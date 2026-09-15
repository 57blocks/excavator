#!/usr/bin/env node
/**
 * semantic-graph.mjs
 *
 * The `semantic-graph.json` product and its deterministic write module
 * (openspec: changes/full-semantic-isolation, capability
 * `full-semantic-isolation`, design D2). It is an OVERLAY on top of the
 * deterministic fact graph (`knowledge-graph.json`, built by
 * build-fact-graph.mjs / lazy-analyze.mjs — the SAME builder Full mode now
 * reuses, design D1): it stores architecture `layers` (each `nodeIds[]` a set
 * of REAL fact-graph node ids, resolved via the shared node-identity
 * authority) and cross-node semantic `relations` (each carrying
 * `provenance`/`evidence` back to source), keyed by the current schema,
 * `contentLanguage: "en"`, and a `factDigest` freshness field.
 *
 * Naming note: `factDigest` here is the SAME value build-fact-graph.mjs
 * computes and knowledge-graph.json publishes as `project.factsDigest` — this
 * module names the field `factDigest` (singular "fact") to match the openspec
 * spec/design text for THIS artifact; it is not a second, independently
 * computed digest.
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
 *     `reuse` branch of the factDigest gate, so a fresh patch-time gap is
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
 *   factDigest: string,
 *   factNodeIds: Set<string>|string[],
 *   layers?: object[], relations?: object[],
 *   model?: string, generatedAt?: string, sampleLimit?: number,
 *   extraGaps?: object[],
 * }} args
 * @returns {{ semanticGraph: object, gaps: object[] }}
 */
export function buildSemanticGraph({
  factDigest,
  factNodeIds,
  layers = [],
  relations = [],
  model = 'unknown',
  generatedAt = new Date().toISOString(),
  sampleLimit = 5,
  extraGaps = [],
}) {
  if (typeof factDigest !== 'string' || factDigest.length === 0) {
    throw new Error('buildSemanticGraph: factDigest is required');
  }
  const idSet = factNodeIds instanceof Set ? factNodeIds : new Set(factNodeIds ?? []);

  const gapCollector = createGapCollector(sampleLimit);
  const sanitizedLayers = sanitizeLayers(layers, idSet, gapCollector);
  const sanitizedRelations = sanitizeRelations(relations, idSet, gapCollector);
  const ownGaps = gapCollector.toArray(reasonFor);

  // `extraGaps` lets an upstream step (e.g. apply-semantic-patches.mjs's
  // node-local patch gaps) merge into the SAME overlay artifact rather than
  // inventing a second gap sink — semantic-graph.json is the one place Full
  // mode's semantic-generation-time gaps live, mirroring how knowledge-graph.json
  // is the one place fact-layer gaps live.
  const gaps = [...ownGaps, ...(Array.isArray(extraGaps) ? extraGaps : [])].sort(compareGaps);

  const semanticGraph = {
    version: SEMANTIC_GRAPH_VERSION,
    contentLanguage: SEMANTIC_GRAPH_CONTENT_LANGUAGE,
    factDigest,
    layers: sanitizedLayers,
    relations: sanitizedRelations,
    gaps,
    model: isNonEmptyString(model) ? model.trim() : 'unknown',
    generatedAt,
  };
  return { semanticGraph, gaps };
}

/**
 * The architecture gate: reuse requires the current semantic schema,
 * `contentLanguage: "en"`, and a factDigest matching the CURRENT fact graph.
 *
 * @param {{ currentFactDigest: string, existing: object|null }} args
 * @returns {{ action: 'reuse'|'rebuild', status: 'fresh'|'stale'|'missing'|'noncanonical-language', reason: string }}
 */
export function resolveArchitectureAction({ currentFactDigest, existing }) {
  if (!existing) {
    return { action: 'rebuild', status: 'missing', reason: 'no existing semantic-graph.json' };
  }
  if (
    existing.version !== SEMANTIC_GRAPH_VERSION
    || existing.contentLanguage !== SEMANTIC_GRAPH_CONTENT_LANGUAGE
  ) {
    return {
      action: 'rebuild',
      status: 'noncanonical-language',
      reason: 'noncanonical-language: semantic-graph.json lacks the current schema with contentLanguage=en',
    };
  }
  if (typeof existing.factDigest !== 'string' || existing.factDigest.length === 0) {
    return { action: 'rebuild', status: 'missing', reason: 'semantic-graph.json carries no factDigest' };
  }
  if (existing.factDigest === currentFactDigest) {
    return {
      action: 'reuse',
      status: 'fresh',
      reason: 'factDigest unchanged since the existing semantic-graph.json was written',
    };
  }
  return {
    action: 'rebuild',
    status: 'stale',
    reason: `factDigest changed (${existing.factDigest.slice(0, 12)}… -> ${String(currentFactDigest).slice(0, 12)}…)`,
  };
}

/** Every fact-graph node id, as a Set, from an already-loaded knowledge-graph.json. */
export function collectFactNodeIds(knowledgeGraph) {
  return new Set((knowledgeGraph?.nodes ?? []).map((n) => n.id));
}

/** Gap kinds this module's OWN `buildSemanticGraph` produces from the last
 *  real layers/relations build — never clobbered by a gaps-only refresh. */
const OWN_STRUCTURAL_GAP_PREFIXES = Object.freeze(['layer-', 'relation-']);

/**
 * Refresh ONLY the `gaps` field of an already-written semantic-graph.json —
 * used on the `reuse` branch of the factDigest gate (design D3): Architecture
 * did not rerun, so `layers`/`relations`/`factDigest` stay exactly as they
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

  const graphPath = join(dataDir, 'knowledge-graph.json');
  const knowledgeGraph = readJson(graphPath, 'knowledge-graph.json');
  const currentFactDigest = knowledgeGraph?.project?.factsDigest;
  if (typeof currentFactDigest !== 'string' || currentFactDigest.length === 0) {
    throw new Error('semantic-graph: knowledge-graph.json has no project.factsDigest — run the fact build first');
  }

  const existing = readSemanticGraph(dataDir);

  if (args.action === 'check') {
    const { action, reason } = resolveArchitectureAction({ currentFactDigest, existing });
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

  const factNodeIds = collectFactNodeIds(knowledgeGraph);
  const { semanticGraph, gaps } = buildSemanticGraph({
    factDigest: currentFactDigest,
    factNodeIds,
    layers: Array.isArray(layers) ? layers : layers?.layers ?? [],
    relations: Array.isArray(relations) ? relations : relations?.relations ?? [],
    model: args.model ?? undefined,
    generatedAt: args.generatedAt ?? undefined,
    extraGaps: Array.isArray(extraGaps) ? extraGaps : extraGaps?.gaps ?? [],
  });

  const outPath = writeSemanticGraph(dataDir, semanticGraph);
  process.stderr.write(
    `semantic-graph write: layers=${semanticGraph.layers.length} relations=${semanticGraph.relations.length} ` +
    `gaps=${gaps.length} factDigest=${currentFactDigest.slice(0, 12)}… -> ${outPath}\n`,
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
};
