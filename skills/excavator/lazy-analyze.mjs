#!/usr/bin/env node
/**
 * lazy-analyze.mjs
 *
 * The Lazy first-run driver (openspec: changes/lazy-first-run, capability
 * `lazy-analysis`, design decision D4). Runs, in sequence and with ZERO
 * subagent/model dispatch:
 *
 *   Scan -> Structure-All -> Import-Map -> Build Fact Graph
 *     -> Deterministic Validate -> Save
 *
 * skipping every LLM phase of the existing pipeline (1.5 BATCH, 2 ANALYZE,
 * 2.3 ANNOTATE, 2.5 VERIFY, 3 ASSEMBLE, 4 ARCHITECTURE, 6 REVIEW). It never
 * imports or invokes any `excavator-*-analyzer/verifier/reviewer` subagent
 * definition — there is in fact no mechanism for a plain Node script to
 * dispatch one; subagent dispatch is a capability of the orchestrating host
 * agent reading SKILL.md prose, not of code. It also produces no LLM batch
 * file, no HTML, and no Tour.
 *
 * Mode resolution is NOT this driver's job. `resolve-mode.mjs` (a pure
 * function) and SKILL.md's Phase 0 decide whether a run is `lazy` or `full`,
 * and SKILL.md only ever invokes this script once that decision is already
 * `lazy`. This keeps the two pieces single-purpose: resolve-mode picks the
 * mode, this driver executes the Lazy pipeline unconditionally.
 *
 * Scripts reuse: `scan-project.mjs`, `structure-all.mjs` and
 * `extract-import-map.mjs` expose only a CLI entrypoint (their core logic is
 * not separately exported), so they are spawned exactly as SKILL.md's
 * Phase 1 / Phase 1.2 already invoke them, and their JSON output files are
 * read back. `build-fact-graph.mjs` is different by design (D1: it is a
 * projection meant for in-process/programmatic use — see its own header
 * doc), so it is imported and called directly here, skipping one redundant
 * file round-trip. `build-fingerprints.mjs` has NO `isCliEntry()` guard
 * around its `main()` (it always runs on import — see its last line,
 * `await main();`), so it is always spawned, never imported, exactly like
 * every other caller in this repo does.
 *
 * Deterministic validate: this driver does NOT reuse `validate-graph.mjs`'s
 * `validateAgainstSource` wholesale. That function assumes a Full-pipeline
 * KnowledgeGraph where every file-level node is assigned to a `layers[]`
 * entry (Phase 4's job) and flags any that are not as an "issue". The Lazy
 * fact projection intentionally carries NO layers at all — Phase 4 is one of
 * the phases Lazy skips by design (D4), and `build-fact-graph.test.mjs`
 * documents this explicitly ("build-fact-graph's return value carries no
 * `layers` key at all"). Running `validateAgainstSource` unmodified against
 * it would flag literally every file node as "not in any layer" — noise
 * from a phase mismatch, not a real defect. Instead, `validateFactGraphIntegrity`
 * below is a lighter, purpose-built check over exactly the fact projection's
 * own shape: every edge endpoint resolves to a known node id (no dangling
 * edges), no duplicate node ids, and the coverage ledger's own conservation
 * identity holds (reusing `coverage-ledger.mjs`'s `conservationViolations`,
 * the same helper `build-fact-graph.test.mjs` already uses for this
 * purpose). See the task report for the full reasoning.
 *
 * Non-destructive save: flipping the default to `lazy` MUST NOT wipe or
 * downgrade an already-existing (Full-mode) graph's `summary`/`tags`/other
 * semantic fields (lazy-analysis spec, Requirement "analysisMode config
 * and --mode flag", Scenario "an existing full graph must not be broken by
 * defaulting to lazy"). See
 * `mergeFactProjectionIntoGraph` below: it refreshes only structural fields
 * on nodes the fact projection already knows about, preserves every
 * semantic field a prior Full run wrote, and never removes an existing node,
 * edge, layer, or tour step.
 *
 * Save gate: mirrors Phase 7's existing rule exactly — the fingerprints
 * baseline MUST be built successfully before `meta.json` is written; on
 * failure, `meta.json` (and, by not being asked to advance, `fingerprints`)
 * stay at their last successful state. The knowledge graph write itself is
 * unconditional (matching Phase 7 step 1, which is likewise not gated on the
 * fingerprints step that follows it). The fingerprints baseline itself is
 * BUILT inside `produce()`, against the materialized snapshot content (HEAD
 * for a git target — Fix B of openspec change `source-snapshot`, Slice B),
 * not against the real `root`; `publish()` only relocates the already-built
 * `fingerprints.json` into the real `root/.excavator/` once the guard has
 * confirmed the source did not change (see `produce()`'s "Structural
 * fingerprints baseline" step for why it cannot be built in `publish()`
 * itself: the materialized temp dir is already gone by then).
 *
 * SourceSnapshot (openspec: changes/source-snapshot, capability
 * `source-snapshot`, design D5): this driver no longer decides "what source
 * to analyze" itself — `resolveSourceSnapshot(root)` does (git repo ->
 * GitCommitSnapshot HEAD-only, non-git parent with member repos ->
 * MultiRepoSnapshot, otherwise -> DirectorySnapshot), and every read the
 * scan/structure/import-map scripts perform below goes through that
 * snapshot's `materialize()`-produced temp directory, never `root` directly.
 * The whole produce step runs under `snapshot.runGuarded(producer, publish)`
 * (D7's consistency guard): `publish` — the actual `saveGraph`/fingerprints/
 * `saveMeta`/`source-manifest.json` writes — only ever runs once the guard
 * has confirmed nothing about the source changed for the run's whole
 * duration; a DirectorySnapshot that keeps drifting retries once and then
 * fails visibly (`saveError` set, `metaAdvanced` false, nothing published).
 * `source-manifest.json` (`sourceRevision`/`selectionDigest`/
 * `pipelineVersion`) is written in the same publish step, right alongside
 * `knowledge-graph.json`/`meta.json`/`fingerprints.json`. This slice does
 * NOT add revision-based incremental sync (group 5 / `revision-sync`) — every
 * run here is still a full deterministic re-projection.
 *
 * source-index.jsonl (openspec: changes/hybrid-retrieval, capability
 * `source-index`, D2; line-oriented persistence added by changes/product-
 * serialization-ceiling, design D1): built here alongside the knowledge
 * graph, from the SAME `scan`/`structureAll` this run already produced, via
 * an injectable `buildSourceIndexStep` (defaulting to a plain
 * `buildSourceIndex` full build). `sync-fact-graph.mjs` overrides this step
 * for an incremental sync so it can reuse `updateSourceIndex` against the
 * previously-persisted index and the already-computed changed-file set,
 * instead of always rebuilding every chunk — this driver itself stays
 * agnostic to that choice. Staged and replaced in `publish()` as one of the
 * five products in the same all-or-nothing publish (design D4) as
 * `knowledge-graph.json`/`fingerprints.json`/`meta.json`/
 * `source-manifest.json` — it is likewise keyed by `sourceRevision` and must
 * never advance out of step with the manifest.
 *
 * Contract: openspec/changes/lazy-first-run/specs/lazy-analysis/spec.md
 *           openspec/changes/source-snapshot/specs/source-snapshot/spec.md
 *           openspec/changes/hybrid-retrieval/specs/source-index/spec.md
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync,
  linkSync, copyFileSync, renameSync, rmSync, readdirSync, unlinkSync, statSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

import { buildFactGraph } from './build-fact-graph.mjs';
import { buildSourceIndex } from './build-source-index.mjs';
import { conservationViolations } from './coverage-ledger.mjs';
import { mergeSnapshotSelection } from './scan-project.mjs';
import { resolveSourceSnapshot } from './source-snapshot.mjs';
import { LEGACY_SOURCE_INDEX_FILE, SOURCE_INDEX_FILE, writeSourceIndex } from './source-index-store.mjs';
import { DEFAULT_LIMIT_CHARS, ProductTooLargeError, createHeadroomRecorder, serializeJsonProduct } from './product-serialization.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');

/** Version stamped into every Lazy-produced KnowledgeGraph / meta.json. */
export const KNOWLEDGE_GRAPH_VERSION = '1.0.0';
/** Stamped into `project.pipelineVersion` — bump when the fact projection's
 *  shape changes in a way downstream consumers should be able to tell apart.
 *  Bumped to /2 by openspec change product-serialization-ceiling: source
 *  index persistence changed from a single whole-document `source-index.json`
 *  to line-oriented `source-index.jsonl` (design D1/D6) — an already-analyzed
 *  project's next run must rebuild rather than try to read the old file. */
