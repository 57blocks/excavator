// spring-xml-method-calls, tasks 3.2-3.5, 4.3 and 5.2: XML method call sites in
// the real Lazy driver - the `invokes` edges, the visible buckets, the gaps and
// the coverage section - and what reads them: the graph validator, the
// traversal, the project service and the unused-code candidates. The fixture is
// a purpose-built synthetic project (tests/fixtures/spring-xml-method-calls): a
// deployment unit with three Spring contexts, another unit with one, and one
// call per way a site can end. It is copied to a temp directory because a Lazy
// run writes `.excavator/` next to the source.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { PIPELINE_VERSION, runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { createProjectService } from '../../skills/excavator/project-service.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { readStructureAll } from '../../skills/excavator/structure-all-store.mjs';
import { createSourceReader, validateAgainstSource } from '../../skills/excavator/validate-graph.mjs';
import { DETERMINISTIC_EDGE_TYPES, boundedBFS, oneHop } from '../../skills/excavator/retrieve.mjs';
import { XML_METHOD_CALL_GAP_KINDS } from '../../skills/excavator/xml-method-call-resolution.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = join(REPO, 'tests/fixtures/spring-xml-method-calls');
const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

const copyFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'excavator-xml-method-calls-'));
  cpSync(FIXTURE, root, { recursive: true });
  return root;
};
const readProduct = (root) => readKnowledgeGraph(join(root, '.excavator', KNOWLEDGE_GRAPH_FILE));

const JAVA = 'app/src/main/java/com/acme';
const RES = 'app/src/main/resources';
const CTX = `${RES}/ctx.xml`;
const DEFAULTS = `${RES}/defaults.xml`;
const GAPS = `${RES}/gaps.xml`;

// Every edge the fixture's contexts draw: descriptor file -> the method node, the
// descriptor line and token of each call that drew it.
const EXPECTED = {
  [`${CTX} -> AuditAspect#log()`]: ['20:log:spring-aop-before'],
  [`${CTX} -> BaseService#setOrderDao(OrderDao)`]: ['7:orderDao:spring-property-setter', '9:p:orderDao-ref:spring-p-setter'],
  [`${CTX} -> Factory#create()`]: ['10:create:spring-factory-method'],
  [`${CTX} -> LookupHolder#dao()`]: ['24:dao:spring-lookup-method-name'],
  [`${CTX} -> LookupHolder#swapped(String)`]: ['25:swapped:spring-replaced-method-name'],
  [`${CTX} -> Maker#make()`]: ['12:make:spring-factory-method-bean'],
  [`${CTX} -> NightlyJob#run()`]: ['15:run:spring-scheduled-method'],
  [`${CTX} -> OrderService#start()`]: ['6:start:spring-init-method'],
  [`${CTX} -> OrderService#stop()`]: ['6:stop:spring-destroy-method'],
  [`${DEFAULTS} -> A#init()`]: ['2:init:spring-default-init-method', '5:init:spring-init-method'],
  [`${GAPS} -> Dup#reset()`]: ['6:reset:spring-init-method'],
  [`${GAPS} -> Factory#create()`]: ['8:create:spring-factory-method'],
};

