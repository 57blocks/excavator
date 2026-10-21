/** The Doc map page's pure functions and its detail panel, run in Node through `vm`. */

import { describe, expect, it } from 'vitest';

import { load } from './viewer-load.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));

function fakeDocument() {
  const trap = (name) => { throw new Error(`${name} was used`); };
  return {
    createElement: (tag) => new Proxy({ tag, attributes: {}, children: [] }, {
      get(target, prop) {
        if (prop === 'setAttribute') return (name, value) => { target.attributes[name] = value; };
        if (prop === 'appendChild') return (child) => { target.children.push(child); return child; };
        if (prop === 'addEventListener') return () => {};
        if (['innerHTML', 'outerHTML', 'insertAdjacentHTML'].includes(prop)) return trap(prop);
        return target[prop];
      },
      set(_target, prop) { return trap(prop); },
    }),
    createTextNode: (text) => ({ text }),
  };
}

const XV = load({ document: fakeDocument() });
const { docmap } = XV;

const evidence = (file, line, code = 'code') => ({ file, line, code });
const unit = (over = {}) => ({
  document: 'a.md', id: 'A', title: 'Submit', quote: 'the quote', line: 10, page: null,
  code: { status: 'found', evidence: [evidence('x.go', 5), evidence('y.go', 7)], searched: [] }, ...over,
});

describe('joinChecks', () => {
  const units = [
    unit(),
    unit({ id: 'B', code: { status: 'found', evidence: [evidence('x.go', 5)], searched: [] } }),
    unit({ id: 'C', code: { status: 'not-found', evidence: [], searched: [{ pattern: 'leave', paths: ['src'] }] } }),
    unit({ id: 'D', code: null }),
  ];
  const checks = [
    { unit: 1, file: 'x.go', line: 5, verdict: 'does', reason: 'creates it' },
    { unit: 1, file: 'y.go', line: 7, verdict: 'not', reason: 'a test' },
    { unit: 2, file: 'x.go', line: 5, verdict: 'none', reason: null },
  ];

  it('gives each piece of evidence the check with the same unit, file and line', () => {
    const { rows, hasChecks, unmatched, duplicates } = docmap.joinChecks(units, checks);
    expect(hasChecks).toBe(true);
    expect(unmatched).toBe(0);
    expect(duplicates).toBe(0);
    expect(plain(rows[0].evidence.map((e) => e.check))).toEqual([{ verdict: 'does', reason: 'creates it' }, { verdict: 'not', reason: 'a test' }]);
    expect(plain(rows[1].evidence[0].check)).toEqual({ verdict: 'none', reason: null });
  });

  it('keeps a check on the unit it names, not on another unit that cites the same place', () => {
    const { rows } = docmap.joinChecks(units, [{ unit: 2, file: 'x.go', line: 5, verdict: 'not', reason: 'r' }]);
    expect(rows[0].evidence[0].check).toBeNull();
    expect(rows[1].evidence[0].check.verdict).toBe('not');
  });

  it('summarises the verdicts of a unit', () => {
    const { rows } = docmap.joinChecks(units, checks);
    expect(rows.map((r) => r.verdictText)).toEqual(['does 1 / not 1 / none 0', 'does 0 / not 0 / none 1', null, null]);
    expect(plain(rows[0].verdicts)).toEqual({ does: 1, not: 1, none: 0, unchecked: 0, other: 0 });
  });

  it('says not checked for evidence that has no check, and counts it beside the others when only some have one', () => {
    const { rows } = docmap.joinChecks(units, [checks[0]]);
    expect(rows[0].verdictText).toBe('does 1 / not 0 / none 0 / not checked 1');
    expect(rows[1].verdictText).toBe('not checked');
  });

  it('shows every unit with evidence as not checked when there are no checks at all', () => {
    const { rows, hasChecks } = docmap.joinChecks(units, null);
    expect(hasChecks).toBe(false);
    expect(rows.map((r) => r.verdictText)).toEqual(['not checked', 'not checked', null, null]);
    expect(rows.flatMap((r) => r.evidence).every((e) => e.check === null)).toBe(true);
  });

  it('counts a check that names no evidence, and a repeated check', () => {
    const { unmatched, duplicates, rows } = docmap.joinChecks(units, [...checks, { unit: 9, file: 'z.go', line: 1, verdict: 'does', reason: 'r' }, { ...checks[0], verdict: 'not' }]);
    expect(unmatched).toBe(1);
    expect(duplicates).toBe(1);
    expect(rows[0].evidence[0].check.verdict).toBe('does');
  });

  it('keeps a verdict it does not know apart from the three it does', () => {
    const { rows } = docmap.joinChecks(units, [{ unit: 2, file: 'x.go', line: 5, verdict: 'maybe', reason: 'r' }]);
    expect(rows[1].verdictText).toBe('does 0 / not 0 / none 0 / other 1');
  });

  it('numbers units from 1 and treats a unit without code as not checked', () => {
    const { rows } = docmap.joinChecks(units, checks);
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.codeStatus)).toEqual(['found', 'found', 'not-found', 'not-checked']);
    expect(rows[3].evidence).toEqual([]);
  });

  it('does not join a line that differs, or a file that differs only by case', () => {
    const { rows, unmatched } = docmap.joinChecks([unit()], [{ unit: 1, file: 'X.go', line: 5, verdict: 'does', reason: 'r' }, { unit: 1, file: 'x.go', line: 6, verdict: 'does', reason: 'r' }]);
    expect(rows[0].verdictText).toBe('not checked');
    expect(unmatched).toBe(2);
  });

  it('copes with a unit that is missing fields', () => {
    const { rows } = docmap.joinChecks([{}], []);
    expect(rows[0]).toMatchObject({ document: null, id: null, title: null, quote: null, line: null, page: null, codeStatus: 'not-checked' });
  });
});

