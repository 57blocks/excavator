// by-type-injection, tasks 4.2 to 4.4: the points a container fills by type, and the business interfaces a class declares by
// annotation, in the real Lazy driver - the `injects` edges, the declared `implements` edges, the visible buckets, the gaps and the
// coverage section - and what reads them: the graph validator, the traversal, the project service and the MCP server. The fixture
// is the `orders-inject` module of the purpose-built synthetic project tests/fixtures/javaee-jsf-app, and the `OrderBean` of its
// `orders-web` module. Every scenario of the module sits in a file (or a few) of its own, so that the group runs below can put
// one scenario at a time through the driver and say which bucket it lands in. The fixture is copied to a temp directory because a
// Lazy run writes `.excavator/` next to the source.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { auditGraphShape } from '@excavator/core';

import { PIPELINE_VERSION, runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { createProjectService } from '../../skills/excavator/project-service.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { readStructureAll } from '../../skills/excavator/structure-all-store.mjs';
import { loadNameBindingCatalog } from '../../skills/excavator/name-binding-catalog.mjs';
import { collectNameReferenceSites } from '../../skills/excavator/name-reference-sites.mjs';
import { collectMentionSites } from '../../skills/excavator/mention-sites.mjs';
import { loadRouteCatalog } from '../../skills/excavator/route-catalog.mjs';
import { loadTypeInjectionCatalog } from '../../skills/excavator/type-injection-catalog.mjs';
import { TYPE_INJECTION_BUCKETS, TYPE_INJECTION_GAP_KINDS, BUSINESS_INTERFACE_BUCKETS, BUSINESS_INTERFACE_GAP_KIND } from '../../skills/excavator/type-injection-resolution.mjs';
import { createSourceReader, validateAgainstSource } from '../../skills/excavator/validate-graph.mjs';
import { DETERMINISTIC_EDGE_TYPES, boundedBFS, oneHop } from '../../skills/excavator/retrieve.mjs';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/javaee-jsf-app');
const SERVER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../skills/excavator/mcp-server.mjs');
const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

const copyFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'excavator-type-injection-'));
  cpSync(FIXTURE, root, { recursive: true });
  return root;
};
const readProduct = (root) => readKnowledgeGraph(join(root, '.excavator', KNOWLEDGE_GRAPH_FILE));

/**
 * The inputs buildFactGraph was given by a run of the driver on `root`, read back from its intermediate products - but the type
 * injection catalog. The driver also gives it the route catalog, so these do: the graphs these tests build without the type stage
 * still have the endpoints the product has, and the comparisons stay about the by-type facts.
 */
function inputsOfRun(root) {
  const intermediate = join(root, '.excavator', 'intermediate');
  const scan = JSON.parse(readFileSync(join(intermediate, 'scan-result.json'), 'utf-8'));
  const structureAll = readStructureAll(join(intermediate, 'structure-all.jsonl'));
  const importMap = JSON.parse(readFileSync(join(intermediate, 'import-map.json'), 'utf-8'));
  const readFile = (path) => readFileSync(join(root, path), 'utf-8');
  const catalog = loadNameBindingCatalog();
  const mention = collectMentionSites({ scan, structureAll, readFile });
  return {
    scan, structureAll, importMap, mentionSites: mention.sites, mentionInputs: mention.inputs,
    nameReferenceSites: collectNameReferenceSites({ scan, catalog, readFile }), nameBindingCatalog: catalog,
    routeCatalog: loadRouteCatalog(),
  };
}

const M = 'orders-inject/src/main/java/com/acme/orders/inject';
const ALT = 'orders-inject/src/alt/java/com/acme/orders/inject';
const f = (path) => `${M}/${path}.java`;
const GREETING = f('unique/GreetingConsumer');
const LOOKUP = f('unique/GreetingLookup');
const SHIPPING = f('chain/ShippingConsumer');
const INVOICE = f('concrete/InvoiceConsumer');
const REPORT = f('wiring/ReportService');
const REPO = f('producers/RepoConsumer');
const PAYMENT = f('named/PaymentConsumer');
const QUOTE = f('business/QuoteConsumer');
const ORDER_BEAN = 'orders-web/src/main/java/com/acme/orders/web/OrderBean.java';
const ORDER_PROCESSOR_BEAN = 'orders-ejb/src/main/java/com/acme/orders/OrderProcessorBean.java';

const classId = (file, name) => `class:${file}:${name}`;
const JSR = 'jsr330-inject';
const EJB = 'ejb-inject';

/** The evidence of an injects edge: `rows` are `[line, role, token, extra?]`, in the order the graph sorts them. */
const evidence = (file, family, member, rows) => rows.map(([line, role, token, extra = {}]) => ({
  file, line, source: 'tree-sitter', token, role, family, member, ...extra,
}));
/** The two entries every point has: the annotation, and the member that carries it with the type it is declared with. */
const point = (file, family, member, { line, type, parameter, qualifier, producer }) => {
  const token = family === JSR ? 'Inject' : 'EJB';
  const own = parameter === undefined ? {} : { parameter };
  const rows = [];
  if (producer !== undefined) rows.push([producer, 'producer', 'Produces']);
  rows.push([line, 'injection', token, own]);
  if (qualifier !== undefined) rows.push([qualifier[0], 'qualifier', 'Named', { name: qualifier[1] }]);
  rows.push([qualifier === undefined ? line + 1 : line + 2, 'member', member, { ...own, type }]);
  return evidence(file, family, member, rows);
};

