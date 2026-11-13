import { describe, expect, it } from 'vitest';

import { CSP_MARKER, DATA_MARKER } from '../../explorer/scripts/single-file.mjs';
import { NOTICE_HEADING } from '../../explorer/scripts/licenses.mjs';
import { PAGE_FONTS, PAGE_TEMPLATE, checkPageTemplate, pageFontsStylesheet } from '../scripts/template.mjs';

const PACKAGES = ['react', 'react-dom', '@radix-ui/react-select', ...PAGE_FONTS.map((font) => font.pkg)];

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

describe('checkPageTemplate: the build output contract (design D13)', () => {
  it('accepts one product-handbook-page.html with the notice, one of each marker and only inline code', () => {
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate())).toEqual([]);
  });

  it('names its own file, not the explorer\'s', () => {
    expect(checkPageTemplate([PAGE_TEMPLATE, 'assets/index.js'], goodTemplate())).toEqual([
      'the output holds more than product-handbook-page.html: assets/index.js',
    ]);
    expect(checkPageTemplate([], null)).toEqual(['the output has no product-handbook-page.html']);
  });

  it('fails a marker that is missing or repeated', () => {
    const html = goodTemplate();
    expect(checkPageTemplate([PAGE_TEMPLATE], html.replace(DATA_MARKER, ''))[0]).toContain(`0 ${DATA_MARKER}`);
    expect(checkPageTemplate([PAGE_TEMPLATE], html.replace('</body>', `${CSP_MARKER}</body>`))[0]).toContain(`2 ${CSP_MARKER}`);
  });

  it('fails a template without the licence notice, or one that does not list a package it bundles', () => {
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate().replace(/<!--\n[\s\S]*?-->\n/, ''))).toEqual([
      'product-handbook-page.html does not carry the licence notice comment right after its charset meta',
    ]);
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate({ packages: PACKAGES.filter((name) => name !== 'react-dom') }))).toEqual([
      'the licence notice does not list react-dom',
    ]);
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate({ packages: PACKAGES.filter((name) => name !== '@radix-ui/react-select') }))).toEqual([
      'the licence notice does not list @radix-ui/react-select',
    ]);
  });

  it('fails a non-ASCII character anywhere in the file', () => {
    const problems = checkPageTemplate([PAGE_TEMPLATE], goodTemplate({ js: `var a = /${String.fromCharCode(0xfb02)}/;` }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^product-handbook-page\.html holds a non-ASCII character at offset \d+$/);
  });

  it('fails a script with src and a link tag, as the explorer\'s contract does', () => {
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate().replace('<script type="module">', '<script type="module" src="a.js">'))).toEqual([
      'product-handbook-page.html has a <script> with src=',
    ]);
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate().replace('<title>', '<link rel="stylesheet" href="a.css"><title>'))).toEqual([
      'product-handbook-page.html has a <link> tag',
    ]);
  });

  it('needs the charset meta within the first 1024 bytes, the offset the check reports', () => {
    expect(goodTemplate().indexOf('<meta charset')).toBeLessThan(1024);
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate({ charset: '<meta charset=utf-8>' }))).toEqual([]);
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate({ charset: '' }))[0]).toBe('product-handbook-page.html has no <meta charset="utf-8"> within its first 1024 bytes');
    // The old layout: the notice first, so the meta sits far past the prescan.
    const long = goodTemplate({ packages: Array.from({ length: 200 }, (_, at) => `pkg-${at}`).concat(PACKAGES) });
    const notice = /<!--\n[\s\S]*?-->\n/.exec(long)[0];
    const late = notice + long.replace(notice, '');
    const problems = checkPageTemplate([PAGE_TEMPLATE], late);
    const offset = Buffer.byteLength(late.slice(0, late.indexOf('<meta charset')));
    expect(offset).toBeGreaterThan(1024);
    expect(problems).toContain(`product-handbook-page.html has its <meta charset> at byte ${offset}, past the first 1024 bytes`);
  });

  it('fails a charset other than utf-8', () => {
    expect(checkPageTemplate([PAGE_TEMPLATE], goodTemplate({ charset: '<meta charset="latin1" />' }))[0]).toMatch(/no <meta charset="utf-8"> within its first 1024 bytes/);
  });
});

describe('the fonts of the page (design D6)', () => {
  it('are IBM Plex Sans 400, 500, 600, 700 and IBM Plex Mono 400, 500, Latin, and nothing else', () => {
    expect(PAGE_FONTS.map((font) => [font.pkg, font.weights])).toEqual([
      ['@fontsource/ibm-plex-sans', [400, 500, 600, 700]],
      ['@fontsource/ibm-plex-mono', [400, 500]],
    ]);
  });

  it('are one @font-face rule per weight, each source a data URL of the woff2 file and no network address', () => {
    const asked = [];
    const css = pageFontsStylesheet((pkg, file) => { asked.push(`${pkg} ${file}`); return Buffer.from(`bytes of ${file}`); });
    expect(asked).toEqual([
      '@fontsource/ibm-plex-sans ibm-plex-sans-latin-400-normal.woff2',
      '@fontsource/ibm-plex-sans ibm-plex-sans-latin-500-normal.woff2',
      '@fontsource/ibm-plex-sans ibm-plex-sans-latin-600-normal.woff2',
      '@fontsource/ibm-plex-sans ibm-plex-sans-latin-700-normal.woff2',
      '@fontsource/ibm-plex-mono ibm-plex-mono-latin-400-normal.woff2',
      '@fontsource/ibm-plex-mono ibm-plex-mono-latin-500-normal.woff2',
    ]);
    expect(css.match(/@font-face/g)).toHaveLength(6);
    expect(css.match(/url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\("woff2"\)/g)).toHaveLength(6);
    expect(css).toContain(Buffer.from('bytes of ibm-plex-mono-latin-500-normal.woff2').toString('base64'));
    expect(css).not.toMatch(/https?:/);
    expect(css).toContain("font-family: 'IBM Plex Mono';");
    expect(css).toContain('font-weight: 700;');
  });

  it('are read from the installed packages: every file exists and is a woff2 file', () => {
    const css = pageFontsStylesheet();
    const faces = css.match(/base64,([A-Za-z0-9+/=]+)\)/g) ?? [];
    expect(faces).toHaveLength(6);
    for (const face of faces) expect(Buffer.from(face.slice(7, -1), 'base64').subarray(0, 4).toString('latin1')).toBe('wOF2');
  });
});
