#!/usr/bin/env node
/**
 * pack.mjs
 *
 * Packs a project's `.excavator/` products into one self-contained HTML page
 * (openspec: changes/report-viewer, capability `report-viewer`, design D2-D3;
 * changes/viewer-explorer, design D4; changes/retire-view-html, design D1-D4).
 *
 *   node pack.mjs <projectRoot> [--no-source] [--out <path>]
 *
 * Writes `<projectRoot>/.excavator/explorer.html` (or `--out`, under any name) through
 * a temporary file and a rename, so a failure leaves an existing page untouched, and
 * prints one JSON result on stdout:
 *   { out, bytes, snapshotRevision, products: [{ name, status, reason?, revision?, note?, counts? }],
 *     source: { embedded, requested, limitBytes, counts },
 *     issues: { total, byKind, fatal } | null, keys: { <key>: <bytes> }, rows: [{ key, status, reason? }] }
 * with `status` one of included, not-run, unreadable, different-revision, or not-shown for semantics
 * or a tour the page has no knowledge graph to hold. Each status is what the page holds: a graph
 * whose body the page refuses is unreadable even when its header passed.
 * The page is the explorer copy's template with the products in the copy's own data
 * shape (explorer-data.mjs); `issues` is what the copy's own validator reports for the
 * graph it will show, null when there is no graph. Any other page beside it, such as
 * one the retired view page left, is left as it is.
 *
 * Deterministic and model-free: the same products, the same source revision and
 * the same arguments give the same bytes. It reads the products and, through
 * the source snapshot (HEAD, never the working tree), the text of the files they
 * point at; it never builds, runs or edits the project, and writes nothing under
 * `.excavator/` except the page.
 *
 * The page is the template `packages/explorer` builds (`pnpm build`), with the policy,
 * the data and the manifest inserted. Without a built template or validator the command
 * fails and says so, and writes nothing.
 *
 * Contract: openspec/specs/report-viewer/spec.md
 */

import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDataDir, bindProjectRoot } from '../excavator/project-paths.mjs';
import { resolveSourceSnapshot } from '../excavator/source-snapshot.mjs';
import { buildExplorerData, GRAPH_KEY } from './explorer-data.mjs';
import { countIssues, loadValidateGraph, VALIDATOR_PATH } from './explorer-validate.mjs';
import { assembleExplorerPage, EXPLORER_TEMPLATE_PATH } from './page-assembly.mjs';
import { collectProducts, NO_GRAPH_REASON } from './products.mjs';
import { collectSources, summarizeSources } from './sources.mjs';

const USAGE = 'Usage: node pack.mjs <projectRoot> [--no-source] [--out <path>]\n';
const EXPLORER_MANIFEST_VERSION = 2;
export const EXPLORER_FILE = 'explorer.html';

/** A built file sits under the plugin root, two levels above this script (resolved through links). It may not exist yet: the code that reads it says so. */
function pluginPath(relative) {
  return resolve(realpathSync(dirname(fileURLToPath(import.meta.url))), '..', '..', relative);
}

function parseArgs(argv) {
  const options = { root: null, noSource: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-source') options.noSource = true;
    else if (arg === '--out') {
      options.out = argv[++i];
      if (!options.out) throw new Error(`--out needs a path\n${USAGE}`);
    } else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}\n${USAGE}`);
    else if (options.root === null) options.root = arg;
    else throw new Error(`unexpected argument ${arg}\n${USAGE}`);
  }
  if (options.root === null) throw new Error(USAGE.trimEnd());
  return options;
}

/** Write through a sibling temporary file and rename; on any failure the target is untouched and the temporary file is gone. */
function writeAtomic(path, bytes) {
  const tmpPath = `${path}.tmp-${process.pid}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmpPath, bytes);
    renameSync(tmpPath, path);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

const READABLE = new Set(['included', 'different-revision']);
/** The products the page holds only inside the knowledge graph. */
const HELD_IN_GRAPH = new Set(['semantics', 'tour']);

