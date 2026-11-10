// O1 (entities and relations) of openspec change handbook-entities-and-views:
// the entities and relations the script computes from the verified units.
// The inputs are built by hand so each rule is tested on its own; the
// end-to-end behaviour through assemble and page is in views-output.test.mjs.
import { afterEach, describe, expect, it } from 'vitest';

import { scanProject } from '../../../skills/excavator-product-handbook/lib/applications.mjs';
import { buildEntities, owningApplication } from '../../../skills/excavator-product-handbook/lib/entities.mjs';
import { SYSTEM, entryOf, ev, makeProject } from './entities-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const APPS = [
  { dir: 'other', name: 'Other app', does: 'Does other things.' },
  { dir: 'svc', name: 'Service', does: 'Does the main things.' },
  { dir: 'svc/admin', name: 'Admin', does: 'Does the admin things.' },
];

const MAP = {
  areas: [{ id: 'A1', name: 'Orders' }, { id: 'A2', name: 'Admin work' }],
  roles: [{ label: 'Clerk' }, { label: 'Approver' }, { label: 'Nobody' }],
  features: [
    { id: 'F1', name: 'Place', area: 'A1', candidates: [] },
    { id: 'F2', name: 'Review', area: 'A1', candidates: [] },
    { id: 'F3', name: 'Panel', area: 'A2', candidates: [] },
    { id: 'F4', name: 'Not verified', area: 'A2', candidates: [] },
  ],
};

const CANDIDATES = [
  { id: 'c1', kind: 'job', file: 'other/jobs.js', line: 1 },
  { id: 'c2', kind: 'job', file: 'svc/routes.js', line: 1 },
];

function project(extra) {
  const made = makeProject(extra);
  cleanups.push(made.cleanup);
  return made.root;
}

/** Entries of F1 (three citations in svc, one in svc/admin), F2 (two in other) and F3 (three in svc/admin); F4 has none. */
function entries() {
  return new Map([
    ['F1', entryOf({
      purpose: 'Staff place orders.',
      who: [{ role: 'Clerk', can: 'Creates orders.', at: ev('svc/routes.js', 'export const routes = 1;') }, { role: 'Clerk', can: 'Edits orders.', at: ev('svc/routes.js', 'export const more = 2;') }],
      cites: [ev('svc/a.js', 'export const a = 1;'), ev('svc/admin/panel.js', 'export const panel = 1;')],
    })],
    ['F2', entryOf({
      purpose: 'Staff review orders.',
      who: [{ role: 'Approver', can: 'Approves.', at: ev('other/d.js', 'export const d = 1;') }],
      cites: [ev('other/d.js', 'export const d = 1;')],
    })],
    ['F3', entryOf({
      purpose: 'Admins open the panel.',
      cites: [ev('svc/admin/panel.js', 'export const rows = 2;'), ev('svc/admin/panel.js', 'export const title = 3;'), ev('svc/admin/panel.js', 'export const panel = 1;')],
    })],
  ]);
}

const SUMMARY = {
  notifications: [{ feature: 'F1', trigger: 't', recipient: 'r', channel: 'c', content: 'x' }],
  jobs: [
    { kind: 'job', candidate: 'c1', feature: 'F2', reason: null, schedule: { bucket: 'absent', literal: null }, automatic: [] },
    { kind: 'job', candidate: 'c2', feature: null, reason: 'left out', schedule: { bucket: 'absent', literal: null }, automatic: [] },
  ],
};

function build(root, { applications = APPS, integrations = [{ system: SYSTEM, use: 'Messages.', callers: ['svc'] }], entriesMap = entries(), overview = true, domains } = {}) {
  const system = { applications, overview: overview ? { integrations } : null };
  return buildEntities({ map: MAP, domains: domains ?? null, entries: entriesMap, candidates: CANDIDATES, summary: SUMMARY, system, scan: scanProject(root) });
}

