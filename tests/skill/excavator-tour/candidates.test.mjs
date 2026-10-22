import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { computeCandidates } from '../../../skills/excavator/tour-candidates.mjs';
import {
  OTHER_DIGEST, clearProducts, configNode, edge, fileNode, fnNode, imports, makeGitProject, makeMultiRepoProject, manyPaths,
  writeDomain, writeGraph, writeManifest, writeSemantics,
} from './fixture.mjs';

const TOUR = join(process.cwd(), 'skills', 'excavator', 'tour.mjs');

let project;
beforeAll(() => {
  project = makeGitProject();
});
afterAll(() => project.cleanup());
beforeEach(() => clearProducts(project.root));

const candidates = (root = project.root) => computeCandidates(root);
const byId = (product, id) => product.candidates.find((candidate) => candidate.id === id);
/** Candidate ids carrying a reason that starts with `prefix`, in the product's order. */
const idsWith = (product, prefix) => product.candidates.filter((c) => c.reasons.some((r) => r.startsWith(prefix))).map((c) => c.id);
const files = (...paths) => paths.map((path) => `file:${path}`);

describe('entry candidates', () => {
  // 20 code files. Fan-out: srv, deep and hub 5, main and the six lib files 1, the rest 0. Fan-in: hub 6, lib 3-4, the rest 0.
  const libs = ['lib/l1.go', 'lib/l2.go', 'lib/l3.go', 'lib/l4.go', 'lib/l5.go'];
  const graph = () => writeGraph(project.root, {
    paths: ['main.go', 'cmd/srv.go', 'cmd/deep/er/x.go', 'lib/hub.go', ...libs, 'lib/l6.go', ...manyPaths('lib', 10, 'z')],
    edges: [
      imports('main.go', 'lib/l1.go'),
      ...libs.flatMap((to) => [imports('cmd/srv.go', to), imports('cmd/deep/er/x.go', to), imports('lib/hub.go', to)]),
      ...[...libs, 'lib/l6.go'].map((from) => imports(from, 'lib/hub.go')),
    ],
  });

  it('takes entry-named files and shallow files with top fan-out and bottom fan-in, not deep files or files others import', () => {
    graph();
    const product = candidates();
    // main.go by name; cmd/srv.go by shape. cmd/deep/er/x.go has the same shape three directories down; lib/hub.go has fan-in 6.
    expect(idsWith(product, 'entry:')).toEqual(files('cmd/srv.go', 'main.go'));
    expect(byId(product, 'file:cmd/srv.go').reasons[0]).toBe('entry: entry-shape (rank 1, fan-out 5, fan-in 0)');
    expect(byId(product, 'file:main.go').reasons[0]).toBe('entry: entry-name (rank 2, fan-out 1, fan-in 0)');
    expect(product.classes.entry).toEqual({ total: 2, listed: 2, truncated: 0 });
    // The walk starts from main.go although cmd/srv.go has the higher fan-out: file name tier comes first.
    expect(product.classes.bfs.starts).toEqual([{ member: '(project)', start: 'main.go' }]);
  });

  it('names main, server, app and index in any case and code extension, and not other files with those stems', () => {
    writeGraph(project.root, { paths: ['ui/main.tsx', 'ui/App.tsx', 'ui/Server.mjs', 'ui/index.css', 'ui/app.json', 'ui/app.test.tsx', 'ui/main'] });
    expect(idsWith(candidates(), 'entry:').sort()).toEqual(files('ui/App.tsx', 'ui/Server.mjs', 'ui/main.tsx'));
  });

  it('counts the entries a quota cuts', () => {
    writeGraph(project.root, { paths: Array.from({ length: 32 }, (_, i) => `d${String(i).padStart(2, '0')}/main.go`) });
    const product = candidates();
    expect(product.classes.entry).toEqual({ total: 32, listed: 30, truncated: 2 });
    expect(idsWith(product, 'entry:')).toHaveLength(30);
  });

  it('measures the depth from the member repository root in a multi-repo project', () => {
    const multi = makeMultiRepoProject({ svcA: { 'a.txt': 'a\n' }, svcB: { 'b.txt': 'b\n' } });
    try {
      const libsA = ['svcA/lib/l1.go', 'svcA/lib/l2.go', 'svcA/lib/l3.go', 'svcA/lib/l4.go', 'svcA/lib/l5.go'];
      writeGraph(multi.root, {
        paths: ['svcA/cmd/api/handler.go', 'svcB/a/b/c/handler.go', ...libsA, ...manyPaths('svcA/lib', 13, 'z')],
        edges: libsA.flatMap((to) => [imports('svcA/cmd/api/handler.go', to), imports('svcB/a/b/c/handler.go', to)]),
      });
      const product = candidates(multi.root);
      // svcA/cmd/api/handler.go is two directories below its member root (three from the project root); svcB's is three below.
      expect(idsWith(product, 'entry:')).toEqual(['file:svcA/cmd/api/handler.go']);
    } finally {
      multi.cleanup();
    }
  });
});

