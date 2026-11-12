// O1 of openspec change handbook-findings-priority: the group keys, the table
// that turns a consequence into a level, priority-items, check-priority,
// and the state of the unit `priority`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { groupKey, partsOf } from '../../../skills/excavator-product-handbook/lib/priority-groups.mjs';
import { CONSEQUENCES, CONSEQUENCE_KEYS, LEVELS, levelOf, meaningOf } from '../../../skills/excavator-product-handbook/lib/priority-shape.mjs';
import { MARK, makeRun, markedMap, runHandbook, translatedUi, verifyChecked } from './helpers.mjs';
import { goodFindings, unitId, withFindingsHelpers } from './findings-fixture.mjs';
import {
  ENV_PART_SIZE, REASONS, checkedPriorityRun, itemRows, judgeAll, judgePlan, verifiedFindingsRun, withPriorityHelpers, writeVerdicts,
} from './priority-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

// The tests that only read share one run (it takes seconds to build); the ones that write build their own.
const sharedCleanups = [];
let sharedRun = null;
const shared = () => {
  sharedRun ??= verifiedFindingsRun(sharedCleanups);
  return sharedRun;
};
afterAll(() => {
  while (sharedCleanups.length > 0) sharedCleanups.pop()();
});

const ui = JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;
const KEY_PATTERN = /^F\d+\.findings#\d+@[0-9a-f]{16}$/;

describe('the table of consequences', () => {
  it('has exactly these keys, in this order, each with the level of design D2', () => {
    expect(CONSEQUENCES.map((row) => [row.key, row.level])).toEqual([
      ['othersRecords', 'P0'], ['money', 'P0'], ['dataLoss', 'P0'], ['secret', 'P0'],
      ['wrongResult', 'P1'], ['notification', 'P1'], ['blocked', 'P1'],
      ['display', 'P2'], ['inert', 'P2'],
    ]);
    expect(CONSEQUENCE_KEYS).toHaveLength(9);
    expect(LEVELS).toEqual(['P0', 'P1', 'P2']);
  });

  it('gives the level from the key alone and has a meaning and a display name for every key', () => {
    for (const row of CONSEQUENCES) {
      expect(levelOf(row.key), row.key).toBe(row.level);
      expect(meaningOf(row.key).length, row.key).toBeGreaterThan(10);
      expect(ui[`md.priority.consequence.${row.key}`], row.key).toEqual(expect.any(String));
    }
    expect(levelOf('display')).toBe('P2');
    expect(() => levelOf('critical')).toThrow();
  });
});

