// Page data of the Markdown handbook (format /20) for the tests: the fixed text is the shipped table with a mark in
// front of every value, so a test can tell a fixed text from the content of the data (which starts with `d~`).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAGE_FORMAT } from '../src/lib/types';
import type { ChapterData, History, Outline, PageData, Technical, View } from '../src/lib/types';

export const MARK = '@@';
export const DATA = 'd~';
export const shipped = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../skills/excavator-product-handbook/ui-strings.json'), 'utf-8')) as { strings: Record<string, string> };
export const marked: Record<string, string> = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));
export const d = (text: string): string => `${DATA}${text}`;

export const BOTH: View[] = ['product', 'technical'];
export const NO_HISTORY: History = { state: 'missing', noHistory: null, years: [], apps: [], hotspots: [], coChange: [], tests: [], conventions: ['goTest', 'dotTest', 'dotSpec', 'pyPrefix', 'pySuffix', 'javaTest', 'testsDir'] };

/** A chapter whose text is a title and one paragraph, the same in both views. */
export const chapter = (id: string, title: string, views: View[] = BOTH, body = `${d(`paragraph of ${id}`)}`): ChapterData => ({
  id,
  texts: Object.fromEntries(views.map((view) => [view, `# ${d(title)}\n\n${body}\n`])),
});

/** The default outline: a system part, a features part and a part with the scripts' blocks (the code health last). */
export function outlineOf(): Outline {
  return {
    source: 'default',
    problems: [],
    parts: [
      { title: d('System'), blocks: [{ block: 'system', kind: 'chapter', title: d('System chapter') }] },
      { title: d('Features'), blocks: [{ block: 'F1', kind: 'chapter', title: d('Orders') }, { block: 'F2', kind: 'chapter', title: d('Reminders') }] },
      {
        title: d('Data and health'),
        blocks: [{ block: 'data', kind: 'data', title: marked['md.data.heading'] }, { block: 'dictionaries', kind: 'dictionaries', title: marked['md.dict.heading'] }, { block: 'history', kind: 'history', title: marked['md.history.heading'] }],
      },
    ],
    unplaced: [],
  };
}

export interface Options {
  views?: View[];
  history?: History | null;
  technical?: Partial<Technical>;
  chapters?: ChapterData[];
  outline?: Outline;
}

/** Page data with the chapters system, F1 and F2, the three script blocks in the outline and no data in them unless `options` give it. */
export function pageData(options: Options = {}): PageData {
  const views = options.views ?? BOTH;
  const coverage = Object.fromEntries(views.map((view) => [view, `# ${d('Coverage')}\n\n${d('coverage text')}\n`]));
  return {
    format: PAGE_FORMAT,
    chunks: { parts: [], units: {} },
    language: d('language'),
    languageTag: 'xx',
    ui: { strings: marked },
    views,
    titles: Object.fromEntries(views.map((view) => [view, d(view === 'technical' ? 'Technical handbook' : 'Handbook')])),
    outline: options.outline ?? outlineOf(),
    chapters: options.chapters ?? [chapter('system', 'System chapter', views), chapter('F1', 'Orders', views), chapter('F2', 'Reminders', views)],
    coverage,
    history: options.history === undefined ? NO_HISTORY : options.history,
    domains: { state: 'missing', list: [], handovers: [] },
    lead: '',
    search: [],
    ...(views.includes('technical') ? {
      technical: { data: null, dataState: 'missing' as const, dictionaries: null, dictionariesState: 'missing' as const, history: null, ...options.technical },
    } : {}),
  };
}
