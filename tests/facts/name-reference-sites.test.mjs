// name-binding-references, task 3.3, and xml-injection-references, task 3.2: the driver's name-reference stage as a
// function of the manifest, the catalog and an injected `readFile` (the driver
// binds it to the materialized snapshot, the live tree is never read here). One
// read per non-code file; code-language files are not read at all.
import { describe, expect, it, vi } from 'vitest';
import { collectNameReferenceSites } from '../../skills/excavator/name-reference-sites.mjs';
import { loadNameBindingCatalog, parseNameBindingCatalog } from '../../skills/excavator/name-binding-catalog.mjs';
import { parseXml } from '../../skills/excavator/xml-name-bindings.mjs';

// Counts the full parses of a file, for the "parsed once" tests: the spy calls
// the real parser. (The root-only read of a file's first element is the module's
// own call and is not counted: it is not a parse of the tree.)
vi.mock('../../skills/excavator/xml-name-bindings.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, parseXml: vi.fn(actual.parseXml) };
});

const catalog = loadNameBindingCatalog();
const scanOf = (files) => ({ files: files.map(([path, language]) => ({ path, language })), skipped: [] });

const SEAM_PAGES = 'xmlns="http://jboss.com/products/seam/pages"';
const contents = {
  'a/list.xhtml': '<html>\n  <p>#{orders.save}</p>\n</html>',
  'a/old.jsp': '<%-- ${gone.x} --%>\n${live.y}',
  'a/empty.xhtml': '<html/>',
  'a/WEB-INF/faces-config.xml': [
    '<faces-config>',
    '  <managed-bean><managed-bean-name>orders</managed-bean-name><managed-bean-class>a.Orders</managed-bean-class></managed-bean>',
    '  <application><el-resolver>org.springframework.web.jsf.el.SpringBeanFacesELResolver</el-resolver></application>',
    '  <managed-property><value>#{cart.x}</value></managed-property>',
    '</faces-config>',
  ].join('\n'),
  'a/WEB-INF/beans.xml': '<beans><bean id="svc" class="a.Svc"/><bean class="a.Anonymous"/></beans>',
  'a/WEB-INF/pages.xml': `<pages ${SEAM_PAGES}>\n  <page view-id="/x.xhtml" action="#{home.go}"/>\n</pages>`,
  'a/WEB-INF/other-pages.xml': '<pages>\n  <page action="#{home.go}"/>\n</pages>',
  'a/web.xml': '<web-app><param-value>#{outside.v}</param-value></web-app>',
  'a/plain.html': '#{home.title}',
  'a/page.html': '<html>\n<p>#{home.title}</p>\n</html>',
  'a/schema.dtd': '<!ELEMENT page (#PCDATA)>\n<!-- #{dtd.note} -->',
  'a/NOTES': 'plain #{notes.x}',
  'a/commented.xml': '<web-app><!-- #{x.y} --></web-app>',
  'a/notes.properties': 'k=#{p.q}',
  'a/clean.xml': '<web-app><display-name>x</display-name></web-app>',
  'a/Bean.java': 'class Bean { String s = "#{java.x}"; }',
};
const scan = scanOf([
  ['a/list.xhtml', 'xhtml'], ['a/old.jsp', 'jsp'], ['a/empty.xhtml', 'xhtml'], ['a/WEB-INF/faces-config.xml', 'xml'],
  ['a/WEB-INF/beans.xml', 'xml'], ['a/WEB-INF/pages.xml', 'xml'], ['a/WEB-INF/other-pages.xml', 'xml'], ['a/web.xml', 'xml'],
  ['a/plain.html', 'html'], ['a/page.html', 'html'], ['a/schema.dtd', 'dtd'], ['a/NOTES', 'unknown'], ['a/commented.xml', 'xml'],
  ['a/notes.properties', 'properties'], ['a/clean.xml', 'xml'], ['a/Bean.java', 'java'],
]);
const collect = (extra = {}) => collectNameReferenceSites({ scan, catalog, readFile: (path) => contents[path], ...extra });

