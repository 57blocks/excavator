// Oracle O1 (output half) of openspec change handbook-summary-tables:
// handbook.md carries the notification table and the scheduled-job table,
// from fixed texts only, byte for byte the same on a second run, with no
// citation path and no project path. (The page half is summary-page.test.mjs.)
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderHandbook } from '../../../skills/excavator-product-handbook/lib/render.mjs';
import { SHIPPED_UI, makeCheckedMapRun, markedEntry, markedMap, runHandbook, translatedUi, MARK, verifyChecked } from './helpers.mjs';
import { FORM, JOB_FILE, entries, verifiedRun as makeVerifiedRun } from './summary-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const NEW_KEYS = [
  'md.summary.notifications.heading', 'md.summary.notifications.counts', 'md.summary.notifications.note', 'md.summary.notifications.none',
  'md.summary.jobs.heading', 'md.summary.jobs.counts', 'md.summary.jobs.note', 'md.summary.jobs.none',
  'md.summary.feature', 'md.summary.unassigned', 'md.summary.schedule.computed', 'md.summary.schedule.absent', 'md.summary.noDescription',
  'md.table.schedule', 'md.table.does', 'page.nav.notifications', 'page.nav.jobs',
];

const assemble = (run) => {
  const result = run.run('assemble');
  expect(result.status, result.stdout).toBe(0);
  return readFileSync(join(run.out, 'handbook.md'), 'utf-8');
};
const page = (run) => runHandbook(['page', run.out, '--project', run.root], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
const verifiedRun = (options) => makeVerifiedRun(cleanups, options);
const shipped = () => JSON.parse(readFileSync(SHIPPED_UI, 'utf-8'));

describe('the fixed texts of the two tables', () => {
  it('the English table holds every new key with a non-empty ASCII value', () => {
    const { strings } = shipped();
    for (const key of NEW_KEYS) {
      expect(Object.hasOwn(strings, key), key).toBe(true);
      expect(strings[key].trim(), key).not.toBe('');
    }
  });

  it('a ui.json without one of the new keys is refused by assemble and by page, and nothing is written', () => {
    const run = verifiedRun();
    const table = shipped();
    delete table.strings['md.summary.jobs.heading'];
    run.writeJson(join(run.out, 'ui.json'), table);
    for (const result of [run.run('assemble'), page(run)]) {
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('ui.json: missing key "md.summary.jobs.heading"');
    }
    expect(existsSync(join(run.out, 'handbook.md'))).toBe(false);
    expect(existsSync(join(run.out, 'handbook.html'))).toBe(false);
  });
});

describe('handbook.md: the two tables', () => {
  it('comes after the feature chapters and before the coverage section, notifications first', () => {
    const text = assemble(verifiedRun());
    const at = (heading) => text.indexOf(heading);
    expect(at('### Orders')).toBeGreaterThan(-1);
    expect(at('## All notifications')).toBeGreaterThan(at('#### Undetermined from the code'));
    expect(at('## All scheduled jobs')).toBeGreaterThan(at('## All notifications'));
    expect(at('## Coverage')).toBeGreaterThan(at('## All scheduled jobs'));
  });

  it('writes the notification table with its count sentence and fixed note', () => {
    const text = assemble(verifiedRun());
    const section = text.slice(text.indexOf('## All notifications'), text.indexOf('## All scheduled jobs'));
    expect(section).toContain('Features with a verified entry: 2 of 5. Notifications listed: 1.');
    expect(section).toContain('see the coverage section');
    expect(section).toContain('Rows are not merged and channel names are not unified.');
    expect(section).toContain('| Feature | Trigger | Recipient | Channel | Content |');
    expect(section).toContain('| F1 Orders | An order is sent | The approver | Message | A new order waits for approval. |');
  });

  it('counts only verified features: a feature that is only checked is not counted and its notifications are not listed', () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    const written = entries(run);
    run.writeEntry('F1', written.F1);
    expect(run.run('check-entry', 'F1').status).toBe(0);
    const text = assemble(run);
    expect(text).toContain('Features with a verified entry: 0 of 5. Notifications listed: 0.');
    expect(text).not.toContain('A new order waits for approval.');
    expect(text).toContain('No verified entry has a notification.');
  });

  it('writes the job table: one row per job candidate, the schedule as the line gives it, the description of the item that cites the line', () => {
    const run = verifiedRun();
    const text = assemble(run);
    const section = text.slice(text.indexOf('## All scheduled jobs'), text.indexOf('## Coverage'));
    const total = run.candidates.items.filter((item) => item.kind === 'job').length;
    expect(total).toBe(1);
    expect(section).toContain('Scheduled jobs listed: 1. Schedule written on the registration line: 1. Schedule worked out when the job is registered: 0. Schedule not in the text of the registration line: 0. Rows with a verified description: 1.');
    expect(section).toContain('Not in this table: the time zone');
    expect(section).toContain('| Candidate | Feature | Schedule in the code | What it does |');
    expect(section).toContain(`| ${run.idOf(JOB_FILE, 4)} | F3 Reminders | \`0 9 * * *\` | Every day at nine: A reminder goes out. |`);
    expect(section.match(/^\| c\d+ /gm)).toHaveLength(total);
  });

  it('writes "no verified description" for a job whose feature has no verified entry, and still lists the row', () => {
    const run = verifiedRun({ withJob: false });
    const text = assemble(run);
    expect(text).toContain(`| ${run.idOf(JOB_FILE, 4)} | F3 Reminders | \`0 9 * * *\` | No verified description |`);
    expect(text).toContain('Rows with a verified description: 0.');
    expect(text).not.toContain('A reminder goes out.');
  });

  it('gives identical bytes on two assemble runs and holds no citation path, candidate file or project path in the tables', () => {
    const run = verifiedRun();
    const first = assemble(run);
    expect(assemble(run)).toBe(first);
    const tables = first.slice(first.indexOf('## All notifications'), first.indexOf('## Coverage'));
    for (const file of [FORM, JOB_FILE, 'src/menu.js', ...run.candidates.items.map((item) => item.file)]) expect(tables).not.toContain(file);
    expect(tables).not.toContain(run.root);
    expect(tables).not.toContain(run.out);
  });
});

