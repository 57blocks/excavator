#!/usr/bin/env node
/**
 * select-stale-semantics.mjs
 *
 * Deterministic file selection for Full mode's semantic-generation phase
 * (openspec: changes/full-semantic-isolation, capability
 * `full-semantic-isolation`, design D3). Decides which scanned files' node-
 * local semantics (in `semantic-cache.json`) are MISSING, STALE, or carry a
 * noncanonical cache schema/language identity against the CURRENT
 * `source-manifest.json` content hash, so file-analyzer is dispatched only
 * for those files — Full mode's incremental behavior at the semantic layer,
 * independent of whether the fact layer itself changed.
 *
 * Calls no model. Reuses `planSemanticCacheReuse`, the same node identity,
 * cache language and source-hash decision used by Lazy and MCP.
 *
 * A file is stale when ANY of its fact-graph nodes (the file node itself,
 * plus any function/class node it owns) has a missing or stale semantic-cache
 * entry. Even an explicit Full run must not regenerate an already-fresh node.
 *
 * Contract: openspec/changes/full-semantic-isolation/specs/full-semantic-isolation/spec.md
 *
 * Usage (CLI):
 *   node select-stale-semantics.mjs <projectRoot> [--out <path>] [--files-out <path>]
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { planSemanticCacheReuse } from './semantic-cache-reuse.mjs';

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

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Pure over already-loaded JSON. No I/O.
 *
 * @param {{
 *   knowledgeGraph: { nodes: object[] },
 *   semanticCache: { version: string, contentLanguage?: string, entries: Record<string, object> } | null | undefined,
 *   manifest: { entries: Array<{ path: string, contentHash: string }> } | null | undefined,
 *   forceAll?: boolean,
 * }} args
 * @returns {{ staleFiles: string[], freshFiles: string[], counts: { stale: number, fresh: number, total: number } }}
 */
export function selectStaleFiles({ knowledgeGraph, semanticCache, manifest, forceAll = false }) {
  if (forceAll) throw new Error('forceAll would regenerate hash-fresh semantics; use the shared reuse plan');
  const nodes = (knowledgeGraph?.nodes ?? []).filter((node) => typeof node?.id === 'string');
  const plan = planSemanticCacheReuse({
    requestedNodeIds: nodes.map((node) => node.id), nodes,
    manifestEntries: manifest?.entries ?? [], semanticCache,
  });
  const eligiblePaths = new Set([...plan.reuse, ...plan.generate].map((entry) => entry.filePath));
  const stalePaths = new Set(plan.generate.map((entry) => entry.filePath));
  const stale = [...stalePaths];
  const fresh = [...eligiblePaths].filter((path) => !stalePaths.has(path));

  stale.sort(compareStrings);
  fresh.sort(compareStrings);
  return { staleFiles: stale, freshFiles: fresh,
    unavailableNodes: plan.unavailable, plan,
    counts: { stale: stale.length, fresh: fresh.length, total: stale.length + fresh.length } };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { projectRoot: null, out: null, filesOut: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') { args.out = argv[++i]; continue; }
    if (arg === '--files-out') { args.filesOut = argv[++i]; continue; }
    if (arg.startsWith('--')) throw new Error(`select-stale-semantics: unknown option: ${arg}`);
    if (!args.projectRoot) { args.projectRoot = arg; continue; }
    throw new Error(`select-stale-semantics: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot) {
    throw new Error('Usage: node select-stale-semantics.mjs <projectRoot> [--out <path>] [--files-out <path>]');
  }
  return args;
}

function readJson(path, label, required = true) {
  if (!existsSync(path)) {
    if (required) throw new Error(`select-stale-semantics: ${label} not found: ${path}`);
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const { resolveDataDir } = await resolveCore(pluginRoot);
  const dataDir = resolveDataDir(projectRoot);
  const intermediate = join(dataDir, 'intermediate');

  const knowledgeGraph = readJson(join(dataDir, 'knowledge-graph.json'), 'knowledge-graph.json');
  // Both are optional: a first Full run has neither yet, and every file is
  // correctly treated as missing semantics (not an error).
  const semanticCache = readJson(join(dataDir, 'semantic-cache.json'), 'semantic-cache.json', false);
  const manifest = readJson(join(dataDir, 'source-manifest.json'), 'source-manifest.json', false);

  const result = selectStaleFiles({ knowledgeGraph, semanticCache, manifest });

  const outPath = resolve(args.out ?? join(intermediate, 'stale-semantics.json'));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ scriptCompleted: true, ...result }, null, 2), 'utf-8');

  // A plain JSON array of stale paths, ready to pass straight to
  // `compute-batches.mjs --changed-files=<path>` (its own parser accepts a
  // bare JSON string array).
  const filesOutPath = resolve(args.filesOut ?? join(intermediate, 'stale-files.json'));
  mkdirSync(dirname(filesOutPath), { recursive: true });
  writeFileSync(filesOutPath, JSON.stringify(result.staleFiles, null, 2), 'utf-8');

  process.stderr.write(
    `select-stale-semantics: stale=${result.counts.stale} fresh=${result.counts.fresh} ` +
    `total=${result.counts.total} unavailableNodes=${result.unavailableNodes.length} -> ${outPath}\n`,
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
    process.stderr.write(`select-stale-semantics.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default { selectStaleFiles };
