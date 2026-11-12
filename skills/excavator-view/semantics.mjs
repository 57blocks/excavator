/**
 * semantics.mjs
 *
 * Reads the Full-mode semantic files into the one payload the page merges into
 * its nodes (openspec: changes/viewer-app, design D11): summaries and tags
 * from `semantic-cache.json`, layers from `semantic-graph.json`. Freshness is
 * judged here and never on the page, with the same two functions the rest of
 * the plugin uses (`isCanonicalSemanticCache`, `isFresh`) against the content
 * hash `source-manifest.json` records for the node's file:
 *   - an entry that is not fresh is left out of the payload and counted;
 *   - an entry a verifier contradicted keeps its verdict and loses its summary,
 *     so the text is not in the page at all;
 *   - `semanticSourceHash` and `languageAudit` are not copied.
 * The layers are inlined only when the semantic graph was made from the same
 * facts as the knowledge graph (`factDigest` equals the graph's `factsDigest`).
 *
 * Returns { state: 'absent' }, { state: 'unreadable', reason }, { state: 'no-graph' }
 * (a cache and a semantic graph that pass their own checks, with no readable
 * knowledge graph to match them to) or
 * { state: 'ok', bytes, counts }; it never throws for a bad file. No model call.
 */

import { join } from 'node:path';

import { bufferLines } from '../excavator/jsonl-lines.mjs';
import { isCanonicalSemanticCache, isFresh, SEMANTIC_CACHE_FILE } from '../excavator/semantic-cache.mjs';
import { SEMANTIC_GRAPH_CONTENT_LANGUAGE, SEMANTIC_GRAPH_FILE, SEMANTIC_GRAPH_VERSION } from '../excavator/semantic-graph.mjs';
import { parseJsonObject, readRegularFile } from './product-files.mjs';

const SOURCE_MANIFEST_FILE = 'source-manifest.json';
const CONTRADICTED = 'contradicted';
const FIXED_VERDICTS = ['verified', 'unverified', CONTRADICTED];

const unreadable = (reason) => ({ state: 'unreadable', reason });
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The facts digest and each node's file path, from the knowledge graph's bytes; lines that are not records are the graph product's to report. */
function readGraphFacts(graphBytes) {
  const nodeFiles = new Map();
  let digest = null;
  let first = true;
  for (const line of bufferLines(graphBytes)) {
    if (line.trim() === '') continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (first) {
      first = false;
      const project = record?.fields?.project;
      if (isObject(project) && typeof project.factsDigest === 'string' && project.factsDigest !== '') digest = project.factsDigest;
    } else if (record?.record === 'node' && typeof record.node?.id === 'string' && typeof record.node.filePath === 'string') {
      if (!nodeFiles.has(record.node.id)) nodeFiles.set(record.node.id, record.node.filePath);
    }
  }
  return { digest, nodeFiles };
}

/** The semantic graph as its own checks accept it (null when there is none), or the reason it cannot be read. */
function readSemanticGraph(dataDir) {
  const file = readRegularFile(join(dataDir, SEMANTIC_GRAPH_FILE), SEMANTIC_GRAPH_FILE);
  if (file.state === 'absent') return { graph: null };
  if (file.state === 'unreadable') return { reason: file.reason };
  const parsed = parseJsonObject(file.bytes, SEMANTIC_GRAPH_FILE);
  if (!parsed.value) return { reason: parsed.reason };
  const graph = parsed.value;
  if (graph.version !== SEMANTIC_GRAPH_VERSION || graph.contentLanguage !== SEMANTIC_GRAPH_CONTENT_LANGUAGE) {
    return {
      reason: `${SEMANTIC_GRAPH_FILE} has version ${JSON.stringify(graph.version ?? null)} and contentLanguage ${JSON.stringify(graph.contentLanguage ?? null)}; the viewer reads version ${SEMANTIC_GRAPH_VERSION} and contentLanguage ${SEMANTIC_GRAPH_CONTENT_LANGUAGE}`,
    };
  }
  if (!Array.isArray(graph.layers) || typeof graph.factDigest !== 'string') {
    const missing = [!Array.isArray(graph.layers) && 'layers', typeof graph.factDigest !== 'string' && 'factDigest'].filter(Boolean);
    return { reason: `${SEMANTIC_GRAPH_FILE} is missing the top-level key(s): ${missing.join(', ')}` };
  }
  return { graph };
}