describe('owningApplication: the directory that holds a file, the longest match', () => {
  it('prefers the deepest listed directory, whatever the order of the list, and the project root only when nothing is deeper', () => {
    expect(owningApplication(['svc', 'svc/admin'], 'svc/admin/a.go')).toBe('svc/admin');
    expect(owningApplication(['svc/admin', 'svc'], 'svc/admin/a.go')).toBe('svc/admin');
    expect(owningApplication(['svc', 'svc/admin'], 'svc/b.go')).toBe('svc');
    expect(owningApplication(['.', 'svc'], 'svc/b.go')).toBe('svc');
    expect(owningApplication(['.', 'svc'], 'top.go')).toBe('.');
    expect(owningApplication(['svc'], 'svcx/a.go')).toBeNull();
    expect(owningApplication([], 'a.go')).toBeNull();
  });
});

describe('entities: the entities', () => {
  it('has a domain for each area of the map and lists its features and the purposes of the verified ones', () => {
    const { domains } = build(project());
    expect(domains.map(({ id, name, features, purposes, relations }) => ({ id, name, features, purposes, relations }))).toEqual([
      { id: 'A1', name: 'Orders', features: ['F1', 'F2'], purposes: [{ feature: 'F1', text: 'Staff place orders.' }, { feature: 'F2', text: 'Staff review orders.' }], relations: [] },
      { id: 'A2', name: 'Admin work', features: ['F3', 'F4'], purposes: [{ feature: 'F3', text: 'Admins open the panel.' }], relations: [] },
    ]);
  });

  it('relates a domain to another by the handoffs of verified entries only, out of the domain and into it, and leaves out a handoff inside one domain (handbook-deep-entry D12)', () => {
    const map = entries();
    const handoff = (feature, text) => ({ feature, text, evidence: [ev('svc/a.js', 'export const a = 1;')] });
    map.get('F1').operations = [
      { name: 'Place', sentences: [], handoffs: [handoff('F3', 'The panel shows the new order.'), handoff('F2', 'Review picks it up.')] },
      { name: 'Cancel', sentences: [] },
    ];
    map.get('F3').operations = [{ name: 'Open', sentences: [], handoffs: [handoff('F2', 'An admin sends an order back to review.')] }];
    const { domains } = build(project(), { entriesMap: map });
    expect(domains[0].relations).toEqual([
      { direction: 'out', domain: 'A2', from: 'F1', to: 'F3', text: 'The panel shows the new order.' },
      { direction: 'in', domain: 'A2', from: 'F3', to: 'F2', text: 'An admin sends an order back to review.' },
    ]);
    expect(domains[1].relations).toEqual([
      { direction: 'out', domain: 'A1', from: 'F3', to: 'F2', text: 'An admin sends an order back to review.' },
      { direction: 'in', domain: 'A1', from: 'F1', to: 'F3', text: 'The panel shows the new order.' },
    ]);
    map.delete('F3');
    expect(build(project(), { entriesMap: map }).domains[1].relations).toEqual([{ direction: 'in', domain: 'A1', from: 'F1', to: 'F3', text: 'The panel shows the new order.' }]);
  });

  it('gives each domain the states and transitions of its verified entries, by feature (handbook-domain-page D2)', () => {
    const map = entries();
    map.get('F3').transitions = [{ from: 'S0', to: 'S1', by: 'Opens.', evidence: [ev('svc/admin/panel.js', 'export const panel = 1;')] }];
    const { domains } = build(project(), { entriesMap: map });
    expect(domains[0].states).toEqual([{ feature: 'F1', label: 'S0', meaning: 'm' }]);
    expect(domains[0].transitions).toEqual([]);
    expect(domains[1].states).toEqual([{ feature: 'F3', label: 'S0', meaning: 'm' }, { feature: 'F3', label: 'S1', meaning: 'm' }]);
    expect(domains[1].transitions).toEqual([{ feature: 'F3', from: 'S0', to: 'S1', by: 'Opens.' }]);
  });

  it('counts the files the verified entries of each domain cite, most cited first, then by path (handbook-domain-page D2)', () => {
    const { domainFiles } = build(project());
    expect(domainFiles).toEqual([
      { domain: 'A1', files: [{ file: 'other/d.js', citations: 2 }, { file: 'svc/routes.js', citations: 2 }, { file: 'svc/a.js', citations: 1 }, { file: 'svc/admin/panel.js', citations: 1 }] },
      { domain: 'A2', files: [{ file: 'svc/admin/panel.js', citations: 3 }] },
    ]);
  });

  it('has a role for each role of the map, with or without a verified entry that names it', () => {
    expect(build(project()).roles).toEqual([{ label: 'Clerk' }, { label: 'Approver' }, { label: 'Nobody' }]);
  });

  it('has every application the system lists, root or below one, with the name and responsibility it was given', () => {
    expect(build(project()).applications).toEqual(APPS);
  });

  it('without a verified overview: every application stays with no name, and there is no external system', () => {
    const bare = [{ dir: 'other', name: null, does: null }, { dir: 'svc', name: null, does: null }];
    const result = build(project(), { applications: bare, overview: false });
    expect(result.applications).toEqual(bare);
    expect(result.integrations).toEqual([]);
  });

  it('links each notification and each scheduled job to its feature, and each job to the application that holds its registration file', () => {
    const result = build(project());
    expect(result.notifications).toEqual([{ index: 0, feature: 'F1' }]);
    expect(result.jobs).toEqual([{ candidate: 'c1', feature: 'F2', application: 'other' }, { candidate: 'c2', feature: null, application: 'svc' }]);
  });
});