describe('filterUnits', () => {
  const units = [
    unit(),
    unit({ id: 'B', title: 'Approve leave', quote: 'Approve <b>it</b>', code: { status: 'found', evidence: [evidence('x.go', 5)], searched: [] } }),
    unit({ id: 'C', document: 'b.md', code: { status: 'not-found', evidence: [], searched: [] } }),
    unit({ id: 'D', code: null }),
  ];
  const checks = [
    { unit: 1, file: 'x.go', line: 5, verdict: 'does', reason: 'r' },
    { unit: 1, file: 'y.go', line: 7, verdict: 'not', reason: 'r' },
  ];
  const { rows } = docmap.joinChecks(units, checks);
  const ids = (list) => list.map((r) => r.id);

  it('keeps every unit when nothing is chosen', () => {
    expect(ids(docmap.filterUnits(rows, {}))).toEqual(['A', 'B', 'C', 'D']);
  });

  it('filters by code status', () => {
    expect(ids(docmap.filterUnits(rows, { codeStatus: ['not-found'] }))).toEqual(['C']);
    expect(ids(docmap.filterUnits(rows, { codeStatus: ['found', 'not-checked'] }))).toEqual(['A', 'B', 'D']);
  });

  it('filters by verdict: a unit matches when any of its evidence has it', () => {
    expect(ids(docmap.filterUnits(rows, { verdict: ['does'] }))).toEqual(['A']);
    expect(ids(docmap.filterUnits(rows, { verdict: ['not'] }))).toEqual(['A']);
    expect(ids(docmap.filterUnits(rows, { verdict: ['none'] }))).toEqual([]);
    expect(ids(docmap.filterUnits(rows, { verdict: ['not checked'] }))).toEqual(['B']);
    expect(ids(docmap.filterUnits(rows, { verdict: ['does', 'not checked'] }))).toEqual(['A', 'B']);
  });

  it('combines code status, verdict and text', () => {
    expect(ids(docmap.filterUnits(rows, { codeStatus: ['found'], verdict: ['not checked'], text: 'approve' }))).toEqual(['B']);
    expect(ids(docmap.filterUnits(rows, { codeStatus: ['not-found'], verdict: ['does'] }))).toEqual([]);
  });

  it('searches document, id, title and quote, ignoring case', () => {
    expect(ids(docmap.filterUnits(rows, { text: 'B.MD' }))).toEqual(['C']);
    expect(ids(docmap.filterUnits(rows, { text: '<b>it</b>' }))).toEqual(['B']);
    expect(ids(docmap.filterUnits(rows, { text: 'nothing like this' }))).toEqual([]);
  });

  it('counts a unit once whatever the filters, over the verdict counts of a product', () => {
    const only = docmap.filterUnits(rows, { verdict: ['does', 'not'] });
    expect(only).toHaveLength(1);
  });
});

