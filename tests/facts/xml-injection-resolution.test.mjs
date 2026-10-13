// xml-injection-references, tasks 4.1-4.4: the resolution of XML injection
// sites into `injects` edges, visible buckets, gaps and coverage
// (skills/excavator/xml-injection-resolution.mjs), over the one binding table.
//
// Every input is real: small synthetic projects are read by the real
// name-reference stage (name-reference-sites.mjs) and the real binding table
// (name-reference-resolution.mjs); Java rows are what Core emits for the source
// text. Nothing here goes through buildFactGraph: wiring it in is task 5.2.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { collectNameReferenceSites } from '../../skills/excavator/name-reference-sites.mjs';
import { loadNameBindingCatalog, parseNameBindingCatalog } from '../../skills/excavator/name-binding-catalog.mjs';
import { buildNameBindingTable } from '../../skills/excavator/name-reference-resolution.mjs';
import {
  XML_INJECTION_BUCKETS,
  XML_INJECTION_GAP_KINDS,
  assertInjectionConservation,
  resolveXmlInjections,
} from '../../skills/excavator/xml-injection-resolution.mjs';

let registry;
beforeAll(async () => {
  const tsPlugin = new TreeSitterPlugin(builtinLanguageConfigs.filter((c) => c.treeSitter));
  await tsPlugin.init();
  registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);
});

const CATALOG = loadNameBindingCatalog();
const LANGUAGE_OF_EXTENSION = { xml: 'xml', xhtml: 'xhtml', jsp: 'jsp', properties: 'properties' };
const lines = (text) => (Array.isArray(text) ? text.join('\n') : text);
const POM = '<project/>';
const BEANS_OPEN = '<beans xmlns="http://www.springframework.org/schema/beans" xmlns:p="http://www.springframework.org/schema/p" xmlns:c="http://www.springframework.org/schema/c">';
const CTX = 'app/WEB-INF/ctx.xml';
/** A Spring context: the first definition is on line 2. */
const ctx = (...definitions) => [BEANS_OPEN, ...definitions.flat(), '</beans>'].join('\n');
/** A plain class of package com.acme in the unit `app`. */
const classFile = (name, pkg = 'com.acme') => [`app/src/${pkg.replaceAll('.', '/')}/${name}.java`, `package ${pkg};\n\npublic class ${name} {\n}\n`];
const javaOf = (...names) => Object.fromEntries(names.map((name) => classFile(name)));
const CLASS = (name) => `app/src/com/acme/${name}.java#${name}`;

/**
 * Read a synthetic project the way the Lazy driver does, up to the injection
 * resolution: the name-reference stage over the non-code files, the binding
 * table, then `resolveXmlInjections`.
 *
 * @param {{
 *   java?: Record<string, string>, files?: Record<string, string|string[]>, catalog?: object,
 *   mutations?: object, declaredTypes?: string[], languageOf?: (path: string) => string|undefined,
 * }} spec `declaredTypes` are classes the repository declares that have no node (an annotation type, a Kotlin class).
 */
function project({ java = {}, files = {}, catalog = CATALOG, mutations, declaredTypes = [], languageOf } = {}) {
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

  const classIds = new Map(javaRows.map((row) => [row.path, (row.classes ?? []).map((cls) => `class:${row.path}#${cls.name}`)]));
  const javaTypes = javaRows.flatMap((row) => (row.classes ?? []).map((cls, i) => ({ fqn: cls.qualifiedName, path: row.path, id: classIds.get(row.path)[i] })));
  const manifestPaths = Object.keys(texts);
  const scan = {
    files: manifestPaths.map((path) => ({ path, language: java[path] === undefined ? (LANGUAGE_OF_EXTENSION[extname(path).slice(1)] ?? 'unknown') : 'java' })),
  };
  const sites = collectNameReferenceSites({ scan, catalog, readFile: (path) => texts[path] });
  const none = { isType: () => false };
  const table = buildNameBindingTable({
    sites, catalog, manifestPaths, javaRows, classIds, javaTypes, otherJvm: none, mutations,
    declaredJavaTypes: { isType: (pkg, name) => declaredTypes.includes(`${pkg}.${name}`) },
  });
  const result = resolveXmlInjections({ sites, catalog, table, manifestPaths, languageOf, mutations });
  const label = (id) => id.replace(/^class:/, '');
  return {
    texts, sites, table, result,
    edges: result.edges,
    links: result.edges.map((e) => `${label(e.source)} -> ${label(e.target)}`).sort(),
    edge: (from, to) => result.edges.find((e) => label(e.source) === from && label(e.target) === to),
    buckets: result.coverage.buckets,
    gaps: (kind) => result.gaps.filter((g) => g.kind === kind),
    samples: (kind) => result.gaps.filter((g) => g.kind === kind).map((g) => g.sample),
  };
}

/** One unit, one context file, the classes the definitions name, and nothing else. */
const unit = (definitions, classes = [], extra = {}) => ({
  java: Object.fromEntries(classes.map((name) => classFile(name))),
  files: { 'app/pom.xml': POM, [CTX]: ctx(definitions), ...extra },
});

describe('the buckets and the gap kinds (design D6, D8)', () => {
  it('lists the fourteen buckets, and every one is a gap bucket, a no-gap bucket or the edge', () => {
    expect([...XML_INJECTION_BUCKETS].sort()).toEqual([
      'ambiguous', 'bundle', 'consumerAmbiguous', 'consumerExternal', 'consumerMissing', 'consumerUnindexed', 'consumerUnknown',
      'edge', 'elsewhere', 'external', 'outside', 'unbound', 'unindexed', 'unknown',
    ].sort());
    expect(new Set(XML_INJECTION_BUCKETS).size).toBe(14);
    expect(Object.isFrozen(XML_INJECTION_BUCKETS)).toBe(true);
  });

  it('maps the gap buckets to the five gap kinds, and leaves the edge, bundle and outside-the-repository buckets out', () => {
    expect(XML_INJECTION_GAP_KINDS).toEqual({
      outside: 'injection-target-unresolved',
      unindexed: 'injection-target-unresolved',
      unknown: 'injection-target-unresolved',
      ambiguous: 'injection-ambiguous',
      elsewhere: 'injection-elsewhere',
      unbound: 'injection-unbound',
      consumerMissing: 'injection-consumer-unresolved',
      consumerUnknown: 'injection-consumer-unresolved',
      consumerUnindexed: 'injection-consumer-unresolved',
      consumerAmbiguous: 'injection-consumer-unresolved',
    });
    for (const bucket of ['edge', 'bundle', 'external', 'consumerExternal']) expect(XML_INJECTION_GAP_KINDS[bucket]).toBeUndefined();
  });

  it('has a reason text in buildFactGraph for each of the five gap kinds, for the wiring of task 5.2 (the text is not exported)', () => {
    const source = readFileSync(new URL('../../skills/excavator/build-fact-graph.mjs', import.meta.url), 'utf-8');
    for (const kind of new Set(Object.values(XML_INJECTION_GAP_KINDS))) expect(source, kind).toContain(`'${kind}': '`);
  });
});

