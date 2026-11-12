// spring-xml-method-calls, tasks 3.1 and 3.5: the resolution of XML method call
// sites into `invokes` edges, visible buckets and gaps
// (skills/excavator/xml-method-call-resolution.mjs), over the one binding table.
//
// Every input is real: small synthetic projects are read by the real
// name-reference stage and the real binding table; Java rows are what Core emits
// for the source text, the type queries are the real call resolver's. Nothing
// here goes through buildFactGraph.
import { beforeAll, describe, expect, it } from 'vitest';
import { extname } from 'node:path';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { collectNameReferenceSites } from '../../skills/excavator/name-reference-sites.mjs';
import { loadNameBindingCatalog, parseNameBindingCatalog } from '../../skills/excavator/name-binding-catalog.mjs';
import { buildNameBindingTable } from '../../skills/excavator/name-reference-resolution.mjs';
import { createJavaCallResolver } from '../../skills/excavator/java-call-resolution.mjs';
import {
  XML_METHOD_CALL_BUCKETS,
  XML_METHOD_CALL_GAP_KINDS,
  assertMethodCallConservation,
  resolveXmlMethodCalls,
} from '../../skills/excavator/xml-method-call-resolution.mjs';

let registry;
beforeAll(async () => {
  const tsPlugin = new TreeSitterPlugin(builtinLanguageConfigs.filter((c) => c.treeSitter));
  await tsPlugin.init();
  registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);
});

const CATALOG = loadNameBindingCatalog();
const BEANS_OPEN = [
  '<beans xmlns="http://www.springframework.org/schema/beans" xmlns:p="http://www.springframework.org/schema/p"',
  ' xmlns:task="http://www.springframework.org/schema/task" xmlns:aop="http://www.springframework.org/schema/aop">',
].join('');
const CTX = 'app/WEB-INF/ctx.xml';
const ctx = (...definitions) => [BEANS_OPEN, ...definitions.flat(), '</beans>'].join('\n');
const path = (name) => `app/src/com/acme/${name}.java`;
/** A class of package com.acme, its header and body as given (`extends X`, methods). */
const klass = (name, body = '', header = '') => [path(name), `package com.acme;\n\npublic class ${name}${header ? ` ${header}` : ''} {\n${body}\n}\n`];

/**
 * Read a synthetic project up to the method call resolution.
 *
 * @param {{ java?: Record<string, string>, files?: Record<string, string>, catalog?: object, languageOf?: Function }} spec
 */
