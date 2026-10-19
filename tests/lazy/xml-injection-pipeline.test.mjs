// xml-injection-references, tasks 5.1-5.4: XML injection sites in the real Lazy
// driver - the `injects` edges, the visible buckets, the gaps and the coverage
// section - and what reads them: the graph validator, the traversal, the project
// service and the MCP server. The fixture is a purpose-built synthetic project
// (tests/fixtures/spring-xml-injection): two deployment units, a Spring context
// in no unit, every site shape, and one name per way a site can end. It is
// copied to a temp directory because a Lazy run writes `.excavator/` next to
// the source.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import { PIPELINE_VERSION, runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { createProjectService } from '../../skills/excavator/project-service.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { readStructureAll } from '../../skills/excavator/structure-all-store.mjs';
import { loadNameBindingCatalog } from '../../skills/excavator/name-binding-catalog.mjs';
import { createSourceReader, validateAgainstSource } from '../../skills/excavator/validate-graph.mjs';
import { DETERMINISTIC_EDGE_TYPES, boundedBFS, oneHop } from '../../skills/excavator/retrieve.mjs';
import {
  XML_INJECTION_BUCKETS,
  XML_INJECTION_GAP_KINDS,
  assertInjectionConservation,
} from '../../skills/excavator/xml-injection-resolution.mjs';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/spring-xml-injection');
const SERVER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../skills/excavator/mcp-server.mjs');
const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

const copyFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'excavator-xml-injection-'));
  cpSync(FIXTURE, root, { recursive: true });
  return root;
};
const readProduct = (root) => readKnowledgeGraph(join(root, '.excavator', KNOWLEDGE_GRAPH_FILE));

/** Files by path and classes by `path#Name`. */
function labeller(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return (id) => {
    const node = byId.get(id);
    return node.type === 'file' ? node.filePath : `${node.filePath}#${node.name}`;
  };
}

const JAVA = 'app/src/main/java/com/acme';
const RES = 'app/src/main/resources';
const CTX = `${RES}/ctx.xml`;
const CTX_TEST = `${RES}/ctx-test.xml`;
const LEGACY = `${RES}/legacy-ctx.xml`;
const LOOSE = 'loose/loose.xml';
const cls = (name) => `${JAVA}/${name}.java#${name}`;
const link = (from, to) => `${cls(from)} -> ${cls(to)}`;

// Every edge the fixture's contexts draw, written out. The consumer is the class
// of the bean the site is in (the nearest one, an inner bean included, or the
// class its parent gives it); the target is the class the name comes to (through
// an alias, a parent, an annotation or a dotted id).
const EXPECTED_INJECTS = [
  link('OrderServiceImpl', 'OrderDaoImpl'), // p:cache-ref, an alias, a collection ref, an entry key-ref, a replacer
  link('OrderServiceImpl', 'MainDs'), // c:ds-ref to a dotted id
  link('OrderServiceImpl', 'BaseDao'), // a constructor-arg and an entry value-ref to a parent-only definition
  link('OrderServiceImpl', 'AuditLog'), // a name only an annotation declares, by property and by lookup-method
  link('Node', 'Node'), // a self-loop
  link('BaseDao', 'OrderDaoImpl'), // an inner bean is the consumer of its own site
  link('BaseDao', 'MainDs'), // the consumer has only a parent, and takes its class from it
  link('Node', 'OrderDaoImpl'), // a ref local to a bean of the same file
  link('Node', 'MainDs'), // two files, one with no namespace and one in no unit
].sort();

