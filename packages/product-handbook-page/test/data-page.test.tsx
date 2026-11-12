// O3 (page) of openspec change handbook-data-tables: the technical view has
// the route #/data, a sidebar link and a data page; the product view has
// neither (the route there is not-found); the page lists the tables, sortable
// by name and by the number of applications, with the places where each name
// appears under a details element; a missing or malformed data.json is one
// line; every fixed text comes from the ui table.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { sortedTables } from '../src/components/DataPage';
import { parseHash, routeHash } from '../src/lib/route';
import type { DataSection, PageData, View } from '../src/lib/types';
import { switchTarget } from '../src/lib/views';
import { NO_APPENDIX, NO_HISTORY } from './empty-parts';

const MARK = '@@';
const DATA = 'd~';
const shipped = JSON.parse(readFileSync(fileURLToPath(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url)), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));
const d = (text: string): string => `${DATA}${text}`;

const mention = (file: string, line: number, rule: 'a' | 'b' | 'c') => ({ file: d(file), line, rule });
const table = (name: string, mentions: DataSection['tables'][number]['mentions'], extra: Partial<DataSection['tables'][number]> = {}): DataSection['tables'][number] => ({
  name: d(name), sources: [{ kind: 'migration', file: d(`m/${name}.js`), line: 4 }], createdBy: d(`m/${name}.js`), lastChangedBy: d(`m/${name}.js`), mentions, ...extra,
});

/** Four tables: `zeta` in two applications and in no application, `alpha` in one, `beta` in no application only, `mid` only in migrations. */
const section: DataSection = {
  recognized: ['migration-calls', 'go-table-name'],
  applications: [{ directory: d('app-one'), migrations: 3 }, { directory: '', migrations: 1 }],
  tables: [
    table('alpha', { [d('app-one')]: [mention('src/a.js', 7, 'a')] }),
    table('beta', { '': [mention('tools/b.py', 1, 'b')] }),
    table('mid', {}, { createdBy: null }),
    table('zeta', { [d('app-one')]: [mention('src/z.js', 2, 'b'), mention('src/y.js', 9, 'a')], [d('app-two')]: [mention('web/z.ts', 4, 'a')], '': [mention('tools/t.py', 3, 'b')] }, { sources: [{ kind: 'model', file: d('models/z.go'), line: 5 }, { kind: 'sql', file: d('db/schema.sql'), line: 2 }] }),
  ],
  dropped: [{ name: d('old'), file: d('m/002.js'), line: 5, createdBy: d('m/001.js'), directory: d('m') }],
  changedNeverCreated: [d('mid')],
  declaredOnly: [d('zeta')],
  removedButDeclared: [d('beta')],
  onlyInMigrations: [d('mid')],
  gaps: {
    unsplitMigrations: [{ file: d('m/012.js') }],
    unnamedOperations: [{ file: d('m/008.js'), line: 7, op: 'create-table', via: 'call' }],
    unresolvedModelNames: [{ file: d('models/dup.go'), line: 7, expression: d('tableDup'), matches: 2 }, { file: d('models/f.go'), line: 5, expression: d('fmt.Sprintf()'), matches: null }],
    otherMigrationFiles: [{ file: d('m/README.md'), reason: 'extension' }],
  },
  counts: {
    tables: 4, migrations: 4, migrationsReplayed: 3, migrationsUnsplit: 1, migrationsDownOnly: 0, otherMigrationFiles: 1,
    operations: { total: 5, create: 3, drop: 1, rename: 0, change: 0, unnamed: 1 },
    declarations: { total: 3, model: 1, sql: 1, unresolved: 2 },
    dropped: 1, removedButDeclared: 1, changedNeverCreated: 1, declaredOnly: 1, onlyInMigrations: 1, tablesInSeveralApplications: 1, gaps: 4,
  },
};

