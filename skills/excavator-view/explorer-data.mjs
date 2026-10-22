/**
 * explorer-data.mjs
 *
 * Builds the data object of `.excavator/explorer.html` (openspec: changes/
 * viewer-explorer, design D4). The explorer copy fetched six data files and a
 * source file from a dev server; the offline page reads one object from
 * `window.__EXCAVATOR_EXPLORER_DATA__` instead, with the original file names as
 * keys and the sources in a table (documented in `packages/explorer/src/offline/
 * inlineData.ts`). Only the shape changes here, never the content:
 *
 *   knowledge-graph.json  the header's fields and every node, edge, layer, tour step, gap and
 *                         the coverage record of `knowledge-graph.jsonl`, joined back into one graph
 *   domain-graph.json     the file as written, but for the commit hash below
 *   meta.json             the file as written
 *   sources               { <filePath>: { path, content, sizeBytes, lineCount } } for the files the
 *                         pack embeds (`sources.mjs` rules); no table under `--no-source`
 *
 * A project outside git has `project.gitCommitHash: null` in both graphs, and the copy's
 * validator rejects a whole graph for any value that is not a string (the domain graph
 * then disappears without a word); the copy writes "no hash" as an empty string, so null
 * becomes "" there and nowhere else.
 *
 * The Full-mode semantic product (`semantics.mjs`: fresh entries only, a contradicted
 * summary already blanked, layers only when the semantic graph was made from the
 * graph's facts) is merged into the graph by the view page's own rule
 * (`packages/report-view/src/data/semantics.ts`): a node's summary is its entry's when
 * that is not empty, empty when the entry was contradicted, else the node's own; its
 * tags are the entry's when there are any, else the node's own; its `verification` is the
 * entry's verdict when it has one (the copy shows it beside the summary); the semantic layers
 * replace the graph's when there is at least one. Entries for ids the graph lacks are
 * counted, not placed.
 *
 * The graph's `tour` is replaced by the steps of `tour.json` (`order`, `title`,
 * `description`, `nodeIds`) only when `tour.mjs` judged that tour to be made from the
 * same facts as the graph; otherwise the graph keeps its own `tour`.
 *
 * A product that is not there, cannot be read or was not packed gives no key, and the
 * copy shows its own empty state for it; `rows` says why, key by key. `diff-overlay.json`,
 * `config.json` and `staleness.json` have no product to read: the first two are not
 * produced here, and a pack-time staleness report would be a frozen claim about a
 * working tree the page cannot see (the copy refreshes it on focus), so it is left out.
 *
 * No `language` is written for a source: the copy's code viewer then derives it from the
 * file name, as it does for a source the server gave none for.
 *
 * Deterministic and model-free. It reads `meta.json`, `domain-graph.json` and
 * `knowledge-graph.jsonl` under `.excavator/`, nothing else, and writes nothing.
 */

import { join } from 'node:path';

import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph } from '../excavator/knowledge-graph-store.mjs';
import { parseJsonObject, readRegularFile } from './product-files.mjs';

export const GRAPH_KEY = 'knowledge-graph.json';
export const DOMAIN_KEY = 'domain-graph.json';
export const META_KEY = 'meta.json';
export const SOURCES_KEY = 'sources';

/** Keys the offline page may carry that nothing in the products produces. */
const NOT_PRODUCED = [
  ['diff-overlay.json', 'no product holds a diff overlay'],
  ['config.json', 'no product holds an explorer config'],
  ['staleness.json', 'a pack-time report would be a frozen claim about the working tree; left out'],
];

const READABLE = new Set(['included', 'different-revision']);

const payloadOf = (products, id) => products.payloads.find((payload) => payload.id === id) ?? null;
const entryOf = (products, name) => products.entries.find((entry) => entry.name === name);

/** The row for a product the page cannot show: why there is no key. */
function absentRow(key, entry) {
  if (entry.status === 'not-run') return { key, status: 'not-run', reason: `${entry.file} was not produced` };
  return { key, status: entry.status, reason: entry.reason ?? `${entry.file} is ${entry.status}` };
}

