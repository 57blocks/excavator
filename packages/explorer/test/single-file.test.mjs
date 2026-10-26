import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CSP_MARKER,
  DATA_MARKER,
  TEMPLATE_FILE,
  checkTemplate,
  collapseBundle,
  escapeInlineScript,
  inlineScriptProblem,
} from '../scripts/single-file.mjs';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKSLASH = String.fromCharCode(92);

/** A template that keeps the contract; each test breaks one thing in it. */
const goodTemplate = (js = 'console.log(1);', css = 'body{margin:0}') => [
  '<!doctype html><html><head>',
  CSP_MARKER,
  '<title>t</title>',
  `<script type="module">${js}</script>`,
  `<style>${css}</style>`,
  '</head><body><div id="xv-app"></div>',
  DATA_MARKER,
  '</body></html>',
].join('\n');

describe('checkTemplate: the build output contract (design D2)', () => {
  it('accepts one explorer.html with one of each marker and only inline code', () => {
    expect(checkTemplate([TEMPLATE_FILE], goodTemplate())).toEqual([]);
  });

  it('fails when the output holds a second file', () => {
    expect(checkTemplate([TEMPLATE_FILE, 'assets/index.js'], goodTemplate())).toEqual([
      'the output holds more than explorer.html: assets/index.js',
    ]);
  });

  it('fails when explorer.html is missing', () => {
    expect(checkTemplate([], null)).toEqual(['the output has no explorer.html']);
  });

  it('fails when a <link> is left in the markup', () => {
    const html = goodTemplate().replace('<title>', '<link rel="icon" href="favicon.svg"><title>');
    expect(checkTemplate([TEMPLATE_FILE], html)).toEqual(['explorer.html has a <link> tag']);
  });

  it('fails when a script loads from src=', () => {
    const html = goodTemplate().replace('</head>', '<script type="module" src="./assets/x.js"></script></head>');
    expect(checkTemplate([TEMPLATE_FILE], html)).toEqual(['explorer.html has a <script> with src=']);
  });

  for (const marker of [CSP_MARKER, DATA_MARKER]) {
    it(`fails when ${marker} is missing`, () => {
      expect(checkTemplate([TEMPLATE_FILE], goodTemplate().replace(marker, ''))).toEqual([`explorer.html has 0 ${marker}; it needs exactly one`]);
    });

    it(`fails when ${marker} occurs twice`, () => {
      const html = goodTemplate().replace('</body>', `${marker}\n</body>`);
      expect(checkTemplate([TEMPLATE_FILE], html)).toContain(`explorer.html has 2 ${marker}; it needs exactly one`);
    });
  }

  it('fails when the CSP marker comes after the first script', () => {
    const html = goodTemplate().replace(`${CSP_MARKER}\n`, '').replace('</head>', `${CSP_MARKER}</head>`);
    expect(checkTemplate([TEMPLATE_FILE], html)).toEqual([
      `${CSP_MARKER} comes after the first script or style, so the policy would not cover it`,
    ]);
  });

  it('fails when the inline JavaScript contains </script (it would end its element early)', () => {
    const html = goodTemplate('const tag = "</script>"; run(tag);');
    expect(checkTemplate([TEMPLATE_FILE], html)).toEqual([
      'explorer.html has a </script that closes no script: an inline script ends its element early',
    ]);
  });

  it('sees </script in any letter case', () => {
    const html = goodTemplate('const tag = "</SCRIPT>";');
    expect(checkTemplate([TEMPLATE_FILE], html)).toHaveLength(1);
  });

  it('fails when the inline JavaScript contains <!--', () => {
    expect(checkTemplate([TEMPLATE_FILE], goodTemplate('const c = "<!--";'))).toEqual([
      'explorer.html has an inline script that contains <!--',
    ]);
  });

  it('fails when the inline CSS contains </style', () => {
    expect(checkTemplate([TEMPLATE_FILE], goodTemplate(undefined, 'a::after{content:"</style>"}'))).toEqual([
      'explorer.html has a </style that closes no style: an inline style ends its element early',
    ]);
  });

  it('fails on an external font or stylesheet import', () => {
    expect(checkTemplate([TEMPLATE_FILE], goodTemplate(undefined, '@import url(x.css);'))).toEqual(['explorer.html has @import url(']);
    expect(checkTemplate([TEMPLATE_FILE], goodTemplate(undefined, '@font-face{src:url(https://fonts.example/x.woff2)}'))).toEqual([
      'explorer.html refers to //fonts.',
    ]);
  });

  it('does not mistake text inside a script body for markup', () => {
    // A <link> or <script src> written inside a JavaScript string is not a tag.
    const html = goodTemplate('const s = "<link rel=x> <script src=y>";');
    expect(checkTemplate([TEMPLATE_FILE], html)).toEqual([]);
  });
});

describe('escapeInlineScript', () => {
  it('writes < as \\x3c before /script and !--, in any case, and nowhere else', () => {
    const code = 'a("</script>", "</Script", "<!--", "<div>", 1 < 2)';
    const escaped = escapeInlineScript(code);
    expect(escaped).toBe(`a("${BACKSLASH}x3c/script>", "${BACKSLASH}x3c/Script", "${BACKSLASH}x3c!--", "<div>", 1 < 2)`);
    expect(inlineScriptProblem(code)).not.toBeNull();
    expect(inlineScriptProblem(escaped)).toBeNull();
  });

  it('keeps the value of string literals', () => {
    const code = 'globalThis.out = ["</script>", "<!--x"];';
    const run = (source) => new Function(`const globalThis = {}; ${source}; return globalThis.out;`)();
    expect(run(escapeInlineScript(code))).toEqual(run(code));
  });
});

