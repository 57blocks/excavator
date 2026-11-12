// O1 of openspec change handbook-topics: topic-facts, topic-lanes, check-topics,
// and the state of the lane units `topics:<lane>`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { TOPICS, rowIdOf, topicsShapeProblems } from '../../../skills/excavator-product-handbook/lib/topics-shape.mjs';
import { laneProblems } from '../../../skills/excavator-product-handbook/lib/topics-check.mjs';
import { factLine, factsDigest, groupFactRow } from '../../../skills/excavator-product-handbook/lib/topics-facts.mjs';
import { makeRun } from './helpers.mjs';
import {
  PART_FORMAT, checkedLane, checkedTopicsRun, factRows, judgePlan, judgeTopics, topicsRun, writeVerdicts,
} from './topics-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

// The tests that only read share one run (it takes seconds to build); the ones that write build their own.
const sharedCleanups = [];
let sharedRun = null;
const shared = () => {
  sharedRun ??= topicsRun(sharedCleanups);
  return sharedRun;
};
afterAll(() => {
  while (sharedCleanups.length > 0) sharedCleanups.pop()();
});

const GROUP_KEY = /^F\d+\.findings#\d+@[0-9a-f]{16}$/;

describe('topic-lanes', () => {
  it('lists each domain that has a verified entry, then repeated, with the number of facts and the status', () => {
    const result = shared().run('topic-lanes');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines.map((line) => line.split('\t'))).toEqual([
      ['D1', 'Customer orders', '6', 'planned'],
      ['D2', 'System upkeep', '6', 'planned'],
      ['repeated', '-', '4', 'planned'],
    ]);
  });

  it('does not list a domain without a verified entry, and not repeated without a verified group of findings', () => {
    const run = topicsRun(cleanups, { findings: false, withJob: false });
    expect(run.run('topic-lanes').lines.map((line) => line.split('\t')[0])).toEqual(['D1']);
  });

  it('prints one Topics: line and no lane when there is no verified entry and no verified finding', () => {
    const run = makeRunWithMap();
    expect(run.run('topic-lanes').lines).toEqual(['Topics: no verified entry and no verified finding; nothing to write']);
  });

  it('groups the lanes by the map areas when there is no domains file', () => {
    const run = topicsRun(cleanups);
    run.writeJson(join(run.out, 'domains.json'), { format: 'nope' });
    expect(run.run('topic-lanes').lines.map((line) => line.split('\t').slice(0, 2))).toEqual([['A1', 'Order handling'], ['A2', 'Automatic work'], ['repeated', '-']]);
  });

  it('shows the status of a lane for the facts as they are now', () => {
    const run = topicsRun(cleanups);
    checkedLane(run, 'D1');
    expect(run.run('topic-lanes').lines.map((line) => line.split('\t')[3])).toEqual(['checked', 'planned', 'planned']);
  });
});

function makeRunWithMap() {
  const run = makeRun();
  cleanups.push(run.cleanup);
  run.writeMap();
  expect(run.run('check-map').status).toBe(0);
  return run;
}

