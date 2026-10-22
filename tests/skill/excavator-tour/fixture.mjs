/**
 * Synthetic projects for the tour tests: a temporary git repository (or a
 * parent directory of member repositories) with hand-built `.excavator/`
 * products. Nothing here is derived from a real project.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { locateDraft } from '../../../skills/excavator/tour-layout.mjs';
import { makeGitProject, makeMultiRepoProject, semanticCache, semanticEntry, semanticGraph, sourceManifest, writeProduct } from '../excavator-view/fixture.mjs';

export { makeGitProject, makeMultiRepoProject, semanticCache, semanticEntry, semanticGraph, sourceManifest, writeProduct };

export const DIGEST = 'a'.repeat(64);
export const OTHER_DIGEST = 'b'.repeat(64);
const GRAPH_FORMAT = 'excavator-knowledge-graph-lines/1';

export const fileNode = (path, extra = {}) => ({ id: `file:${path}`, type: 'file', name: path.slice(path.lastIndexOf('/') + 1), filePath: path, summary: '', tags: [], ...extra });
export const fnNode = (path, name, extra = {}) => ({ id: `function:${path}:${name}`, type: 'function', name, filePath: path, lineRange: [1, 5], summary: '', tags: [], ...extra });
export const configNode = (path, name) => ({ id: `config:${path}:${name}`, type: 'config', name, filePath: path, lineRange: [1, 1], summary: '', tags: [] });
export const edge = (source, target, type = 'imports') => ({ source, target, type });
/** A file-level import edge between two file paths. */
export const imports = (from, to) => edge(`file:${from}`, `file:${to}`, 'imports');

