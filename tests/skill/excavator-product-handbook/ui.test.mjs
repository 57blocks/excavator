// Oracle O5 (check-ui half) of openspec change product-handbook-map: the
// fixed-text table is held to the shipped English table. Missing key, extra
// key, lost placeholder and empty value are each rejected; a translation that
// keeps keys and placeholders passes. Non-English text is built from code
// points so that this file holds only ASCII.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { SHIPPED_UI, clone, makeRun, runHandbook } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const shipped = () => JSON.parse(readFileSync(SHIPPED_UI, 'utf-8'));
const cjk = (...points) => String.fromCodePoint(...points);

function newRun(language = 'English') {
  const run = makeRun();
  cleanups.push(run.cleanup);
  const map = clone(run.map);
  map.language = language;
  run.writeMap(map);
  return run;
}

/** A translation of the shipped table: every value is the English one with its words replaced by `word`, placeholders kept. */
function translated(word) {
  const table = shipped();
  table.language = 'Chinese';
  for (const [key, value] of Object.entries(table.strings)) {
    table.strings[key] = value.replace(/[A-Za-z][A-Za-z ]*[A-Za-z]|[A-Za-z]/g, (piece, offset, whole) => (whole[offset - 1] === '{' ? piece : word));
  }
  return table;
}

// check-ui takes no --project: just <out>.
const ui = (run) => runHandbook(['check-ui', run.out]);

describe('the shipped English table', () => {
  it('has the format, the language, and md.* and page.* keys with non-empty values', () => {
    const table = shipped();
    expect(table.format).toBe('excavator-product-handbook-ui/1');
    expect(table.language).toBe('English');
    const keys = Object.keys(table.strings);
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      expect(key).toMatch(/^(md|page)\.[A-Za-z.]+$/);
      expect(typeof table.strings[key]).toBe('string');
      expect(table.strings[key].trim()).not.toBe('');
    }
    expect(Object.keys(table)).toEqual(['format', 'language', 'strings']);
  });

  it('holds only ASCII (the source carries no non-English text)', () => {
    expect(readFileSync(SHIPPED_UI, 'utf-8')).toMatch(/^[\x00-\x7f]*$/);
  });
});

describe('check-ui for an English run', () => {
  it('writes ui.json as a copy of the shipped table when it is missing', () => {
    const run = newRun('English');
    expect(existsSync(join(run.out, 'ui.json'))).toBe(false);
    const result = ui(run);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(run.out, 'ui.json'), 'utf-8'))).toEqual(shipped());
  });

  it('matches the language name in any case', () => {
    const run = newRun('ENGLISH');
    expect(ui(run).status).toBe(0);
    expect(existsSync(join(run.out, 'ui.json'))).toBe(true);
  });

  it('checks an existing ui.json instead of overwriting it', () => {
    const run = newRun('English');
    const table = shipped();
    delete table.strings['md.title'];
    run.writeJson(join(run.out, 'ui.json'), table);
    const result = ui(run);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('ui.json: missing key "md.title"');
    expect(JSON.parse(readFileSync(join(run.out, 'ui.json'), 'utf-8')).strings['md.title']).toBeUndefined();
  });
});

describe('check-ui for another language: each rejection, then the good table', () => {
  function rejects(name, mutate, expected) {
    it(name, () => {
      const run = newRun('Chinese');
      const bad = translated(cjk(0x6587));
      mutate(bad);
      run.writeJson(join(run.out, 'ui.json'), bad);
      const result = ui(run);
      expect(result.status, result.stdout).toBe(1);
      expect(result.stdout).toContain(expected);
      run.writeJson(join(run.out, 'ui.json'), translated(cjk(0x6587)));
      const good = ui(run);
      expect(good.status, good.stdout).toBe(0);
    });
  }

  rejects('a missing key', (table) => {
    delete table.strings['md.table.field'];
  }, 'ui.json: missing key "md.table.field"');

  rejects('an extra key', (table) => {
    table.strings['md.table.extra'] = cjk(0x6587);
  }, 'ui.json: unexpected key "md.table.extra"');

  rejects('a lost placeholder', (table) => {
    table.strings['md.who.item'] = `${cjk(0x6587)}: {role}`;
  }, 'ui.json: md.who.item: lost the placeholder {can}');

  rejects('a placeholder that the English text does not have', (table) => {
    table.strings['md.who.item'] = '{role}: {can} {more}';
  }, 'ui.json: md.who.item: has the placeholder {more}, which the English text does not');

  rejects('an empty value', (table) => {
    table.strings['md.title'] = '';
  }, 'ui.json: md.title: the value must be a non-empty string');

  rejects('a value that is only white space', (table) => {
    table.strings['md.title'] = '   ';
  }, 'ui.json: md.title: the value must be a non-empty string');

  rejects('a value that is not a string', (table) => {
    table.strings['md.title'] = 7;
  }, 'ui.json: md.title: the value must be a non-empty string');

  rejects('a wrong format', (table) => {
    table.format = 'excavator-product-handbook-ui/2';
  }, 'ui.json: format: must be "excavator-product-handbook-ui/1"');

  rejects('a missing language', (table) => {
    delete table.language;
  }, 'ui.json: (top level): missing key "language"');

  it('prints every problem, not just the first', () => {
    const run = newRun('Chinese');
    const bad = translated(cjk(0x6587));
    delete bad.strings['md.title'];
    bad.strings['md.who.item'] = 'x';
    bad.strings['md.coverage.heading'] = '';
    run.writeJson(join(run.out, 'ui.json'), bad);
    expect(ui(run).lines).toHaveLength(4);
  });

  it('refuses a run in another language that has no ui.json: nothing is copied from English', () => {
    const run = newRun('Chinese');
    const result = ui(run);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/ui\.json is missing; the run's language is Chinese/);
    expect(existsSync(join(run.out, 'ui.json'))).toBe(false);
  });

  it('is a usage error without map.json', () => {
    const run = makeRun();
    cleanups.push(run.cleanup);
    expect(ui(run).status).toBe(2);
    rmSync(run.out, { recursive: true });
    expect(ui(run).status).toBe(2);
  });
});
