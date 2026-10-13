// artifact-view tasks 7A.1-7A.4: every edge in a graph level's scope lands in
// one visible bucket (drawn, past the link limit, folded into "more", inside
// an item, at the file's own node, or outside the scope), and the buckets add
// up to a total counted independently. Hand-built segments with known counts:
// a file with 460 symbols (past the 400-item cap), a directory with known
// edges in and out, and a node with 500 callers for the per-hop quotas. Plus
// the legend's drawn / total rows.
import { describe, expect, it } from 'vitest';

import { GraphEngine, MAX_VISIBLE } from '../../packages/view/src/model/graph-model.ts';
import { bucketTotalsByType, ledgerReport, ledgerSums, neighborhoodReport } from '../../packages/view/src/model/edge-ledger.ts';
import { legendRows } from '../../packages/view/src/model/legend.ts';

/** Segments from `nodes: [{ id, path, type }]` and `edges: [[srcId, dstId, type]]`. */
function makeSegments(nodes, edges) {
  const strings = [];
  const cells = new Map();
  const cell = (s) => {
    if (s === null || s === undefined) return -1;
    if (!cells.has(s)) {
      cells.set(s, strings.length);
      strings.push(s);
    }
    return cells.get(s);
  };
  return {
    strings,
    nodes: {
      rows: nodes.length,
      columns: {
        id: Int32Array.from(nodes.map((n) => cell(n.id))),
        name: Int32Array.from(nodes.map((n) => cell(n.name ?? n.id))),
        path: Int32Array.from(nodes.map((n) => cell(n.path))),
        type: Int32Array.from(nodes.map((n) => cell(n.type))),
      },
    },
    edges: {
      rows: edges.length,
      columns: {
        src: Int32Array.from(edges.map((e) => cell(e[0]))),
        dst: Int32Array.from(edges.map((e) => cell(e[1]))),
        type: Int32Array.from(edges.map((e) => cell(e[2]))),
      },
    },
  };
}

const sum = (a) => a.reduce((n, c) => n + c, 0);
const byType = (types, perType) => Object.fromEntries(types.map((t, i) => [t, perType[i]]).filter(([, n]) => n > 0));

// One file, big/Big.java: its file node (row 0) and symbols s0..s459 (rows 1..460),
// plus two symbols in other/O.java (rows 461, 462).
//   ring:       s_i -calls-> s_(i+1 mod 460)          460 edges
//   references: s_i -references-> s_(i+200), i < 100  100 edges
//   contains:   file -contains-> s_i                   460 edges (the file node bucket)
//   imports:    s_i -imports-> o0, i < 10               10 edges (out of the file)
//   calls in:   o0 -calls-> s5                            1 edge  (into the file)
//   o0 -calls-> o1, and s0 -calls-> ghost (unresolved): not in this file's scope
// Degrees (every edge counts): s0..s9 5 (s5 6), s10..s99 and s200..s299 4, the rest 3.
// The 61 lightest (degree 3, latest rows first to go) are s399..s459, folded into "more".
// Collapsed: ring s398->s399, s399..s459 among themselves (60), s459->s0: 62.
// Drawn: 560 symbol-to-symbol edges minus 62 = 498.
function bigFile() {
  const N = 460;
  const nodes = [{ id: 'file:big/Big.java', path: 'big/Big.java', type: 'file' }];
  for (let i = 0; i < N; i += 1) nodes.push({ id: `s${i}`, path: 'big/Big.java', type: 'method' });
  nodes.push({ id: 'o0', path: 'other/O.java', type: 'method' }, { id: 'o1', path: 'other/O.java', type: 'method' });
  const edges = [];
  for (let i = 0; i < N; i += 1) edges.push([`s${i}`, `s${(i + 1) % N}`, 'calls']);
  for (let i = 0; i < 100; i += 1) edges.push([`s${i}`, `s${i + 200}`, 'references']);
  for (let i = 0; i < N; i += 1) edges.push(['file:big/Big.java', `s${i}`, 'contains']);
  for (let i = 0; i < 10; i += 1) edges.push([`s${i}`, 'o0', 'imports']);
  edges.push(['o0', 's5', 'calls'], ['o0', 'o1', 'calls'], ['s0', 'ghost', 'calls']);
  return makeSegments(nodes, edges);
}

