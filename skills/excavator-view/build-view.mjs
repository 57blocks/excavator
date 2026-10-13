#!/usr/bin/env node
/**
 * build-view.mjs
 *
 * The deterministic view bake (openspec change `artifact-view`, design D3-D6):
 * reads the artifacts present in `<projectRoot>/.excavator/`, encodes them as
 * an `excavator-view-bundle/1` payload, injects it into the prebuilt page
 * template, checks the result, and writes ONE self-contained HTML file
 * atomically. Zero model calls; never builds or runs the target; writes
 * nothing but the output file.
 *
 * Pipeline:
 *   inventory (required: knowledge-graph.jsonl, source-manifest.json)
 *   -> template load and vetting (fails before any heavy work)
 *   -> graph streamed line by line into interned Int32 columns, counts
 *      checked against the header
 *   -> fact-layer freshness via the shared consumer-freshness helper
 *      (stale still bakes)
 *   -> optional artifacts with per-item freshness
 *   -> source text through SourceSnapshot (unless --no-source)
 *   -> source budget: drop `excerpts`, then `evidenceText`, whole segments
 *   -> encode, hard size limit, decode self-check, page checks
 *   -> temp file + rename; one JSON report line on stdout
 *
 * Usage:
 *   node build-view.mjs <projectRoot> [--out <path>] [--no-source] [--raw]
 *     [--source-budget <MB>] [--template <path>]
 *
 * Opening the file is the skill's job (and its --no-open flag); this script
 * never launches anything.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUNDLE_FORMAT, Interner, decodeBundle, encodeBundle, isTable } from './bundle-codec.mjs';
import { takeInventory } from './bake/inventory.mjs';
import { streamKnowledgeGraph } from './bake/graph-stream.mjs';
import {
  buildFilesTable, readDomainGraph, readSemanticCache, readSemanticGraph, streamSourceIndex,
} from './bake/optional-artifacts.mjs';
import { collectSourceText } from './bake/source-text.mjs';
import { loadTemplate, writePageAtomic } from './bake/html-output.mjs';
import { MissingArtifactError, ViewBakeError, ViewSelfCheckError, ViewTooLargeError } from './bake/errors.mjs';
import { resolveFreshness } from '../excavator/consumer-freshness.mjs';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const DATA_DIR_NAME = '.excavator';
export const DEFAULT_OUTPUT_NAME = 'view.html';
export const DEFAULT_TEMPLATE = join(pluginRoot, 'packages/view/dist/index.html');
const MB = 1024 * 1024;
export const DEFAULT_SOURCE_BUDGET_BYTES = 64 * MB;
export const DEFAULT_HARD_LIMIT_BYTES = 256 * MB;

/** Order in which source segments are dropped when over budget. */
const TRIM_ORDER = Object.freeze(['excerpts', 'evidenceText']);

/**
 * @param {{
 *   projectRoot: string,
 *   out?: string,
 *   noSource?: boolean,
 *   raw?: boolean,
 *   sourceBudgetBytes?: number,
 *   hardLimitBytes?: number,
 *   templatePath?: string,
 *   now?: () => string,
 * }} options
 */