describe('entities: citations go to the application with the longest matching directory', () => {
  it('counts a citation under svc/admin for svc/admin and not for svc, per feature', () => {
    const { relations } = build(project());
    expect(relations.featureApplication).toEqual([
      { feature: 'F1', application: 'svc', citations: 3 },
      { feature: 'F1', application: 'svc/admin', citations: 1 },
      { feature: 'F2', application: 'other', citations: 2 },
      { feature: 'F3', application: 'svc/admin', citations: 3 },
    ]);
  });

  it('shows a citation in no application as unattributed, so no citation is dropped', () => {
    const root = project();
    const result = build(root, { applications: [{ dir: 'other', name: null, does: null }] });
    expect(result.relations.featureApplication).toEqual([{ feature: 'F2', application: 'other', citations: 2 }]);
    expect(result.relations.unattributed).toEqual([{ feature: 'F1', citations: 4 }, { feature: 'F3', citations: 3 }]);
  });

  it('counts every citation of a verified unit exactly once between the applications and the unattributed', () => {
    const { relations } = build(project());
    const total = [...relations.featureApplication, ...relations.unattributed].reduce((sum, row) => sum + row.citations, 0);
    const expected = [...entries().values()].reduce((sum, entry) => sum + entry.who.length + (entry.purpose === undefined ? 0 : 1) + entry.states.length, 0);
    expect(total).toBe(expected);
  });

  it('puts no relation or matrix cell on a feature that has no verified entry, a confirmed one included', () => {
    const only = entries();
    only.delete('F3');
    const result = build(project(), { entriesMap: only });
    expect(result.relations.featureApplication.map((row) => row.feature)).not.toContain('F3');
    expect(result.matrices.roleFeature.features).toEqual(['F1', 'F2']);
    expect(result.domains[1].purposes).toEqual([]);
  });
});

