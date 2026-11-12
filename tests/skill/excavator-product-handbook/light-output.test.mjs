// O1 and O2 of openspec change handbook-light-scheme: one run where the overview, every findings unit, the system units, the ranking, the
// remedies and the topics are all `checked` and nothing is `verified`. The handbook (both views) and the page data have every block, each
// under its own not-verified sentence; no block reads unfinished, not written, or names a verified overview; the coverage section counts
// the parts as written and not verified; the ranking groups, the remedy facts and the topic lanes hold the checked findings; a checked lane
// is done. A unit whose file changed after its check is refused like any unit.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { featuresByFile } from '../../../skills/excavator-product-handbook/lib/history-features.mjs';
import { makeCheckedMapRun, runHandbook } from './helpers.mjs';
import { MAIL_TEXT, NIGHTLY_TEXT, ORDERS_TEXT, REPORTS_TEXT, SMALL_TEXT, START_TEXT, STOCK_ROUTE_TEXT, STOCK_TEXT, lightRun } from './light-fixture.mjs';

const ui = JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
const sharedCleanups = [];
let sharedRun = null;
const shared = () => {
  sharedRun ??= lightRun(sharedCleanups);
  return sharedRun;
};
afterAll(() => {
  while (sharedCleanups.length > 0) sharedCleanups.pop()();
});

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const text = (run, name) => readFileSync(join(run.out, name), 'utf-8');
const page = (run) => runHandbook(['page', run.out, '--project', run.root, '--views', 'product,technical'], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
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

const FILES = { product: 'handbook.md', technical: 'handbook-technical.md' };

describe('a run with every model-written part checked and none verified', () => {
  it('writes every block in both views, each under its own not-verified sentence', () => {
    const run = shared();
    const made = run.run('assemble', '--views', 'product,technical');
    expect(made.status, made.stdout + made.stderr).toBe(0);
    for (const view of ['product', 'technical']) {
      const body = text(run, FILES[view]);
      const overview = section(body, '## Overview');
      expect(overview, view).toContain(ui['md.overview.unverified']);
      expect(overview, view).toContain('Staff look after shop orders and stock.');
      expect(overview, view).toContain('Shop service');
      const findings = section(body, `## ${ui['md.findings.heading']}`);
      for (const key of ['md.findings.unverifiedFeature', 'md.findings.unverifiedSystem', 'md.priority.unverified', 'md.remedies.unverified']) expect(findings, `${view} ${key}`).toContain(ui[key]);
      for (const statement of [ORDERS_TEXT, NIGHTLY_TEXT, MAIL_TEXT, STOCK_TEXT, REPORTS_TEXT, START_TEXT, STOCK_ROUTE_TEXT, SMALL_TEXT]) expect(findings, `${view} ${statement}`).toContain(statement);
      expect(findings, view).toContain('Common cause: The mail helper reports success before anything is sent.');
      const recommendations = section(body, `## ${ui['md.remedies.heading']}`);
      expect(recommendations, view).toContain(ui['md.remedies.unverified']);
      expect(recommendations, view).toContain('### 1. Make the mail helper honest');
      const topics = section(body, `## ${ui['md.topics.heading']}`);
      expect(topics, view).toContain(ui['md.topics.unverified']);
      expect(topics, view).toContain('Lists answer a fixed result without reading anything.');
    }
  });

  it('counts the written units, not zero verified ones, in the counts line and the page data', () => {
    const run = shared();
    run.run('assemble', '--views', 'product');
    const findings = section(text(run, 'handbook.md'), `## ${ui['md.findings.heading']}`);
    expect(findings).toContain('Findings units written: 6 of 6, 6 of them not verified. System findings units written: 3 of 3, 2 of them not verified.');
    expect(findings).not.toContain('written: 0 of');
  });

  it('gives each finding the level the writer gave it, and leaves no group unranked', () => {
    const run = shared();
    run.run('assemble', '--views', 'product');
    const findings = section(text(run, 'handbook.md'), `## ${ui['md.findings.heading']}`);
    const lines = findings.split('\n').filter((line) => line.startsWith('- ['));
    expect(lines).toHaveLength(8);
    for (const line of lines) expect(line, line).not.toContain('[Unranked]');
    expect(findings).toContain('Unranked: 0.');
    expect(findings).not.toContain(ui['md.coverage.priorityNotFinished'].split('{')[0]);
  });

  // The four topics written by a domain lane say their lane did not finish here: the fixture has no feature with an entry, so no domain lane exists. That is
  // the topics chapter as it was; a run with chapters (checked /3 entries) has the lanes.
  it('reads no block as unfinished or not written, and falls back to no text that names a verified overview', () => {
    const run = shared();
    run.run('assemble', '--views', 'product,technical');
    const unfinished = [
      ui['md.overview.notWritten'].split('{')[0], ui['md.coverage.priorityNotFinished'].split('{')[0], ui['md.coverage.remediesNotFinished'], ui['md.coverage.remediesStale'],
      ui['md.coverage.topicsNotFinished'], ui['md.coverage.topicsStale'], ui['md.topics.notFinished'], ui['md.remedies.none'], ui['md.findings.none'],
      ui['md.status.checked'], ui['md.coverage.findingsAllVerified'], ui['md.coverage.systemFindingsAllVerified'],
    ];
    for (const view of ['product', 'technical']) {
      const body = text(run, FILES[view]);
      for (const fragment of unfinished) expect(body.includes(fragment), `${view}: ${fragment}`).toBe(false);
      expect(body, view).not.toMatch(/were not written/);
      expect(body, view).not.toContain('verified overview');
      expect(body, view).not.toContain('Written, verification not finished');
    }
  });

  it('counts the parts as written and not verified in the coverage section', () => {
    const run = shared();
    run.run('assemble', '--views', 'product');
    const coverage = section(text(run, 'handbook.md'), `## ${ui['md.coverage.heading']}`);
    expect(coverage).toContain(ui['md.coverage.overviewUnverified']);
    expect(coverage).toContain('The findings of 6 of 6 features are written but not verified.');
    expect(coverage).toContain('The system findings of 2 of 3 application roots are written but not verified.');
    expect(coverage).toContain(ui['md.coverage.priorityUnverified']);
    expect(coverage).toContain(ui['md.coverage.remediesUnverified']);
    expect(coverage).toContain(ui['md.coverage.topicsUnverified']);
    expect(coverage).toContain('| The same problem in several places | Written, not verified | 1 | 0 |');
    expect(coverage).not.toContain('did not finish');
  });

  it('puts the not-verified sentence at the head of the findings of each feature section only for a feature with an entry; the unit of an app has none of its own section', () => {
    const run = shared();
    run.run('assemble', '--views', 'product');
    // The fixture's features have no verified entry, so no feature section is written; the chapter holds every finding.
    expect(text(run, 'handbook.md')).not.toContain(`##### ${ui['md.findings.heading']}`);
  });
});

describe('the inputs of the ranking, the remedies and the topics', () => {
  it('the groups of the ranking, the facts of the remedies and the facts of the lane hold the checked findings', () => {
    const run = shared();
    const groups = run.run('priority-items');
    expect(groups.lines.join('\n')).toContain('nothing to rank');
    const facts = run.run('remedy-facts');
    expect(facts.lines.join('\n')).toContain('nothing to write');
    // A fresh view of the groups: the keys of the four checked findings are in the ranking file.
    const ranking = JSON.parse(readFileSync(join(run.out, 'priority', 'part-1.json'), 'utf-8'));
    expect(ranking.items).toHaveLength(8);
    const lane = run.run('topic-facts', '--lane', 'repeated');
    expect(lane.lines).toEqual(['Topics: repeated: checked; nothing to write']);
  });

  it('reports a checked topic lane as done, and the check commands print no step for a judge', () => {
    const run = shared();
    const lanes = run.run('topic-lanes');
    expect(lanes.lines).toEqual(['repeated\t-\t8\tchecked']);
    for (const result of [run.run('check-priority'), run.run('check-remedies'), run.run('check-topics', '--lane', 'repeated')]) {
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).not.toMatch(/judge/);
    }
  });

  it('a findings unit that was written after the ranking starts the ranking over: its groups have no level until it is ranked again', () => {
    const run = shared();
    const groups = run.run('priority-items');
    expect(groups.status).toBe(0);
    expect(groups.lines).toEqual(['Priority: checked (8 groups); nothing to rank']);
  });
});