describe('fan-in and fan-out', () => {
  it('lifts edges to files, counts distinct files, and keeps same-named files at different paths apart', () => {
    const calls = (from, to) => edge(from.id, to.id, 'calls');
    const a1 = fnNode('a/util.go', 'One');
    const a2 = fnNode('a/util.go', 'Two');
    const a3 = fnNode('a/util.go', 'Three');
    const b1 = fnNode('b/util.go', 'One');
    const s0 = fnNode('s0.go', 'run');
    const s1 = fnNode('s1.go', 'run');
    const s2 = fnNode('s2.go', 'run');
    writeGraph(project.root, {
      paths: ['a/util.go', 'b/util.go', 's0.go', 's1.go', 's2.go'],
      nodes: [a1, a2, a3, b1, s0, s1, s2],
      edges: [
        // s0 reaches a/util.go through four edges (three calls and an import): one file, so fan-in counts it once.
        calls(s0, a1), calls(s0, a2), calls(s0, a3), imports('s0.go', 'a/util.go'),
        calls(s1, a1),
        calls(s2, b1),
        // A call inside a/util.go is no dependency between files.
        calls(a1, a2),
      ],
    });
    const product = candidates();
    expect(idsWith(product, 'fan-in:')).toEqual(files('a/util.go', 'b/util.go'));
    expect(byId(product, 'file:a/util.go').reasons).toContain('fan-in: rank 1 with 2 file(s)');
    expect(byId(product, 'file:b/util.go').reasons).toContain('fan-in: rank 2 with 1 file(s)');
    expect(idsWith(product, 'fan-out:')).toEqual(files('s0.go', 's1.go', 's2.go'));
    expect(byId(product, 'file:s0.go').reasons).toContain('fan-out: rank 1 with 1 file(s)');
    expect(product.sources.graph.ignoredEdges).toMatchObject({ sameFile: 1, unresolved: 0, nonCode: 0 });
  });

  it('lists the top 20 of each and says how many the quota cut', () => {
    // t_k is imported by the first k+1 of 30 sources (fan-in 1..25); s_j imports t_k for k >= j (fan-out 25 - j for j < 25).
    const targets = manyPaths('t', 25, 't');
    const sources = manyPaths('s', 30, 's');
    writeGraph(project.root, {
      paths: [...targets, ...sources],
      edges: sources.flatMap((from, j) => targets.filter((_, k) => j <= k).map((to) => imports(from, to))),
    });
    const product = candidates();
    expect(product.classes.fanIn).toEqual({ total: 25, listed: 20, truncated: 5 });
    expect(product.classes.fanOut).toEqual({ total: 25, listed: 20, truncated: 5 });
    expect(idsWith(product, 'fan-in:')).toEqual(files(...targets.slice(5).reverse()));
    expect(idsWith(product, 'fan-out:').sort()).toEqual(files(...sources.slice(0, 20)).sort());
  });
});