describe('a site that is an injects edge (spec: XML injection sites)', () => {
  it('draws consumer class -> target class for a property ref, citing the line of the ref (spec: property ref)', () => {
    const p = project(unit([
      '  <bean id="orderService" class="com.acme.OrderServiceImpl">',
      '    <property name="dao" ref="orderDao"/>',
      '  </bean>',
      '  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>',
    ], ['OrderServiceImpl', 'OrderDaoImpl']));
    expect(p.links).toEqual([`${CLASS('OrderServiceImpl')} -> ${CLASS('OrderDaoImpl')}`]);
    expect(p.edges[0]).toMatchObject({ type: 'injects', direction: 'forward', weight: 0.5, provenance: 'extracted' });
    expect(p.edges[0].evidence).toEqual([{
      file: CTX, line: 3, source: 'lexical', token: 'orderDao', site: 'spring-property-ref',
      consumer: { line: 2, bindings: [] },
      bindings: [{ file: CTX, line: 5, binder: 'spring-xml-bean' }],
    }]);
    expect(p.buckets).toMatchObject({ edge: 1 });
    expect(p.result.gaps).toEqual([]);
  });

  it('gives a ref in a collection the nearest bean as consumer (spec)', () => {
    const p = project(unit([
      '  <bean class="com.acme.Router">',
      '    <property name="handlers"><list><ref bean="orderHandler"/></list></property>',
      '  </bean>',
      '  <bean id="orderHandler" class="com.acme.OrderHandler"/>',
    ], ['Router', 'OrderHandler']));
    expect(p.links).toEqual([`${CLASS('Router')} -> ${CLASS('OrderHandler')}`]);
    expect(p.edges[0].evidence[0]).toMatchObject({ site: 'spring-ref-bean', token: 'orderHandler', line: 3, consumer: { line: 2, bindings: [] } });
  });

  it('gives an inner bean\'s site to the inner bean, not the outer one (spec)', () => {
    const p = project(unit([
      '  <bean id="a" class="com.acme.A">',
      '    <property name="p">',
      '      <bean class="com.acme.Inner">',
      '        <property name="q" ref="x"/>',
      '      </bean>',
      '    </property>',
      '  </bean>',
      '  <bean id="x" class="com.acme.X"/>',
    ], ['A', 'Inner', 'X']));
    expect(p.links).toEqual([`${CLASS('Inner')} -> ${CLASS('X')}`]);
  });

  it('draws an edge for an attribute of the p namespace, the bean it sits on being the consumer (spec)', () => {
    const p = project(unit(['  <bean class="com.acme.Report" p:source-ref="orderDao"/>', '  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>'], ['Report', 'OrderDaoImpl']));
    expect(p.links).toEqual([`${CLASS('Report')} -> ${CLASS('OrderDaoImpl')}`]);
    expect(p.edges[0].evidence[0]).toMatchObject({ site: 'spring-p-ref', token: 'orderDao', line: 2, consumer: { line: 2 } });
  });

  it('reads every site shape the catalog lists as a way to name a bean: constructor-arg, entry key-ref and value-ref, lookup-method, replaced-method, c namespace', () => {
    const p = project(unit([
      '  <bean class="com.acme.Hub" c:mail-ref="mailer">',
      '    <constructor-arg ref="dao"/>',
      '    <property name="m"><map><entry key-ref="keyBean" value-ref="valueBean"/></map></property>',
      '    <lookup-method name="make" bean="proto"/>',
      '    <replaced-method name="calc" replacer="calculator"/>',
      '  </bean>',
      '  <bean id="mailer" class="com.acme.Mailer"/>',
      '  <bean id="dao" class="com.acme.Dao"/>',
      '  <bean id="keyBean" class="com.acme.KeyBean"/>',
      '  <bean id="valueBean" class="com.acme.ValueBean"/>',
      '  <bean id="proto" class="com.acme.Proto"/>',
      '  <bean id="calculator" class="com.acme.Calculator"/>',
    ], ['Hub', 'Mailer', 'Dao', 'KeyBean', 'ValueBean', 'Proto', 'Calculator']));
    expect(p.links).toEqual(['Mailer', 'Dao', 'KeyBean', 'ValueBean', 'Proto', 'Calculator'].map((name) => `${CLASS('Hub')} -> ${CLASS(name)}`).sort());
    expect(p.result.coverage.sites).toMatchObject({
      'spring-c-ref': 1, 'spring-constructor-arg-ref': 1, 'spring-entry-key-ref': 1, 'spring-entry-value-ref': 1, 'spring-lookup-method': 1, 'spring-replaced-method': 1,
    });
  });

  it('matches a name as it is written, a dotted id included, though no expression could reach it (spec: dotted bean id)', () => {
    const p = project(unit([
      '  <bean id="com.acme.api.OrderService" class="com.acme.OrderServiceImpl"/>',
      '  <bean class="com.acme.Web"><property name="s" ref="com.acme.api.OrderService"/></bean>',
    ], ['OrderServiceImpl', 'Web']));
    expect(p.links).toEqual([`${CLASS('Web')} -> ${CLASS('OrderServiceImpl')}`]);
    expect(p.table.bindings.find((b) => b.name === 'com.acme.api.OrderService').el).toBe(false);
  });

  it('takes a target an annotation declares, citing the annotation line as the binding (spec: annotation target)', () => {
    const repo = `package com.acme;\nimport org.springframework.stereotype.Repository;\n\n@Repository("orderDao")\npublic class JdbcOrderDao {\n}\n`;
    const p = project({
      ...unit(['  <bean class="com.acme.OrderServiceImpl"><property name="dao" ref="orderDao"/></bean>'], ['OrderServiceImpl']),
      java: { ...javaOf('OrderServiceImpl'), 'app/src/com/acme/JdbcOrderDao.java': repo },
    });
    expect(p.links).toEqual([`${CLASS('OrderServiceImpl')} -> ${CLASS('JdbcOrderDao')}`]);
    expect(p.edges[0].evidence[0].bindings).toEqual([{ file: 'app/src/com/acme/JdbcOrderDao.java', line: 4, binder: 'spring-annotation-stereotype' }]);
  });

  it('takes a target through an alias, citing both the alias and the bean definition (spec: alias)', () => {
    const p = project(unit([
      '  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>',
      '  <alias name="orderDao" alias="orders"/>',
      '  <bean class="com.acme.Service"><property name="dao" ref="orders"/></bean>',
    ], ['OrderDaoImpl', 'Service']));
    expect(p.links).toEqual([`${CLASS('Service')} -> ${CLASS('OrderDaoImpl')}`]);
    expect(p.edges[0].evidence[0].bindings).toEqual([
      { file: CTX, line: 2, binder: 'spring-xml-bean' },
      { file: CTX, line: 3, binder: 'spring-xml-alias' },
    ]);
  });

  it('takes a target through a parent, an alias of a parent and a chain, citing every hop', () => {
    const p = project(unit([
      '  <bean id="base" class="com.acme.BaseDao"/>',
      '  <bean id="child" parent="base"/>',
      '  <alias name="child" alias="kid"/>',
      '  <bean class="com.acme.Service"><property name="dao" ref="kid"/></bean>',
    ], ['BaseDao', 'Service']));
    expect(p.links).toEqual([`${CLASS('Service')} -> ${CLASS('BaseDao')}`]);
    expect(p.edges[0].evidence[0].bindings.map((b) => [b.line, b.binder])).toEqual([[2, 'spring-xml-bean'], [3, 'spring-xml-bean'], [4, 'spring-xml-alias']]);
  });

  it('takes the class of a parent for the consumer, citing the parent definition (spec: consumer inherits)', () => {
    const p = project(unit([
      '  <bean id="baseDao" class="com.acme.BaseDao"/>',
      '  <bean id="userDao" parent="baseDao">',
      '    <property name="ds" ref="mainDs"/>',
      '  </bean>',
      '  <bean id="mainDs" class="com.acme.MainDs"/>',
    ], ['BaseDao', 'MainDs']));
    expect(p.links).toEqual([`${CLASS('BaseDao')} -> ${CLASS('MainDs')}`]);
    expect(p.edges[0].evidence[0].consumer).toEqual({ line: 3, bindings: [{ file: CTX, line: 2, binder: 'spring-xml-bean' }] });
  });

  it('draws one edge for a consumer class and a target class, with the evidence of every site, sorted and without repeats', () => {
    const p = project(unit([
      '  <bean id="a" class="com.acme.Service"><property name="d" ref="dao"/><property name="e" ref="orders"/></bean>',
      '  <bean id="b" class="com.acme.Service"><property name="d" ref="dao"/></bean>',
      '  <bean id="dao" class="com.acme.Dao"/>',
      '  <alias name="dao" alias="orders"/>',
    ], ['Service', 'Dao']));
    expect(p.edges).toHaveLength(1);
    expect(p.edges[0].evidence.map((e) => [e.line, e.token, e.site])).toEqual([
      [2, 'dao', 'spring-property-ref'], [2, 'orders', 'spring-property-ref'], [3, 'dao', 'spring-property-ref'],
    ]);
    expect(p.buckets.edge).toBe(3);
  });

  it('sorts the evidence by file, line, token and site, whatever order the sites were read in', () => {
    // the manifest lists z.xml before a.xml, and one line writes its refs in the reverse of the alphabet
    const p = project({
      java: javaOf('Service', 'Dao'),
      files: {
        'app/pom.xml': POM,
        'app/WEB-INF/z.xml': ctx('  <bean class="com.acme.Service"><property name="d" ref="dao"/></bean>'),
        'app/WEB-INF/a.xml': ctx('  <bean class="com.acme.Service"><property name="m"><map><entry key-ref="zeta" value-ref="alpha"/></map></property></bean>'),
        'app/WEB-INF/dao.xml': ctx('  <bean id="dao" class="com.acme.Dao"/>', '  <alias name="dao" alias="zeta"/>', '  <alias name="dao" alias="alpha"/>'),
      },
    });
    expect(p.edges).toHaveLength(1);
    expect(p.edges[0].evidence.map((e) => [e.file, e.line, e.token, e.site])).toEqual([
      ['app/WEB-INF/a.xml', 2, 'alpha', 'spring-entry-value-ref'],
      ['app/WEB-INF/a.xml', 2, 'zeta', 'spring-entry-key-ref'],
      ['app/WEB-INF/z.xml', 2, 'dao', 'spring-property-ref'],
    ]);
  });

  it('cites a line once for two sites that write the same token with the same site id on it, both counted in the buckets', () => {
    const p = project(unit([
      '  <bean class="com.acme.Service"><property name="a" ref="dao"/><property name="b" ref="dao"/></bean>',
      '  <bean id="dao" class="com.acme.Dao"/>',
    ], ['Service', 'Dao']));
    expect(p.buckets.edge).toBe(2);
    expect(p.edges).toHaveLength(1);
    expect(p.edges[0].evidence).toHaveLength(1);
  });

  it('draws a self-loop when a bean is injected with another bean of its own class', () => {
    const p = project(unit([
      '  <bean id="primary" class="com.acme.Node"><property name="next" ref="secondary"/></bean>',
      '  <bean id="secondary" class="com.acme.Node"/>',
    ], ['Node']));
    expect(p.links).toEqual([`${CLASS('Node')} -> ${CLASS('Node')}`]);
    expect(p.edges[0].source).toBe(p.edges[0].target);
  });

  it('keeps two sites of one element apart, in one edge or two, by their site ids (entry key-ref and value-ref to one bean)', () => {
    const p = project(unit([
      '  <bean class="com.acme.Hub"><property name="m"><map><entry key-ref="k" value-ref="k"/></map></property></bean>',
      '  <bean id="k" class="com.acme.K"/>',
    ], ['Hub', 'K']));
    expect(p.edges).toHaveLength(1);
    expect(p.edges[0].evidence.map((e) => [e.site, e.token])).toEqual([['spring-entry-key-ref', 'k'], ['spring-entry-value-ref', 'k']]);
    // written the other way round, the same evidence comes out in the same order
    const reversed = project(unit([
      '  <bean class="com.acme.Hub"><property name="m"><map><entry value-ref="k" key-ref="k"/></map></property></bean>',
      '  <bean id="k" class="com.acme.K"/>',
    ], ['Hub', 'K']));
    expect(reversed.edges[0].evidence.map((e) => e.site)).toEqual(['spring-entry-key-ref', 'spring-entry-value-ref']);
  });

  it('is checkable: the line of every evidence holds its token, and each binding line holds the binding\'s name or an annotation (spec: checkable evidence)', () => {
    const repo = `package com.acme;\nimport org.springframework.stereotype.Component;\n\n@Component("annotated")\npublic class Annotated {\n}\n`;
    const p = project({
      ...unit([
        '  <bean id="base" class="com.acme.BaseDao"/>',
        '  <bean id="child" parent="base"><property name="x" ref="aliased"/><property name="y" ref="annotated"/></bean>',
        '  <bean id="target" class="com.acme.Target"/>',
        '  <alias name="target" alias="aliased"/>',
      ], ['BaseDao', 'Target']),
      java: { ...javaOf('BaseDao', 'Target'), 'app/src/com/acme/Annotated.java': repo },
    });
    expect(p.edges.length).toBeGreaterThan(0);
    for (const edge of p.edges) {
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
  });
});

describe('where a name is looked for (design D6)', () => {
  const SERVICE = '  <bean class="com.acme.Service"><property name="d" ref="orderDao"/></bean>';
  const DAO = '  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>';

  it('is "outside" for a ref parent, though the unit has a bean of that name: the parent container is not seen (spec)', () => {
    const p = project(unit(['  <bean class="com.acme.Service"><property name="d"><ref parent="orderDao"/></property></bean>', DAO], ['Service', 'OrderDaoImpl']));
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ outside: 1, edge: 0 });
    expect(p.samples('injection-target-unresolved')).toEqual([`${CTX}:2 orderDao -> [outside]`]);
  });

  it('is only the same file for a ref local: a bean of that name in another file of the unit is "elsewhere" (spec)', () => {
    const p = project(unit(['  <bean class="com.acme.Service"><property name="d"><ref local="orderDao"/></property></bean>'], ['Service', 'OrderDaoImpl'], {
      'app/WEB-INF/other.xml': ctx(DAO),
    }));
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ elsewhere: 1 });
    expect(p.samples('injection-elsewhere')).toEqual([`${CTX}:2 orderDao -> [app [spring] in app/WEB-INF/other.xml]`]);
  });

  it('is an edge for a ref local when the bean is in the same file, whose target an alias or parent resolves in another file of the unit', () => {
    const same = project(unit(['  <bean class="com.acme.Service"><property name="d"><ref local="orderDao"/></property></bean>', DAO], ['Service', 'OrderDaoImpl']));
    expect(same.links).toEqual([`${CLASS('Service')} -> ${CLASS('OrderDaoImpl')}`]);
    expect(same.edges[0].evidence[0].site).toBe('spring-ref-local');
    // the name is found in this file; where its target is declared is the unit's business (design D6)
    const aliased = project(unit(
      ['  <bean class="com.acme.Service"><property name="d"><ref local="orders"/></property></bean>', '  <alias name="orderDao" alias="orders"/>'],
      ['Service', 'OrderDaoImpl'],
      { 'app/WEB-INF/other.xml': ctx(DAO) },
    ));
    expect(aliased.links).toEqual([`${CLASS('Service')} -> ${CLASS('OrderDaoImpl')}`]);
    expect(aliased.edges[0].evidence[0].bindings.map((b) => b.file)).toEqual([CTX, 'app/WEB-INF/other.xml'].sort());
  });

  it('is "elsewhere" for a name only another unit declares, the sample listing that unit (spec)', () => {
    const p = project({
      java: javaOf('Service', 'Directory'),
      files: {
        'a/pom.xml': POM, 'a/ctx.xml': ctx('  <bean class="com.acme.Service"><property name="d" ref="userDirectory"/></bean>'),
        'b/pom.xml': POM, 'b/ctx.xml': ctx('  <bean id="userDirectory" class="com.acme.Directory"/>'),
      },
    });
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ elsewhere: 1 });
    expect(p.samples('injection-elsewhere')).toEqual(['a/ctx.xml:2 userDirectory -> [b [spring]]']);
  });

  it('is "elsewhere" for a name only another namespace declares, the sample naming the namespace', () => {
    const named = `package com.acme;\nimport javax.inject.Named;\n\n@Named("orderDao")\npublic class CdiDao {\n}\n`;
    const p = project({ ...unit([SERVICE], ['Service']), java: { ...javaOf('Service'), 'app/src/com/acme/CdiDao.java': named } });
    expect(p.links).toEqual([]);
    expect(p.samples('injection-elsewhere')).toEqual([`${CTX}:2 orderDao -> [app [el]]`]);
  });

  it('is "unbound" for a name no binding anywhere declares, a gap with no candidates', () => {
    const p = project(unit([SERVICE], ['Service']));
    expect(p.buckets).toMatchObject({ unbound: 1 });
    expect(p.samples('injection-unbound')).toEqual([`${CTX}:2 orderDao -> []`]);
  });

  it('is "ambiguous" for a name two files of the unit declare as different classes, the sample naming both (spec)', () => {
    const p = project(unit(
      ['  <bean id="mailer" class="com.acme.SmtpMailer"/>', '  <bean class="com.acme.Service"><property name="m" ref="mailer"/></bean>'],
      ['SmtpMailer', 'FakeMailer', 'Service'],
      { 'app/WEB-INF/test.xml': ctx('  <bean id="mailer" class="com.acme.FakeMailer"/>') },
    ));
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ ambiguous: 1 });
    expect(p.samples('injection-ambiguous')).toEqual([`${CTX}:3 mailer -> [${CLASS('FakeMailer')}, ${CLASS('SmtpMailer')}]`]);
  });

  it('is an edge when a name declared twice names the same class: the declarations agree', () => {
    const p = project(unit(
      ['  <bean id="mailer" class="com.acme.SmtpMailer"/>', '  <bean class="com.acme.Service"><property name="m" ref="mailer"/></bean>'],
      ['SmtpMailer', 'Service'],
      { 'app/WEB-INF/test.xml': ctx('  <bean id="mailer" class="com.acme.SmtpMailer"/>') },
    ));
    expect(p.links).toEqual([`${CLASS('Service')} -> ${CLASS('SmtpMailer')}`]);
    expect(p.edges[0].evidence[0].bindings.map((b) => b.file)).toEqual([CTX, 'app/WEB-INF/test.xml']);
  });

  it('is "external", no gap, for a bean whose class is not the repository\'s (spec)', () => {
    const p = project(unit([
      '  <bean id="dataSource" class="org.apache.commons.dbcp.BasicDataSource"/>',
      '  <bean class="com.acme.Service"><property name="ds" ref="dataSource"/></bean>',
    ], ['Service']));
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ external: 1 });
    expect(p.result.gaps).toEqual([]);
  });

  it('is "unindexed" for a class the repository declares and has no node for, the sample naming the type', () => {
    const p = project({ ...unit(['  <bean id="marker" class="com.acme.Marker"/>', '  <bean class="com.acme.Service"><property name="m" ref="marker"/></bean>'], ['Service']), declaredTypes: ['com.acme.Marker'] });
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ unindexed: 1 });
    expect(p.samples('injection-target-unresolved')).toEqual([`${CTX}:3 marker -> [com.acme.Marker]`]);
  });

  it('is "unknown" for a factory-method bean, though it writes a class: the sample names the attribute (spec)', () => {
    const p = project(unit([
      '  <bean id="svc" class="com.acme.ServiceLocator" factory-method="lookup"/>',
      '  <bean class="com.acme.Service"><property name="s" ref="svc"/></bean>',
    ], ['ServiceLocator', 'Service']));
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ unknown: 1 });
    expect(p.samples('injection-target-unresolved')).toEqual([`${CTX}:3 svc -> [${CTX}:2 (factory-method)]`]);
  });

  it('is "unknown" for a parent-only bean whose parent is in no file of the unit, the sample giving the reason', () => {
    const p = project(unit(['  <bean id="child" parent="missing"/>', '  <bean class="com.acme.Service"><property name="s" ref="child"/></bean>'], ['Service']));
    expect(p.buckets).toMatchObject({ unknown: 1 });
    expect(p.samples('injection-target-unresolved')).toEqual([`${CTX}:3 child -> [${CTX}:2 (missing has no binding in this unit)]`]);
  });

  it('is "unknown" for a cycle of aliases', () => {
    const p = project(unit(['  <alias name="a" alias="b"/>', '  <alias name="b" alias="a"/>', '  <bean class="com.acme.Service"><property name="s" ref="a"/></bean>'], ['Service']));
    expect(p.buckets).toMatchObject({ unknown: 1 });
    expect(p.samples('injection-target-unresolved')[0]).toContain('(cycle)');
  });

  it('is "bundle", no gap, for a name that is a resource bundle in the family\'s namespace', () => {
    const catalog = JSON.parse(JSON.stringify(CATALOG));
    catalog.xmlBinders.push({
      id: 'spring-xml-bundle', namespace: 'spring', basis: 'A test binder: a bundle element of a beans root registers a resource bundle under its id.',
      root: 'beans', rootNamespace: ['http://www.springframework.org/schema/beans', null], element: 'bundle', parent: 'beans',
      name: { attribute: ['id'] }, target: { kind: 'bundle', attribute: 'basename' }, namespacedNames: false, missingTarget: 'unknown',
    });
    const p = project({
      ...unit(['  <bundle id="messages" basename="com.acme.Messages"/>', '  <bean class="com.acme.Service"><property name="m" ref="messages"/></bean>'], ['Service']),
      catalog: parseNameBindingCatalog(catalog),
    });
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ bundle: 1 });
    expect(p.result.gaps).toEqual([]);
  });

  it('decides the target before the consumer: a name nothing declares is "unbound" even where there is no consumer', () => {
    const p = project(unit(['  <util:list id="l"><ref bean="nothing"/></util:list>'], []));
    expect(p.buckets).toMatchObject({ unbound: 1, consumerMissing: 0 });
  });
});