describe('file level: 399 heaviest symbols plus "more", every edge accounted for (7A.1)', () => {
  const segments = bigFile();
  const engine = new GraphEngine(segments, segments.strings);
  const file = engine.fileView('big/Big.java');
  const T = file.types;

  it('keeps the 399 heaviest symbols in graph order and folds the 61 lightest', () => {
    expect(file).toMatchObject({ found: true, fileRow: 0, total: 460, folded: 61 });
    expect(file.rows).toHaveLength(MAX_VISIBLE - 1);
    expect(file.rows[0]).toBe(1);
    expect(file.rows.at(-1)).toBe(399); // s398
    expect(file.rows).toEqual([...file.rows].sort((a, b) => a - b));
  });

  it('puts each in-scope edge in exactly one bucket, matching the hand count', () => {
    const b = file.buckets;
    expect(byType(T, b.drawn)).toEqual({ calls: 398, references: 100 });
    expect(byType(T, b.collapsed)).toEqual({ calls: 62 });
    expect(byType(T, b.fileNode)).toEqual({ contains: 460 });
    expect(byType(T, b.outside)).toEqual({ calls: 1, imports: 10 });
    expect(sum(b.cut)).toBe(0);
    expect(sum(b.inside)).toBe(0);
    expect(byType(T, b.total)).toEqual({ calls: 461, contains: 460, imports: 10, references: 100 });
    const sums = ledgerSums(b);
    expect(sums).toMatchObject({ drawn: 498, cut: 0, collapsed: 62, inside: 0, fileNode: 460, outside: 11, total: 1031, balanced: true });
    expect(file.edges.length / 4).toBe(498);
    expect(file.edgesTotal).toBe(498);
  });

  it('draws the edges to folded symbols as links to the "more" item', () => {
    const more = file.rows.length;
    const links = [];
    for (let i = 0; i < file.moreLinks.length; i += 4) links.push([file.moreLinks[i], file.moreLinks[i + 1], T[file.moreLinks[i + 2]], file.moreLinks[i + 3]]);
    // s459 -> s0 arrives from "more"; s398 -> s399 leaves for it (index 398 is s398).
    expect(links).toEqual([[398, more, 'calls', 1], [more, 0, 'calls', 1]]);
    expect(file.moreInternal).toBe(60);
  });

  it('counts the edges leaving and entering the file from the fixture\'s known values (7A.4)', () => {
    expect(byType(T, file.outsideOut)).toEqual({ imports: 10 });
    expect(byType(T, file.outsideIn)).toEqual({ calls: 1 });
  });

  it('self-reports the ledger on data-graph-edges-* attributes', () => {
    expect(ledgerReport(ledgerSums(file.buckets))).toEqual({
      'data-graph-edges-total': 1031,
      'data-graph-edges-drawn': 498,
      'data-graph-edges-cut': 0,
      'data-graph-edges-collapsed': 62,
      'data-graph-edges-inside': 0,
      'data-graph-edges-file-node': 460,
      'data-graph-edges-outside': 11,
      'data-graph-edges-balanced': 'true',
    });
    expect(ledgerReport(null)['data-graph-edges-total']).toBeNull();
  });

  it('shows an unbalanced ledger as unbalanced (instrument check)', () => {
    const lost = { ...file.buckets, collapsed: file.buckets.collapsed.map(() => 0) };
    expect(ledgerSums(lost)).toMatchObject({ total: 1031, balanced: false });
  });
});

// Directory a/: a/x.ts (file node + x1), a/y.ts (file node + y1); outside it b/z.ts (z1, z2).
//   x1 -calls-> z1 (x3)       out of a/: calls 3
//   z1 -imports-> y1 (x2)     into a/:  imports 2
//   x1 -calls-> y1            between the two file items: drawn 1
//   a/x.ts -contains-> x1     inside the a/x.ts item: 1
//   z1 -calls-> z2            outside a/ entirely: not in its scope
describe('directory level: outside counts and the ledger (7A.1, 7A.4)', () => {
  const segments = makeSegments(
    [
      { id: 'file:a/x.ts', path: 'a/x.ts', type: 'file' },
      { id: 'x1', path: 'a/x.ts', type: 'function' },
      { id: 'file:a/y.ts', path: 'a/y.ts', type: 'file' },
      { id: 'y1', path: 'a/y.ts', type: 'function' },
      { id: 'z1', path: 'b/z.ts', type: 'function' },
      { id: 'z2', path: 'b/z.ts', type: 'function' },
    ],
    [
      ['x1', 'z1', 'calls'], ['x1', 'z1', 'calls'], ['x1', 'z1', 'calls'],
      ['z1', 'y1', 'imports'], ['z1', 'y1', 'imports'],
      ['x1', 'y1', 'calls'],
      ['file:a/x.ts', 'x1', 'contains'],
      ['z1', 'z2', 'calls'],
    ],
  );
  const engine = new GraphEngine(segments, segments.strings);
  const view = engine.graphView('a');

  it('counts the edges entering and leaving the directory from the fixture\'s known values', () => {
    expect(view.found).toBe(true);
    expect(byType(view.types, view.outsideIn)).toEqual({ imports: 2 });
    expect(byType(view.types, view.outsideOut)).toEqual({ calls: 3 });
  });

  it('balances drawn + inside + outside against the independent total', () => {
    expect(ledgerSums(view.buckets)).toMatchObject({ drawn: 1, cut: 0, collapsed: 0, inside: 1, fileNode: 0, outside: 5, total: 7, balanced: true });
    expect(Object.fromEntries(bucketTotalsByType(view.types, view.buckets))).toEqual({ calls: 4, contains: 1, imports: 2 });
  });

  it('accounts for every edge at the member level too', () => {
    const member = engine.graphView(null);
    expect(ledgerSums(member.buckets)).toMatchObject({ outside: 0, total: 8, balanced: true });
  });
});

