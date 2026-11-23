// plan-semantic-batches.mjs: Phase F2 batches are packed by the source lines
// the analyzer must read, not by file count, so no batch hands the analyzer
// more code than it can read.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { planSemanticBatches, MAX_BATCH_NODES, MAX_BATCH_LINES } from '../../skills/excavator/plan-semantic-batches.mjs';
import { readRangeFor, FILE_HEAD_LINES } from '../../skills/excavator/read-evidence.mjs';
import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';

const SCRIPT = join(import.meta.dirname, '../../skills/excavator/plan-semantic-batches.mjs');

function fn(filePath, name, start, end) {
  return { id: `function:${filePath}:${name}()`, type: 'function', name, filePath, lineRange: [start, end] };
}
function fileNode(filePath) {
  return { id: `file:${filePath}`, type: 'file', name: filePath.split('/').pop(), filePath };
}
function plan(nodes, lineCounts, options = {}) {
  return planSemanticBatches({
    generate: nodes.map((n) => ({ nodeId: n.id, filePath: n.filePath })),
    nodes,
    lineCountOf: (p) => (Object.hasOwn(lineCounts, p) ? lineCounts[p] : null),
    ...options,
  });
}
function readLines(batch, lineCounts) {
  // Union of readRanges per file, summed: what the batch asks the analyzer to read.
  const byFile = new Map();
  for (const n of batch.nodes) {
    const set = byFile.get(n.filePath) ?? new Set();
    for (let l = n.readRange[0]; l <= n.readRange[1]; l++) set.add(l);
    byFile.set(n.filePath, set);
  }
  return [...byFile.values()].reduce((a, s) => a + s.size, 0);
}

describe('readRangeFor', () => {
  it('uses the lineRange when the node has one', () => {
    expect(readRangeFor({ lineRange: [12, 31] }, 100)).toEqual([12, 31]);
  });
  it('uses the head of the file when the node has no lineRange', () => {
    expect(readRangeFor({}, 2500)).toEqual([1, FILE_HEAD_LINES]);
    expect(readRangeFor({}, 40)).toEqual([1, 40]);
  });
  it('has no range for an empty or unreadable file', () => {
    expect(readRangeFor({}, 0)).toBeNull();
    expect(readRangeFor({ lineRange: [1, 3] }, null)).toBeNull();
  });
});

