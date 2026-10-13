// name-binding-references, task 3.2, and xml-injection-references, tasks 2.1 and
// 3.1: reading the root element, the name bindings and the injection sites of an
// XML descriptor, by the binders and injection families of the shipped catalog.
// Pure input and output; what a binding's target class is, is a later stage.
import { describe, expect, it } from 'vitest';
import {
  injectionsOfTree,
  parseXml,
  readElementTextConditions,
  readRootElement,
  readXmlBindings,
  readXmlInjections,
} from '../../skills/excavator/xml-name-bindings.mjs';
import { loadNameBindingCatalog, parseNameBindingCatalog } from '../../skills/excavator/name-binding-catalog.mjs';

const catalog = loadNameBindingCatalog();
const BINDERS = catalog.xmlBinders;
const SPRING_BRIDGE = catalog.expressionLanguages[0].sees[1].when.elementTextIn;

const readAll = (lines, options) => readXmlBindings(Array.isArray(lines) ? lines.join('\n') : lines, BINDERS, options);
const read = (lines, options) => readAll(lines, options).bindings;
const shown = (bindings) => bindings.map((b) => [b.binder, b.name, b.line, b.target]);
const cls = (text) => ({ kind: 'class', text });

describe('the root element', () => {
  it('reads the local name and the default namespace', () => {
    expect(readRootElement('<?xml version="1.0"?>\n<faces-config xmlns="http://java.sun.com/xml/ns/javaee" version="2.0"></faces-config>'))
      .toEqual({ local: 'faces-config', prefix: null, namespace: 'http://java.sun.com/xml/ns/javaee' });
  });

  it('reads the namespace the root prefix is bound to', () => {
    expect(readRootElement('<c:components xmlns:c="urn:c" xmlns="urn:other"/>')).toEqual({ local: 'components', prefix: 'c', namespace: 'urn:c' });
  });

  it('has no namespace when none is declared', () => {
    expect(readRootElement('<beans/>')).toEqual({ local: 'beans', prefix: null, namespace: null });
    expect(readRootElement('<p:beans xmlns="urn:default"/>')).toEqual({ local: 'beans', prefix: 'p', namespace: null });
  });

  it('skips a byte-order mark, the prolog, comments, a DOCTYPE with an internal subset and processing instructions', () => {
    const text = [
      '﻿<?xml version="1.0" encoding="UTF-8"?>',
      '<!-- <not-the-root/> -->',
      '<!DOCTYPE faces-config PUBLIC "-//Sun//DTD" "http://x/y.dtd" [',
      '  <!ENTITY e "v">',
      ']>',
      '<?target data?>',
      '<faces-config>',
      '</faces-config>',
    ].join('\n');
    expect(readRootElement(text)).toEqual({ local: 'faces-config', prefix: null, namespace: null });
  });

  it('is null for text that is not markup, and for markup with no element', () => {
    expect(readRootElement('')).toBeNull();
    expect(readRootElement('just text <a/>')).toBeNull();
    expect(readRootElement('<!-- only a comment -->')).toBeNull();
  });
});

describe('faces-config (spec: a managed bean declared in faces-config)', () => {
  it('binds the name to the class, at the line of the name text', () => {
    const bindings = read([
      '<faces-config>',
      '  <managed-bean>',
      '    <managed-bean-name>orders</managed-bean-name>',
      '    <managed-bean-class>com.acme.web.OrderBean</managed-bean-class>',
      '    <managed-bean-scope>request</managed-bean-scope>',
      '  </managed-bean>',
      '</faces-config>',
    ]);
    expect(shown(bindings)).toEqual([['jsf-xml-managed-bean', 'orders', 3, cls('com.acme.web.OrderBean')]]);
  });

  it('takes the first non-blank line of a name written across lines, trimmed', () => {
    const bindings = read([
      '<faces-config><managed-bean><managed-bean-name>',
      '   orders ',
      '</managed-bean-name><managed-bean-class>',
      '   com.acme.web.OrderBean',
      '</managed-bean-class></managed-bean></faces-config>',
    ]);
    expect(shown(bindings)).toEqual([['jsf-xml-managed-bean', 'orders', 2, cls('com.acme.web.OrderBean')]]);
  });

  it('is a binding with no target when the class is missing or blank', () => {
    expect(shown(read('<faces-config><managed-bean><managed-bean-name>a</managed-bean-name></managed-bean></faces-config>')))
      .toEqual([['jsf-xml-managed-bean', 'a', 1, null]]);
    expect(shown(read('<faces-config><managed-bean><managed-bean-name>a</managed-bean-name><managed-bean-class>  </managed-bean-class></managed-bean></faces-config>')))
      .toEqual([['jsf-xml-managed-bean', 'a', 1, null]]);
  });

  it('makes no binding of an element with no name, and counts it for its binder (spec: an anonymous bean)', () => {
    const result = readAll([
      '<faces-config>',
      '  <managed-bean><managed-bean-class>a.B</managed-bean-class></managed-bean>',
      '  <managed-bean><managed-bean-name>  </managed-bean-name><managed-bean-class>a.C</managed-bean-class></managed-bean>',
      '</faces-config>',
    ]);
    expect(result.bindings).toEqual([]);
    expect(result.missing).toEqual({ 'jsf-xml-managed-bean': 2 });
  });

  it('reads a resource bundle by its var, whose target is a bundle', () => {
    const bindings = read([
      '<faces-config>',
      '  <application>',
      '    <resource-bundle><base-name>msgs.Messages</base-name><var>msgs</var></resource-bundle>',
      '  </application>',
      '</faces-config>',
    ]);
    expect(shown(bindings)).toEqual([['jsf-xml-resource-bundle', 'msgs', 3, { kind: 'bundle', text: 'msgs.Messages' }]]);
  });

  it('reads nothing from a managed-bean under another parent, or from another root', () => {
    expect(read('<faces-config><application><managed-bean><managed-bean-name>a</managed-bean-name></managed-bean></application></faces-config>')).toEqual([]);
    expect(read('<web-app><managed-bean><managed-bean-name>a</managed-bean-name></managed-bean></web-app>')).toEqual([]);
    expect(read('<faces-config><resource-bundle><var>v</var><base-name>b</base-name></resource-bundle></faces-config>')).toEqual([]);
  });

  it('decodes entities and CDATA in a name', () => {
    expect(shown(read('<faces-config><managed-bean><managed-bean-name>a&amp;b</managed-bean-name></managed-bean></faces-config>'))[0][1]).toBe('a&b');
    expect(shown(read('<faces-config><managed-bean><managed-bean-name><![CDATA[cd]]></managed-bean-name></managed-bean></faces-config>'))[0][1]).toBe('cd');
  });
});