/** A knowledge-graph JSONL text as the Full-mode graph writes it, with layer records when given. */
export function tourGraphJsonl({ factsDigest = DIGEST, nodes, edges = [], layers = [] }) {
  const lines = [{
    record: 'header',
    format: GRAPH_FORMAT,
    keys: ['version', 'project', 'nodes', 'edges', 'layers'],
    fields: { version: '1.0.0', project: { name: 'fixture', languages: ['go'], frameworks: [], ...(factsDigest === null ? {} : { factsDigest }) } },
    counts: { nodes: nodes.length, edges: edges.length, layers: layers.length },
  }];
  for (const node of nodes) lines.push({ record: 'node', node });
  for (const e of edges) lines.push({ record: 'edge', edge: { direction: 'forward', weight: 1, ...e } });
  for (const layer of layers) lines.push({ record: 'layer', layer });
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

/** File nodes for `paths` (those not already given in `nodes`) plus `nodes`, and the edges; written as the project's graph. */
export function writeGraph(root, { paths = [], nodes = [], edges = [], layers = [], factsDigest = DIGEST } = {}) {
  const have = new Set(nodes.map((node) => node.id));
  const all = [...paths.map((path) => fileNode(path)).filter((node) => !have.has(node.id)), ...nodes];
  writeProduct(root, 'knowledge-graph.jsonl', tourGraphJsonl({ factsDigest, nodes: all, edges, layers }));
  return all;
}

/** The source manifest the semantic freshness check reads: `{ path: contentHash }`. */
export function writeManifest(root, hashes) {
  writeProduct(root, 'source-manifest.json', sourceManifest('fixture-revision', Object.entries(hashes).map(([path, contentHash]) => ({ path, contentHash }))));
}

/** A semantic cache of `{ nodeId: { summary, semanticSourceHash, verification? } }`. */
export function writeSemantics(root, entries, { layers, factDigest = DIGEST } = {}) {
  writeProduct(root, 'semantic-cache.json', semanticCache(Object.fromEntries(Object.entries(entries).map(([id, fields]) => [id, semanticEntry(fields)]))));
  if (layers) writeProduct(root, 'semantic-graph.json', semanticGraph({ factDigest, layers }));
}

/** A domain graph of flows: `{ flowId: [[stepName, [nodeIds]], ...] }`, steps ordered by their `flow_step` weight in the order given. */
export function writeDomain(root, flows, { factDigest = DIGEST, sourceRevision = 'fixture-revision' } = {}) {
  const nodes = [];
  const edges = [];
  for (const [flowId, steps] of Object.entries(flows)) {
    nodes.push({ id: `flow:${flowId}`, type: 'flow', name: flowId, summary: `Flow ${flowId}.`, tags: [], complexity: 'simple', domainMeta: { entryPoint: flowId, entryType: 'cli' } });
    steps.forEach(([name, nodeIds], i) => {
      nodes.push({ id: `step:${flowId}:${name}`, type: 'step', name, summary: `Step ${name}.`, tags: [], complexity: 'simple', filePath: 'x.go', nodeIds, evidence: [] });
      edges.push({ source: `flow:${flowId}`, target: `step:${flowId}:${name}`, type: 'flow_step', direction: 'forward', weight: (i + 1) / 10 });
    });
  }
  writeProduct(root, 'domain-graph.json', {
    version: '2.0.0', contentLanguage: 'en', sourceRevision, factDigest, project: { name: 'fixture' }, nodes, edges, layers: [], tour: [], gaps: [], languageAudit: { status: 'accepted', fields: 1 },
  });
}

export const clearProducts = (root) => rmSync(join(root, '.excavator'), { recursive: true, force: true });

/** `n` zero-padded file paths under `dir`: dir/f00.go, dir/f01.go, ... */
export const manyPaths = (dir, n, prefix = 'f') => Array.from({ length: n }, (_, i) => `${dir}/${prefix}${String(i).padStart(2, '0')}.go`);

// ---------------------------------------------------------------------------
// Tour-draft fixtures (check, slices, verdicts)
// ---------------------------------------------------------------------------

/** `n` numbered lines `line <k>` of a source file. */
export const sourceLines = (n, prefix = 'line') => `${Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n')}\n`;

/**
 * A tour's candidates.json written by hand for `revision`: `[{ id, filePath, lineRange?, type? }]`, and the knowledge graph
 * it was made from (same facts digest): the candidates as nodes, plus `contains` edges for `contains`, a map of
 * file node id to `[{ node }]` where `node` is a full graph node, or null for an edge whose target the graph lacks.
 */
export function writeCandidatesFile(root, revision, nodes, { contains = {} } = {}) {
  const candidates = nodes.map((node) => ({
    id: node.id, type: node.type ?? 'file', name: node.id, filePath: node.filePath, lineRange: node.lineRange ?? null, layer: null, reasons: ['fixture'], summary: '', summarySource: 'none', verification: null,
  }));
  const dir = join(root, '.excavator', 'tour');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'candidates.json'), JSON.stringify({ format: 'excavator-tour-candidates/1', factsDigest: DIGEST, sourceRevision: revision, sources: {}, classes: {}, layers: [], gaps: [], candidates }));
  const graphNodes = nodes.map((node) => ({ id: node.id, type: node.type ?? 'file', name: node.id.split('/').pop(), filePath: node.filePath, ...(node.lineRange ? { lineRange: node.lineRange } : {}), summary: '', tags: [] }));
  const items = Object.entries(contains).flatMap(([file, entries]) => entries.map((entry) => ({ file, entry })));
  writeProduct(root, 'knowledge-graph.jsonl', tourGraphJsonl({
    factsDigest: DIGEST,
    nodes: [...graphNodes, ...items.filter(({ entry }) => entry.node).map(({ entry }) => entry.node)],
    edges: items.map(({ file, entry }) => ({ source: file, target: entry.node ? entry.node.id : entry.id, type: 'contains' })),
  }));
  return dir;
}

/** A draft step with two description sentences citing `nodeIds`; `extra` replaces fields. */
export const draftStep = (order, nodeIds = ['file:a.go'], extra = {}) => ({
  order,
  title: `Step ${order}`,
  description: `Step ${order} reads the first thing. It then reads the second thing.`,
  nodeIds,
  ...extra,
});

/** A draft of `n` steps (default 5), each citing `file:a.go`. */
export const draftOf = (n = 5, extra = {}) => ({ contentLanguage: 'en', steps: Array.from({ length: n }, (_, i) => draftStep(i + 1)), ...extra });

export function writeDraft(root, draft) {
  const path = join(root, '.excavator', 'tour', 'draft.json');
  mkdirSync(join(root, '.excavator', 'tour'), { recursive: true });
  writeFileSync(path, typeof draft === 'string' ? draft : JSON.stringify(draft, null, 2));
  return locateDraft(path);
}

/** Write the verifier's output for a step: `[[sentenceId, verdict, reason?], ...]`. */
export function writeVerdicts(tourDir, round, order, rows) {
  const dir = join(tourDir, 'verdicts', `round-${round}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `step-${order}.json`), JSON.stringify({ step: order, verdicts: rows.map(([id, verdict, reason = `reason for ${id}`]) => ({ id, verdict, reason })) }));
}