function dataFor(views: View[], dataSection: DataSection | null = section, dataState: 'ok' | 'missing' | 'malformed' = 'ok'): PageData {
  return {
    format: 'excavator-product-handbook-page/14',
    project: d('project'),
    language: d('language'),
    languageTag: 'xx',
    ui: { strings: marked },
    views,
    areas: [{ id: 'A1', name: d('area') }],
    domains: [{ id: 'D1', name: d('domain') }],
    domainBasis: 'domains',
    features: [],
    findings: [],
    remedies: { categories: [], recommendations: [] },
    topics: { approval: [], time: [], handoffs: [], access: [], repeated: [] },
    history: NO_HISTORY,
    appendix: NO_APPENDIX,
    coverage: { candidateTotal: 0, assigned: 0, unassigned: [], reachCounts: [], removedOverview: [], removed: [], findingsUnfinished: [], findingsNotWritten: 0, findingsRemoved: [], systemFindingsTotal: 0, systemFindingsUnfinished: [], systemFindingsNotWritten: 0, systemFindingsRemoved: [], priority: { finished: true, unranked: [] }, remedies: { finished: true, stale: false, dropped: [] }, topics: { finished: true, stale: false, entriesRead: 0, groupsRead: 0, lanes: [], dropped: [] } },
    summary: { notifications: [], jobs: [], counts: { featureTotal: 0, featuresWithEntry: 0, notificationRows: 0, jobRows: 0, schedule: { literal: 0, computed: 0, absent: 0 }, described: 0 } },
    system: { status: 'planned', overview: null, applications: [], counts: { applications: 0, files: 0, lines: 0, areas: 1, domains: 1, features: 0, featuresWithEntry: 0, roles: 0 }, areas: [], domains: [] },
    entities: { domains: [{ id: 'D1', name: d('domain'), features: [], purposes: [] }], roles: [], roleFeature: { roles: [], features: [], cells: [] } },
    ...(views.includes('technical') ? {
      technical: {
        featureApplication: [], unattributed: [], applicationDomain: { applications: [], domains: [], cells: [], unattributed: [] },
        integrations: [], jobs: [], locations: [], findingLocations: [], topicLocations: [], history: { hotspots: [], coChange: [] }, data: dataSection, dataState, dictionaries: null, dictionariesState: 'missing' as const,
      },
    } : {}),
  };
}

const BOTH: View[] = ['product', 'technical'];
const render = (data: PageData, hash: string): string => renderToStaticMarkup(<AppView data={data} route={parseHash(hash)} />);
const decode = (text: string): string => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function visibleTexts(html: string): string[] {
  const nodes = html.split(/<[^>]*>/).map((text) => decode(text).trim()).filter((text) => text !== '');
  const attributes = Array.from(html.matchAll(/\s(?:aria-label|title|alt|placeholder|aria-description)="([^"]*)"/g), (match) => decode(match[1]).trim());
  return [...nodes, ...attributes];
}
const unmarked = (html: string): string[] => visibleTexts(html).filter((text) => !text.includes(MARK) && !(text.startsWith(DATA) && !text.includes('@')) && !/^\d+$/.test(text));
const main = (html: string): string => html.slice(html.indexOf('<main'));
const railOf = (html: string) => html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>', html.indexOf('<nav class="rail"')));

/** The block of one table in the tables list: from its item to the next item (or the end of the list). */
const item = (html: string, name: string): string => {
  const from = html.indexOf(`<li class="item" data-table="${d(name)}">`);
  expect(from, name).toBeGreaterThan(0);
  const rest = html.slice(from + 1);
  const next = rest.indexOf('<li class="item"');
  return rest.slice(0, next < 0 ? rest.indexOf('</ul></div>') : next);
};

