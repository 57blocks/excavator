// Oracle O1 (summary half) of openspec change handbook-summary-tables: the
// notification table and the scheduled-job table are built from the loaded
// run and the project's source, with no model. The project here is a purpose-
// built synthetic one; the run is written by hand, not by the commands.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { buildSummary } from '../../../skills/excavator-product-handbook/lib/summary.mjs';

const REGISTER = [
  "const schedule = require('node-schedule');",
  "schedule.scheduleJob('nightly-report', '30 * * * * *', runNightlyReport);",
  'schedule.scheduleJob(`${m} ${h} * * *`, runDigest);',
  'schedule.scheduleJob(settings.cleanupSpec, runCleanup);',
  '',
  'function onShipped(order) {',
  '  notifyWarehouse(order);',
  '}',
];
const OTHER = ["schedule.scheduleJob('0 9 * * *', runOther);", "schedule.scheduleJob('0 5 * * *', runOtherToo);"];
const LEGACY = ["cron.AddFunc('@every 5m', poll)"];
const FILES = { 'src/jobs/register.js': REGISTER, 'src/jobs/other.js': OTHER, 'src/jobs/legacy.js': LEGACY, 'src/routes/orders.js': ["router.get('/', list);"] };

let root;
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'xhb-summary-')));
  for (const [path, lines] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `${lines.join('\n')}\n`);
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const cite = (file, passage) => ({ file, passage });
const lineOf = (file, number) => FILES[file][number - 1];
const candidate = (id, kind, file, line) => ({ id, kind, file, line, text: lineOf(file, line).trim() });
const REGISTRATION = cite('src/jobs/register.js', REGISTER[1]);
const DIGEST = cite('src/jobs/register.js', REGISTER[2]);

function item(when, effect, ...evidence) {
  return { when, effect, evidence };
}
const note = (trigger, recipient, channel, content) => ({ trigger, recipient, channel, content, evidence: [REGISTRATION] });
const entryOf = (id, { automatic = [], notifications = [] } = {}) => ({ id, automatic, notifications });

/** The run of the scenarios: four features, five job candidates and one route; F3 is not verified, F5 is unassigned. */
function run({ f1Automatic, f2Automatic = [], verified = ['F1', 'F2', 'F4'] } = {}) {
  const candidates = [
    candidate('c1', 'job', 'src/jobs/register.js', 2),
    candidate('c2', 'job', 'src/jobs/register.js', 3),
    candidate('c3', 'job', 'src/jobs/register.js', 4),
    candidate('c4', 'job', 'src/jobs/other.js', 1),
    candidate('c5', 'job', 'src/jobs/legacy.js', 1),
    candidate('c6', 'route', 'src/routes/orders.js', 1),
  ];
  const feature = (id, name, area, ids) => ({ id, name, area, reach: 'automated', candidates: ids, seedFiles: [] });
  const map = {
    language: 'English',
    areas: [{ id: 'A1', name: 'Operations' }, { id: 'A2', name: 'Billing' }],
    // The features are listed with A2's first: the tables follow the areas, then the features of each area.
    features: [feature('F2', 'Invoices', 'A2', ['c3', 'c6']), feature('F1', 'Reports', 'A1', ['c1', 'c2']), feature('F3', 'Archive', 'A1', ['c4']), feature('F4', 'Payments', 'A2', [])],
    unassigned: [{ candidate: 'c5', reason: 'A poller that no reader sees.' }],
  };
  const entries = new Map();
  const all = {
    F4: entryOf('F4', { notifications: [note('A payment fails', 'The accountant', 'Email', 'The payment failed.')] }),
    F2: entryOf('F2', { automatic: f2Automatic, notifications: [note('An invoice is sent', 'The customer', 'Email', 'Your invoice is ready.'), note('An invoice is late', 'The customer', 'SMS', 'Your invoice is late.')] }),
    F1: entryOf('F1', { automatic: f1Automatic ?? [], notifications: [note('A report is built', 'The manager', 'Email', 'The report is ready.')] }),
    F3: entryOf('F3', { notifications: [note('Archived', 'Nobody', 'Email', 'This must not be listed.')] }),
  };
  for (const id of ['F4', 'F2', 'F1', 'F3']) if (verified.includes(id)) entries.set(id, all[id]);
  return { ok: true, map, entries, candidates };
}

