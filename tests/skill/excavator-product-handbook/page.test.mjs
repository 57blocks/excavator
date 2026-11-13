// Oracle O4 (script half) of openspec change handbook-skill-first: `page` writes handbook.html with
// the data format /21 built from the same checked Markdown run `assemble` uses: the chapters as
// Markdown by view, the outline's parts, the coverage section and the scripts' blocks. A product-only
// page holds no citation and no project path, the same input gives the same bytes, the page refuses
// the runs assemble refuses and leaves no file, and a new template rewrites the page from the files
// alone. These tests use a stub template with the two markers; the real template is exercised by
// page-browser.test.mjs.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { languageTag } from '../../../skills/excavator-product-handbook/lib/language-tag.mjs';
import { productText } from '../../../skills/excavator-product-handbook/lib/md-views.mjs';
import { SHIPPED_UI, runHandbook } from './helpers.mjs';
import { FORM, chapterText, cite } from './md-run-fixture.mjs';
import { STUB, STUB_TWO, dataOf, html, listing, pageRun, runPage } from './page-md-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
const stubTwoPath = join(stubDir, 'template-two.html');
writeFileSync(stubPath, STUB);
writeFileSync(stubTwoPath, STUB_TWO);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const make = (options) => pageRun(cleanups, options);
const page = (run, options = {}) => runPage(run, { template: stubPath, ...options });
const cjk = (...points) => String.fromCodePoint(...points);
const ANY_CITATION = /[\w./-]+\.\w+:\d+(?:-\d+)?/;

