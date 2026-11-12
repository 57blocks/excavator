// Oracle O1 of openspec change handbook-free-chapter, fact-sheet half: a /3 entry has
// the keys of the fact sheet only and is checked together with its chapter; the /2 checks
// (citations, labels, numbers, roles, handoffs, transitions, banned words) carry over;
// a new /2 entry is refused with a line that says new entries are /3; a verified /2 entry
// still loads and assembles.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { entryShapeProblems } from '../../../skills/excavator-product-handbook/lib/entry-shape.mjs';
import { FORM, GOOD_CHAPTER, GOOD_COUNTS, NO_NOTES, goodEntryV3 } from './chapter-fixture.mjs';
import { clone, makeCheckedMapRun, runHandbook, verifyChecked } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const NO_LEGACY = { env: { EXCAVATOR_HANDBOOK_ALLOW_V2_ENTRY: '' } };
const ev = (file, passage) => ({ file, passage });

function newRun() {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  run.writeChapter = (text = GOOD_CHAPTER, id = 'F1') => {
    mkdirSync(join(run.out, 'chapters'), { recursive: true });
    writeFileSync(join(run.out, 'chapters', `${id}.md`), text);
  };
  run.strict = (command, ...args) => runHandbook([command, run.out, ...args, '--project', run.root], NO_LEGACY);
  return run;
}

/** A bad /3 entry (the good one through `mutate`) must fail check-entry with `expected`; the good one then passes. */
function rejects(name, mutate, expected) {
  it(name, () => {
    const run = newRun();
    run.writeChapter();
    const entry = goodEntryV3();
    mutate(entry);
    run.writeEntry('F1', entry);
    const bad = run.strict('check-entry', 'F1');
    expect(bad.status, `${bad.stdout}${bad.stderr}`).toBe(1);
    expect(bad.stdout).toMatch(expected);
    run.writeEntry('F1', goodEntryV3());
    const good = run.strict('check-entry', 'F1');
    expect(good.status, `${good.stdout}${good.stderr}`).toBe(0);
  });
}