describe('reading order', () => {
  // main.go (4 imports) -> c1 -> c2 -> c3 -> c4, main.go -> c1b, x1, x2; rev.go imports main.go.
  const chain = () => writeGraph(project.root, {
    paths: ['main.go', 'c1.go', 'c1b.go', 'c2.go', 'c3.go', 'c4.go', 'rev.go', 'x1.go', 'x2.go', ...manyPaths('pad', 11)],
    edges: [
      imports('main.go', 'c1.go'), imports('main.go', 'c1b.go'), imports('main.go', 'x1.go'), imports('main.go', 'x2.go'),
      imports('c1.go', 'c2.go'), imports('c2.go', 'c3.go'), imports('c3.go', 'c4.go'), imports('rev.go', 'main.go'),
    ],
  });

  it('walks forward from the best entry to depth 3 and records the depth', () => {
    chain();
    const product = candidates();
    expect(product.classes.bfs.starts).toEqual([{ member: '(project)', start: 'main.go' }]);
    const step = (c) => c.reasons.find((r) => r.startsWith('reading-order'));
    const reading = product.candidates.filter(step).sort((a, b) => Number(step(a).match(/step (\d+)/)[1]) - Number(step(b).match(/step (\d+)/)[1]));
    expect(reading.map((c) => [c.id, step(c)])).toEqual([
      ['file:main.go', 'reading-order (project): step 1, depth 0'],
      ['file:c1.go', 'reading-order (project): step 2, depth 1'],
      ['file:c1b.go', 'reading-order (project): step 3, depth 1'],
      ['file:x1.go', 'reading-order (project): step 4, depth 1'],
      ['file:x2.go', 'reading-order (project): step 5, depth 1'],
      ['file:c2.go', 'reading-order (project): step 6, depth 2'],
      ['file:c3.go', 'reading-order (project): step 7, depth 3'],
    ]);
  });

  it('never follows an edge backwards and stops at depth 3', () => {
    chain();
    const product = candidates();
    const ids = idsWith(product, 'reading-order');
    expect(ids).not.toContain('file:rev.go');
    expect(ids).not.toContain('file:c4.go');
    expect(ids).toContain('file:c3.go');
    expect(product.classes.bfs).toMatchObject({ total: 7, listed: 7, truncated: 0 });
  });

  it('lists at most 60 files and counts the rest', () => {
    const leaves = manyPaths('lib', 70);
    writeGraph(project.root, { paths: ['main.go', ...leaves], edges: leaves.map((to) => imports('main.go', to)) });
    const product = candidates();
    expect(product.classes.bfs).toMatchObject({ total: 71, listed: 60, truncated: 11 });
    const ids = idsWith(product, 'reading-order');
    expect(ids).toHaveLength(60);
    expect(ids).toContain('file:lib/f58.go');
    expect(ids).not.toContain('file:lib/f59.go');
  });

  it('has no reading order, and says so, when there is no entry', () => {
    writeGraph(project.root, { paths: ['a.go', 'b.go'], edges: [] });
    const product = candidates();
    expect(product.classes.bfs).toMatchObject({ total: 0, listed: 0, truncated: 0, starts: [], membersWithoutStart: ['(project)'] });
    expect(product.gaps).toContain('There is no entry candidate, so there is no reading order.');
  });
});

