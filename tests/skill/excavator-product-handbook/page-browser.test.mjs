// Oracle O4 (browser half) of openspec change handbook-skill-first: the page `handbook.mjs page` writes opens from
// file:// in headless Chrome with no network request and no console error, shows a chapter's Markdown (a table is a
// table, a list is a list, a flowchart and a state diagram are drawn by mermaid, a diagram that cannot be drawn shows
// its source and a note), shows a citation chip in the technical view and none in the product view, keeps the chapter
// when the view is switched, has no horizontal scroll at 375 px (tables scroll inside their own box), and with part
// files loads only the parts of the page it opens. Needs the built template (`pnpm -r build`) and a Chrome
// (CHROME_PATH, the macOS application, or google-chrome / chromium on PATH). Without a Chrome the suite is skipped with
// a visible reason, except when CI is set: CI runners have Chrome, so there it fails.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Browser, findChrome } from './chrome-cdp.mjs';
import { repoRoot } from './helpers.mjs';
import { pageRun, runPage } from './page-md-fixture.mjs';

const TEMPLATE = join(repoRoot, 'packages/product-handbook-page/dist/product-handbook-page.html');
const chrome = findChrome();
const NO_CHROME = 'no Chrome found: set CHROME_PATH, or install google-chrome or chromium';

if (chrome === null && process.env.CI) {
  describe('page in a browser', () => {
    it('finds a Chrome (CI runners have one)', () => {
      throw new Error(`${NO_CHROME}. The page tests need it on CI.`);
    });
  });
}

const suite = chrome === null ? describe.skip : describe;
if (chrome === null && !process.env.CI) console.warn(`page-browser.test.mjs skipped: ${NO_CHROME}`);

