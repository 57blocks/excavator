// name-mention-facts, "Name mentions in non-code files": the single-file lexer.
// Pure input/output tests - no project on disk. Every expectation reads the
// candidates the lexer emits; resolving them against the repository is a
// later stage with its own tests.
import { describe, expect, it } from 'vitest';
import { builtinLanguageConfigs } from '@excavator/core';
import { codeLanguagePredicate, isCodeLanguage, lexMentions } from '../../skills/excavator/text-mentions.mjs';

const EXTENSIONS = new Set(['xml', 'xhtml', 'jsp', 'jspx', 'html', 'properties', 'java', 'js', 'ftl', 'tld', 'tag', 'png']);

const lex = (path, language, lines, options = {}) =>
  lexMentions(path, language, Array.isArray(lines) ? lines.join('\n') : lines, { extensions: EXTENSIONS, ...options });
const tokens = (candidates) => candidates.map((c) => c.token);
const named = (candidates, token) => candidates.filter((c) => c.token === token);

describe('descriptor class names', () => {
  it('records a servlet class on line 12 with element context', () => {
    const lines = ['<web-app>'];
    for (let i = 0; i < 10; i++) lines.push('');
    lines.push('<servlet-class>com.acme.web.OrderServlet</servlet-class>');
    const { fqn } = lex('WEB-INF/web.xml', 'xml', lines);
    expect(fqn).toEqual([
      { token: 'com.acme.web.OrderServlet', line: 12, context: { element: 'servlet-class', attribute: null } },
    ]);
  });

  it('records a bean class attribute with element and attribute', () => {
    const { fqn } = lex('beans.xml', 'xml', ['<beans>', '  <bean id="o" class="com.acme.Outer$Handler"/>', '</beans>']);
    expect(fqn).toEqual([
      { token: 'com.acme.Outer$Handler', line: 2, context: { element: 'bean', attribute: 'class' } },
    ]);
  });
});

describe('comments never yield candidates', () => {
  it('ignores an XML comment that holds a commented-out bean', () => {
    const { fqn } = lex('beans.xml', 'xml', [
      '<beans>',
      '  <!-- <bean class="com.acme.Legacy"/> -->',
      '  <bean class="com.acme.Live"/>',
      '</beans>',
    ]);
    expect(tokens(fqn)).toEqual(['com.acme.Live']);
    expect(fqn[0].line).toBe(3);
  });

  it('ignores a JSP comment', () => {
    const { fqn, path } = lex('a.jsp', 'jsp', ['<%-- <jsp:include page="old.jsp"/> com.acme.Old --%>', '<jsp:include page="new.jsp"/>']);
    // a file name is dotted, so the live include is on both lists; the comment is on neither
    expect(tokens(fqn)).toEqual(['new.jsp']);
    expect(tokens(path)).toEqual(['new.jsp']);
  });

  it('keeps line numbers across a multi-line comment with markup after it', () => {
    const { fqn } = lex('beans.xml', 'xml', [
      '<beans>', // 1
      '  <!-- first', // 2
      '       <bean class="com.acme.Gone"/>', // 3
      '       still comment -->  <bean class="com.acme.SameLine"/>', // 4
      '  <bean class="com.acme.NextLine"/>', // 5
      '</beans>',
    ]);
    expect(fqn.map((c) => [c.token, c.line])).toEqual([
      ['com.acme.SameLine', 4],
      ['com.acme.NextLine', 5],
    ]);
  });

  it('masks only whole-line comments in properties', () => {
    const { fqn } = lex('app.properties', 'properties', [
      '# handler = com.acme.Hash',
      '   ! handler = com.acme.Bang',
      'handler = com.acme.Live',
      'wrapped = a.b.First \\',
      '   # still the value, com.acme.Continued',
      'tail = x # com.acme.NotAComment',
    ]);
    expect(fqn.map((c) => [c.token, c.line])).toEqual([
      ['com.acme.Live', 3],
      ['a.b.First', 4],
      ['com.acme.Continued', 5],
      ['com.acme.NotAComment', 6],
    ]);
  });

  it('treats an unterminated comment as running to the end of the file', () => {
    const { fqn } = lex('a.xml', 'xml', ['<a class="com.acme.Before"/>', '<!-- never closed', '<b class="com.acme.After"/>']);
    expect(tokens(fqn)).toEqual(['com.acme.Before']);
  });

  it('does not take a comment opener inside CDATA for a comment', () => {
    const { fqn } = lex('a.xml', 'xml', ['<s><![CDATA[ <!-- com.acme.InCdata ]]></s>', '<b class="com.acme.After"/>']);
    expect(tokens(fqn)).toEqual(['com.acme.InCdata', 'com.acme.After']);
    expect(fqn[0].context).toEqual({ element: 's', attribute: null });
  });
});