export const PIPELINE_VERSION = 'lazy-fact-graph/2';

/** Same two-step @excavator/core resolution every sibling script uses. */
async function resolveCore(root) {
  const require = createRequire(resolve(root, 'package.json'));
  try {
    return await import(pathToFileURL(require.resolve('@excavator/core')).href);
  } catch {
    return await import(pathToFileURL(resolve(root, 'packages/core/dist/index.js')).href);
  }
}

// ---------------------------------------------------------------------------
// Deterministic validate — see the module doc above for why this is a
// purpose-built check rather than a reuse of validate-graph.mjs.
// ---------------------------------------------------------------------------

/**
 * A lighter, deterministic internal-integrity check purpose-built for the
 * Lazy fact projection. Pure function; no I/O, no source re-read.
 *
 * @param {{ nodes: object[], edges: object[], coverage: object }} projection
 * @returns {{ ok: boolean, issues: string[] }}
 */
export function validateFactGraphIntegrity({ nodes, edges, coverage }) {
  const issues = [];
  const nodeIds = new Set();
  for (const node of nodes ?? []) {
    if (!node || typeof node.id !== 'string' || node.id.length === 0) {
      issues.push('a node is missing a string id');
      continue;
    }
    if (nodeIds.has(node.id)) issues.push(`duplicate node id: ${node.id}`);
    nodeIds.add(node.id);
  }
  for (const edge of edges ?? []) {
    if (!edge || !nodeIds.has(edge.source)) {
      issues.push(`edge source not found among nodes: ${edge?.source} (${edge?.type})`);
    }
    if (!edge || !nodeIds.has(edge.target)) {
      issues.push(`edge target not found among nodes: ${edge?.target} (${edge?.type})`);
    }
  }
  for (const violation of conservationViolations(coverage ?? {})) {
    issues.push(
      `coverage conservation violated for language "${violation.language}": ` +
      `files=${violation.files} accounted=${violation.accounted}`,
    );
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Non-destructive merge — see the module doc above.
// ---------------------------------------------------------------------------

/** Semantic node fields a prior (Full-mode) run may have written, and which
 *  Lazy must never clear or downgrade. Structural fields (id/type/name/
 *  filePath/lineRange/owner/anchorSource/complexity) are NOT in this list —
 *  those are always refreshed from the fresh fact projection. */
const SEMANTIC_NODE_FIELDS = Object.freeze([
  'summary', 'tags', 'verification', 'languageNotes', 'domainMeta', 'knowledgeMeta', 'figmaMeta',
]);

function edgeKey(e) {
  return `${e.type}|${e.source}|${e.target}|${e.direction}`;
}

/**
 * Merge the deterministic fact projection into an already-existing
 * KnowledgeGraph (produced by a prior Full run, or a prior Lazy sync),
 * without discarding any model-authored semantics.
 *
 * - Nodes: for every fact node, if a node with the same id already exists,
 *   its structural fields are refreshed from the fresh projection while its
 *   semantic fields (see `SEMANTIC_NODE_FIELDS`) are preserved verbatim. A
 *   fact node with no prior counterpart is added as-is (nothing to
 *   preserve — it is genuinely new). An existing node the fresh projection
 *   no longer sees is DROPPED when it is itself fact-provenance (carries a
 *   `filePath`) — design D4's full re-projection (openspec: changes/
 *   source-snapshot, capability `revision-sync`) is exhaustive over every
 *   currently-scanned file, so a fact node it does not reproduce genuinely
 *   no longer exists (its file was deleted, or its declaration was
 *   renamed/removed); keeping it would violate revision-sync's "deleted files'
 *   fact nodes and edges SHALL be removed" and leave stale line numbers behind. A node
 *   with NO `filePath` (never produced by the fact layer — e.g. a
 *   Full-mode-only conceptual/grouping node) is preserved exactly as
 *   before: Lazy has no way to reason about it, so "leave it rather than
 *   guess" still applies there.
 * - Edges: the fresh projection is likewise exhaustive for every edge that
 *   touches a CURRENT fact node (an edge whose endpoint is a fact node was
 *   necessarily re-derivable this run, since that node's whole file was
 *   re-extracted). An existing edge is therefore stale — and dropped —
 *   whenever either endpoint is a fact node id (present now, or just
 *   dropped as stale above), unless the fresh projection reproduces that
 *   exact edge. An edge between two non-fact ids (Full-mode-only nodes with
 *   no `filePath`) is preserved as-is; Lazy never re-derives those.
 * - `layers` / `tour`: left exactly as they were; Lazy populates neither.
 *
 * @param {object|null} existing a previously-saved KnowledgeGraph, or null
 * @param {{ nodes: object[], edges: object[] }} projection build-fact-graph's output
 * @returns {{ nodes: object[], edges: object[], layers: object[], tour: object[] }}
 */
export function mergeFactProjectionIntoGraph(existing, projection) {
  const existingNodesById = new Map((existing?.nodes ?? []).map((n) => [n.id, n]));

  const nodes = [];
  const seenIds = new Set();
  for (const factNode of projection.nodes) {
    const prior = existingNodesById.get(factNode.id);
    if (prior) {
      const merged = { ...factNode };
      for (const field of SEMANTIC_NODE_FIELDS) {
        if (prior[field] !== undefined) merged[field] = prior[field];
      }
      nodes.push(merged);
    } else {
      nodes.push(factNode);
    }
    seenIds.add(factNode.id);
  }
  const staleFactIds = new Set();
  for (const node of existing?.nodes ?? []) {
    if (seenIds.has(node.id)) continue;
    if (typeof node.filePath === 'string' && node.filePath.length > 0) {
      staleFactIds.add(node.id); // dropped — not pushed to `nodes`.
      continue;
    }
    nodes.push(node);
  }
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const factNodeIds = new Set([...projection.nodes.map((n) => n.id), ...staleFactIds]);
  const freshEdgeKeys = new Set(projection.edges.map(edgeKey));
  const survivingExistingEdges = (existing?.edges ?? []).filter((e) => {
    if (freshEdgeKeys.has(edgeKey(e))) return false; // reintroduced once, from projection.edges below.
    return !factNodeIds.has(e.source) && !factNodeIds.has(e.target);
  });
  const edges = [...survivingExistingEdges, ...projection.edges];

  return {
    nodes,
    edges,
    layers: existing?.layers ?? [],
    tour: existing?.tour ?? [],
  };
}

// ---------------------------------------------------------------------------
// Script spawning — matches how SKILL.md's phases already invoke these
// bundled scripts (`node <script> <args>`). Returns a uniform result object
// instead of throwing, so the caller decides what is fatal and tests can
// inject a failure for a single script without touching the others.
// ---------------------------------------------------------------------------

/** @param {string} scriptName @param {string[]} args */
export function defaultRunScript(scriptName, args) {
  const scriptPath = join(__dirname, scriptName);
  const result = spawnSync('node', [scriptPath, ...args], {
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function basenameOf(p) {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/**
 * Deterministic, model-free project name/description: read package.json's
 * own literal fields when present. No synthesis, no inference — an absent
 * or field-less manifest just means an empty description, which is honest,
 * not a gap to paper over with a guess.
 */
function deterministicProjectMeta(projectRoot) {
  const pkgPath = join(projectRoot, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return {
        name: typeof pkg.name === 'string' && pkg.name.length > 0 ? pkg.name : basenameOf(projectRoot),
        description: typeof pkg.description === 'string' ? pkg.description : '',
      };
    } catch {
      // Unreadable/invalid package.json — fall through to the directory-name
      // fallback below rather than fail the whole run over a narrative field.
    }
  }
  return { name: basenameOf(projectRoot), description: '' };
}

/** `--exclude <patterns>` passthrough to `scan-project.mjs`, if present. */
function extractExcludeArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--exclude' && typeof argv[i + 1] === 'string') {
      return ['--exclude', argv[i + 1]];
    }
  }
  return [];
}

/** Same `--exclude <patterns>` CLI flag, parsed into a raw pattern array for
 *  `resolveSourceSnapshot`'s `extraExcludePatterns` (so a CLI exclude applies
 *  to the snapshot's OWN selection/selectionDigest too, not only to
 *  scan-project's redundant re-filter over the already-materialized temp). */
function parseExcludePatterns(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--exclude' && typeof argv[i + 1] === 'string') {
      return argv[i + 1].split(',').map((p) => p.trim()).filter(Boolean);
    }
  }
  return [];
}

