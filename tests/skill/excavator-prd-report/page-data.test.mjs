// `lib/page-data.mjs`: the data object of the report page (openspec change
// prd-report-page, design D3). Pure and read-only; refuses an out directory
// whose index.json, findings.json and feature files disagree.
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { FINDINGS_FORMAT } from '../../../skills/excavator-prd-report/lib/aggregate.mjs';
import { UsageError } from '../../../skills/excavator-prd-report/lib/errors.mjs';
import { PAGE_FORMAT, collectPageData } from '../../../skills/excavator-prd-report/lib/page-data.mjs';
import { makeLaneRun, runPrd } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

/** The lane fixture after `aggregate`; returns the run and aggregate's printed fields. */
function aggregatedRun() {
  const run = makeLaneRun();
  cleanups.push(run.cleanup);
  const aggregate = runPrd(['aggregate', run.out, '--project', run.project]);
  expect(aggregate.status, aggregate.stdout + aggregate.stderr).toBe(0);
  return { run, printed: aggregate.json };
}

/** The lane fixture plus F3, a planned feature with no files, then aggregated. */
function aggregatedRunWithF3() {
  const run = makeLaneRun();
  cleanups.push(run.cleanup);
  const index = run.readIndex();
  index.candidates.items.push({ id: 'c3', kind: 'job', file: 'src/orders/service.js', line: 15, text: 'function reopenOrder(order) {', framework: 'custom', provenance: 'inferred' });
  index.features.push({ id: 'F3', name: 'Order reopening', kind: 'automated', chapter: 3, entrypoints: ['c3'], seedFiles: ['src/orders/service.js'], tiers: ['backend'] });
  run.writeIndex(index);
  expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
  return run;
}
const aggregateOk = (run) => {
  const out = runPrd(['aggregate', run.out, '--project', run.project]);
  expect(out.status, out.stdout + out.stderr).toBe(0);
  return out.json;
};

/** Every file under `dir` with its bytes' digest and mtime: what "reads only" must leave unchanged. */
function snapshot(dir) {
  const entries = {};
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else entries[path] = [createHash('sha256').update(readFileSync(path)).digest('hex'), statSync(path).mtimeMs];
    }
  };
  walk(dir);
  return entries;
}

