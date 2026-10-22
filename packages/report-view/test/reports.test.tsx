import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Markdown } from '../src/components/Markdown';

const render = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe('the Markdown of a report', () => {
  it('renders headings, paragraphs, lists, tables, code and emphasis', () => {
    const out = render('# Title\n\nSome *emphasis* and `code`.\n\n- a\n- b\n\n1. one\n\n| h1 | h2 |\n|---|:-:|\n| c1 | c2 |\n\n```js\nlet x = 1;\n```\n');
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<em>emphasis</em>');
    expect(out).toContain('<code>code</code>');
    expect(out).toContain('<ul>');
    expect(out).toContain('<ol>');
    expect(out).toMatch(/<table><thead><tr><th>h1<\/th><th[^>]*>h2<\/th><\/tr><\/thead>/);
    expect(out).toContain('<pre><code class="language-js">let x = 1;');
  });

  it('shows a script element and an image with an event handler as text', () => {
    const out = render('before\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\ninline <b onclick="x()">bold</b> text\n');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<b ');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('&lt;img src=x onerror=alert(2)&gt;');
    expect(out).toContain('&lt;b onclick=&quot;x()&quot;&gt;bold&lt;/b&gt;');
  });

  it('links only to routes of the page: any other link is its text and its address as text', () => {
    const out = render('[a route](#/code?path=src%2Fa.js&lines=3) [out](https://example.test/x) [js](javascript:alert(1)) [rel](docs/a.md)');
    expect(out).toContain('<a href="#/code?path=src%2Fa.js&amp;lines=3">a route</a>');
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).toContain('out (https://example.test/x)');
    expect(out).toContain('js (javascript:alert(1))');
    expect(out).toContain('rel (docs/a.md)');
  });

  it('shows an image as text and loads nothing', () => {
    const out = render('![alt text](https://example.test/x.png)');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<link');
    expect(out).toContain('![alt text](https://example.test/x.png)');
  });

  it('writes no raw URL or file reference as a link', () => {
    const out = render('see https://example.test/a and src/main.js:42');
    expect(out).not.toContain('href="https://example.test');
    expect(out).toContain('src/main.js:42');
  });

  it('keeps non-ASCII text intact', () => {
    const text = String.fromCharCode(0x4e2d, 0x6587, 0x20, 0xe9, 0x20, 0xd83d, 0xde00);
    expect(render(`# ${text}`)).toContain(`<h1>${text}</h1>`);
  });
});