describe('Spring beans', () => {
  it('reads id and class of a bean under beans', () => {
    expect(shown(read(['<beans>', '  <bean id="orderService" class="com.acme.OrderService"/>', '</beans>']))).toEqual([
      ['spring-xml-bean', 'orderService', 2, cls('com.acme.OrderService')],
    ]);
  });

  it('splits the name attribute into aliases on comma, semicolon and space', () => {
    const bindings = read('<beans><bean id="a" name="b, c;d  e" class="x.Y"/></beans>');
    expect(bindings.map((b) => b.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(bindings.every((b) => b.target.text === 'x.Y' && b.line === 1)).toBe(true);
  });

  it('does not split the id on the alias separators, only the attribute the catalog lists (spec: an id is not split)', () => {
    const bindings = read('<beans><bean id="a;b" name="c d" class="com.acme.X"/></beans>');
    expect(bindings.map((b) => b.name)).toEqual(['a;b', 'c', 'd']);
  });

  it('splits what the binder\'s split map lists and nothing else, whatever attribute order it names', () => {
    const custom = [{ ...BINDERS[3], name: { attribute: ['name', 'id'], split: { id: '|' } } }];
    const names = (text) => readXmlBindings(text, custom).bindings.map((b) => b.name);
    expect(names('<beans><bean id="a|b" name="c d" class="x.Y"/></beans>')).toEqual(['c d', 'a', 'b']);
  });

  it('counts a name once when id and name write it twice', () => {
    expect(read('<beans><bean id="a" name="a" class="x.Y"/></beans>').map((b) => b.name)).toEqual(['a']);
  });

  it('gives an inner bean no name (spec: an inner bean\'s id is not a name)', () => {
    const bindings = read([
      '<beans>',
      '  <bean id="outer" class="com.acme.Outer">',
      '    <property name="p"><bean id="inner" class="com.acme.Inner"/></property>',
      '  </bean>',
      '</beans>',
    ]);
    expect(bindings.map((b) => b.name)).toEqual(['outer']);
  });

  it('reads a bean nested in nested beans, whose parent is still beans', () => {
    expect(read('<beans><beans profile="p"><bean id="b" class="x.B"/></beans></beans>').map((b) => b.name)).toEqual(['b']);
  });

  it('is a binding with no target for a bean that only has a parent (spec: a bean definition with only a parent)', () => {
    expect(shown(read('<beans><bean id="child" parent="base"/></beans>'))).toEqual([['spring-xml-bean', 'child', 1, null]]);
  });

  it('says in each binding what its binder means by a missing target', () => {
    expect(read('<beans><bean id="child" parent="base"/></beans>')[0].missingTarget).toBe('unknown');
    expect(read('<faces-config><managed-bean><managed-bean-name>a</managed-bean-name></managed-bean></faces-config>')[0].missingTarget).toBe('unknown');
    expect(read('<beans><bean id="withClass" class="a.B"/></beans>')[0].missingTarget).toBe('unknown'); // carried as is, target or not
  });

  it('makes no binding for a bean without id or name, and counts it (spec: an anonymous bean)', () => {
    const result = readAll(['<beans>', '  <bean class="com.acme.Audit"/>', '  <bean id="named" class="com.acme.Named"/>', '  <bean id=" " name=" ,; " class="x.Y"/>', '</beans>']);
    expect(result.bindings.map((b) => b.name)).toEqual(['named']);
    expect(result.missing).toEqual({ 'spring-xml-bean': 2 });
  });

  it('does not count a bean nested in another, whose parent is not beans, as an anonymous bean', () => {
    const result = readAll('<beans><bean id="o" class="a.O"><property name="p"><bean class="a.Inner"/></property></bean></beans>');
    expect(result.missing).toEqual({});
  });

  it('matches element names by their local part, prefix or not', () => {
    expect(shown(read('<sp:beans xmlns:sp="http://www.springframework.org/schema/beans"><sp:bean id="x" class="a.B"/></sp:beans>'))).toEqual([['spring-xml-bean', 'x', 1, cls('a.B')]]);
  });

  it('reads past a DOCTYPE and comments before the root, and not a commented-out bean', () => {
    const bindings = read([
      '<?xml version="1.0"?>',
      '<!DOCTYPE beans PUBLIC "-//SPRING//DTD BEAN//EN" "http://www.springframework.org/dtd/spring-beans.dtd">',
      '<!-- <bean id="gone" class="a.Gone"/> -->',
      '<beans>',
      '  <bean id="live" class="a.Live"/>',
      '</beans>',
    ]);
    expect(shown(bindings)).toEqual([['spring-xml-bean', 'live', 5, cls('a.Live')]]);
  });

  it('reads the commented-out bean as live when the mask is switched off (mutation tripwire)', () => {
    const bindings = read(['<beans>', '  <!-- <bean id="gone" class="a.Gone"/> -->', '</beans>'], { mutations: { noCommentMask: true } });
    expect(bindings.map((b) => b.name)).toEqual(['gone']);
  });

  it('reads an inner bean as a name when the parent check is switched off (mutation tripwire)', () => {
    const text = '<beans><bean id="outer" class="a.O"><property name="p"><bean id="inner" class="a.I"/></property></bean></beans>';
    expect(read(text, { mutations: { anyParent: true } }).map((b) => b.name)).toEqual(['outer', 'inner']);
  });
});

describe('Spring beans: which roots are read, target rules and aliases (xml-injection-references, task 2.1)', () => {
  const BEANS = 'http://www.springframework.org/schema/beans';
  const JAVAEE = 'http://xmlns.jcp.org/xml/ns/javaee';

  it('reads a beans root in the Spring namespace, and a DTD-form root that declares no namespace', () => {
    expect(read(`<beans xmlns="${BEANS}"><bean id="a" class="x.A"/></beans>`).map((b) => b.name)).toEqual(['a']);
    expect(read([
      '<?xml version="1.0"?>',
      '<!DOCTYPE beans PUBLIC "-//SPRING//DTD BEAN//EN" "http://www.springframework.org/dtd/spring-beans.dtd">',
      '<beans><bean id="dtd" class="x.D"/><alias name="dtd" alias="legacy"/></beans>',
    ]).map((b) => b.name)).toEqual(['dtd', 'legacy']);
  });

  it('does not read a beans root in another namespace: a CDI beans.xml is not Spring configuration', () => {
    const cdi = `<beans xmlns="${JAVAEE}" version="1.1"><bean id="a" class="x.A"/><alias name="a" alias="b"/></beans>`;
    expect(readAll(cdi)).toEqual({ bindings: [], missing: {} });
    expect(readAll('<beans xmlns="urn:other"><bean class="x.A"/></beans>')).toEqual({ bindings: [], missing: {} });
  });

  it('records the first listed unknownWhen attribute a bean writes, whatever order they are written in', () => {
    const [method] = read('<beans><bean id="svc" class="x.Locator" factory-method="lookup"/></beans>');
    expect(method).toMatchObject({ name: 'svc', unknownBecause: 'factory-method', target: cls('x.Locator') });
    const [bean] = read('<beans><bean id="made" factory-bean="locator"/></beans>');
    expect(bean).toMatchObject({ name: 'made', unknownBecause: 'factory-bean', target: null });
    for (const attributes of ['factory-bean="f" factory-method="m"', 'factory-method="m" factory-bean="f"']) {
      expect(read(`<beans><bean id="both" ${attributes}/></beans>`)[0].unknownBecause).toBe('factory-method');
    }
  });

  it('has no unknownBecause for a bean with neither factory attribute, nor for a binder that lists none', () => {
    expect(read('<beans><bean id="plain" class="x.P"/></beans>')[0].unknownBecause).toBeNull();
    expect(read('<faces-config><managed-bean><managed-bean-name>a</managed-bean-name><managed-bean-class>x.A</managed-bean-class></managed-bean></faces-config>')[0])
      .toMatchObject({ unknownBecause: null, inherits: null });
  });

  it('gives every name of a bean the same unknownBecause and the same inherits', () => {
    const rows = read('<beans><bean id="a" name="b c" class="x.X" factory-method="m"/><bean id="d" name="e" parent="base"/></beans>');
    expect(rows.map((b) => [b.name, b.unknownBecause, b.inherits])).toEqual([
      ['a', 'factory-method', null], ['b', 'factory-method', null], ['c', 'factory-method', null], ['d', null, 'base'], ['e', null, 'base'],
    ]);
  });

  it('records the parent a bean names, trimmed, even when it also writes a class; a blank parent is none', () => {
    expect(read('<beans><bean id="child" parent=" base "/></beans>')[0]).toMatchObject({ target: null, inherits: 'base' });
    expect(read('<beans><bean id="both" class="x.B" parent="base"/></beans>')[0]).toMatchObject({ target: cls('x.B'), inherits: 'base' });
    expect(read('<beans><bean id="blank" parent="  "/></beans>')[0].inherits).toBeNull();
    expect(read('<beans><bean id="none" class="x.N"/></beans>')[0].inherits).toBeNull();
  });

  it('reads an alias element under beans: the alias is the name, the name attribute is a target of kind name', () => {
    const [alias] = read(['<beans xmlns="' + BEANS + '">', '  <bean id="orderDao" class="x.Dao"/>', '  <alias name="orderDao" alias="orders"/>', '</beans>']).slice(1);
    expect(alias).toMatchObject({ binder: 'spring-xml-alias', name: 'orders', line: 3, target: { kind: 'name', text: 'orderDao' }, missingTarget: 'unknown', unknownBecause: null, inherits: null });
  });

  it('reads an alias under a nested beans element, trims its name, and gives a blank name no target', () => {
    expect(shown(read('<beans><beans profile="p"><alias name=" a " alias=" b "/></beans></beans>'))).toEqual([['spring-xml-alias', 'b', 1, { kind: 'name', text: 'a' }]]);
    expect(shown(read('<beans><alias name=" " alias="b"/></beans>'))).toEqual([['spring-xml-alias', 'b', 1, null]]);
  });

  it('counts an alias with no alias attribute as missing a name, and reads no alias that is not directly under beans', () => {
    const result = readAll('<beans><alias name="a"/><bean id="x" class="y.Z"><property name="p"><alias name="a" alias="b"/></property></bean></beans>');
    expect(result.bindings.map((b) => b.name)).toEqual(['x']);
    expect(result.missing).toEqual({ 'spring-xml-alias': 1 });
  });

  it('reads an alias in a DTD-form file and not in a commented-out line', () => {
    expect(read('<beans>\n<!-- <alias name="a" alias="gone"/> -->\n<alias name="a" alias="live"/></beans>').map((b) => [b.name, b.line])).toEqual([['live', 3]]);
  });
});

describe('XML injection sites (xml-injection-references, task 3.1; design D4, D5)', () => {
  const BEANS = 'http://www.springframework.org/schema/beans';
  const P = 'http://www.springframework.org/schema/p';
  const C = 'http://www.springframework.org/schema/c';
  const JAVAEE = 'http://xmlns.jcp.org/xml/ns/javaee';
  const FAMILY = 'spring-xml-injection';
  const beans = (...lines) => [`<beans xmlns="${BEANS}" xmlns:p="${P}" xmlns:c="${C}">`, ...lines, '</beans>'];
  const sitesOf = (lines, options) => readXmlInjections(Array.isArray(lines) ? lines.join('\n') : lines, catalog, options);
  /** [site id, name, line, consumer line] per site. */
  const shownSites = (result) => result.sites.map((s) => [s.site, s.name, s.line, s.consumer === null ? null : s.consumer.line]);
  const consumerOf = (target, extra = {}) => ({ target, unknownBecause: null, inherits: null, ...extra });

  it('reads a property ref as a site of the Spring family, with the nearest bean as consumer, read by the bean binder (spec: property ref)', () => {
    const result = sitesOf(beans('  <bean id="orderService" class="com.acme.OrderServiceImpl">', '    <property name="dao" ref="orderDao"/>', '  </bean>'));
    expect(result.families).toEqual([FAMILY]);
    expect(result.sites).toEqual([{
      family: FAMILY, site: 'spring-property-ref', name: 'orderDao', line: 3, scope: 'unit',
      consumer: { line: 2, target: cls('com.acme.OrderServiceImpl'), unknownBecause: null, inherits: null },
    }]);
    expect(result.uncovered).toEqual({});
  });

  it('is the line of the attribute, not of the element, that a site cites', () => {
    const result = sitesOf(beans('  <bean class="a.B">', '    <property', '      name="dao"', '      ref="orderDao"/>', '  </bean>'));
    expect(shownSites(result)).toEqual([['spring-property-ref', 'orderDao', 5, 2]]);
  });

  it('gives a ref in a collection the nearest bean as consumer (spec: collection ref)', () => {
    const result = sitesOf(beans('  <bean class="com.acme.Router">', '    <property name="handlers"><list><ref bean="orderHandler"/></list></property>', '  </bean>'));
    expect(result.sites).toEqual([expect.objectContaining({ site: 'spring-ref-bean', name: 'orderHandler', consumer: expect.objectContaining({ line: 2, target: cls('com.acme.Router') }) })]);
  });

  it('gives an inner bean\'s site to the inner bean, which declares no name and is still a consumer (spec: inner bean)', () => {
    const lines = beans(
      '  <bean id="a" class="com.acme.A">',
      '    <property name="p">',
      '      <bean class="com.acme.Inner">',
      '        <property name="q" ref="x"/>',
      '      </bean>',
      '    </property>',
      '  </bean>',
    );
    const [site] = sitesOf(lines).sites;
    expect(site).toMatchObject({ name: 'x', consumer: { line: 4, target: cls('com.acme.Inner') } });
    // anonymous: the bean binder declares nothing for it
    expect(read(lines).map((b) => b.name)).toEqual(['a']);
  });

  it('reads an attribute of the p namespace that ends in -ref; the bean it sits on is the consumer (spec: p namespace)', () => {
    const result = sitesOf(beans('  <bean class="com.acme.Report" p:source-ref="orderDao" p:title="Orders"/>'));
    expect(result.sites).toEqual([expect.objectContaining({ site: 'spring-p-ref', name: 'orderDao', line: 2, consumer: consumerOf(cls('com.acme.Report'), { line: 2 }) })]);
    // p:title is a value, not a reference: it is neither a site nor a census item
    expect(result.uncovered).toEqual({});
  });

  it('reads an attribute of the c namespace that ends in -ref', () => {
    const result = sitesOf(beans('  <bean class="com.acme.Mailer" c:transport-ref="smtp"/>'));
    expect(shownSites(result)).toEqual([['spring-c-ref', 'smtp', 2, 2]]);
  });

  it('resolves a prefix by the nearest declaration on the element or its ancestors, not only the root', () => {
    const lines = [
      `<beans xmlns="${BEANS}">`,
      `  <bean id="a" class="a.A" xmlns:q="${P}">`,
      '    <property name="x" q:y-ref="b"/>',
      `    <property name="z" xmlns:q="urn:not-p" q:w-ref="c"/>`,
      '  </bean>',
      '</beans>',
    ];
    const result = sitesOf(lines);
    // q is the p namespace on the bean, so q:y-ref is a site; on the last element q is redeclared, so q:w-ref is none
    expect(shownSites(result)).toEqual([['spring-p-ref', 'b', 3, 2]]);
    // ...which the census still counts: it ends in -ref and no site read it
    expect(result.uncovered).toEqual({ 'property@q:w-ref': 1 });
  });

  it('takes an unprefixed attribute to be in no namespace, and a prefix no declaration binds to be in none either', () => {
    const result = sitesOf(beans('  <bean class="a.B" source-ref="orderDao" u:other-ref="x"/>'));
    expect(result.sites).toEqual([]);
    expect(result.uncovered).toEqual({ 'bean@source-ref': 1, 'bean@u:other-ref': 1 });
  });

  it('takes an attribute for a site by its name as written: a prefixed ref on a property is another attribute, and is counted', () => {
    const result = sitesOf(beans('  <bean class="a.B"><property name="p" x:ref="a"/></bean>'));
    expect(result.sites).toEqual([]);
    expect(result.uncovered).toEqual({ 'property@x:ref': 1 });
  });

  it('never takes an xmlns declaration for a site or a census item', () => {
    const result = sitesOf([`<beans xmlns="${BEANS}" xmlns:foo-ref="urn:x" xmlns:ref="urn:y">`, '  <bean class="a.B" xmlns:bar-ref="urn:z"/>', '</beans>']);
    expect(result).toEqual({ sites: [], uncovered: {}, families: [FAMILY] });
  });

  it('reads two sites of one element in the order they are written: entry key-ref and value-ref', () => {
    const result = sitesOf(beans('  <bean class="a.Registry">', '    <property name="m"><map><entry key-ref="k" value-ref="v"/></map></property>', '  </bean>'));
    expect(result.sites.map((s) => [s.site, s.name, s.line, s.consumer.line])).toEqual([
      ['spring-entry-key-ref', 'k', 3, 2], ['spring-entry-value-ref', 'v', 3, 2],
    ]);
  });

  it('reads the other attribute-form sites: constructor-arg, ref bean, lookup-method and replaced-method', () => {
    const result = sitesOf(beans(
      '  <bean class="a.B">',
      '    <constructor-arg ref="dao"/>',
      '    <lookup-method name="make" bean="prototype"/>',
      '    <replaced-method name="calc" replacer="calculator"/>',
      '    <property name="r"><ref bean="b"/></property>',
      '  </bean>',
    ));
    expect(result.sites.map((s) => [s.site, s.name])).toEqual([
      ['spring-constructor-arg-ref', 'dao'], ['spring-lookup-method', 'prototype'], ['spring-replaced-method', 'calculator'], ['spring-ref-bean', 'b'],
    ]);
    expect(result.uncovered).toEqual({});
  });

  it('carries the scope the catalog gives the site: ref local is the file\'s, ref parent is outside the unit, the others the unit\'s', () => {
    const result = sitesOf(beans('  <bean class="a.B">', '    <property name="a"><ref local="l"/></property>', '    <property name="b"><ref parent="p"/></property>', '    <property name="c"><ref bean="u"/></property>', '  </bean>'));
    expect(result.sites.map((s) => [s.site, s.name, s.scope])).toEqual([
      ['spring-ref-local', 'l', 'file'], ['spring-ref-parent', 'p', 'outside'], ['spring-ref-bean', 'u', 'unit'],
    ]);
  });

  it('trims the name, and gives an empty or blank value no site: it is counted by element and attribute as written', () => {
    const result = sitesOf(beans('  <bean class="a.B">', '    <property name="a" ref=" spaced "/>', '    <property name="b" ref=""/>', '    <property name="c" ref="   "/>', '  </bean>'));
    expect(result.sites.map((s) => s.name)).toEqual(['spaced']);
    expect(result.uncovered).toEqual({ 'property@ref': 2 });
  });

  it('counts an empty value of a site that is no census shape once, under its element and attribute, and an empty ref element too', () => {
    const result = sitesOf(beans('  <bean class="a.B">', '    <lookup-method name="make" bean=""/>', '    <property name="r"><ref bean=""/></property>', '  </bean>'));
    expect(result.sites).toEqual([]);
    expect(result.uncovered).toEqual({ 'lookup-method@bean': 1, ref: 1, 'ref@bean': 1 });
  });

  it('counts an unread census item once, whether or not an empty value caused it', () => {
    const result = sitesOf(beans('  <bean class="a.B">', '    <property name="p" ref=""/>', '  </bean>'));
    expect(result.uncovered).toEqual({ 'property@ref': 1 });
  });

  it('is a consumer with the target rules of its binder: a factory-method bean, a parent-only bean and one with no class (spec: consumer rules)', () => {
    const result = sitesOf(beans(
      '  <bean id="ctx" class="com.acme.Context" factory-method="getInstance"><property name="dao" ref="d1"/></bean>',
      '  <bean id="child" parent=" base "><property name="dao" ref="d2"/></bean>',
      '  <bean id="bare"><property name="dao" ref="d3"/></bean>',
      '  <bean class="a.Both" parent="base" factory-bean="f"><property name="dao" ref="d4"/></bean>',
    ));
    expect(result.sites.map((s) => [s.name, s.consumer.line, s.consumer.target, s.consumer.unknownBecause, s.consumer.inherits])).toEqual([
      ['d1', 2, cls('com.acme.Context'), 'factory-method', null],
      ['d2', 3, null, null, 'base'],
      ['d3', 4, null, null, null],
      ['d4', 5, cls('a.Both'), 'factory-bean', 'base'],
    ]);
  });

  it('has no consumer for a site outside every bean, as a ref in a top-level collection (spec: no enclosing bean)', () => {
    const result = sitesOf(beans('  <util:list id="handlers">', '    <ref bean="orderHandler"/>', '  </util:list>'));
    expect(result.sites).toEqual([expect.objectContaining({ site: 'spring-ref-bean', name: 'orderHandler', consumer: null })]);
  });

  it('matches elements by local name, so a property of another namespace is a site too, and without a bean around it has no consumer', () => {
    const result = sitesOf(beans('  <lang:property ref="script"/>'));
    expect(result.sites).toEqual([expect.objectContaining({ site: 'spring-property-ref', name: 'script', consumer: null })]);
  });

  it('reads a DTD-form file, which declares no namespace', () => {
    const result = sitesOf(['<!DOCTYPE beans PUBLIC "-//SPRING//DTD BEAN//EN" "http://www.springframework.org/dtd/spring-beans.dtd">', '<beans>', '  <bean class="a.B"><property name="x" ref="y"/></bean>', '</beans>']);
    expect(result.families).toEqual([FAMILY]);
    expect(shownSites(result)).toEqual([['spring-property-ref', 'y', 3, 3]]);
  });

  it('does not read a beans root in another namespace: no site, no census, no family (spec: not Spring)', () => {
    const cdi = `<beans xmlns="${JAVAEE}"><bean class="a.B"><property name="x" ref="y"/><idref bean="z"/></bean></beans>`;
    expect(sitesOf(cdi)).toEqual({ sites: [], uncovered: {}, families: [] });
    expect(sitesOf('<other xmlns="x"><bean><property ref="y"/></bean></other>')).toEqual({ sites: [], uncovered: {}, families: [] });
    expect(sitesOf('not xml at all')).toEqual({ sites: [], uncovered: {}, families: [] });
  });

  it('counts the reference shapes no site reads: idref by element, custom-filter@ref by element and attribute (spec: census)', () => {
    const result = sitesOf(beans(
      '  <bean class="a.B"><property name="x"><idref bean="orderDao"/></property></bean>',
      '  <security:custom-filter ref="authFilter"/>',
      '  <bean class="a.C"><property name="y" ref="read"/></bean>',
    ));
    expect(result.uncovered).toEqual({ idref: 1, 'custom-filter@ref': 1 });
    expect(result.sites.map((s) => s.name)).toEqual(['read']);
  });

  it('counts a census element that no site came from, and not one a site did', () => {
    const result = sitesOf(beans('  <bean class="a.B"><property name="p"><ref bean="x"/><ref/><ref local=""/></property></bean>'));
    // <ref bean="x"/> read; <ref/> and <ref local=""/> are census elements with no site
    expect(result.uncovered).toEqual({ ref: 2, 'ref@local': 1 });
  });

  it('keys the census by the element\'s local name and the attribute as written, so a prefixed element and attribute are told apart', () => {
    const result = sitesOf(beans('  <sec:http entry-point-ref="e"/>', '  <sec:custom-filter x:ref="f"/>'));
    expect(result.uncovered).toEqual({ 'custom-filter@x:ref': 1, 'http@entry-point-ref': 1 });
  });

  it('counts nothing from a commented-out site or census item (spec: comments)', () => {
    const result = sitesOf(beans('  <bean class="a.B">', '    <!-- <property name="dao" ref="orderDao"/> <idref bean="x"/> -->', '  </bean>'));
    expect(result).toEqual({ sites: [], uncovered: {}, families: [FAMILY] });
  });

  it('sorts the census keys, and counts a shape each time it is met', () => {
    const result = sitesOf(beans('  <z:a ref="1"/>', '  <z:a ref="2"/>', '  <z:b ref="3"/>', '  <idref/>'));
    expect(Object.entries(result.uncovered)).toEqual([['a@ref', 2], ['b@ref', 1], ['idref', 1]]);
  });

  it('knows nothing of Spring in the code: another family in the catalog reads another framework\'s sites, with its own census', () => {
    const custom = structuredClone(JSON.parse(JSON.stringify(catalog)));
    custom.xmlBinders.push({
      id: 'blueprint-xml-bean', namespace: 'osgi', basis: 'A test binder: a bean of a blueprint root is registered by its id and class.',
      root: 'blueprint', element: 'bean', parent: 'blueprint', name: { attribute: ['id'] }, target: { kind: 'class', attribute: 'class' },
      namespacedNames: false, missingTarget: 'unknown',
    });
    custom.xmlInjections.push({
      id: 'blueprint-xml-injection', namespace: 'osgi', basis: 'A test family: a property ref names another bean of the blueprint.', root: 'blueprint',
      consumer: { element: 'bean', binder: 'blueprint-xml-bean' },
      sites: [{ id: 'blueprint-property-ref', element: 'property', attribute: 'ref' }],
      census: { attributes: ['ref'], attributeSuffixes: [], elements: ['ref-list'] },
    });
    const both = parseNameBindingCatalog(custom);
    const text = '<blueprint><bean id="b" class="a.B"><property name="x" ref="y"/><ref-list/></bean></blueprint>';
    const result = readXmlInjections(text, both);
    expect(result.families).toEqual(['blueprint-xml-injection']);
    expect(result.sites).toEqual([expect.objectContaining({ family: 'blueprint-xml-injection', site: 'blueprint-property-ref', name: 'y', scope: 'unit', consumer: expect.objectContaining({ target: cls('a.B') }) })]);
    expect(result.uncovered).toEqual({ 'ref-list': 1 });
    // a Spring file is not read by it, and the Blueprint family does not read the Spring family's shapes
    expect(readXmlInjections(`<beans xmlns="${BEANS}"><bean class="a.B"><property ref="z"/></bean></beans>`, both).families).toEqual([FAMILY]);
  });

  it('works over a parsed tree, as the collector uses it: injectionsOfTree on parseXml of the same text', () => {
    const text = beans('  <bean class="a.B"><property name="x" ref="y"/></bean>').join('\n');
    expect(injectionsOfTree(parseXml(text), catalog)).toEqual(readXmlInjections(text, catalog));
    expect(injectionsOfTree({ root: null, elements: [] }, catalog)).toEqual({ sites: [], uncovered: {}, families: [] });
  });

  describe('mutation tripwires', () => {
    it('outermostConsumer: the outermost bean around a site is its consumer, not the nearest', () => {
      const lines = beans('  <bean class="a.Outer">', '    <property name="p"><bean class="a.Inner"><property name="q" ref="x"/></bean></property>', '  </bean>');
      expect(sitesOf(lines).sites[0].consumer.target).toEqual(cls('a.Inner'));
      expect(sitesOf(lines, { mutations: { outermostConsumer: true } }).sites[0].consumer).toMatchObject({ line: 2, target: cls('a.Outer') });
    });

    it('anyRootNamespace: a beans root in the Java EE namespace is read as Spring configuration', () => {
      const cdi = `<beans xmlns="${JAVAEE}"><bean class="a.B"><property name="x" ref="y"/></bean></beans>`;
      expect(sitesOf(cdi).sites).toEqual([]);
      const mutated = sitesOf(cdi, { mutations: { anyRootNamespace: true } });
      expect(mutated.families).toEqual([FAMILY]);
      expect(mutated.sites.map((s) => s.name)).toEqual(['y']);
    });

    it('noCensus: nothing is counted, neither a reference shape no site read nor an empty value', () => {
      const lines = beans('  <bean class="a.B"><property name="x"><idref bean="z"/></property><property name="e" ref=""/></bean>', '  <sec:custom-filter ref="f"/>');
      expect(sitesOf(lines).uncovered).toEqual({ 'custom-filter@ref': 1, idref: 1, 'property@ref': 1 });
      expect(sitesOf(lines, { mutations: { noCensus: true } }).uncovered).toEqual({});
    });
  });
});

describe('Seam components.xml (the root namespace limits a binder)', () => {
  const SEAM = 'http://jboss.com/products/seam/components';

  it('reads a component of the Seam components namespace', () => {
    const text = `<components xmlns="${SEAM}">\n  <component name="orders" class="com.acme.OrderHome"/>\n</components>`;
    expect(shown(read(text))).toEqual([['seam-xml-component', 'orders', 2, cls('com.acme.OrderHome')]]);
  });

  it('reads a component with a name and no class as configuring a component declared elsewhere', () => {
    const [binding] = read(`<components xmlns="${SEAM}"><component name="numberGuess"/></components>`);
    expect(binding).toMatchObject({ binder: 'seam-xml-component', name: 'numberGuess', target: null, missingTarget: 'configures' });
  });

  it('makes no binding of a component with only a class, and counts it', () => {
    const result = readAll(`<components xmlns="${SEAM}"><component class="com.acme.Mailer"/></components>`);
    expect(result.bindings).toEqual([]);
    expect(result.missing).toEqual({ 'seam-xml-component': 1 });
  });

  it('reads nothing when the root is in another namespace, or in none', () => {
    expect(read('<components xmlns="urn:other"><component name="orders" class="a.B"/></components>')).toEqual([]);
    expect(read('<components><component name="orders" class="a.B"/></components>')).toEqual([]);
  });

  it('reads a root whose prefix is bound to the Seam namespace', () => {
    expect(read(`<c:components xmlns:c="${SEAM}"><c:component name="x" class="a.B"/></c:components>`).map((b) => b.name)).toEqual(['x']);
  });
});

describe('a tolerant reading', () => {
  it('reads what comes before a malformed place and does not throw', () => {
    const text = '<beans><bean id="a" class="x.A"/><bean id="b" class="x.B"<bean id="c" class="x.C"/></beans>';
    expect(read(text).map((b) => b.name)).toContain('a');
  });

  it('ignores an end tag with no open element', () => {
    expect(read('</stray><beans><bean id="a" class="x.A"/></beans>').map((b) => b.name)).toEqual(['a']);
  });

  it('reads an empty or non-XML text as no bindings', () => {
    expect(read('')).toEqual([]);
    expect(read('plain text')).toEqual([]);
  });

  it('builds a tree whose elements know their parent and line', () => {
    const { root, elements } = parseXml('<a>\n<b/>\n<c><d/></c></a>');
    expect(root.local).toBe('a');
    expect(elements.map((e) => [e.local, e.parent?.local ?? null, e.line])).toEqual([['a', null, 1], ['b', 'a', 2], ['c', 'a', 3], ['d', 'c', 3]]);
  });
});

describe('the Spring bridge condition (elementTextIn)', () => {
  const faces = (resolver, element = 'el-resolver') =>
    ['<faces-config>', '  <application>', `    <${element}>`, `      ${resolver}`, `    </${element}>`, '  </application>', '</faces-config>'].join('\n');
  const hits = (text) => readElementTextConditions(text, SPRING_BRIDGE);

  it('is met by a declared el-resolver, at the line of its text', () => {
    expect(hits(faces('org.springframework.web.jsf.el.SpringBeanFacesELResolver'))).toEqual([
      { line: 4, text: 'org.springframework.web.jsf.el.SpringBeanFacesELResolver' },
    ]);
  });

  it('is met by a variable-resolver of the older kind', () => {
    expect(hits(faces('org.springframework.web.jsf.DelegatingVariableResolver', 'variable-resolver')).map((h) => h.line)).toEqual([4]);
    expect(hits(faces('org.springframework.web.jsf.SpringBeanVariableResolver', 'variable-resolver')).map((h) => h.line)).toEqual([4]);
  });

  it('is not met by the resolver that does not resolve Spring beans', () => {
    expect(hits(faces('org.springframework.web.jsf.el.WebApplicationContextFacesELResolver'))).toEqual([]);
  });

  it('is not met by a commented-out el-resolver', () => {
    const text = '<faces-config><application><!-- <el-resolver>org.springframework.web.jsf.el.SpringBeanFacesELResolver</el-resolver> --></application></faces-config>';
    expect(hits(text)).toEqual([]);
    expect(readElementTextConditions(text, SPRING_BRIDGE, { mutations: { noCommentMask: true } })).toHaveLength(1);
  });

  it('is not met when the text is in another element, or the root is not the named one', () => {
    expect(hits(faces('org.springframework.web.jsf.el.SpringBeanFacesELResolver', 'managed-bean-class'))).toEqual([]);
    expect(hits('<web-app><el-resolver>org.springframework.web.jsf.el.SpringBeanFacesELResolver</el-resolver></web-app>')).toEqual([]);
    expect(hits('')).toEqual([]);
  });

  it('wants the whole text to be the class name', () => {
    expect(hits(faces('org.springframework.web.jsf.el.SpringBeanFacesELResolverX'))).toEqual([]);
  });
});
