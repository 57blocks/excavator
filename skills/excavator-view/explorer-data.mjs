/**
 * explorer-data.mjs
 *
 * Builds the data object of `.excavator/explorer.html` (openspec: changes/
 * viewer-explorer, design D4). The explorer copy fetched six data files and a
 * source file from a dev server; the offline page reads one object instead, with
 * the original file names as keys and the sources in a table (documented in
 * `packages/explorer/src/offline/inlineData.ts`). `page-assembly.mjs` writes that
 * object into the page as compressed parts (`data-chunks.mjs`); it is the same
 * object when read back. Only the shape changes here, never the content:
 *
 *   knowledge-graph.json  the header's fields and every node, edge, layer, tour step, gap and
 *                         the coverage record of `knowledge-graph.jsonl`, joined back into one graph
 *   domain-graph.json     the file as written, but for the commit hash below
 *   meta.json             the file as written
 *   staleness.json        each graph's recorded source revision against the snapshot's (below)
 *   unused-code.json      the product files as written (parsed), each only when its entry is included or
 *   hotspots.json         made from a different revision; absent otherwise
 *   doc-map.json
 *   doc-map-checks.json   the doc map's `doc-map/checks.json`, only when the doc map is there and has one
 *   products.json         { snapshotRevision, products: [{ name, status, reason, revision, revisionNote, command }] } for
 *                         unused-code, hotspots and doc-map, from the entries `products.mjs` judged, so each
 *                         product view states its product the way the pack's reply does
 *   sources               { <filePath>: { path, content, sizeBytes, lineCount } } for the files the
 *                         pack embeds (`sources.mjs` rules); no table under `--no-source`
 *
 * A project outside git has `project.gitCommitHash: null` in both graphs, and the copy's
 * validator rejects a whole graph for any value that is not a string (the domain graph
 * then disappears without a word); the copy writes "no hash" as an empty string, so null
 * becomes "" there and nowhere else.
 *
 * A graph an earlier analysis named after its temporary snapshot directory
 * (`excavator-snapshot-<kind>-<6>`) is named after the project root folder, the name
 * the analysis now gives such a project (design D4d); any other name is kept.
 *
 * The Full-mode semantic product (`semantics.mjs`: fresh entries only, a contradicted
 * summary already blanked, layers only when the semantic graph was made from the
 * graph's facts) is merged into the graph by one rule
 * (openspec: changes/retire-view-html, spec report-viewer): a node's summary is its entry's when
 * that is not empty, empty when the entry was contradicted, else the node's own; its
 * tags are the entry's when there are any, else the node's own; its `verification` is the
 * entry's verdict when it has one (the copy shows it beside the summary); the semantic layers
 * replace the graph's when there is at least one. Entries for ids the graph lacks are
 * counted, not placed. A summary whose verdict is contradicted is empty whichever source the
 * verdict came from: a graph verified without a semantic cache keeps the verdict on its nodes.
 *
 * The graph's `tour` is replaced by the steps of `tour.json` (`order`, `title`,
 * `description`, `nodeIds`) only when `tour.mjs` judged that tour to be made from the
 * same facts as the graph; otherwise the graph keeps its own `tour`.
 *
 * `staleness.json` compares the source revision each packed graph records with the revision of
 * the snapshot the pack read (the one the embedded source comes from): `fresh` when they are the
 * same, and the copy's `revision` result (design D2) when they differ or the graph records none,
 * so the page says the graph and the code shown beside it may not match. It is written only with
 * a knowledge graph; the domain graph is in it only when it is packed. It says nothing about the
 * working tree after the pack.
 *
 * A product that is not there, cannot be read or was not packed gives no key (`products.json` always
 * exists and says which of the three it is), and the
 * copy shows its own empty state for it; `rows` says why, key by key. `config.json` has no
 * product to read: it is not produced here. `diff-overlay.json` is an optional input no skill
 * writes yet: the pack reads `.excavator/diff-overlay.json` (openspec: changes/violet-theme-diff-overlay,
 * design D4) and puts only `changedNodeIds`, `affectedNodeIds`, `label` and `description` in the key,
 * with ids the graph lacks dropped and ids in both lists kept as changed only; both counts are in the row's reason.
 *
 * No `language` is written for a source: the copy's code viewer then derives it from the
 * file name, as it does for a source the server gave none for.
 *
 * Deterministic and model-free. It reads `meta.json` and `domain-graph.json` under
 * `.excavator/`, nothing else, and writes nothing; the knowledge graph is the one
 * `collectProducts` already read whole (`products.graph`).
 */

import { basename, join } from 'node:path';

import { isSnapshotDirName } from '../excavator/source-snapshot/snapshot-dir.mjs';
import { parseJsonObject, readRegularFile } from './product-files.mjs';

