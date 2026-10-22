import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Manifest } from '../src/data/manifest';
import { PayloadReader } from '../src/data/payload';
import { ViewerProvider } from '../src/state/viewer';
import { filterUnits, joinChecks, KEYS, unitList, whereText, type DocMapCheck } from '../src/lib/docmap';
import { sortRows } from '../src/lib/table';
import { UnitDetail } from '../src/pages/DocMap';

const evidence = (file: string, line: number, code = 'code') => ({ file, line, code });
const unit = (over: Record<string, unknown> = {}) => ({
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
  const checks: DocMapCheck[] = [
    { unit: 1, file: 'x.go', line: 5, verdict: 'does', reason: 'creates it' },
    { unit: 1, file: 'y.go', line: 7, verdict: 'not', reason: 'a test' },
    { unit: 2, file: 'x.go', line: 5, verdict: 'none', reason: null },
  ];

  it('gives each piece of evidence the check with the same unit, file and line', () => {
    const { rows, hasChecks, unmatched, duplicates } = joinChecks(units, checks);
    expect(hasChecks).toBe(true);
    expect(unmatched).toBe(0);
    expect(duplicates).toBe(0);
    expect(rows[0].evidence.map((e) => e.check)).toEqual([{ verdict: 'does', reason: 'creates it' }, { verdict: 'not', reason: 'a test' }]);
    expect(rows[1].evidence[0].check).toEqual({ verdict: 'none', reason: null });
  });

  it('keeps a check on the unit it names, not on another unit that cites the same place', () => {
    const { rows } = joinChecks(units, [{ unit: 2, file: 'x.go', line: 5, verdict: 'not', reason: 'r' }]);
    expect(rows[0].evidence[0].check).toBeNull();
    expect(rows[1].evidence[0].check?.verdict).toBe('not');
  });

  it('summarises the verdicts of a unit', () => {
    const { rows } = joinChecks(units, checks);
    expect(rows.map((r) => r.verdictText)).toEqual(['does 1 / not 1 / none 0', 'does 0 / not 0 / none 1', null, null]);
    expect(rows[0].verdicts).toEqual({ does: 1, not: 1, none: 0, unchecked: 0, other: 0 });
  });

  it('says not checked for evidence that has no check, and counts it beside the others when only some have one', () => {
    const { rows } = joinChecks(units, [checks[0]]);
    expect(rows[0].verdictText).toBe('does 1 / not 0 / none 0 / not checked 1');
    expect(rows[1].verdictText).toBe('not checked');
  });

  it('shows every unit with evidence as not checked when there are no checks at all', () => {
    const { rows, hasChecks } = joinChecks(units, null);
    expect(hasChecks).toBe(false);
    expect(rows.map((r) => r.verdictText)).toEqual(['not checked', 'not checked', null, null]);
    expect(rows.flatMap((r) => r.evidence).every((e) => e.check === null)).toBe(true);
  });

  it('counts a check that names no evidence, and a repeated check', () => {
    const { unmatched, duplicates, rows } = joinChecks(units, [...checks, { unit: 9, file: 'z.go', line: 1, verdict: 'does', reason: 'r' }, { ...checks[0], verdict: 'not' }]);
    expect(unmatched).toBe(1);
    expect(duplicates).toBe(1);
    expect(rows[0].evidence[0].check?.verdict).toBe('does');
  });

  it('keeps a verdict it does not know apart from the three it does', () => {
    const { rows } = joinChecks(units, [{ unit: 2, file: 'x.go', line: 5, verdict: 'maybe', reason: 'r' }]);
    expect(rows[1].verdictText).toBe('does 0 / not 0 / none 0 / other 1');
  });

  it('numbers units from 1 and treats a unit without code as not checked', () => {
    const { rows } = joinChecks(units, checks);
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.codeStatus)).toEqual(['found', 'found', 'not-found', 'not-checked']);
    expect(rows[3].evidence).toEqual([]);
  });

  it('does not join a line that differs, or a file that differs only by case', () => {
    const { rows, unmatched } = joinChecks([unit()], [{ unit: 1, file: 'X.go', line: 5, verdict: 'does', reason: 'r' }, { unit: 1, file: 'x.go', line: 6, verdict: 'does', reason: 'r' }]);
    expect(rows[0].verdictText).toBe('not checked');
    expect(unmatched).toBe(2);
  });

  it('copes with a unit that is missing fields', () => {
    const { rows } = joinChecks([{}], []);
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
  const checks: DocMapCheck[] = [
    { unit: 1, file: 'x.go', line: 5, verdict: 'does', reason: 'r' },
    { unit: 1, file: 'y.go', line: 7, verdict: 'not', reason: 'r' },
  ];
  const { rows } = joinChecks(units, checks);
  const ids = (list: typeof rows) => list.map((r) => r.id);

  it('keeps every unit when nothing is chosen', () => {
    expect(ids(filterUnits(rows, {}))).toEqual(['A', 'B', 'C', 'D']);
  });

  it('filters by code status', () => {
    expect(ids(filterUnits(rows, { codeStatus: ['not-found'] }))).toEqual(['C']);
    expect(ids(filterUnits(rows, { codeStatus: ['found', 'not-checked'] }))).toEqual(['A', 'B', 'D']);
  });

  it('filters by verdict: a unit matches when any of its evidence has it', () => {
    expect(ids(filterUnits(rows, { verdict: ['does'] }))).toEqual(['A']);
    expect(ids(filterUnits(rows, { verdict: ['not'] }))).toEqual(['A']);
    expect(ids(filterUnits(rows, { verdict: ['none'] }))).toEqual([]);
    expect(ids(filterUnits(rows, { verdict: ['not checked'] }))).toEqual(['B']);
    expect(ids(filterUnits(rows, { verdict: ['does', 'not checked'] }))).toEqual(['A', 'B']);
  });

  it('combines code status, verdict and text', () => {
    expect(ids(filterUnits(rows, { codeStatus: ['found'], verdict: ['not checked'], text: 'approve' }))).toEqual(['B']);
    expect(ids(filterUnits(rows, { codeStatus: ['not-found'], verdict: ['does'] }))).toEqual([]);
  });

  it('searches document, id, title and quote, ignoring case', () => {
    expect(ids(filterUnits(rows, { text: 'B.MD' }))).toEqual(['C']);
    expect(ids(filterUnits(rows, { text: '<b>it</b>' }))).toEqual(['B']);
    expect(ids(filterUnits(rows, { text: 'nothing like this' }))).toEqual([]);
  });
});

