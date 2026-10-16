/**
 * parse-data-dir.mjs
 *
 * Reads one `.excavator/` directory into the view's bundle segments
 * (openspec change `artifact-view`, design D3-D6, task 9.1). The ONE
 * implementation of the reading rules, shared by the bake (`build-view.mjs`,
 * through a Node file-system reader) and the page's dropped-directory mode
 * (a File API reader in the data Worker). Only file access differs between
 * the two, behind the `DataDirReader` interface; this module imports no
 * `node:` module.
 *
 * Steps: the required manifest; the knowledge graph line by line, counts
 * checked against its header; then each optional artifact, where one that
 * exists but cannot be read becomes an `invalid` inventory entry with its
 * reason (never an empty section passed off as real): fingerprint line
 * counts, the source index, and the three semantic products with their
 * freshness.
 *
 * `composeView` builds `meta` and the segment object from the result plus
 * what only the caller knows (fact-layer freshness, source text and its
 * budget); `dropModeView` is that call for a dropped directory, where source
 * text is never embedded.
 */

import { BUNDLE_FORMAT, Interner, Int32Builder, isTable, table } from '../bundle-codec.mjs';
import { MissingArtifactError } from '../bake/errors.mjs';
import { OptionalArtifactError, parseArtifactJson } from './errors.mjs';
import { createGraphReader } from './graph-lines.mjs';
import { createSourceIndexReader } from './index-lines.mjs';
import { FingerprintFormatError, scanFingerprintLineCounts } from './fingerprint-scan.mjs';
import { readDomainGraph, readSemanticCache, readSemanticGraph } from './semantic.mjs';
import { memberRepositories } from './members.mjs';

/**
 * File access for one `.excavator/` directory.
 * @typedef {{
 *   path(name: string): string,
 *   lines(name: string): AsyncIterable<string>,
 *   chunks(name: string): AsyncIterable<Uint8Array>,
 *   text(name: string): Promise<string>,
 * }} DataDirReader
 * `path` names a file in messages; `lines` yields each line without its line
 * break (CR LF, LF or a lone CR, as Node's readline splits).
 */

/** Order in which source segments are dropped when over budget. */
export const TRIM_ORDER = Object.freeze(['excerpts', 'indexLiterals', 'evidenceText']);
/** Order source segments are listed in `meta.embeds`. */
export const EMBED_ORDER = Object.freeze(['evidenceText', 'excerpts', 'indexLiterals']);

/**
 * Throw for the first required artifact the inventory does not hold.
 * @param {Array<{ name: string, required: boolean, status: string }>} inventory
 * @param {string} where the directory, for the message
 */
export function requireArtifacts(inventory, where) {
  for (const required of inventory.filter((i) => i.required)) {
    if (required.status !== 'present') throw new MissingArtifactError(required.name, `not found in ${where}`);
  }
}

/**
 * The `files` table: one row per manifest entry (the selected files), with
 * `totalLines` from fingerprints when available (-1 otherwise).
 *
 * @param {Array<{ path: string, contentHash: string }>} manifestEntries
 * @param {Map<string, number> | null} lineCounts
 * @param {Interner} interner
 */
export function buildFilesTable(manifestEntries, lineCounts, interner) {
  const path = new Int32Builder(manifestEntries.length);
  const totalLines = new Int32Builder(manifestEntries.length);
  const contentHash = new Int32Builder(manifestEntries.length);
  let withoutLineCount = 0;
  for (const entry of manifestEntries) {
    path.push(interner.cell(entry.path));
    contentHash.push(interner.cell(entry.contentHash));
    const lines = lineCounts?.get(entry.path) ?? -1;
    if (lines === -1) withoutLineCount += 1;
    totalLines.push(lines);
  }
  return {
    files: table(manifestEntries.length, { path: path.finish(), totalLines: totalLines.finish(), contentHash: contentHash.finish() }),
    withoutLineCount,
  };
}

/**
 * @param {DataDirReader} reader
 * @param {{
 *   inventory: ReturnType<typeof import('./inventory-rules.mjs').inventoryOf>,
 *   includeLiterals?: boolean,
 *   makeGraphError?: (message: string) => Error,
 * }} options `inventory` is updated in place (an unreadable optional artifact becomes `invalid`)
 */