/**
 * Every injects edge of the fixture, in the order of `source|target`: the consumer, the target (a class, or the producer method), the
 * entries of the evidence. A producer is a method here, so that the edge ends at the method and not at its class.
 */
const INJECTS = [
  { from: classId(GREETING, 'GreetingConsumer'), to: classId(GREETING, 'GreeterImpl'), evidence: point(GREETING, JSR, 'greeter', { line: 12, type: 'Greeter' }) },
  { from: classId(LOOKUP, 'GreetingLookup'), to: classId(GREETING, 'GreeterImpl'), evidence: point(LOOKUP, EJB, 'typed', { line: 6, type: 'Object' }) },
  { from: classId(SHIPPING, 'ShippingConsumer'), to: classId(SHIPPING, 'GroundShipping'), evidence: point(SHIPPING, JSR, 'shipping', { line: 33, type: 'Shipping' }) },
  { from: classId(SHIPPING, 'ShippingConsumer'), to: classId(SHIPPING, 'FlatTax'), evidence: point(SHIPPING, JSR, 'tax', { line: 36, type: 'Tax' }) },
  { from: classId(INVOICE, 'InvoiceConsumer'), to: classId(INVOICE, 'InvoiceService'), evidence: point(INVOICE, EJB, 'invoices', { line: 9, type: 'InvoiceService' }) },
  { from: classId(REPORT, 'ReportService'), to: classId(REPORT, 'SystemClock'), evidence: point(REPORT, JSR, 'ReportService', { line: 24, type: 'Clock', parameter: 0 }) },
  { from: classId(REPORT, 'ReportService'), to: classId(REPORT, 'SmtpMailer'), evidence: point(REPORT, JSR, 'ReportService', { line: 24, type: 'Mailer', parameter: 1 }) },
  { from: classId(REPORT, 'ReportService'), to: classId(REPORT, 'DbAuditTrail'), evidence: point(REPORT, JSR, 'setAudit', { line: 28, type: 'AuditTrail', parameter: 0 }) },
  { from: classId(REPO, 'RepoConsumer'), to: `function:${REPO}:RepoProducers#repo()`, evidence: point(REPO, JSR, 'repo', { line: 35, type: 'Repo', producer: 11 }) },
  { from: classId(PAYMENT, 'PaymentConsumer'), to: classId(PAYMENT, 'CardPayment'), evidence: point(PAYMENT, JSR, 'card', { line: 23, type: 'Payment', qualifier: [24, 'card'] }) },
  { from: classId(PAYMENT, 'PaymentConsumer'), to: classId(PAYMENT, 'CashPayment'), evidence: point(PAYMENT, JSR, 'cash', { line: 27, type: 'Payment', qualifier: [28, 'cashPayment'] }) },
  { from: classId(PAYMENT, 'PaymentConsumer'), to: classId(PAYMENT, 'VoucherPayment'), evidence: point(PAYMENT, JSR, 'voucher', { line: 31, type: 'Payment', qualifier: [32, 'voucherPayment'] }) },
  { from: classId(QUOTE, 'QuoteConsumer'), to: classId(QUOTE, 'QuoteBean'), evidence: point(QUOTE, EJB, 'quote', { line: 16, type: 'Quote' }) },
  { from: classId(ORDER_BEAN, 'OrderBean'), to: classId(ORDER_PROCESSOR_BEAN, 'OrderProcessorBean'), evidence: point(ORDER_BEAN, JSR, 'processor', { line: 13, type: 'OrderProcessorLocal' }) },
].sort((a, b) => (`${a.from}|${a.to}` < `${b.from}|${b.to}` ? -1 : 1));

/** The one declared implements edge: `@Local(Quote.class)` on a class that writes no `implements`. */
const DECLARED = {
  from: classId(QUOTE, 'QuoteBean'),
  to: classId(QUOTE, 'Quote'),
  evidence: [{ file: QUOTE, line: 11, source: 'tree-sitter', token: 'Quote', role: 'businessInterface' }],
};

const bucketsOf = (names, nonZero) => Object.fromEntries(names.map((name) => [name, nonZero[name] ?? 0]));
const family = (annotations, points, edges, nonZero) => ({ annotations, points, buckets: bucketsOf(TYPE_INJECTION_BUCKETS, nonZero), edges });

