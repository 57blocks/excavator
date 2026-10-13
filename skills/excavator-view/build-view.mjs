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
 *   -> source budget: drop `excerpts`, then `indexLiterals`, then
 *      `evidenceText`, whole segments
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

import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeSegments, encodeBundle, isTable } from './bundle-codec.mjs';
import { takeInventory } from './bake/inventory.mjs';
import { nodeDataDirReader } from './bake/node-reader.mjs';
import {
  EMBED_ORDER, TRIM_ORDER, composeView, parseDataDirectory, requireArtifacts,
} from './shared/parse-data-dir.mjs';
import { KnowledgeGraphFormatError } from '../excavator/knowledge-graph-store.mjs';
import { collectSourceText } from './bake/source-text.mjs';
import { loadTemplate, writePageAtomic } from './bake/html-output.mjs';
import { ViewBakeError, ViewSelfCheckError, ViewTooLargeError } from './bake/errors.mjs';
import { resolveFreshness } from '../excavator/consumer-freshness.mjs';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const DATA_DIR_NAME = '.excavator';
export const DEFAULT_OUTPUT_NAME = 'view.html';
export const DEFAULT_TEMPLATE = join(pluginRoot, 'packages/view/dist/index.html');
const MB = 1024 * 1024;
export const DEFAULT_SOURCE_BUDGET_BYTES = 64 * MB;
export const DEFAULT_HARD_LIMIT_BYTES = 256 * MB;

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

  // --- inventory, then the template (fails before any heavy work) ---------
  const inventory = takeInventory(dataDir);
  requireArtifacts(inventory, dataDir);
  const template = loadTemplate(options.templatePath ?? DEFAULT_TEMPLATE);

  // --- the directory, read by the rules shared with the page's drop mode ---
  const parsed = await parseDataDirectory(nodeDataDirReader(dataDir), {
    inventory,
    includeLiterals: !options.noSource,
    makeGraphError: (message) => new KnowledgeGraphFormatError(message),
  });
  const { manifest, graph, index } = parsed;
  const strings = parsed.interner.strings;

  // --- fact-layer freshness (never throws; stale still bakes) --------------
  const freshness = await resolveFreshness(projectRoot);
  // `indexLiterals` is a source segment only when a source index was read.
  const sourceSegmentNames = new Set(index ? TRIM_ORDER : TRIM_ORDER.filter((s) => s !== 'indexLiterals'));

  // --- source text and budget ----------------------------------------------
  /** @type {Array<{ segment: string, reason: 'no-source'|'budget', bytes: number }>} */
  const dropped = [];
  /** @type {Record<string, unknown>} */
  const sourceSegments = {};
  let sourceStats = null;
  if (options.noSource) {
    for (const segment of TRIM_ORDER) {
      if (sourceSegmentNames.has(segment)) dropped.push({ segment, reason: 'no-source', bytes: 0 });
    }
  } else {
    const text = collectSourceText({ projectRoot, manifest, strings, nodes: graph.nodes, evidence: graph.evidence });
    sourceStats = text.stats;
    /** @type {Record<string, { bytes: number, segments: Record<string, unknown> }>} */
    const parts = { evidenceText: text.evidenceText, excerpts: text.excerpts };
    if (index?.literals) parts.indexLiterals = index.literals;
    const order = TRIM_ORDER.filter((segment) => Object.hasOwn(parts, segment));
    let total = order.reduce((sum, segment) => sum + parts[segment].bytes, 0);
    const kept = new Set(order);
    for (const segment of order) {
      if (total <= sourceBudgetBytes) break;
      kept.delete(segment);
      total -= parts[segment].bytes;
      dropped.push({ segment, reason: 'budget', bytes: parts[segment].bytes });
    }
    for (const segment of EMBED_ORDER) {
      if (kept.has(segment)) Object.assign(sourceSegments, parts[segment].segments);
    }
  }
  if (index && dropped.some((d) => d.segment === 'indexLiterals')) {
    index.dropLiterals();
    index.meta.literals = options.noSource ? 'omitted' : 'trimmed';
  }

  // --- meta and segments ---------------------------------------------------
  const embeds = EMBED_ORDER.filter((segment) => sourceSegmentNames.has(segment)).map((segment) => {
    const drop = dropped.find((d) => d.segment === segment);
    return drop ? { segment, status: 'dropped', reason: drop.reason } : { segment, status: 'embedded' };
  });
  const { meta, segments } = composeView(parsed, {
    bakedAt: now(),
    factLayer: freshness,
    embeds,
    dropped,
    sourceSegments,
    embedding: options.noSource ? null : sourceStats,
    budgetBytes: sourceBudgetBytes,
  });

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
 * Decode the encoded payload with the page's decoder and compare counts.
 * Segments are decoded one at a time and only their counts are kept, so the
 * check never holds a second copy of the bundle.
 * @param {string[]} lines
 * @param {{ header: { counts: Record<string, number> }, counts: { evidence: number } }} graph
 */
export async function selfCheck(lines, graph) {
  const counts = { nodes: -1, edges: -1, evidence: -1, gaps: -1 };
  try {
    for await (const { name, value } of decodeSegments(lines)) {
      if (name === 'nodes' || name === 'edges' || name === 'evidence') counts[name] = isTable(value) ? /** @type {any} */ (value).rows : -1;
      else if (name === 'gaps') counts.gaps = Array.isArray(value) ? value.length : -1;
    }
  } catch (error) {
    throw new ViewSelfCheckError([`the bundle does not decode: ${/** @type {Error} */ (error).message}`]);
  }
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
