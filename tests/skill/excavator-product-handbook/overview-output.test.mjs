// O1 (output) of openspec change handbook-system-overview: handbook.md opens
// with the system overview before the areas and features; an overview that is
// not verified is said to be unwritten and where it stopped, with the area
// table that does not depend on it; removed overview items are listed in the
// coverage section; the page data and the reply carry the overview.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MARK, SHIPPED_UI, judge, makeCheckedMapRun, markedMap, runHandbook, set, traceFeature, translatedUi, verifyChecked } from './helpers.mjs';
import { NOTIFY_FILE, NOTIFY_LINE, checkedOverviewRun, goodOverview, overviewRun } from './overview-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const shipped = () => JSON.parse(readFileSync(SHIPPED_UI, 'utf-8'));
const assemble = (run) => {
  const result = run.run('assemble');
  expect(result.status, result.stdout).toBe(0);
  return readFileSync(join(run.out, 'handbook.md'), 'utf-8');
};
const page = (run) => runHandbook(['page', run.out, '--project', run.root], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
const dataOf = (run) => JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(readFileSync(join(run.out, 'handbook.html'), 'utf-8'))[1]);
const sectionOf = (text, heading, next) => text.slice(text.indexOf(heading), next === undefined ? undefined : text.indexOf(next, text.indexOf(heading) + 1));

function verifiedOverviewRun(adjust) {
  const run = checkedOverviewRun(cleanups, adjust);
  verifyChecked(run, 'overview');
  return run;
}

describe('the fixed texts of the overview', () => {
  const KEYS = [
    'md.overview.heading', 'md.overview.counts', 'md.overview.countsWithDomains', 'md.overview.notWritten', 'md.overview.audiencesHeading', 'md.overview.applicationsHeading',
    'md.overview.integrationsHeading', 'md.overview.areasHeading', 'md.overview.noHistory', 'md.overview.notVerified', 'md.overview.languageItem', 'md.overview.frameworkItem',
    'md.overview.application.item', 'md.coverage.removedOverview', 'md.table.who', 'md.table.directory', 'md.table.name', 'md.table.languages',
    'md.table.frameworks', 'md.table.files', 'md.table.lines', 'md.table.firstCommit', 'md.table.lastCommit', 'md.table.commits', 'md.table.authors',
    'md.table.system', 'md.table.use', 'md.table.callers', 'md.table.area', 'md.table.verified', 'md.table.roles',
  ];

  it('the English table holds every new key with a non-empty ASCII value', () => {
    const { strings } = shipped();
    for (const key of KEYS) {
      expect(Object.hasOwn(strings, key), key).toBe(true);
      expect(strings[key].trim(), key).not.toBe('');
      expect(/^[\x20-\x7E]*$/.test(strings[key]), key).toBe(true);
    }
  });

  it('a ui.json without one of them is refused by assemble and page, and nothing is written', () => {
    const run = verifiedOverviewRun();
    const table = shipped();
    delete table.strings['md.overview.heading'];
    run.writeJson(join(run.out, 'ui.json'), table);
    for (const result of [run.run('assemble'), page(run)]) {
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('ui.json: missing key "md.overview.heading"');
    }
  });
});