describe('the type injection stage in the real Lazy driver (tasks 4.2 to 4.4)', () => {
  let root;
  let result;
  let graph;
  let byId;
  beforeAll(async () => {
    root = copyFixture();
    result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    graph = readProduct(root);
    byId = new Map(graph.nodes.map((n) => [n.id, n]));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const linesOf = (file) => readFileSync(join(root, file), 'utf-8').split('\n');
  const injectsEdges = () => graph.edges.filter((e) => e.type === 'injects');
  const declaredEdges = () => graph.edges.filter((e) => e.type === 'implements' && e.evidence.some((x) => x.role === 'businessInterface'));
  const typeGaps = () => graph.gaps.filter((g) => g.kind.startsWith('type-injection-') || g.kind === BUSINESS_INTERFACE_GAP_KIND);
  const outOf = (id) => injectsEdges().filter((e) => e.source === id).map((e) => e.target);

  it('stamps the product with the new pipeline version', () => {
    expect(result.saveError).toBeNull();
    expect(PIPELINE_VERSION).toBe('lazy-fact-graph/13');
    expect(graph.project.pipelineVersion).toBe('lazy-fact-graph/13');
  });

  it('draws exactly the injects edges of the list: the consumer, the one candidate, and the cited lines, tokens, roles, families, members, types and names', () => {
    const actual = injectsEdges()
      .map((e) => ({ from: e.source, to: e.target, evidence: e.evidence }))
      .sort((a, b) => (`${a.from}|${a.to}` < `${b.from}|${b.to}` ? -1 : 1));
    expect(actual).toEqual(INJECTS);
    for (const edge of injectsEdges()) {
      expect([edge.type, edge.direction, edge.weight, edge.provenance]).toEqual(['injects', 'forward', 0.5, 'extracted']);
      expect(byId.has(edge.source) && byId.has(edge.target)).toBe(true);
    }
  });

  it('ends the edge of a producer at the producer method, and no other edge at a method', () => {
    const toMethods = injectsEdges().filter((e) => byId.get(e.target).type === 'function');
    expect(toMethods.map((e) => e.target)).toEqual([`function:${REPO}:RepoProducers#repo()`]);
    expect(byId.get(toMethods[0].target)).toMatchObject({ name: 'repo', owner: 'RepoProducers', filePath: REPO });
    expect(toMethods[0].evidence.map((x) => [x.line, x.role, x.token])).toEqual([[11, 'producer', 'Produces'], [35, 'injection', 'Inject'], [36, 'member', 'repo']]);
  });

  it('draws one implements edge for the business interface the class does not write, citing the annotation line and the interface', () => {
    const [edge, ...rest] = declaredEdges();
    expect(rest).toEqual([]);
    expect({ from: edge.source, to: edge.target, evidence: edge.evidence }).toEqual(DECLARED);
    expect([edge.type, edge.direction, edge.weight, edge.provenance]).toEqual(['implements', 'forward', 0.9, 'extracted']);
    expect(linesOf(QUOTE)[10]).toBe('@Local(Quote.class)');
    // the interface the class writes (`implements Ledger`) is the hierarchy's edge, and no second one is drawn; neither for the others
    expect(graph.edges.filter((e) => e.type === 'implements' && e.source.includes('LedgerBean.java:LedgerBean'))).toHaveLength(1);
  });

  it('draws no edge for a point that the buckets put elsewhere: ambiguous, hidden, dynamic, alternative, unbound, type variable, nested, shadowed, by name, JNDI', () => {
    const none = (file, name) => expect(outOf(classId(file, name))).toEqual([]);
    none(f('hidden/HiddenConsumer'), 'HiddenConsumer');
    none(f('dynamic/RegistryConsumer'), 'RegistryConsumer');
    none(f('deployment/DiscountConsumer'), 'DiscountConsumer');
    none(f('unbound/OrphanConsumer'), 'OrphanConsumer');
    none(f('types/Box'), 'Box');
    none(f('types/TypeConsumer'), 'TypeConsumer');
    none(f('qualifiers/NotifierConsumer'), 'NotifierConsumer');
    none(f('shadow/ShadowConsumer'), 'ShadowConsumer');
    none(f('wiring/Positioned'), 'Positioned');
    // the three consumers of the shared interfaces have an edge for the points that have one, and not for the ones that do not
    expect(outOf(classId(SHIPPING, 'ShippingConsumer')).sort()).toEqual([classId(SHIPPING, 'FlatTax'), classId(SHIPPING, 'GroundShipping')]);
    expect(outOf(classId(PAYMENT, 'PaymentConsumer'))).toHaveLength(3);
    expect(outOf(classId(LOOKUP, 'GreetingLookup'))).toEqual([classId(GREETING, 'GreeterImpl')]);
    // the alternative is nobody's target
    expect(injectsEdges().some((e) => e.target.endsWith(':SeasonalDiscount'))).toBe(false);
  });

  it('counts every point of the fixture in one bucket of its family, and says what the identity could not confirm, which qualifiers it met, and the business interfaces', () => {
    expect(graph.coverage.typeInjections).toEqual({
      status: 'ran',
      families: {
        [JSR]: family(27, 28, 11, {
          nested: 1, memberUnindexed: 1, outsideType: 1, typeVariable: 1, typeUndetermined: 2, qualifierUnresolved: 1,
          hiddenCandidate: 3, dynamicCandidate: 1, noCandidate: 1, ambiguous: 2, deploymentDecided: 1, noTargetNode: 2, edge: 11,
        }),
        [EJB]: family(7, 7, 3, { byName: 1, jndi: 1, position: 2, edge: 3 }),
      },
      // the two `@Produces` of the JAX-RS resources, written under an on-demand import: no catalog annotation can be told from them
      unconfirmed: { Produces: 2 },
      qualifiers: { RestClient: 1 },
      businessInterfaces: {
        annotations: 7,
        declarations: 8,
        buckets: bucketsOf(BUSINESS_INTERFACE_BUCKETS, { notListed: 1, unreadable: 1, outsideType: 2, typeUndetermined: 1, notInterface: 1, alreadySupertype: 1, declared: 1 }),
        edges: 1,
      },
    });
    expect(result.coverage.typeInjections).toEqual(graph.coverage.typeInjections);
    // every one of the sixteen buckets and the eight business buckets but the two that nothing in a synthetic project can reach is used
    const used = new Set();
    for (const { buckets } of Object.values(graph.coverage.typeInjections.families)) for (const [name, count] of Object.entries(buckets)) if (count > 0) used.add(name);
    expect(TYPE_INJECTION_BUCKETS.filter((name) => !used.has(name))).toEqual([]);
    expect(Object.entries(graph.coverage.typeInjections.businessInterfaces.buckets).filter(([, count]) => count === 0).map(([name]) => name)).toEqual(['unindexed']);
  });

  it('records the gaps of the buckets that are gaps: one count per point, and the first five samples with the file, the line, the member and what it was told', () => {
    const view = typeGaps().map(({ kind, scope, count, samples }) => ({ kind, scope, count, samples }));
    expect(view).toEqual([
      { kind: 'business-interface-unresolved', scope: 'javax.ejb.Local', count: 2, samples: [
        `${f('business/BareBean')}:13 UnknownBean Missing`,
        `${f('business/ConstantBean')}:5 ConstantBean @Local(value)`,
      ] },
      { kind: 'type-injection-ambiguous', scope: JSR, count: 2, samples: [
        `${SHIPPING}:40 ShippingConsumer.pricing : Pricing -> com.acme.orders.inject.chain.BasePricing, com.acme.orders.inject.chain.PremiumPricing`,
        `${PAYMENT}:36 PaymentConsumer.any : Payment -> com.acme.orders.inject.named.CardPayment, com.acme.orders.inject.named.CashPayment, com.acme.orders.inject.named.VoucherPayment`,
      ] },
      { kind: 'type-injection-candidates-unresolved', scope: JSR, count: 8, samples: [
        `${f('deployment/DiscountConsumer')}:15 DiscountConsumer.discount : Discount`,
        `${f('dynamic/RegistryConsumer')}:17 RegistryConsumer.registry : Registry`,
        `${f('hidden/HiddenConsumer')}:44 HiddenConsumer.auditor : Auditor`,
        `${f('hidden/HiddenConsumer')}:47 HiddenConsumer.scheduler : Scheduler`,
        `${f('hidden/HiddenConsumer')}:50 HiddenConsumer.exporter : Exporter`,
      ] },
      { kind: 'type-injection-point-unresolved', scope: EJB, count: 1, samples: [`${LOOKUP}:13 GreetingLookup.looked : Greeter`] },
      { kind: 'type-injection-point-unresolved', scope: JSR, count: 2, samples: [
        `${f('types/TypeConsumer')}:14 TypeConsumer.inner : Twin`,
        `${f('wiring/Positioned')}:17 Positioned.put`,
      ] },
      { kind: 'type-injection-type-unresolved', scope: JSR, count: 3, samples: [
        `${f('types/Box')}:7 Box.item : T`,
        `${f('types/TypeConsumer')}:7 TypeConsumer.part : Holder.Part`,
        `${f('types/TypeConsumer')}:10 TypeConsumer.twin : Twin`,
      ] },
      { kind: 'type-injection-unbound', scope: JSR, count: 1, samples: [`${f('unbound/OrphanConsumer')}:10 OrphanConsumer.orphan : Orphan`] },
    ]);
    // each gap kind of the catalog of kinds is recorded, and nothing else starts with the prefix
    const kinds = new Set(Object.values(TYPE_INJECTION_GAP_KINDS));
    expect([...kinds].sort()).toEqual([...new Set(typeGaps().map((g) => g.kind).filter((kind) => kind !== BUSINESS_INTERFACE_GAP_KIND))].sort());
    // the gaps of the points add up to the buckets that are gaps
    const pointGaps = typeGaps().filter((g) => g.kind !== BUSINESS_INTERFACE_GAP_KIND).reduce((sum, g) => sum + g.count, 0);
    const bucketGaps = Object.values(graph.coverage.typeInjections.families)
      .flatMap(({ buckets }) => Object.entries(buckets).filter(([name]) => TYPE_INJECTION_GAP_KINDS[name] !== undefined))
      .reduce((sum, [, count]) => sum + count, 0);
    expect(pointGaps).toBe(bucketGaps);
  });

  it('adds nothing to the graph of the rows but the injects edges, the declared implements edge and the gaps and the coverage of the stage', () => {
    // the same run's own inputs, projected without the stage
    const inputs = inputsOfRun(root);
    const without = buildFactGraph(inputs);
    expect(without.coverage.typeInjections).toEqual({ status: 'not-run' });
    expect(without.edges.filter((e) => e.type === 'injects')).toEqual([]);
    expect(graph.nodes).toEqual(without.nodes);
    expect(graph.edges.filter((e) => e.type !== 'injects' && !declaredEdges().includes(e))).toEqual(without.edges);
    expect(graph.gaps.filter((g) => !typeGaps().includes(g))).toEqual(without.gaps);
    const { typeInjections, ...rest } = graph.coverage;
    const { typeInjections: notRun, ...restWithout } = without.coverage;
    expect(rest).toEqual(restWithout);
    expect(typeInjections.status).toBe('ran');
    expect(without.factsDigest).not.toBe(graph.project.factsDigest);
    // the run is the same as one given the same inputs and the catalog
    const again = buildFactGraph({ ...inputs, typeInjectionCatalog: loadTypeInjectionCatalog() });
    expect(again.factsDigest).toBe(graph.project.factsDigest);
    expect(again.nodes).toEqual(graph.nodes);
    expect(again.edges).toEqual(graph.edges);
    expect(again.gaps).toEqual(graph.gaps);
    expect(again.coverage).toEqual(graph.coverage);
  });

  it('draws the same by-type edges when the name stage is not run: they are merged on their own', () => {
    const inputs = inputsOfRun(root);
    const alone = buildFactGraph({ ...inputs, nameReferenceSites: undefined, nameBindingCatalog: undefined, typeInjectionCatalog: loadTypeInjectionCatalog() });
    expect(alone.coverage.typeInjections).toEqual(graph.coverage.typeInjections);
    expect(alone.coverage.nameReferences).toEqual({ status: 'not-run' });
    expect(alone.edges.filter((e) => e.type === 'injects')).toEqual(injectsEdges());
    expect(alone.edges.filter((e) => e.type === 'implements' && e.evidence.some((x) => x.role === 'businessInterface'))).toEqual(declaredEdges());
  });

  it('is not run by the standalone build-fact-graph entry, which reads only the intermediate files: the section says so and no edge is drawn', () => {
    const out = join(root, 'standalone-fact-graph.json');
    const run = spawnSync('node', [resolve(FIXTURE, '../../../skills/excavator/build-fact-graph.mjs'), root, '--out', out], { encoding: 'utf-8' });
    expect(run.status).toBe(0);
    const product = JSON.parse(readFileSync(out, 'utf-8'));
    expect(product.coverage.typeInjections).toEqual({ status: 'not-run' });
    expect(product.edges.some((e) => e.type === 'injects')).toBe(false);
    expect(product.edges.some((e) => e.evidence?.some((x) => x.role === 'businessInterface'))).toBe(false);
    expect(product.gaps.some((g) => g.kind.startsWith('type-injection-') || g.kind === BUSINESS_INTERFACE_GAP_KIND)).toBe(false);
  });

  it('refuses a catalog without the packages of the Java types that have no entry of their own: the identity of an annotation needs them', () => {
    const { mentionInputs, mentionSites, routeCatalog, ...inputs } = inputsOfRun(root);
    expect(() => buildFactGraph({ ...inputs, typeInjectionCatalog: loadTypeInjectionCatalog() })).toThrow(/typeInjectionCatalog needs mentionInputs/);
  });

  it('passes the integrity check of the driver, and the shape audit of the graph schema', () => {
    expect(result.validation).toEqual({ ok: true, issues: [] });
    const audit = auditGraphShape(graph);
    expect(audit.issues.filter((issue) => /^(injects|implements)\|/.test(issue.edgeKey ?? ''))).toEqual([]);
  });

  it('writes the same coverage into the result of the run and the product, and runs the stage inside the stage that reads the catalogs', () => {
    expect(Object.keys(result.timings)).toContain('nameReferences');
    expect(Object.keys(result.timings)).not.toContain('typeInjections');
    expect(result.coverage.typeInjections).toEqual(graph.coverage.typeInjections);
  });
});

describe('what reads the by-type edges (design D11, D13, tasks 4.2 and 4.4)', () => {
  let root;
  let graph;
  beforeAll(async () => {
    root = copyFixture();
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    graph = readProduct(root);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const node = (file, name) => graph.nodes.find((n) => n.id === classId(file, name));
  const linesOf = (file) => readFileSync(join(root, file), 'utf-8').split('\n');
  const edgeBetween = (type, from, to) => graph.edges.find((e) => e.type === type && e.source === from && e.target === to);

  it('is one of the deterministic edge types, for both kinds of edge the stage draws', () => {
    expect(DETERMINISTIC_EDGE_TYPES).toEqual(expect.arrayContaining(['injects', 'implements']));
  });

  it('takes an implementation to its consumer in one hop, along the edge backwards (spec: from an implementation to the classes that need it)', () => {
    const impl = node(SHIPPING, 'GroundShipping');
    const consumer = node(SHIPPING, 'ShippingConsumer');
    const hop = oneHop(graph.edges, [impl.id]);
    expect(hop.nodes).toContain(consumer.id);
    expect(hop.edges.filter((e) => e.type === 'injects').map((e) => [e.source, e.target])).toEqual([[consumer.id, impl.id]]);
    // the one implementation of two consumers is reached from both of them
    const shared = node(GREETING, 'GreeterImpl');
    expect(oneHop(graph.edges, [shared.id]).edges.filter((e) => e.type === 'injects').map((e) => e.source).sort()).toEqual(
      [node(GREETING, 'GreetingConsumer').id, node(LOOKUP, 'GreetingLookup').id].sort(),
    );
    expect(boundedBFS(graph.edges, [impl.id], { maxHops: 1 }).nodes).toEqual(expect.arrayContaining(hop.nodes));
  });

  it('takes the producer method to its consumer, and a session bean to the consumer of its interface and to the interface it declares', () => {
    const producer = graph.nodes.find((n) => n.id === `function:${REPO}:RepoProducers#repo()`);
    expect(oneHop(graph.edges, [producer.id]).nodes).toContain(node(REPO, 'RepoConsumer').id);
    const bean = node(QUOTE, 'QuoteBean');
    const hop = oneHop(graph.edges, [bean.id]);
    expect(hop.nodes).toEqual(expect.arrayContaining([node(QUOTE, 'QuoteConsumer').id, node(QUOTE, 'Quote').id]));
    expect(hop.edges.map((e) => e.type).filter((type) => type === 'implements' || type === 'injects').sort()).toEqual(['implements', 'injects']);
  });

  it('serves the traversal through the project service, both ways, with the evidence of the injects edge', async () => {
    const service = createProjectService(root);
    const impl = node(SHIPPING, 'GroundShipping');
    const inbound = await service.traverse({ seedIds: [impl.id], mode: 'one-hop' });
    expect(inbound.status).toBe('ok');
    expect(inbound.data.nodes.map((n) => n.name)).toContain('ShippingConsumer');
    const edge = inbound.data.edges.find((e) => e.type === 'injects');
    expect(edge.evidence.map((x) => [x.line, x.role, x.token])).toEqual([[33, 'injection', 'Inject'], [34, 'member', 'shipping']]);

    const consumer = node(SHIPPING, 'ShippingConsumer');
    const outbound = await service.traverse({ seedIds: [consumer.id], mode: 'one-hop' });
    expect(outbound.data.edges.filter((e) => e.type === 'injects').map((e) => e.target).sort()).toEqual(
      [node(SHIPPING, 'FlatTax').id, impl.id].sort(),
    );
  });

  it('passes the graph validator: every injects evidence line holds its token and every declared implements line names its ends, and nothing else is new', () => {
    const { report } = validateAgainstSource({ graph: structuredClone(graph), reader: createSourceReader(root) });
    expect(report.findings.edgeContradicted.filter((x) => x.type === 'injects')).toEqual([]);
    expect(report.findings.edgeContradicted.filter((x) => x.edgeKey === `implements|${DECLARED.from}|${DECLARED.to}`)).toEqual([]);
    // the graph without the by-type edges reads the same, apart from how many edges were checked and confirmed
    const byType = graph.edges.filter((e) => e.type === 'injects' || e === edgeBetween('implements', DECLARED.from, DECLARED.to));
    expect(byType).toHaveLength(15);
    const plain = structuredClone({ ...graph, edges: graph.edges.filter((e) => !byType.includes(e)) });
    const { report: baseline } = validateAgainstSource({ graph: plain, reader: createSourceReader(root) });
    expect(report.issues).toEqual(baseline.issues);
    expect(report.warnings.filter((w) => !baseline.warnings.includes(w))).toEqual([]);
    expect(baseline.warnings.filter((w) => !report.warnings.includes(w))).toEqual([]);
    expect(report.counts).toEqual({
      ...baseline.counts,
      edgesChecked: baseline.counts.edgesChecked + 15,
      edgeConfirmed: baseline.counts.edgeConfirmed + 15,
    });
  });

  it('is checkable: every cited line holds its token, the member line the member, and a qualifier line the name it writes', () => {
    for (const edge of graph.edges.filter((e) => e.type === 'injects')) {
      for (const entry of edge.evidence) {
        const line = linesOf(entry.file)[entry.line - 1];
        expect(line, `${entry.file}:${entry.line}`).toContain(entry.token);
        if (entry.role === 'qualifier') expect(line).toContain(`"${entry.name}"`);
      }
    }
    expect(linesOf(DECLARED.evidence[0].file)[DECLARED.evidence[0].line - 1]).toContain(DECLARED.evidence[0].token);
  });

  it('reports an injects edge whose cited lines hold none of its tokens (spec: a line without the token)', () => {
    const corrupted = structuredClone(graph);
    const edge = corrupted.edges.find((e) => e.type === 'injects' && e.source === classId(PAYMENT, 'PaymentConsumer') && e.target === classId(PAYMENT, 'CardPayment'));
    expect(edge.evidence).toHaveLength(3);
    for (const entry of edge.evidence) entry.line = 1; // `package com.acme.orders.inject.named;`: no Inject, no Named and no member on it
    const { report } = validateAgainstSource({ graph: corrupted, reader: createSourceReader(root) });
    expect(report.findings.edgeContradicted.filter((x) => x.type === 'injects').map((x) => x.edgeKey)).toEqual([`injects|${edge.source}|${edge.target}`]);
    const { report: intact } = validateAgainstSource({ graph: structuredClone(graph), reader: createSourceReader(root) });
    expect(intact.findings.edgeContradicted.filter((x) => x.type === 'injects')).toEqual([]);
    expect(report.counts.edgeContradicted).toBe(intact.counts.edgeContradicted + 1);
  });

  it('reports the declared implements edge whose cited line names neither end', () => {
    const corrupted = structuredClone(graph);
    const edge = corrupted.edges.find((e) => e.type === 'implements' && e.source === DECLARED.from && e.target === DECLARED.to);
    edge.evidence[0].line = 1; // `package com.acme.orders.inject.business;`
    const { report } = validateAgainstSource({ graph: corrupted, reader: createSourceReader(root) });
    expect(report.findings.edgeContradicted.map((x) => x.edgeKey)).toContain(`implements|${edge.source}|${edge.target}`);
    const { report: intact } = validateAgainstSource({ graph: structuredClone(graph), reader: createSourceReader(root) });
    expect(intact.findings.edgeContradicted.map((x) => x.edgeKey)).not.toContain(`implements|${edge.source}|${edge.target}`);
  });

  it('reports the coverage and the gaps of the stage through project_status', () => {
    const status = createProjectService(root).projectStatus();
    expect(status.status).toBe('ok');
    expect(status.data.factCoverage.typeInjections).toEqual(graph.coverage.typeInjections);
    expect(status.gaps.filter((g) => g.kind.startsWith('type-injection-')).map((g) => `${g.kind}|${g.scope}`).sort()).toEqual([
      'type-injection-ambiguous|jsr330-inject',
      'type-injection-candidates-unresolved|jsr330-inject',
      'type-injection-point-unresolved|ejb-inject',
      'type-injection-point-unresolved|jsr330-inject',
      'type-injection-type-unresolved|jsr330-inject',
      'type-injection-unbound|jsr330-inject',
    ]);
    expect(status.gaps.filter((g) => g.kind === BUSINESS_INTERFACE_GAP_KIND).map((g) => g.scope)).toEqual(['javax.ejb.Local']);
  });

  it('serves the same through the real stdio MCP server: project_status, a traversal from the implementation and the annotation line of the evidence', async () => {
    const client = new Client({ name: 'excavator-type-injection-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath, args: [SERVER_PATH, '--project-root', root], cwd: process.cwd(), stderr: 'pipe',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' },
    });
    await client.connect(transport);
    try {
      const status = await client.callTool({ name: 'project_status', arguments: {} });
      expect(status.structuredContent.status).toBe('ok');
      expect(status.structuredContent.data.factCoverage.typeInjections.families[JSR]).toMatchObject({ annotations: 27, points: 28, edges: 11 });
      expect(status.structuredContent.data.factCoverage.typeInjections.businessInterfaces).toMatchObject({ declarations: 8, edges: 1 });

      const impl = node(SHIPPING, 'GroundShipping');
      const inbound = await client.callTool({ name: 'traverse', arguments: { seedIds: [impl.id], mode: 'one-hop' } });
      const [edge] = inbound.structuredContent.data.edges.filter((e) => e.type === 'injects');
      expect(edge.source).toBe(node(SHIPPING, 'ShippingConsumer').id);
      const annotation = edge.evidence.find((x) => x.role === 'injection');
      const read = await client.callTool({ name: 'read_evidence', arguments: { path: annotation.file, startLine: annotation.line, endLine: annotation.line } });
      expect(read.structuredContent.data.text).toContain('@Inject');
    } finally {
      await client.close();
    }
  }, 60_000);
});

/**
 * One scenario at a time: the files of a scenario are copied into a project of their own and run through the driver, so that
 * what the coverage says is about that scenario only. This is what says which bucket each file of the module is for; the run of
 * the whole module only says that the buckets add up. The scenarios that only draw edges (the unique implementation, two levels,
 * a concrete class, a constructor, a name qualifier) are pinned by the exact edges of the run of the whole module.
 */
const GROUPS = [
  { name: 'a unique implementation of an interface, and a restated type with a bean name and a JNDI name', files: ['unique/GreetingConsumer', 'unique/GreetingLookup'],
    jsr: [1, { edge: 1 }], ejb: [3, { byName: 1, jndi: 1, edge: 1 }] },
  { name: 'positions the families do not read, and two methods no declaration of the row can tell', files: ['wiring/ReportService', 'wiring/Positioned'],
    jsr: [3, { edge: 3, memberUnindexed: 1 }], ejb: [2, { position: 2 }] },
  { name: 'a producer method, a producer field and a provider class', files: ['producers/RepoConsumer'], jsr: [3, { edge: 1, noTargetNode: 2 }] },
  { name: 'a type outside the repository and a qualifier nothing declares', files: ['qualifiers/NotifierConsumer'],
    jsr: [2, { outsideType: 1, qualifierUnresolved: 1 }], qualifiers: { RestClient: 1 } },
  { name: 'an implementation in a static nested type, an anonymous one and a local one', files: ['hidden/HiddenConsumer'], jsr: [3, { hiddenCandidate: 3 }] },
  { name: 'an interface whose class literal code writes', files: ['dynamic/RegistryConsumer'], jsr: [1, { dynamicCandidate: 1 }] },
  { name: 'the one implementation is an alternative', files: ['deployment/DiscountConsumer'], jsr: [1, { deploymentDecided: 1 }] },
  { name: 'nothing satisfies the type', files: ['unbound/OrphanConsumer'], jsr: [1, { noCandidate: 1 }] },
  { name: 'a type variable', files: ['types/Box'], jsr: [1, { typeVariable: 1 }] },
  { name: 'a nested type, a name two declarations carry, and a point in a nested type', files: ['types/Holder', 'types/Twin', 'types/TypeConsumer', 'alt:types/Twin'],
    jsr: [3, { nested: 1, typeUndetermined: 2 }] },
  { name: 'an annotation type of the same package and the same name as the injection annotation', files: ['shadow/Inject', 'shadow/ShadowConsumer'], jsr: [0, {}] },
  { name: 'a business interface the class does not write', files: ['business/QuoteConsumer'], ejb: [1, { edge: 1 }], business: [1, 1, { declared: 1 }] },
  { name: 'a business interface the class writes', files: ['business/LedgerBean'], business: [1, 1, { alreadySupertype: 1 }] },
  { name: 'a business interface given by a constant', files: ['business/Interfaces', 'business/ConstantBean'], business: [1, 1, { unreadable: 1 }] },
  { name: 'a business interface outside the repository', files: ['business/OutsideBean'], business: [1, 1, { outsideType: 1 }] },
  { name: 'a bare annotation, a class and an interface that cannot be resolved', files: ['business/BareBean', 'business/Interfaces'],
    business: [3, 4, { notListed: 1, notInterface: 1, typeUndetermined: 1, outsideType: 1 }] },
];

describe('each scenario of the module, run on its own, lands in the bucket it is for (design O1)', () => {
  let outcomes;
  beforeAll(async () => {
    outcomes = await Promise.all(GROUPS.map(async ({ files }) => {
      const dir = mkdtempSync(join(tmpdir(), 'excavator-type-injection-group-'));
      try {
        for (const name of files) {
          const rel = name.startsWith('alt:') ? `${ALT}/${name.slice(4)}.java` : f(name);
          mkdirSync(dirname(join(dir, rel)), { recursive: true });
          cpSync(join(FIXTURE, rel), join(dir, rel));
        }
        const run = await runLazyAnalysis({ projectRoot: dir, now: FIXED_NOW });
        return { coverage: run.coverage.typeInjections, validation: run.validation, gaps: readProduct(dir).gaps };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }));
  }, 120_000);

  it.each(GROUPS.map((group, index) => [group.name, index]))('%s', (name, index) => {
    const group = GROUPS[index];
    const { coverage, validation, gaps } = outcomes[index];
    expect(validation).toEqual({ ok: true, issues: [] });
    expect(coverage.status).toBe('ran');
    const [jsrAnnotations, jsrBuckets] = group.jsr ?? [0, {}];
    const [ejbAnnotations, ejbBuckets] = group.ejb ?? [0, {}];
    const sum = (buckets) => Object.values(buckets).reduce((total, count) => total + count, 0);
    expect(coverage.families[JSR]).toEqual(family(jsrAnnotations, sum(jsrBuckets), jsrBuckets.edge ?? 0, jsrBuckets));
    expect(coverage.families[EJB]).toEqual(family(ejbAnnotations, sum(ejbBuckets), ejbBuckets.edge ?? 0, ejbBuckets));
    expect(coverage.qualifiers).toEqual(group.qualifiers ?? {});
    expect(coverage.unconfirmed).toEqual({});
    const [businessAnnotations, businessDeclarations, businessBuckets] = group.business ?? [0, 0, {}];
    expect(coverage.businessInterfaces).toEqual({
      annotations: businessAnnotations,
      declarations: businessDeclarations,
      buckets: bucketsOf(BUSINESS_INTERFACE_BUCKETS, businessBuckets),
      edges: businessBuckets.declared ?? 0,
    });
    // the gaps of the stage in the project are the buckets that are gaps, no more and no fewer
    const gapCount = (kinds) => gaps.filter((g) => kinds(g.kind)).reduce((total, g) => total + g.count, 0);
    const expectedPointGaps = [jsrBuckets, ejbBuckets].flatMap((buckets) => Object.entries(buckets).filter(([bucket]) => TYPE_INJECTION_GAP_KINDS[bucket] !== undefined)).reduce((total, [, count]) => total + count, 0);
    expect(gapCount((kind) => kind.startsWith('type-injection-'))).toBe(expectedPointGaps);
    const expectedBusinessGaps = ['unreadable', 'typeUndetermined', 'unindexed'].reduce((total, bucket) => total + (businessBuckets[bucket] ?? 0), 0);
    expect(gapCount((kind) => kind === BUSINESS_INTERFACE_GAP_KIND)).toBe(expectedBusinessGaps);
  });
});

describe('a type of another JVM language (design D7 and D13)', () => {
  /** The unique-implementation scenario, with or without a Kotlin class whose supertypes the rows do not carry. */
  async function run(withKotlin) {
    const dir = mkdtempSync(join(tmpdir(), 'excavator-type-injection-kotlin-'));
    try {
      const rel = f('unique/GreetingConsumer');
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      cpSync(join(FIXTURE, rel), join(dir, rel));
      if (withKotlin) {
        const kotlin = join(dir, 'orders-inject/src/main/kotlin/com/acme/orders/inject/unique/KotlinGreeter.kt');
        mkdirSync(dirname(kotlin), { recursive: true });
        writeFileSync(kotlin, 'package com.acme.orders.inject.unique\n\nclass KotlinGreeter : Greeter\n');
      }
      const result = await runLazyAnalysis({ projectRoot: dir, now: FIXED_NOW });
      return { result, graph: readProduct(dir) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('counts the classes of the Kotlin and Scala rows, and stops an edge whose interface one of them may implement', async () => {
    const plain = await run(false);
    expect(plain.result.coverage.typeInjections.families[JSR].buckets).toMatchObject({ edge: 1, hiddenCandidate: 0 });
    expect(plain.graph.edges.filter((e) => e.type === 'injects')).toHaveLength(1);

    const mixed = await run(true);
    expect(mixed.result.coverage.typeInjections.families[JSR]).toEqual(family(1, 1, 0, { hiddenCandidate: 1 }));
    expect(mixed.graph.edges.filter((e) => e.type === 'injects')).toEqual([]);
    expect(mixed.graph.gaps.filter((g) => g.kind === 'type-injection-candidates-unresolved').map((g) => [g.scope, g.count])).toEqual([[JSR, 1]]);
  });
});