describe('collapseBundle: the single-file plugin', () => {
  const html = (body = '') => [
    '<!doctype html><html><head>',
    CSP_MARKER,
    '<script type="module" crossorigin src="./assets/index-abc.js"></script>',
    '<link rel="stylesheet" crossorigin href="./assets/index-def.css">',
    `</head><body>${body}`,
    DATA_MARKER,
    '</body></html>',
  ].join('\n');
  const bundle = (extra = {}) => ({
    'explorer.html': { type: 'asset', fileName: 'explorer.html', source: html() },
    'assets/index-abc.js': { type: 'chunk', fileName: 'assets/index-abc.js', code: 'render("</script>");' },
    'assets/index-def.css': { type: 'asset', fileName: 'assets/index-def.css', source: 'body{margin:0}' },
    ...extra,
  });

  it('inlines the chunk and the stylesheet, escapes </script, and leaves only explorer.html', () => {
    const b = bundle();
    collapseBundle(b);
    expect(Object.keys(b)).toEqual(['explorer.html']);
    const out = b['explorer.html'].source;
    expect(out).toContain(`<script type="module">render("${BACKSLASH}x3c/script>");</script>`);
    expect(out).toContain('<style>body{margin:0}</style>');
    expect(checkTemplate(['explorer.html'], out)).toEqual([]);
  });

  it('keeps $ sequences in the code as they are', () => {
    const b = bundle({ 'assets/index-abc.js': { type: 'chunk', fileName: 'assets/index-abc.js', code: 'x.replace(a, "$&$1$$")' } });
    collapseBundle(b);
    expect(b['explorer.html'].source).toContain('x.replace(a, "$&$1$$")');
  });

  it('fails on a second JavaScript chunk', () => {
    const b = bundle({ 'assets/lazy.js': { type: 'chunk', fileName: 'assets/lazy.js', code: '1' } });
    expect(() => collapseBundle(b)).toThrow(/exactly one JavaScript chunk; it produced 2/);
  });

  it('fails on an output it does not inline', () => {
    const b = bundle({ 'assets/logo.png': { type: 'asset', fileName: 'assets/logo.png', source: new Uint8Array([1]) } });
    expect(() => collapseBundle(b)).toThrow('the build produced output(s) the template does not inline: assets/logo.png');
  });

  it('fails on a <link> that is not one of its stylesheets', () => {
    const b = bundle();
    b['explorer.html'].source = html().replace('<head>', '<head><link rel="icon" href="./favicon.svg">');
    expect(() => collapseBundle(b)).toThrow(/cannot inline <link rel="icon"/);
  });

  it('fails when a marker is missing', () => {
    const b = bundle();
    b['explorer.html'].source = html().replace(DATA_MARKER, '');
    expect(() => collapseBundle(b)).toThrow(`explorer.html has 0 ${DATA_MARKER}; it needs exactly one`);
  });

  it('fails when the HTML is not explorer.html', () => {
    const b = bundle();
    b['index.html'] = b['explorer.html'];
    delete b['explorer.html'];
    expect(() => collapseBundle(b)).toThrow(/exactly one HTML file, explorer.html; it produced index.html/);
  });
});

describe('a template of another name (the report page shares these plugins)', () => {
  const page = 'page.html';
  const markup = [`<!doctype html><html><head>${CSP_MARKER}`, '<script type="module" src="./a.js"></script>', `</head><body>${DATA_MARKER}</body></html>`].join('\n');
  const bundle = () => ({
    [page]: { type: 'asset', fileName: page, source: markup },
    'a.js': { type: 'chunk', fileName: 'a.js', code: 'go();' },
  });

  it('collapses into the named file and names it in its messages', () => {
    const b = bundle();
    collapseBundle(b, '<!-- n -->\n', page);
    expect(Object.keys(b)).toEqual([page]);
    expect(b[page].source.startsWith('<!-- n -->\n')).toBe(true);
    expect(checkTemplate([page], b[page].source, page)).toEqual([]);
    expect(checkTemplate([page, 'x.js'], b[page].source, page)).toEqual(['the output holds more than page.html: x.js']);
    expect(checkTemplate([], null, page)).toEqual(['the output has no page.html']);
  });

  it('refuses the explorer\'s name when asked for another', () => {
    const b = bundle();
    b['explorer.html'] = b[page];
    delete b[page];
    expect(() => collapseBundle(b, '', page)).toThrow(/exactly one HTML file, page.html; it produced explorer.html/);
  });
});

describe('the built template', () => {
  // `pnpm -r build` runs before `pnpm test` in the gate; a missing build is a failure, not a skip.
  it('is one explorer.html that keeps the contract', () => {
    const dist = join(packageDir, 'dist');
    expect(existsSync(join(dist, TEMPLATE_FILE)), 'packages/explorer is not built; run pnpm build first').toBe(true);
    const names = readdirSync(dist, { recursive: true, encoding: 'utf-8' });
    expect(checkTemplate(names, readFileSync(join(dist, TEMPLATE_FILE), 'utf-8'))).toEqual([]);
  });
});
