// O2 (output) of openspec change handbook-feature-findings: assemble and page
// write a Findings chapter in both views (counts by category, grouped by
// category, the feature's name and the statement; the technical view also the
// file and line, the product view never), only for verified units, the feature
// section lists its own findings, the coverage section lists the units not
// finished and the removed findings with their reasons, and a verified unit
// whose file changed is refused like an entry.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { categoryKey } from '../../../skills/excavator-product-handbook/lib/findings-shape.mjs';
import { clone, judge, runHandbook, traceFeature, verifyChecked } from './helpers.mjs';
import { DELETE_LINE, JOBS_FILE, ORDERS_FILE, findingsRun, goodFindings, unitId } from './findings-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const REMOVED_REASON = 'The code shown stores the order.';
const FAILED_TEXT = 'The admin tool must never be run twice at once.';
const UNFINISHED_TEXT = 'The interface for other systems deletes by number and always answers success.';
const ui = JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;
const CATEGORY_NAMES = Object.keys(ui).filter((key) => key.startsWith('md.findings.category.')).map((key) => ui[key]);

const assemble = (run, views) => run.run('assemble', '--views', views);
const text = (run, name) => readFileSync(join(run.out, name), 'utf-8');
const page = (run, views = 'product,technical') => runHandbook(['page', run.out, '--project', run.root, '--views', views], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
const dataOf = (run) => JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(text(run, 'handbook.html'))[1]);

