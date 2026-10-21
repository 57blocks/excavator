#!/usr/bin/env node
/**
 * pack.mjs
 *
 * Packs a project's `.excavator/` products into one self-contained HTML page
 * (openspec: changes/report-viewer, capability `report-viewer`, design D2-D3).
 *
 *   node pack.mjs <projectRoot> [--no-source] [--out <path>]
 *
 * Writes `<projectRoot>/.excavator/view.html` (or `--out`) through a temporary
 * file and a rename, so a failure leaves an existing page untouched, and prints
 * one JSON result on stdout:
 *   { out, bytes, snapshotRevision, products: [{ name, status, reason?, revision?, note?, counts? }],
 *     source: { embedded, requested, limitBytes, counts } }
 * with `status` one of included, not-run, unreadable, different-revision.
 *
 * Deterministic and model-free: the same products, the same source revision and
 * the same arguments give the same bytes. It reads the products and, through
 * the source snapshot (HEAD, never the working tree), the text of the files they
 * point at; it never builds, runs or edits the project, and writes nothing under
 * `.excavator/` except the page.
 *
 * The page is the template `packages/report-view` builds (`pnpm build`) with the
 * policy, the manifest and the data inserted; without a built template the command
 * fails and says so, and writes nothing.
 *
 * Contract: openspec/specs/report-viewer/spec.md
 */

import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDataDir, bindProjectRoot } from '../excavator/project-paths.mjs';
import { resolveSourceSnapshot } from '../excavator/source-snapshot.mjs';
import { assemblePage, TEMPLATE_PATH } from './page-assembly.mjs';
import { collectProducts } from './products.mjs';
import { collectSources, summarizeSources } from './sources.mjs';

const USAGE = 'Usage: node pack.mjs <projectRoot> [--no-source] [--out <path>]\n';
const MANIFEST_VERSION = 1;

/** The built view template sits under the plugin root, two levels above this script (resolved through links). It may not exist yet: assemblePage says so. */
function defaultTemplatePath() {
  return resolve(realpathSync(dirname(fileURLToPath(import.meta.url))), '..', '..', TEMPLATE_PATH);
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

/**
 * Pack the project and write the page.
 * @param {string} rootArg
 * @param {{ noSource?: boolean, out?: string|null, template?: string }} [options] `template` replaces the built view template (the tests use a small one)
 */
export function packProject(rootArg, options = {}) {
  const noSource = options.noSource === true;
  const root = bindProjectRoot(rootArg);
  const dataDir = assertDataDir(root);
  const out = options.out ? resolve(options.out) : join(dataDir, 'view.html');

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
    templatePath: options.template ?? defaultTemplatePath(),
    manifest,
    payloads: [...products.payloads, ...sources.payloads],
  });
  writeAtomic(out, page);

  return {
    out,
    bytes: page.length,
    snapshotRevision: snapshot.revision,
    products: products.entries.map(resultProduct),
    source: summarizeSources(sources.manifest),
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
