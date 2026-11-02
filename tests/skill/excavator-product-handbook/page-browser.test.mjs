// Oracle O8, browser half, of openspec change product-handbook-map: the page
// `handbook.mjs page` writes opens from file:// in headless Chrome with no
// network request and no console error, shows the overview, a feature page and
// the coverage page by hash, and has no horizontal scroll at 375 px (tables
// scroll inside their own box). Needs the built template (`pnpm -r build`) and
// a Chrome (CHROME_PATH, the macOS application, or google-chrome / chromium on
// PATH). Without a Chrome the suite is skipped with a visible reason, except
// when CI is set: CI runners have Chrome, so there it fails.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Browser, findChrome } from './chrome-cdp.mjs';
import { clone, judge, makeCheckedMapRun, repoRoot, traceFeature } from './helpers.mjs';

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

const ev = (file, passage) => ({ file, passage });
const form = 'src/forms/order-form.js';
const LONG = 'A customer name that is longer than the print width is shortened in documents but kept in full in the order record, and a name made only of spaces is refused with a message asking for a real name.';

/** A run whose F1 entry has a table wide enough to need its own scroll box on a phone. */
function pageRun() {
  const run = makeCheckedMapRun();
  const entry = clone(run.entry);
  entry.screens[0].fields[0].rules.push({ side: 'backend', text: LONG, evidence: [ev(form, "{ label: 'Customer Name', required: true },")] });
  entry.notifications.push({
    trigger: 'An order is sent', recipient: 'The approver', channel: 'Message', content: 'A new order waits for approval.',
    evidence: [ev(form, "const statuses = ['Draft', 'Submitted'];")],
  });
  run.writeEntry('F1', entry);
  const checked = run.run('check-entry', 'F1');
  if (checked.status !== 0) throw new Error(`the entry failed check-entry:\n${checked.stdout}`);
  // One backend rule is contradicted in both rounds, so the coverage page has a removed-items table to lay out.
  const bad = (item) => (item.id === 'screens[0].fields[1].rules[0]' ? { verdict: 'contradicted', reason: 'The limit the code shows is 50, not the number the sentence gives.' } : 'verified');
  for (const round of [1, 2]) {
    const judged = judge(run, 'F1', round, bad);
    if (judged.status !== 0) throw new Error(`verdicts round ${round} failed:\n${judged.stdout}`);
  }
  const traced = traceFeature(run);
  if (traced.status !== 0) throw new Error(`trace-verdicts failed:\n${traced.stdout}`);
  const made = run.run('page');
  if (made.status !== 0) throw new Error(`page failed (${made.status}):\n${made.stdout}${made.stderr}`);
  return run;
}

