// name-binding-references, task 3.3: the driver's name-reference stage as a
// function of the manifest, the catalog and an injected `readFile` (the driver
// binds it to the materialized snapshot, the live tree is never read here). One
// read per non-code file; code-language files are not read at all.
import { describe, expect, it } from 'vitest';
import { collectNameReferenceSites } from '../../skills/excavator/name-reference-sites.mjs';
import { loadNameBindingCatalog } from '../../skills/excavator/name-binding-catalog.mjs';

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