describe('the key of a group', () => {
  const item = (id, text) => ({ id, text });

  it('is the unit, the index of the representative and 16 hex digits of the digest of every statement', () => {
    expect(groupKey({ items: [item('F1.findings[2]', 'one'), item('F3.findings[0]', 'two')] })).toMatch(/^F1\.findings#2@[0-9a-f]{16}$/);
    expect(groupKey({ items: [item('app1.system[0]', 'one')] })).toMatch(/^app1\.system#0@[0-9a-f]{16}$/);
  });

  it('changes when one word of a statement changes, and when the group has one more member', () => {
    const base = groupKey({ items: [item('F1.findings[0]', 'Deleting an order asks nothing.')] });
    expect(groupKey({ items: [item('F1.findings[0]', 'Deleting an order asks nothing!')] })).not.toBe(base);
    expect(groupKey({ items: [item('F1.findings[0]', 'Deleting an order asks nothing.'), item('F3.findings[0]', 'Another.')] })).not.toBe(base);
    expect(groupKey({ items: [item('F1.findings[0]', 'Deleting an order asks nothing.')] })).toBe(base);
  });

  it('changes when a statement other than the representative changes', () => {
    const first = item('F1.findings[0]', 'same');
    expect(groupKey({ items: [first, item('F3.findings[0]', 'one')] })).not.toBe(groupKey({ items: [first, item('F3.findings[0]', 'two')] }));
  });

  it('keeps the unit and the index apart: another representative is another key even with the same statements', () => {
    expect(groupKey({ items: [item('F1.findings[0]', 'x')] })).not.toBe(groupKey({ items: [item('F1.findings[1]', 'x')] }));
  });
});

describe('the parts', () => {
  it('cuts the groups into parts of at most 40, in order', () => {
    const groups = Array.from({ length: 41 }, (_, index) => ({ key: `k${index}` }));
    expect(partsOf(groups).map((part) => part.length)).toEqual([40, 1]);
    expect(partsOf(groups.slice(0, 40)).map((part) => part.length)).toEqual([40]);
    expect(partsOf([])).toEqual([[]]);
  });
});

describe('priority-items', () => {
  it('prints one tab-separated line for each group: key, category display name, representative statement, the others', () => {
    const run = shared();
    const rows = itemRows(run);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row).toHaveLength(4);
      expect(row[0]).toMatch(KEY_PATTERN);
    }
    expect(rows.map((row) => row[1])).toEqual([ui['md.findings.category.authorization'], ui['md.findings.category.errorHandling'], ui['md.findings.category.hardCoded'], ui['md.findings.category.time']]);
    expect(rows[0][2]).toBe('Deleting an order asks nothing about who calls: the handler removes the order and answers success to every caller.');
    expect(rows.map((row) => row[3])).toEqual(['', '', '', '']);
    expect(new Set(rows.map((row) => row[0])).size).toBe(4);
  });

  it('is computed from the findings each time, changes no file and prints the same lines twice', () => {
    const run = shared();
    const before = readFileSync(join(run.out, 'state.json'), 'utf-8');
    const first = run.run('priority-items').stdout;
    expect(run.run('priority-items').stdout).toBe(first);
    expect(readFileSync(join(run.out, 'state.json'), 'utf-8')).toBe(before);
  });

  it('prints only the lines of one part with --part, and refuses a part that does not exist', () => {
    const run = shared();
    const all = run.run('priority-items').lines;
    const second = runHandbook(['priority-items', run.out, '--part', '2', '--project', run.root], { env: { ...process.env, [ENV_PART_SIZE]: '3' } });
    expect(second.status, second.stderr).toBe(0);
    expect(second.lines).toEqual([all[3]]);
    const none = run.run('priority-items', '--part', '5');
    expect(none.status).toBe(2);
    expect(none.stderr).toContain('--part must be a number from 1 to 1');
  });

  it('prints one Priority: line and no group when no finding is verified', () => {
    const run = verifiedFindingsRun(cleanups);
    const state = run.readState();
    state.findings = {};
    run.writeJson(join(run.out, 'state.json'), state);
    const result = run.run('priority-items');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.lines).toEqual(['Priority: no verified findings; nothing to rank']);
  });
});