describe('entities: the matrices agree with the relations', () => {
  it('role by feature: a cell holds what the entry says the role can do, in entry order, and a role the entry does not name has no cell', () => {
    const { matrices } = build(project());
    expect(matrices.roleFeature).toEqual({
      roles: ['Clerk', 'Approver', 'Nobody'],
      features: ['F1', 'F2', 'F3'],
      cells: [{ role: 'Clerk', feature: 'F1', can: ['Creates orders.', 'Edits orders.'] }, { role: 'Approver', feature: 'F2', can: ['Approves.'] }],
    });
  });

  it('application by domain: a cell is the sum of the citations of the domain\'s features in that application', () => {
    const { matrices, relations } = build(project());
    expect(matrices.applicationDomain.applications).toEqual(['other', 'svc', 'svc/admin']);
    expect(matrices.applicationDomain.domains).toEqual(['A1', 'A2']);
    expect(matrices.applicationDomain.cells).toEqual([
      { application: 'other', domain: 'A1', citations: 2 },
      { application: 'svc', domain: 'A1', citations: 3 },
      { application: 'svc/admin', domain: 'A1', citations: 1 },
      { application: 'svc/admin', domain: 'A2', citations: 3 },
    ]);
    const area = new Map(MAP.features.map((feature) => [feature.id, feature.area]));
    for (const cell of matrices.applicationDomain.cells) {
      const sum = relations.featureApplication.filter((row) => row.application === cell.application && area.get(row.feature) === cell.domain).reduce((total, row) => total + row.citations, 0);
      expect(cell.citations).toBe(sum);
    }
    expect(matrices.applicationDomain.unattributed).toEqual([]);
  });

  it('application by domain: the citations that sit in no application are listed per domain', () => {
    const result = build(project(), { applications: [{ dir: 'other', name: null, does: null }] });
    expect(result.matrices.applicationDomain.unattributed).toEqual([{ domain: 'A1', citations: 4 }, { domain: 'A2', citations: 3 }]);
  });
});

describe('entities: external systems and the two relations to applications', () => {
  it('keeps the callers the citations show apart from the applications whose source holds the name, which the script finds', () => {
    const [system] = build(project()).integrations;
    expect(system.system).toBe(SYSTEM);
    expect(system.use).toBe('Messages.');
    expect(system.shown).toEqual(['svc']);
    // svc: a.js (a comment) and a2.js; svc/admin: b.js. The test file, the dependency and the lower case spelling do not count.
    expect(system.named).toEqual([{ application: 'svc', files: 2 }, { application: 'svc/admin', files: 1 }]);
    expect(system.namedOutside).toBe(0);
  });

  it('finds an application the model did not list as a caller (the shown relation is not widened by the search)', () => {
    const root = project();
    const [system] = build(root, { integrations: [{ system: SYSTEM, use: 'Messages.', callers: ['other'] }] }).integrations;
    expect(system.shown).toEqual(['other']);
    expect(system.named.map((entry) => entry.application)).toEqual(['svc', 'svc/admin']);
  });

  it('counts a name in a comment, does not count another case, a test file or a skipped directory, and is case sensitive', () => {
    const root = project({ 'other/e.js': `// ${SYSTEM.toUpperCase()} only in capitals\n`, 'other/f.js': `// ${SYSTEM}\n` });
    const [system] = build(root).integrations;
    expect(system.named).toEqual([{ application: 'other', files: 1 }, { application: 'svc', files: 2 }, { application: 'svc/admin', files: 1 }]);
  });

  it('counts the files of a listed sub-application for it and not again for its root', () => {
    const [system] = build(project()).integrations;
    expect(system.named.find((entry) => entry.application === 'svc').files).toBe(2);
    expect(system.named.find((entry) => entry.application === 'svc/admin').files).toBe(1);
  });

  it('shows a name found in a file that no application holds as a count of its own', () => {
    const root = project();
    const result = build(root, { applications: [{ dir: 'other', name: null, does: null }] });
    expect(result.integrations[0].named).toEqual([]);
    expect(result.integrations[0].namedOutside).toBe(3);
  });

  it('gives each system its own result, in the order of the overview', () => {
    const root = project({ 'other/g.js': "export const g = 'Jira';\n" });
    const { integrations } = build(root, { integrations: [{ system: 'Jira', use: 'Tickets.', callers: ['svc'] }, { system: SYSTEM, use: 'Messages.', callers: ['svc'] }] });
    expect(integrations.map((entry) => entry.system)).toEqual(['Jira', SYSTEM]);
    expect(integrations[0].named).toEqual([{ application: 'other', files: 1 }]);
  });
});