suite('page in a browser (O8)', () => {
  let browser;
  let run;
  let url;

  beforeAll(async () => {
    if (!existsSync(TEMPLATE)) throw new Error(`the page template ${TEMPLATE} is not built: run \`pnpm -r build\` at the repository root`);
    run = pageRun();
    url = pathToFileURL(join(run.out, 'handbook.html')).href;
    browser = await Browser.launch(chrome);
  }, 60000);

  afterAll(async () => {
    await browser?.close();
    run?.cleanup();
  });

  const overflow = (page) => page.evaluate('({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })');
  // The window is the intended width: a page wider than it scrolls sideways.
  const fits = async (page, width, what) => {
    const size = await overflow(page);
    expect(size.inner, 'the window has the width it was given').toBe(width);
    expect(size.scroll, `${what} is ${size.scroll}px wide in a ${width}px window`).toBeLessThanOrEqual(width);
  };
  const goTo = async (page, hash, selector) => {
    await page.evaluate(`window.location.hash = ${JSON.stringify(hash)}`);
    await page.waitFor(`document.querySelector(${JSON.stringify(selector)})`, `${selector} after ${hash}`);
  };

  for (const [width, height] of [[375, 812], [1280, 800]]) {
    describe(`at ${width}x${height}`, () => {
      it('opens from file:// with no network request and no console error, and shows each view by hash', async () => {
        const page = await browser.openPage({ width, height });
        await page.goto(url);
        await page.waitFor('document.querySelector(\'[data-view="overview"]\')', 'the overview');

        expect(await page.evaluate('document.documentElement.lang')).toBe('en');
        expect(await page.evaluate('document.title')).toBe('Overview - project - Product handbook');
        await fits(page, width, 'the overview');
        expect(await page.evaluate("document.querySelectorAll('.area-card').length")).toBe(2);

        await goTo(page, '#/feature/F1', '[data-view="feature"][data-feature="F1"]');
        expect(await page.evaluate('document.title')).toBe('Orders - project - Product handbook');
        await fits(page, width, 'the feature page');
        expect(await page.evaluate("document.querySelectorAll('.table-scroll').length")).toBeGreaterThanOrEqual(2);
        if (width < 500) {
          // The wide table keeps its width inside its own box: the box scrolls, the page does not.
          expect(await page.evaluate("Array.from(document.querySelectorAll('.table-scroll')).some((box) => box.scrollWidth > box.clientWidth)")).toBe(true);
        }

        await goTo(page, '#/feature/F2', '[data-view="feature"][data-feature="F2"] .notice');
        await goTo(page, '#/coverage', '[data-view="coverage"]');
        await fits(page, width, 'the coverage page');
        expect(await page.evaluate("document.querySelectorAll('[data-view=\"coverage\"] .removed-group').length")).toBe(1);
        expect(await page.evaluate("document.querySelector('[data-view=\"coverage\"] .callout').textContent")).toContain('Entrypoint candidates listed: 7.');

        // The two cross-cutting tables: reachable by hash, a row for each row of the data, no sideways page scroll.
        const summary = JSON.parse(await page.evaluate("document.getElementById('xv-product-handbook-data').textContent")).summary;
        expect(summary.notifications).toHaveLength(1);
        expect(summary.jobs).toHaveLength(1);
        await goTo(page, '#/notifications', '[data-view="notifications"] table');
        expect(await page.evaluate('document.title')).toBe('All notifications - project - Product handbook');
        await fits(page, width, 'the notification table page');
        expect(await page.evaluate("document.querySelectorAll('[data-view=\"notifications\"] tbody tr').length")).toBe(summary.notifications.length);
        expect(await page.evaluate("document.querySelector('[data-view=\"notifications\"] tbody tr').textContent")).toContain('A new order waits for approval.');
        expect(await page.evaluate("document.querySelector('[data-view=\"notifications\"] .summary-counts').textContent")).toContain('Notifications listed: 1.');
        await goTo(page, '#/jobs', '[data-view="jobs"] table');
        expect(await page.evaluate('document.title')).toBe('All scheduled jobs - project - Product handbook');
        await fits(page, width, 'the job table page');
        expect(await page.evaluate("document.querySelectorAll('[data-view=\"jobs\"] tbody tr').length")).toBe(summary.jobs.length);
        expect(await page.evaluate("document.querySelector('[data-view=\"jobs\"] tbody code.schedule').textContent")).toBe('0 9 * * *');
        expect(await page.evaluate("document.querySelector('[data-view=\"jobs\"] tbody tr').textContent")).toContain('No verified description');
        if (width < 500) {
          expect(await page.evaluate("Array.from(document.querySelectorAll('[data-view=\"jobs\"] .table-scroll')).some((box) => box.scrollWidth > box.clientWidth)")).toBe(true);
        }

        await goTo(page, '#/nowhere', '[data-view="not-found"]');
        await goTo(page, '#/feature/missing', '[data-view="not-found"]');
        await goTo(page, '#/', '[data-view="overview"]');

        // The back button follows the routes.
        await goTo(page, '#/coverage', '[data-view="coverage"]');
        await page.evaluate('history.back()');
        await page.waitFor('document.querySelector(\'[data-view="overview"]\')', 'the overview after back');

        const foreign = page.requests.filter((request) => request !== url && !request.startsWith('data:'));
        expect(foreign).toEqual([]);
        expect(page.requests.length).toBeGreaterThan(0);
        expect(page.consoleErrors).toEqual([]);
      }, 60000);

      it('navigates from the sidebar', async () => {
        const page = await browser.openPage({ width, height });
        await page.goto(url);
        await page.waitFor('document.querySelector(\'[data-view="overview"]\')', 'the overview');
        if (width < 900) {
          expect(await page.evaluate("getComputedStyle(document.querySelector('.rail')).visibility")).toBe('hidden');
          await page.evaluate("document.querySelector('.menu-btn').click()");
          await page.waitFor("document.querySelector('.rail[data-open=\"true\"]')", 'the open drawer');
          expect(await page.evaluate("getComputedStyle(document.querySelector('.rail')).visibility")).toBe('visible');
          await fits(page, width, 'the page with the drawer open');
        } else {
          expect(await page.evaluate("getComputedStyle(document.querySelector('.rail')).visibility")).toBe('visible');
        }
        expect(await page.evaluate("document.querySelectorAll('.rail-feature').length")).toBe(5);
        await page.evaluate("document.querySelector('.rail-feature').click()");
        await page.waitFor('document.querySelector(\'[data-view="feature"][data-feature="F1"]\')', 'F1 from the sidebar');
        if (width < 900) {
          await page.waitFor("document.querySelector('.rail[data-open=\"false\"]')", 'the drawer closed after a choice');
        }
        expect(await page.evaluate("document.querySelector('.rail-feature[aria-current=\"page\"] .rail-feature-name').textContent")).toBe('Orders');
        // The two tables are in the navigation too.
        for (const [view, hash] of [['notifications', '#/notifications'], ['jobs', '#/jobs']]) {
          if (width < 900) await page.evaluate("document.querySelector('.menu-btn').click()");
          await page.evaluate(`document.querySelector('.rail-link[href="${hash}"]').click()`);
          await page.waitFor(`document.querySelector('[data-view="${view}"]')`, `the ${view} page from the sidebar`);
          expect(await page.evaluate(`document.querySelector('.rail-link[href="${hash}"]').getAttribute('aria-current')`)).toBe('page');
        }
        expect(page.consoleErrors).toEqual([]);
      }, 60000);
    });
  }

  it('follows the system colour scheme', async () => {
    const colours = [];
    for (const dark of [false, true]) {
      const page = await browser.openPage({ width: 1280, height: 800, dark });
      await page.goto(url);
      await page.waitFor('document.querySelector(\'[data-view="overview"]\')', 'the overview');
      colours.push(await page.evaluate('getComputedStyle(document.body).backgroundColor'));
      expect(page.consoleErrors).toEqual([]);
    }
    expect(colours[0]).not.toBe(colours[1]);
  }, 60000);
});