describe('topic-facts', () => {
  it('lists only the verified items of the domain: who, sentences, states, automatic behaviors and notifications, by kind, with their ids', () => {
    const rows = factRows(shared(), 'D1');
    expect(rows).toEqual([
      ['F1#who[0]', 'Orders', 'who', 'Clerk: Create an order.'],
      ['F1#operations[0].sentences[0]', 'Orders', 'sentence', 'Place an order: The clerk fills in the customer name.'],
      ['F1#operations[0].sentences[1]', 'Orders', 'sentence', 'Place an order: The item count is limited to 35000.'],
      ['F1#states[0]', 'Orders', 'state', 'Draft: The order is not sent yet.'],
      ['F1#states[1]', 'Orders', 'state', 'Submitted: The order was sent.'],
      ['F1#notifications[0]', 'Orders', 'notification', 'An order is sent | Message | The approver'],
    ]);
  });

  it('ends the lines of a domain lane with the other domains, which are not facts, and none for the repeated lane', () => {
    expect(shared().run('topic-facts', '--lane', 'D1').lines.filter((line) => line.startsWith('domain:'))).toEqual(['domain:D2\tSystem upkeep']);
    expect(shared().run('topic-facts', '--lane', 'D2').lines.filter((line) => line.startsWith('domain:'))).toEqual(['domain:D1\tCustomer orders']);
    expect(shared().run('topic-facts', '--lane', 'repeated').lines.some((line) => line.startsWith('domain:'))).toBe(false);
  });

  it('lists the automatic behavior of the other domain, and nothing of a feature that has no verified entry', () => {
    const rows = factRows(shared(), 'D2');
    expect(rows.map((row) => row[0])).toEqual(['F3#who[0]', 'F3#operations[0].sentences[0]', 'F3#operations[0].sentences[1]', 'F3#states[0]', 'F3#states[1]', 'F3#automatic[0]']);
    expect(rows.find((row) => row[2] === 'automatic')).toEqual(['F3#automatic[0]', 'Reminders', 'automatic', 'Every day at nine: A reminder goes out.']);
    expect(rows.every((row) => row[0].startsWith('F3#'))).toBe(true);
  });

  it('lists the groups of the verified findings for the repeated lane: key, level, category key, statement and the application directory', () => {
    const rows = factRows(shared(), 'repeated');
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row).toHaveLength(5);
      expect(row[0]).toMatch(GROUP_KEY);
      expect(row[1]).toBe('unranked');
      expect(row[4]).toBe('.');
    }
    expect(rows.map((row) => row[2]).sort()).toEqual(['authorization', 'error-handling', 'hard-coded', 'time']);
    expect(rows.find((row) => row[2] === 'authorization')[3]).toBe('Deleting an order asks nothing about who calls: the handler removes the order and answers success to every caller.');
  });

  it('exits 2 for a lane that is not listed, and for a missing --lane', () => {
    expect(shared().run('topic-facts', '--lane', 'D9').status).toBe(2);
    expect(shared().run('topic-facts', '--lane', 'D9').stderr).toContain('topic-lanes');
    expect(shared().run('topic-facts').status).toBe(2);
  });

  it('prints the same lines twice and changes no file; a changed text changes the digest', () => {
    const run = shared();
    const before = readFileSync(join(run.out, 'state.json'), 'utf-8');
    const first = run.run('topic-facts', '--lane', 'D1').stdout;
    expect(run.run('topic-facts', '--lane', 'D1').stdout).toBe(first);
    expect(readFileSync(join(run.out, 'state.json'), 'utf-8')).toBe(before);
    const rows = [{ id: 'a', fields: ['x'] }];
    expect(factsDigest(rows)).toBe(factsDigest([{ id: 'a', fields: ['x'] }]));
    expect(factsDigest(rows)).not.toBe(factsDigest([{ id: 'a', fields: ['y'] }]));
    expect(factLine(rows[0])).toBe('a\tx');
  });

  it('prints a Topics: note and no fact for a lane that is checked, verified or failed twice', () => {
    const run = topicsRun(cleanups);
    checkedLane(run, 'D1');
    expect(run.run('topic-facts', '--lane', 'D1').lines).toEqual(['Topics: D1: checked; nothing to write']);
    expect(judgeTopics(run).status).toBe(0);
    expect(run.run('topic-facts', '--lane', 'D1').lines).toEqual(['Topics: D1: verified; nothing to write']);
  });
});

describe('the application column of a repeated-lane fact', () => {
  const group = { key: 'k', category: 'authorization', priority: null, items: [{ id: 'a', text: 'One statement.' }, { id: 'b', text: 'Another.' }] };
  const places = new Map([['a', [{ file: 'svc-b/main.go' }]], ['b', [{ file: 'svc-a/x.go' }]]]);
  const roots = ['svc-a', 'svc-b'];

  it('names each application by the name it is given, sorted by directory, and keeps the directories apart', () => {
    const names = { 'svc-a': 'Auth service', 'svc-b': 'Billing service' };
    const row = groupFactRow(group, { roots, places, nameOf: (dir) => names[dir] });
    expect(row.applications).toEqual(['svc-a', 'svc-b']);
    expect(row.fields.at(-1)).toBe('Auth service, Billing service');
  });

  it('falls back to the directory when no name is given', () => {
    expect(groupFactRow(group, { roots, places }).fields.at(-1)).toBe('svc-a, svc-b');
  });
});

