#!/usr/bin/env node
/**
 * plan-semantic-batches.mjs
 *
 * Phase F2 batches for Full mode, packed by the source lines the analyzer
 * must read (openspec: changes/semantic-read-evidence, design D1). Each node
 * in `stale-semantics.json`'s `plan.generate` gets a `readRange`
 * (read-evidence.mjs); nodes are taken in path order and a batch closes
 * before it would hold more than `maxNodes` nodes or more than `maxLines`
 * lines to read. Lines are counted as the union of the batch's read ranges
 * within each file, so a class and its methods are not counted twice. A node
 * longer than `maxLines` on its own gets a batch to itself, marked
 * `oversized`. A node whose file cannot be read, or is empty, or that has no
 * fact node, lands in the visible `unreadable` bucket and is not dispatched.
 *
 * Writes `intermediate/semantic-batches.json` and one
 * `intermediate/semantic-input-batch-<i>.json` per batch, the node list the
 * analyzer is dispatched with. Calls no model.
 *
 * Usage (CLI):
 *   node plan-semantic-batches.mjs <projectRoot> [--max-nodes <n>] [--max-lines <n>]
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph } from './knowledge-graph-store.mjs';
import { createLineReader, readRangeFor } from './read-evidence.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');

export const MAX_BATCH_NODES = 40;
export const MAX_BATCH_LINES = 1500;

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

/** Size of the union of inclusive [start, end] ranges. */
function unionSize(ranges) {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let current = null;
  for (const [start, end] of sorted) {
    if (current && start <= current[1] + 1) {
      current[1] = Math.max(current[1], end);
      continue;
    }
    if (current) total += current[1] - current[0] + 1;
    current = [start, end];
  }
  if (current) total += current[1] - current[0] + 1;
  return total;
}

function sourceLinesOf(nodes) {
  const byFile = new Map();
  for (const node of nodes) {
    const list = byFile.get(node.filePath) ?? [];
    list.push(node.readRange);
    byFile.set(node.filePath, list);
  }
  let total = 0;
  for (const ranges of byFile.values()) total += unionSize(ranges);
  return total;
}

/**
 * Pure over loaded inputs.
 *
 * @param {{
 *   generate: Array<{ nodeId: string, filePath?: string|null }>,
 *   nodes: Array<{ id: string, type?: string, name?: string, filePath?: string, lineRange?: [number, number] }>,
 *   lineCountOf: (filePath: string) => number|null,
 *   maxNodes?: number, maxLines?: number,
 * }} args
 */
