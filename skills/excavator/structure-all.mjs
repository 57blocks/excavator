#!/usr/bin/env node
/**
 * structure-all.mjs
 *
 * Deterministic full-project structural extraction (analysis phase 1.2).
 *
 * The model is still the author of the knowledge graph. This script exists so
 * that the SAME structural facts the model is given can also be used, after
 * the merge, to audit what the model wrote: which declarations exist, at which
 * lines, which imports/exports/call sites the readers actually found.
 *
 * It does NOT re-implement extraction. It calls the existing
 * `extract-structure.mjs` — unchanged, in chunks — and concatenates the
 * per-file result rows into one file. Every scanned file gets a row, including
 * the files no reader supports (`status: "no-extractor"`), because the
 * coverage ledger's conservation identity is only checkable if nothing is
 * missing from the ledger.
 *
 * Usage:
 *   node structure-all.mjs <projectRoot>
 *     [--scan <scan-result.json>] [--out <structure-all.json>]
 *     [--chunk-size <n>]
 *
 * Output JSON (`intermediate/structure-all.json`):
 *   {
 *     scriptCompleted: true,
 *     chunkSize: N,
 *     filesRequested: N,
 *     filesAnalyzed: N,
 *     filesSkipped: [<path>, ...],
 *     analysisOutcomes: { structure: {...}, callGraph: {...} },
 *     byStatus: { parsed, zero-symbol, no-extractor, parse-failed },
 *     results: [ <one row per scanned file, sorted by path> ]
 *   }
 *
 * Determinism: files are processed in a locale-independent path order, chunk
 * boundaries are a pure function of that order, and the output carries no
 * timestamps. Two runs on the same scan result produce byte-identical output.
 *
 * Logging: stderr only.
 */

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

