import { describe, expect, it } from 'vitest';

import { CSP_MARKER, DATA_MARKER } from '../../explorer/scripts/single-file.mjs';
import { NOTICE_HEADING } from '../../explorer/scripts/licenses.mjs';
import { PAGE_FONTS, PAGE_TEMPLATE, checkPageTemplate } from '../scripts/template.mjs';

const PACKAGES = ['react', 'react-dom', 'react-markdown', 'remark-gfm', 'rehype-raw', 'rehype-sanitize', 'mermaid', ...PAGE_FONTS.map((font) => font.pkg)];

/** A template that keeps the contract; each test breaks one thing in it. */
function goodTemplate({ packages = PACKAGES, js = 'console.log(1);' } = {}) {
  return [
    `<!--\n${NOTICE_HEADING}\n${packages.map((name) => `${name} 1.0.0 MIT`).join('\n')}\n-->\n`,
    '<!doctype html><html><head>',
    CSP_MARKER,
    '<title>t</title>',
    `<script type="module">${js}</script>`,
    '<style>body{margin:0}</style>',
    '</head><body><div id="root"></div>',
    DATA_MARKER,
    '</body></html>',
  ].join('\n');
}

describe('checkPageTemplate: the build output contract (design D2)', () => {
  it('accepts one prd-report-page.html with the notice, one of each marker and only inline code', () => {
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate())).toEqual([]);
  });

  it('names its own file, not the explorer\'s', () => {
    expect(checkPageTemplate([PAGE_TEMPLATE, 'assets/index.js'], goodTemplate())).toEqual([
      'the output holds more than prd-report-page.html: assets/index.js',
    ]);
    expect(checkPageTemplate([], null)).toEqual(['the output has no prd-report-page.html']);
  });

  it('fails a marker that is missing or repeated', () => {
    const html = goodTemplate();
    expect(checkPageTemplate([PAGE_TEMPLATE], html.replace(DATA_MARKER, ''))[0]).toContain(`0 ${DATA_MARKER}`);
    expect(checkPageTemplate([PAGE_TEMPLATE], html.replace('</body>', `${CSP_MARKER}</body>`))[0]).toContain(`2 ${CSP_MARKER}`);
  });

  it('fails a template without the licence notice, or one that does not list a package it bundles', () => {
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate().replace(/^<!--[\s\S]*?-->\n/, ''))).toEqual([
      'prd-report-page.html does not start with the licence notice comment',
    ]);
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate({ packages: PACKAGES.filter((name) => name !== 'mermaid') }))).toEqual([
      'the licence notice does not list mermaid',
    ]);
  });

  it('fails a non-ASCII character anywhere in the file', () => {
    const problems = checkPageTemplate([PAGE_TEMPLATE], goodTemplate({ js: `var a = /${String.fromCharCode(0xfb02)}/;` }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^prd-report-page\.html holds a non-ASCII character at offset \d+$/);
  });

  it('fails a script with src and a link tag, as the explorer\'s contract does', () => {
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate().replace('<script type="module">', '<script type="module" src="a.js">'))).toEqual([
      'prd-report-page.html has a <script> with src=',
    ]);
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate().replace('<title>', '<link rel="stylesheet" href="a.css"><title>'))).toEqual([
      'prd-report-page.html has a <link> tag',
    ]);
  });
});