describe('code files are outside this scan', () => {
  it('yields nothing for a Java string literal', () => {
    const java = ['class A {', '  String s = "com.acme.Foo";', '  String t = "/WEB-INF/x.xml";', '}'];
    expect(lex('A.java', 'java', java)).toEqual({ fqn: [], path: [] });
  });
});

describe('line numbers', () => {
  it('counts CRLF files by line, not by carriage return', () => {
    const text = '<beans>\r\n  <bean class="com.acme.One"/>\r\n\r\n  <bean class="com.acme.Two"/>\r\n</beans>\r\n';
    const { fqn } = lex('beans.xml', 'xml', text);
    expect(fqn.map((c) => [c.token, c.line])).toEqual([['com.acme.One', 2], ['com.acme.Two', 4]]);
    // the carriage return never leaks into a token
    expect(tokens(fqn).every((t) => !t.includes('\r'))).toBe(true);
  });

  it('keeps CRLF line numbers across comments in markup and properties', () => {
    const xml = lex('a.xml', 'xml', '<a>\r\n<!-- x\r\n y -->\r\n<b class="com.acme.C"/>\r\n');
    expect(xml.fqn.map((c) => [c.token, c.line])).toEqual([['com.acme.C', 4]]);
    const props = lex('a.properties', 'properties', '# one\r\n! two\r\nk = com.acme.K\r\n');
    expect(props.fqn.map((c) => [c.token, c.line])).toEqual([['com.acme.K', 3]]);
  });

  it('numbers an attribute value that spans lines by the line the token is on', () => {
    const { fqn } = lex('a.jsp', 'jsp', ['<%@ page', '   import="java.util.List,', '          com.acme.Two" %>']);
    expect(fqn.map((c) => [c.token, c.line])).toEqual([['java.util.List', 2], ['com.acme.Two', 3]]);
  });
});

describe('context', () => {
  it('records element and attribute for an attribute value, element only for text', () => {
    const { path } = lex('order/list.xhtml', 'xhtml', [
      '<ui:composition template="/WEB-INF/templates/main.xhtml">',
      '  <ui:define name="body">',
      '    <ui:include src="row.xhtml"/>',
      '    <welcome-file>index.jsp</welcome-file>',
      '    shared/footer.xhtml',
      '  </ui:define>',
      '</ui:composition>',
      'trailer.xhtml',
    ]);
    expect(path.map((c) => [c.token, c.line, c.context])).toEqual([
      ['/WEB-INF/templates/main.xhtml', 1, { element: 'ui:composition', attribute: 'template' }],
      ['row.xhtml', 3, { element: 'ui:include', attribute: 'src' }],
      ['index.jsp', 4, { element: 'welcome-file', attribute: null }],
      ['shared/footer.xhtml', 5, { element: 'ui:define', attribute: null }],
      ['trailer.xhtml', 8, null], // outside every element
    ]);
  });

  it('names a JSP directive %@page', () => {
    const { fqn, path } = lex('a.jsp', 'jsp', [
      '<%@ page contentType="text/html" import="com.acme.Alpha, com.acme.Beta" %>',
      '<%@ include file="/WEB-INF/jspf/header.jspx" %>',
      '<%@taglib prefix="c" uri="/WEB-INF/c.tld"%>',
    ]);
    expect(fqn.filter((c) => c.token.startsWith('com.acme.')).map((c) => [c.token, c.context])).toEqual([
      ['com.acme.Alpha', { element: '%@page', attribute: 'import' }],
      ['com.acme.Beta', { element: '%@page', attribute: 'import' }],
    ]);
    expect(path.map((c) => [c.token, c.context])).toEqual([
      ['/WEB-INF/jspf/header.jspx', { element: '%@include', attribute: 'file' }],
      ['/WEB-INF/c.tld', { element: '%@taglib', attribute: 'uri' }],
    ]);
  });

  it('is null in a file that is not markup', () => {
    const { fqn, path } = lex('app.properties', 'properties', ['handler=com.acme.H', 'page=/WEB-INF/x.xml']);
    expect(fqn[0].context).toBeNull();
    expect(path[0].context).toBeNull();
    expect(lex('c.yaml', 'yaml', ['class: com.acme.Y']).fqn[0].context).toBeNull();
  });

  it('does not let a void or self-closing element swallow the text after it', () => {
    const { fqn } = lex('a.html', 'html', ['<p>', '  <br>', '  <img src="x.png">', '  com.acme.InP', '</p>']);
    expect(named(fqn, 'com.acme.InP')[0].context).toEqual({ element: 'p', attribute: null });
  });

  it('keeps an XML element named like an HTML void element open', () => {
    const { fqn } = lex('a.xml', 'xml', ['<link>com.acme.InLink</link>']);
    expect(fqn[0].context).toEqual({ element: 'link', attribute: null });
  });

  it('treats script bodies as raw text, not markup', () => {
    const { fqn } = lex('a.html', 'html', ['<script>', '  if (a<b) { go("com.acme.InScript"); }', '</script>', '<p>com.acme.AfterScript</p>']);
    expect(named(fqn, 'com.acme.InScript')[0].context).toEqual({ element: 'script', attribute: null });
    expect(named(fqn, 'com.acme.AfterScript')[0].context).toEqual({ element: 'p', attribute: null });
  });

  it('recovers when an end tag closes elements left open inside it', () => {
    const { fqn } = lex('a.xml', 'xml', ['<a><b><c></a>', '<d>com.acme.Later</d>']);
    expect(fqn[0].context).toEqual({ element: 'd', attribute: null });
  });

  it('survives a start tag it cannot finish and a bare less-than', () => {
    const { fqn } = lex('a.xml', 'xml', ['<a>x < y com.acme.Bare</a>', '<b class="com.acme.Open']);
    expect(tokens(fqn)).toEqual(['com.acme.Bare', 'com.acme.Open']);
  });

  it('treats an undeclared extension as markup only when its first character is <', () => {
    const markup = lex('page.ftl', 'ftl', ['<#-- n/a -->', '<form action="submit.xhtml">com.acme.Form</form>']);
    expect(named(markup.fqn, 'com.acme.Form')[0].context).toEqual({ element: 'form', attribute: null });
    expect(markup.path[0].context).toEqual({ element: 'form', attribute: 'action' });

    const plain = lex('notes.ftl', 'ftl', ['see com.acme.Plain', '<!-- com.acme.NotMasked -->']);
    expect(tokens(plain.fqn)).toEqual(['com.acme.Plain', 'com.acme.NotMasked']);
    expect(plain.fqn[0].context).toBeNull();
  });
});