/** The graph with a null commit hash written the way the copy accepts it. */
function withHashString(graph) {
  if (graph.project && graph.project.gitCommitHash === null) graph.project.gitCommitHash = '';
  return graph;
}

/** The knowledge graph joined back into one object; a body the store refuses is a visible reason, not a thrown error. */
function readGraph(dataDir, products) {
  const entry = entryOf(products, 'knowledge-graph');
  if (!READABLE.has(entry.status)) return { row: absentRow(GRAPH_KEY, entry) };
  try {
    return { graph: withHashString(readKnowledgeGraph(join(dataDir, KNOWLEDGE_GRAPH_FILE))), row: { key: GRAPH_KEY, status: 'included' } };
  } catch (error) {
    return { row: { key: GRAPH_KEY, status: 'unreadable', reason: error.message } };
  }
}

/** A JSON object product that sits as one file, passed on as written. */
function readObjectFile(dataDir, file, key) {
  const read = readRegularFile(join(dataDir, file), file);
  if (read.state === 'absent') return { row: { key, status: 'not-run', reason: `${file} was not produced` } };
  if (read.state === 'unreadable') return { row: { key, status: 'unreadable', reason: read.reason } };
  const parsed = parseJsonObject(read.bytes, file);
  if (!parsed.value) return { row: { key, status: 'unreadable', reason: parsed.reason } };
  return { value: parsed.value, row: { key, status: 'included' } };
}

function readDomain(dataDir, products) {
  const entry = entryOf(products, 'domain-graph');
  if (!READABLE.has(entry.status)) return { row: absentRow(DOMAIN_KEY, entry) };
  const read = readObjectFile(dataDir, entry.file, DOMAIN_KEY);
  if (read.value) withHashString(read.value);
  return read;
}

/**
 * The tour steps in the copy's shape when the tour is the graph's own revision, with the row that says which tour the page shows.
 * `tour.mjs` keeps the steps in its payload only for a tour made from the graph's facts.
 */
function readTourSteps(products) {
  const entry = entryOf(products, 'tour');
  if (entry.status === 'included') {
    const payload = payloadOf(products, 'tour');
    const steps = payload ? JSON.parse(payload.bytes.toString('utf-8')).steps : null;
    if (Array.isArray(steps)) {
      return {
        steps: steps.map(({ order, title, description, nodeIds }) => ({ order, title, description, nodeIds })),
        row: { key: 'tour', status: 'replaces-graph-tour', reason: entry.revisionNote },
      };
    }
  }
  const why = entry.status === 'not-run' ? `${entry.file} was not produced` : entry.reason ?? `${entry.file} is ${entry.status}`;
  return { steps: null, row: { key: 'tour', status: 'keeps-graph-tour', reason: why } };
}

const CONTRADICTED = 'contradicted';
const nonEmpty = (value) => typeof value === 'string' && value !== '';
const tagList = (value) => (Array.isArray(value) ? value.filter((tag) => typeof tag === 'string') : []);

/** One node's summary, tags and verdict after its semantic entry, by the view page's order of sources; no verdict when neither has one. */
function mergedText(node, entry) {
  const ownSummary = nonEmpty(node.summary) ? node.summary : '';
  const ownTags = tagList(node.tags);
  const entryTags = tagList(entry.tags);
  const tags = entryTags.length > 0 ? entryTags : ownTags;
  const verification = nonEmpty(entry.verification) ? entry.verification : nonEmpty(node.verification) ? node.verification : null;
  const verdict = verification === null ? {} : { verification };
  if (verification === CONTRADICTED) return { summary: '', tags, ...verdict };
  return { summary: nonEmpty(entry.summary) ? entry.summary : ownSummary, tags, ...verdict };
}