suite('page in a browser (O4)', () => {
  const cleanups = [];
  let browser;
  let run;
  let url;

  beforeAll(async () => {
    if (!existsSync(TEMPLATE)) throw new Error(`the page template ${TEMPLATE} is not built: run \`pnpm -r build\` at the repository root`);
    run = pageRun(cleanups);
    const made = runPage(run, { template: TEMPLATE });
    if (made.status !== 0) throw new Error(`page failed (${made.status}):\n${made.stdout}${made.stderr}`);
    url = pathToFileURL(join(run.out, 'handbook.html')).href;
    browser = await Browser.launch(chrome);
  }, 60000);

  afterAll(async () => {
    await browser?.close();
    while (cleanups.length > 0) cleanups.pop()();
  });

  const fits = async (page, width, what) => {
    const size = await page.evaluate('({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })');
    expect(size.inner, 'the window has the width it was given').toBe(width);
    expect(size.scroll, `${what} is ${size.scroll}px wide in a ${width}px window`).toBeLessThanOrEqual(width);
  };
  const goTo = async (page, hash, selector) => {
    await page.evaluate(`window.location.hash = ${JSON.stringify(hash)}`);
    await page.waitFor(`document.querySelector(${JSON.stringify(selector)})`, `${selector} after ${hash}`);
  };
  const diagramsSettled = (page) => page.waitFor("document.querySelectorAll('[data-diagram=\"pending\"]').length === 0 && document.querySelectorAll('[data-diagram]').length === 3", 'the three diagrams settled');

  for (const [width, height] of [[375, 812], [1280, 800]]) {
    describe(`at ${width}x${height}`, () => {
      it('opens from file:// with no network request and no console error, and shows the first chapter at the home route', async () => {
        const page = await browser.openPage({ width, height });
        await page.goto(url);
        await page.waitFor('document.querySelector(\'[data-view="chapter"]\')', 'the first chapter');
        expect(await page.evaluate('document.documentElement.lang')).toBe('en');
        expect(await page.evaluate("document.querySelector('h1').textContent")).toBe('System');
        await fits(page, width, 'the first chapter');
        const foreign = page.requests.filter((request) => request !== url && !request.startsWith('data:'));
        expect(foreign).toEqual([]);
        expect(page.consoleErrors).toEqual([]);
      }, 60000);

      it('shows the feature chapter: a table, a list, two drawn diagrams and one that falls back to its source', async () => {
        const page = await browser.openPage({ width, height });
        await page.goto(url);
        await page.waitFor('document.querySelector(\'[data-view="chapter"]\')', 'a chapter');
        await goTo(page, '#/technical/chapter/F1', '[data-chapter="F1"] .prose table');
        await diagramsSettled(page);
        expect(await page.evaluate("document.querySelectorAll('.prose table').length")).toBeGreaterThanOrEqual(1);
        expect(await page.evaluate("document.querySelectorAll('.prose table tbody tr').length")).toBe(2);
        expect(await page.evaluate("document.querySelectorAll('.prose ul > li').length")).toBeGreaterThanOrEqual(2);
        expect(await page.evaluate("document.querySelectorAll('[data-diagram=\"done\"] svg').length")).toBe(2);
        expect(await page.evaluate("document.querySelectorAll('[data-diagram=\"failed\"]').length")).toBe(1);
        expect(await page.evaluate("document.querySelector('[data-diagram=\"failed\"] pre code').textContent")).toContain('flowchart TD');
        expect(await page.evaluate("document.querySelector('[data-diagram=\"failed\"]').textContent")).toContain('This diagram could not be drawn');
        await fits(page, width, 'the feature chapter');
        // The drawings are inside the window too.
        expect(await page.evaluate("Math.max(...Array.from(document.querySelectorAll('[data-diagram=\"done\"]')).map((box) => box.getBoundingClientRect().right))")).toBeLessThanOrEqual(width);
        expect(page.requests.filter((request) => request !== url && !request.startsWith('data:'))).toEqual([]);
        // The broken diagram is the one expected console error source of mermaid; the page itself raises none of its own.
        expect(page.consoleErrors.filter((message) => !/mermaid|Parse error|Syntax error|diagram/i.test(message))).toEqual([]);
      }, 60000);

      it('shows a citation chip in the technical view and none in the product view, and keeps the chapter when the view is switched', async () => {
        const page = await browser.openPage({ width, height });
        await page.goto(url);
        await goTo(page, '#/technical/chapter/F1', '[data-chapter="F1"] .prose');
        expect(await page.evaluate("document.querySelectorAll('.cite').length")).toBeGreaterThan(0);
        expect(await page.evaluate("document.querySelector('.cite .cite-file').textContent")).toMatch(/\.js$/);
        expect(await page.evaluate("document.querySelector('.cite .cite-lines').textContent")).toMatch(/^:\d/);
        await page.evaluate("document.querySelector('[data-view-link=\"product\"]').click()");
        await page.waitFor("location.hash === '#/product/chapter/F1' && document.querySelector('[data-chapter=\"F1\"] .prose')", 'the same chapter in the product view');
        expect(await page.evaluate("document.querySelectorAll('.cite').length")).toBe(0);
        expect(await page.evaluate("document.querySelector('.prose').textContent")).not.toContain('order-form.js');
        // The data page is the technical view's only: the switch goes to the first chapter.
        await goTo(page, '#/technical/data', '[data-view="data"]');
        await page.evaluate("document.querySelector('[data-view-link=\"product\"]').click()");
        await page.waitFor("location.hash === '#/product/chapter/system'", 'the first chapter of the product view');
      }, 60000);

      it('shows the data, dictionaries, code health and coverage pages, and moves with the previous and next links', async () => {
        const page = await browser.openPage({ width, height });
        await page.goto(url);
        await goTo(page, '#/technical/data', '[data-view="data"] [data-part="data-tables"]');
        await fits(page, width, 'the data page');
        await goTo(page, '#/technical/dictionaries', '[data-view="dictionaries"] [data-set]');
        await fits(page, width, 'the dictionaries page');
        await goTo(page, '#/technical/history', '[data-view="history"] [data-part="history-years"]');
        await fits(page, width, 'the code health page');
        await goTo(page, '#/product/history', '[data-view="history"] [data-part="history-hotspots"]');
        expect(await page.evaluate("document.querySelector('[data-part=\"history-hotspots\"] a').getAttribute('href')")).toMatch(/^#\/product\/chapter\//);
        await page.evaluate("document.querySelector('.chapter-link[data-side=\"next\"]').click()");
        await page.waitFor('document.querySelector(\'[data-chapter="coverage"]\')', 'the coverage page by the next link');
        expect(await page.evaluate("document.querySelector('h1').textContent")).toBe('Coverage');
        await fits(page, width, 'the coverage page');
        await page.evaluate("document.querySelector('.chapter-link[data-side=\"previous\"]').click()");
        await page.waitFor('document.querySelector(\'[data-view="history"]\')', 'the code health page by the previous link');
        await goTo(page, '#/nowhere', '[data-view="not-found"]');
        await goTo(page, '#/product/chapter/missing', '[data-view="not-found"]');
        expect(page.consoleErrors).toEqual([]);
      }, 60000);

      it('navigates from the sidebar, in a drawer on a narrow window', async () => {
        const page = await browser.openPage({ width, height });
        await page.goto(url);
        await page.waitFor('document.querySelector(\'[data-view="chapter"]\')', 'the first chapter');
        if (width < 900) {
          expect(await page.evaluate("getComputedStyle(document.querySelector('.rail')).visibility")).toBe('hidden');
          await page.evaluate("document.querySelector('.menu-btn').click()");
          await page.waitFor("document.querySelector('.rail[data-open=\"true\"]')", 'the open drawer');
          await fits(page, width, 'the page with the drawer open');
        } else {
          expect(await page.evaluate("getComputedStyle(document.querySelector('.rail')).visibility")).toBe('visible');
        }
        expect(await page.evaluate("Array.from(document.querySelectorAll('.rail-group-name')).map((el) => el.textContent)")).toEqual(['System', 'Features', 'Data and code health']);
        await page.evaluate("document.querySelector('.rail-link[data-page=\"chapter:F1\"]').click()");
        await page.waitFor('document.querySelector(\'[data-chapter="F1"]\')', 'the chapter from the sidebar');
        if (width < 900) await page.waitFor("document.querySelector('.rail[data-open=\"false\"]')", 'the drawer closed after a choice');
        expect(await page.evaluate("document.querySelector('.rail-link[aria-current=\"page\"]').getAttribute('data-page')")).toBe('chapter:F1');
      }, 60000);
    });
  }

  // A page with part files opens from file:// and shows the same chapter as the one-file form; the home page loads only the
  // parts of its chapter, a chapter loads its own, no request but the page and its part files, no console error; with a part
  // deleted the page that needs it names it and the others still work.
  describe('a page with part files', () => {
    const route = '#/technical/chapter/F1';
    const mainOf = (page) => page.evaluate("document.querySelector('main').innerHTML");
    const partsOf = (page) => page.requests.filter((request) => request.includes('/handbook-data/')).map((request) => request.replace(/^.*\//, ''));

    it('shows the page of the one-file form, loading only the parts of the page it opens, and names a missing part', async () => {
      const single = await browser.openPage({ width: 1280, height: 800 });
      await single.goto(url);
      await goTo(single, route, '[data-chapter="F1"] .prose table');
      await diagramsSettled(single);
      const expected = await single.evaluate("document.querySelector('[data-chapter=\"F1\"]').textContent");
      expect(partsOf(single)).toEqual([]);

      const made = runPage(run, { template: TEMPLATE, env: { EXCAVATOR_PRODUCT_HANDBOOK_PAGE_CHUNK_THRESHOLD: '1', EXCAVATOR_PRODUCT_HANDBOOK_PAGE_PART_LIMIT: '3000' } });
      expect(made.status, made.stdout + made.stderr).toBe(0);
      const names = readdirSync(join(run.out, 'handbook-data'));
      expect(names.length).toBeGreaterThan(1);
      const page = await browser.openPage({ width: 1280, height: 800 });
      await page.goto(url);
      await page.waitFor('document.querySelector(\'[data-view="chapter"] .prose\')', 'the first chapter');
      const homeParts = partsOf(page);
      expect(homeParts.length).toBeGreaterThan(0);
      expect(homeParts.length).toBeLessThan(names.length);
      await goTo(page, route, '[data-chapter="F1"] .prose table');
      await diagramsSettled(page);
      expect(await page.evaluate("document.querySelector('[data-chapter=\"F1\"]').textContent")).toBe(expected);
      const loaded = partsOf(page);
      expect(loaded.every((name) => names.includes(name))).toBe(true);
      expect(page.requests.filter((request) => request !== url && !request.startsWith('data:') && !request.includes('/handbook-data/part-'))).toEqual([]);
      expect(page.consoleErrors.filter((message) => !/mermaid|Parse error|Syntax error|diagram/i.test(message))).toEqual([]);
      expect(await mainOf(page)).toContain('cite');

      rmSync(join(run.out, 'handbook-data', loaded[loaded.length - 1]));
      const broken = await browser.openPage({ width: 1280, height: 800 });
      await broken.goto(url);
      await goTo(broken, '#/technical/chapter/F1', '[data-part="chunk-missing"], [data-chapter="F1"] .prose');
      await goTo(broken, '#/technical/coverage', '[data-chapter="coverage"], [data-part="chunk-missing"]');
      expect(readFileSync(join(run.out, 'handbook.html'), 'utf-8')).toContain("script-src 'self' 'unsafe-inline'");
    }, 90000);
  });
});
