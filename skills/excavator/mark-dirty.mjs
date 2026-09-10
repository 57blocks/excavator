#!/usr/bin/env node
/**
 * mark-dirty.mjs
 *
 * Freshness for the one path that never reaches the annotate phase.
 *
 * An incremental run whose changes are all cosmetic is classified `SKIP`: the
 * pipeline runs `finalize-incremental.mjs`, advances its markers and STOPS.
 * Phases 1.2 / 2.3 / 2.5 / 6b never execute — so the dirty marking added in
 * phase 2.3 missed exactly the commit it was written for: a threshold changed
 * inside a function body, every summary describing it now slightly wrong, and
 * nothing in the graph saying so.
 *
 * This script is the SKIP-path equivalent. It needs none of phase 1.2's work:
 * the file list comes from the incremental plan (the pipeline's own record of
 * what it skipped) and the graph is the published one. It produces a
 * supplement copy for `publish-annotations.mjs` to merge, rather than editing
 * the published graph itself, so there stays exactly one writer of that file.
 *
 * The dirty set and the merge rule are imported, not re-implemented: the same
 * `cosmeticDirtyFiles` phase 2.3 uses, and the same never-downgrade ordering
 * (`contradicted` > `dirty` > `unverified` > `verified`), so the two paths
 * cannot drift into disagreeing about the same commit.
 *
 * Usage:
 *   node mark-dirty.mjs <projectRoot>
 *     [--graph <knowledge-graph.json>] [--plan <incremental-plan.json>]
 *     [--fingerprints <fingerprints.json>] [--scan <scan-result.json>]
 *     [--out <intermediate/dirty-graph.json>] [--meta <meta.json>] [--no-meta]
 *
 * Exit 0 with a printed note when there is nothing to mark — a SKIP run whose
 * changes were ignored files rather than cosmetic edits is the normal case.
 *
 * Logging: stderr only.
 */

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { cosmeticDirtyFiles, publishSupplementMeta, PIPELINE_VERSION } from './annotate-graph.mjs';
import { mergeVerification } from './verification-state.mjs';

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

/** Gap kinds this script owns and replaces, so a re-run is a no-op. */
export const OWNED_GAP_KINDS = Object.freeze(['cosmetic-dirty', 'dirty-unfingerprinted']);

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Mark the nodes of cosmetically-changed files. Pure over parsed inputs.
 *
 * The returned graph is a SUPPLEMENT copy: same nodes and edges as the input,
 * with `verification` merged and this script's gap rows replaced. Only the
 * fields `publish-annotations.mjs` is allowed to publish differ from the
 * published graph.
 */