describe('reading order across member repos', () => {
  let multi;
  beforeAll(() => {
    multi = makeMultiRepoProject(Object.fromEntries(['svcA', 'svcB', 'svcC', 'svcD', 'svcE', 'svcF'].map((name) => [name, { 'x.txt': 'x\n' }])));
  });
  afterAll(() => multi.cleanup());
  beforeEach(() => clearProducts(multi.root));

  /** Entry files of a member, each importing the first `n` of the member's lib files; `n` is its fan-out. */
  const member = (name, entries, extraPaths = []) => {
    const libs = manyPaths(`${name}/lib`, 12, 'l');
    return {
      paths: [...Object.keys(entries).map((entry) => `${name}/${entry}`), ...libs, ...extraPaths],
      edges: Object.entries(entries).flatMap(([entry, n]) => libs.slice(0, n).map((to) => imports(`${name}/${entry}`, to))),
    };
  };
  const merge = (...parts) => ({ paths: parts.flatMap((part) => part.paths), edges: parts.flatMap((part) => part.edges) });

  it('starts each member from its most entry-like file: main.* > server.* > app.* > index.* > other entries, then fan-out', () => {
    writeGraph(multi.root, merge(
      member('svcA', { 'index.ts': 9, 'app.js': 8, 'server.js': 7, 'main.go': 1 }), // main wins with the lowest fan-out
      member('svcB', { 'index.js': 9, 'app.js': 2, 'manage.py': 11 }), // app beats a higher-fan-out index
      member('svcC', { 'app.py': 9, 'server.js': 1, 'manage.py': 11 }), // server beats a higher-fan-out app
      member('svcD', { 'index.ts': 2, 'manage.py': 11 }), // index beats a higher-fan-out other entry
      member('svcE', { 'manage.py': 3, 'Program.cs': 7 }), // inside the other tier, the higher fan-out
    ));
    const product = candidates(multi.root);
    expect(product.classes.bfs.starts).toEqual([
      { member: 'svcA', start: 'svcA/main.go' },
      { member: 'svcB', start: 'svcB/app.js' },
      { member: 'svcC', start: 'svcC/server.js' },
      { member: 'svcD', start: 'svcD/index.ts' },
      { member: 'svcE', start: 'svcE/Program.cs' },
    ]);
  });

  it('starts only from an entry with fan-out of at least 1', () => {
    writeGraph(multi.root, merge(
      member('svcA', { 'main.go': 0, 'server.js': 2 }), // main.go imports nothing, so server.js starts the walk
      member('svcB', { 'main.go': 0 }), // its only entry reads nothing: no start, said so
    ));
    const product = candidates(multi.root);
    expect(idsWith(product, 'entry:')).toContain('file:svcB/main.go');
    expect(product.classes.bfs.starts).toEqual([{ member: 'svcA', start: 'svcA/server.js' }]);
    expect(product.classes.bfs.membersWithoutStart).toContain('svcB');
  });

  it('prefers the shallower directory inside a tier, before fan-out', () => {
    writeGraph(multi.root, merge(
      member('svcA', { 'index.ts': 2, 'src/deep/index.ts': 9 }), // two directories deeper but more fan-out: loses
      member('svcB', { 'src/index.ts': 3, 'src/ui/index.ts': 9, 'lib/index.js': 5 }), // one level: src/index.ts and lib/index.js tie on depth, fan-out 5 > 3
    ));
    const product = candidates(multi.root);
    expect(product.classes.bfs.starts).toEqual([
      { member: 'svcA', start: 'svcA/index.ts' },
      { member: 'svcB', start: 'svcB/lib/index.js' },
    ]);
  });

  it('names a member with code but no entry candidate and lists no reading order for it', () => {
    writeGraph(multi.root, merge(member('svcA', { 'main.go': 3 }), member('svcF', {})));
    const product = candidates(multi.root);
    expect(product.classes.bfs.starts).toEqual([{ member: 'svcA', start: 'svcA/main.go' }]);
    expect(product.classes.bfs.membersWithoutStart).toEqual(['svcF']);
    expect(idsWith(product, 'reading-order svcF')).toEqual([]);
    expect(idsWith(product, 'reading-order svcA')).toEqual(files('svcA/main.go', 'svcA/lib/l00.go', 'svcA/lib/l01.go', 'svcA/lib/l02.go'));
  });

  it('interleaves the walks under the 60-file cap so every member keeps its start and nearest files', () => {
    const wide = (name) => {
      const leaves = manyPaths(`${name}/lib`, 50, 'l');
      return { paths: [`${name}/main.go`, ...leaves], edges: leaves.map((to) => imports(`${name}/main.go`, to)) };
    };
    writeGraph(multi.root, merge(wide('svcA'), wide('svcB')));
    const product = candidates(multi.root);
    expect(product.classes.bfs).toMatchObject({ total: 102, listed: 60, truncated: 42 });
    expect(idsWith(product, 'reading-order svcA')).toHaveLength(30);
    expect(idsWith(product, 'reading-order svcB')).toHaveLength(30);
    expect(idsWith(product, 'reading-order svcB')).toContain('file:svcB/main.go');
  });
});