describe('class-name token boundaries', () => {
  const fqnOf = (text, language = 'yaml') => tokens(lex('f', language, text).fqn);

  it('takes dotted names with $ and members whole', () => {
    expect(fqnOf('a: com.acme.Outer$Inner$1')).toEqual(['com.acme.Outer$Inner$1']);
    expect(fqnOf('a: com.acme.Limits.MAX_SIZE')).toEqual(['com.acme.Limits.MAX_SIZE']);
    expect(fqnOf('a: com.acme.Foo.class')).toEqual(['com.acme.Foo.class']);
  });

  it('needs at least two segments', () => {
    expect(fqnOf('a: Foo')).toEqual([]);
    expect(fqnOf('a: 1.2.3')).toEqual([]);
  });

  it('does not start inside a longer dotted or identifier run', () => {
    expect(fqnOf('a: foo.com.acme.Foo')).toEqual(['foo.com.acme.Foo']);
    expect(fqnOf('a: com.acme.Foo.2')).toEqual([]);
    expect(fqnOf('a: x-com.acme.Foo')).toEqual(['com.acme.Foo']);
  });

  it('allows a sentence-ending dot', () => {
    expect(fqnOf('Handled by com.acme.Foo.')).toEqual(['com.acme.Foo']);
  });

  it('finds every candidate on a line, repeats included', () => {
    expect(fqnOf('a: com.acme.A, com.acme.B com.acme.A')).toEqual(['com.acme.A', 'com.acme.B', 'com.acme.A']);
  });
});