describe('the consumer (design D5, D6)', () => {
  const DAO = '  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>';

  it('is missing for a site outside every bean, as a ref in a top-level collection: "consumerMissing", a gap (spec)', () => {
    const p = project(unit(['  <util:list id="handlers">', '    <ref bean="orderDao"/>', '  </util:list>', DAO], ['OrderDaoImpl']));
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ consumerMissing: 1 });
    expect(p.samples('injection-consumer-unresolved')).toEqual([`${CTX}:3 orderDao -> [consumerMissing: no enclosing bean element]`]);
  });

  it('is unknown for a factory-method bean that consumes the injection: "consumerUnknown", a gap (spec)', () => {
    const p = project(unit(['  <bean id="ctx" class="com.acme.Context" factory-method="getInstance"><property name="dao" ref="orderDao"/></bean>', DAO], ['Context', 'OrderDaoImpl']));
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ consumerUnknown: 1 });
    expect(p.samples('injection-consumer-unresolved')).toEqual([`${CTX}:2 orderDao -> [consumerUnknown: factory-method]`]);
  });

  it('is unknown when the parent it names has no binding in the unit, the sample giving the reason (spec)', () => {
    const p = project(unit(['  <bean id="child" parent="base"><property name="dao" ref="orderDao"/></bean>', DAO], ['OrderDaoImpl']));
    expect(p.buckets).toMatchObject({ consumerUnknown: 1 });
    expect(p.samples('injection-consumer-unresolved')).toEqual([`${CTX}:2 orderDao -> [consumerUnknown: base has no binding in this unit]`]);
  });

  it('is unknown for a bean that writes no class and names no parent: an anonymous bean of no class', () => {
    const p = project(unit(['  <bean><property name="dao" ref="orderDao"/></bean>', DAO], ['OrderDaoImpl']));
    expect(p.buckets).toMatchObject({ consumerUnknown: 1 });
    expect(p.samples('injection-consumer-unresolved')).toEqual([`${CTX}:2 orderDao -> [consumerUnknown: (no target)]`]);
  });

  it('is outside the repository for a class the repository does not have: "consumerExternal", no gap (spec)', () => {
    const p = project(unit([
      '  <bean class="org.springframework.transaction.interceptor.TransactionProxyFactoryBean"><property name="target" ref="orderServiceTarget"/></bean>',
      '  <bean id="orderServiceTarget" class="com.acme.OrderDaoImpl"/>',
    ], ['OrderDaoImpl']));
    expect(p.links).toEqual([]);
    expect(p.buckets).toMatchObject({ consumerExternal: 1 });
    expect(p.result.gaps).toEqual([]);
  });

  it('is "consumerExternal" too when the parent it names is a bean of an outside class', () => {
    const p = project(unit(['  <bean id="proxy" class="org.acme.Outside"/>', '  <bean parent="proxy"><property name="t" ref="orderDao"/></bean>', DAO], ['OrderDaoImpl']));
    expect(p.buckets).toMatchObject({ consumerExternal: 1 });
  });

  it('is "consumerUnindexed" for a class the repository declares and has no node for, the sample naming the type', () => {
    const p = project({ ...unit(['  <bean class="com.acme.Marker"><property name="dao" ref="orderDao"/></bean>', DAO], ['OrderDaoImpl']), declaredTypes: ['com.acme.Marker'] });
    expect(p.buckets).toMatchObject({ consumerUnindexed: 1 });
    expect(p.samples('injection-consumer-unresolved')).toEqual([`${CTX}:2 orderDao -> [consumerUnindexed: com.acme.Marker]`]);
  });

  it('is "consumerAmbiguous" for a class name two declarations carry, the sample naming both', () => {
    const p = project({
      ...unit(['  <bean class="com.acme.Dup"><property name="dao" ref="orderDao"/></bean>', DAO], ['OrderDaoImpl']),
      java: { ...javaOf('OrderDaoImpl'), 'app/src/one/Dup.java': 'package com.acme;\n\npublic class Dup {\n}\n', 'app/src/two/Dup.java': 'package com.acme;\n\npublic class Dup {\n}\n' },
    });
    expect(p.buckets).toMatchObject({ consumerAmbiguous: 1 });
    expect(p.samples('injection-consumer-unresolved')).toEqual([`${CTX}:2 orderDao -> [consumerAmbiguous: app/src/one/Dup.java#Dup, app/src/two/Dup.java#Dup]`]);
  });

  it('reads a consumer\'s parent in the unit and the family\'s namespace only, not another unit\'s', () => {
    const p = project({
      java: javaOf('BaseDao', 'OrderDaoImpl'),
      files: {
        'a/pom.xml': POM, 'a/ctx.xml': ctx('  <bean parent="baseDao"><property name="dao" ref="orderDao"/></bean>', DAO),
        'b/pom.xml': POM, 'b/ctx.xml': ctx('  <bean id="baseDao" class="com.acme.BaseDao"/>'),
      },
    });
    expect(p.buckets).toMatchObject({ consumerUnknown: 1, edge: 0 });
  });
});