/**
 * Each product's entry as the page holds it. The entries judge the graph by its header (semantics and a tour with
 * no graph that passes it are already not shown); the page reads the whole body, so a body it refuses makes the
 * graph unreadable, and readable semantics or a readable tour then have no graph to go into either.
 */
function heldEntries(entries, rows) {
  const graphRow = rows.find((row) => row.key === GRAPH_KEY);
  const graphHeld = graphRow.status === 'included';
  return entries.map((entry) => {
    const { name, file } = entry;
    if (name === 'knowledge-graph' && graphRow.status === 'unreadable' && entry.status !== 'unreadable') return { name, file, status: 'unreadable', reason: graphRow.reason };
    if (!graphHeld && HELD_IN_GRAPH.has(name) && READABLE.has(entry.status)) return { name, file, status: 'not-shown', reason: NO_GRAPH_REASON };
    return entry;
  });
}

function resultProduct(entry) {
  const row = { name: entry.name, status: entry.status };
  if (entry.reason) row.reason = entry.reason;
  if (entry.revision) row.revision = entry.revision;
  if (entry.revisionNote) row.note = entry.revisionNote;
  if (entry.counts) row.counts = entry.counts;
  return row;
}

/**
 * The page's data and its manifest (what the copy is given, and what the reply says about it:
 * each product's state, the embedded source count and the issue count).
 */
function packExplorer({ root, dataDir, snapshotRevision, products, sources, templatePath, validatorPath }) {
  const validateGraph = loadValidateGraph(validatorPath);
  const { data, rows } = buildExplorerData({ root, dataDir, snapshotRevision, products, sources });
  const issues = data[GRAPH_KEY] ? countIssues(validateGraph, data[GRAPH_KEY]) : null;
  const keys = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Buffer.byteLength(JSON.stringify(value))]));
  const held = heldEntries(products.entries, rows);
  const manifest = {
    explorer: EXPLORER_MANIFEST_VERSION,
    products: held.map(({ name, status }) => ({ name, status })),
    source: { embedded: sources.manifest.embedded, counts: sources.manifest.counts },
    issues,
    keys,
    rows,
  };
  return { page: assembleExplorerPage({ templatePath, data, manifest }), held, issues, keys, rows };
}

/**
 * Pack the project and write the page.
 * @param {string} rootArg
 * @param {{ noSource?: boolean, out?: string|null, explorerTemplate?: string, explorerValidator?: string }} [options]
 *   `explorerTemplate` replaces the built template, `explorerValidator` the built validator (the tests use small ones)
 */
export function packProject(rootArg, options = {}) {
  const noSource = options.noSource === true;
  const root = bindProjectRoot(rootArg);
  const dataDir = assertDataDir(root);
  const out = options.out ? resolve(options.out) : join(dataDir, EXPLORER_FILE);

  const snapshot = resolveSourceSnapshot(root);
  const products = collectProducts(dataDir, snapshot.revision);
  const sources = collectSources({ noSource, snapshot, payloads: products.payloads });

  // The page is assembled before anything is written, so a missing template or validator writes nothing.
  const explorer = packExplorer({
    root,
    dataDir,
    snapshotRevision: snapshot.revision,
    products,
    sources,
    templatePath: options.explorerTemplate ?? pluginPath(EXPLORER_TEMPLATE_PATH),
    validatorPath: options.explorerValidator ?? pluginPath(VALIDATOR_PATH),
  });
  writeAtomic(out, explorer.page);

  return {
    out,
    bytes: explorer.page.length,
    snapshotRevision: snapshot.revision,
    products: explorer.held.map(resultProduct),
    source: summarizeSources(sources.manifest),
    issues: explorer.issues,
    keys: explorer.keys,
    rows: explorer.rows,
  };
}

function main(argv) {
  const options = parseArgs(argv);
  const result = packProject(options.root, { noSource: options.noSource, out: options.out });
  process.stdout.write(`${JSON.stringify(result)}\n`);
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
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`excavator-view pack failed: ${error.message}\n`);
    process.exit(1);
  }
}