describe('a /3 entry with its chapter', () => {
  it('passes check-entry, prints the chapter counts and records the items with the text of their lines', () => {
    const run = newRun();
    run.writeChapter();
    run.writeEntry('F1', goodEntryV3());
    const result = run.strict('check-entry', 'F1');
    expect(result.lines).toEqual(['F1: checked', GOOD_COUNTS, NO_NOTES]);
    expect(result.status).toBe(0);
    const record = run.readJson('state.json').features.F1;
    expect(record.status).toBe('checked');
    const sentence = record.chapter.items.find((item) => item.text.startsWith('The clerk fills in'));
    expect(sentence.id).toBe('chapter.3');
    expect(sentence.kind).toBe('sentence');
    expect(sentence.claim).toBe('Orders > Placing an order: The clerk fills in the \u201cCustomer Name\u201d field.');
    expect(sentence.cites).toEqual([{ file: FORM, lines: [5, 5], passage: "    { label: 'Customer Name', required: true }," }]);
    const arrow = record.chapter.items.find((item) => item.kind === 'arrow');
    expect(arrow.cites[0].lines).toEqual([3, 6]);
    expect(arrow.cites[0].passage.split('\n')).toHaveLength(4);
    const heading = record.chapter.items.find((item) => item.text === '# Orders');
    expect(heading.cites.length).toBeGreaterThan(0);
  });

  it('try-entry runs the same checks for the lane and records nothing', () => {
    const run = newRun();
    run.writeChapter();
    run.writeEntry('F1', goodEntryV3());
    const result = run.strict('try-entry', 'F1');
    expect(result.lines).toEqual(['F1: ok', GOOD_COUNTS, NO_NOTES]);
    expect(run.readJson('state.json').features.F1).toEqual({ status: 'planned', attempts: 0 });
  });

  it('fails when the chapter is missing, and says so', () => {
    const run = newRun();
    run.writeEntry('F1', goodEntryV3());
    for (const command of ['check-entry', 'try-entry']) {
      const result = run.strict(command, 'F1');
      expect(result.status, command).toBe(1);
      expect(result.stdout, command).toMatch(/chapters\/F1\.md: chapter missing/);
    }
    expect(run.readJson('state.json').features.F1.status).toBe('failed');
  });

  it('fails the entry on a bad chapter, and prints the lines of both files in one run', () => {
    const run = newRun();
    run.writeChapter(`${GOOD_CHAPTER}\nA sentence with no citation.\n`);
    const entry = goodEntryV3();
    entry.states[0].label = 'Pending';
    run.writeEntry('F1', entry);
    for (const command of ['check-entry', 'try-entry']) {
      const result = run.strict(command, 'F1');
      expect(result.status, command).toBe(1);
      expect(result.stdout, command).toMatch(/states\[0\]\.label: label "Pending" does not occur/);
      expect(result.stdout, command).toMatch(/chapters\/F1\.md line \d+: uncited sentence/);
    }
  });

  it('records the content notes with the items, and a note does not fail the entry', () => {
    const run = newRun();
    run.writeChapter(GOOD_CHAPTER.replace('limited to 35000', 'limited to 36000'));
    run.writeEntry('F1', goodEntryV3());
    const result = run.strict('check-entry', 'F1');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('F1: checked');
    expect(result.stdout).toMatch(/note: chapter\.4 \(sentence, line 5\) number: number 36000/);
    const notes = run.readJson('state.json').features.F1.chapter.notes;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: 'chapter.4', kind: 'number' });
    expect(notes[0].detail).toMatch(/number 36000 does not occur/);
  });

  rejects('an operations key, with a line that says operations belong in the chapter', (entry) => {
    entry.operations = [];
  }, /\(top level\): unexpected key "operations"; what the fact sheet does not list \(operations, fields, steps, rules\) belongs in the chapter/);

  rejects('fields on a screen', (entry) => {
    entry.screens[0].fields = [];
  }, /screens\[0\]: unexpected key "fields"; .*belongs in the chapter/);

  rejects('any other key', (entry) => {
    entry.mood = 'cheerful';
  }, /\(top level\): unexpected key "mood"; .*belongs in the chapter/);

  rejects('a missing key of the sheet', (entry) => {
    delete entry.handoffs;
  }, /\(top level\): missing key "handoffs"/);

  rejects('a role that is not in the map', (entry) => {
    entry.who[0].role = 'Auditor';
  }, /who\[0\]\.role: "Auditor" is not a role in map\.json/);

  rejects('a handoff to a feature that is not in the map', (entry) => {
    entry.handoffs[0].feature = 'F9';
  }, /handoffs\[0\]\.feature: .*F9.*not a feature in map\.json/);

  rejects('a handoff to the feature itself', (entry) => {
    entry.handoffs[0].feature = 'F1';
  }, /handoffs\[0\]\.feature: .*F1.*itself/);

  rejects('a transition state that is not in its passages', (entry) => {
    entry.transitions = [{ from: 'Draft', to: 'Archived', by: 'The clerk sends the order.', evidence: [ev(FORM, "const statuses = ['Draft', 'Submitted'];")] }];
  }, /transitions\[0\]\.to: label "Archived" does not occur/);

  rejects('a number in the text of a handoff that its passage lacks', (entry) => {
    entry.handoffs[0].text = 'Finished orders move to the archive after 90 days.';
  }, /handoffs\[0\]\.text: number 90 does not occur/);

  rejects('a code-shaped word in a handoff', (entry) => {
    entry.handoffs[0].text = 'The archiveOrder call moves them.';
  }, /handoffs\[0\]\.text: "archiveOrder" is not allowed in reader text/);

  rejects('a passage that is not in the file', (entry) => {
    entry.screens[0].evidence[0].passage = 'const MAX_UPLOAD = 9;';
  }, /screens\[0\]\.evidence\[0\]: passage not in src\/forms\/order-form\.js/);

  rejects('an id that is another feature', (entry) => {
    entry.id = 'F2';
  }, /id: "F2" is not "F1"/);

  it('accepts the sheet in the shape check, and reads a settled one without its purpose', () => {
    expect(entryShapeProblems(goodEntryV3())).toEqual([]);
    const settled = goodEntryV3();
    delete settled.purpose;
    expect(entryShapeProblems(settled, { settled: true })).toEqual([]);
    expect(entryShapeProblems(settled).join('\n')).toMatch(/missing key "purpose"/);
  });
});

describe('the older formats are read, not written', () => {
  it('refuses a new /2 entry at check-entry and try-entry with a line that says new entries are /3', () => {
    const run = newRun();
    run.writeEntry('F1', run.entry);
    for (const command of ['check-entry', 'try-entry']) {
      const result = run.strict(command, 'F1');
      expect(result.status, command).toBe(1);
      expect(result.stdout, command).toMatch(/format: "excavator-product-handbook-entry\/2" is not accepted; "excavator-product-handbook-entry\/3" is the format of a new entry .*new entries use \/3/);
    }
  });

  it('still loads a verified /2 entry: check-entry leaves it as it is, and assemble writes it into the handbook', () => {
    const run = newRun();
    run.writeEntry('F1', clone(run.entry));
    expect(run.run('check-entry', 'F1').status).toBe(0);
    verifyChecked(run);
    const again = run.strict('check-entry', 'F1');
    expect(again.lines).toEqual(['F1: verified, unchanged since it was verified']);
    const assembled = run.strict('assemble');
    expect(assembled.status, `${assembled.stdout}${assembled.stderr}`).toBe(0);
    expect(readFileSync(join(run.out, 'handbook.md'), 'utf-8')).toContain('Customer Name');
  });
});