function readJsonRequired(path, label) {
  if (!existsSync(path)) throw new Error(`lazy-analyze: ${label} not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** Default `buildSourceIndexStep`: an unconditional full build (first run,
 *  a full rebuild, or any caller with no better strategy — see
 *  sync-fact-graph.mjs's `buildOrUpdateSourceIndex` for the incremental
 *  override an actual sync passes instead). */
function defaultBuildSourceIndexStep({ scan, structureAll, readFile, sourceRevision }) {
  return buildSourceIndex({ scan, structureAll, readFile, sourceRevision });
}

// ---------------------------------------------------------------------------
// Staged publish (openspec: changes/product-serialization-ceiling, design
// D4) — write every final product into a staging directory first, then
// replace the final files one at a time only once every staged write
// succeeded; a failure anywhere leaves every final product untouched. See
// `publish()` below for the full sequence.
// ---------------------------------------------------------------------------

/** The five products a publish stages/replaces, and their fixed replace
 *  order (spec: "graph -> fingerprints -> source-index -> meta -> manifest"). */
const PUBLISH_PRODUCT_ORDER = ['graph', 'fingerprints', 'sourceIndex', 'meta', 'manifest'];
const PUBLISH_PRODUCT_FILENAME = Object.freeze({
  graph: 'knowledge-graph.json',
  fingerprints: 'fingerprints.json',
  sourceIndex: SOURCE_INDEX_FILE,
  meta: 'meta.json',
  manifest: 'source-manifest.json',
});

/** Narrow, real-fs-backed seam (design D4's "FAULT INJECTION" requirement):
 *  every disk operation `publish()` performs goes through this object, so a
 *  test can override exactly one operation (optionally only for one path) to
 *  simulate a failure at exactly one staged product or one replace step,
 *  without touching production behavior at all — every method here is a
 *  thin, literal wrapper around the real `node:fs` call. */
export const defaultPublishFs = Object.freeze({
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  writeFile: (path, content) => writeFileSync(path, content, 'utf-8'),
  writeSourceIndex: (path, index) => writeSourceIndex(path, index),
  exists: (path) => existsSync(path),
  link: (existingPath, newPath) => linkSync(existingPath, newPath),
  copyFile: (src, dest) => copyFileSync(src, dest),
  rename: (oldPath, newPath) => renameSync(oldPath, newPath),
  rm: (path) => rmSync(path, { recursive: true, force: true }),
  unlink: (path) => unlinkSync(path),
  readdir: (path) => readdirSync(path),
});

/** `true` iff a process with this pid is currently running (checked via the
 *  zero-signal `process.kill(pid, 0)` probe — sends no actual signal, only
 *  tests existence/permission). An error OTHER than ESRCH (e.g. EPERM: the
 *  process exists but we lack permission to signal it) is treated as "still
 *  alive" — the conservative direction, since a live pid's staging directory
 *  must never be removed out from under it. */
function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

/** Removes `.publish-staging-<pid>-<random>` directories left behind by a
 *  publish that was killed mid-replace (design D4, step 3: the NEXT publish
 *  cleans up same-prefix staging directories whose process no longer
 *  exists). Called at the very start of
 *  EVERY `publish()`, before this run's own staging directory is created, so
 *  there is no risk of this scan ever seeing (and needing to specially
 *  exclude) its own not-yet-created directory. A directory whose pid is
 *  still alive, or whose name does not match this exact naming scheme, is
 *  left alone unconditionally. */
export function cleanupStalePublishStagingDirs(dataDir, publishFs) {
  let entries;
  try {
    entries = publishFs.readdir(dataDir);
  } catch {
    return; // dataDir does not exist yet (very first run ever) — nothing to clean.
  }
  for (const entry of entries) {
    const match = /^\.publish-staging-(\d+)-/.exec(entry);
    if (!match) continue;
    if (pidIsAlive(Number(match[1]))) continue;
    try {
      publishFs.rm(join(dataDir, entry));
    } catch {
      // Best-effort: a stale directory that resists cleanup is left for the
      // NEXT publish to retry — never fatal to the current run.
    }
  }
}

// ---------------------------------------------------------------------------
// The driver.
// ---------------------------------------------------------------------------

/**
 * Run the Lazy first-run pipeline once, synchronously in sequence:
 * Scan -> Structure-All -> Import-Map -> Build Fact Graph -> Validate -> Save.
 *
 * @param {{
 *   projectRoot: string,
 *   argv?: string[],
 *   now?: () => string,
 *   runScript?: (scriptName: string, args: string[]) => { status: number, stdout: string, stderr: string },
 *   buildSourceIndexStep?: (args: { scan: object, structureAll: object, readFile: (p: string) => string, sourceRevision: string }) => object,
 * }} options
 */
export async function runLazyAnalysis({
  projectRoot,
  argv = [],
  now = () => new Date().toISOString(),
  runScript = defaultRunScript,
  buildSourceIndexStep = defaultBuildSourceIndexStep,
  publishFs = defaultPublishFs,
  serializationLimit = DEFAULT_LIMIT_CHARS,
} = {}) {
  // Wall-clock total (design D7): the WHOLE run, not a sum of stage timers —
  // measured from the very first line so it also covers time no per-stage
  // timer attributes to itself (module/`@excavator/core` resolution, ...).
  const runStartedAt = performance.now();

  if (!projectRoot) throw new Error('runLazyAnalysis: projectRoot is required');
  const root = resolve(projectRoot);

  const core = await resolveCore(pluginRoot);
  const { resolveDataDir, loadGraph, sanitiseFilePaths } = core;

  const dataDir = resolveDataDir(root);
  const intermediateDir = join(dataDir, 'intermediate');
  mkdirSync(intermediateDir, { recursive: true });
  const graphPath = join(dataDir, 'knowledge-graph.json');

  // SourceSnapshot decides WHAT gets analyzed (design D2/D5) — this driver
  // no longer calls `git rev-parse HEAD` or reads `root` directly to decide
  // analysis content; every read below goes through the snapshot's
  // `materialize()`-produced temp directory instead.
  const extraExcludePatterns = parseExcludePatterns(argv);
  const preProduceTimings = {}; // merged into product.timings once a product exists (see the very end of this function)
  const snapshotResolveStart = Date.now();
  const snapshot = resolveSourceSnapshot(root, { extraExcludePatterns });
  preProduceTimings.snapshotResolve = Date.now() - snapshotResolveStart;

  const saveState = { metaAdvanced: false, saveError: null };
  let lastProduct = null;
  /** Set immediately before the `runGuarded` call below; read at the very
   *  start of `produce()` to measure "snapshotMaterialize" (design D7: the
   *  time from entering runGuarded to produce starting) — the time
   *  `runGuarded` itself spends in `materialize()` before invoking this
   *  producer callback. On the (rare)
   *  D7-guard retry path this also folds in the discarded first attempt's
   *  materialize+drift-detection time; that is an accepted simplification
   *  for what is a performance OBSERVATION, not a correctness gate. */
  let beforeRunGuardedAt = null;

  // --- Produce: run the existing Scan -> Structure-All -> Import-Map ->
  // Build Fact Graph -> Deterministic Validate pipeline against the
  // MATERIALIZED snapshot content (never `root` directly). ------------------
  async function produce(materializedDir, activeSnapshot) {
    const timings = { snapshotMaterialize: Date.now() - beforeRunGuardedAt };
    function time(label, fn) {
      const start = Date.now();
      const value = fn();
      timings[label] = Date.now() - start;
      return value;
    }
    // One recorder per produce ATTEMPT (not shared across a D7-guard retry —
    // a discarded attempt's entries must not leak into the winning one's
    // report). Carried to `publish()` via `product.recorder` so the final
    // five products' own serializeJsonProduct calls add to the SAME table.
    const recorder = createHeadroomRecorder();
    const limit = serializationLimit;

    // --- Phase 1 SCAN (script, never the excavator-project-scanner subagent) -
    const scanPath = join(intermediateDir, 'scan-result.json');
    time('scan', () => {
      // `.excavator/` exclusion is now guaranteed by the snapshot's own
      // selection (it is never materialized into `materializedDir` at all),
      // so --exclude-analysis-data is redundant belt-and-suspenders here —
      // kept because it is harmless and other callers still rely on it.
      const result = runScript('scan-project.mjs', [materializedDir, scanPath, '--exclude-analysis-data', ...extractExcludeArgs(argv)]);
      if (result.status !== 0) {
        throw new Error(`lazy-analyze: scan-project.mjs failed: ${result.stderr || result.status}`);
      }
    });
    const scan = mergeSnapshotSelection(
      readJsonRequired(scanPath, 'scan-result.json'),
      activeSnapshot.selection,
      activeSnapshot.processingSkips,
    );
    writeFileSync(scanPath, serializeJsonProduct('scan-result.json', scan, { indent: 2, limit, recorder }), 'utf-8');

    // --- Phase 1.2 STRUCTURE-ALL ---------------------------------------------
    const structurePath = join(intermediateDir, 'structure-all.json');
    time('structureAll', () => {
      const result = runScript('structure-all.mjs', [materializedDir, '--scan', scanPath, '--out', structurePath]);
      if (result.status !== 0) {
        throw new Error(`lazy-analyze: structure-all.mjs failed: ${result.stderr || result.status}`);
      }
    });
    const structureAll = readJsonRequired(structurePath, 'structure-all.json');
    // structure-all.mjs is a child-process (script) output, not something we
    // serialize in-process — record at least its disk byte count (design D5).
    recorder.recordBytes('structure-all.json', statSync(structurePath).size, limit);

    // --- Import map (deterministic, extract-import-map.mjs) ------------------
    const importMapInputPath = join(intermediateDir, 'lazy-import-map-input.json');
    const importMapPath = join(intermediateDir, 'import-map.json');
    time('importMap', () => {
      writeFileSync(
        importMapInputPath,
        serializeJsonProduct('lazy-import-map-input.json', { projectRoot: materializedDir, files: scan.files }, { indent: 2, limit, recorder }),
        'utf-8',
      );
      const result = runScript('extract-import-map.mjs', [importMapInputPath, importMapPath]);
      if (result.status !== 0) {
        throw new Error(`lazy-analyze: extract-import-map.mjs failed: ${result.stderr || result.status}`);
      }
    });
    const importMap = readJsonRequired(importMapPath, 'import-map.json');
    // import-map.json is likewise a child-process output — byte count only.
    recorder.recordBytes('import-map.json', statSync(importMapPath).size, limit);

    // --- Build Fact Graph (in-process — design D1: a projection, not a CLI) -
    let projection;
    time('factGraph', () => {
      projection = buildFactGraph({ scan, structureAll, importMap, serializationLimit: limit, headroomRecorder: recorder });
      writeFileSync(
        join(intermediateDir, 'fact-graph.json'),
        serializeJsonProduct('fact-graph.json', projection, { indent: 2, limit, recorder }),
        'utf-8',
      );
    });

    // --- source-index (deterministic lexical index, hybrid-retrieval D2) ----
    // `readFile` reads from the MATERIALIZED snapshot content, same as every
    // other read in this driver — never `root` directly.
    let sourceIndex;
    time('sourceIndex', () => {
      const readFile = (relPath) => readFileSync(join(materializedDir, relPath), 'utf-8');
      sourceIndex = buildSourceIndexStep({ scan, structureAll, readFile, sourceRevision: activeSnapshot.revision });
    });

    // --- Deterministic validate ----------------------------------------------
    let validation;
    time('validate', () => {
      validation = validateFactGraphIntegrity(projection);
      writeFileSync(
        join(intermediateDir, 'lazy-validation.json'),
        serializeJsonProduct('lazy-validation.json', validation, { indent: 2, limit, recorder }),
        'utf-8',
      );
    });

    // --- Structural fingerprints baseline (Fix B, openspec change
    // source-snapshot) ---------------------------------------------------------
    // Built against `materializedDir` — the snapshot's own materialized
    // content (HEAD for a git target) — never against the real, possibly
    // dirty `root`. The temp dir is still alive here (runGuarded's cleanup
    // only runs after this whole `produce` call returns), so the resulting
    // fingerprints.json is read back into `product` now and relocated into
    // the REAL root's `.excavator/` by `publish()`, once the D7 consistency
    // guard has confirmed the source did not change for the run's whole
    // duration. Still invoked via `runScript('build-fingerprints.mjs', ...)`
    // (never imported) so the existing save-failure-gate injection point
    // (tests replace this exact script name) keeps working unchanged.
    let fingerprints;
    time('fingerprints', () => {
      const fingerprintInputPath = join(intermediateDir, 'fingerprint-input.json');
      writeFileSync(
        fingerprintInputPath,
        serializeJsonProduct('fingerprint-input.json', {
          projectRoot: materializedDir,
          filePaths: scan.files.map((f) => f.path),
          gitCommitHash: activeSnapshot.kind === 'git' ? activeSnapshot.sha : null,
        }, { indent: 2, limit, recorder }),
        'utf-8',
      );
      const fpResult = runScript('build-fingerprints.mjs', [fingerprintInputPath]);
      if (fpResult.status !== 0 || !/Fingerprints baseline:/.test(fpResult.stdout ?? '')) {
        fingerprints = { ok: false, error: `build-fingerprints.mjs failed: ${fpResult.stderr || fpResult.status}` };
        return;
      }
      const fingerprintsFilePath = join(materializedDir, '.excavator', 'fingerprints.json');
      fingerprints = {
        ok: true,
        raw: readFileSync(fingerprintsFilePath, 'utf-8'),
      };
      // fingerprints.json is likewise a child-script (build-fingerprints.mjs)
      // output — byte count via stat, same as structure-all.json/import-map.json.
      recorder.recordBytes('fingerprints.json', statSync(fingerprintsFilePath).size, limit);
    });

    // --- Assemble the (not-yet-published) knowledge graph --------------------
    // `gitCommitHash` is derived from the snapshot's OWN revision rather than
    // a second `git rev-parse HEAD` call — for a GitCommitSnapshot this is
    // exactly the sha `revision` already names; for Directory/MultiRepo there
    // is no single commit to report, so it is honestly null.
    const gitCommitHash = activeSnapshot.kind === 'git' ? activeSnapshot.sha : null;
    const { name, description } = deterministicProjectMeta(materializedDir);
    const languages = Object.keys(scan.stats?.byLanguage ?? {}).sort();

    const existingGraph = loadGraph(root, { validate: false });
    const merged = mergeFactProjectionIntoGraph(existingGraph, projection);

    const knowledgeGraph = {
      version: KNOWLEDGE_GRAPH_VERSION,
      project: {
        name: existingGraph?.project?.name ?? name,
        languages: existingGraph?.project?.languages?.length ? existingGraph.project.languages : languages,
        frameworks: existingGraph?.project?.frameworks ?? [],
        description: existingGraph?.project?.description ?? description,
        analyzedAt: now(),
        gitCommitHash,
        // sha256 over the scanned source content — written by the scan
        // (scan-project.mjs's own `contentDigest`), matching ProjectMeta's
        // documented meaning for `sourceDigest`.
        sourceDigest: scan.contentDigest,
        factsDigest: projection.factsDigest,
        pipelineVersion: PIPELINE_VERSION,
      },
      nodes: merged.nodes,
      edges: merged.edges,
      layers: merged.layers,
      tour: merged.tour,
      coverage: projection.coverage,
      gaps: projection.gaps,
    };

    const product = { knowledgeGraph, validation, scan, structureAll, projection, sourceIndex, timings, fingerprints, recorder };
    lastProduct = product; // kept for diagnostics even if the guard later discards it.
    return product;
  }

  // --- Publish: non-destructive merge already happened above; this step is
  // ONLY reached once `runGuarded` has confirmed nothing about the source
  // changed for the whole duration of `produce` (design D7).
  //
  // Staged publish (openspec: changes/product-serialization-ceiling, design
  // D4): every final product is written to a staging directory FIRST; only
  // once every one of the five staged writes has succeeded do we replace the
  // final files, one at a time, in the fixed order graph -> fingerprints ->
  // source-index -> meta -> manifest. Any failure — staging OR replacing —
  // leaves EVERY final product byte-for-byte unchanged: a failed stage
  // aborts before any final file is touched at all; a failed replace rolls
  // back every replace step already completed, in reverse, before aborting.
  // This is why the fingerprints-failure gate now runs FIRST, before any
  // staging begins at all — it is a precondition, not itself a staged write,
  // and the modified lazy-analysis/revision-sync specs require that its
  // failure leave knowledge-graph.json (and everything else) untouched,
  // which was NOT true before this slice (saveGraph used to run
  // unconditionally, ahead of this check). --------------------------------
  async function publish(product, activeSnapshot) {
    const saveStart = Date.now();

    if (!product.fingerprints.ok) {
      saveState.saveError = product.fingerprints.error;
      product.timings.save = Date.now() - saveStart;
      return; // Nothing staged, nothing touched — spec Scenario "a failed
      // save must not advance metadata" now covers knowledge-graph.json too.
    }

    // Clear out any staging directory a past run left behind because it was
    // killed mid-replace (design D4 step 3) — before creating THIS run's own,
    // so this scan can never need to special-case excluding its own
    // not-yet-created directory.
    cleanupStalePublishStagingDirs(dataDir, publishFs);

    const stagingDir = join(dataDir, `.publish-staging-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const previousDir = join(stagingDir, 'previous');

    /** Aborts the whole publish: clean up the staging directory (best-effort
     *  — a cleanup failure must never mask the real error) and record a
     *  named `saveError`. A `ProductTooLargeError`'s own message (already
     *  names product/requiredChars/limitChars) is used verbatim; anything
     *  else is wrapped with which phase/product failed. */
    function abort(phase, productName, err) {
      const message = err instanceof ProductTooLargeError
        ? err.message
        : `${phase} ${productName} failed: ${err.message}`;
      try {
        publishFs.rm(stagingDir);
      } catch {
        // Best-effort: the ORIGINAL failure above is what gets reported.
      }
      saveState.saveError = message;
      product.timings.save = Date.now() - saveStart;
    }

    try {
      publishFs.mkdir(previousDir); // recursive: creates stagingDir too.
    } catch (err) {
      saveState.saveError = `creating publish staging directory failed: ${err.message}`;
      product.timings.save = Date.now() - saveStart;
      return;
    }

    const staged = {};
    const final = {};
    for (const key of PUBLISH_PRODUCT_ORDER) {
      staged[key] = join(stagingDir, PUBLISH_PRODUCT_FILENAME[key]);
      final[key] = join(dataDir, PUBLISH_PRODUCT_FILENAME[key]);
    }

    // --- STAGE (design D4, step 1): all five, in this fixed order. ---------
    const { recorder } = product;
    const limit = serializationLimit;

    try {
      const sanitised = sanitiseFilePaths(product.knowledgeGraph, root);
      const content = serializeJsonProduct('knowledge-graph.json', sanitised, { indent: 2, limit, recorder });
      publishFs.writeFile(staged.graph, content);
    } catch (err) { return abort('staging', 'knowledge-graph.json', err); }

    try {
      publishFs.writeFile(staged.fingerprints, product.fingerprints.raw);
    } catch (err) { return abort('staging', 'fingerprints.json', err); }

    try {
      publishFs.writeSourceIndex(staged.sourceIndex, product.sourceIndex);
    } catch (err) { return abort('staging', SOURCE_INDEX_FILE, err); }

    try {
      const metaContent = {
        lastAnalyzedAt: now(),
        gitCommitHash: product.knowledgeGraph.project.gitCommitHash ?? '',
        version: KNOWLEDGE_GRAPH_VERSION,
        analyzedFiles: product.structureAll.filesAnalyzed,
      };
      const content = serializeJsonProduct('meta.json', metaContent, { indent: 2, limit, recorder });
      publishFs.writeFile(staged.meta, content);
    } catch (err) { return abort('staging', 'meta.json', err); }

    try {
      // `entries()` runs HERE, at the point of writing the manifest — not
      // earlier — per design D4; it is the run's single most expensive save
      // step at scale (design.md's risk log: ~11ms/file on Hadoop), so it
      // must never be duplicated or hoisted into `produce()`. `manifestEntries`
      // is a NESTED sub-breakdown of `save` (design D7: the save stage
      // SHALL separately record the manifest's per-file content hashing) —
      // `save`'s own duration (measured across the whole of `publish()`, see
      // `saveStart` above) already spans this call; a caller summing every
      // timings value must exclude `manifestEntries` to avoid double-counting
      // this overlap.
      const entriesStart = Date.now();
      const entries = activeSnapshot.entries();
      product.timings.manifestEntries = Date.now() - entriesStart;
      const manifestContent = {
        sourceRevision: activeSnapshot.revision,
        selectionDigest: activeSnapshot.selectionDigest,
        pipelineVersion: PIPELINE_VERSION,
        entries,
        selection: activeSnapshot.selection,
      };
      const content = serializeJsonProduct('source-manifest.json', manifestContent, { indent: 2, limit, recorder });
      publishFs.writeFile(staged.manifest, content);
    } catch (err) { return abort('staging', 'source-manifest.json', err); }

    // --- REPLACE (design D4, step 2): fixed order, one product at a time. --
    // A final path is NEVER deleted first — only ever hard-linked-or-copied
    // into a backup and then atomically renamed over — so a concurrent
    // reader (e.g. an MCP server) never observes a product as missing.
    const completed = []; // { key, hadPrevious } — for reverse rollback on failure.
    for (const key of PUBLISH_PRODUCT_ORDER) {
      const hadPrevious = publishFs.exists(final[key]);
      try {
        if (hadPrevious) {
          const backupPath = join(previousDir, PUBLISH_PRODUCT_FILENAME[key]);
          try {
            publishFs.link(final[key], backupPath);
          } catch {
            publishFs.copyFile(final[key], backupPath); // hard link unavailable — fall back to a copy.
          }
        }
        publishFs.rename(staged[key], final[key]);
        completed.push({ key, hadPrevious });
      } catch (err) {
        for (let i = completed.length - 1; i >= 0; i--) {
          const { key: doneKey, hadPrevious: donePrevious } = completed[i];
          try {
            if (donePrevious) {
              publishFs.rename(join(previousDir, PUBLISH_PRODUCT_FILENAME[doneKey]), final[doneKey]);
            } else {
              publishFs.unlink(final[doneKey]); // it did not exist before this publish — restore that.
            }
          } catch {
            // Best-effort rollback; the ORIGINAL replace failure is what gets reported.
          }
        }
        return abort('replacing', PUBLISH_PRODUCT_FILENAME[key], err);
      }
    }

    // --- FINALIZE (design D4, step 3): only once every replace succeeded. --
    if (publishFs.exists(join(dataDir, LEGACY_SOURCE_INDEX_FILE))) {
      try {
        publishFs.unlink(join(dataDir, LEGACY_SOURCE_INDEX_FILE));
      } catch {
        // Best-effort — a leftover legacy file is inert (never read) even if
        // this cleanup itself fails; it is retried on the next publish.
      }
    }
    try {
      publishFs.rm(stagingDir);
    } catch {
      // Best-effort — a fully-replaced publish has already succeeded;
      // leftover staging-dir cleanup is retried by the next publish's
      // `cleanupStalePublishStagingDirs` once this pid exits.
    }

    saveState.metaAdvanced = true;
    product.timings.save = Date.now() - saveStart;
  }

  beforeRunGuardedAt = Date.now();
  const guardResult = await snapshot.runGuarded(
    (materializedDir, activeSnapshot) => produce(materializedDir, activeSnapshot),
    (product, activeSnapshot) => publish(product, activeSnapshot),
  );

  if (!guardResult.ok) {
    // D7: the guard retried once and the source still changed — keep
    // whatever was already persisted (nothing above ever touched it) and
    // fail visibly rather than publish against a moving target.
    saveState.saveError = `source consistency guard failed: ${guardResult.reason}`;
  }

  const product = guardResult.ok ? guardResult.product : lastProduct;
  const timings = product?.timings ?? {};
  Object.assign(timings, preProduceTimings); // snapshotResolve — measured before produce() ever existed.
  // Wall-clock total (design D7): the WHOLE runLazyAnalysis call, not a sum
  // of the stage timers above (that sum used to silently miss anything a
  // stage timer does not itself cover, e.g. `@excavator/core` resolution —
  // on Hadoop-scale runs the snapshot/materialize stages alone were ~87% of
  // real wall time, which a pure sum of the OTHER stages could never show).
  timings.total = Math.round(performance.now() - runStartedAt);

  return {
    mode: 'lazy',
    graphPath,
    metaAdvanced: saveState.metaAdvanced,
    saveError: saveState.saveError,
    validation: product?.validation ?? { ok: false, issues: [saveState.saveError ?? 'no product was produced'] },
    coverage: product?.projection?.coverage ?? {},
    gaps: product?.projection?.gaps ?? [],
    factsDigest: product?.projection?.factsDigest ?? '',
    nodeCount: product?.knowledgeGraph?.nodes?.length ?? 0,
    edgeCount: product?.knowledgeGraph?.edges?.length ?? 0,
    timings,
    sourceRevision: guardResult.revision ?? snapshot.revision,
    // Sorted (percent of the runtime single-string ceiling, descending) —
    // design D5/product-serialization: every whole-document product this run
    // serialized in-process, plus the byte counts of the three child-script
    // outputs. Empty when the run never reached `produce()` at all.
    serialization: product?.recorder?.entries() ?? [],
  };
}

