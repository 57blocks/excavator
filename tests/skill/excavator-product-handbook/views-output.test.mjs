// O1 (output) of openspec change handbook-entities-and-views: assemble and
// page write the views that --views selects and no other, the product view
// holds no citation path, the technical view shows the file and lines of each
// cited item, the relations count only verified units, and every output is
// the same bytes on a second run.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clone, confirmChecked, runHandbook, verifyChecked } from './helpers.mjs';
import { checkedOverviewRun } from './overview-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const ev = (file, passage) => ({ file, passage });
const FORM = 'src/forms/order-form.js';
const SECOND = 'svc2/package.json';

/** Assemble with `views` (omitted: no --views option). */
const assemble = (run, views) => run.run('assemble', ...(views === undefined ? [] : ['--views', views]));
const page = (run, views) => runHandbook(['page', run.out, '--project', run.root, ...(views === undefined ? [] : ['--views', views])], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
const text = (run, name) => readFileSync(join(run.out, name), 'utf-8');
const dataOf = (run) => JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(text(run, 'handbook.html'))[1]);
const sectionOf = (body, from, to) => {
  const start = body.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  const end = to === undefined ? -1 : body.indexOf(to, start + from.length);
  return end === -1 ? body.slice(start) : body.slice(start, end);
};

/**
 * A run with a verified overview that lists a second application (`svc2`, whose
 * source also names Slack but which the overview does not list as a caller), a
 * verified F1, and F2 that is only confirmed (verified by the verifiers, not traced).
 */
function viewsRun({ confirmedF2 = true } = {}) {
  const run = checkedOverviewRun(cleanups, (doc, made) => {
    mkdirSync(join(made.root, 'svc2'), { recursive: true });
    writeFileSync(join(made.root, SECOND), '{ "name": "svc2", "dependencies": { "koa": "^2.0.0" } }\n');
    writeFileSync(join(made.root, 'svc2', 'board.js'), "export const channel = 'Slack';\n");
    doc.applications.push({ dir: 'svc2', name: 'Board service', does: 'Reads the board.', evidence: [ev(SECOND, '"koa": "^2.0.0"')] });
  });
  verifyChecked(run, 'overview');
  run.writeEntry('F1', clone(run.entry));
  expect(run.run('check-entry', 'F1').status).toBe(0);
  verifyChecked(run, 'F1');
  if (confirmedF2) {
    const second = clone(run.entry);
    second.id = 'F2';
    run.writeEntry('F2', second);
    expect(run.run('check-entry', 'F2').status).toBe(0);
    confirmChecked(run, 'F2');
  }
  return run;
}

/** Every file a citation of the map or an entry names. */
function citedFiles(run) {
  const files = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') {
      if (typeof value.file === 'string' && typeof value.passage === 'string') files.add(value.file);
      Object.values(value).forEach(walk);
    }
  };
  walk(run.readJson('map.json'));
  for (const name of readdirSync(join(run.out, 'entries'))) walk(run.readJson(join('entries', name)));
  return [...files];
}