describe('XML method call sites in the real Lazy driver', () => {
  let root;
  let result;
  let graph;
  beforeAll(async () => {
    root = copyFixture();
    result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    graph = readProduct(root);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const byId = () => new Map(graph.nodes.map((n) => [n.id, n]));
  const label = (id) => {
    const node = byId().get(id);
    return node.type === 'file' ? node.filePath : `${node.owner}#${id.split('#')[1]}`;
  };
  const invokes = () => graph.edges.filter((e) => e.type === 'invokes');
  const gapOf = (kind) => graph.gaps.find((g) => g.kind === kind);

  it('stamps the product with the new pipeline version', () => {
    expect(result.saveError).toBeNull();
    expect(PIPELINE_VERSION).toBe('lazy-fact-graph/15');
    expect(graph.project.pipelineVersion).toBe('lazy-fact-graph/15');
  });

  it('draws exactly the expected invokes edges: extracted, forward, from the descriptor file node, with the evidence of every call', () => {
    expect(Object.fromEntries(invokes().map((e) => [
      `${label(e.source)} -> ${label(e.target)}`,
      e.evidence.map((x) => `${x.line}:${x.token}:${x.site}`),
    ]).sort(([a], [b]) => (a < b ? -1 : 1)))).toEqual(EXPECTED);
    for (const edge of invokes()) {
      expect(edge).toMatchObject({ direction: 'forward', weight: 0.5, provenance: 'extracted' });
      expect(byId().get(edge.source).type).toBe('file');
      expect(byId().get(edge.target).type).toBe('function');
    }
  });

  it('cites a line of the descriptor that holds the token of every call', () => {
    for (const edge of invokes()) {
      for (const entry of edge.evidence) {
        const text = readFileSync(join(root, entry.file), 'utf-8').split('\n')[entry.line - 1];
        expect(text, `${entry.file}:${entry.line}`).toContain(entry.token);
      }
    }
  });

  it('sorts the evidence of an edge by file, line, token and site, one entry per call', () => {
    const edge = invokes().find((e) => label(e.target) === 'A#init()');
    expect(edge.evidence.map((x) => x.line)).toEqual([2, 5]);
  });

  it('puts each of the 27 calls in one bucket: fourteen calls draw an edge, and one call or more ends each other way', () => {
    const { methodCalls } = graph.coverage;
    expect(methodCalls).toMatchObject({ status: 'ran', siteCount: 27, emptyValues: 1, files: { 'spring-xml-method-call': 4 } });
    expect(methodCalls.buckets).toEqual({
      ownerMissing: 2, ownerExternal: 1, ownerBundle: 0, ownerUnindexed: 1, ownerUnknown: 1, ownerAmbiguous: 1, ownerElsewhere: 1, ownerUnbound: 1,
      edge: 14, methodMissing: 1, methodExternal: 1, methodNotModeled: 1, methodAmbiguous: 1, optionalInactive: 1,
    });
    expect(Object.values(methodCalls.buckets).reduce((a, b) => a + b, 0)).toBe(methodCalls.siteCount);
    expect(methodCalls.sites).toMatchObject({ 'spring-init-method': 7, 'spring-property-setter': 3, 'spring-factory-method': 3, 'spring-default-init-method': 2, 'spring-default-destroy-method': 0, 'spring-p-setter': 1, 'spring-aop-before': 1 });
  });

  it('records the three gap kinds with one occurrence per call in a gap bucket and a sample that names the line and the call', () => {
    expect(gapOf('method-call-owner-unresolved')).toMatchObject({ count: 7, scope: 'xml' });
    expect(gapOf('method-call-method-unresolved')).toMatchObject({ count: 3 });
    expect(gapOf('method-call-ambiguous')).toMatchObject({ count: 1 });
    expect(gapOf('method-call-ambiguous').samples).toEqual([`${GAPS}:19 of -> [com.acme.Overloaded#of(String), com.acme.Overloaded#of(int)]`]);
    expect(gapOf('method-call-method-unresolved').samples).toEqual(expect.arrayContaining([`${GAPS}:4 dataSource -> [com.acme.LibBacked#setDataSource]`, `${GAPS}:21 config.timeout -> [com.acme.OrderService: config.timeout]`]));
    for (const kind of new Set(Object.values(XML_METHOD_CALL_GAP_KINDS))) {
      expect(gapOf(kind).reason, kind).not.toMatch(/unrecognized gap kind/);
    }
  });

  it('writes the same coverage into the result of the run and the product', () => {
    expect(result.coverage.methodCalls).toEqual(graph.coverage.methodCalls);
  });

  it('adds nothing to the graph but invokes edges and the method call gaps', () => {
    const intermediate = join(root, '.excavator', 'intermediate');
    const scan = JSON.parse(readFileSync(join(intermediate, 'scan-result.json'), 'utf-8'));
    const structureAll = readStructureAll(join(intermediate, 'structure-all.jsonl'));
    const importMap = JSON.parse(readFileSync(join(intermediate, 'import-map.json'), 'utf-8'));
    const without = buildFactGraph({ scan, structureAll, importMap });
    expect(without.coverage.methodCalls).toEqual({ status: 'not-run' });
    expect(graph.nodes.length).toBe(without.nodes.length);
    // `without` has no name stages either: the injects, mentions and references edges and their gaps are theirs
    expect(graph.edges.filter((e) => !['injects', 'invokes', 'mentions', 'references'].includes(e.type)).length).toBe(without.edges.length);
    const added = new Set([...Object.values(XML_METHOD_CALL_GAP_KINDS), 'mention-ambiguous', 'mention-target-unindexed', 'path-mention-unresolved']);
    expect(graph.gaps.filter((g) => !added.has(g.kind) && !g.kind.startsWith('name-reference-') && !g.kind.startsWith('injection-'))).toEqual(without.gaps);
  });
});

describe('what reads invokes edges (design D4, tasks 3.4, 3.5, 4.3)', () => {
  let root;
  let graph;
  beforeAll(async () => {
    root = copyFixture();
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    graph = readProduct(root);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const method = (name, owner) => graph.nodes.find((n) => n.type === 'function' && n.name === name && n.owner === owner);
  const file = (path) => graph.nodes.find((n) => n.type === 'file' && n.filePath === path);

  it('is one of the deterministic edge types', () => {
    expect(DETERMINISTIC_EDGE_TYPES).toContain('invokes');
  });

  it('takes a method to the descriptor that has the container call it, in one hop and within the bounded search', () => {
    const start = method('start', 'OrderService');
    const hop = oneHop(graph.edges, [start.id]);
    expect(hop.nodes).toContain(file(CTX).id);
    expect(hop.edges.some((e) => e.type === 'invokes' && e.source === file(CTX).id && e.target === start.id)).toBe(true);
    expect(boundedBFS(graph.edges, [start.id], { maxHops: 1 }).nodes).toContain(file(CTX).id);
  });

  it('serves it through the project service, with the evidence of the edge', async () => {
    const start = method('start', 'OrderService');
    const traversed = await createProjectService(root).traverse({ seedIds: [start.id], mode: 'one-hop' });
    expect(traversed.status).toBe('ok');
    expect(traversed.data.nodes.map((n) => n.id)).toContain(file(CTX).id);
    const edge = traversed.data.edges.find((e) => e.type === 'invokes');
    expect(edge.evidence[0]).toMatchObject({ file: CTX, line: 6, token: 'start' });
  });

  it('passes the graph validator: every invokes evidence line holds its token', () => {
    const { report } = validateAgainstSource({ graph: structuredClone(graph), reader: createSourceReader(root) });
    expect(report.findings.edgeContradicted.filter((f) => f.type === 'invokes')).toEqual([]);
    const count = graph.edges.filter((e) => e.type === 'invokes').length;
    expect(count).toBe(Object.keys(EXPECTED).length);
    const plain = structuredClone({ ...graph, edges: graph.edges.filter((e) => e.type !== 'invokes') });
    const { report: baseline } = validateAgainstSource({ graph: plain, reader: createSourceReader(root) });
    expect(report.issues).toEqual(baseline.issues);
    expect(report.counts).toEqual({ ...baseline.counts, edgesChecked: baseline.counts.edgesChecked + count, edgeConfirmed: baseline.counts.edgeConfirmed + count });
  });

  it('reports an invokes edge whose cited line does not hold the token', () => {
    const corrupted = structuredClone(graph);
    const edge = corrupted.edges.find((e) => e.type === 'invokes' && e.evidence.length === 1 && e.evidence[0].token === 'run' && e.evidence[0].file === CTX);
    edge.evidence[0].line = 5; // `<bean id="job" class="com.acme.NightlyJob"/>`: no `run` on it
    const { report } = validateAgainstSource({ graph: corrupted, reader: createSourceReader(root) });
    expect(report.findings.edgeContradicted.filter((f) => f.type === 'invokes').map((f) => f.edgeKey)).toEqual([`invokes|${edge.source}|${edge.target}`]);
  });

  it('reports the method call coverage and its gaps through project_status', () => {
    const status = createProjectService(root).projectStatus();
    expect(status.status).toBe('ok');
    expect(status.data.factCoverage.methodCalls).toMatchObject({ status: 'ran', siteCount: 27, buckets: { edge: 14, optionalInactive: 1 } });
    expect(status.gaps.map((g) => g.kind)).toEqual(expect.arrayContaining(Object.values(XML_METHOD_CALL_GAP_KINDS)));
  });

  describe('unused-code candidates', () => {
    let product;
    beforeAll(() => {
      const run = spawnSync(process.execPath, [join(REPO, 'skills/excavator/unused-code.mjs'), 'candidates', root], { encoding: 'utf-8' });
      expect(run.status, run.stderr).toBe(0);
      product = JSON.parse(readFileSync(join(root, '.excavator', 'unused-candidates.json'), 'utf-8'));
    });

    it('treats the target of an invokes edge as a root: it and what it calls are no candidates', () => {
      const names = product.candidates.map((c) => c.id.split(':').pop());
      // OrderService#start calls loadCache, which calls warm: all three are reachable
      for (const reached of ['OrderService#start()', 'OrderService#loadCache()', 'OrderService#warm()', 'BaseService#setOrderDao(OrderDao)', 'A#init()']) {
        expect(names).not.toContain(reached);
      }
      // the overridden declaration is reached through `overrides` from the one the container calls
      expect(names).not.toContain('DupBase#reset()');
      // the overloads no edge was drawn to, and the method nothing names, stay candidates
      expect(names).toEqual(['Orphan#unused()', 'Overloaded#of(String)', 'Overloaded#of(int)']);
    });

    it('counts the roots by edge type: eleven distinct methods are called by descriptors and no route handler', () => {
      expect(product.counts.roots).toEqual({ routes: 0, invokes: 11 });
      expect(product.counts).toMatchObject({ functionNodes: 17, routeReachable: 14, candidates: 3 });
      expect(product.conservation).toEqual({ functionNodes: 17, routeReachable: 14, candidates: 3, holds: true });
    });
  });
});
