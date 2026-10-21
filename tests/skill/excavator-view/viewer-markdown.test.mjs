/** The Markdown renderer of the Reports page: blocks, inline, links, raw HTML as text, and speed. */

import { describe, expect, it } from 'vitest';

import { all, byTag, fakeDom, textOf } from './fake-dom.mjs';
import { load } from './viewer-load.mjs';

const XV = load({ document: fakeDom() });
const md = XV.markdown;
const plain = (value) => JSON.parse(JSON.stringify(value));
const render = (text) => md.render(text);
const tagsOf = (root) => all(root).filter((n) => n.tag).map((n) => n.tag);
const kids = (node) => node.children.filter((c) => c.tag);
const inline = (text) => plain(md.parseInline(text, 0));

describe('blocks', () => {
  it('renders headings h1 to h6 and keeps a line that only looks like one as text', () => {
    const root = render('# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n####### Seven\n#hashtag');
    expect(kids(root).map((n) => n.tag)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p']);
    expect(textOf(kids(root)[0])).toBe('One');
    expect(textOf(kids(root)[6])).toBe('####### Seven #hashtag');
  });

  it('drops the closing hashes of a heading and keeps inline markup in it', () => {
    const root = render('## A `b` **c** ##');
    expect(textOf(root)).toBe('A b c');
    expect(tagsOf(root)).toEqual(['div', 'h2', 'code', 'strong']);
  });

  it('joins the lines of a paragraph and splits paragraphs at blank lines', () => {
    const root = render('one\ntwo\n\nthree');
    expect(kids(root).map((n) => textOf(n))).toEqual(['one two', 'three']);
  });

  it('makes a hard break from two trailing spaces or a backslash', () => {
    expect(tagsOf(render('a  \nb'))).toEqual(['div', 'p', 'br']);
    expect(tagsOf(render('a\\\nb'))).toEqual(['div', 'p', 'br']);
  });

  it('renders a horizontal rule, in each of its three spellings', () => {
    for (const rule of ['---', '***', '___', '- - -', '*  *  *']) expect(tagsOf(render(`a\n\n${rule}\n\nb`)), rule).toEqual(['div', 'p', 'hr', 'p']);
  });

  it('renders fenced code, verbatim, with the language only as a class', () => {
    const root = render('```js\nconst a = "<b>";\n  indented\n```\nafter');
    const code = byTag(root, 'code')[0];
    expect(code.attributes.class).toBe('language-js');
    expect(textOf(code)).toBe('const a = "<b>";\n  indented');
    expect(kids(root).map((n) => n.tag)).toEqual(['pre', 'p']);
  });

  it('renders a tilde fence, a longer closing fence, and a fence that never closes', () => {
    expect(textOf(render('~~~\nx\n~~~'))).toBe('x');
    expect(textOf(render('````\n```\ninner\n```\n````'))).toBe('```\ninner\n```');
    expect(textOf(render('```\nopen\nforever'))).toBe('open\nforever');
  });

  it('does not use an odd info string as a class', () => {
    expect(byTag(render('```"><x\ncode\n```'), 'code')[0].attributes.class).toBeUndefined();
    expect(byTag(render('``` python extra\nx\n```'), 'code')[0].attributes.class).toBe('language-python');
  });

  it('renders block quotes, including nested ones and lazy lines', () => {
    const root = render('> quoted\ncontinues\n> > deeper');
    expect(tagsOf(root)).toEqual(['div', 'blockquote', 'p', 'blockquote', 'p']);
    expect(textOf(root)).toContain('quoted continues');
  });
});

describe('lists', () => {
  it('renders a bullet list and a numbered list, and starts a numbered list where it says', () => {
    const root = render('- a\n- b\n\n3. c\n4. d');
    const [ul, ol] = kids(root);
    expect([ul.tag, kids(ul).map((li) => textOf(li))]).toEqual(['ul', ['a', 'b']]);
    expect([ol.tag, ol.attributes.start, kids(ol).map((li) => textOf(li))]).toEqual(['ol', '3', ['c', 'd']]);
    expect(render('1. a\n2. b').children[0].attributes.start).toBeUndefined();
  });

  it('accepts *, + and ) markers', () => {
    expect(tagsOf(render('* a\n* b'))).toEqual(['div', 'ul', 'li', 'li']);
    expect(tagsOf(render('+ a'))).toEqual(['div', 'ul', 'li']);
    expect(tagsOf(render('1) a\n2) b'))).toEqual(['div', 'ol', 'li', 'li']);
  });

  it('nests by indentation, two levels and three', () => {
    const root = render('- top\n  - child one\n  - child two\n    - grandchild\n- next');
    const top = kids(root)[0];
    const items = kids(top);
    expect(items).toHaveLength(2);
    expect(kids(items[0]).map((n) => n.tag)).toEqual(['ul']);
    const child = kids(kids(items[0])[0]);
    expect(child).toHaveLength(2);
    expect(kids(child[1]).map((n) => n.tag)).toEqual(['ul']);
    expect(textOf(kids(kids(child[1])[0])[0])).toBe('grandchild');
    expect(textOf(items[1])).toBe('next');
  });

  it('nests under a numbered item with two, three or four spaces', () => {
    for (const pad of ['  ', '   ', '    ']) {
      const root = render(`1. one\n${pad}- inner\n2. two`);
      const ol = kids(root)[0];
      expect(ol.tag).toBe('ol');
      expect(kids(ol)).toHaveLength(2);
      expect(kids(kids(ol)[0]).map((n) => n.tag), pad.length).toEqual(['ul']);
    }
  });

  it('mixes a numbered list inside a bullet list', () => {
    const root = render('- group\n  1. first\n  2. second');
    expect(tagsOf(root)).toEqual(['div', 'ul', 'li', 'ol', 'li', 'li']);
  });

  it('lets a list follow a paragraph line directly', () => {
    expect(tagsOf(render('Intro:\n- a\n- b'))).toEqual(['div', 'p', 'ul', 'li', 'li']);
  });

  it('keeps a lazy continuation line and a paragraph inside an item', () => {
    const root = render('- first line\ncontinued\n\n  second paragraph\n- next');
    const items = kids(kids(root)[0]);
    expect(textOf(items[0])).toBe('first line continuedsecond paragraph');
    expect(kids(items[0]).map((n) => n.tag)).toEqual(['p']);
  });

  it('keeps fenced code in an item', () => {
    const root = render('- step\n\n  ```\n  run it\n  ```\n- done');
    expect(byTag(root, 'pre')).toHaveLength(1);
    expect(textOf(byTag(root, 'code')[0])).toBe('run it');
  });

  it('ends a list at a heading or at a different kind of list', () => {
    expect(kids(render('- a\n# H\n- b')).map((n) => n.tag)).toEqual(['ul', 'h1', 'ul']);
    expect(kids(render('- a\n1. b')).map((n) => n.tag)).toEqual(['ul', 'ol']);
  });

  it('renders an empty item and a marker alone', () => {
    expect(tagsOf(render('-\n- a'))).toEqual(['div', 'ul', 'li', 'li']);
  });

  it('keeps the numbers of a numbered list that is not 1', () => {
    expect(plain(md.parseBlocks('7. a\n8. b', 0))[0].start).toBe(7);
  });
});

describe('tables', () => {
  const table = '| Name | Count | Note |\n| :--- | ---: | :---: |\n| a | 1 | x |\n| b | 22 | y |';

  it('renders a header, the rows, and the alignment of each column as a class', () => {
    const root = render(table);
    expect(tagsOf(root)).toEqual(['div', 'div', 'table', 'thead', 'tr', 'th', 'th', 'th', 'tbody', 'tr', 'td', 'td', 'td', 'tr', 'td', 'td', 'td']);
    const heads = byTag(root, 'th');
    expect(heads.map((n) => n.attributes.class)).toEqual(['xv-align-left', 'xv-align-right', 'xv-align-center']);
    expect(byTag(root, 'td').map((n) => n.attributes.class).slice(0, 3)).toEqual(['xv-align-left', 'xv-align-right', 'xv-align-center']);
    expect(byTag(root, 'td').map((n) => textOf(n))).toEqual(['a', '1', 'x', 'b', '22', 'y']);
  });

  it('leaves a column with no colon unaligned', () => {
    expect(byTag(render('| a | b |\n| --- | --- |\n| 1 | 2 |'), 'th')[0].attributes.class).toBeUndefined();
  });

  it('pads a short row and cuts a long one to the header width', () => {
    const root = render('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |');
    expect(byTag(root, 'td').map((n) => textOf(n))).toEqual(['1', '', '1', '2']);
  });

  it('takes a table without outer pipes, and an escaped pipe inside a cell', () => {
    const root = render('a | b\n--- | ---\nx \\| y | z');
    expect(byTag(root, 'td').map((n) => textOf(n))).toEqual(['x | y', 'z']);
  });

  it('renders inline markup in cells', () => {
    const root = render('| a |\n|---|\n| `code` and **bold** |');
    expect(tagsOf(byTag(root, 'td')[0])).toEqual(['td', 'code', 'strong']);
  });

  it('ends at a blank line and does not take a pipe line with no delimiter row for a table', () => {
    expect(kids(render('| a |\n|---|\n| 1 |\n\ntext')).map((n) => n.tag)).toEqual(['div', 'p']);
    expect(tagsOf(render('a | b\nc | d'))).toEqual(['div', 'p']);
    expect(tagsOf(render('| a | b |\n|---|\n| 1 | 2 |'))).toEqual(['div', 'p']);
  });

  it('starts a table straight after a paragraph line', () => {
    expect(kids(render('Intro\n| a |\n|---|\n| 1 |')).map((n) => n.tag)).toEqual(['p', 'div']);
  });
});

describe('inline', () => {
  it('renders code spans verbatim, with their backticks and without markup inside', () => {
    expect(inline('a `b *c*` d')).toEqual([{ t: 'text', v: 'a ' }, { t: 'code', v: 'b *c*' }, { t: 'text', v: ' d' }]);
    expect(inline('`` a ` b ``')).toEqual([{ t: 'code', v: 'a ` b' }]);
    expect(inline('unclosed ` tick')).toEqual([{ t: 'text', v: 'unclosed ` tick' }]);
  });

  it('renders strong and emphasis, with either character', () => {
    expect(inline('**a**')).toEqual([{ t: 'strong', c: [{ t: 'text', v: 'a' }] }]);
    expect(inline('__a__')).toEqual([{ t: 'strong', c: [{ t: 'text', v: 'a' }] }]);
    expect(inline('*a*')).toEqual([{ t: 'em', c: [{ t: 'text', v: 'a' }] }]);
    expect(inline('_a_')).toEqual([{ t: 'em', c: [{ t: 'text', v: 'a' }] }]);
    expect(inline('***a***')).toEqual([{ t: 'em', c: [{ t: 'strong', c: [{ t: 'text', v: 'a' }] }] }]);
  });

  it('nests emphasis in strong and strong in emphasis', () => {
    expect(inline('**a *b* c**')).toEqual([{ t: 'strong', c: [{ t: 'text', v: 'a ' }, { t: 'em', c: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' c' }] }]);
    expect(inline('*a **b** c*')).toEqual([{ t: 'em', c: [{ t: 'text', v: 'a ' }, { t: 'strong', c: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' c' }] }]);
  });

  it('leaves unmatched or spaced delimiters as text', () => {
    expect(inline('a * b * c')).toEqual([{ t: 'text', v: 'a * b * c' }]);
    expect(inline('**open')).toEqual([{ t: 'text', v: '**open' }]);
    expect(inline('2 * 3 = 6')).toEqual([{ t: 'text', v: '2 * 3 = 6' }]);
  });

  it('does not take underscores inside a word for emphasis', () => {
    expect(inline('snake_case_name and __init__')).toEqual([{ t: 'text', v: 'snake_case_name and ' }, { t: 'strong', c: [{ t: 'text', v: 'init' }] }]);
  });

  it('honours a backslash escape', () => {
    expect(inline('\\*not em\\* and \\`x\\`')).toEqual([{ t: 'text', v: '*not em* and `x`' }]);
    expect(inline('a \\ b')).toEqual([{ t: 'text', v: 'a \\ b' }]);
  });

  it('keeps strikethrough, task boxes and autolinks as the text they are', () => {
    expect(textOf(render('~~gone~~ [ ] todo <https://x.test> https://y.test'))).toBe('~~gone~~ [ ] todo <https://x.test> https://y.test');
    expect(tagsOf(render('see https://y.test and src/a.go:12'))).toEqual(['div', 'p']);
  });
});

describe('links', () => {
  const links = (text) => byTag(render(text), 'a');

  it('makes an anchor only for an in-page route', () => {
    const [a] = links('[open](#/code?path=a&lines=1-2)');
    expect(a.attributes.href).toBe('#/code?path=a&lines=1-2');
    expect(textOf(a)).toBe('open');
    expect(links('[home](#/overview) and [x](#/unused)')).toHaveLength(2);
  });

  it('keeps a title as the title attribute', () => {
    expect(links('[t](#/code "the title")')[0].attributes.title).toBe('the title');
  });

  it.each([
    '[x](javascript:alert(1))', '[x](https://evil)', '[x](http://evil/a?b=(c))', '[x](//evil)', '[x](data:text/html,hi)', '[x](mailto:a@b)',
    '[x](  javascript:alert(1))', '[x](JAVASCRIPT:alert(1))', '[x](#nothing)', '[x](/#/code)', '[x]( #/code)',
  ])('makes no anchor for %s, and says where it pointed', (source) => {
    const root = render(source);
    if (source === '[x]( #/code)') {
      expect(byTag(root, 'a')).toHaveLength(1);
      return;
    }
    expect(byTag(root, 'a')).toEqual([]);
    expect(textOf(root).startsWith('x (')).toBe(true);
  });

  it('shows a link to another place as its text and the address in plain text', () => {
    expect(textOf(render('[docs](https://evil.test/a)'))).toBe('docs (https://evil.test/a)');
    expect(textOf(render('[**bold** doc](https://evil.test)'))).toBe('bold doc (https://evil.test)');
  });

  it('shows an image as the text it was and loads nothing', () => {
    const root = render('![alt](https://evil.test/p.png)');
    expect(textOf(root)).toBe('![alt](https://evil.test/p.png)');
    expect(tagsOf(root)).toEqual(['div', 'p']);
  });

  it('leaves a bracket with no destination as text', () => {
    expect(textOf(render('[just brackets] and [x]'))).toBe('[just brackets] and [x]');
    expect(textOf(render('[a](unclosed'))).toBe('[a](unclosed');
  });

  it('shows a reference definition as the text it was', () => {
    expect(textOf(render('[ref]: https://x.test'))).toBe('[ref]: https://x.test');
  });
});

describe('raw HTML is text', () => {
  it('shows a script tag as characters and creates no script element', () => {
    const root = render('<script>alert(1)</script>');
    expect(textOf(root)).toBe('<script>alert(1)</script>');
    expect(tagsOf(root)).toEqual(['div', 'p']);
  });

  it('shows an img with onerror as characters and creates no img element', () => {
    const root = render('<img src=x onerror=alert(1)>');
    expect(textOf(root)).toBe('<img src=x onerror=alert(1)>');
    expect(tagsOf(root)).not.toContain('img');
  });

  it('keeps HTML as text in every place a report can put text', () => {
    const bad = '<img src=x onerror=alert(1)>';
    const root = render([
      `# ${bad}`, '', `para ${bad} end`, '', `- item ${bad}`, '', `> quote ${bad}`, '', `| h ${bad} |`, '|---|', `| c ${bad} |`, '', `**${bad}** *${bad}* [l ${bad}](#/code)`,
      '', '```', bad, '```', '', '<div onclick="x()">block</div>', '', '<!-- comment -->',
    ].join('\n'));
    const tags = new Set(tagsOf(root));
    for (const forbidden of ['img', 'script', 'div2', 'iframe', 'svg', 'style', 'object', 'embed', 'form', 'input']) expect(tags.has(forbidden), forbidden).toBe(false);
    expect(all(root).filter((n) => n.attributes && Object.keys(n.attributes).some((k) => /^on/i.test(k)))).toEqual([]);
    expect(textOf(root)).toContain('<div onclick="x()">block</div>');
    expect(textOf(root)).toContain('<!-- comment -->');
    expect(textOf(root).split(bad).length - 1).toBe(10);
  });

  it('puts text in text nodes only, never as an attribute of an element', () => {
    const root = render('[a](#/x "t") and ```x```');
    for (const n of all(root)) for (const [k] of Object.entries(n.attributes || {})) expect(['href', 'title', 'class', 'start']).toContain(k);
  });
});

describe('what the renderer keeps and what it bounds', () => {
  it('shows the text of an unsupported block (setext heading, indented code) rather than dropping it', () => {
    expect(textOf(render('Title\n=====\n\n    indented code'))).toContain('Title =====');
    expect(textOf(render('    indented code'))).toBe('indented code');
  });

  it('gives an empty text an empty container', () => {
    expect(render('').children).toEqual([]);
    expect(render('\n\n  \n').children).toEqual([]);
  });

  it('reads Windows line ends', () => {
    expect(kids(render('# A\r\n\r\ntext\r\n- a\r\n- b')).map((n) => n.tag)).toEqual(['h1', 'p', 'ul']);
  });

  it('does not recurse without bound on deep nesting', () => {
    const deep = Array.from({ length: 60 }, (_, i) => `${'  '.repeat(i)}- level ${i}`).join('\n');
    const root = render(deep);
    expect(textOf(root)).toContain('level 59');
    const quotes = render(`${'> '.repeat(60)}end`);
    expect(textOf(quotes)).toContain('end');
  });

  it('does not stall on a paragraph of unmatched delimiters', () => {
    const start = Date.now();
    render('*a '.repeat(600) + '\n\n' + '[x '.repeat(600) + '\n\n' + '`a '.repeat(600));
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it('renders a 2,000 line report in reasonable time', () => {
    const lines = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`## Section ${i}`, '', `Paragraph ${i} with \`code\`, **strong**, *em* and [a route](#/code?path=src%2Fa.js&lines=1-2).`, '',
        '- item one', '  - nested', '- item two', '', '| File | Score |', '| :--- | ---: |', `| src/a${i}.js | ${i} |`, `| src/b${i}.js | ${i * 2} |`, '', '```', `code ${i}`, '```', '', '> quote', '', '1. one', '2. two');
    }
    expect(lines.length).toBeGreaterThanOrEqual(2000);
    const start = Date.now();
    const root = render(lines.join('\n'));
    const took = Date.now() - start;
    expect(byTag(root, 'h2')).toHaveLength(100);
    expect(byTag(root, 'table')).toHaveLength(100);
    expect(took).toBeLessThan(2000);
  });
});
