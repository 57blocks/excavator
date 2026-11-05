// Oracle O8, node half (R8) of openspec change product-handbook-map: every
// fixed text the page shows comes from the data's ui table. The page is
// rendered to a string from data whose ui strings all start with a marker;
// the data's own text (names, labels, sentences) is given a different
// recognisable prefix. A visible text or a text attribute that carries neither
// is a fixed text the code wrote itself.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { parseHash } from '../src/lib/route';
import type { Entry, Feature, PageData, Reach, Summary, System } from '../src/lib/types';

const MARK = '@@';
const DATA = 'd~';
const shipped = JSON.parse(readFileSync(fileURLToPath(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url)), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));

const d = (text: string): string => `${DATA}${text}`;

const fullEntry: Entry = {
  purpose: d('purpose'),
  who: [{ role: d('role one'), can: d('can one') }, { role: d('role two'), can: d('can two') }],
  where: [d('menu entry'), d('page entry')],
  screens: [
    {
      name: d('screen one'),
      fields: [
        { label: d('field one'), rules: [{ side: 'frontend', text: d('front rule') }, { side: 'backend', text: d('back rule one') }, { side: 'backend', text: d('back rule two') }] },
        { label: d('field two'), rules: [] },
      ],
    },
    { name: d('screen two'), fields: [] },
  ],
  operations: [{ name: d('operation'), sentences: [d('first sentence.'), d('second sentence.')] }],
  states: [{ label: d('state'), meaning: d('state meaning') }],
  notifications: [{ trigger: d('trigger'), recipient: d('recipient'), channel: d('channel'), content: d('content') }],
  automatic: [{ when: d('when'), effect: d('effect') }],
  unknowns: [{ item: d('unknown item'), searched: d('searched place') }],
};

const emptyEntry: Entry = { purpose: d('purpose'), who: [], where: [], screens: [], operations: [], states: [], notifications: [], automatic: [], unknowns: [] };

const reaches: Reach[] = ['menu', 'link', 'automated', 'interface', 'operator'];

function feature(id: string, reach: Reach, status: Feature['status'], entry: Entry | null, label?: string): Feature {
  return { id: d(id), name: d(`name ${id}`), area: d('A1'), reach, label: label === undefined ? undefined : d(label), status, entry };
}

const emptySummary: Summary = {
  notifications: [],
  jobs: [],
  counts: { featureTotal: 6, featuresWithEntry: 2, notificationRows: 0, jobRows: 0, schedule: { literal: 0, computed: 0, absent: 0 }, described: 0 },
};

const richSummary: Summary = {
  notifications: [
    { feature: d('F1'), trigger: d('note trigger one'), recipient: d('note recipient'), channel: d('note channel'), content: d('note content one') },
    { feature: d('F5'), trigger: d('note trigger two'), recipient: d('note recipient'), channel: d('note channel'), content: d('note content two') },
  ],
  jobs: [
    { kind: 'job', candidate: d('c1'), feature: d('F1'), reason: null, schedule: { bucket: 'literal', literal: d('0 9 * * *') }, automatic: [{ when: d('job when one'), effect: d('job effect one') }, { when: d('job when two'), effect: d('job effect two') }] },
    { kind: 'job', candidate: d('c2'), feature: d('F5'), reason: null, schedule: { bucket: 'computed', literal: null }, automatic: [] },
    { kind: 'job', candidate: d('c3'), feature: null, reason: d('job reason'), schedule: { bucket: 'absent', literal: null }, automatic: [] },
  ],
  counts: { featureTotal: 6, featuresWithEntry: 2, notificationRows: 2, jobRows: 3, schedule: { literal: 1, computed: 1, absent: 1 }, described: 1 },
};

const areaRows: System['areas'] = [
  { id: d('A1'), name: d('area one'), features: 4, verified: 2, roles: [d('role one'), d('role two')] },
  { id: d('A2'), name: d('area two'), features: 2, verified: 0, roles: [] },
];