describe('assemble and page write the views that --views selects', () => {
  it('without --views: handbook.md and a page with the product view only, no technical file and no technical data', () => {
    const run = viewsRun();
    const result = assemble(run);
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual([join(run.out, 'handbook.md')]);
    expect(existsSync(join(run.out, 'handbook-technical.md'))).toBe(false);
    expect(page(run).status).toBe(0);
    const data = dataOf(run);
    expect(data.views).toEqual(['product']);
    expect(Object.hasOwn(data, 'technical')).toBe(false);
  });

  it('with product,technical: both handbook files, in the fixed order, and a page that holds both views and the technical data', () => {
    const run = viewsRun();
    const result = assemble(run, 'technical,product');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual([join(run.out, 'handbook.md'), join(run.out, 'handbook-technical.md')]);
    expect(text(run, 'handbook.md').startsWith('# Product handbook\n')).toBe(true);
    expect(text(run, 'handbook-technical.md').startsWith('# Product handbook: technical view\n')).toBe(true);
    expect(page(run, 'product,technical').status).toBe(0);
    const data = dataOf(run);
    expect(data.views).toEqual(['product', 'technical']);
    expect(Object.keys(data)).toEqual(['format', 'project', 'language', 'languageTag', 'ui', 'views', 'areas', 'domains', 'domainBasis', 'features', 'coverage', 'summary', 'system', 'entities', 'technical']);
    expect(Object.keys(data.technical)).toEqual(['featureApplication', 'unattributed', 'applicationDomain', 'integrations', 'jobs', 'locations', 'data', 'dataState', 'dictionaries', 'dictionariesState']);
  });

  it('technical only: the technical file alone, and the product file an earlier run left is removed', () => {
    const run = viewsRun();
    assemble(run, 'product,technical');
    expect(existsSync(join(run.out, 'handbook.md'))).toBe(true);
    const result = assemble(run, 'technical');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual([join(run.out, 'handbook-technical.md')]);
    expect(existsSync(join(run.out, 'handbook.md'))).toBe(false);
  });

  it('product only after both: the technical file is removed, so no stale content is left', () => {
    const run = viewsRun();
    assemble(run, 'product,technical');
    expect(existsSync(join(run.out, 'handbook-technical.md'))).toBe(true);
    expect(assemble(run, 'product').status).toBe(0);
    expect(existsSync(join(run.out, 'handbook-technical.md'))).toBe(false);
    expect(existsSync(join(run.out, 'handbook.md'))).toBe(true);
  });

  it('a refused run removes nothing: the other view\'s file stays when the checks fail', () => {
    const run = viewsRun();
    assemble(run, 'product,technical');
    const map = clone(run.map);
    map.features[2].candidates = [];
    run.writeMap(map);
    expect(assemble(run, 'product').status).toBe(1);
    expect(existsSync(join(run.out, 'handbook-technical.md'))).toBe(true);
  });

  it('reply names the file of each selected view, and refuses when one is missing', () => {
    const run = viewsRun();
    assemble(run, 'product,technical');
    const both = run.run('reply', '--views', 'product,technical');
    expect(both.status, both.stdout).toBe(0);
    expect(both.lines.slice(0, 2)).toEqual([`Handbook: ${join(run.out, 'handbook.md')}`, `Technical handbook: ${join(run.out, 'handbook-technical.md')}`]);
    const technicalOnly = run.run('reply', '--views', 'technical');
    expect(technicalOnly.lines[0]).toBe(`Technical handbook: ${join(run.out, 'handbook-technical.md')}`);
    expect(technicalOnly.lines[1]).toMatch(/^Page: /);
    assemble(run, 'product');
    const missing = run.run('reply', '--views', 'product,technical');
    expect(missing.status).toBe(1);
    expect(missing.lines).toEqual(['handbook-technical.md: missing', 'Next: run assemble, then this command again']);
    expect(run.run('reply').status).toBe(0);
  });
});

describe('the product view holds no citation path', () => {
  it('handbook.md and the product part of the page data name none of the cited files; the technical outputs do (the scan sees them)', () => {
    const run = viewsRun();
    expect(assemble(run, 'product,technical').status).toBe(0);
    expect(page(run, 'product,technical').status).toBe(0);
    const files = citedFiles(run);
    expect(files.length).toBeGreaterThan(4);
    const { technical, ...productPart } = dataOf(run);
    const product = [text(run, 'handbook.md'), JSON.stringify(productPart)];
    for (const file of files) for (const body of product) expect(body.includes(file), file).toBe(false);
    const technicalBodies = [text(run, 'handbook-technical.md'), JSON.stringify(technical)];
    for (const body of technicalBodies) expect(files.filter((file) => body.includes(file)).length).toBeGreaterThan(3);
  });

  it('a page with only the product view has no cited file anywhere in its data', () => {
    const run = viewsRun();
    expect(page(run).status).toBe(0);
    const body = JSON.stringify(dataOf(run));
    for (const file of citedFiles(run)) expect(body.includes(file), file).toBe(false);
  });
});