// ---------------------------------------------------------------------------
// CLI entry.
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const [projectRoot, ...rest] = argv;
  if (!projectRoot) {
    process.stderr.write('Usage: node lazy-analyze.mjs <projectRoot> [--exclude <patterns>]\n');
    process.exit(1);
  }

  const result = await runLazyAnalysis({ projectRoot, argv: rest });

  process.stderr.write(
    `lazy-analyze: nodes=${result.nodeCount} edges=${result.edgeCount} ` +
    `gaps=${result.gaps.length} factsDigest=${result.factsDigest.slice(0, 12)}… ` +
    `metaAdvanced=${result.metaAdvanced} totalMs=${result.timings.total}\n`,
  );
  const stageLine = Object.entries(result.timings)
    .filter(([stage]) => stage !== 'total')
    .map(([stage, ms]) => `${stage}=${ms}ms`)
    .join(' ');
  process.stderr.write(`lazy-analyze: stages ${stageLine}\n`);
  const headroomLine = result.serialization
    .map((entry) => `${entry.product}=${entry.percentOfLimit.toFixed(2)}%(${entry.measuredAs})`)
    .join(' ') || '(none)';
  process.stderr.write(`lazy-analyze: headroom ${headroomLine}\n`);
  if (!result.validation.ok) {
    process.stderr.write(`lazy-analyze: deterministic validate found ${result.validation.issues.length} issue(s):\n`);
    for (const issue of result.validation.issues) process.stderr.write(`  - ${issue}\n`);
  }
  if (result.saveError) {
    process.stderr.write(`lazy-analyze: SAVE FAILED: ${result.saveError}\n`);
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
    process.stderr.write(`lazy-analyze.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}

export default {
  runLazyAnalysis,
  validateFactGraphIntegrity,
  mergeFactProjectionIntoGraph,
  defaultRunScript,
  defaultPublishFs,
  cleanupStalePublishStagingDirs,
  KNOWLEDGE_GRAPH_VERSION,
  PIPELINE_VERSION,
};