/** An overview that is not verified: where it stopped, and the area table that does not depend on it. */
const unwrittenSystem: System = {
  status: 'checked',
  overview: null,
  applications: [{ dir: d('root/dir'), name: null, does: null, languages: [{ language: d('Lang A'), files: 3 }], frameworks: [], files: 3, lines: 40, history: null }],
  counts: { applications: 1, files: 3, lines: 40, areas: 2, features: 6, featuresWithEntry: 2, roles: 2 },
  areas: areaRows,
};

const fullSystem: System = {
  status: 'verified',
  overview: {
    summary: [d('first summary sentence.'), d('second summary sentence.')],
    audiences: [{ who: d('who one'), does: d('does one') }, { who: d('who two'), does: d('does two') }],
    integrations: [{ system: d('system one'), use: d('use one'), callers: [d('dir one'), d('dir two')] }],
    unknowns: [{ item: d('overview unknown'), searched: d('overview searched') }],
  },
  applications: [
    {
      dir: d('app/dir'), name: d('app name'), does: d('app does'),
      languages: [{ language: d('Lang A'), files: 9 }, { language: d('Lang B'), files: 2 }],
      frameworks: [{ framework: d('framework a'), candidates: 5 }],
      files: 11, lines: 1200,
      history: { first: d('2023-02-01'), last: d('2024-01-20'), commits: 14, authors: 3 },
    },
    { dir: d('other/dir'), name: null, does: null, languages: [], frameworks: [], files: 0, lines: 0, history: null },
  ],
  counts: { applications: 2, files: 11, lines: 1200, areas: 2, features: 6, featuresWithEntry: 2, roles: 2 },
  areas: areaRows,
};

/** A verified overview that lost every part to verification. */
const emptySystem: System = {
  status: 'verified',
  overview: { summary: [], audiences: [], integrations: [], unknowns: [] },
  applications: [],
  counts: { applications: 0, files: 0, lines: 0, areas: 2, features: 6, featuresWithEntry: 2, roles: 0 },
  areas: areaRows,
};

function dataFor(features: Feature[], unassigned: PageData['coverage']['unassigned'] = [], removed: PageData['coverage']['removed'] = [], summary: Summary = emptySummary, system: System = unwrittenSystem, removedOverview: PageData['coverage']['removedOverview'] = []): PageData {
  return {
    format: 'excavator-product-handbook-page/4',
    project: d('project'),
    language: d('language'),
    languageTag: 'xx',
    ui: { strings: marked },
    views: ['product'],
    areas: [{ id: d('A1'), name: d('area one') }, { id: d('A2'), name: d('area two') }],
    features,
    coverage: {
      candidateTotal: 9,
      assigned: 9 - unassigned.length,
      unassigned,
      reachCounts: reaches.map((reach) => ({ reach, count: features.filter((item) => item.reach === reach).length })),
      removedOverview,
      removed,
    },
    summary,
    system,
    entities: { domains: [], roles: [], roleFeature: { roles: [], features: [], cells: [] } },
  };
}

const populated = dataFor(
  [
    feature('F1', 'menu', 'verified', fullEntry, 'menu label'),
    feature('F2', 'link', 'planned', null, 'link label'),
    feature('F3', 'automated', 'dispatched', null),
    feature('F4', 'interface', 'failed', null),
    feature('F5', 'operator', 'verified', emptyEntry),
    feature('F6', 'menu', 'checked', null, 'other label'),
  ],
  [{ candidate: d('c7'), kind: 'route', reason: d('why') }, { candidate: d('c8'), kind: 'job', reason: d('why too') }],
  [
    { feature: d('F1'), items: [{ claim: d('a claim'), verdict: 'contradicted', reason: d('a reason') }, { claim: d('another claim'), verdict: 'unverified', reason: d('another reason') }, { claim: d('a child'), verdict: 'withParent', reason: '' }] },
    { feature: d('F4'), items: [{ claim: d('lost claim'), verdict: 'unverified', reason: d('lost reason') }] },
  ],
  richSummary,
  fullSystem,
  [{ claim: d('overview claim'), verdict: 'contradicted', reason: d('overview reason') }, { claim: d('other overview claim'), verdict: 'unverified', reason: d('other overview reason') }],
);
const emptyOverview = dataFor([feature('F1', 'menu', 'verified', emptyEntry)], [], [], emptySummary, emptySystem);
const allWritten = dataFor([feature('F1', 'menu', 'verified', emptyEntry)]);
const { purpose: _removedPurpose, ...entryWithoutPurpose } = fullEntry;
const withoutPurpose = dataFor([feature('F1', 'menu', 'verified', entryWithoutPurpose)]);