/** The semantic graph's layers, or the reason it cannot be used with the knowledge graph whose facts digest is given. */
function layersFor(graph, graphDigest) {
  if (graph === null) return { layers: [] };
  if (graph.factDigest !== graphDigest) {
    return {
      reason: `${SEMANTIC_GRAPH_FILE} was made from other facts than knowledge-graph.jsonl: its factDigest is ${graph.factDigest} and the graph's factsDigest is ${graphDigest ?? 'not recorded'}`,
    };
  }
  const layers = graph.layers.filter(isObject).map((layer) => ({
    id: layer.id,
    name: layer.name,
    description: typeof layer.description === 'string' ? layer.description : '',
    nodeIds: Array.isArray(layer.nodeIds) ? layer.nodeIds.filter((id) => typeof id === 'string') : [],
  }));
  return { layers };
}

/** The content hash `source-manifest.json` records for each file path, or the reason it cannot be read. */
function readCurrentHashes(dataDir) {
  const file = readRegularFile(join(dataDir, SOURCE_MANIFEST_FILE), SOURCE_MANIFEST_FILE);
  if (file.state === 'absent') return { reason: `${SOURCE_MANIFEST_FILE} is missing, so the summaries cannot be checked against the source` };
  if (file.state === 'unreadable') return { reason: file.reason };
  const parsed = parseJsonObject(file.bytes, SOURCE_MANIFEST_FILE);
  if (!parsed.value) return { reason: parsed.reason };
  if (!Array.isArray(parsed.value.entries)) return { reason: `${SOURCE_MANIFEST_FILE} is missing the top-level key(s): entries` };
  const hashes = new Map();
  for (const entry of parsed.value.entries) {
    if (isObject(entry) && typeof entry.path === 'string' && typeof entry.contentHash === 'string') hashes.set(entry.path, entry.contentHash);
  }
  return { hashes };
}

/** One payload row: the fields the page reads, a contradicted summary blanked. */
function payloadEntry(id, entry) {
  const verification = typeof entry.verification === 'string' && entry.verification !== '' ? entry.verification : null;
  const row = {
    id,
    summary: verification === CONTRADICTED ? '' : entry.summary,
    tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === 'string') : [],
  };
  if (verification !== null) row.verification = verification;
  return row;
}

function verdictCounts(rows) {
  const counts = new Map([...FIXED_VERDICTS, 'unchecked'].map((key) => [key, 0]));
  for (const row of rows) {
    const key = row.verification ?? 'unchecked';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Fixed keys first, any other verdict the cache holds after them in name order.
  const fixed = [...counts].slice(0, FIXED_VERDICTS.length + 1);
  const extra = [...counts].slice(FIXED_VERDICTS.length + 1).sort((a, b) => compare(a[0], b[0]));
  return Object.fromEntries([...fixed, ...extra]);
}

/**
 * @param {string} dataDir the project's `.excavator/`
 * @param {Buffer|null} graphBytes the knowledge graph's bytes when that product is readable, else null
 */
export function readSemantics(dataDir, graphBytes) {
  const file = readRegularFile(join(dataDir, SEMANTIC_CACHE_FILE), SEMANTIC_CACHE_FILE);
  if (file.state === 'absent') return { state: 'absent' };
  if (file.state === 'unreadable') return unreadable(file.reason);
  const parsed = parseJsonObject(file.bytes, SEMANTIC_CACHE_FILE);
  if (!parsed.value) return unreadable(parsed.reason);
  const cache = parsed.value;
  if (!isCanonicalSemanticCache(cache)) {
    return unreadable(`${SEMANTIC_CACHE_FILE} has version ${JSON.stringify(cache.version ?? null)} and contentLanguage ${JSON.stringify(cache.contentLanguage ?? null)}; the viewer reads the current version and contentLanguage "en"`);
  }
  if (!isObject(cache.entries)) return unreadable(`${SEMANTIC_CACHE_FILE} is missing the top-level key(s): entries`);
  const semanticGraph = readSemanticGraph(dataDir);
  if (semanticGraph.reason) return unreadable(semanticGraph.reason);
  if (graphBytes === null) return { state: 'no-graph' };

  const facts = readGraphFacts(graphBytes);
  const layers = layersFor(semanticGraph.graph, facts.digest);
  if (layers.reason) return unreadable(layers.reason);
  const current = readCurrentHashes(dataDir);
  if (current.reason) return unreadable(current.reason);

  const rows = [];
  let stale = 0;
  for (const [id, entry] of Object.entries(cache.entries)) {
    // A node the graph lacks, or a file the manifest lacks, has no current hash: isFresh says not fresh.
    const currentHash = current.hashes.get(facts.nodeFiles.get(id));
    if (isFresh(entry, currentHash, cache)) rows.push(payloadEntry(id, entry));
    else stale += 1;
  }
  rows.sort((a, b) => compare(a.id, b.id));

  return {
    state: 'ok',
    bytes: Buffer.from(JSON.stringify({ entries: rows, layers: layers.layers }), 'utf-8'),
    counts: { entries: rows.length, stale, byVerdict: verdictCounts(rows), layers: layers.layers.length },
  };
}