describe('what a run says (design D8)', () => {
  const everyBucket = () => project({
    java: javaOf('Service', 'OrderDaoImpl', 'Fake', 'Context'),
    declaredTypes: ['com.acme.Marker'],
    files: {
      'app/pom.xml': POM,
      [CTX]: ctx(
        '  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>',
        '  <bean id="dataSource" class="org.apache.commons.dbcp.BasicDataSource"/>',
        '  <bean id="marker" class="com.acme.Marker"/>',
        '  <bean id="svc" class="com.acme.Fake" factory-method="make"/>',
        '  <bean id="mailer" class="com.acme.Service"/>',
        '  <bean id="a" class="com.acme.Service">',
        '    <property name="p1" ref="orderDao"/>',
        '    <property name="p2" ref="dataSource"/>',
        '    <property name="p3" ref="marker"/>',
        '    <property name="p4" ref="svc"/>',
        '    <property name="p5" ref="mailer"/>',
        '    <property name="p6" ref="nowhere"/>',
        '    <property name="p7"><ref parent="orderDao"/></property>',
        '    <property name="p8" ref="foreign"/>',
        '  </bean>',
        '  <bean class="com.acme.Context" factory-method="get"><property name="c1" ref="orderDao"/></bean>',
        '  <bean class="org.acme.Proxy"><property name="c2" ref="orderDao"/></bean>',
        '  <util:list id="l"><ref bean="orderDao"/></util:list>',
      ),
      'app/WEB-INF/test.xml': ctx('  <bean id="mailer" class="com.acme.Fake"/>'),
      'other/pom.xml': POM,
      'other/ctx.xml': ctx('  <bean id="foreign" class="com.acme.OrderDaoImpl"/>'),
    },
  });

  it('puts every site in exactly one bucket, and the fourteen add up to the site count (conservation)', () => {
    const { result } = everyBucket();
    const { coverage } = result;
    expect(Object.keys(coverage.buckets)).toEqual([...XML_INJECTION_BUCKETS]);
    expect(coverage.siteCount).toBe(11);
    expect(Object.values(coverage.buckets).reduce((a, b) => a + b, 0)).toBe(coverage.siteCount);
    expect(coverage.buckets).toEqual({
      outside: 1, bundle: 0, external: 1, unindexed: 1, unknown: 1, ambiguous: 1, elsewhere: 1, unbound: 1, edge: 1,
      consumerExternal: 1, consumerMissing: 1, consumerUnknown: 1, consumerUnindexed: 0, consumerAmbiguous: 0,
    });
  });

  it('records the five gap kinds, each with the count of its buckets, and nothing for the buckets that are no gap', () => {
    const p = everyBucket();
    const counts = {};
    for (const gap of p.result.gaps) counts[gap.kind] = (counts[gap.kind] ?? 0) + 1;
    expect(counts).toEqual({
      'injection-target-unresolved': 3, // outside, unindexed, unknown
      'injection-ambiguous': 1,
      'injection-elsewhere': 1,
      'injection-unbound': 1,
      'injection-consumer-unresolved': 2, // missing, unknown
    });
    expect(() => assertInjectionConservation(p.result.coverage, Object.fromEntries(Object.entries(counts)))).not.toThrow();
  });

  it('gives each gap the language of the XML file it is in as its scope, xml when none is known', () => {
    expect(new Set(everyBucket().result.gaps.map((g) => g.scope))).toEqual(new Set(['xml']));
    const p = project({ ...unit(['  <bean class="com.acme.Service"><property name="d" ref="nowhere"/></bean>'], ['Service']), languageOf: (path) => (path === CTX ? 'spring' : undefined) });
    expect(p.result.gaps).toEqual([{ kind: 'injection-unbound', scope: 'spring', sample: `${CTX}:2 nowhere -> []` }]);
  });

  it('counts the sites by id, every id of every family listed with zeros', () => {
    const { result } = everyBucket();
    expect(Object.keys(result.coverage.sites)).toEqual(CATALOG.xmlInjections.flatMap((f) => f.sites.map((s) => s.id)));
    expect(result.coverage.sites).toMatchObject({ 'spring-property-ref': 9, 'spring-ref-parent': 1, 'spring-ref-bean': 1, 'spring-p-ref': 0, 'spring-c-ref': 0, 'spring-ref-local': 0 });
    expect(Object.values(result.coverage.sites).reduce((a, b) => a + b, 0)).toBe(result.coverage.siteCount);
  });

  it('carries the files read per family, the census it was given, and the status', () => {
    const p = everyBucket();
    expect(p.result.coverage).toMatchObject({ status: 'ran', files: { 'spring-xml-injection': 3 }, uncovered: p.sites.uncoveredReferences });
    expect(p.result.coverage.uncovered).toEqual({});
    const idref = project(unit(['  <bean class="com.acme.Service"><idref bean="x"/></bean>'], ['Service']));
    expect(idref.result.coverage.uncovered).toEqual({ idref: 1 });
    expect(idref.result.coverage.siteCount).toBe(0);
    expect(idref.result.coverage.buckets).toEqual(Object.fromEntries(XML_INJECTION_BUCKETS.map((b) => [b, 0])));
  });

  it('is a run with nothing to resolve when no file holds a site: all zeros, still ran', () => {
    const p = project({ files: { 'app/pom.xml': POM, 'app/x.xml': '<other/>' } });
    expect(p.result).toEqual({ edges: [], gaps: [], coverage: expect.objectContaining({ status: 'ran', siteCount: 0, files: { 'spring-xml-injection': 0 } }) });
  });
});

