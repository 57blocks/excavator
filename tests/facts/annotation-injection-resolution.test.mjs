// annotation-injection-references, tasks 3.2-3.5: the resolution of Java
// annotation injection sites into `injects` edges, visible buckets, gaps and
// coverage (skills/excavator/annotation-injection-resolution.mjs), over the one
// binding table, and the merge of this source's edges with the XML source's.
//
// Every input is real: small synthetic projects are read by the real
// name-reference stage (name-reference-sites.mjs) and the real binding table
// (name-reference-resolution.mjs); Java rows are what Core emits for the source
// text - `memberAnnotations` included, read from the built Core. Nothing here goes
// through buildFactGraph: wiring it in is task 4.2.
import { beforeAll, describe, expect, it } from 'vitest';
import { extname } from 'node:path';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { collectNameReferenceSites } from '../../skills/excavator/name-reference-sites.mjs';
import { MEMBER_DEFAULT_NAME_RULES, loadNameBindingCatalog, parseNameBindingCatalog } from '../../skills/excavator/name-binding-catalog.mjs';
import { buildNameBindingTable } from '../../skills/excavator/name-reference-resolution.mjs';
import { XML_INJECTION_BUCKETS, XML_INJECTION_GAP_KINDS, assertInjectionConservation, resolveXmlInjections } from '../../skills/excavator/xml-injection-resolution.mjs';
import {
  ANNOTATION_INJECTION_BUCKETS,
  ANNOTATION_INJECTION_GAP_KINDS,
  MEMBER_NAME_RULES,
  mergeInjectsEdges,
  resolveAnnotationInjections,
} from '../../skills/excavator/annotation-injection-resolution.mjs';

let registry;
beforeAll(async () => {
  const tsPlugin = new TreeSitterPlugin(builtinLanguageConfigs.filter((c) => c.treeSitter));
  await tsPlugin.init();
  registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);
});

const CATALOG = loadNameBindingCatalog();
const LANGUAGE_OF_EXTENSION = { xml: 'xml', xhtml: 'xhtml', properties: 'properties' };
const lines = (text) => (Array.isArray(text) ? text.join('\n') : text);
const POM = '<project/>';
const BEANS_OPEN = '<beans xmlns="http://www.springframework.org/schema/beans">';
const CTX = 'app/WEB-INF/ctx.xml';
/** A Spring context: the first definition is on line 2. */
const ctx = (...definitions) => [BEANS_OPEN, ...definitions.flat(), '</beans>'].join('\n');
const SEAM_COMPONENTS = 'http://jboss.com/products/seam/components';
const FACES = (name, cls) => `<faces-config><managed-bean><managed-bean-name>${name}</managed-bean-name><managed-bean-class>${cls}</managed-bean-class></managed-bean></faces-config>`;

/** Where a class of package `pkg` is, in the unit `unit`. */
const SRC = (name, pkg = 'com.acme', unit = 'app') => `${unit}/src/${pkg.replaceAll('.', '/')}/${name}.java`;
/** A plain class of package com.acme. */
const classFile = (name, pkg = 'com.acme', unit = 'app') => [SRC(name, pkg, unit), `package ${pkg};\n\npublic class ${name} {\n}\n`];
const javaOf = (...names) => Object.fromEntries(names.map((name) => classFile(name)));
/** The label of a class node in `links`. */
const CLASS = (name, unit = 'app', pkg = 'com.acme') => `${SRC(name, pkg, unit)}#${name}`;
/** `file:line` of the first line of a source that holds `needle`. */
const at = (p, path, needle) => `${path}:${p.texts[path].split('\n').findIndex((line) => line.includes(needle)) + 1}`;

const RESOURCE = 'import javax.annotation.Resource;';
const QUALIFIER = 'import org.springframework.beans.factory.annotation.Qualifier;';
const SERVICE = 'import org.springframework.stereotype.Service;';
const SEAM_NAME = 'import org.jboss.seam.annotations.Name;';
const SEAM_IN = 'import org.jboss.seam.annotations.In;';
/** A Java file: the package line, the imports, a blank line, the body - the first import on line 2. */
const javaSource = (pkg, imports, body) => [`package ${pkg};`, ...imports, '', ...[body].flat(), ''].join('\n');

/**
 * Read a synthetic project the way the Lazy driver does, up to the injection
 * resolution: the name-reference stage over the non-code files, the binding table,
 * then `resolveAnnotationInjections`.
 *
 * @param {{
 *   java?: Record<string, string|string[]>, files?: Record<string, string|string[]>, catalog?: object,
 *   mutations?: object, declaredTypes?: string[], nullIds?: string[],
 * }} spec `declaredTypes` are classes the repository declares that no Java file here does (a Kotlin class);
 *   `nullIds` are `path#Name` of classes whose node id is shared with another declaration (so names no node).
 */
function project({ java = {}, files = {}, catalog = CATALOG, mutations, declaredTypes = [], nullIds = [] } = {}) {
  const texts = {};
  const javaRows = [];
  for (const [path, source] of Object.entries(java)) {
    texts[path] = lines(source);
    const file = { path, language: 'java', fileCategory: 'code' };
    const extracted = analyzeFileWithOutcomes(registry, file, texts[path]);
    expect(extracted.structureOutcome).toBe('succeeded');
    const split = texts[path].split('\n');
    javaRows.push(buildResult(file, split.length, split.filter((l) => l.trim()).length, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome));
  }
  for (const [path, source] of Object.entries(files)) texts[path] = lines(source);

  const classIds = new Map(javaRows.map((row) => [
    row.path,
    (row.classes ?? []).map((cls) => (nullIds.includes(`${row.path}#${cls.name}`) ? null : `class:${row.path}#${cls.name}`)),
  ]));
  const javaTypes = javaRows.flatMap((row) => (row.classes ?? []).map((cls, i) => ({ fqn: cls.qualifiedName, path: row.path, id: classIds.get(row.path)[i] })));
  const manifestPaths = Object.keys(texts);
  const scan = {
    files: manifestPaths.map((path) => ({ path, language: java[path] === undefined ? (LANGUAGE_OF_EXTENSION[extname(path).slice(1)] ?? 'unknown') : 'java' })),
  };
  const sites = collectNameReferenceSites({ scan, catalog, readFile: (path) => texts[path] });
  const none = { isType: () => false };
  // The types Java files declare by their `package` and file name: what the mentions stage reads, an annotation type included.
  const declared = new Set(declaredTypes);
  for (const path of Object.keys(java)) {
    const pkg = /^package\s+([\w.]+);/m.exec(texts[path])?.[1];
    if (pkg !== undefined) declared.add(`${pkg}.${path.slice(path.lastIndexOf('/') + 1).replace(/\.java$/, '')}`);
  }
  const table = buildNameBindingTable({
    sites, catalog, manifestPaths, javaRows, classIds, javaTypes, otherJvm: none, mutations,
    declaredJavaTypes: { isType: (pkg, name) => declared.has(`${pkg}.${name}`) },
  });
  const result = resolveAnnotationInjections({ javaRows, catalog, table, classIds, mutations });
  const label = (id) => id.replace(/^class:/, '');
  return {
    texts, sites, table, javaRows, classIds, result, catalog,
    rows: javaRows,
    edges: result.edges,
    links: result.edges.map((e) => `${label(e.source)} -> ${label(e.target)}`).sort(),
    edge: (from, to) => result.edges.find((e) => label(e.source) === from && label(e.target) === to),
    buckets: result.coverage.buckets,
    coverage: result.coverage,
    gaps: (kind) => result.gaps.filter((g) => g.kind === kind),
    samples: (kind) => result.gaps.filter((g) => g.kind === kind).map((g) => g.sample),
    /** The XML stage over the same sites and table. */
    xml: () => resolveXmlInjections({ sites, catalog, table, manifestPaths, mutations }),
  };
}

/** A coverage of the XML source with every bucket zero: a run whose descriptors held no site. */
function emptyXml() {
  return { siteCount: 0, buckets: Object.fromEntries(XML_INJECTION_BUCKETS.map((bucket) => [bucket, 0])) };
}

/** One unit `app`, one Spring context holding the definitions, and what else the spec adds. */
const spring = ({ java = {}, definitions = [], files = {}, ...rest }) => project({ java, files: { 'app/pom.xml': POM, [CTX]: ctx(definitions), ...files }, ...rest });

/** Every bucket of the version-3 table is a bucket of the run: a catalog that also has a bundle binder in the Spring namespace. */
const BUNDLE_CATALOG = (() => {
  const catalog = JSON.parse(JSON.stringify(CATALOG));
  catalog.xmlBinders.push({
    id: 'spring-xml-bundle', namespace: 'spring', basis: 'A test binder: a bundle element of a beans root registers a resource bundle under its id.',
    root: 'beans', rootNamespace: ['http://www.springframework.org/schema/beans', null], element: 'bundle', parent: 'beans',
    name: { attribute: ['id'] }, target: { kind: 'bundle', attribute: 'basename' }, namespacedNames: false, missingTarget: 'unknown',
  });
  return parseNameBindingCatalog(catalog);
})();

// ---------------------------------------------------------------------------
// What Core hands over, and what the stage knows
// ---------------------------------------------------------------------------