describe('check-topics for a lane', () => {
  const NEXT = (lane) => `Next: delete topics/part-${lane}.json, mark topics:${lane} dispatched and re-dispatch the lane once with the lines above (attempt 2 of 2)`;
  const failing = (lane, edit) => {
    const run = topicsRun(cleanups);
    expect(run.run('mark', `topics:${lane}`, 'dispatched').lines).toEqual([`topics:${lane}: dispatched, attempts 1`]);
    const rows = run.goodRows(lane);
    const edited = edit(rows, run) ?? rows;
    if (Array.isArray(edited)) run.writePart(lane, edited);
    else run.writeRawPart(lane, edited.doc);
    return { run, result: run.laneRun('check-topics', lane) };
  };

  it('accepts a good file, records the lane as checked with both digests and says what is next', () => {
    const run = checkedLane(topicsRun(cleanups), 'D1');
    const entry = run.readState().topics.D1;
    expect(entry).toMatchObject({ status: 'checked', attempts: 1 });
    expect(entry.entryDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.factsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(run.laneRun('check-topics', 'D1').lines).toEqual(['topics:D1: checked (2 rows)']);
  });

  it('accepts a lane that wrote no row: nothing in the entries says anything about the topics', () => {
    const run = topicsRun(cleanups);
    run.run('mark', 'topics:D2', 'dispatched');
    run.writePart('D2', []);
    expect(run.laneRun('check-topics', 'D2').lines).toEqual(['topics:D2: checked (0 rows)']);
  });

  const REJECTED = [
    ['a topic is not in the table', (rows) => { rows[0].topic = 'weather'; }, 'rows[0].topic: must be one of'],
    ['a column is not in the table', (rows) => { rows[0].fields.colour = 'blue'; }, 'rows[0].fields: "colour" is not a column of approval'],
    ['a column is missing', (rows) => { delete rows[0].fields.skips; }, 'rows[0].fields: missing column "skips"'],
    ['a column is not text', (rows) => { rows[0].fields.skips = 3; }, 'rows[0].fields.skips: must be a string'],
    ['every column is empty', (rows) => { rows[0].fields = { business: '', route: '', skips: '', conditions: '', actors: '' }; }, 'every column is empty'],
    ['a domain lane writes the repeated topic', (rows) => { rows[0] = { topic: 'repeated', fields: { mechanism: 'x', places: 'y' }, cites: ['F1#who[0]'] }; }, 'rows[0].topic: "repeated" is not written by a domain lane'],
    ['a row cites nothing', (rows) => { rows[0].cites = []; }, 'rows[0].cites: must cite at least one fact'],
    ['a row cites an id that is not a fact', (rows) => { rows[0].cites = ['F1#who[7]']; }, 'rows[0].cites[0]: "F1#who[7]" is not a fact of topic-facts for this lane'],
    ['a row cites an item of another lane', (rows) => { rows[0].cites = ['F3#automatic[0]']; }, 'rows[0].cites[0]: "F3#automatic[0]" is not a fact of topic-facts for this lane'],
    ['a number is not in the cited text', (rows) => { rows[0].fields.conditions = 'Over 16 items the order goes to the next level.'; }, 'rows[0].fields.conditions: number 16 does not occur in the items it cites'],
    ['a text holds a code word', (rows) => { rows[0].fields.route = 'The clerk calls place_order.'; }, 'is not allowed in reader text'],
    ['a text holds a file name', (rows) => { rows[0].fields.route = 'See orders.js for the route.'; }, 'source file extension'],
    ['a text holds a word of advice', (rows) => { rows[0].fields.route = 'The clerk should fill in the customer name.'; }, 'is a word of advice'],
    ['a text has two lines', (rows) => { rows[0].fields.route = 'One.\nTwo.'; }, 'rows[0].fields.route: must be one line'],
    ['an access row names a feature of another lane', (rows) => { rows[1].fields.feature = 'F3'; }, 'rows[1].fields.feature: "F3" is not a feature with a verified entry in this lane'],
    ['the file is for another lane', (rows) => ({ doc: { schema: PART_FORMAT, lane: 'D2', rows } }), 'lane: must be "D1"'],
    ['the shape is wrong', () => ({ doc: { schema: PART_FORMAT, lane: 'D1' } }), 'missing key "rows"'],
  ];
  for (const [name, edit, text] of REJECTED) {
    it(`exits 1, records the lane as failed and names the problem when ${name}`, () => {
      const { run, result } = failing('D1', edit);
      expect(result.status, result.stdout).toBe(1);
      expect(result.lines.join('\n')).toContain(text);
      expect(result.lines.at(-1)).toBe(NEXT('D1'));
      expect(run.readState().topics.D1).toMatchObject({ status: 'failed', attempts: 1, failure: { step: 'check-entry' } });
    });
  }

  const HANDOFFS = [
    ['the using domain is not this lane', (rows) => { rows[1].fields.to = 'D1'; }, 'rows[1].fields.to: "D1" must be this lane, D2'],
    ['the providing domain is not a domain', (rows) => { rows[1].fields.from = 'D9'; }, 'rows[1].fields.from: "D9" is not another domain of the handbook'],
    ['the providing domain is this lane', (rows) => { rows[1].fields.from = 'D2'; }, 'rows[1].fields.from: "D2" is not another domain of the handbook'],
    ['a handoff has no content', (rows) => { rows[1].fields.content = ''; }, 'rows[1].fields.content: a data row needs content'],
  ];
  for (const [name, edit, text] of HANDOFFS) {
    it(`exits 1 for a data row when ${name}`, () => {
      const { result } = failing('D2', edit);
      expect(result.status, result.stdout).toBe(1);
      expect(result.lines.join('\n')).toContain(text);
    });
  }

  it('an access row must cite an item of its own feature, not only of another feature of the lane', () => {
    const items = ['F1#who[0]', 'F2#who[0]'].map((id) => ({ id, kind: 'item', text: 'Clerk: Create an order.', fields: ['n', 'who', 'Clerk: Create an order.'] }));
    const lane = { id: 'D1', kind: 'domain', featureIds: ['F1', 'F2'], byId: new Map(items.map((item) => [item.id, item])) };
    const facts = { domains: [{ id: 'D1', name: 'x' }] };
    const doc = { schema: PART_FORMAT, lane: 'D1', rows: [{ topic: 'access', fields: { feature: 'F1', who: '', pageCheck: '', serverCheck: '' }, cites: ['F2#who[0]'] }] };
    const run = { ui: {}, check: { files: null, memberDirs: [], languageCheck: null, mapLabels: new Set() } };
    expect(laneProblems(doc, lane, facts, run)).toEqual(['rows[0].cites: an access row must cite at least one item of F1']);
  });

  it('the repeated lane writes only the repeated topic, and cites only groups', () => {
    const { result } = failing('repeated', (rows) => { rows[0].topic = 'approval'; });
    expect(result.status).toBe(1);
    expect(result.lines.join('\n')).toContain('rows[0].topic: "approval" is not written by the repeated lane');
    const other = failing('repeated', (rows) => { rows[0].cites = ['F1#who[0]']; });
    expect(other.result.lines.join('\n')).toContain('is not a fact of topic-facts for this lane');
  });

  it('accepts a number that the cited text holds, and a text with a word that only contains an advice word', () => {
    const { result } = failing('D1', (rows) => { rows[0].fields.conditions = 'The item count is limited to 35000; musty rules are not mentioned.'; });
    expect(result.status, result.stdout).toBe(0);
  });

  it('exits 1 for a file that is missing, and one that is not JSON', () => {
    const run = topicsRun(cleanups);
    run.run('mark', 'topics:D1', 'dispatched');
    const missing = run.laneRun('check-topics', 'D1');
    expect(missing.status).toBe(1);
    expect(missing.lines[0]).toBe('lane-wrote-nothing: topics/part-D1.json is missing');
    run.writeRawPart('D1', []);
    expect(run.laneRun('check-topics', 'D1').status).toBe(1);
  });

  it('stays failed after the second attempt and refuses a third dispatch', () => {
    const { run } = failing('D1', (rows) => { rows[0].topic = 'weather'; });
    expect(run.run('mark', 'topics:D1', 'dispatched').lines).toEqual(['topics:D1: dispatched, attempts 2']);
    const second = run.laneRun('check-topics', 'D1');
    expect(second.status).toBe(1);
    expect(second.lines.at(-1)).toBe('Next: topics:D1 stays failed (2 of 2 attempts)');
    expect(run.run('mark', 'topics:D1', 'dispatched').lines).toEqual(['topics:D1: attempts is already 2, the most a lane gets']);
    expect(run.run('topic-facts', '--lane', 'D1').lines).toEqual(['Topics: D1: failed (2 of 2 attempts); its rows are not written']);
  });

  it('does not check again a lane the judges settled: it says so and keeps the verdicts', () => {
    const run = checkedTopicsRun(cleanups);
    expect(judgeTopics(run).status).toBe(0);
    const before = readFileSync(join(run.out, 'state.json'), 'utf-8');
    expect(run.laneRun('check-topics', 'D1').lines).toEqual(['topics:D1: verified, unchanged since it was verified']);
    expect(readFileSync(join(run.out, 'state.json'), 'utf-8')).toBe(before);
  });
});

describe('check-topics for the whole run', () => {
  it('checks every lane, records each, merges the rows by topic, then lane, then row into entries/topics.json', () => {
    const run = topicsRun(cleanups);
    for (const lane of ['D1', 'D2', 'repeated']) {
      run.run('mark', `topics:${lane}`, 'dispatched');
      run.writePart(lane, run.goodRows(lane));
    }
    const result = run.run('check-topics');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['topics:D1: checked (2 rows)', 'topics:D2: checked (2 rows)', 'topics:repeated: checked (1 rows)', 'topics: merged (3 lanes, 5 rows)']);
    const merged = run.readJson('entries/topics.json');
    expect(merged.schema).toBe('excavator-product-handbook-topics/1');
    expect(merged.rows.map((row) => [row.id, row.lane, row.topic])).toEqual([
      ['D1#1', 'D1', 'approval'],
      ['D2#1', 'D2', 'time'],
      ['D2#2', 'D2', 'handoffs'],
      ['D1#2', 'D1', 'access'],
      ['repeated#1', 'repeated', 'repeated'],
    ]);
    expect(Object.keys(merged.rows[0])).toEqual(['id', 'lane', 'topic', 'fields', 'cites']);
  });

  it('checks a lane whose file is missing as failed, names the lane to write again and still merges the others', () => {
    const run = topicsRun(cleanups);
    for (const lane of ['D1', 'repeated']) {
      run.run('mark', `topics:${lane}`, 'dispatched');
      run.writePart(lane, run.goodRows(lane));
    }
    run.run('mark', 'topics:D2', 'dispatched');
    const result = run.run('check-topics');
    expect(result.status).toBe(1);
    expect(result.lines).toContain('lane D2: lane-wrote-nothing: topics/part-D2.json is missing');
    expect(result.lines).toContain('Next: delete topics/part-D2.json, mark topics:D2 dispatched and re-dispatch the lane once with the lines above (attempt 2 of 2)');
    expect(run.readState().topics.D2).toMatchObject({ status: 'failed', attempts: 1 });
    expect(run.readJson('entries/topics.json').rows.map((row) => row.lane)).toEqual(['D1', 'D1', 'repeated']);
  });

  it('exits 0 for a lane that failed twice: it stays failed, the others are merged', () => {
    const run = topicsRun(cleanups);
    for (const lane of ['D1', 'repeated']) {
      run.run('mark', `topics:${lane}`, 'dispatched');
      run.writePart(lane, run.goodRows(lane));
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      run.run('mark', 'topics:D2', 'dispatched');
      run.writePart('D2', [{ topic: 'weather', fields: {}, cites: [] }]);
      run.run('check-topics');
    }
    const result = run.run('check-topics');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toContain('Next: topics:D2 stays failed (2 of 2 attempts)');
    expect(run.readState().topics.D2).toMatchObject({ status: 'failed', attempts: 2 });
  });

  it('prints a note and records nothing when there is no lane', () => {
    const run = makeRunWithMap();
    expect(run.run('check-topics').lines).toEqual(['Topics: no verified entry and no verified finding; nothing to check']);
    expect(run.readJson('state.json').topics).toBeUndefined();
  });
});