describe('handbook.md: the tables from fixed texts, in a translated run', () => {
  it('writes the headings, the table headers and the count sentences from ui.json', () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    // A run in a language with its own script: the fixed text first, then the map and the entry are checked against it.
    const table = translatedUi('Chinese');
    run.writeJson(join(run.out, 'ui.json'), table);
    expect(runHandbook(['check-ui', run.out]).status).toBe(0);
    run.writeMap(markedMap(run.map));
    expect(run.run('check-map').status).toBe(0);
    const entry = markedEntry(entries(run).F1);
    run.writeEntry('F1', entry);
    expect(run.run('check-entry', 'F1').status).toBe(0);
    verifyChecked(run);
    const text = assemble(run);
    for (const key of ['md.summary.notifications.heading', 'md.summary.jobs.heading']) expect(text).toContain(`## ${MARK}${shipped().strings[key]}`);
    expect(text).toContain(`${MARK}Features with a verified entry: {verified}`.replace('{verified}', '1'));
    for (const english of ['All notifications', 'All scheduled jobs']) expect(text.replace(new RegExp(`${MARK}${english}`, 'g'), '')).not.toContain(english);
    expect(text).toContain(`| ${MARK}Feature | ${MARK}Trigger | ${MARK}Recipient | ${MARK}Channel | ${MARK}Content |`);
    expect(text).toContain(`| ${MARK}Candidate | ${MARK}Feature | ${MARK}Schedule in the code | ${MARK}What it does |`);
    // F3 has no verified entry in this run: its job row says so with the fixed text.
    expect(text).toContain(`${MARK}No verified description`);
  });
});