describe('XML injection sites in the real Lazy driver', () => {
  let root;
  let result;
  let graph;
  beforeAll(async () => {
    root = copyFixture();
    result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    graph = readProduct(root);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const label = (id) => labeller(graph)(id);
  const injects = () => graph.edges.filter((e) => e.type === 'injects');
  const edgeOf = (from, to) => injects().find((e) => label(e.source) === cls(from) && label(e.target) === cls(to));
  const linesOf = (file) => readFileSync(join(root, file), 'utf-8').split('\n');
  const gap = (kind) => graph.gaps.find((g) => g.kind === kind);

  it('stamps the product with the new pipeline version', () => {
    expect(result.saveError).toBeNull();
    expect(PIPELINE_VERSION).toBe('lazy-fact-graph/13');
    expect(graph.project.pipelineVersion).toBe('lazy-fact-graph/13');
  });

  it('records no framework in the header: its poms and Spring contexts declare no framework keyword', () => {
    expect(graph.project.frameworks).toEqual([]);
  });

  it('keeps the name-reference stage where it was in the stages row: after mentions, before the fact graph, timed', () => {
    const stages = Object.keys(result.timings);
    expect(stages.indexOf('nameReferences')).toBeGreaterThan(stages.indexOf('mentions'));
    expect(stages.indexOf('nameReferences')).toBeLessThan(stages.indexOf('factGraph'));
    expect(Number.isInteger(result.timings.nameReferences)).toBe(true);
    const other = copyFixture();
    try {
      const run = spawnSync('node', [resolve(FIXTURE, '../../../skills/excavator/lazy-analyze.mjs'), other], { encoding: 'utf-8' });
      expect(run.status).toBe(0);
      expect(run.stderr).toMatch(/lazy-analyze: stages .*mentions=\d+ms nameReferences=\d+ms factGraph=\d+ms/);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('draws exactly the expected injects edges: extracted, forward, weight 0.5, with the evidence of every site', () => {
    expect(injects().map((e) => `${label(e.source)} -> ${label(e.target)}`).sort()).toEqual(EXPECTED_INJECTS);
    expect(injects().every((e) => e.provenance === 'extracted' && e.weight === 0.5 && e.direction === 'forward' && e.evidence.length > 0)).toBe(true);
    const sites = (from, to) => edgeOf(from, to).evidence.map((x) => `${x.file.split('/').pop()}:${x.line}:${x.site}`);
    expect(sites('OrderServiceImpl', 'OrderDaoImpl')).toEqual([
      'ctx.xml:22:spring-p-ref', 'ctx.xml:24:spring-property-ref', 'ctx.xml:26:spring-ref-bean', 'ctx.xml:27:spring-entry-key-ref', 'ctx.xml:29:spring-replaced-method',
    ]);
    expect(sites('OrderServiceImpl', 'MainDs')).toEqual(['ctx.xml:22:spring-c-ref']);
    expect(sites('OrderServiceImpl', 'BaseDao')).toEqual(['ctx.xml:23:spring-constructor-arg-ref', 'ctx.xml:27:spring-entry-value-ref']);
    expect(sites('OrderServiceImpl', 'AuditLog')).toEqual(['ctx.xml:25:spring-property-ref', 'ctx.xml:28:spring-lookup-method']);
    expect(sites('Node', 'Node')).toEqual(['ctx.xml:49:spring-property-ref']);
    expect(sites('BaseDao', 'OrderDaoImpl')).toEqual(['ctx.xml:52:spring-property-ref']);
    expect(sites('BaseDao', 'MainDs')).toEqual(['ctx.xml:80:spring-property-ref']);
    expect(sites('Node', 'OrderDaoImpl')).toEqual(['ctx-test.xml:5:spring-ref-local']);
    expect(sites('Node', 'MainDs')).toEqual(['legacy-ctx.xml:6:spring-ref-local', 'loose.xml:4:spring-property-ref']);
  });

  it('cites a ref through an alias with the alias and the bean it names (spec: alias)', () => {
    const [, viaAlias] = edgeOf('OrderServiceImpl', 'OrderDaoImpl').evidence;
    expect(viaAlias).toEqual({
      file: CTX, line: 24, source: 'lexical', token: 'orders', site: 'spring-property-ref',
      consumer: { line: 22, bindings: [] },
      bindings: [{ file: CTX, line: 7, binder: 'spring-xml-bean' }, { file: CTX, line: 8, binder: 'spring-xml-alias' }],
    });
  });

  it('cites a ref to a definition that only has a parent with both definitions, and a name only an annotation declares with the annotation line', () => {
    const [viaParent] = edgeOf('OrderServiceImpl', 'BaseDao').evidence;
    expect(viaParent).toEqual({
      file: CTX, line: 23, source: 'lexical', token: 'childDao', site: 'spring-constructor-arg-ref',
      consumer: { line: 22, bindings: [] },
      bindings: [{ file: CTX, line: 9, binder: 'spring-xml-bean' }, { file: CTX, line: 10, binder: 'spring-xml-bean' }],
    });
    const [annotated] = edgeOf('OrderServiceImpl', 'AuditLog').evidence;
    expect(annotated.bindings).toEqual([{ file: `${JAVA}/AuditLog.java`, line: 6, binder: 'spring-annotation-stereotype' }]);
  });

  it('cites a consumer that takes its class from its parent with the parent definition (spec: consumer inherits)', () => {
    expect(edgeOf('BaseDao', 'MainDs').evidence).toEqual([{
      file: CTX, line: 80, source: 'lexical', token: 'com.acme.api.MainDs', site: 'spring-property-ref',
      consumer: { line: 79, bindings: [{ file: CTX, line: 9, binder: 'spring-xml-bean' }] },
      bindings: [{ file: CTX, line: 11, binder: 'spring-xml-bean' }],
    }]);
  });

  it('draws a self-loop for a bean referring to another bean of its own class', () => {
    const loop = edgeOf('Node', 'Node');
    expect(loop.source).toBe(loop.target);
    expect(loop.evidence).toEqual([{
      file: CTX, line: 49, source: 'lexical', token: 'node2', site: 'spring-property-ref',
      consumer: { line: 48, bindings: [] },
      bindings: [{ file: CTX, line: 56, binder: 'spring-xml-bean' }],
    }]);
  });

  it('gives an inner bean\'s site to the inner bean, and not to the bean around it', () => {
    expect(edgeOf('BaseDao', 'OrderDaoImpl').evidence[0].consumer).toEqual({ line: 51, bindings: [] });
    expect(edgeOf('Node', 'OrderDaoImpl').evidence.map((e) => e.file)).toEqual([CTX_TEST]); // not node1's
  });

  it('merges the sites of two files, one with no namespace and one in no unit, into one edge', () => {
    expect(edgeOf('Node', 'MainDs').evidence.map((e) => [e.file, e.line, e.token, e.site])).toEqual([
      [LEGACY, 6, 'legacyTarget', 'spring-ref-local'],
      [LOOSE, 4, 'looseTarget', 'spring-property-ref'],
    ]);
  });

  it('puts every site in one of the fourteen buckets, and counts them (design D8)', () => {
    const { injections } = graph.coverage;
    expect(Object.keys(injections.buckets)).toEqual([...XML_INJECTION_BUCKETS]);
    expect(injections.status).toBe('ran');
    expect(injections.siteCount).toBe(36);
    expect(injections.buckets).toEqual({
      outside: 1, // ref parent
      bundle: 0, // no Spring binder of the shipped catalog declares a resource bundle (a catalog of one does: see xml-injection-resolution.test.mjs)
      external: 2, // a data source of a library, which a library's bean is also injected with
      unindexed: 1, // an annotation type: a repository class with no node
      unknown: 4, // a factory method, a parent no file declares, an alias cycle, an alias of a name another unit declares
      ambiguous: 1, // one name, two classes, in two files of one unit
      elsewhere: 4, // another unit, another namespace, another file of the unit for a ref local, and a file in no unit
      unbound: 1,
      edge: 16,
      consumerExternal: 1, // a library's proxy factory bean
      consumerMissing: 1, // a ref in a top-level collection
      consumerUnknown: 2, // a factory method, a parent no file declares
      consumerUnindexed: 1,
      consumerAmbiguous: 1, // a parent whose name is two classes
    });
    expect(Object.values(injections.buckets).reduce((a, b) => a + b, 0)).toBe(injections.siteCount);
  });

  it('counts the sites by id, every id listed, and the files each family read', () => {
    const { injections } = graph.coverage;
    expect(injections.sites).toEqual({
      'spring-property-ref': 23,
      'spring-constructor-arg-ref': 1,
      'spring-ref-bean': 2,
      'spring-ref-local': 3,
      'spring-ref-parent': 1,
      'spring-entry-key-ref': 1,
      'spring-entry-value-ref': 1,
      'spring-lookup-method': 1,
      'spring-replaced-method': 1,
      'spring-p-ref': 1,
      'spring-c-ref': 1,
    });
    expect(Object.keys(injections.sites)).toEqual(loadNameBindingCatalog().xmlInjections[0].sites.map((s) => s.id));
    // ctx.xml, ctx-test.xml, legacy-ctx.xml, lib/ctx.xml and loose.xml; the Java EE beans.xml is no Spring file
    expect(injections.files).toEqual({ 'spring-xml-injection': 5 });
  });

  it('counts the reference shapes it read no site from, empty values and commented-out sites among what is not counted', () => {
    expect(graph.coverage.injections.uncovered).toEqual({
      'custom-filter@ref': 1, // a prefixed element of another namespace
      'http@entry-point-ref': 1, // a -ref attribute no site names
      idref: 1, // it passes the id, not the bean
      'property@ref': 1, // ref="" has no name
    });
  });

  it('records the five gap kinds, each with the count of its buckets, in the language of the file they are in', () => {
    const counts = Object.fromEntries([...new Set(Object.values(XML_INJECTION_GAP_KINDS))].map((kind) => [kind, graph.gaps.filter((g) => g.kind === kind).reduce((sum, g) => sum + g.count, 0)]));
    expect(counts).toEqual({
      'injection-target-unresolved': 6, // outside 1, unindexed 1, unknown 4
      'injection-ambiguous': 1,
      'injection-elsewhere': 4,
      'injection-unbound': 1,
      'injection-consumer-unresolved': 5, // missing 1, unknown 2, unindexed 1, ambiguous 1
    });
    for (const kind of Object.keys(counts)) expect(gap(kind)).toMatchObject({ scope: 'xml', count: counts[kind] });
    expect(() => assertInjectionConservation(graph.coverage.injections, counts)).not.toThrow();
  });

  it('writes each gap sample as file, line, name and what it names or why not (design D8)', () => {
    const BASE = cls('BaseDao');
    const ORDER = cls('OrderDaoImpl');
    expect(gap('injection-target-unresolved').samples).toEqual([
      `${CTX}:31 svc -> [${CTX}:13 (factory-method)]`,
      `${CTX}:32 orphanChild -> [${CTX}:14 (missingBase has no binding in this unit)]`,
      `${CTX}:33 a -> [${CTX}:15 (cycle)]`,
      `${CTX}:34 dir -> [${CTX}:17 (userDirectory has no binding in this unit)]`,
      `${CTX}:36 marker -> [com.acme.Marker]`,
    ]); // the sixth, `ref parent` on line 41, is counted and not sampled
    expect(gap('injection-ambiguous').samples).toEqual([`${CTX}:30 store -> [${BASE}, ${ORDER}]`]);
    expect(gap('injection-elsewhere').samples).toEqual([
      `${CTX}:37 userDirectory -> [lib [spring]]`, // another unit
      `${CTX}:38 cdiDao -> [app [el]]`, // a CDI Named bean: another namespace
      `${CTX}:40 localDao -> [app [spring] in ${CTX_TEST}]`, // ref local: another file of the unit
      `${LOOSE}:5 orderDao -> [app [spring], lib [spring]]`, // a file in no unit sees no unit's names
    ]);
    expect(gap('injection-unbound').samples).toEqual([`${CTX}:39 nothing -> []`]);
    expect(gap('injection-consumer-unresolved').samples).toEqual([
      `${CTX}:60 orderDao -> [consumerMissing: no enclosing bean element]`,
      `${CTX}:63 orderDao -> [consumerUnknown: factory-method]`,
      `${CTX}:66 orderDao -> [consumerUnknown: missingBase has no binding in this unit]`,
      `${CTX}:72 orderDao -> [consumerUnindexed: com.acme.Marker]`,
      `${CTX}:75 orderDao -> [consumerAmbiguous: ${BASE}, ${ORDER}]`,
    ]);
  });

  it('keeps a name of one unit out of another: lib declares orderDao too, and neither makes the other ambiguous', () => {
    // app's `orderDao` is OrderDaoImpl and lib's is BaseDao; the ambiguous bucket holds only `store`
    expect(graph.coverage.injections.buckets.ambiguous).toBe(1);
    expect(injects().some((e) => e.evidence.some((x) => x.file.startsWith('lib/') || x.bindings.some((b) => b.file.startsWith('lib/'))))).toBe(false);
  });

  it('is checkable: every cited line holds its token, and every binding line its name or an annotation (spec: checkable evidence)', () => {
    const catalog = loadNameBindingCatalog();
    const annotationBinders = new Set(catalog.annotationBinders.map((b) => b.id));
    let checked = 0;
    for (const edge of injects()) {
      for (const evidence of edge.evidence) {
        expect(linesOf(evidence.file)[evidence.line - 1], `${evidence.file}:${evidence.line}`).toContain(evidence.token);
        for (const binding of [...evidence.bindings, ...evidence.consumer.bindings]) {
          const text = linesOf(binding.file)[binding.line - 1];
          if (annotationBinders.has(binding.binder)) expect(text).toContain('@Component');
          else expect(text, `${binding.file}:${binding.line}`).toMatch(/\b(?:id|alias)="[^"]+"/);
          checked += 1;
        }
      }
    }
    // 16 evidence entries: the bindings each one cites, and the ones its consumer went through
    expect(checked).toBe(20);
  });

  it('adds nothing to the graph but injects edges and the injection gaps', () => {
    // the same run's own inputs, projected without the stage
    const intermediate = join(root, '.excavator', 'intermediate');
    const scan = JSON.parse(readFileSync(join(intermediate, 'scan-result.json'), 'utf-8'));
    const structureAll = readStructureAll(join(intermediate, 'structure-all.jsonl'));
    const importMap = JSON.parse(readFileSync(join(intermediate, 'import-map.json'), 'utf-8'));
    const without = buildFactGraph({ scan, structureAll, importMap });
    expect(without.coverage.injections).toEqual({ status: 'not-run' });
    expect(without.coverage.nameReferences).toEqual({ status: 'not-run' });
    expect(graph.nodes.length).toBe(without.nodes.length);
    // `without` has no mentions stage either: those edges and gaps are an earlier step's
    expect(graph.edges.filter((e) => !['injects', 'mentions', 'references'].includes(e.type)).length).toBe(without.edges.length);
    const added = new Set([...Object.values(XML_INJECTION_GAP_KINDS), 'mention-ambiguous', 'mention-target-unindexed', 'path-mention-unresolved']);
    expect(graph.gaps.filter((g) => !added.has(g.kind) && !g.kind.startsWith('name-reference-'))).toEqual(without.gaps);
  });

  it('writes the same coverage into the result of the run and the product', () => {
    expect(result.coverage.injections).toEqual(graph.coverage.injections);
  });

  it('is not an expression stage: the pages of the name-reference stage are not here, and its section is still written', () => {
    expect(graph.coverage.nameReferences).toMatchObject({ status: 'ran', rootCount: 0, bindings: { 'spring-xml-alias': 4 } });
  });
});

describe('what reads injects edges (design D7, tasks 5.3 and 5.4)', () => {
  let root;
  let graph;
  beforeAll(async () => {
    root = copyFixture();
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    graph = readProduct(root);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const label = (id) => labeller(graph)(id);
  const node = (name) => graph.nodes.find((n) => n.type === 'class' && n.name === name);

  it('is one of the deterministic edge types', () => {
    expect(DETERMINISTIC_EDGE_TYPES).toContain('injects');
  });

  it('takes the class that is injected to the class that consumes it, in one hop and within the bounded search (spec: from the injected class)', () => {
    const dao = node('OrderDaoImpl');
    const service = node('OrderServiceImpl');
    const hop = oneHop(graph.edges, [dao.id]);
    expect(hop.nodes).toContain(service.id);
    expect(hop.edges.some((e) => e.type === 'injects' && e.source === service.id && e.target === dao.id)).toBe(true);
    expect(boundedBFS(graph.edges, [dao.id], { maxHops: 1 }).nodes).toContain(service.id);
  });

  it('serves it through the project service, with the injects edge and its evidence', async () => {
    const dao = node('OrderDaoImpl');
    const traversed = await createProjectService(root).traverse({ seedIds: [dao.id], mode: 'one-hop' });
    expect(traversed.status).toBe('ok');
    expect(traversed.data.nodes.map((n) => n.name)).toContain('OrderServiceImpl');
    const edge = traversed.data.edges.find((e) => e.type === 'injects' && label(e.source) === `${JAVA}/OrderServiceImpl.java#OrderServiceImpl`);
    expect(edge.evidence.length).toBeGreaterThan(0);
  });

  it('passes the graph validator: every injects evidence line holds its token, and nothing else is new', () => {
    const { report } = validateAgainstSource({ graph: structuredClone(graph), reader: createSourceReader(root) });
    expect(report.findings.edgeContradicted.filter((f) => f.type === 'injects')).toEqual([]);
    // the graph without the injects edges reads the same, apart from how many edges were checked and confirmed
    const injectsCount = graph.edges.filter((e) => e.type === 'injects').length;
    expect(injectsCount).toBe(EXPECTED_INJECTS.length);
    const plain = structuredClone({ ...graph, edges: graph.edges.filter((e) => e.type !== 'injects') });
    const { report: baseline } = validateAgainstSource({ graph: plain, reader: createSourceReader(root) });
    expect(report.issues).toEqual(baseline.issues);
    // no new warning: the injects edges only add edges to classes that already have them
    expect(report.warnings.filter((w) => !baseline.warnings.includes(w))).toEqual([]);
    expect(report.counts).toEqual({
      ...baseline.counts,
      edgesChecked: baseline.counts.edgesChecked + injectsCount,
      edgeConfirmed: baseline.counts.edgeConfirmed + injectsCount,
    });
  });

  it('reports an injects edge whose cited line does not hold the name (spec: a line without the name)', () => {
    const corrupted = structuredClone(graph);
    const loop = corrupted.edges.find((e) => e.type === 'injects' && e.source === e.target);
    expect(loop.evidence).toHaveLength(1);
    loop.evidence[0].line = 1; // the opening tag of the file: no `node2` on it
    const { report } = validateAgainstSource({ graph: corrupted, reader: createSourceReader(root) });
    // (the `contains` and `exports` edges of an annotated class are contradicted either way: its line range starts at its first annotation)
    expect(report.findings.edgeContradicted.filter((f) => f.type === 'injects').map((f) => f.edgeKey)).toEqual([`injects|${loop.source}|${loop.target}`]);
    const { report: intact } = validateAgainstSource({ graph: structuredClone(graph), reader: createSourceReader(root) });
    expect(report.counts.edgeContradicted).toBe(intact.counts.edgeContradicted + 1);
  });

  it('does not ask an injects edge for the names of its two classes: the evidence line holds the name the XML wrote', () => {
    // the class names Node and OrderDaoImpl are not on the line `<property name="dao"><ref local="localDao"/>...`
    const edge = graph.edges.find((e) => e.type === 'injects' && e.evidence[0].file === CTX_TEST);
    expect(label(edge.source)).toBe(cls('Node'));
    expect(linesOf(CTX_TEST)[edge.evidence[0].line - 1]).not.toContain('OrderDaoImpl');
    const { report } = validateAgainstSource({ graph: structuredClone(graph), reader: createSourceReader(root) });
    expect(report.findings.edgeContradicted.some((f) => f.edgeKey === `injects|${edge.source}|${edge.target}`)).toBe(false);
  });

  function linesOf(file) {
    return readFileSync(join(root, file), 'utf-8').split('\n');
  }

  it('reports the injection coverage and its gaps through project_status', () => {
    const status = createProjectService(root).projectStatus();
    expect(status.status).toBe('ok');
    expect(status.data.factCoverage.injections).toMatchObject({ status: 'ran', siteCount: 36, buckets: { edge: 16, unbound: 1 }, uncovered: { idref: 1 } });
    expect(status.gaps.map((g) => g.kind)).toEqual(expect.arrayContaining(Object.values(XML_INJECTION_GAP_KINDS)));
  });

  it('serves the same through the real stdio MCP server: project_status, a traversal into the class and the evidence line of the edge', async () => {
    const client = new Client({ name: 'excavator-injection-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath, args: [SERVER_PATH, '--project-root', root], cwd: process.cwd(), stderr: 'pipe',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' },
    });
    await client.connect(transport);
    try {
      const status = await client.callTool({ name: 'project_status', arguments: {} });
      expect(status.structuredContent.status).toBe('ok');
      expect(status.structuredContent.data.factCoverage.injections).toMatchObject({ status: 'ran', siteCount: 36 });
      expect(status.structuredContent.gaps.map((g) => g.kind)).toEqual(expect.arrayContaining(['injection-unbound', 'injection-elsewhere']));

      const dao = node('OrderDaoImpl');
      const traversed = await client.callTool({ name: 'traverse', arguments: { seedIds: [dao.id], mode: 'one-hop' } });
      expect(traversed.structuredContent.data.edges.map((e) => e.type)).toContain('injects');
      expect(traversed.structuredContent.data.nodes.map((n) => n.name)).toContain('OrderServiceImpl');

      const evidence = await client.callTool({ name: 'read_evidence', arguments: { path: CTX, startLine: 24, endLine: 24 } });
      expect(evidence.structuredContent.data.text).toContain('ref="orders"');
    } finally {
      await client.close();
    }
  }, 60_000);
});