// ---------------------------------------------------------------------------
// Resolve @excavator/core (same two-step resolution as the sibling scripts;
// pathToFileURL is required on Windows for dynamic import of absolute paths).
// ---------------------------------------------------------------------------
let core;
try {
  core = await import(pathToFileURL(require.resolve('@excavator/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}
const { resolveDataDir } = core;

const EXTRACT_STRUCTURE = join(__dirname, 'extract-structure.mjs');

/** Files handed to one `extract-structure.mjs` invocation. */
export const DEFAULT_CHUNK_SIZE = 400;

/** Locale-independent order (UTF-16 code units), as used by the scanner. */
function compareStableStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Split an ordered array into fixed-size chunks. */
export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Merge one `extract-structure.mjs` output into the accumulator. Counters are
 * summed; rows are concatenated. Unknown counter keys are summed too, so a
 * future outcome bucket is carried rather than dropped.
 */
export function mergeChunkOutput(accumulator, output) {
  if (!output || typeof output !== 'object') {
    throw new Error('structure-all: chunk output is not an object');
  }
  if (!Array.isArray(output.results)) {
    throw new Error('structure-all: chunk output has no results array');
  }
  accumulator.results.push(...output.results);
  for (const path of output.filesSkipped ?? []) accumulator.filesSkipped.push(path);
  for (const [group, counters] of Object.entries(output.analysisOutcomes ?? {})) {
    if (!accumulator.analysisOutcomes[group]) accumulator.analysisOutcomes[group] = {};
    for (const [key, value] of Object.entries(counters ?? {})) {
      accumulator.analysisOutcomes[group][key] =
        (accumulator.analysisOutcomes[group][key] ?? 0) + value;
    }
  }
  for (const [status, count] of Object.entries(output.byStatus ?? {})) {
    accumulator.byStatus[status] = (accumulator.byStatus[status] ?? 0) + count;
  }
  return accumulator;
}

/** Sort an object's own keys so the emitted JSON is byte-stable. */
function sortKeys(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort(compareStableStrings)) out[key] = obj[key];
  return out;
}

function parseArgs(argv) {
  const args = { projectRoot: null, scan: null, out: null, chunkSize: DEFAULT_CHUNK_SIZE };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--scan' || arg === '--out' || arg === '--chunk-size') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`structure-all: ${arg} requires a value`);
      }
      if (arg === '--scan') args.scan = value;
      else if (arg === '--out') args.out = value;
      else {
        const size = Number.parseInt(value, 10);
        if (!Number.isInteger(size) || size < 1) {
          throw new Error(`structure-all: --chunk-size must be a positive integer, got ${value}`);
        }
        args.chunkSize = size;
      }
      i++;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`structure-all: unknown option: ${arg}`);
    if (!args.projectRoot) {
      args.projectRoot = arg;
      continue;
    }
    throw new Error(`structure-all: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot) {
    throw new Error('Usage: node structure-all.mjs <projectRoot> [--scan <path>] [--out <path>] [--chunk-size <n>]');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const dataDir = resolveDataDir(projectRoot);
  const scanPath = args.scan ? resolve(args.scan) : join(dataDir, 'intermediate', 'scan-result.json');
  const outputPath = args.out ? resolve(args.out) : join(dataDir, 'intermediate', 'structure-all.json');

  if (!existsSync(scanPath)) {
    throw new Error(`structure-all: scan result not found: ${scanPath}`);
  }
  const scan = JSON.parse(readFileSync(scanPath, 'utf-8'));
  if (!Array.isArray(scan.files)) {
    throw new Error(`structure-all: ${scanPath} has no files array`);
  }

  // EVERY scanned file, not only `fileCategory: "code"`. A file whose language
  // has no reader must still come back with `status: "no-extractor"`, or the
  // ledger cannot account for it and `files = parsed + zeroSymbol + skipped`
  // silently stops holding.
  const files = scan.files
    .map((file) => ({
      path: file.path,
      language: file.language,
      sizeLines: file.sizeLines,
      fileCategory: file.fileCategory,
    }))
    .sort((a, b) => compareStableStrings(a.path, b.path));

  const tmpDir = join(dataDir, 'tmp');
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(dirname(outputPath), { recursive: true });

  const accumulator = {
    results: [],
    filesSkipped: [],
    analysisOutcomes: {},
    byStatus: {},
  };

  const chunks = chunk(files, args.chunkSize);
  for (let index = 0; index < chunks.length; index++) {
    // The pid keeps two concurrent runs over the same project root from
    // overwriting each other's scratch files. It never reaches the output.
    const inputPath = join(tmpDir, `structure-all-chunk-${process.pid}-${index}.in.json`);
    const chunkOut = join(tmpDir, `structure-all-chunk-${process.pid}-${index}.out.json`);
    writeFileSync(
      inputPath,
      JSON.stringify({ projectRoot, batchFiles: chunks[index], batchImportData: {} }),
      'utf-8',
    );
    const run = spawnSync('node', [EXTRACT_STRUCTURE, inputPath, chunkOut], {
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (run.stderr) process.stderr.write(run.stderr);
    if (run.status !== 0) {
      throw new Error(
        `structure-all: extract-structure failed on chunk ${index} (${chunks[index].length} files), exit ${run.status}`,
      );
    }
    mergeChunkOutput(accumulator, JSON.parse(readFileSync(chunkOut, 'utf-8')));
    rmSync(inputPath, { force: true });
    rmSync(chunkOut, { force: true });
    process.stderr.write(
      `structure-all: chunk ${index + 1}/${chunks.length} — ${accumulator.results.length}/${files.length} files\n`,
    );
  }

  accumulator.results.sort((a, b) => compareStableStrings(a.path, b.path));
  accumulator.filesSkipped.sort(compareStableStrings);

  const output = {
    scriptCompleted: true,
    chunkSize: args.chunkSize,
    filesRequested: files.length,
    filesAnalyzed: accumulator.results.length,
    filesSkipped: accumulator.filesSkipped,
    analysisOutcomes: sortKeys(
      Object.fromEntries(
        Object.entries(accumulator.analysisOutcomes).map(([group, counters]) => [
          group,
          sortKeys(counters),
        ]),
      ),
    ),
    byStatus: sortKeys(accumulator.byStatus),
    results: accumulator.results,
  };

  // Every requested file must come back with exactly one row. Anything else is
  // a hole in the ledger, so fail loudly instead of publishing it.
  if (output.filesAnalyzed !== output.filesRequested) {
    const seen = new Set(accumulator.results.map((r) => r.path));
    const missing = files.map((f) => f.path).filter((p) => !seen.has(p));
    throw new Error(
      `structure-all: ${missing.length} scanned file(s) produced no result row, ` +
      `first: ${missing.slice(0, 5).join(', ')}`,
    );
  }

  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  if (!existsSync(outputPath)) {
    throw new Error(`output file missing after write: ${outputPath}`);
  }

  const statuses = Object.entries(output.byStatus)
    .map(([status, count]) => `${status}=${count}`)
    .join(' ');
  process.stderr.write(`structure-all: files=${output.filesAnalyzed} ${statuses}\n`);
}

// ---------------------------------------------------------------------------
// Run only when executed directly as a CLI; importing the module (e.g. from
// tests) must not trigger main(). Both sides are canonicalized through
// realpathSync because plugin installs are symlinked.
// ---------------------------------------------------------------------------
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
    await main();
  } catch (err) {
    process.stderr.write(`structure-all.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default { chunk, mergeChunkOutput, DEFAULT_CHUNK_SIZE };
