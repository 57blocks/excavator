// name-binding-references, task 3.1: the single-file EL lexer. Pure input and
// output - no project on disk. It reads the root names of every `#{...}` and
// `${...}` in a template (and the member chain after each), by the rules of the
// shipped catalog's expression language; what a root name is bound to is a later
// stage with its own tests.
import { describe, expect, it } from 'vitest';
import { lexElExpressions } from '../../skills/excavator/el-expressions.mjs';
import { loadNameBindingCatalog } from '../../skills/excavator/name-binding-catalog.mjs';

const EL = loadNameBindingCatalog().expressionLanguages[0];

const lex = (lines, options = {}) =>
  lexElExpressions(Array.isArray(lines) ? lines.join('\n') : lines, { language: 'xhtml', expressionLanguage: EL, ...options });
const tokens = (result) => result.roots.map((r) => r.token);
const brief = (result) => result.roots.map((r) => [r.token, r.chain, r.local, r.line]);

describe('what is an expression', () => {
  it('reads both delimiters of the language, in document order', () => {
    expect(brief(lex(['<p>#{orders.save}</p>', '<p>${cart.total}</p>']))).toEqual([
      ['orders', 'orders.save', false, 1],
      ['cart', 'cart.total', false, 2],
    ]);
  });

  it('takes the delimiters from the catalog: a language with only #{ does not read ${', () => {
    const narrowed = { ...EL, delimiters: ['#{'] };
    expect(tokens(lex('<p>#{a.b} ${c.d}</p>', { expressionLanguage: narrowed }))).toEqual(['a']);
  });

  it('ignores a lone # or $ and a delimiter-free text', () => {
    expect(lex('<p>price $5 # 3 {not} </p>')).toEqual({ roots: [], escaped: 0, unterminated: 0 });
  });

  it('reads text with no markup at all', () => {
    expect(brief(lex('hello ${user.name}', { language: 'jsp' }))).toEqual([['user', 'user.name', false, 1]]);
  });
});

describe('comments and escapes (spec: expressions in comments and escapes do not count)', () => {
  it('skips a markup comment and an escaped delimiter, counting the escape', () => {
    const result = lex(['<!-- #{orders.secret} -->', '\\#{orders.raw}']);
    expect(result).toEqual({ roots: [], escaped: 1, unterminated: 0 });
  });

  it('skips a JSP comment and keeps the lines of what follows a multi-line comment', () => {
    const result = lex(['<%-- ${a.b}', '   still ${c.d} --%>  ${live.one}', '${live.two}'], { language: 'jsp' });
    expect(brief(result)).toEqual([['live', 'live.one', false, 2], ['live', 'live.two', false, 3]]);
  });

  it('counts an escaped ${ as well, and keeps reading after it', () => {
    const result = lex('<p>\\${x.y} #{real.one}</p>');
    expect(result.escaped).toBe(1);
    expect(tokens(result)).toEqual(['real']);
  });

  it('reads the comment as live when the mask is switched off (mutation tripwire)', () => {
    const result = lex('<!-- #{orders.secret} -->', { mutations: { noCommentMask: true } });
    expect(tokens(result)).toEqual(['orders']);
  });
});

describe('JSP scripting is not EL', () => {
  const jsp = (lines) => lex(lines, { language: 'jsp' });

  it('skips scriptlets, scripting expressions and declarations', () => {
    const result = jsp([
      '<% String s = "${a.b}"; %>',
      '<%= "${c.d}" %>',
      '<%! String e = "${f.g}"; %>',
      '${live.one}',
    ]);
    expect(brief(result)).toEqual([['live', 'live.one', false, 4]]);
  });

  it('keeps reading the attributes of a directive', () => {
    expect(tokens(jsp('<%@ include file="${page.path}" %>'))).toEqual(['page']);
  });

  it('skips the body of jsp:scriptlet, jsp:expression and jsp:declaration but not other jsp elements', () => {
    const result = jsp([
      '<jsp:scriptlet>${a.b}</jsp:scriptlet>',
      '<jsp:expression>${c.d}</jsp:expression>',
      '<jsp:declaration>${e.f}</jsp:declaration>',
      '<jsp:include page="${g.h}"/>',
      '<jsp:text>${i.j}</jsp:text>',
    ]);
    expect(tokens(result)).toEqual(['g', 'i']);
  });

  it('does not mask CDATA or a script element: both are template text', () => {
    const result = lex(['<script>var a = #{orders.js};</script>', '<![CDATA[ ${orders.cdata} ]]>']);
    expect(tokens(result)).toEqual(['orders', 'orders']);
    expect(result.roots.map((r) => r.chain)).toEqual(['orders.js', 'orders.cdata']);
  });
});