export function markDirty({ graph, plan, fingerprints, scan, sampleLimit = 5 }) {
  const marked = JSON.parse(JSON.stringify(graph));
  marked.nodes = Array.isArray(marked.nodes) ? marked.nodes : [];

  const dirty = cosmeticDirtyFiles({ plan, fingerprints, scan });
  const dirtySet = new Set(dirty.files);
  const counts = {
    dirtyFiles: dirty.files.length,
    dirtyNodes: 0,
    dirtyPreserved: 0,
    dirtyUnfingerprinted: dirty.unfingerprinted.length,
    dirtyReanalysedOverlap: dirty.reanalysedOverlap.length,
    nodesTotal: marked.nodes.length,
  };

  for (const node of marked.nodes) {
    if (!node || typeof node !== 'object') continue;
    if (typeof node.filePath !== 'string' || !dirtySet.has(node.filePath)) continue;
    const merged = mergeVerification(node.verification, 'dirty');
    if (merged.preserved) {
      counts.dirtyPreserved += 1;
      continue;
    }
    node.verification = merged.value;
    counts.dirtyNodes += 1;
  }

  const kept = (Array.isArray(marked.gaps) ? marked.gaps : []).filter(
    (gap) => !OWNED_GAP_KINDS.includes(gap?.kind),
  );
  const gaps = [...kept];
  if (counts.dirtyFiles > 0) {
    gaps.push({
      kind: 'cosmetic-dirty',
      scope: 'graph',
      reason: `${counts.dirtyFiles} file(s) changed without re-analysis; ${counts.dirtyNodes} node(s) marked dirty`,
      count: counts.dirtyFiles,
      samples: dirty.files.slice(0, sampleLimit),
    });
  }
  if (counts.dirtyUnfingerprinted > 0) {
    gaps.push({
      kind: 'dirty-unfingerprinted',
      scope: 'graph',
      reason: `${counts.dirtyUnfingerprinted} cosmetic file(s) have no baseline fingerprint entry`,
      count: counts.dirtyUnfingerprinted,
      samples: dirty.unfingerprinted.slice(0, sampleLimit),
    });
  }
  gaps.sort((a, b) => compareStrings(a.kind, b.kind) || compareStrings(a.scope, b.scope));
  marked.gaps = gaps;

  return { marked, counts, dirtyFiles: dirty.files };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    projectRoot: null, graph: null, plan: null, fingerprints: null, scan: null,
    out: null, meta: null, writeMeta: true,
  };
  const valueFlags = {
    '--graph': 'graph', '--plan': 'plan', '--fingerprints': 'fingerprints',
    '--scan': 'scan', '--out': 'out', '--meta': 'meta',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-meta') { args.writeMeta = false; continue; }
    if (valueFlags[arg]) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`mark-dirty: ${arg} requires a value`);
      args[valueFlags[arg]] = value;
      i++;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`mark-dirty: unknown option: ${arg}`);
    if (!args.projectRoot) { args.projectRoot = arg; continue; }
    throw new Error(`mark-dirty: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot) {
    throw new Error(
      'Usage: node mark-dirty.mjs <projectRoot> [--graph <path>] [--plan <path>] ' +
      '[--fingerprints <path>] [--scan <path>] [--out <path>] [--meta <path>] [--no-meta]',
    );
  }
  return args;
}

function readJsonOrNull(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const dataDir = resolveDataDir(projectRoot);
  const intermediate = join(dataDir, 'intermediate');
  const graphPath = resolve(args.graph ?? join(dataDir, 'knowledge-graph.json'));
  const planPath = resolve(args.plan ?? join(intermediate, 'incremental-plan.json'));
  const fingerprintPath = resolve(args.fingerprints ?? join(dataDir, 'fingerprints.json'));
  const scanPath = resolve(args.scan ?? join(intermediate, 'scan-result.json'));
  const outPath = resolve(args.out ?? join(intermediate, 'dirty-graph.json'));
  const metaPath = resolve(args.meta ?? join(dataDir, 'meta.json'));

  const graph = readJsonOrNull(graphPath);
  if (!graph) {
    process.stderr.write(`mark-dirty: no graph at ${graphPath} — nothing to mark\n`);
    return;
  }
  const plan = readJsonOrNull(planPath);
  if (!plan) {
    process.stderr.write(
      `mark-dirty: no incremental plan at ${planPath} — nothing was skipped, so nothing is dirty\n`,
    );
    return;
  }
  const fingerprints = readJsonOrNull(fingerprintPath);
  const scan = readJsonOrNull(scanPath);
  if (!scan) {
    // Without the scan inventory a cosmetic path cannot be confirmed as still
    // analysed. Refuse rather than mark files that may no longer be in scope.
    process.stderr.write(
      `mark-dirty: no scan result at ${scanPath} — cannot confirm which files are still analysed; nothing marked\n`,
    );
    return;
  }

  const { marked, counts, dirtyFiles } = markDirty({ graph, plan, fingerprints, scan });

  if (counts.dirtyFiles === 0) {
    process.stderr.write(
      `mark-dirty: no cosmetic file in the plan is still analysed — nothing marked ` +
      `(plan cosmetic=${(plan.cosmeticFiles ?? []).length})\n`,
    );
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(marked, null, 2)}\n`, 'utf-8');
  if (args.writeMeta) {
    publishSupplementMeta(metaPath, {
      dirtyFiles,
      model: marked.project?.model ?? 'unknown',
      pipelineVersion: PIPELINE_VERSION,
    });
  }

  process.stderr.write(
    `mark-dirty: dirty-files=${counts.dirtyFiles} dirty-nodes=${counts.dirtyNodes} ` +
    `preserved=${counts.dirtyPreserved} unfingerprinted=${counts.dirtyUnfingerprinted} ` +
    `overlap=${counts.dirtyReanalysedOverlap} -> ${outPath}\n`,
  );
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
    process.stderr.write(`mark-dirty.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default { markDirty, OWNED_GAP_KINDS };