describe('the state of the lanes', () => {
  it('has no key before the first dispatch (planned, no migration) and records the dispatch with the digest of the facts of the lane', () => {
    const run = topicsRun(cleanups);
    expect(run.readState().topics).toBeUndefined();
    expect(run.run('mark', 'topics:D1', 'dispatched').lines).toEqual(['topics:D1: dispatched, attempts 1']);
    expect(run.readState().topics.D1).toMatchObject({ status: 'dispatched', attempts: 1 });
    expect(run.readState().topics.D1.factsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(run.readState().topics.D2).toBeUndefined();
  });

  it('records a lane that wrote nothing as failed and keeps the digest, so the next dispatch is the second attempt', () => {
    const run = topicsRun(cleanups);
    run.run('mark', 'topics:D1', 'dispatched');
    expect(run.run('mark', 'topics:D1', 'failed', 'lane', 'no file').lines).toEqual(['topics:D1: failed at lane: no file']);
    expect(run.run('mark', 'topics:D1', 'dispatched').lines).toEqual(['topics:D1: dispatched, attempts 2']);
  });

  it('refuses a dispatch for facts that are already written, and starts over, without the old files, when the facts changed', () => {
    const run = checkedLane(topicsRun(cleanups), 'D1');
    expect(run.run('mark', 'topics:D1', 'dispatched').lines).toEqual(['topics:D1: already checked for these facts; it is not written again']);
    const state = run.readState();
    state.topics.D1.factsDigest = '0'.repeat(64);
    run.writeJson(join(run.out, 'state.json'), state);
    expect(run.run('mark', 'topics:D1', 'dispatched').lines).toEqual(['topics:D1: dispatched, attempts 1']);
    expect(() => run.readJson('topics/part-D1.json')).toThrow();
    expect(run.readState().topics.D1.dropped).toBeUndefined();
  });

  it('a lane whose facts changed is planned again: the status shows it and the lane is listed as planned', () => {
    const run = checkedLane(topicsRun(cleanups), 'D1');
    const state = run.readState();
    state.topics.D1.factsDigest = '2'.repeat(64);
    run.writeJson(join(run.out, 'state.json'), state);
    expect(run.run('topic-lanes').lines[0].split('\t')[3]).toBe('planned');
  });

  it('refuses a mark for a lane that is not listed', () => {
    const run = topicsRun(cleanups);
    const result = run.run('mark', 'topics:D9', 'dispatched');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('topic-lanes');
  });

  it('refuses a state whose topics entry is malformed', () => {
    const run = topicsRun(cleanups);
    const state = run.readState();
    state.topics = { D1: { status: 'verified', attempts: 1, dropped: [{ id: 'x' }] } };
    run.writeJson(join(run.out, 'state.json'), state);
    const result = run.run('topic-lanes');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('topics D1 has a dropped list that is not [{ id, reasons }]');
  });
});

describe('topic-facts on a settled lane', () => {
  it('a settled lane prints a note: the lane is current, so nothing is written again', () => {
    const run = checkedTopicsRun(cleanups);
    judgeTopics(run);
    expect(run.run('topic-facts', '--lane', 'repeated').lines).toEqual(['Topics: repeated: verified; nothing to write']);
  });
});

describe('the shape of the file', () => {
  it('has the five topics with the columns of the table, and ids of the form lane#n counted from 1', () => {
    expect(TOPICS.map((topic) => [topic.id, topic.columns])).toEqual([
      ['approval', ['business', 'route', 'skips', 'conditions', 'actors']],
      ['time', ['rule', 'calendar', 'scope']],
      ['handoffs', ['from', 'to', 'content']],
      ['access', ['feature', 'who', 'pageCheck', 'serverCheck']],
      ['repeated', ['mechanism', 'places']],
    ]);
    expect(rowIdOf('D1', 0)).toBe('D1#1');
    const doc = { schema: PART_FORMAT, lane: 'D1', rows: [{ topic: 'time', fields: { rule: 'r', calendar: '', scope: 's' }, cites: ['k'] }] };
    expect(topicsShapeProblems(doc)).toEqual([]);
    expect(topicsShapeProblems({ ...doc, extra: 1 })).toEqual(['(top level): unexpected key "extra"']);
  });
});
