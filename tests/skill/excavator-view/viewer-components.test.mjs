/** The shared sort and paging functions of the product pages, run in Node through `vm`. */

import { describe, expect, it } from 'vitest';

import { load } from './viewer-load.mjs';

const { table } = load();
const plain = (value) => JSON.parse(JSON.stringify(value));

// A small seeded generator, so a failing case can be replayed.
function random(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('sortRows', () => {
  const rows = [{ n: 'b', v: 2 }, { n: 'a', v: 10 }, { n: 'c', v: null }, { n: 'd', v: 2 }, { n: 'e', v: 1 }];

  it('sorts numbers by value, not as text', () => {
    expect(table.sortRows(rows, (r) => r.v, 1).map((r) => r.n)).toEqual(['e', 'b', 'd', 'a', 'c']);
    expect(table.sortRows(rows, (r) => r.v, -1).map((r) => r.n)).toEqual(['a', 'b', 'd', 'e', 'c']);
  });

  it('puts rows without a key last in both directions and keeps equal keys in their order', () => {
    const none = [{ k: null, i: 0 }, { k: 'x', i: 1 }, { k: undefined, i: 2 }, { k: 'x', i: 3 }];
    expect(table.sortRows(none, (r) => r.k, 1).map((r) => r.i)).toEqual([1, 3, 0, 2]);
    expect(table.sortRows(none, (r) => r.k, -1).map((r) => r.i)).toEqual([1, 3, 0, 2]);
  });

  it('sorts text by code unit and leaves the input alone', () => {
    const input = [{ s: 'b' }, { s: 'B' }, { s: 'a' }];
    const copy = plain(input);
    expect(table.sortRows(input, (r) => r.s, 1).map((r) => r.s)).toEqual(['B', 'a', 'b']);
    expect(plain(input)).toEqual(copy);
  });

  it('puts numbers before text when a column mixes them', () => {
    expect(table.sortRows([{ k: 'x' }, { k: 3 }, { k: 'a' }, { k: 1 }], (r) => r.k, 1).map((r) => r.k)).toEqual([1, 3, 'a', 'x']);
  });

  it('keeps every row exactly once, over random rows', () => {
    const next = random(7);
    for (let round = 0; round < 50; round++) {
      const input = Array.from({ length: Math.floor(next() * 60) }, (_, i) => ({ i, k: next() < 0.2 ? null : Math.floor(next() * 5) }));
      for (const dir of [1, -1]) {
        const out = table.sortRows(input, (r) => r.k, dir);
        expect(out.map((r) => r.i).sort((a, b) => a - b)).toEqual(input.map((r) => r.i));
        const keys = out.map((r) => r.k).filter((k) => k !== null);
        expect(keys).toEqual([...keys].sort((a, b) => (a - b) * dir));
      }
    }
  });
});

describe('pageBounds and footerText', () => {
  it('describes the first, a middle and the last page', () => {
    expect(table.pageBounds(450, 1, 200)).toEqual({ page: 1, pages: 3, from: 1, to: 200, total: 450 });
    expect(table.pageBounds(450, 2, 200)).toEqual({ page: 2, pages: 3, from: 201, to: 400, total: 450 });
    expect(table.pageBounds(450, 3, 200)).toEqual({ page: 3, pages: 3, from: 401, to: 450, total: 450 });
  });

  it('fills a page exactly without starting an empty one', () => {
    expect(table.pageBounds(400, 2, 200)).toEqual({ page: 2, pages: 2, from: 201, to: 400, total: 400 });
    expect(table.pageBounds(200, 1, 200)).toMatchObject({ pages: 1, from: 1, to: 200 });
    expect(table.pageBounds(201, 2, 200)).toMatchObject({ pages: 2, from: 201, to: 201 });
  });

  it('clamps a page that is out of range, and has no rows to show when there are none', () => {
    expect(table.pageBounds(450, 99, 200).page).toBe(3);
    expect(table.pageBounds(450, 0, 200).page).toBe(1);
    expect(table.pageBounds(450, -4, 200).page).toBe(1);
    expect(table.pageBounds(450, NaN, 200).page).toBe(1);
    expect(table.pageBounds(0, 5, 200)).toEqual({ page: 1, pages: 1, from: 0, to: 0, total: 0 });
  });

  it('writes the footer with an en dash and grouped digits', () => {
    const dash = String.fromCharCode(0x2013);
    expect(table.footerText(table.pageBounds(5019, 1, 200))).toBe(`Rows 1${dash}200 of 5,019`);
    expect(table.footerText(table.pageBounds(5019, 26, 200))).toBe(`Rows 5,001${dash}5,019 of 5,019`);
    expect(table.footerText(table.pageBounds(0, 1, 200))).toBe('No rows');
  });

  it('covers every row exactly once across the pages, over random sizes', () => {
    const next = random(11);
    for (let round = 0; round < 200; round++) {
      const total = Math.floor(next() * 1000);
      const size = 1 + Math.floor(next() * 250);
      const first = table.pageBounds(total, 1, size);
      let covered = 0;
      let last = 0;
      for (let page = 1; page <= first.pages; page++) {
        const b = table.pageBounds(total, page, size);
        if (total > 0) {
          expect(b.from).toBe(last + 1);
          expect(b.to).toBeGreaterThanOrEqual(b.from);
          expect(b.to - b.from + 1).toBeLessThanOrEqual(size);
          covered += b.to - b.from + 1;
          last = b.to;
        }
      }
      expect(covered).toBe(total);
    }
  });
});

describe('cellContent', () => {
  const fakeDocument = {
    createElement: (tag) => {
      const el = { tag, attributes: {}, children: [] };
      el.setAttribute = (name, value) => { el.attributes[name] = value; };
      el.appendChild = (child) => { el.children.push(child); return child; };
      el.addEventListener = () => {};
      return el;
    },
    createTextNode: (text) => ({ text }),
  };
  const XV = load({ document: fakeDocument });

  it('shows a missing value as a muted dash, the same everywhere', () => {
    for (const missing of [null, undefined, '', XV.EMPTY, XV.formatNumber(null)]) {
      const el = XV.cellContent(missing);
      expect(el.attributes.class).toBe('xv-muted');
      expect(el.children).toEqual([{ text: String.fromCharCode(0x2014) }]);
    }
  });

  it('leaves any other value alone, including 0 and text that looks empty', () => {
    expect(XV.cellContent(0)).toBe(0);
    expect(XV.cellContent('0')).toBe('0');
    expect(XV.cellContent('n/a')).toBe('n/a');
    const node = { tag: 'a' };
    expect(XV.cellContent(node)).toBe(node);
  });
});

describe('the product state cards', () => {
  const fakeDocument = {
    createElement: (tag) => {
      const el = { tag, attributes: {}, children: [] };
      el.setAttribute = (name, value) => { el.attributes[name] = value; };
      el.appendChild = (child) => { el.children.push(child); return child; };
      el.addEventListener = () => {};
      return el;
    },
    createTextNode: (text) => ({ text }),
  };
  const XV = load({ document: fakeDocument });
  const flat = (node) => (node === null || node === undefined ? [] : node.text !== undefined ? [node.text] : (node.children || []).flatMap(flat));

  it('says a product was not run and gives its command', () => {
    const card = XV.unavailableCard({ status: 'not-run', label: 'Hotspots', file: 'hotspots.json', command: '/excavator-hotspots' });
    expect(flat(card).join('|')).toContain('Hotspots: not run');
    expect(flat(card).join('|')).toContain('There is no hotspots.json in .excavator/.');
    expect(flat(card)).toContain('/excavator-hotspots');
  });

  it('says why a product is unreadable', () => {
    const card = XV.unavailableCard({ status: 'unreadable', label: 'Unused code', reason: 'unused-code.json is not valid JSON' });
    expect(flat(card)).toContain('unused-code.json is not valid JSON');
  });

  it('gives no card for a product that can be shown, and a banner only for another revision', () => {
    expect(XV.unavailableCard({ status: 'included' })).toBeNull();
    expect(XV.unavailableCard({ status: 'different-revision' })).toBeNull();
    const manifest = { snapshot: { revision: 'git:new' } };
    expect(XV.revisionBanner(manifest, { status: 'included' })).toBeNull();
    expect(XV.revisionBanner(manifest, null)).toBeNull();
    const banner = XV.revisionBanner(manifest, { status: 'different-revision', label: 'Unused code', revision: 'git:old' });
    expect(flat(banner)).toEqual(expect.arrayContaining(['Unused code: different revision', 'git:old', 'git:new']));
  });
});
