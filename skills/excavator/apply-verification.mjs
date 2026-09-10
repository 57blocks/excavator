#!/usr/bin/env node
/**
 * apply-verification.mjs
 *
 * Analysis phase 2.5 (added, after ANNOTATE). Two deterministic halves around
 * one model pass:
 *
 *   prepare — pick the nodes whose summaries are checkable, cut them into
 *             batches of `{id, filePath, lineRange, summary}`, and write a
 *             manifest that records HOW they were picked (`full` or
 *             `sample:<n>`). Nodes whose `filePath` escapes the project root
 *             are refused here and counted: the batch is a read instruction
 *             handed to a model, and a model-authored path must never be able
 *             to send it outside the analysed tree.
 *   apply   — read the verifier's verdicts and write `verification` onto the
 *             nodes. It NEVER clears or rewrites a `summary`: a contradicted
 *             sentence stays on the node, marked, and consumers decide. Every
 *             contradiction is archived with its reason in
 *             `intermediate/contradicted-summaries.json` and counted under gap
 *             `summary-contradicted`.
 *   skip    — stamp `project.verification = "skipped"` and nothing else, so a
 *             `--no-verify` run still says out loud that no summary was
 *             checked.
 *
 * Every non-empty summary lands in exactly one visible bucket
 * (`verified` / `unverified` / `contradicted` / `dirty` / unmarked) and the
 * report's `byVerification` totals must add up to the number of non-empty
 * summaries in the graph — a summary cannot quietly fall out of the ledger.
 *
 * Severity, when a node already carries a `verification`: a verdict never
 * DOWNGRADES an existing marking. `contradicted` > `dirty` > `unverified` >
 * `verified`, and the more severe of {existing, verdict} wins, counted under
 * `verificationPreserved`. Without this, a `verified` summary verdict would
 * erase the freshness marking annotate had put on the same node.
 *
 * Usage:
 *   node apply-verification.mjs <projectRoot> prepare
 *     [--graph <annotated-graph.json>] [--sample <n>] [--batch-size <n>]
 *     [--manifest <path>] [--batch-dir <dir>]
 *   node apply-verification.mjs <projectRoot> apply
 *     [--graph <annotated-graph.json>] [--out <path>] [--manifest <path>]
 *     [--verdict-dir <dir>] [--report <path>] [--archive <path>]
 *     [--samples <n>]
 *   node apply-verification.mjs <projectRoot> skip
 *     [--graph <annotated-graph.json>] [--out <path>] [--report <path>]
 *
 * `apply` and `skip` default `--out` to the input graph path, so phase 6b
 * picks the verification up without any change to how it is invoked.
 *
 * Determinism: no timestamps; nodes ordered by id; sampling is a fixed stride,
 * never random; this script's own gap rows are replaced rather than appended,
 * so running it twice over the same inputs is a no-op.
 *
 * Logging: stderr only.
 */

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { compareGaps } from './coverage-ledger.mjs';
import { resolveWithinRoot } from './validate-graph.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

