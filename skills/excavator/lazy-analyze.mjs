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
 * fingerprints step that follows it).
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
 * Contract: openspec/changes/lazy-first-run/specs/lazy-analysis/spec.md
 *           openspec/changes/source-snapshot/specs/source-snapshot/spec.md
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { buildFactGraph } from './build-fact-graph.mjs';
import { conservationViolations } from './coverage-ledger.mjs';
import { resolveSourceSnapshot } from './source-snapshot.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');

/** Version stamped into every Lazy-produced KnowledgeGraph / meta.json. */
export const KNOWLEDGE_GRAPH_VERSION = '1.0.0';
/** Stamped into `project.pipelineVersion` — bump when the fact projection's
 *  shape changes in a way downstream consumers should be able to tell apart. */
export const PIPELINE_VERSION = 'lazy-fact-graph/1';

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
 * KnowledgeGraph (produced by a prior Full run), without discarding any
 * model-authored semantics.
 *
 * - Nodes: for every fact node, if a node with the same id already exists,
 *   its structural fields are refreshed from the fresh projection while its
 *   semantic fields (see `SEMANTIC_NODE_FIELDS`) are preserved verbatim. A
 *   fact node with no prior counterpart is added as-is (nothing to
 *   preserve — it is genuinely new). An existing node the fresh projection
 *   no longer sees (e.g. the file was deleted) is left in place: Lazy has
 *   no incremental-deletion logic of its own, and the conservative choice
 *   next to "never clear or downgrade" is to leave it rather than guess.
 * - Edges: union, keyed by (source, target, type, direction) — existing
 *   edges are kept, new fact edges not already present are appended.
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
  for (const node of existing?.nodes ?? []) {
    if (!seenIds.has(node.id)) nodes.push(node);
  }
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const existingEdgeKeys = new Set((existing?.edges ?? []).map(edgeKey));
  const edges = [...(existing?.edges ?? [])];
  for (const factEdge of projection.edges) {
    if (!existingEdgeKeys.has(edgeKey(factEdge))) edges.push(factEdge);
  }

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
 * }} options
 */
