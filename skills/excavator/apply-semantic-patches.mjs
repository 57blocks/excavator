#!/usr/bin/env node
/**
 * apply-semantic-patches.mjs
 *
 * Deterministic mechanics for committing model-authored, NODE-LOCAL semantic
 * patches (a `summary`/`tags` for one existing fact-graph node) into
 * `semantic-cache.json` during Full mode's semantic-generation phase
 * (openspec: changes/full-semantic-isolation, capability
 * `full-semantic-isolation`, design D1/D3).
 *
 * This module calls no model — the patch CONTENT is produced by the
 * excavator-file-analyzer subagent SKILL.md dispatches (over only the files
 * select-stale-semantics.mjs marked stale); this file only decides whether
 * each patch's `nodeId` is a REAL fact-graph node id before handing it to the
 * `commitSemanticCacheEntry` (semantic-cache.mjs). A patch
 * naming a nodeId with no fact-graph counterpart is NEVER committed — it is
 * recorded as a semantic gap instead, so a hallucinated id can never become a
 * fact anchor by riding in through the cache (spec Requirement "unmappable model
 * output is recorded as a semantic gap").
 *
 * Usage (CLI):
 *   node apply-semantic-patches.mjs <projectRoot> --patches <patches.json> [--out <report.json>]
 *
 * `<patches.json>` is an array of
 *   `{ nodeId, filePath, summary, tags?, semanticSourceHash, model?, generatedAt? }`.
 *
 * Contract: openspec/changes/full-semantic-isolation/specs/full-semantic-isolation/spec.md
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { commitSemanticCacheEntry } from './semantic-cache.mjs';
import { collectFactNodeIds } from './semantic-graph.mjs';
import { createGapCollector } from './fact-graph-resolve.mjs';
import { compareGaps } from './coverage-ledger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');

async function resolveCore(root) {
  const require = createRequire(resolve(root, 'package.json'));
  try {
    return await import(pathToFileURL(require.resolve('@excavator/core')).href);
  } catch {
    return await import(pathToFileURL(resolve(root, 'packages/core/dist/index.js')).href);
  }
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function reasonFor(kind) {
  if (kind === 'semantic-patch-invalid') {
    return 'a model-authored semantic patch was missing a nodeId and was dropped, not committed';
  }
  if (kind === 'semantic-patch-unmappable-node') {
    return 'a semantic patch named a nodeId with no fact-graph counterpart and was dropped, not committed';
  }
  if (kind.startsWith('semantic-patch-write-failed-')) {
    const status = kind.slice('semantic-patch-write-failed-'.length);
    return `a semantic patch failed to commit into semantic-cache.json (status: ${status})`;
  }
  return `unrecognized semantic-patch gap kind: ${kind}`;
}

/**
 * Commit a batch of node-local semantic patches, validating each `nodeId`
 * against the real fact-graph node id set first. Never throws per-patch — a
 * rejected or failed patch is recorded as a gap, and processing continues.
 *
 * @param {{
 *   projectRoot: string,
 *   factNodeIds: Set<string>|string[],
 *   patches: object[],
 *   commit?: typeof commitSemanticCacheEntry,
 *   sampleLimit?: number,
 * }} args
 * @returns {Promise<{ committed: number, total: number, gaps: object[], results: object[] }>}
 */
export async function applySemanticPatches({
  projectRoot,
  factNodeIds,
  patches,
  commit = commitSemanticCacheEntry,
  sampleLimit = 5,
}) {
  const idSet = factNodeIds instanceof Set ? factNodeIds : new Set(factNodeIds ?? []);
  const gapCollector = createGapCollector(sampleLimit);
  const list = Array.isArray(patches) ? patches : [];
  const results = [];
  let committed = 0;

  for (const patch of list) {
    const nodeId = patch?.nodeId;
    if (!isNonEmptyString(nodeId)) {
      gapCollector.add('semantic-patch-invalid', 'graph', JSON.stringify(patch ?? null).slice(0, 200));
      results.push({ nodeId: nodeId ?? null, ok: false, status: 'invalid-patch' });
      continue;
    }
    if (!idSet.has(nodeId)) {
      // The one behavior this whole module exists for: an unmappable model
      // output becomes a semantic gap, never a fact anchor and never a
      // committed cache entry under a made-up key.
      gapCollector.add('semantic-patch-unmappable-node', isNonEmptyString(patch.filePath) ? patch.filePath : 'unknown', nodeId);
      results.push({ nodeId, ok: false, status: 'unmappable-node' });
      continue;
    }

    const fields = {
      summary: patch.summary,
      ...(Array.isArray(patch.tags) ? { tags: patch.tags } : {}),
      semanticSourceHash: patch.semanticSourceHash,
      ...(isNonEmptyString(patch.model) ? { model: patch.model } : {}),
      ...(isNonEmptyString(patch.generatedAt) ? { generatedAt: patch.generatedAt } : {}),
    };
    const result = await commit({ projectRoot, nodeId, filePath: patch.filePath, fields,
      verifyNodePath: true, onlyIfNotFresh: true });
    results.push({ nodeId, ...result });
    if (result.ok) {
      committed += 1;
    } else {
      gapCollector.add(
        `semantic-patch-write-failed-${result.status}`,
        isNonEmptyString(patch.filePath) ? patch.filePath : 'unknown',
        nodeId,
      );
    }
  }

  const gaps = gapCollector.toArray(reasonFor).sort(compareGaps);
  return { committed, total: list.length, gaps, results };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { projectRoot: null, patches: null, out: null };
  const valueFlags = { '--patches': 'patches', '--out': 'out' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (valueFlags[arg]) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`apply-semantic-patches: ${arg} requires a value`);
      args[valueFlags[arg]] = value;
      i++;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`apply-semantic-patches: unknown option: ${arg}`);
    if (!args.projectRoot) { args.projectRoot = arg; continue; }
    throw new Error(`apply-semantic-patches: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot || !args.patches) {
    throw new Error('Usage: node apply-semantic-patches.mjs <projectRoot> --patches <path> [--out <report.json>]');
  }
  return args;
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`apply-semantic-patches: ${label} not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const { resolveDataDir } = await resolveCore(pluginRoot);
  const dataDir = resolveDataDir(projectRoot);
  const intermediate = join(dataDir, 'intermediate');

  const graphPath = join(dataDir, 'knowledge-graph.json');
  const knowledgeGraph = readJson(graphPath, 'knowledge-graph.json');
  const factNodeIds = collectFactNodeIds(knowledgeGraph);

  const patchesRaw = readJson(resolve(args.patches), 'patches file');
  const patches = Array.isArray(patchesRaw) ? patchesRaw : patchesRaw?.patches ?? [];

  const { committed, total, gaps, results } = await applySemanticPatches({
    projectRoot, factNodeIds, patches,
  });

  const outPath = resolve(args.out ?? join(intermediate, 'semantic-patch-report.json'));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ scriptCompleted: true, committed, total, gaps, results }, null, 2), 'utf-8');

  process.stderr.write(
    `apply-semantic-patches: committed=${committed}/${total} gaps=${gaps.length} -> ${outPath}\n`,
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
    process.stderr.write(`apply-semantic-patches.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default { applySemanticPatches };