describe('entities: same input, same bytes', () => {
  it('gives the same object twice and from another copy of the project', () => {
    const first = JSON.stringify(build(project()));
    expect(JSON.stringify(build(project()))).toBe(first);
    expect(first).not.toMatch(/\/(?:private\/)?(?:var|tmp)\//);
  });
});

// O1 of openspec change handbook-map-by-domain: the domains of the entities are
// the business domains of domains.json, and the map's areas only when there is
// none. D1 crosses the two areas of MAP (F1 and F2 are in A1, F3 and F4 in A2);
// the features of D2 and D1 are listed in another order than the map's.
const BUSINESS = {
  format: 'excavator-product-handbook-domains/1',
  language: 'English',
  domains: [
    { id: 'D1', name: 'Orders and panels', features: ['F3', 'F1', 'F2'] },
    { id: 'D2', name: 'Upkeep', features: ['F4'] },
  ],
};

describe('entities: business domains', () => {
  it('takes the domains from domains.json, each with its features in the order of the map, even when they cross the map\'s areas', () => {
    const { domains, domainBasis } = build(project(), { domains: BUSINESS });
    expect(domainBasis).toBe('domains');
    expect(domains.map(({ id, name, features, purposes, relations }) => ({ id, name, features, purposes, relations }))).toEqual([
      {
        id: 'D1',
        name: 'Orders and panels',
        features: ['F1', 'F2', 'F3'],
        purposes: [{ feature: 'F1', text: 'Staff place orders.' }, { feature: 'F2', text: 'Staff review orders.' }, { feature: 'F3', text: 'Admins open the panel.' }],
        relations: [],
      },
      { id: 'D2', name: 'Upkeep', features: ['F4'], purposes: [], relations: [] },
    ]);
  });

  it('falls back to the areas of the map when there is no domains file, and says so in domainBasis', () => {
    const { domains, domainBasis } = build(project());
    expect(domainBasis).toBe('areas');
    expect(domains.map((domain) => [domain.id, domain.name, domain.features])).toEqual([['A1', 'Orders', ['F1', 'F2']], ['A2', 'Admin work', ['F3', 'F4']]]);
  });

  it('sums the application by domain matrix over the business domains, not over the areas', () => {
    const { matrices, relations } = build(project(), { domains: BUSINESS });
    expect(matrices.applicationDomain.domains).toEqual(['D1', 'D2']);
    expect(matrices.applicationDomain.cells).toEqual([
      { application: 'other', domain: 'D1', citations: 2 },
      { application: 'svc', domain: 'D1', citations: 3 },
      { application: 'svc/admin', domain: 'D1', citations: 4 },
    ]);
    expect(matrices.applicationDomain.unattributed).toEqual([]);
    const total = matrices.applicationDomain.cells.reduce((sum, cell) => sum + cell.citations, 0);
    expect(total).toBe(relations.featureApplication.reduce((sum, row) => sum + row.citations, 0));
  });

  it('lists the citations of a business domain that sit in no application under that domain', () => {
    const result = build(project(), { applications: [{ dir: 'other', name: null, does: null }], domains: BUSINESS });
    expect(result.matrices.applicationDomain.unattributed).toEqual([{ domain: 'D1', citations: 7 }]);
  });

  it('does not change what the domains do not touch: relations, roles and the role by feature matrix are the same either way', () => {
    const withDomains = build(project(), { domains: BUSINESS });
    const without = build(project());
    expect(withDomains.relations).toEqual(without.relations);
    expect(withDomains.roles).toEqual(without.roles);
    expect(withDomains.matrices.roleFeature).toEqual(without.matrices.roleFeature);
  });

  it('gives the same object twice, whatever the order the domains file lists its features in', () => {
    const first = JSON.stringify(build(project(), { domains: BUSINESS }));
    const reordered = { ...BUSINESS, domains: [{ ...BUSINESS.domains[0], features: ['F2', 'F3', 'F1'] }, BUSINESS.domains[1]] };
    expect(JSON.stringify(build(project(), { domains: reordered }))).toBe(first);
  });
});