// Node C with 500 callers p0..p499; p0..p49 each have one caller q_i (two hops
// from C); r -calls-> q0 is three hops away.
describe('neighborhood: per-hop quotas and edges to undrawn nodes (7A.1, 7A.3)', () => {
  const nodes = [{ id: 'C', path: 'c/C.java', type: 'method' }];
  const edges = [];
  for (let i = 0; i < 500; i += 1) {
    nodes.push({ id: `p${i}`, path: `p/P${i}.java`, type: 'method' });
    edges.push([`p${i}`, 'C', 'calls']);
  }
  for (let i = 0; i < 50; i += 1) {
    nodes.push({ id: `q${i}`, path: `q/Q${i}.java`, type: 'method' });
    edges.push([`q${i}`, `p${i}`, 'calls']);
  }
  nodes.push({ id: 'r', path: 'r/R.java', type: 'method' });
  edges.push(['r', 'q0', 'calls']);
  const segments = makeSegments(nodes, edges);
  const engine = new GraphEngine(segments, segments.strings);

  it('keeps two-hop nodes in view when one hop alone would fill 400', () => {
    const two = engine.neighborhoodView(0, 2, null);
    expect(two.hopTotals).toEqual([1, 500, 50]);
    expect(two.hopDrawn).toEqual([1, 348, 50]);
    expect(two.rows).toHaveLength(MAX_VISIBLE - 1);
    expect(two.distance.filter((d) => d === 2)).toHaveLength(50);
    expect(two).toMatchObject({ total: 551, folded: 152 });
    expect(ledgerSums(two.buckets)).toMatchObject({ drawn: 398, collapsed: 152, outside: 1, cut: 0, total: 551, balanced: true });
    expect(neighborhoodReport(two)).toEqual({
      'data-neighborhood-hop1': '348/500',
      'data-neighborhood-hop2': '50/50',
      'data-neighborhood-folded': 152,
    });
  });

  it('gives one hop the room when there is no second hop', () => {
    const one = engine.neighborhoodView(0, 1, null);
    expect(one.hopTotals).toEqual([1, 500]);
    expect(one.hopDrawn).toEqual([1, 398]);
    expect(one.folded).toBe(102);
    expect(ledgerSums(one.buckets)).toMatchObject({ drawn: 398, collapsed: 102, total: 500 + 50, outside: 50, balanced: true });
    expect(neighborhoodReport(one)['data-neighborhood-hop2']).toBeNull();
  });

  it('draws everything and folds nothing under the cap', () => {
    const small = engine.neighborhoodView(1, 2, null); // p0: C, q0 (1 hop); 499 callers of C and r (2 hops)
    expect(small.hopTotals).toEqual([1, 2, 500]);
    expect(ledgerSums(small.buckets).balanced).toBe(true);
  });
});

describe('edge legend rows: drawn / total per type (7A.2)', () => {
  it('shows drawn and total per legend key, folding unlisted types into "other"', () => {
    const rows = legendRows(new Map([['inherits', 3], ['calls', 10]]), new Map([['inherits', 26], ['calls', 10], ['depends-on', 4]]), new Set());
    const get = (k) => rows.find((r) => r.key === k);
    expect(get('inherits')).toMatchObject({ drawn: 3, total: 26, off: false, disabled: false });
    expect(get('calls')).toMatchObject({ drawn: 10, total: 10 });
    expect(get('other')).toMatchObject({ drawn: 0, total: 4, otherTypes: ['depends-on'], disabled: false });
    expect(get('imports')).toMatchObject({ drawn: 0, total: 0, disabled: true });
  });

  it('keeps a type switchable when none of its edges is drawn but the scope has some', () => {
    const rows = legendRows(new Map(), new Map([['inherits', 26]]), new Set());
    expect(rows.find((r) => r.key === 'inherits')).toMatchObject({ drawn: 0, total: 26, disabled: false });
    const off = legendRows(new Map(), new Map(), new Set(['calls']));
    expect(off.find((r) => r.key === 'calls')).toMatchObject({ off: true, disabled: false });
  });
});
