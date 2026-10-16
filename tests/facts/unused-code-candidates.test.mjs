// unused-code, tasks 2.1-2.2: the deterministic candidate set. Function nodes
// reachable from a route handler along calls and (bidirectional) implements /
// overrides are used; every other function node is a candidate, clustered by
// strongly connected components, each with the structure facts the later entry
// judgment reads. Synthetic in-memory graphs exercise the pure builder; a small
// Java fixture through Core and buildFactGraph pins every feature field; the CLI
// runs end to end on a temp project directory.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { writeKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { writeStructureAll } from '../../skills/excavator/structure-all-store.mjs';
import {
  UNUSED_CANDIDATES_FORMAT,
  assertConservation,
  buildUnusedCandidates,
  computeCandidateSet,
  simpleTypeName,
} from '../../skills/excavator/unused-code.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../skills/excavator/unused-code.mjs');

// ---------------------------------------------------------------------------
// Synthetic graph helpers
// ---------------------------------------------------------------------------

const fnId = (label, file = 'src/X.java', owner = 'X') => `function:${file}:${owner}#${label}()`;
const fnNode = (label, file = 'src/X.java', owner = 'X') => ({
  id: fnId(label, file, owner), type: 'function', name: label, filePath: file, lineRange: [1, 2], owner,
});
const classId = (name, file = `src/${name}.java`) => `class:${file}:${name}`;
const classNode = (name, file = `src/${name}.java`, lineRange = [1, 9]) => ({
  id: classId(name, file), type: 'class', name, filePath: file, lineRange,
});
const edge = (type, source, target, evidence = [{ file: 'src/X.java', line: 1 }]) => ({
  source, target, type, direction: 'forward', weight: 1, evidence, provenance: 'extracted',
});
const call = (from, to) => edge('calls', fnId(from), fnId(to));
const endpointNode = (name) => ({ id: `endpoint:src/X.java:X#${name}`, type: 'endpoint', name, filePath: 'src/X.java' });
const routeTo = (endpoint, target) => edge('routes', endpoint.id, target);

function build({ nodes, edges = [], structure = { results: [] } }) {
  return buildUnusedCandidates({
    graph: { nodes, edges, gaps: [], factsDigest: 'digest-1' },
    structure,
    sourceRevision: 'rev-1',
  });
}
const labels = (labelList) => labelList.map((label) => fnNode(label));
const candidate = (product, label, file = 'src/X.java', owner = 'X') => {
  const hits = product.candidates.filter((c) => c.id === fnId(label, file, owner));
  expect(hits, `candidate ${label}`).toHaveLength(1);
  return hits[0];
};
const candidateLabels = (product) => product.candidates.map((c) => c.name);

// ---------------------------------------------------------------------------
// Definition: reachability, candidates, clusters (spec: the definition of unused code)
// ---------------------------------------------------------------------------