describe('the data route and link', () => {
  it('parses #/data with and without the view and builds it back', () => {
    expect(parseHash('#/data')).toEqual({ name: 'data' });
    expect(parseHash('#/technical/data')).toEqual({ name: 'data', view: 'technical' });
    expect(parseHash('#/technical/data/x').name).toBe('not-found');
    expect(routeHash({ name: 'data' }, null)).toBe('#/data');
    expect(routeHash({ name: 'data' }, 'technical')).toBe('#/technical/data');
  });

  it('the technical view has the sidebar link and the page; the product view has neither', () => {
    const data = dataFor(BOTH);
    const technical = render(data, '#/technical');
    expect(railOf(technical)).toContain('href="#/technical/data"');
    const product = render(data, '#/product');
    expect(railOf(product)).not.toContain('/data"');
    expect(product).not.toContain('data-view="data"');
  });

  it('the route in the product view, or in a page without the technical view, is the not-found page', () => {
    expect(render(dataFor(BOTH), '#/product/data')).toContain('data-view="not-found"');
    expect(render(dataFor(['product']), '#/data')).toContain('data-view="not-found"');
    expect(render(dataFor(['product']), '#/technical/data')).toContain('data-view="not-found"');
    expect(render(dataFor(BOTH), '#/product/data')).not.toContain(d('zeta'));
    expect(render(dataFor(['technical']), '#/data')).toContain('data-view="data"');
  });

  it('switching from the data page goes to the overview of the product view, and into it from the product overview stays on the overview', () => {
    const data = dataFor(BOTH);
    expect(switchTarget(data, parseHash('#/technical/data'), 'product')).toBe('#/product');
    expect(switchTarget(data, parseHash('#/product/data'), 'technical')).toBe('#/technical/data');
  });
});

describe('the data page', () => {
  const html = render(dataFor(BOTH), '#/technical/data');
  const body = main(html);

  it('shows the fixed note, the recognized forms and the count line', () => {
    for (const key of ['md.data.note.nameRules', 'md.data.note.comments', 'md.data.note.ormDefaults', 'md.data.note.onlyInMigrationsAnyRule']) expect(body, key).toContain(marked[key]);
    expect(body).toContain(`${MARK}Forms of table declaration recognized in this version: ${marked['md.data.form.migrationCalls']}; ${marked['md.data.form.goTableName']}.`);
    expect(body).toContain(`${MARK}Tables: 4. Migrations: 4 (3 replayed, 1 not split, 0 down only). Tables whose name appears in two or more applications: 1. Tables whose name appears only in migrations: 1. Tables dropped by a migration: 1. Tables declared by a model or a .sql file and created by no migration: 1. Tables removed by a migration and still declared: 1. Tables changed by a migration and created by none: 1. Gaps: 4.`);
  });

  it('lists one row per table, by name, with the applications and counts, and the fixed text for a name that is only in migrations', () => {
    // The declared places and the paths are long, so a table is a block with its fields, not a row of a table.
    const rows = body.slice(body.indexOf('data-part="data-tables"')).match(/<li class="item" data-table="[^"]*">/g) ?? [];
    expect(rows).toEqual([d('alpha'), d('beta'), d('mid'), d('zeta')].map((name) => `<li class="item" data-table="${name}">`));
    expect(item(body, 'zeta')).toContain(`${MARK}${d('app-one')}: 2`);
    expect(item(body, 'zeta')).toContain(`${MARK}${marked['md.data.noApplication']}: 1`);
    expect(item(body, 'mid')).toContain(marked['md.data.onlyInMigrationsCell']);
  });

  it('puts the places where a name appears in a details element, with the rule of each', () => {
    const row = item(body, 'zeta');
    expect(row).toContain('<details class="data-mentions">');
    expect(row).toContain(`${MARK}Where the name appears (4)`);
    expect(row).toContain(`${MARK}${MARK}${d('src/z.js')}, line 2 (${marked['md.data.rule.b']})`);
    expect(row).toContain(`${MARK}${MARK}${d('src/y.js')}, line 9 (${marked['md.data.rule.a']})`);
    expect(row).toContain(`${MARK}${MARK}${d('tools/t.py')}, line 3 (${marked['md.data.rule.b']})`);
  });

  it('shows the earlier name a source line shows, next to the place, and nothing when the line shows the current name', () => {
    const renamed: DataSection = { ...section, tables: [table('now', {}, { sources: [{ kind: 'migration', file: d('m/old.js'), line: 3, as: d('before') }, { kind: 'migration', file: d('m/now.js'), line: 8 }] })] };
    const row = main(render(dataFor(BOTH, renamed), '#/technical/data'));
    expect(row).toContain(`${MARK}migration: ${MARK}${d('m/old.js')}, line 3 (as ${d('before')})`);
    expect(row).not.toContain(`${d('m/now.js')}, line 8 (as`);
  });

  it('words rule c from the ui table', () => {
    const withC: DataSection = { ...section, tables: [table('joined', { [d('app-one')]: [mention('models/j.go', 4, 'c')] })] };
    expect(main(render(dataFor(BOTH, withC), '#/technical/data'))).toContain(`${MARK}${MARK}${d('models/j.go')}, line 4 (${marked['md.data.rule.c']})`);
    expect(marked['md.data.rule.c']).not.toBe('@@undefined');
  });

  it('has the sort controls, the by-name one pressed first', () => {
    expect(body).toContain(`aria-pressed="true"`);
    expect(body).toContain(marked['page.data.sort.name']);
    expect(body).toContain(marked['page.data.sort.applications']);
  });

  it('lists the dropped tables, the other lists and the four gap lists', () => {
    for (const key of ['md.data.droppedHeading', 'md.data.declaredOnlyHeading', 'md.data.removedButDeclaredHeading', 'md.data.changedNeverCreatedHeading', 'md.data.onlyInMigrationsHeading', 'md.data.gapsHeading', 'md.data.gap.unnamedHeading', 'md.data.gap.unsplitHeading', 'md.data.gap.unresolvedHeading', 'md.data.gap.otherHeading']) expect(body, key).toContain(marked[key]);
    expect(body).toContain(`${MARK}${MARK}${d('models/dup.go')}, line 7: ${d('tableDup')} (2 declarations found)`);
    expect(body).toContain(`${MARK}${MARK}${d('models/f.go')}, line 5: ${d('fmt.Sprintf()')}`);
  });
});

