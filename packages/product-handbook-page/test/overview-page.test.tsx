// @vitest-environment happy-dom
// The overview (openspec change handbook-page-structure, task 5.1): the counts line under the lead, the grid of the domains with
// their features (the problem count and the level mark of each), the map after the grid, the page without a usable domains list,
// and the stylesheet rules the compact layout stands on. Rows are written by hand so every expectation is exact.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { countRows, highestLevels, rowsOfFeature } from '../src/lib/problems';
import { parseHash } from '../src/lib/route';
import type { PageData, ProblemRow, ProblemsData } from '../src/lib/types';
import { cleanup, mount } from './dom';
import { FEATURES, domainData } from './domains-fixture';
import { d, marked } from './page-fixture';

afterEach(cleanup);

const DOT = ` ${String.fromCharCode(0xb7)} `;
const row = (id: string, over: Partial<ProblemRow>): ProblemRow => ({
  id, type: 'defect', level: 'P1', group: null, features: ['F1'], summary: d(`summary ${id}`), texts: {}, source: { chapter: 'defects', line: 1 }, remedy: null, ...over,
});
const ROWS: ProblemRow[] = [
  row('a1', { level: 'P1' }),
  row('a2', { level: 'P2', features: ['F1', 'F2'] }),
  row('a3', { type: 'design', level: 'medium', features: ['F1'] }),
  row('a4', { type: 'design', level: 'low', features: ['F1', 'F3'] }),
  row('a5', { type: 'open', level: null, features: ['F1', 'F4'] }),
  row('b1', { level: 'P0', features: ['F2'] }),
  row('s1', { type: 'open', level: null, features: ['system'] }),
];
const problemsOf = (over: Partial<ProblemsData> = {}): ProblemsData => ({
  sources: { defects: { state: 'ok', count: 3 }, design: { state: 'ok', count: 2 }, open: { state: 'ok', count: 2, unmatched: [] } }, rows: ROWS, remedies: null, ...over,
});
const dataWith = (problems: ProblemsData = problemsOf(), extra: Partial<PageData> = {}): PageData => domainData({ problems, ...extra });
const home = (data: PageData = dataWith(), hash = '#/product'): HTMLElement => mount(<AppView data={data} route={parseHash(hash)} />);
const t = (key: string, values: Record<string, string | number> = {}): string => marked[key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
const countsText = (host: HTMLElement): string[] => Array.from(host.querySelectorAll('[data-part="overview-counts"] li')).map((one) => (one.textContent ?? '').replace(/\s+/g, ' ').trim());
const feature = (host: HTMLElement, id: string): HTMLElement => host.querySelector(`[data-part="overview-grid"] a[data-feature="${id}"]`) as HTMLElement;

describe('the counts line', () => {
  it('has the domains, the features and the total of each problem type, in this order', () => {
    const counts = countsText(home());
    expect(counts).toEqual([
      t('page.overview.domains', { count: 4 }),
      t('page.overview.features', { count: 4 }),
      `${t('page.problems.type.defect')} ${countRows(ROWS, 'defect').total}`,
      `${t('page.problems.type.design')} ${countRows(ROWS, 'design').total}`,
      `${t('page.problems.type.open')} ${countRows(ROWS, 'open').total}`,
    ]);
    expect(countRows(ROWS, 'defect').total).toBe(3);
  });

  it('is under the lead and before the grid', () => {
    const host = home();
    const line = host.querySelector('[data-part="overview-counts"]') as Element;
    expect((host.querySelector('.home-lead') as Element).compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(host.querySelector('[data-part="overview-grid"]') as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the state of a source that is not usable in words, in place of its number', () => {
    const sources = { defects: { state: 'missing' as const, count: null }, design: { state: 'failed' as const, count: null }, open: { state: 'changed' as const, count: null, unmatched: [] } };
    const counts = countsText(home(dataWith(problemsOf({ sources }))));
    expect(counts.slice(2)).toEqual([
      `${t('page.problems.type.defect')} ${t('page.problems.count.missing')}`,
      `${t('page.problems.type.design')} ${t('page.problems.count.failed')}`,
      `${t('page.problems.type.open')} ${t('page.problems.count.changed')}`,
    ]);
  });

  it('marks the open questions incomplete when a chapter did not match, and only then', () => {
    const sources = { ...problemsOf().sources, open: { state: 'ok' as const, count: 2, unmatched: ['topics'] } };
    expect(countsText(home(dataWith(problemsOf({ sources }))))[4]).toBe(`${t('page.problems.type.open')} 2 ${t('page.problems.count.incomplete')}`);
    expect(countsText(home())[4]).not.toContain(t('page.problems.count.incomplete'));
  });

  it('has no domain count without a map, and counts a feature chapter once', () => {
    const data = dataWith(problemsOf(), { domains: { state: 'failed', list: [], handovers: [] } });
    const counts = countsText(home(data));
    expect(counts[0]).toBe(t('page.overview.features', { count: 4 }));
    expect(counts.some((text) => text === t('page.overview.domains', { count: 4 }))).toBe(false);
  });
});

describe('the grid', () => {
  it('has one block per domain in the domains order, its head linking to its page with its feature count', () => {
    const host = home();
    const blocks = Array.from(host.querySelectorAll('[data-part="overview-grid"] .ov-block'));
    expect(blocks.map((block) => block.getAttribute('data-group'))).toEqual(['d1', 'd2', 'd3', 'd4']);
    const heads = Array.from(host.querySelectorAll('.ov-head a')).map((one) => [one.getAttribute('href'), one.textContent]);
    expect(heads).toEqual([['#/product/domain/d1', d('Platform')], ['#/product/domain/d2', d('Orders')], ['#/product/domain/d3', d('Billing')], ['#/product/domain/d4', d('Support')]]);
    expect(Array.from(host.querySelectorAll('.ov-head small')).map((one) => one.textContent)).toEqual(['1', '1', '1', '1']);
    expect(blocks[0].querySelector('.mark')).not.toBeNull();
  });

  it('lists every feature as a link to its page with the full title in a title attribute', () => {
    const host = home();
    const links = Array.from(host.querySelectorAll('[data-part="overview-grid"] li a'));
    expect(links.map((one) => one.getAttribute('href'))).toEqual(FEATURES.map(([id]) => `#/product/chapter/${id}`));
    for (const [id, title] of FEATURES) {
      const one = feature(host, id);
      expect(one.querySelector('.ov-title')?.textContent).toBe(d(title));
      expect(one.querySelector('.ov-title')?.getAttribute('title')).toBe(d(title));
    }
  });

  it('shows for every feature a count equal to its rows in the problems table, 0 included', () => {
    const host = home();
    for (const [id] of FEATURES) {
      expect(feature(host, id).querySelector('[data-part="problem-count"]')?.textContent, id).toBe(String(rowsOfFeature(ROWS, id).length));
    }
    expect(feature(host, 'F4').querySelector('[data-part="problem-count"]')?.textContent).toBe('1');
    const none = home(dataWith(problemsOf({ rows: ROWS.filter((one) => !one.features.includes('F4')) })));
    expect(feature(none, 'F4').querySelector('[data-part="problem-count"]')?.textContent).toBe('0');
  });

  it('writes the worst defect level and the worst design impact as text, both when both exist', () => {
    const host = home();
    const mark = (id: string): string | null => feature(host, id).querySelector('[data-part="level-mark"]')?.textContent ?? null;
    expect(mark('F1')).toBe(`P1${DOT}${t('chapter.review.impact.medium')}`);
    expect(mark('F2')).toBe('P0');
    expect(mark('F3')).toBe(t('chapter.review.impact.low'));
  });

  it('gives no level mark to a feature with only points to confirm, or with nothing', () => {
    const host = home();
    expect(feature(host, 'F4').querySelector('[data-part="level-mark"]')).toBeNull();
    const bare = home(dataWith(problemsOf({ rows: [] })));
    for (const [id] of FEATURES) expect(feature(bare, id).querySelector('[data-part="level-mark"]'), id).toBeNull();
  });

  it('finds the highest levels of a feature with highestLevels', () => {
    expect(highestLevels(ROWS, 'F1')).toEqual({ defect: 'P1', design: 'medium' });
    expect(highestLevels(ROWS, 'F2')).toEqual({ defect: 'P0', design: null });
    expect(highestLevels(ROWS, 'F3')).toEqual({ defect: null, design: 'low' });
    expect(highestLevels(ROWS, 'F4')).toEqual({ defect: null, design: null });
    expect(highestLevels([...ROWS, row('x', { type: 'design', level: 'high', features: ['F1'] })], 'F1').design).toBe('high');
  });

  it('is before the map, which is still on the page with its nodes', () => {
    const host = home();
    const grid = host.querySelector('[data-part="overview-grid"]') as Element;
    const atlas = host.querySelector('.atlas-section') as Element;
    expect(grid.compareDocumentPosition(atlas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.querySelectorAll('[data-node]')).toHaveLength(4);
  });

  it('uses the outline parts when the domains list is not usable: blocks by part, the no-map line and no map', () => {
    const host = home(dataWith(problemsOf(), { domains: { state: 'changed', list: [], handovers: [] } }));
    expect(Array.from(host.querySelectorAll('[data-part="overview-grid"] .ov-block')).map((block) => block.getAttribute('data-group'))).toEqual(['d1']);
    expect(host.querySelectorAll('[data-part="overview-grid"] li a')).toHaveLength(4);
    expect(host.querySelector('[data-part="no-map"]')?.textContent).toBe(marked['page.home.noMap.changed']);
    expect(host.querySelector('.atlas-section, [data-part="atlas"]')).toBeNull();
  });
});

describe('the stylesheet of the overview', () => {
  const css = readFileSync(join(__dirname, '../src/index.css'), 'utf-8');

  it('flows the blocks in columns of about 220px that do not split, and has one column on a phone', () => {
    expect(css).toMatch(/\.ov-grid \{[^}]*column-width: 220px;/);
    expect(css).toMatch(/\.ov-block \{[^}]*break-inside: avoid;/);
    expect(css).toMatch(/@media \(max-width: 640px\) \{ \.ov-grid \{ column-width: auto; column-count: 1; \} \}/);
  });

  it('keeps a feature title on one line with an ellipsis', () => {
    expect(css).toMatch(/\.ov-title \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  });
});
