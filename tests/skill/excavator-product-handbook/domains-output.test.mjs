// O1 (entities and outputs) of openspec change handbook-map-by-domain: handbook.md,
// handbook-technical.md and the page data group the features by the business
// domains of domains.json, and by the map's areas, with a fixed text that says
// so, when there is no passing domains file; the map, the entries and the
// candidates are never touched, and every output is the same bytes twice.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MARK, clone, makeCheckedMapRun, markedDomains, markedEntry, markedMap, runHandbook, translatedUi, verifyChecked } from './helpers.mjs';
import { checkedOverviewRun } from './overview-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const FROM_AREAS = 'These are areas drawn by the navigation, not business domains.';

/** A run whose F1 is verified (and whose overview is verified), with or without the good domains file. */
function domainsRun({ domains = true } = {}) {
  const run = checkedOverviewRun(cleanups);
  verifyChecked(run, 'overview');
  run.writeEntry('F1', clone(run.entry));
  expect(run.run('check-entry', 'F1').status).toBe(0);
  verifyChecked(run, 'F1');
  if (domains) run.writeDomains();
  return run;
}

const assemble = (run, views = 'product,technical') => {
  const result = run.run('assemble', '--views', views);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return result;
};
const page = (run, views = 'product,technical') => runHandbook(['page', run.out, '--project', run.root, '--views', views], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
const text = (run, name) => readFileSync(join(run.out, name), 'utf-8');
const dataOf = (run) => JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(text(run, 'handbook.html'))[1]);
const sectionOf = (body, from, to) => {
  const start = body.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  const end = to === undefined ? -1 : body.indexOf(to, start + from.length);
  return end === -1 ? body.slice(start) : body.slice(start, end);
};
const digests = (dir, names) => Object.fromEntries(names.map((name) => [name, createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')]));

describe('handbook.md groups the features by business domain', () => {
  it('lists each domain with its features in the order of the map, across the map\'s areas, and writes no fallback text', () => {
    const run = domainsRun();
    assemble(run);
    const md = text(run, 'handbook.md');
    const top = sectionOf(md, '## Domains and features', '| How readers get to it |');
    expect(top).toContain('- **Customer orders**\n  - Orders (From the menu)\n  - Archive (By a link)\n  - Orders (Interface for other systems)');
    expect(top).toContain('- **System upkeep**\n  - Reminders (Automatic)\n  - Admin tool (Operator command)');
    expect(md).not.toContain(FROM_AREAS);
    expect(md).not.toContain('## Areas and features');
  });

  it('writes the chapter of a verified feature under its domain, with the area it sits in as a property', () => {
    const run = domainsRun();
    assemble(run);
    const md = text(run, 'handbook.md');
    expect(md).toContain('## Customer orders\n\n### Orders\n\nHow readers get to it: From the menu');
    expect(md).not.toContain('## Order handling');
    expect(md).toContain('Area in the navigation: Order handling');
  });

  it('computes the domain entity section and the overview table over the domains', () => {
    const run = domainsRun();
    assemble(run);
    const md = text(run, 'handbook.md');
    const domains = sectionOf(md, '## Domains\n', '## Roles');
    expect(domains).toContain('### Customer orders\n\nFeatures: 3. Features with a verified entry: 1.');
    expect(domains).toContain('### System upkeep\n\nFeatures: 2. Features with a verified entry: 0.');
    expect(domains).not.toContain(FROM_AREAS);
    const overview = sectionOf(md, '### Domains and roles', '## Domains and features');
    expect(overview).toContain('| Domain | Features | Verified entries | Roles |');
    expect(overview).toContain('| Customer orders | 3 | 1 | Clerk |');
    expect(overview).toContain('| System upkeep | 2 | 0 | - |');
  });

  it('puts the technical matrix of applications by domain over the business domains', () => {
    const run = domainsRun();
    assemble(run);
    const matrix = sectionOf(text(run, 'handbook-technical.md'), '## Applications by domain');
    expect(matrix).toContain('| Application | Customer orders | System upkeep |');
  });
});

describe('without a passing domains file the handbook falls back to the map\'s areas and says so', () => {
  const fallbackChecks = (run) => {
    assemble(run);
    const md = text(run, 'handbook.md');
    const top = sectionOf(md, '## Areas and features', '| How readers get to it |');
    expect(top).toContain(FROM_AREAS);
    expect(top).toContain('- **Order handling**\n  - Orders (From the menu)\n  - Archive (By a link)');
    expect(md).toContain('## Order handling\n\n### Orders');
    expect(md).not.toContain('Area in the navigation:');
    expect(sectionOf(md, '## Domains\n', '## Roles')).toContain(FROM_AREAS);
    expect(sectionOf(md, '### Areas and roles', '## Areas and features')).toContain('| Area | Features | Verified entries | Roles |');
    expect(sectionOf(text(run, 'handbook-technical.md'), '## Applications by domain')).toContain('| Application | Order handling | Automatic work |');
  };

  it('no domains.json', () => fallbackChecks(domainsRun({ domains: false })));

  it('a domains.json that fails check-domains (a feature left out)', () => {
    const run = domainsRun();
    const broken = clone(run.domains);
    broken.domains[0].features = ['F1', 'F2'];
    run.writeDomains(broken);
    expect(run.run('check-domains').status).toBe(1);
    fallbackChecks(run);
  });

  it('a domains.json that is not JSON', () => {
    const run = domainsRun();
    writeFileSync(join(run.out, 'domains.json'), '{ not json');
    fallbackChecks(run);
  });
});

describe('the page data', () => {
  it('carries the domains, which domain each feature is in and where the grouping comes from; the map\'s areas stay', () => {
    const run = domainsRun();
    expect(page(run).status).toBe(0);
    const data = dataOf(run);
    expect(Object.keys(data)).toEqual(['format', 'project', 'language', 'languageTag', 'ui', 'views', 'areas', 'domains', 'domainBasis', 'features', 'coverage', 'summary', 'system', 'entities', 'technical']);
    expect(data.format).toBe('excavator-product-handbook-page/7');
    expect(data.domainBasis).toBe('domains');
    expect(data.domains).toEqual([{ id: 'D1', name: 'Customer orders' }, { id: 'D2', name: 'System upkeep' }]);
    expect(data.areas).toEqual([{ id: 'A1', name: 'Order handling' }, { id: 'A2', name: 'Automatic work' }]);
    expect(data.features.map((feature) => [feature.id, feature.area, feature.domain])).toEqual([
      ['F1', 'A1', 'D1'], ['F2', 'A1', 'D1'], ['F3', 'A2', 'D2'], ['F4', 'A2', 'D2'], ['F5', 'A2', 'D1'],
    ]);
    expect(data.entities.domains.map((domain) => [domain.id, domain.features])).toEqual([['D1', ['F1', 'F2', 'F5']], ['D2', ['F3', 'F4']]]);
    expect(data.technical.applicationDomain.domains).toEqual(['D1', 'D2']);
    expect(data.system.domains.map((row) => [row.id, row.features, row.verified, row.roles])).toEqual([['D1', 3, 1, ['Clerk']], ['D2', 2, 0, []]]);
    expect(data.ui.strings['md.domains.fromAreas']).toBe(FROM_AREAS);
  });

  it('falls back to the areas and says so in domainBasis; every feature has its area as its domain', () => {
    const run = domainsRun({ domains: false });
    expect(page(run).status).toBe(0);
    const data = dataOf(run);
    expect(data.domainBasis).toBe('areas');
    expect(data.domains).toEqual(data.areas);
    expect(data.features.every((feature) => feature.domain === feature.area)).toBe(true);
    expect(data.entities.domains.map((domain) => domain.id)).toEqual(['A1', 'A2']);
  });
});

describe('every output is the same bytes twice, and the domains change nothing but the grouping', () => {
  it('gives identical handbook.md, handbook-technical.md and page data on a second run', () => {
    const run = domainsRun();
    assemble(run);
    expect(page(run).status).toBe(0);
    const first = ['handbook.md', 'handbook-technical.md', 'handbook.html'].map((name) => text(run, name));
    assemble(run);
    expect(page(run).status).toBe(0);
    expect(['handbook.md', 'handbook-technical.md', 'handbook.html'].map((name) => text(run, name))).toEqual(first);
  });

  it('writing domains.json into an output that has none changes only the handbook: the map, the entries and the candidates are byte for byte the same', () => {
    const run = domainsRun({ domains: false });
    const names = ['map.json', 'candidates.json', 'state.json', 'entries/F1.json', 'entries/overview.json'];
    assemble(run);
    const before = digests(run.out, names);
    const fallback = text(run, 'handbook.md');
    run.writeDomains();
    expect(run.run('check-domains').status).toBe(0);
    assemble(run);
    expect(digests(run.out, names)).toEqual(before);
    expect(text(run, 'handbook.md')).not.toBe(fallback);
    expect(text(run, 'handbook.md')).toContain('## Domains and features');
    expect(readdirSync(run.out).sort()).toEqual(expect.arrayContaining(['domains.json', 'handbook.md']));
  });

  it('the overview counts line gives the area count and the business domain count when the handbook groups by domains', () => {
    const run = domainsRun();
    assemble(run, 'product');
    const md = text(run, 'handbook.md');
    expect(md).toContain('Areas: 2. Business domains: 2. Features: 5.');
    expect(sectionOf(md, '## System overview', '### ')).not.toContain('Areas: 2. Features:');
  });

  it('the overview counts line is the old one, with no domain count, when the handbook falls back to the areas', () => {
    const run = domainsRun({ domains: false });
    assemble(run, 'product');
    const md = text(run, 'handbook.md');
    expect(md).toContain('Areas: 2. Features: 5.');
    expect(md).not.toContain('Business domains:');
  });

  it('the page data carries the domain count in the system counts only when the grouping is by domains', () => {
    const withDomains = domainsRun();
    expect(page(withDomains).status).toBe(0);
    expect(dataOf(withDomains).system.counts.domains).toBe(2);
    const without = domainsRun({ domains: false });
    expect(page(without).status).toBe(0);
    expect(dataOf(without).system.counts.domains).toBeNull();
  });
});

describe('a run in a language with its own script', () => {
  it('writes the domain names and the fixed texts of the domain sections from ui.json', () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    run.writeJson(join(run.out, 'ui.json'), translatedUi('Chinese'));
    run.writeMap(markedMap(run.map));
    expect(run.run('check-map').status).toBe(0);
    run.writeEntry('F1', markedEntry(run.entry));
    expect(run.run('check-entry', 'F1').status).toBe(0);
    verifyChecked(run);
    run.writeDomains(markedDomains(run.domains));
    expect(run.run('check-domains').status).toBe(0);
    expect(run.run('assemble').status).toBe(0);
    const md = text(run, 'handbook.md');
    expect(md).toContain(`## ${MARK}Domains and features`);
    expect(md).toContain(`- **${MARK}Customer orders**`);
    expect(md).toContain(`${MARK}Area in the navigation: `);
    expect(md).not.toContain(FROM_AREAS);
    fallbackText(run);
  });
});

function fallbackText(run) {
  rmSync(join(run.out, 'domains.json'));
  expect(run.run('assemble').status).toBe(0);
  const md = text(run, 'handbook.md');
  expect(md).toContain(`${MARK}${FROM_AREAS}`);
  expect(md.replace(new RegExp(`${MARK}${FROM_AREAS}`, 'g'), '')).not.toContain(FROM_AREAS);
}