describe('page: the file and its data', () => {
  it('writes handbook.html, prints its path, and replaces both markers', () => {
    const run = make();
    const result = page(run);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.lines).toEqual([join(run.out, 'handbook.html')]);
    const text = html(run);
    expect(text).not.toContain('<!-- xv:csp -->');
    expect(text).not.toContain('<!-- xv:data -->');
    expect(text.startsWith('<!doctype html>')).toBe(true);
  });

  it('carries the content security policy: no network, only inline code, data: images and fonts', () => {
    const run = make();
    page(run);
    const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html(run))[1];
    expect(policy).toBe("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'");
  });

  it('has format /21, the keys in a fixed order, the ui table and the title of each view', () => {
    const run = make();
    page(run);
    const data = dataOf(html(run));
    expect(Object.keys(data)).toEqual(['format', 'chunks', 'language', 'languageTag', 'ui', 'views', 'titles', 'outline', 'chapters', 'coverage', 'history', 'domains', 'lead', 'architecture', 'search', 'technical']);
    expect(data.format).toBe('excavator-product-handbook-page/21');
    expect(data.chunks).toEqual({ parts: [], units: {} });
    expect(data.language).toBe('English');
    expect(data.languageTag).toBe('en');
    expect(data.ui.strings).toEqual(JSON.parse(readFileSync(SHIPPED_UI, 'utf-8')).strings);
    expect(data.views).toEqual(['product', 'technical']);
    expect(data.titles).toEqual({ product: data.ui.strings['md.title'], technical: data.ui.strings['md.titleTechnical'] });
  });

  it('has the outline in parts of blocks with their titles, and the chapters in that order', () => {
    const run = make();
    page(run);
    const { outline, chapters } = dataOf(html(run));
    expect(outline.source).toBe('default');
    expect(outline.problems).toEqual([]);
    expect(outline.parts.map((part) => part.title)).toEqual(['System', 'Features', 'Data and code health']);
    const flat = outline.parts.flatMap((part) => part.blocks);
    expect(flat.map((item) => [item.block, item.kind, item.title])).toEqual([
      ['system', 'chapter', 'System'],
      ['F1', 'chapter', 'Orders'],
      ['data', 'data', 'Data'],
      ['dictionaries', 'dictionaries', 'Status dictionary'],
      ['history', 'history', 'Code health'],
    ]);
    expect(chapters.map((chapter) => chapter.id)).toEqual(['system', 'F1']);
  });

  it('the product text drops a table column the citation removal emptied; the technical text keeps it', () => {
    const run = make();
    const rows = `\n| Role | Can do | Cite |\n| --- | --- | --- |\n| Clerk | Creates an order | ${cite('1', 'src/roles.js')} |\n`;
    run.write('F1', chapterText('Orders', rows));
    expect(run.check('F1').status).toBe(0);
    page(run);
    const f1 = dataOf(html(run)).chapters.find((chapter) => chapter.id === 'F1');
    expect(f1.texts.product).toContain('| Role | Can do |\n| --- | --- |\n| Clerk | Creates an order |');
    expect(f1.texts.product).not.toContain('Cite');
    expect(f1.texts.technical).toContain('| Role | Can do | Cite |');
  });

  it('puts in each chapter the Markdown of each view, made by the functions assemble uses', () => {
    const run = make();
    page(run);
    const f1 = dataOf(html(run)).chapters.find((chapter) => chapter.id === 'F1');
    expect(Object.keys(f1.texts)).toEqual(['product', 'technical']);
    const written = run.read('chapters/F1.md');
    // Not heading-shifted: the chapter's own level-1 heading is the page heading.
    expect(f1.texts.product.startsWith('# Orders\n')).toBe(true);
    expect(f1.texts.technical).toContain(written.replace('# Orders\n', '').split('\n')[2]);
    expect(f1.texts.technical).toContain(`(\`${FORM}:5\`)`);
    expect(f1.texts.product).toContain(productText(written).split('\n').find((line) => line.startsWith('- An order is Draft')));
    expect(f1.texts.product).toContain('Not verified: this chapter was written by a model');
    expect(f1.texts.technical).toContain('Not verified: this chapter was written by a model');
    // The fences stay as written in both views.
    expect(f1.texts.product).toContain('```mermaid\nflowchart TD');
    expect(f1.texts.technical).toContain('```mermaid\nstateDiagram-v2');
  });

  it('has the coverage section as Markdown with its title as the level-1 heading, once per view', () => {
    const run = make();
    page(run);
    const { coverage, ui } = dataOf(html(run));
    expect(Object.keys(coverage)).toEqual(['product', 'technical']);
    expect(coverage.product.startsWith(`# ${ui.strings['md.coverage.heading']}\n`)).toBe(true);
    expect(coverage.technical).toBe(coverage.product);
    expect(coverage.product).toContain('\n## ');
  });

  it('has the data, the dictionaries and the code health structured, the data and the paths in the technical part only', () => {
    const run = make();
    page(run);
    const data = dataOf(html(run));
    expect(data.technical.dataState).toBe('ok');
    expect(data.technical.data.tables.length).toBeGreaterThan(0);
    expect(data.technical.dictionariesState).toBe('ok');
    expect(data.technical.dictionaries.dictionaries.length).toBeGreaterThan(0);
    expect(data.history.state).toBe('ok');
    expect(data.history.hotspots.length).toBeGreaterThan(0);
    expect(data.technical.history.hotspots).toHaveLength(data.history.hotspots.length);
    expect(data.technical.history.hotspots[0]).toMatch(/\//);
    expect(data.history.hotspots[0].name).not.toMatch(/\//);
  });
});