describe('buildSummary: the job table', () => {
  it('writes one row per job candidate and none for another kind, with the conservation counts', () => {
    const summary = buildSummary(run(), root);
    expect(summary.jobs.map((row) => row.candidate)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(summary.jobs.every((row) => row.kind === 'job')).toBe(true);
    const { schedule } = summary.counts;
    expect(summary.counts.jobRows).toBe(5);
    expect(schedule.literal + schedule.computed + schedule.absent).toBe(summary.counts.jobRows);
    expect(schedule).toEqual({ literal: 3, computed: 1, absent: 1 });
  });

  it('puts each row in its bucket and writes the literal as the line gives it', () => {
    const rows = buildSummary(run(), root).jobs;
    expect(rows.map((row) => row.schedule)).toEqual([
      { bucket: 'literal', literal: '30 * * * * *' },
      { bucket: 'computed', literal: null },
      { bucket: 'absent', literal: null },
      { bucket: 'literal', literal: '0 9 * * *' },
      { bucket: 'literal', literal: '@every 5m' },
    ]);
  });

  it('gives each row the feature the map assigned it to, or no feature and the map reason', () => {
    const rows = buildSummary(run(), root).jobs;
    expect(rows.map((row) => row.feature)).toEqual(['F1', 'F1', 'F2', 'F3', null]);
    expect(rows.map((row) => row.reason)).toEqual([null, null, null, null, 'A poller that no reader sees.']);
  });

  it('lists only the automatic items whose citation covers the registration line, in the entry order', () => {
    const covering = item('Every night', 'The nightly report is built.', cite('src/jobs/register.js', REGISTER[6]), REGISTRATION);
    const alsoCovering = item('At 30 seconds', 'The report job runs.', REGISTRATION);
    const elsewhere = item('After shipping', 'The warehouse is told.', cite('src/jobs/register.js', REGISTER[6]));
    const rows = buildSummary(run({ f1Automatic: [elsewhere, covering, alsoCovering] }), root).jobs;
    expect(rows[0].automatic).toEqual([
      { when: 'Every night', effect: 'The nightly report is built.' },
      { when: 'At 30 seconds', effect: 'The report job runs.' },
    ]);
    // c2 sits on another line of the same file and the same feature: nothing is borrowed from the first row's items.
    expect(rows[1].automatic).toEqual([]);
  });

  it('writes no description when the covering item is gone, and does not fall back to an item elsewhere in the file', () => {
    const elsewhere = item('After shipping', 'The warehouse is told.', cite('src/jobs/register.js', REGISTER[6]));
    const summary = buildSummary(run({ f1Automatic: [elsewhere] }), root);
    expect(summary.jobs[0].automatic).toEqual([]);
    expect(summary.counts.described).toBe(0);
  });

  it('does not list an item of another feature that covers the line', () => {
    const foreign = item('Every night', 'Invoices are chased.', REGISTRATION);
    const summary = buildSummary(run({ f1Automatic: [], f2Automatic: [foreign] }), root);
    expect(summary.jobs[0].automatic).toEqual([]);
  });

  it('does not list an item whose citation is on the same line number of another file', () => {
    // other.js line 2 has the line number of c1 in register.js, but it is another file.
    const otherFile = item('Every day', 'Other file.', cite('src/jobs/other.js', OTHER[1]));
    const summary = buildSummary(run({ f1Automatic: [otherFile] }), root);
    expect(summary.jobs[0].automatic).toEqual([]);
    expect(summary.counts.described).toBe(0);
  });

  it('lists an item whose passage spans several lines for every registration line it covers, once per row', () => {
    const span = item('Every minute and hour', 'Both jobs run.', cite('src/jobs/register.js', `${REGISTER[1]}\n${REGISTER[2]}`), REGISTRATION, DIGEST);
    const summary = buildSummary(run({ f1Automatic: [span] }), root);
    expect(summary.jobs[0].automatic).toEqual([{ when: 'Every minute and hour', effect: 'Both jobs run.' }]);
    expect(summary.jobs[1].automatic).toEqual([{ when: 'Every minute and hour', effect: 'Both jobs run.' }]);
    expect(summary.jobs[2].automatic).toEqual([]);
    expect(summary.counts.described).toBe(2);
  });

  it('treats a citation that does not locate (file unreadable, passage not found) as no match', () => {
    const broken = item('Never', 'Nothing.', cite('src/jobs/missing.js', REGISTER[1]), cite('src/jobs/register.js', 'a passage that is not in the file'));
    const summary = buildSummary(run({ f1Automatic: [broken] }), root);
    expect(summary.jobs[0].automatic).toEqual([]);
  });

  it('keeps the rows of a feature without a verified entry and writes them without a description', () => {
    const summary = buildSummary(run({ f1Automatic: [item('Every night', 'Built.', REGISTRATION)], verified: ['F2', 'F4'] }), root);
    expect(summary.jobs.map((row) => row.feature)).toEqual(['F1', 'F1', 'F2', 'F3', null]);
    expect(summary.jobs[0].automatic).toEqual([]);
  });

  it('has no rows and zero counts when there is no job candidate', () => {
    const none = run();
    none.candidates = none.candidates.filter((c) => c.kind !== 'job');
    none.map.features.forEach((feature) => { feature.candidates = feature.candidates.filter((id) => id === 'c6'); });
    none.map.unassigned = [];
    const summary = buildSummary(none, root);
    expect(summary.jobs).toEqual([]);
    expect(summary.counts.schedule).toEqual({ literal: 0, computed: 0, absent: 0 });
    expect(summary.counts.jobRows).toBe(0);
  });

  it('puts a candidate without a text, and a root that does not exist when no citation is read, in the absent bucket instead of failing', () => {
    const bare = run();
    bare.candidates = bare.candidates.map((c) => ({ id: c.id, kind: c.kind }));
    const summary = buildSummary(bare, join(root, 'nowhere'));
    expect(summary.jobs.map((row) => row.schedule.bucket)).toEqual(['absent', 'absent', 'absent', 'absent', 'absent']);
    expect(summary.counts.schedule).toEqual({ literal: 0, computed: 0, absent: 5 });
  });

  it('throws for a job candidate that the map neither assigns nor lists as unassigned (a bug of the caller, not a quiet row)', () => {
    const broken = run();
    broken.map.unassigned = [];
    expect(() => buildSummary(broken, root)).toThrow(/c5/);
  });
});

describe('buildSummary: the notification table', () => {
  it('lists the notifications of the verified entries by area, then feature, then entry order, copied as written', () => {
    const summary = buildSummary(run(), root);
    expect(summary.notifications).toEqual([
      { feature: 'F1', trigger: 'A report is built', recipient: 'The manager', channel: 'Email', content: 'The report is ready.' },
      { feature: 'F2', trigger: 'An invoice is sent', recipient: 'The customer', channel: 'Email', content: 'Your invoice is ready.' },
      { feature: 'F2', trigger: 'An invoice is late', recipient: 'The customer', channel: 'SMS', content: 'Your invoice is late.' },
      { feature: 'F4', trigger: 'A payment fails', recipient: 'The accountant', channel: 'Email', content: 'The payment failed.' },
    ]);
  });

  it('does not list the notifications of a feature that is not verified, and does not count it', () => {
    const summary = buildSummary(run(), root);
    expect(JSON.stringify(summary)).not.toContain('This must not be listed.');
    expect(summary.counts.featureTotal).toBe(4);
    expect(summary.counts.featuresWithEntry).toBe(3);
    expect(summary.counts.notificationRows).toBe(4);
    const fewer = buildSummary(run({ verified: ['F1'] }), root);
    expect(fewer.counts.featuresWithEntry).toBe(1);
    expect(fewer.notifications.map((row) => row.feature)).toEqual(['F1']);
  });

  it('does not merge identical rows or change the channel names', () => {
    const doubled = run();
    doubled.entries.get('F1').notifications.push(note('A report is built', 'The manager', 'Email', 'The report is ready.'), note('A report is built', 'The manager', 'e-mail', 'The report is ready.'));
    const rows = buildSummary(doubled, root).notifications.filter((row) => row.feature === 'F1');
    expect(rows.map((row) => row.channel)).toEqual(['Email', 'Email', 'e-mail']);
  });

  it('is empty, with the counts, when no verified entry has a notification', () => {
    const quiet = run();
    for (const entry of quiet.entries.values()) entry.notifications = [];
    const summary = buildSummary(quiet, root);
    expect(summary.notifications).toEqual([]);
    expect(summary.counts.notificationRows).toBe(0);
    expect(summary.counts.featuresWithEntry).toBe(3);
  });

  it('holds no evidence, no file name and no project path', () => {
    const text = JSON.stringify(buildSummary(run({ f1Automatic: [item('Every night', 'Built.', REGISTRATION)] }), root));
    expect(text).not.toContain('evidence');
    expect(text).not.toContain('src/jobs');
    expect(text).not.toContain(root);
  });
});