export async function parseDataDirectory(reader, { inventory, includeLiterals = true, makeGraphError }) {
  const item = (/** @type {string} */ name) => /** @type {any} */ (inventory.find((i) => i.name === name));

  let manifest;
  try {
    manifest = JSON.parse(await reader.text('source-manifest.json'));
  } catch (error) {
    throw new MissingArtifactError('source-manifest.json', `not valid JSON (${/** @type {Error} */ (error).message})`);
  }
  if (manifest === null || typeof manifest !== 'object' || !Array.isArray(manifest.entries)) {
    throw new MissingArtifactError('source-manifest.json', 'has no "entries" array');
  }

  // --- graph ---------------------------------------------------------------
  const interner = new Interner();
  const graphReader = createGraphReader(interner, {
    source: reader.path('knowledge-graph.jsonl'),
    ...(makeGraphError ? { makeError: makeGraphError } : {}),
  });
  for await (const line of reader.lines('knowledge-graph.jsonl')) graphReader.line(line);
  const graph = graphReader.finish();
  const headerFactsDigest = typeof graph.header.fields?.project?.factsDigest === 'string'
    ? graph.header.fields.project.factsDigest
    : null;

  // --- optional artifacts --------------------------------------------------
  /**
   * @template T
   * @param {string} name
   * @param {() => Promise<T> | T} read
   * @returns {Promise<T | null>}
   */
  const optional = async (name, read) => {
    if (item(name).status !== 'present') return null;
    try {
      return await read();
    } catch (error) {
      const entry = item(name);
      entry.status = 'invalid';
      entry.reason = /** @type {Error} */ (error).message;
      return null;
    }
  };
  const json = async (/** @type {string} */ name) => parseArtifactJson(await reader.text(name));

  const manifestEntries = manifest.entries.filter((/** @type {any} */ e) => e && typeof e.path === 'string');
  const lineCounts = await optional('fingerprints.json', async () => {
    try {
      return await scanFingerprintLineCounts(reader.chunks('fingerprints.json'));
    } catch (error) {
      if (error instanceof FingerprintFormatError) throw new OptionalArtifactError(error.message);
      throw error;
    }
  });
  const filesResult = buildFilesTable(manifestEntries, lineCounts, interner);

  const index = await optional('source-index.jsonl', async () => {
    const indexReader = createSourceIndexReader(interner, { includeLiterals });
    for await (const line of reader.lines('source-index.jsonl')) indexReader.line(line);
    return indexReader.finish();
  });

  const strings = interner.strings;
  /** @type {Map<string, string>} */
  const nodeFile = new Map();
  if (item('semantic-cache.json').status === 'present') {
    const { id, path } = graph.nodes.columns;
    for (let row = 0; row < graph.nodes.rows; row += 1) {
      if (id[row] >= 0 && path[row] >= 0) nodeFile.set(strings[id[row]], strings[path[row]]);
    }
  }
  const manifestHash = new Map(manifestEntries.map((/** @type {any} */ e) => [e.path, e.contentHash]));
  const sourceRevision = typeof manifest.sourceRevision === 'string' ? manifest.sourceRevision : null;
  const semantic = await optional('semantic-cache.json', async () => readSemanticCache(await json('semantic-cache.json'), nodeFile, manifestHash));
  const layers = await optional('semantic-graph.json', async () => readSemanticGraph(await json('semantic-graph.json'), headerFactsDigest));
  const domain = await optional('domain-graph.json', async () => readDomainGraph(await json('domain-graph.json'), sourceRevision, headerFactsDigest));

  return { interner, inventory, manifest, manifestEntries, sourceRevision, graph, headerFactsDigest, filesResult, index, semantic, layers, domain };
}

/** @typedef {Awaited<ReturnType<typeof parseDataDirectory>>} ParsedDataDirectory */

/**
 * `meta` and the bundle's segments, in bundle order.
 *
 * @param {ParsedDataDirectory} parsed
 * @param {{
 *   bakedAt: string,
 *   factLayer: unknown,
 *   embeds: Array<{ segment: string, status: string, reason?: string }>,
 *   dropped: Array<{ segment: string, reason: string, bytes: number }>,
 *   sourceSegments: Record<string, unknown>,
 *   embedding: unknown,
 *   budgetBytes: number | null,
 *   origin?: { mode: 'drop', directory: string, loadedAt: string },
 * }} options
 */