describe('path candidates', () => {
  const pathsOf = (text, language = 'xml', extensions = EXTENSIONS) =>
    lexMentions('f', language, text, { extensions }).path;

  it('splits on whitespace, quotes, brackets, separators and equals', () => {
    const found = pathsOf('<a x="a.xml,b.xml;c.xml (d.xml)" y=e.xml>f.xml</a>');
    expect(tokens(found)).toEqual(['a.xml', 'b.xml', 'c.xml', 'd.xml', 'e.xml', 'f.xml']);
  });

  it('strips classpath and file prefixes, queries and fragments', () => {
    const found = pathsOf([
      'classpath:spring/beans.xml',
      'classpath*:META-INF/spring.xml',
      'file:/etc/app/conf.xml',
      '/orders/list.xhtml?faces-redirect=true',
      '/orders/detail.xhtml#top',
    ].join(' '));
    expect(found.map((c) => [c.token, c.path, c.prefix, c.pattern])).toEqual([
      ['classpath:spring/beans.xml', 'spring/beans.xml', 'classpath', false],
      ['classpath*:META-INF/spring.xml', 'META-INF/spring.xml', 'classpath*', true],
      ['file:/etc/app/conf.xml', '/etc/app/conf.xml', 'file', false],
      ['/orders/list.xhtml?faces-redirect', '/orders/list.xhtml', null, false],
      ['/orders/detail.xhtml#top', '/orders/detail.xhtml', null, false],
    ]);
  });

  it('keeps only extensions present in the manifest', () => {
    expect(tokens(pathsOf('a.xml b.unknownext c.XML .xml noext', 'yaml'))).toEqual(['a.xml', 'c.XML']);
    expect(tokens(pathsOf('a.xml b.jsp', 'yaml', ['.XML']))).toEqual(['a.xml']);
    expect(pathsOf('a.xml', 'yaml', new Set())).toEqual([]);
  });

  it('does not take a directory or a bare extension for a file', () => {
    expect(pathsOf('dir.xml/ .xml', 'yaml')).toEqual([]);
  });

  it('does not take URLs or EL for paths', () => {
    const text = 'http://example.com/a.xml https://h/b.xhtml file:///c.xml #{bean.view}.xhtml ${base}/d.xhtml /WEB-INF/${page}.xhtml';
    expect(pathsOf(text, 'yaml')).toEqual([]);
  });

  it('keeps a plain path next to URLs and EL', () => {
    const text = '<a href="http://h/a.xml" src="#{x.y}" page="real.xhtml"/>';
    expect(tokens(pathsOf(text))).toEqual(['real.xhtml']);
  });

  it('drops wildcards that name no literal directory', () => {
    const none = ['*.xhtml', '**/*.xml', '/*.xhtml', '*/*.xml', 'classpath*:*.xml', 'classpath*:**/*.xml', 'spring/*'];
    expect(pathsOf(none.join(' '))).toEqual([]);
  });

  it('keeps wildcards that do name a literal directory, as patterns', () => {
    const found = pathsOf('spring/*.xml /WEB-INF/spring/*-context.xml classpath*:spring/**/*.xml a/**/b.xml ../conf/*.xml');
    expect(found.map((c) => [c.path, c.pattern])).toEqual([
      ['spring/*.xml', true],
      ['/WEB-INF/spring/*-context.xml', true],
      ['spring/**/*.xml', true],
      ['a/**/b.xml', true],
      ['../conf/*.xml', true],
    ]);
  });

  it('reads the url-pattern of a descriptor as no path', () => {
    const { path } = lex('WEB-INF/web.xml', 'xml', ['<url-pattern>*.xhtml</url-pattern>', '<url-pattern>/faces/*</url-pattern>']);
    expect(path).toEqual([]);
  });

  it('finds a file name that is also a dotted class-name token on both lists', () => {
    const { fqn, path } = lex('a.xml', 'xml', ['<welcome-file>index.jsp</welcome-file>']);
    expect(tokens(fqn)).toEqual(['index.jsp']);
    expect(tokens(path)).toEqual(['index.jsp']);
  });
});

describe('the code-language predicate', () => {
  it('is derived from the registry, not from a list in the lexer', () => {
    const treeSitterIds = builtinLanguageConfigs.filter((c) => c.treeSitter).map((c) => c.id);
    expect(treeSitterIds).toEqual(expect.arrayContaining(['java', 'typescript', 'kotlin']));
    for (const id of treeSitterIds) expect(isCodeLanguage(id), id).toBe(true);
    for (const config of builtinLanguageConfigs.filter((c) => !c.treeSitter)) {
      expect(isCodeLanguage(config.id), config.id).toBe(false);
    }

    // a synthetic registry changes the answer with no edit to the lexer
    const custom = codeLanguagePredicate([
      { id: 'newlang', treeSitter: { wasmPackage: 'x', wasmFile: 'y' } },
      { id: 'java' },
    ]);
    expect(custom('newlang')).toBe(true);
    expect(custom('java')).toBe(false);
  });

  it('names java, typescript and kotlin code; markup, properties, shell and sql not', () => {
    for (const language of ['java', 'typescript', 'kotlin']) expect(isCodeLanguage(language), language).toBe(true);
    for (const language of ['xml', 'jsp', 'xhtml', 'properties', 'shell', 'sql']) {
      expect(isCodeLanguage(language), language).toBe(false);
    }
    // the ones the registry does not know at all are not code either
    expect(isCodeLanguage('unknown')).toBe(false);
    expect(isCodeLanguage(undefined)).toBe(false);
  });
});