export async function buildView(options) {
  const projectRoot = resolve(options.projectRoot);
  const dataDir = join(projectRoot, DATA_DIR_NAME);
  const outPath = resolve(options.out ?? join(dataDir, DEFAULT_OUTPUT_NAME));
  const sourceBudgetBytes = options.sourceBudgetBytes ?? DEFAULT_SOURCE_BUDGET_BYTES;
  const hardLimitBytes = options.hardLimitBytes ?? DEFAULT_HARD_LIMIT_BYTES;
  const now = options.now ?? (() => new Date().toISOString());

  // --- inventory -----------------------------------------------------------
  const inventory = takeInventory(dataDir);
  const item = (/** @type {string} */ name) => /** @type {any} */ (inventory.find((i) => i.name === name));
  for (const required of inventory.filter((i) => i.required)) {
    if (required.status !== 'present') throw new MissingArtifactError(required.name, `not found in ${dataDir}`);
  }
  const template = loadTemplate(options.templatePath ?? DEFAULT_TEMPLATE);

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dataDir, 'source-manifest.json'), 'utf-8'));
  } catch (error) {
    throw new MissingArtifactError('source-manifest.json', `not valid JSON (${/** @type {Error} */ (error).message})`);
  }
  if (manifest === null || typeof manifest !== 'object' || !Array.isArray(manifest.entries)) {
    throw new MissingArtifactError('source-manifest.json', 'has no "entries" array');
  }

  // --- graph ---------------------------------------------------------------
  const interner = new Interner();
  const graph = await streamKnowledgeGraph(join(dataDir, 'knowledge-graph.jsonl'), interner);
  const headerFactsDigest = typeof graph.header.fields?.project?.factsDigest === 'string'
    ? graph.header.fields.project.factsDigest
    : null;

  // --- fact-layer freshness (never throws; stale still bakes) --------------
  const freshness = await resolveFreshness(projectRoot);

  // --- optional artifacts --------------------------------------------------
  /** @type {Record<string, unknown>} */
  const optionalSegments = {};
  const markInvalid = (/** @type {string} */ name, /** @type {unknown} */ error) => {
    const entry = item(name);
    entry.status = 'invalid';
    entry.reason = /** @type {Error} */ (error).message;
  };
  const optional = async (/** @type {string} */ name, /** @type {() => unknown} */ read) => {
    if (item(name).status !== 'present') return null;
    try {
      return await read();
    } catch (error) {
      markInvalid(name, error);
      return null;
    }
  };

  const manifestEntries = manifest.entries.filter((/** @type {any} */ e) => e && typeof e.path === 'string');
  let filesResult = await optional('fingerprints.json', () => buildFilesTable(manifestEntries, join(dataDir, 'fingerprints.json'), interner));
  if (!filesResult) filesResult = buildFilesTable(manifestEntries, null, interner);

  const index = await optional('source-index.jsonl', () => streamSourceIndex(
    join(dataDir, 'source-index.jsonl'), interner, { includeLiterals: !options.noSource },
  ));
  if (index) Object.assign(optionalSegments, index.segments);

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
  const semantic = await optional('semantic-cache.json', () => readSemanticCache(join(dataDir, 'semantic-cache.json'), nodeFile, manifestHash));
  if (semantic) optionalSegments.semantic = semantic.segment;
  const layers = await optional('semantic-graph.json', () => readSemanticGraph(join(dataDir, 'semantic-graph.json'), headerFactsDigest));
  if (layers) optionalSegments.layers = layers.segment;
  const domain = await optional('domain-graph.json', () => readDomainGraph(
    join(dataDir, 'domain-graph.json'),
    typeof manifest.sourceRevision === 'string' ? manifest.sourceRevision : null,
    headerFactsDigest,
  ));
  if (domain) optionalSegments.domain = domain.segment;

  // --- source text and budget ----------------------------------------------
  /** @type {Array<{ segment: string, reason: 'no-source'|'budget', bytes: number }>} */
  const dropped = [];
  /** @type {Record<string, unknown>} */
  let sourceSegments = {};
  let sourceStats = null;
  if (options.noSource) {
    for (const segment of TRIM_ORDER) dropped.push({ segment, reason: 'no-source', bytes: 0 });
  } else {
    const text = collectSourceText({ projectRoot, manifest, strings, nodes: graph.nodes, evidence: graph.evidence });
    sourceStats = text.stats;
    const parts = { evidenceText: text.evidenceText, excerpts: text.excerpts };
    let total = parts.evidenceText.bytes + parts.excerpts.bytes;
    const kept = new Set(TRIM_ORDER);
    for (const segment of TRIM_ORDER) {
      if (total <= sourceBudgetBytes) break;
      kept.delete(segment);
      total -= parts[segment].bytes;
      dropped.push({ segment, reason: 'budget', bytes: parts[segment].bytes });
    }
    for (const segment of ['evidenceText', 'excerpts']) {
      if (kept.has(segment)) Object.assign(sourceSegments, parts[/** @type {'evidenceText'|'excerpts'} */ (segment)].segments);
    }
  }

  // --- meta and segments ---------------------------------------------------
  const sourceRevision = typeof manifest.sourceRevision === 'string' ? manifest.sourceRevision : null;
  const selection = manifest.selection && typeof manifest.selection === 'object' ? manifest.selection : null;
  const members = sourceRevision?.startsWith('multi-repo:') ? memberRepositories(manifestEntries) : [];
  const embeds = ['evidenceText', 'excerpts'].map((segment) => {
    const drop = dropped.find((d) => d.segment === segment);
    return drop ? { segment, status: 'dropped', reason: drop.reason } : { segment, status: 'embedded' };
  });
  const meta = {
    format: BUNDLE_FORMAT,
    bakedAt: now(),
    graph: { keys: graph.header.keys, fields: graph.header.fields, counts: graph.header.counts },
    counts: graph.counts,
    inventory,
    embeds,
    dropped,
    freshness: {
      factLayer: freshness,
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
      embedding: options.noSource ? null : sourceStats,
      budgetBytes: sourceBudgetBytes,
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
    strings,
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
    ...optionalSegments,
    ...sourceSegments,
  };

  // --- encode, hard limit, self-check, write --------------------------------
  const encoded = await encodeBundle(segments, { compress: !options.raw });
  if (encoded.totalChars > hardLimitBytes) {
    throw new ViewTooLargeError({ product: 'view.html', requiredBytes: encoded.totalChars, limitBytes: hardLimitBytes });
  }
  const decodedCounts = await selfCheck(encoded.lines, graph);
  const bytes = writePageAtomic(outPath, template, encoded.lines);

  return {
    path: outPath,
    bytes,
    compressed: !options.raw,
    inventory: inventory.map(({ name, required, status, bytes: size, missing, ...rest }) => ({
      name, required, status, bytes: size, ...(status === 'missing' ? { missing } : {}), ...rest,
    })),
    embeds,
    dropped,
    freshness: meta.freshness,
    counts: { header: graph.header.counts, streamed: graph.counts, decoded: decodedCounts },
    source: meta.source,
    segments: encoded.segments.map(({ name, rawBytes, storedBytes }) => ({ name, rawBytes, storedBytes })),
  };
}