describe('small formats', () => {
  it('writes where a unit is', () => {
    expect(whereText({ line: 193, page: null })).toBe('line 193');
    expect(whereText({ line: 40, page: 2 })).toBe('page 2, line 40');
    expect(whereText({ line: null, page: 3 })).toBe('page 3');
    expect(whereText({ line: null, page: null })).toBeNull();
  });

  it('lists unit numbers and cuts a long list', () => {
    expect(unitList([])).toBeNull();
    expect(unitList(undefined)).toBeNull();
    expect(unitList([1, 2, 3])).toBe('1, 2, 3');
    const many = Array.from({ length: 34 }, (_, i) => i + 1);
    expect(unitList(many)).toBe(`${many.slice(0, 30).join(', ')} +4`);
  });

  it('orders a unit by page then line', () => {
    const sorted = sortRows([{ page: null, line: 50 }, { page: 2, line: 1 }, { page: null, line: 7 }, { page: 1, line: 99 }, { page: null, line: null }], (r) => KEYS.where(r as never), 1);
    expect(sorted.map((r) => [r.page, r.line])).toEqual([[null, 7], [null, 50], [1, 99], [2, 1], [null, null]]);
  });
});

describe('the unit detail', () => {
  // The locate buttons read the graph's state from the page, so the detail is drawn inside one.
  const manifest = { products: [{ name: 'knowledge-graph', label: 'Knowledge graph', status: 'included', payloads: ['knowledge-graph'] }] } as unknown as Manifest;
  const payloads = new PayloadReader({ getElementById: () => null });
  const html = (over: Record<string, unknown>, checks: DocMapCheck[] | null) => renderToStaticMarkup(
    <ViewerProvider manifest={manifest} payloads={payloads}><UnitDetail row={joinChecks([unit(over)], checks).rows[0]} /></ViewerProvider>,
  );

  it('shows the quote verbatim as text and each place with its code and verdict', () => {
    const hostile = '</script><img src=x onerror=1>';
    const out = html({ quote: hostile, title: hostile }, [{ unit: 1, file: 'x.go', line: 5, verdict: 'does', reason: hostile }]);
    expect(out).toContain('&lt;/script&gt;&lt;img src=x onerror=1&gt;');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<script');
    expect(out).toContain('href="#/code?path=x.go&amp;lines=5"');
    expect(out).toContain('href="#/code?path=y.go&amp;lines=7"');
    expect(out).toContain('Not checked: checks.json has no verdict for this place.');
    expect(out).toContain('>does<');
    // Each place can be shown in the graph, with the doc-map overlay.
    expect(out).toContain('data-xv-locate="file:x.go"');
    expect(out).toContain('data-xv-locate="file:y.go"');
  });

  it('shows the searches of a unit with no code found, and no code location', () => {
    const out = html({ code: { status: 'not-found', evidence: [], searched: [{ pattern: 'leave.*apply', paths: ['svc/a', 'svc/b'] }] } }, []);
    expect(out).not.toContain('<a ');
    expect(out).toContain('leave.*apply');
    expect(out).toContain('Paths: svc/a, svc/b');
    expect(out).toContain('not-found');
  });

  it('says a unit whose code was not looked for has none to show', () => {
    const out = html({ code: null }, null);
    expect(out).toContain('The code for this unit was not looked for.');
    expect(out).not.toContain('<a ');
  });
});