describe('collectPageData', () => {
  it('returns the page object of the fixture with its keys in a fixed order', () => {
    const { run, printed } = aggregatedRun();
    const data = collectPageData(run.out, run.project);

    expect(PAGE_FORMAT).toBe('excavator-prd-report-page/1');
    expect(Object.keys(data)).toEqual([
      'format', 'project', 'sourceRevision', 'language', 'role', 'scope',
      'counts', 'overview', 'features', 'findings', 'tables', 'unassigned', 'uncovered',
    ]);
    expect(data.format).toBe(PAGE_FORMAT);
    expect(data.project).toBe('project');
    expect([data.sourceRevision, data.language, data.role, data.scope]).toEqual(['directory:synthetic', 'English', 'product manager', null]);
    // counts are the fields aggregate printed; prdPath and outIsDefault are about the machine, uncovered has its own key.
    const { prdPath, outIsDefault, uncovered, ...fields } = printed;
    expect(data.counts).toEqual(fields);
    expect(Object.keys(data.counts)).toEqual(['features', 'diagrams', 'findings', 'verification']);
    expect(data.overview).toBe(readFileSync(join(run.out, 'overview.md'), 'utf-8').trim());
    expect(data.unassigned).toEqual([]);
    expect(data.uncovered).toEqual([]);
    expect(Object.keys(data.tables)).toEqual(['rolesByFeature', 'coverage', 'verification']);
    expect(data.tables.rolesByFeature).toContain('| F1 Order placement | x |  |');
    expect(data.tables.coverage).toContain('| c1 | route |');
    expect(data.tables.verification).toContain('verified');

    const stored = run.readJson('findings.json');
    expect(data.findings).toEqual(stored.findings);
    expect(data.findings.map((finding) => finding.id)).toEqual(['F1-1', 'F2-1']);

    expect(data.features.map((feature) => feature.id)).toEqual(['F1', 'F2']);
    const [f1] = data.features;
    expect(Object.keys(f1)).toEqual([
      'id', 'name', 'kind', 'chapter', 'status', 'failure', 'attempts', 'counts',
      'entrypoints', 'roles', 'triggers', 'body', 'verificationReport',
    ]);
    expect([f1.name, f1.kind, f1.chapter, f1.status, f1.failure, f1.attempts]).toEqual(['Order placement', 'flow', 1, 'verified', null, 0]);
    expect(f1.counts).toEqual(run.readIndex().features[0].counts);
    expect(f1.entrypoints.map((entry) => [entry.id, entry.file, entry.line])).toEqual([
      ['c1', 'src/orders/routes.js', 5], ['i1', 'web/src/OrderForm.tsx', 1],
    ]);
    expect(Object.keys(f1.entrypoints[0])).toEqual(['id', 'kind', 'file', 'line', 'text', 'framework']);
    expect(f1.roles).toEqual(['customer']);
    expect(f1.triggers).toEqual(['A customer submits the order form']);
    expect(f1.body.startsWith('## Order placement\n')).toBe(true);
    expect(f1.body).toContain('```mermaid');
    expect(f1.body).not.toContain('chapter: 1');
    expect(f1.body.startsWith('---')).toBe(false);
    expect(f1.verificationReport).toContain('A synthetic verification report.');
    expect(data.features[1].triggers).toEqual(['A support agent cancels an order']);
  });

  it('sorts the features by chapter', () => {
    const { run } = aggregatedRun();
    const index = run.readIndex();
    index.features[0].chapter = 2;
    index.features[1].chapter = 1;
    run.writeIndex(index);
    run.writeText('features/F1.md', run.readText('features/F1.md').replace('chapter: 1', 'chapter: 2'));
    run.writeText('features/F2.md', run.readText('features/F2.md').replace('chapter: 2', 'chapter: 1'));
    aggregateOk(run);
    expect(collectPageData(run.out, run.project).features.map((feature) => feature.id)).toEqual(['F2', 'F1']);
  });

  it('keeps a failed feature with its status and reasons and no chapter body', () => {
    const { run } = aggregatedRun();
    // F2's chapter loses its mermaid block, so check-lane's rules refuse it.
    run.writeText('features/F2.md', run.readText('features/F2.md').replace(/```mermaid[\s\S]*?```\n/, ''));
    aggregateOk(run);
    const data = collectPageData(run.out, run.project);
    const f2 = data.features.find((feature) => feature.id === 'F2');
    expect(f2.status).toBe('failed');
    expect(f2.failure).toEqual({ step: 'check-lane', reasons: ['F2: no mermaid block'] });
    expect(f2.body).toBeNull();
    expect(f2.verificationReport).toBeNull();
    expect(f2.roles).toEqual([]);
    expect(f2.triggers).toEqual([]);
    expect(data.counts.features).toEqual({ total: 2, written: 1, failed: 1 });
    expect(data.findings.map((finding) => finding.feature)).toEqual(['F1']);
  });

  it('keeps a feature whose chapter file is missing, with no body', () => {
    const run = aggregatedRunWithF3();
    expect(runPrd(['mark', run.out, 'F3', 'failed', 'lane', 'the lane wrote nothing', '--project', run.project]).status).toBe(0);
    aggregateOk(run);
    const data = collectPageData(run.out, run.project);
    const f3 = data.features[2];
    expect(f3.id).toBe('F3');
    expect(f3.status).toBe('failed');
    expect(f3.failure).toEqual({ step: 'lane', reasons: ['the lane wrote nothing'] });
    expect(f3.body).toBeNull();
    expect(f3.verificationReport).toBeNull();
    expect(f3.entrypoints.map((entry) => entry.id)).toEqual(['c3']);
  });

  it('lists a planned feature with its status and no body', () => {
    const run = aggregatedRunWithF3();
    aggregateOk(run);
    const f3 = collectPageData(run.out, run.project).features[2];
    expect([f3.status, f3.failure, f3.body, f3.verificationReport]).toEqual(['planned', null, null, null]);
  });

  it('shows the unassigned entrypoints and the frameworks without patterns', () => {
    const { run } = aggregatedRun();
    const index = run.readIndex();
    index.candidates.items.push({ id: 'c9', kind: 'route', file: 'src/orders/routes.js', line: 8, text: 'module.exports = router;', framework: 'express' });
    index.unassigned = ['c9'];
    index.candidates.uncovered = ['spring'];
    run.writeIndex(index);
    aggregateOk(run);
    const data = collectPageData(run.out, run.project);
    expect(data.unassigned).toEqual([{ id: 'c9', kind: 'route', file: 'src/orders/routes.js', line: 8, text: 'module.exports = router;', framework: 'express' }]);
    expect(data.uncovered).toEqual(['spring']);
  });

  it('throws, naming aggregate, when a chapter changed after aggregate and its status differs now', () => {
    const { run } = aggregatedRun();
    run.writeText('features/F1.md', run.readText('features/F1.md').replace(/```mermaid[\s\S]*?```\n/, ''));
    const attempt = () => collectPageData(run.out, run.project);
    expect(attempt).toThrow(UsageError);
    expect(attempt).toThrow(/F1.*verified.*failed|F1.*failed.*verified/);
    expect(attempt).toThrow(/prd\.mjs aggregate/);
  });

  it('throws, naming aggregate, when a lane\'s findings changed after aggregate and findings.json holds the old ones', () => {
    const { run } = aggregatedRun();
    // A valid edit: F2 stays verified, so only the findings comparison can see it.
    const lane = run.readJson('findings/F2.json');
    lane.findings[0].statement = 'cancelOrder sets the status to cancelled without looking at the current status.';
    run.writeJson('findings/F2.json', lane);
    const attempt = () => collectPageData(run.out, run.project);
    expect(attempt).toThrow(UsageError);
    expect(attempt).toThrow(/findings\.json does not hold the current findings of F2.*prd\.mjs aggregate/);
    aggregateOk(run);
    expect(collectPageData(run.out, run.project).findings[1].statement).toContain('without looking');
  });

  it('throws when findings.json holds a finding of no feature, or the findings in another order', () => {
    const { run } = aggregatedRun();
    const stored = run.readJson('findings.json');
    run.writeJson('findings.json', { ...stored, findings: [...stored.findings, { ...stored.findings[0], id: 'F9-1', feature: 'F9' }] });
    expect(() => collectPageData(run.out, run.project)).toThrow(/no feature|another order/);
    run.writeJson('findings.json', { ...stored, findings: [...stored.findings].reverse() });
    expect(() => collectPageData(run.out, run.project)).toThrow(/prd\.mjs aggregate/);
  });

  it('throws, naming aggregate, when a failed feature\'s files give other reasons but the same failed status', () => {
    const { run } = aggregatedRun();
    // F2 fails on one reason (no mermaid block) and aggregate records it ...
    run.writeText('features/F2.md', run.readText('features/F2.md').replace(/```mermaid[\s\S]*?```\n/, ''));
    aggregateOk(run);
    expect(run.readIndex().features[1].failure.reasons).toEqual(['F2: no mermaid block']);
    expect(() => collectPageData(run.out, run.project)).not.toThrow();
    // ... then its chapter loses its evidence block too: still failed, now with two reasons.
    run.writeText('features/F2.md', run.readText('features/F2.md').replace(/<details>[\s\S]*?<\/details>\n?/, ''));
    const attempt = () => collectPageData(run.out, run.project);
    expect(attempt).toThrow(UsageError);
    expect(attempt).toThrow(/F2's failure reasons in index\.json differ from what its files give/);
    expect(attempt).toThrow(/prd\.mjs aggregate/);
    aggregateOk(run);
    expect(collectPageData(run.out, run.project).features[1].failure.reasons).toHaveLength(2);
  });

  it('throws, naming aggregate, when findings.json is missing', () => {
    const { run } = aggregatedRun();
    rmSync(join(run.out, 'findings.json'));
    expect(() => collectPageData(run.out, run.project)).toThrow(UsageError);
    expect(() => collectPageData(run.out, run.project)).toThrow(/findings\.json.*prd\.mjs aggregate/);
  });

  it('throws, naming aggregate, when findings.json is not in the current format', () => {
    const { run } = aggregatedRun();
    run.writeJson('findings.json', { ...run.readJson('findings.json'), format: 'excavator-prd/1' });
    expect(() => collectPageData(run.out, run.project)).toThrow(UsageError);
    expect(() => collectPageData(run.out, run.project)).toThrow(new RegExp(`${FINDINGS_FORMAT}.*prd\\.mjs aggregate`));
  });

  it('throws when the overview or a table is missing', () => {
    const { run } = aggregatedRun();
    rmSync(join(run.out, 'tables/coverage.md'));
    expect(() => collectPageData(run.out, run.project)).toThrow(/tables\/coverage\.md.*prd\.mjs aggregate/);
    const second = aggregatedRun().run;
    rmSync(join(second.out, 'overview.md'));
    expect(() => collectPageData(second.out, second.project)).toThrow(/overview\.md/);
  });

  it('throws when the out directory or index.json does not exist, or the project is not the index\'s', () => {
    const { run } = aggregatedRun();
    expect(() => collectPageData(join(run.root, 'nowhere'), run.project)).toThrow(UsageError);
    expect(() => collectPageData(run.out, run.root)).toThrow(/projectRoot/);
  });

  it('throws when an entrypoint is not a candidate, so no feature lists a missing one', () => {
    const { run } = aggregatedRun();
    const index = run.readIndex();
    index.features[1].entrypoints.push('c404');
    run.writeIndex(index);
    expect(() => collectPageData(run.out, run.project)).toThrow(/c404.*not a candidate/);
  });

  it('gives the same JSON on two calls and writes nothing', () => {
    const { run } = aggregatedRun();
    const before = snapshot(run.root);
    const first = JSON.stringify(collectPageData(run.out, run.project));
    const second = JSON.stringify(collectPageData(run.out, run.project));
    expect(second).toBe(first);
    expect(snapshot(run.root)).toEqual(before);
  });

  it('holds no absolute path: the project is its directory name only', () => {
    const { run } = aggregatedRun();
    const text = JSON.stringify(collectPageData(run.out, run.project));
    expect(text).not.toContain(run.project);
    expect(text).not.toContain(run.out);
    expect(text).not.toContain(run.root);
    expect(text).toContain('"project":"project"');
  });
});
