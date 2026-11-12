// O1 of openspec change handbook-remedies: remedy-facts, check-remedies,
// and the state of the unit `remedies`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { factLine, buildFactRows, factsDigest } from '../../../skills/excavator-product-handbook/lib/remedies-facts.mjs';
import { paragraphsOf, remediesShapeProblems } from '../../../skills/excavator-product-handbook/lib/remedies-shape.mjs';
import { makeRun } from './helpers.mjs';
import { verifiedFindingsRun } from './priority-fixture.mjs';
import {
  checkedRemediesRun, commitProject, factRows, judgeRemedies, rankedRun, remedyJudgePlan, writeRemedyVerdicts, writeSharedTables,
} from './remedies-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

// The tests that only read share one run (it takes seconds to build); the ones that write build their own.
const sharedCleanups = [];
let sharedRun = null;
const shared = () => {
  sharedRun ??= rankedRun(sharedCleanups);
  return sharedRun;
};
afterAll(() => {
  while (sharedCleanups.length > 0) sharedCleanups.pop()();
});

const GROUP_KEY = /^F\d+\.findings#\d+@[0-9a-f]{16}$/;

describe('remedy-facts', () => {
  it('prints a line for each group (key, level, category key, representative statement), P0 first, then the application, the shared tables and the counts', () => {
    const rows = factRows(shared());
    const groups = rows.slice(0, 4);
    for (const row of groups) {
      expect(row).toHaveLength(4);
      expect(row[0]).toMatch(GROUP_KEY);
    }
    expect(groups.map((row) => [row[1], row[2]])).toEqual([['P0', 'authorization'], ['P1', 'error-handling'], ['P1', 'time'], ['P2', 'hard-coded']]);
    expect(groups[0][3]).toBe('Deleting an order asks nothing about who calls: the handler removes the order and answers success to every caller.');
    expect(rows.slice(4).map((row) => row[0])).toEqual(['app:.', 'tables-shared', 'counts']);
  });

  it('prints an application line with its name, main language, files, lines and, without a version history, a dash for commits and authors', () => {
    const app = factRows(shared()).find((row) => row[0] === 'app:.');
    expect(app).toHaveLength(7);
    expect(app[1]).toBe('.');
    expect(app[2]).toBe('JavaScript');
    expect(app[3]).toMatch(/^[1-9]\d*$/);
    expect(app[4]).toMatch(/^[1-9]\d*$/);
    expect(app.slice(5)).toEqual(['-', '-']);
  });

  it('prints the commits and the authors of an application with a version history', () => {
    const run = rankedRun(cleanups);
    commitProject(run);
    const app = factRows(run).find((row) => row[0] === 'app:.');
    expect(app.slice(5)).toEqual(['1', '1']);
  });

  it('counts a table only when two or more applications mention it, and lists it with them', () => {
    const run = rankedRun(cleanups);
    writeSharedTables(run, [
      { name: 'orders', mentions: { '.': 2, billing: 1 } },
      { name: 'carts', mentions: { '.': 3 } },
      { name: 'loose', mentions: { '': 2, '.': 1 } },
      { name: 'zebra', mentions: { alpha: 1, '.': 1 } },
    ]);
    const row = factRows(run).find((one) => one[0] === 'tables-shared');
    expect(row).toEqual(['tables-shared', '2', 'orders (., billing)', 'zebra (., alpha)']);
  });

  it('prints a dash for the tables when the data section was not written, and zero when no table is shared', () => {
    const run = rankedRun(cleanups);
    expect(factRows(run).find((one) => one[0] === 'tables-shared')).toEqual(['tables-shared', '-']);
    writeSharedTables(run, [{ name: 'carts', mentions: { '.': 3 } }]);
    expect(factRows(run).find((one) => one[0] === 'tables-shared')).toEqual(['tables-shared', '0']);
  });

  it('prints the counts: groups, groups of each level and unranked, groups of each category with a group', () => {
    expect(factRows(shared()).find((row) => row[0] === 'counts')).toEqual(['counts', 'groups=4', 'P0=1', 'P1=2', 'P2=1', 'unranked=0', 'authorization=1', 'error-handling=1', 'hard-coded=1', 'time=1']);
  });

  it('writes the level unranked for a group no judge confirmed, and for every group when the ranking is not verified', () => {
    const run = verifiedFindingsRun(cleanups);
    const rows = factRows(run);
    expect(rows.slice(0, 4).map((row) => row[1])).toEqual(['unranked', 'unranked', 'unranked', 'unranked']);
    expect(rows.find((row) => row[0] === 'counts').slice(1, 6)).toEqual(['groups=4', 'P0=0', 'P1=0', 'P2=0', 'unranked=4']);
  });

  it('prints the same lines twice and changes no file; a changed statement changes the digest', () => {
    const run = shared();
    const before = readFileSync(join(run.out, 'state.json'), 'utf-8');
    const first = run.run('remedy-facts').stdout;
    expect(run.run('remedy-facts').stdout).toBe(first);
    expect(readFileSync(join(run.out, 'state.json'), 'utf-8')).toBe(before);
    const rows = [{ id: 'a', fields: ['x'] }];
    expect(factsDigest(rows)).toBe(factsDigest([{ id: 'a', fields: ['x'] }]));
    expect(factsDigest(rows)).not.toBe(factsDigest([{ id: 'a', fields: ['y'] }]));
    expect(factLine(rows[0])).toBe('a\tx');
  });

  it('is built from the groups, the applications and the data by a pure function', () => {
    const group = { key: 'K', category: 'time', items: [{ id: 'F1.findings[0]', text: 'one\ttwo\nthree' }], priority: { level: 'P1' } };
    const rows = buildFactRows({ groups: [group], applications: [{ dir: 'a', name: null, languages: [], files: 0, lines: 0, history: null }], data: { state: 'missing' } });
    expect(rows.map(factLine)).toEqual(['K\tP1\ttime\tone two three', 'app:a\ta\t-\t0\t0\t-\t-', 'tables-shared\t-', 'counts\tgroups=1\tP0=0\tP1=1\tP2=0\tunranked=0\ttime=1']);
  });

  it('prints one Remedies: line and no fact when no finding is verified', () => {
    const run = rankedRun(cleanups);
    const state = run.readState();
    state.findings = {};
    run.writeJson(join(run.out, 'state.json'), state);
    expect(run.run('remedy-facts').lines).toEqual(['Remedies: no verified findings; nothing to write']);
  });
});