function project({ java = {}, files = {}, catalog = CATALOG, languageOf, declaredTypes = [] } = {}) {
  const texts = { ...files };
  const javaRows = [];
  for (const [file, source] of Object.entries(java)) {
    texts[file] = source;
    const entry = { path: file, language: 'java', fileCategory: 'code' };
    const extracted = analyzeFileWithOutcomes(registry, entry, source);
    expect(extracted.structureOutcome).toBe('succeeded');
    const split = source.split('\n');
    javaRows.push(buildResult(entry, split.length, split.filter((l) => l.trim()).length, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome));
  }
  const classIds = new Map(javaRows.map((row) => [row.path, (row.classes ?? []).map((cls) => `class:${row.path}#${cls.name}`)]));
  const functionIds = new Map(javaRows.map((row) => [
    row.path,
    (row.functions ?? []).map((fn) => `function:${row.path}:${fn.owner ?? ''}#${fn.name}(${(fn.paramTypes ?? []).join(',')})`),
  ]));
  const javaTypes = javaRows.flatMap((row) => (row.classes ?? []).map((cls, i) => ({ fqn: cls.qualifiedName, path: row.path, id: classIds.get(row.path)[i] })));
  const manifestPaths = Object.keys(texts);
  const scan = { files: manifestPaths.map((p) => ({ path: p, language: java[p] === undefined ? (extname(p) === '.xml' ? 'xml' : 'unknown') : 'java' })) };
  const sites = collectNameReferenceSites({ scan, catalog, readFile: (p) => texts[p] });
  const none = { isType: () => false };
  const table = buildNameBindingTable({
    sites, catalog, manifestPaths, javaRows, classIds, javaTypes, otherJvm: none, declaredJavaTypes: { isType: (pkg, name) => declaredTypes.includes(`${pkg}.${name}`) },
  });
  const types = createJavaCallResolver({ rows: javaRows, functionIds, classIds });
  const result = resolveXmlMethodCalls({ sites, catalog, table, manifestPaths, types, javaRows, functionIds, languageOf });
  const label = (id) => id.replace(/^function:app\/src\/com\/acme\//, '').replace(/\.java:/, ':');
  return {
    sites, table, result,
    links: result.edges.map((e) => `${e.file} -> ${label(e.target)}`).sort(),
    edge: (target) => result.edges.find((e) => label(e.target) === target),
    buckets: result.coverage.buckets,
    samples: (kind) => result.gaps.filter((g) => g.kind === kind).map((g) => g.sample),
  };
}

/** One unit, one context file, the classes given. */
const unit = (definitions, classes, extra = {}) => ({
  java: Object.fromEntries(classes),
  files: { 'app/pom.xml': '<project/>', [CTX]: ctx(definitions), ...extra },
});

const bucketsWith = (buckets, expected) => {
  const zero = Object.fromEntries(XML_METHOD_CALL_BUCKETS.map((b) => [b, 0]));
  expect(buckets).toEqual({ ...zero, ...expected });
};

describe('the buckets and the gap kinds (design D2, D3)', () => {
  it('lists the fourteen buckets', () => {
    expect([...XML_METHOD_CALL_BUCKETS].sort()).toEqual([
      'edge', 'methodAmbiguous', 'methodExternal', 'methodMissing', 'methodNotModeled', 'optionalInactive', 'ownerAmbiguous', 'ownerBundle',
      'ownerElsewhere', 'ownerExternal', 'ownerMissing', 'ownerUnbound', 'ownerUnindexed', 'ownerUnknown',
    ]);
    expect(Object.isFrozen(XML_METHOD_CALL_BUCKETS)).toBe(true);
  });

  it('maps the gap buckets to the three gap kinds; the edge, an outside class, a bundle and an inactive default are no gap', () => {
    expect(XML_METHOD_CALL_GAP_KINDS).toEqual({
      ownerMissing: 'method-call-owner-unresolved',
      ownerUnknown: 'method-call-owner-unresolved',
      ownerUnindexed: 'method-call-owner-unresolved',
      ownerAmbiguous: 'method-call-owner-unresolved',
      ownerElsewhere: 'method-call-owner-unresolved',
      ownerUnbound: 'method-call-owner-unresolved',
      methodMissing: 'method-call-method-unresolved',
      methodExternal: 'method-call-method-unresolved',
      methodNotModeled: 'method-call-method-unresolved',
      methodAmbiguous: 'method-call-ambiguous',
    });
    for (const free of ['edge', 'ownerExternal', 'ownerBundle', 'optionalInactive']) expect(XML_METHOD_CALL_GAP_KINDS[free]).toBeUndefined();
  });
});

describe('the scenarios of the spec', () => {
  it('init-method: an invokes edge from the descriptor to the method, with the evidence of the line', () => {
    const p = project(unit(['<bean id="svc" class="com.acme.OrderService" init-method="start"/>'], [klass('OrderService', '  public void start() {}')]));
    expect(p.links).toEqual([`${CTX} -> OrderService:OrderService#start()`]);
    expect(p.edge('OrderService:OrderService#start()').evidence).toEqual([
      { file: CTX, line: 2, source: 'lexical', token: 'start', site: 'spring-init-method', bindings: [] },
    ]);
    bucketsWith(p.buckets, { edge: 1 });
    expect(p.result.gaps).toEqual([]);
  });

  it('a property name is the setter of an ancestor in the repository; the same attribute still injects', () => {
    const p = project(unit(
      ['<bean class="com.acme.OrderService"><property name="orderDao" ref="dao"/></bean>'],
      [
        klass('BaseService', '  public void setOrderDao(OrderDao dao) {}'),
        klass('OrderService', '', 'extends BaseService'),
        klass('OrderDao'),
      ],
    ));
    expect(p.links).toEqual([`${CTX} -> BaseService:BaseService#setOrderDao(OrderDao)`]);
    expect(p.edge('BaseService:BaseService#setOrderDao(OrderDao)').evidence[0]).toMatchObject({ line: 2, token: 'orderDao', site: 'spring-property-setter' });
  });

  it('a p attribute loses its -ref suffix: the method name is setOrderDao, and the token is the attribute as written', () => {
    const p = project(unit(
      ['<bean class="com.acme.OrderService" p:orderDao-ref="dao"/>', '<bean class="com.acme.OrderService" p:limit="3"/>'],
      [klass('OrderService', '  public void setOrderDao(Object o) {}\n  public void setLimit(int n) {}')],
    ));
    expect(p.sites.methodCalls.map((c) => [c.method, c.token])).toEqual([['setOrderDao', 'p:orderDao-ref'], ['setLimit', 'p:limit']]);
    expect(p.links).toEqual([`${CTX} -> OrderService:OrderService#setLimit(int)`, `${CTX} -> OrderService:OrderService#setOrderDao(Object)`]);
  });

  it('a static factory method is on the class the bean writes, though that class is not what the bean stands for', () => {
    const p = project(unit(
      ['<bean id="x" class="com.acme.Factory" factory-method="create"/>'],
      [klass('Factory', '  public static Object create() { return null; }')],
    ));
    expect(p.links).toEqual([`${CTX} -> Factory:Factory#create()`]);
    // the bean as an injection target is still unknown: the class it writes is the factory's
    const hits = p.table.bindingsNamed('x', { unit: p.table.unitOf(CTX), namespace: 'spring' });
    expect(p.table.resolveHits(hits).target.kind).toBe('unknown');
  });

  it('an init-method of a bean a factory builds is a gap: its own class is not the factory\'s', () => {
    const p = project(unit(
      ['<bean id="x" class="com.acme.Factory" factory-method="create" init-method="start"/>'],
      [klass('Factory', '  public static Object create() { return null; }\n  public void start() {}')],
    ));
    expect(p.links).toEqual([`${CTX} -> Factory:Factory#create()`]);
    bucketsWith(p.buckets, { edge: 1, ownerUnknown: 1 });
    expect(p.samples('method-call-owner-unresolved')).toEqual([`${CTX}:2 start -> [factory-method]`]);
  });

  it('an instance factory method is on the class of the bean factory-bean names', () => {
    const p = project(unit(
      ['<bean id="f" class="com.acme.Maker"/>', '<bean id="x" factory-bean="f" factory-method="make"/>'],
      [klass('Maker', '  public Object make() { return null; }')],
    ));
    expect(p.links).toEqual([`${CTX} -> Maker:Maker#make()`]);
    expect(p.edge('Maker:Maker#make()').evidence[0]).toMatchObject({ site: 'spring-factory-method-bean', line: 3 });
    // the bean named by factory-bean is found through its binding, which the evidence cites
    expect(p.edge('Maker:Maker#make()').evidence[0].bindings).toEqual([{ file: CTX, line: 2, binder: 'spring-xml-bean' }]);
  });

  it('a scheduled method is on the class of the bean its ref names', () => {
    const p = project(unit(
      ['<bean id="job" class="com.acme.NightlyJob"/>', '<task:scheduled ref="job" method="run" fixed-delay="1000"/>'],
      [klass('NightlyJob', '  public void run() {}')],
    ));
    expect(p.links).toEqual([`${CTX} -> NightlyJob:NightlyJob#run()`]);
  });

  it('an advice method is on the class of the bean the enclosing aspect names', () => {
    const p = project(unit(
      ['<bean id="audit" class="com.acme.AuditAspect"/>', '<aop:config><aop:aspect ref="audit">', '<aop:before method="log" pointcut="x"/>', '</aop:aspect></aop:config>'],
      [klass('AuditAspect', '  public void log() {}')],
    ));
    expect(p.links).toEqual([`${CTX} -> AuditAspect:AuditAspect#log()`]);
  });

  it('a default init method applies to the beans whose class has it; a bean without it is an inactive optional call, no gap', () => {
    const p = project({
      java: Object.fromEntries([klass('A', '  public void init() {}'), klass('B')]),
      files: {
        'app/pom.xml': '<project/>',
        [CTX]: ['<beans xmlns="http://www.springframework.org/schema/beans" default-init-method="init">',
          '<bean id="a" class="com.acme.A"/>', '<bean id="b" class="com.acme.B"/>', '</beans>'].join('\n'),
      },
    });
    expect(p.links).toEqual([`${CTX} -> A:A#init()`]);
    bucketsWith(p.buckets, { edge: 1, optionalInactive: 1 });
    expect(p.result.gaps).toEqual([]);
    // the line is the root's attribute
    expect(p.edge('A:A#init()').evidence[0]).toMatchObject({ line: 1, token: 'init', site: 'spring-default-init-method' });
  });

  it('a default init method on a bean whose class extends a library type is an inactive optional call, not a gap', () => {
    const p = project({
      java: Object.fromEntries([[path('LibBacked'), 'package com.acme;\n\nimport org.springframework.jdbc.core.support.JdbcDaoSupport;\n\npublic class LibBacked extends JdbcDaoSupport {\n}\n']]),
      files: {
        'app/pom.xml': '<project/>',
        [CTX]: ['<beans xmlns="http://www.springframework.org/schema/beans" default-init-method="init">',
          '<bean id="l" class="com.acme.LibBacked"/>', '</beans>'].join('\n'),
      },
    });
    bucketsWith(p.buckets, { optionalInactive: 1 });
    expect(p.result.gaps).toEqual([]);
  });

  it('a method that may come from a library: no method in the repository, a supertype outside it', () => {
    const p = project({
      ...unit(
        ['<bean class="com.acme.LibBacked"><property name="dataSource" ref="ds"/></bean>'],
        [[path('LibBacked'), 'package com.acme;\n\nimport org.springframework.jdbc.core.support.JdbcDaoSupport;\n\npublic class LibBacked extends JdbcDaoSupport {\n}\n']],
      ),
    });
    bucketsWith(p.buckets, { methodExternal: 1 });
    expect(p.samples('method-call-method-unresolved')).toEqual([`${CTX}:2 dataSource -> [com.acme.LibBacked#setDataSource]`]);
  });

  it('a method the class overrides is the nearest declaration: one edge, to the class, none to the ancestor', () => {
    const p = project(unit(
      ['<bean class="com.acme.Dup" init-method="reset"/>'],
      [klass('DupBase', '  public void reset() {}'), klass('Dup', '  public void reset() {}', 'extends DupBase')],
    ));
    expect(p.links).toEqual([`${CTX} -> Dup:Dup#reset()`]);
    bucketsWith(p.buckets, { edge: 1 });
    expect(p.result.gaps).toEqual([]);
  });

  it('a method only an ancestor declares is found there, nearest ancestor first', () => {
    const p = project(unit(
      ['<bean class="com.acme.C" init-method="reset"/>'],
      [klass('A0', '  public void reset() {}'), klass('B0', '  public void reset() {}', 'extends A0'), klass('C', '', 'extends B0')],
    ));
    expect(p.links).toEqual([`${CTX} -> B0:B0#reset()`]);
  });

  it('overloads on one type are ambiguous: factory-method of(String) and of(int), no edge, none preferred', () => {
    const p = project(unit(
      ['<bean id="x" class="com.acme.Ov" factory-method="of"/>'],
      [klass('Ov', '  public static Object of(String s) { return s; }\n  public static Object of(int n) { return n; }')],
    ));
    expect(p.result.edges).toEqual([]);
    bucketsWith(p.buckets, { methodAmbiguous: 1 });
    expect(p.samples('method-call-ambiguous')).toEqual([`${CTX}:2 of -> [com.acme.Ov#of(String), com.acme.Ov#of(int)]`]);
  });

  it('overloads on the nearest type decide, an overload further up is not looked at', () => {
    const p = project(unit(
      ['<bean class="com.acme.D" init-method="go"/>'],
      [klass('E', '  public void go() {}'), klass('D', '  public void go(int a) {}\n  public void go() {}', 'extends E')],
    ));
    expect(p.links).toEqual([`${CTX} -> D:D#go()`]);
  });

  it('a setter for a nested property path is not modeled: a gap, no lookup, even when the class has a setter of that shape', () => {
    const p = project(unit(
      ['<bean class="com.acme.N"><property name="config.timeout" value="5"/></bean>'],
      [klass('N', '  public void setConfig(Object c) {}')],
    ));
    expect(p.result.edges).toEqual([]);
    bucketsWith(p.buckets, { methodNotModeled: 1 });
    expect(p.samples('method-call-method-unresolved')).toEqual([`${CTX}:2 config.timeout -> [com.acme.N: config.timeout]`]);
  });

  it('the argument count tells overloads of setters and init methods apart', () => {
    const p = project(unit(
      ['<bean class="com.acme.O" init-method="go"/>', '<bean class="com.acme.O"><property name="x" ref="y"/></bean>'],
      [klass('O', '  public void go(int a) {}\n  public void go() {}\n  public void go(String s) {}\n  public void setX() {}\n  public void setX(Object o) {}')],
    ));
    // go with no argument: exactly one; setX with one argument: exactly one
    expect(p.links).toEqual([`${CTX} -> O:O#go()`, `${CTX} -> O:O#setX(Object)`]);
    bucketsWith(p.buckets, { edge: 2 });
  });

  it('a method nothing declares is a gap, a constructor is no method, and a default of an optional site is not', () => {
    const p = project(unit(
      ['<bean class="com.acme.Ghost" init-method="nothing"/>', '<bean class="com.acme.Ghost" init-method="Ghost"/>'],
      [klass('Ghost', '  public Ghost() {}')],
    ));
    bucketsWith(p.buckets, { methodMissing: 2 });
    expect(p.samples('method-call-method-unresolved')).toHaveLength(2);
  });
});

describe('the class the method belongs to', () => {
  const noMethods = [klass('K'), klass('Other')];
  const cases = [
    ['a call outside every bean element has no consumer', '<lookup-method name="m" bean="x"/>', 'ownerMissing'],
    ['a scheduled element with no ref', '<task:scheduled method="run"/>', 'ownerMissing'],
    ['a ref no binding declares anywhere', '<task:scheduled ref="nope" method="run"/>', 'ownerUnbound'],
    ['a class outside the repository is no gap', '<bean class="org.vendor.V" init-method="go"/>', 'ownerExternal'],
    ['a bean with no class and no parent', '<bean id="abstractOne" init-method="go"/>', 'ownerUnknown'],
  ];
  it.each(cases)('%s', (_why, definition, bucket) => {
    const p = project(unit([definition], noMethods));
    bucketsWith(p.buckets, { [bucket]: 1 });
    expect(p.result.gaps.length).toBe(XML_METHOD_CALL_GAP_KINDS[bucket] === undefined ? 0 : 1);
  });

  it('a name that two beans declare is ambiguous; a name another unit declares is elsewhere', () => {
    const p = project({
      java: Object.fromEntries(noMethods),
      files: {
        'app/pom.xml': '<project/>',
        'lib/pom.xml': '<project/>',
        'lib/ctx.xml': ctx('<bean id="far" class="com.acme.K"/>'),
        [CTX]: ctx(
          '<bean id="twin" class="com.acme.K"/>', '<bean id="twin" class="com.acme.Other"/>',
          '<task:scheduled ref="twin" method="run"/>', '<task:scheduled ref="far" method="run"/>',
        ),
      },
    });
    bucketsWith(p.buckets, { ownerAmbiguous: 1, ownerElsewhere: 1 });
  });

  it('a bean that takes its class from a parent finds the method there, and cites the binding it went through', () => {
    const p = project(unit(
      ['<bean id="base" class="com.acme.K"/>', '<bean id="child" parent="base" init-method="go"/>'],
      [klass('K', '  public void go() {}')],
    ));
    expect(p.links).toEqual([`${CTX} -> K:K#go()`]);
    expect(p.edge('K:K#go()').evidence[0].bindings).toEqual([{ file: CTX, line: 2, binder: 'spring-xml-bean' }]);
  });

  it('a class the type index has no view of lands in ownerUnindexed, not nowhere', () => {
    const p = project({ ...unit(['<bean class="com.acme.Marker" init-method="go"/>'], [[path('Marker'), 'package com.acme;\n\npublic @interface Marker {\n}\n']]), declaredTypes: ['com.acme.Marker'] });
    bucketsWith(p.buckets, { ownerUnindexed: 1 });
  });
});

describe('one edge per (file, method), with the evidence of every call, in order', () => {
  it('merges a property and a p attribute onto one edge; a repeated line is one entry', () => {
    const p = project(unit(
      ['<bean class="com.acme.S" p:limit="1"><property name="limit" value="2"/></bean>'],
      [klass('S', '  public void setLimit(int n) {}')],
    ));
    expect(p.result.edges).toHaveLength(1);
    expect(p.result.edges[0].evidence.map((e) => [e.line, e.token, e.site])).toEqual([
      [2, 'limit', 'spring-property-setter'],
      [2, 'p:limit', 'spring-p-setter'],
    ]);
    expect(p.result.edges[0].weight).toBe(0.5);
  });
});

describe('conservation', () => {
  it('counts every call in exactly one bucket and records one gap per gap-bucket call', () => {
    const p = project(unit(
      ['<bean class="com.acme.K" init-method="a"/>', '<bean class="com.acme.K" init-method="b"/>', '<task:scheduled method="run"/>'],
      [klass('K', '  public void a() {}')],
    ));
    expect(p.result.coverage).toMatchObject({ status: 'ran', siteCount: 3, emptyValues: 0 });
    bucketsWith(p.buckets, { edge: 1, methodMissing: 1, ownerMissing: 1 });
    const counts = {};
    for (const gap of p.result.gaps) counts[gap.kind] = (counts[gap.kind] ?? 0) + 1;
    expect(() => assertMethodCallConservation(p.result.coverage, { 'method-call-owner-unresolved': 1, 'method-call-method-unresolved': 1, 'method-call-ambiguous': 0, ...counts })).not.toThrow();
  });

  it('throws when the buckets do not add up to the calls, or a gap kind to its buckets', () => {
    const coverage = { siteCount: 2, buckets: { ...Object.fromEntries(XML_METHOD_CALL_BUCKETS.map((b) => [b, 0])), edge: 1, methodMissing: 1 } };
    const gaps = { 'method-call-owner-unresolved': 0, 'method-call-method-unresolved': 1, 'method-call-ambiguous': 0 };
    expect(() => assertMethodCallConservation(coverage, gaps)).not.toThrow();
    expect(() => assertMethodCallConservation({ ...coverage, siteCount: 3 }, gaps)).toThrow(/3 method call site\(s\) but 2 outcome\(s\)/);
    expect(() => assertMethodCallConservation(coverage, { ...gaps, 'method-call-method-unresolved': 0 })).toThrow(/1 method-call-method-unresolved outcome\(s\) but 0 recorded/);
    expect(() => assertMethodCallConservation(coverage, { ...gaps, 'method-call-ambiguous': 1 })).toThrow(/0 method-call-ambiguous outcome\(s\) but 1 recorded/);
  });

  it('refuses sites of an older stage, a file outside the manifest and a site the catalog does not have', () => {
    const base = project(unit(['<bean class="com.acme.K" init-method="a"/>'], [klass('K', '  public void a() {}')]));
    const args = (sites) => ({ sites, catalog: CATALOG, table: null, manifestPaths: [CTX], types: null, javaRows: [], functionIds: new Map() });
    expect(() => resolveXmlMethodCalls(args({}))).toThrow(/have no methodCalls/);
    const row = base.sites.methodCalls[0];
    expect(() => resolveXmlMethodCalls({ ...args({ methodCalls: [{ ...row, file: 'elsewhere.xml' }] }), types: { declaredTypes: () => [] } })).toThrow(/outside the manifest/);
    expect(() => resolveXmlMethodCalls({ ...args({ methodCalls: [{ ...row, site: 'nope' }] }), types: { declaredTypes: () => [] } })).toThrow(/does not have/);
  });

  it('does not take a catalog without the section: a custom catalog with no family has no calls', () => {
    const raw = JSON.parse(JSON.stringify(CATALOG));
    raw.xmlMethodCalls = [];
    const p = project({ ...unit(['<bean class="com.acme.K" init-method="a"/>'], [klass('K', '  public void a() {}')]), catalog: parseNameBindingCatalog(raw) });
    expect(p.result.coverage.siteCount).toBe(0);
    expect(p.result.edges).toEqual([]);
  });
});