describe('conservation (design D8; spec: unbalanced conservation fails the build)', () => {
  const balanced = () => ({
    siteCount: 14,
    buckets: Object.fromEntries(XML_INJECTION_BUCKETS.map((bucket) => [bucket, 1])),
  });
  const kinds = {
    'injection-target-unresolved': 3, 'injection-ambiguous': 1, 'injection-elsewhere': 1, 'injection-unbound': 1, 'injection-consumer-unresolved': 4,
  };

  it('holds for fourteen buckets that add up and gaps that read back to their buckets', () => {
    expect(() => assertInjectionConservation(balanced(), kinds)).not.toThrow();
  });

  it('fails when the buckets do not add up to the site count, in either direction', () => {
    expect(() => assertInjectionConservation({ ...balanced(), siteCount: 15 }, kinds)).toThrow(/15 injection site\(s\) but 14 outcome\(s\)/);
    expect(() => assertInjectionConservation({ ...balanced(), siteCount: 13 }, kinds)).toThrow(/13 injection site\(s\) but 14 outcome\(s\)/);
  });

  it('fails when the gaps read back of a kind differ from the sum of its buckets, for each of the five kinds', () => {
    for (const kind of Object.keys(kinds)) {
      expect(() => assertInjectionConservation(balanced(), { ...kinds, [kind]: kinds[kind] + 1 }), kind).toThrow(new RegExp(`${kind} outcome\\(s\\) but`));
      expect(() => assertInjectionConservation(balanced(), { ...kinds, [kind]: kinds[kind] - 1 }), kind).toThrow(new RegExp(kind));
    }
  });

  it('fails when a gap kind is not read back at all', () => {
    const { 'injection-unbound': dropped, ...rest } = kinds;
    expect(dropped).toBe(1);
    expect(() => assertInjectionConservation(balanced(), rest)).toThrow(/injection-unbound/);
  });

  it('fails on a coverage whose bucket is missing', () => {
    const missing = balanced();
    delete missing.buckets.edge;
    expect(() => assertInjectionConservation(missing, kinds)).toThrow();
  });
});

