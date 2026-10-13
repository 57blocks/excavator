// annotation-injection-references, tasks 4.1-4.4: Java annotation injection sites
// in the real Lazy driver - the `injects` edges, the visible buckets, the gaps and
// the coverage section - and what reads them: the graph validator, the traversal,
// the project service and the MCP server. The fixture is a purpose-built synthetic
// project (tests/fixtures/annotation-injection): three deployment units (a Spring
// application, a library whose class the application's XML manages, a Seam
// application), the Spring, Seam and EJB injection families, and one name per way
// a site can end. It is copied to a temp directory because a Lazy run writes
// `.excavator/` next to the source.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { auditGraphShape } from '@excavator/core';

import { PIPELINE_VERSION, runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { createProjectService } from '../../skills/excavator/project-service.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph, writeKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { readStructureAll } from '../../skills/excavator/structure-all-store.mjs';
import { loadNameBindingCatalog } from '../../skills/excavator/name-binding-catalog.mjs';
import { createSourceReader, validateAgainstSource } from '../../skills/excavator/validate-graph.mjs';
import { DETERMINISTIC_EDGE_TYPES, boundedBFS, oneHop } from '../../skills/excavator/retrieve.mjs';
import { XML_INJECTION_BUCKETS, assertInjectionConservation } from '../../skills/excavator/xml-injection-resolution.mjs';
import { ANNOTATION_INJECTION_BUCKETS, ANNOTATION_INJECTION_GAP_KINDS } from '../../skills/excavator/annotation-injection-resolution.mjs';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/annotation-injection');
const SERVER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../skills/excavator/mcp-server.mjs');
const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

const copyFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'excavator-annotation-injection-'));
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

const APP = 'app/src/main/java/com/acme';
const LIB = 'lib/src/main/java/com/acme/lib';
const SEAM = 'seam/src/main/java/com/acme/seam';
const CTX = 'app/src/main/resources/ctx.xml';
const LIB_CTX = 'lib/src/main/resources/ctx.xml';
const COMPONENTS = 'seam/src/main/resources/components.xml';
const cls = (dir, name) => `${dir}/${name}.java#${name}`;
const link = (from, to) => `${from} -> ${to}`;

const ORDER_SERVICE = cls(APP, 'OrderService');
const ORDER_DAO = cls(APP, 'OrderDaoImpl');
const AUDIT_LOG = cls(APP, 'AuditLog');
const WEB_ADVICE = cls(APP, 'WebAdvice');
const APP_CONFIG = cls(APP, 'AppConfig');
const XML_WIRED = cls(APP, 'XmlWired');
const ORDER_FACADE = cls(APP, 'OrderFacade');
const ORDER_BEAN = cls(APP, 'OrderBeanImpl');
const INVOICE_BEAN = cls(APP, 'InvoiceBean');
const LIB_CLIENT = cls(LIB, 'LibClient');
const ORDER_ACTION = cls(SEAM, 'OrderAction');

// Every edge the fixture's sites draw, written out. The consumer is the class that
// declares the annotated member (an XML bean for the XML sites); the target is the
// class the written, or defaulted, name comes to.
const EXPECTED_INJECTS = [
  link(ORDER_SERVICE, ORDER_DAO), // @Qualifier and @Resource on fields, a setter's default name, and a site in a nested class
  link(ORDER_SERVICE, AUDIT_LOG), // a field's default name, a constructor parameter and an XML property ref: one edge, two sources
  link(WEB_ADVICE, ORDER_DAO), // a class a ControllerAdvice manages
  link(APP_CONFIG, AUDIT_LOG), // a class a Configuration manages
  link(LIB_CLIENT, ORDER_DAO), // a class of another unit, which the XML of this unit manages: the name is looked up here
  link(XML_WIRED, ORDER_DAO), // only an XML ref: passes through the merge untouched
  link(ORDER_FACADE, ORDER_BEAN), // EJB beanName, a Stateless with a name
  link(ORDER_FACADE, INVOICE_BEAN), // EJB beanName, a Stateless without one: its ejb-name is the class name
  link(ORDER_ACTION, cls(SEAM, 'CustomerList')), // Seam In with the field's name
  link(ORDER_ACTION, cls(SEAM, 'BillingService')), // Seam In with a name
  link(ORDER_ACTION, cls(SEAM, 'MailerImpl')), // Seam In whose component components.xml declares
  link(ORDER_ACTION, cls(SEAM, 'Inventory')), // Seam In on a setter: the property's name
].sort();