describe('planSemanticBatches', () => {
  it('splits a 300-node batch over long files so no batch exceeds either cap', () => {
    const nodes = [];
    const lineCounts = {};
    for (let f = 0; f < 23; f++) {
      const path = `svc/f${String(f).padStart(2, '0')}.js`;
      lineCounts[path] = f < 4 ? 2400 : 500;
      nodes.push(fileNode(path));
      const per = Math.ceil(277 / 23);
      const span = Math.floor(lineCounts[path] / per);
      for (let i = 0; i < per && nodes.length < 300; i++) nodes.push(fn(path, `h${i}`, i * span + 1, (i + 1) * span));
    }
    nodes.splice(300);
    expect(nodes).toHaveLength(300);
    const { batches, counts } = plan(nodes, lineCounts);
    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) {
      expect(b.nodes.length).toBeLessThanOrEqual(MAX_BATCH_NODES);
      if (!b.oversized) expect(readLines(b, lineCounts)).toBeLessThanOrEqual(MAX_BATCH_LINES);
      expect(b.sourceLines).toBe(readLines(b, lineCounts));
    }
    // Every node lands in exactly one batch.
    const ids = batches.flatMap((b) => b.nodes.map((n) => n.id));
    expect(new Set(ids).size).toBe(300);
    expect(counts).toMatchObject({ requested: 300, planned: 300, unreadable: 0 });
  });

  it('caps a batch at the node limit even when the lines are few', () => {
    const nodes = Array.from({ length: 41 }, (_, i) => fn('a.js', `f${i}`, i + 1, i + 1));
    const { batches } = plan(nodes, { 'a.js': 41 });
    expect(batches.map((b) => b.nodes.length)).toEqual([40, 1]);
  });

  it('counts lines a class and its methods share only once', () => {
    const nodes = [
      { id: 'class:a.js:A', type: 'class', name: 'A', filePath: 'a.js', lineRange: [1, 1000] },
      fn('a.js', 'm1', 2, 400),
      fn('a.js', 'm2', 401, 999),
    ];
    const { batches } = plan(nodes, { 'a.js': 1000 });
    expect(batches).toHaveLength(1);
    expect(batches[0].sourceLines).toBe(1000);
  });

  it('puts a node longer than the line cap alone in a batch marked oversized', () => {
    const nodes = [fn('a.js', 'small', 1, 10), fn('a.js', 'huge', 11, 2100), fn('a.js', 'tail', 2101, 2110)];
    const { batches } = plan(nodes, { 'a.js': 2110 });
    expect(batches.map((b) => b.nodes.map((n) => n.name))).toEqual([['small'], ['huge'], ['tail']]);
    expect(batches.map((b) => b.oversized)).toEqual([false, true, false]);
  });

  it('gives a file node only the head of its file to read', () => {
    const { batches } = plan([fileNode('big.js')], { 'big.js': 2500 });
    expect(batches[0].nodes[0].readRange).toEqual([1, FILE_HEAD_LINES]);
    expect(batches[0].oversized).toBe(false);
  });

  it('keeps a node whose file cannot be read in a visible bucket and dispatches nothing for it', () => {
    const nodes = [fn('gone.js', 'x', 1, 3), fileNode('empty.js'), fn('a.js', 'y', 2, 4)];
    const { batches, unreadable, counts } = plan(nodes, { 'a.js': 10, 'empty.js': 0 });
    expect(batches.flatMap((b) => b.nodes.map((n) => n.id))).toEqual(['function:a.js:y()']);
    expect(unreadable.map((u) => u.nodeId).sort()).toEqual(['file:empty.js', 'function:gone.js:x()']);
    expect(counts).toMatchObject({ requested: 3, planned: 1, unreadable: 2 });
  });

  it('records a generate entry with no fact node as unreadable, not dropped', () => {
    const { unreadable, counts } = planSemanticBatches({
      generate: [{ nodeId: 'function:a.js:ghost()', filePath: 'a.js' }], nodes: [], lineCountOf: () => 10,
    });
    expect(unreadable).toEqual([{ nodeId: 'function:a.js:ghost()', filePath: 'a.js', reason: 'unknown-node' }]);
    expect(counts.unreadable).toBe(1);
  });
});

describe('plan-semantic-batches.mjs CLI', () => {
  let root;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'plan-semantic-batches-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), 'export function run(): void {\n  console.log("run");\n}\n');
    await runLazyAnalysis({ projectRoot: root, now: () => '2024-01-01T00:00:00.000Z' });
    execFileSync(process.execPath, [join(import.meta.dirname, '../../skills/excavator/select-stale-semantics.mjs'), root], { stdio: 'pipe' });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('writes the plan and one input file per batch', () => {
    execFileSync(process.execPath, [SCRIPT, root], { stdio: 'pipe' });
    const inter = join(root, '.excavator', 'intermediate');
    const planFile = JSON.parse(readFileSync(join(inter, 'semantic-batches.json'), 'utf-8'));
    expect(planFile.totalBatches).toBe(planFile.batches.length);
    expect(planFile.totalBatches).toBeGreaterThan(0);
    const input = JSON.parse(readFileSync(join(inter, 'semantic-input-batch-0.json'), 'utf-8'));
    expect(input.batchIndex).toBe(0);
    const run = input.nodes.find((n) => n.name === 'run');
    expect(run).toMatchObject({ filePath: 'src/a.ts', lineRange: [1, 3], readRange: [1, 3] });
    expect(existsSync(join(inter, `semantic-input-batch-${planFile.totalBatches}.json`))).toBe(false);
  });
});
