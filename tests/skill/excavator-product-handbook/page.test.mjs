// Oracle O5 (page half) of openspec change product-handbook-map: handbook.html
// is the same bytes from the same input, holds no citation path, no project
// path and no evidence, and is refused for the same runs as handbook.md. These
// tests use a stub template with the two markers; the real template is
// exercised by page-browser.test.mjs.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildPageData } from '../../../skills/excavator-product-handbook/lib/page-data.mjs';
import { languageTag } from '../../../skills/excavator-product-handbook/lib/language-tag.mjs';
import { SHIPPED_UI, clone, makeCheckedMapRun, markedMap, runHandbook, verifyChecked } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const withTemplate = (path) => ({ env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: path } });
const cjk = (...points) => String.fromCodePoint(...points);

function checkedRun(adjust) {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  const entry = clone(run.entry);
  adjust?.(entry);
  run.writeEntry('F1', entry);
  const result = run.run('check-entry', 'F1');
  expect(result.status, result.stdout).toBe(0);
  verifyChecked(run);
  return run;
}

const page = (run, template = stubPath) => runHandbook(['page', run.out, '--project', run.root], withTemplate(template));
const html = (run) => readFileSync(join(run.out, 'handbook.html'), 'utf-8');
/** The page data parsed out of the data block. */
function dataOf(text) {
  const match = /<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(text);
  expect(match).not.toBeNull();
  return JSON.parse(match[1]);
}

function citedFiles(...documents) {
  const files = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') {
      if (typeof value.file === 'string' && typeof value.passage === 'string') files.add(value.file);
      Object.values(value).forEach(walk);
    }
  };
  documents.forEach(walk);
  return [...files];
}