describe('candidates and clusters', () => {
  it('B has no references and A is only called by B: both are candidates, B is the entry, A is not', () => {
    const product = build({ nodes: labels(['a', 'b']), edges: [call('b', 'a')] });
    expect(candidateLabels(product)).toEqual(['a', 'b']);
    expect(candidate(product, 'b').entry).toBe(true);
    expect(candidate(product, 'a').entry).toBe(false);
    expect(candidate(product, 'a').referrers).toEqual([{ id: fnId('b'), edge: 'calls', reverse: false }]);
    expect(candidate(product, 'b').referrers).toEqual([]);
    expect(product.counts).toMatchObject({ functionNodes: 2, routeReachable: 0, candidates: 2, entries: 1, entryComponents: 1, clusters: 1 });
  });

  it('A and B calling each other with nothing else: both are entries in one component', () => {
    const product = build({ nodes: labels(['a', 'b']), edges: [call('a', 'b'), call('b', 'a')] });
    expect(candidate(product, 'a')).toMatchObject({ entry: true, component: 0 });
    expect(candidate(product, 'b')).toMatchObject({ entry: true, component: 0 });
    expect(product.counts).toMatchObject({ candidates: 2, entries: 2, entryComponents: 1, clusters: 1 });
  });

  it('a cycle that something outside it calls is not an entry; the outside caller is', () => {
    const product = build({ nodes: labels(['a', 'b', 'c']), edges: [call('b', 'c'), call('c', 'b'), call('a', 'b')] });
    expect(candidate(product, 'a')).toMatchObject({ entry: true });
    expect(candidate(product, 'b')).toMatchObject({ entry: false });
    expect(candidate(product, 'c')).toMatchObject({ entry: false });
    expect(candidate(product, 'b').component).toBe(candidate(product, 'c').component);
    expect(candidate(product, 'b').component).not.toBe(candidate(product, 'a').component);
    expect(product.counts).toMatchObject({ entries: 1, entryComponents: 1, clusters: 1 });
  });

  it('numbers components by their smallest member id, from 0', () => {
    const product = build({ nodes: labels(['c', 'a', 'd', 'b']), edges: [call('c', 'd'), call('d', 'c')] });
    expect(candidate(product, 'a').component).toBe(0);
    expect(candidate(product, 'b').component).toBe(1);
    expect(candidate(product, 'c').component).toBe(2);
    expect(candidate(product, 'd').component).toBe(2);
    expect(product.counts).toMatchObject({ entries: 4, entryComponents: 3, clusters: 3 });
  });

  it('route GET /orders/{id} -> OrderResource#get(Long) -> OrderService#find(Long): neither is a candidate', () => {
    const endpoint = endpointNode('GET /orders/{id}');
    const get = { ...fnNode('get', 'src/OrderResource.java', 'OrderResource'), id: 'function:src/OrderResource.java:OrderResource#get(Long)' };
    const find = { ...fnNode('find', 'src/OrderService.java', 'OrderService'), id: 'function:src/OrderService.java:OrderService#find(Long)' };
    const orphan = fnNode('orphan');
    const product = build({
      nodes: [endpoint, get, find, orphan],
      edges: [routeTo(endpoint, get.id), edge('calls', get.id, find.id)],
    });
    expect(candidateLabels(product)).toEqual(['orphan']);
    expect(product.counts).toMatchObject({ functionNodes: 3, routeReachable: 2, candidates: 1 });
    expect(product.conservation).toEqual({ functionNodes: 3, routeReachable: 2, candidates: 1, holds: true });
  });

  it('a route that targets a non-function node seeds nothing; a call from a route-reachable node reaches transitively', () => {
    const endpoint = endpointNode('GET /x');
    const product = build({
      nodes: [endpoint, classNode('K'), ...labels(['h', 'i', 'j', 'lone'])],
      edges: [routeTo(endpoint, classId('K')), routeTo(endpoint, fnId('h')), call('h', 'i'), call('i', 'j')],
    });
    expect(candidateLabels(product)).toEqual(['lone']);
  });

  it('counts clusters as weakly connected components of the candidate subgraph', () => {
    const product = build({
      nodes: labels(['a', 'b', 'c', 'd', 'e']),
      edges: [call('a', 'b'), call('c', 'b'), call('d', 'e')],
    });
    expect(product.counts).toMatchObject({ candidates: 5, entries: 3, entryComponents: 3, clusters: 2 });
  });

  it('a self-call makes the node its own referrer and does not make it a non-entry', () => {
    const product = build({ nodes: labels(['a']), edges: [call('a', 'a')] });
    expect(candidate(product, 'a')).toMatchObject({
      entry: true, referrers: [{ id: fnId('a'), edge: 'calls', reverse: false }],
    });
  });

  it('ignores edges to or from ids that are not function nodes', () => {
    const product = build({
      nodes: labels(['a']),
      edges: [edge('calls', fnId('a'), 'function:ghost'), edge('calls', 'function:ghost', fnId('a'))],
    });
    expect(candidateLabels(product)).toEqual(['a']);
    expect(candidate(product, 'a').referrers).toEqual([]);
  });

  it('sorts and de-duplicates the referrers of a node by (id, edge, reverse)', () => {
    const product = build({
      nodes: labels(['t', 'u', 'v']),
      edges: [call('v', 't'), call('u', 't'), call('u', 't'), edge('implements', fnId('u'), fnId('t')), edge('overrides', fnId('t'), fnId('u'))],
    });
    expect(candidate(product, 't').referrers).toEqual([
      { id: fnId('u'), edge: 'calls', reverse: false },
      { id: fnId('u'), edge: 'implements', reverse: false },
      { id: fnId('u'), edge: 'overrides', reverse: true },
      { id: fnId('v'), edge: 'calls', reverse: false },
    ]);
  });
});

describe.each(['overrides', 'implements'])('%s edges are followed in both directions', (type) => {
  const base = fnNode('m', 'src/Base.java', 'Base');
  const sub = fnNode('m', 'src/Sub.java', 'Sub');
  const subToBase = edge(type, sub.id, base.id);

  it(`the base method is route-reachable: the method that ${type} it is not a candidate`, () => {
    const endpoint = endpointNode('GET /b');
    const product = build({ nodes: [endpoint, base, sub], edges: [subToBase, routeTo(endpoint, base.id)] });
    expect(product.candidates).toEqual([]);
    expect(product.counts).toMatchObject({ functionNodes: 2, routeReachable: 2, candidates: 0 });
  });

  it(`the ${type} method is route-reachable: the declaration it ${type} is not a candidate`, () => {
    const endpoint = endpointNode('GET /s');
    const product = build({ nodes: [endpoint, base, sub], edges: [subToBase, routeTo(endpoint, sub.id)] });
    expect(product.candidates).toEqual([]);
  });

  it('with nothing reachable both are candidates in one component, and the reverse flag marks the dispatch direction', () => {
    const product = build({ nodes: [base, sub], edges: [subToBase] });
    const baseCandidate = product.candidates.find((c) => c.id === base.id);
    const subCandidate = product.candidates.find((c) => c.id === sub.id);
    // Fact edge sub -> base: the referrer of base is sub going with the edge,
    // the referrer of sub is base going against it.
    expect(baseCandidate.referrers).toEqual([{ id: sub.id, edge: type, reverse: false }]);
    expect(subCandidate.referrers).toEqual([{ id: base.id, edge: type, reverse: true }]);
    expect(baseCandidate.component).toBe(subCandidate.component);
    expect(baseCandidate.entry && subCandidate.entry).toBe(true);
  });
});