describe('check-remedies', () => {
  const failing = (edit) => {
    const run = rankedRun(cleanups);
    expect(run.run('mark', 'remedies', 'dispatched').lines).toEqual(['remedies: dispatched, attempts 1']);
    const doc = run.goodRemedies();
    run.writeRemedies(edit(doc, run) ?? doc);
    return { run, result: run.run('check-remedies') };
  };
  const NEXT = 'Next: delete entries/remedies.json, mark remedies dispatched and re-dispatch the remedies lane once with the lines above (attempt 2 of 2)';

  it('accepts a good file, records checked with the digests and says what is next; advice words are not refused', () => {
    const run = checkedRemediesRun(cleanups);
    const state = run.readState();
    expect(state.remedies).toMatchObject({ status: 'checked', attempts: 1 });
    expect(state.remedies.entryDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(state.remedies.factsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(run.goodRemedies().recommendations[1].text).toContain('should');
    // A second check of the same file is unchanged (a checked unit is final).
    expect(run.run('check-remedies').lines).toEqual(['remedies: checked, unchanged since it was checked']);
  });

  const REJECTED = [
    ['a cited id is not a fact', (doc) => { doc.recommendations[0].cites = ['no-such-fact']; }, 'recommendations[0].cites[0]: "no-such-fact" is not a fact of remedy-facts'],
    ['a category paragraph cites a group of another category', (doc, run) => { doc.categories[0].cites = [run.groupOf('time')]; }, 'is not a group of the category authorization'],
    ['a category paragraph cites a fact that is not a group', (doc) => { doc.categories[0].cites = ['counts']; }, 'is not a group of the category authorization'],
    ['a paragraph is for a category with no verified group', (doc, run) => { doc.categories.push({ category: 'security', cause: 'Nothing here.', measure: 'Nothing to do.', cites: [run.groupOf('time')] }); }, 'has no verified group'],
    ['a category has two paragraphs', (doc) => { doc.categories.push({ ...doc.categories[0] }); }, 'has more than one paragraph'],
    ['there are eleven recommendations', (doc) => { doc.recommendations = Array.from({ length: 11 }, (_, i) => ({ title: `Step ${i}`, text: 'Do the next thing.', cites: ['counts'] })); }, 'recommendations: must have at most 10 items'],
    ['there is no recommendation', (doc) => { doc.recommendations = []; }, 'recommendations: must have at least 1 item'],
    ['a paragraph cites nothing', (doc) => { doc.recommendations[1].cites = []; }, 'must cite at least one fact'],
    ['a number is not in the facts it cites', (doc) => { doc.recommendations[0].text = 'Start with the 52 findings of the highest level.'; }, 'recommendations[0].text: number 52 does not occur in the facts it cites'],
    ['a number of a cause is not in the facts it cites', (doc) => { doc.categories[0].cause = 'All 7 operations on orders ask nothing about who calls.'; }, 'categories[0].cause: number 7 does not occur in the facts it cites'],
    ['a text holds a code word', (doc) => { doc.categories[0].measure = 'Wrap delete_order in a check of the caller.'; }, 'is not allowed in reader text'],
    ['a text holds a file name', (doc) => { doc.recommendations[1].text = 'Rewrite orders.js so that it reads the store.'; }, 'source file extension'],
    ['a cause has two lines', (doc) => { doc.categories[0].cause = 'One line.\nAnother line.'; }, 'categories[0].cause: must be one line'],
    ['the shape is wrong', (doc) => { delete doc.recommendations; }, 'missing key "recommendations"'],
  ];
  for (const [name, edit, text] of REJECTED) {
    it(`exits 1, records failed and names the problem when ${name}`, () => {
      const { run, result } = failing(edit);
      expect(result.status, result.stdout).toBe(1);
      expect(result.lines.join('\n')).toContain(text);
      expect(result.lines.at(-1)).toBe(NEXT);
      expect(run.readState().remedies).toMatchObject({ status: 'failed', attempts: 1, failure: { step: 'check-entry' } });
    });
  }

  it('a number that is a level name is no number, and a number of the cited counts is accepted', () => {
    const { result } = failing((doc) => { doc.recommendations[0].text = 'Start with the findings of level P0: there are 1 of them, among 4 groups.'; });
    expect(result.status, result.stdout).toBe(0);
  });

  it('accepts a number that the cited facts hold as a count of tables, and refuses 52 against 31', () => {
    const run = rankedRun(cleanups);
    writeSharedTables(run, Array.from({ length: 31 }, (_, i) => ({ name: `table${i}`, mentions: { '.': 1, other: 1 } })));
    run.run('mark', 'remedies', 'dispatched');
    const doc = run.goodRemedies();
    doc.recommendations[1] = { title: 'Split the tables', text: '52 tables are shared by several applications and should be split.', cites: ['tables-shared'] };
    run.writeRemedies(doc);
    const bad = run.run('check-remedies');
    expect(bad.status).toBe(1);
    expect(bad.lines.join('\n')).toContain('number 52 does not occur in the facts it cites');
    run.run('mark', 'remedies', 'dispatched');
    doc.recommendations[1].text = '31 tables are shared by several applications and should be split.';
    run.writeRemedies(doc);
    expect(run.run('check-remedies').status).toBe(0);
  });

  it('exits 1 for a file that is missing, and one that is not JSON', () => {
    const run = rankedRun(cleanups);
    run.run('mark', 'remedies', 'dispatched');
    const missing = run.run('check-remedies');
    expect(missing.status).toBe(1);
    expect(missing.lines[0]).toBe('lane-wrote-nothing: entries/remedies.json is missing');
    run.writeRemedies([]);
    expect(run.run('check-remedies').status).toBe(1);
  });

  it('stays failed after the second attempt and refuses a third dispatch', () => {
    const { run } = failing((doc) => { doc.recommendations = []; });
    expect(run.run('mark', 'remedies', 'dispatched').lines).toEqual(['remedies: dispatched, attempts 2']);
    const second = run.run('check-remedies');
    expect(second.status).toBe(1);
    expect(second.lines.at(-1)).toBe('Next: remedies stays failed (2 of 2 attempts)');
    expect(run.run('mark', 'remedies', 'dispatched').lines).toEqual(['remedies: attempts is already 2, the most a lane gets']);
    expect(run.run('remedy-facts').lines).toEqual(['Remedies: failed (2 of 2 attempts); the remedies are not written']);
  });

  it('does not check again remedies the judges settled: it says so and keeps the verdicts', () => {
    const run = checkedRemediesRun(cleanups);
    expect(judgeRemedies(run).status).toBe(0);
    const before = readFileSync(join(run.out, 'state.json'), 'utf-8');
    expect(run.run('check-remedies').lines).toEqual(['remedies: verified, unchanged since it was verified']);
    expect(readFileSync(join(run.out, 'state.json'), 'utf-8')).toBe(before);
  });

  it('prints a note and records nothing when no finding is verified', () => {
    const run = rankedRun(cleanups);
    const state = run.readState();
    state.findings = {};
    run.writeJson(join(run.out, 'state.json'), state);
    expect(run.run('check-remedies').lines).toEqual(['Remedies: no verified findings; nothing to check']);
    expect(run.readState().remedies).toBeUndefined();
  });
});

describe('the state of the unit', () => {
  it('has no key before the first dispatch (planned, no migration) and records the dispatch with the digest of the facts', () => {
    const run = rankedRun(cleanups);
    expect(run.readState().remedies).toBeUndefined();
    expect(run.run('mark', 'remedies', 'dispatched').lines).toEqual(['remedies: dispatched, attempts 1']);
    expect(run.readState().remedies).toMatchObject({ status: 'dispatched', attempts: 1 });
    expect(run.readState().remedies.factsDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records a lane that wrote nothing as failed and keeps the digest, so the next dispatch is the second attempt', () => {
    const run = rankedRun(cleanups);
    run.run('mark', 'remedies', 'dispatched');
    expect(run.run('mark', 'remedies', 'failed', 'lane', 'no file').lines).toEqual(['remedies: failed at lane: no file']);
    expect(run.run('mark', 'remedies', 'dispatched').lines).toEqual(['remedies: dispatched, attempts 2']);
  });

  it('refuses a dispatch for facts that are already written, and starts over, without the old file, when the facts changed', () => {
    const run = checkedRemediesRun(cleanups);
    expect(run.run('mark', 'remedies', 'dispatched').lines).toEqual(['remedies: already checked for these facts; it is not written again']);
    const state = run.readState();
    state.remedies.factsDigest = '0'.repeat(64);
    run.writeJson(join(run.out, 'state.json'), state);
    expect(run.run('mark', 'remedies', 'dispatched').lines).toEqual(['remedies: dispatched, attempts 1']);
    expect(() => run.readJson('entries/remedies.json')).toThrow();
    expect(run.readState().remedies.dropped).toBeUndefined();
  });

  it('refuses a state whose remedies entry is malformed', () => {
    const run = rankedRun(cleanups);
    const state = run.readState();
    state.remedies = { status: 'verified', attempts: 1, dropped: [{ id: 'x' }] };
    run.writeJson(join(run.out, 'state.json'), state);
    const result = run.run('remedy-facts');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('remedies has a dropped list that is not [{ id, reasons }]');
  });

  it('reserves the id remedies: a feature of the map cannot have it', () => {
    const run = makeRun();
    cleanups.push(run.cleanup);
    run.map.features[0].id = 'remedies';
    run.writeMap();
    const result = run.run('check-map');
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toContain('is reserved for the remedies of the findings');
  });
});

describe('remedy-facts on settled or checked remedies', () => {
  it('settled remedies print a note: the remedies are current, so nothing is written again', () => {
    const run = checkedRemediesRun(cleanups);
    judgeRemedies(run);
    expect(run.run('remedy-facts').lines).toEqual(['Remedies: verified; nothing to write']);
  });

  it('for checked remedies, remedy-facts prints the note that there is nothing to write', () => {
    const run = checkedRemediesRun(cleanups);
    expect(run.run('remedy-facts').lines).toEqual(['Remedies: checked; nothing to write']);
  });
});

describe('the shape of the file', () => {
  it('numbers the recommendations from 1 and names the categories, in the order of the file', () => {
    const doc = { schema: 'excavator-product-handbook-remedies/1', categories: [{ category: 'time', cause: 'c', measure: 'm', cites: ['k'] }], recommendations: [{ title: 't', text: 'x', cites: ['k'] }, { title: 'u', text: 'y', cites: ['k'] }] };
    expect(remediesShapeProblems(doc)).toEqual([]);
    expect(paragraphsOf(doc).map((one) => one.id)).toEqual(['category:time', 'recommendation:1', 'recommendation:2']);
    expect(remediesShapeProblems({ ...doc, extra: 1 })).toEqual(['(top level): unexpected key "extra"']);
  });
});