describe('page: the views', () => {
  it('a product-only page carries no citation, no project path and no technical part', () => {
    const run = make();
    const result = page(run, { views: 'product' });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const text = html(run);
    const data = dataOf(text);
    expect(data.views).toEqual(['product']);
    expect(Object.keys(data)).not.toContain('technical');
    expect(Object.keys(data.titles)).toEqual(['product']);
    expect(Object.keys(data.coverage)).toEqual(['product']);
    for (const chapter of data.chapters) expect(Object.keys(chapter.texts)).toEqual(['product']);
    const prose = data.chapters.map((chapter) => chapter.texts.product.replace(/```[\s\S]*?```/g, '')).join('\n');
    expect(prose).not.toMatch(ANY_CITATION);
    expect(text).not.toContain('order-form.js');
    expect(text).not.toContain('src/roles.js');
    expect(text).not.toContain(run.root);
    expect(text).not.toContain(run.out);
    // The code health names files, never paths.
    expect(JSON.stringify(data.history)).not.toMatch(/src\//);
  });

  it('a technical-only page has every citation group as written and no product text', () => {
    const run = make();
    expect(page(run, { views: 'technical' }).status).toBe(0);
    const data = dataOf(html(run));
    expect(data.views).toEqual(['technical']);
    const f1 = data.chapters.find((chapter) => chapter.id === 'F1');
    expect(Object.keys(f1.texts)).toEqual(['technical']);
    expect(f1.texts.technical).toContain(`\`${FORM}:5\``);
    expect(f1.texts.technical).toContain('`src/roles.js:3`');
  });

  it('both views: the product text is the technical text without its citations', () => {
    const run = make();
    page(run);
    const f1 = dataOf(html(run)).chapters.find((chapter) => chapter.id === 'F1');
    expect(f1.texts.technical).toMatch(ANY_CITATION);
    expect(f1.texts.product.replace(/```[\s\S]*?```/g, '')).not.toMatch(ANY_CITATION);
  });
});

describe('page: the outline, the chapters that were not written, a chapter that did not pass', () => {
  it('follows a written outline and leaves out the blocks it puts aside, with their chapters', () => {
    const run = make();
    run.writeJson(join(run.out, 'outline.json'), {
      format: 'excavator-product-handbook-outline/2',
      language: 'English',
      parts: [{ title: 'Everything', chapters: ['F1', 'system', 'history'] }],
      unplaced: [{ block: 'data', reason: 'Not for this reader.' }, { block: 'dictionaries', reason: 'Not for this reader.' }],
    });
    expect(page(run).status).toBe(0);
    const data = dataOf(html(run));
    expect(data.outline.source).toBe('outline');
    expect(data.outline.parts.map((part) => [part.title, part.blocks.map((item) => item.block)])).toEqual([['Everything', ['F1', 'system', 'history']]]);
    expect(data.outline.unplaced).toEqual([{ block: 'data', reason: 'Not for this reader.' }, { block: 'dictionaries', reason: 'Not for this reader.' }]);
    expect(data.chapters.map((chapter) => chapter.id)).toEqual(['F1', 'system']);
    expect(data.technical.data).toBeNull();
  });

  it('an outline that breaks conservation is replaced by the default and its problems are kept', () => {
    const run = make();
    run.writeJson(join(run.out, 'outline.json'), { format: 'excavator-product-handbook-outline/2', language: 'English', parts: [{ title: 'Some', chapters: ['F1'] }], unplaced: [] });
    expect(page(run).status).toBe(0);
    const { outline } = dataOf(html(run));
    expect(outline.source).toBe('default');
    expect(outline.problems.length).toBeGreaterThan(0);
    expect(outline.problems.every((line) => line.startsWith('Outline: '))).toBe(true);
  });

  it('a run with no scripts blocks has only its chapters, and a chapter that failed twice carries the fixed sentence', () => {
    const run = make({ withScripts: false });
    const bad = `${chapterText('Orders')}\nThe clerk fills in a field (\`${FORM}:999\`).\n`;
    run.write('F1', bad);
    expect(run.check('F1').status).toBe(1);
    expect(run.check('F1').status).toBe(1);
    run.check('F1');
    expect(page(run).status).toBe(0);
    const data = dataOf(html(run));
    expect(data.history).toBeNull();
    expect(data.technical.data).toBeNull();
    expect(data.technical.dataState).toBe('missing');
    expect(data.technical.history).toBeNull();
    expect(data.outline.parts.flatMap((part) => part.blocks.map((item) => item.block))).toEqual(['system', 'F1']);
    const f1 = data.chapters.find((chapter) => chapter.id === 'F1');
    expect(f1.texts.product).toContain('did not pass');
  });
});

describe('page: deterministic bytes and nothing local', () => {
  it('gives identical bytes on two runs and from separate copies of the same input at other paths', () => {
    const first = make();
    const second = make();
    expect(first.root).not.toBe(second.root);
    page(first);
    const before = readFileSync(join(first.out, 'handbook.html'));
    page(first);
    expect(readFileSync(join(first.out, 'handbook.html')).equals(before)).toBe(true);
    page(second);
    expect(readFileSync(join(second.out, 'handbook.html')).equals(before)).toBe(true);
  });

  it('does not change when only the attempt count in state.json changes', () => {
    const run = make();
    page(run);
    const before = html(run);
    const state = run.readJson('state.json');
    state.chapters.system.attempts = 1;
    run.writeJson(join(run.out, 'state.json'), state);
    page(run);
    expect(html(run)).toBe(before);
  });

  it('holds no project path and no out path', () => {
    const run = make();
    page(run);
    const text = html(run);
    expect(text).not.toContain(run.root);
    expect(text).not.toContain(run.out);
  });

  it('writes a "<" inside the data as an escape, so no text can close the data block', () => {
    const run = make();
    run.write('system', chapterText('System', `\nA reader may see a < b and a <!-- c (${cite('5')}).\n`));
    expect(run.check('system').status, run.check('system').stdout).toBe(0);
    const result = page(run);
    expect(result.status, result.stdout).toBe(0);
    const text = html(run);
    const block = text.slice(text.indexOf('<script type="application/json"'));
    expect(block.slice(block.indexOf('>') + 1, block.indexOf('</script>'))).not.toContain('<');
    expect(dataOf(text).chapters[0].texts.technical).toContain('a < b and a <!-- c (');
  });
});

describe('page: refuses what assemble refuses, and leaves no page', () => {
  const cases = {
    'a chapter that was never checked': (run) => run.write('roles', chapterText('Roles')),
    'a chapter that changed after its check': (run) => run.write('F1', `${run.read('chapters/F1.md')}\nAn extra line.\n`),
    'a chapter file that is not a chapter of the run': (run) => run.write('F9', chapterText('Nine')),
    'a map that no longer holds every candidate': (run) => {
      const map = JSON.parse(JSON.stringify(run.map));
      map.features[0].candidates.pop();
      run.writeMap(map);
    },
    'a candidates.json for another project': (run) => {
      const listed = run.readJson('candidates.json');
      listed.projectRoot = '/nowhere/else';
      run.writeJson(join(run.out, 'candidates.json'), listed);
    },
  };
  for (const [name, spoil] of Object.entries(cases)) {
    it(`${name}: the same exit status and lines as assemble, and the earlier page and parts are removed`, () => {
      const run = make();
      expect(page(run).status).toBe(0);
      expect(existsSync(join(run.out, 'handbook.html'))).toBe(true);
      spoil(run);
      const assembled = run.assemble();
      const result = page(run);
      expect(assembled.status).toBe(1);
      expect(result.status).toBe(1);
      expect(result.lines).toEqual(assembled.lines);
      expect(existsSync(join(run.out, 'handbook.html'))).toBe(false);
      expect(existsSync(join(run.out, 'handbook-data'))).toBe(false);
    });
  }

  it('a state of format /1 or a missing state.json is refused like assemble, with no page left', () => {
    const run = make();
    page(run);
    rmSync(join(run.out, 'state.json'));
    const assembled = run.assemble();
    const result = page(run);
    expect(result.status).toBe(assembled.status);
    expect(result.lines).toEqual(assembled.lines);
    expect(existsSync(join(run.out, 'handbook.html'))).toBe(false);
  });
});

describe('page: the template', () => {
  it('a template that was never built is exit 2 with the build command, and no page is left', () => {
    const run = make();
    page(run);
    const result = page(run, { template: join(stubDir, 'missing.html') });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('pnpm -r build');
    expect(result.stderr).toContain('missing.html');
    expect(existsSync(join(run.out, 'handbook.html'))).toBe(false);
  });

  it('a template with a marker missing or repeated is exit 2', () => {
    const run = make();
    for (const [name, text] of [['nodata.html', STUB.replace('<!-- xv:data -->', '')], ['twice.html', STUB.replace('<!-- xv:csp -->', '<!-- xv:csp --><!-- xv:csp -->')]]) {
      const path = join(stubDir, name);
      writeFileSync(path, text);
      const result = page(run, { template: path });
      expect(result.status, name).toBe(2);
      expect(result.stderr, name).toContain('exactly once');
      expect(existsSync(join(run.out, 'handbook.html'))).toBe(false);
    }
  });

  it('without the variable the template is looked up under the plugin root, packages/product-handbook-page/dist', () => {
    const run = make();
    const env = { ...process.env };
    delete env.EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE;
    const result = runHandbook(['page', run.out, '--project', run.root], { env });
    const built = existsSync(join(run.out, 'handbook.html'));
    if (result.status === 2) expect(result.stderr).toContain('packages/product-handbook-page/dist/product-handbook-page.html');
    else expect(built).toBe(true);
  });

  it('a changed template rewrites the page from the files alone: the same data, and no other file of the out directory changes', () => {
    const run = make();
    expect(page(run, { template: stubPath }).status).toBe(0);
    const first = html(run);
    const others = (rel) => rel === 'handbook.html' || rel.startsWith('handbook-data');
    const before = listing(run.out, others);
    expect(Object.keys(before).length).toBeGreaterThan(5);
    const result = page(run, { template: stubTwoPath });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const second = html(run);
    expect(second).toContain('data-template="two"');
    expect(second).not.toBe(first);
    expect(dataOf(second)).toEqual(dataOf(first));
    expect(listing(run.out, others)).toEqual(before);
  });
});

describe('languageTag: the free-form --language value to a BCP 47 tag', () => {
  it('maps common names, in any case, with accents or extra white space', () => {
    expect(languageTag('English')).toBe('en');
    expect(languageTag('  chinese ')).toBe('zh');
    expect(languageTag('Simplified  Chinese')).toBe('zh-Hans');
    expect(languageTag('Chinese (Traditional)')).toBe('zh-Hant');
    expect(languageTag('Japanese')).toBe('ja');
    expect(languageTag('Korean')).toBe('ko');
    expect(languageTag('Brazilian Portuguese')).toBe('pt-BR');
    expect(languageTag(`Espa${cjk(0xf1)}ol`)).toBe('es');
  });

  it('maps a few native names', () => {
    expect(languageTag(cjk(0x4e2d, 0x6587))).toBe('zh');
    expect(languageTag(cjk(0x7e41, 0x9ad4, 0x4e2d, 0x6587))).toBe('zh-Hant');
    expect(languageTag(cjk(0x65e5, 0x672c, 0x8a9e))).toBe('ja');
  });

  it('keeps a value that already looks like a tag', () => {
    expect(languageTag('zh-CN')).toBe('zh-CN');
    expect(languageTag('pt-BR')).toBe('pt-BR');
    expect(languageTag('fr')).toBe('fr');
    expect(languageTag('sr-Latn-RS')).toBe('sr-Latn-RS');
  });

  it('gives und for anything else and never throws', () => {
    expect(languageTag('Klingon')).toBe('und');
    expect(languageTag('Pirate speak')).toBe('und');
    expect(languageTag('')).toBe('und');
    expect(languageTag(cjk(0x3042, 0x3044))).toBe('und');
    expect(languageTag(undefined)).toBe('und');
    expect(languageTag(null)).toBe('und');
  });
});
