import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { describe, expect, it } from 'vitest';

import { rehypePlugins, remarkPlugins, sanitizeSchema } from '../src/lib/markdown-config';

/** The HTML the page's Markdown pipeline gives for `source`. */
const render = (source: string): string => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins, rehypePlugins, children: source }));

describe('the sanitize schema of the page Markdown (design D4)', () => {
  it('removes script elements together with their text', () => {
    const html = render('before\n\n<script>window.__x = 1</script>\n\nafter');
    expect(html).not.toMatch(/script/i);
    expect(html).not.toContain('__x');
    expect(html).toContain('before');
    expect(html).toContain('after');
  });

  it('removes iframe, style and object elements', () => {
    const html = render('<iframe src="https://example.com"></iframe>\n\n<style>body { display: none }</style>\n\n<object data="x"></object>\n\ntext');
    expect(html).not.toMatch(/<(iframe|style|object)/i);
    expect(html).toContain('text');
  });

  it('removes event-handler and style attributes but keeps the element', () => {
    const html = render('<p onclick="x()" style="color: red">hello</p>\n\n<img src="a.png" alt="pic" onerror="x()">');
    expect(html).toContain('<p>hello</p>');
    expect(html).not.toMatch(/onclick|onerror|style=/i);
    expect(html).toContain('<img');
  });

  it('removes javascript: URLs', () => {
    const html = render('[x](javascript:alert(1)) <a href="javascript:alert(2)">y</a>');
    expect(html).not.toMatch(/javascript:/i);
  });

  it('keeps details and summary, and the open attribute of details', () => {
    const html = render('<details open><summary>Evidence</summary>\n\n- `src/a.js:1`\n\n</details>');
    expect(html).toContain('<details open="">');
    expect(html).toContain('<summary>Evidence</summary>');
    expect(html).toContain('<li><code>src/a.js:1</code></li>');
  });

  it('keeps a details block without open closed', () => {
    expect(render('<details><summary>s</summary>body</details>')).toContain('<details>');
  });

  it('renders GFM tables and fenced code with its language class', () => {
    const html = render('| a | b |\n|---|---|\n| 1 | 2 |\n\n```mermaid\nflowchart LR\n  A --> B\n```');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('class="language-mermaid"');
  });

  it('adds details and its open attribute to the default schema and nothing else dangerous', () => {
    expect(sanitizeSchema.tagNames).toEqual(expect.arrayContaining(['details', 'summary']));
    expect(sanitizeSchema.attributes?.details).toContain('open');
    for (const tag of ['script', 'iframe', 'style', 'object', 'embed', 'form', 'input']) {
      if (tag === 'input') continue; // GFM task-list checkboxes are inputs in the default schema
      expect(sanitizeSchema.tagNames, tag).not.toContain(tag);
    }
    expect(JSON.stringify(sanitizeSchema.attributes)).not.toMatch(/"on[a-z]+"|"style"/i);
  });
});