export async function runLazyAnalysis({
  projectRoot,
  argv = [],
  now = () => new Date().toISOString(),
  runScript = defaultRunScript,
} = {}) {
  if (!projectRoot) throw new Error('runLazyAnalysis: projectRoot is required');
  const root = resolve(projectRoot);

  const core = await resolveCore(pluginRoot);
  const { resolveDataDir, saveGraph, loadGraph, saveMeta } = core;

  const dataDir = resolveDataDir(root);
  const intermediateDir = join(dataDir, 'intermediate');
  mkdirSync(intermediateDir, { recursive: true });
  const graphPath = join(dataDir, 'knowledge-graph.json');

  // SourceSnapshot decides WHAT gets analyzed (design D2/D5) — this driver
  // no longer calls `git rev-parse HEAD` or reads `root` directly to decide
  // analysis content; every read below goes through the snapshot's
  // `materialize()`-produced temp directory instead.
  const extraExcludePatterns = parseExcludePatterns(argv);
  const snapshot = resolveSourceSnapshot(root, { extraExcludePatterns });

  const saveState = { metaAdvanced: false, saveError: null };
  let lastProduct = null;

  // --- Produce: run the existing Scan -> Structure-All -> Import-Map ->
  // Build Fact Graph -> Deterministic Validate pipeline against the
  // MATERIALIZED snapshot content (never `root` directly). ------------------
  async function produce(materializedDir) {
    const timings = {};
    function time(label, fn) {
      const start = Date.now();
      const value = fn();
      timings[label] = Date.now() - start;
      return value;
    }

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
    const scan = readJsonRequired(scanPath, 'scan-result.json');

    // --- Phase 1.2 STRUCTURE-ALL ---------------------------------------------
    const structurePath = join(intermediateDir, 'structure-all.json');
    time('structureAll', () => {
      const result = runScript('structure-all.mjs', [materializedDir, '--scan', scanPath, '--out', structurePath]);
      if (result.status !== 0) {
        throw new Error(`lazy-analyze: structure-all.mjs failed: ${result.stderr || result.status}`);
      }
    });
    const structureAll = readJsonRequired(structurePath, 'structure-all.json');

    // --- Import map (deterministic, extract-import-map.mjs) ------------------
    const importMapInputPath = join(intermediateDir, 'lazy-import-map-input.json');
    const importMapPath = join(intermediateDir, 'import-map.json');
    time('importMap', () => {
      writeFileSync(
        importMapInputPath,
        JSON.stringify({ projectRoot: materializedDir, files: scan.files }, null, 2),
        'utf-8',
      );
      const result = runScript('extract-import-map.mjs', [importMapInputPath, importMapPath]);
      if (result.status !== 0) {
        throw new Error(`lazy-analyze: extract-import-map.mjs failed: ${result.stderr || result.status}`);
      }
    });
    const importMap = readJsonRequired(importMapPath, 'import-map.json');

    // --- Build Fact Graph (in-process — design D1: a projection, not a CLI) -
    let projection;
    time('factGraph', () => {
      projection = buildFactGraph({ scan, structureAll, importMap });
      writeFileSync(join(intermediateDir, 'fact-graph.json'), JSON.stringify(projection, null, 2), 'utf-8');
    });

    // --- Deterministic validate ----------------------------------------------
    let validation;
    time('validate', () => {
      validation = validateFactGraphIntegrity(projection);
      writeFileSync(join(intermediateDir, 'lazy-validation.json'), JSON.stringify(validation, null, 2), 'utf-8');
    });

    // --- Assemble the (not-yet-published) knowledge graph --------------------
    // `gitCommitHash` is derived from the snapshot's OWN revision rather than
    // a second `git rev-parse HEAD` call — for a GitCommitSnapshot this is
    // exactly the sha `revision` already names; for Directory/MultiRepo there
    // is no single commit to report, so it is honestly null.
    const gitCommitHash = snapshot.kind === 'git' ? snapshot.sha : null;
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

    const product = { knowledgeGraph, validation, scan, structureAll, projection, timings };
    lastProduct = product; // kept for diagnostics even if the guard later discards it.
    return product;
  }

  // --- Publish: non-destructive merge already happened above; this step is
  // ONLY reached once `runGuarded` has confirmed nothing about the source
  // changed for the whole duration of `produce` (design D7). --------------
  async function publish(product) {
    const saveStart = Date.now();

    try {
      saveGraph(root, product.knowledgeGraph);
    } catch (err) {
      saveState.saveError = `writing knowledge-graph.json failed: ${err.message}`;
      product.timings.save = Date.now() - saveStart;
      return;
    }

    // Fingerprints baseline MUST succeed before meta.json is written — the
    // same gate Phase 7 step 2 already enforces (see build-fingerprints.mjs
    // / issue #152: otherwise a future incremental run sees a fresh commit
    // hash with no fingerprints to compare against). This reads/writes the
    // REAL `root` (not the materialized temp) — the structural-fingerprint
    // baseline is a separate, pre-existing change-detection subsystem this
    // slice does not otherwise touch.
    const fingerprintInputPath = join(intermediateDir, 'fingerprint-input.json');
    writeFileSync(
      fingerprintInputPath,
      JSON.stringify(
        {
          projectRoot: root,
          filePaths: product.scan.files.map((f) => f.path),
          gitCommitHash: product.knowledgeGraph.project.gitCommitHash,
        },
        null,
        2,
      ),
      'utf-8',
    );
    const fpResult = runScript('build-fingerprints.mjs', [fingerprintInputPath]);
    if (fpResult.status !== 0 || !/Fingerprints baseline:/.test(fpResult.stdout ?? '')) {
      saveState.saveError = `build-fingerprints.mjs failed: ${fpResult.stderr || fpResult.status}`;
      product.timings.save = Date.now() - saveStart;
      return; // Do NOT advance meta.json/source-manifest.json — they all stay
      // at their last successful state (spec Scenario "a failed save must
      // not advance metadata").
    }

    saveMeta(root, {
      lastAnalyzedAt: now(),
      gitCommitHash: product.knowledgeGraph.project.gitCommitHash ?? '',
      version: KNOWLEDGE_GRAPH_VERSION,
      analyzedFiles: product.structureAll.filesAnalyzed,
    });

    // source-manifest.json — the new artifact this slice adds, written
    // alongside knowledge-graph.json/meta.json/fingerprints.json, and only
    // ever advanced together with them (same gate as meta.json above).
    writeFileSync(
      join(dataDir, 'source-manifest.json'),
      JSON.stringify(
        {
          sourceRevision: snapshot.revision,
          selectionDigest: snapshot.selectionDigest,
          pipelineVersion: PIPELINE_VERSION,
        },
        null,
        2,
      ),
      'utf-8',
    );

    saveState.metaAdvanced = true;
    product.timings.save = Date.now() - saveStart;
  }

  const guardResult = await snapshot.runGuarded(
    (materializedDir) => produce(materializedDir),
    (product) => publish(product),
  );

  if (!guardResult.ok) {
    // D7: the guard retried once and the source still changed — keep
    // whatever was already persisted (nothing above ever touched it) and
    // fail visibly rather than publish against a moving target.
    saveState.saveError = `source consistency guard failed: ${guardResult.reason}`;
  }

  const product = guardResult.ok ? guardResult.product : lastProduct;
  const timings = product?.timings ?? {};
  timings.total = Object.values(timings).reduce((sum, ms) => sum + ms, 0);

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
    sourceRevision: snapshot.revision,
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
  KNOWLEDGE_GRAPH_VERSION,
  PIPELINE_VERSION,
};