describe('inputs it cannot place fail (as the expression stage fails on them)', () => {
  const base = () => project(unit(['  <bean class="com.acme.Service"><property name="d" ref="orderDao"/></bean>', '  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>'], ['Service', 'OrderDaoImpl']));
  const resolveWith = (p, edit) => () => resolveXmlInjections({
    sites: edit(structuredClone(p.sites)), catalog: CATALOG, table: p.table, manifestPaths: Object.keys(p.texts),
  });

  it('accepts what the stage produced', () => {
    const p = base();
    expect(resolveWith(p, (x) => x)).not.toThrow();
  });

  it('fails on a site in a file outside the manifest', () => {
    expect(resolveWith(base(), (x) => { x.injections[0].file = 'elsewhere.xml'; return x; })).toThrow(/injection site in a file outside the manifest: elsewhere\.xml/);
  });

  it('fails on a family or a site id the catalog does not have, and on a site id of another family', () => {
    expect(resolveWith(base(), (x) => { x.injections[0].family = 'nope'; return x; })).toThrow(/family "nope", which the catalog does not have/);
    expect(resolveWith(base(), (x) => { x.injections[0].site = 'nope'; return x; })).toThrow(/site "nope", which the family "spring-xml-injection" does not have/);
  });

  it('fails on a scope that is none of unit, file and outside', () => {
    expect(resolveWith(base(), (x) => { x.injections[0].scope = 'global'; return x; })).toThrow(/scope "global"/);
  });

  it('fails on sites with no injection rows, the output of an older stage', () => {
    const p = base();
    expect(() => resolveXmlInjections({ sites: { files: [] }, catalog: CATALOG, table: p.table, manifestPaths: [] })).toThrow(/no injections/);
  });
});