describe('Java annotation injection sites in the real Lazy driver', () => {
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
  const edgeOf = (from, to) => injects().find((e) => label(e.source) === from && label(e.target) === to);
  const linesOf = (file) => readFileSync(join(root, file), 'utf-8').split('\n');
  const gaps = (kind) => graph.gaps.filter((g) => g.kind === kind);
  const sumOf = (kind) => gaps(kind).reduce((sum, g) => sum + g.count, 0);

  it('stamps the product with the new pipeline version', () => {
    expect(result.saveError).toBeNull();
    expect(PIPELINE_VERSION).toBe('lazy-fact-graph/9');
    expect(graph.project.pipelineVersion).toBe('lazy-fact-graph/9');
  });

  it('keeps the stages where they were in the stages row: the annotation sites add no stage and no file read', () => {
    const stages = Object.keys(result.timings);
    expect(stages.indexOf('nameReferences')).toBeGreaterThan(stages.indexOf('mentions'));
    expect(stages.indexOf('nameReferences')).toBeLessThan(stages.indexOf('factGraph'));
    expect(stages).not.toContain('annotationInjections');
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

  it('draws exactly the expected injects edges: extracted, forward, weight 0.5, each with evidence', () => {
    expect(injects().map((e) => `${label(e.source)} -> ${label(e.target)}`).sort()).toEqual(EXPECTED_INJECTS);
    expect(injects().every((e) => e.provenance === 'extracted' && e.weight === 0.5 && e.direction === 'forward' && e.evidence.length > 0)).toBe(true);
    // one edge per pair, however many sites draw it
    const sites = (from, to) => edgeOf(from, to).evidence.map((x) => `${x.file.split('/').pop()}:${x.line}:${x.site}`);
    expect(sites(ORDER_SERVICE, ORDER_DAO)).toEqual([
      'OrderService.java:13:spring-qualifier', 'OrderService.java:16:spring-resource', 'OrderService.java:25:spring-resource', 'OrderService.java:43:spring-resource',
    ]);
    expect(sites(ORDER_FACADE, ORDER_BEAN)).toEqual(['OrderFacade.java:8:ejb-bean-name']);
    expect(sites(ORDER_ACTION, cls(SEAM, 'CustomerList'))).toEqual(['OrderAction.java:9:seam-in']);
  });

  it('merges the two sources of one pair into one edge, with the Java and the XML evidence both (spec: two sources, one edge)', () => {
    const edges = injects().filter((e) => label(e.source) === ORDER_SERVICE && label(e.target) === AUDIT_LOG);
    expect(edges).toHaveLength(1);
    const stereotype = { file: `${APP}/OrderService.java`, line: 8, binder: 'spring-annotation-stereotype' };
    const xmlBean = { file: CTX, line: 10, binder: 'spring-xml-bean' };
    const auditBinding = { file: `${APP}/AuditLog.java`, line: 5, binder: 'spring-annotation-stereotype' };
    expect(edges[0].evidence).toEqual([
      // a field's default name: the token is the name
      {
        file: `${APP}/OrderService.java`, line: 20, source: 'lexical', token: 'auditLog', name: 'auditLog', site: 'spring-resource',
        consumer: { bindings: [stereotype, xmlBean] }, bindings: [auditBinding],
      },
      // a constructor parameter
      {
        file: `${APP}/OrderService.java`, line: 35, source: 'lexical', token: 'auditLog', name: 'auditLog', site: 'spring-qualifier',
        consumer: { bindings: [stereotype, xmlBean] }, bindings: [auditBinding],
      },
      // the XML source keeps its own shape: no `name`, the consumer is a line of the descriptor
      {
        file: CTX, line: 11, source: 'lexical', token: 'auditLog', site: 'spring-property-ref',
        consumer: { line: 10, bindings: [] }, bindings: [auditBinding],
      },
    ]);
    const kinds = new Set(edges[0].evidence.map((x) => x.file.endsWith('.java') ? 'java' : 'xml'));
    expect(kinds).toEqual(new Set(['java', 'xml']));
  });

  it('draws an edge only an XML ref draws as the XML stage did: no `name`, the consumer a descriptor line', () => {
    expect(edgeOf(XML_WIRED, ORDER_DAO).evidence).toEqual([{
      file: CTX, line: 15, source: 'lexical', token: 'orderDao', site: 'spring-property-ref',
      consumer: { line: 14, bindings: [] },
      bindings: [{ file: CTX, line: 3, binder: 'spring-xml-bean' }],
    }]);
  });

  it('cites a default name with the member that wrote it, not the name it came to (design D4: token and name)', () => {
    const [, , setter] = edgeOf(ORDER_SERVICE, ORDER_DAO).evidence;
    expect(setter).toEqual({
      file: `${APP}/OrderService.java`, line: 25, source: 'lexical', token: 'setOrderDao', name: 'orderDao', site: 'spring-resource',
      consumer: {
        bindings: [
          { file: `${APP}/OrderService.java`, line: 8, binder: 'spring-annotation-stereotype' },
          { file: CTX, line: 10, binder: 'spring-xml-bean' },
        ],
      },
      bindings: [{ file: CTX, line: 3, binder: 'spring-xml-bean' }],
    });
    expect(linesOf(setter.file)[setter.line - 1]).toContain('setOrderDao');
    expect(linesOf(setter.file)[setter.line - 1]).not.toContain('orderDao'); // the name is not on the line
    expect(edgeOf(ORDER_ACTION, cls(SEAM, 'Inventory')).evidence).toEqual([{
      file: `${SEAM}/OrderAction.java`, line: 20, source: 'lexical', token: 'setInventory', name: 'inventory', site: 'seam-in',
      consumer: { bindings: [{ file: `${SEAM}/OrderAction.java`, line: 6, binder: 'seam-annotation-name' }] },
      bindings: [{ file: `${SEAM}/Inventory.java`, line: 5, binder: 'seam-annotation-name' }],
    }]);
  });

  it('looks a name up where the container that manages the class looks, not where the class file is (spec: unit of the manager)', () => {
    // LibClient is in unit `lib`, whose own `orderDao` is LibDao; the XML that manages it is `app`'s
    expect(edgeOf(LIB_CLIENT, ORDER_DAO).evidence).toEqual([{
      file: `${LIB}/LibClient.java`, line: 6, source: 'lexical', token: 'orderDao', name: 'orderDao', site: 'spring-qualifier',
      consumer: { bindings: [{ file: CTX, line: 13, binder: 'spring-xml-bean' }] },
      bindings: [{ file: CTX, line: 3, binder: 'spring-xml-bean' }],
    }]);
    expect(injects().some((e) => label(e.target) === cls(LIB, 'LibDao'))).toBe(false);
    expect(injects().some((e) => e.evidence.some((x) => x.bindings.some((b) => b.file === LIB_CTX)))).toBe(false);
  });

  it('cites how each consumer is managed: a ControllerAdvice, a Configuration, a Seam Name and, for EJB, no one', () => {
    expect(edgeOf(WEB_ADVICE, ORDER_DAO).evidence[0].consumer).toEqual({ bindings: [{ file: `${APP}/WebAdvice.java`, line: 6, binder: 'spring-annotation-advice' }] });
    expect(edgeOf(APP_CONFIG, AUDIT_LOG).evidence[0].consumer).toEqual({ bindings: [{ file: `${APP}/AppConfig.java`, line: 6, binder: 'spring-annotation-stereotype' }] });
    expect(edgeOf(ORDER_ACTION, cls(SEAM, 'BillingService')).evidence[0].consumer).toEqual({ bindings: [{ file: `${SEAM}/OrderAction.java`, line: 6, binder: 'seam-annotation-name' }] });
    expect(edgeOf(ORDER_FACADE, ORDER_BEAN).evidence[0].consumer).toEqual({ bindings: [] }); // the family asks for no managing
  });

  it('resolves an EJB name to the bean that declares it, with a name or by the class name, and a Seam name to components.xml', () => {
    expect(edgeOf(ORDER_FACADE, ORDER_BEAN).evidence).toEqual([{
      file: `${APP}/OrderFacade.java`, line: 8, source: 'lexical', token: 'OrderBean', name: 'OrderBean', site: 'ejb-bean-name',
      consumer: { bindings: [] }, bindings: [{ file: `${APP}/OrderBeanImpl.java`, line: 6, binder: 'ejb-annotation-session' }],
    }]);
    expect(edgeOf(ORDER_FACADE, INVOICE_BEAN).evidence).toEqual([{
      file: `${APP}/OrderFacade.java`, line: 11, source: 'lexical', token: 'InvoiceBean', name: 'InvoiceBean', site: 'ejb-bean-name',
      consumer: { bindings: [] }, bindings: [{ file: `${APP}/InvoiceBean.java`, line: 5, binder: 'ejb-annotation-session' }],
    }]);
    expect(edgeOf(ORDER_ACTION, cls(SEAM, 'MailerImpl')).evidence).toEqual([{
      file: `${SEAM}/OrderAction.java`, line: 15, source: 'lexical', token: 'mailer', name: 'mailer', site: 'seam-in',
      consumer: { bindings: [{ file: `${SEAM}/OrderAction.java`, line: 6, binder: 'seam-annotation-name' }] },
      bindings: [{ file: COMPONENTS, line: 2, binder: 'seam-xml-component' }],
    }]);
  });

  it('draws a site in a nested class on the top-level class, and counts it (design D5)', () => {
    const nested = edgeOf(ORDER_SERVICE, ORDER_DAO).evidence.find((x) => x.line === 43);
    expect(linesOf(nested.file)[nested.line - 1]).toContain('@Resource(name = "orderDao")');
    expect(graph.coverage.annotationInjections.nested).toBe(2); // this one and a byType one beside it
  });

  it('puts every site in one of the fifteen buckets, and counts them (design D6, D8)', () => {
    const { annotationInjections } = graph.coverage;
    expect(Object.keys(annotationInjections.buckets)).toEqual([...ANNOTATION_INJECTION_BUCKETS]);
    expect(annotationInjections.status).toBe('ran');
    expect(annotationInjections.siteCount).toBe(38);
    expect(annotationInjections.buckets).toEqual({
      position: 1, // @Qualifier on a method
      nonLiteral: 2, // @Qualifier(ORDER_NAME), @EJB(beanName = BEAN)
      unnamed: 2, // an @EJB with no beanName, an @In on a method that is no setter
      expression: 1, // @In("#{currentUser.name}")
      consumerUnindexed: 1, // the member of an annotation type, which has no class node
      unmanaged: 3, // two @Resource of an EJB, an @In of a class no Seam binder declares
      edge: 15,
      bundle: 0, // no binder an injection family reads declares a resource bundle (the unit tests make one)
      external: 1, // a data source of a library
      unindexed: 1, // an annotation type: a repository class with no node
      unknown: 1, // a bean built by a factory method
      ambiguous: 1, // one name, a class an annotation declares and one the XML declares
      byType: 2, // a @Resource whose default name no bean has, and the one in the nested class
      elsewhere: 4, // another unit, another namespace, a JSF bean Seam does not inject, an ejb name that is a Spring bean
      unbound: 3, // no bean, no EJB, a Seam built-in
    });
    expect(Object.values(annotationInjections.buckets).reduce((a, b) => a + b, 0)).toBe(annotationInjections.siteCount);
  });

  it('counts the sites by id, every id listed in the catalog\'s order, and the annotations whose identity it could not confirm', () => {
    const { annotationInjections } = graph.coverage;
    expect(annotationInjections.sites).toEqual({
      'spring-qualifier': 12,
      'spring-resource': 10,
      'seam-in': 9,
      'ejb-bean-name': 7,
    });
    expect(Object.keys(annotationInjections.sites)).toEqual(
      loadNameBindingCatalog().annotationInjections.flatMap((family) => family.sites.map((site) => site.id)),
    );
    // Mystery.java imports `com.thirdparty.inject.*` and writes @Qualifier: it could be one; Shadowed.java's is a type of its own package (not counted at all)
    expect(annotationInjections.unconfirmed).toEqual({ Qualifier: 1 });
    expect(Object.values(annotationInjections.sites).reduce((a, b) => a + b, 0)).toBe(annotationInjections.siteCount);
    expect(injects().some((e) => [`${APP}/Mystery.java`, `${APP}/custom/Shadowed.java`].some((file) => label(e.source).startsWith(file)))).toBe(false);
  });

  it('leaves the XML stage its own coverage: the annotation sites are not XML sites', () => {
    const { injections } = graph.coverage;
    expect(injections).toMatchObject({ status: 'ran', siteCount: 3, files: { 'spring-xml-injection': 2 } });
    expect(injections.buckets).toMatchObject({ edge: 2, unbound: 1 });
    expect(Object.keys(injections.buckets)).toEqual([...XML_INJECTION_BUCKETS]);
  });

  it('records the five gap kinds of both sources, each with the count of its buckets, in the scope of the file they are in', () => {
    const counts = Object.fromEntries([...new Set(Object.values(ANNOTATION_INJECTION_GAP_KINDS))].map((kind) => [kind, sumOf(kind)]));
    expect(counts).toEqual({
      'injection-target-unresolved': 5, // nonLiteral 2, expression 1, unindexed 1, unknown 1; XML 0
      'injection-ambiguous': 1,
      'injection-elsewhere': 4,
      'injection-unbound': 4, // the annotations' 3 and the XML's 1
      'injection-consumer-unresolved': 1,
    });
    for (const kind of Object.keys(counts)) {
      const scopes = gaps(kind).map((g) => g.scope);
      expect(scopes, kind).toContain('java');
    }
    // the same kind in two scopes is two entries: what is in an XML file and what is in a Java file
    expect(gaps('injection-unbound').map((g) => [g.scope, g.count])).toEqual(expect.arrayContaining([['java', 3], ['xml', 1]]));
    expect(gaps('injection-unbound')).toHaveLength(2);
    expect(() => assertInjectionConservation(graph.coverage.injections, counts, graph.coverage.annotationInjections)).not.toThrow();
  });

  it('gives the Java-scope injection gaps the injection reason, not a Java call reason, and the same one as the XML scope (no collision)', () => {
    const [javaUnbound] = gaps('injection-unbound').filter((g) => g.scope === 'java');
    const [xmlUnbound] = gaps('injection-unbound').filter((g) => g.scope === 'xml');
    expect(javaUnbound.reason).toBe(xmlUnbound.reason);
    for (const kind of Object.keys(ANNOTATION_INJECTION_GAP_KINDS).map((bucket) => ANNOTATION_INJECTION_GAP_KINDS[bucket])) {
      for (const g of gaps(kind)) {
        expect(g.reason, `${kind} ${g.scope}`).toMatch(/^injection site\(s\)/);
        expect(g.reason).toMatch(/Java annotation/);
      }
    }
    expect(graph.gaps.filter((g) => g.scope === 'java' && g.kind.startsWith('calls-')).every((g) => /^Java call site\(s\)/.test(g.reason))).toBe(true);
  });

  it('writes each Java gap sample as file, line, name and what it names or why not (design D8)', () => {
    const java = (kind) => gaps(kind).find((g) => g.scope === 'java').samples;
    expect(java('injection-target-unresolved')).toEqual([
      `${APP}/OrderFacade.java:17 @EJB(beanName) -> [nonLiteral: the beanName argument is not a string literal]`,
      `${APP}/OrderService.java:32 @Qualifier(value) -> [nonLiteral: the value argument is not a string literal]`,
      `${APP}/ReportService.java:12 svc -> [${CTX}:6 (factory-method)]`,
      `${APP}/ReportService.java:15 marker -> [com.acme.Marker]`,
      `${SEAM}/OrderAction.java:24 #{currentUser.name} -> [expression: starts with "#{"]`,
    ]);
    expect(java('injection-ambiguous')).toEqual([`${APP}/ReportService.java:21 store -> [${ORDER_DAO}, ${cls(APP, 'StoreImpl')}]`]);
    expect(java('injection-elsewhere')).toEqual([
      `${APP}/OrderFacade.java:23 orderDao -> [app [spring], lib [spring]]`, // an EJB name that only Spring beans have
      `${APP}/ReportService.java:24 cdiBean -> [app [el]]`, // a CDI bean is no Spring bean
      `${LIB}/LibClient.java:9 libOnly -> [lib [spring]]`, // the unit that manages the class does not have it
      `${SEAM}/OrderAction.java:28 jsfOnly -> [seam [el]]`, // a JSF managed bean is no Seam component
    ]);
    expect(java('injection-unbound')).toEqual([
      `${APP}/OrderFacade.java:20 NoSuchBean -> []`,
      `${APP}/ReportService.java:9 nothing -> []`,
      `${SEAM}/OrderAction.java:31 facesMessages -> []`,
    ]);
    expect(java('injection-consumer-unresolved')).toEqual([`${APP}/Tagged.java:6 OrderBean -> [consumerUnindexed: no class node for Tagged]`]);
    expect(gaps('injection-unbound').find((g) => g.scope === 'xml').samples).toEqual([`${CTX}:16 ghost -> []`]);
  });

  it('is checkable: every cited line holds its token, a default name is the member\'s, and every binding line is its binder\'s (spec: checkable evidence)', () => {
    const BINDER_LINE = {
      'spring-annotation-stereotype': /@(?:Component|Service|Repository|Controller|Configuration|RestController)\b/,
      'spring-annotation-advice': /@(?:Rest)?ControllerAdvice\b/,
      'ejb-annotation-session': /@(?:Stateless|Stateful|Singleton)\b/,
      'seam-annotation-name': /@Name\(/,
      'spring-xml-bean': /\bid="[^"]+"/,
      'seam-xml-component': /\bname="[^"]+"/,
    };
    let evidenceChecked = 0;
    let bindingsChecked = 0;
    let defaults = 0;
    for (const edge of injects()) {
      for (const evidence of edge.evidence) {
        const text = linesOf(evidence.file)[evidence.line - 1];
        expect(text, `${evidence.file}:${evidence.line}`).toContain(evidence.token);
        evidenceChecked += 1;
        if (evidence.file.endsWith('.java')) {
          // a name written is the token; a default one is the member that stands for it: `setOrderDao` is `orderDao`
          if (evidence.token !== evidence.name) {
            expect(evidence.token).toBe(`set${evidence.name[0].toUpperCase()}${evidence.name.slice(1)}`);
            defaults += 1;
          }
        }
        const name = evidence.name ?? evidence.token;
        for (const binding of evidence.bindings) {
          const bound = linesOf(binding.file)[binding.line - 1];
          expect(bound, `${binding.file}:${binding.line}`).toMatch(BINDER_LINE[binding.binder]);
          // the line of the binding writes the name, unless it is an annotation with no argument: the name is the class's
          if (binding.binder.endsWith('-bean') || binding.binder.endsWith('-component') || /@\w+\(/.test(bound)) expect(bound).toContain(`"${name}"`);
          else expect(binding.file.split('/').pop()).toBe(`${name}.java`);
          bindingsChecked += 1;
        }
        for (const binding of evidence.consumer.bindings) {
          expect(linesOf(binding.file)[binding.line - 1], `${binding.file}:${binding.line}`).toMatch(BINDER_LINE[binding.binder]);
          bindingsChecked += 1;
        }
      }
    }
    // 15 Java entries (one per edge site) and 2 XML ones; the bindings each cites, and the ones its consumer went through
    expect(evidenceChecked).toBe(17);
    expect(defaults).toBe(2); // setOrderDao and setInventory
    expect(bindingsChecked).toBe(36);
  });

  it('adds nothing to the graph but injects edges and the injection gaps', () => {
    // the same run's own inputs, projected without the stage
    const intermediate = join(root, '.excavator', 'intermediate');
    const scan = JSON.parse(readFileSync(join(intermediate, 'scan-result.json'), 'utf-8'));
    const structureAll = readStructureAll(join(intermediate, 'structure-all.jsonl'));
    const importMap = JSON.parse(readFileSync(join(intermediate, 'import-map.json'), 'utf-8'));
    const without = buildFactGraph({ scan, structureAll, importMap });
    expect(without.coverage.annotationInjections).toEqual({ status: 'not-run' });
    expect(without.coverage.injections).toEqual({ status: 'not-run' });
    expect(graph.nodes.length).toBe(without.nodes.length);
    // `without` has no mentions stage either: those edges and gaps are an earlier step's
    expect(graph.edges.filter((e) => !['injects', 'mentions', 'references'].includes(e.type)).length).toBe(without.edges.length);
    const added = new Set([...Object.values(ANNOTATION_INJECTION_GAP_KINDS), 'mention-ambiguous', 'mention-target-unindexed', 'path-mention-unresolved']);
    expect(graph.gaps.filter((g) => !added.has(g.kind) && !g.kind.startsWith('name-reference-'))).toEqual(without.gaps);
  });

  it('writes the same coverage into the result of the run and the product', () => {
    expect(result.coverage.annotationInjections).toEqual(graph.coverage.annotationInjections);
    expect(result.coverage.injections).toEqual(graph.coverage.injections);
  });

  it('counts the two binders and three stereotypes this change added in the name-reference coverage', () => {
    const { nameReferences } = graph.coverage;
    expect(nameReferences.bindings).toMatchObject({ 'ejb-annotation-session': 2, 'spring-annotation-advice': 1 });
    expect(Object.keys(nameReferences.missingNames)).toEqual(expect.arrayContaining(['ejb-annotation-session', 'spring-annotation-advice']));
  });
});

describe('what reads annotation-sourced injects edges (design D7, tasks 4.3 and 4.4)', () => {
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
  const linesOf = (file) => readFileSync(join(root, file), 'utf-8').split('\n');

  it('is one of the deterministic edge types, and nothing else about the edge needed widening', () => {
    expect(DETERMINISTIC_EDGE_TYPES).toContain('injects');
  });

  it('takes the class that is injected to the classes that consume it by annotation, in one hop and within the bounded search (spec: from the injected class)', () => {
    const auditLog = node('AuditLog');
    const hop = oneHop(graph.edges, [auditLog.id]);
    // OrderService by both sources (merged), AppConfig by an annotation alone
    expect(hop.nodes).toEqual(expect.arrayContaining([node('OrderService').id, node('AppConfig').id]));
    expect(hop.edges.filter((e) => e.type === 'injects').map((e) => label(e.source)).sort()).toEqual([APP_CONFIG, ORDER_SERVICE]);
    expect(boundedBFS(graph.edges, [auditLog.id], { maxHops: 1 }).nodes).toEqual(expect.arrayContaining([node('AppConfig').id]));
    // a class that is injected by a managed class of another unit and by an advice
    const dao = oneHop(graph.edges, [node('OrderDaoImpl').id]);
    expect(dao.edges.filter((e) => e.type === 'injects').map((e) => label(e.source)).sort()).toEqual([LIB_CLIENT, ORDER_SERVICE, WEB_ADVICE, XML_WIRED].sort());
  });

  it('takes the consumer to what it is injected with, along the edge', () => {
    const facade = node('OrderFacade');
    const reached = boundedBFS(graph.edges, [facade.id], { maxHops: 1 }).nodes;
    expect(reached).toEqual(expect.arrayContaining([node('OrderBeanImpl').id, node('InvoiceBean').id]));
  });

  it('serves the traversal through the project service, with the merged edge and the evidence of both sources', async () => {
    const traversed = await createProjectService(root).traverse({ seedIds: [node('AuditLog').id], mode: 'one-hop' });
    expect(traversed.status).toBe('ok');
    expect(traversed.data.nodes.map((n) => n.name)).toEqual(expect.arrayContaining(['OrderService', 'AppConfig']));
    const edge = traversed.data.edges.find((e) => e.type === 'injects' && label(e.source) === ORDER_SERVICE);
    expect(edge.evidence.map((x) => x.file)).toEqual([`${APP}/OrderService.java`, `${APP}/OrderService.java`, CTX]);
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

  it('confirms an edge whose only cited line holds the member that stands for the name, though the name is not on it', () => {
    // `public void setInventory(Inventory stock)`: `inventory` is the name, `setInventory` the token
    const edge = graph.edges.find((e) => e.type === 'injects' && label(e.target) === cls(SEAM, 'Inventory'));
    expect(edge.evidence).toHaveLength(1);
    expect(linesOf(edge.evidence[0].file)[edge.evidence[0].line - 1]).not.toContain(edge.evidence[0].name);
    const { report } = validateAgainstSource({ graph: structuredClone(graph), reader: createSourceReader(root) });
    expect(report.findings.edgeContradicted.some((f) => f.edgeKey === `injects|${edge.source}|${edge.target}`)).toBe(false);
  });

  it('reports an injects edge whose cited Java line does not hold the token (spec: a line without the name)', () => {
    const corrupted = structuredClone(graph);
    const edge = corrupted.edges.find((e) => e.type === 'injects' && label(e.source) === LIB_CLIENT);
    expect(edge.evidence).toHaveLength(1);
    edge.evidence[0].line = 1; // `package com.acme.lib;`: no `orderDao` on it
    const { report } = validateAgainstSource({ graph: corrupted, reader: createSourceReader(root) });
    // (the `contains` and `exports` edges of an annotated class are contradicted either way: its line range starts at its first annotation)
    expect(report.findings.edgeContradicted.filter((f) => f.type === 'injects').map((f) => f.edgeKey)).toEqual([`injects|${edge.source}|${edge.target}`]);
    const { report: intact } = validateAgainstSource({ graph: structuredClone(graph), reader: createSourceReader(root) });
    expect(report.counts.edgeContradicted).toBe(intact.counts.edgeContradicted + 1);
  });

  it('passes the shape audit of the graph schema: an injects edge states its provenance and cites non-model evidence', () => {
    const audit = auditGraphShape(graph);
    expect(audit.issues.filter((issue) => issue.edgeKey?.startsWith('injects|'))).toEqual([]);
    expect(graph.edges.filter((e) => e.type === 'injects').length).toBe(EXPECTED_INJECTS.length);
  });

  it('reports the annotation injection coverage and its gaps through project_status', () => {
    const status = createProjectService(root).projectStatus();
    expect(status.status).toBe('ok');
    expect(status.data.factCoverage.annotationInjections).toMatchObject({
      status: 'ran', siteCount: 38, nested: 2, unconfirmed: { Qualifier: 1 }, buckets: { edge: 15, unmanaged: 3, byType: 2 },
    });
    expect(status.data.factCoverage.injections).toMatchObject({ status: 'ran', siteCount: 3 });
    expect(status.gaps.filter((g) => g.scope === 'java').map((g) => g.kind)).toEqual(
      expect.arrayContaining(['injection-target-unresolved', 'injection-ambiguous', 'injection-elsewhere', 'injection-unbound', 'injection-consumer-unresolved']),
    );
  });

  it('serves the same through the real stdio MCP server: project_status, a traversal into the class and the Java line of the evidence', async () => {
    const client = new Client({ name: 'excavator-annotation-injection-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath, args: [SERVER_PATH, '--project-root', root], cwd: process.cwd(), stderr: 'pipe',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' },
    });
    await client.connect(transport);
    try {
      const status = await client.callTool({ name: 'project_status', arguments: {} });
      expect(status.structuredContent.status).toBe('ok');
      expect(status.structuredContent.data.factCoverage.annotationInjections).toMatchObject({
        status: 'ran', siteCount: 38, buckets: { edge: 15, ambiguous: 1 }, sites: { 'seam-in': 9 },
      });
      expect(status.structuredContent.gaps.filter((g) => g.scope === 'java').map((g) => g.kind)).toEqual(expect.arrayContaining(['injection-unbound', 'injection-elsewhere']));

      const traversed = await client.callTool({ name: 'traverse', arguments: { seedIds: [node('AuditLog').id], mode: 'one-hop' } });
      expect(traversed.structuredContent.data.edges.map((e) => e.type)).toContain('injects');
      expect(traversed.structuredContent.data.nodes.map((n) => n.name)).toEqual(expect.arrayContaining(['OrderService', 'AppConfig']));

      const evidence = await client.callTool({ name: 'read_evidence', arguments: { path: `${APP}/OrderService.java`, startLine: 35, endLine: 35 } });
      expect(evidence.structuredContent.data.text).toContain('@Qualifier("auditLog")');
    } finally {
      await client.close();
    }
  }, 60_000);
});

describe('a product of the previous pipeline version (design D10, task 4.4)', () => {
  let root;
  beforeAll(async () => {
    root = copyFixture();
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('reads as stale, and the next sync projects it again whole: the coverage section and the annotation edges come back', async () => {
    const graphPath = join(root, '.excavator', KNOWLEDGE_GRAPH_FILE);
    const manifestPath = join(root, '.excavator', 'source-manifest.json');
    // what a /8 run left: no annotation injection coverage, no injects edge with a Java line of evidence
    const old = readKnowledgeGraph(graphPath);
    delete old.coverage.annotationInjections;
    old.edges = old.edges.filter((e) => e.type !== 'injects' || e.evidence.every((x) => x.file.endsWith('.xml')));
    old.project.pipelineVersion = 'lazy-fact-graph/8';
    writeKnowledgeGraph(graphPath, old);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, pipelineVersion: 'lazy-fact-graph/8' }, null, 2));

    const service = createProjectService(root);
    const before = service.projectStatus();
    expect(before.status).toBe('unavailable');
    expect(before.snapshot.freshness).toBe('stale');
    expect(before.data.factCoverage.annotationInjections).toBeUndefined();

    const synced = await service.syncFacts();
    expect(synced.status).toBe('ok');
    expect(synced.data.kind).toBe('synced');
    expect(synced.data.factCoverage.annotationInjections).toMatchObject({ status: 'ran', siteCount: 38 });
    const graph = readProduct(root);
    expect(graph.project.pipelineVersion).toBe('lazy-fact-graph/9');
    expect(graph.edges.filter((e) => e.type === 'injects')).toHaveLength(EXPECTED_INJECTS.length);
    expect(service.projectStatus().snapshot.freshness).toBe('fresh');
  });
});
