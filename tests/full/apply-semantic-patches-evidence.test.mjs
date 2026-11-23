// A semantic patch is committed only when it quotes a line of its node's own
// slice that is not the declaration line (openspec: changes/semantic-read-evidence,
// D2). The quote is the deterministic floor against a summary written from
// the node's name without reading its source.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { applySemanticPatches } from '../../skills/excavator/apply-semantic-patches.mjs';
import { readKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { checkReadEvidence } from '../../skills/excavator/read-evidence.mjs';

const SOURCE = [
  'export function run(): void {',
  "  const label = 'run the fixture';",
  '  console.log(label);',
  '}',
  'export function one(): number { return 1; }',
  '',
].join('\n');

describe('checkReadEvidence', () => {
  const lines = SOURCE.split('\n').slice(0, 5);
  const run = { lineRange: [1, 4] };
  const check = (evidence, node = run) => checkReadEvidence({ evidence, node, lines });

  it('accepts a verbatim quote from a body line', () => {
    expect(check({ line: 2, quote: "const label = 'run the fixture';" })).toEqual({ ok: true });
  });
  it('accepts a quote whose spacing differs from the line only in whitespace runs', () => {
    expect(check({ line: 2, quote: "const  label =   'run the fixture'" })).toEqual({ ok: true });
  });
  it('refuses a patch with no evidence', () => {
    expect(check(undefined)).toEqual({ ok: false, status: 'evidence-missing' });
    expect(check({ line: '2', quote: 'console.log(label);' })).toEqual({ ok: false, status: 'evidence-missing' });
    expect(check({ line: 3, quote: 'console.log(label);\n}' })).toEqual({ ok: false, status: 'evidence-missing' });
  });
  it('refuses a line outside the node', () => {
    expect(check({ line: 5, quote: 'export function one()' })).toEqual({ ok: false, status: 'evidence-line-outside-range' });
  });
  it('refuses the declaration line of a multi-line node', () => {
    expect(check({ line: 1, quote: 'export function run(): void {' })).toEqual({ ok: false, status: 'evidence-declaration-line' });
  });
  it('accepts the only line of a one-line node', () => {
    expect(check({ line: 5, quote: 'return 1;' }, { lineRange: [5, 5] })).toEqual({ ok: true });
  });
  it('refuses a quote with no letter or digit, or a fragment shorter than the minimum', () => {
    expect(check({ line: 4, quote: '}' })).toEqual({ ok: false, status: 'evidence-quote-trivial' });
    expect(check({ line: 3, quote: 'log' })).toEqual({ ok: false, status: 'evidence-quote-trivial' });
  });
  it('accepts a short line quoted whole', () => {
    expect(checkReadEvidence({ evidence: { line: 2, quote: 'x=1' }, node: { lineRange: [1, 3] }, lines: ['f(){', 'x=1', '}'] }))
      .toEqual({ ok: true });
  });
  it('refuses a quote that is not on the cited line', () => {
    expect(check({ line: 3, quote: "const label = 'run the fixture';" })).toEqual({ ok: false, status: 'evidence-quote-not-on-line' });
    expect(check({ line: 2, quote: 'performs the run operation' })).toEqual({ ok: false, status: 'evidence-quote-not-on-line' });
  });
  it('refuses when the source cannot be read', () => {
    expect(checkReadEvidence({ evidence: { line: 2, quote: 'console.log(label);' }, node: run, lines: null }))
      .toEqual({ ok: false, status: 'evidence-source-unreadable' });
  });
  it('lets a node without a lineRange cite any line of its file head, the first included', () => {
    expect(checkReadEvidence({ evidence: { line: 1, quote: 'export function run()' }, node: {}, lines }))
      .toEqual({ ok: true });
  });
});

describe('applySemanticPatches refuses a patch without read evidence', () => {
  let root;
  let graph;
  let runNode;
  let fileNode;
  let hash;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'apply-semantic-patches-evidence-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), SOURCE);
    await runLazyAnalysis({ projectRoot: root, now: () => '2024-01-01T00:00:00.000Z' });
    graph = readKnowledgeGraph(join(root, '.excavator', 'knowledge-graph.jsonl'));
    runNode = graph.nodes.find((n) => n.type === 'function' && n.name === 'run');
    fileNode = graph.nodes.find((n) => n.id === 'file:src/a.ts');
    expect(runNode.lineRange).toEqual([1, 4]);
    const manifest = JSON.parse(readFileSync(join(root, '.excavator', 'source-manifest.json'), 'utf-8'));
    hash = manifest.entries.find((e) => e.path === 'src/a.ts').contentHash;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const patch = (node, extra) => ({
    nodeId: node.id, filePath: node.filePath, summary: 'Logs a fixed label.', displayName: 'Log the label',
    tags: [], semanticSourceHash: hash, ...extra,
  });
  const cacheEntries = () => {
    const path = join(root, '.excavator', 'semantic-cache.json');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')).entries : {};
  };

  it('commits a patch that quotes a body line', async () => {
    const { committed, gaps } = await applySemanticPatches({
      projectRoot: root, factNodes: graph.nodes,
      patches: [patch(runNode, { evidence: { line: 3, quote: 'console.log(label);' } })],
    });
    expect(committed).toBe(1);
    expect(gaps).toEqual([]);
    expect(cacheEntries()[runNode.id].summary).toBe('Logs a fixed label.');
    expect(cacheEntries()[runNode.id].evidence).toBeUndefined();
  });

  it('commits a file-node patch that quotes any line of the file head', async () => {
    const { committed } = await applySemanticPatches({
      projectRoot: root, factNodes: graph.nodes,
      patches: [patch(fileNode, { displayName: 'Fixture module', evidence: { line: 1, quote: 'export function run(): void {' } })],
    });
    expect(committed).toBe(1);
  });

  for (const [label, evidence, status] of [
    ['no evidence', undefined, 'evidence-missing'],
    ['the declaration line', { line: 1, quote: 'export function run(): void {' }, 'evidence-declaration-line'],
    ['a line outside the node', { line: 5, quote: 'export function one(): number' }, 'evidence-line-outside-range'],
    ['a closing brace', { line: 4, quote: '}' }, 'evidence-quote-trivial'],
    ['words that are not on the line', { line: 2, quote: 'runs the fixture service' }, 'evidence-quote-not-on-line'],
  ]) {
    it(`never commits a patch citing ${label}, and records a gap`, async () => {
      const { committed, gaps, results } = await applySemanticPatches({
        projectRoot: root, factNodes: graph.nodes, patches: [patch(runNode, evidence ? { evidence } : {})],
      });
      expect(committed).toBe(0);
      expect(results[0]).toMatchObject({ nodeId: runNode.id, ok: false, status });
      const gap = gaps.find((g) => g.kind === 'semantic-patch-evidence-invalid');
      expect(gap).toMatchObject({ count: 1, samples: [runNode.id] });
      expect(cacheEntries()[runNode.id]).toBeUndefined();
    });
  }

  it('never commits when the source file is gone', async () => {
    unlinkSync(join(root, 'src', 'a.ts'));
    const { committed, results } = await applySemanticPatches({
      projectRoot: root, factNodes: graph.nodes,
      patches: [patch(runNode, { evidence: { line: 3, quote: 'console.log(label);' } })],
    });
    expect(committed).toBe(0);
    expect(results[0]).toMatchObject({ ok: false, status: 'evidence-source-unreadable' });
  });

  it('refuses to run without the fact nodes the evidence is checked against', async () => {
    await expect(applySemanticPatches({ projectRoot: root, patches: [] })).rejects.toThrow(/factNodes/);
  });
});