describe('layer representatives', () => {
  // L_k is imported by the first k of seven sources (fan-in k); the layer holds L0..L7, the first through its function node.
  const members = manyPaths('layer', 8, 'L');
  const sources = manyPaths('src', 7, 's');
  const graph = (layers) => writeGraph(project.root, {
    paths: [...members, ...sources],
    nodes: [fnNode('layer/L07.go', 'Run')],
    edges: sources.flatMap((from, j) => members.filter((_, k) => j < k).map((to) => imports(from, to))),
    layers,
  });
  const layer = { id: 'layer:core', name: 'Core', description: 'The core.', nodeIds: [...files(...members.slice(0, 7)), 'function:layer/L07.go:Run', 'file:gone.go'] };

  it('takes the five files with the highest fan-in in each layer, from the semantic graph', () => {
    graph([]);
    writeManifest(project.root, { 'layer/L00.go': 'h0' });
    writeSemantics(project.root, { 'file:layer/L00.go': { summary: 'Zero.', semanticSourceHash: 'h0' } }, { layers: [layer] });
    const product = candidates();
    expect(product.sources.layers).toEqual({ source: 'semantic-graph', count: 1 });
    expect(idsWith(product, 'layer layer:core:')).toEqual(files('layer/L07.go', 'layer/L06.go', 'layer/L05.go', 'layer/L04.go', 'layer/L03.go'));
    expect(byId(product, 'file:layer/L07.go').reasons).toContain('layer layer:core: rank 1 with fan-in 7');
    expect(byId(product, 'file:layer/L07.go').layer).toBe('layer:core');
    // L00..L06 and the function's file are layer files (L07 once); the quota cuts three; one node id is not in the graph.
    expect(product.classes.layer).toEqual({ total: 8, listed: 5, truncated: 3 });
    expect(product.layers).toEqual([{ id: 'layer:core', name: 'Core', description: 'The core.' }]);
    expect(product.gaps).toContain('1 layer node id(s) are not nodes of the knowledge graph.');
  });

  it('falls back to the knowledge graph\'s own layer records when there is no semantic graph', () => {
    graph([layer]);
    const product = candidates();
    expect(product.sources.layers).toEqual({ source: 'knowledge-graph', count: 1 });
    expect(idsWith(product, 'layer layer:core:')).toHaveLength(5);
  });

  it('says there are no layers when neither source has any', () => {
    graph([]);
    const product = candidates();
    expect(product.sources.layers).toEqual({ source: 'none', count: 0 });
    expect(product.classes.layer).toEqual({ total: 0, listed: 0, truncated: 0 });
    expect(product.gaps).toContain('There are no layers (no semantic graph and no layer records in the knowledge graph).');
  });
});