describe('collectNameReferenceSites', () => {
  it('lexes the expression files, by extension or by XML root and namespace, one row each, in manifest order', () => {
    const { files } = collect();
    expect(files.map((f) => [f.file, f.language, f.expressionLanguage])).toEqual([
      ['a/list.xhtml', 'xhtml', 'jsf-jsp-el'],
      ['a/old.jsp', 'jsp', 'jsf-jsp-el'],
      ['a/empty.xhtml', 'xhtml', 'jsf-jsp-el'],
      ['a/WEB-INF/faces-config.xml', 'xml', 'jsf-jsp-el'],
      ['a/WEB-INF/pages.xml', 'xml', 'jsf-jsp-el'],
    ]);
  });

  it('records the roots of each file with line and chain, and the escape and unterminated counts', () => {
    const { files } = collect();
    const byFile = Object.fromEntries(files.map((f) => [f.file, f]));
    expect(byFile['a/list.xhtml'].roots).toEqual([{ line: 2, token: 'orders', chain: 'orders.save', local: false }]);
    expect(byFile['a/old.jsp'].roots).toEqual([{ line: 2, token: 'live', chain: 'live.y', local: false }]);
    expect(byFile['a/WEB-INF/faces-config.xml'].roots.map((r) => r.token)).toEqual(['cart']);
    expect(byFile['a/WEB-INF/pages.xml'].roots).toEqual([{ line: 2, token: 'home', chain: 'home.go', local: false }]);
    expect(byFile['a/empty.xhtml']).toMatchObject({ roots: [], escaped: 0, unterminated: 0 });
  });

  it('keeps a pages file whose root is in no Seam namespace out of the expression files', () => {
    const { files, outsideFiles } = collect();
    expect(files.some((f) => f.file === 'a/WEB-INF/other-pages.xml')).toBe(false);
    expect(outsideFiles['xml:pages']).toBe(1);
  });

  it('reads the name bindings of the descriptors, each with the file it came from and what its binder means by no target', () => {
    const { bindings } = collect();
    expect(bindings.map((b) => [b.file, b.binder, b.name, b.line, b.target, b.missingTarget])).toEqual([
      ['a/WEB-INF/faces-config.xml', 'jsf-xml-managed-bean', 'orders', 2, { kind: 'class', text: 'a.Orders' }, 'unknown'],
      ['a/WEB-INF/beans.xml', 'spring-xml-bean', 'svc', 1, { kind: 'class', text: 'a.Svc' }, 'unknown'],
    ]);
  });

  it('carries the target rules of each Spring binding: the factory attribute it writes, the parent it names, and an alias as a name target', () => {
    const files = {
      'b/ctx.xml': [
        '<beans xmlns="http://www.springframework.org/schema/beans">',
        '  <bean id="svc" class="b.Locator" factory-method="make"/>',
        '  <bean id="child" parent="base"/>',
        '  <alias name="base" alias="alias1"/>',
        '</beans>',
      ].join('\n'),
      'b/cdi/beans.xml': '<beans xmlns="http://xmlns.jcp.org/xml/ns/javaee"><bean id="ignored" class="b.X"/></beans>',
    };
    const { bindings } = collectNameReferenceSites({
      scan: scanOf([['b/ctx.xml', 'xml'], ['b/cdi/beans.xml', 'xml']]), catalog, readFile: (path) => files[path],
    });
    expect(bindings.map((b) => [b.binder, b.name, b.target, b.unknownBecause, b.inherits])).toEqual([
      ['spring-xml-bean', 'svc', { kind: 'class', text: 'b.Locator' }, 'factory-method', null],
      ['spring-xml-bean', 'child', null, null, 'base'],
      ['spring-xml-alias', 'alias1', { kind: 'name', text: 'base' }, null, null],
    ]);
  });

  it('counts the elements a binder matched that gave no name, for their binder (the anonymous bean)', () => {
    expect(collect().missingNames).toEqual({ 'spring-xml-bean': 1 });
  });

  it('reads the condition facts of the catalog: the file, the language, the namespace it opens and the line', () => {
    expect(collect().conditions).toEqual([{
      file: 'a/WEB-INF/faces-config.xml',
      expressionLanguage: 'jsf-jsp-el',
      namespace: 'spring',
      line: 3,
      text: 'org.springframework.web.jsf.el.SpringBeanFacesELResolver',
    }]);
  });

  it('counts a file that holds #{ but is not an expression file: an .xml file by root element, any other by extension (spec: EL outside the expression files)', () => {
    expect(collect().outsideFiles).toEqual({
      'xml:web-app': 2, // web.xml, and commented.xml, whose #{ is in a comment: the probe reads the text as written
      html: 2, // plain.html, and page.html: an HTML page that starts with a tag is still html
      dtd: 1, // a DTD has no element
      '(none)': 1, // NOTES has no extension
      properties: 1,
      'xml:pages': 1,
    });
  });

  it('does not count a file with no #{, nor an expression file, as outside', () => {
    const { outsideFiles } = collect();
    expect(outsideFiles['xml:web-app']).toBe(2); // web.xml and commented.xml, not clean.xml
    expect(Object.keys(outsideFiles).some((k) => k.includes('xhtml') || k.includes('faces-config'))).toBe(false);
  });

  it('never reads a code-language file, and reads every other file exactly once', () => {
    const reads = [];
    collect({ readFile: (path) => (reads.push(path), contents[path]) });
    expect(reads).not.toContain('a/Bean.java');
    expect(reads.slice().sort()).toEqual(scan.files.map((f) => f.path).filter((p) => p !== 'a/Bean.java').sort());
  });

  it('fails visibly when a manifest file cannot be read, never an empty row', () => {
    expect(() => collect({
      readFile: () => {
        throw new Error('ENOENT');
      },
    })).toThrow(/name-references: cannot read a\/list\.xhtml from the snapshot: ENOENT/);
  });

  it('uses the catalog it is given: another extension, no Spring bridge condition', () => {
    const custom = structuredClone(JSON.parse(JSON.stringify(catalog)));
    custom.expressionLanguages[0].files = { extensions: ['html'], templateExtensions: [], xmlRoots: [] };
    const result = collect({ catalog: custom });
    expect(result.files.map((f) => f.file)).toEqual(['a/plain.html', 'a/page.html']);
    expect(result.outsideFiles.html).toBeUndefined();
    expect(result.files[0].roots.map((r) => r.token)).toEqual(['home']);
  });

  it('does not make the expression roots of an alias attribute local when the switch is on (mutation tripwire)', () => {
    const alias = { 'a/t.jsp': '<%@ taglib prefix="t" uri="http://myfaces.apache.org/tomahawk" %>\n<t:aliasBean alias="#{bean}"/>${bean.x}' };
    const scanAlias = scanOf([['a/t.jsp', 'jsp']]);
    const run = (mutations) => collectNameReferenceSites({ scan: scanAlias, catalog, readFile: (path) => alias[path], mutations }).files[0].roots.map((r) => r.local);
    expect(run({})).toEqual([true, true]);
    expect(run({ noExpressionLocals: true })).toEqual([false, false]);
  });

  it('reads a comment as live when the mask is switched off (mutation tripwire)', () => {
    const live = collect({ mutations: { noCommentMask: true } });
    expect(live.files.find((f) => f.file === 'a/old.jsp').roots.map((r) => r.token)).toEqual(['gone', 'live']);
  });

  it('reads an inner bean as a binding when the parent check is switched off (mutation tripwire)', () => {
    const text = '<beans><bean id="o" class="a.O"><property name="p"><bean id="inner" class="a.I"/></property></bean></beans>';
    const readFile = (path) => (path === 'a/WEB-INF/beans.xml' ? text : contents[path]);
    expect(collect({ readFile }).bindings.map((b) => b.name)).toEqual(['orders', 'o']);
    expect(collect({ readFile, mutations: { anyParent: true } }).bindings.map((b) => b.name)).toEqual(['orders', 'o', 'inner']);
    // the parent check also decides what is an anonymous bean: the inner bean without a name is not counted
    const anonymous = '<beans><bean id="o" class="a.O"><property name="p"><bean class="a.I"/></property></bean></beans>';
    const readAnonymous = (path) => (path === 'a/WEB-INF/beans.xml' ? anonymous : contents[path]);
    expect(collect({ readFile: readAnonymous }).missingNames).toEqual({});
    expect(collect({ readFile: readAnonymous, mutations: { anyParent: true } }).missingNames).toEqual({ 'spring-xml-bean': 1 });
  });
});