export function composeView(parsed, { bakedAt, factLayer, embeds, dropped, sourceSegments, embedding, budgetBytes, origin }) {
  const { graph, manifest, manifestEntries, sourceRevision, filesResult, index, semantic, layers, domain, interner } = parsed;
  const selection = manifest.selection && typeof manifest.selection === 'object' ? manifest.selection : null;
  const members = sourceRevision?.startsWith('multi-repo:') ? memberRepositories(manifestEntries, selection) : [];
  const meta = {
    format: BUNDLE_FORMAT,
    bakedAt,
    ...(origin ? { origin } : {}),
    graph: { keys: graph.header.keys, fields: graph.header.fields, counts: graph.header.counts },
    counts: graph.counts,
    inventory: parsed.inventory,
    embeds,
    dropped,
    freshness: {
      factLayer,
      semanticCache: semantic?.summary ?? null,
      semanticGraph: layers?.summary ?? null,
      domainGraph: domain?.summary ?? null,
    },
    source: {
      sourceRevision,
      selectionDigest: manifest.selectionDigest ?? null,
      pipelineVersion: manifest.pipelineVersion ?? null,
      manifestEntries: manifestEntries.length,
      filesWithoutLineCount: filesResult.withoutLineCount,
      embedding,
      budgetBytes,
    },
    selection: selection ? {
      ...Object.fromEntries(Object.entries(selection).filter(([key]) => key !== 'entries')),
      entries: Array.isArray(selection.entries) ? selection.entries.filter((/** @type {any} */ e) => e?.kind !== 'selected') : [],
    } : null,
    members,
    index: index?.meta ?? null,
    unembedded: graph.unembedded,
    anomalies: graph.anomalies,
  };

  /** @type {Record<string, unknown>} */
  const segments = {
    meta,
    strings: interner.strings,
    values: interner.values(),
    nodes: graph.nodes,
    nodeTags: graph.nodeTags,
    edges: graph.edges,
    evidence: graph.evidence,
    coverage: graph.coverage,
    gaps: graph.gaps,
    ...(graph.layers.length > 0 ? { graphLayers: graph.layers } : {}),
    ...(graph.tour.length > 0 ? { tour: graph.tour } : {}),
    files: filesResult.files,
    ...(index ? index.segments : {}),
    ...(semantic ? { semantic: semantic.segment } : {}),
    ...(layers ? { layers: layers.segment } : {}),
    ...(domain ? { domain: domain.segment } : {}),
    ...sourceSegments,
  };
  return { meta, segments };
}

/** Why fact-layer freshness is not checked for a dropped directory. */
export const DROP_MODE_FRESHNESS_REASON = 'This page was loaded from a dropped .excavator directory: the project source is not available '
  + 'to the browser, so whether the facts still match it was not checked.';

/**
 * The segments for a dropped directory, isomorphic to a decoded bundle:
 * source text (evidence lines, excerpts) is never embedded (reason
 * `drop-mode`; the browser has no access to the project's source), the
 * source index's literal text is embedded from the index itself, and the
 * fact layer's freshness is `not-checked`. JSON segments go through one JSON
 * round trip so they hold exactly what a decoded bundle would.
 *
 * @param {ParsedDataDirectory} parsed
 * @param {{ directory: string, loadedAt: string }} options
 */
export function dropModeView(parsed, { directory, loadedAt }) {
  const sourceNames = parsed.index ? EMBED_ORDER : EMBED_ORDER.filter((s) => s !== 'indexLiterals');
  const dropped = sourceNames.filter((s) => s !== 'indexLiterals').map((segment) => ({ segment, reason: 'drop-mode', bytes: 0 }));
  const embeds = sourceNames.map((segment) => (segment === 'indexLiterals'
    ? { segment, status: 'embedded' }
    : { segment, status: 'dropped', reason: 'drop-mode' }));
  const { segments } = composeView(parsed, {
    bakedAt: loadedAt,
    factLayer: {
      status: 'not-checked',
      manifestSourceRevision: parsed.sourceRevision,
      currentSourceRevision: null,
      reason: DROP_MODE_FRESHNESS_REASON,
    },
    embeds,
    dropped,
    sourceSegments: parsed.index?.literals?.segments ?? {},
    embedding: null,
    budgetBytes: null,
    origin: { mode: 'drop', directory, loadedAt },
  });
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [name, value] of Object.entries(segments)) {
    out[name] = isTable(value) ? value : JSON.parse(JSON.stringify(value));
  }
  return out;
}
