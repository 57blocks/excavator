/**
 * Test helpers that give a synthetic project the facts the domain extractor
 * reads: a real Lazy run (deterministic, no model) or a hand-written graph.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeKnowledgeGraph } from '../../../skills/excavator/knowledge-graph-store.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const LAZY = resolve(repoRoot, 'skills/excavator/lazy-analyze.mjs');

/** Build `<root>/.excavator/knowledge-graph.jsonl` with the Lazy driver. */
export function runLazy(root) {
  const result = spawnSync(process.execPath, [LAZY, root], { encoding: 'utf-8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`lazy-analyze failed: ${result.stderr}`);
}

/** Write a graph with no nodes and the given entryPoint records. */
export function writeEntryPointGraph(root, entryPoints) {
  const dir = join(root, '.excavator');
  mkdirSync(dir, { recursive: true });
  writeKnowledgeGraph(join(dir, 'knowledge-graph.jsonl'), {
    version: '1.0.0', nodes: [], edges: [], gaps: [], entryPoints,
  });
}

/** An `entry` record, as entry-point-resolution writes it. */
export function entryRecord({ file, line, method = 'GET', path = '/x', handler = { fate: 'inline', line, endLine: line }, framework = 'express' }) {
  return { kind: 'entry', framework, routeKind: 'http', form: 'call', method, path, bucket: 'resolved', file, line, handler, source: 'script' };
}

export function mountRecord({ file, line, path = '/api', framework = 'express' }) {
  return { kind: 'mount', framework, file, line, path, fate: 'resolved' };
}