export const GRAPH_KEY = 'knowledge-graph.json';
export const DOMAIN_KEY = 'domain-graph.json';
export const META_KEY = 'meta.json';
export const SOURCES_KEY = 'sources';
export const STALENESS_KEY = 'staleness.json';
export const PRODUCTS_KEY = 'products.json';
export const DOC_MAP_CHECKS_KEY = 'doc-map-checks.json';

/** The product files the page shows: the entry name, the data key and the payload id `products.mjs` holds its bytes under. */
const PRODUCT_FILES = [
  { name: 'unused-code', key: 'unused-code.json' },
  { name: 'hotspots', key: 'hotspots.json' },
  { name: 'doc-map', key: 'doc-map.json' },
];

/** Keys the offline page may carry that nothing in the products produces. */
const NOT_PRODUCED = [['config.json', 'no product holds an explorer config']];

export const DIFF_OVERLAY_KEY = 'diff-overlay.json';

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

/** The graph named after the project root folder when it carries a snapshot directory's name. */
function withProjectName(graph, root) {
  if (graph.project && isSnapshotDirName(graph.project.name)) graph.project.name = basename(root);
  return graph;
}

/** The knowledge graph the products read, as one object; a body the store refused is already the product's unreadable state. */
function readGraph(root, products) {
  const entry = entryOf(products, 'knowledge-graph');
  if (!READABLE.has(entry.status)) return { row: absentRow(GRAPH_KEY, entry) };
  return { graph: withProjectName(withHashString(products.graph), root), row: { key: GRAPH_KEY, status: 'included' } };
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

/** One node's summary, tags and verdict after its semantic entry, entry first, then the node's own; no verdict when neither has one. */
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

/** Blanks, in place, the summary of every node whose verdict is contradicted, whichever source the verdict came from. */
function blankContradicted(graph) {
  for (const node of graph.nodes) if (node.verification === CONTRADICTED) node.summary = '';
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

/** A graph's freshness in the copy's shape: its recorded revision against the snapshot's. */
function freshnessOf(entry, current) {
  const revision = typeof entry.revision === 'string' && entry.revision !== '' ? entry.revision : null;
  if (revision === current) {
    return { status: 'fresh', graphCommitHash: current, headCommitHash: current, changedFileCount: 0, changedFiles: [], commitsBehind: 0, commitsAhead: 0 };
  }
  return { status: 'revision', graphRevision: revision, currentRevision: current };
}

const freshnessWords = (result) => (result.status === 'fresh' ? 'same revision' : result.graphRevision === null ? 'no revision recorded' : `made from ${result.graphRevision}`);

/** The freshness report for the graphs the page holds, with its row; no report without a knowledge graph. */
function staleness(data, products, snapshotRevision) {
  if (!data[GRAPH_KEY]) return { row: { key: STALENESS_KEY, status: 'unused', reason: 'there is no knowledge graph to compare' } };
  const graphs = { knowledge: freshnessOf(entryOf(products, 'knowledge-graph'), snapshotRevision) };
  if (data[DOMAIN_KEY]) graphs.domain = freshnessOf(entryOf(products, 'domain-graph'), snapshotRevision);
  const words = Object.entries(graphs).map(([name, result]) => `${name} graph: ${freshnessWords(result)}`);
  return { value: { graphs }, row: { key: STALENESS_KEY, status: 'included', reason: words.join('; ') } };
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

/** The product's file as written, parsed, with the row that says whether the page holds it. */
function readProductFile(products, { name, key }) {
  const entry = entryOf(products, name);
  const payload = payloadOf(products, name);
  if (!READABLE.has(entry.status) || !payload) return { row: absentRow(key, entry) };
  return { value: JSON.parse(payload.bytes.toString('utf-8')), row: { key, status: entry.status, ...(entry.reason ? { reason: entry.reason } : {}) } };
}

/** The doc map's checks file; it belongs to the doc map, so without the doc map there is nothing to hold it. */
function readDocMapChecks(products, docMapHeld) {
  if (!docMapHeld) return { row: { key: DOC_MAP_CHECKS_KEY, status: 'unused', reason: 'there is no doc map to hold it' } };
  const payload = payloadOf(products, 'doc-map-checks');
  if (!payload) return { row: { key: DOC_MAP_CHECKS_KEY, status: 'not-run', reason: 'doc-map/checks.json was not produced' } };
  return { value: JSON.parse(payload.bytes.toString('utf-8')), row: { key: DOC_MAP_CHECKS_KEY, status: 'included' } };
}

/** Each product's state in the shape the page reads, taken from the entries as judged. */
function productStates(products, snapshotRevision) {
  const states = PRODUCT_FILES.map(({ name }) => {
    const { status, reason, revision, revisionNote, command } = entryOf(products, name);
    return { name, status, reason, revision, revisionNote, command };
  });
  const words = states.map((state) => `${state.name} ${state.status}`);
  return { value: { snapshotRevision, products: states }, row: { key: PRODUCTS_KEY, status: 'included', reason: words.join('; ') } };
}

const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
const unique = (list) => [...new Set(list)];

/** The first thing wrong with an overlay's shape, named by field; null when it is fine. */
function overlayShapeProblem(overlay) {
  for (const field of ['changedNodeIds', 'affectedNodeIds']) {
    if (!isStringArray(overlay[field])) return `${DIFF_OVERLAY_KEY} ${field} is not an array of strings`;
  }
  for (const field of ['label', 'description']) {
    if (overlay[field] !== undefined && typeof overlay[field] !== 'string') return `${DIFF_OVERLAY_KEY} ${field} is not a string`;
  }
  return null;
}

/**
 * The optional diff overlay, reduced to what the page reads, with the row that says what was dropped.
 * Ids the graph lacks are dropped and an id in both lists counts as changed only; both counts are always written.
 */
function readDiffOverlay(dataDir, graph, snapshotRevision) {
  const read = readObjectFile(dataDir, DIFF_OVERLAY_KEY, DIFF_OVERLAY_KEY);
  if (!read.value) return { row: read.row };
  const problem = overlayShapeProblem(read.value);
  if (problem) return { row: { key: DIFF_OVERLAY_KEY, status: 'unreadable', reason: problem } };
  if (!graph) return { row: { key: DIFF_OVERLAY_KEY, status: 'unused', reason: 'there is no knowledge graph to hold it' } };

  const known = new Set(graph.nodes.map((node) => node.id));
  const changedInput = unique(read.value.changedNodeIds);
  const affectedInput = unique(read.value.affectedNodeIds);
  const missing = unique([...changedInput, ...affectedInput]).filter((id) => !known.has(id)).length;
  const changed = changedInput.filter((id) => known.has(id));
  const changedSet = new Set(changed);
  const both = affectedInput.filter((id) => changedSet.has(id)).length;
  const affected = affectedInput.filter((id) => known.has(id) && !changedSet.has(id));
  const counts = `${changed.length} changed, ${affected.length} affected; ${missing} ids not in the graph; ${both} in both lists`;
  if (changed.length === 0) return { row: { key: DIFF_OVERLAY_KEY, status: 'unused', reason: `no changed node is in the graph (${counts})` } };

  const value = { changedNodeIds: changed, affectedNodeIds: affected };
  if (read.value.label !== undefined) value.label = read.value.label;
  if (read.value.description !== undefined) value.description = read.value.description;
  const revision = read.value.provenance?.sourceRevision;
  if (typeof revision === 'string' && revision !== snapshotRevision) {
    return { value, row: { key: DIFF_OVERLAY_KEY, status: 'different-revision', reason: `${counts}; written for ${revision}, the snapshot is ${snapshotRevision}` } };
  }
  return { value, row: { key: DIFF_OVERLAY_KEY, status: 'included', reason: counts } };
}

/**
 * @param {{ root: string, dataDir: string, snapshotRevision: string, products: { entries: object[], payloads: {id: string, bytes: Buffer}[], graph: object|null }, sources: { manifest: object, payloads: {id: string, bytes: Buffer}[] } }} input
 *   `root` is the project root the pack was given, `snapshotRevision` the revision of the snapshot it read; `products` and `sources` are what `collectProducts` and
 *   `collectSources` returned for the same pack
 * @returns {{ data: Record<string, unknown>, rows: { key: string, status: string, reason?: string }[] }}
 */
export function buildExplorerData({ root, dataDir, snapshotRevision, products, sources }) {
  const data = {};
  const rows = [];

  const graph = readGraph(root, products);
  rows.push(graph.row);
  const tour = readTourSteps(products);
  if (graph.graph) {
    rows.push(mergeSemantics(graph.graph, products));
    blankContradicted(graph.graph);
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

  const fresh = staleness(data, products, snapshotRevision);
  rows.push(fresh.row);
  if (fresh.value) data[STALENESS_KEY] = fresh.value;

  const heldProducts = PRODUCT_FILES.map((file) => ({ file, read: readProductFile(products, file) }));
  for (const { file, read } of heldProducts) {
    rows.push(read.row);
    if (read.value) data[file.key] = read.value;
    if (file.name === 'doc-map') {
      const checks = readDocMapChecks(products, Boolean(read.value));
      rows.push(checks.row);
      if (checks.value) data[DOC_MAP_CHECKS_KEY] = checks.value;
    }
  }
  const states = productStates(products, snapshotRevision);
  rows.push(states.row);
  data[PRODUCTS_KEY] = states.value;

  const table = sources.manifest.requested ? sourceTable(sources) : null;
  rows.push(sourcesRow(sources));
  if (table !== null) data[SOURCES_KEY] = table;

  const overlay = readDiffOverlay(dataDir, data[GRAPH_KEY], snapshotRevision);
  rows.push(overlay.row);
  if (overlay.value) data[DIFF_OVERLAY_KEY] = overlay.value;

  for (const [key, reason] of NOT_PRODUCED) rows.push({ key, status: 'not-produced', reason });
  return { data, rows };
}
