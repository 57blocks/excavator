import { describe, expect, it } from 'vitest';

import { GRAPH_FORMAT, parseGraphJsonl } from '../src/data/graph';
import { summarizeGraph } from '../src/lib/overview';

/** A knowledge-graph JSONL text with the given node and edge types. */
function graphJsonl({ name = 'fixture', nodes = [] as string[], edges = [] as string[], gaps = [] as object[], coverage = undefined as object | undefined } = {}) {
  const lines: object[] = [{
    record: 'header',
    format: GRAPH_FORMAT,
    keys: ['project', 'nodes', 'edges', 'gaps', ...(coverage ? ['coverage'] : [])],
    fields: { project: { name, languages: ['javascript'], frameworks: ['express'], description: 'a fixture' }, kind: 'knowledge' },
    counts: { nodes: nodes.length, edges: edges.length, gaps: gaps.length },
  }];
  nodes.forEach((type, i) => lines.push({ record: 'node', node: { id: `n${i}`, type, name: `n${i}` } }));
  edges.forEach((type, i) => lines.push({ record: 'edge', edge: { source: 'n0', target: `n${i}`, type } }));
  gaps.forEach((gap) => lines.push({ record: 'gap', gap }));
  if (coverage) lines.push({ record: 'coverage', coverage });
  return `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;
}

const summarize = (text: string) => summarizeGraph(parseGraphJsonl(text));

describe('Products page counts', () => {
  it('counts nodes and edges by type from the records', () => {
    const summary = summarize(graphJsonl({
      nodes: ['file', 'function', 'function', 'class', 'file', 'function'],
      edges: ['calls', 'imports', 'calls'],
      gaps: [{ kind: 'dynamic-call', scope: 'a', reason: 'r', count: 3 }, { kind: 'dynamic-call', scope: 'b', reason: 'r', count: 2 }, { kind: 'parse', scope: 'c', reason: 'r', count: 1 }],
      coverage: {
        files: 10,
        ignored: 4,
        byLanguage: {
          python: { files: 3, parsed: 2, zeroSymbol: 1, skipped: {}, kinds: { function: 7, class: 1, import: 0, export: 0, call: 0 } },
          go: { files: 7, parsed: 4, zeroSymbol: 0, skipped: { 'too-large': 2, sensitive: 1 }, kinds: { function: 9, class: 0, import: 0, export: 0, call: 0 } },
        },
      },
    }));
    expect(summary.totals).toEqual({ nodes: 6, edges: 3, gaps: 3 });
    expect(summary.nodesByType).toEqual([{ type: 'function', count: 3 }, { type: 'file', count: 2 }, { type: 'class', count: 1 }]);
    expect(summary.edgesByType).toEqual([{ type: 'calls', count: 2 }, { type: 'imports', count: 1 }]);
    expect(summary.gapsByKind).toEqual([{ kind: 'dynamic-call', records: 2, count: 5 }, { kind: 'parse', records: 1, count: 1 }]);
    expect(summary.project).toMatchObject({ name: 'fixture', languages: ['javascript'], frameworks: ['express'] });
    expect(summary.coverage?.files).toBe(10);
    expect(summary.coverage?.ignored).toBe(4);
    expect(summary.coverage?.languages.map((l) => [l.language, l.files, l.parsed, l.zeroSymbol, l.skipped, l.functions])).toEqual([
      ['go', 7, 4, 0, 3, 9], ['python', 3, 2, 1, 0, 7],
    ]);
    expect(summary.notes).toEqual([]);
  });

  it('counts the records, not the header, and says when they differ', () => {
    const lines = graphJsonl({ nodes: ['file', 'file'] }).trimEnd().split('\n');
    const header = JSON.parse(lines[0]);
    header.counts.nodes = 99;
    const summary = summarize([JSON.stringify(header), ...lines.slice(1)].join('\n'));
    expect(summary.totals.nodes).toBe(2);
    expect(summary.notes).toEqual(['The header states 99 nodes; 2 records are in the file.']);
  });

  it('does not count a record it cannot use, and says how many', () => {
    const header = { record: 'header', format: GRAPH_FORMAT, keys: [], fields: {}, counts: { nodes: 2, edges: 1 } };
    const summary = summarize([
      JSON.stringify(header),
      JSON.stringify({ record: 'node', node: { id: 'a', type: 'file', name: 'a' } }),
      JSON.stringify({ record: 'node', node: { id: 'b' } }),
      JSON.stringify({ record: 'edge', edge: { source: 'a', target: 'b' } }),
      '{broken',
      '',
      JSON.stringify({ record: 'mystery' }),
    ].join('\n'));
    expect(summary.totals).toEqual({ nodes: 1, edges: 0, gaps: 0 });
    expect(summary.notes).toEqual(['4 line(s) of the graph file could not be used as records and are not counted.']);
    expect(summary.coverage).toBeNull();
    expect(summary.project.languages).toEqual([]);
  });

  it('keeps hostile names as plain strings', () => {
    const hostile = '</script><img onerror=x>';
    const summary = summarize(graphJsonl({ name: hostile, nodes: [hostile] }));
    expect(summary.project.name).toBe(hostile);
    expect(summary.nodesByType[0].type).toBe(hostile);
  });

  it('ranks types of equal count by name', () => {
    expect(summarize(graphJsonl({ nodes: ['b', 'a', 'c'] })).nodesByType.map((r) => r.type)).toEqual(['a', 'b', 'c']);
  });

  it('gives a graph with no header no counts: the page cannot read it', () => {
    expect(() => parseGraphJsonl(`${JSON.stringify({ record: 'node', node: { type: 'file' } })}\n`)).toThrow(/header/);
  });
});