describe('edges that do not take part in method reachability', () => {
  const endpoint = endpointNode('GET /h');
  const h = fnNode('h');
  const m = fnNode('m');
  const owner = classNode('K');
  const base = [endpoint, h, m, owner];

  it.each(['references', 'injects', 'mentions', 'contains', 'exports', 'imports'])(
    'a %s edge from a route-reachable function to another function does not make it reachable',
    (type) => {
      const product = build({ nodes: base, edges: [routeTo(endpoint, h.id), edge(type, h.id, m.id)] });
      expect(candidateLabels(product)).toEqual(['m']);
    },
  );

  it('a call to a class node does not make the class methods reachable', () => {
    const product = build({
      nodes: base,
      edges: [routeTo(endpoint, h.id), edge('calls', h.id, owner.id), edge('contains', owner.id, m.id)],
    });
    expect(candidateLabels(product)).toEqual(['m']);
  });

  it('references, injects and mentions edges to a class are not function references', () => {
    const product = build({
      nodes: [...base, fnNode('n')],
      edges: [
        routeTo(endpoint, h.id),
        edge('references', h.id, owner.id), edge('injects', h.id, owner.id), edge('mentions', h.id, owner.id),
        edge('contains', owner.id, m.id),
      ],
    });
    expect(candidateLabels(product)).toEqual(['m', 'n']);
    expect(candidate(product, 'm').referrers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Conservation (O1: the assertion goes red on a known fault)
// ---------------------------------------------------------------------------

describe('assertConservation', () => {
  const ids = ['f1', 'f2', 'f3'];

  it('accepts a partition of the function ids', () => {
    expect(() => assertConservation({ functionIds: ids, reachable: ['f1'], candidates: ['f2', 'f3'] })).not.toThrow();
    expect(() => assertConservation({ functionIds: new Set(ids), reachable: new Set(), candidates: new Set(ids) })).not.toThrow();
  });

  it('throws, naming the id, when a function id is in neither set', () => {
    expect(() => assertConservation({ functionIds: ids, reachable: ['f1'], candidates: ['f2'] })).toThrow(/neither.*f3/);
  });

  it('throws, naming the id, when a function id is in both sets', () => {
    expect(() => assertConservation({ functionIds: ids, reachable: ['f1', 'f2'], candidates: ['f2', 'f3'] })).toThrow(/both.*f2/);
  });

  it('throws when a set holds an id that is not a function node', () => {
    expect(() => assertConservation({ functionIds: ids, reachable: ['f1', 'ghost'], candidates: ['f2', 'f3'] })).toThrow(/not function nodes.*ghost/);
  });
});

describe('inputs', () => {
  it('refuses two function nodes with one id instead of counting one of them silently', () => {
    expect(() => build({ nodes: [fnNode('a'), fnNode('a')] })).toThrow(/duplicate function node id/);
  });

  it('refuses a graph without factsDigest and a manifest without sourceRevision', () => {
    expect(() => buildUnusedCandidates({ graph: { nodes: [], edges: [] }, structure: { results: [] }, sourceRevision: 'r' }))
      .toThrow(/factsDigest/);
    expect(() => buildUnusedCandidates({ graph: { nodes: [], edges: [], factsDigest: 'd' }, structure: { results: [] } }))
      .toThrow(/sourceRevision/);
  });

  it('an empty graph yields an empty product that conserves', () => {
    const product = build({ nodes: [] });
    expect(product).toMatchObject({
      format: UNUSED_CANDIDATES_FORMAT, factsDigest: 'digest-1', sourceRevision: 'rev-1', types: {}, candidates: [],
      conservation: { functionNodes: 0, routeReachable: 0, candidates: 0, holds: true },
    });
  });
});

// ---------------------------------------------------------------------------
// Determinism and scale
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffled = (list, random) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

describe('determinism', () => {
  const random = mulberry32(7);
  const names = Array.from({ length: 60 }, (_, i) => `m${i}`);
  const nodes = [endpointNode('GET /a'), endpointNode('GET /b'), classNode('K'), ...labels(names)];
  const edges = [routeTo(nodes[0], fnId('m0')), routeTo(nodes[1], fnId('m1')), edge('contains', classId('K'), fnId('m2'))];
  const kinds = ['calls', 'calls', 'calls', 'implements', 'overrides'];
  for (let i = 0; i < 90; i++) {
    edges.push(edge(kinds[Math.floor(random() * kinds.length)], fnId(names[Math.floor(random() * 60)]), fnId(names[Math.floor(random() * 60)])));
  }
  const structure = { results: [{ path: 'src/X.java', language: 'java', functions: [], classes: [], classLiterals: [] }] };

  it('builds the same product from the same graph twice', () => {
    expect(JSON.stringify(build({ nodes, edges, structure }))).toBe(JSON.stringify(build({ nodes, edges, structure })));
  });

  it('builds the same product whatever the order of the nodes and edges', () => {
    const expected = JSON.stringify(build({ nodes, edges, structure }));
    for (let round = 0; round < 5; round++) {
      const product = build({ nodes: shuffled(nodes, random), edges: shuffled(edges, random), structure });
      expect(JSON.stringify(product)).toBe(expected);
    }
  });

  it('exercises components, entries and reachability, not just an empty product', () => {
    const product = build({ nodes, edges, structure });
    expect(product.counts.routeReachable).toBeGreaterThan(0);
    expect(product.counts.candidates).toBeGreaterThan(5);
    expect(product.counts.entries).toBeGreaterThan(0);
    expect(new Set(product.candidates.map((c) => c.component)).size).toBeGreaterThan(1);
  });
});

describe('scale', () => {
  const N = 200_000;
  const idOf = (i) => `function:src/Chain.java:Chain#m${i}()`;
  const chainNodes = Array.from({ length: N }, (_, i) => ({
    id: idOf(i), type: 'function', name: `m${i}`, filePath: 'src/Chain.java', lineRange: [1, 2],
  }));
  const chainEdges = Array.from({ length: N - 1 }, (_, i) => edge('calls', idOf(i), idOf(i + 1)));

  it('a 200k-node call chain of candidates does not overflow the stack: one entry, one referrer each', () => {
    const set = computeCandidateSet({ nodes: chainNodes, edges: chainEdges });
    expect(set.candidateIds).toHaveLength(N);
    expect(set.entry.filter(Boolean)).toHaveLength(1);
    expect(set.entryComponents).toBe(1);
    expect(set.clusters).toBe(1);
    expect(new Set(set.component).size).toBe(N);
    expect(set.referrers.filter((r) => r.length === 1)).toHaveLength(N - 1);
  }, 60_000);

  it('a 200k-node cycle is one component in which every node is an entry', () => {
    const set = computeCandidateSet({ nodes: chainNodes, edges: [...chainEdges, edge('calls', idOf(N - 1), idOf(0))] });
    expect(new Set(set.component).size).toBe(1);
    expect(set.entry.filter(Boolean)).toHaveLength(N);
  }, 60_000);

  it('a 200k-node chain reachable from one route has no candidates', () => {
    const endpoint = endpointNode('GET /chain');
    const set = computeCandidateSet({ nodes: [endpoint, ...chainNodes], edges: [...chainEdges, edge('routes', endpoint.id, idOf(0))] });
    expect(set.candidateIds).toHaveLength(0);
    expect(set.reachable.reduce((sum, flag) => sum + flag, 0)).toBe(N);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Type names
// ---------------------------------------------------------------------------

describe('simpleTypeName', () => {
  it.each([
    ['Foo', 'Foo'],
    [' Foo ', 'Foo'],
    ['a.b.Foo', 'Foo'],
    ['java.util.Map.Entry<K, V>[]', 'Entry'],
    ['Comparable<Map.Entry<K, List<V>>>', 'Comparable'],
    ['Foo[][]', 'Foo'],
    ['a.b.Outer<T>.Inner', 'Inner'],
    ['', ''],
  ])('%j -> %j', (text, expected) => {
    expect(simpleTypeName(text)).toBe(expected);
  });

  it('is empty for a value that is not text', () => {
    expect(simpleTypeName(undefined)).toBe('');
    expect(simpleTypeName(42)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Features: a small Java fixture through Core and buildFactGraph
// ---------------------------------------------------------------------------

let registry;
beforeAll(async () => {
  const tsPlugin = new TreeSitterPlugin(builtinLanguageConfigs.filter((c) => c.treeSitter));
  await tsPlugin.init();
  registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);
});

function structureRow(path, language, lines) {
  const source = [...lines, ''].join('\n');
  const file = { path, language, fileCategory: 'code' };
  const extracted = analyzeFileWithOutcomes(registry, file, source);
  expect(extracted.structureOutcome).toBe('succeeded');
  return buildResult(file, lines.length, lines.length, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
}

function factGraphOf(rows) {
  const scan = {
    files: rows.map((r) => ({ path: r.path, language: r.language, fileCategory: 'code', sizeLines: r.totalLines })),
    skipped: [],
    coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } },
  };
  const importMap = { importMap: Object.fromEntries(rows.map((r) => [r.path, []])), unresolved: {} };
  return buildFactGraph({ scan, structureAll: { results: rows }, importMap });
}

const J = 'src/main/java/p';
const FIXTURE = {
  [`${J}/Base.java`]: [
    'package p;',
    'public class Base implements java.io.Serializable {',
    '  private void readObject(java.io.ObjectInputStream in) {}',
    '  protected void hook() {}',
    '}',
  ],
  [`${J}/Sub.java`]: [
    'package p;',
    '@Deprecated',
    'public class Sub extends Base implements Runnable {',
    '  @Override',
    '  public void run() {}',
    '  static void util() {}',
    '}',
  ],
  [`${J}/Helper.java`]: [
    'package p;',
    'public class Helper {',
    '  void assist() {}',
    '}',
  ],
  [`${J}/Svc.java`]: [
    'package p;',
    '@Mapper(uses = Helper.class)',
    'public class Svc {',
    '  @PostConstruct',
    '  private void init() {}',
    '}',
  ],
};
const PY_PATH = 'tools/clean.py';
const PY_LINES = ['def tidy():', '    pass'];

const fixtureRows = () => [
  ...Object.entries(FIXTURE).map(([path, lines]) => structureRow(path, 'java', lines)),
  structureRow(PY_PATH, 'python', PY_LINES),
];

describe('features from a Java fixture', () => {
  let rows;
  let graph;
  let product;
  beforeAll(() => {
    rows = fixtureRows();
    graph = factGraphOf(rows);
    product = buildUnusedCandidates({ graph, structure: { results: rows }, sourceRevision: 'rev-java' });
  });

  const jid = (file, owner, signature) => `function:${J}/${file}.java:${owner}#${signature}`;

  it('gives every candidate its position, owner, visibility, modifiers, annotations, entry flag and component', () => {
    expect(product.candidates).toEqual([
      {
        id: jid('Base', 'Base', 'hook()'), name: 'hook', language: 'java', file: `${J}/Base.java`, lineRange: [4, 4],
        owner: classId('Base', `${J}/Base.java`), visibility: 'protected', modifiers: [], annotations: [],
        entry: true, component: 0, referrers: [],
      },
      {
        id: jid('Base', 'Base', 'readObject(java.io.ObjectInputStream)'), name: 'readObject', language: 'java', file: `${J}/Base.java`, lineRange: [3, 3],
        owner: classId('Base', `${J}/Base.java`), visibility: 'private', modifiers: [], annotations: [],
        entry: true, component: 1, referrers: [],
      },
      {
        id: jid('Helper', 'Helper', 'assist()'), name: 'assist', language: 'java', file: `${J}/Helper.java`, lineRange: [3, 3],
        owner: classId('Helper', `${J}/Helper.java`), visibility: 'package', modifiers: [], annotations: [],
        entry: true, component: 2, referrers: [],
      },
      {
        id: jid('Sub', 'Sub', 'run()'), name: 'run', language: 'java', file: `${J}/Sub.java`, lineRange: [4, 5],
        owner: classId('Sub', `${J}/Sub.java`), visibility: 'public', modifiers: [], annotations: ['Override'],
        entry: true, component: 3, referrers: [],
      },
      {
        id: jid('Sub', 'Sub', 'util()'), name: 'util', language: 'java', file: `${J}/Sub.java`, lineRange: [6, 6],
        owner: classId('Sub', `${J}/Sub.java`), visibility: 'package', modifiers: ['static'], annotations: [],
        entry: true, component: 4, referrers: [],
      },
      {
        id: jid('Svc', 'Svc', 'init()'), name: 'init', language: 'java', file: `${J}/Svc.java`, lineRange: [4, 5],
        owner: classId('Svc', `${J}/Svc.java`), visibility: 'private', modifiers: [], annotations: ['PostConstruct'],
        entry: true, component: 5, referrers: [],
      },
      {
        // Another language: the structure result has no visibility, modifiers or
        // annotations for it, so they are unknown (null), not an empty default.
        id: `function:${PY_PATH}:tidy()`, name: 'tidy', language: 'python', file: PY_PATH, lineRange: [1, 2],
        owner: null, visibility: null, modifiers: null, annotations: null,
        entry: true, component: 6, referrers: [],
      },
    ]);
  });

  it('counts the header by language and conserves', () => {
    expect(product.counts).toEqual({
      functionNodes: 7,
      routeReachable: 0,
      candidates: 7,
      entries: 7,
      entryComponents: 7,
      clusters: 7,
      unmatchedStructure: 0,
      byLanguage: {
        java: { functionNodes: 6, routeReachable: 0, candidates: 6, entries: 6 },
        python: { functionNodes: 1, routeReachable: 0, candidates: 1, entries: 1 },
      },
    });
    expect(product.conservation).toEqual({ functionNodes: 7, routeReachable: 0, candidates: 7, holds: true });
    expect(product).toMatchObject({ format: UNUSED_CANDIDATES_FORMAT, factsDigest: graph.factsDigest, sourceRevision: 'rev-java' });
  });

  it('gives each type that owns a candidate its annotations, outside supertypes and use signals', () => {
    const base = classId('Base', `${J}/Base.java`);
    const sub = classId('Sub', `${J}/Sub.java`);
    const helper = classId('Helper', `${J}/Helper.java`);
    const svc = classId('Svc', `${J}/Svc.java`);
    expect(Object.keys(product.types)).toEqual([base, helper, sub, svc]);
    const none = { references: 0, injects: 0, mentions: 0, samples: [] };
    const noLiterals = { count: 0, samples: [] };

    // Base implements an interface outside the index; its subclass adds another.
    expect(product.types[base]).toEqual({
      name: 'Base', file: `${J}/Base.java`, annotations: [],
      outsideSupertypes: { own: ['java.io.Serializable'], ancestors: [], descendants: ['Runnable'], unknown: 0 },
      referencedBy: none, annotationClassLiterals: noLiterals,
    });
    // Sub extends the in-repo Base (inside the index) and implements Runnable (outside).
    expect(product.types[sub]).toEqual({
      name: 'Sub', file: `${J}/Sub.java`, annotations: ['Deprecated'],
      outsideSupertypes: { own: ['Runnable'], ancestors: ['java.io.Serializable'], descendants: [], unknown: 0 },
      referencedBy: none, annotationClassLiterals: noLiterals,
    });
    // Helper is used only as the class literal in Svc's @Mapper annotation.
    expect(product.types[helper]).toEqual({
      name: 'Helper', file: `${J}/Helper.java`, annotations: [],
      outsideSupertypes: { own: [], ancestors: [], descendants: [], unknown: 0 },
      referencedBy: none, annotationClassLiterals: { count: 1, samples: [{ file: `${J}/Svc.java`, line: 2 }] },
    });
    expect(product.types[svc]).toEqual({
      name: 'Svc', file: `${J}/Svc.java`, annotations: ['Mapper'],
      outsideSupertypes: { own: [], ancestors: [], descendants: [], unknown: 0 },
      referencedBy: none, annotationClassLiterals: noLiterals,
    });
  });

  it('records the fixture graph as the edges the type table was computed from', () => {
    // Guards the fixture itself: Sub -> Base is in the index, the two interfaces are not.
    const typeEdges = graph.edges.filter((e) => (e.type === 'inherits' || e.type === 'implements') && e.source.startsWith('class:'));
    expect(typeEdges.map((e) => `${e.source} -${e.type}-> ${e.target}`)).toEqual([
      `${classId('Sub', `${J}/Sub.java`)} -inherits-> ${classId('Base', `${J}/Base.java`)}`,
    ]);
    expect(rows.find((r) => r.path === `${J}/Svc.java`).classLiterals).toContainEqual(
      expect.objectContaining({ type: 'Helper', context: 'annotation' }),
    );
  });

  it('records unknown (null) for facts a missing structure row cannot give, and counts the unknown classes', () => {
    const without = rows.filter((r) => r.path !== `${J}/Base.java`);
    const partial = buildUnusedCandidates({ graph, structure: { results: without }, sourceRevision: 'rev-java' });
    const hook = partial.candidates.find((c) => c.name === 'hook');
    expect(hook).toMatchObject({
      language: null, visibility: null, modifiers: null, annotations: null, owner: classId('Base', `${J}/Base.java`),
    });
    expect(partial.counts.unmatchedStructure).toBe(2);
    expect(partial.counts.byLanguage.unknown).toEqual({ functionNodes: 2, routeReachable: 0, candidates: 2, entries: 2 });
    const base = partial.types[classId('Base', `${J}/Base.java`)];
    expect(base.annotations).toBeNull();
    expect(base.outsideSupertypes).toEqual({ own: null, ancestors: [], descendants: ['Runnable'], unknown: 1 });
    // Sub's ancestor Base is unknown, so what Base would add is not claimed to be empty.
    expect(partial.types[classId('Sub', `${J}/Sub.java`)].outsideSupertypes)
      .toEqual({ own: ['Runnable'], ancestors: [], descendants: [], unknown: 1 });
  });
});

// ---------------------------------------------------------------------------
// Types table: use signals and hierarchy edge cases on synthetic graphs
// ---------------------------------------------------------------------------

describe('types table on synthetic graphs', () => {
  const structureFor = (classes, extra = {}) => ({
    results: [{ path: 'src/K.java', language: 'java', functions: [], classes, classLiterals: [], ...extra }],
  });
  const typed = (name, supertypes, extra = {}) => ({ name, startLine: 1, endLine: 9, annotations: [], supertypes, ...extra });
  const ownedMethod = (cls, file = `src/${cls}.java`) => ({
    ...fnNode('m', file, cls), id: `function:${file}:${cls}#m()`,
  });
  const contains = (cls, fn) => edge('contains', classId(cls), fn.id);

  it('counts every reference, injection and mention of the class and keeps five samples in (file, line, type, source) order', () => {
    const k = classNode('K', 'src/K.java');
    const m = ownedMethod('K');
    const sources = [
      ['references', 'file:v3.xhtml', 'v3.xhtml', 3],
      ['injects', 'class:src/B.java:B', 'src/B.java', 12],
      ['mentions', 'file:web.xml', 'web.xml', 7],
      ['references', 'file:v1.xhtml', 'v1.xhtml', 9],
      ['injects', 'class:src/A.java:A', 'src/A.java', 12],
      ['mentions', 'file:app.xml', 'app.xml', 1],
      ['references', 'file:v2.xhtml', 'v2.xhtml', 3],
    ];
    const product = build({
      nodes: [k, m],
      edges: [contains('K', m), ...sources.map(([type, source, file, line]) => edge(type, source, k.id, [{ file, line }]))],
      structure: structureFor([typed('K', [])]),
    });
    const { referencedBy } = product.types[k.id];
    expect(referencedBy).toMatchObject({ references: 3, injects: 2, mentions: 2 });
    // Seven edges in all; the five that sort first by (file, line, type, source).
    expect(referencedBy.samples).toEqual([
      { type: 'mentions', source: 'file:app.xml', file: 'app.xml', line: 1 },
      { type: 'injects', source: 'class:src/A.java:A', file: 'src/A.java', line: 12 },
      { type: 'injects', source: 'class:src/B.java:B', file: 'src/B.java', line: 12 },
      { type: 'references', source: 'file:v1.xhtml', file: 'v1.xhtml', line: 9 },
      { type: 'references', source: 'file:v2.xhtml', file: 'v2.xhtml', line: 3 },
    ]);
  });

  it('counts annotation class literals by simple name from any file, ignores code literals, and keeps five samples', () => {
    const k = classNode('K', 'src/K.java');
    const m = ownedMethod('K');
    const literal = (type, line, context = 'annotation') => ({ type, line, context });
    const structure = {
      results: [
        { path: 'src/K.java', language: 'java', functions: [], classes: [typed('K', [])], classLiterals: [literal('K', 4, 'code')] },
        ...[9, 8, 7, 6, 5, 4].map((line, i) => ({
          path: `src/u${i}.java`, language: 'java', functions: [], classes: [], classLiterals: [literal(i % 2 ? 'other.pkg.K' : 'K', line)],
        })),
        { path: 'src/z.java', language: 'java', functions: [], classes: [], classLiterals: [literal('Kk', 1), literal('K[]', 2)] },
      ],
    };
    const product = build({ nodes: [k, m], edges: [contains('K', m)], structure });
    const { annotationClassLiterals } = product.types[k.id];
    expect(annotationClassLiterals.count).toBe(7);
    expect(annotationClassLiterals.samples).toEqual([
      { file: 'src/u0.java', line: 9 }, { file: 'src/u1.java', line: 8 }, { file: 'src/u2.java', line: 7 },
      { file: 'src/u3.java', line: 6 }, { file: 'src/u4.java', line: 5 },
    ]);
  });

  it('matches a generic or qualified supertype text to an in-repo parent by simple name; one edge absorbs one text', () => {
    const base = classNode('Base');
    const sub = classNode('Sub');
    const other = classNode('Other');
    const m1 = ownedMethod('Sub');
    const m2 = ownedMethod('Other');
    const structure = {
      results: [
        { path: 'src/Sub.java', language: 'java', functions: [], classes: [typed('Sub', [{ relation: 'extends', type: 'Base<String>', line: 1 }])], classLiterals: [] },
        { path: 'src/Other.java', language: 'java', functions: [], classes: [typed('Other', [
          { relation: 'extends', type: 'a.Base', line: 1 }, { relation: 'implements', type: 'b.Base', line: 1 },
        ])], classLiterals: [] },
      ],
    };
    const product = build({
      nodes: [base, sub, other, m1, m2],
      edges: [contains('Sub', m1), contains('Other', m2), edge('inherits', sub.id, base.id), edge('inherits', other.id, base.id)],
      structure,
    });
    expect(product.types[sub.id].outsideSupertypes.own).toEqual([]);
    expect(product.types[other.id].outsideSupertypes.own).toEqual(['b.Base']);
    // Base itself has no structure row, so it is unknown for both subclasses.
    expect(product.types[sub.id].outsideSupertypes.unknown).toBe(1);
  });

  it('terminates on a cyclic hierarchy and counts each class once', () => {
    const a = classNode('A');
    const b = classNode('B');
    const ma = ownedMethod('A');
    const mb = ownedMethod('B');
    const structure = {
      results: [
        { path: 'src/A.java', language: 'java', functions: [], classes: [typed('A', [{ relation: 'extends', type: 'B', line: 1 }])], classLiterals: [] },
        { path: 'src/B.java', language: 'java', functions: [], classes: [typed('B', [{ relation: 'extends', type: 'A', line: 1 }, { relation: 'implements', type: 'Z', line: 1 }])], classLiterals: [] },
      ],
    };
    const product = build({
      nodes: [a, b, ma, mb],
      edges: [contains('A', ma), contains('B', mb), edge('inherits', a.id, b.id), edge('inherits', b.id, a.id)],
      structure,
    });
    expect(product.types[a.id].outsideSupertypes).toEqual({ own: [], ancestors: ['Z'], descendants: ['Z'], unknown: 0 });
  });

  it('a matched class whose structure has no supertypes field (another language) has unknown supertypes, not none', () => {
    const k = classNode('K', 'src/k.py');
    const m = ownedMethod('K', 'src/k.py');
    const structure = { results: [{ path: 'src/k.py', language: 'python', functions: [], classes: [{ name: 'K', startLine: 1, endLine: 9 }], classLiterals: [] }] };
    const product = build({ nodes: [k, m], edges: [edge('contains', k.id, m.id)], structure });
    expect(product.types[k.id]).toMatchObject({ annotations: null, outsideSupertypes: { own: null, unknown: 1 } });
  });

  it('a class with no candidate method gets no entry in the table', () => {
    const k = classNode('K');
    const product = build({ nodes: [k, fnNode('free')], structure: structureFor([typed('K', [])]) });
    expect(product.types).toEqual({});
    expect(candidate(product, 'free').owner).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

describe('candidates CLI', () => {
  const dirs = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  function projectWith({ graph = true, structure = true, manifest = { sourceRevision: 'git:abc123', entries: [] } } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'unused-code-cli-'));
    dirs.push(root);
    const data = join(root, '.excavator');
    mkdirSync(join(data, 'intermediate'), { recursive: true });
    if (graph) {
      const endpoint = endpointNode('GET /ok');
      writeKnowledgeGraph(join(data, 'intermediate', 'fact-graph.jsonl'), {
        nodes: [endpoint, ...labels(['handler', 'helper', 'dead1', 'dead2'])],
        edges: [routeTo(endpoint, fnId('handler')), call('handler', 'helper'), call('dead1', 'dead2')],
        coverage: [],
        gaps: [],
        factsDigest: 'cli-digest',
      });
    }
    if (structure) {
      writeStructureAll(join(data, 'intermediate', 'structure-all.jsonl'), {
        scriptCompleted: true,
        results: [{ path: 'src/X.java', language: 'java', functions: [], classes: [], classLiterals: [] }],
      });
    }
    if (manifest) writeFileSync(join(data, 'source-manifest.json'), JSON.stringify(manifest));
    return { root, data, product: join(data, 'unused-candidates.json') };
  }
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8' });

  it('writes the product, prints one JSON line with its path and counts, and leaves no temporary file', () => {
    const { root, data, product } = projectWith();
    const result = run('candidates', root);
    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const printed = JSON.parse(lines[0]);
    expect(printed.product).toBe(join(realpathSync(root), '.excavator', 'unused-candidates.json'));
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(result.stderr).toMatch(/2 candidates/);

    const written = JSON.parse(readFileSync(product, 'utf-8'));
    expect(written).toMatchObject({
      format: 'excavator-unused-candidates/1',
      factsDigest: 'cli-digest',
      sourceRevision: 'git:abc123',
      conservation: { functionNodes: 4, routeReachable: 2, candidates: 2, holds: true },
      types: {},
    });
    expect(written.counts).toEqual(printed.counts);
    expect(written.counts).toMatchObject({ entries: 1, clusters: 1, unmatchedStructure: 2 });
    expect(written.candidates.map((c) => c.name)).toEqual(['dead1', 'dead2']);
    expect(readdirSync(data).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('exits non-zero, naming the file, and writes nothing when the fact graph is missing', () => {
    const { root, product } = projectWith({ graph: false });
    const result = run('candidates', root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/fact-graph\.jsonl/);
    expect(existsSync(product)).toBe(false);
  });

  it.each([
    ['the structure result', { structure: false }, /structure-all\.jsonl/],
    ['the source manifest', { manifest: null }, /source-manifest\.json/],
  ])('exits non-zero and writes nothing when %s is missing', (_what, options, pattern) => {
    const { root, product } = projectWith(options);
    const result = run('candidates', root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(pattern);
    expect(existsSync(product)).toBe(false);
  });

  it('exits non-zero and writes nothing when the manifest has no sourceRevision', () => {
    const { root, product } = projectWith({ manifest: { entries: [] } });
    const result = run('candidates', root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/sourceRevision/);
    expect(existsSync(product)).toBe(false);
  });

  it('leaves an existing product untouched when the run fails', () => {
    const { root, product } = projectWith({ manifest: null });
    writeFileSync(product, 'previous');
    expect(run('candidates', root).status).toBe(1);
    expect(readFileSync(product, 'utf-8')).toBe('previous');
  });

  it('prints usage and exits 1 for a missing root, an unknown subcommand and extra arguments', () => {
    const { root } = projectWith();
    for (const args of [[], ['candidates'], ['report', root], ['candidates', root, 'extra'], [root]]) {
      const result = run(...args);
      expect(result.status, JSON.stringify(args)).toBe(1);
      expect(result.stderr).toMatch(/Usage: node unused-code\.mjs candidates <projectRoot>/);
      expect(result.stdout).toBe('');
    }
  });
});