describe('small formats', () => {
  it('writes where a unit is', () => {
    expect(docmap.whereText({ line: 193, page: null })).toBe('line 193');
    expect(docmap.whereText({ line: 40, page: 2 })).toBe('page 2, line 40');
    expect(docmap.whereText({ line: null, page: 3 })).toBe('page 3');
    expect(docmap.whereText({ line: null, page: null })).toBeNull();
  });

  it('lists unit numbers and cuts a long list', () => {
    expect(docmap.unitList([])).toBeNull();
    expect(docmap.unitList(undefined)).toBeNull();
    expect(docmap.unitList([1, 2, 3])).toBe('1, 2, 3');
    const many = Array.from({ length: 34 }, (_, i) => i + 1);
    expect(docmap.unitList(many)).toBe(`${many.slice(0, 30).join(', ')} +4`);
  });

  it('orders a unit by page then line', () => {
    const sorted = XV.table.sortRows([{ page: null, line: 50 }, { page: 2, line: 1 }, { page: null, line: 7 }, { page: 1, line: 99 }, { page: null, line: null }], docmap.keys.where, 1);
    expect(sorted.map((r) => [r.page, r.line])).toEqual([[null, 7], [null, 50], [1, 99], [2, 1], [null, null]]);
  });
});

describe('the detail panel', () => {
  const all = (node) => (node === null || node === undefined ? [] : [node, ...(node.children || []).flatMap(all)]);
  const texts = (node) => all(node).filter((n) => n.text !== undefined).map((n) => n.text);
  const tags = (node) => all(node).filter((n) => n.tag).map((n) => n.tag);

  it('shows the quote verbatim and each place with its code and verdict', () => {
    const hostile = '</script><img src=x onerror=1>';
    const { rows } = docmap.joinChecks([unit({ quote: hostile, title: hostile })], [{ unit: 1, file: 'x.go', line: 5, verdict: 'does', reason: hostile }]);
    const panel = docmap.detailPanel(rows[0]);
    expect(texts(panel)).toContain(hostile);
    expect(tags(panel)).not.toContain('img');
    expect(tags(panel)).not.toContain('script');
    const links = all(panel).filter((n) => n.tag === 'a');
    expect(links.map((a) => a.attributes.href)).toEqual(['#/code?path=x.go&lines=5', '#/code?path=y.go&lines=7']);
    expect(texts(panel).join('|')).toContain('Not checked: checks.json has no verdict for this place.');
    expect(texts(panel)).toContain('does');
  });

  it('shows the searches of a unit with no code found, and no code location', () => {
    const { rows } = docmap.joinChecks([unit({ code: { status: 'not-found', evidence: [], searched: [{ pattern: 'leave.*apply', paths: ['svc/a', 'svc/b'] }] } })], []);
    const panel = docmap.detailPanel(rows[0]);
    expect(all(panel).filter((n) => n.tag === 'a')).toEqual([]);
    expect(texts(panel)).toContain('leave.*apply');
    expect(texts(panel).join('|')).toContain('Paths: svc/a, svc/b');
    expect(texts(panel)).toContain('not-found');
  });

  it('says a unit whose code was not looked for has none to show', () => {
    const { rows } = docmap.joinChecks([unit({ code: null })], null);
    const panel = docmap.detailPanel(rows[0]);
    expect(texts(panel)).toContain('The code for this unit was not looked for.');
    expect(all(panel).filter((n) => n.tag === 'a')).toEqual([]);
  });

  it('never touches a markup property', () => {
    const { rows } = docmap.joinChecks([unit()], []);
    expect(() => docmap.detailPanel(rows[0])).not.toThrow();
  });
});
