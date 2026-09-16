#!/usr/bin/env node
/**
 * Build the node-local semantic reuse plan before any semantic generation.
 *
 * The pure planner is the single decision surface for exact node identities:
 * every first-occurrence node id lands in reuse, generate, or unavailable.
 * Freshness delegates to semantic-cache.mjs so schema, canonical language,
 * content audit, and source-hash precedence remain one shared authority.
 *
 * CLI:
 *   node semantic-cache-reuse.mjs <projectRoot> --node-id <id> [--node-id <id> ...]
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { freshnessOf, readSemanticCache } from './semantic-cache.mjs';

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

/**
 * @param {{
 *   requestedNodeIds: string[],
 *   nodes: Array<{ id: string, filePath?: string }>,
 *   manifestEntries: Array<{ path: string, contentHash: string }>,
 *   semanticCache: { version: string, contentLanguage?: string, entries?: Record<string, object> },
 * }} args
 * @returns {{
 *   reuse: Array<{ nodeId: string, filePath: string, reason: 'fresh', summary: string, tags: string[] }>,
 *   generate: Array<{ nodeId: string, filePath: string, currentContentHash: string|null, reason: 'missing'|'stale'|'noncanonical-language' }>,
 *   unavailable: Array<{ nodeId: string, filePath: string|null, reason: 'unknown-node'|'path-not-in-manifest' }>,
 *   counts: { requested: number, reuse: number, generate: number, unavailable: number },
 * }}
 */
export function planSemanticCacheReuse({
  requestedNodeIds = [],
  nodes = [],
  manifestEntries = [],
  semanticCache = null,
} = {}) {
  const uniqueNodeIds = [...new Set(requestedNodeIds)];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const hashByPath = new Map(
    manifestEntries.map((entry) => [entry.path, entry.contentHash]),
  );
  const cacheEntries = semanticCache?.entries ?? {};

  const reuse = [];
  const generate = [];
  const unavailable = [];

  for (const nodeId of uniqueNodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) {
      unavailable.push({ nodeId, filePath: null, reason: 'unknown-node' });
      continue;
    }

    const filePath = node.filePath;
    if (typeof filePath !== 'string' || !hashByPath.has(filePath)) {
      unavailable.push({
        nodeId,
        filePath: typeof filePath === 'string' ? filePath : null,
        reason: 'path-not-in-manifest',
      });
      continue;
    }

    const currentContentHash = hashByPath.get(filePath) ?? null;
    const entry = cacheEntries[nodeId];
    const reason = freshnessOf(entry, currentContentHash, semanticCache);
    if (reason === 'fresh') {
      reuse.push({
        nodeId,
        filePath,
        reason,
        summary: entry.summary,
        tags: Array.isArray(entry.tags) ? [...entry.tags] : [],
      });
      continue;
    }

    generate.push({ nodeId, filePath, currentContentHash, reason });
  }

  return {
    reuse,
    generate,
    unavailable,
    counts: {
      requested: uniqueNodeIds.length,
      reuse: reuse.length,
      generate: generate.length,
      unavailable: unavailable.length,
    },
  };
}

function parseArgs(argv) {
  if (argv.length === 0) {
    throw new Error(
      'Usage: node semantic-cache-reuse.mjs <projectRoot> --node-id <id> [--node-id <id> ...]',
    );
  }

  const projectRoot = argv[0];
  const requestedNodeIds = [];
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (arg !== '--node-id') {
      throw new Error(`semantic-cache-reuse: unexpected argument: ${arg}`);
    }
    if (index + 1 >= argv.length) {
      throw new Error('semantic-cache-reuse: --node-id requires a value');
    }
    requestedNodeIds.push(argv[++index]);
  }
  if (requestedNodeIds.length === 0) {
    throw new Error('semantic-cache-reuse: at least one --node-id is required');
  }
  return { projectRoot, requestedNodeIds };
}

function readRequiredJson(path, label, expectedArrayField) {
  if (!existsSync(path)) {
    throw new Error(`semantic-cache-reuse: ${label} not found: ${path}`);
  }
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new Error(`semantic-cache-reuse: invalid ${label}: ${error.message}`);
  }
  if (!value || typeof value !== 'object' || !Array.isArray(value[expectedArrayField])) {
    throw new Error(`semantic-cache-reuse: invalid ${label}: expected ${expectedArrayField} array`);
  }
  return value;
}

async function main() {
  const { projectRoot: projectRootArg, requestedNodeIds } = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(projectRootArg);
  const { resolveDataDir } = await resolveCore(pluginRoot);
  const dataDir = resolveDataDir(projectRoot);
  const graph = readRequiredJson(join(dataDir, 'knowledge-graph.json'), 'knowledge-graph.json', 'nodes');
  const manifest = readRequiredJson(join(dataDir, 'source-manifest.json'), 'source-manifest.json', 'entries');
  const semanticCache = await readSemanticCache(projectRoot);

  const plan = planSemanticCacheReuse({
    requestedNodeIds,
    nodes: graph.nodes,
    manifestEntries: manifest.entries,
    semanticCache,
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
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
  } catch (error) {
    process.stderr.write(`semantic-cache-reuse.mjs failed: ${error.message}\n`);
    process.exit(1);
  }
}

export default { planSemanticCacheReuse };
