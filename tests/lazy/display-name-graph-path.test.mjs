// The legacy graph-mode path (openspec: changes/node-display-name, design decision 7):
// a Lazy re-projection keeps a node's displayName, and validate-graph reports a missing
// or malformed one as a visible issue without failing.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mergeFactProjectionIntoGraph } from '../../skills/excavator/lazy-analyze.mjs';
import { createSourceReader, validateAgainstSource } from '../../skills/excavator/validate-graph.mjs';

const node = (id, extra = {}) => ({
  id, type: 'function', name: id.split(':').pop(), summary: 'Does a thing.', tags: ['t'], complexity: 'simple', ...extra,
});

describe('mergeFactProjectionIntoGraph keeps displayName', () => {
  it('re-projects a node without losing its displayName', () => {
    const existing = { nodes: [node('function:a.ts:run', { filePath: 'a.ts', displayName: 'Run the job' })], edges: [] };
    const projection = { nodes: [{ id: 'function:a.ts:run', type: 'function', name: 'run', filePath: 'a.ts', lineRange: [2, 4] }], edges: [] };
    const merged = mergeFactProjectionIntoGraph(existing, projection);
    expect(merged.nodes.find((n) => n.id === 'function:a.ts:run').displayName).toBe('Run the job');
  });
});

describe('validate-graph checks displayName', () => {
  const root = mkdtempSync(join(tmpdir(), 'excavator-display-name-'));
  const run = (nodes) => validateAgainstSource({
    graph: { version: '1.0.0', project: { name: 'p', languages: [] }, nodes, edges: [], layers: [], tour: [] },
    reader: createSourceReader(root),
  }).report;
  const all = (report) => [...report.issues, ...report.warnings];

  it('accepts a good displayName with no mention of it', () => {
    expect(all(run([node('function:a.ts:run', { displayName: 'Run the job' })])).filter((m) => /displayName/.test(m))).toEqual([]);
  });

  it('reports a bad shape (one word, 61 characters, newline) as a visible issue naming the node', () => {
    const bad = ['Run', 'x'.repeat(30) + ' ' + 'y'.repeat(30), 'Run\nthe job'];
    for (const [i, value] of bad.entries()) {
      const messages = all(run([node(`function:a.ts:f${i}`, { displayName: value })])).filter((m) => /displayName/.test(m));
      expect(messages.length, JSON.stringify(value)).toBe(1);
      expect(messages[0]).toContain(`function:a.ts:f${i}`);
      expect(messages[0]).toContain('display-name-shape');
    }
  });

  it('reports a missing displayName as a warning, not a failing issue', () => {
    const report = run([node('function:a.ts:run')]);
    expect(report.warnings.some((m) => /displayName/.test(m) && m.includes('function:a.ts:run'))).toBe(true);
    expect(report.issues.some((m) => /displayName/.test(m))).toBe(false);
  });

  it('cleanup', () => rmSync(root, { recursive: true, force: true }));
});
