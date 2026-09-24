#!/usr/bin/env node
/**
 * sync-fact-graph.mjs
 *
 * Revision-based incremental sync entry point (openspec: changes/
 * source-snapshot, capability `revision-sync`, design D4). This is the
 * ROUTER in front of `lazy-analyze.mjs`'s `runLazyAnalysis`: it decides
 * whether a rebuild is needed at all, and if so whether it is a normal sync
 * or an adapter-type-change full rebuild — the rebuild itself, in every
 * case, is `runLazyAnalysis`'s full deterministic re-projection (D4: this
 * slice does not attempt a "minimal" incremental merge; see design.md for
 * why that is a deliberate, documented trade-off).
 *
 * Decision (spec "freshness mismatch triggers sync" + "adapter-type change triggers full rebuild"):
 *   1. No persisted `source-manifest.json`                -> full rebuild (first build).
 *   2. sourceRevision/selectionDigest/pipelineVersion all
 *      match the persisted manifest                       -> SKIP: no rebuild, manifest not touched.
 *   3. The adapter TYPE changed (the persisted manifest's
 *      `sourceRevision` prefix — `git:`/`multi-repo:`/
 *      `directory:` — differs from the current snapshot's)  -> full rebuild,
 *      never treated as an incremental sync (spec: MUST NOT take the
 *      incremental path here).
 *   4. Otherwise (some field mismatches, same adapter type) -> sync: still a
 *      full re-projection (D4), but the changed-file set is computed and
 *      REPORTED (spec "the change set comes from diff, not guessed") — this is the seam Slice C's
 *      semantic-cache invalidation will read from; it does not drive the
 *      deterministic rebuild itself, which recomputes everything regardless.
 *
 * In every case that rebuilds (1, 3, 4), the actual work is delegated
 * wholesale to `runLazyAnalysis` — produce, D7 guard, publish, manifest
 * advance are ALL its existing logic, reused verbatim rather than
 * reimplemented here. The atomic-save-before-manifest-advance guarantee
 * (spec "atomic save before advancing manifest") is therefore inherited for free: a
 * `runLazyAnalysis` publish failure already leaves `metaAdvanced: false`
 * and the persisted `source-manifest.json` untouched.
 *
 * Changed-file-set computation (spec "the change set comes from diff, not guessed"): MUST NOT
 * hand-construct a new diff algorithm.
 *   - `snapshot.kind === 'git'`: reuses `prepare-incremental.mjs`'s own
 *     NUL-delimited `git diff --name-status` parser (`parseNameStatusZ`)
 *     over `git diff --name-status --no-renames <oldSha> <newSha>`, run
 *     read-only against the real repo (never the materialized temp) — this
 *     IS the "commit diff" the spec asks for. `--no-renames` guarantees a
 *     renamed file is unconditionally reported as an independent delete +
 *     add pair (spec: "a rename, even if Git does not detect it, SHALL be handled as delete+add"),
 *     with no rename-correlation logic needed at all. The full
 *     prepare-incremental.mjs CLI is deliberately NOT shelled out to here:
 *     it requires a clean git working tree and drives the unrelated
 *     Full-mode incremental pipeline (batch-existing.json, symbol
 *     baselines, ...), which would both reintroduce a "dirty working tree
 *     blocks analysis" failure mode this project's GitCommitSnapshot is
 *     built to NOT have, and produce artifacts this Lazy-only slice has no
 *     use for.
 *   - `snapshot.kind === 'directory' | 'multi-repo'`: reuses the snapshot's
 *     own `diff(previousManifest)` (manifest.mjs's `diffEntries`, built in
 *     groups 1-4 of this same change specifically for this reuse — see that
 *     module's own doc comment) — a content-hash manifest diff, which is
 *     exactly "a non-Git directory SHALL use the before/after manifest diff". It likewise has no
 *     rename correlation, so a rename is delete + add there too.
 *
 * Both paths need the PREVIOUS manifest's `{path, contentHash}` entries,
 * which is why `lazy-analyze.mjs`'s publish step now persists `entries` on
 * `source-manifest.json` (see that file's own comment at the write site).
 *
 * source-index.jsonl incremental reuse (openspec: changes/hybrid-retrieval,
 * capability `source-index`, D2; line-oriented persistence added by
 * changes/product-serialization-ceiling, design D1): a sync that already
 * computed a changed-file set (branch 4 above) also reuses
 * `updateSourceIndex` — via `buildOrUpdateSourceIndex` below — to rebuild
 * ONLY the touched files' chunks against the previously-persisted
 * `source-index.jsonl`, instead of `lazy-analyze.mjs`'s default full
 * `buildSourceIndex`. This is passed to `runLazyAnalysis` as its
 * `buildSourceIndexStep` override; a first build or an adapter-type-change
 * full rebuild (branches 1/3, `changed === null`) gets no override and falls
 * back to lazy-analyze's own full-build default, as does a project with no
 * previously-persisted `source-index.jsonl` yet (a Slice-C upgrade of an
 * existing Slice-A/B project, or one upgrading from `PIPELINE_VERSION` `/1`).
 *
 * Contract: openspec/changes/source-snapshot/specs/revision-sync/spec.md
 *           openspec/changes/hybrid-retrieval/specs/source-index/spec.md
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { resolveSourceSnapshot } from './source-snapshot.mjs';
import { parseNameStatusZ } from './prepare-incremental.mjs';
import { runLazyAnalysis, defaultRunScript, PIPELINE_VERSION } from './lazy-analyze.mjs';
import { buildSourceIndex, updateSourceIndex } from './build-source-index.mjs';
import { SOURCE_INDEX_FILE, readSourceIndex } from './source-index-store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');

/** Same two-step @excavator/core resolution every sibling script uses. */
async function resolveCore(root) {
  const require = createRequire(resolve(root, 'package.json'));
  try {
    return await import(pathToFileURL(require.resolve('@excavator/core')).href);
  } catch {
    return await import(pathToFileURL(resolve(root, 'packages/core/dist/index.js')).href);
  }
}