/** The part of the handbook between a heading and the next heading of the same or a higher level. */
function section(body, heading) {
  const level = heading.match(/^#+/)[0].length;
  const start = body.indexOf(`\n${heading}\n`);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const rest = body.slice(start + heading.length + 2);
  const end = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * F1: verified entry and verified findings (one of three removed by a verifier);
 * F2: verified with no finding; F3: verified findings but no entry; F4: findings
 * that failed their check; F5: findings that passed the check and wait for the
 * verifiers. Nothing is written for the units that are not verified.
 */
function outputRun(owner = cleanups) {
  const run = findingsRun(owner);
  run.writeEntry('F1');
  expect(run.run('check-entry', 'F1').status).toBe(0);
  verifyChecked(run, 'F1');

  run.writeFindings('F1');
  expect(run.run('check-findings', unitId('F1')).status).toBe(0);
  const judged = judge(run, unitId('F1'), 1, (item) => (item.id === 'findings[1]' ? { verdict: 'contradicted', reason: REMOVED_REASON } : 'verified'));
  expect(judged.status, judged.stdout).toBe(0);
  expect(traceFeature(run, unitId('F1')).lines).toEqual(['F1.findings: verified (2 items)']);

  run.writeFindings('F2', { ...goodFindings('F2'), findings: [], unknowns: [] });
  expect(run.run('check-findings', unitId('F2')).lines).toEqual(['F2.findings: verified (0 findings)']);

  run.writeFindings('F3');
  expect(run.run('check-findings', unitId('F3')).status).toBe(0);
  verifyChecked(run, unitId('F3'));

  const failed = goodFindings('F4');
  failed.findings = [{ category: 'consistency', text: FAILED_TEXT, evidence: [{ file: 'bin/admin.js', passage: "console.log('admin');" }] }];
  run.writeFindings('F4', failed);
  expect(run.run('check-findings', unitId('F4')).status).toBe(1);

  const unfinished = goodFindings('F5');
  unfinished.findings = [{ category: 'authorization', text: UNFINISHED_TEXT, evidence: [{ file: ORDERS_FILE, passage: DELETE_LINE }] }];
  run.writeFindings('F5', unfinished);
  expect(run.run('check-findings', unitId('F5')).status).toBe(0);
  return run;
}

// The tests that only read the outputs share one run (it takes seconds to build); the ones that change a file build their own.
const sharedCleanups = [];
let sharedRun = null;
const shared = () => {
  sharedRun ??= outputRun(sharedCleanups);
  return sharedRun;
};
afterAll(() => {
  while (sharedCleanups.length > 0) sharedCleanups.pop()();
});

describe('the Findings chapter', () => {
  it('is in both views, after the entity sections and before the coverage section', () => {
    const run = shared();
    for (const views of ['product', 'technical']) {
      expect(assemble(run, views).status).toBe(0);
      const body = text(run, views === 'product' ? 'handbook.md' : 'handbook-technical.md');
      const at = (needle) => body.indexOf(needle);
      expect(at(`\n## ${ui['md.findings.heading']}\n`), views).toBeGreaterThan(at(`\n## ${ui['md.entities.roles.heading']}\n`));
      expect(at(`\n## ${ui['md.findings.heading']}\n`), views).toBeLessThan(at(`\n## ${ui['md.coverage.heading']}\n`));
    }
  });

  it('writes the verified findings only: the feature name and the statement, grouped by category in the order of the enum', () => {
    const run = shared();
    assemble(run, 'product');
    const chapter = section(text(run, 'handbook.md'), `## ${ui['md.findings.heading']}`);
    expect(chapter).toContain('- F1 Orders: Deleting an order asks nothing about who calls: the handler removes the order and answers success to every caller.');
    expect(chapter).toContain('- F1 Orders: The list of orders is always empty, whatever was created.');
    expect(chapter).toContain('- F3 Reminders: The reminder goes out at one fixed time of day for every recipient, whatever their time zone.');
    // A finding a verifier removed, a unit that failed its check and one that was not verified are not in the chapter.
    expect(chapter).not.toContain('Creating an order answers that it was created');
    expect(chapter).not.toContain(FAILED_TEXT);
    expect(chapter).not.toContain(UNFINISHED_TEXT);
    const headings = [...chapter.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual([ui[categoryKey('authorization')], ui[categoryKey('hard-coded')], ui[categoryKey('time')]]);
  });

  it('counts by category on one line, and every count equals the length of the list it counts', () => {
    const run = shared();
    assemble(run, 'product');
    const chapter = section(text(run, 'handbook.md'), `## ${ui['md.findings.heading']}`);
    const line = chapter.split('\n').find((candidate) => candidate.startsWith('Findings: '));
    expect(line).toBe(`Findings: 3. Statements: 3. Groups merged: 0. Findings units verified: 3 of 5. System findings units verified: 0 of 1. By category: ${CATEGORY_NAMES.map((name) => `${name}: ${['authorization', 'hard-coded', 'time'].some((key) => ui[categoryKey(key)] === name) ? 1 : 0}`).join('; ')}.`);
    const total = Number(/^Findings: (\d+)\./.exec(line)[1]);
    const groups = chapter.split(/^### /m).slice(1);
    expect(groups.map((group) => group.split('\n').filter((row) => row.startsWith('- ')).length).reduce((sum, n) => sum + n, 0)).toBe(total);
    for (const group of groups) {
      const name = group.split('\n')[0];
      const count = Number(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: (\\d+)`).exec(line)[1]);
      expect(group.split('\n').filter((row) => row.startsWith('- ')).length, name).toBe(count);
    }
  });

  it('says so when no finding was verified', () => {
    const run = findingsRun(cleanups);
    run.writeEntry('F1');
    expect(run.run('check-entry', 'F1').status).toBe(0);
    verifyChecked(run, 'F1');
    assemble(run, 'product');
    const chapter = section(text(run, 'handbook.md'), `## ${ui['md.findings.heading']}`);
    expect(chapter).toContain(ui['md.findings.none']);
    expect(chapter).toContain('Findings: 0. Statements: 0. Groups merged: 0. Findings units verified: 0 of 5. System findings units verified: 0 of 1.');
    expect(chapter).not.toMatch(/^### /m);
  });

  it('the technical view writes the file and line of each finding; the product view writes no file and no line', () => {
    const run = shared();
    expect(assemble(run, 'product,technical').status).toBe(0);
    const technical = section(text(run, 'handbook-technical.md'), `## ${ui['md.findings.heading']}`);
    expect(technical).toContain(`- F1 Orders: Deleting an order asks nothing about who calls: the handler removes the order and answers success to every caller. (${ORDERS_FILE}, line 7)`);
    expect(technical).toContain(`- F3 Reminders: The reminder goes out at one fixed time of day for every recipient, whatever their time zone. (${JOBS_FILE}, line 4)`);
    const product = text(run, 'handbook.md');
    for (const file of [ORDERS_FILE, JOBS_FILE, 'src/', 'bin/admin.js']) expect(product, file).not.toContain(file);
    expect(product).not.toMatch(/line \d+\)/);
  });

  it('the same input gives the same bytes', () => {
    const run = shared();
    assemble(run, 'product,technical');
    const first = [text(run, 'handbook.md'), text(run, 'handbook-technical.md')];
    assemble(run, 'product,technical');
    expect([text(run, 'handbook.md'), text(run, 'handbook-technical.md')]).toEqual(first);
  });
});

describe('the feature section lists the findings of its own feature', () => {
  it('lists F1\'s two verified findings with their category, and says none for a feature with no finding; a feature with no entry has no section', () => {
    const run = shared();
    assemble(run, 'product');
    const body = text(run, 'handbook.md');
    const f1 = section(body, '### Orders');
    expect(f1).toContain(`#### ${ui['md.findings.heading']}`);
    const own = f1.slice(f1.indexOf(`#### ${ui['md.findings.heading']}`));
    expect(own).toContain(`- ${ui[categoryKey('authorization')]}: Deleting an order asks nothing about who calls: the handler removes the order and answers success to every caller.`);
    expect(own).toContain(`- ${ui[categoryKey('hard-coded')]}: The list of orders is always empty, whatever was created.`);
    expect(own.match(/^- /gm)).toHaveLength(2);
    expect(body).not.toContain('### Reminders');
  });

  it('writes the fixed none text when the feature has a verified entry and a verified unit without a finding', () => {
    const run = outputRun();
    run.writeEntry('F2', { ...clone(run.entry), id: 'F2' });
    expect(run.run('check-entry', 'F2').status).toBe(0);
    verifyChecked(run, 'F2');
    assemble(run, 'product');
    const f2 = section(text(run, 'handbook.md'), '### Archive');
    expect(f2.slice(f2.indexOf(`#### ${ui['md.findings.heading']}`))).toContain(ui['md.none']);
  });
});

describe('the coverage section', () => {
  it('lists the findings units that are not verified, with where they stopped, and the removed finding with its reason', () => {
    const run = shared();
    assemble(run, 'product');
    const coverage = section(text(run, 'handbook.md'), `## ${ui['md.coverage.heading']}`);
    const unfinished = section(coverage, `### ${ui['md.coverage.findingsUnfinishedHeading']}`);
    expect(unfinished).toContain(`| Admin tool (F4, Automatic work) | ${ui['md.status.failed']} |`);
    expect(unfinished).toContain(`| Orders (F5, Automatic work) | ${ui['md.status.checked']} |`);
    expect(unfinished).not.toContain(ui['md.coverage.findingsNotWritten'].split(' {count}')[0]);
    expect(unfinished).not.toContain('F1,');
    expect(unfinished).not.toContain('F3,');
    const removed = section(coverage, `### ${ui['md.coverage.findingsRemovedHeading']}`);
    expect(removed).toContain('#### F1 Orders (Order handling): findings removed: 1');
    expect(removed).toContain(`| Finding > ${ui[categoryKey('error-handling')]} > Creating an order answers that it was created without reading or storing anything. | ${ui['md.verdict.contradicted']} | ${REMOVED_REASON} |`);
  });
});

describe('findings units never written are one count line, not one row each', () => {
  const NOT_WRITTEN = (count) => `Findings were not written for ${count} features.`;

  it('all planned: one count line and no row', () => {
    const run = findingsRun(cleanups);
    run.writeEntry('F1');
    expect(run.run('check-entry', 'F1').status).toBe(0);
    verifyChecked(run, 'F1');
    for (const views of ['product', 'technical']) {
      assemble(run, views);
      const part = section(section(text(run, views === 'product' ? 'handbook.md' : 'handbook-technical.md'), `## ${ui['md.coverage.heading']}`), `### ${ui['md.coverage.findingsUnfinishedHeading']}`);
      expect(part).toContain(NOT_WRITTEN(5));
      expect(part).not.toContain('|');
    }
    expect(page(run).status).toBe(0);
    expect(dataOf(run).coverage).toMatchObject({ findingsUnfinished: [], findingsNotWritten: 5 });
  });

  it('a mix: the count line for the planned ones, rows for the others, and the counts add up to the features', () => {
    const run = findingsRun(cleanups);
    run.writeFindings('F1');
    expect(run.run('check-findings', unitId('F1')).status).toBe(0);
    verifyChecked(run, unitId('F1'));
    const failed = goodFindings('F4');
    failed.findings[0].text = FAILED_TEXT;
    failed.findings[0].evidence = [{ file: 'bin/admin.js', passage: "console.log('admin');" }];
    run.writeFindings('F4', failed);
    expect(run.run('check-findings', unitId('F4')).status).toBe(1);
    run.writeFindings('F5', goodFindings('F5'));
    expect(run.run('check-findings', unitId('F5')).status).toBe(0);
    assemble(run, 'product');
    const part = section(section(text(run, 'handbook.md'), `## ${ui['md.coverage.heading']}`), `### ${ui['md.coverage.findingsUnfinishedHeading']}`);
    expect(part).toContain(NOT_WRITTEN(2));
    expect(part).toContain(`| Admin tool (F4, Automatic work) | ${ui['md.status.failed']} |`);
    expect(part).toContain(`| Orders (F5, Automatic work) | ${ui['md.status.checked']} |`);
    expect(part.match(/^\| [^-].*\|$/gm)).toHaveLength(3);
    expect(page(run).status).toBe(0);
    const { coverage } = dataOf(run);
    expect(coverage.findingsNotWritten).toBe(2);
    expect(coverage.findingsUnfinished.map((row) => row.feature)).toEqual(['F4', 'F5']);
    expect(coverage.findingsNotWritten + coverage.findingsUnfinished.length + 1).toBe(5);
  });
});

describe('verified findings are checked again like an entry', () => {
  it('refuses a unit whose file changed after it was verified, and one that no longer passes its check', () => {
    const run = outputRun();
    const doc = clone(run.readFindings('F1'));
    doc.findings[0].text = 'Deleting an order answers success to every caller.';
    run.writeFindings('F1', doc);
    const changed = assemble(run, 'product');
    expect(changed.status).toBe(1);
    expect(changed.lines).toContain('F1.findings: entries/F1.findings.json changed after it was verified; run check-findings for F1.findings and verify it again');
    const spoiled = clone(doc);
    spoiled.findings[0].evidence[0].passage = 'router.delete("/:id", approve);';
    run.writeFindings('F1', spoiled);
    const broken = page(run);
    expect(broken.status).toBe(1);
    expect(broken.lines).toContain('F1.findings: entries/F1.findings.json no longer passes check-findings; run check-findings for F1.findings');
  });
});

describe('the page data', () => {
  it('has the format /10, the findings of the verified units in map order as groups (one statement each here), and no citation path outside the technical part', () => {
    const run = shared();
    const made = page(run);
    expect(made.status, made.stdout).toBe(0);
    const data = dataOf(run);
    expect(data.format).toBe('excavator-product-handbook-page/10');
    expect(data.findings.map((group) => [group.items.map((item) => item.id), group.owners.map((owner) => [owner.kind, owner.id]), group.category])).toEqual([
      [['F1.findings[0]'], [['feature', 'F1']], 'authorization'],
      [['F1.findings[1]'], [['feature', 'F1']], 'hard-coded'],
      [['F3.findings[0]'], [['feature', 'F3']], 'time'],
    ]);
    expect(Object.keys(data.findings[0])).toEqual(['category', 'owners', 'items']);
    expect(JSON.stringify({ ...data, technical: undefined })).not.toContain(ORDERS_FILE);
    expect(data.technical.findingLocations.map((place) => [place.id, place.citations])).toEqual([
      ['F1.findings[0]', [{ file: ORDERS_FILE, startLine: 7, endLine: 7 }]],
      ['F1.findings[1]', [{ file: ORDERS_FILE, startLine: 5, endLine: 5 }]],
      ['F3.findings[0]', [{ file: JOBS_FILE, startLine: 4, endLine: 4 }]],
    ]);
  });

  it('has the unfinished units and the removed findings in the coverage part, and no technical part in a product-only page', () => {
    const run = shared();
    expect(page(run, 'product').status).toBe(0);
    const data = dataOf(run);
    expect(data.technical).toBeUndefined();
    expect(data.coverage.findingsUnfinished).toEqual([{ feature: 'F4', status: 'failed' }, { feature: 'F5', status: 'checked' }]);
    expect(data.coverage.findingsNotWritten).toBe(0);
    expect(data.coverage.findingsRemoved).toEqual([{ feature: 'F1', items: [{ claim: `Finding > ${ui[categoryKey('error-handling')]} > Creating an order answers that it was created without reading or storing anything.`, verdict: 'contradicted', reason: REMOVED_REASON }] }]);
    expect(data.findings).toHaveLength(3);
  });

  it('is the same bytes from the same input', () => {
    const run = shared();
    page(run);
    const first = text(run, 'handbook.html');
    page(run);
    expect(text(run, 'handbook.html')).toBe(first);
  });
});
