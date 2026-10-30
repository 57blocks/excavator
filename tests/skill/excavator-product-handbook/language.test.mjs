// The narrative language check of openspec change product-handbook-map (design
// D12): a run in a language with its own script refuses model-written text
// that holds no letter outside ASCII, in check-map, check-entry, try-entry and
// (through their re-checks) assemble and page. Non-ASCII text is built from
// code points so that this file holds only ASCII.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { MARK, cjk, latinUi, makeRun, markedEntry, markedMap, set, translatedUi } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const form = 'src/forms/order-form.js';
const ev = (file, passage) => ({ file, passage });
const WRONG = (language) => `written only in ASCII letters; the run's language is ${language}; write it in that language (labels quoted from the source stay as they are)`;

/** A run whose fixed text is written (`ui`, default a CJK-marked table) and whose marked map passed check-map. */
function newRun({ language = 'Chinese', ui = translatedUi(language), adjustMap } = {}) {
  const run = makeRun();
  cleanups.push(run.cleanup);
  if (ui !== null) run.writeJson(join(run.out, 'ui.json'), ui);
  const map = markedMap(run.map, language);
  adjustMap?.(map);
  run.writeMap(map);
  const checked = run.run('check-map');
  expect(checked.status, `${checked.stdout}${checked.stderr}`).toBe(0);
  return run;
}

const stateText = (run) => readFileSync(join(run.out, 'state.json'), 'utf-8');

