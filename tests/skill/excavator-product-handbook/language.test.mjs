// The narrative language check of openspec change product-handbook-map (design
// D12): a run in a language with its own script refuses model-written text
// of the map that holds no letter outside ASCII, in check-map and, through the
// same check, select. Non-ASCII text is built from code points so that this
// file holds only ASCII.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { cjk, latinUi, makeRun, markedMap, set, translatedUi } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

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

  it('is also what select builds on: a map spoiled after check-map is refused with the same line', () => {
    const run = newRun();
    const map = run.readJson('map.json');
    set(map, 'unassigned.0.reason', 'A health check that no reader uses.');
    run.writeMap(map);
    const selected = run.run('select', '--features', 'F1');
    expect(selected.lines).toEqual([`unassigned[0].reason: ${WRONG('Chinese')}`]);
  });
});

describe('the language check: which runs are checked', () => {
  const englishMap = (run) => run.run('check-map');

  it('does not check a run in a language written in Latin letters (fewer than half of the fixed texts hold a letter outside ASCII)', () => {
    const run = makeRun();
    cleanups.push(run.cleanup);
    const ui = latinUi('French');
    run.writeJson(join(run.out, 'ui.json'), ui);
    const accented = Object.values(ui.strings).filter((value) => /[^\x00-\x7f]/.test(value)).length;
    expect(accented * 2).toBeLessThan(Object.keys(ui.strings).length);
    expect(accented).toBeGreaterThan(0);
    // English text, as it came from the lane: not refused.
    run.writeMap({ ...run.map, language: 'French' });
    expect(englishMap(run).status).toBe(0);
  });

  it('checks a run once half of the fixed texts hold such a letter', () => {
    const run = makeRun();
    cleanups.push(run.cleanup);
    run.writeJson(join(run.out, 'ui.json'), translatedUi('French', (index) => (index % 2 === 0 ? cjk(0xe9) : '')));
    run.writeMap({ ...run.map, language: 'French' });
    expect(englishMap(run).lines).toContain(`unassigned[0].reason: ${WRONG('French')}`);
  });

  it('does not check an English run, and needs no ui.json for it', () => {
    const run = makeRun();
    cleanups.push(run.cleanup);
    run.writeMap();
    expect(englishMap(run).status).toBe(0);
    expect(existsSync(join(run.out, 'ui.json'))).toBe(false);
  });

  it('judges the run by the language name in map.json: english in any case is English', () => {
    const run = makeRun();
    cleanups.push(run.cleanup);
    run.writeMap({ ...run.map, language: 'english' });
    expect(englishMap(run).status).toBe(0);
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

  it('a ui.json that fails check-ui is refused with its first problem named', () => {
    const run = newRun();
    const table = run.readJson('ui.json');
    delete table.strings['md.title'];
    run.writeJson(join(run.out, 'ui.json'), table);
    const result = run.run('check-map');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('ui.json: missing key "md.title"; the narrative language check of a Chinese run needs a checked ui.json');
  });
});