describe('domain flow anchors', () => {
  const anchored = Array.from({ length: 7 }, (_, i) => fnNode(`flow/f${i}.go`, 'Do'));
  const graph = () => writeGraph(project.root, { paths: Array.from({ length: 7 }, (_, i) => `flow/f${i}.go`), nodes: anchored });
  const flows = {
    pay: [...anchored.map((node, i) => [`s${i}`, i === 2 ? [node.id, 'function:flow/missing.go:Do'] : [node.id]])],
    refund: [['only', [anchored[0].id, anchored[0].id]]],
  };

  it('takes the graph nodes the steps of each flow anchor on, five per flow, in step order', () => {
    graph();
    writeDomain(project.root, flows);
    const product = candidates();
    expect(idsWith(product, 'flow flow:pay')).toEqual(anchored.slice(0, 5).map((node) => node.id));
    // The node two flows anchor on is one candidate with both reasons.
    expect(byId(product, anchored[0].id).reasons.filter((r) => r.startsWith('flow '))).toEqual(['flow flow:pay', 'flow flow:refund']);
    // 7 anchors in pay (the id the graph lacks is not one) and 1 in refund; five of pay are listed.
    expect(product.classes.flow).toEqual({ total: 8, listed: 6, truncated: 2 });
    expect(product.sources.domain).toEqual({ state: 'ok', flows: 2, anchorsNotInGraph: 1 });
  });

  it('has no flow candidates, and says the domain graph is a different revision, when its factDigest is not the graph\'s', () => {
    graph();
    writeDomain(project.root, flows, { factDigest: OTHER_DIGEST });
    const product = candidates();
    expect(idsWith(product, 'flow ')).toEqual([]);
    expect(product.classes.flow).toEqual({ total: 0, listed: 0, truncated: 0 });
    expect(product.sources.domain.state).toBe('different-revision');
    expect(product.sources.domain.reason).toContain(OTHER_DIGEST);
    expect(product.gaps.some((gap) => gap.startsWith('domain-graph.json is a different revision'))).toBe(true);
  });

  it('records an absent domain graph as absent', () => {
    graph();
    const product = candidates();
    expect(product.sources.domain).toEqual({ state: 'absent' });
    expect(product.classes.flow.total).toBe(0);
  });
});

describe('summaries and verdicts', () => {
  const targets = ['a.go', 'b.go', 'c.go', 'd.go'];
  const graph = (extra = {}) => writeGraph(project.root, {
    paths: ['s.go'],
    nodes: [
      ...targets.map((path) => fileNode(path, { summary: `Graph summary of ${path}.` })),
    ],
    edges: targets.map((to) => imports('s.go', to)),
    ...extra,
  });

  it('blanks a contradicted summary and keeps the verdict, keeps fresh ones, and blanks a stale or missing one', () => {
    graph();
    writeManifest(project.root, { 'a.go': 'ha', 'b.go': 'hb', 'c.go': 'hc-now', 'd.go': 'hd' });
    writeSemantics(project.root, {
      'file:a.go': { summary: 'Reads the settings.', semanticSourceHash: 'ha', verification: 'verified' },
      'file:b.go': { summary: 'Opens a socket and retries forever.', semanticSourceHash: 'hb', verification: 'contradicted' },
      'file:c.go': { summary: 'Describes an older version of the file.', semanticSourceHash: 'hc-old', verification: 'verified' },
    });
    const product = candidates();
    expect(product.sources.summaries).toBe('semantic-cache');
    expect(byId(product, 'file:a.go')).toMatchObject({ summary: 'Reads the settings.', summarySource: 'semantic-cache', verification: 'verified' });
    expect(byId(product, 'file:b.go')).toMatchObject({ summary: '', summarySource: 'none', verification: 'contradicted' });
    // Stale entry: not fresh against the manifest, so left out. No entry: empty, though the graph node has its own summary (the cache is readable).
    expect(byId(product, 'file:c.go')).toMatchObject({ summary: '', summarySource: 'none', verification: null });
    expect(byId(product, 'file:d.go')).toMatchObject({ summary: '', summarySource: 'none', verification: null });
    expect(JSON.stringify(product)).not.toContain('retries forever');
  });

  it('uses the graph nodes\' own summaries when there is no semantic cache', () => {
    graph();
    const product = candidates();
    expect(product.sources.summaries).toBe('graph');
    expect(product.sources.semantics).toEqual({ state: 'absent' });
    expect(byId(product, 'file:a.go')).toMatchObject({ summary: 'Graph summary of a.go.', summarySource: 'graph', verification: null });
    expect(product.gaps).toContain('There is no semantic cache; summaries are the graph nodes\' own summaries.');
  });

  it('says no candidate has a summary when every summary is empty', () => {
    writeGraph(project.root, { paths: ['s.go', ...targets], edges: targets.map((to) => imports('s.go', to)) });
    const product = candidates();
    expect(product.candidates.every((candidate) => candidate.summary === '')).toBe(true);
    expect(product.gaps).toContain('No candidate has a summary.');
  });
});