/**
 * Members of a multi-repo target: the first path segment of every selected
 * file, with file counts.
 * @param {Array<{ path: string }>} entries
 */
function memberRepositories(entries) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const { path } of entries) {
    const first = path.split('/')[0];
    if (path.includes('/')) counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, files]) => ({ name, files }));
}

/**
 * Decode the encoded payload with the page's decoder and compare counts.
 * @param {string[]} lines
 * @param {{ header: { counts: Record<string, number> }, counts: { evidence: number } }} graph
 */
export async function selfCheck(lines, graph) {
  let decoded;
  try {
    decoded = (await decodeBundle(lines)).segments;
  } catch (error) {
    throw new ViewSelfCheckError([`the bundle does not decode: ${/** @type {Error} */ (error).message}`]);
  }
  const rows = (/** @type {string} */ name) => (isTable(decoded[name]) ? /** @type {any} */ (decoded[name]).rows : -1);
  const counts = {
    nodes: rows('nodes'),
    edges: rows('edges'),
    evidence: rows('evidence'),
    gaps: Array.isArray(decoded.gaps) ? decoded.gaps.length : -1,
  };
  const header = graph.header.counts;
  const problems = [];
  for (const key of ['nodes', 'edges', 'gaps']) {
    const expected = Number.isInteger(header[key]) ? header[key] : 0;
    if (counts[/** @type {'nodes'|'edges'|'gaps'} */ (key)] !== expected) {
      problems.push(`decoded ${key} ${counts[/** @type {'nodes'|'edges'|'gaps'} */ (key)]} != header ${expected}`);
    }
  }
  if (counts.evidence !== graph.counts.evidence) problems.push(`decoded evidence ${counts.evidence} != streamed ${graph.counts.evidence}`);
  if (problems.length > 0) throw new ViewSelfCheckError(problems);
  return counts;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = 'Usage: node build-view.mjs <projectRoot> [--out <path>] [--no-source] [--raw] '
  + '[--source-budget <MB>] [--template <path>]';

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {Parameters<typeof buildView>[0]} */
  const options = { projectRoot: '' };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new ViewBakeError(`${arg} needs a value. ${USAGE}`);
      i += 1;
      return next;
    };
    if (arg === '--out') options.out = value();
    else if (arg === '--template') options.templatePath = value();
    else if (arg === '--no-source') options.noSource = true;
    else if (arg === '--raw') options.raw = true;
    else if (arg === '--source-budget') {
      const mb = Number(value());
      if (!Number.isFinite(mb) || mb < 0) throw new ViewBakeError(`--source-budget must be a non-negative number of MB. ${USAGE}`);
      options.sourceBudgetBytes = Math.floor(mb * MB);
    } else if (arg.startsWith('--')) throw new ViewBakeError(`unknown option ${arg}. ${USAGE}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) throw new ViewBakeError(USAGE);
  options.projectRoot = positional[0];
  if (!existsSync(options.projectRoot)) throw new ViewBakeError(`project root ${options.projectRoot} does not exist`);
  return options;
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
    const report = await buildView(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    const err = /** @type {Error} */ (error);
    process.stderr.write(`build-view.mjs failed: ${err.name}: ${err.message}\n`);
    process.exit(1);
  }
}