describe('check-priority', () => {
  /** A checked-state run with the part file the test edits; `edit(items)` changes the items of the good part before it is written. */
  const withPart = (edit) => {
    const run = verifiedFindingsRun(cleanups);
    expect(run.run('mark', 'priority', 'dispatched').lines).toEqual(['priority: dispatched, attempts 1']);
    const items = run.keys().map(run.goodItem);
    const written = edit(items) ?? items;
    run.writePart(1, written);
    return run;
  };

  it('accepts a good part: records checked, merges the items in group order into entries/priority.json and says what is next', () => {
    const run = withPart(() => undefined);
    const result = run.run('check-priority');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['priority: checked (4 groups, 1 part)']);
    const state = run.readState();
    expect(state.priority).toMatchObject({ status: 'checked', attempts: 1 });
    expect(state.priority.entryDigest).toMatch(/^[0-9a-f]{64}$/);
    const merged = run.readJson('entries/priority.json');
    expect(merged.schema).toBe('excavator-product-handbook-priority/1');
    expect(merged.items.map((item) => item.key)).toEqual(run.allKeys);
    expect(merged.items.map((item) => item.consequence)).toEqual(['othersRecords', 'wrongResult', 'display', 'notification']);
  });

  it('merges the part files of several parts in group order', () => {
    const run = verifiedFindingsRun(cleanups);
    expect(run.runSized(3, 'mark', 'priority', 'dispatched').status).toBe(0);
    run.writeGoodParts(3);
    const result = run.runSized(3, 'check-priority');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('priority: checked (4 groups, 2 parts)');
    expect(run.readJson('entries/priority.json').items.map((item) => item.key)).toEqual(run.allKeys);
  });

  const REJECTED = [
    ['a group has no item', (items) => items.slice(1), (lines) => expect(lines.some((line) => line.startsWith('part 1: ') && line.endsWith(': no item'))).toBe(true)],
    ['an item has a key that is not a group', (items) => [...items, { key: 'F9.findings#0@0123456789abcdef', consequence: 'money', reason: REASONS.time }], (lines) => expect(lines.join('\n')).toContain('is not a group of this part')],
    ['a key is repeated', (items) => [...items, items[0]], (lines) => expect(lines.join('\n')).toContain('more than one item')],
    ['a consequence is not in the table', (items) => items.map((item, index) => (index === 0 ? { ...item, consequence: 'critical' } : item)), (lines) => expect(lines.join('\n')).toContain('consequence: must be one of')],
    ['a reason has two lines', (items) => items.map((item, index) => (index === 0 ? { ...item, reason: `${item.reason}\nIt also does more.` } : item)), (lines) => expect(lines.join('\n')).toContain('the reason must be one line')],
    ['a reason holds a code word', (items) => items.map((item, index) => (index === 0 ? { ...item, reason: 'The handler named delete_order removes it for any caller.' } : item)), (lines) => expect(lines.join('\n')).toContain('is not allowed in reader text')],
    ['a reason holds a file name', (items) => items.map((item, index) => (index === 0 ? { ...item, reason: 'The router in orders.js removes it for any caller.' } : item)), (lines) => expect(lines.join('\n')).toContain('source file extension')],
    ['a reason holds a word of advice', (items) => items.map((item, index) => (index === 0 ? { ...item, reason: 'Any caller can delete an order, which the handler should refuse.' } : item)), (lines) => expect(lines.join('\n')).toContain('"should" is a word of advice')],
    ['a reason is empty', (items) => items.map((item, index) => (index === 0 ? { ...item, reason: '  ' } : item)), (lines) => expect(lines.join('\n')).toContain('reason: must be a non-empty string')],
    ['an item has a key the part does not have: the key of a group whose statement changed', (items) => items.map((item, index) => (index === 0 ? { ...item, key: item.key.replace(/@.{16}$/, '@0000000000000000') } : item)), (lines) => expect(lines.join('\n')).toContain('is not a group of this part')],
  ];
  for (const [name, edit, expectLines] of REJECTED) {
    it(`exits 1, records failed and writes no priority file when ${name}`, () => {
      const run = withPart(edit);
      const result = run.run('check-priority');
      expect(result.status, result.stdout).toBe(1);
      expectLines(result.lines);
      expect(result.lines.at(-1)).toBe('Next: delete the part file of part 1, mark priority dispatched and re-dispatch the ranking lane once for part 1 with the lines above (attempt 2 of 2)');
      expect(run.readState().priority).toMatchObject({ status: 'failed', attempts: 1, failure: { step: 'check-entry' } });
      expect(() => run.readJson('entries/priority.json')).toThrow();
    });
  }

  it('exits 1 for a part file that is missing, and for one that is not JSON', () => {
    const run = verifiedFindingsRun(cleanups);
    run.run('mark', 'priority', 'dispatched');
    const missing = run.run('check-priority');
    expect(missing.status).toBe(1);
    expect(missing.lines[0]).toBe('part 1: lane-wrote-nothing: priority/part-1.json is missing');
    run.writePart(1, []);
    expect(run.run('check-priority').status).toBe(1);
  });

  it('stays failed after the second attempt: the Next line says so', () => {
    const run = withPart((items) => items.slice(1));
    expect(run.run('check-priority').status).toBe(1);
    expect(run.run('mark', 'priority', 'dispatched').lines).toEqual(['priority: dispatched, attempts 2']);
    const second = run.run('check-priority');
    expect(second.status).toBe(1);
    expect(second.lines.at(-1)).toBe('Next: priority stays failed (2 of 2 attempts)');
    expect(run.run('mark', 'priority', 'dispatched').lines).toEqual(['priority: attempts is already 2, the most a lane gets']);
  });

  it('names exactly the parts that failed when there are several', () => {
    const run = verifiedFindingsRun(cleanups);
    run.runSized(3, 'mark', 'priority', 'dispatched');
    run.writeGoodParts(3);
    run.writePart(2, []);
    const result = run.runSized(3, 'check-priority');
    expect(result.status).toBe(1);
    expect(result.lines.at(-1)).toContain('for part 2 with the lines above');
    expect(result.lines.at(-1)).not.toContain('part 1');
  });

  it('does not check again a ranking the judges settled for these groups: it says so and keeps the verdicts', () => {
    const run = checkedPriorityRun(cleanups);
    judgeAll(run, () => 'follows');
    const before = readFileSync(join(run.out, 'state.json'), 'utf-8');
    const result = run.run('check-priority');
    expect(result.status).toBe(0);
    expect(result.lines).toEqual(['priority: verified, unchanged since it was verified']);
    expect(readFileSync(join(run.out, 'state.json'), 'utf-8')).toBe(before);
  });

  it('prints a note and records nothing when no finding is verified', () => {
    const run = verifiedFindingsRun(cleanups);
    const state = run.readState();
    state.findings = {};
    run.writeJson(join(run.out, 'state.json'), state);
    const result = run.run('check-priority');
    expect(result.status).toBe(0);
    expect(result.lines).toEqual(['Priority: no verified findings; nothing to check']);
    expect(run.readState().priority).toBeUndefined();
  });
});