/** Same `--exclude <patterns>` CLI flag parsing lazy-analyze.mjs uses, kept
 *  identical so a caller can pass the same argv to both. */
function parseExcludePatterns(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--exclude' && typeof argv[i + 1] === 'string') {
      return argv[i + 1].split(',').map((p) => p.trim()).filter(Boolean);
    }
  }
  return [];
}

/** The adapter-kind prefix of a `revision` string (`git`, `multi-repo` or
 *  `directory`) — everything up to (not including) the first `:`. */
function adapterKindOf(revision) {
  const idx = revision.indexOf(':');
  return idx === -1 ? revision : revision.slice(0, idx);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

/**
 * `git diff --name-status --no-renames -z <oldSha> <newSha>`, parsed via
 * prepare-incremental.mjs's own `parseNameStatusZ` (literal reuse, not a
 * reimplementation — see the module doc above). `--no-renames` means the
 * only statuses `parseNameStatusZ` can ever hand back here are single-path
 * ones (A/M/D/T/...), so every change classifies into exactly one bucket.
 *
 * @param {string} repoRoot
 * @param {string} oldSha
 * @param {string} newSha
 * @returns {{ added: string[], modified: string[], removed: string[] }}
 */
function gitCommitDiff(repoRoot, oldSha, newSha) {
  const result = spawnSync(
    'git',
    ['diff', '--name-status', '--no-renames', '-z', '--relative', oldSha, newSha, '--', '.'],
    { cwd: repoRoot, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(
      `sync-fact-graph: git diff --name-status ${oldSha}..${newSha} failed in ${repoRoot}: ${result.stderr || result.status}`,
    );
  }
  const changes = parseNameStatusZ(result.stdout ?? '');
  const added = [];
  const modified = [];
  const removed = [];
  for (const change of changes) {
    const kind = change.status[0];
    if (kind === 'A') added.push(change.path);
    else if (kind === 'D') removed.push(change.path);
    else modified.push(change.path); // M, T (typechange), etc.
  }
  return { added: sortedUnique(added), modified: sortedUnique(modified), removed: sortedUnique(removed) };
}

/** Restrict a raw diff's three buckets to paths that are actually part of
 *  the current or the previous analysis inventory, so a change to an
 *  excluded/ignored path (`.excavator/`, a file matched by
 *  `.excavatorignore`, ...) never appears in the reported changed-file set. */
function restrictToInventory(diff, currentPaths, previousPaths) {
  return {
    added: diff.added.filter((p) => currentPaths.has(p)),
    modified: diff.modified.filter((p) => currentPaths.has(p) && previousPaths.has(p)),
    removed: diff.removed.filter((p) => previousPaths.has(p)),
  };
}

/**
 * Compute the changed-file-set report for a non-skip, non-adapter-change
 * sync (see the module doc's "Changed-file-set computation" section for the
 * per-kind rationale).
 *
 * @param {object} snapshot the CURRENT resolved SourceSnapshot
 * @param {{ sourceRevision: string, entries?: Array<{path:string,contentHash:string}> }} persistedManifest
 * @returns {{ added: string[], modified: string[], removed: string[] }}
 */
export function computeChangedFileSet(snapshot, persistedManifest) {
  const currentPaths = new Set(snapshot.listFiles());
  const previousPaths = new Set((persistedManifest.entries ?? []).map((e) => e.path));

  const raw = snapshot.kind === 'git'
    ? gitCommitDiff(snapshot.root, persistedManifest.sourceRevision.slice('git:'.length), snapshot.sha)
    : snapshot.diff(persistedManifest);

  return restrictToInventory(raw, currentPaths, previousPaths);
}

/**
 * Decide how `source-index.jsonl` should be produced for this run (openspec:
 * changes/hybrid-retrieval, capability `source-index`, D2): reuse
 * `updateSourceIndex`'s single-file incremental rebuild whenever there IS a
 * computed changed-file-set AND a previously-persisted `source-index.jsonl`
 * to update against; otherwise fall back to a full `buildSourceIndex` (first
 * build, an adapter-type-change full rebuild, or a project with no
 * source-index.jsonl yet). Pure and exported so this decision is directly
 * unit-testable (inject fake `buildFn`/`updateFn` and assert which one was
 * called) without needing to run the real pipeline.
 *
 * @param {{
 *   changed: {added:string[],modified:string[],removed:string[]}|null,
 *   previousIndex: object|null,
 *   scan: object, structureAll: object, readFile: (p:string)=>string, sourceRevision: string,
 *   buildFn?: typeof buildSourceIndex, updateFn?: typeof updateSourceIndex,
 * }} args
 */
export function buildOrUpdateSourceIndex({
  changed, previousIndex, scan, structureAll, readFile, sourceRevision,
  buildFn = buildSourceIndex, updateFn = updateSourceIndex,
}) {
  if (changed && previousIndex) {
    return updateFn({ previousIndex, structureAll, changed, readFile, sourceRevision });
  }
  return buildFn({ scan, structureAll, readFile, sourceRevision });
}

/** Read a previously-persisted `source-index.jsonl`, if any. ANY failure to
 *  read it — missing, malformed content (`SourceIndexFormatError`), or a
 *  plain filesystem error (EACCES/EISDIR/EIO/...) — is treated the same as
 *  "no previous index": `buildOrUpdateSourceIndex` then safely falls back to
 *  a full rebuild rather than failing the whole sync over a damaged
 *  incidental artifact (design D3: treat it as if there were no previous
 *  version at all and fall back to a full rebuild — no exception for WHY the
 *  read failed). This is a catch-all deliberately, not a
 *  catch-only-format-errors: this read runs BEFORE `syncFactGraph`'s
 *  freshness-skip check below, so an unreadable/odd `.jsonl` (a directory
 *  left at that path, a permission error, ...) must not fail even a sync
 *  that should have been skipped entirely — its result is discarded on that
 *  path regardless. The legacy whole-document `source-index.json` is never
 *  read here even if it is the only thing present (zero-compat, design
 *  D3/D6) — a project upgrading from `PIPELINE_VERSION` `/1` to `/2`
 *  legitimately has no `.jsonl` yet, which this same "no previous index ->
 *  full rebuild" path already handles correctly. Exported for direct unit
 *  testing of this catch-all (mirrors `computeChangedFileSet`/
 *  `buildOrUpdateSourceIndex` below, exported for the same reason). */
export function readPreviousSourceIndex(sourceIndexPath) {
  if (!existsSync(sourceIndexPath)) return null;
  try {
    return readSourceIndex(sourceIndexPath);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The router.
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   projectRoot: string,
 *   argv?: string[],
 *   now?: () => string,
 *   runScript?: (scriptName: string, args: string[]) => { status: number, stdout: string, stderr: string },
 * }} options
 * @returns {Promise<{
 *   kind: 'skipped'|'synced'|'full-rebuild',
 *   reason: string,
 *   sourceRevision: string,
 *   previousSourceRevision: string|null,
 *   metaAdvanced: boolean,
 *   saveError: string|null,
 *   changed: {added: string[], modified: string[], removed: string[]}|null,
 *   lazyResult: object|null,
 * }>}
 */
export async function syncFactGraph({
  projectRoot,
  argv = [],
  now = () => new Date().toISOString(),
  runScript = defaultRunScript,
} = {}) {
  if (!projectRoot) throw new Error('syncFactGraph: projectRoot is required');
  const root = resolve(projectRoot);

  const core = await resolveCore(pluginRoot);
  const { resolveDataDir } = core;
  const dataDir = resolveDataDir(root);
  const manifestPath = join(dataDir, 'source-manifest.json');
  const sourceIndexPath = join(dataDir, SOURCE_INDEX_FILE);

  const extraExcludePatterns = parseExcludePatterns(argv);
  const snapshot = resolveSourceSnapshot(root, { extraExcludePatterns });

  const persisted = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf-8'))
    : null;
  // Read BEFORE the rebuild below overwrites it — this is the "previous"
  // half of the incremental source-index update.
  const previousSourceIndex = readPreviousSourceIndex(sourceIndexPath);

  // 1. Freshness match -> SKIP: no rebuild, manifest not touched (spec
  // "manifest matches, skip").
  if (
    persisted
    && persisted.sourceRevision === snapshot.revision
    && persisted.selectionDigest === snapshot.selectionDigest
    && persisted.pipelineVersion === PIPELINE_VERSION
  ) {
    return {
      kind: 'skipped',
      reason: 'sourceRevision/selectionDigest/pipelineVersion all match the persisted source-manifest.json',
      sourceRevision: snapshot.revision,
      previousSourceRevision: persisted.sourceRevision,
      metaAdvanced: false,
      saveError: null,
      changed: null,
      lazyResult: null,
    };
  }

  // 2. Adapter-type change -> full rebuild, never incremental (spec "adapter
  // adapter-type change triggers full rebuild" — MUST NOT compute/act on a diff in this branch).
  const adapterChanged = persisted !== null
    && adapterKindOf(persisted.sourceRevision) !== adapterKindOf(snapshot.revision);

  // 3. Changed-file-set report — only meaningful when there IS a previous
  // manifest of the SAME adapter kind to diff against.
  const changed = (persisted !== null && !adapterChanged)
    ? computeChangedFileSet(snapshot, persisted)
    : null;

  // D4: the rebuild itself is ALWAYS runLazyAnalysis's full deterministic
  // re-projection — reused wholesale (produce + D7 guard + publish + atomic
  // manifest advance), for every branch that reaches this point. The
  // source-index build strategy is the one piece this router DOES override:
  // when there is a changed-file-set AND a previous index to update against,
  // reuse the incremental `updateSourceIndex` path (hybrid-retrieval D2)
  // instead of lazy-analyze's own full-rebuild default.
  const buildSourceIndexStep = ({ scan, structureAll, readFile, sourceRevision }) =>
    buildOrUpdateSourceIndex({ changed, previousIndex: previousSourceIndex, scan, structureAll, readFile, sourceRevision });
  const lazyResult = await runLazyAnalysis({ projectRoot: root, argv, now, runScript, buildSourceIndexStep });

  let kind;
  let reason;
  if (persisted === null) {
    kind = 'full-rebuild';
    reason = 'no persisted source-manifest.json — first build';
  } else if (adapterChanged) {
    kind = 'full-rebuild';
    reason = `adapter type changed (${adapterKindOf(persisted.sourceRevision)} -> ${adapterKindOf(snapshot.revision)}) — full rebuild, not incremental`;
  } else {
    kind = 'synced';
    reason = 'sourceRevision/selectionDigest/pipelineVersion mismatch — full deterministic re-projection';
  }

  return {
    kind,
    reason,
    sourceRevision: lazyResult.sourceRevision,
    previousSourceRevision: persisted?.sourceRevision ?? null,
    metaAdvanced: lazyResult.metaAdvanced,
    saveError: lazyResult.saveError,
    changed,
    lazyResult,
  };
}

// ---------------------------------------------------------------------------
// CLI entry.
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const [projectRoot, ...rest] = argv;
  if (!projectRoot) {
    process.stderr.write('Usage: node sync-fact-graph.mjs <projectRoot> [--exclude <patterns>]\n');
    process.exit(1);
  }

  const result = await syncFactGraph({ projectRoot, argv: rest });

  process.stderr.write(
    `sync-fact-graph: ${result.kind} (${result.reason}); sourceRevision=${result.sourceRevision} ` +
    `metaAdvanced=${result.metaAdvanced}` +
    (result.changed
      ? ` changed=+${result.changed.added.length}/~${result.changed.modified.length}/-${result.changed.removed.length}`
      : '') +
    '\n',
  );
  if (result.saveError) {
    process.stderr.write(`sync-fact-graph: SAVE FAILED: ${result.saveError}\n`);
    process.exit(1);
  }
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`sync-fact-graph.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}

export default {
  syncFactGraph,
  computeChangedFileSet,
  buildOrUpdateSourceIndex,
  readPreviousSourceIndex,
};