describe('injection sites in collectNameReferenceSites (xml-injection-references, task 3.2; design D9)', () => {
  const BEANS = 'xmlns="http://www.springframework.org/schema/beans"';
  const JAVAEE = 'xmlns="http://xmlns.jcp.org/xml/ns/javaee"';
  const FAMILY = 'spring-xml-injection';
  const injectionContents = {
    'a/ctx.xml': [
      `<beans ${BEANS}>`,
      '  <bean id="svc" class="a.Svc"><property name="dao" ref="orderDao"/><idref bean="x"/></bean>',
      '  <bean id="orderDao" class="a.Dao"/>',
      '</beans>',
    ].join('\n'),
    'a/more.xml': `<beans ${BEANS}>\n  <sec:custom-filter ref="f"/>\n  <bean class="a.B"><property name="e" ref=""/></bean>\n  <idref/>\n</beans>`,
    'a/quiet.xml': `<beans ${BEANS}>\n  <bean id="q" class="a.Q"/>\n</beans>`,
    'a/cdi/beans.xml': `<beans ${JAVAEE}><bean class="a.C"><property name="x" ref="y"/></bean></beans>`,
    'a/web/page.xhtml': '<html>\n  <p>#{orderDao.run}</p>\n</html>',
  };
  const injectionScan = scanOf([['a/ctx.xml', 'xml'], ['a/more.xml', 'xml'], ['a/quiet.xml', 'xml'], ['a/cdi/beans.xml', 'xml'], ['a/web/page.xhtml', 'xhtml']]);
  const run = (extra = {}) => collectNameReferenceSites({ scan: injectionScan, catalog, readFile: (path) => injectionContents[path], ...extra });

  it('reads the injection sites of the files whose root is a family\'s, each row with its file, in manifest order', () => {
    const { injections } = run();
    expect(injections.map((r) => [r.file, r.family, r.site, r.name, r.line, r.scope, r.consumer.line])).toEqual([
      ['a/ctx.xml', FAMILY, 'spring-property-ref', 'orderDao', 2, 'unit', 2],
    ]);
    expect(injections[0].consumer).toEqual({ line: 2, target: { kind: 'class', text: 'a.Svc' }, unknownBecause: null, inherits: null });
  });

  it('counts, per family, the files it read - by root, whether or not a site was written - and lists every family', () => {
    // ctx.xml, more.xml and quiet.xml have a Spring root; the CDI beans.xml does not
    expect(run().injectionFiles).toEqual({ [FAMILY]: 3 });
    const none = run({ catalog: parseNameBindingCatalog({ ...JSON.parse(JSON.stringify(catalog)), xmlInjections: [] }) });
    expect(none.injectionFiles).toEqual({});
    expect(none.injections).toEqual([]);
    expect(none.uncoveredReferences).toEqual({});
    // a family with no file shows with a zero
    expect(collectNameReferenceSites({ scan: scanOf([['a/page.xhtml', 'xhtml']]), catalog, readFile: () => '<html/>' }).injectionFiles).toEqual({ [FAMILY]: 0 });
  });

  it('merges the census of every file, counts in sorted key order, and leaves out a file no family reads', () => {
    expect(run().uncoveredReferences).toEqual({ 'custom-filter@ref': 1, idref: 2, 'property@ref': 1 });
    expect(Object.keys(run().uncoveredReferences)).toEqual(['custom-filter@ref', 'idref', 'property@ref']);
  });

  it('yields no expression row for an injection-family file that is not an expression file', () => {
    const { files } = run();
    expect(files.map((f) => f.file)).toEqual(['a/web/page.xhtml']);
  });

  it('reads a file once and parses it once, however many of binders, conditions and families read its root', () => {
    const reads = [];
    parseXml.mockClear();
    run({ readFile: (path) => (reads.push(path), injectionContents[path]) });
    expect(reads.slice().sort()).toEqual(Object.keys(injectionContents).sort());
    const parsed = (path) => parseXml.mock.calls.filter(([text]) => text === injectionContents[path]).length;
    expect(parsed('a/ctx.xml')).toBe(1); // a binder and the family both read its root
    expect(parsed('a/more.xml')).toBe(1);
    expect(parsed('a/cdi/beans.xml')).toBe(0); // no binder, condition or family reads a Java EE beans root
  });

  it('parses a file only a family reads: its root is the family\'s, whatever the binders\' roots', () => {
    const custom = JSON.parse(JSON.stringify(catalog));
    custom.xmlInjections[0].root = 'integration';
    const only = { 'a/flow.xml': '<integration>\n  <bean class="a.B"><property name="x" ref="y"/></bean>\n</integration>' };
    parseXml.mockClear();
    const result = collectNameReferenceSites({
      scan: scanOf([['a/flow.xml', 'xml']]), catalog: parseNameBindingCatalog(custom), readFile: (path) => only[path],
    });
    expect(parseXml.mock.calls.filter(([text]) => text === only['a/flow.xml']).length).toBe(1);
    expect(result.injections.map((r) => [r.file, r.name, r.line])).toEqual([['a/flow.xml', 'y', 2]]);
    expect(result.injectionFiles).toEqual({ [FAMILY]: 1 });
    expect(result.bindings).toEqual([]); // no binder's root is integration
  });

  it('fails visibly when an injection file cannot be read, naming it', () => {
    expect(() => run({
      readFile: (path) => {
        if (path === 'a/ctx.xml') throw new Error('EIO');
        return injectionContents[path];
      },
    })).toThrow(/name-references: cannot read a\/ctx\.xml from the snapshot: EIO/);
  });

  it('keeps the expression and binding output as it was: the extra keys are additions', () => {
    const { files, bindings, missingNames, conditions, outsideFiles } = run();
    expect(files).toHaveLength(1);
    expect(bindings.map((b) => [b.file, b.binder, b.name])).toEqual([
      ['a/ctx.xml', 'spring-xml-bean', 'svc'], ['a/ctx.xml', 'spring-xml-bean', 'orderDao'], ['a/quiet.xml', 'spring-xml-bean', 'q'],
    ]);
    expect(missingNames).toEqual({ 'spring-xml-bean': 1 }); // the anonymous bean of more.xml
    expect(conditions).toEqual([]);
    expect(outsideFiles).toEqual({});
  });

  it('passes the reading seams down: another namespace read as Spring, nothing counted, the outermost consumer', () => {
    const mutated = run({ mutations: { anyRootNamespace: true } });
    expect(mutated.injections.map((r) => r.file)).toEqual(['a/ctx.xml', 'a/cdi/beans.xml']);
    expect(mutated.injectionFiles).toEqual({ [FAMILY]: 4 });
    expect(run({ mutations: { noCensus: true } }).uncoveredReferences).toEqual({});

    const nested = { 'a/n.xml': `<beans ${BEANS}>\n<bean class="a.Outer"><property name="p"><bean class="a.Inner"><property name="q" ref="x"/></bean></property></bean>\n</beans>` };
    const consumerText = (mutations) => collectNameReferenceSites({ scan: scanOf([['a/n.xml', 'xml']]), catalog, readFile: (path) => nested[path], mutations }).injections[0].consumer.target.text;
    expect(consumerText({})).toBe('a.Inner');
    expect(consumerText({ outermostConsumer: true })).toBe('a.Outer');
  });
});

