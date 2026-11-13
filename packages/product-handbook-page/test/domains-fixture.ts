// A synthetic page with four domains and five hand-overs between them, for the map, the home page, the domain pages, the
// strip on a feature page and the search. Names are plain words; no part of it comes from a real project.
import type { ChapterData, HandoverData, Outline, PageData } from '../src/lib/types';
import { BOTH, chapter, d, marked, pageData } from './page-fixture';

const NOTICE = marked['chapter.notVerified'];

/** The chapter of a feature: the title, the not-verified notice, then two second-level headings and a table. */
const featureText = (title: string): string => `# ${d(title)}\n\n${NOTICE}\n\n${d('Intro words.')}\n\n## ${d(`${title} first`)}\n\ntext\n\n## ${d(`${title} second`)}\n\ntext\n`;

export const FEATURES: [string, string][] = [['F1', 'Platform core'], ['F2', 'Order entry'], ['F3', 'Invoicing'], ['F4', 'Help desk']];

export const HANDOVERS: HandoverData[] = [
  { from: 'd1', to: 'd2', what: `${d('Platform core')} (F1) sends settings to ${d('Order entry')} (F2).`, features: ['F1', 'F2'], cites: ['src/a.js:1-3'] },
  { from: 'd1', to: 'd3', what: `${d('Rates reach')} (F3) for billing.`, features: ['F3'], cites: ['src/b.js:4-9'] },
  { from: 'd2', to: 'd3', what: `${d('Order entry')} (F2) asks for an invoice.`, features: ['F2'], cites: ['src/c.js:2-2'] },
  { from: 'd3', to: 'd2', what: d('Payment results come back.'), features: [], cites: ['src/d.js:7-8'] },
  { from: 'd3', to: 'd4', what: `${d('Disputes go to')} ${d('Help desk')} (F4) after ${d('Order entry')} (F2).`, features: ['F4', 'F2'], cites: ['src/e.js:5-6'] },
];

export const DOMAINS: PageData['domains'] = {
  state: 'ok',
  list: [
    { id: 'd1', name: d('Platform'), features: ['F1'], intro: { product: `${d('Runs the **base** services.')}`, technical: `${d('Runs the base services (code).')}` }, body: { product: `### ${d('Notes')}\n\n${d('Body of the platform.')}\n`, technical: `### ${d('Notes')}\n\n${d('Body of the platform.')} \`src/z.js:1-2\`\n` } },
    { id: 'd2', name: d('Orders'), features: ['F2'], intro: { product: d('Takes orders.'), technical: d('Takes orders (code).') }, body: { product: '', technical: '' } },
    { id: 'd3', name: d('Billing'), features: ['F3'], intro: { product: d('Bills customers.'), technical: d('Bills customers (code).') }, body: {} },
    { id: 'd4', name: d('Support'), features: ['F4'], intro: { product: d('Answers customers.'), technical: d('Answers customers (code).') }, body: {} },
  ],
  handovers: HANDOVERS,
};

export function outlineWithFeatures(): Outline {
  return {
    source: 'default',
    problems: [],
    parts: [
      { title: d('System'), blocks: [{ block: 'system', kind: 'chapter', title: d('System chapter') }] },
      { title: d('Features'), blocks: FEATURES.map(([block, title]) => ({ block, kind: 'chapter' as const, title: d(title) })) },
      { title: d('Data and health'), blocks: [{ block: 'history', kind: 'history', title: marked['md.history.heading'] }] },
    ],
    unplaced: [],
  };
}

export function domainData(extra: Partial<PageData> = {}): PageData {
  const chapters: ChapterData[] = [chapter('system', 'System chapter'), ...FEATURES.map(([id, title]) => ({ id, texts: Object.fromEntries(BOTH.map((view) => [view, featureText(title)])) }))];
  return {
    ...pageData({ outline: outlineWithFeatures(), chapters, domains: DOMAINS }),
    lead: d('A small *synthetic* system.'),
    search: [
      { kind: 'chapter', title: d('System chapter'), chapter: 'system', domain: null, heading: null, level: null },
      { kind: 'chapter', title: d('Platform core'), chapter: 'F1', domain: 'd1', heading: null, level: null },
      { kind: 'heading', title: d('Platform core first'), chapter: 'F1', domain: 'd1', heading: 0, level: 2 },
      { kind: 'chapter', title: d('Order entry'), chapter: 'F2', domain: 'd2', heading: null, level: null },
      { kind: 'heading', title: d('Order entry first'), chapter: 'F2', domain: 'd2', heading: 0, level: 2 },
      { kind: 'heading', title: d('Order entry second'), chapter: 'F2', domain: 'd2', heading: 1, level: 2 },
    ],
    ...extra,
  };
}
