// Oracle O8, browser half, of openspec change product-handbook-map: the page
// `handbook.mjs page` writes opens from file:// in headless Chrome with no
// network request and no console error, shows the overview, a feature page and
// the coverage page by hash, and has no horizontal scroll at 375 px (tables
// scroll inside their own box). Needs the built template (`pnpm -r build`) and
// a Chrome (CHROME_PATH, the macOS application, or google-chrome / chromium on
// PATH). Without a Chrome the suite is skipped with a visible reason, except
// when CI is set: CI runners have Chrome, so there it fails.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Browser, findChrome } from './chrome-cdp.mjs';
import { writeFileSync } from 'node:fs';

import { clone, judge, makeCheckedMapRun, repoRoot, traceFeature } from './helpers.mjs';
import { writeHistory } from './appendix-fixture.mjs';
import { NOTIFY_FILE, NOTIFY_LINE, goodOverview } from './overview-fixture.mjs';

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

/**
 * A run whose F1 entry has a table wide enough to need its own scroll box on a phone. `keepIntegration`
 * keeps the overview's external system (it is removed in round 1 otherwise) and `views` is the page's --views.
 */
function pageRun({ keepIntegration = false, views = undefined, unnamed = false } = {}) {
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
  // One backend rule is contradicted in round 1 and removed there, so the coverage page has a removed-items table to lay out.
  const bad = (item) => (item.id === 'screens[0].fields[1].rules[0]' ? { verdict: 'contradicted', reason: 'The limit the code shows is 50, not the number the sentence gives.' } : 'verified');
  const judged = judge(run, 'F1', 1, bad);
  if (judged.status !== 0) throw new Error(`verdicts round 1 failed:\n${judged.stdout}`);
  const traced = traceFeature(run);
  if (traced.status !== 0) throw new Error(`trace-verdicts failed:\n${traced.stdout}`);
  // A verified system overview that lost its external system in round 1, so the overview page holds the wide application table and the coverage page a second removed-items group.
  writeFileSync(join(run.root, NOTIFY_FILE), `${NOTIFY_LINE}\n`);
  const overview = goodOverview();
  if (unnamed) overview.name = null;
  run.writeEntry('overview', overview);
  if (run.run('check-overview').status !== 0) throw new Error('the overview failed check-overview');
  const judgedOverview = judge(run, 'overview', 1, (item) => (item.id === 'integrations[0]' && !keepIntegration ? { verdict: 'contradicted', reason: 'The code shown sends it to another channel.' } : 'verified'));
  if (judgedOverview.status !== 0) throw new Error(`overview verdicts failed:\n${judgedOverview.stdout}`);
  const tracedOverview = traceFeature(run, 'overview');
  if (tracedOverview.status !== 0) throw new Error(`overview trace-verdicts failed:\n${tracedOverview.stdout}`);
  // The code health page has a history file to show (the fixture project's one application root is `.`).
  writeHistory(run);
  const made = run.run('page', ...(views === undefined ? [] : ['--views', views]));
  if (made.status !== 0) throw new Error(`page failed (${made.status}):\n${made.stdout}${made.stderr}`);
  return run;
}