/** Decode the few entities React writes into markup. */
const decode = (text: string): string => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Every visible text node and every text attribute of the markup. */
function visibleTexts(html: string): string[] {
  const nodes = html.split(/<[^>]*>/).map((text) => decode(text).trim()).filter((text) => text !== '');
  const attributes = Array.from(html.matchAll(/\s(?:aria-label|title|alt|placeholder|aria-description)="([^"]*)"/g), (match) => decode(match[1]).trim());
  return [...nodes, ...attributes];
}

/** The texts that carry neither the ui marker nor the data prefix (a bare number, a count, is data). */
function unmarked(html: string): string[] {
  return visibleTexts(html).filter((text) => !text.includes(MARK) && !(text.startsWith(DATA) && !text.includes('@')) && !/^\d+$/.test(text));
}

const render = (data: PageData, hash: string): string => renderToStaticMarkup(<AppView data={data} route={parseHash(hash)} />);

const featureId = (data: PageData, index: number): string => encodeURIComponent(data.features[index].id);

describe('every fixed text of the page comes from the ui table (O8, node half)', () => {
  const views: [string, PageData, string][] = [
    ['the overview with a verified system overview', populated, '#/'],
    ['the overview with a system overview that was not written', allWritten, '#/'],
    ['the overview with a verified system overview that lost every part', emptyOverview, '#/'],
    ['a feature with every section filled', populated, `#/feature/${featureId(populated, 0)}`],
    ['a feature whose purpose was removed', withoutPurpose, `#/feature/${featureId(withoutPurpose, 0)}`],
    ['a feature whose sections are all empty', populated, `#/feature/${featureId(populated, 4)}`],
    ['a feature with no verified entry (planned)', populated, `#/feature/${featureId(populated, 1)}`],
    ['a feature with no verified entry (failed)', populated, `#/feature/${featureId(populated, 3)}`],
    ['a feature with no verified entry (verification not finished)', populated, `#/feature/${featureId(populated, 5)}`],
    ['the coverage view with unassigned candidates, unwritten features and removed items', populated, '#/coverage'],
    ['the coverage view with nothing unassigned and every feature written', allWritten, '#/coverage'],
    ['the notification table with rows', populated, '#/notifications'],
    ['the notification table with no row', allWritten, '#/notifications'],
    ['the job table with a literal, a computed and an unassigned row', populated, '#/jobs'],
    ['the job table with no row', allWritten, '#/jobs'],
    ['an address that is not a page', populated, '#/nowhere'],
    ['a feature id the handbook does not have', populated, '#/feature/missing'],
  ];

  for (const [name, data, hash] of views) {
    it(`${name}: no text without the marker or the data prefix`, () => {
      const html = render(data, hash);
      expect(visibleTexts(html).length).toBeGreaterThan(3);
      expect(unmarked(html)).toEqual([]);
    });
  }

  it('shows no purpose section for a feature whose purpose was removed, and the other sections stay', () => {
    const html = render(withoutPurpose, `#/feature/${featureId(withoutPurpose, 0)}`);
    expect(html).not.toContain(marked['md.section.purpose']);
    expect(html).not.toContain('id="sec-purpose"');
    expect(html).toContain(marked['md.section.who']);
    expect(html).toContain(d('role one'));
  });

  it('shows the data text and the marked fixed text together (the fixture reaches the page)', () => {
    const html = render(populated, `#/feature/${featureId(populated, 0)}`);
    for (const text of ['purpose', 'role one', 'front rule', 'back rule two', 'operation', 'trigger', 'searched place', 'menu label']) expect(html).toContain(d(text));
    for (const key of ['md.section.purpose', 'md.table.frontendRules', 'md.table.channel', 'md.section.unknowns', 'page.breadcrumb.label']) expect(html).toContain(marked[key]);
  });

  it('lists the removed items of each feature with the result text, a count and the reason; an item that went with its parent has no reason', () => {
    const html = render(populated, '#/coverage');
    for (const text of ['a claim', 'a reason', 'another claim', 'another reason', 'a child', 'lost claim', 'lost reason']) expect(html).toContain(d(text));
    for (const key of ['md.coverage.removedHeading', 'md.table.item', 'md.table.result', 'md.verdict.contradicted', 'md.verdict.unverified', 'md.verdict.withParent']) expect(html).toContain(marked[key]);
    expect(html).toContain('data-empty="true"');
    // Nothing removed: the section says so with the shared "none" text.
    const section = (page: string): string => page.slice(page.indexOf('id="cov-removed"'));
    expect(section(render(allWritten, '#/coverage'))).toContain(marked['md.none']);
    expect(section(html)).not.toContain(marked['md.none']);
  });

  it('counts only verified features as written on the overview, and marks a checked one as not finished', () => {
    const html = render(populated, '#/');
    expect(html).toContain(marked['md.status.checked']);
    expect(html).toMatch(/stat-value">2<\/span><span class="stat-label">@@With a verified entry/);
  });

  it('lists a confirmed feature (settled by the verifiers, not yet traced) as not finished, with no entry', () => {
    const confirmed = dataFor([feature('F1', 'menu', 'confirmed', null, 'menu label')]);
    expect(render(confirmed, '#/')).toContain(marked['md.status.confirmed']);
    expect(render(confirmed, '#/coverage')).toContain(marked['md.status.confirmed']);
    expect(render(confirmed, '#/')).toMatch(/stat-value">0<\/span><span class="stat-label">@@With a verified entry/);
  });

  it('shows the rows of the two tables with their fixed texts, the schedule as written, and the reason of an unassigned job', () => {
    const notifications = render(populated, '#/notifications');
    for (const text of ['note trigger one', 'note content two', 'note recipient', 'note channel']) expect(notifications).toContain(d(text));
    for (const key of ['md.summary.notifications.heading', 'md.summary.notifications.note', 'md.table.feature', 'md.table.trigger']) expect(notifications).toContain(marked[key]);
    expect(notifications).toContain(`${MARK}Features with a verified entry: 2 of 6. Notifications listed: 2.`);
    expect(notifications).not.toContain(marked['md.summary.notifications.none']);
    expect((notifications.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr>/g) ?? []).length).toBe(2);

    const jobs = render(populated, '#/jobs');
    for (const text of ['c1', 'job when two', 'job effect one', 'job reason']) expect(jobs).toContain(d(text));
    expect(jobs).toContain(`${MARK}Scheduled jobs listed: 3. Schedule written on the registration line: 1. Schedule worked out when the job is registered: 1. Schedule not in the text of the registration line: 1. Rows with a verified description: 1.`);
    expect(jobs).toContain(`${MARK}Unassigned: ${d('job reason')}`);
    expect(jobs).toContain(`<code class="schedule">${d('0 9 * * *')}</code>`);
    for (const key of ['md.summary.jobs.heading', 'md.summary.jobs.note', 'md.summary.schedule.computed', 'md.summary.schedule.absent', 'md.summary.noDescription', 'md.table.schedule', 'md.table.does']) expect(jobs).toContain(marked[key]);
    expect((jobs.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr>/g) ?? []).length).toBe(3);
  });

  it('says so with the fixed text instead of an empty table when a table has no row', () => {
    expect(render(allWritten, '#/notifications')).toContain(marked['md.summary.notifications.none']);
    expect(render(allWritten, '#/notifications')).not.toContain('<table');
    expect(render(allWritten, '#/jobs')).toContain(marked['md.summary.jobs.none']);
    expect(render(allWritten, '#/jobs')).not.toContain('<table');
  });

  it('puts the two tables in the navigation, after the overview and before the coverage page', () => {
    const html = render(populated, '#/');
    const at = (text: string): number => html.indexOf(text);
    expect(at('href="#/notifications"')).toBeGreaterThan(at('href="#/"'));
    expect(at('href="#/jobs"')).toBeGreaterThan(at('href="#/notifications"'));
    expect(at('href="#/coverage"')).toBeGreaterThan(at('href="#/jobs"'));
    expect(html).toContain(marked['page.nav.notifications']);
    expect(html).toContain(marked['page.nav.jobs']);
  });

  it('marks the page of the current route in the navigation', () => {
    expect(render(populated, '#/jobs')).toMatch(/<a class="rail-link" href="#\/jobs" aria-current="page">/);
    expect(render(populated, '#/notifications')).toMatch(/<a class="rail-link" href="#\/notifications" aria-current="page">/);
  });

  it('shows the system overview: its text, the application facts from the script, the history cells and the area table', () => {
    const html = render(populated, '#/');
    for (const text of ['first summary sentence.', 'second summary sentence.', 'who two', 'does one', 'system one', 'use one', 'app/dir', 'app name', 'app does', '2023-02-01', '2024-01-20', 'overview unknown', 'overview searched', 'area one', 'role two']) expect(html).toContain(d(text));
    for (const key of ['md.overview.heading', 'md.overview.audiencesHeading', 'md.overview.applicationsHeading', 'md.overview.integrationsHeading', 'md.overview.areasHeading', 'md.table.directory', 'md.table.firstCommit', 'md.table.authors', 'md.table.callers', 'md.table.verified', 'md.section.unknowns']) expect(html).toContain(marked[key]);
    expect(html).toContain(`${MARK}Applications: 2. Source files: 11. Lines of source: 1200. Areas: 2. Features: 6. Features with a verified entry: 2. Roles: 2.`);
    expect(html).toContain(`${MARK}${d('Lang A')} (9), ${MARK}${d('Lang B')} (2)`);
    // The application with no version history says so in each of the four cells.
    expect((html.match(new RegExp(`${MARK}No version history`, 'g')) ?? []).length).toBe(4);
    // A root with no verified application keeps its row: the fixed not-verified text stands in the name and responsibility cells.
    expect((html.match(new RegExp(`${MARK}Not verified`, 'g')) ?? []).length).toBe(2);
    expect(html).not.toContain(marked['md.overview.notWritten']);
  });

  it('says where the system overview stopped, replaces only the model-written sections, and keeps the counts, the application rows and the area table', () => {
    const html = render(allWritten, '#/');
    expect(html).toContain(`${MARK}The system overview is not in this handbook. Where it stopped: ${marked['md.status.checked']}.`);
    expect(html).toContain(marked['md.overview.areasHeading']);
    expect(html).toContain(marked['md.overview.applicationsHeading']);
    expect(html).toContain(`${MARK}Applications: 1. Source files: 3. Lines of source: 40.`);
    expect(html).toContain(d('root/dir'));
    // The name and responsibility cells of the root hold the fixed not-verified text.
    expect((html.match(new RegExp(`${MARK}Not verified`, 'g')) ?? []).length).toBe(2);
    expect(html).not.toContain(marked['md.overview.audiencesHeading']);
    expect(html).not.toContain(marked['md.overview.integrationsHeading']);
    expect(html).not.toContain(marked['md.section.purpose'] + '</h2>');
    expect(html).toContain(d('role one'));
  });

  it('lists the removed items of the system overview first in the coverage view, with the unit named by its fixed text', () => {
    const html = render(populated, '#/coverage');
    for (const text of ['overview claim', 'overview reason', 'other overview claim', 'other overview reason']) expect(html).toContain(d(text));
    expect(html).toContain(`${MARK}${shipped.strings['md.overview.heading']}: items removed: 2`);
    expect(html.indexOf(d('overview claim'))).toBeLessThan(html.indexOf(d('a claim')));
  });

  it('shows the fixed text for each empty part of a verified system overview that lost every part', () => {
    const html = render(emptyOverview, '#/');
    const part = html.slice(html.indexOf('data-part="system"'), html.indexOf('id="overview-reach"'));
    expect(part.split(marked['md.none']).length - 1).toBe(5);
  });

  it('the instrument sees a fixed text the code wrote itself', () => {
    expect(unmarked('<main><button>Save</button><p>@@Purpose</p><p>d~name</p><a aria-label="Menu">x</a></main>')).toEqual(['Save', 'x', 'Menu']);
  });
});
