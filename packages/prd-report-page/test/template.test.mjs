import { describe, expect, it } from 'vitest';

import { CSP_MARKER, DATA_MARKER } from '../../explorer/scripts/single-file.mjs';
import { NOTICE_HEADING } from '../../explorer/scripts/licenses.mjs';
import { PAGE_FONTS, PAGE_TEMPLATE, checkPageTemplate } from '../scripts/template.mjs';

const PACKAGES = ['react', 'react-dom', 'react-markdown', 'remark-gfm', 'rehype-raw', 'rehype-sanitize', 'mermaid', ...PAGE_FONTS.map((font) => font.pkg)];

/** A template that keeps the contract; each test breaks one thing in it. The charset meta comes first, the notice right after it. */
function goodTemplate({ packages = PACKAGES, js = 'console.log(1);', charset = '<meta charset="UTF-8" />' } = {}) {
  return [
    '<!doctype html><html lang="en"><head>',
    `${charset}<!--\n${NOTICE_HEADING}\n${packages.map((name) => `${name} 1.0.0 MIT`).join('\n')}\n-->\n`,
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
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate().replace(/<!--\n[\s\S]*?-->\n/, ''))).toEqual([
      'prd-report-page.html does not carry the licence notice comment right after its charset meta',
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

  it('needs the charset meta within the first 1024 bytes, the offset the check reports', () => {
    expect(goodTemplate().indexOf('<meta charset')).toBeLessThan(1024);
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate({ charset: '<meta charset=utf-8>' }))).toEqual([]);
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate({ charset: '' }))[0]).toBe('prd-report-page.html has no <meta charset="utf-8"> within its first 1024 bytes');
    // The old layout: the notice first, so the meta sits far past the prescan.
    const long = goodTemplate({ packages: Array.from({ length: 200 }, (_, at) => `pkg-${at}`).concat(PACKAGES) });
    const notice = /<!--\n[\s\S]*?-->\n/.exec(long)[0];
    const late = notice + long.replace(notice, '');
    const problems = checkPageTemplate([PAGE_TEMPLATE], late);
    const offset = Buffer.byteLength(late.slice(0, late.indexOf('<meta charset')));
    expect(offset).toBeGreaterThan(1024);
    expect(problems).toContain(`prd-report-page.html has its <meta charset> at byte ${offset}, past the first 1024 bytes`);
  });

  it('fails a charset other than utf-8', () => {
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate({ charset: '<meta charset="latin1" />' }))[0]).toMatch(/no <meta charset="utf-8"> within its first 1024 bytes/);
  });
});
