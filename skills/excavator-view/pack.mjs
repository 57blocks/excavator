#!/usr/bin/env node
/**
 * pack.mjs
 *
 * Packs a project's `.excavator/` products into self-contained HTML pages
 * (openspec: changes/report-viewer, capability `report-viewer`, design D2-D3;
 * changes/viewer-explorer, design D4).
 *
 *   node pack.mjs <projectRoot> [--no-source] [--out <path>]
 *
 * Writes `<projectRoot>/.excavator/view.html` (or `--out`, which must not itself be
 * named `explorer.html`) and, beside it, `explorer.html`, each through a temporary file and a rename, so a failure
 * leaves an existing page untouched, and prints one JSON result on stdout:
 *   { out, bytes, snapshotRevision, products: [{ name, status, reason?, revision?, note?, counts? }],
 *     source: { embedded, requested, limitBytes, counts },
 *     explorer: { out, bytes, issues: { total, byKind, fatal } | null, keys: { <key>: <bytes> }, rows: [{ key, status, reason? }] } }
 * with `status` one of included, not-run, unreadable, different-revision.
 * `explorer.html` is the explorer copy's template with the same products in the
 * copy's own data shape (explorer-data.mjs); `issues` is what the copy's own
 * validator reports for the graph it will show, null when there is no graph.
 *
 * Deterministic and model-free: the same products, the same source revision and
 * the same arguments give the same bytes. It reads the products and, through
 * the source snapshot (HEAD, never the working tree), the text of the files they
 * point at; it never builds, runs or edits the project, and writes nothing under
 * `.excavator/` except the page.
 *
 * The view page is the template `packages/report-view` builds (`pnpm build`) with the
 * policy, the manifest and the data inserted; the explorer page is the template
 * `packages/explorer` builds, with the policy and the data inserted. Without a built
 * template or validator the command fails and says so, and writes nothing.
 *
 * Contract: openspec/specs/report-viewer/spec.md
 */

import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDataDir, bindProjectRoot } from '../excavator/project-paths.mjs';
import { resolveSourceSnapshot } from '../excavator/source-snapshot.mjs';
import { buildExplorerData, GRAPH_KEY } from './explorer-data.mjs';
import { countIssues, loadValidateGraph, VALIDATOR_PATH } from './explorer-validate.mjs';
import { assembleExplorerPage, assemblePage, EXPLORER_TEMPLATE_PATH, TEMPLATE_PATH } from './page-assembly.mjs';
import { collectProducts } from './products.mjs';
import { collectSources, summarizeSources } from './sources.mjs';

const USAGE = 'Usage: node pack.mjs <projectRoot> [--no-source] [--out <path>]\n';
const MANIFEST_VERSION = 1;
const EXPLORER_MANIFEST_VERSION = 1;
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

function resultProduct(entry) {
  const row = { name: entry.name, status: entry.status };
  if (entry.reason) row.reason = entry.reason;
  if (entry.revision) row.revision = entry.revision;
  if (entry.revisionNote) row.note = entry.revisionNote;
  if (entry.counts) row.counts = entry.counts;
  return row;
}

/** The explorer page's data and its manifest (what the copy is given, and what the reply says about it). */
function packExplorer({ root, dataDir, snapshotRevision, products, sources, templatePath, validatorPath }) {
  const validateGraph = loadValidateGraph(validatorPath);
  const { data, rows } = buildExplorerData({ root, dataDir, snapshotRevision, products, sources });
  const issues = data[GRAPH_KEY] ? countIssues(validateGraph, data[GRAPH_KEY]) : null;
  const keys = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Buffer.byteLength(JSON.stringify(value))]));
  const manifest = { explorer: EXPLORER_MANIFEST_VERSION, issues, keys, rows };
  return { page: assembleExplorerPage({ templatePath, data, manifest }), issues, keys, rows };
}

/**
 * Pack the project and write the pages.
 * @param {string} rootArg
 * @param {{ noSource?: boolean, out?: string|null, template?: string, explorerTemplate?: string, explorerValidator?: string }} [options]
 *   `template` and `explorerTemplate` replace the built templates, `explorerValidator` the built validator (the tests use small ones)
 */
export function packProject(rootArg, options = {}) {
  const noSource = options.noSource === true;
  const root = bindProjectRoot(rootArg);
  const dataDir = assertDataDir(root);
  const out = options.out ? resolve(options.out) : join(dataDir, 'view.html');
  const explorerOut = join(dirname(out), EXPLORER_FILE);
  if (out === explorerOut) {
    throw new Error(`--out ${out} is where the explorer page is written beside it; name the view page something else`);
  }

  const snapshot = resolveSourceSnapshot(root);
  const products = collectProducts(dataDir, snapshot.revision);
  const sources = collectSources({ noSource, snapshot, payloads: products.payloads });

  const manifest = {
    viewer: MANIFEST_VERSION,
    project: { name: basename(root) },
    snapshot: { revision: snapshot.revision, kind: snapshot.kind },
    products: products.entries,
    source: sources.manifest,
  };
  const page = assemblePage({
    templatePath: options.template ?? pluginPath(TEMPLATE_PATH),
    manifest,
    payloads: [...products.payloads, ...sources.payloads],
  });
  // Both pages are assembled before either is written, so a missing template or validator writes nothing.
  const explorer = packExplorer({
    root,
    dataDir,
    snapshotRevision: snapshot.revision,
    products,
    sources,
    templatePath: options.explorerTemplate ?? pluginPath(EXPLORER_TEMPLATE_PATH),
    validatorPath: options.explorerValidator ?? pluginPath(VALIDATOR_PATH),
  });
  writeAtomic(out, page);
  writeAtomic(explorerOut, explorer.page);

  return {
    out,
    bytes: page.length,
    snapshotRevision: snapshot.revision,
    products: products.entries.map(resultProduct),
    source: summarizeSources(sources.manifest),
    explorer: { out: explorerOut, bytes: explorer.page.length, issues: explorer.issues, keys: explorer.keys, rows: explorer.rows },
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