describe('the language check: entries of a run in a language with its own script', () => {
  const entryOf = (run) => {
    const entry = markedEntry(run.entry);
    entry.notifications = [{ trigger: `${MARK}When sent`, recipient: `${MARK}The clerk`, channel: `${MARK}Mail`, content: `${MARK}Order sent`, evidence: [ev(form, "title: 'New Order',")] }];
    entry.automatic = [{ when: `${MARK}Every day`, effect: `${MARK}A reminder goes out`, evidence: [ev(form, "title: 'New Order',")] }];
    return entry;
  };

  it('passes the marked entry (labels, screen names, where labels and roles stay in ASCII, as quoted)', () => {
    const run = newRun();
    run.writeEntry('F1', entryOf(run));
    const result = run.run('check-entry', 'F1');
    expect(result.lines).toEqual(['F1: checked']);
    expect(result.status).toBe(0);
  });

  // [json path, how to write the field in English]
  const fields = [
    ['purpose.text', (e) => set(e, 'purpose.text', 'Staff place orders.')],
    ['who[0].can', (e) => set(e, 'who.0.can', 'Create an order.')],
    ['operations[0].name', (e) => set(e, 'operations.0.name', 'Place an order')],
    ['operations[0].sentences[1].text', (e) => set(e, 'operations.0.sentences.1.text', 'The item count is limited.')],
    ['screens[0].fields[1].rules[1].text', (e) => set(e, 'screens.0.fields.1.rules.1.text', 'An upload has a size limit.')],
    ['states[1].meaning', (e) => set(e, 'states.1.meaning', 'The order was sent.')],
    ['notifications[0].trigger', (e) => set(e, 'notifications.0.trigger', 'When it is sent')],
    ['notifications[0].recipient', (e) => set(e, 'notifications.0.recipient', 'The clerk')],
    ['notifications[0].channel', (e) => set(e, 'notifications.0.channel', 'Mail')],
    ['notifications[0].content', (e) => set(e, 'notifications.0.content', 'Order sent')],
    ['automatic[0].when', (e) => set(e, 'automatic.0.when', 'Every day')],
    ['automatic[0].effect', (e) => set(e, 'automatic.0.effect', 'A reminder goes out')],
    ['unknowns[0].item', (e) => set(e, 'unknowns.0.item', 'Who approves a large order')],
    ['unknowns[0].searched', (e) => set(e, 'unknowns.0.searched', 'the order form')],
  ];

  for (const [path, spoil] of fields) {
    it(`refuses ${path} written in English, then accepts it with a letter of the language`, () => {
      const run = newRun();
      const entry = entryOf(run);
      spoil(entry);
      run.writeEntry('F1', entry);
      const bad = run.run('check-entry', 'F1');
      expect(bad.status, bad.stdout).toBe(1);
      expect(bad.lines).toContain(`${path}: ${WRONG('Chinese')}`);
      expect(bad.lines.filter((line) => line.includes('written only in ASCII'))).toHaveLength(1);
      run.writeEntry('F1', entryOf(run));
      expect(run.run('check-entry', 'F1').status).toBe(0);
    });
  }

  it('prints every wrong field, then a Next line, and records the failure with the lines', () => {
    const run = newRun();
    const entry = entryOf(run);
    set(entry, 'purpose.text', 'Staff place orders.');
    set(entry, 'states.0.meaning', 'Not sent yet.');
    run.writeEntry('F1', entry);
    const bad = run.run('check-entry', 'F1');
    expect(bad.lines.slice(0, 2)).toEqual([`purpose.text: ${WRONG('Chinese')}`, `states[0].meaning: ${WRONG('Chinese')}`]);
    expect(bad.lines.at(-1)).toMatch(/^Next: delete F1's entry/);
    expect(run.readJson('state.json').features.F1.failure.reasons).toEqual(bad.lines.slice(0, 2));
  });

  it('exempts text that is only a verified label and digits, and refuses the same text with a word of English', () => {
    const run = newRun();
    const entry = entryOf(run);
    // "Item Count" is the field's own verified label; "35,000" is in the cited line.
    set(entry, 'screens.0.fields.1.rules.0.text', 'Item Count 35,000');
    run.writeEntry('F1', entry);
    expect(run.run('check-entry', 'F1').status).toBe(0);
    set(entry, 'screens.0.fields.1.rules.0.text', 'Item Count max 35,000');
    run.writeEntry('F1', entry);
    const bad = run.run('check-entry', 'F1');
    expect(bad.status).toBe(1);
    expect(bad.lines).toContain(`screens[0].fields[1].rules[0].text: ${WRONG('Chinese')}`);
  });

  it('exempts a map-wide label (a role) in a text with no other letters, but not when English words surround it', () => {
    const run = newRun();
    const entry = entryOf(run);
    set(entry, 'who.0.can', 'Clerk');
    run.writeEntry('F1', entry);
    expect(run.run('check-entry', 'F1').status).toBe(0);
    set(entry, 'who.0.can', 'Clerk can create an order');
    run.writeEntry('F1', entry);
    expect(run.run('check-entry', 'F1').lines).toContain(`who[0].can: ${WRONG('Chinese')}`);
  });

  it('does not take a label of the text as its language: English words next to a label of another script are still English', () => {
    const run = newRun();
    const entry = entryOf(run);
    set(entry, 'states.0.meaning', 'Draft is the first status');
    run.writeEntry('F1', entry);
    expect(run.run('check-entry', 'F1').lines).toContain(`states[0].meaning: ${WRONG('Chinese')}`);
  });

  it('try-entry prints the same lines, a different Next line, and touches no state', () => {
    const run = newRun();
    const entry = entryOf(run);
    set(entry, 'purpose.text', 'Staff place orders.');
    run.writeEntry('F1', entry);
    const before = stateText(run);
    const tried = run.run('try-entry', 'F1');
    expect(tried.status).toBe(1);
    expect(tried.lines[0]).toBe(`purpose.text: ${WRONG('Chinese')}`);
    expect(tried.lines.at(-1)).toMatch(/^Next: fix each line above/);
    expect(stateText(run)).toBe(before);
    const checked = run.run('check-entry', 'F1');
    expect(checked.lines.slice(0, -1)).toEqual(tried.lines.slice(0, -1));
    run.writeEntry('F1', entryOf(run));
    expect(run.run('try-entry', 'F1').lines).toEqual(['F1: ok']);
  });
});

describe('the language check: the map', () => {
  const refuses = (adjust, expectedPath) => {
    const run = newRun();
    const map = markedMap(run.map, 'Chinese');
    adjust(map);
    run.writeMap(map);
    const bad = run.run('check-map');
    expect(bad.status, bad.stdout).toBe(1);
    expect(bad.lines).toEqual([`${expectedPath}: ${WRONG('Chinese')}`]);
    run.writeMap(markedMap(run.map, 'Chinese'));
    expect(run.run('check-map').status).toBe(0);
  };

  it('refuses an unassigned reason in English', () => refuses((map) => set(map, 'unassigned.0.reason', 'A health check that no reader uses.'), 'unassigned[0].reason'));
  it('refuses an area name without evidence in English', () => refuses((map) => set(map, 'areas.1.name', 'Automatic work'), 'areas[1].name'));
  it('refuses a feature name without a label in English', () => refuses((map) => set(map, 'features.2.name', 'Reminders'), 'features[2].name'));

  it('does not check a feature name that sits next to a label, nor an area name with evidence', () => {
    const run = newRun({ adjustMap: (map) => {
      set(map, 'areas.0.name', 'Orders');
      set(map, 'areas.0.evidence', [ev('src/menu.js', "{ label: 'Orders', path: '/orders' },")]);
    } });
    const map = run.readJson('map.json');
    expect(map.features[0].name).toBe('Orders');
    expect(map.areas[0].name).toBe('Orders');
    expect(run.run('check-map').status).toBe(0);
  });

  it('is also what select, assemble and page build on: a map spoiled after check-map is refused with the same line', () => {
    const run = newRun();
    const map = run.readJson('map.json');
    set(map, 'unassigned.0.reason', 'A health check that no reader uses.');
    run.writeMap(map);
    for (const command of ['assemble', 'page']) {
      const result = run.run(command);
      expect(result.status, command).toBe(1);
      expect(result.lines, command).toEqual([`map.json: unassigned[0].reason: ${WRONG('Chinese')}`]);
    }
    const selected = run.run('select', '--features', 'F1');
    expect(selected.lines).toEqual([`unassigned[0].reason: ${WRONG('Chinese')}`]);
  });
});

describe('the language check: assemble and page re-check a checked entry', () => {
  it('refuses an entry that was checked and then changed to English, and writes nothing', () => {
    const run = newRun();
    run.writeEntry('F1', markedEntry(run.entry));
    expect(run.run('check-entry', 'F1').status).toBe(0);
    const entry = markedEntry(run.entry);
    set(entry, 'purpose.text', 'Staff place orders.');
    run.writeEntry('F1', entry);
    for (const command of ['assemble', 'page']) {
      const result = run.run(command);
      expect(result.status, command).toBe(1);
      expect(result.lines, command).toContain(`F1: purpose.text: ${WRONG('Chinese')}`);
      expect(result.lines.at(-1), command).toMatch(/no longer passes check-entry/);
    }
    expect(existsSync(join(run.out, 'handbook.md'))).toBe(false);
    expect(existsSync(join(run.out, 'handbook.html'))).toBe(false);
  });
});

describe('the language check: which runs are checked', () => {
  it('does not check a run in a language written in Latin letters (fewer than half of the fixed texts hold a letter outside ASCII)', () => {
    const run = newRun({ language: 'French', ui: latinUi('French') });
    const accented = Object.values(run.readJson('ui.json').strings).filter((value) => /[^\x00-\x7f]/.test(value)).length;
    expect(accented * 2).toBeLessThan(Object.keys(run.readJson('ui.json').strings).length);
    expect(accented).toBeGreaterThan(0);
    // English text, as it came from the lane: not refused.
    run.writeEntry('F1', run.entry);
    const result = run.run('check-entry', 'F1');
    expect(result.lines).toEqual(['F1: checked']);
  });

  it('checks a run once half of the fixed texts hold such a letter', () => {
    const base = translatedUi('French', (index) => (index % 2 === 0 ? cjk(0xe9) : ''));
    const run = newRun({ language: 'French', ui: base });
    run.writeEntry('F1', run.entry);
    expect(run.run('check-entry', 'F1').lines).toContain(`purpose.text: ${WRONG('French')}`);
  });

  it('does not check an English run, and needs no ui.json for it', () => {
    const run = newRun({ language: 'English', ui: null });
    expect(existsSync(join(run.out, 'ui.json'))).toBe(false);
    run.writeEntry('F1', run.entry);
    expect(run.run('check-entry', 'F1').lines).toEqual(['F1: checked']);
    expect(existsSync(join(run.out, 'ui.json'))).toBe(false);
  });

  it('judges the run by the language name in map.json: english in any case is English', () => {
    const run = newRun({ language: 'english', ui: null });
    run.writeEntry('F1', run.entry);
    expect(run.run('check-entry', 'F1').status).toBe(0);
  });
});

describe('the language check: a run in another language without a usable ui.json', () => {
  const fixedTextLine = /^ui\.json is missing; the run's language is Chinese, so ui\.json must hold the translated table; the narrative language check of a Chinese run needs a checked ui\.json$/;

  it('check-map refuses with one line and a Next line, and creates no state', () => {
    const run = makeRun();
    cleanups.push(run.cleanup);
    run.writeMap(markedMap(run.map, 'Chinese'));
    const result = run.run('check-map');
    expect(result.status).toBe(1);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatch(fixedTextLine);
    expect(result.lines[1]).toMatch(/^Next: write ui\.json first \(the fixed-text phase/);
    expect(existsSync(join(run.out, 'state.json'))).toBe(false);
  });

  it('check-entry and try-entry refuse the same way and record nothing', () => {
    const run = newRun();
    run.writeEntry('F1', markedEntry(run.entry));
    rmSync(join(run.out, 'ui.json'));
    const before = stateText(run);
    for (const command of ['check-entry', 'try-entry']) {
      const result = run.run(command, 'F1');
      expect(result.status, command).toBe(1);
      expect(result.lines, command).toHaveLength(2);
      expect(result.lines[0], command).toMatch(fixedTextLine);
      expect(result.lines[1], command).toMatch(/^Next: write ui\.json first/);
    }
    expect(stateText(run)).toBe(before);
  });

  it('a ui.json that fails check-ui is refused with its first problem named', () => {
    const run = newRun();
    const table = run.readJson('ui.json');
    delete table.strings['md.title'];
    run.writeJson(join(run.out, 'ui.json'), table);
    run.writeEntry('F1', markedEntry(run.entry));
    const result = run.run('check-entry', 'F1');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('ui.json: missing key "md.title"; the narrative language check of a Chinese run needs a checked ui.json');
    expect(run.run('check-map').lines[0]).toBe(result.lines[0]);
  });

  it('assemble, page and reply refuse it too, with the same line', () => {
    const run = newRun();
    run.writeEntry('F1', markedEntry(run.entry));
    expect(run.run('check-entry', 'F1').status).toBe(0);
    rmSync(join(run.out, 'ui.json'));
    for (const command of ['assemble', 'page', 'reply']) {
      const result = run.run(command);
      expect(result.status, command).toBe(1);
      expect(result.lines[0], command).toMatch(fixedTextLine);
    }
  });
});