describe('the technical view shows the file and lines of each cited item', () => {
  /** The 1-based line of a one-line passage, counted by hand in the file. */
  const lineOf = (run, file, passage) => readFileSync(join(run.root, file), 'utf-8').split('\n').findIndex((line) => line.includes(passage)) + 1;

  it('lists every citation of the F1 entry with the line its passage is on, in handbook-technical.md', () => {
    const run = viewsRun();
    assemble(run, 'technical');
    const body = text(run, 'handbook-technical.md');
    const section = sectionOf(body, '#### Source locations', '## ');
    const cited = [];
    const walk = (value) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === 'object') {
        if (typeof value.file === 'string' && typeof value.passage === 'string') cited.push(value);
        Object.values(value).forEach(walk);
      }
    };
    walk(run.entry);
    expect(cited.length).toBeGreaterThan(8);
    for (const citation of cited) expect(section, citation.passage).toContain(`${citation.file}, line ${lineOf(run, citation.file, citation.passage)}`);
    expect(section).toContain(`Purpose > Staff place new orders for customers.: ${FORM}, line 3`);
  });

  it('puts the same positions in the page data, and the system overview\'s own', () => {
    const run = viewsRun();
    page(run, 'technical');
    const { locations } = dataOf(run).technical;
    expect(locations.map((unit) => unit.id)).toEqual(['F1', 'overview']);
    const purpose = locations[0].items.find((item) => item.claim.startsWith('Purpose >'));
    expect(purpose.citations).toEqual([{ file: FORM, startLine: 3, endLine: 3 }]);
    expect(locations[1].items.length).toBeGreaterThan(2);
    assemble(run, 'technical');
    expect(sectionOf(text(run, 'handbook-technical.md'), '### Source locations of the system overview', '## ')).toContain('package.json, line');
  });

  it('the product file has no source locations section', () => {
    const run = viewsRun();
    assemble(run, 'product,technical');
    expect(text(run, 'handbook.md')).not.toContain('Source locations');
    expect(text(run, 'handbook-technical.md')).toContain('#### Source locations');
  });
});

