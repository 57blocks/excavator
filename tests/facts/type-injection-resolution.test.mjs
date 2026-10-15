// by-type-injection, tasks 3.2-3.5: the resolution of Java injection points that
// a container fills by type into `injects` edges, visible buckets, gaps and
// coverage (skills/excavator/type-injection-resolution.mjs), over the types the
// Java call resolver reads (java-type-queries.mjs).
//
// Every input is real: the Java rows are what Core emits for synthetic source
// text - `memberAnnotations`, `nestedTypes`, `classLiterals` and the member types
// included, read from the built Core - the types are the call resolver over those
// rows, the catalog is the shipped one and the annotation identity is
// `createAnnotationIdentity`. Nothing here goes through buildFactGraph: wiring the
// stage in is task 4.2. "Catalog format errors" - an unknown key in a family - are
// the loader's: tests/facts/type-injection-catalog.test.mjs.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { createJavaCallResolver, createOtherJvmIndex } from '../../skills/excavator/java-call-resolution.mjs';
import { createDeclaredJavaTypeIndex, indexJavaTypes } from '../../skills/excavator/mention-resolution.mjs';
import { createAnnotationIdentity } from '../../skills/excavator/name-reference-resolution.mjs';
import { loadTypeInjectionCatalog, parseTypeInjectionCatalog } from '../../skills/excavator/type-injection-catalog.mjs';
import { collectNameReferenceSites } from '../../skills/excavator/name-reference-sites.mjs';
import { loadNameBindingCatalog } from '../../skills/excavator/name-binding-catalog.mjs';
import { buildNameBindingTable } from '../../skills/excavator/name-reference-resolution.mjs';
import { mergeInjectsEdges, resolveAnnotationInjections } from '../../skills/excavator/annotation-injection-resolution.mjs';
import {
  BUSINESS_INTERFACE_BUCKETS,
  BUSINESS_INTERFACE_GAP_BUCKETS,
  BUSINESS_INTERFACE_GAP_KIND,
  TYPE_INJECTIONS_NOT_RUN,
  TYPE_INJECTION_BUCKETS,
  TYPE_INJECTION_GAP_KINDS,
  assertTypeInjectionConservation,
  buildSubtypeIndex,
  measureTypeInjections,
  resolveTypeInjections,
} from '../../skills/excavator/type-injection-resolution.mjs';

let registry;
beforeAll(async () => {
  const tsPlugin = new TreeSitterPlugin(builtinLanguageConfigs.filter((c) => c.treeSitter));
  await tsPlugin.init();
  registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);
});

const CATALOG = loadTypeInjectionCatalog();
const lines = (text) => (Array.isArray(text) ? text.join('\n') : text);

/** Where a class of package `pkg` is. */
const SRC = (name, pkg = 'com.acme') => `src/main/java/${pkg.replaceAll('.', '/')}/${name}.java`;
/** A Java file: the package line, the imports, a blank line, the body - the first import on line 2. */
const javaSource = (pkg, imports, body) => [`package ${pkg};`, ...imports, '', ...[body].flat(), ''].join('\n');
/** `[path, source]` of a file of package com.acme. */
const file = (name, imports, body, pkg = 'com.acme') => [SRC(name, pkg), javaSource(pkg, imports, body)];
const javaOf = (...entries) => Object.fromEntries(entries);

const INJECT = 'import javax.inject.Inject;';
const NAMED = 'import javax.inject.Named;';
const EJB = 'import javax.ejb.EJB;';
const PRODUCES = 'import javax.enterprise.inject.Produces;';
const ALTERNATIVE = 'import javax.enterprise.inject.Alternative;';
const MODEL = 'import javax.enterprise.inject.Model;';
const LOCAL = 'import javax.ejb.Local;';

/**
 * Read a synthetic project the way the Lazy driver will, up to the resolution:
 * the Java rows through the real extractor, the call resolver over them, the
 * annotation identity, then `resolveTypeInjections`.
 *
 * @param {{
 *   java: Record<string, string|string[]>, catalog?: object|null, mutations?: object,
 *   nullClassIds?: string[], nullFunctionIds?: string[], otherJvmTypeCount?: number,
 * }} spec `nullClassIds` are `Name` of classes whose node id is shared with another declaration;
 *   `nullFunctionIds` are `Owner#name` of functions whose id is.
 */
function project({ java, catalog = CATALOG, mutations, nullClassIds = [], nullFunctionIds = [], otherJvmTypeCount }) {
  const texts = {};
  const javaRows = [];
  for (const [path, source] of Object.entries(java)) {
    texts[path] = lines(source);
    const row = { path, language: 'java', fileCategory: 'code' };
    const extracted = analyzeFileWithOutcomes(registry, row, texts[path]);
    expect(extracted.structureOutcome, path).toBe('succeeded');
    const split = texts[path].split('\n');
    javaRows.push(buildResult(row, split.length, split.filter((l) => l.trim()).length, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome));
  }
  const functionIds = new Map(javaRows.map((row) => [
    row.path,
    (row.functions ?? []).map((fn) => (nullFunctionIds.includes(`${fn.owner}#${fn.name}`) ? null : `fn:${fn.owner}#${fn.name}`)),
  ]));
  const classIds = new Map(javaRows.map((row) => [
    row.path,
    (row.classes ?? []).map((cls) => (nullClassIds.includes(cls.name) ? null : `class:${cls.qualifiedName}`)),
  ]));
  const types = createJavaCallResolver({ rows: javaRows, functionIds, classIds });

  const javaTypes = javaRows.flatMap((row) => (row.classes ?? []).map((cls, i) => ({ fqn: cls.qualifiedName, path: row.path, id: classIds.get(row.path)[i] })));
  // The types Java files declare by their `package` and file name: an annotation type is one of them, and has no class entry.
  const declared = new Set();
  for (const path of Object.keys(java)) {
    const pkg = /^package\s+([\w.]+);/m.exec(texts[path])?.[1];
    if (pkg !== undefined) declared.add(`${pkg}.${path.slice(path.lastIndexOf('/') + 1).replace(/\.java$/, '')}`);
  }
  const typesByFqn = indexJavaTypes(javaTypes);
  const otherJvm = createOtherJvmIndex([]);
  const declaredJavaTypes = createDeclaredJavaTypeIndex([...declared].map((fqn) => ({ file: `${fqn.replaceAll('.', '/')}.java`, package: fqn.slice(0, fqn.lastIndexOf('.')) })));
  const identity = ({ fqns, simpleNames }) => createAnnotationIdentity({ fqns, typesByFqn, otherJvm, declaredJavaTypes, simpleNames });

  const args = {
    javaRows,
    catalog,
    identity,
    types,
    functionIdOf: (path, index) => functionIds.get(path)?.[index] ?? null,
    ...(otherJvmTypeCount === undefined ? {} : { otherJvmTypeCount }),
    mutations,
  };
  const result = resolveTypeInjections(args);
  const label = (id) => id.replace(/^(class|fn):/, '');
  return {
    texts, javaRows, types, args, result, catalog, classIds, functionIds, javaTypes, declaredJavaTypes,
    edges: result.edges,
    links: result.edges.map((edge) => `${label(edge.source)} -> ${label(edge.target)}`).sort(),
    edge: (from, to) => result.edges.find((edge) => label(edge.source) === from && label(edge.target) === to),
    coverage: result.coverage,
    family: (id) => result.coverage.families[id],
    buckets: (id) => Object.fromEntries(Object.entries(result.coverage.families[id].buckets).filter(([, count]) => count > 0)),
    gaps: (kind) => result.gaps.filter((gap) => gap.kind === kind),
    samples: (kind) => result.gaps.filter((gap) => gap.kind === kind).map((gap) => gap.sample),
    /** `path:line` of the first line of a source that holds `needle`. */
    at: (path, needle) => `${path}:${texts[path].split('\n').findIndex((text) => text.includes(needle)) + 1}`,
    line: (path, needle) => texts[path].split('\n').findIndex((text) => text.includes(needle)) + 1,
  };
}

const JSR = 'jsr330-inject';
const EJB_FAMILY = 'ejb-inject';

/** The interface `name` of package com.acme, and the classes that implement it. */
const iface = (name) => file(name, [], `public interface ${name} {}`);
const impl = (name, of, extra = [], imports = []) => file(name, imports, [...extra, `public class ${name} implements ${of} {}`]);

/** One consumer class whose body is `body`, with the injection imports. */
const consumer = (body, { name = 'OrderController', imports = [INJECT] } = {}) => file(name, imports, [`public class ${name} {`, ...[body].flat(), '}']);

describe('every point has a fate', () => {
  it('has the sixteen buckets in the order of the design, and a gap kind only for the buckets that are gaps', () => {
    expect([...TYPE_INJECTION_BUCKETS]).toEqual([
      'byName', 'jndi', 'position', 'nested', 'memberUnindexed', 'outsideType', 'typeVariable', 'typeUndetermined',
      'qualifierUnresolved', 'hiddenCandidate', 'dynamicCandidate', 'noCandidate', 'ambiguous', 'deploymentDecided', 'noTargetNode', 'edge',
    ]);
    expect(Object.isFrozen(TYPE_INJECTION_BUCKETS)).toBe(true);
    expect(TYPE_INJECTION_GAP_KINDS).toEqual({
      jndi: 'type-injection-point-unresolved',
      nested: 'type-injection-point-unresolved',
      memberUnindexed: 'type-injection-point-unresolved',
      typeVariable: 'type-injection-type-unresolved',
      typeUndetermined: 'type-injection-type-unresolved',
      qualifierUnresolved: 'type-injection-candidates-unresolved',
      hiddenCandidate: 'type-injection-candidates-unresolved',
      dynamicCandidate: 'type-injection-candidates-unresolved',
      deploymentDecided: 'type-injection-candidates-unresolved',
      noTargetNode: 'type-injection-candidates-unresolved',
      noCandidate: 'type-injection-unbound',
      ambiguous: 'type-injection-ambiguous',
    });
    for (const bucket of ['byName', 'position', 'outsideType', 'edge']) expect(TYPE_INJECTION_GAP_KINDS[bucket], bucket).toBeUndefined();
  });

  it('is exactly the five gap kinds of the design, and every bucket of a gap kind is a bucket', () => {
    expect(new Set(Object.values(TYPE_INJECTION_GAP_KINDS))).toEqual(new Set([
      'type-injection-point-unresolved', 'type-injection-type-unresolved', 'type-injection-candidates-unresolved',
      'type-injection-unbound', 'type-injection-ambiguous',
    ]));
    for (const bucket of Object.keys(TYPE_INJECTION_GAP_KINDS)) expect(TYPE_INJECTION_BUCKETS).toContain(bucket);
  });
});

// ---------------------------------------------------------------------------
// The scenarios of the requirement on Java injection points by type
// ---------------------------------------------------------------------------

describe('candidates: the declarations that can satisfy a type', () => {
  it('draws an edge from the consumer to the one implementation, with the evidence of the point', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'),
        impl('OrderServiceImpl', 'OrderService'),
        consumer(['  @Inject private OrderService service;']),
      ),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.OrderServiceImpl']);
    const [edge] = p.edges;
    const path = SRC('OrderController');
    const line = p.line(path, '@Inject');
    expect(line).toBe(5);
    expect(edge).toEqual({
      source: 'class:com.acme.OrderController',
      target: 'class:com.acme.OrderServiceImpl',
      type: 'injects',
      direction: 'forward',
      weight: 0.5,
      provenance: 'extracted',
      evidence: [
        { file: path, line, source: 'tree-sitter', token: 'Inject', role: 'injection', family: JSR, member: 'service' },
        { file: path, line, source: 'tree-sitter', token: 'service', role: 'member', family: JSR, member: 'service', type: 'OrderService' },
      ],
    });
    expect(p.family(JSR)).toEqual({ annotations: 1, points: 1, buckets: { ...Object.fromEntries(TYPE_INJECTION_BUCKETS.map((b) => [b, 0])), edge: 1 }, edges: 1 });
    expect(p.result.gaps).toEqual([]);
  });

  it('counts an implementation reached through another class: two of them are two candidates, and the sample lists both', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'),
        impl('BaseOrderService', 'OrderService'),
        file('PremiumOrderService', [], 'public class PremiumOrderService extends BaseOrderService {}'),
        consumer(['  @Inject private OrderService service;']),
      ),
    });
    expect(p.edges).toEqual([]);
    expect(p.buckets(JSR)).toEqual({ ambiguous: 1 });
    expect(p.result.gaps).toEqual([{
      kind: 'type-injection-ambiguous',
      scope: JSR,
      sample: `${SRC('OrderController')}:5 OrderController.service : OrderService -> com.acme.BaseOrderService, com.acme.PremiumOrderService`,
    }]);
  });

  it('does not take an abstract class for a candidate: the one concrete subclass is', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'),
        file('AbstractOrderService', [], 'public abstract class AbstractOrderService implements OrderService {}'),
        file('DefaultOrderService', [], 'public class DefaultOrderService extends AbstractOrderService {}'),
        consumer(['  @Inject private OrderService service;']),
      ),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.DefaultOrderService']);
  });

  it('does not take an interface, an enum or an annotation type for a candidate', () => {
    const p = project({
      java: javaOf(
        iface('Port'),
        file('SubPort', [], 'public interface SubPort extends Port {}'),
        file('Mode', [], 'public enum Mode implements Port { A }'),
        file('Real', [], 'public class Real implements SubPort {}'),
        consumer(['  @Inject private Port port;']),
      ),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.Real']);
  });

  it('takes a record for a candidate', () => {
    const p = project({
      java: javaOf(iface('Port'), file('Pair', [], 'public record Pair(int a) implements Port {}'), consumer(['  @Inject private Port port;'])),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.Pair']);
  });

  it('takes the type itself for a candidate when it is a concrete class: an injection of a concrete class', () => {
    const p = project({
      java: javaOf(file('InvoiceBean', [], 'public class InvoiceBean {}'), consumer(['  @EJB private InvoiceBean invoices;'], { imports: [EJB] })),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.InvoiceBean']);
    expect(p.edges[0].evidence.map((entry) => [entry.role, entry.token, entry.family])).toEqual([
      ['injection', 'EJB', EJB_FAMILY],
      ['member', 'invoices', EJB_FAMILY],
    ]);
    expect(p.family(EJB_FAMILY).edges).toBe(1);
    expect(p.family(JSR).points).toBe(0);
  });

  it('counts a subclass of a concrete class with it: two candidates', () => {
    const p = project({
      java: javaOf(file('InvoiceBean', [], 'public class InvoiceBean {}'), file('SpecialInvoiceBean', [], 'public class SpecialInvoiceBean extends InvoiceBean {}'), consumer(['  @EJB private InvoiceBean invoices;'], { imports: [EJB] })),
    });
    expect(p.buckets(EJB_FAMILY)).toEqual({ ambiguous: 1 });
  });
});

describe('points of a method or a constructor: one per parameter', () => {
  it('makes each parameter of a constructor a point of its own, with the parameter in its evidence', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'), impl('OrderServiceImpl', 'OrderService'),
        file('AuditLog', [], 'public class AuditLog {}'),
        consumer(['  @Inject', '  public OrderController(OrderService service, AuditLog log) {}']),
      ),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.AuditLog', 'com.acme.OrderController -> com.acme.OrderServiceImpl']);
    expect(p.family(JSR).points).toBe(2);
    expect(p.family(JSR).annotations).toBe(1);
    const path = SRC('OrderController');
    const annotation = p.line(path, '@Inject');
    const constructor = p.line(path, 'public OrderController(');
    expect(p.edge('com.acme.OrderController', 'com.acme.OrderServiceImpl').evidence).toEqual([
      { file: path, line: annotation, source: 'tree-sitter', token: 'Inject', role: 'injection', family: JSR, member: 'OrderController', parameter: 0 },
      { file: path, line: constructor, source: 'tree-sitter', token: 'OrderController', role: 'member', family: JSR, member: 'OrderController', parameter: 0, type: 'OrderService' },
    ]);
    expect(p.edge('com.acme.OrderController', 'com.acme.AuditLog').evidence.map((entry) => [entry.role, entry.parameter, entry.type])).toEqual([
      ['injection', 1, undefined],
      ['member', 1, 'AuditLog'],
    ]);
  });

  it('reads a setter of one parameter, and gives a method with no parameter no point at all', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'), impl('OrderServiceImpl', 'OrderService'),
        consumer(['  @Inject public void setService(OrderService service) {}', '  @Inject public void init() {}']),
      ),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.OrderServiceImpl']);
    expect(p.family(JSR)).toMatchObject({ annotations: 2, points: 1, edges: 1 });
  });

  it('settles a method annotation that is stopped by one of the first five buckets as one point, not one per parameter', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'),
        consumer(['  @EJB(lookup = "java:global/x") public void setBoth(OrderService a, OrderService b) {}'], { imports: [EJB] }),
      ),
    });
    expect(p.buckets(EJB_FAMILY)).toEqual({ jndi: 1 });
    expect(p.family(EJB_FAMILY).points).toBe(1);
  });

  it('reads the qualifiers of a parameter from the parameter, and not from the method', () => {
    const p = project({
      java: javaOf(
        iface('PaymentService'), impl('FastPayment', 'PaymentService'),
        consumer(['  @Inject @Deprecated public void setPay(@Named("x") PaymentService pay) {}'], { imports: [INJECT, NAMED] }),
      ),
    });
    // @Deprecated is on the method, which is only the trigger; the parameter's own @Named names no class that is a candidate.
    expect(p.buckets(JSR)).toEqual({ noCandidate: 1 });
  });

  it('takes the type of a parameter as the written one with its generics erased, in the scope of the consumer', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'), impl('OrderServiceImpl', 'OrderService'),
        consumer(['  @Inject public OrderController(java.util.List<OrderService> unused, OrderService service) {}']),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ outsideType: 1, edge: 1 });
  });
});