describe('handbook.md opens with the system overview', () => {
  it('has the system overview as its first section, before the areas and features', () => {
    const text = assemble(verifiedOverviewRun());
    const headings = text.split('\n').filter((line) => /^## /.test(line));
    expect(headings[0]).toBe('## System overview');
    expect(headings[1]).toBe('## Areas and features');
    expect(text.indexOf('## System overview')).toBeLessThan(text.indexOf('## Areas and features'));
  });

  it('writes the count line, the purpose, the users, the applications, the external systems, the unknowns and the areas, in that order', () => {
    const run = verifiedOverviewRun();
    const text = assemble(run);
    const section = sectionOf(text, '## System overview', '## Areas and features');
    const order = ['### Purpose', '### Who uses it', '### Applications', '### External systems', '### What the code does not settle', '### Areas and roles'];
    const at = order.map((heading) => section.indexOf(heading));
    expect(at.every((index) => index > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(section.indexOf('Applications: 1. Source files:')).toBeGreaterThan(0);
    expect(section.indexOf('Applications: 1. Source files:')).toBeLessThan(at[0]);
    expect(section).toContain('Areas: 2. Features: 5. Features with a verified entry: 0. Roles: 2.');
    expect(section).toContain('Staff place and review orders for customers.');
    expect(section).toContain('| Who | What it does |\n| --- | --- |\n| Clerk | Creates orders. |');
    expect(section).toContain('| Directory | Name | What it does | Languages | Frameworks | Source files | Lines | First commit | Last commit | Commits | Authors |');
    expect(section).toContain('| External system | What it is used for | Called by, in the quoted code |\n| --- | --- | --- |\n| Slack | Reminders go to a team channel. | . |');
    expect(section).toContain('- Whether other tools call it (searched: the routes and the jobs)');
    expect(section).toContain('| Area | Features | Verified entries | Roles |\n| --- | --- | --- | --- |\n| Order handling | 2 | 0 | - |\n| Automatic work | 3 | 0 | - |');
  });

  it('is the same bytes on a second assemble, with no run time and no project path', () => {
    const run = verifiedOverviewRun();
    const first = assemble(run);
    expect(assemble(run)).toBe(first);
    expect(first).not.toContain(run.root);
    expect(first).not.toContain(run.out);
    expect(first).not.toContain('evidence');
  });

  it('shows none for a part that was removed from a verified overview, and keeps the rest', () => {
    const run = checkedOverviewRun(cleanups);
    expect(judge(run, 'overview', 1, (item) => (item.id === 'integrations[0]' ? 'contradicted' : 'verified')).status).toBe(0);
    expect(traceFeature(run, 'overview').status).toBe(0);
    const section = sectionOf(assemble(run), '### External systems', '### What the code does not settle');
    expect(section).toContain('None.');
    expect(section).not.toContain('Slack');
  });
});

describe('an overview that is not verified', () => {
  const stopped = [
    ['not written at all', (run) => run, 'Not written'],
    ['written but not checked', (run) => { run.run('mark', 'overview', 'dispatched'); return run; }, 'Written but not checked'],
    ['checked, verification not finished', (run) => { expect(run.run('check-overview').status).toBe(0); return run; }, 'Written, verification not finished'],
    ['confirmed, the trace not finished', (run) => { run.run('check-overview'); expect(judge(run, 'overview').status).toBe(0); return run; }, 'Written, final check not finished'],
  ];
  for (const [name, prepare, step] of stopped) {
    it(`says so and where it stopped (${name}), writes the area table and nothing of the overview`, () => {
      const run = prepare(overviewRun(cleanups));
      const text = assemble(run);
      const section = sectionOf(text, '## System overview', '## Areas and features');
      expect(section).toContain(`The system overview is not in this handbook. Where it stopped: ${step}.`);
      expect(section).toContain('| Area | Features | Verified entries | Roles |');
      expect(section).not.toContain('Staff place and review orders for customers.');
      expect(section).not.toContain('### Purpose');
      expect(section).not.toContain('### Who uses it');
      expect(section).not.toContain('### External systems');
      // The facts of the script do not depend on the overview: counts, the application row and the area table stay.
      expect(section).toContain('Applications: 1. Source files: ');
      expect(section).toMatch(/\| \. \| Not verified \| Not verified \| JavaScript \(9\) \|/);
      expect(text).not.toContain('Slack');
    });
  }

  it('says it was written to no entry file when the run has no overview key at all (an older output directory)', () => {
    const run = overviewRun(cleanups);
    expect(Object.hasOwn(run.readJson('state.json'), 'overview')).toBe(false);
    expect(assemble(run)).toContain('Where it stopped: Not written.');
  });

  it('page data: no overview, but the application rows, the counts and the area table', () => {
    const run = overviewRun(cleanups);
    expect(page(run).status).toBe(0);
    const { system } = dataOf(run);
    expect(system.status).toBe('planned');
    expect(system.overview).toBeNull();
    expect(system.counts).toMatchObject({ applications: 1, areas: 2, features: 5, featuresWithEntry: 0, roles: 2 });
    expect(system.applications.map((row) => [row.dir, row.name, row.does])).toEqual([['.', null, null]]);
    expect(system.areas.map((area) => area.id)).toEqual(['A1', 'A2']);
  });
});

describe('the coverage section lists the removed overview items', () => {
  function removedRun() {
    const run = checkedOverviewRun(cleanups);
    const bad = { 'audiences[0]': { verdict: 'unverified', reason: 'No line shown names who uses it.' } };
    expect(judge(run, 'overview', 1, (item) => (item.id === 'applications[0]' ? { verdict: 'contradicted', reason: 'The code shown names another tool.' } : bad[item.id] ?? 'verified')).status).toBe(0);
    const round2 = judge(run, 'overview', 2, () => ({ verdict: 'unverified', reason: 'No line shown names who uses it.' }));
    expect(round2.status, round2.stdout).toBe(0);
    const traced = traceFeature(run, 'overview', () => 'holds', () => {}, (item) => (item.id === 'integrations[0]'
      ? { verdict: 'contradicted', reason: 'Another function sends it to a different channel.', at: [{ file: 'src/roles.js', line: 1 }] }
      : 'holds'));
    expect(traced.lines).toEqual(['overview: verified, 1 item removed']);
    return run;
  }

  it('names the system overview as the unit, with each removed claim, result and reason, before the features', () => {
    const run = removedRun();
    const text = assemble(run);
    const section = sectionOf(text, '### Items removed because the code did not back them up');
    expect(section).toContain('#### System overview: items removed: 3');
    expect(section).toContain('| Application . (Order tool) > Serves the order pages and sends reminders. | The code shown says otherwise | The code shown names another tool. |');
    expect(section).toContain('| Who: Clerk; What it does: Creates orders. | The code shown does not settle it | No line shown names who uses it. |');
    expect(section).toContain('| External system: Slack; What it is used for: Reminders go to a team channel.; Called by, in the quoted code: . | The code shown says otherwise | Another function sends it to a different channel. |');
    // The removed items are gone from the body.
    expect(sectionOf(text, '## System overview', '## Areas and features')).not.toContain('Order tool');
    expect(sectionOf(text, '## System overview', '## Areas and features')).not.toContain('Slack');
  });

  it('puts the same group in the page data, with the claims and reasons and no citation path', () => {
    const run = removedRun();
    expect(page(run).status).toBe(0);
    const data = dataOf(run);
    expect(data.coverage.removedOverview.map((item) => [item.verdict, item.reason])).toEqual([
      ['contradicted', 'The code shown names another tool.'],
      ['unverified', 'No line shown names who uses it.'],
      ['contradicted', 'Another function sends it to a different channel.'],
    ]);
    expect(JSON.stringify(data)).not.toContain('src/notify.js');
    expect(data.system.overview.applications).toBeUndefined();
    // The application item was removed: its root keeps the row, with the script facts and no name.
    expect(data.system.applications.map((row) => [row.dir, row.name, row.does])).toEqual([['.', null, null]]);
    expect(data.system.applications[0].files).toBeGreaterThan(0);
    expect(data.system.counts.applications).toBe(1);
  });

  it('lists nothing for an overview that lost no item', () => {
    const run = verifiedOverviewRun();
    expect(assemble(run)).not.toContain('items removed:');
    expect(page(run).status).toBe(0);
    expect(dataOf(run).coverage.removedOverview).toEqual([]);
  });
});

describe('page data: the overview', () => {
  it('has the format 6 and carries the text of the verified overview, the application facts and the counts, without evidence', () => {
    const run = verifiedOverviewRun();
    expect(page(run).status).toBe(0);
    const data = dataOf(run);
    expect(data.format).toBe('excavator-product-handbook-page/9');
    expect(Object.keys(data)).toEqual(['format', 'project', 'language', 'languageTag', 'ui', 'views', 'areas', 'domains', 'domainBasis', 'features', 'findings', 'coverage', 'summary', 'system', 'entities']);
    expect(data.system.status).toBe('verified');
    expect(data.project).toBe('handbook-fixture');
    expect(data.system.overview).toEqual({
      name: 'handbook-fixture',
      summary: ['Staff place and review orders for customers.'],
      audiences: [{ who: 'Clerk', does: 'Creates orders.' }],
      integrations: [{ system: 'Slack', use: 'Reminders go to a team channel.', callers: ['.'] }],
      unknowns: [{ item: 'Whether other tools call it', searched: 'the routes and the jobs' }],
    });
    expect(Object.keys(data.system.applications[0])).toEqual(['dir', 'name', 'does', 'languages', 'frameworks', 'files', 'lines', 'history']);
    expect(data.system.counts.applications).toBe(1);
    expect(JSON.stringify(data.system)).not.toContain('evidence');
    expect(JSON.stringify(data.system)).not.toContain('passage');
  });
});

describe('reply: the overview state', () => {
  it('prints the overview status after the feature counts, and lists a failed overview among the failed', () => {
    const run = verifiedOverviewRun();
    expect(run.run('assemble').status).toBe(0);
    expect(run.run('reply').lines.slice(2, 4)).toEqual([
      'Features: 5 (planned 5, dispatched 0, checked 0, confirmed 0, verified 0, failed 0)',
      'Overview: verified',
    ]);
    const failed = overviewRun(cleanups);
    failed.run('mark', 'overview', 'failed', 'lane', 'wrote-nothing');
    expect(failed.run('assemble').status).toBe(0);
    const lines = failed.run('reply').lines;
    expect(lines[3]).toBe('Overview: failed');
    expect(lines[4]).toBe('Failed: overview');
  });

  it('says planned for an output directory that has no overview key, and counts features as before', () => {
    const run = overviewRun(cleanups);
    run.run('assemble');
    const lines = run.run('reply').lines;
    expect(lines[3]).toBe('Overview: planned');
    expect(lines).toHaveLength(5);
    expect(lines.some((line) => line.startsWith('Failed:'))).toBe(false);
  });
});

describe('a translated run', () => {
  const MARKED = ['summary.0.text', 'audiences.0.who', 'audiences.0.does', 'applications.0.name', 'applications.0.does', 'integrations.0.use', 'unknowns.0.item', 'unknowns.0.searched'];

  /** A run in a language with its own script: the fixed text first, then the map and the overview. */
  function translatedRun(markOverview = true) {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    run.writeJson(join(run.out, 'ui.json'), translatedUi('Chinese'));
    run.writeMap(markedMap(run.map));
    expect(run.run('check-map').status).toBe(0);
    writeFileSync(join(run.root, NOTIFY_FILE), `${NOTIFY_LINE}\n`);
    const doc = goodOverview();
    if (markOverview) for (const path of MARKED) set(doc, path, `${MARK}${path.split('.').reduce((value, key) => value[key], doc)}`);
    run.writeJson(join(run.out, 'entries', 'overview.json'), doc);
    return run;
  }

  it('refuses a narrative text written only in ASCII letters, and names its place', () => {
    const run = translatedRun(false);
    const result = run.run('try-overview');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^summary\[0\]\.text: written only in ASCII letters/m);
    expect(result.stdout).toMatch(/^audiences\[0\]\.does: written only in ASCII letters/m);
    expect(result.stdout).not.toMatch(/integrations\[0\]\.system/);
  });

  it('writes the overview headings, table headers and the not-written line from ui.json, with the narrative as the model wrote it', () => {
    const run = translatedRun();
    expect(run.run('check-overview').status).toBe(0);
    verifyChecked(run, 'overview');
    const text = assemble(run);
    const section = sectionOf(text, `## ${MARK}System overview`, `## ${MARK}Areas and features`);
    expect(section).toContain(`### ${MARK}Who uses it`);
    expect(section).toContain(`| ${MARK}Who | ${MARK}What it does |`);
    expect(section).toContain(`${MARK}Staff place and review orders for customers.`);
    expect(section).toContain(`| ${MARK}External system | ${MARK}What it is used for | ${MARK}Called by, in the quoted code |`);
    // Not written: the not-written line is the translated text too.
    const second = translatedRun();
    expect(assemble(second)).toContain(`${MARK}The system overview is not in this handbook. Where it stopped: ${MARK}Not written.`);
  });
});