describe('the sort', () => {
  it('by name is byte order of the names; by applications is the number of applications with a name in them, most first, then by name', () => {
    expect(sortedTables(section.tables, 'name').map((entry) => entry.name)).toEqual([d('alpha'), d('beta'), d('mid'), d('zeta')]);
    expect(sortedTables(section.tables, 'applications').map((entry) => entry.name)).toEqual([d('zeta'), d('alpha'), d('beta'), d('mid')]);
  });

  it('does not count the "in no application" bucket as an application, and does not change the list it is given', () => {
    const copy = JSON.stringify(section.tables);
    sortedTables(section.tables, 'applications');
    expect(JSON.stringify(section.tables)).toBe(copy);
  });
});

describe('a section that is missing or malformed', () => {
  it('is the heading and one line, and no table', () => {
    for (const [state, key] of [['missing', 'md.data.notWritten'], ['malformed', 'md.data.malformed']] as const) {
      const html = render(dataFor(BOTH, null, state), '#/technical/data');
      expect(main(html)).toContain(marked[key]);
      expect(main(html)).not.toContain('data-table=');
      expect(main(html).match(/data-part="data-status"/g)?.length, state).toBe(1);
    }
  });
});

describe('every fixed text of the data page comes from the ui table', () => {
  for (const [name, data, hash] of [
    ['full', dataFor(BOTH), '#/technical/data'],
    ['missing', dataFor(BOTH, null, 'missing'), '#/technical/data'],
    ['malformed', dataFor(['technical'], null, 'malformed'), '#/data'],
    ['not found in the product view', dataFor(BOTH), '#/product/data'],
  ] as const) {
    it(name, () => {
      const html = render(data, hash);
      expect(visibleTexts(html).length).toBeGreaterThan(3);
      expect(unmarked(html)).toEqual([]);
    });
  }
});