describe('malformed and hostile input', () => {
  it('keeps every candidate on the line it was read from, whatever the markup', () => {
    // deterministic pseudo-random documents built from markup fragments
    const fragments = ['<', '>', '</', '/>', '<!--', '-->', '<%--', '--%>', '<%@ page import="', '<%', '%>', '<![CDATA[', ']]>', '<?', '?>',
      '"', "'", '=', ' ', '\n', '\r\n', '\t', 'com.acme.Foo', 'a.b.C$D', 'x.xml', '/WEB-INF/a.xhtml', 'classpath*:spring/*.xml', '#{a.b}',
      '${a.b}', 'http://h/x.xml', '# c', '! c', '\\', 'bean', 'class=', 'ui:include', 'src=', '<script>', '</script>', '<br>', '.', '*', '?', '#'];
    const languages = ['xml', 'html', 'jsp', 'properties', 'yaml', 'ftl', 'xhtml', 'shell'];
    let seed = 12345;
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    let seen = 0;
    for (let i = 0; i < 3000; i++) {
      let text = '';
      for (let j = 1 + Math.floor(next() * 60); j > 0; j--) text += fragments[Math.floor(next() * fragments.length)];
      const lines = text.split('\n');
      const { fqn, path } = lexMentions('f', languages[i % languages.length], text, { extensions: EXTENSIONS });
      for (const c of [...fqn, ...path]) {
        seen++;
        expect(c.line).toBeGreaterThanOrEqual(1);
        expect(c.line).toBeLessThanOrEqual(lines.length);
        expect(lines[c.line - 1], JSON.stringify(text)).toContain(c.token);
      }
    }
    expect(seen).toBeGreaterThan(1000); // the generator does produce candidates
  });

  it('does not slow down on tags that never close', () => {
    const started = Date.now();
    for (const piece of ['<a ', '<a b="', '</a ', '<!x ', '<%@ page ']) {
      lexMentions('f', 'jsp', piece.repeat(40000), { extensions: EXTENSIONS });
    }
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('does not read an end tag with junk after the name as an end tag', () => {
    const { fqn } = lex('a.xml', 'xml', ['<a><b></b junk>com.acme.Still</a>']);
    expect(fqn[0].context).toEqual({ element: 'b', attribute: null });
  });
});

// Mutation tripwire (task 1.3): the comment cases above must be able to fail.
// Each case below states something a comment must NOT yield; turning comment
// masking off (the lexer's test seam) makes every one of them fail, which is
// the proof that the masking assertions would turn red if masking broke.
describe('tripwire: comment masking', () => {
  const cases = [
    { name: 'xml comment', path: 'b.xml', language: 'xml', text: '<!-- <bean class="com.acme.Legacy"/> -->', forbidden: 'com.acme.Legacy' },
    { name: 'multi-line xml comment', path: 'b.xml', language: 'xml', text: '<!--\n<bean class="com.acme.Legacy"/>\n-->', forbidden: 'com.acme.Legacy' },
    { name: 'jsp comment', path: 'a.jsp', language: 'jsp', text: '<%-- com.acme.Legacy --%>', forbidden: 'com.acme.Legacy' },
    { name: 'xhtml comment path', path: 'a.xhtml', language: 'xhtml', text: '<!-- <ui:include src="old.xhtml"/> -->', forbidden: 'old.xhtml', list: 'path' },
    { name: 'properties # comment', path: 'a.properties', language: 'properties', text: '# a = com.acme.Legacy', forbidden: 'com.acme.Legacy' },
    { name: 'properties ! comment', path: 'a.properties', language: 'properties', text: '  ! a = com.acme.Legacy', forbidden: 'com.acme.Legacy' },
  ];
  const yielded = (c, options) => {
    const result = lexMentions(c.path, c.language, c.text, { extensions: EXTENSIONS, ...options });
    return tokens(result[c.list ?? 'fqn']).includes(c.forbidden);
  };

  it('holds with masking on (the production default)', () => {
    for (const c of cases) expect(yielded(c, {}), c.name).toBe(false);
  });

  it('breaks every case when masking is turned off', () => {
    for (const c of cases) expect(yielded(c, { maskComments: false }), c.name).toBe(true);
  });
});