describe('what is a root name', () => {
  it('skips function prefixes and names, and keeps both arms of a ternary (spec: functions and ternary)', () => {
    const result = lex('<p>#{fn:length(orders.items) gt 0 ? cart.total : 0}</p>');
    expect(brief(result)).toEqual([['orders', 'orders.items', false, 1], ['cart', 'cart.total', false, 1]]);
  });

  it('keeps the arms of a plain ternary', () => {
    expect(tokens(lex('#{a.ok ? b : c}'))).toEqual(['a', 'b', 'c']);
  });

  it('reads entities and character references as the characters they stand for (spec: entity in attribute)', () => {
    const result = lex('<h:panel rendered="#{orders.open &amp;&amp; not cart.empty}"/>');
    expect(brief(result)).toEqual([['orders', 'orders.open', false, 1], ['cart', 'cart.empty', false, 1]]);
    expect(tokens(result)).not.toContain('amp');
  });

  it('reads &lt; &gt; &quot; &apos; and numeric references, and makes no identifier of an unknown entity', () => {
    const result = lex([
      '<a v="#{a.n &lt; 3 and b.n &gt; 1}"/>',
      '<a v="#{c.name == &quot;x&quot; or d.name == &#39;y&#39; or e.v == &#x27;z&#x27;}"/>',
      '<a v="#{f.x&nbsp;g.y}"/>',
      '<a v="#{h.x == &apos;it&apos;}"/>',
    ]);
    expect(tokens(result)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(tokens(result)).not.toContain('nbsp');
    expect(tokens(result)).not.toContain('quot');
    expect(tokens(result)).not.toContain('x');
  });

  it('gives a root after an entity its own line, not the line the entity count suggests', () => {
    const result = lex(['<a v="&amp;&amp;&amp;"/>', '<a v="&amp; #{later.one}"/>']);
    expect(brief(result)).toEqual([['later', 'later.one', false, 2]]);
  });

  it('does not take the letters of a string literal for names, and a } inside a string does not end the expression', () => {
    const result = lex(`<p>#{msg['order.title'] eq "total" ? x : y} #{fn:contains(a.b, '}')} #{c.d eq 'it\\'s e.f'}</p>`);
    expect(tokens(result)).toEqual(['msg', 'x', 'y', 'a', 'c']);
  });

  it('counts nested braces, so the expression ends at its own closing brace', () => {
    const result = lex('#{x.foo({"k": b.c})} then #{y.z}');
    expect(tokens(result)).toEqual(['x', 'b', 'y']);
    expect(result.unterminated).toBe(0);
  });

  it('does not take a keyword after a dot for a keyword, nor for a root', () => {
    const result = lex('#{bean.empty and not x.y or z.not}');
    expect(brief(result)).toEqual([['bean', 'bean.empty', false, 1], ['x', 'x.y', false, 1], ['z', 'z.not', false, 1]]);
  });

  it('skips every keyword where a root could stand', () => {
    expect(tokens(lex('#{empty a or b and c eq d ne e lt f gt g le h ge i div j mod k and not l instanceof m}')))
      .toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm']);
  });

  it('takes no name from a number literal, exponent or not', () => {
    expect(brief(lex('#{x.y gt 1e5 and z.w lt 2.5E-3 or 10 mod 3 eq .5}'))).toEqual([['x', 'x.y', false, 1], ['z', 'z.w', false, 1]]);
  });

  it('reads a root inside brackets, and stops the chain at the bracket', () => {
    expect(brief(lex(`#{map[key].v} #{map['k'].v}`))).toEqual([
      ['map', 'map', false, 1],
      ['key', 'key', false, 1],
      ['map', 'map', false, 1],
    ]);
  });

  it('chains member accesses, whitespace around the dot included, and ends at a call or index', () => {
    expect(brief(lex('#{orders.items[0].price} #{orders . items} #{orders.save()} #{orders}'))).toEqual([
      ['orders', 'orders.items', false, 1],
      ['orders', 'orders.items', false, 1],
      ['orders', 'orders.save', false, 1],
      ['orders', 'orders', false, 1],
    ]);
  });

  it('reads the arguments of a call as roots of their own', () => {
    expect(tokens(lex('#{orders.find(id, cart.total)}'))).toEqual(['orders', 'id', 'cart']);
  });
});

describe('lambda parameters', () => {
  it('makes a single parameter local inside its body, and is not itself a root', () => {
    expect(brief(lex('#{orders.items.stream().map(x -> x.price).sum()}'))).toEqual([
      ['orders', 'orders.items.stream', false, 1],
      ['x', 'x.price', true, 1],
    ]);
  });

  it('reads a parenthesized parameter list', () => {
    expect(brief(lex('#{list.reduce((a, b) -> a + b.n)}'))).toEqual([
      ['list', 'list.reduce', false, 1],
      ['a', 'a', true, 1],
      ['b', 'b.n', true, 1],
    ]);
  });

  it('ends the parameter\'s scope with its body: a later argument of the same name is a root again', () => {
    expect(brief(lex('#{foo.apply(x -> x.y, x.z)}'))).toEqual([
      ['foo', 'foo.apply', false, 1],
      ['x', 'x.y', true, 1],
      ['x', 'x.z', false, 1],
    ]);
  });

  it('does not take a parenthesized group without an arrow for a parameter list', () => {
    expect(tokens(lex('#{(a.b + c.d) * e.f}'))).toEqual(['a', 'c', 'e']);
    expect(lex('#{(a.b + c.d) * e.f}').roots.every((r) => !r.local)).toBe(true);
  });
});

describe('names a tag declares', () => {
  const FACELETS = 'xmlns:ui="http://java.sun.com/jsf/facelets"';
  const page = [
    `<html ${FACELETS} xmlns:f="http://xmlns.jcp.org/jsf/core" xmlns:h="http://java.sun.com/jsf/html">`,
    '<ui:repeat value="#{orders.items}" var="item" varStatus="st">',
    '  #{item.price} #{st.index} #{orders.total}',
    '</ui:repeat>',
    '<ui:param name="title" value="#{theme.x}"/>',
    '<h:outputText value="#{title}"/>',
    '<jsp:useBean id="helper" class="a.B"/>',
    '<f:attribute name="orders" value="#{plain.v}"/>',
    '<h:inputText id="field" value="#{field.v}"/>',
  ];
  const local = (result, token) => result.roots.filter((r) => r.token === token).map((r) => r.local);

  it('marks var, varStatus, Facelets param name and useBean id local, wherever they sit in the file', () => {
    const result = lex([...page, '#{helper.x}', '#{item.late}']);
    expect(local(result, 'item')).toEqual([true, true]);
    expect(local(result, 'st')).toEqual([true]);
    expect(local(result, 'title')).toEqual([true]);
    expect(local(result, 'helper')).toEqual([true]);
    // the iterated collection and the value of ui:param are not declared by those attributes
    expect(local(result, 'orders')).toEqual([false, false]);
    expect(local(result, 'theme')).toEqual([false]);
  });

  it('does not take a name attribute of another element or an id of another element for a declaration', () => {
    const result = lex(page);
    expect(local(result, 'plain')).toEqual([false]);
    expect(local(result, 'field')).toEqual([false]);
  });

  it('does not take the request parameter name of f:param, c:param or jsp:param for a local name (spec)', () => {
    const result = lex([
      '<html xmlns:f="http://xmlns.jcp.org/jsf/core" xmlns:c="http://java.sun.com/jsp/jstl/core">',
      '<f:param name="cart" value="#{orderId}"/>',
      '<c:param name="rows" value="1"/>',
      '<jsp:param name="cols" value="1"/>',
      '#{cart.total} #{rows.n} #{cols.n}',
    ]);
    expect(local(result, 'cart')).toEqual([false]);
    expect(local(result, 'rows')).toEqual([false]);
    expect(local(result, 'cols')).toEqual([false]);
  });

  it('takes ui:param for a declaration under each of the three Facelets namespaces', () => {
    for (const uri of ['http://java.sun.com/jsf/facelets', 'http://xmlns.jcp.org/jsf/facelets', 'jakarta.faces.facelets']) {
      const result = lex([`<html xmlns:u="${uri}"><u:param name="p" value="1"/>`, '#{p.x}']);
      expect(local(result, 'p'), uri).toEqual([true]);
    }
  });

  it('does not take ui:param for a declaration when the prefix is bound to nothing in the file, or to another namespace', () => {
    expect(local(lex(['<ui:param name="p" value="1"/>', '#{p.x}']), 'p')).toEqual([false]);
    expect(local(lex(['<html xmlns:ui="urn:other"><ui:param name="p" value="1"/>', '#{p.x}']), 'p')).toEqual([false]);
  });

  it('reads an element with no prefix in the default namespace of the file', () => {
    expect(local(lex(['<html xmlns="http://java.sun.com/jsf/facelets"><param name="p" value="1"/>', '#{p.x}']), 'p')).toEqual([true]);
    expect(local(lex(['<html xmlns="http://www.w3.org/1999/xhtml"><param name="p" value="1"/>', '#{p.x}']), 'p')).toEqual([false]);
    expect(local(lex(['<param name="p" value="1"/>', '#{p.x}']), 'p')).toEqual([false]);
  });

  it('counts a prefix bound to several namespaces as any of them (more names local never makes an edge)', () => {
    const result = lex(['<a xmlns:p="urn:other"><b xmlns:p="http://java.sun.com/jsf/facelets"/></a>', '<p:param name="q" value="1"/>', '#{q.x}']);
    expect(local(result, 'q')).toEqual([true]);
  });

  it('reads the prefixes a JSP taglib directive binds, uri and prefix in either order', () => {
    const jsp = (directive) => lex([directive, '<ui:param name="q" value="1"/>', '${q.x}'], { language: 'jsp' });
    expect(local(jsp('<%@ taglib prefix="ui" uri="http://java.sun.com/jsf/facelets" %>'), 'q')).toEqual([true]);
    expect(local(jsp('<%@ taglib uri="http://java.sun.com/jsf/facelets" prefix="ui" %>'), 'q')).toEqual([true]);
    expect(local(jsp('<%@ taglib prefix="ui" uri="urn:other" %>'), 'q')).toEqual([false]);
    expect(local(jsp('<%@ taglib prefix="x" uri="http://java.sun.com/jsf/facelets" %>'), 'q')).toEqual([false]);
  });

  it('matches useBean by its local name in any namespace, as classic JSP binds none to the jsp: prefix', () => {
    expect(local(lex(['<jsp:useBean id="b" class="a.B"/>', '${b.x}'], { language: 'jsp' }), 'b')).toEqual([true]);
    expect(local(lex(['<useBean id="b" class="a.B"/>', '${b.x}'], { language: 'jsp' }), 'b')).toEqual([true]);
  });

  it('ignores a declaration whose value is not a plain name', () => {
    expect(brief(lex(['<ui:repeat var="#{x}" value="#{y.z}"/>', '#{x.q}'])).map((r) => r[2])).toEqual([false, false, false]);
  });
});

describe('expression roots an attribute declares (Tomahawk aliasBean)', () => {
  const TAGLIB = '<%@ taglib prefix="t" uri="http://myfaces.apache.org/tomahawk" %>';
  const jsp = (lines, options) => lex(lines, { language: 'jsp', ...options });
  const local = (result, token) => result.roots.filter((r) => r.token === token).map((r) => r.local);

  it('makes the root of the alias expression local, and every use of that name in the file, the alias itself included (spec)', () => {
    const result = jsp([TAGLIB, '<t:aliasBean alias="#{bean}" value="#{orders}">', '  #{bean.save}', '</t:aliasBean>']);
    expect(local(result, 'bean')).toEqual([true, true]);
    expect(local(result, 'orders')).toEqual([false]);
  });

  it('reads the alias of a prefix bound by xmlns, and a member chain in the alias', () => {
    const result = lex(['<html xmlns:t="http://myfaces.apache.org/tomahawk">', '<t:aliasBean alias="#{cart.item}" value="#{x}"/>', '#{cart.total}']);
    expect(local(result, 'cart')).toEqual([true, true]);
  });

  it('does not take an alias that is not an expression, or an element of another namespace', () => {
    expect(local(jsp([TAGLIB, '<t:aliasBean alias="plain" value="#{orders}"/>', '${plain.x}']), 'plain')).toEqual([false]);
    expect(local(jsp(['<%@ taglib prefix="t" uri="urn:other" %>', '<t:aliasBean alias="#{bean}"/>', '${bean.x}']), 'bean')).toEqual([false, false]);
    expect(local(jsp(['<t:aliasBean alias="#{bean}"/>', '${bean.x}']), 'bean')).toEqual([false, false]);
  });

  it('does not take a different attribute of aliasBean for a declaration', () => {
    expect(local(jsp([TAGLIB, '<t:aliasBean alias="#{a}" value="#{b}"/>', '${b.x}']), 'b')).toEqual([false, false]);
  });

  it('is only a name when the switch is on: the expression roots are not made local (mutation tripwire)', () => {
    const result = jsp([TAGLIB, '<t:aliasBean alias="#{bean}" value="#{orders}">', '  #{bean.save}', '</t:aliasBean>'], { mutations: { noExpressionLocals: true } });
    expect(local(result, 'bean')).toEqual([false, false]);
  });
});

describe('lines and unterminated expressions', () => {
  it('gives a root the line it is on, in a multi-line expression too', () => {
    const result = lex(['<h:outputText value="#{orders.a', '   + cart.b', '   + other.c}"/>']);
    expect(brief(result)).toEqual([['orders', 'orders.a', false, 1], ['cart', 'cart.b', false, 2], ['other', 'other.c', false, 3]]);
  });

  it('counts lines across CRLF', () => {
    const result = lexElExpressions('<p>\r\n#{a.b}\r\n<!-- x\r\n y -->\r\n#{c.d}\r\n</p>', { language: 'xhtml', expressionLanguage: EL });
    expect(brief(result)).toEqual([['a', 'a.b', false, 2], ['c', 'c.d', false, 5]]);
  });

  it('counts an expression with no closing brace and makes no root of it', () => {
    expect(lex('<p>text #{orders.items')).toEqual({ roots: [], escaped: 0, unterminated: 1 });
    expect(lex('<p>#{orders.items</p><p>#{ok.one}</p>')).toEqual({ roots: [{ line: 1, token: 'ok', chain: 'ok.one', local: false }], escaped: 0, unterminated: 1 });
  });

  it('goes on reading after the delimiter of an unterminated expression, so a missing brace does not swallow what follows (spec)', () => {
    const text = ['<p>', '', '#{orders.title', '', '', '', '', '', '#{cart.total}', '</p>'].join('\n');
    const result = lex(text);
    expect(result.unterminated).toBe(1);
    expect(brief(result)).toEqual([['cart', 'cart.total', false, 9]]);
  });

  it('counts each unterminated delimiter once', () => {
    expect(lex('<p>#{a #{b #{c</p>')).toEqual({ roots: [], escaped: 0, unterminated: 3 });
    expect(brief(lex('<p>#{a.b #{c.d} #{e.f</p>'))).toEqual([['c', 'c.d', false, 1]]);
    expect(lex('<p>#{a.b #{c.d} #{e.f</p>').unterminated).toBe(2);
  });

  it('counts an unterminated string in an expression as unterminated', () => {
    expect(lex("<p>#{a.b eq 'oops}</p>")).toEqual({ roots: [], escaped: 0, unterminated: 1 });
  });

  it('is empty for an empty text', () => {
    expect(lex('')).toEqual({ roots: [], escaped: 0, unterminated: 0 });
  });
});