let core;
try {
  core = await import(pathToFileURL(require.resolve('@excavator/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}
const { resolveDataDir } = core;

/** The only verdicts a verifier may return. There is no fourth. */
export const VERDICTS = Object.freeze(['verified', 'unverified', 'contradicted']);

/** Severity order for `verification`; a verdict never lowers an existing one. */
export const VERIFICATION_SEVERITY = Object.freeze({
  verified: 0,
  unverified: 1,
  dirty: 2,
  contradicted: 3,
});

/** Gap kinds this script owns and therefore replaces on a re-run. */
export const OWNED_GAP_KINDS = Object.freeze([
  'summary-contradicted',
  'summary-unverified',
  'summary-unchecked',
  'summary-verdict-missing',
  'summary-verdict-unknown-node',
  'summary-verdict-invalid',
  'summary-path-out-of-scope',
]);

/** Nodes per verifier batch. Each node costs one small source read. */
export const DEFAULT_BATCH_SIZE = 30;

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasSummary(node) {
  return typeof node?.summary === 'string' && node.summary.trim().length > 0;
}

/** A summary is checkable only against a concrete file and line range. */
function hasAnchor(node) {
  return (
    typeof node?.filePath === 'string' &&
    node.filePath.length > 0 &&
    Array.isArray(node.lineRange) &&
    Number.isInteger(node.lineRange[0]) &&
    Number.isInteger(node.lineRange[1])
  );
}

/**
 * Fixed-stride selection over the id-sorted candidates.
 *
 * `--sample 50` on 500 candidates takes every 10th, not the first 50: the
 * first n of an id-sorted list is one alphabetical corner of the project, and
 * a sample that only ever looks at `api/...` says nothing about the rest.
 * Deterministic by construction — no RNG, no seed to remember.
 */
export function strideSample(items, sampleSize) {
  if (!Number.isInteger(sampleSize) || sampleSize <= 0) return [];
  if (sampleSize >= items.length) return items.slice();
  const stride = items.length / sampleSize;
  const out = [];
  for (let i = 0; i < sampleSize; i++) {
    out.push(items[Math.min(items.length - 1, Math.floor(i * stride))]);
  }
  return out;
}

export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Choose what to hand the verifier.
 *
 * Pure over the graph plus a path classifier, so a test can drive it without
 * a project tree. `classifyPath(filePath)` returns `'ok' | 'missing' |
 * 'out-of-scope'`.
 */
export function prepareVerification({ graph, sample = null, batchSize = DEFAULT_BATCH_SIZE, classifyPath }) {
  // No permissive default: a missing classifier would mean every
  // model-authored path is accepted as a read instruction, which is the one
  // failure mode this argument exists to prevent.
  if (typeof classifyPath !== 'function') {
    throw new Error('prepareVerification: classifyPath must be a function');
  }
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const counts = {
    nodesTotal: nodes.length,
    summariesTotal: 0,
    noAnchor: 0,
    pathOutOfScope: 0,
    sourceMissing: 0,
    candidates: 0,
    selected: 0,
  };
  const outOfScope = [];
  const missing = [];

  const candidates = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    if (!hasSummary(node)) continue;
    counts.summariesTotal += 1;
    if (!hasAnchor(node)) {
      counts.noAnchor += 1;
      continue;
    }
    const status = classifyPath(node.filePath);
    if (status === 'out-of-scope') {
      // Refused, not read, and never handed to the model as a read
      // instruction. The node keeps its summary and stays unmarked.
      counts.pathOutOfScope += 1;
      outOfScope.push(`${node.id} -> ${node.filePath}`);
      continue;
    }
    if (status === 'missing') {
      counts.sourceMissing += 1;
      missing.push(`${node.id} -> ${node.filePath}`);
      continue;
    }
    candidates.push({
      id: node.id,
      filePath: node.filePath,
      lineRange: [node.lineRange[0], node.lineRange[1]],
      summary: node.summary,
    });
  }

  candidates.sort((a, b) => compareStrings(a.id, b.id));
  counts.candidates = candidates.length;

  const selected =
    sample === null || sample >= candidates.length
      ? candidates
      : strideSample(candidates, sample);
  counts.selected = selected.length;

  const mode =
    sample === null || sample >= candidates.length ? 'full' : `sample:${selected.length}`;

  const batches = chunk(selected, Math.max(1, batchSize)).map((batchNodes, index) => ({
    batchIndex: index,
    nodes: batchNodes,
  }));

  const manifest = {
    scriptCompleted: true,
    mode,
    batchSize: Math.max(1, batchSize),
    counts,
    outOfScopePaths: outOfScope.sort(compareStrings),
    missingFiles: missing.sort(compareStrings),
    selectedIds: selected.map((n) => n.id),
    batches: batches.map((b) => ({ batchIndex: b.batchIndex, nodeCount: b.nodes.length })),
  };

  return { manifest, batches, mode };
}

/**
 * Write the verdicts onto the graph.
 *
 * @param {object} args
 * @param {object} args.graph      the annotated graph
 * @param {object} [args.manifest] the prepare manifest (mode + selected ids)
 * @param {object[]} args.verdicts flattened `{id, verdict, reason}` entries
 * @param {string} [args.mode]     overrides the manifest's mode
 */
export function applyVerification({ graph, manifest = null, verdicts = [], mode = null, sampleLimit = 5 }) {
  const verified = clone(graph);
  verified.nodes = Array.isArray(verified.nodes) ? verified.nodes : [];

  const byId = new Map();
  for (const node of verified.nodes) {
    if (node && typeof node === 'object' && node.id !== undefined) byId.set(node.id, node);
  }

  const counts = {
    verdictsRead: verdicts.length,
    verdictsApplied: 0,
    verified: 0,
    unverified: 0,
    contradicted: 0,
    verdictInvalid: 0,
    verdictUnknownNode: 0,
    verdictDuplicate: 0,
    verdictMissing: 0,
    verificationPreserved: 0,
  };
  const samples = {
    contradicted: [],
    unverified: [],
    invalid: [],
    unknownNode: [],
    missing: [],
  };
  const archive = [];

  const seen = new Set();
  const ordered = verdicts
    .filter((entry) => entry && typeof entry === 'object')
    .slice()
    .sort((a, b) => compareStrings(String(a.id), String(b.id)));

  for (const entry of ordered) {
    const id = entry.id;
    const verdict = entry.verdict;
    if (!VERDICTS.includes(verdict)) {
      counts.verdictInvalid += 1;
      if (samples.invalid.length < sampleLimit) samples.invalid.push(`${id}: ${JSON.stringify(verdict)}`);
      continue;
    }
    const node = byId.get(id);
    if (!node) {
      // A verdict for an id that is not in the graph is discarded — but never
      // silently: a reconstructed id would otherwise look like a check that
      // happened.
      counts.verdictUnknownNode += 1;
      if (samples.unknownNode.length < sampleLimit) samples.unknownNode.push(String(id));
      continue;
    }
    if (seen.has(id)) {
      counts.verdictDuplicate += 1;
      continue;
    }
    seen.add(id);

    const existing = node.verification;
    const existingRank = VERIFICATION_SEVERITY[existing];
    const verdictRank = VERIFICATION_SEVERITY[verdict];
    if (existingRank !== undefined && existingRank > verdictRank) {
      node.verification = existing;
      counts.verificationPreserved += 1;
    } else {
      node.verification = verdict;
    }
    counts.verdictsApplied += 1;
    counts[verdict] += 1;

    if (verdict === 'contradicted') {
      // The summary STAYS on the node. The archive is the reason trail, not a
      // quarantine.
      archive.push({
        id: node.id,
        filePath: node.filePath ?? null,
        lineRange: Array.isArray(node.lineRange) ? node.lineRange : null,
        summary: node.summary ?? '',
        reason: typeof entry.reason === 'string' ? entry.reason : '',
      });
      if (samples.contradicted.length < sampleLimit) samples.contradicted.push(node.id);
    } else if (verdict === 'unverified') {
      if (samples.unverified.length < sampleLimit) samples.unverified.push(node.id);
    }
  }

  archive.sort((a, b) => compareStrings(a.id, b.id));

  // Selected but no verdict came back: marked `unverified`, which is what it
  // is — nobody confirmed it — and counted separately so a verifier that
  // dropped a batch is visible rather than looking like caution.
  const selectedIds = Array.isArray(manifest?.selectedIds) ? manifest.selectedIds : [];
  for (const id of [...selectedIds].sort(compareStrings)) {
    if (seen.has(id)) continue;
    const node = byId.get(id);
    counts.verdictMissing += 1;
    if (samples.missing.length < sampleLimit) samples.missing.push(String(id));
    if (!node) continue;
    const existingRank = VERIFICATION_SEVERITY[node.verification];
    if (existingRank !== undefined && existingRank > VERIFICATION_SEVERITY.unverified) continue;
    node.verification = 'unverified';
    counts.unverified += 1;
  }

  // Every non-empty summary in one bucket, by the field's final value.
  const byVerification = { verified: 0, unverified: 0, contradicted: 0, dirty: 0, unmarked: 0 };
  let summariesTotal = 0;
  const uncheckedSamples = [];
  for (const node of verified.nodes) {
    if (!hasSummary(node)) continue;
    summariesTotal += 1;
    const value = node.verification;
    if (value === undefined || value === null || value === '') {
      byVerification.unmarked += 1;
      if (uncheckedSamples.length < sampleLimit) uncheckedSamples.push(node.id);
      continue;
    }
    if (byVerification[value] === undefined) byVerification[value] = 0;
    byVerification[value] += 1;
  }

  const resolvedMode = mode ?? manifest?.mode ?? 'full';
  if (verified.project && typeof verified.project === 'object') {
    verified.project.verification = resolvedMode;
  }

  // Replace this script's own rows so a second run is a no-op.
  const kept = (Array.isArray(verified.gaps) ? verified.gaps : []).filter(
    (gap) => !OWNED_GAP_KINDS.includes(gap?.kind),
  );
  const gaps = [...kept];
  const addGap = (kind, count, reason, sampleList) => {
    if (count <= 0) return;
    gaps.push({ kind, scope: 'graph', reason, count, samples: (sampleList ?? []).slice().sort(compareStrings) });
  };
  addGap('summary-contradicted', counts.contradicted,
    `${counts.contradicted} summary(ies) the verifier found the anchored source contradicts`,
    samples.contradicted);
  addGap('summary-unverified', counts.unverified,
    `${counts.unverified} summary(ies) the anchored source neither supports nor contradicts`,
    samples.unverified);
  addGap('summary-unchecked', byVerification.unmarked,
    `${byVerification.unmarked} non-empty summary(ies) carry no verification status`,
    uncheckedSamples);
  addGap('summary-verdict-missing', counts.verdictMissing,
    `${counts.verdictMissing} selected summary(ies) came back with no verdict`,
    samples.missing);
  addGap('summary-verdict-unknown-node', counts.verdictUnknownNode,
    `${counts.verdictUnknownNode} verdict(s) name an id that is not in the graph`,
    samples.unknownNode);
  addGap('summary-verdict-invalid', counts.verdictInvalid,
    `${counts.verdictInvalid} verdict(s) are not one of ${VERDICTS.join('/')}`,
    samples.invalid);
  const outOfScopeCount = manifest?.counts?.pathOutOfScope ?? 0;
  addGap('summary-path-out-of-scope', outOfScopeCount,
    `${outOfScopeCount} summary anchor(s) name a path outside the project root and were not checked`,
    (manifest?.outOfScopePaths ?? []).slice(0, sampleLimit));
  gaps.sort(compareGaps);
  verified.gaps = gaps;

  const bucketSum = Object.values(byVerification).reduce((a, b) => a + b, 0);
  const report = {
    scriptCompleted: true,
    action: 'apply',
    mode: resolvedMode,
    counts: { ...counts, summariesTotal },
    byVerification,
    conserves: bucketSum === summariesTotal,
    samples,
    archived: archive.length,
  };

  return { verified, report, archive };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const ACTIONS = Object.freeze(['prepare', 'apply', 'skip']);

function parseArgs(argv) {
  const args = {
    projectRoot: null, action: null, graph: null, out: null, manifest: null,
    batchDir: null, verdictDir: null, report: null, archive: null,
    sample: null, batchSize: DEFAULT_BATCH_SIZE, sampleLimit: 5,
  };
  const valueFlags = {
    '--graph': 'graph', '--out': 'out', '--manifest': 'manifest',
    '--batch-dir': 'batchDir', '--verdict-dir': 'verdictDir',
    '--report': 'report', '--archive': 'archive',
  };
  const intFlags = { '--sample': 'sample', '--batch-size': 'batchSize', '--samples': 'sampleLimit' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (intFlags[arg]) {
      const value = Number.parseInt(argv[i + 1], 10);
      const min = arg === '--samples' ? 0 : 1;
      if (!Number.isInteger(value) || value < min) {
        throw new Error(`apply-verification: ${arg} requires an integer >= ${min}`);
      }
      args[intFlags[arg]] = value;
      i++;
      continue;
    }
    if (valueFlags[arg]) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`apply-verification: ${arg} requires a value`);
      args[valueFlags[arg]] = value;
      i++;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`apply-verification: unknown option: ${arg}`);
    if (!args.projectRoot) { args.projectRoot = arg; continue; }
    if (!args.action) {
      if (!ACTIONS.includes(arg)) {
        throw new Error(`apply-verification: unknown action "${arg}" (expected ${ACTIONS.join(' | ')})`);
      }
      args.action = arg;
      continue;
    }
    throw new Error(`apply-verification: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot || !args.action) {
    throw new Error(
      'Usage: node apply-verification.mjs <projectRoot> <prepare|apply|skip> [options] ' +
      '(see the header comment for the full flag list)',
    );
  }
  return args;
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`apply-verification: ${label} not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8');
}

/**
 * Path classifier for the real filesystem: 'ok' when the file exists inside
 * the project root, 'out-of-scope' when the path escapes it (refused without
 * a read), 'missing' when it is in scope but not there.
 */
function createPathClassifier(projectRoot) {
  let root;
  try {
    root = realpathSync(resolve(projectRoot));
  } catch {
    root = resolve(projectRoot);
  }
  const cache = new Map();
  return (filePath) => {
    if (!cache.has(filePath)) {
      const absolute = resolveWithinRoot(root, filePath);
      if (absolute === null) cache.set(filePath, 'out-of-scope');
      else cache.set(filePath, existsSync(absolute) ? 'ok' : 'missing');
    }
    return cache.get(filePath);
  };
}

/** Every `summary-verdicts-*.json` in a directory, in index order. */
export function readVerdictFiles(dir) {
  if (!existsSync(dir)) return { verdicts: [], files: [] };
  const files = readdirSync(dir)
    .filter((name) => /^summary-verdicts-\d+\.json$/.test(name))
    .sort((a, b) => {
      const ai = Number.parseInt(a.match(/(\d+)/)[1], 10);
      const bi = Number.parseInt(b.match(/(\d+)/)[1], 10);
      return ai - bi;
    });
  const verdicts = [];
  for (const name of files) {
    const parsed = JSON.parse(readFileSync(join(dir, name), 'utf-8'));
    for (const entry of parsed?.verdicts ?? []) verdicts.push(entry);
  }
  return { verdicts, files };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const intermediate = join(resolveDataDir(projectRoot), 'intermediate');
  const graphPath = resolve(args.graph ?? join(intermediate, 'annotated-graph.json'));
  const manifestPath = resolve(args.manifest ?? join(intermediate, 'summary-verify-manifest.json'));
  const batchDir = resolve(args.batchDir ?? intermediate);
  const verdictDir = resolve(args.verdictDir ?? intermediate);
  const reportPath = resolve(args.report ?? join(intermediate, 'summary-verification.json'));
  const archivePath = resolve(args.archive ?? join(intermediate, 'contradicted-summaries.json'));
  // Defaults to the input graph so phase 6b needs no new argument.
  const outPath = resolve(args.out ?? graphPath);

  const graph = readJson(graphPath, 'graph');

  if (args.action === 'prepare') {
    const { manifest, batches, mode } = prepareVerification({
      graph,
      sample: args.sample,
      batchSize: args.batchSize,
      classifyPath: createPathClassifier(projectRoot),
    });
    writeJson(manifestPath, manifest);
    for (const batch of batches) {
      writeJson(join(batchDir, `summary-verify-batch-${batch.batchIndex}.json`), batch);
    }
    const c = manifest.counts;
    process.stderr.write(
      `apply-verification prepare: mode=${mode} summaries=${c.summariesTotal} ` +
      `candidates=${c.candidates} selected=${c.selected} batches=${batches.length} ` +
      `no-anchor=${c.noAnchor} source-missing=${c.sourceMissing} ` +
      `path-out-of-scope=${c.pathOutOfScope}\n`,
    );
    if (c.pathOutOfScope > 0) {
      process.stderr.write(
        `Warning: apply-verification: ${c.pathOutOfScope} summary anchor(s) name a path outside the project root — refused, not read\n`,
      );
    }
    return;
  }

  if (args.action === 'skip') {
    const { verified, report } = applyVerification({
      graph, manifest: null, verdicts: [], mode: 'skipped', sampleLimit: args.sampleLimit,
    });
    writeJson(outPath, verified);
    writeJson(reportPath, { ...report, action: 'skip' });
    process.stderr.write(
      `apply-verification skip: project.verification=skipped ` +
      `summaries=${report.counts.summariesTotal} unchecked=${report.byVerification.unmarked}\n`,
    );
    return;
  }

  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf-8')) : null;
  if (!manifest) {
    process.stderr.write(
      `Warning: apply-verification: no manifest at ${manifestPath} — selected-but-unanswered summaries cannot be counted\n`,
    );
  }
  const { verdicts, files } = readVerdictFiles(verdictDir);
  if (files.length === 0) {
    process.stderr.write(
      `Warning: apply-verification: no summary-verdicts-*.json in ${verdictDir}\n`,
    );
  }

  // mode is not passed: it comes from the manifest, so the graph says how the
  // run was actually scoped rather than how a flag claimed it was.
  const { verified, report, archive } = applyVerification({
    graph, manifest, verdicts, sampleLimit: args.sampleLimit,
  });

  writeJson(outPath, verified);
  writeJson(reportPath, { ...report, verdictFiles: files });
  writeJson(archivePath, { scriptCompleted: true, count: archive.length, records: archive });

  const c = report.counts;
  process.stderr.write(
    `apply-verification: mode=${report.mode} verdicts=${c.verdictsRead} applied=${c.verdictsApplied} ` +
    `verified=${c.verified} unverified=${c.unverified} summary-contradicted=${c.contradicted} ` +
    `verdict-missing=${c.verdictMissing} unknown-node=${c.verdictUnknownNode} ` +
    `invalid=${c.verdictInvalid} preserved=${c.verificationPreserved} ` +
    `unchecked=${report.byVerification.unmarked}\n`,
  );
  if (!report.conserves) {
    process.stderr.write(
      'Warning: apply-verification: verification buckets do not account for every non-empty summary\n',
    );
  }
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
    await main();
  } catch (err) {
    process.stderr.write(`apply-verification.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default {
  prepareVerification, applyVerification, readVerdictFiles, strideSample, chunk,
  VERDICTS, VERIFICATION_SEVERITY, OWNED_GAP_KINDS, DEFAULT_BATCH_SIZE,
};