describe('page: the file and its data', () => {
  it('writes handbook.html, prints its path, and replaces both markers', () => {
    const run = checkedRun();
    const result = page(run);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.lines).toEqual([join(run.out, 'handbook.html')]);
    const text = html(run);
    expect(text).not.toContain('<!-- xv:csp -->');
    expect(text).not.toContain('<!-- xv:data -->');
    expect(text.startsWith('<!doctype html>')).toBe(true);
    expect(readdirSync(run.out).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('carries the content security policy: no network, only inline code, data: images and fonts', () => {
    const run = checkedRun();
    page(run);
    const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html(run))[1];
    expect(policy).toBe("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'");
  });

  it('has the data keys in a fixed order, no project name without a verified overview name, and the ui table', () => {
    const run = checkedRun();
    page(run);
    const data = dataOf(html(run));
    expect(Object.keys(data)).toEqual(['format', 'project', 'language', 'languageTag', 'ui', 'views', 'areas', 'domains', 'domainBasis', 'features', 'findings', 'coverage', 'summary', 'system', 'entities']);
    expect(data.format).toBe('excavator-product-handbook-page/11');
    expect(data.project).toBeNull();
    expect(data.language).toBe('English');
    expect(data.languageTag).toBe('en');
    expect(data.ui.strings).toEqual(JSON.parse(readFileSync(SHIPPED_UI, 'utf-8')).strings);
    expect(data.areas).toEqual([{ id: 'A1', name: 'Order handling' }, { id: 'A2', name: 'Automatic work' }]);
    expect(Object.keys(data.features[0])).toEqual(['id', 'name', 'area', 'domain', 'reach', 'label', 'status', 'entry', 'findingsStatus']);
  });

  it('gives a verified feature its entry without evidence and every other feature its status and no entry', () => {
    const run = checkedRun();
    run.run('mark', 'F3', 'dispatched');
    page(run);
    const data = dataOf(html(run));
    const [f1, f2, f3] = data.features;
    expect(f1.status).toBe('verified');
    expect(Object.keys(f1.entry)).toEqual(['purpose', 'who', 'where', 'screens', 'operations', 'states', 'notifications', 'automatic', 'unknowns']);
    expect(f1.entry.purpose).toBe('Staff place new orders for customers.');
    expect(f1.entry.where).toEqual(['Orders', 'New Order']);
    expect(f1.entry.screens[0].fields[1].rules).toEqual([{ side: 'backend', text: 'At most 35,000 items.' }, { side: 'frontend', text: 'An upload may hold up to 100,000 bytes.' }]);
    expect(f1.entry.operations[0].sentences).toEqual(['The clerk fills in the customer name.', 'The item count is limited to 35000.']);
    expect(f2).toMatchObject({ id: 'F2', reach: 'link', label: 'Archive', status: 'planned', entry: null });
    expect(f3).toMatchObject({ id: 'F3', status: 'dispatched', entry: null });
    expect(Object.hasOwn(f3, 'label')).toBe(false);
    expect(JSON.stringify(data)).not.toContain('evidence');
  });

  it('counts candidates, assigned, unassigned and reaches as candidates.json and map.json do', () => {
    const run = checkedRun();
    page(run);
    const { coverage } = dataOf(html(run));
    const assigned = run.map.features.reduce((sum, feature) => sum + feature.candidates.length, 0);
    expect(coverage.candidateTotal).toBe(run.candidates.items.length);
    expect(coverage.assigned).toBe(assigned);
    expect(coverage.candidateTotal).toBe(coverage.assigned + coverage.unassigned.length);
    expect(coverage.unassigned).toEqual([{ candidate: run.idOf('src/app.js', 8), kind: 'route', reason: 'A health check that no reader uses.' }]);
    expect(coverage.reachCounts.map(({ reach }) => reach)).toEqual(['menu', 'link', 'automated', 'interface', 'operator']);
    expect(coverage.reachCounts.map(({ count }) => count)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('page: deterministic bytes and nothing local', () => {
  it('gives identical bytes on two runs and from separate copies of the same input at other paths', () => {
    const first = checkedRun();
    const second = checkedRun();
    expect(first.root).not.toBe(second.root);
    page(first);
    const before = readFileSync(join(first.out, 'handbook.html'));
    page(first);
    expect(readFileSync(join(first.out, 'handbook.html')).equals(before)).toBe(true);
    page(second);
    expect(readFileSync(join(second.out, 'handbook.html')).equals(before)).toBe(true);
  });

  it('does not change when only the attempt count in state.json changes', () => {
    const run = checkedRun();
    page(run);
    const before = html(run);
    const state = run.readJson('state.json');
    state.features.F3.attempts = 1;
    run.writeJson(join(run.out, 'state.json'), state);
    page(run);
    expect(html(run)).toBe(before);
  });

  it('holds no citation path, no candidate file, no project or out path, no time and no evidence key', () => {
    const run = checkedRun();
    page(run);
    const text = html(run);
    const files = citedFiles(run.map, run.entry);
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) expect(text).not.toContain(file);
    for (const file of run.candidates.items.map((item) => item.file)) expect(text).not.toContain(file);
    expect(text).not.toContain(run.root);
    expect(text).not.toContain(run.out);
    expect(text).not.toContain('.excavator');
    expect(text).not.toContain('evidence');
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('replaces the project path by the directory name in every string of the data (defence in depth: the banned-word gate already refuses a path)', () => {
    // The system facts read the project, so the root is a real directory named shop.
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'xhb-root-')));
    cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
    const root = join(parent, 'shop');
    mkdirSync(root);
    const run = {
      map: {
        language: 'English',
        areas: [{ id: 'A1', name: `Area at ${root}/src` }],
        features: [{ id: 'F1', name: 'One', area: 'A1', reach: 'automated', candidates: ['c1'], seedFiles: [] }],
        unassigned: [{ candidate: 'c2', reason: `see ${root} and ${root}-two and ${root}.bak` }, { candidate: 'c3', reason: `registered at ${root}/jobs` }],
        roles: [],
      },
      entries: new Map(),
      findings: new Map(),
      state: { features: { F1: { status: 'planned', attempts: 0 } } },
      candidates: [{ id: 'c1', kind: 'job', file: 'a.js', line: 1, text: 'run()' }, { id: 'c2', kind: 'route' }, { id: 'c3', kind: 'job', file: 'b.js', line: 1, text: 'run()' }],
      ui: { 'md.title': `Handbook of ${root}` },
    };
    const data = buildPageData(run, [root, '/links/shop']);
    // The directory name rewrites paths inside strings; it is not the name the page shows.
    expect(data.project).toBeNull();
    expect(data.areas[0].name).toBe('Area at shop/src');
    expect(data.coverage.unassigned[0].reason).toBe(`see shop and ${root}-two and ${root}.bak`);
    expect(data.ui.strings['md.title']).toBe('Handbook of shop');
    expect(data.summary.jobs.map((row) => [row.candidate, row.feature, row.reason])).toEqual([['c1', 'F1', null], ['c3', null, 'registered at shop/jobs']]);
  });

  it('writes a "<" inside the data as an escape, so no text can close the data block', () => {
    const run = checkedRun((entry) => {
      entry.purpose.text = 'Staff place orders when a < b and a <!-- c.';
    });
    const result = page(run);
    expect(result.status, result.stdout).toBe(0);
    const text = html(run);
    const block = text.slice(text.indexOf('<script type="application/json"'));
    expect(block.slice(block.indexOf('>') + 1, block.indexOf('</script>'))).not.toContain('<');
    expect(dataOf(text).features[0].entry.purpose).toBe('Staff place orders when a < b and a <!-- c.');
  });
});

describe('page: a translated run', () => {
  it('puts the translated table in the data and the language tag of the language', () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    // The fixed text first: the narrative of a run in a language with its own script is checked against it.
    const table = JSON.parse(readFileSync(SHIPPED_UI, 'utf-8'));
    table.language = 'Chinese';
    const word = cjk(0x624b, 0x518c);
    for (const key of Object.keys(table.strings)) {
      table.strings[key] = table.strings[key].replace(/[A-Za-z]+(?: [A-Za-z]+)*/g, (piece, offset, whole) => (whole[offset - 1] === '{' ? piece : `${word}${key}`));
    }
    run.writeJson(join(run.out, 'ui.json'), table);
    run.writeMap(markedMap(run.map));
    expect(run.run('check-map').status).toBe(0);
    expect(page(run).status).toBe(0);
    const data = dataOf(html(run));
    expect(data.language).toBe('Chinese');
    expect(data.languageTag).toBe('zh');
    expect(data.ui.strings['page.nav.overview']).toBe(`${word}page.nav.overview`);
  });
});

describe('page: refuses what assemble refuses, and leaves no page', () => {
  const cases = {
    'a map that no longer passes check-map': (run) => {
      const map = clone(run.map);
      map.features[2].name = 'send_reminders';
      run.writeMap(map);
    },
    'a verified entry changed into a bad one': (run) => {
      const entry = clone(run.entry);
      entry.who[0].can = 'Only clerk_admin may do this.';
      run.writeEntry('F1', entry);
    },
    'a verified entry whose file is gone': (run) => rmSync(join(run.out, 'entries/F1.json')),
    'a ui.json that check-ui would refuse': (run) => {
      const table = JSON.parse(readFileSync(SHIPPED_UI, 'utf-8'));
      delete table.strings['page.nav.overview'];
      run.writeJson(join(run.out, 'ui.json'), table);
    },
    'a candidates.json for another project': (run) => {
      const listed = run.readJson('candidates.json');
      listed.projectRoot = '/nowhere/else';
      run.writeJson(join(run.out, 'candidates.json'), listed);
    },
  };

  for (const [name, spoil] of Object.entries(cases)) {
    it(`${name}: the same exit status and lines as assemble, and the earlier page is removed`, () => {
      const run = checkedRun();
      expect(page(run).status).toBe(0);
      expect(existsSync(join(run.out, 'handbook.html'))).toBe(true);
      spoil(run);
      const assembled = run.run('assemble');
      const result = page(run);
      expect(assembled.status).toBe(1);
      expect(result.status).toBe(1);
      expect(result.lines).toEqual(assembled.lines);
      expect(existsSync(join(run.out, 'handbook.html'))).toBe(false);
    });
  }

  it('a missing state.json is a usage error (exit 2) for both, and removes the earlier page', () => {
    const run = checkedRun();
    page(run);
    rmSync(join(run.out, 'state.json'));
    expect(run.run('assemble').status).toBe(2);
    expect(page(run).status).toBe(2);
    expect(existsSync(join(run.out, 'handbook.html'))).toBe(false);
  });
});

describe('page: the template', () => {
  it('a template that was never built is exit 2 with the build command, and no page is left', () => {
    const run = checkedRun();
    page(run);
    const result = page(run, join(stubDir, 'missing.html'));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('pnpm -r build');
    expect(result.stderr).toContain('missing.html');
    expect(existsSync(join(run.out, 'handbook.html'))).toBe(false);
  });

  it('a template with a marker missing or repeated is exit 2', () => {
    const run = checkedRun();
    for (const [name, text] of [['nodata.html', STUB.replace('<!-- xv:data -->', '')], ['twice.html', STUB.replace('<!-- xv:csp -->', '<!-- xv:csp --><!-- xv:csp -->')]]) {
      const path = join(stubDir, name);
      writeFileSync(path, text);
      const result = page(run, path);
      expect(result.status, name).toBe(2);
      expect(result.stderr, name).toContain('exactly once');
      expect(existsSync(join(run.out, 'handbook.html'))).toBe(false);
    }
  });

  it('without the variable the template is looked up under the plugin root, packages/product-handbook-page/dist', () => {
    const run = checkedRun();
    const env = { ...process.env };
    delete env.EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE;
    const result = runHandbook(['page', run.out, '--project', run.root], { env });
    const built = existsSync(join(run.out, 'handbook.html'));
    if (result.status === 2) expect(result.stderr).toContain('packages/product-handbook-page/dist/product-handbook-page.html');
    else expect(built).toBe(true);
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