describe('the member annotations Core emits (design D1) and the rules the stage owns (D3, D4)', () => {
  it('reads the structure row of a real Java source: member annotations by source order, with the argument lines and the owner', () => {
    const p = spring({
      java: {
        [SRC('OrderService')]: [
          'package com.acme;', // 1
          RESOURCE, // 2
          QUALIFIER, // 3
          '', // 4
          'public class OrderService {', // 5
          '  @Resource', // 6
          '  private OrderDao orderDao;', // 7
          '  @Resource(name = "x")', // 8
          '  public void setOrderDao(OrderDao d) {}', // 9
          '  public OrderService(@Qualifier("mainDs") DataSource ds) {}', // 10
          '  static class Inner { @Resource(name = "y") Object z; }', // 11
          '}',
        ],
      },
    });
    expect(p.rows[0].memberAnnotations).toEqual([
      { name: 'Resource', line: 6, arguments: [], on: 'field', owner: 'OrderService', nested: false, member: { name: 'orderDao', line: 7 } },
      { name: 'Resource', line: 8, arguments: [{ key: 'name', value: 'x', line: 8 }], on: 'method', owner: 'OrderService', nested: false, member: { name: 'setOrderDao', line: 9 } },
      {
        name: 'Qualifier', line: 10, arguments: [{ key: 'value', value: 'mainDs', line: 10 }], on: 'parameter', owner: 'OrderService', nested: false,
        member: { name: 'OrderService', line: 10 }, parameter: { name: 'ds', index: 0, line: 10 },
      },
      { name: 'Resource', line: 11, arguments: [{ key: 'name', value: 'y', line: 11 }], on: 'field', owner: 'OrderService', nested: true, member: { name: 'z', line: 11 } },
    ]);
    // all four are sites of the catalog's, whatever fate they have
    expect(p.coverage.siteCount).toBe(4);
    expect(p.coverage.nested).toBe(1);
  });

  it('has the fifteen buckets in the order of the design, and a gap kind only for the buckets that are gaps', () => {
    expect([...ANNOTATION_INJECTION_BUCKETS]).toEqual([
      'position', 'nonLiteral', 'unnamed', 'expression', 'consumerUnindexed', 'unmanaged',
      'edge', 'bundle', 'external', 'unindexed', 'unknown', 'ambiguous', 'byType', 'elsewhere', 'unbound',
    ]);
    expect(Object.isFrozen(ANNOTATION_INJECTION_BUCKETS)).toBe(true);
    expect(ANNOTATION_INJECTION_GAP_KINDS).toEqual({
      nonLiteral: 'injection-target-unresolved',
      expression: 'injection-target-unresolved',
      unindexed: 'injection-target-unresolved',
      unknown: 'injection-target-unresolved',
      ambiguous: 'injection-ambiguous',
      elsewhere: 'injection-elsewhere',
      unbound: 'injection-unbound',
      consumerUnindexed: 'injection-consumer-unresolved',
    });
    for (const bucket of ['position', 'unnamed', 'unmanaged', 'edge', 'bundle', 'external', 'byType']) expect(ANNOTATION_INJECTION_GAP_KINDS[bucket], bucket).toBeUndefined();
    // the same five kinds as the XML source records
    expect(new Set(Object.values(ANNOTATION_INJECTION_GAP_KINDS))).toEqual(new Set(Object.values(XML_INJECTION_GAP_KINDS)));
  });

  it('has a rule for each default-name rule the catalog loader accepts, and no other', () => {
    expect(Object.keys(MEMBER_NAME_RULES).sort()).toEqual([...MEMBER_DEFAULT_NAME_RULES].sort());
  });

  it('names a field by itself, a setter by its property and any other method by itself (member-java-beans)', () => {
    const rule = MEMBER_NAME_RULES['member-java-beans'];
    const use = (on, name) => ({ on, member: { name, line: 1 } });
    expect(rule(use('field', 'orderDao'))).toBe('orderDao');
    expect(rule(use('method', 'setOrderDao'))).toBe('orderDao');
    // the Introspector's rule: two capitals stay as they are
    expect(rule(use('method', 'setURL'))).toBe('URL');
    expect(rule(use('method', 'setX'))).toBe('x');
    // `set` and a name that merely starts with it that is not longer than three letters
    expect(rule(use('method', 'set'))).toBe('set');
    expect(rule(use('method', 'init'))).toBe('init');
    for (const kind of ['parameter', 'constructor', 'component']) expect(rule(use(kind, 'orderDao')), kind).toBeUndefined();
  });

  it('names a field by itself, a setter by its property with a lower case first letter, and gives no other method a name (member-seam)', () => {
    const rule = MEMBER_NAME_RULES['member-seam'];
    const use = (on, name) => ({ on, member: { name, line: 1 } });
    expect(rule(use('field', 'cart'))).toBe('cart');
    expect(rule(use('method', 'setCart'))).toBe('cart');
    // no Introspector rule here: the first letter alone
    expect(rule(use('method', 'setURL'))).toBe('uRL');
    expect(rule(use('method', 'getCart'))).toBeUndefined();
    expect(rule(use('method', 'set'))).toBeUndefined();
    for (const kind of ['parameter', 'constructor', 'component']) expect(rule(use(kind, 'cart')), kind).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Requirement: Java annotation injection sites - one test per scenario
// ---------------------------------------------------------------------------

describe('a site that is an injects edge (spec: Java annotation injection sites)', () => {
  const ORDER_SERVICE = SRC('OrderService');
  const JDBC_DAO = '  <bean id="orderDao" class="com.acme.JdbcOrderDao"/>';

  it('draws consumer -> target for a Qualifier on a field, citing the line of the name, the managing @Service and the bean (spec: Qualifier on a field)', () => {
    const p = spring({
      java: {
        ...javaOf('JdbcOrderDao'),
        [ORDER_SERVICE]: [
          'package com.acme;', // 1
          SERVICE, // 2
          'import org.springframework.beans.factory.annotation.Autowired;', // 3
          QUALIFIER, // 4
          '', // 5
          '@Service', // 6
          'public class OrderService {', // 7
          '  @Autowired @Qualifier("orderDao") private OrderDao dao;', // 8
          '}',
        ],
      },
      definitions: [JDBC_DAO],
    });
    expect(p.links).toEqual([`${CLASS('OrderService')} -> ${CLASS('JdbcOrderDao')}`]);
    expect(p.edges[0]).toMatchObject({ type: 'injects', direction: 'forward', weight: 0.5, provenance: 'extracted' });
    expect(p.edges[0].evidence).toEqual([{
      file: ORDER_SERVICE, line: 8, source: 'lexical', token: 'orderDao', name: 'orderDao', site: 'spring-qualifier',
      consumer: { bindings: [{ file: ORDER_SERVICE, line: 6, binder: 'spring-annotation-stereotype' }] },
      bindings: [{ file: CTX, line: 2, binder: 'spring-xml-bean' }],
    }]);
    // the Autowired next to it is no site: it is no annotation of the catalog's
    expect(p.coverage.siteCount).toBe(1);
    expect(p.buckets.edge).toBe(1);
    expect(p.result.gaps).toEqual([]);
  });

  it('Qualifier on a constructor parameter: the line of the parameter is the evidence (spec)', () => {
    const REPORT = SRC('Report');
    const p = spring({
      java: {
        ...javaOf('MainDs'),
        [REPORT]: [
          'package com.acme;', // 1
          'import org.springframework.stereotype.Component;', // 2
          QUALIFIER, // 3
          '', // 4
          '@Component', // 5
          'public class Report {', // 6
          '  public Report(@Qualifier("mainDs") DataSource ds) {', // 7
          '  }', // 8
          '}',
        ],
      },
      definitions: ['  <bean id="mainDs" class="com.acme.MainDs"/>'],
    });
    expect(p.links).toEqual([`${CLASS('Report')} -> ${CLASS('MainDs')}`]);
    expect(p.edges[0].evidence).toEqual([{
      file: REPORT, line: 7, source: 'lexical', token: 'mainDs', name: 'mainDs', site: 'spring-qualifier',
      consumer: { bindings: [{ file: REPORT, line: 5, binder: 'spring-annotation-stereotype' }] },
      bindings: [{ file: CTX, line: 2, binder: 'spring-xml-bean' }],
    }]);
  });

  it('Resource on a field with no name: the field name is the name, written at the field (spec: default name)', () => {
    const p = spring({
      java: {
        ...javaOf('JdbcOrderDao'),
        [ORDER_SERVICE]: [
          'package com.acme;', // 1
          RESOURCE, // 2
          SERVICE, // 3
          '', // 4
          '@Service', // 5
          'public class OrderService {', // 6
          '  @Resource', // 7
          '  private OrderDao orderDao;', // 8
          '}',
        ],
      },
      definitions: [JDBC_DAO],
    });
    expect(p.links).toEqual([`${CLASS('OrderService')} -> ${CLASS('JdbcOrderDao')}`]);
    expect(p.edges[0].evidence).toEqual([{
      file: ORDER_SERVICE, line: 8, source: 'lexical', token: 'orderDao', name: 'orderDao', site: 'spring-resource',
      consumer: { bindings: [{ file: ORDER_SERVICE, line: 5, binder: 'spring-annotation-stereotype' }] },
      bindings: [{ file: CTX, line: 2, binder: 'spring-xml-bean' }],
    }]);
  });

  it('Resource on a setter with no name: the name is the property, the token is the method as it is written (spec: setter default)', () => {
    const p = spring({
      java: {
        ...javaOf('JdbcOrderDao'),
        [ORDER_SERVICE]: [
          'package com.acme;', // 1
          RESOURCE, // 2
          SERVICE, // 3
          '', // 4
          '@Service', // 5
          'public class OrderService {', // 6
          '  @Resource', // 7
          '  public void setOrderDao(OrderDao d) {}', // 8
          '}',
        ],
      },
      definitions: [JDBC_DAO],
    });
    expect(p.links).toEqual([`${CLASS('OrderService')} -> ${CLASS('JdbcOrderDao')}`]);
    // name and token differ: the line writes setOrderDao, the lookup is orderDao
    expect(p.edges[0].evidence).toEqual([expect.objectContaining({ line: 8, token: 'setOrderDao', name: 'orderDao', site: 'spring-resource' })]);
    expect(p.texts[ORDER_SERVICE].split('\n')[7]).toContain('setOrderDao');
  });

  it('Resource with no name and no bean of that name: injected by type, no edge and no gap (spec: falls back to the type)', () => {
    const p = spring({
      java: { [ORDER_SERVICE]: javaSource('com.acme', [RESOURCE, SERVICE], ['@Service', 'public class OrderService {', '  @Resource private Clock clock;', '}']) },
    });
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ byType: 1, unbound: 0, elsewhere: 0 });
    expect(p.result.gaps).toEqual([]);
  });

  it('Resource on a class no Spring binder manages: the name is not looked up, no edge, no gap (spec: unmanaged)', () => {
    const p = spring({
      java: {
        ...javaOf('JdbcOrderDao'),
        [SRC('OrderBean')]: javaSource('com.acme', ['import javax.ejb.Stateless;', RESOURCE, 'import javax.sql.DataSource;'], [
          '@Stateless', 'public class OrderBean {', '  @Resource(name = "jdbc/orders") private DataSource ds;', '}',
        ]),
      },
      definitions: [JDBC_DAO],
    });
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ unmanaged: 1, edge: 0 });
    expect(p.result.gaps).toEqual([]);
  });

  it('a class managed by the XML of another unit: the name is looked up in that unit, the managing binding is cited (spec)', () => {
    const SERVICE_FILE = SRC('OrderService', 'com.acme', 'core');
    const p = project({
      java: {
        ...Object.fromEntries([classFile('JdbcOrderDao', 'com.acme', 'web')]),
        [SERVICE_FILE]: javaSource('com.acme', [RESOURCE], ['public class OrderService {', '  @Resource(name = "orderDao") private OrderDao dao;', '}']),
      },
      files: {
        'core/pom.xml': POM,
        'web/pom.xml': POM,
        'web/WEB-INF/ctx.xml': ctx('  <bean id="orderService" class="com.acme.OrderService"/>', '  <bean id="orderDao" class="com.acme.JdbcOrderDao"/>'),
      },
    });
    expect(p.links).toEqual([`${CLASS('OrderService', 'core')} -> ${CLASS('JdbcOrderDao', 'web')}`]);
    expect(p.edges[0].evidence).toEqual([{
      file: SERVICE_FILE, line: 5, source: 'lexical', token: 'orderDao', name: 'orderDao', site: 'spring-resource',
      consumer: { bindings: [{ file: 'web/WEB-INF/ctx.xml', line: 2, binder: 'spring-xml-bean' }] },
      bindings: [{ file: 'web/WEB-INF/ctx.xml', line: 3, binder: 'spring-xml-bean' }],
    }]);
  });

  it('Qualifier on a method is not read: "position", no edge and no gap (spec)', () => {
    const p = spring({
      java: {
        ...javaOf('JdbcOrderDao'),
        [SRC('Config')]: javaSource('com.acme', [QUALIFIER, SERVICE, 'import org.springframework.context.annotation.Bean;'], [
          '@Service', 'public class Config {', '  @Bean @Qualifier("orderDao") public DataSource ds() { return null; }', '}',
        ]),
      },
      definitions: [JDBC_DAO],
    });
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ position: 1, edge: 0 });
    expect(p.result.gaps).toEqual([]);
  });

  it('Seam: a field with no name is the component of that name, written at the field (spec: Seam default name)', () => {
    const CHECKOUT = SRC('Checkout');
    const p = project({
      java: {
        [CHECKOUT]: [
          'package com.acme;', // 1
          SEAM_NAME, // 2
          SEAM_IN, // 3
          '', // 4
          '@Name("checkout")', // 5
          'public class Checkout {', // 6
          '  @In', // 7
          '  private Cart cart;', // 8
          '}',
        ],
        [SRC('Cart')]: javaSource('com.acme', [SEAM_NAME], ['@Name("cart")', 'public class Cart {}']),
      },
      files: { 'app/pom.xml': POM },
    });
    expect(p.links).toEqual([`${CLASS('Checkout')} -> ${CLASS('Cart')}`]);
    expect(p.edges[0].evidence).toEqual([{
      file: CHECKOUT, line: 8, source: 'lexical', token: 'cart', name: 'cart', site: 'seam-in',
      consumer: { bindings: [{ file: CHECKOUT, line: 5, binder: 'seam-annotation-name' }] },
      bindings: [{ file: SRC('Cart'), line: 4, binder: 'seam-annotation-name' }],
    }]);
  });

  it('Seam: a name only a JSF managed bean declares is "elsewhere", the sample naming its unit and namespace (spec)', () => {
    const p = project({
      java: { [SRC('Checkout')]: javaSource('com.acme', [SEAM_NAME, SEAM_IN], ['@Name("checkout")', 'public class Checkout {', '  @In private Prefs prefs;', '}']), ...javaOf('Prefs') },
      files: { 'app/pom.xml': POM, 'app/WEB-INF/faces-config.xml': FACES('prefs', 'com.acme.Prefs') },
    });
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ elsewhere: 1, edge: 0 });
    expect(p.samples('injection-elsewhere')).toEqual([`${at(p, SRC('Checkout'), '@In private Prefs')} prefs -> [app [el]]`]);
  });

  it('Seam: an EL expression is no name: "expression", a gap of unresolved target (spec)', () => {
    const p = project({
      java: { [SRC('Checkout')]: javaSource('com.acme', [SEAM_NAME, SEAM_IN], ['@Name("checkout")', 'public class Checkout {', '  @In("#{preferences.get(\'wiki\')}") private Object pref;', '}']) },
      files: { 'app/pom.xml': POM },
    });
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ expression: 1 });
    expect(p.samples('injection-target-unresolved')).toEqual([`${SRC('Checkout')}:7 #{preferences.get('wiki')} -> [expression: starts with "#{"]`]);
  });

  it('Seam: a built-in component no binding declares is "unbound", a gap (spec)', () => {
    const p = project({
      java: { [SRC('Checkout')]: javaSource('com.acme', [SEAM_NAME, SEAM_IN], ['@Name("checkout")', 'public class Checkout {', '  @In private FacesMessages facesMessages;', '}']) },
      files: { 'app/pom.xml': POM },
    });
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ unbound: 1 });
    expect(p.samples('injection-unbound')).toEqual([`${SRC('Checkout')}:7 facesMessages -> []`]);
  });

  it('EJB: a beanName names the @Stateless bean of that name, by its simple name when it writes none (spec)', () => {
    const CALLER = SRC('Caller');
    const p = project({
      java: {
        [CALLER]: [
          'package com.acme;', // 1
          'import javax.ejb.EJB;', // 2
          '', // 3
          'public class Caller {', // 4
          '  @EJB(beanName = "OrderBean") private Orders orders;', // 5
          '}',
        ],
        [SRC('OrderBean')]: javaSource('com.acme', ['import javax.ejb.Stateless;'], ['@Stateless', 'public class OrderBean {}']),
      },
      files: { 'app/pom.xml': POM },
    });
    expect(p.links).toEqual([`${CLASS('Caller')} -> ${CLASS('OrderBean')}`]);
    // an EJB site asks for no managed consumer: the evidence has no managing binding
    expect(p.edges[0].evidence).toEqual([{
      file: CALLER, line: 5, source: 'lexical', token: 'OrderBean', name: 'OrderBean', site: 'ejb-bean-name',
      consumer: { bindings: [] },
      bindings: [{ file: SRC('OrderBean'), line: 4, binder: 'ejb-annotation-session' }],
    }]);
  });

  it('EJB without a beanName is injected by type: "unnamed", no edge and no gap (spec)', () => {
    const p = project({
      java: { [SRC('Caller')]: javaSource('com.acme', ['import javax.ejb.EJB;'], ['public class Caller {', '  @EJB private Orders orders;', '}']) },
      files: { 'app/pom.xml': POM },
    });
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ unnamed: 1 });
    expect(p.result.gaps).toEqual([]);
  });

  it('a name that is not a string literal is "nonLiteral", a gap of unresolved target (spec)', () => {
    const p = spring({
      java: {
        ...javaOf('JdbcOrderDao'),
        [SRC('OrderService')]: javaSource('com.acme', [QUALIFIER, SERVICE], ['@Service', 'public class OrderService {', '  @Qualifier(Beans.ORDER_DAO) private OrderDao dao;', '}']),
      },
      definitions: [JDBC_DAO],
    });
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ nonLiteral: 1 });
    expect(p.samples('injection-target-unresolved')).toEqual([`${SRC('OrderService')}:7 @Qualifier(value) -> [nonLiteral: the value argument is not a string literal]`]);
  });

  it('a same-package annotation of the name Resource is not a site, and is in no bucket and no count (spec)', () => {
    const p = spring({
      java: {
        ...javaOf('JdbcOrderDao'),
        [SRC('Resource')]: 'package com.acme;\n\npublic @interface Resource {\n  String name() default "";\n}\n',
        [SRC('OrderService')]: javaSource('com.acme', [SERVICE], ['@Service', 'public class OrderService {', '  @Resource(name = "orderDao") private OrderDao dao;', '}']),
      },
      definitions: [JDBC_DAO],
    });
    expect(p.links).toEqual([]);
    expect(p.coverage.siteCount).toBe(0);
    expect(Object.values(p.buckets).reduce((a, b) => a + b, 0)).toBe(0);
    // confirmed to be somebody else's, not "could not tell"
    expect(p.coverage.unconfirmed).toEqual({});
  });

  it('a site in a nested type belongs to the top-level type, and is counted as nested (spec)', () => {
    const OUTER = SRC('Outer');
    const p = spring({
      java: {
        ...javaOf('JdbcOrderDao'),
        [OUTER]: [
          'package com.acme;', // 1
          RESOURCE, // 2
          SERVICE, // 3
          '', // 4
          '@Service', // 5
          'public class Outer {', // 6
          '  static class Inner {', // 7
          '    @Resource(name = "orderDao")', // 8
          '    Object dao;', // 9
          '  }', // 10
          '}',
        ],
      },
      definitions: [JDBC_DAO],
    });
    expect(p.links).toEqual([`${CLASS('Outer')} -> ${CLASS('JdbcOrderDao')}`]);
    expect(p.edges[0].evidence[0]).toMatchObject({ file: OUTER, line: 8, token: 'orderDao' });
    expect(p.coverage.nested).toBe(1);
    expect(p.coverage.siteCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The name (design D4)
// ---------------------------------------------------------------------------

describe('the name a site writes (design D4)', () => {
  const DAO = '  <bean id="orderDao" class="com.acme.JdbcOrderDao"/>';
  const SERVICE_FILE = SRC('OrderService');
  /** A managed Spring class whose body is the given lines, over a bean `orderDao`. */
  const service = (body, { imports = [RESOURCE, QUALIFIER, SERVICE], ...rest } = {}) => spring({
    java: { ...javaOf('JdbcOrderDao'), [SERVICE_FILE]: javaSource('com.acme', imports, ['@Service', 'public class OrderService {', ...[body].flat(), '}']) },
    definitions: [DAO],
    ...rest,
  });
  /** A Seam component of the name checkout whose body is the given lines. */
  const seam = (body, extra = {}) => project({
    java: { [SRC('Checkout')]: javaSource('com.acme', [SEAM_NAME, SEAM_IN], ['@Name("checkout")', 'public class Checkout {', ...[body].flat(), '}']), ...javaOf('Cart'), ...extra.java },
    files: { 'app/pom.xml': POM, ...extra.files },
  });

  it('takes a name that is written over the name of the member, and cites the line of the value', () => {
    const p = service(['  @Resource(name = "orderDao")', '  private Object somethingElse;']);
    expect(p.links).toEqual([`${CLASS('OrderService')} -> ${CLASS('JdbcOrderDao')}`]);
    expect(p.edges[0].evidence[0]).toMatchObject({ line: 8, token: 'orderDao', name: 'orderDao' });
  });

  it('cites the line of the value when the annotation is written over several lines, not the line of the annotation or of the member', () => {
    const p = service(['  @Resource(', '      name = "orderDao")', '  private OrderDao dao;']);
    const row = p.javaRows.find((r) => r.path === SERVICE_FILE);
    expect(row.memberAnnotations[0]).toMatchObject({ line: 8, arguments: [{ key: 'name', value: 'orderDao', line: 9 }], member: { name: 'dao', line: 10 } });
    expect(p.edges[0].evidence[0]).toMatchObject({ line: 9, token: 'orderDao', name: 'orderDao' });
  });

  it('cites the line of the member for a default name, though the annotation is written above it', () => {
    const p = service(['  @Resource', '  @Deprecated', '  private OrderDao orderDao;']);
    expect(p.edges[0].evidence[0]).toMatchObject({ line: 10, token: 'orderDao', name: 'orderDao' });
  });

  it('takes the default name for a name written as the empty string, as if it were not written', () => {
    const p = service('  @Resource(name = "") private OrderDao orderDao;');
    expect(p.links).toEqual([`${CLASS('OrderService')} -> ${CLASS('JdbcOrderDao')}`]);
    // the default name is written at the member: the token is the member's, not the empty string
    expect(p.edges[0].evidence[0]).toMatchObject({ token: 'orderDao', name: 'orderDao', site: 'spring-resource' });
    const seamed = seam('  @In("") private Cart cart;');
    expect(seamed.buckets).toMatchObject({ edge: 0, unbound: 1 });
    expect(seamed.samples('injection-unbound')).toEqual([`${SRC('Checkout')}:7 cart -> []`]);
  });

  it('has no default name for an empty name where the site has no default: "unnamed"', () => {
    const p = service('  @Qualifier("") private OrderDao dao;');
    expect(p.buckets).toMatchObject({ unnamed: 1, edge: 0 });
    expect(p.result.gaps).toEqual([]);
  });

  it('is "unnamed" for a Qualifier with no value, on a field and on a parameter: injected by type, no gap', () => {
    const p = service(['  @Qualifier private OrderDao a;', '  public void init(@Qualifier OrderDao b) {}']);
    expect(p.buckets).toMatchObject({ unnamed: 2 });
    expect(p.result.gaps).toEqual([]);
  });

  it('gives a method that is no setter no default name under member-seam: "unnamed", where a setter has one', () => {
    const p = seam(['  @In public Cart getCart() { return null; }', '  @In public void setCart(Cart c) {}']);
    // getCart: nothing to name it by; setCart: the property cart, which no component of this project is called
    expect(p.buckets).toMatchObject({ unnamed: 1, unbound: 1 });
    expect(p.samples('injection-unbound')).toEqual([`${SRC('Checkout')}:8 cart -> []`]);
    expect(p.coverage.sites['seam-in']).toBe(2);
  });

  it('names a method that is no setter by itself under member-java-beans: a default name that may fall back to the type', () => {
    const p = service('  @Resource public void init() {}');
    expect(p.buckets).toMatchObject({ byType: 1, unnamed: 0 });
  });

  it('gives a setter the property name of the Introspector under Spring and the lower-cased first letter under Seam', () => {
    const spring = service('  @Resource public void setURL(Object u) {}');
    expect(spring.buckets).toMatchObject({ byType: 1 });
    const seamed = seam('  @In public void setURL(Object u) {}');
    expect(seamed.samples('injection-unbound')).toEqual([`${SRC('Checkout')}:7 uRL -> []`]);
  });

  it('has no default name on a constructor, a parameter or a record component: "position" where the site does not read them, "unnamed" where it does', () => {
    const p = service([
      '  @Resource public OrderService() {}', // constructor: Resource reads fields and methods only
      '  public void a(@Resource OrderDao x) {}', // parameter: likewise
      '  public void b(@Qualifier OrderDao y) {}', // parameter, which Qualifier reads, with no name
    ]);
    expect(p.buckets).toMatchObject({ position: 2, unnamed: 1 });
    const record = project({
      java: { [SRC('Pair')]: javaSource('com.acme', [QUALIFIER], ['public record Pair(@Qualifier OrderDao left, @Qualifier("x") OrderDao right) {}']) },
      files: { 'app/pom.xml': POM },
    });
    // a record component is a member kind no shipped site reads
    expect(record.buckets).toMatchObject({ position: 2 });
  });

  it('reads one site per declarator of a field, each named by its own declarator', () => {
    const p = seam('  @In private Cart cart, other;', { java: { ...javaOf('Cart'), [SRC('Cart')]: javaSource('com.acme', [SEAM_NAME], ['@Name("cart")', 'public class Cart {}']) } });
    expect(p.coverage.sites['seam-in']).toBe(2);
    expect(p.buckets).toMatchObject({ edge: 1, unbound: 1 });
    expect(p.samples('injection-unbound')).toEqual([`${SRC('Checkout')}:7 other -> []`]);
  });

  it('reads the first of the name arguments the site lists that is written, whatever order they are written in, and no other argument', () => {
    const catalog = JSON.parse(JSON.stringify(CATALOG));
    catalog.annotationInjections.find((family) => family.id === 'spring-annotation-injection').sites.find((site) => site.id === 'spring-resource').nameArguments = ['name', 'value'];
    const read = (body) => service(body, { catalog: parseNameBindingCatalog(catalog) });
    expect(read('  @Resource(value = "nowhere", name = "orderDao") private Object a;').links).toEqual([`${CLASS('OrderService')} -> ${CLASS('JdbcOrderDao')}`]);
    expect(read('  @Resource(value = "orderDao") private Object a;').links).toEqual([`${CLASS('OrderService')} -> ${CLASS('JdbcOrderDao')}`]);
    // an argument the site does not list is not a name
    expect(service('  @Resource(lookup = "nowhere", name = "orderDao") private Object a;').links).toHaveLength(1);
    expect(service('  @Resource(lookup = "orderDao") private OrderDao nowhere;').buckets).toMatchObject({ byType: 1, edge: 0 });
  });

  it('is "nonLiteral" for the first name argument that is written when it is not a string literal, though a later one is a literal', () => {
    const catalog = JSON.parse(JSON.stringify(CATALOG));
    catalog.annotationInjections.find((family) => family.id === 'spring-annotation-injection').sites.find((site) => site.id === 'spring-resource').nameArguments = ['name', 'value'];
    const p = service('  @Resource(name = NAMES.ORDER, value = "orderDao") private Object a;', { catalog: parseNameBindingCatalog(catalog) });
    expect(p.buckets).toMatchObject({ nonLiteral: 1, edge: 0 });
  });

  it('takes an annotation written with its qualified name, no import needed, and reads it the same', () => {
    const p = spring({
      java: {
        ...javaOf('JdbcOrderDao'),
        [SERVICE_FILE]: javaSource('com.acme', [SERVICE], ['@Service', 'public class OrderService {', '  @javax.annotation.Resource(name = "orderDao") private Object a;', '}']),
      },
      definitions: [DAO],
    });
    expect(p.links).toEqual([`${CLASS('OrderService')} -> ${CLASS('JdbcOrderDao')}`]);
    expect(p.edges[0].evidence[0]).toMatchObject({ token: 'orderDao', site: 'spring-resource' });
  });

  it('takes the jakarta spelling of an annotation as the same site as the javax one', () => {
    const p = service('  @Resource(name = "orderDao") private Object a;', { imports: ['import jakarta.annotation.Resource;', SERVICE] });
    expect(p.links).toEqual([`${CLASS('OrderService')} -> ${CLASS('JdbcOrderDao')}`]);
  });
});

// ---------------------------------------------------------------------------
// The consumer and where the name is looked for (design D5)
// ---------------------------------------------------------------------------

describe('the consumer and the scope of a name (design D5)', () => {
  const DAO = '  <bean id="orderDao" class="com.acme.JdbcOrderDao"/>';
  const OWNER = SRC('Owner');
  const owner = (annotations, body = '  @Resource(name = "orderDao") private Object dao;', imports = [RESOURCE, SERVICE]) =>
    javaSource('com.acme', imports, [...[annotations].flat(), 'public class Owner {', body, '}']);

  it('is managed by a bean definition of an XML context alone: the bean line is the managing binding', () => {
    const p = spring({ java: { ...javaOf('JdbcOrderDao'), [OWNER]: owner([]) }, definitions: [DAO, '  <bean id="owner" class="com.acme.Owner"/>'] });
    expect(p.links).toEqual([`${CLASS('Owner')} -> ${CLASS('JdbcOrderDao')}`]);
    expect(p.edges[0].evidence[0].consumer).toEqual({ bindings: [{ file: CTX, line: 3, binder: 'spring-xml-bean' }] });
  });

  it('is managed by a Configuration, a RestController or a ControllerAdvice class as by a Service: each is a component of Spring', () => {
    const stereotypes = [
      ['org.springframework.context.annotation.Configuration', '@Configuration', 'spring-annotation-stereotype'],
      ['org.springframework.web.bind.annotation.RestController', '@RestController', 'spring-annotation-stereotype'],
      ['org.springframework.web.bind.annotation.ControllerAdvice', '@ControllerAdvice', 'spring-annotation-advice'],
    ];
    for (const [fqn, written, binder] of stereotypes) {
      const p = spring({ java: { ...javaOf('JdbcOrderDao'), [OWNER]: owner([written], '  @Resource(name = "orderDao") private Object dao;', [RESOURCE, `import ${fqn};`]) }, definitions: [DAO] });
      expect(p.links, fqn).toEqual([`${CLASS('Owner')} -> ${CLASS('JdbcOrderDao')}`]);
      expect(p.edges[0].evidence[0].consumer, fqn).toEqual({ bindings: [{ file: OWNER, line: 5, binder }] });
    }
  });

  it('resolves the Qualifier field of a ControllerAdvice class: its value is no bean name, but it is a Spring component (spec)', () => {
    const FAULTS = SRC('Faults');
    const p = spring({
      java: {
        ...javaOf('JdbcOrderDao'),
        [FAULTS]: [
          'package com.acme;', // 1
          'import org.springframework.web.bind.annotation.ControllerAdvice;', // 2
          QUALIFIER, // 3
          '', // 4
          '@ControllerAdvice("com.acme.web")', // 5
          'public class Faults {', // 6
          '  @Qualifier("orderDao") private OrderDao dao;', // 7
          '}',
        ],
      },
      definitions: [DAO],
    });
    expect(p.links).toEqual([`${CLASS('Faults')} -> ${CLASS('JdbcOrderDao')}`]);
    expect(p.edges[0].evidence).toEqual([{
      file: FAULTS, line: 7, source: 'lexical', token: 'orderDao', name: 'orderDao', site: 'spring-qualifier',
      consumer: { bindings: [{ file: FAULTS, line: 5, binder: 'spring-annotation-advice' }] },
      bindings: [{ file: CTX, line: 2, binder: 'spring-xml-bean' }],
    }]);
    // the package list is not a name: nothing is bound as com.acme.web, and the site's name is the member's own
    expect(p.table.named('com.acme.web')).toEqual([]);
  });

  it('cites every binding that manages the consumer, by file, line and binder: the XML bean and the stereotype of one class', () => {
    const p = spring({ java: { ...javaOf('JdbcOrderDao'), [OWNER]: owner(['@Service']) }, definitions: [DAO, '  <bean id="owner" class="com.acme.Owner"/>'] });
    expect(p.edges[0].evidence[0].consumer.bindings).toEqual([
      { file: CTX, line: 3, binder: 'spring-xml-bean' },
      { file: OWNER, line: 5, binder: 'spring-annotation-stereotype' },
    ]);
  });

  it('is not managed by the binding of a binder the family does not list: a Named of CDI or a component of Seam is no Spring bean', () => {
    const p = spring({
      java: { ...javaOf('JdbcOrderDao'), [OWNER]: owner(['@Named("owner")'], '  @Resource(name = "orderDao") private Object dao;', [RESOURCE, 'import javax.inject.Named;']) },
      definitions: [DAO],
    });
    expect(p.buckets).toMatchObject({ unmanaged: 1, edge: 0 });
  });

  it('is not managed through a bean built by a factory method, whose class is the factory\'s, nor through a class name several declarations carry', () => {
    const factory = spring({ java: { ...javaOf('JdbcOrderDao'), [OWNER]: owner([]) }, definitions: [DAO, '  <bean id="owner" class="com.acme.Owner" factory-method="make"/>'] });
    expect(factory.buckets).toMatchObject({ unmanaged: 1 });
    const twice = spring({
      java: { ...javaOf('JdbcOrderDao'), 'app/src/one/Owner.java': owner([]), 'app/src/two/Owner.java': owner([]) },
      definitions: [DAO, '  <bean id="owner" class="com.acme.Owner"/>'],
    });
    expect(twice.buckets).toMatchObject({ unmanaged: 2, edge: 0 });
  });

  it('is managed through a bean that only names a parent, which inherits the class: the inheriting definition is a binding of the class too', () => {
    const p = spring({
      java: { ...javaOf('JdbcOrderDao'), [OWNER]: owner([]) },
      definitions: [DAO, '  <bean id="base" class="com.acme.Owner" abstract="true"/>', '  <bean id="owner" parent="base"/>'],
    });
    expect(p.edges[0].evidence[0].consumer.bindings).toEqual([
      { file: CTX, line: 3, binder: 'spring-xml-bean' },
      { file: CTX, line: 4, binder: 'spring-xml-bean' },
    ]);
  });

  it('looks the name up in the unit that manages the class, not the unit of the class file: a bean of that name in the class\'s own unit is not taken (spec)', () => {
    const p = project({
      java: {
        [SRC('OrderService', 'com.acme', 'core')]: javaSource('com.acme', [RESOURCE], ['public class OrderService {', '  @Resource(name = "orderDao") private Object dao;', '}']),
        ...Object.fromEntries([classFile('WebDao', 'com.acme', 'web'), classFile('CoreDao', 'com.acme', 'core')]),
      },
      files: {
        'core/pom.xml': POM,
        'core/ctx.xml': ctx('  <bean id="orderDao" class="com.acme.CoreDao"/>'),
        'web/pom.xml': POM,
        'web/ctx.xml': ctx('  <bean id="orderService" class="com.acme.OrderService"/>', '  <bean id="orderDao" class="com.acme.WebDao"/>'),
      },
    });
    expect(p.links).toEqual([`${CLASS('OrderService', 'core')} -> ${CLASS('WebDao', 'web')}`]);
  });

  describe('a class several units manage', () => {
    const units = (aDao, bDao) => project({
      java: {
        [SRC('Owner', 'com.acme', 'a')]: owner([]),
        ...Object.fromEntries([classFile('DaoA', 'com.acme', 'a'), classFile('DaoB', 'com.acme', 'b')]),
      },
      files: {
        'a/pom.xml': POM, 'a/ctx.xml': ctx('  <bean id="owner" class="com.acme.Owner"/>', ...aDao),
        'b/pom.xml': POM, 'b/ctx.xml': ctx('  <bean id="owner2" class="com.acme.Owner"/>', ...bDao),
      },
    });

    it('is an ambiguity when the units disagree on a name: no unit is preferred, the sample names both classes', () => {
      const p = units(['  <bean id="orderDao" class="com.acme.DaoA"/>'], ['  <bean id="orderDao" class="com.acme.DaoB"/>']);
      expect(p.links).toEqual([]);
      expect(p.buckets).toMatchObject({ ambiguous: 1, edge: 0 });
      expect(p.samples('injection-ambiguous')).toEqual([`${at(p, SRC('Owner', 'com.acme', 'a'), '"orderDao"')} orderDao -> [${CLASS('DaoA', 'a')}, ${CLASS('DaoB', 'b')}]`]);
    });

    it('is an edge when they agree, the evidence citing the binding in each unit and the managing binding in each', () => {
      const p = units(['  <bean id="orderDao" class="com.acme.DaoA"/>'], ['  <bean id="orderDao" class="com.acme.DaoA"/>']);
      expect(p.links).toEqual([`${CLASS('Owner', 'a')} -> ${CLASS('DaoA', 'a')}`]);
      expect(p.edges[0].evidence[0].bindings).toEqual([{ file: 'a/ctx.xml', line: 3, binder: 'spring-xml-bean' }, { file: 'b/ctx.xml', line: 3, binder: 'spring-xml-bean' }]);
      expect(p.edges[0].evidence[0].consumer.bindings).toEqual([{ file: 'a/ctx.xml', line: 2, binder: 'spring-xml-bean' }, { file: 'b/ctx.xml', line: 2, binder: 'spring-xml-bean' }]);
    });

    it('is an edge when only one of them has the name', () => {
      const p = units(['  <bean id="orderDao" class="com.acme.DaoA"/>'], []);
      expect(p.links).toEqual([`${CLASS('Owner', 'a')} -> ${CLASS('DaoA', 'a')}`]);
    });

    it('is "elsewhere" when none of them has the name but a third unit does: the managing units are the whole of the scope', () => {
      const p = project({
        java: { [SRC('Owner', 'com.acme', 'a')]: owner([]), ...Object.fromEntries([classFile('DaoC', 'com.acme', 'c')]) },
        files: {
          'a/pom.xml': POM, 'a/ctx.xml': ctx('  <bean id="owner" class="com.acme.Owner"/>'),
          'c/pom.xml': POM, 'c/ctx.xml': ctx('  <bean id="orderDao" class="com.acme.DaoC"/>'),
        },
      });
      expect(p.buckets).toMatchObject({ elsewhere: 1, edge: 0 });
      expect(p.samples('injection-elsewhere')).toEqual([`${at(p, SRC('Owner', 'com.acme', 'a'), '"orderDao"')} orderDao -> [c [spring]]`]);
    });
  });

  it('looks an EJB name up in the unit of the class file, which no binding manages: a bean of another unit is "elsewhere"', () => {
    const p = project({
      java: {
        [SRC('Caller', 'com.acme', 'a')]: javaSource('com.acme', ['import javax.ejb.EJB;'], ['public class Caller {', '  @EJB(beanName = "OrderBean") private Object orders;', '}']),
        [SRC('OrderBean', 'com.acme', 'b')]: javaSource('com.acme', ['import javax.ejb.Stateless;'], ['@Stateless', 'public class OrderBean {}']),
      },
      files: { 'a/pom.xml': POM, 'b/pom.xml': POM },
    });
    expect(p.links).toEqual([]);
    expect(p.samples('injection-elsewhere')).toEqual([`${SRC('Caller', 'com.acme', 'a')}:5 OrderBean -> [b [ejb]]`]);
  });

  it('looks only in the namespace of the family: a name another framework declares is "elsewhere", the sample naming the namespace', () => {
    const p = spring({
      java: {
        ...javaOf('JdbcOrderDao'),
        [OWNER]: owner(['@Service']),
        [SRC('CdiDao')]: javaSource('com.acme', ['import javax.inject.Named;'], ['@Named("orderDao")', 'public class CdiDao {}']),
      },
      definitions: [],
    });
    expect(p.buckets).toMatchObject({ elsewhere: 1, edge: 0 });
    expect(p.samples('injection-elsewhere')).toEqual([`${at(p, OWNER, '"orderDao"')} orderDao -> [app [el]]`]);
  });

  it('limits a Seam name to the binders of the family: a CDI Named of the same namespace is not a Seam component', () => {
    const p = project({
      java: {
        [SRC('Checkout')]: javaSource('com.acme', [SEAM_NAME, SEAM_IN], ['@Name("checkout")', 'public class Checkout {', '  @In private Cart cart;', '}']),
        [SRC('Cart')]: javaSource('com.acme', ['import javax.inject.Named;'], ['@Named("cart")', 'public class Cart {}']),
      },
      files: { 'app/pom.xml': POM },
    });
    expect(p.links).toEqual([]);
    expect(p.samples('injection-elsewhere')).toEqual([`${SRC('Checkout')}:7 cart -> [app [el]]`]);
  });

  it('takes a Seam component of a components.xml that names its class, and is managed by one: the descriptor lines are the bindings', () => {
    const p = project({
      java: { [SRC('Checkout')]: javaSource('com.acme', [SEAM_IN], ['public class Checkout {', '  @In private Cart cart;', '}']), ...javaOf('Cart') },
      files: {
        'app/pom.xml': POM,
        'app/components.xml': [`<components xmlns="${SEAM_COMPONENTS}">`, '  <component name="checkout" class="com.acme.Checkout"/>', '  <component name="cart" class="com.acme.Cart"/>', '</components>'],
      },
    });
    expect(p.links).toEqual([`${CLASS('Checkout')} -> ${CLASS('Cart')}`]);
    expect(p.edges[0].evidence[0]).toMatchObject({
      consumer: { bindings: [{ file: 'app/components.xml', line: 2, binder: 'seam-xml-component' }] },
      bindings: [{ file: 'app/components.xml', line: 3, binder: 'seam-xml-component' }],
    });
  });

  it('is "consumerUnindexed" for a member of an annotation type, which has no class node, and for a class whose node id several declarations share', () => {
    const interfaceMember = project({
      java: { [SRC('Marked')]: javaSource('com.acme', [RESOURCE], ['public @interface Marked {', '  @Resource(name = "orderDao") String X = "";', '}']) },
      files: { 'app/pom.xml': POM },
    });
    expect(interfaceMember.buckets).toMatchObject({ consumerUnindexed: 1 });
    expect(interfaceMember.samples('injection-consumer-unresolved')).toEqual([`${SRC('Marked')}:5 orderDao -> [consumerUnindexed: no class node for Marked]`]);

    const collided = spring({ java: { ...javaOf('JdbcOrderDao'), [OWNER]: owner(['@Service']) }, definitions: [DAO], nullIds: [`${OWNER}#Owner`] });
    expect(collided.links).toEqual([]);
    expect(collided.buckets).toMatchObject({ consumerUnindexed: 1, unmanaged: 0 });
  });

  it('decides the consumer before the management and the name before the consumer: the order of the buckets is the order of the design (D6)', () => {
    // position before everything: a parameter is a position the Resource site does not read, though its (absent) name is...
    const position = spring({ java: { [OWNER]: owner([], '  public void a(@Resource(name = Names.X) Object x) {}') } });
    expect(position.buckets).toMatchObject({ position: 1, nonLiteral: 0 });
    // an expression before the consumer is looked for
    const expression = project({
      java: { [SRC('Marked')]: javaSource('com.acme', [SEAM_IN], ['public @interface Marked {', '  @In("#{a.b}") String X = "";', '}']) },
      files: { 'app/pom.xml': POM },
    });
    expect(expression.buckets).toMatchObject({ expression: 1, consumerUnindexed: 0 });
    // an unindexed consumer before the management
    const unindexed = spring({ java: { [OWNER]: owner([]) }, nullIds: [`${OWNER}#Owner`] });
    expect(unindexed.buckets).toMatchObject({ consumerUnindexed: 1, unmanaged: 0 });
    // the management before the name: an unmanaged class with a name no binding declares is not "unbound"
    const unmanaged = spring({ java: { [OWNER]: owner([], '  @Resource(name = "nowhere") private Object x;') } });
    expect(unmanaged.buckets).toMatchObject({ unmanaged: 1, unbound: 0 });
    expect(unmanaged.result.gaps).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The target (design D6)
// ---------------------------------------------------------------------------

describe('where a name comes to (design D6)', () => {
  const OWNER = SRC('Owner');
  /** A class managed by an XML bean `owner`, with one `@Resource(name = ...)` field per name. */
  const injecting = (names, { definitions = [], files = {}, java = {}, ...rest } = {}) => spring({
    java: {
      [OWNER]: javaSource('com.acme', [RESOURCE], ['public class Owner {', ...names.map((name, i) => `  @Resource(name = "${name}") private Object f${i};`), '}']),
      ...java,
    },
    definitions: ['  <bean id="owner" class="com.acme.Owner"/>', ...definitions],
    files,
    ...rest,
  });

  it('is "external", no gap, for a bean whose class is not the repository\'s', () => {
    const p = injecting(['dataSource'], { definitions: ['  <bean id="dataSource" class="org.apache.commons.dbcp.BasicDataSource"/>'] });
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ external: 1 });
    expect(p.result.gaps).toEqual([]);
  });

  it('is "unindexed" for a class the repository declares and has no node for, the sample naming the type', () => {
    const p = injecting(['marker'], { definitions: ['  <bean id="marker" class="com.acme.Marker"/>'], declaredTypes: ['com.acme.Marker'] });
    expect(p.buckets).toMatchObject({ unindexed: 1 });
    expect(p.samples('injection-target-unresolved')).toEqual([`${OWNER}:5 marker -> [com.acme.Marker]`]);
  });

  it('is "unknown" for a factory-method bean, though it writes a class: the sample names the attribute', () => {
    const p = injecting(['svc'], { definitions: ['  <bean id="svc" class="com.acme.Locator" factory-method="make"/>'], java: javaOf('Locator') });
    expect(p.buckets).toMatchObject({ unknown: 1 });
    expect(p.samples('injection-target-unresolved')).toEqual([`${OWNER}:5 svc -> [${CTX}:3 (factory-method)]`]);
  });

  it('is "unknown" for a parent-only bean whose parent is in no file of the unit, the sample giving the reason', () => {
    const p = injecting(['child'], { definitions: ['  <bean id="child" parent="missing"/>'] });
    expect(p.buckets).toMatchObject({ unknown: 1 });
    expect(p.samples('injection-target-unresolved')).toEqual([`${OWNER}:5 child -> [${CTX}:3 (missing has no binding in this unit)]`]);
  });

  it('is "ambiguous" for a name two declarations of the unit give different classes, the sample naming both and no one preferred', () => {
    const p = injecting(['mailer'], {
      definitions: ['  <bean id="mailer" class="com.acme.SmtpMailer"/>'],
      files: { 'app/WEB-INF/test.xml': ctx('  <bean id="mailer" class="com.acme.FakeMailer"/>') },
      java: javaOf('SmtpMailer', 'FakeMailer'),
    });
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ ambiguous: 1 });
    expect(p.samples('injection-ambiguous')).toEqual([`${OWNER}:5 mailer -> [${CLASS('FakeMailer')}, ${CLASS('SmtpMailer')}]`]);
  });

  it('is an edge when a name declared twice names the same class: the declarations agree, and both are cited', () => {
    const p = injecting(['mailer'], {
      definitions: ['  <bean id="mailer" class="com.acme.SmtpMailer"/>'],
      files: { 'app/WEB-INF/test.xml': ctx('  <bean id="mailer" class="com.acme.SmtpMailer"/>') },
      java: javaOf('SmtpMailer'),
    });
    expect(p.links).toEqual([`${CLASS('Owner')} -> ${CLASS('SmtpMailer')}`]);
    expect(p.edges[0].evidence[0].bindings.map((b) => b.file)).toEqual([CTX, 'app/WEB-INF/test.xml']);
  });

  it('is "bundle", no gap, for a name that is a resource bundle of the family\'s namespace', () => {
    const p = injecting(['messages'], { definitions: ['  <bundle id="messages" basename="com.acme.Messages"/>'], catalog: BUNDLE_CATALOG });
    expect(p.buckets).toMatchObject({ bundle: 1, edge: 0 });
    expect(p.result.gaps).toEqual([]);
  });

  it('follows an alias to the bean it names, and cites both', () => {
    const p = injecting(['orders'], { definitions: ['  <bean id="orderDao" class="com.acme.JdbcOrderDao"/>', '  <alias name="orderDao" alias="orders"/>'], java: javaOf('JdbcOrderDao') });
    expect(p.links).toEqual([`${CLASS('Owner')} -> ${CLASS('JdbcOrderDao')}`]);
    expect(p.edges[0].evidence[0].bindings).toEqual([{ file: CTX, line: 3, binder: 'spring-xml-bean' }, { file: CTX, line: 4, binder: 'spring-xml-alias' }]);
  });

  it('takes a target an annotation declares, citing the annotation line as the binding', () => {
    const p = injecting(['orderDao'], {
      java: { [SRC('JdbcOrderDao')]: javaSource('com.acme', ['import org.springframework.stereotype.Repository;'], ['@Repository("orderDao")', 'public class JdbcOrderDao {}']) },
    });
    expect(p.links).toEqual([`${CLASS('Owner')} -> ${CLASS('JdbcOrderDao')}`]);
    expect(p.edges[0].evidence[0].bindings).toEqual([{ file: SRC('JdbcOrderDao'), line: 4, binder: 'spring-annotation-stereotype' }]);
  });

  it('is "unbound" for a name no binding anywhere declares, a gap with no candidates; and for an explicit name there is no fall back to the type', () => {
    const p = injecting(['clock']);
    expect(p.buckets).toMatchObject({ unbound: 1, byType: 0 });
    expect(p.samples('injection-unbound')).toEqual([`${OWNER}:5 clock -> []`]);
  });

  it('is "byType", not "elsewhere", for a default name that only another unit declares: the fall back is decided first', () => {
    const p = project({
      java: { [SRC('Owner', 'com.acme', 'a')]: javaSource('com.acme', [RESOURCE], ['public class Owner {', '  @Resource private Object clock;', '}']), ...Object.fromEntries([classFile('Clock', 'com.acme', 'b')]) },
      files: {
        'a/pom.xml': POM, 'a/ctx.xml': ctx('  <bean id="owner" class="com.acme.Owner"/>'),
        'b/pom.xml': POM, 'b/ctx.xml': ctx('  <bean id="clock" class="com.acme.Clock"/>'),
      },
    });
    expect(p.buckets).toMatchObject({ byType: 1, elsewhere: 0 });
    expect(p.result.gaps).toEqual([]);
    // an explicit name of the same is "elsewhere"
    const explicit = project({
      java: { [SRC('Owner', 'com.acme', 'a')]: javaSource('com.acme', [RESOURCE], ['public class Owner {', '  @Resource(name = "clock") private Object c;', '}']), ...Object.fromEntries([classFile('Clock', 'com.acme', 'b')]) },
      files: {
        'a/pom.xml': POM, 'a/ctx.xml': ctx('  <bean id="owner" class="com.acme.Owner"/>'),
        'b/pom.xml': POM, 'b/ctx.xml': ctx('  <bean id="clock" class="com.acme.Clock"/>'),
      },
    });
    expect(explicit.buckets).toMatchObject({ elsewhere: 1, byType: 0 });
  });

  it('is "byType" only for a site that falls back: a default name that no Seam binding declares is "unbound"', () => {
    const p = project({
      java: { [SRC('Checkout')]: javaSource('com.acme', [SEAM_NAME, SEAM_IN], ['@Name("checkout")', 'public class Checkout {', '  @In private Object cart;', '}']) },
      files: { 'app/pom.xml': POM },
    });
    expect(p.buckets).toMatchObject({ unbound: 1, byType: 0 });
  });
});

// ---------------------------------------------------------------------------
// Edges and evidence (design D7)
// ---------------------------------------------------------------------------

describe('the edges and their evidence (design D7)', () => {
  const OWNER = SRC('Owner');
  const owned = (body, definitions = ['  <bean id="dao" class="com.acme.Dao"/>'], java = javaOf('Dao')) => spring({
    java: { [OWNER]: javaSource('com.acme', [RESOURCE], ['public class Owner {', ...[body].flat(), '}']), ...java },
    definitions: ['  <bean id="owner" class="com.acme.Owner"/>', ...definitions],
  });

  it('draws one edge for a consumer class and a target class, with the evidence of every site, sorted and without repeats', () => {
    const p = owned([
      '  @Resource(name = "zeta") private Object a; @Resource(name = "alpha") private Object b;',
      '  @Resource(name = "dao") private Object c;',
      '  @Resource(name = "dao") private Object d; @Resource(name = "dao") private Object e;',
    ], ['  <bean id="dao" class="com.acme.Dao"/>', '  <alias name="dao" alias="zeta"/>', '  <alias name="dao" alias="alpha"/>']);
    expect(p.edges).toHaveLength(1);
    // line 5 writes zeta first and alpha second: the evidence is in the order of the tokens; line 7 writes dao twice: once
    expect(p.edges[0].evidence.map((e) => [e.line, e.token, e.name, e.site])).toEqual([
      [5, 'alpha', 'alpha', 'spring-resource'], [5, 'zeta', 'zeta', 'spring-resource'], [6, 'dao', 'dao', 'spring-resource'], [7, 'dao', 'dao', 'spring-resource'],
    ]);
    // every site is counted all the same: the buckets count sites, not evidence
    expect(p.buckets.edge).toBe(5);
    expect(p.coverage.siteCount).toBe(5);
  });

  it('draws a self-loop when a class is injected with a bean of its own class', () => {
    const p = spring({
      java: { [OWNER]: javaSource('com.acme', [RESOURCE], ['public class Owner {', '  @Resource(name = "other") private Owner next;', '}']) },
      definitions: ['  <bean id="owner" class="com.acme.Owner"/>', '  <bean id="other" class="com.acme.Owner"/>'],
    });
    expect(p.links).toEqual([`${CLASS('Owner')} -> ${CLASS('Owner')}`]);
    expect(p.edges[0].source).toBe(p.edges[0].target);
    expect(p.edges[0].evidence[0].consumer.bindings).toEqual([{ file: CTX, line: 2, binder: 'spring-xml-bean' }, { file: CTX, line: 3, binder: 'spring-xml-bean' }]);
  });

  it('draws one edge per target for one consumer, each with its own evidence', () => {
    const p = owned(['  @Resource(name = "dao") private Object a;', '  @Resource(name = "audit") private Object b;'], ['  <bean id="dao" class="com.acme.Dao"/>', '  <bean id="audit" class="com.acme.Audit"/>'], javaOf('Dao', 'Audit'));
    expect(p.links).toEqual([`${CLASS('Owner')} -> ${CLASS('Audit')}`, `${CLASS('Owner')} -> ${CLASS('Dao')}`]);
    expect(p.edge(CLASS('Owner'), CLASS('Audit')).evidence).toHaveLength(1);
  });

  it('has the same evidence for the same sites whatever order the files are read in: the edges and the order of their evidence are fixed', () => {
    const body = ['  @Resource(name = "dao") private Object a;', '  @Resource private Object dao;'];
    const a = owned(body);
    const b = project({
      java: { ...javaOf('Dao'), [OWNER]: javaSource('com.acme', [RESOURCE], ['public class Owner {', ...body, '}']) },
      files: { [CTX]: ctx('  <bean id="owner" class="com.acme.Owner"/>', '  <bean id="dao" class="com.acme.Dao"/>'), 'app/pom.xml': POM },
    });
    expect(b.edges).toEqual(a.edges);
  });

  it('is checkable: the line of every evidence holds its token, and the line of each binding holds the binding\'s name or an annotation (spec)', () => {
    const p = spring({
      java: {
        ...javaOf('JdbcOrderDao', 'Target'),
        [OWNER]: javaSource('com.acme', [RESOURCE, QUALIFIER, SERVICE], [
          '@Service',
          'public class Owner {',
          '  @Qualifier("aliased") private Object a;',
          '  @Resource public void setJdbcOrderDao(Object d) {}',
          '  @Resource(name = "annotated") private Object c;',
          '  @Resource',
          '  private Object target;',
          '}',
        ]),
        [SRC('Annotated')]: javaSource('com.acme', ['import org.springframework.stereotype.Component;'], ['@Component("annotated")', 'public class Annotated {}']),
      },
      definitions: [
        '  <bean id="jdbcOrderDao" class="com.acme.JdbcOrderDao"/>',
        '  <bean id="target" class="com.acme.Target"/>',
        '  <alias name="target" alias="aliased"/>',
      ],
    });
    expect(p.edges.length).toBe(3);
    const check = (result) => {
      for (const edge of result.edges) {
        for (const evidence of edge.evidence) {
          expect(p.texts[evidence.file].split('\n')[evidence.line - 1]).toContain(evidence.token);
          for (const binding of [...evidence.bindings, ...evidence.consumer.bindings]) {
            const text = p.texts[binding.file].split('\n')[binding.line - 1];
            const declared = p.table.bindings.find((b) => b.file === binding.file && b.line === binding.line && b.binder === binding.binder);
            expect(declared, JSON.stringify(binding)).toBeDefined();
            if (binding.binder.includes('annotation')) expect(text).toContain('@');
            else expect(text).toContain(declared.name);
          }
        }
      }
    };
    check(p.result);
    // a default name's token is the member's spelling: that is what makes the setter line checkable
    expect(p.edge(CLASS('Owner'), CLASS('JdbcOrderDao')).evidence[0]).toMatchObject({ token: 'setJdbcOrderDao', name: 'jdbcOrderDao' });
    // the same check refuses evidence whose token is the lookup name where the line writes the setter
    const forged = resolveAnnotationInjections({ javaRows: p.javaRows, catalog: CATALOG, table: p.table, classIds: p.classIds, mutations: { annotationTokenIsName: true } });
    expect(() => check(forged)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Merging the two sources (design D7)
// ---------------------------------------------------------------------------

describe('the merge of the injects edges of the XML source and the annotation source (design D7)', () => {
  const ev = (file, line, token, site, extra = {}) => ({ file, line, source: 'lexical', token, site, ...extra });
  const edge = (source, target, evidence) => ({ source, target, type: 'injects', direction: 'forward', weight: 0.5, evidence, provenance: 'extracted' });

  it('makes one edge of a pair both sources draw, with the evidence of both, XML lines and Java lines (spec: two sources make one edge)', () => {
    const SERVICE_FILE = SRC('OrderService');
    const p = spring({
      java: {
        ...javaOf('JdbcOrderDao'),
        [SERVICE_FILE]: [
          'package com.acme;', // 1
          RESOURCE, // 2
          '', // 3
          'public class OrderService {', // 4
          '  @Resource(name = "orderDao") private OrderDao second;', // 5
          '}',
        ],
      },
      definitions: [
        '  <bean id="orderService" class="com.acme.OrderService"><property name="dao" ref="orderDao"/></bean>',
        '  <bean id="orderDao" class="com.acme.JdbcOrderDao"/>',
      ],
    });
    const xml = p.xml();
    expect(xml.edges).toHaveLength(1);
    expect(p.edges).toHaveLength(1);
    expect(p.links).toEqual([`${CLASS('OrderService')} -> ${CLASS('JdbcOrderDao')}`]);

    const merged = mergeInjectsEdges({ xmlEdges: xml.edges, annotationEdges: p.edges });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ source: xml.edges[0].source, target: xml.edges[0].target, type: 'injects', direction: 'forward', weight: 0.5, provenance: 'extracted' });
    // sorted by file: the descriptor before the sources of the Java
    expect(merged[0].evidence.map((e) => [e.file, e.line, e.token, e.site])).toEqual([
      [CTX, 2, 'orderDao', 'spring-property-ref'],
      [SERVICE_FILE, 5, 'orderDao', 'spring-resource'],
    ]);
    // each evidence keeps the shape its source gave it
    expect(merged[0].evidence[0]).toHaveProperty('consumer.line', 2);
    expect(merged[0].evidence[1].consumer).toEqual({ bindings: [{ file: CTX, line: 2, binder: 'spring-xml-bean' }] });
  });

  it('passes the edges of disjoint pairs through, each as it was, the XML source\'s first', () => {
    const xmlEdges = [edge('a', 'b', [ev('x.xml', 2, 'b', 'spring-property-ref')])];
    const annotationEdges = [edge('a', 'c', [ev('A.java', 5, 'c', 'spring-resource')]), edge('d', 'b', [ev('D.java', 7, 'b', 'spring-qualifier')])];
    const merged = mergeInjectsEdges({ xmlEdges, annotationEdges });
    expect(merged.map((e) => [e.source, e.target])).toEqual([['a', 'b'], ['a', 'c'], ['d', 'b']]);
    expect(merged).toEqual([...xmlEdges, ...annotationEdges]);
  });

  it('returns the evidence of a merged pair sorted by file, line, token and site, without repeats', () => {
    const xmlEdges = [edge('a', 'b', [ev('z.xml', 9, 'b', 's'), ev('m.xml', 3, 'b', 's'), ev('m.xml', 3, 'b', 's')])];
    const annotationEdges = [edge('a', 'b', [
      ev('Z.java', 1, 'x', 's'), ev('A.java', 8, 'q', 's'), ev('A.java', 8, 'q', 's'), ev('A.java', 8, 'p', 'u'), ev('A.java', 8, 'p', 't'), ev('A.java', 2, 'q', 's'),
    ])];
    const [merged] = mergeInjectsEdges({ xmlEdges, annotationEdges });
    expect(merged.evidence.map((e) => [e.file, e.line, e.token, e.site])).toEqual([
      ['A.java', 2, 'q', 's'], ['A.java', 8, 'p', 't'], ['A.java', 8, 'p', 'u'], ['A.java', 8, 'q', 's'], ['Z.java', 1, 'x', 's'], ['m.xml', 3, 'b', 's'], ['z.xml', 9, 'b', 's'],
    ]);
  });

  it('sorts and deduplicates the evidence of an edge that only one source drew, and merges two edges of one pair within a source', () => {
    const [only] = mergeInjectsEdges({ xmlEdges: [], annotationEdges: [edge('a', 'b', [ev('B.java', 2, 'b', 's'), ev('A.java', 2, 'b', 's'), ev('A.java', 2, 'b', 's')])] });
    expect(only.evidence.map((e) => e.file)).toEqual(['A.java', 'B.java']);
    expect(mergeInjectsEdges({ xmlEdges: [edge('a', 'b', [ev('x.xml', 2, 'b', 's')]), edge('a', 'b', [ev('y.xml', 2, 'b', 's')])], annotationEdges: [] })[0].evidence).toHaveLength(2);
  });

  it('is empty for no edges, and does not change the edges it is given', () => {
    expect(mergeInjectsEdges({ xmlEdges: [], annotationEdges: [] })).toEqual([]);
    const xmlEdges = [edge('a', 'b', [ev('x.xml', 2, 'b', 's')])];
    const annotationEdges = [edge('a', 'b', [ev('A.java', 5, 'b', 's')])];
    const before = structuredClone([xmlEdges, annotationEdges]);
    const [merged] = mergeInjectsEdges({ xmlEdges, annotationEdges });
    expect([xmlEdges, annotationEdges]).toEqual(before);
    merged.evidence.push('changed');
    expect(xmlEdges[0].evidence).toHaveLength(1);
  });

  it('refuses an edge that is not an injects edge: a pair of another type is not a pair to merge', () => {
    expect(() => mergeInjectsEdges({ xmlEdges: [{ ...edge('a', 'b', []), type: 'references' }], annotationEdges: [] })).toThrow(/"references"/);
  });
});

// ---------------------------------------------------------------------------
// Annotation identity (design D2)
// ---------------------------------------------------------------------------

describe('which annotations are sites (design D2)', () => {
  const FIELD = (annotation) => `  ${annotation} private Object x;`;
  const classOf = (name, imports, field, extra = {}) => project({
    java: { [SRC(name)]: javaSource('com.acme', imports, [`public class ${name} {`, field, '}']), ...extra.java },
    files: { 'app/pom.xml': POM },
  });

  it('confirms an annotation through exactly one on-demand import that provides it', () => {
    const p = classOf('A', ['import javax.annotation.*;'], FIELD('@Resource(name = "x")'));
    expect(p.coverage.siteCount).toBe(1);
    expect(p.coverage.unconfirmed).toEqual({});
  });

  it('counts by spelling a name no import can tell: two on-demand imports that both provide it, none, and two single-type imports', () => {
    const p = project({
      java: {
        [SRC('A')]: javaSource('com.acme', ['import javax.annotation.*;', 'import jakarta.annotation.*;'], ['public class A {', FIELD('@Resource(name = "x")'), '}']),
        [SRC('B')]: javaSource('com.acme', [], ['public class B {', '  @In private Object cart, other;', '}']),
        [SRC('C')]: javaSource('com.acme', ['import javax.ejb.EJB;', 'import jakarta.ejb.EJB;'], ['public class C {', FIELD('@EJB(beanName = "x")'), '}']),
      },
      files: { 'app/pom.xml': POM },
    });
    // not sites: in no bucket and no count, but counted, by spelling, one per record, in the order of the spellings
    expect(p.coverage.siteCount).toBe(0);
    expect(p.coverage.unconfirmed).toEqual({ EJB: 1, In: 2, Resource: 1 });
    expect(Object.keys(p.coverage.unconfirmed)).toEqual(['EJB', 'In', 'Resource']);
    expect(Object.values(p.buckets).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('does not count what is confirmed to be another type, or what has no site name at all: another package\'s Resource, a qualified name outside the catalog, Autowired', () => {
    const p = project({
      java: {
        [SRC('D')]: javaSource('com.acme', ['import org.springframework.core.io.Resource;'], ['public class D {', FIELD('@Resource(name = "x")'), '}']),
        [SRC('E')]: javaSource('com.acme', [], ['public class E {', FIELD('@Autowired @org.acme.Qualifier("x")'), '}']),
        // a type of the same package shadows what an on-demand import would have provided
        [SRC('Qualifier')]: 'package com.acme;\n\npublic @interface Qualifier {\n}\n',
        [SRC('F')]: javaSource('com.acme', ['import org.springframework.beans.factory.annotation.*;'], ['public class F {', FIELD('@Qualifier("x")'), '}']),
      },
      files: { 'app/pom.xml': POM },
    });
    expect(p.coverage.siteCount).toBe(0);
    expect(p.coverage.unconfirmed).toEqual({});
  });

  it('reads the single-type import before the type of the same package, as Java does: an imported Qualifier is a site though com.acme has a Qualifier too', () => {
    const p = project({
      java: {
        [SRC('Qualifier')]: 'package com.acme;\n\npublic @interface Qualifier {\n}\n',
        [SRC('F')]: javaSource('com.acme', [QUALIFIER], ['public class F {', FIELD('@Qualifier("x")'), '}']),
      },
      files: { 'app/pom.xml': POM },
    });
    expect(p.coverage.siteCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Coverage and gaps (design D8)
// ---------------------------------------------------------------------------

describe('what a run says (design D8)', () => {
  const SERVICE_FILE = SRC('Service');
  /** One site of each of the fifteen buckets. */
  const everyBucket = () => project({
    catalog: BUNDLE_CATALOG,
    declaredTypes: ['com.acme.Marker'],
    java: {
      ...javaOf('OrderDaoImpl', 'Locator', 'SmtpMailer', 'FakeMailer'),
      [SERVICE_FILE]: javaSource('com.acme', [RESOURCE, QUALIFIER], [
        'public class Service {',
        '  @Resource(name = "orderDao") private Object edge;',
        '  @Resource(name = "dataSource") private Object external;',
        '  @Resource(name = "marker") private Object unindexed;',
        '  @Resource(name = "svc") private Object unknown;',
        '  @Resource(name = "mailer") private Object ambiguous;',
        '  @Resource(name = "nowhere") private Object unbound;',
        '  @Resource(name = "foreign") private Object elsewhere;',
        '  @Resource private Clock clock;',
        '  @Resource(name = "messages") private Object bundle;',
        '  @Qualifier(Beans.X) private Object nonLiteral;',
        '  @Qualifier("x") public void position() {}',
        '  @Qualifier private Object unnamed;',
        '}',
      ]),
      [SRC('Seamy')]: javaSource('com.acme', [SEAM_NAME, SEAM_IN], ['@Name("seamy")', 'public class Seamy {', '  @In("#{x}") private Object expression;', '}']),
      [SRC('Plain')]: javaSource('com.acme', [RESOURCE], ['public class Plain {', '  @Resource(name = "orderDao") private Object unmanaged;', '}']),
      [SRC('Marked')]: javaSource('com.acme', [RESOURCE], ['public @interface Marked {', '  @Resource(name = "orderDao") String X = "";', '}']),
    },
    files: {
      'app/pom.xml': POM,
      [CTX]: ctx(
        '  <bean id="service" class="com.acme.Service"/>',
        '  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>',
        '  <bean id="dataSource" class="org.apache.commons.dbcp.BasicDataSource"/>',
        '  <bean id="marker" class="com.acme.Marker"/>',
        '  <bean id="svc" class="com.acme.Locator" factory-method="make"/>',
        '  <bean id="mailer" class="com.acme.SmtpMailer"/>',
        '  <bundle id="messages" basename="com.acme.Messages"/>',
      ),
      'app/WEB-INF/test.xml': ctx('  <bean id="mailer" class="com.acme.FakeMailer"/>'),
      'other/pom.xml': POM,
      'other/ctx.xml': ctx('  <bean id="foreign" class="com.acme.OrderDaoImpl"/>'),
    },
  });

  it('puts every site in exactly one bucket, and the fifteen add up to the site count (conservation)', () => {
    const { coverage } = everyBucket();
    expect(Object.keys(coverage.buckets)).toEqual([...ANNOTATION_INJECTION_BUCKETS]);
    expect(coverage.siteCount).toBe(15);
    expect(Object.values(coverage.buckets).reduce((a, b) => a + b, 0)).toBe(coverage.siteCount);
    expect(coverage.buckets).toEqual(Object.fromEntries(ANNOTATION_INJECTION_BUCKETS.map((bucket) => [bucket, 1])));
  });

  it('records the five gap kinds, each with the count of its buckets, scope java, and nothing for the buckets that are no gap', () => {
    const p = everyBucket();
    const counts = {};
    for (const gap of p.result.gaps) counts[gap.kind] = (counts[gap.kind] ?? 0) + 1;
    expect(counts).toEqual({
      'injection-target-unresolved': 4, // nonLiteral, expression, unindexed, unknown
      'injection-ambiguous': 1,
      'injection-elsewhere': 1,
      'injection-unbound': 1,
      'injection-consumer-unresolved': 1, // consumerUnindexed
    });
    expect(new Set(p.result.gaps.map((g) => g.scope))).toEqual(new Set(['java']));
    expect(() => assertInjectionConservation(emptyXml(), counts, p.coverage)).not.toThrow();
  });

  it('writes each sample as file:line, the name and the candidates or the reason', () => {
    const p = everyBucket();
    expect(p.samples('injection-target-unresolved').sort()).toEqual([
      `${at(p, SERVICE_FILE, 'Beans.X')} @Qualifier(value) -> [nonLiteral: the value argument is not a string literal]`,
      `${at(p, SRC('Seamy'), '#{x}')} #{x} -> [expression: starts with "#{"]`,
      `${at(p, SERVICE_FILE, '"marker"')} marker -> [com.acme.Marker]`,
      `${at(p, SERVICE_FILE, '"svc"')} svc -> [${CTX}:6 (factory-method)]`,
    ].sort());
    expect(p.samples('injection-ambiguous')).toEqual([`${at(p, SERVICE_FILE, '"mailer"')} mailer -> [${CLASS('FakeMailer')}, ${CLASS('SmtpMailer')}]`]);
    expect(p.samples('injection-elsewhere')).toEqual([`${at(p, SERVICE_FILE, '"foreign"')} foreign -> [other [spring]]`]);
    expect(p.samples('injection-unbound')).toEqual([`${at(p, SERVICE_FILE, '"nowhere"')} nowhere -> []`]);
    expect(p.samples('injection-consumer-unresolved')).toEqual([`${at(p, SRC('Marked'), '"orderDao"')} orderDao -> [consumerUnindexed: no class node for Marked]`]);
  });

  it('counts the sites by id, every id of every family listed with zeros', () => {
    const { coverage } = everyBucket();
    expect(Object.keys(coverage.sites)).toEqual(CATALOG.annotationInjections.flatMap((f) => f.sites.map((s) => s.id)));
    expect(coverage.sites).toEqual({ 'spring-qualifier': 3, 'spring-resource': 11, 'seam-in': 1, 'ejb-bean-name': 0 });
    expect(Object.values(coverage.sites).reduce((a, b) => a + b, 0)).toBe(coverage.siteCount);
  });

  it('carries the status, the count of sites in nested types and the unconfirmed spellings', () => {
    const p = everyBucket();
    expect(p.coverage).toMatchObject({ status: 'ran', nested: 0, unconfirmed: {} });
    expect(Object.keys(p.coverage).sort()).toEqual(['buckets', 'nested', 'siteCount', 'sites', 'status', 'unconfirmed']);
    const nested = project({
      java: { [SRC('Outer')]: javaSource('com.acme', [RESOURCE], ['public class Outer {', '  @Resource(name = "x") Object a;', '  class Inner {', '    @Resource(name = "y") Object b;', '    Runnable r = new Runnable() { @Resource(name = "z") Object c; public void run() {} };', '  }', '}']) },
      files: { 'app/pom.xml': POM },
    });
    // the member of the top-level type is not nested; the member of a nested and of an anonymous type are
    expect(nested.coverage).toMatchObject({ siteCount: 3, nested: 2 });
  });

  it('is a run with nothing to resolve when no source holds a site: all zeros, still ran, and every site id listed', () => {
    const p = project({ java: javaOf('Plain'), files: { 'app/pom.xml': POM } });
    expect(p.result).toEqual({
      edges: [],
      gaps: [],
      coverage: {
        status: 'ran',
        sites: { 'spring-qualifier': 0, 'spring-resource': 0, 'seam-in': 0, 'ejb-bean-name': 0 },
        buckets: Object.fromEntries(ANNOTATION_INJECTION_BUCKETS.map((bucket) => [bucket, 0])),
        siteCount: 0,
        nested: 0,
        unconfirmed: {},
      },
    });
  });

  it('reads no rows as a run with nothing to resolve too, not a failure', () => {
    const p = project({ files: { 'app/pom.xml': POM } });
    expect(p.result.coverage).toMatchObject({ status: 'ran', siteCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// Conservation of both sources (design D8)
// ---------------------------------------------------------------------------

describe('conservation of the XML and the annotation sources together (design D8; spec: unbalanced conservation fails the build)', () => {
  const xml = () => ({ siteCount: 14, buckets: Object.fromEntries(XML_INJECTION_BUCKETS.map((bucket) => [bucket, 1])) });
  const annotation = () => ({ status: 'ran', siteCount: 15, buckets: Object.fromEntries(ANNOTATION_INJECTION_BUCKETS.map((bucket) => [bucket, 1])) });
  // XML: target-unresolved 3 (outside, unindexed, unknown), consumer-unresolved 4; annotation: target-unresolved 4 (nonLiteral, expression, unindexed, unknown), consumer-unresolved 1
  const xmlOnlyKinds = { 'injection-target-unresolved': 3, 'injection-ambiguous': 1, 'injection-elsewhere': 1, 'injection-unbound': 1, 'injection-consumer-unresolved': 4 };
  const jointKinds = { 'injection-target-unresolved': 7, 'injection-ambiguous': 2, 'injection-elsewhere': 2, 'injection-unbound': 2, 'injection-consumer-unresolved': 5 };

  it('holds when the buckets of each source add up to its sites and the gaps read back to the buckets of both together', () => {
    expect(() => assertInjectionConservation(xml(), jointKinds, annotation())).not.toThrow();
  });

  it('fails when the buckets of the annotation source do not add up to its site count, in either direction', () => {
    expect(() => assertInjectionConservation(xml(), jointKinds, { ...annotation(), siteCount: 16 })).toThrow(/16 annotation injection site\(s\) but 15 outcome\(s\)/);
    expect(() => assertInjectionConservation(xml(), jointKinds, { ...annotation(), siteCount: 14 })).toThrow(/14 annotation injection site\(s\) but 15 outcome\(s\)/);
  });

  it('fails when a bucket of the annotation source is missing from its coverage', () => {
    const missing = annotation();
    delete missing.buckets.byType;
    expect(() => assertInjectionConservation(xml(), jointKinds, missing)).toThrow();
  });

  it('fails when the gaps read back of a kind differ from the sum of both sources\' buckets, for each of the five kinds and both ways', () => {
    for (const kind of Object.keys(jointKinds)) {
      expect(() => assertInjectionConservation(xml(), { ...jointKinds, [kind]: jointKinds[kind] + 1 }, annotation()), kind).toThrow(new RegExp(`${kind} outcome\\(s\\) but`));
      expect(() => assertInjectionConservation(xml(), { ...jointKinds, [kind]: jointKinds[kind] - 1 }, annotation()), kind).toThrow(new RegExp(kind));
    }
  });

  it('fails when only the XML source\'s gaps were recorded and the annotation source ran: its gaps are not skipped, and the other way round', () => {
    expect(() => assertInjectionConservation(xml(), xmlOnlyKinds, annotation())).toThrow(/outcome\(s\) but \d+ recorded gap occurrence\(s\)/);
    const annotationOnly = { 'injection-target-unresolved': 4, 'injection-ambiguous': 1, 'injection-elsewhere': 1, 'injection-unbound': 1, 'injection-consumer-unresolved': 1 };
    expect(() => assertInjectionConservation(xml(), annotationOnly, annotation())).toThrow();
  });

  it('holds for the XML source alone when the annotation coverage is left out, absent or not-run, and still fails on its own gaps', () => {
    expect(() => assertInjectionConservation(xml(), xmlOnlyKinds)).not.toThrow();
    expect(() => assertInjectionConservation(xml(), xmlOnlyKinds, undefined)).not.toThrow();
    expect(() => assertInjectionConservation(xml(), xmlOnlyKinds, null)).not.toThrow();
    expect(() => assertInjectionConservation(xml(), xmlOnlyKinds, { status: 'not-run' })).not.toThrow();
    // a stage that did not run has no sites: gaps of the joint total would be gaps from nowhere
    expect(() => assertInjectionConservation(xml(), jointKinds, { status: 'not-run' })).toThrow(/recorded gap occurrence/);
    expect(() => assertInjectionConservation(xml(), { ...xmlOnlyKinds, 'injection-unbound': 2 })).toThrow(/injection-unbound outcome\(s\) but 2/);
  });

  it('still fails when the XML buckets do not add up to its site count, with or without the annotation source', () => {
    expect(() => assertInjectionConservation({ ...xml(), siteCount: 15 }, jointKinds, annotation())).toThrow(/15 injection site\(s\) but 14 outcome\(s\)/);
    expect(() => assertInjectionConservation({ ...xml(), siteCount: 13 }, xmlOnlyKinds)).toThrow(/13 injection site\(s\) but 14 outcome\(s\)/);
  });

  it('refuses an annotation coverage that says some other status, which is no run and no not-run', () => {
    expect(() => assertInjectionConservation(xml(), jointKinds, { ...annotation(), status: 'partial' })).toThrow(/status "partial"/);
  });

  it('holds on what the two real stages produced for one project: the gap counts read back from the recorded gaps of both', () => {
    const p = project({
      java: {
        ...javaOf('Dao'),
        [SRC('Owner')]: javaSource('com.acme', [RESOURCE], ['public class Owner {', '  @Resource(name = "dao") private Object a;', '  @Resource(name = "missing") private Object b;', '}']),
      },
      files: { 'app/pom.xml': POM, [CTX]: ctx('  <bean id="owner" class="com.acme.Owner"><property name="d" ref="dao"/><property name="x" ref="absent"/></bean>', '  <bean id="dao" class="com.acme.Dao"/>') },
    });
    const xml = p.xml();
    const recorded = {};
    for (const gap of [...xml.gaps, ...p.result.gaps]) recorded[gap.kind] = (recorded[gap.kind] ?? 0) + 1;
    expect(recorded).toEqual({ 'injection-unbound': 2 });
    expect(() => assertInjectionConservation(xml.coverage, { ...Object.fromEntries(Object.keys(jointKinds).map((k) => [k, 0])), ...recorded }, p.coverage)).not.toThrow();
    // the same counts fail against the XML source alone: one of the two gaps is the annotation source's
    expect(() => assertInjectionConservation(xml.coverage, { ...Object.fromEntries(Object.keys(jointKinds).map((k) => [k, 0])), ...recorded })).toThrow(/injection-unbound outcome\(s\) but 2/);
  });
});

// ---------------------------------------------------------------------------
// Inputs it cannot place
// ---------------------------------------------------------------------------

describe('inputs it cannot place fail (as the XML stage fails on them)', () => {
  const base = () => spring({
    java: { ...javaOf('Dao'), [SRC('Owner')]: javaSource('com.acme', [RESOURCE], ['public class Owner {', '  @Resource(name = "dao") private Object a;', '}']) },
    definitions: ['  <bean id="owner" class="com.acme.Owner"/>', '  <bean id="dao" class="com.acme.Dao"/>'],
  });
  const resolveWith = (p, javaRows) => () => resolveAnnotationInjections({ javaRows, catalog: CATALOG, table: p.table, classIds: p.classIds });

  it('accepts what the extraction produced', () => {
    const p = base();
    expect(resolveWith(p, p.javaRows)).not.toThrow();
  });

  it('fails on a row that has types and no member annotations: the output of an older extraction would otherwise read as "no sites"', () => {
    const p = base();
    const stale = structuredClone(p.javaRows);
    for (const row of stale) delete row.memberAnnotations;
    expect(resolveWith(p, stale)).toThrow(/has no memberAnnotations \(an output of an older extraction\?\)/);
  });

  it('skips a row that has no types and no member annotations: a file the extraction could not read says so in the structure coverage', () => {
    const p = base();
    expect(resolveWith(p, [{ path: 'app/src/com/acme/Broken.java', language: 'java', status: 'parse-failed' }, ...p.javaRows])).not.toThrow();
  });

  it('fails on a site whose default-name rule it does not have', () => {
    const p = base();
    const catalog = structuredClone(CATALOG);
    catalog.annotationInjections[0].sites[1].defaultName = 'member-unknown';
    expect(() => resolveAnnotationInjections({ javaRows: p.javaRows, catalog, table: p.table, classIds: p.classIds })).toThrow(/default-name rule "member-unknown"/);
  });
});

// ---------------------------------------------------------------------------
// Mutation tripwires (design D11)
// ---------------------------------------------------------------------------

describe('mutation tripwires (design D11)', () => {
  const OWNER = SRC('Owner');
  const DAO = '  <bean id="orderDao" class="com.acme.JdbcOrderDao"/>';
  const FIELD = '  @Resource(name = "orderDao") private Object dao;';
  const owner = (annotations, body = FIELD, imports = [RESOURCE, SERVICE]) =>
    javaSource('com.acme', imports, [...annotations, 'public class Owner {', ...[body].flat(), '}']);
  const edgeTo = (name, unit = 'app') => `${CLASS('Owner', unit)} -> ${CLASS(name, unit)}`;

  it('annotationSimpleNames: a Resource that the package declares itself, or that no import settles, is taken for the catalog\'s', () => {
    const own = {
      java: { ...javaOf('JdbcOrderDao'), [SRC('Resource')]: 'package com.acme;\n\npublic @interface Resource {\n}\n', [OWNER]: owner(['@Service'], FIELD, [SERVICE]) },
      definitions: [DAO],
    };
    expect(spring(own).coverage.siteCount).toBe(0);
    const mutated = spring({ ...own, mutations: { annotationSimpleNames: true } });
    expect(mutated.coverage.siteCount).toBe(1);
    expect(mutated.links).toEqual([edgeTo('JdbcOrderDao')]);

    // an on-demand import that two packages provide: "could not tell", unless the simple name is enough
    const twice = { java: { ...javaOf('JdbcOrderDao'), [OWNER]: owner(['@Service'], FIELD, ['import javax.annotation.*;', 'import jakarta.annotation.*;', SERVICE]) }, definitions: [DAO] };
    expect(spring(twice).coverage).toMatchObject({ siteCount: 0, unconfirmed: { Resource: 1 } });
    expect(spring({ ...twice, mutations: { annotationSimpleNames: true } }).coverage).toMatchObject({ siteCount: 1, unconfirmed: {} });
  });

  it('annotationIgnoreManaged: a class no binder manages has its names looked up, in its own unit', () => {
    const unmanaged = { java: { ...javaOf('JdbcOrderDao'), [OWNER]: owner([]) }, definitions: [DAO] };
    expect(spring(unmanaged).buckets).toMatchObject({ unmanaged: 1, edge: 0 });
    const mutated = spring({ ...unmanaged, mutations: { annotationIgnoreManaged: true } });
    expect(mutated.links).toEqual([edgeTo('JdbcOrderDao')]);
    expect(mutated.buckets).toMatchObject({ unmanaged: 0, edge: 1 });
    // nothing manages it: the evidence has no managing binding either
    expect(mutated.edges[0].evidence[0].consumer).toEqual({ bindings: [] });
  });

  it('annotationIgnoreManaged: a class another unit\'s XML manages is looked up in the unit of its file, not the unit that manages it', () => {
    const files = {
      'core/pom.xml': POM, 'web/pom.xml': POM,
      'web/ctx.xml': ctx('  <bean id="owner" class="com.acme.Owner"/>', '  <bean id="orderDao" class="com.acme.JdbcOrderDao"/>'),
    };
    const java = { [SRC('Owner', 'com.acme', 'core')]: owner([]), ...Object.fromEntries([classFile('JdbcOrderDao', 'com.acme', 'web')]) };
    expect(project({ java, files }).links).toEqual([`${CLASS('Owner', 'core')} -> ${CLASS('JdbcOrderDao', 'web')}`]);
    const mutated = project({ java, files, mutations: { annotationIgnoreManaged: true } });
    expect(mutated.links).toEqual([]);
    expect(mutated.buckets).toMatchObject({ elsewhere: 1, edge: 0 });
  });

  it('annotationIgnoreBinders: a Seam name is looked up among every binder of the namespace, a JSF managed bean included', () => {
    const spec = {
      java: { [SRC('Checkout')]: javaSource('com.acme', [SEAM_NAME, SEAM_IN], ['@Name("checkout")', 'public class Checkout {', '  @In private Prefs prefs;', '}']), ...javaOf('Prefs') },
      files: { 'app/pom.xml': POM, 'app/WEB-INF/faces-config.xml': FACES('prefs', 'com.acme.Prefs') },
    };
    expect(project(spec).buckets).toMatchObject({ elsewhere: 1, edge: 0 });
    const mutated = project({ ...spec, mutations: { annotationIgnoreBinders: true } });
    expect(mutated.links).toEqual([`${CLASS('Checkout')} -> ${CLASS('Prefs')}`]);
    expect(mutated.buckets).toMatchObject({ elsewhere: 0, edge: 1 });
  });

  it('annotationNoFallback: a default name no bean has is a missing bean, not a name for the container to match by type', () => {
    const spec = { java: { [OWNER]: owner(['@Service'], '  @Resource private Clock clock;') } };
    expect(spring(spec).buckets).toMatchObject({ byType: 1, unbound: 0 });
    const mutated = spring({ ...spec, mutations: { annotationNoFallback: true } });
    expect(mutated.buckets).toMatchObject({ byType: 0, unbound: 1 });
    expect(mutated.samples('injection-unbound')).toEqual([`${OWNER}:7 clock -> []`]);
    // another unit that has the name is the "elsewhere" the fall back would have hidden
    const other = project({
      java: { [SRC('Owner', 'com.acme', 'a')]: owner([], '  @Resource private Object clock;'), ...Object.fromEntries([classFile('Clock', 'com.acme', 'b')]) },
      files: { 'a/pom.xml': POM, 'a/ctx.xml': ctx('  <bean id="owner" class="com.acme.Owner"/>'), 'b/pom.xml': POM, 'b/ctx.xml': ctx('  <bean id="clock" class="com.acme.Clock"/>') },
      mutations: { annotationNoFallback: true },
    });
    expect(other.buckets).toMatchObject({ byType: 0, elsewhere: 1 });
  });

  it('annotationTokenIsName: the evidence of a default name writes the name resolved with where the line writes the member', () => {
    const spec = { java: { ...javaOf('JdbcOrderDao'), [OWNER]: owner(['@Service'], '  @Resource public void setOrderDao(Object d) {}') }, definitions: [DAO] };
    const evidence = (p) => p.edges[0].evidence[0];
    expect(evidence(spring(spec))).toMatchObject({ token: 'setOrderDao', name: 'orderDao' });
    const mutated = evidence(spring({ ...spec, mutations: { annotationTokenIsName: true } }));
    expect(mutated).toMatchObject({ token: 'orderDao', name: 'orderDao' });
    // the line does not hold it: the check that every evidence line holds its token would fail
    expect(spring(spec).texts[OWNER].split('\n')[mutated.line - 1]).not.toContain(mutated.token);
  });

  it('annotationTokenIsName leaves an explicit name alone: its token is the name already', () => {
    const spec = { java: { ...javaOf('JdbcOrderDao'), [OWNER]: owner(['@Service']) }, definitions: [DAO] };
    expect(spring({ ...spec, mutations: { annotationTokenIsName: true } }).edges).toEqual(spring(spec).edges);
  });

  it('noInjectsMerge: of one pair both sources draw, the second source\'s edge is dropped, as the graph would drop it', () => {
    const p = spring({
      java: { ...javaOf('JdbcOrderDao'), [OWNER]: owner([], FIELD) },
      definitions: ['  <bean id="owner" class="com.acme.Owner"><property name="d" ref="orderDao"/></bean>', DAO],
    });
    const merge = (mutations) => mergeInjectsEdges({ xmlEdges: p.xml().edges, annotationEdges: p.edges, mutations });
    expect(merge({})[0].evidence.map((e) => e.site)).toEqual(['spring-property-ref', 'spring-resource']);
    const mutated = merge({ noInjectsMerge: true });
    expect(mutated).toHaveLength(1);
    expect(mutated[0].evidence.map((e) => e.site)).toEqual(['spring-property-ref']);
  });

  it('has every switch off by default: no mutations and empty mutations are the same run', () => {
    const spec = { java: { ...javaOf('JdbcOrderDao'), [OWNER]: owner(['@Service']) }, definitions: [DAO] };
    expect(spring({ ...spec, mutations: {} }).result).toEqual(spring(spec).result);
  });

  describe('the tripwires of the earlier steps, which live in the table, reach annotation injections through it', () => {
    it('noAliases: an alias is not followed to the bean it names', () => {
      const spec = { java: { ...javaOf('JdbcOrderDao'), [OWNER]: owner(['@Service'], '  @Resource(name = "orders") private Object dao;') }, definitions: [DAO, '  <alias name="orderDao" alias="orders"/>'] };
      expect(spring(spec).links).toEqual([edgeTo('JdbcOrderDao')]);
      expect(spring({ ...spec, mutations: { noAliases: true } }).buckets).toMatchObject({ edge: 0, unknown: 1 });
    });

    it('noInheritance: a bean with only a parent does not take the parent\'s class', () => {
      const spec = { java: { ...javaOf('JdbcOrderDao'), [OWNER]: owner(['@Service'], '  @Resource(name = "child") private Object dao;') }, definitions: [DAO, '  <bean id="child" parent="orderDao"/>'] };
      expect(spring(spec).links).toEqual([edgeTo('JdbcOrderDao')]);
      expect(spring({ ...spec, mutations: { noInheritance: true } }).buckets).toMatchObject({ edge: 0, unknown: 1 });
    });

    it('ignoreUnknownWhen: a class built by a factory method is taken for managed by the bean that writes its class', () => {
      const spec = { java: { ...javaOf('JdbcOrderDao'), [OWNER]: owner([]) }, definitions: [DAO, '  <bean id="owner" class="com.acme.Owner" factory-method="make"/>'] };
      expect(spring(spec).buckets).toMatchObject({ unmanaged: 1, edge: 0 });
      expect(spring({ ...spec, mutations: { ignoreUnknownWhen: true } }).links).toEqual([edgeTo('JdbcOrderDao')]);
    });

    it('simpleNameAnnotations: a same-package Service is taken for the stereotype, and its class for managed', () => {
      const spec = {
        java: { ...javaOf('JdbcOrderDao'), [SRC('Service')]: 'package com.acme;\n\npublic @interface Service {\n}\n', [OWNER]: owner(['@Service'], FIELD, [RESOURCE]) },
        definitions: [DAO],
      };
      expect(spring(spec).buckets).toMatchObject({ unmanaged: 1, edge: 0 });
      expect(spring({ ...spec, mutations: { simpleNameAnnotations: true } }).links).toEqual([edgeTo('JdbcOrderDao')]);
    });
  });
});
