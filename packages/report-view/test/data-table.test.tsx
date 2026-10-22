import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { cellContent } from '../src/components/ui/Cell';
import { DataTable, type Column } from '../src/components/ui/DataTable';
import { EMPTY, NOT_PROVIDED } from '../src/lib/format';

interface Row {
  name: string;
  score: number | null;
}

const columns: Column<Row>[] = [
  { label: 'Name', key: (r) => r.name, title: (r) => r.name, render: (r) => r.name },
  { label: 'Score', num: true, key: (r) => r.score, render: (r) => (r.score === null ? null : String(r.score)) },
];

const many = Array.from({ length: 450 }, (_, i) => ({ name: `row-${String(i).padStart(3, '0')}`, score: (i * 37) % 450 }));
const html = (props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) => renderToStaticMarkup(<DataTable<Row> rows={many} columns={columns} {...props} />);
const bodyRows = (out: string) => (out.match(/<tbody>([\s\S]*)<\/tbody>/)?.[1].match(/<tr[ >]/g) ?? []).length;
const firstCells = (out: string) => [...out.matchAll(/<tr[^>]*><td[^>]*>([^<]*)</g)].map((m) => m[1]);

describe('DataTable', () => {
  it('shows 200 rows of 450 and says which', () => {
    const out = html();
    expect(bodyRows(out)).toBe(200);
    expect(out).toContain(`Rows 1${String.fromCharCode(0x2013)}200 of 450`);
    expect(out).toContain('Page 1 of 3');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Previous</);
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*>Next</);
  });

  it('takes the page size it is given', () => {
    const out = html({ pageSize: 50 });
    expect(bodyRows(out)).toBe(50);
    expect(out).toContain('Page 1 of 9');
  });

  it('keeps the order of the rows when no initial sort is given, and marks no column sorted', () => {
    const out = html();
    expect(firstCells(out).slice(0, 2)).toEqual(['row-000', 'row-001']);
    expect(out.match(/aria-sort="none"/g)).toHaveLength(2);
  });

  it('starts sorted by the named column, highest first, and marks it', () => {
    const out = html({ initialSort: { label: 'Score', dir: -1 } });
    expect(firstCells(out).slice(0, 3).map((name) => many.find((r) => r.name === name)?.score)).toEqual([449, 448, 447]);
    expect(out).toContain('aria-sort="descending"');
    expect(out).toContain(`Score ${String.fromCharCode(0x25bc)}`);
  });

  it('sorts all rows before it pages: the first page holds the top rows of every row', () => {
    const out = html({ initialSort: { label: 'Score', dir: 1 } });
    expect(firstCells(out).map((name) => many.find((r) => r.name === name)?.score)).toEqual(Array.from({ length: 200 }, (_, i) => i));
  });

  it('refuses an initial sort that names no column', () => {
    expect(() => html({ initialSort: { label: 'Nope', dir: 1 } })).toThrow(/names no column/);
  });

  it('says there are no rows for none', () => {
    const out = html({ rows: [] });
    expect(bodyRows(out)).toBe(0);
    expect(out).toContain('No rows');
  });

  it('makes a row clickable only when it is given a handler, and marks the chosen row', () => {
    expect(html()).not.toContain('tabindex');
    const out = html({ onRowClick: () => {}, isSelected: (r) => r.name === 'row-001' });
    expect(out.match(/tabindex="0"/g)).toHaveLength(200);
    expect(out.match(/bg-highlight/g)).toHaveLength(1);
  });

  it('shows names as text, not markup', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const out = html({ rows: [{ name: hostile, score: 1 }] });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('cellContent', () => {
  it('shows a missing value as a muted dash, the same everywhere', () => {
    for (const missing of [null, undefined, '', EMPTY]) {
      expect(renderToStaticMarkup(<>{cellContent(missing)}</>)).toBe(`<span class="text-muted">${EMPTY}</span>`);
    }
  });

  it('says a field the product lacks is not provided', () => {
    expect(renderToStaticMarkup(<>{cellContent(NOT_PROVIDED)}</>)).toBe(`<span class="text-muted">${NOT_PROVIDED}</span>`);
  });

  it('leaves any other value alone, including 0 and text that looks empty', () => {
    expect(cellContent('0')).toBe('0');
    expect(cellContent('n/a')).toBe('n/a');
    expect(cellContent(0)).toBe(0);
  });
});
