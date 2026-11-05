// O1 (locations) of openspec change handbook-entities-and-views: the file and
// line range shown next to an item of the technical view are the ones the
// citation check locates, from the same function (locate.mjs), and a
// citation that cannot be located is listed, not dropped.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildLocations } from '../../../skills/excavator-product-handbook/lib/locations.mjs';
import { locatePassage } from '../../../skills/excavator-product-handbook/lib/locate.mjs';
import { clone, makeRun } from './helpers.mjs';
import { goodOverview } from './overview-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const FORM = 'src/forms/order-form.js';

function runWith(adjust) {
  const run = makeRun();
  cleanups.push(run.cleanup);
  const entry = clone(run.entry);
  adjust?.(entry);
  return { run, entry };
}

const ui = () => JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;

function locationsFor(run, entry, extra = {}) {
  const entries = new Map([['F1', entry]]);
  for (const [id, value] of Object.entries(extra)) entries.set(id, value);
  return buildLocations({ map: run.map, entries, ui: ui() }, run.root);
}

describe('locations: the technical view\'s file and line range of each cited item', () => {
  it('gives each item that carries evidence its claim and, for each citation, the file and the first and last line', () => {
    const { run, entry } = runWith();
    const [unit] = locationsFor(run, entry);
    expect(unit.id).toBe('F1');
    const purpose = unit.items.find((item) => item.claim === 'Purpose > Staff place new orders for customers.');
    expect(purpose.citations).toEqual([{ file: FORM, startLine: 3, endLine: 3 }]);
    const nameField = unit.items.find((item) => item.claim.endsWith('Field: Customer Name'));
    expect(nameField.citations).toEqual([{ file: FORM, startLine: 5, endLine: 5 }]);
    const upload = unit.items.find((item) => item.claim.endsWith('An upload may hold up to 100,000 bytes.'));
    expect(upload.citations).toEqual([{ file: FORM, startLine: 9, endLine: 9 }]);
  });

  it('gives a passage that spans lines its first and last line', () => {
    const { run, entry } = runWith();
    entry.states[0].evidence = [{ file: FORM, passage: "const MAX_UPLOAD = 100_000;\nconst statuses = ['Draft', 'Submitted'];" }];
    const [unit] = locationsFor(run, entry);
    const state = unit.items.find((item) => item.claim.startsWith('State: Draft'));
    expect(state.citations).toEqual([{ file: FORM, startLine: 9, endLine: 10 }]);
  });

  it('is the range locatePassage gives for every citation of every item: one locating function, not a second', () => {
    const { run, entry } = runWith();
    const [unit] = locationsFor(run, entry);
    const cited = [];
    const walk = (value) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === 'object') {
        if (typeof value.file === 'string' && typeof value.passage === 'string') cited.push(value);
        Object.values(value).forEach(walk);
      }
    };
    walk(entry);
    const rangeOf = (citation) => {
      const found = locatePassage(readFileSync(join(run.root, citation.file), 'utf-8'), citation.passage);
      expect(found, citation.passage).not.toBeNull();
      return `${citation.file}:${found.startLine}-${found.endLine}`;
    };
    const listed = unit.items.flatMap((item) => item.citations).map((row) => `${row.file}:${row.startLine}-${row.endLine}`);
    expect(cited.length).toBeGreaterThan(8);
    expect(listed.sort()).toEqual(cited.map(rangeOf).sort());
  });

  it('lists a citation whose passage cannot be located with no lines, instead of dropping it', () => {
    const { run, entry } = runWith();
    entry.purpose.evidence = [{ file: FORM, passage: 'this text is not in the file' }];
    const [unit] = locationsFor(run, entry);
    const purpose = unit.items.find((item) => item.claim.startsWith('Purpose'));
    expect(purpose.citations).toEqual([{ file: FORM, startLine: null, endLine: null }]);
  });

  it('has no row for an item without evidence (an operation name, an unknown)', () => {
    const { run, entry } = runWith();
    const [unit] = locationsFor(run, entry);
    expect(unit.items.some((item) => item.claim.includes('Place an order') && item.citations.length === 0)).toBe(false);
    expect(unit.items.every((item) => item.citations.length > 0)).toBe(true);
  });

  it('puts the verified features in map order and the system overview last, under the id overview', () => {
    const { run, entry } = runWith();
    const overview = clone(goodOverview());
    const second = clone(entry);
    second.id = 'F3';
    const units = locationsFor(run, entry, { overview, F3: second });
    expect(units.map((unit) => unit.id)).toEqual(['F1', 'F3', 'overview']);
  });
});