describe('non-code files', () => {
  it('makes one candidate per file, the file node, counts its config nodes, and keeps the file out of the code files', () => {
    writeGraph(project.root, {
      paths: ['main.go', 'app.env', 'noenv.env'],
      nodes: [configNode('app.env', 'PORT'), configNode('app.env', 'HOST'), configNode('app.env', 'MODE'), configNode('noenv.env', 'ONE')],
      edges: [],
    });
    const product = candidates();
    expect(idsWith(product, 'non-code:')).toEqual(['file:app.env', 'file:noenv.env']);
    expect(byId(product, 'file:app.env').reasons).toEqual(['non-code: 3 config node(s)']);
    expect(product.classes.nonCode).toEqual({ total: 2, listed: 2, truncated: 0 });
    expect(product.sources.graph).toMatchObject({ codeFiles: 1, nonCodeFiles: 2 });
  });

  it('falls back to the first non-code node when the file has no file node, and cuts at 30 files', () => {
    const nodes = Array.from({ length: 32 }, (_, i) => configNode(`cfg/c${String(i).padStart(2, '0')}.env`, 'K'));
    writeGraph(project.root, { paths: [], nodes: [...nodes, configNode('lone.env', 'B'), configNode('lone.env', 'A')] });
    const product = candidates();
    expect(product.classes.nonCode).toEqual({ total: 33, listed: 30, truncated: 3 });
    // lone.env has two nodes, so it ranks first; its representative is a config node, the one at the earliest line then the smallest id.
    expect(idsWith(product, 'non-code:')[0]).toBe('config:lone.env:A');
  });
});

describe('the command', () => {
  const run = (root) => spawnSync(process.execPath, [TOUR, 'candidates', root], { encoding: 'utf-8' });

  it('exits non-zero and says to run /excavator when there is no knowledge graph', () => {
    const result = run(project.root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('knowledge-graph.jsonl does not exist; run /excavator on this project first');
    expect(existsSync(join(project.root, '.excavator', 'tour'))).toBe(false);
  });

  it('exits non-zero for a graph that is not a knowledge graph, writing nothing', () => {
    writeGraph(project.root, { paths: ['main.go'] });
    writeFileSync(join(project.root, '.excavator', 'knowledge-graph.jsonl'), 'not json\n');
    const result = run(project.root);
    expect(result.status).not.toBe(0);
    expect(existsSync(join(project.root, '.excavator', 'tour', 'candidates.json'))).toBe(false);
  });

  it('writes .excavator/tour/candidates.json, the same bytes twice, and no stray temporary file', () => {
    writeGraph(project.root, { paths: ['main.go', 'lib/a.go'], edges: [imports('main.go', 'lib/a.go')] });
    const first = run(project.root);
    expect(first.status).toBe(0);
    const out = join(project.root, '.excavator', 'tour', 'candidates.json');
    const bytes = readFileSync(out);
    const summary = JSON.parse(first.stdout);
    expect(summary).toMatchObject({ out, factsDigest: 'a'.repeat(64), sourceRevision: project.revision });
    expect(summary.classes.entry).toEqual({ total: 1, truncated: 0 });
    expect(run(project.root).status).toBe(0);
    expect(readFileSync(out).equals(bytes)).toBe(true);
    expect(readdirSync(join(project.root, '.excavator', 'tour'))).toEqual(['candidates.json']);
    const product = JSON.parse(bytes.toString('utf-8'));
    expect(product).toMatchObject({ format: 'excavator-tour-candidates/1', factsDigest: 'a'.repeat(64), sourceRevision: project.revision });
  });

  it('rejects an unknown subcommand with the usage', () => {
    const result = spawnSync(process.execPath, [TOUR, 'nonsense'], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage: node tour.mjs candidates <projectRoot>');
  });
});