/** Merges the semantic product into the graph in place; the row says what it gave. */
function mergeSemantics(graph, products) {
  const entry = entryOf(products, 'semantics');
  if (!entry || entry.status !== 'included') {
    const why = !entry || entry.status === 'not-run' ? 'semantic-cache.json was not produced' : entry.reason ?? `semantic-cache.json is ${entry.status}`;
    return { key: 'semantics', status: 'not-merged', reason: why };
  }
  const payload = payloadOf(products, 'semantics');
  const { entries, layers } = JSON.parse(payload.bytes.toString('utf-8'));
  const byId = new Map(entries.map((row) => [row.id, row]));
  let merged = 0;
  for (const node of graph.nodes) {
    const row = byId.get(node.id);
    if (!row) continue;
    Object.assign(node, mergedText(node, row));
    byId.delete(node.id);
    merged += 1;
  }
  const replaceLayers = Array.isArray(layers) && layers.length > 0;
  if (replaceLayers) graph.layers = layers;
  const layerText = replaceLayers ? `${layers.length} layers replace the graph's` : "the graph's own layers kept";
  return { key: 'semantics', status: 'merged', reason: `${merged} nodes; ${byId.size} entries for ids the graph lacks; ${layerText}` };
}

/** Number of lines as an editor counts them: a final newline ends the last line, it does not start another. */
function lineCountOf(text) {
  if (text === '') return 0;
  const lines = text.split('\n').length;
  return text.endsWith('\n') ? lines - 1 : lines;
}

/** The source table in the shape the code viewer reads, from the texts `sources.mjs` embedded; null when none were. */
function sourceTable(sources) {
  const payload = sources.payloads.find((item) => item.id === 'sources');
  if (!payload) return null;
  const texts = JSON.parse(payload.bytes.toString('utf-8'));
  // Null prototype: a file named __proto__ is an entry like any other.
  const table = Object.create(null);
  for (const [path, content] of Object.entries(texts)) {
    table[path] = { path, content, sizeBytes: content.length, lineCount: lineCountOf(content) };
  }
  return table;
}

function sourcesRow(sources) {
  const { counts, requested } = sources.manifest;
  if (!requested) return { key: SOURCES_KEY, status: 'not-embedded', reason: 'the pack was asked not to embed source' };
  if (counts.embedded === 0) return { key: SOURCES_KEY, status: 'not-embedded', reason: 'no referenced file could be embedded' };
  return { key: SOURCES_KEY, status: 'included', reason: `${counts.embedded} files` };
}

/**
 * @param {{ dataDir: string, products: { entries: object[], payloads: {id: string, bytes: Buffer}[] }, sources: { manifest: object, payloads: {id: string, bytes: Buffer}[] } }} input
 *   `products` and `sources` are what `collectProducts` and `collectSources` returned for the same pack
 * @returns {{ data: Record<string, unknown>, rows: { key: string, status: string, reason?: string }[] }}
 */
export function buildExplorerData({ dataDir, products, sources }) {
  const data = {};
  const rows = [];

  const graph = readGraph(dataDir, products);
  rows.push(graph.row);
  const tour = readTourSteps(products);
  if (graph.graph) {
    rows.push(mergeSemantics(graph.graph, products));
    if (tour.steps !== null) graph.graph.tour = tour.steps;
    data[GRAPH_KEY] = graph.graph;
  } else {
    rows.push({ key: 'semantics', status: 'unused', reason: 'there is no knowledge graph to hold it' });
  }
  rows.push(graph.graph ? tour.row : { key: 'tour', status: 'unused', reason: 'there is no knowledge graph to hold it' });

  const domain = readDomain(dataDir, products);
  rows.push(domain.row);
  if (domain.value) data[DOMAIN_KEY] = domain.value;

  const meta = readObjectFile(dataDir, 'meta.json', META_KEY);
  rows.push(meta.row);
  if (meta.value) data[META_KEY] = meta.value;

  const table = sources.manifest.requested ? sourceTable(sources) : null;
  rows.push(sourcesRow(sources));
  if (table !== null) data[SOURCES_KEY] = table;

  for (const [key, reason] of NOT_PRODUCED) rows.push({ key, status: 'not-produced', reason });
  return { data, rows };
}