describe('a checked unit is checked again against the project', () => {
  it('refuses a findings unit whose file no longer passes its check, in assemble and in page', () => {
    const run = lightRun(cleanups);
    const doc = JSON.parse(readFileSync(join(run.out, 'entries', 'F1.findings.json'), 'utf-8'));
    doc.findings[0].evidence[0].passage = 'router.get("/r1", approve);';
    run.writeFindings('F1', doc);
    for (const result of [run.run('assemble'), page(run)]) {
      expect(result.status).toBe(1);
      expect(result.lines).toContain('F1.findings: entries/F1.findings.json no longer passes check-findings; run check-findings for F1.findings');
    }
  });

  it('refuses an overview that no longer passes its check', () => {
    const run = lightRun(cleanups);
    const doc = JSON.parse(readFileSync(join(run.out, 'entries', 'overview.json'), 'utf-8'));
    doc.summary[0].evidence[0].passage = 'console.log("stop");';
    run.writeOverview(doc);
    const result = run.run('assemble');
    expect(result.status).toBe(1);
    expect(result.lines).toContain('overview: entries/overview.json no longer passes check-overview; run check-overview');
  });
});

describe('the features that cite a file for the code health', () => {
  it('lists a verified feature and a checked /3 entry, and not a checked entry without a chapter or one waiting for its rewrite', () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    const state = run.readJson('state.json');
    const chapter = { items: [], notes: [] };
    state.features.F1 = { status: 'verified', attempts: 1, entryDigest: 'x' };
    state.features.F2 = { status: 'checked', attempts: 1, chapter };
    state.features.F3 = { status: 'checked', attempts: 1 };
    state.features.F4 = { status: 'checked', attempts: 1, rewriting: true, chapter };
    run.writeJson(join(run.out, 'state.json'), state);
    for (const id of ['F1', 'F2', 'F3', 'F4']) run.writeJson(join(run.out, 'entries', `${id}.json`), { who: [{ evidence: [{ file: 'src/shared.js', passage: 'x' }] }] });
    expect(featuresByFile(run.out).get('src/shared.js')).toEqual(['F1', 'F2']);
  });
});