suite('page in a browser (O8)', () => {
  let browser;
  let run;
  let url;
  let both;
  let urlBoth;

  beforeAll(async () => {
    if (!existsSync(TEMPLATE)) throw new Error(`the page template ${TEMPLATE} is not built: run \`pnpm -r build\` at the repository root`);
    run = pageRun();
    url = pathToFileURL(join(run.out, 'handbook.html')).href;
    both = pageRun({ keepIntegration: true, views: 'product,technical' });
    urlBoth = pathToFileURL(join(both.out, 'handbook.html')).href;
    browser = await Browser.launch(chrome);
  }, 60000);

  afterAll(async () => {
    await browser?.close();
    run?.cleanup();
    both?.cleanup();
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

  // The text of a block keeps (nearly) the whole content width of its list, the opposite of a squeezed column.
  const fullWidth = (page, selector) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const list = el.closest('.item-list'); return el.getBoundingClientRect().width >= list.getBoundingClientRect().width * 0.6; })()`);

  for (const [width, height] of [[375, 812], [1280, 800]]) {
    describe(`at ${width}x${height}`, () => {
      it('opens from file:// with no network request and no console error, and shows each view by hash', async () => {
        const page = await browser.openPage({ width, height });
        await page.goto(url);
        await page.waitFor('document.querySelector(\'[data-view="overview"]\')', 'the overview');

        expect(await page.evaluate('document.documentElement.lang')).toBe('en');
        expect(await page.evaluate('document.title')).toBe('Overview - handbook-fixture - Product handbook');
        // The bar and the eyebrow show the verified system name, not the directory the project sits in.
        expect(await page.evaluate("document.querySelector('.brand-project').textContent")).toBe('handbook-fixture');
        expect(await page.evaluate("document.querySelector('[data-view=\"overview\"] .eyebrow').textContent")).toBe('handbook-fixture');
        await fits(page, width, 'the overview');
        expect(await page.evaluate("document.querySelectorAll('.area-card').length")).toBe(2);
        // The system overview: its purpose and the applications, each a block that has the full width (not a column of a wide table).
        expect(await page.evaluate("document.querySelector('[data-part=\"system\"] #sys-purpose').parentElement.textContent")).toContain('Staff place and review orders for customers.');
        expect(await page.evaluate("document.querySelectorAll('[data-part=\"system\"] #sys-applications ~ .item-list li.item').length")).toBe(1);
        expect(await fullWidth(page, '[data-part="system"] #sys-applications ~ .item-list li.item')).toBe(true);

        await goTo(page, '#/feature/F1', '[data-view="feature"][data-feature="F1"]');
        expect(await page.evaluate('document.title')).toBe('Orders - handbook-fixture - Product handbook');
        await fits(page, width, 'the feature page');
        // The rules and the notifications hold free text: blocks, not tables, and the long rule keeps the full width of its block.
        expect(await page.evaluate("document.querySelectorAll('[data-view=\"feature\"] .item-list').length")).toBeGreaterThanOrEqual(2);
        expect(await page.evaluate("document.querySelectorAll('[data-view=\"feature\"] table').length")).toBe(0);
        expect(await fullWidth(page, '[data-view="feature"] [data-part="fields"] li.item .item-body')).toBe(true);

        await goTo(page, '#/feature/F2', '[data-view="feature"][data-feature="F2"] .notice');
        await goTo(page, '#/coverage', '[data-view="coverage"]');
        await fits(page, width, 'the coverage page');
        expect(await page.evaluate("document.querySelectorAll('[data-view=\"coverage\"] .removed-group').length")).toBe(2);
        expect(await page.evaluate("document.querySelector('[data-view=\"coverage\"] .callout').textContent")).toContain('Entrypoint candidates listed: 7.');

        // The two cross-cutting tables: reachable by hash, a row for each row of the data, no sideways page scroll.
        const summary = JSON.parse(await page.evaluate("document.getElementById('xv-product-handbook-data').textContent")).summary;
        expect(summary.notifications).toHaveLength(1);
        expect(summary.jobs).toHaveLength(1);
        await goTo(page, '#/notifications', '[data-view="notifications"] .item-list');
        expect(await page.evaluate('document.title')).toBe('All notifications - handbook-fixture - Product handbook');
        await fits(page, width, 'the notification table page');
        expect(await page.evaluate("document.querySelectorAll('[data-view=\"notifications\"] li.item').length")).toBe(summary.notifications.length);
        expect(await page.evaluate("document.querySelector('[data-view=\"notifications\"] li.item').textContent")).toContain('A new order waits for approval.');
        expect(await page.evaluate("document.querySelector('[data-view=\"notifications\"] .summary-counts').textContent")).toContain('Notifications listed: 1.');
        await goTo(page, '#/jobs', '[data-view="jobs"] .item-list');
        expect(await page.evaluate('document.title')).toBe('All scheduled jobs - handbook-fixture - Product handbook');
        await fits(page, width, 'the job table page');
        expect(await page.evaluate("document.querySelectorAll('[data-view=\"jobs\"] li.item').length")).toBe(summary.jobs.length);
        expect(await page.evaluate("document.querySelector('[data-view=\"jobs\"] li.item code.schedule').textContent")).toBe('0 9 * * *');
        expect(await page.evaluate("document.querySelector('[data-view=\"jobs\"] li.item').textContent")).toContain('No verified description');

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

  it('without a verified name the bar, the eyebrow and the browser title say there is none and never show the directory', async () => {
    const unnamed = pageRun({ unnamed: true });
    try {
      const page = await browser.openPage({ width: 1280, height: 800 });
      await page.goto(pathToFileURL(join(unnamed.out, 'handbook.html')).href);
      await page.waitFor('document.querySelector(\'[data-view="overview"]\')', 'the overview');
      expect(await page.evaluate('document.title')).toBe('Overview - Product handbook');
      expect(await page.evaluate("document.querySelector('.brand-project').textContent")).toBe('No system name found in the code');
      expect(await page.evaluate("document.querySelector('[data-view=\"overview\"] .eyebrow').textContent")).toBe('No system name found in the code');
      expect(await page.evaluate("document.body.innerText.includes('/project') || document.title.includes('project')")).toBe(false);
      expect(page.consoleErrors).toEqual([]);
    } finally {
      unnamed.cleanup();
    }
  }, 60000);

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

  for (const [width, height] of [[375, 812], [1280, 800]]) {
    describe(`the two views at ${width}x${height}`, () => {
      it('a page with one view has no switch', async () => {
        const page = await browser.openPage({ width, height });
        await page.goto(url);
        await page.waitFor('document.querySelector(\'[data-view="overview"]\')', 'the overview');
        expect(await page.evaluate("document.querySelectorAll('[data-part=\"view-switch\"]').length")).toBe(0);
        expect(await page.evaluate("document.querySelectorAll('.rail [data-application]').length")).toBe(0);
        expect(page.consoleErrors).toEqual([]);
      }, 60000);

      it('shows the switch, which keeps the entity, the technical navigation by application, and no page scrolls sideways', async () => {
        const page = await browser.openPage({ width, height });
        await page.goto(urlBoth);
        await page.waitFor('document.querySelector(\'[data-view="overview"]\')', 'the overview');
        expect(await page.evaluate("document.querySelectorAll('[data-part=\"view-switch\"] a').length")).toBe(2);
        await fits(page, width, 'the overview with the switch');

        // Switching on a feature page stays on the feature, and the technical page shows where each item is cited.
        await goTo(page, '#/product/feature/F1', '[data-view="feature"][data-feature="F1"]');
        expect(await page.evaluate("document.querySelector('[data-part=\"locations\"]')")).toBeNull();
        await page.evaluate("document.querySelector('[data-view-link=\"technical\"]').click()");
        await page.waitFor('document.querySelector(\'[data-part="locations"]\')', 'the source locations after the switch');
        expect(await page.evaluate('window.location.hash')).toBe('#/technical/feature/F1');
        expect(await page.evaluate("document.querySelector('[data-view=\"feature\"]').getAttribute('data-feature')")).toBe('F1');
        expect(await page.evaluate("document.querySelector('[data-part=\"locations\"]').textContent")).toMatch(/src\/forms\/order-form\.js:\s?\d+/);
        await fits(page, width, 'the technical feature page');
        // The technical rail is by application: the application, then its domains, then their features.
        expect(await page.evaluate("document.querySelectorAll('.rail [data-application]').length")).toBeGreaterThan(0);
        expect(await page.evaluate("(() => { const app = document.querySelector('.rail [data-application]'); return app.querySelector('.rail-domain .rail-feature') !== null; })()")).toBe(true);
        // The other way: the entity stays too.
        await page.evaluate("document.querySelector('[data-view-link=\"product\"]').click()");
        await page.waitFor('document.querySelector(\'[data-view="feature"][data-feature="F1"]\')', 'F1 in the product view');
        expect(await page.evaluate('window.location.hash')).toBe('#/product/feature/F1');
        expect(await page.evaluate("document.querySelector('[data-part=\"locations\"]')")).toBeNull();
        expect(await page.evaluate("document.querySelectorAll('.rail [data-application]').length")).toBe(0);

        // A page the product view does not have: switching goes to the product overview.
        await goTo(page, '#/technical/application/.', '[data-view="application"]');
        await fits(page, width, 'the application page');
        await page.evaluate("document.querySelector('[data-view-link=\"product\"]').click()");
        await page.waitFor('document.querySelector(\'[data-view="overview"]\')', 'the product overview after the switch');
        expect(await page.evaluate('window.location.hash')).toBe('#/product');

        for (const [hash, selector, what] of [
          ['#/technical', '[data-view="overview"]', 'the technical overview'],
          ['#/technical/system/Slack', '[data-view="system"]', 'the external system page'],
          ['#/technical/matrix/applications', '[data-view="applications-matrix"] table', 'the applications-by-domain matrix'],
          ['#/technical/matrix/roles', '[data-view="roles-matrix"] table', 'the roles-by-feature matrix'],
          ['#/technical/domain/A1', '[data-view="domain"]', 'the domain page'],
          ['#/technical/role/Clerk', '[data-view="role"]', 'the role page'],
          ['#/technical/coverage', '[data-view="coverage"]', 'the coverage page'],
          ['#/product/matrix/roles', '[data-view="roles-matrix"] table', 'the product roles matrix'],
          ['#/product/domain/A2', '[data-view="domain"]', 'the product domain page'],
        ]) {
          await goTo(page, hash, selector);
          await fits(page, width, what);
        }

        const foreign = page.requests.filter((request) => request !== urlBoth && !request.startsWith('data:'));
        expect(foreign).toEqual([]);
        expect(page.consoleErrors).toEqual([]);
      }, 90000);
    });
  }

  // O2 of openspec change handbook-history-appendix: the code health page and the three appendix pages open in both views at both widths
  // with the free text in blocks and the tables inside their own boxes (no sideways scroll of the page), the technical view with the path of each file, and no console error.
  for (const [width, height] of [[375, 812], [1280, 800]]) {
    it(`shows the code health and the appendix pages at ${width}x${height}`, async () => {
      const page = await browser.openPage({ width, height });
      await page.goto(urlBoth);
      await page.waitFor('document.querySelector(\'[data-view="overview"]\')', 'the overview');
      for (const [hash, selector, what] of [
        ['#/product/history', '[data-view="history"] [data-part="history-years"]', 'the product code health page'],
        ['#/technical/history', '[data-view="history"] [data-part="history-hotspots"]', 'the technical code health page'],
        ['#/product/open-questions', '[data-view="open-questions"] .item-list', 'the open questions page'],
        ['#/technical/glossary', '[data-view="glossary"] .def-list', 'the glossary page'],
        ['#/product/sources', '[data-view="sources"] table', 'the sources and scope page'],
      ]) {
        await goTo(page, hash, selector);
        await fits(page, width, what);
      }
      await goTo(page, '#/product/history', '[data-view="history"] [data-part="history-hotspots"]');
      const product = await page.evaluate("document.querySelector('[data-part=\"history-hotspots\"]').textContent");
      expect(product).toContain('orders.js');
      expect(product).not.toContain('src/routes');
      await goTo(page, '#/technical/history', '[data-view="history"] [data-part="history-hotspots"]');
      expect(await page.evaluate("document.querySelector('[data-part=\"history-hotspots\"]').textContent")).toContain('src/routes/orders.js');
      expect(await page.evaluate("document.querySelectorAll('[data-part=\"history-chart\"] .year-bar').length")).toBe(3);
      const foreign = page.requests.filter((request) => request !== urlBoth && !request.startsWith('data:'));
      expect(foreign).toEqual([]);
      expect(page.consoleErrors).toEqual([]);
    }, 60000);
  }
});