describe('renderHandbook: the states the commands cannot easily reach', () => {
  const ui = shipped().strings;
  const base = () => ({
    map: {
      areas: [{ id: 'A1', name: 'Operations' }],
      features: [{ id: 'F1', name: 'Reports', area: 'A1', reach: 'automated', candidates: ['c1'], seedFiles: [] }],
      unassigned: [{ candidate: 'c2', reason: 'A poller that no reader sees.' }],
    },
    entries: new Map(),
    state: { features: { F1: { status: 'planned' } } },
    candidates: [{ id: 'c1', kind: 'job' }, { id: 'c2', kind: 'job' }],
    ui,
    system: { status: 'planned', overview: null, applications: [], counts: { applications: 0, files: 0, lines: 0, areas: 1, features: 1, featuresWithEntry: 0, roles: 0 }, areas: [{ id: 'A1', name: 'Operations', features: 1, verified: 0, roles: [] }], domains: [{ id: 'A1', name: 'Operations', features: 1, verified: 0, roles: [] }] },
    // The entity sections (handbook-entities-and-views) need the entities; this map has one domain and nothing verified.
    entities: {
      domainBasis: 'areas',
      domains: [{ id: 'A1', name: 'Operations', features: ['F1'], purposes: [] }],
      roles: [],
      applications: [],
      integrations: [],
      notifications: [],
      jobs: [],
      relations: { featureApplication: [], unattributed: [] },
      matrices: { roleFeature: { roles: [], features: [], cells: [] }, applicationDomain: { applications: [], domains: ['A1'], cells: [], unattributed: [] } },
    },
  });
  const summary = {
    notifications: [],
    jobs: [
      { kind: 'job', candidate: 'c1', feature: 'F1', reason: null, schedule: { bucket: 'computed', literal: null }, automatic: [] },
      { kind: 'job', candidate: 'c2', feature: null, reason: 'A poller that no reader sees.', schedule: { bucket: 'absent', literal: null }, automatic: [] },
    ],
    counts: { featureTotal: 1, featuresWithEntry: 0, notificationRows: 0, jobRows: 2, schedule: { literal: 0, computed: 1, absent: 1 }, described: 0 },
  };

  it('writes an unassigned row with the map reason, and the computed and absent buckets with their fixed words', () => {
    const text = renderHandbook({ ...base(), summary });
    expect(text).toContain('| c1 | F1 Reports | Worked out when the job is registered | No verified description |');
    expect(text).toContain('| c2 | Unassigned: A poller that no reader sees. | Not in the text of the registration line | No verified description |');
    expect(text).toContain('Scheduled jobs listed: 2. Schedule written on the registration line: 0. Schedule worked out when the job is registered: 1. Schedule not in the text of the registration line: 1. Rows with a verified description: 0.');
  });

  it('writes the fixed text instead of a table when there is no job and no notification, and keeps the count sentences', () => {
    const empty = { notifications: [], jobs: [], counts: { ...summary.counts, jobRows: 0, schedule: { literal: 0, computed: 0, absent: 0 } } };
    const text = renderHandbook({ ...base(), summary: empty });
    expect(text).toContain('No verified entry has a notification.');
    expect(text).toContain('No scheduled job was found.');
    expect(text).toContain('Scheduled jobs listed: 0.');
    expect(text).not.toContain('| Candidate | Feature | Schedule in the code |');
  });

  it('escapes a pipe and a line break in a cell, and joins several descriptions of one row', () => {
    const rich = {
      notifications: [{ feature: 'F1', trigger: 'A | B\nC', recipient: 'R', channel: 'Mail', content: 'Body' }],
      jobs: [{ kind: 'job', candidate: 'c1', feature: 'F1', reason: null, schedule: { bucket: 'literal', literal: '@every 5m' }, automatic: [{ when: 'Often', effect: 'One.' }, { when: 'Always', effect: 'Two.' }] }],
      counts: { ...summary.counts, notificationRows: 1, jobRows: 1, schedule: { literal: 1, computed: 0, absent: 0 }, described: 1 },
    };
    const text = renderHandbook({ ...base(), summary: rich });
    expect(text).toContain('| F1 Reports | A \\| B C | R | Mail | Body |');
    expect(text).toContain('| c1 | F1 Reports | `@every 5m` | Often: One.<br>Always: Two. |');
  });
});