describe('mutation tripwires (design D11)', () => {
  const DAO = '  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>';

  it('injectionIgnoreUnits: a name another unit declares is taken for a name of this one', () => {
    const spec = {
      java: javaOf('Service', 'Directory'),
      files: {
        'a/pom.xml': POM, 'a/ctx.xml': ctx('  <bean class="com.acme.Service"><property name="d" ref="userDirectory"/></bean>'),
        'b/pom.xml': POM, 'b/ctx.xml': ctx('  <bean id="userDirectory" class="com.acme.Directory"/>'),
      },
    };
    expect(project(spec).links).toEqual([]);
    expect(project(spec).buckets).toMatchObject({ elsewhere: 1 });
    const mutated = project({ ...spec, mutations: { injectionIgnoreUnits: true } });
    expect(mutated.links).toEqual([`${CLASS('Service')} -> ${CLASS('Directory')}`]);
    expect(mutated.buckets).toMatchObject({ edge: 1, elsewhere: 0 });
  });

  it('injectionIgnoreUnits: another namespace is still another namespace', () => {
    const named = `package com.acme;\nimport javax.inject.Named;\n\n@Named("orderDao")\npublic class CdiDao {\n}\n`;
    const spec = { ...unit(['  <bean class="com.acme.Service"><property name="d" ref="orderDao"/></bean>'], ['Service']), java: { ...javaOf('Service'), 'app/src/com/acme/CdiDao.java': named } };
    expect(project({ ...spec, mutations: { injectionIgnoreUnits: true } }).buckets).toMatchObject({ elsewhere: 1, edge: 0 });
  });

  it('injectionFirstBinding: a name two classes carry resolves to the first of them', () => {
    const spec = unit(
      ['  <bean id="mailer" class="com.acme.SmtpMailer"/>', '  <bean class="com.acme.Service"><property name="m" ref="mailer"/></bean>'],
      ['SmtpMailer', 'FakeMailer', 'Service'],
      { 'app/WEB-INF/test.xml': ctx('  <bean id="mailer" class="com.acme.FakeMailer"/>') },
    );
    expect(project(spec).buckets).toMatchObject({ ambiguous: 1, edge: 0 });
    const mutated = project({ ...spec, mutations: { injectionFirstBinding: true } });
    expect(mutated.links).toEqual([`${CLASS('Service')} -> ${CLASS('SmtpMailer')}`]);
    expect(mutated.buckets).toMatchObject({ ambiguous: 0, edge: 1 });
  });

  it('ignoreFileScope: a ref local looks at the unit, as any other ref does', () => {
    const spec = unit(['  <bean class="com.acme.Service"><property name="d"><ref local="orderDao"/></property></bean>'], ['Service', 'OrderDaoImpl'], { 'app/WEB-INF/other.xml': ctx(DAO) });
    expect(project(spec).buckets).toMatchObject({ elsewhere: 1, edge: 0 });
    const mutated = project({ ...spec, mutations: { ignoreFileScope: true } });
    expect(mutated.links).toEqual([`${CLASS('Service')} -> ${CLASS('OrderDaoImpl')}`]);
  });

  it('ignoreFileScope does not make an outside site visible', () => {
    const spec = unit(['  <bean class="com.acme.Service"><property name="d"><ref parent="orderDao"/></property></bean>', DAO], ['Service', 'OrderDaoImpl']);
    expect(project({ ...spec, mutations: { ignoreFileScope: true } }).buckets).toMatchObject({ outside: 1, edge: 0 });
  });

  it('noAliases, noInheritance and ignoreUnknownWhen act on the target and on the consumer, as the table does', () => {
    const alias = unit(['  <alias name="orderDao" alias="orders"/>', DAO, '  <bean class="com.acme.Service"><property name="d" ref="orders"/></bean>'], ['Service', 'OrderDaoImpl']);
    expect(project(alias).buckets).toMatchObject({ edge: 1 });
    expect(project({ ...alias, mutations: { noAliases: true } }).buckets).toMatchObject({ edge: 0, unknown: 1 });

    const parent = unit(['  <bean id="base" class="com.acme.BaseDao"/>', '  <bean parent="base"><property name="d" ref="orderDao"/></bean>', DAO], ['BaseDao', 'OrderDaoImpl']);
    expect(project(parent).links).toEqual([`${CLASS('BaseDao')} -> ${CLASS('OrderDaoImpl')}`]);
    expect(project({ ...parent, mutations: { noInheritance: true } }).buckets).toMatchObject({ edge: 0, consumerUnknown: 1 });

    const factory = unit(['  <bean class="com.acme.Context" factory-method="get"><property name="d" ref="orderDao"/></bean>', DAO], ['Context', 'OrderDaoImpl']);
    expect(project(factory).buckets).toMatchObject({ edge: 0, consumerUnknown: 1 });
    expect(project({ ...factory, mutations: { ignoreUnknownWhen: true } }).links).toEqual([`${CLASS('Context')} -> ${CLASS('OrderDaoImpl')}`]);
  });
});
