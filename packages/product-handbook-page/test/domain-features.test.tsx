// @vitest-environment happy-dom
// The features section of a domain page (openspec change handbook-page-structure, tasks 8.1 and 8.2): every feature of the
// domain as a link with its worst level and its problem count (0 shown), equal to the rows of the problems table filtered by
// that feature. Rows are written by hand so every expectation is exact.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { highestLevels, rowsOfFeature } from '../src/lib/problems';
import { parseHash } from '../src/lib/route';
import type { PageData, ProblemRow, ProblemsData } from '../src/lib/types';
import { cleanup, mount } from './dom';
import { DOMAINS, FEATURES, domainData } from './domains-fixture';
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
/** The features section stands in for the domain section only without a usable list: one fallback domain (d1) holds F1 to F4. */
const dataWith = (problems: ProblemsData = problemsOf(), extra: Partial<PageData> = {}): PageData => ({ ...domainData({ problems }), domains: { state: 'failed', list: [], handovers: [] }, ...extra });
const page = (data: PageData, hash: string): HTMLElement => mount(<AppView data={data} route={parseHash(hash)} />);
const features = (host: HTMLElement): HTMLElement => host.querySelector('section[data-part="domain-features"]') as HTMLElement;
const feature = (host: HTMLElement, id: string): HTMLElement => features(host).querySelector(`a[data-feature="${id}"]`) as HTMLElement;
const t = (key: string): string => marked[key];

describe('the features section of a domain page', () => {
  it('comes after the title and the lede with the heading and one link per feature of the domain, when there is no usable list', () => {
    const host = page(dataWith(), '#/product/domain/d1');
    const section = features(host);
    expect(section.querySelector('h2')?.textContent).toBe(t('page.domain.features'));
    expect(Array.from(section.querySelectorAll('a')).map((one) => [one.getAttribute('href'), one.getAttribute('data-feature'), one.querySelector('.feat-title')?.textContent])).toEqual([
      ['#/product/chapter/F1', 'F1', d('Platform core')],
      ['#/product/chapter/F2', 'F2', d('Order entry')],
      ['#/product/chapter/F3', 'F3', d('Invoicing')],
      ['#/product/chapter/F4', 'F4', d('Help desk')],
    ]);
    const after = (first: Element, second: Element) => first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(after(host.querySelector('h1') as Element, section)).toBeTruthy();
  });

  it('is replaced by the features table of the domain section when the list is usable', () => {
    const host = page({ ...dataWith(), domains: DOMAINS }, '#/product/domain/d1');
    expect(host.querySelector('section[data-part="domain-features"]')).toBeNull();
    expect(host.querySelector('.dom-cols')).not.toBeNull();
  });

  it('shows for every feature a count equal to its rows in the problems table, 0 included', () => {
    for (const hash of ['#/product/domain/d1']) {
      const host = page(dataWith(), hash);
      for (const link of Array.from(features(host).querySelectorAll<HTMLElement>('a[data-feature]'))) {
        const id = link.getAttribute('data-feature') as string;
        expect(link.querySelector('[data-part="problem-count"]')?.textContent, id).toBe(String(rowsOfFeature(ROWS, id).length));
      }
    }
    const none = page(dataWith(problemsOf({ rows: ROWS.filter((one) => !one.features.includes('F4')) })), '#/product/domain/d1');
    expect(feature(none, 'F4').querySelector('[data-part="problem-count"]')?.textContent).toBe('0');
  });

  it('equals the number of rows the problems page shows when it is filtered by the feature', () => {
    const data = dataWith();
    for (const [id] of FEATURES) {
      const domainPage = page(data, '#/product/domain/d1');
      const shown = feature(domainPage, id).querySelector('[data-part="problem-count"]')?.textContent;
      cleanup();
      const table = page(data, `#/product/problems?feature=${id}`);
      expect(table.querySelectorAll('.prob'), id).toHaveLength(Number(shown));
      cleanup();
    }
  });

  it('writes the worst defect level and the worst design impact as text, both when both exist', () => {
    const host = page(dataWith(), '#/product/domain/d1');
    const mark = (id: string): string | null => feature(host, id).querySelector('[data-part="level-mark"]')?.textContent ?? null;
    expect(mark('F1')).toBe(`P1${DOT}${t('chapter.review.impact.medium')}`);
    expect(mark('F2')).toBe('P0');
    expect(feature(host, 'F3').querySelector('[data-part="level-mark"]')?.textContent).toBe(t('chapter.review.impact.low'));
  });

  it('gives no level mark to a feature with only points to confirm, or with nothing', () => {
    const host = page(dataWith(), '#/product/domain/d1');
    expect(feature(host, 'F4').querySelector('[data-part="level-mark"]')).toBeNull();
    const bare = page(dataWith(problemsOf({ rows: [] })), '#/product/domain/d1');
    for (const id of ['F1', 'F2']) expect(feature(bare, id).querySelector('[data-part="level-mark"]'), id).toBeNull();
  });

  it('finds the highest levels of a feature with highestLevels', () => {
    expect(highestLevels(ROWS, 'F1')).toEqual({ defect: 'P1', design: 'medium' });
    expect(highestLevels(ROWS, 'F2')).toEqual({ defect: 'P0', design: null });
    expect(highestLevels(ROWS, 'F3')).toEqual({ defect: null, design: 'low' });
    expect(highestLevels(ROWS, 'F4')).toEqual({ defect: null, design: null });
    expect(highestLevels([...ROWS, row('x', { type: 'design', level: 'high', features: ['F1'] })], 'F1').design).toBe('high');
  });
});

describe('the stylesheet of the features section', () => {
  const css = readFileSync(join(__dirname, '../src/index.css'), 'utf-8');

  it('flows the features in columns that do not split, and has one column on a phone', () => {
    expect(css).toMatch(/\.dom-features ul \{[^}]*column-width: 280px;/);
    expect(css).toMatch(/\.dom-features li \{[^}]*break-inside: avoid;/);
    expect(css).toMatch(/@media \(max-width: 640px\) \{ \.dom-features ul \{ column-width: auto; column-count: 1; \} \}/);
  });

  it('keeps a feature title on one line with an ellipsis', () => {
    expect(css).toMatch(/\.feat-title \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  });
});
