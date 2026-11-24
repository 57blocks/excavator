#!/usr/bin/env node
/**
 * semantic-graph.mjs
 *
 * The `semantic-graph.json` product and its deterministic write module
 * (openspec: changes/full-semantic-isolation, capability
 * `full-semantic-isolation`, design D2). It is an OVERLAY on top of the
 * deterministic fact graph (`knowledge-graph.jsonl`, built by
 * build-fact-graph.mjs / lazy-analyze.mjs — the SAME builder Full mode now
 * reuses, design D1): it stores architecture `layers` (each `nodeIds[]` a set
 * of REAL fact-graph node ids, resolved via the shared node-identity
 * authority) and cross-node semantic `relations` (each carrying
 * `provenance`/`evidence` back to source), keyed by the current schema,
 * `contentLanguage: "en"`, and a `structureDigest` freshness field.
 *
 * Naming note: `structureDigest` is the value build-fact-graph.mjs computes
 * over the fact nodes and edges ONLY and knowledge-graph.jsonl publishes as
 * `project.structureDigest` (openspec: changes/semantic-structure-digest).
 * The semantic layer is made from nodes, edges and the semantic cache, so it
 * does not bind to `factsDigest`, which also covers record streams, coverage
 * and gaps. A file written before this binding carries `factDigest` instead;
 * `rebindSemanticGraph` re-binds it when its nodes and edges are proven
 * unchanged.
 *
 * MUST NOT call any model. MUST NOT copy or rewrite fact nodes/edges — the
 * only fact-graph data this module reads is the SET of valid node ids, used
 * solely to validate what a model handed it. A `layers[].nodeIds` entry, or a
 * relation endpoint, that does not resolve to a real fact-graph node id is
 * dropped from what gets written and recorded as a semantic gap instead —
 * never silently kept as a dangling reference, and never promoted into a fact
 * anchor (spec Requirement "unmappable model output is recorded as a semantic gap").
 *
 * Contract: openspec/changes/full-semantic-isolation/specs/full-semantic-isolation/spec.md
 *
 * Usage (CLI):
 *   node semantic-graph.mjs <projectRoot> check
 *   node semantic-graph.mjs <projectRoot> write --layers <layers.json>
 *     [--relations <relations.json>] [--model <name>] [--extra-gaps <path>]
 *     [--generated-at <iso>]
 *   node semantic-graph.mjs <projectRoot> merge-gaps --extra-gaps <path>
 *     (refreshes ONLY `gaps` on an existing semantic-graph.json — used on the
 *     `reuse` branch of the structureDigest gate, so a fresh patch-time gap is
 *     never lost just because Architecture itself was skippable)
 *
 * Programmatic:
 *   import { buildSemanticGraph, resolveArchitectureAction } from './semantic-graph.mjs';
 *
 * Logging: stderr only.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, realpathSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createGapCollector, compareStrings } from './fact-graph-resolve.mjs';
import { compareGaps } from './coverage-ledger.mjs';
import { computeFactsDigest, coverageForDigest } from './build-fact-graph.mjs';
import { ENTRY_POINT_GAP_REASONS } from './entry-point-resolution.mjs';
import { resolveSourceSnapshot } from './source-snapshot.mjs';
import {
  auditSemanticGraphFields,
  isAcceptedLanguageAudit,
} from './semantic-language-audit.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph, readKnowledgeGraphHeader } from './knowledge-graph-store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');

export const SEMANTIC_GRAPH_VERSION = '2.0.0';
export const SEMANTIC_GRAPH_CONTENT_LANGUAGE = 'en';
export const SEMANTIC_GRAPH_FILE = 'semantic-graph.json';

const REAL_FS = Object.freeze({
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync,
});

/** Same two-step @excavator/core resolution every sibling script uses. */
async function resolveCore(root) {
  const require = createRequire(resolve(root, 'package.json'));
  try {
    return await import(pathToFileURL(require.resolve('@excavator/core')).href);
  } catch {
    return await import(pathToFileURL(resolve(root, 'packages/core/dist/index.js')).href);
  }
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

const REQUIRED_LAYER_FIELDS = Object.freeze(['id', 'name', 'description']);
const REQUIRED_RELATION_FIELDS = Object.freeze(['id', 'type', 'source', 'target']);

/** Reason text per semantic-gap kind this module records. */
const GAP_REASONS = Object.freeze({
  'layer-invalid': 'a model-authored layer was missing a required field (id/name/description) and was dropped',
  'layer-nodeId-unmappable': "a layer's nodeIds entry does not resolve to any fact-graph node id and was dropped from the layer, not kept as a dangling reference",
  'relation-invalid': 'a model-authored relation was missing a required field (id/type/source/target) and was dropped',
  'relation-endpoint-unmappable': "a relation's source or target does not resolve to any fact-graph node id and the whole relation was dropped",
});

function reasonFor(kind) {
  return GAP_REASONS[kind] ?? `unrecognized semantic gap kind: ${kind}`;
}

/**
 * Filter model-authored layers against the real fact-node-id set. Pure;
 * unmappable nodeIds are dropped from the layer (not the whole layer) and
 * recorded as a gap; a layer missing a required field is dropped entirely.
 */
function sanitizeLayers(layers, factNodeIds, gapCollector) {
  const out = [];
  for (const raw of Array.isArray(layers) ? layers : []) {
    if (!raw || typeof raw !== 'object') {
      gapCollector.add('layer-invalid', '<unknown>', '<non-object layer>');
      continue;
    }
    const missing = REQUIRED_LAYER_FIELDS.filter((f) => !isNonEmptyString(raw[f]));
    if (missing.length > 0) {
      gapCollector.add('layer-invalid', isNonEmptyString(raw.id) ? raw.id : '<unknown>', `missing field(s): ${missing.join(', ')}`);
      continue;
    }
    const rawIds = Array.isArray(raw.nodeIds) ? raw.nodeIds : [];
    const nodeIds = [];
    for (const id of rawIds) {
      if (typeof id === 'string' && factNodeIds.has(id)) {
        nodeIds.push(id);
      } else {
        gapCollector.add('layer-nodeId-unmappable', raw.id, String(id));
      }
    }
    out.push({ id: raw.id, name: raw.name, description: raw.description, nodeIds: [...nodeIds].sort(compareStrings) });
  }
  out.sort((a, b) => compareStrings(a.id, b.id));
  return out;
}

/**
 * Filter model-authored cross-node relations against the real fact-node-id
 * set. Pure; a relation with either endpoint unmappable is dropped WHOLE
 * (unlike a layer, a relation with a dangling endpoint has no honest partial
 * form) and recorded as a gap.
 */
function sanitizeRelations(relations, factNodeIds, gapCollector) {
  const out = [];
  for (const raw of Array.isArray(relations) ? relations : []) {
    if (!raw || typeof raw !== 'object') {
      gapCollector.add('relation-invalid', '<unknown>', '<non-object relation>');
      continue;
    }
    const missing = REQUIRED_RELATION_FIELDS.filter((f) => !isNonEmptyString(raw[f]));
    if (missing.length > 0) {
      gapCollector.add('relation-invalid', isNonEmptyString(raw.id) ? raw.id : '<unknown>', `missing field(s): ${missing.join(', ')}`);
      continue;
    }
    const sourceOk = factNodeIds.has(raw.source);
    const targetOk = factNodeIds.has(raw.target);
    if (!sourceOk || !targetOk) {
      gapCollector.add('relation-endpoint-unmappable', raw.type, `${raw.source} -> ${raw.target}`);
      continue;
    }
    out.push({
      id: raw.id,
      type: raw.type,
      source: raw.source,
      target: raw.target,
      ...(isNonEmptyString(raw.description) ? { description: raw.description } : {}),
      ...(Array.isArray(raw.evidence) ? { evidence: raw.evidence } : {}),
      provenance: isNonEmptyString(raw.provenance) ? raw.provenance : 'model',
    });
  }
  out.sort((a, b) => compareStrings(a.id, b.id));
  return out;
}

/**
 * Build the semantic-graph.json document. Pure function; no I/O, no model
 * call, no re-read of the fact graph beyond the id set the caller already
 * extracted from it.
 *
 * @param {{
 *   structureDigest: string,
 *   factNodeIds: Set<string>|string[],
 *   factGraph?: object, sourceSnapshot?: object,
 *   layers?: object[], relations?: object[],
 *   model?: string, generatedAt?: string, sampleLimit?: number,
 *   extraGaps?: object[],
 * }} args
 * @returns {{ semanticGraph: object|null, gaps: object[], languageAudit: object }}
 */
export function buildSemanticGraph({
  structureDigest,
  factNodeIds,
  factGraph = null,
  sourceSnapshot = null,
  layers = [],
  relations = [],
  model = 'unknown',
  generatedAt = new Date().toISOString(),
  sampleLimit = 5,
  extraGaps = [],
}) {
  if (typeof structureDigest !== 'string' || structureDigest.length === 0) {
    throw new Error('buildSemanticGraph: structureDigest is required');
  }
  const idSet = factNodeIds instanceof Set ? factNodeIds : new Set(factNodeIds ?? []);

  const gapCollector = createGapCollector(sampleLimit);
  const sanitizedLayers = sanitizeLayers(layers, idSet, gapCollector);
  const sanitizedRelations = sanitizeRelations(relations, idSet, gapCollector);
  const ownGaps = gapCollector.toArray(reasonFor);

  // Audit exactly what can be persisted. Sanitization may drop invalid input
  // and sorting may move an optional description to a different array index;
  // auditing the raw model arrays would bind field paths to the wrong product.
  const languageAudit = auditSemanticGraphFields({
    layers: sanitizedLayers,
    relations: sanitizedRelations,
    factGraph,
    sourceSnapshot,
  });
  if (!isAcceptedLanguageAudit(languageAudit)) {
    const languageGap = {
      kind: 'noncanonical-language',
      scope: 'semantic-graph',
      reason: 'model-owned semantic graph prose failed the canonical English language audit',
      count: languageAudit.rejected.length,
      samples: languageAudit.rejected.map((entry) => entry.fieldPath),
    };
    return {
      semanticGraph: null,
      languageAudit,
      gaps: [
        ...ownGaps,
        ...(Array.isArray(extraGaps) ? extraGaps : []),
        languageGap,
      ].sort(compareGaps),
    };
  }

  // `extraGaps` lets an upstream step (e.g. apply-semantic-patches.mjs's
  // node-local patch gaps) merge into the SAME overlay artifact rather than
  // inventing a second gap sink — semantic-graph.json is the one place Full
  // mode's semantic-generation-time gaps live, mirroring how knowledge-graph.jsonl
  // is the one place fact-layer gaps live.
  const gaps = [...ownGaps, ...(Array.isArray(extraGaps) ? extraGaps : [])].sort(compareGaps);

  const semanticGraph = {
    version: SEMANTIC_GRAPH_VERSION,
    contentLanguage: SEMANTIC_GRAPH_CONTENT_LANGUAGE,
    languageAudit,
    structureDigest,
    layers: sanitizedLayers,
    relations: sanitizedRelations,
    gaps,
    model: isNonEmptyString(model) ? model.trim() : 'unknown',
    generatedAt,
  };
  return { semanticGraph, gaps, languageAudit };
}

/**
 * The architecture gate: reuse requires the current semantic schema,
 * `contentLanguage: "en"`, and a structureDigest matching the CURRENT fact graph.
 *
 * @param {{ currentStructureDigest: string, existing: object|null }} args
 * @returns {{ action: 'reuse'|'rebuild', status: 'fresh'|'stale'|'missing'|'noncanonical-language', reason: string }}
 */
export function resolveArchitectureAction({ currentStructureDigest, existing }) {
  if (!existing) {
    return { action: 'rebuild', status: 'missing', reason: 'no existing semantic-graph.json' };
  }
  if (
    existing.version !== SEMANTIC_GRAPH_VERSION
    || existing.contentLanguage !== SEMANTIC_GRAPH_CONTENT_LANGUAGE
    || !isAcceptedLanguageAudit(
      existing.languageAudit,
      auditSemanticGraphFields({ layers: existing.layers, relations: existing.relations }),
    )
  ) {
    return {
      action: 'rebuild',
      status: 'noncanonical-language',
      reason: 'noncanonical-language: semantic-graph.json lacks the current schema, contentLanguage=en, or an accepted field audit',
    };
  }
  if (typeof existing.structureDigest !== 'string' || existing.structureDigest.length === 0) {
    return {
      action: 'rebuild',
      status: 'missing',
      reason: 'semantic-graph.json records no structureDigest (a file written before the semantic graph was bound to nodes and edges carries only factDigest; a Lazy run re-binds it when its nodes and edges are proven unchanged)',
    };
  }
  if (existing.structureDigest === currentStructureDigest) {
    return {
      action: 'reuse',
      status: 'fresh',
      reason: 'structureDigest unchanged since the existing semantic-graph.json was written',
    };
  }
  return {
    action: 'rebuild',
    status: 'stale',
    reason: `structureDigest changed (${existing.structureDigest.slice(0, 12)}… -> ${String(currentStructureDigest).slice(0, 12)}…)`,
  };
}

/** Every fact-graph node id, as a Set, from an already-loaded knowledge graph. */
export function collectFactNodeIds(knowledgeGraph) {
  return new Set((knowledgeGraph?.nodes ?? []).map((n) => n.id));
}

/** Gap kinds this module's OWN `buildSemanticGraph` produces from the last
 *  real layers/relations build — never clobbered by a gaps-only refresh. */
const OWN_STRUCTURAL_GAP_PREFIXES = Object.freeze(['layer-', 'relation-']);

/**
 * Refresh ONLY the `gaps` field of an already-written semantic-graph.json —
 * used on the `reuse` branch of the structureDigest gate (design D3): Architecture
 * did not rerun, so `layers`/`relations`/`structureDigest` stay exactly as they
 * were, but a semantic-generation-time gap discovered THIS run (e.g. an
 * unmappable node-local patch from Phase F2) must still surface somewhere —
 * silently dropping it because Architecture happened to be skippable would
 * violate "missing must be visible". Gap kinds this module itself owns
 * (`layer-*`/`relation-*`, from the last real build) are preserved verbatim;
 * everything else (patch-origin gaps) is replaced by `extraGaps`, matching
 * the same "this script's own rows are replaced, not appended" convention
 * `apply-verification.mjs`'s `OWNED_GAP_KINDS` already uses.
 *
 * @param {object} existing an already-loaded semantic-graph.json
 * @param {object[]} extraGaps the fresh patch-origin gaps to merge in
 * @returns {object} a new semantic-graph document with only `gaps` changed
 */
export function mergeExtraGapsIntoExisting(existing, extraGaps) {
  const kept = (existing?.gaps ?? []).filter(
    (g) => OWN_STRUCTURAL_GAP_PREFIXES.some((prefix) => typeof g?.kind === 'string' && g.kind.startsWith(prefix)),
  );
  const gaps = [...kept, ...(Array.isArray(extraGaps) ? extraGaps : [])].sort(compareGaps);
  return { ...existing, gaps };
}

/** Read `dataDir/semantic-graph.json`, or null if absent/corrupt. Never throws. */
export function readSemanticGraph(dataDir, { fsImpl = REAL_FS } = {}) {
  const p = join(dataDir, SEMANTIC_GRAPH_FILE);
  if (!fsImpl.existsSync(p)) return null;
  try {
    return JSON.parse(fsImpl.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/** Atomic write (temp file + rename), matching semantic-cache.mjs's pattern. */
export function writeSemanticGraph(dataDir, semanticGraph, { fsImpl = REAL_FS } = {}) {
  if (
    semanticGraph?.version !== SEMANTIC_GRAPH_VERSION
    || semanticGraph?.contentLanguage !== SEMANTIC_GRAPH_CONTENT_LANGUAGE
    || !isAcceptedLanguageAudit(
      semanticGraph?.languageAudit,
      auditSemanticGraphFields({ layers: semanticGraph?.layers, relations: semanticGraph?.relations }),
    )
  ) {
    throw new Error('semantic-graph: refusing to write a noncanonical or unaudited semantic graph');
  }
  fsImpl.mkdirSync(dataDir, { recursive: true });
  const finalPath = join(dataDir, SEMANTIC_GRAPH_FILE);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fsImpl.writeFileSync(tmpPath, JSON.stringify(semanticGraph, null, 2), 'utf-8');
  try {
    fsImpl.renameSync(tmpPath, finalPath);
  } catch (err) {
    try { fsImpl.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
    throw err;
  }
  return finalPath;
}

// ---------------------------------------------------------------------------
// One-time re-bind of semantic graphs written before they bound structureDigest
// (openspec: changes/semantic-structure-digest, design D4).
// ---------------------------------------------------------------------------

/**
 * Record streams added to the facts digest after semantic graphs were first
 * written. It exists only to re-bind semantic graphs written before they
 * bound structureDigest; new streams are never added here.
 */
export const ADDITIVE_FACT_STREAMS = Object.freeze([
  Object.freeze({
    recordStream: 'entryPoints',
    coverageKey: 'entryPoints',
    gapKinds: Object.freeze(Object.keys(ENTRY_POINT_GAP_REASONS)),
  }),
]);

/**
 * The facts digests a legacy semantic graph's `factDigest` may equal, in
 * order: the current `factsDigest`, then the digest of the same nodes and
 * edges without the additive streams (the algorithm before they existed).
 * The second one costs a full serialization pass, so it is computed only when
 * the caller asks for it.
 *
 * @param {{ nodes: object[], edges: object[], coverage: object, gaps: object[], factsDigest: string }} projection
 * @returns {Generator<{ label: string, digest: string }>}
 */
export function* legacyFactDigestCandidates(projection) {
  yield { label: 'current factsDigest', digest: projection.factsDigest };
  const coverage = coverageForDigest(projection.coverage);
  for (const stream of ADDITIVE_FACT_STREAMS) delete coverage[stream.coverageKey];
  const stripped = new Set(ADDITIVE_FACT_STREAMS.flatMap((stream) => stream.gapKinds));
  const gaps = (projection.gaps ?? []).filter((gap) => !stripped.has(gap?.kind));
  yield {
    label: 'digest without the additive streams',
    digest: computeFactsDigest({ nodes: projection.nodes, edges: projection.edges, coverage, gaps }),
  };
}

/**
 * Check an existing semantic-graph.json against the freshly published
 * projection and, for a file written before it bound structureDigest, re-bind
 * it when its recorded `factDigest` proves the nodes and edges unchanged.
 * Never throws; writes only on `rebound`.
 *
 * @param {{ dataDir: string, projection: object, fsImpl?: object }} args
 * @returns {{ status: 'absent'|'bound'|'stale'|'rebound'|'unbound', reason: string }}
 */
export function rebindSemanticGraph({ dataDir, projection, fsImpl = REAL_FS }) {
  try {
    const path = join(dataDir, SEMANTIC_GRAPH_FILE);
    if (!fsImpl.existsSync(path)) {
      return { status: 'absent', reason: 'no semantic-graph.json' };
    }
    let existing;
    try {
      existing = JSON.parse(fsImpl.readFileSync(path, 'utf-8'));
    } catch (err) {
      return { status: 'unbound', reason: `${SEMANTIC_GRAPH_FILE} is not readable JSON: ${err.message}` };
    }
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      return { status: 'unbound', reason: `${SEMANTIC_GRAPH_FILE} is not a JSON object` };
    }
    if (isNonEmptyString(existing.structureDigest)) {
      return existing.structureDigest === projection.structureDigest
        ? { status: 'bound', reason: 'structureDigest equals the published graph\'s' }
        : {
          status: 'stale',
          reason: `structureDigest ${existing.structureDigest.slice(0, 12)}... differs from the graph's ${String(projection.structureDigest).slice(0, 12)}...; a Full run rebuilds it`,
        };
    }
    if (!isNonEmptyString(existing.factDigest)) {
      return { status: 'unbound', reason: `${SEMANTIC_GRAPH_FILE} records neither structureDigest nor factDigest` };
    }
    let matched = null;
    for (const candidate of legacyFactDigestCandidates(projection)) {
      if (candidate.digest === existing.factDigest) { matched = candidate; break; }
    }
    if (!matched) {
      return {
        status: 'unbound',
        reason: 'its factDigest equals no digest of the current nodes and edges, so its nodes and edges cannot be shown to be unchanged',
      };
    }
    const rebound = {};
    for (const [key, value] of Object.entries(existing)) {
      if (key === 'factDigest') rebound.structureDigest = projection.structureDigest;
      else rebound[key] = value;
    }
    try {
      writeSemanticGraph(dataDir, rebound, { fsImpl });
    } catch (err) {
      return { status: 'unbound', reason: `re-bind refused or failed: ${err.message}` };
    }
    return { status: 'rebound', reason: `factDigest matched the ${matched.label}; nodes and edges are unchanged` };
  } catch (err) {
    return { status: 'unbound', reason: `re-bind check failed: ${err?.message ?? String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    projectRoot: null, action: null, layers: null, relations: null,
    model: null, extraGaps: null, generatedAt: null,
  };
  const valueFlags = {
    '--layers': 'layers', '--relations': 'relations', '--model': 'model',
    '--extra-gaps': 'extraGaps', '--generated-at': 'generatedAt',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (valueFlags[arg]) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`semantic-graph: ${arg} requires a value`);
      args[valueFlags[arg]] = value;
      i++;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`semantic-graph: unknown option: ${arg}`);
    if (!args.projectRoot) { args.projectRoot = arg; continue; }
    if (!args.action) {
      if (!['check', 'write', 'merge-gaps'].includes(arg)) {
        throw new Error(`semantic-graph: unknown action "${arg}" (expected check | write | merge-gaps)`);
      }
      args.action = arg;
      continue;
    }
    throw new Error(`semantic-graph: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot || !args.action) {
    throw new Error(
      'Usage: node semantic-graph.mjs <projectRoot> check\n' +
      '   or: node semantic-graph.mjs <projectRoot> write --layers <path> ' +
      '[--relations <path>] [--model <name>] [--extra-gaps <path>] [--generated-at <iso>]\n' +
      '   or: node semantic-graph.mjs <projectRoot> merge-gaps --extra-gaps <path>',
    );
  }
  return args;
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`semantic-graph: ${label} not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const { resolveDataDir } = await resolveCore(pluginRoot);
  const dataDir = resolveDataDir(projectRoot);

  const graphPath = join(dataDir, KNOWLEDGE_GRAPH_FILE);
  if (!existsSync(graphPath)) throw new Error(`semantic-graph: ${KNOWLEDGE_GRAPH_FILE} not found: ${graphPath}`);
  // Only the project header is needed here; never parse the whole graph.
  const currentStructureDigest = readKnowledgeGraphHeader(graphPath).fields.project?.structureDigest;
  if (typeof currentStructureDigest !== 'string' || currentStructureDigest.length === 0) {
    throw new Error('semantic-graph: knowledge-graph.jsonl has no project.structureDigest - run the fact build (/excavator) first');
  }

  const existing = readSemanticGraph(dataDir);

  if (args.action === 'check') {
    const { action, reason } = resolveArchitectureAction({ currentStructureDigest, existing });
    process.stdout.write(`${action}\n`);
    process.stderr.write(`semantic-graph check: action=${action} (${reason})\n`);
    return;
  }

  if (args.action === 'merge-gaps') {
    if (!existing) {
      throw new Error('semantic-graph merge-gaps: no existing semantic-graph.json to refresh gaps on');
    }
    const extra = args.extraGaps ? readJson(resolve(args.extraGaps), 'extra-gaps file') : [];
    const merged = mergeExtraGapsIntoExisting(existing, Array.isArray(extra) ? extra : extra?.gaps ?? []);
    const outPath = writeSemanticGraph(dataDir, merged);
    process.stderr.write(`semantic-graph merge-gaps: gaps=${merged.gaps.length} -> ${outPath}\n`);
    return;
  }

  // action === 'write'
  if (!args.layers) throw new Error('semantic-graph write: --layers <path> is required');
  const layers = readJson(resolve(args.layers), 'layers file');
  const relations = args.relations ? readJson(resolve(args.relations), 'relations file') : [];
  const extraGaps = args.extraGaps ? readJson(resolve(args.extraGaps), 'extra-gaps file') : [];

  // Writing needs every fact node id, so this action reads the whole graph.
  const knowledgeGraph = readKnowledgeGraph(graphPath);
  const factNodeIds = collectFactNodeIds(knowledgeGraph);
  let sourceSnapshot = null;
  let factGraphForLanguageAudit = null;
  try {
    sourceSnapshot = resolveSourceSnapshot(projectRoot);
    const manifestPath = join(dataDir, 'source-manifest.json');
    const manifest = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, 'utf-8'))
      : null;
    if (manifest?.sourceRevision === sourceSnapshot.revision) {
      factGraphForLanguageAudit = knowledgeGraph;
    }
  } catch {
    // Without a current snapshot, no source-owned exemption is granted. The
    // fact graph is still used structurally, but not as language authority.
  }

  const built = buildSemanticGraph({
    structureDigest: currentStructureDigest,
    factNodeIds,
    factGraph: factGraphForLanguageAudit,
    sourceSnapshot,
    layers: Array.isArray(layers) ? layers : layers?.layers ?? [],
    relations: Array.isArray(relations) ? relations : relations?.relations ?? [],
    model: args.model ?? undefined,
    generatedAt: args.generatedAt ?? undefined,
    extraGaps: Array.isArray(extraGaps) ? extraGaps : extraGaps?.gaps ?? [],
  });
  const { semanticGraph, gaps, languageAudit } = built;
  if (!semanticGraph) {
    process.stderr.write(
      `semantic-graph write: status=noncanonical-language ${JSON.stringify(languageAudit)}\n`,
    );
    process.exitCode = 2;
    return;
  }

  const outPath = writeSemanticGraph(dataDir, semanticGraph);
  process.stderr.write(
    `semantic-graph write: layers=${semanticGraph.layers.length} relations=${semanticGraph.relations.length} ` +
    `gaps=${gaps.length} language-fields=${languageAudit.inspected} ` +
    `structureDigest=${currentStructureDigest.slice(0, 12)}… -> ${outPath}\n`,
  );
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
    process.stderr.write(`semantic-graph.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default {
  SEMANTIC_GRAPH_VERSION, SEMANTIC_GRAPH_CONTENT_LANGUAGE, SEMANTIC_GRAPH_FILE,
  buildSemanticGraph, resolveArchitectureAction, collectFactNodeIds,
  mergeExtraGapsIntoExisting, readSemanticGraph, writeSemanticGraph,
  ADDITIVE_FACT_STREAMS, legacyFactDigestCandidates, rebindSemanticGraph,
  auditSemanticGraphFields, isAcceptedLanguageAudit,
};