describe('entity sections and matrices', () => {
  it('both views have the domains, the roles and the roles-by-feature matrix between the tables and the coverage section', () => {
    const run = viewsRun();
    assemble(run, 'product,technical');
    for (const name of ['handbook.md', 'handbook-technical.md']) {
      const body = text(run, name);
      const at = (heading) => body.indexOf(heading);
      expect(at('## All scheduled jobs'), name).toBeGreaterThan(0);
      expect(at('## Domains'), name).toBeGreaterThan(at('## All scheduled jobs'));
      expect(at('## Roles\n'), name).toBeGreaterThan(at('## Domains'));
      expect(at('## Roles by feature'), name).toBeGreaterThan(at('## Roles\n'));
      expect(at('## Coverage'), name).toBeGreaterThan(at('## Roles by feature'));
    }
  });

  it('writes the domain, the role and the matrix cell from the verified entry only: F2 is confirmed, so it is not there', () => {
    const run = viewsRun();
    assemble(run, 'product');
    const body = text(run, 'handbook.md');
    const domains = sectionOf(body, '## Domains', '## Roles\n');
    expect(domains).toContain('### Order handling');
    expect(domains).toContain('Features: 2. Features with a verified entry: 1.');
    expect(domains).toContain('- F1 Orders: Staff place new orders for customers.');
    expect(domains).not.toContain('F2 Archive:');
    const roles = sectionOf(body, '## Roles\n', '## Roles by feature');
    expect(roles).toContain('### Clerk\n\n- F1 Orders: Create an order.');
    expect(roles).toContain('### Approver\n\nNone.');
    const matrix = sectionOf(body, '## Roles by feature', '## Coverage');
    expect(matrix).toContain('| Role | F1 Orders |');
    expect(matrix).toContain('| Clerk | Create an order. |');
    expect(matrix).toContain('| Approver |  |');
    expect(matrix).not.toContain('F2 Archive');
  });

  it('the product file has neither the application sections nor the application matrix; the technical file has all three', () => {
    const run = viewsRun();
    assemble(run, 'product,technical');
    const product = text(run, 'handbook.md');
    for (const heading of ['## Applications in detail', '## External systems in detail', '## Applications by domain']) expect(product).not.toContain(heading);
    const technical = text(run, 'handbook-technical.md');
    for (const heading of ['## Applications in detail', '## External systems in detail', '## Applications by domain']) expect(technical).toContain(heading);
  });

  it('the relations name what was checked: quoted passages that fall in an application, and a name that appears in the source', () => {
    const run = viewsRun();
    assemble(run, 'technical');
    const body = text(run, 'handbook-technical.md');
    expect(body).toContain('#### Features whose quoted passages fall in this application');
    expect(body).toContain('#### External systems whose name appears in the source of this application');
    expect(body).toContain('Called by, in the quoted code');
    // The notes say what the relation is not; no heading claims more than was checked.
    const headings = body.split('\n').filter((line) => line.startsWith('#'));
    expect(headings.length).toBeGreaterThan(20);
    expect(headings.join('\n')).not.toMatch(/implement|calls|permission/i);
    expect(body).toContain('This does not say that the application implements the feature.');
  });

  it('the applications section: F1\'s passages by application (longest match), and no citation of the confirmed F2', () => {
    const run = viewsRun();
    assemble(run, 'technical');
    const body = text(run, 'handbook-technical.md');
    const root = sectionOf(body, '### .\n', '### svc2');
    expect(root).toContain('| F1 Orders |');
    expect(root).not.toContain('F2 Archive');
    const second = sectionOf(body, '### svc2', '### Quoted passages in no application');
    expect(second).toContain('None.');
  });

  it('keeps the callers the quoted code shows apart from the applications whose source holds the name: the model listed the first only', () => {
    const run = viewsRun();
    assemble(run, 'technical');
    const slack = sectionOf(text(run, 'handbook-technical.md'), '### Slack', '## Applications by domain');
    expect(sectionOf(slack, '#### Called by, in the quoted code', '#### Applications whose source contains the name')).toContain('- .');
    expect(sectionOf(slack, '#### Called by, in the quoted code', '#### Applications whose source contains the name')).not.toContain('svc2');
    const named = sectionOf(slack, '#### Applications whose source contains the name', 'Source files outside');
    expect(named).toContain('- . (1 files)');
    expect(named).toContain('- svc2 (1 files)');
    expect(slack).toContain('Source files outside every listed application that contain the name: 0.');
  });

  it('puts the same relations in the page data, in the technical part only', () => {
    const run = viewsRun();
    page(run, 'product,technical');
    const data = dataOf(run);
    const [slack] = data.technical.integrations;
    expect(slack).toEqual({ system: 'Slack', use: 'Reminders go to a team channel.', shown: ['.'], named: [{ application: '.', files: 1 }, { application: 'svc2', files: 1 }], namedOutside: 0 });
    expect(data.technical.featureApplication.map((row) => row.feature)).toEqual(['F1']);
    expect(data.entities.roleFeature.features).toEqual(['F1']);
    expect(data.entities.domains[0].purposes).toEqual([{ feature: 'F1', text: 'Staff place new orders for customers.' }]);
    expect(Object.keys(data.entities)).toEqual(['domains', 'roles', 'roleFeature']);
  });

  it('a confirmed feature puts nothing in any relation, in the page data or in the matrices', () => {
    const run = viewsRun();
    page(run, 'technical');
    const { technical, entities } = dataOf(run);
    const body = JSON.stringify({ featureApplication: technical.featureApplication, unattributed: technical.unattributed, roleFeature: entities.roleFeature, purposes: entities.domains.map((domain) => domain.purposes) });
    expect(body).not.toContain('"F2"');
    expect(technical.locations.map((unit) => unit.id)).not.toContain('F2');
    expect(technical.applicationDomain.cells.every((cell) => cell.domain === 'A1')).toBe(true);
  });

  it('without a verified overview every application root is still an application, named as not verified, and there is no external system', () => {
    const run = viewsRun({ confirmedF2: false });
    run.run('mark', 'overview', 'failed', 'lane', 'wrote-nothing');
    assemble(run, 'technical');
    const body = text(run, 'handbook-technical.md');
    const apps = sectionOf(body, '## Applications in detail', '## External systems in detail');
    expect(apps).toContain('### .\n\n- Not verified\n- Languages');
    expect(sectionOf(body, '## External systems in detail', '## Applications by domain')).toContain('None.');
  });
});

describe('every output is the same bytes on a second run', () => {
  it('assemble for both views, and the page with both views', () => {
    const run = viewsRun();
    assemble(run, 'product,technical');
    page(run, 'product,technical');
    const first = ['handbook.md', 'handbook-technical.md', 'handbook.html'].map((name) => readFileSync(join(run.out, name)));
    assemble(run, 'product,technical');
    page(run, 'product,technical');
    const second = ['handbook.md', 'handbook-technical.md', 'handbook.html'].map((name) => readFileSync(join(run.out, name)));
    first.forEach((bytes, at) => expect(second[at].equals(bytes)).toBe(true));
  });

  it('from another copy of the same input at other paths', () => {
    const a = viewsRun();
    const b = viewsRun();
    expect(a.root).not.toBe(b.root);
    for (const run of [a, b]) {
      assemble(run, 'product,technical');
      page(run, 'product,technical');
    }
    for (const name of ['handbook.md', 'handbook-technical.md', 'handbook.html']) expect(readFileSync(join(b.out, name)).equals(readFileSync(join(a.out, name))), name).toBe(true);
  });
});