describe('producers and the classes that provide a type', () => {
  const producer = (type, name = 'repository') => file('Producers', [PRODUCES], ['public class Producers {', '  @Produces', `  public ${type} ${name}() { return null; }`, '}']);

  it('takes a producer method for the one candidate: the edge goes to the method, and the evidence cites the producer', () => {
    const p = project({
      java: javaOf(iface('OrderRepository'), producer('OrderRepository'), consumer(['  @Inject private OrderRepository repo;'])),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> Producers#repository']);
    const producerPath = SRC('Producers');
    expect(p.edges[0].evidence.map((entry) => [entry.file, entry.role, entry.token, entry.member, entry.parameter])).toEqual([
      [SRC('OrderController'), 'injection', 'Inject', 'repo', undefined],
      [SRC('OrderController'), 'member', 'repo', 'repo', undefined],
      [producerPath, 'producer', 'Produces', 'repository', undefined],
    ]);
    expect(p.edges[0].evidence[2]).toEqual({
      file: producerPath, line: p.line(producerPath, '@Produces'), source: 'tree-sitter', token: 'Produces', role: 'producer', family: JSR, member: 'repository',
    });
  });

  it('counts a producer beside an implementation: two candidates', () => {
    const p = project({
      java: javaOf(iface('OrderRepository'), impl('JpaOrderRepository', 'OrderRepository'), producer('OrderRepository'), consumer(['  @Inject private OrderRepository repo;'])),
    });
    expect(p.buckets(JSR)).toEqual({ ambiguous: 1 });
    expect(p.samples('type-injection-ambiguous')[0]).toMatch(/ -> com\.acme\.JpaOrderRepository, com\.acme\.Producers#repository$/);
  });

  it('takes a producer of a subtype for a candidate of the supertype', () => {
    const p = project({
      java: javaOf(
        iface('OrderRepository'), file('CachedOrderRepository', [], 'public interface CachedOrderRepository extends OrderRepository {}'),
        producer('CachedOrderRepository'), consumer(['  @Inject private OrderRepository repo;']),
      ),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> Producers#repository']);
  });

  it('takes a producer field for a candidate that has no node to point at', () => {
    const p = project({
      java: javaOf(
        iface('OrderRepository'),
        file('Producers', [PRODUCES], ['public class Producers {', '  @Produces OrderRepository repository;', '}']),
        consumer(['  @Inject private OrderRepository repo;']),
      ),
    });
    expect(p.edges).toEqual([]);
    expect(p.buckets(JSR)).toEqual({ noTargetNode: 1 });
    expect(p.gaps('type-injection-candidates-unresolved')).toHaveLength(1);
  });

  it('has no node for a producer method whose node id is shared with another declaration', () => {
    const p = project({
      java: javaOf(iface('OrderRepository'), producer('OrderRepository'), consumer(['  @Inject private OrderRepository repo;'])),
      nullFunctionIds: ['Producers#repository'],
    });
    expect(p.buckets(JSR)).toEqual({ noTargetNode: 1 });
  });

  it('has no node for a class whose node id is shared with another declaration', () => {
    const p = project({
      java: javaOf(iface('OrderService'), impl('OrderServiceImpl', 'OrderService'), consumer(['  @Inject private OrderService service;'])),
      nullClassIds: ['OrderServiceImpl'],
    });
    expect(p.buckets(JSR)).toEqual({ noTargetNode: 1 });
  });

  it('reads a method type variable of a producer as one, not as a repository type of the same name: it hides what it may produce', () => {
    const p = project({
      java: javaOf(
        iface('Thing'), file('X', [], 'public class X implements Thing {}'),
        file('Producers', [PRODUCES], ['public class Producers {', '  @Produces', '  public <X> X make() { return null; }', '}']),
        consumer(['  @Inject private Thing thing;']),
      ),
    });
    // `X` there is the method's variable, not the class X that implements Thing: the producer is no candidate (two would be
    // "ambiguous"), and what it produces cannot be named, which may be a subtype of Thing called X, so the set is not complete.
    expect(p.edges).toEqual([]);
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('reads a producer whose type it cannot resolve as hiding nothing unless its name may be the type', () => {
    const quiet = project({
      java: javaOf(
        iface('Thing'), impl('ThingImpl', 'Thing'),
        file('Producers', [PRODUCES], ['public class Producers {', '  @Produces', '  public Mystery make() { return null; }', '}']),
        consumer(['  @Inject private Thing thing;']),
      ),
    });
    expect(quiet.links).toEqual(['com.acme.OrderController -> com.acme.ThingImpl']);
    const loud = project({
      java: javaOf(
        iface('Thing'), impl('ThingImpl', 'Thing'), file('Holder', [], 'public class Holder {}'),
        file('Producers', [PRODUCES], ['public class Producers {', '  @Produces', '  public Holder.Thing make() { return null; }', '}']),
        consumer(['  @Inject private Thing thing;']),
      ),
    });
    // `Holder.Thing` is a nested type, which cannot be resolved, and ends in the name of the type: it may be what it produces.
    expect(loud.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('takes a class that provides a type through a provider type for a candidate that has no node, and does not draw it', () => {
    const p = project({
      java: javaOf(
        file('Clock', [], 'public class Clock {}'),
        file('ClockProvider', ['import javax.inject.Provider;'], 'public class ClockProvider implements Provider<Clock> { public Clock get() { return null; } }'),
        consumer(['  @Inject private Clock clock;']),
      ),
    });
    // The concrete class Clock and the provider of it: two candidates.
    expect(p.buckets(JSR)).toEqual({ ambiguous: 1 });
    expect(p.samples('type-injection-ambiguous')[0]).toMatch(/ -> com\.acme\.Clock, com\.acme\.ClockProvider$/);
  });

  it('draws nothing for a unique provider: the class that provides is not the instance', () => {
    const p = project({
      java: javaOf(
        file('Clock', [], 'public interface Clock {}'),
        file('ClockProvider', ['import javax.inject.Provider;'], 'public class ClockProvider implements Provider<Clock> { public Clock get() { return null; } }'),
        consumer(['  @Inject private Clock clock;']),
      ),
    });
    expect(p.edges).toEqual([]);
    expect(p.buckets(JSR)).toEqual({ noTargetNode: 1 });
  });

  it('reads a provider through a supertype that is one: the interface of the provider provides, its implementation is the candidate', () => {
    const p = project({
      java: javaOf(
        file('Clock', [], 'public interface Clock {}'),
        file('ClockProvider', ['import javax.inject.Provider;'], 'public interface ClockProvider extends Provider<Clock> {}'),
        file('SystemClockProvider', [], 'public class SystemClockProvider implements ClockProvider { public Clock get() { return null; } }'),
        consumer(['  @Inject private Clock clock;']),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ noTargetNode: 1 });
  });

  it('does not take a type written Provider for a provider type when it is the repository\'s own', () => {
    const p = project({
      java: javaOf(
        file('Clock', [], 'public interface Clock {}'),
        file('Provider', [], 'public interface Provider<T> {}'),
        file('ClockProvider', [], 'public class ClockProvider implements Provider<Clock> {}'),
        consumer(['  @Inject private Clock clock;']),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ noCandidate: 1 });
  });
});

describe('names: the qualifier by name', () => {
  const payments = (extra = []) => [iface('PaymentService'), ...extra];
  const named = (name, value) => file(name, [NAMED], [...(value === undefined ? ['@Named'] : [`@Named("${value}")`]), `public class ${name} implements PaymentService {}`]);
  const pay = (annotations, imports = [INJECT, NAMED]) => consumer([`  ${annotations} private PaymentService payment;`], { imports });

  it('keeps the candidate that has the name, with the line of the qualifier in the evidence', () => {
    const p = project({
      java: javaOf(...payments([named('FastPayment', 'fast'), impl('SlowPayment', 'PaymentService'), pay('@Inject @Named("fast")')])),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.FastPayment']);
    const path = SRC('OrderController');
    const line = p.line(path, '@Inject @Named');
    expect(p.edges[0].evidence).toEqual([
      { file: path, line, source: 'tree-sitter', token: 'Inject', role: 'injection', family: JSR, member: 'payment' },
      { file: path, line, source: 'tree-sitter', token: 'Named', role: 'qualifier', family: JSR, member: 'payment', name: 'fast' },
      { file: path, line, source: 'tree-sitter', token: 'payment', role: 'member', family: JSR, member: 'payment', type: 'PaymentService' },
    ]);
  });

  it('gives a class with a name qualifier and no value the simple name with a lower-case first letter', () => {
    const p = project({ java: javaOf(...payments([named('FastPayment'), named('SlowPayment', 'slow'), pay('@Inject @Named("fastPayment")')])) });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.FastPayment']);
  });

  it('gives a class with a stereotype that carries a default name that name', () => {
    const p = project({
      java: javaOf(...payments([
        file('FastPayment', [MODEL], ['@Model', 'public class FastPayment implements PaymentService {}']),
        impl('SlowPayment', 'PaymentService'),
        pay('@Inject @Named("fastPayment")'),
      ])),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.FastPayment']);
  });

  it('has no name for a class that writes no name qualifier and no stereotype: a name asks for another', () => {
    const p = project({ java: javaOf(...payments([impl('SlowPayment', 'PaymentService'), pay('@Inject @Named("slowPayment")')])) });
    expect(p.buckets(JSR)).toEqual({ noCandidate: 1 });
  });

  it('keeps a candidate whose name qualifier is no string literal: its name cannot be read', () => {
    const p = project({
      java: javaOf(...payments([
        file('FastPayment', [NAMED], ['@Named(Names.FAST)', 'public class FastPayment implements PaymentService {}']),
        named('SlowPayment', 'slow'),
        pay('@Inject @Named("fast")'),
      ])),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.FastPayment']);
  });

  it('takes the field\'s own name for a name qualifier with no value', () => {
    const p = project({
      java: javaOf(...payments([named('FastPayment', 'payment'), named('SlowPayment', 'slow'), pay('@Inject @Named')])),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.FastPayment']);
    expect(p.edges[0].evidence.find((entry) => entry.role === 'qualifier').name).toBe('payment');
  });

  it('lands a parameter whose name qualifier has no value in "qualifier unresolved": a parameter has no name to default to', () => {
    const p = project({
      java: javaOf(...payments([named('FastPayment', 'fast'), consumer(['  @Inject public OrderController(@Named PaymentService payment) {}'], { imports: [INJECT, NAMED] })])),
    });
    expect(p.buckets(JSR)).toEqual({ qualifierUnresolved: 1 });
    expect(p.coverage.qualifiers).toEqual({ Named: 1 });
  });

  it('lands a name qualifier whose value is no string literal in "qualifier unresolved"', () => {
    const p = project({
      java: javaOf(...payments([named('FastPayment', 'fast'), pay('@Inject @Named(Names.FAST)')])),
    });
    expect(p.buckets(JSR)).toEqual({ qualifierUnresolved: 1 });
  });

  it('names a producer method by its name qualifier, by the property it reads, and by its own name', () => {
    const producers = (annotations, member) => file('Producers', [PRODUCES, NAMED], ['public class Producers {', `  @Produces ${annotations}`, `  public PaymentService ${member}() { return null; }`, '}']);
    const one = (annotations, member, wanted) => project({
      java: javaOf(...payments([impl('SlowPayment', 'PaymentService'), producers(annotations, member), pay(`@Inject @Named("${wanted}")`)])),
    });
    // a literal value
    expect(one('@Named("fast")', 'make', 'fast').links).toEqual(['com.acme.OrderController -> Producers#make']);
    // a getter is the property, as java.beans.Introspector names it
    expect(one('@Named', 'getFastPayment', 'fastPayment').links).toEqual(['com.acme.OrderController -> Producers#getFastPayment']);
    expect(one('@Named', 'isFast', 'fast').links).toEqual(['com.acme.OrderController -> Producers#isFast']);
    expect(one('@Named', 'getURL', 'URL').links).toEqual(['com.acme.OrderController -> Producers#getURL']);
    // any other method is its own name
    expect(one('@Named', 'make', 'make').links).toEqual(['com.acme.OrderController -> Producers#make']);
    // a producer with no name qualifier has no name, and the class that has none either
    expect(one('', 'make', 'make').buckets(JSR)).toEqual({ noCandidate: 1 });
  });

  it('names a producer field by its own name when its qualifier has no value', () => {
    const p = project({
      java: javaOf(...payments([
        file('Producers', [PRODUCES, NAMED], ['public class Producers {', '  @Produces @Named PaymentService fast;', '}']),
        impl('SlowPayment', 'PaymentService'),
        pay('@Inject @Named("fast")'),
      ])),
    });
    // The one candidate left is a field, which has no node.
    expect(p.buckets(JSR)).toEqual({ noTargetNode: 1 });
  });

  it('keeps a provider class under a name: the name of what a provider provides is not its own', () => {
    const p = project({
      java: javaOf(...payments([
        file('PaymentProvider', ['import javax.inject.Provider;'], 'public class PaymentProvider implements Provider<PaymentService> { public PaymentService get() { return null; } }'),
        named('FastPayment', 'fast'),
        pay('@Inject @Named("fast")'),
      ])),
    });
    expect(p.buckets(JSR)).toEqual({ ambiguous: 1 });
  });

  it('applies every name qualifier of a point', () => {
    const p = project({
      java: javaOf(...payments([named('FastPayment', 'fast'), named('SlowPayment', 'slow'), pay('@Inject @Named("fast") @Named("slow")')])),
    });
    expect(p.buckets(JSR)).toEqual({ noCandidate: 1 });
  });
});

describe('candidates that may be missing, and beans the sources do not declare', () => {
  const service = [iface('OrderService'), impl('OrderServiceImpl', 'OrderService')];
  const field = consumer(['  @Inject private OrderService service;']);
  const hidden = (...extra) => project({ java: javaOf(...service, ...extra, field) });

  it('does not draw an edge when a static nested class implements the type', () => {
    const p = hidden(file('Holder', [], ['public class Holder {', '  static class Mock implements OrderService {}', '}']));
    expect(p.edges).toEqual([]);
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
    expect(p.gaps('type-injection-candidates-unresolved').map((gap) => gap.sample)).toEqual([
      `${SRC('OrderController')}:5 OrderController.service : OrderService`,
    ]);
  });

  it('does not draw an edge when a local class implements the type', () => {
    const p = hidden(file('Holder', [], ['public class Holder {', '  void run() {', '    class Fake implements OrderService {}', '  }', '}']));
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('does not draw an edge when an anonymous class instantiates the type', () => {
    const p = hidden(file('Holder', [], ['public class Holder {', '  OrderService make() { return new OrderService() { }; }', '}']));
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('does not draw an edge when a nested class extends a subtype of the type', () => {
    const p = hidden(
      file('Sub', [], 'public interface Sub extends OrderService {}'),
      file('Holder', [], ['public class Holder {', '  static class Mock implements Sub {}', '}']),
    );
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('does not draw an edge when a nested interface extends the type, nor when a type nested in an anonymous class does', () => {
    expect(hidden(file('Holder', [], ['public class Holder {', '  interface Port extends OrderService {}', '}'])).buckets(JSR)).toEqual({ hiddenCandidate: 1 });
    expect(hidden(file('Holder', [], ['public class Holder {', '  Object o = new Object() { class In implements OrderService {} };', '}'])).buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('does not let a nested type of an unrelated type hide anything', () => {
    const p = hidden(file('Holder', [], ['public class Holder {', '  static class Mock implements Runnable { public void run() {} }', '  Object o = new Runnable() { public void run() {} };', '}']));
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.OrderServiceImpl']);
  });

  it('does not draw an edge when a producer in a nested class produces the type or a subtype', () => {
    const p = hidden(file('Holder', [PRODUCES], ['public class Holder {', '  static class Maker {', '    @Produces OrderService make() { return null; }', '  }', '}']));
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('does not draw an edge when a nested class provides the type through a provider type', () => {
    const p = hidden(file('Holder', ['import javax.inject.Provider;'], [
      'public class Holder {',
      '  static class Maker implements Provider<OrderService> { public OrderService get() { return null; } }',
      '}',
    ]));
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('does not draw an edge when an anonymous class is a provider of the type', () => {
    const p = hidden(file('Holder', ['import javax.inject.Provider;'], ['public class Holder {', '  Object o = new Provider<OrderService>() { public OrderService get() { return null; } };', '}']));
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('does not draw an edge for a supertype it cannot resolve whose simple name is the type\'s, or a subtype\'s', () => {
    const named = hidden(file('Holder', [], 'public class Holder { public class Impl2 implements Holder.OrderService {} }'));
    // A nested type of a repository type is not resolved, and ends in OrderService.
    expect(named.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
    const viaSubtype = hidden(
      file('Holder', [], 'public class Holder {}'),
      file('Special', [], 'public interface Special extends OrderService {}'),
      file('Other', [], 'public class Other implements Holder.Special {}'),
    );
    expect(viaSubtype.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('lets a supertype it cannot resolve through when its name is none of the type\'s or its subtypes\'', () => {
    const p = hidden(file('Holder', [], 'public class Holder {}'), file('Other', [], 'public class Other implements Holder.Unrelated {}'));
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.OrderServiceImpl']);
  });

  it('does not let a subtype of another type hide this one', () => {
    const p = hidden(file('Holder', [], 'public class Holder {}'), file('Q', [], 'public interface Q {}'), file('QImpl', [], 'public class QImpl implements Q {}'),
      file('Other', [], 'public class Other implements Holder.Q {}'));
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.OrderServiceImpl']);
  });

  it('does not draw an edge when the type is an interface and code writes its class literal', () => {
    const p = hidden(file('Module', [], ['public class Module {', '  void configure() { bind(OrderService.class); }', '  void bind(Class<?> type) {}', '}']));
    expect(p.edges).toEqual([]);
    expect(p.buckets(JSR)).toEqual({ dynamicCandidate: 1 });
    expect(p.gaps('type-injection-candidates-unresolved')).toHaveLength(1);
  });

  it('does the same for an abstract class, and for a class literal written with a name it cannot resolve', () => {
    const abstractType = project({
      java: javaOf(
        file('Repo', [], 'public abstract class Repo {}'), file('RepoImpl', [], 'public class RepoImpl extends Repo {}'),
        file('Module', [], ['public class Module {', '  Object o = Repo.class;', '}']),
        consumer(['  @Inject private Repo repo;']),
      ),
    });
    expect(abstractType.buckets(JSR)).toEqual({ dynamicCandidate: 1 });
    const unresolved = hidden(file('Holder', [], 'public class Holder {}'), file('Module', [], 'public class Module { Object o = Holder.OrderService.class; }'));
    expect(unresolved.buckets(JSR)).toEqual({ dynamicCandidate: 1 });
  });

  it('does not stop an edge for the class literal of a concrete class, or of an array', () => {
    const p = project({
      java: javaOf(
        file('InvoiceBean', [], 'public class InvoiceBean {}'),
        file('Module', [], ['public class Module {', '  Object a = InvoiceBean.class;', '  Object b = InvoiceBean[].class;', '}']),
        consumer(['  @Inject private InvoiceBean invoices;']),
      ),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.InvoiceBean']);
  });

  it('does not take a class literal in an annotation for one in code', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'),
        file('OrderBean', [LOCAL], ['@Local(OrderService.class)', 'public class OrderBean implements OrderService {}']),
        file('Marker', [], ['public @interface Marker {', '  Class<?> value() default OrderService.class;', '}']),
        field,
      ),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.OrderBean']);
  });

  it('does not draw an edge when the one candidate is an alternative, a specialization, a vetoed type, a decorator or an interceptor', () => {
    for (const [annotation, name] of [['@Alternative', 'Alternative'], ['@Specializes', 'Specializes'], ['@Typed', 'Typed'], ['@Vetoed', 'Vetoed']]) {
      const p = project({
        java: javaOf(
          iface('OrderService'),
          file('OrderServiceImpl', [`import javax.enterprise.inject.${name};`], [annotation, 'public class OrderServiceImpl implements OrderService {}']),
          field,
        ),
      });
      expect(p.buckets(JSR), name).toEqual({ deploymentDecided: 1 });
    }
    const decorated = project({
      java: javaOf(
        iface('OrderService'),
        file('OrderServiceImpl', ['import javax.decorator.Decorator;'], ['@Decorator', 'public class OrderServiceImpl implements OrderService {}']),
        field,
      ),
    });
    expect(decorated.buckets(JSR)).toEqual({ deploymentDecided: 1 });
  });

  it('does not draw an edge when the one candidate is a producer of an alternative, or in a class that is', () => {
    const own = project({
      java: javaOf(
        iface('OrderRepository'),
        file('Producers', [PRODUCES, ALTERNATIVE], ['public class Producers {', '  @Produces @Alternative OrderRepository make() { return null; }', '}']),
        consumer(['  @Inject private OrderRepository repo;']),
      ),
    });
    expect(own.buckets(JSR)).toEqual({ deploymentDecided: 1 });
    const inClass = project({
      java: javaOf(
        iface('OrderRepository'),
        file('Producers', [PRODUCES, ALTERNATIVE], ['@Alternative', 'public class Producers {', '  @Produces OrderRepository make() { return null; }', '}']),
        consumer(['  @Inject private OrderRepository repo;']),
      ),
    });
    expect(inClass.buckets(JSR)).toEqual({ deploymentDecided: 1 });
  });

  it('does not decide by deployment for an annotation that is only spelled like one: it is another type', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'),
        file('OrderServiceImpl', ['import com.vendor.Alternative;'], ['@Alternative', 'public class OrderServiceImpl implements OrderService {}']),
        field,
      ),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.OrderServiceImpl']);
  });

  it('does not draw an edge when no declaration can satisfy the type: unbound', () => {
    const p = project({ java: javaOf(iface('OrderService'), field) });
    expect(p.buckets(JSR)).toEqual({ noCandidate: 1 });
    expect(p.result.gaps).toEqual([{ kind: 'type-injection-unbound', scope: JSR, sample: `${SRC('OrderController')}:5 OrderController.service : OrderService` }]);
  });
});

describe('what is no point of this stage, or is another stage\'s', () => {
  it('lands a type outside the repository, a primitive and an array in "outside type" and records no gap', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'),
        consumer([
          '  @Inject private EntityManager em;',
          '  @Inject private int count;',
          '  @Inject private OrderService[] all;',
          '  @Inject private java.util.List<OrderService> list;',
          '  @Inject private String text;',
        ], { imports: [INJECT, 'import javax.persistence.EntityManager;'] }),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ outsideType: 5 });
    expect(p.result.gaps).toEqual([]);
  });

  it('leaves a bean named by beanName to the by-name stage: no edge, no gap', () => {
    const p = project({ java: javaOf(consumer(['  @EJB(beanName = "OrderBean") private Orders orders;'], { imports: [EJB] })) });
    expect(p.buckets(EJB_FAMILY)).toEqual({ byName: 1 });
    expect(p.result.gaps).toEqual([]);
  });

  it('counts a beanName that is no string literal as named too, and one written empty as not named', () => {
    const p = project({
      java: javaOf(
        file('InvoiceBean', [], 'public class InvoiceBean {}'),
        consumer(['  @EJB(beanName = Names.INVOICES) private InvoiceBean a;', '  @EJB(beanName = "") private InvoiceBean b;'], { imports: [EJB] }),
      ),
    });
    expect(p.buckets(EJB_FAMILY)).toEqual({ byName: 1, edge: 1 });
    expect(p.edges[0].evidence.find((entry) => entry.role === 'member').member).toBe('b');
  });

  it('leaves a point that carries a name annotation of the family to the by-name stage', () => {
    const p = project({
      java: javaOf(
        iface('OrderDao'), impl('JdbcOrderDao', 'OrderDao'),
        consumer(['  @Inject @Qualifier("orderDao") private OrderDao dao;'], { imports: [INJECT, 'import org.springframework.beans.factory.annotation.Qualifier;'] }),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ byName: 1 });
    expect(p.result.gaps).toEqual([]);
    expect(p.coverage.qualifiers).toEqual({});
  });

  it('reads the name annotation of one parameter as that parameter\'s, and takes the other parameters by type', () => {
    const p = project({
      java: javaOf(
        iface('OrderDao'), impl('JdbcOrderDao', 'OrderDao'),
        consumer(['  @Inject public OrderController(@Qualifier("orderDao") OrderDao dao, OrderDao other) {}'], { imports: [INJECT, 'import org.springframework.beans.factory.annotation.Qualifier;'] }),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ byName: 1, edge: 1 });
  });

  it('lands a JNDI name in "JNDI name" and records point-unresolved, with the member and its type', () => {
    const p = project({ java: javaOf(consumer(['  @EJB(lookup = "java:global/app/OrderBean") private Orders orders;', '  @EJB(mappedName = "x") private Orders other;'], { imports: [EJB] })) });
    expect(p.buckets(EJB_FAMILY)).toEqual({ jndi: 2 });
    expect(p.result.gaps.map((gap) => [gap.kind, gap.scope, gap.sample])).toEqual([
      ['type-injection-point-unresolved', EJB_FAMILY, `${SRC('OrderController')}:5 OrderController.orders : Orders`],
      ['type-injection-point-unresolved', EJB_FAMILY, `${SRC('OrderController')}:6 OrderController.other : Orders`],
    ]);
  });

  it('lands a type variable in "type variable" and records type-unresolved', () => {
    const p = project({ java: javaOf(file('Repository', [INJECT], ['public class Repository<T> {', '  @Inject private T delegate;', '}'])) });
    expect(p.buckets(JSR)).toEqual({ typeVariable: 1 });
    expect(p.result.gaps).toEqual([{ kind: 'type-injection-type-unresolved', scope: JSR, sample: `${SRC('Repository')}:5 Repository.delegate : T` }]);
  });

  it('reads a type variable of a method as one for the point of its parameter', () => {
    const p = project({ java: javaOf(file('Repository', [INJECT], ['public class Repository {', '  @Inject public <X> void put(X value) {}', '}'])) });
    // Core writes a method type variable as its bound in the parameter types (Object here), so the point is outside the repository.
    expect(p.buckets(JSR)).toEqual({ outsideType: 1 });
  });

  it('lands a nested type, an unresolvable type, a duplicated name and an unreadable restatement in "type undetermined"', () => {
    const p = project({
      java: javaOf(
        file('Holder', [], 'public class Holder { public static class Part {} }'),
        file('OrderService', [], 'public interface OrderService {}'),
        ['other/src/main/java/com/acme/OrderService.java', javaSource('com.acme', [], 'public interface OrderService {}')],
        consumer([
          '  @Inject private Holder.Part part;',
          '  @Inject private Mystery mystery;',
          '  @Inject private OrderService service;',
          '  @EJB(beanInterface = Names.X) private Object restated;',
          '  @EJB(beanInterface = {First.class, Second.class}) private Object several;',
        ], { imports: [INJECT, EJB] }),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ typeUndetermined: 3 });
    expect(p.buckets(EJB_FAMILY)).toEqual({ typeUndetermined: 2 });
    const path = SRC('OrderController');
    const at = (needle) => p.line(path, needle);
    expect(p.gaps('type-injection-type-unresolved').map((gap) => gap.sample)).toEqual([
      `${path}:${at('Holder.Part part')} OrderController.part : Holder.Part`,
      `${path}:${at('Mystery mystery')} OrderController.mystery : Mystery`,
      `${path}:${at('OrderService service')} OrderController.service : OrderService`,
      `${path}:${at('Object restated')} OrderController.restated : Object`,
      `${path}:${at('Object several')} OrderController.several : Object`,
    ]);
  });

  it('takes the type the family\'s argument restates for the type to satisfy, and gives the declared one in the member evidence', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'), impl('OrderServiceImpl', 'OrderService'),
        consumer(['  @EJB(beanInterface = OrderService.class) private Object orders;'], { imports: [EJB] }),
      ),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.OrderServiceImpl']);
    expect(p.edges[0].evidence.find((entry) => entry.role === 'member').type).toBe('Object');
  });

  it('lands a point in a position the family does not read in "position", with no gap', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'),
        consumer([
          '  @Inject public void run(@Inject OrderService param) {}',
          '  @EJB public OrderController() {}',
          '  @EJB public void setBoth(OrderService a, OrderService b) {}',
        ], { imports: [INJECT, EJB] }),
      ),
    });
    // The annotation on the parameter is in no position the family reads; the one on the method, with no candidate, reads it.
    expect(p.buckets(JSR)).toEqual({ position: 1, noCandidate: 1 });
    expect(p.buckets(EJB_FAMILY)).toEqual({ position: 2 });
    // Only the point with no candidate is a gap: the sample names the parameter.
    expect(p.result.gaps).toEqual([{
      kind: 'type-injection-unbound', scope: JSR, sample: `${SRC('OrderController')}:${p.line(SRC('OrderController'), 'public void run')} OrderController.run#0 : OrderService`,
    }]);
  });

  it('reads a setter of the EJB family that has one parameter, and a method with none is "position" too', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'), impl('OrderServiceImpl', 'OrderService'),
        consumer(['  @EJB public void setOne(OrderService a) {}', '  @EJB public void init() {}'], { imports: [EJB] }),
      ),
    });
    expect(p.buckets(EJB_FAMILY)).toEqual({ position: 1, edge: 1 });
  });

  it('lands a member in a nested, local or anonymous type in "nested", and records point-unresolved', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'), impl('OrderServiceImpl', 'OrderService'),
        consumer([
          '  static class Inner {',
          '    @Inject private OrderService inner;',
          '  }',
          '  void run() {',
          '    class Local { @Inject OrderService local; }',
          '    Object o = new Object() { @Inject OrderService anonymous; };',
          '  }',
        ]),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ nested: 3 });
    expect(p.gaps('type-injection-point-unresolved').map((gap) => gap.sample)).toEqual([
      `${SRC('OrderController')}:6 OrderController.inner : OrderService`,
      `${SRC('OrderController')}:9 OrderController.local : OrderService`,
      `${SRC('OrderController')}:10 OrderController.anonymous : OrderService`,
    ]);
    expect(p.edges).toEqual([]);
  });

  it('lands a method no function entry holds, and a consumer with no node, in "member unindexed"', () => {
    const noNode = project({
      java: javaOf(iface('OrderService'), impl('OrderServiceImpl', 'OrderService'), consumer(['  @Inject private OrderService service;', '  @Inject public void setService(OrderService s) {}'])),
      nullClassIds: ['OrderController'],
    });
    expect(noNode.buckets(JSR)).toEqual({ memberUnindexed: 2 });
    expect(noNode.samples('type-injection-point-unresolved')).toEqual([
      `${SRC('OrderController')}:5 OrderController.service : OrderService`,
      `${SRC('OrderController')}:6 OrderController.setService`,
    ]);
    const noFunction = project({
      java: javaOf(iface('OrderService'), impl('OrderServiceImpl', 'OrderService'), consumer(['  @Inject public void setService(OrderService s) {}'])),
      nullFunctionIds: ['OrderController#setService'],
    });
    expect(noFunction.buckets(JSR)).toEqual({ memberUnindexed: 1 });
  });

  it('lands a field with no declared type in "member unindexed": a row from before the member type', () => {
    const p = project({ java: javaOf(iface('OrderService'), consumer(['  @Inject private OrderService service;'])) });
    const rows = p.javaRows.map((row) => structuredClone(row));
    for (const row of rows) for (const use of row.memberAnnotations) delete use.member.type;
    // The call resolver reads the same rows as the stage does: the types are those of the rows.
    const resolved = resolveTypeInjections({ ...p.args, javaRows: rows, types: createJavaCallResolver({ rows, functionIds: p.functionIds, classIds: p.classIds }) });
    expect(resolved.coverage.families[JSR].buckets).toMatchObject({ memberUnindexed: 1, edge: 0, noCandidate: 0 });
  });
});

describe('which annotations are a point, and which are counted by their spelling', () => {
  it('does not take an annotation type the repository declares in the same package for an injection annotation', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'), impl('OrderServiceImpl', 'OrderService'),
        file('Inject', [], 'public @interface Inject {}'),
        consumer(['  @Inject private OrderService service;'], { imports: [] }),
      ),
    });
    expect(p.family(JSR)).toMatchObject({ annotations: 0, points: 0 });
    expect(p.coverage.unconfirmed).toEqual({});
    expect(p.edges).toEqual([]);
  });

  it('counts a spelling that could be an injection annotation and cannot be confirmed, and makes no point of it', () => {
    const p = project({
      java: javaOf(iface('OrderService'), impl('OrderServiceImpl', 'OrderService'), consumer(['  @Inject private OrderService service;'], { imports: [] })),
    });
    expect(p.family(JSR)).toMatchObject({ annotations: 0, points: 0 });
    expect(p.coverage.unconfirmed).toEqual({ Inject: 1 });
    expect(p.edges).toEqual([]);
  });

  it('confirms an annotation written qualified, and one imported on demand', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'), impl('OrderServiceImpl', 'OrderService'),
        consumer(['  @javax.inject.Inject private OrderService qualified;'], { imports: [] }),
        file('Other', ['import javax.inject.*;'], ['public class Other {', '  @Inject private OrderService onDemand;', '}']),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ edge: 2 });
    expect(p.edges[0].evidence[0].token).toBe('javax.inject.Inject');
  });

  it('counts a point of the jakarta namespace as the family\'s, and an EJB annotation of either', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'), impl('OrderServiceImpl', 'OrderService'),
        consumer(['  @Inject private OrderService a;', '  @EJB private OrderService b;'], { imports: ['import jakarta.inject.Inject;', 'import jakarta.ejb.EJB;'] }),
      ),
    });
    expect(p.family(JSR).edges).toBe(1);
    expect(p.family(EJB_FAMILY).edges).toBe(1);
  });

  it('lands an unknown qualifier in "qualifier unresolved", counted by spelling, for a family that reads qualifiers', () => {
    const p = project({
      java: javaOf(
        iface('PaymentService'), impl('FastPayment', 'PaymentService'),
        consumer(['  @Inject @RestClient private PaymentService payment;'], { imports: [INJECT, 'import org.eclipse.microprofile.rest.client.inject.RestClient;'] }),
      ),
    });
    expect(p.edges).toEqual([]);
    expect(p.buckets(JSR)).toEqual({ qualifierUnresolved: 1 });
    expect(p.coverage.qualifiers).toEqual({ RestClient: 1 });
    expect(p.result.gaps).toEqual([{
      kind: 'type-injection-candidates-unresolved', scope: JSR, sample: `${SRC('OrderController')}:${p.line(SRC('OrderController'), 'RestClient private')} OrderController.payment : PaymentService`,
    }]);
  });

  it('counts each qualifier a point does not know, and a spelling it cannot confirm too', () => {
    const p = project({
      java: javaOf(
        iface('PaymentService'), impl('FastPayment', 'PaymentService'),
        consumer(['  @Inject @RestClient @Deprecated private PaymentService a;', '  @Inject @Named("x") private PaymentService b;'], { imports: [INJECT, 'import com.vendor.RestClient;'] }),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ qualifierUnresolved: 2 });
    expect(p.coverage.qualifiers).toEqual({ Deprecated: 1, Named: 1, RestClient: 1 });
    expect(p.coverage.unconfirmed).toEqual({ Named: 1 });
  });

  it('does not read a qualifier of a family that reads none', () => {
    const p = project({
      java: javaOf(file('InvoiceBean', [], 'public class InvoiceBean {}'), consumer(['  @EJB @Deprecated @RestClient private InvoiceBean invoices;'], { imports: [EJB, 'import com.vendor.RestClient;'] })),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.InvoiceBean']);
    expect(p.coverage.qualifiers).toEqual({});
  });

  it('does not count another injection annotation or an annotation the catalog says is no qualifier as one', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'), impl('OrderServiceImpl', 'OrderService'),
        consumer(['  @Inject @EJB @Nullable private OrderService a;'], { imports: [INJECT, EJB, 'import javax.annotation.Nullable;'] }),
      ),
    });
    expect(p.family(JSR)).toMatchObject({ points: 1, edges: 1 });
    expect(p.family(EJB_FAMILY)).toMatchObject({ points: 1, edges: 1 });
    expect(p.coverage.qualifiers).toEqual({});
    // Both points draw the one pair: the edge holds the evidence of both.
    expect(p.edges).toHaveLength(1);
    expect(p.edges[0].evidence.filter((entry) => entry.role === 'injection').map((entry) => entry.family)).toEqual([JSR, EJB_FAMILY].sort());
  });
});

// ---------------------------------------------------------------------------
// All sixteen buckets, with exact counts; evidence; merging; conservation
// ---------------------------------------------------------------------------

/** Every evidence entry of every edge cites a line of its file that holds its token. */
function expectEvidenceOnItsLine(p) {
  for (const edge of p.edges) {
    for (const entry of edge.evidence) {
      const text = p.texts[entry.file].split('\n')[entry.line - 1];
      expect(text, `${entry.file}:${entry.line} ${entry.role} ${entry.token}`).toContain(entry.token);
      expect(entry.source).toBe('tree-sitter');
    }
  }
}

/** A project that lands at least one point in each of the sixteen buckets. */
function taxonomy(extra = {}) {
  const extras = [
    'import javax.persistence.EntityManager;', 'import com.vendor.Weird;',
    'import org.springframework.beans.factory.annotation.Qualifier;',
  ];
  return project({
    java: javaOf(
      file('Alpha', [], 'public interface Alpha {}'), impl('AlphaImpl', 'Alpha'),
      file('Beta', [], 'public interface Beta {}'), impl('BetaImpl', 'Beta'),
      file('Holder2', [], ['public class Holder2 {', '  static class Mock implements Beta {}', '}']),
      file('Gamma', [], 'public interface Gamma {}'), impl('GammaImpl', 'Gamma'),
      file('Module', [], ['public class Module {', '  void configure() { bind(Gamma.class); }', '  void bind(Class<?> type) {}', '}']),
      file('Delta', [], 'public interface Delta {}'),
      file('Eps', [], 'public interface Eps {}'), impl('EpsOne', 'Eps'), impl('EpsTwo', 'Eps'),
      file('Zeta', [], 'public interface Zeta {}'), impl('ZetaImpl', 'Zeta', ['@Alternative'], [ALTERNATIVE]),
      file('Eta', [], 'public interface Eta {}'),
      file('Producers', [PRODUCES], ['public class Producers {', '  @Produces Eta eta;', '}']),
      file('Holder', [], 'public class Holder { public static class Part {} }'),
      file('Box', [INJECT], ['public class Box<T> {', '  @Inject private T item;', '}']),
      consumer([
        '  @Inject private Alpha alpha;',
        '  static class Inner {',
        '    @Inject private Alpha inner;',
        '  }',
        '  @Inject private EntityManager em;',
        '  @Inject private Holder.Part part;',
        '  @Inject @Weird private Alpha weird;',
        '  @Inject private Beta beta;',
        '  @Inject private Gamma gamma;',
        '  @Inject private Delta delta;',
        '  @Inject private Eps eps;',
        '  @Inject private Zeta zeta;',
        '  @Inject private Eta eta;',
        '  @Inject @Qualifier("x") private Alpha named;',
        '  public void run(@Inject Alpha p) {}',
        '  @Inject public void setAlpha(Alpha a) {}',
        '  @EJB(lookup = "java:x") private Alpha jndi;',
        '  @EJB(beanName = "x") private Alpha ejbNamed;',
      ], { imports: [INJECT, EJB, ...extras] }),
    ),
    nullFunctionIds: ['OrderController#setAlpha'],
    ...extra,
  });
}

describe('the sixteen buckets', () => {
  const zero = Object.fromEntries(TYPE_INJECTION_BUCKETS.map((bucket) => [bucket, 0]));

  it('lands each point in exactly one bucket, with the counts of each family', () => {
    const p = taxonomy();
    expect(p.family(JSR)).toEqual({
      annotations: 15,
      points: 15,
      buckets: {
        ...zero, byName: 1, position: 1, nested: 1, memberUnindexed: 1, outsideType: 1, typeVariable: 1, typeUndetermined: 1,
        qualifierUnresolved: 1, hiddenCandidate: 1, dynamicCandidate: 1, noCandidate: 1, ambiguous: 1, deploymentDecided: 1, noTargetNode: 1, edge: 1,
      },
      edges: 1,
    });
    expect(p.family(EJB_FAMILY)).toEqual({ annotations: 2, points: 2, buckets: { ...zero, byName: 1, jndi: 1 }, edges: 0 });
    // together: every one of the sixteen buckets has a point
    const total = TYPE_INJECTION_BUCKETS.map((bucket) => p.family(JSR).buckets[bucket] + p.family(EJB_FAMILY).buckets[bucket]);
    expect(total).toEqual([2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(p.coverage.qualifiers).toEqual({ Weird: 1 });
    expect(p.coverage.unconfirmed).toEqual({});
    expect(p.coverage.status).toBe('ran');
  });

  it('records one gap per point of a gap bucket, of the kind the design says, with a sample of the point', () => {
    const p = taxonomy();
    const path = SRC('OrderController');
    const at = (needle) => p.line(path, needle);
    // In the order the points are met: the rows in the order they are given, a row's members in source order.
    expect(p.result.gaps.map((gap) => [gap.kind, gap.scope, gap.sample])).toEqual([
      ['type-injection-type-unresolved', JSR, `${SRC('Box')}:${p.line(SRC('Box'), 'T item')} Box.item : T`],
      ['type-injection-point-unresolved', JSR, `${path}:${at('Alpha inner')} OrderController.inner : Alpha`],
      ['type-injection-type-unresolved', JSR, `${path}:${at('Holder.Part part')} OrderController.part : Holder.Part`],
      ['type-injection-candidates-unresolved', JSR, `${path}:${at('@Weird')} OrderController.weird : Alpha`],
      ['type-injection-candidates-unresolved', JSR, `${path}:${at('Beta beta')} OrderController.beta : Beta`],
      ['type-injection-candidates-unresolved', JSR, `${path}:${at('Gamma gamma')} OrderController.gamma : Gamma`],
      ['type-injection-unbound', JSR, `${path}:${at('Delta delta')} OrderController.delta : Delta`],
      ['type-injection-ambiguous', JSR, `${path}:${at('Eps eps')} OrderController.eps : Eps -> com.acme.EpsOne, com.acme.EpsTwo`],
      ['type-injection-candidates-unresolved', JSR, `${path}:${at('Zeta zeta')} OrderController.zeta : Zeta`],
      ['type-injection-candidates-unresolved', JSR, `${path}:${at('Eta eta')} OrderController.eta : Eta`],
      ['type-injection-point-unresolved', JSR, `${path}:${at('setAlpha')} OrderController.setAlpha`],
      ['type-injection-point-unresolved', EJB_FAMILY, `${path}:${at('Alpha jndi')} OrderController.jndi : Alpha`],
    ]);
  });

  it('draws the one edge, and cites only lines that hold what they cite', () => {
    const p = taxonomy();
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.AlphaImpl']);
    expectEvidenceOnItsLine(p);
  });

  it('balances: the buckets of each family add up to its points, the edge points are the injection entries, the gaps are the gap buckets', () => {
    const p = taxonomy();
    expect(() => assertTypeInjectionConservation(p.coverage, measureTypeInjections(p.result))).not.toThrow();
    expect(measureTypeInjections(p.result)).toEqual({
      injections: { [JSR]: 1 },
      implementations: 0,
      gaps: {
        [JSR]: {
          'type-injection-point-unresolved': 2, 'type-injection-type-unresolved': 2, 'type-injection-candidates-unresolved': 5,
          'type-injection-unbound': 1, 'type-injection-ambiguous': 1,
        },
        [EJB_FAMILY]: { 'type-injection-point-unresolved': 1 },
      },
    });
  });
});

describe('one edge for a pair, whatever points draw it', () => {
  const service = [iface('OrderService'), impl('OrderServiceImpl', 'OrderService')];

  it('merges the points of one consumer that reach one candidate into one edge with the evidence of each', () => {
    const p = project({ java: javaOf(...service, consumer(['  @Inject private OrderService a;', '  @Inject private OrderService b;'])) });
    expect(p.edges).toHaveLength(1);
    const path = SRC('OrderController');
    expect(p.edges[0].evidence.map((entry) => [entry.line, entry.role, entry.member])).toEqual([
      [p.line(path, 'OrderService a'), 'injection', 'a'],
      [p.line(path, 'OrderService a'), 'member', 'a'],
      [p.line(path, 'OrderService b'), 'injection', 'b'],
      [p.line(path, 'OrderService b'), 'member', 'b'],
    ]);
    // Two points drew it: the coverage counts the points, and the evidence has one injection entry for each.
    expect(p.family(JSR)).toMatchObject({ points: 2, edges: 2 });
    expect(measureTypeInjections(p.result).injections).toEqual({ [JSR]: 2 });
    expect(() => assertTypeInjectionConservation(p.coverage, measureTypeInjections(p.result))).not.toThrow();
  });

  it('keeps the entries of the declarators of one field apart: the member is not the same', () => {
    const p = project({ java: javaOf(...service, consumer(['  @Inject private OrderService a, b;'])) });
    expect(p.edges).toHaveLength(1);
    expect(p.edges[0].evidence.filter((entry) => entry.role === 'injection').map((entry) => entry.member)).toEqual(['a', 'b']);
    expect(p.family(JSR).edges).toBe(2);
  });

  it('merges a field and a parameter that reach the same candidate, the parameter in its own entries', () => {
    const p = project({
      java: javaOf(...service, consumer(['  @Inject private OrderService field;', '  @Inject public OrderController(OrderService param) {}'])),
    });
    expect(p.edges).toHaveLength(1);
    expect(p.edges[0].evidence.map((entry) => [entry.role, entry.member, entry.parameter])).toEqual([
      ['injection', 'field', undefined],
      ['member', 'field', undefined],
      ['injection', 'OrderController', 0],
      ['member', 'OrderController', 0],
    ]);
  });

  it('keeps the two pairs two edges, in the order each pair is first met', () => {
    const p = project({
      java: javaOf(...service, file('Other', [], 'public class Other {}'), consumer(['  @Inject private Other other;', '  @Inject private OrderService service;'])),
    });
    expect(p.links.length).toBe(2);
    expect(p.edges.map((edge) => edge.target)).toEqual(['class:com.acme.Other', 'class:com.acme.OrderServiceImpl']);
  });

  it('merges the points of two families that reach the same pair: the entries carry their families', () => {
    const p = project({ java: javaOf(file('InvoiceBean', [], 'public class InvoiceBean {}'), consumer(['  @Inject private InvoiceBean a;', '  @EJB private InvoiceBean b;'], { imports: [INJECT, EJB] })) });
    expect(p.edges).toHaveLength(1);
    expect(p.edges[0].evidence.filter((entry) => entry.role === 'injection').map((entry) => [entry.family, entry.member])).toEqual([[JSR, 'a'], [EJB_FAMILY, 'b']]);
    expect(p.family(JSR).edges).toBe(1);
    expect(p.family(EJB_FAMILY).edges).toBe(1);
  });

  it('is one edge per pair with a producer for the evidence of the producer once, whatever consumer member draws it', () => {
    const p = project({
      java: javaOf(
        iface('OrderRepository'),
        file('Producers', [PRODUCES], ['public class Producers {', '  @Produces OrderRepository make() { return null; }', '}']),
        consumer(['  @Inject private OrderRepository a;', '  @Inject private OrderRepository b;']),
      ),
    });
    expect(p.edges).toHaveLength(1);
    expect(p.edges[0].evidence.filter((entry) => entry.role === 'producer')).toHaveLength(1);
  });

  it('sorts the evidence of an edge by file, line, token, role, family, member and parameter', () => {
    const p = project({
      java: javaOf(
        iface('PaymentService'), file('FastPayment', [NAMED], ['@Named("fast")', 'public class FastPayment implements PaymentService {}']),
        consumer(['  @Inject @Named("fast") private PaymentService b;', '  @Inject @Named("fast") private PaymentService a;'], { imports: [INJECT, NAMED] }),
      ),
    });
    const keys = p.edges[0].evidence.map((entry) => [entry.file, entry.line, entry.token, entry.role, entry.family, entry.member]);
    expect(keys).toEqual([...keys].sort((x, y) => {
      for (let i = 0; i < x.length; i += 1) {
        if (x[i] === y[i]) continue;
        return x[i] < y[i] ? -1 : 1;
      }
      return 0;
    }));
    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(keys.length);
  });
});

describe('the conservation of a run', () => {
  const run = () => taxonomy();
  const tamper = (edit) => {
    const p = run();
    const coverage = structuredClone(p.coverage);
    const recorded = measureTypeInjections(p.result);
    edit(coverage, recorded);
    return () => assertTypeInjectionConservation(coverage, recorded);
  };

  it('passes for a run, and for one that did not run', () => {
    const p = run();
    expect(() => assertTypeInjectionConservation(p.coverage, measureTypeInjections(p.result))).not.toThrow();
    expect(() => assertTypeInjectionConservation(TYPE_INJECTIONS_NOT_RUN, { injections: {}, gaps: {} })).not.toThrow();
  });

  it('fails, naming the family, when the buckets do not add up to the points', () => {
    expect(tamper((coverage) => { coverage.families[JSR].buckets.noCandidate += 1; })).toThrow(/family "jsr330-inject": 15 injection point\(s\) but 16 outcome\(s\)/);
    expect(tamper((coverage) => { coverage.families[EJB_FAMILY].points += 1; })).toThrow(/family "ejb-inject": 3 injection point\(s\) but 2 outcome\(s\)/);
  });

  it('fails when the points that became edges are not the edges counted', () => {
    expect(tamper((coverage) => { coverage.families[JSR].edges = 2; })).toThrow(/family "jsr330-inject": 1 point\(s\) became an edge but 2 edge point\(s\) were counted/);
  });

  it('fails when the points that became edges are not the injection entries of the evidence', () => {
    expect(tamper((_, recorded) => { recorded.injections[JSR] = 0; })).toThrow(/family "jsr330-inject": 1 point\(s\) became an edge but 0 injection entr\(ies\) in the evidence/);
    expect(tamper((_, recorded) => { recorded.injections[JSR] = 2; })).toThrow(/but 2 injection entr/);
  });

  it('fails when the gaps recorded of a kind are not the buckets that are gaps of that kind', () => {
    expect(tamper((_, recorded) => { recorded.gaps[JSR]['type-injection-ambiguous'] = 0; }))
      .toThrow(/family "jsr330-inject": 1 type-injection-ambiguous outcome\(s\) but 0 recorded gap occurrence\(s\)/);
    expect(tamper((_, recorded) => { recorded.gaps[JSR]['type-injection-unbound'] += 1; }))
      .toThrow(/type-injection-unbound outcome\(s\) but 2 recorded/);
    expect(tamper((_, recorded) => { delete recorded.gaps[EJB_FAMILY]; }))
      .toThrow(/family "ejb-inject": 1 type-injection-point-unresolved outcome\(s\) but 0 recorded/);
    expect(tamper((_, recorded) => { recorded.gaps[JSR]['type-injection-candidates-unresolved'] -= 1; }))
      .toThrow(/type-injection-candidates-unresolved outcome\(s\) but 4 recorded/);
  });

  it('counts a gap of every kind the design says in the bucket sums', () => {
    const coverage = {
      status: 'ran',
      families: { f: { points: 12, edges: 0, buckets: Object.fromEntries(TYPE_INJECTION_BUCKETS.map((bucket) => [bucket, TYPE_INJECTION_GAP_KINDS[bucket] === undefined ? 0 : 1])) } },
      businessInterfaces: { annotations: 0, declarations: 0, buckets: Object.fromEntries(BUSINESS_INTERFACE_BUCKETS.map((bucket) => [bucket, 0])), edges: 0 },
    };
    const recorded = { injections: {}, gaps: { f: {} } };
    for (const kind of Object.values(TYPE_INJECTION_GAP_KINDS)) recorded.gaps.f[kind] = (recorded.gaps.f[kind] ?? 0) + 1;
    expect(() => assertTypeInjectionConservation(coverage, recorded)).not.toThrow();
  });
});

describe('a stage that did not run, and rows that cannot be read', () => {
  it('reports "not-run" for a run with no catalog, with no edge and no gap', () => {
    const p = taxonomy();
    for (const catalog of [null, undefined]) {
      expect(resolveTypeInjections({ ...p.args, catalog })).toEqual({ edges: [], implementsEdges: [], gaps: [], coverage: { status: 'not-run' } });
    }
    expect(TYPE_INJECTIONS_NOT_RUN).toEqual({ status: 'not-run' });
    expect(Object.isFrozen(TYPE_INJECTIONS_NOT_RUN)).toBe(true);
    expect(p.coverage.status).toBe('ran');
  });

  it('throws for a row that has types and no member annotations, nested types, class literals or class modifiers: an older extraction', () => {
    const p = project({ java: javaOf(iface('OrderService'), consumer(['  @Inject private OrderService service;'])) });
    for (const field of ['memberAnnotations', 'nestedTypes', 'classLiterals']) {
      const rows = structuredClone(p.javaRows);
      delete rows[0][field];
      expect(() => resolveTypeInjections({ ...p.args, javaRows: rows }), field).toThrow(new RegExp(`the structure row of ${rows[0].path} has no ${field} \\(an output of an older extraction\\?\\)`));
    }
    const rows = structuredClone(p.javaRows);
    delete rows[0].classes[0].modifiers;
    expect(() => resolveTypeInjections({ ...p.args, javaRows: rows })).toThrow(/has a class with no modifiers \(an output of an older extraction\?\)/);
  });

  it('does not throw for a row with no types, which has none of the lists', () => {
    const p = project({ java: javaOf(iface('OrderService'), consumer(['  @Inject private OrderService service;'])) });
    const rows = [...p.javaRows, { path: 'src/main/java/com/acme/package-info.java', language: 'java', metrics: {} }];
    expect(() => resolveTypeInjections({ ...p.args, javaRows: rows })).not.toThrow();
  });
});

describe('what the stage reads and what it leaves alone', () => {
  it('asks for the identity of an annotation once, for every qualified name of the catalog whatever its role', () => {
    const p = taxonomy();
    const calls = [];
    const identity = (args) => {
      calls.push({ fqns: [...args.fqns], simpleNames: args.simpleNames });
      return p.args.identity(args);
    };
    resolveTypeInjections({ ...p.args, identity });
    const catalog = p.catalog;
    const everyName = new Set([
      ...catalog.injectionFamilies.flatMap((family) => [...family.annotations, ...family.nameAnnotations]),
      ...catalog.namedQualifier.annotations, ...catalog.namedQualifier.defaultNameStereotypes,
      ...catalog.producers.annotations, ...catalog.providerTypes.types,
      ...catalog.deploymentDependent.annotations, ...catalog.notQualifiers.annotations, ...catalog.businessInterfaces.annotations,
    ]);
    expect(calls).toHaveLength(1);
    expect(new Set(calls[0].fqns)).toEqual(everyName);
    expect(calls[0].fqns).toHaveLength(everyName.size);
    expect(calls[0].simpleNames).toBe(false);
  });

  it('changes none of its inputs', () => {
    const p = taxonomy();
    const before = structuredClone(p.javaRows);
    const resolved = resolveTypeInjections(p.args);
    expect(p.javaRows).toEqual(before);
    expect(resolved).toEqual(p.result);
  });

  it('gives the same result for the same inputs, and has no framework in its code: the catalog is the only place that says one', () => {
    const p = taxonomy();
    expect(resolveTypeInjections(p.args)).toEqual(p.result);
    const source = readFileSync(new URL('../../skills/excavator/type-injection-resolution.mjs', import.meta.url), 'utf-8');
    expect(source).not.toMatch(/\b(EJB|CDI|Spring|Guice|Dagger|Lombok|javax|jakarta|Seam)\b/);
  });

  it('takes the catalog it is given: a catalog without the second family reads no point of it', () => {
    const slim = JSON.parse(JSON.stringify(CATALOG));
    slim.injectionFamilies = slim.injectionFamilies.filter((family) => family.id === JSR);
    const p = taxonomy({ catalog: parseTypeInjectionCatalog(slim) });
    expect(Object.keys(p.coverage.families)).toEqual([JSR]);
    expect(p.family(JSR).points).toBe(15);
  });

  it('reads a family\'s data: a family with another injection annotation, reading no qualifiers, takes that annotation', () => {
    const custom = JSON.parse(JSON.stringify(CATALOG));
    custom.injectionFamilies.push({
      id: 'custom', basis: 'A test family.', annotations: ['com.vendor.Wire'], on: ['field'], readsQualifiers: false,
      singleParameterMethods: false, nameArguments: [], nameAnnotations: [], lookupArguments: [], typeArgument: null,
    });
    const p = project({
      java: javaOf(file('InvoiceBean', [], 'public class InvoiceBean {}'), consumer(['  @Wire @Deprecated private InvoiceBean invoices;'], { imports: ['import com.vendor.Wire;'] })),
      catalog: parseTypeInjectionCatalog(custom),
    });
    expect(p.family('custom')).toMatchObject({ annotations: 1, points: 1, edges: 1 });
    expect(p.edges[0].evidence[0]).toMatchObject({ family: 'custom', token: 'Wire' });
  });
});

describe('the subtypes of a type, and the declared supertypes that add to them', () => {
  const files = javaOf(
    iface('Port'),
    file('Base', [], 'public class Base implements Port {}'),
    file('Free', [], 'public class Free {}'),
    file('Sub', [], 'public class Sub extends Base {}'),
  );

  it('gives the type and the types that have it as a supertype, in the order of the types', () => {
    const p = project({ java: files });
    const index = buildSubtypeIndex({ types: p.types });
    const view = (name) => p.types.declaredTypes().find((type) => type.name === name);
    expect(index.closureOf(view('Port')).map((type) => type.name)).toEqual(['Port', 'Base', 'Sub']);
    expect(index.subtypesOf(view('Base')).map((type) => type.name)).toEqual(['Sub']);
    expect(index.ancestorsOf(view('Sub')).map((type) => type.name)).toEqual(['Base', 'Port']);
    expect(index.closureOf(view('Free')).map((type) => type.name)).toEqual(['Free']);
  });

  it('follows a declared supertype of a type, with everything that supertype reaches', () => {
    const p = project({ java: files });
    const view = (name) => p.types.declaredTypes().find((type) => type.name === name);
    const index = buildSubtypeIndex({ types: p.types, extraSupertypes: new Map([[view('Free'), [view('Base')]]]) });
    expect(index.ancestorsOf(view('Free')).map((type) => type.name)).toEqual(['Base', 'Port']);
    expect(index.closureOf(view('Port')).map((type) => type.name)).toEqual(['Port', 'Base', 'Free', 'Sub']);
    expect(index.subtypesOf(view('Base')).map((type) => type.name)).toEqual(['Free', 'Sub']);
  });

  it('gives a subtype of a type with a declared supertype that supertype too, and ends for a cycle of them', () => {
    const p = project({ java: files });
    const view = (name) => p.types.declaredTypes().find((type) => type.name === name);
    const extra = new Map([[view('Free'), [view('Port')]], [view('Port'), [view('Free')]]]);
    const index = buildSubtypeIndex({ types: p.types, extraSupertypes: extra });
    expect(index.ancestorsOf(view('Sub')).map((type) => type.name)).toEqual(['Base', 'Port', 'Free']);
    expect(index.ancestorsOf(view('Port')).map((type) => type.name)).toEqual(['Free']);
  });
});

describe('the two stages that read an injection annotation agree on which points are named (oracle O3)', () => {
  const NAME_CATALOG = loadNameBindingCatalog();

  /** The by-name stage over the rows of a project, with no descriptor: what the Lazy driver gives it for Java rows alone. */
  function nameStage(p) {
    const scan = { files: [] };
    const sites = collectNameReferenceSites({ scan, catalog: NAME_CATALOG, readFile: () => '' });
    const table = buildNameBindingTable({
      sites, catalog: NAME_CATALOG, manifestPaths: Object.keys(p.texts), javaRows: p.javaRows, classIds: p.classIds, javaTypes: p.javaTypes,
      otherJvm: { isType: () => false }, declaredJavaTypes: p.declaredJavaTypes,
    });
    return resolveAnnotationInjections({ javaRows: p.javaRows, catalog: NAME_CATALOG, table, classIds: p.classIds });
  }

  const ejbProject = () => project({
    java: javaOf(
      file('InvoiceBean', [], 'public class InvoiceBean {}'),
      consumer([
        '  @EJB private InvoiceBean a;',
        '  @EJB(beanName = "x") private InvoiceBean b;',
        '  @EJB(beanName = "") private InvoiceBean c;',
        '  @EJB(lookup = "j") private InvoiceBean d;',
        '  @EJB(beanName = Names.X) private InvoiceBean e;',
        '  @EJB public void setTwo(InvoiceBean p, InvoiceBean q) {}',
        '  @EJB public OrderController() {}',
        '  @EJB(beanName = "y") public OrderController(int n) {}',
        '  @EJB(lookup = "j") public OrderController(long n) {}',
        '  public void run(@EJB InvoiceBean r) {}',
        '  static class N {',
        '    @EJB private InvoiceBean n;',
        '    @EJB(beanName = "z") private InvoiceBean z;',
        '  }',
      ], { imports: [EJB] }),
    ),
  });

  it('has this stage\'s byName for the points the by-name stage reads as named, and nothing of its unnamed ones', () => {
    const p = ejbProject();
    const byType = p.family(EJB_FAMILY);
    expect(byType.buckets).toMatchObject({ byName: 4, jndi: 2, position: 3, nested: 1, edge: 2 });
    expect(byType.annotations).toBe(12);
    const byName = nameStage(p);
    // beanName written and not empty: `b`, `e` (no literal), the constructor with one, the nested `z`.
    expect(byName.coverage.buckets.nonLiteral).toBe(1);
    expect(byName.coverage.buckets.position).toBe(4); // three constructors and the parameter: kinds the name stage does not read
    expect(byName.coverage.buckets.unnamed).toBe(5); // a, c, d, setTwo, the nested n
  });

  it('is the exact complement: unnamed = annotations - byName - (points of a kind the name stage does not read that name nothing)', () => {
    const p = ejbProject();
    const type = p.family(EJB_FAMILY);
    const unnamed = nameStage(p).coverage.buckets.unnamed;

    // The kinds each stage reads come from its own catalog.
    const nameKinds = NAME_CATALOG.annotationInjections.flatMap((family) => family.sites).find((site) => site.id === 'ejb-bean-name').on;
    const typeKinds = CATALOG.injectionFamilies.find((family) => family.id === EJB_FAMILY).on;
    expect(nameKinds).toEqual(typeKinds);

    const uses = p.javaRows.flatMap((row) => row.memberAnnotations).filter((use) => use.name === 'EJB');
    const named = (use) => { const argument = use.arguments.find((a) => a.key === 'beanName'); return argument !== undefined && argument.value !== ''; };
    const jndi = (use) => use.arguments.some((argument) => argument.key === 'lookup' && argument.value !== '');
    const outside = uses.filter((use) => !nameKinds.includes(use.on) && !named(use));
    const outsidePosition = outside.filter((use) => !jndi(use)).length;
    const outsideJndi = outside.filter(jndi).length;
    expect([outsidePosition, outsideJndi]).toEqual([2, 1]);

    // The identity that holds.
    expect(unnamed).toBe(type.annotations - type.buckets.byName - outsidePosition - outsideJndi);
    // The design's text counts only the "position" of such kinds: one point too many, the constructor that writes a JNDI name.
    expect(type.annotations - type.buckets.byName - outsidePosition).toBe(unnamed + outsideJndi);
  });

  it('reads a bean name written empty as no name, as the by-name stage does', () => {
    const p = project({ java: javaOf(file('InvoiceBean', [], 'public class InvoiceBean {}'), consumer(['  @EJB(beanName = "") private InvoiceBean c;'], { imports: [EJB] })) });
    expect(p.buckets(EJB_FAMILY)).toEqual({ edge: 1 });
    expect(nameStage(p).coverage.buckets.unnamed).toBe(1);
  });

  it('reads a bean name that is no literal as named, as the by-name stage does: it is a gap there', () => {
    const p = project({ java: javaOf(file('InvoiceBean', [], 'public class InvoiceBean {}'), consumer(['  @EJB(beanName = Names.X) private InvoiceBean e;'], { imports: [EJB] })) });
    expect(p.buckets(EJB_FAMILY)).toEqual({ byName: 1 });
    const byName = nameStage(p);
    expect(byName.coverage.buckets.nonLiteral).toBe(1);
    expect(byName.gaps.map((gap) => gap.kind)).toEqual(['injection-target-unresolved']);
  });
});

describe('a mutation that breaks a rule turns a test red (D14)', () => {
  const service = [iface('OrderService')];
  const field = consumer(['  @Inject private OrderService service;']);

  it('simpleNameAnnotations: a simple name alone is no annotation', () => {
    const java = javaOf(...service, impl('OrderServiceImpl', 'OrderService'), consumer(['  @Inject private OrderService service;'], { imports: [] }));
    expect(project({ java }).family(JSR)).toMatchObject({ annotations: 0, points: 0 });
    // with the seam on, the unconfirmed spelling is taken for the catalog's and draws an edge
    const wrong = project({ java, mutations: { simpleNameAnnotations: true } });
    expect(wrong.family(JSR)).toMatchObject({ annotations: 1, edges: 1 });
    expect(wrong.links).toEqual(['com.acme.OrderController -> com.acme.OrderServiceImpl']);
  });

  it('abstractCandidates: an abstract class is no candidate', () => {
    const java = javaOf(...service, file('AbstractOrderService', [], 'public abstract class AbstractOrderService implements OrderService {}'),
      file('DefaultOrderService', [], 'public class DefaultOrderService extends AbstractOrderService {}'), field);
    expect(project({ java }).links).toEqual(['com.acme.OrderController -> com.acme.DefaultOrderService']);
    const wrong = project({ java, mutations: { abstractCandidates: true } });
    expect(wrong.edges).toEqual([]);
    expect(wrong.buckets(JSR)).toEqual({ ambiguous: 1 });
  });

  it('noHiddenCandidates: a nested implementation hides', () => {
    const java = javaOf(...service, impl('OrderServiceImpl', 'OrderService'), file('Holder', [], ['public class Holder {', '  static class Mock implements OrderService {}', '}']), field);
    expect(project({ java }).buckets(JSR)).toEqual({ hiddenCandidate: 1 });
    const wrong = project({ java, mutations: { noHiddenCandidates: true } });
    expect(wrong.links).toEqual(['com.acme.OrderController -> com.acme.OrderServiceImpl']);
  });

  it('noDynamicGuard: a class literal of the type in code stops the edge', () => {
    const java = javaOf(...service, impl('OrderServiceImpl', 'OrderService'), file('Module', [], 'public class Module { Object o = OrderService.class; }'), field);
    expect(project({ java }).buckets(JSR)).toEqual({ dynamicCandidate: 1 });
    const wrong = project({ java, mutations: { noDynamicGuard: true } });
    expect(wrong.links).toEqual(['com.acme.OrderController -> com.acme.OrderServiceImpl']);
  });

  it('ignoreUnknownQualifiers: an annotation beside the injection that is not known stops the edge', () => {
    const java = javaOf(iface('PaymentService'), impl('FastPayment', 'PaymentService'),
      consumer(['  @Inject @RestClient private PaymentService payment;'], { imports: [INJECT, 'import com.vendor.RestClient;'] }));
    expect(project({ java }).buckets(JSR)).toEqual({ qualifierUnresolved: 1 });
    const wrong = project({ java, mutations: { ignoreUnknownQualifiers: true } });
    expect(wrong.links).toEqual(['com.acme.OrderController -> com.acme.FastPayment']);
    expect(wrong.coverage.qualifiers).toEqual({});
  });

  it('noNamedFilter: a name qualifier keeps the candidates that have the name', () => {
    const java = javaOf(iface('PaymentService'),
      file('FastPayment', [NAMED], ['@Named("fast")', 'public class FastPayment implements PaymentService {}']), impl('SlowPayment', 'PaymentService'),
      consumer(['  @Inject @Named("fast") private PaymentService payment;'], { imports: [INJECT, NAMED] }));
    expect(project({ java }).links).toEqual(['com.acme.OrderController -> com.acme.FastPayment']);
    const wrong = project({ java, mutations: { noNamedFilter: true } });
    expect(wrong.edges).toEqual([]);
    expect(wrong.buckets(JSR)).toEqual({ ambiguous: 1 });
  });

  it('firstCandidate: two candidates draw no edge', () => {
    const java = javaOf(...service, impl('BaseOrderService', 'OrderService'), file('PremiumOrderService', [], 'public class PremiumOrderService extends BaseOrderService {}'), field);
    expect(project({ java }).edges).toEqual([]);
    const wrong = project({ java, mutations: { firstCandidate: true } });
    expect(wrong.links).toEqual(['com.acme.OrderController -> com.acme.BaseOrderService']);
  });

  it('turns no switch on by default: a run with an empty seam is the run with none', () => {
    const java = javaOf(...service, impl('OrderServiceImpl', 'OrderService'), field);
    expect(project({ java, mutations: {} }).result).toEqual(project({ java }).result);
  });
});

// ---------------------------------------------------------------------------
// Cases the rules above are tight on
// ---------------------------------------------------------------------------

describe('where a rule is tight', () => {
  const service = [iface('OrderService'), impl('OrderServiceImpl', 'OrderService')];
  const other = (root, name, body, pkg = 'com.acme') => [`${root}/src/main/java/${pkg.replaceAll('.', '/')}/${name}.java`, javaSource(pkg, [], body)];

  it('reads a JNDI name written empty as not written', () => {
    const p = project({ java: javaOf(file('InvoiceBean', [], 'public class InvoiceBean {}'), consumer(['  @EJB(lookup = "") private InvoiceBean a;', '  @EJB(mappedName = "") private InvoiceBean b;'], { imports: [EJB] })) });
    expect(p.buckets(EJB_FAMILY)).toEqual({ edge: 2 });
  });

  it('takes a method for no declaration when two share its name on its line, and by lines when they do not', () => {
    const oneLine = project({
      java: javaOf(...service, consumer(['  @Inject public void set(OrderService a) {} public void set(Runnable b) {}'])),
    });
    expect(oneLine.buckets(JSR)).toEqual({ memberUnindexed: 1 });
    const apart = project({
      java: javaOf(...service, consumer(['  @Inject public void set(OrderService a) {}', '  public void set(Runnable b) {}', '  public void set(Thread c) {}'])),
    });
    expect(apart.links).toEqual(['com.acme.OrderController -> com.acme.OrderServiceImpl']);
    expect(apart.family(JSR).points).toBe(1);
  });

  it('gives a sample the line of the member, not of its annotation', () => {
    const p = project({ java: javaOf(iface('OrderService'), consumer(['  @Inject', '  @javax.annotation.Nullable', '  private OrderService service;'])) });
    const path = SRC('OrderController');
    expect(p.samples('type-injection-unbound')).toEqual([`${path}:${p.line(path, 'private OrderService')} OrderController.service : OrderService`]);
    expect(p.line(path, 'private OrderService')).toBeGreaterThan(p.line(path, '@Inject'));
  });

  it('lists five candidates in a sample, sorted, and counts the rest', () => {
    const names = ['Zed', 'Yak', 'Xi', 'Wu', 'Vee', 'Uma', 'Tau'];
    const p = project({ java: javaOf(iface('OrderService'), ...names.map((name) => impl(`${name}Service`, 'OrderService')), consumer(['  @Inject private OrderService service;'])) });
    expect(p.samples('type-injection-ambiguous')[0]).toMatch(/ -> com\.acme\.TauService, com\.acme\.UmaService, com\.acme\.VeeService, com\.acme\.WuService, com\.acme\.XiService, …\+2$/);
    const exact = project({ java: javaOf(iface('OrderService'), ...names.slice(0, 5).map((name) => impl(`${name}Service`, 'OrderService')), consumer(['  @Inject private OrderService service;'])) });
    expect(exact.samples('type-injection-ambiguous')[0]).toMatch(/ -> com\.acme\.VeeService, com\.acme\.WuService, com\.acme\.XiService, com\.acme\.YakService, com\.acme\.ZedService$/);
  });

  it('gives the parameter in the evidence of each parameter that reaches the one pair, and none to what a producer says', () => {
    const p = project({
      java: javaOf(
        iface('OrderRepository'),
        file('Producers', [PRODUCES], ['public class Producers {', '  @Produces OrderRepository make() { return null; }', '}']),
        consumer(['  @Inject public OrderController(OrderRepository first, OrderRepository second) {}']),
      ),
    });
    expect(p.edges).toHaveLength(1);
    expect(p.edges[0].evidence.map((entry) => [entry.role, entry.member, entry.parameter])).toEqual([
      ['injection', 'OrderController', 0],
      ['injection', 'OrderController', 1],
      ['member', 'OrderController', 0],
      ['member', 'OrderController', 1],
      ['producer', 'make', undefined],
    ]);
  });

  it('keeps the entries of two families on one line apart: the member entry of each', () => {
    const p = project({
      java: javaOf(file('InvoiceBean', [], 'public class InvoiceBean {}'), consumer(['  @Inject @EJB private InvoiceBean a;'], { imports: [INJECT, EJB] })),
    });
    expect(p.edges[0].evidence.filter((entry) => entry.role === 'member').map((entry) => entry.family)).toEqual([EJB_FAMILY, JSR]);
  });

  it('sorts the spellings it counts', () => {
    const p = project({
      java: javaOf(iface('PaymentService'), impl('FastPayment', 'PaymentService'),
        consumer(['  @Inject @Zed @Alpha @Mid private PaymentService payment;', '  @Beta @Alpine private PaymentService other;'], { imports: [INJECT, 'import com.vendor.Zed;', 'import com.vendor.Alpha;', 'import com.vendor.Mid;'] })),
    });
    expect(Object.keys(p.coverage.qualifiers)).toEqual(['Alpha', 'Mid', 'Zed']);
    expect(Object.keys(p.coverage.unconfirmed)).toEqual([]);
    const spellings = project({
      java: javaOf(iface('PaymentService'), consumer(['  @Zulu private PaymentService a;', '  @Alpha private PaymentService b;'], { imports: [] })),
      catalog: parseTypeInjectionCatalog({
        ...JSON.parse(JSON.stringify(CATALOG)),
        notQualifiers: { basis: CATALOG.notQualifiers.basis, annotations: [...CATALOG.notQualifiers.annotations, 'com.vendor.Zulu', 'com.vendor.Alpha'] },
      }),
    });
    expect(Object.keys(spellings.coverage.unconfirmed)).toEqual(['Alpha', 'Zulu']);
  });

  it('does not hide a type for a supertype of a type it cannot resolve when the name is another\'s only by being ambiguous', () => {
    // `Sub` is declared in two source roots; `Other` in a third writes it, which resolves to neither.
    const p = project({
      java: javaOf(
        iface('OrderService'),
        other('one', 'Sub', 'public interface Sub extends OrderService {}'),
        other('two', 'Sub', 'public interface Sub extends OrderService {}'),
        other('three', 'Other', 'public class Other implements Sub {}'),
        consumer(['  @Inject private OrderService service;']),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('hides a type for a supertype that resolves to a declaration with a twin', () => {
    const p = project({
      java: javaOf(
        iface('OrderService'),
        other('one', 'Sub', 'public interface Sub extends OrderService {}'),
        other('two', 'Sub', 'public interface Sub extends OrderService {}'),
        other('one', 'Other', 'public class Other implements Sub {}'),
        consumer(['  @Inject private OrderService service;']),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('reads a type nested in a type in the scope of its top-level type: a member type of the owner hides the name', () => {
    // In Holder, `Base` is the member type, not kit.a.Base; its name may be that of kit.b.Base, a subtype of Port.
    const p = project({
      java: javaOf(
        ['src/main/java/kit/a/Port.java', javaSource('kit.a', [], 'public interface Port {}')],
        ['src/main/java/kit/a/PortImpl.java', javaSource('kit.a', [], 'public class PortImpl implements Port {}')],
        ['src/main/java/kit/a/Base.java', javaSource('kit.a', [], 'public class Base {}')],
        ['src/main/java/kit/b/Base.java', javaSource('kit.b', ['import kit.a.Port;'], 'public abstract class Base implements Port {}')],
        ['src/main/java/kit/a/Holder.java', javaSource('kit.a', [], ['public class Holder {', '  class Base {}', '  static class N extends Base {}', '}'])],
        ['src/main/java/kit/a/Use.java', javaSource('kit.a', [INJECT], ['public class Use {', '  @Inject private Port port;', '}'])],
      ),
    });
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('hides a type for a provider of a type variable that has the name of the type', () => {
    const p = project({
      java: javaOf(
        file('Clock', [], 'public interface Clock {}'), impl('SystemClock', 'Clock'),
        file('Maker', ['import javax.inject.Provider;'], 'public class Maker<Clock> implements Provider<Clock> { public Clock get() { return null; } }'),
        consumer(['  @Inject private Clock clock;']),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('hides a type for a nested class that provides it through a repository supertype that is a provider', () => {
    const p = project({
      java: javaOf(
        file('Clock', [], 'public interface Clock {}'), impl('SystemClock', 'Clock'),
        file('ClockProvider', ['import javax.inject.Provider;'], 'public interface ClockProvider extends Provider<Clock> {}'),
        file('Holder', [], ['public class Holder {', '  static class Impl implements ClockProvider { public Clock get() { return null; } }', '}']),
        consumer(['  @Inject private Clock clock;']),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('hides a type for a provider whose provider type it cannot confirm, and does not take it for a candidate', () => {
    const p = project({
      java: javaOf(
        file('Clock', [], 'public interface Clock {}'),
        file('ClockProvider', [], 'public class ClockProvider implements Provider<Clock> { public Clock get() { return null; } }'),
        consumer(['  @Inject private Clock clock;']),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('hides a type for a producer it cannot read the type of: a method no declaration of the row is', () => {
    const p = project({
      java: javaOf(
        file('Thing', [], 'public interface Thing {}'), impl('ThingImpl', 'Thing'),
        file('Producers', [PRODUCES], ['public class Producers {', '  @Produces public Thing make() { return null; } public Thing make(int n) { return null; }', '}']),
        consumer(['  @Inject private Thing thing;']),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('keeps a producer whose name qualifier is no literal under a name', () => {
    const p = project({
      java: javaOf(
        iface('PaymentService'), impl('SlowPayment', 'PaymentService'),
        file('Producers', [PRODUCES, NAMED], ['public class Producers {', '  @Produces @Named(Names.FAST) PaymentService make() { return null; }', '}']),
        consumer(['  @Inject @Named("fast") private PaymentService payment;'], { imports: [INJECT, NAMED] }),
      ),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> Producers#make']);
  });

  it('names a producer field by its own name even when it reads like a getter', () => {
    const p = project({
      java: javaOf(
        iface('PaymentService'),
        file('Producers', [PRODUCES, NAMED], ['public class Producers {', '  @Produces @Named PaymentService getFast;', '}']),
        consumer(['  @Inject @Named("getFast") private PaymentService payment;'], { imports: [INJECT, NAMED] }),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ noTargetNode: 1 });
  });

  it('takes a provider of two subtypes for one candidate', () => {
    const p = project({
      java: javaOf(
        iface('Port'), file('A', [], 'public interface A extends Port {}'), file('B', [], 'public interface B extends Port {}'),
        file('Multi', [], 'public class Multi implements javax.inject.Provider<A>, com.google.inject.Provider<B> { public A get() { return null; } }'),
        consumer(['  @Inject private Port port;']),
      ),
    });
    expect(p.buckets(JSR)).toEqual({ noTargetNode: 1 });
  });

  it('stops an edge for a class literal that two on-demand imports leave ambiguous, one of which is the type', () => {
    const files = javaOf(
      ['src/main/java/kit/a/Thing.java', javaSource('kit.a', [], 'public interface Thing {}')],
      ['src/main/java/kit/a/ThingImpl.java', javaSource('kit.a', [], 'public class ThingImpl implements Thing {}')],
      ['src/main/java/kit/b/Thing.java', javaSource('kit.b', [], 'public interface Thing {}')],
      ['src/main/java/kit/c/Module.java', javaSource('kit.c', ['import kit.a.*;', 'import kit.b.*;'], 'public class Module { Object o = Thing.class; }')],
      ['src/main/java/kit/c/Use.java', javaSource('kit.c', [INJECT, 'import kit.a.Thing;'], ['public class Use {', '  @Inject private Thing thing;', '}'])],
    );
    expect(project({ java: files }).buckets(JSR)).toEqual({ dynamicCandidate: 1 });
  });

  it('does not stop an edge for the class literal of another type that is called the same', () => {
    const p = project({
      java: javaOf(
        ['src/main/java/kit/a/Thing.java', javaSource('kit.a', [], 'public interface Thing {}')],
        ['src/main/java/kit/a/ThingImpl.java', javaSource('kit.a', [], 'public class ThingImpl implements Thing {}')],
        ['src/main/java/kit/b/Thing.java', javaSource('kit.b', [], 'public interface Thing {}')],
        ['src/main/java/kit/c/Module.java', javaSource('kit.c', [], 'public class Module { Object o = kit.b.Thing.class; }')],
        ['src/main/java/kit/c/Use.java', javaSource('kit.c', [INJECT, 'import kit.a.Thing;'], ['public class Use {', '  @Inject private Thing thing;', '}'])],
      ),
    });
    expect(p.links).toEqual(['kit.c.Use -> kit.a.ThingImpl']);
  });
});

// ---------------------------------------------------------------------------
// Review fixes: a name annotation that names nothing, generic provider bases,
// types of other JVM languages, and the names a filter drops
// ---------------------------------------------------------------------------

describe('a name annotation of the family that names no bean', () => {
  const QUALIFIER_IMPORT = 'import org.springframework.beans.factory.annotation.Qualifier;';
  const dao = [iface('OrderDao'), impl('JdbcOrderDao', 'OrderDao')];
  const field = (annotation) => consumer([`  @Inject ${annotation} private OrderDao dao;`], { imports: [INJECT, QUALIFIER_IMPORT] });
  const parameter = (annotation) => consumer([`  @Inject public OrderController(${annotation} OrderDao dao) {}`], { imports: [INJECT, QUALIFIER_IMPORT] });

  it('is by name for a field when it writes a value, and for a constant too: the by-name stage calls that a name it cannot read', () => {
    expect(project({ java: javaOf(...dao, field('@Qualifier("orderDao")')) }).buckets(JSR)).toEqual({ byName: 1 });
    expect(project({ java: javaOf(...dao, field('@Qualifier(Names.DAO)')) }).buckets(JSR)).toEqual({ byName: 1 });
  });

  it('is no name for a field when it writes none or the empty string: the point is a qualifier it cannot read, counted by its spelling', () => {
    for (const annotation of ['@Qualifier', '@Qualifier()', '@Qualifier("")']) {
      const p = project({ java: javaOf(...dao, field(annotation)) });
      expect(p.buckets(JSR), annotation).toEqual({ qualifierUnresolved: 1 });
      expect(p.coverage.qualifiers, annotation).toEqual({ Qualifier: 1 });
      expect(p.edges, annotation).toEqual([]);
      expect(p.gaps('type-injection-candidates-unresolved'), annotation).toHaveLength(1);
    }
  });

  it('is by name for a parameter when it writes a value, and no name when it writes none', () => {
    expect(project({ java: javaOf(...dao, parameter('@Qualifier("orderDao")')) }).buckets(JSR)).toEqual({ byName: 1 });
    expect(project({ java: javaOf(...dao, parameter('@Qualifier(Names.DAO)')) }).buckets(JSR)).toEqual({ byName: 1 });
    for (const annotation of ['@Qualifier', '@Qualifier("")']) {
      const p = project({ java: javaOf(...dao, parameter(annotation)) });
      expect(p.buckets(JSR), annotation).toEqual({ qualifierUnresolved: 1 });
      expect(p.coverage.qualifiers, annotation).toEqual({ Qualifier: 1 });
    }
  });

  it('is read as an ordinary annotation, so a family that reads no qualifiers takes the point by type', () => {
    const custom = JSON.parse(JSON.stringify(CATALOG));
    custom.injectionFamilies.push({
      id: 'custom', basis: 'A test family.', annotations: ['com.vendor.Wire'], on: ['field'], readsQualifiers: false,
      singleParameterMethods: false, nameArguments: [], nameAnnotations: ['com.vendor.Tag'], lookupArguments: [], typeArgument: null,
    });
    const run = (annotation) => project({
      java: javaOf(...dao, consumer([`  @Wire ${annotation} private OrderDao dao;`], { imports: ['import com.vendor.Wire;', 'import com.vendor.Tag;'] })),
      catalog: parseTypeInjectionCatalog(custom),
    });
    expect(run('@Tag').buckets('custom')).toEqual({ edge: 1 });
    expect(run('@Tag("x")').buckets('custom')).toEqual({ byName: 1 });
  });

  it('still leaves the by-name counts of the other stage as they were', () => {
    // The EJB family lists no name annotation, so the cross-stage identity of the O3 tests is not about this.
    expect(CATALOG.injectionFamilies.find((family) => family.id === EJB_FAMILY).nameAnnotations).toEqual([]);
  });
});

describe('a provider through a generic base class', () => {
  const foo = [iface('Foo'), impl('FooImpl', 'Foo')];
  const providerBase = file('BaseProvider', ['import javax.inject.Provider;'], 'public abstract class BaseProvider<X> implements Provider<X> { public X get() { return null; } }');
  const field = consumer(['  @Inject private Foo foo;']);

  it('hides a type that the type argument of the subclass names: it may be what the base provides', () => {
    const p = project({ java: javaOf(...foo, providerBase, file('FooProvider', [], 'public class FooProvider extends BaseProvider<Foo> {}'), field) });
    expect(p.edges).toEqual([]);
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('hides it through two levels of generic base, the argument written at the last', () => {
    const p = project({
      java: javaOf(
        ...foo, providerBase,
        file('Mid', [], 'public abstract class Mid<Y> extends BaseProvider<Y> {}'),
        file('FooProvider', [], 'public class FooProvider extends Mid<Foo> {}'),
        field,
      ),
    });
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('hides a type that is an argument nested in a generic argument, and one a wildcard bounds', () => {
    const nested = project({
      java: javaOf(...foo, providerBase, file('Box', [], 'public class Box<Z> {}'), file('BoxProvider', [], 'public class BoxProvider extends BaseProvider<Box<Foo>> {}'), field),
    });
    expect(nested.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
    const wildcard = project({
      java: javaOf(...foo, providerBase, file('Box', [], 'public class Box<Z> {}'), file('BoxProvider', [], 'public class BoxProvider extends BaseProvider<Box<? extends Foo>> {}'), field),
    });
    expect(wildcard.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('hides a type that only an ancestor of the provider writes as an argument', () => {
    const p = project({
      java: javaOf(
        ...foo, providerBase,
        file('FooBase', [], 'public abstract class FooBase extends BaseProvider<Foo> {}'),
        file('FooProvider', [], 'public class FooProvider extends FooBase {}'),
        field,
      ),
    });
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('hides a type that only an ancestor of a nested provider writes as an argument', () => {
    const p = project({
      java: javaOf(
        ...foo, providerBase,
        file('FooBase', [], 'public abstract class FooBase extends BaseProvider<Foo> {}'),
        file('Sub', [], 'public abstract class Sub extends FooBase {}'),
        file('Holder', [], ['public class Holder {', '  static class Maker extends Sub {}', '}']),
        field,
      ),
    });
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('hides a type that a nested class writes as an argument beside a provider of a variable of its owner', () => {
    const p = project({
      java: javaOf(
        ...foo, file('Box', [], 'public class Box<Q> {}'),
        file('Holder', ['import javax.inject.Provider;'], ['public class Holder<Z> {', '  class Maker extends Box<Foo> implements Provider<Z> { public Z get() { return null; } }', '}']),
        field,
      ),
    });
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('hides a type that a nested class provides through a generic base', () => {
    const p = project({
      java: javaOf(...foo, providerBase, file('Holder', [], ['public class Holder {', '  static class Maker extends BaseProvider<Foo> {}', '}']), field),
    });
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('hides a type that a nested class provides through a repository interface that is a generic provider', () => {
    const p = project({
      java: javaOf(
        ...foo, file('GenericProvider', ['import javax.inject.Provider;'], 'public interface GenericProvider<X> extends Provider<X> {}'),
        file('Holder', [], ['public class Holder {', '  static class Maker implements GenericProvider<Foo> { public Foo get() { return null; } }', '}']), field,
      ),
    });
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('does not hide what the arguments of the other types name: a generic base that is no provider blocks nothing', () => {
    const p = project({
      java: javaOf(...foo, providerBase, file('Box', [], 'public class Box<X> {}'), file('FooBox', [], 'public class FooBox extends Box<Foo> {}'), field),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.FooImpl']);
  });

  it('does not hide what a provider with a concrete argument says: that one is a candidate, not a hiding', () => {
    const p = project({
      java: javaOf(...foo, providerBase, file('Other', [], 'public interface Other {}'), file('OtherProvider', [], 'public class OtherProvider extends BaseProvider<Other> {}'), field),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> com.acme.FooImpl']);
  });
});

describe('types of other JVM languages', () => {
  const run = (files, otherJvmTypeCount) => project({ java: javaOf(...files), otherJvmTypeCount });
  const interfaceFiles = [iface('OrderService'), impl('OrderServiceImpl', 'OrderService'), consumer(['  @Inject private OrderService service;'])];

  it('hides an interface when the repository has a Kotlin or Scala type, which may implement it', () => {
    const p = run(interfaceFiles, 1);
    expect(p.edges).toEqual([]);
    expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
    expect(p.gaps('type-injection-candidates-unresolved')).toHaveLength(1);
  });

  it('hides an abstract class and a class that is not final too', () => {
    const files = (cls) => [cls, consumer(['  @Inject private Repo repo;'])];
    expect(run(files(file('Repo', [], 'public abstract class Repo {}')), 1).buckets(JSR)).toEqual({ hiddenCandidate: 1 });
    expect(run(files(file('Repo', [], 'public class Repo {}')), 1).buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('draws the edge for a final class, a record and an enum, which nothing extends', () => {
    expect(run([file('Repo', [], 'public final class Repo {}'), consumer(['  @Inject private Repo repo;'])], 1).links).toEqual(['com.acme.OrderController -> com.acme.Repo']);
    expect(run([file('Repo', [], 'public record Repo(int a) {}'), consumer(['  @Inject private Repo repo;'])], 1).links).toEqual(['com.acme.OrderController -> com.acme.Repo']);
    // an enum is no candidate, and no other language can extend it: no candidate rather than hidden
    expect(run([file('Mode', [], 'public enum Mode { A }'), consumer(['  @Inject private Mode mode;'])], 1).buckets(JSR)).toEqual({ noCandidate: 1 });
  });

  it('changes nothing for none, which is the default', () => {
    const none = run(interfaceFiles, 0);
    expect(none.links).toEqual(['com.acme.OrderController -> com.acme.OrderServiceImpl']);
    expect(run(interfaceFiles, undefined).result).toEqual(none.result);
  });

  it('lands in the bucket after the qualifiers, and before the counting', () => {
    const qualified = run([
      iface('PaymentService'), impl('FastPayment', 'PaymentService'),
      consumer(['  @Inject @RestClient private PaymentService payment;'], { imports: [INJECT, 'import com.vendor.RestClient;'] }),
    ], 1);
    expect(qualified.buckets(JSR)).toEqual({ qualifierUnresolved: 1 });
    const unbound = run([iface('OrderService'), consumer(['  @Inject private OrderService service;'])], 1);
    expect(unbound.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
  });

  it('does not touch a type outside the repository, and is switched off with the other hidden checks', () => {
    expect(run([consumer(['  @Inject private EntityManager em;'], { imports: [INJECT, 'import javax.persistence.EntityManager;'] })], 1).buckets(JSR)).toEqual({ outsideType: 1 });
    const off = project({ java: javaOf(...interfaceFiles), otherJvmTypeCount: 1, mutations: { noHiddenCandidates: true } });
    expect(off.links).toEqual(['com.acme.OrderController -> com.acme.OrderServiceImpl']);
  });

  it('refuses a count that is not one', () => {
    const p = project({ java: javaOf(...interfaceFiles) });
    for (const count of [-1, 1.5, '1', null]) {
      expect(() => resolveTypeInjections({ ...p.args, otherJvmTypeCount: count }), String(count)).toThrow(/otherJvmTypeCount must be a count/);
    }
  });

  it('is not asked of a run with no catalog', () => {
    const p = project({ java: javaOf(...interfaceFiles) });
    expect(resolveTypeInjections({ ...p.args, catalog: null, otherJvmTypeCount: 'x' }).coverage).toEqual({ status: 'not-run' });
  });
});

describe('names a filter drops', () => {
  const payments = [iface('PaymentService')];
  const point = consumer(['  @Inject @Named("x") private PaymentService payment;'], { imports: [INJECT, NAMED] });

  it('drops a producer that writes no name qualifier: it has no name to match', () => {
    const p = project({
      java: javaOf(...payments, file('Producers', [PRODUCES], ['public class Producers {', '  @Produces PaymentService x() { return null; }', '}']), point),
    });
    expect(p.edges).toEqual([]);
    expect(p.buckets(JSR)).toEqual({ noCandidate: 1 });
  });

  it('drops a producer field that writes no name qualifier, whatever it is called', () => {
    const p = project({
      java: javaOf(...payments, file('Producers', [PRODUCES], ['public class Producers {', '  @Produces PaymentService x;', '}']), point),
    });
    expect(p.buckets(JSR)).toEqual({ noCandidate: 1 });
  });

  it('drops a class that writes no name qualifier and no stereotype, whatever it is called', () => {
    const p = project({ java: javaOf(...payments, impl('X', 'PaymentService'), point) });
    expect(p.buckets(JSR)).toEqual({ noCandidate: 1 });
  });

  it('keeps the producer that is named, beside the one that is not', () => {
    const p = project({
      java: javaOf(
        ...payments,
        file('Producers', [PRODUCES, NAMED], ['public class Producers {', '  @Produces PaymentService other() { return null; }', '  @Produces @Named("x") PaymentService named() { return null; }', '}']),
        point,
      ),
    });
    expect(p.links).toEqual(['com.acme.OrderController -> Producers#named']);
  });
});

// ---------------------------------------------------------------------------
// Business interfaces a session class declares by annotation (task 3.6)
// ---------------------------------------------------------------------------

describe('business interfaces declared by annotation', () => {
  const STATELESS = 'import javax.ejb.Stateless;';
  const REMOTE = 'import javax.ejb.Remote;';
  const zero = Object.fromEntries(BUSINESS_INTERFACE_BUCKETS.map((bucket) => [bucket, 0]));
  const bean = (annotations, { implementsClause = '', name = 'OrderBean', body = '', imports = [STATELESS, LOCAL, REMOTE] } = {}) => file(
    name, imports, [...annotations, `public class ${name}${implementsClause} {${body}}`],
  );
  const business = (p) => p.coverage.businessInterfaces;
  const orders = consumer(['  @EJB private OrderService orders;'], { imports: [EJB] });

  it('has the eight buckets in the order of the design, and a gap only for three of them', () => {
    expect([...BUSINESS_INTERFACE_BUCKETS]).toEqual([
      'notListed', 'unreadable', 'outsideType', 'typeUndetermined', 'notInterface', 'alreadySupertype', 'unindexed', 'declared',
    ]);
    expect(Object.isFrozen(BUSINESS_INTERFACE_BUCKETS)).toBe(true);
    expect([...BUSINESS_INTERFACE_GAP_BUCKETS]).toEqual(['unreadable', 'typeUndetermined', 'unindexed']);
    expect(BUSINESS_INTERFACE_GAP_KIND).toBe('business-interface-unresolved');
  });

  describe('the scenarios of the requirement', () => {
    it('draws an implements edge for an interface the class does not write, and the by-type point reaches the class', () => {
      const p = project({ java: javaOf(iface('OrderService'), bean(['@Stateless', '@Local(OrderService.class)']), orders) });
      const path = SRC('OrderBean');
      expect(p.result.implementsEdges).toEqual([{
        source: 'class:com.acme.OrderBean',
        target: 'class:com.acme.OrderService',
        type: 'implements',
        direction: 'forward',
        weight: 0.9,
        provenance: 'extracted',
        evidence: [{ file: path, line: p.line(path, '@Local'), source: 'tree-sitter', token: 'OrderService', role: 'businessInterface' }],
      }]);
      expect(p.links).toEqual(['com.acme.OrderController -> com.acme.OrderBean']);
      expect(business(p)).toEqual({ annotations: 1, declarations: 1, buckets: { ...zero, declared: 1 }, edges: 1 });
      expect(p.result.gaps).toEqual([]);
      expect(() => assertTypeInjectionConservation(p.coverage, measureTypeInjections(p.result))).not.toThrow();
    });

    it('draws no new edge for an interface the class already implements', () => {
      const p = project({ java: javaOf(iface('OrderService'), bean(['@Local(OrderService.class)'], { implementsClause: ' implements OrderService' }), orders) });
      expect(p.result.implementsEdges).toEqual([]);
      expect(business(p)).toEqual({ annotations: 1, declarations: 1, buckets: { ...zero, alreadySupertype: 1 }, edges: 0 });
      expect(p.links).toEqual(['com.acme.OrderController -> com.acme.OrderBean']);
    });

    it('lands a constant in "unreadable" and records the gap, with the annotation and its argument in the sample', () => {
      const p = project({ java: javaOf(iface('OrderService'), bean(['@Local(Interfaces.LOCAL)']), orders) });
      const path = SRC('OrderBean');
      expect(p.result.implementsEdges).toEqual([]);
      expect(business(p)).toEqual({ annotations: 1, declarations: 1, buckets: { ...zero, unreadable: 1 }, edges: 0 });
      expect(p.gaps('business-interface-unresolved')).toEqual([{
        kind: 'business-interface-unresolved', scope: 'javax.ejb.Local', sample: `${path}:${p.line(path, '@Local')} OrderBean @Local(value)`,
      }]);
      // The class is no candidate of the interface it does not declare: the by-type point finds none.
      expect(p.buckets(EJB_FAMILY)).toEqual({ noCandidate: 1 });
    });

    it('lands an interface outside the repository in "outside type", with no gap', () => {
      const p = project({ java: javaOf(bean(['@Remote(javax.management.MBeanServer.class)'])) });
      expect(p.result.implementsEdges).toEqual([]);
      expect(business(p)).toEqual({ annotations: 1, declarations: 1, buckets: { ...zero, outsideType: 1 }, edges: 0 });
      expect(p.result.gaps).toEqual([]);
    });
  });

  describe('all eight buckets', () => {
    const taxonomyBusiness = (extra = {}) => project({
      java: javaOf(
        file('Port', [], 'public interface Port {}'), file('Port2', [], 'public interface Port2 {}'), file('Port3', [], 'public interface Port3 {}'),
        file('Port4', [], 'public interface Port4 {}'), file('Port5', [], 'public interface Port5 {}'),
        file('Concrete', [], 'public class Concrete {}'), file('Holder', [], 'public class Holder { public static class Part {} }'),
        file('NotListedBean', [LOCAL], ['@Local', 'public class NotListedBean {}']),
        file('UnreadableBean', [LOCAL], ['@Local(Interfaces.LOCAL)', 'public class UnreadableBean {}']),
        file('OutsideBean', [REMOTE], ['@Remote(javax.management.MBeanServer.class)', 'public class OutsideBean {}']),
        file('UndeterminedBean', [LOCAL], ['@Local({Holder.Part.class, Mystery.class})', 'public class UndeterminedBean {}']),
        file('ConcreteBean', [LOCAL], ['@Local(Concrete.class)', 'public class ConcreteBean {}']),
        file('AlreadyBean', [LOCAL], ['@Local(Port.class)', 'public class AlreadyBean implements Port {}']),
        file('UnindexedBean', [LOCAL], ['@Local(Port2.class)', 'public class UnindexedBean {}']),
        file('DeclaredBean', [LOCAL], ['@Local(Port3.class)', 'public class DeclaredBean {}']),
        file('TwoBean', [REMOTE], ['@Remote({Port4.class, "text", Port5.class})', 'public class TwoBean {}']),
      ),
      nullClassIds: ['UnindexedBean'],
      ...extra,
    });

    it('lands each declaration in one bucket, with the counts of annotations, declarations and edges', () => {
      const p = taxonomyBusiness();
      expect(business(p)).toEqual({
        annotations: 9,
        declarations: 11,
        buckets: { notListed: 1, unreadable: 1, outsideType: 1, typeUndetermined: 2, notInterface: 1, alreadySupertype: 1, unindexed: 1, declared: 3 },
        edges: 3,
      });
      expect(p.result.implementsEdges.map((edge) => `${edge.source.replace('class:com.acme.', '')} -> ${edge.target.replace('class:com.acme.', '')}`)).toEqual([
        'DeclaredBean -> Port3', 'TwoBean -> Port4', 'TwoBean -> Port5',
      ]);
    });

    it('records one gap per declaration that cannot be read, with its sample', () => {
      const p = taxonomyBusiness();
      const at = (name, needle) => `${SRC(name)}:${p.line(SRC(name), needle)}`;
      expect(p.result.gaps.map((gap) => [gap.kind, gap.scope, gap.sample])).toEqual([
        ['business-interface-unresolved', 'javax.ejb.Local', `${at('UnreadableBean', '@Local')} UnreadableBean @Local(value)`],
        ['business-interface-unresolved', 'javax.ejb.Local', `${at('UndeterminedBean', '@Local')} UndeterminedBean Holder.Part`],
        ['business-interface-unresolved', 'javax.ejb.Local', `${at('UndeterminedBean', '@Local')} UndeterminedBean Mystery`],
        ['business-interface-unresolved', 'javax.ejb.Local', `${at('UnindexedBean', '@Local')} UnindexedBean Port2`],
      ]);
    });

    it('balances: the buckets add up to the declarations, the declared ones are the evidence of the implements edges, the gaps are the gap buckets', () => {
      const p = taxonomyBusiness();
      const measured = measureTypeInjections(p.result);
      expect(measured.implementations).toBe(3);
      expect(measured.gaps['javax.ejb.Local']).toEqual({ 'business-interface-unresolved': 4 });
      expect(() => assertTypeInjectionConservation(p.coverage, measured)).not.toThrow();
    });
  });

  describe('how a declaration is counted and drawn', () => {
    it('counts a class literal as a declaration, and an annotation with none as one declaration of its own', () => {
      const p = project({
        java: javaOf(iface('A'), iface('B'), bean(['@Local({A.class, B.class, C.CONST})', '@Remote(Names.X)', '@Remote'])),
      });
      expect(business(p)).toMatchObject({ annotations: 3, declarations: 4, buckets: { ...zero, declared: 2, typeUndetermined: 0, unreadable: 1, notListed: 1 }, edges: 2 });
    });

    it('draws one edge for a pair, with the evidence of each class literal that names it', () => {
      const p = project({ java: javaOf(iface('OrderService'), bean(['@Local(OrderService.class)', '@Remote(OrderService.class)'])) });
      const path = SRC('OrderBean');
      expect(p.result.implementsEdges).toHaveLength(1);
      expect(p.result.implementsEdges[0].evidence).toEqual([
        { file: path, line: p.line(path, '@Local'), source: 'tree-sitter', token: 'OrderService', role: 'businessInterface' },
        { file: path, line: p.line(path, '@Remote'), source: 'tree-sitter', token: 'OrderService', role: 'businessInterface' },
      ]);
      expect(business(p)).toMatchObject({ declarations: 2, edges: 2 });
      expect(() => assertTypeInjectionConservation(p.coverage, measureTypeInjections(p.result))).not.toThrow();
    });

    it('counts a class literal written twice at one line once', () => {
      const p = project({ java: javaOf(iface('OrderService'), bean(['@Local({OrderService.class, OrderService.class})'])) });
      expect(business(p)).toMatchObject({ declarations: 1, edges: 1 });
      expect(p.result.implementsEdges[0].evidence).toHaveLength(1);
      expect(() => assertTypeInjectionConservation(p.coverage, measureTypeInjections(p.result))).not.toThrow();
    });

    it('writes the type as the class literal spells it: a qualified name stays qualified', () => {
      const p = project({ java: javaOf(iface('OrderService'), bean(['@Local(com.acme.OrderService.class)'])) });
      expect(p.result.implementsEdges[0].evidence[0].token).toBe('com.acme.OrderService');
    });

    it('lands an array type and a primitive in "outside type", and a class that is no interface in "not interface"', () => {
      const p = project({ java: javaOf(iface('OrderService'), file('Concrete', [], 'public class Concrete {}'), bean(['@Local({OrderService[].class, int.class, Concrete.class})'])) });
      expect(business(p).buckets).toEqual({ ...zero, outsideType: 2, notInterface: 1 });
      expect(p.result.gaps).toEqual([]);
    });

    it('lands an enum and a record in "not interface"', () => {
      const p = project({ java: javaOf(file('Mode', [], 'public enum Mode { A }'), file('Pair', [], 'public record Pair(int a) {}'), bean(['@Local({Mode.class, Pair.class})'])) });
      expect(business(p).buckets).toEqual({ ...zero, notInterface: 2 });
    });

    it('lands a type declared twice, a nested type and an undeclared name in "type undetermined", counted by their spelling', () => {
      const p = project({
        java: javaOf(
          file('Holder', [], 'public class Holder { public interface Inner {} }'),
          iface('Twin'), ['other/src/main/java/com/acme/Twin.java', javaSource('com.acme', [], 'public interface Twin {}')],
          bean(['@Local({Twin.class, Holder.Inner.class, Mystery.class})']),
        ),
      });
      expect(business(p).buckets).toEqual({ ...zero, typeUndetermined: 3 });
      expect(p.samples('business-interface-unresolved').map((sample) => sample.split(' ').pop())).toEqual(['Twin', 'Holder.Inner', 'Mystery']);
    });

    it('reads the class literal in the scope of the class that writes it: a member type of the class hides the name', () => {
      const p = project({ java: javaOf(iface('Port'), bean(['@Local(Port.class)'], { body: ' interface Port {} ' })) });
      expect(business(p).buckets).toEqual({ ...zero, typeUndetermined: 1 });
    });

    it('does not draw an edge for a class with no node, nor to an interface with none, and both are counted "unindexed"', () => {
      const noClass = project({ java: javaOf(iface('OrderService'), bean(['@Local(OrderService.class)'])), nullClassIds: ['OrderBean'] });
      expect(noClass.result.implementsEdges).toEqual([]);
      expect(business(noClass).buckets).toEqual({ ...zero, unindexed: 1 });
      const noInterface = project({ java: javaOf(iface('OrderService'), bean(['@Local(OrderService.class)'])), nullClassIds: ['OrderService'] });
      expect(noInterface.result.implementsEdges).toEqual([]);
      expect(business(noInterface).buckets).toEqual({ ...zero, unindexed: 1 });
      expect(noInterface.gaps('business-interface-unresolved')).toHaveLength(1);
    });

    it('cites the line of each class literal, which is not the line of the annotation when the array spans several', () => {
      const p = project({ java: javaOf(iface('A'), iface('B'), bean(['@Local({', '    A.class,', '    B.class', '})'])) });
      const path = SRC('OrderBean');
      expect(p.result.implementsEdges.map((edge) => [edge.target, edge.evidence.map((entry) => [entry.line, entry.token])])).toEqual([
        ['class:com.acme.A', [[p.line(path, 'A.class'), 'A']]],
        ['class:com.acme.B', [[p.line(path, 'B.class'), 'B']]],
      ]);
      expect(p.line(path, 'A.class')).toBeGreaterThan(p.line(path, '@Local'));
    });

    it('counts a class that has no class entry of its own as unindexed: no edge, and no supertype it could be a candidate by', () => {
      const p = project({ java: javaOf(iface('OrderService'), bean(['@Local(com.acme.OrderService.class)']), orders) });
      const rows = p.javaRows.map((row) => structuredClone(row));
      delete rows.find((row) => row.path === SRC('OrderBean')).classes[0].qualifiedName;
      const resolved = resolveTypeInjections({ ...p.args, javaRows: rows, types: createJavaCallResolver({ rows, functionIds: p.functionIds, classIds: p.classIds }) });
      expect(resolved.implementsEdges).toEqual([]);
      expect(resolved.coverage.businessInterfaces.buckets).toEqual({ ...zero, unindexed: 1 });
      expect(resolved.coverage.families[EJB_FAMILY].buckets.noCandidate).toBe(1);
    });

    it('takes an interface the class reaches through a superclass for one it already has', () => {
      const p = project({
        java: javaOf(iface('OrderService'), file('BaseBean', [], 'public class BaseBean implements OrderService {}'), bean(['@Local(OrderService.class)'], { implementsClause: ' extends BaseBean' })),
      });
      expect(business(p).buckets).toEqual({ ...zero, alreadySupertype: 1 });
    });

    it('does not draw a method-level edge: the only edges of the business interfaces are the implements edges between types', () => {
      const p = project({
        java: javaOf(file('OrderService', [], 'public interface OrderService { void place(); }'), bean(['@Local(OrderService.class)'], { body: ' public void place() {} ' })),
      });
      expect(p.result.implementsEdges.map((edge) => [edge.source, edge.target])).toEqual([['class:com.acme.OrderBean', 'class:com.acme.OrderService']]);
    });
  });

  describe('which annotations are read', () => {
    it('reads the annotations of a class, and not those of an interface, an enum, a record or a nested class', () => {
      const p = project({
        java: javaOf(
          iface('OrderService'),
          file('Holder', [LOCAL], ['public class Holder {', '  @Local(OrderService.class) static class Nested {}', '}']),
          file('Pair', [LOCAL], ['@Local(OrderService.class)', 'public record Pair(int a) {}']),
          file('Mode', [LOCAL], ['@Local(OrderService.class)', 'public enum Mode { A }']),
          file('Port', [LOCAL], ['@Local(OrderService.class)', 'public interface Port {}']),
        ),
      });
      expect(business(p)).toEqual({ annotations: 0, declarations: 0, buckets: zero, edges: 0 });
      expect(p.result.implementsEdges).toEqual([]);
    });

    it('does not read a spelling it cannot confirm, and counts it', () => {
      const p = project({ java: javaOf(iface('OrderService'), bean(['@Local(OrderService.class)'], { imports: [] })) });
      expect(business(p).annotations).toBe(0);
      expect(p.coverage.unconfirmed).toEqual({ Local: 1 });
    });

    it('reads the annotations of both namespaces and of a class that is abstract', () => {
      const p = project({
        java: javaOf(iface('A'), iface('B'), file('JakartaBean', ['import jakarta.ejb.Local;'], ['@Local(A.class)', 'public class JakartaBean {}']), file('Base', [LOCAL], ['@Local(B.class)', 'public abstract class Base {}'])),
      });
      expect(business(p)).toMatchObject({ annotations: 2, buckets: { ...zero, declared: 2 } });
      expect(p.result.gaps).toEqual([]);
    });
  });

  describe('what the declared interfaces do to the by-type points', () => {
    it('makes the class a candidate for the interfaces of the interface it declares', () => {
      const p = project({
        java: javaOf(
          iface('OrderService'), file('LocalOrderService', [], 'public interface LocalOrderService extends OrderService {}'),
          bean(['@Local(LocalOrderService.class)']), orders,
        ),
      });
      expect(p.links).toEqual(['com.acme.OrderController -> com.acme.OrderBean']);
    });

    it('makes the class a candidate when the interface is declared by a class with no node: the point has no node to point at', () => {
      const p = project({ java: javaOf(iface('OrderService'), bean(['@Local(OrderService.class)']), orders), nullClassIds: ['OrderBean'] });
      expect(p.buckets(EJB_FAMILY)).toEqual({ noTargetNode: 1 });
    });

    it('counts the class beside another that implements the interface in Java: two candidates', () => {
      const p = project({ java: javaOf(iface('OrderService'), impl('OrderServiceImpl', 'OrderService'), bean(['@Local(OrderService.class)']), orders) });
      expect(p.buckets(EJB_FAMILY)).toEqual({ ambiguous: 1 });
      expect(p.samples('type-injection-ambiguous')[0]).toMatch(/ -> com\.acme\.OrderBean, com\.acme\.OrderServiceImpl$/);
    });

    it('is not a class literal in code: the interface the annotation names is not "dynamic"', () => {
      const p = project({ java: javaOf(iface('OrderService'), bean(['@Local(OrderService.class)']), consumer(['  @Inject private OrderService orders;'])) });
      expect(p.links).toEqual(['com.acme.OrderController -> com.acme.OrderBean']);
      expect(p.buckets(JSR)).toEqual({ edge: 1 });
    });

    it('hides a type for the name of an interface it cannot resolve, as it hides for any supertype it cannot resolve', () => {
      const p = project({
        java: javaOf(
          iface('OrderService'), impl('OrderServiceImpl', 'OrderService'), file('Holder', [], 'public class Holder {}'),
          bean(['@Local(Holder.OrderService.class)']),
          consumer(['  @Inject private OrderService service;']),
        ),
      });
      expect(p.buckets(JSR)).toEqual({ hiddenCandidate: 1 });
    });

    it('does not hide for an interface that cannot be read at all: nothing says what it is', () => {
      const p = project({
        java: javaOf(iface('OrderService'), impl('OrderServiceImpl', 'OrderService'), bean(['@Local(Interfaces.LOCAL)']), consumer(['  @Inject private OrderService service;'])),
      });
      expect(p.links).toEqual(['com.acme.OrderController -> com.acme.OrderServiceImpl']);
    });
  });

  describe('the conservation of the business interfaces', () => {
    const run = () => project({ java: javaOf(iface('OrderService'), bean(['@Local(OrderService.class)', '@Remote(Interfaces.X)'])) });
    const tamper = (edit) => {
      const p = run();
      const coverage = structuredClone(p.coverage);
      const recorded = structuredClone(measureTypeInjections(p.result));
      edit(coverage, recorded);
      return () => assertTypeInjectionConservation(coverage, recorded);
    };

    it('passes for a run', () => {
      expect(tamper(() => {})).not.toThrow();
      expect(business(run())).toMatchObject({ declarations: 2, buckets: { ...zero, declared: 1, unreadable: 1 }, edges: 1 });
    });

    it('fails when the buckets do not add up to the declarations', () => {
      expect(tamper((coverage) => { coverage.businessInterfaces.buckets.notInterface += 1; })).toThrow(/business interfaces: 2 declaration\(s\) but 3 outcome\(s\)/);
      expect(tamper((coverage) => { coverage.businessInterfaces.declarations += 1; })).toThrow(/business interfaces: 3 declaration\(s\) but 2 outcome\(s\)/);
    });

    it('fails when the declared ones are not the edges counted', () => {
      expect(tamper((coverage) => { coverage.businessInterfaces.edges = 2; })).toThrow(/business interfaces: 1 declaration\(s\) became an implements edge but 2 edge\(s\) were counted/);
    });

    it('fails when the edges drawn are not the entries of the evidence', () => {
      expect(tamper((_, recorded) => { recorded.implementations = 0; })).toThrow(/business interfaces: 1 implements edge\(s\) drawn but 0 entr\(ies\) in the evidence/);
      expect(tamper((_, recorded) => { recorded.implementations = 2; })).toThrow(/but 2 entr\(ies\)/);
    });

    it('fails when the gaps recorded are not the buckets that are gaps', () => {
      expect(tamper((_, recorded) => { recorded.gaps = {}; })).toThrow(/business interfaces: 1 business-interface-unresolved outcome\(s\) but 0 recorded gap occurrence\(s\)/);
      expect(tamper((_, recorded) => { recorded.gaps['javax.ejb.Remote'][BUSINESS_INTERFACE_GAP_KIND] += 1; })).toThrow(/outcome\(s\) but 2 recorded gap/);
    });

    it('counts the gaps of every annotation of the catalog together', () => {
      const p = project({ java: javaOf(iface('OrderService'), bean(['@Local(Interfaces.X)', '@Remote(Interfaces.Y)'])) });
      expect(measureTypeInjections(p.result).gaps).toEqual({
        'javax.ejb.Local': { [BUSINESS_INTERFACE_GAP_KIND]: 1 },
        'javax.ejb.Remote': { [BUSINESS_INTERFACE_GAP_KIND]: 1 },
      });
      expect(() => assertTypeInjectionConservation(p.coverage, measureTypeInjections(p.result))).not.toThrow();
    });

    it('fails for a run whose coverage has no business interface section', () => {
      const p = run();
      const coverage = structuredClone(p.coverage);
      delete coverage.businessInterfaces;
      expect(() => assertTypeInjectionConservation(coverage, measureTypeInjections(p.result))).toThrow(/a run has no business interface coverage/);
    });
  });

  describe('the switch (D14)', () => {
    it('noBusinessInterfaces: the annotations are not read: no edge, no supertype, every bucket zero', () => {
      const java = javaOf(iface('OrderService'), bean(['@Stateless', '@Local(OrderService.class)']), orders);
      const on = project({ java });
      expect(on.links).toEqual(['com.acme.OrderController -> com.acme.OrderBean']);
      const off = project({ java, mutations: { noBusinessInterfaces: true } });
      expect(off.result.implementsEdges).toEqual([]);
      expect(off.edges).toEqual([]);
      expect(business(off)).toEqual({ annotations: 0, declarations: 0, buckets: zero, edges: 0 });
      expect(off.buckets(EJB_FAMILY)).toEqual({ noCandidate: 1 });
    });

    it('turns the same off for the unresolvable interface that hides, and for the gaps', () => {
      const java = javaOf(iface('OrderService'), impl('OrderServiceImpl', 'OrderService'), file('Holder', [], 'public class Holder {}'),
        bean(['@Local(Holder.OrderService.class)']), consumer(['  @Inject private OrderService service;']));
      expect(project({ java }).buckets(JSR)).toEqual({ hiddenCandidate: 1 });
      const off = project({ java, mutations: { noBusinessInterfaces: true } });
      expect(off.links).toEqual(['com.acme.OrderController -> com.acme.OrderServiceImpl']);
      expect(off.result.gaps).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// The injects edges of the three sources: one edge per pair (task 4.1)
// ---------------------------------------------------------------------------

describe('mergeInjectsEdges with the by-type source (design D11)', () => {
  const NAME_CATALOG = loadNameBindingCatalog();
  const STATELESS = 'import javax.ejb.Stateless;';

  /** The by-name annotation stage over the rows of a project, with no descriptor. */
  function nameEdges(p) {
    const sites = collectNameReferenceSites({ scan: { files: [] }, catalog: NAME_CATALOG, readFile: () => '' });
    const table = buildNameBindingTable({
      sites, catalog: NAME_CATALOG, manifestPaths: Object.keys(p.texts), javaRows: p.javaRows, classIds: p.classIds, javaTypes: p.javaTypes,
      otherJvm: { isType: () => false }, declaredJavaTypes: p.declaredJavaTypes,
    });
    return resolveAnnotationInjections({ javaRows: p.javaRows, catalog: NAME_CATALOG, table, classIds: p.classIds }).edges;
  }

  // Two fields of Checkout reach OrderBean: one by the bean name, one by the type.
  const checkout = () => project({
    java: javaOf(
      file('OrderBean', [STATELESS], ['@Stateless', 'public class OrderBean {}']),
      file('Checkout', [EJB], ['public class Checkout {', '  @EJB(beanName = "OrderBean") private Orders a;', '  @EJB private OrderBean b;', '}']),
    ),
  });

  it('is one edge for a pair the by-name stage and the by-type stage both draw, with the evidence of both', () => {
    const p = checkout();
    const named = nameEdges(p);
    expect(named.map((edge) => [edge.source, edge.target])).toEqual([['class:com.acme.Checkout', 'class:com.acme.OrderBean']]);
    expect(p.links).toEqual(['com.acme.Checkout -> com.acme.OrderBean']);

    const merged = mergeInjectsEdges({ xmlEdges: [], annotationEdges: named, typeEdges: p.edges });
    expect(merged).toHaveLength(1);
    const path = SRC('Checkout');
    expect(merged[0]).toMatchObject({ source: 'class:com.acme.Checkout', target: 'class:com.acme.OrderBean', type: 'injects', direction: 'forward', weight: 0.5, provenance: 'extracted' });
    expect(merged[0].evidence.map((entry) => [entry.line, entry.token, entry.site ?? entry.role])).toEqual([
      [p.line(path, 'beanName'), 'OrderBean', 'ejb-bean-name'],
      [p.line(path, '@EJB private'), 'EJB', 'injection'],
      [p.line(path, '@EJB private'), 'b', 'member'],
    ]);
    // the entries are what each stage drew, untouched
    expect(merged[0].evidence).toEqual(expect.arrayContaining([...named[0].evidence, ...p.edges[0].evidence]));
    expect(merged[0].evidence).toHaveLength(named[0].evidence.length + p.edges[0].evidence.length);
  });

  it('keeps the edge of a pair only the by-type stage draws as it is: the stage\'s own edge, the evidence in the stage\'s order', () => {
    const p = project({ java: javaOf(iface('OrderService'), impl('OrderServiceImpl', 'OrderService'), consumer(['  @Inject private OrderService a;', '  @Inject private OrderService b;'])) });
    const merged = mergeInjectsEdges({ xmlEdges: [], annotationEdges: [], typeEdges: p.edges });
    expect(merged).toEqual(p.edges);
    expect(merged[0]).not.toBe(p.edges[0]);
    expect(merged[0].evidence).not.toBe(p.edges[0].evidence);
  });

  it('keeps the pairs of the sources apart, the first source\'s first', () => {
    const p = checkout();
    const other = { ...p.edges[0], target: 'class:com.acme.Other', evidence: [] };
    const merged = mergeInjectsEdges({ xmlEdges: [], annotationEdges: nameEdges(p), typeEdges: [other, ...p.edges] });
    expect(merged.map((edge) => edge.target)).toEqual(['class:com.acme.OrderBean', 'class:com.acme.Other']);
  });

  it('merges the three sources into one edge, sorted by file, line, token, and the site or the role', () => {
    const p = checkout();
    const xml = {
      source: 'class:com.acme.Checkout', target: 'class:com.acme.OrderBean', type: 'injects', direction: 'forward', weight: 0.5, provenance: 'extracted',
      evidence: [{ file: 'app/ctx.xml', line: 4, source: 'lexical', token: 'orderBean', site: 'spring-ref' }],
    };
    const merged = mergeInjectsEdges({ xmlEdges: [xml], annotationEdges: nameEdges(p), typeEdges: p.edges });
    expect(merged).toHaveLength(1);
    expect(merged[0].evidence.map((entry) => entry.file)).toEqual(['app/ctx.xml', SRC('Checkout'), SRC('Checkout'), SRC('Checkout')]);
  });

  it('sorts entries that have no role, family, member or parameter as it did before they existed', () => {
    const entry = (extra) => ({ file: 'a.java', line: 3, source: 'lexical', token: 't', ...extra });
    const edge = (evidence) => ({ source: 's', target: 't', type: 'injects', direction: 'forward', weight: 0.5, provenance: 'extracted', evidence });
    const [merged] = mergeInjectsEdges({
      xmlEdges: [edge([entry({ site: 'b-site' }), entry({ site: 'a-site' }), entry({ site: 'a-site' })])],
      annotationEdges: [edge([entry({ line: 2, site: 'z-site' })])],
    });
    expect(merged.evidence.map((x) => [x.line, x.site])).toEqual([[2, 'z-site'], [3, 'a-site'], [3, 'b-site']]);
  });

  it('tells apart the entries of two families, two members and two parameters on one line, and counts one of each twice as one', () => {
    const entry = (extra) => ({ file: 'a.java', line: 3, source: 'tree-sitter', token: 'x', role: 'member', family: 'f', member: 'm', ...extra });
    const edge = (evidence) => ({ source: 's', target: 't', type: 'injects', direction: 'forward', weight: 0.5, provenance: 'extracted', evidence });
    const [merged] = mergeInjectsEdges({
      xmlEdges: [],
      annotationEdges: [],
      typeEdges: [edge([
        entry({ parameter: 1 }), entry({ parameter: 0 }), entry({ member: 'n' }), entry({ family: 'g' }), entry({ role: 'injection' }), entry({ parameter: 0 }),
      ])],
    });
    expect(merged.evidence.map((x) => [x.role, x.family, x.member, x.parameter])).toEqual([
      ['injection', 'f', 'm', undefined],
      ['member', 'f', 'm', 0],
      ['member', 'f', 'm', 1],
      ['member', 'f', 'n', undefined],
      ['member', 'g', 'm', undefined],
    ]);
  });

  it('with the switch on drops the by-type edge of a pair another source drew, and with no other source keeps it', () => {
    const p = checkout();
    const named = nameEdges(p);
    const wrong = mergeInjectsEdges({ xmlEdges: [], annotationEdges: named, typeEdges: p.edges, mutations: { noInjectsMerge: true } });
    expect(wrong).toHaveLength(1);
    expect(wrong[0].evidence).toEqual(named[0].evidence);
    // the first source's edge wins whichever source it is: the by-type edge, put first, has the by-type evidence only
    const typeFirst = mergeInjectsEdges({ xmlEdges: [], annotationEdges: [], typeEdges: [...p.edges, ...named], mutations: { noInjectsMerge: true } });
    expect(typeFirst[0].evidence).toEqual(p.edges[0].evidence);
    // alone, nothing is dropped
    expect(mergeInjectsEdges({ xmlEdges: [], annotationEdges: [], typeEdges: p.edges, mutations: { noInjectsMerge: true } })).toEqual(p.edges);
  });

  it('refuses an edge that is no injects edge, in any of the three sources', () => {
    const p = checkout();
    const bad = { ...p.edges[0], type: 'implements' };
    expect(() => mergeInjectsEdges({ xmlEdges: [], annotationEdges: [], typeEdges: [bad] })).toThrow(/an edge of the type "implements" among the injects edges to merge/);
  });

  it('defaults the by-type source to none: the two-source call is as it was', () => {
    const p = checkout();
    const named = nameEdges(p);
    expect(mergeInjectsEdges({ xmlEdges: [], annotationEdges: named })).toEqual(named);
  });
});