describe('the state of the unit', () => {
  it('has no key before the first dispatch (planned, no migration) and records the dispatch with the digest of the groups', () => {
    const run = verifiedFindingsRun(cleanups);
    expect(run.readState().priority).toBeUndefined();
    expect(run.run('mark', 'priority', 'dispatched').lines).toEqual(['priority: dispatched, attempts 1']);
    const entry = run.readState().priority;
    expect(entry).toMatchObject({ status: 'dispatched', attempts: 1 });
    expect(entry.groupsDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records a lane that wrote nothing as failed and keeps the digest, so the next dispatch is the second attempt', () => {
    const run = verifiedFindingsRun(cleanups);
    run.run('mark', 'priority', 'dispatched');
    expect(run.run('mark', 'priority', 'failed', 'lane', 'no file').lines).toEqual(['priority: failed at lane: no file']);
    expect(run.run('mark', 'priority', 'dispatched').lines).toEqual(['priority: dispatched, attempts 2']);
  });

  it('refuses a dispatch for groups that are already ranked, and starts over when the groups are not the ones it was recorded for', () => {
    const run = checkedPriorityRun(cleanups);
    expect(run.run('mark', 'priority', 'dispatched').lines).toEqual(['priority: already checked for these groups; it is not ranked again']);
    const state = run.readState();
    state.priority.groupsDigest = '0'.repeat(64);
    run.writeJson(join(run.out, 'state.json'), state);
    expect(run.run('mark', 'priority', 'dispatched').lines).toEqual(['priority: dispatched, attempts 1']);
    expect(run.readState().priority.unranked).toBeUndefined();
    expect(() => run.readJson('priority/part-1.json')).toThrow();
  });

  it('refuses a state whose priority entry is malformed', () => {
    const run = verifiedFindingsRun(cleanups);
    const state = run.readState();
    state.priority = { status: 'verified', attempts: 1, unranked: [{ key: 'k' }] };
    run.writeJson(join(run.out, 'state.json'), state);
    const result = run.run('priority-items');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('priority has an unranked list that is not [{ key, reasons }]');
  });
});

describe('priority-items on a settled or checked ranking', () => {
  it('a settled ranking prints a note: the ranking is current, so nothing is ranked again', () => {
    const run = checkedPriorityRun(cleanups);
    judgeAll(run);
    expect(run.run('priority-items').lines).toEqual(['Priority: verified (4 groups); nothing to rank']);
  });

  it('for a checked ranking, priority-items prints the note that there is nothing to rank', () => {
    const run = checkedPriorityRun(cleanups);
    expect(run.run('priority-items').lines).toEqual(['Priority: checked (4 groups); nothing to rank']);
  });
});

describe('the language of a reason', () => {
  /** A run in a language with its own script (the marker is two CJK letters) whose one findings unit is verified: one group. */
  function chineseRun() {
    const run = withPriorityHelpers(withFindingsHelpers(makeRun()));
    cleanups.push(run.cleanup);
    run.writeJson(join(run.out, 'ui.json'), translatedUi('Chinese'));
    run.writeMap(markedMap(run.map, 'Chinese'));
    expect(run.run('check-map').status).toBe(0);
    const doc = goodFindings('F3');
    doc.findings[0].text = `${MARK}one fixed time of day`;
    run.writeFindings('F3', doc);
    expect(run.run('check-findings', unitId('F3')).status).toBe(0);
    verifyChecked(run, unitId('F3'));
    run.allKeys = run.keys();
    expect(run.allKeys).toHaveLength(1);
    return run;
  }
  const LANGUAGE_LINE = "written only in ASCII letters; the run's language is Chinese; write it in that language (labels quoted from the source stay as they are)";

  it('check-priority refuses a reason written only in ASCII letters, and accepts one that holds a letter of the language', () => {
    const run = chineseRun();
    run.run('mark', 'priority', 'dispatched');
    run.writePart(1, [{ key: run.allKeys[0], consequence: 'notification', reason: 'One fixed time of day for everyone.' }]);
    const bad = run.run('check-priority');
    expect(bad.status, bad.stdout).toBe(1);
    expect(bad.lines).toContain(`part 1: ${run.allKeys[0]}.reason: ${LANGUAGE_LINE}`);
    run.writePart(1, [{ key: run.allKeys[0], consequence: 'notification', reason: `${MARK}one fixed time of day` }]);
    expect(run.run('check-priority').status).toBe(0);
  });

});