export function planSemanticBatches({
  generate, nodes, lineCountOf, maxNodes = MAX_BATCH_NODES, maxLines = MAX_BATCH_LINES,
}) {
  if (!Number.isInteger(maxNodes) || maxNodes < 1) throw new Error('plan-semantic-batches: maxNodes must be a positive integer');
  if (!Number.isInteger(maxLines) || maxLines < 1) throw new Error('plan-semantic-batches: maxLines must be a positive integer');
  const nodeById = new Map((nodes ?? []).map((node) => [node.id, node]));
  const planned = [];
  const unreadable = [];
  const requested = Array.isArray(generate) ? generate : [];

  for (const entry of requested) {
    const node = nodeById.get(entry?.nodeId);
    if (!node) {
      unreadable.push({ nodeId: entry?.nodeId ?? null, filePath: entry?.filePath ?? null, reason: 'unknown-node' });
      continue;
    }
    const lineCount = typeof node.filePath === 'string' ? lineCountOf(node.filePath) : null;
    const readRange = readRangeFor(node, lineCount);
    if (readRange === null) {
      unreadable.push({
        nodeId: node.id,
        filePath: node.filePath ?? null,
        reason: lineCount === 0 ? 'empty-file' : 'source-unreadable',
      });
      continue;
    }
    planned.push({
      id: node.id,
      type: node.type,
      name: node.name,
      filePath: node.filePath,
      ...(Array.isArray(node.lineRange) ? { lineRange: [node.lineRange[0], node.lineRange[1]] } : {}),
      readRange,
    });
  }

  planned.sort((a, b) => compareStrings(a.filePath, b.filePath)
    || a.readRange[0] - b.readRange[0] || compareStrings(a.id, b.id));

  const batches = [];
  let current = [];
  const close = () => {
    if (current.length === 0) return;
    const sourceLines = sourceLinesOf(current);
    batches.push({ batchIndex: batches.length, nodes: current, sourceLines, oversized: sourceLines > maxLines });
    current = [];
  };
  for (const node of planned) {
    const alone = sourceLinesOf([node]);
    if (alone > maxLines) {
      close();
      current = [node];
      close();
      continue;
    }
    if (current.length + 1 > maxNodes || sourceLinesOf([...current, node]) > maxLines) close();
    current.push(node);
  }
  close();

  unreadable.sort((a, b) => compareStrings(String(a.nodeId), String(b.nodeId)));
  return {
    batches,
    unreadable,
    counts: {
      requested: requested.length,
      planned: planned.length,
      unreadable: unreadable.length,
      batches: batches.length,
      oversized: batches.filter((b) => b.oversized).length,
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { projectRoot: null, maxNodes: MAX_BATCH_NODES, maxLines: MAX_BATCH_LINES };
  const intFlags = { '--max-nodes': 'maxNodes', '--max-lines': 'maxLines' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (intFlags[arg]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (!Number.isInteger(value) || value < 1 || String(value) !== argv[i + 1]) {
        throw new Error(`plan-semantic-batches: ${arg} requires a positive integer`);
      }
      args[intFlags[arg]] = value;
      i++;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`plan-semantic-batches: unknown option: ${arg}`);
    if (!args.projectRoot) { args.projectRoot = arg; continue; }
    throw new Error(`plan-semantic-batches: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot) {
    throw new Error('Usage: node plan-semantic-batches.mjs <projectRoot> [--max-nodes <n>] [--max-lines <n>]');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const { resolveDataDir } = await resolveCore(pluginRoot);
  const dataDir = resolveDataDir(projectRoot);
  const intermediate = join(dataDir, 'intermediate');

  const graphPath = join(dataDir, KNOWLEDGE_GRAPH_FILE);
  if (!existsSync(graphPath)) throw new Error(`plan-semantic-batches: ${KNOWLEDGE_GRAPH_FILE} not found: ${graphPath}`);
  const stalePath = join(intermediate, 'stale-semantics.json');
  if (!existsSync(stalePath)) throw new Error(`plan-semantic-batches: stale-semantics.json not found: ${stalePath}`);

  const knowledgeGraph = readKnowledgeGraph(graphPath);
  const stale = JSON.parse(readFileSync(stalePath, 'utf-8'));
  const readLines = createLineReader(projectRoot);
  const lineCountOf = (filePath) => readLines(filePath)?.length ?? null;

  const { batches, unreadable, counts } = planSemanticBatches({
    generate: stale?.plan?.generate ?? [],
    nodes: knowledgeGraph.nodes,
    lineCountOf,
    maxNodes: args.maxNodes,
    maxLines: args.maxLines,
  });

  mkdirSync(intermediate, { recursive: true });
  // A previous plan's input files must not stand in for a batch this plan lacks.
  for (const name of readdirSync(intermediate)) {
    if (/^semantic-input-batch-\d+\.json$/.test(name)) unlinkSync(join(intermediate, name));
  }
  for (const batch of batches) {
    writeFileSync(join(intermediate, `semantic-input-batch-${batch.batchIndex}.json`),
      JSON.stringify({ batchIndex: batch.batchIndex, nodes: batch.nodes }, null, 2), 'utf-8');
  }
  const outPath = join(intermediate, 'semantic-batches.json');
  writeFileSync(outPath, JSON.stringify({
    scriptCompleted: true,
    maxNodes: args.maxNodes,
    maxLines: args.maxLines,
    totalBatches: batches.length,
    counts,
    batches: batches.map((b) => ({
      batchIndex: b.batchIndex, nodeCount: b.nodes.length, sourceLines: b.sourceLines, oversized: b.oversized,
    })),
    unreadable,
  }, null, 2), 'utf-8');

  process.stderr.write(
    `plan-semantic-batches: nodes=${counts.requested} planned=${counts.planned} unreadable=${counts.unreadable} ` +
    `batches=${counts.batches} oversized=${counts.oversized} -> ${outPath}\n`,
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
    process.stderr.write(`plan-semantic-batches.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default { planSemanticBatches };
