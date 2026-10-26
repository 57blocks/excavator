// `lib/page-data.mjs`: the data object of the report page (openspec change
// prd-report-page, design D3). Pure and read-only; refuses an out directory
// whose index.json, findings.json and feature files disagree.
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { FINDINGS_FORMAT } from '../../../skills/excavator-prd-report/lib/aggregate.mjs';
import { UsageError } from '../../../skills/excavator-prd-report/lib/errors.mjs';
import { PAGE_FORMAT, collectPageData, withoutRootPaths } from '../../../skills/excavator-prd-report/lib/page-data.mjs';
import { makeLaneRun, makeSkeletonRun, rankEntry, runPrd, writeRanks } from './helpers.mjs';

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

/** A chapter's text without its front-matter (a chapter with no open items section is its body as it is). */
const markdownBodyOf = (run, id) => run.readText(`features/${id}.md`).replace(/^---\n[\s\S]*?\n---\n/, '').trim();

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

describe('withoutRootPaths', () => {
  const ROOT = '/work/shop';

  it('replaces the root where it is a whole path, in strings at any depth, keeping keys and order', () => {
    const value = { a: `at ${ROOT}`, list: [`${ROOT}/src/a.js:3`, { k: `\`${ROOT}\`` }], n: 3, nothing: null, [ROOT]: 'key stays' };
    expect(withoutRootPaths(value, [ROOT], 'shop')).toEqual({ a: 'at shop', list: ['shop/src/a.js:3', { k: '`shop`' }], n: 3, nothing: null, [ROOT]: 'key stays' });
    expect(Object.keys(withoutRootPaths(value, [ROOT], 'shop'))).toEqual(Object.keys(value));
  });

  it('leaves a longer path or name that only starts with the root', () => {
    expect(withoutRootPaths(`${ROOT}-two/x ${ROOT}.bak ${ROOT}2`, [ROOT], 'shop')).toBe(`${ROOT}-two/x ${ROOT}.bak ${ROOT}2`);
  });

  it('tries the longest root first, ignores duplicates and a trailing slash', () => {
    expect(withoutRootPaths('/private/work/shop/a and /work/shop/b', ['/work/shop', '/private/work/shop/', '/work/shop'], 'shop')).toBe('shop/a and shop/b');
    expect(withoutRootPaths('/ and /x', ['/', ''], 'shop')).toBe('/ and /x');
  });
});

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
    // retryable is about the next command, not the run's counts: the page holds none of it.
    const { prdPath, outIsDefault, uncovered, retryable, ...fields } = printed;
    expect(retryable).toEqual([]);
    expect(data.counts).toEqual(fields);
    expect(Object.keys(data.counts)).toEqual(['features', 'diagrams', 'findings', 'verification']);
    expect(data.overview).toBe(readFileSync(join(run.out, 'overview.md'), 'utf-8').trim());
    expect(data.unassigned).toEqual([]);
    expect(data.uncovered).toEqual([]);
    expect(Object.keys(data.tables)).toEqual(['terminology', 'roles', 'openItems', 'coverage', 'verification']);
    expect(data.tables.terminology).toContain('| Order | A customer\'s request for goods, with a status of open or cancelled. |');
    expect(data.tables.roles).toContain('| F1 Order placement | x |  |');
    expect(data.tables.roles).toContain('### Permission roles');
    expect(data.tables.openItems).toBe('None.');
    expect(data.tables.coverage).toContain('| c1 | route |');
    expect(data.tables.verification).toContain('verified');

    const stored = run.readJson('findings.json');
    expect(data.findings).toEqual(stored.findings);
    expect(data.findings.map((finding) => finding.id)).toEqual(['F1-1', 'F2-1']);

    expect(data.features.map((feature) => feature.id)).toEqual(['F1', 'F2']);
    const [f1] = data.features;
    expect(Object.keys(f1)).toEqual([
      'id', 'name', 'kind', 'chapter', 'status', 'failure', 'attempts', 'counts',
      'entrypoints', 'actors', 'permissionRoles', 'flows', 'triggers', 'body', 'verificationReport',
    ]);
    expect([f1.name, f1.kind, f1.chapter, f1.status, f1.failure, f1.attempts]).toEqual(['Order placement', 'flow', 1, 'verified', null, 0]);
    expect(f1.counts).toEqual(run.readIndex().features[0].counts);
    expect(f1.entrypoints.map((entry) => [entry.id, entry.file, entry.line])).toEqual([
      ['c1', 'src/orders/routes.js', 5], ['i1', 'web/src/OrderForm.tsx', 1],
    ]);
    expect(Object.keys(f1.entrypoints[0])).toEqual(['id', 'kind', 'file', 'line', 'text', 'framework']);
    expect(f1.roles).toBeUndefined();
    expect([f1.actors, f1.permissionRoles, f1.flows]).toEqual([['customer'], [], ['Flow 1: Place an order']]);
    expect(f1.triggers).toEqual(['A customer submits the order form']);
    expect(f1.body.startsWith('## Order placement\n')).toBe(true);
    expect(f1.body).toContain('```mermaid');
    expect(f1.body).not.toContain('chapter: 1');
    expect(f1.body.startsWith('---')).toBe(false);
    expect(f1.verificationReport).toContain('A synthetic verification report.');
    expect(data.features[1].triggers).toEqual(['A support agent cancels an order']);
  });

  it('gives each feature its declared actors, permission roles and flows, its body without the open items section, and the three skeleton tables (D10)', () => {
    const run = makeSkeletonRun();
    cleanups.push(run.cleanup);
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
    aggregateOk(run);
    const data = collectPageData(run.out, run.project);
    expect(data.features.map((feature) => feature.id)).toEqual(['F3', 'F1', 'F2', 'F4']);
    const [reference, placement, cancellation, failed] = data.features;
    expect([reference.actors, reference.permissionRoles, reference.flows]).toEqual([[], ['admin', 'normal'], []]);
    expect([placement.actors, placement.permissionRoles, placement.flows]).toEqual([['customer'], [], ['Flow 1: Place an order']]);
    expect(cancellation.flows).toEqual(['Cancel an order', 'Cancel an order']);
    expect([failed.actors, failed.permissionRoles, failed.flows, failed.body]).toEqual([[], [], [], null]);
    expect(placement.body).not.toContain('### Open items');
    expect(placement.body).not.toContain('Whether open orders expire');
    expect(placement.body.endsWith('</details>')).toBe(true);
    expect(cancellation.body).toBe(markdownBodyOf(run, 'F2'));
    expect(data.tables.terminology).toBe(run.readText('tables/terminology.md').trim());
    expect(data.tables.roles).toBe(run.readText('tables/roles.md').trim());
    expect(data.tables.openItems).toBe(run.readText('tables/open-items.md').trim());
    expect(data.tables.openItems).toContain('Whether open orders expire');
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
    expect([f2.actors, f2.permissionRoles, f2.flows]).toEqual([[], [], []]);
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

  describe('anything aggregate wrote that its files no longer give (the whole outputs are compared, not chosen fields)', () => {
    const attempt = (run) => () => collectPageData(run.out, run.project);

    it('refuses new statement counts in a verification reply while the feature stays verified', () => {
      const { run } = aggregatedRun();
      expect(run.readIndex().features[0].status).toBe('verified');
      run.writeText('verification/F1.txt', run.readText('verification/F1.txt').replace('Statements: 7 verified, 2 contradicted', 'Statements: 9 verified, 0 contradicted'));
      expect(attempt(run)).toThrow(UsageError);
      expect(attempt(run)).toThrow(/F1's recorded fields in index\.json differ from what its files give/);
      expect(attempt(run)).toThrow(/tables\/verification\.md differs from what aggregate writes now/);
      expect(attempt(run)).toThrow(/prd\.mjs aggregate/);
      aggregateOk(run);
      expect(collectPageData(run.out, run.project).counts.verification.verified).toBe(9);
    });

    it('refuses a chapter whose actors changed: the roles table is stale', () => {
      const { run } = aggregatedRun();
      run.writeText('features/F1.md', run.readText('features/F1.md').replace('actors: [customer]', 'actors: [customer, auditor]'));
      expect(attempt(run)).toThrow(/tables\/roles\.md differs from what aggregate writes now.*prd\.mjs aggregate/);
      aggregateOk(run);
      expect(collectPageData(run.out, run.project).tables.roles).toContain('auditor');
    });

    it('refuses a chapter that gained a mermaid block: the diagram count is recorded in index.json', () => {
      const { run } = aggregatedRun();
      run.writeText('features/F1.md', `${run.readText('features/F1.md').trimEnd()}\n\n\`\`\`mermaid\nflowchart LR\n  A --> B\n\`\`\`\n`);
      expect(attempt(run)).toThrow(/F1's recorded fields in index\.json differ from what its files give.*prd\.mjs aggregate/);
      aggregateOk(run);
      expect(collectPageData(run.out, run.project).counts.diagrams).toBe(3);
    });

    it('refuses an index.json whose conservation summary was changed', () => {
      const { run } = aggregatedRun();
      const index = run.readIndex();
      index.conservation = { ...index.conservation, assigned: 99 };
      run.writeIndex(index);
      expect(attempt(run)).toThrow(/conservation in index\.json differs.*prd\.mjs aggregate/);
    });

    it('refuses a table edited by hand', () => {
      const { run } = aggregatedRun();
      run.writeText('tables/coverage.md', `${run.readText('tables/coverage.md')}\nextra\n`);
      expect(attempt(run)).toThrow(/tables\/coverage\.md differs from what aggregate writes now.*prd\.mjs aggregate/);
    });

    it('accepts a run aggregate just wrote, and is not stopped by key order alone', () => {
      const { run } = aggregatedRun();
      expect(attempt(run)).not.toThrow();
      const index = run.readIndex();
      run.writeIndex({ ...index, features: index.features.map((feature) => Object.fromEntries(Object.entries(feature).reverse())) });
      expect(attempt(run)).not.toThrow();
    });
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

  it('replaces the project root with its directory name in every string, wherever the files quote it', () => {
    const { run } = aggregatedRun();
    // A verification report, a chapter paragraph and a finding's quoted passage that name the root, as model-written files do.
    run.writeText('verification/F1.md', `# Verification of features/F1.md\n\nProject source: \`${run.project}\`\n\nSee ${run.project}/src/orders/service.js.\n`);
    run.writeText('features/F1.md', run.readText('features/F1.md').replace('## Order placement\n', `## Order placement\n\nWritten from ${run.project}/web/src.\n`));
    appendFileSync(join(run.project, 'src/orders/service.js'), `// built under ${run.project}\n`);
    const lane = run.readJson('findings/F1.json');
    lane.findings.push({
      id: 'F1-9', class: 'technical', statement: `The file ${run.project}/src/orders/service.js ends with a note.`, flows: ['F1'],
      evidence: [{ file: 'src/orders/service.js', passage: `// built under ${run.project}` }],
    });
    run.writeJson('findings/F1.json', lane);
    aggregateOk(run);

    const data = collectPageData(run.out, run.project);
    const text = JSON.stringify(data);
    expect(text).not.toContain(run.project);
    expect(text).not.toContain(run.root);
    const [f1] = data.features;
    expect(f1.verificationReport).toContain('Project source: `project`');
    expect(f1.verificationReport).toContain('See project/src/orders/service.js.');
    expect(f1.body).toContain('Written from project/web/src.');
    const finding = data.findings.find((item) => item.id === 'F1-9');
    expect(finding.statement).toBe('The file project/src/orders/service.js ends with a note.');
    expect(finding.evidence[0].passage).toBe('// built under project');
    expect(Object.keys(data)).toEqual([
      'format', 'project', 'sourceRevision', 'language', 'role', 'scope',
      'counts', 'overview', 'features', 'findings', 'tables', 'unassigned', 'uncovered',
    ]);
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

describe('collectPageData with priorities (openspec change prd-report-finding-priority, design D5)', () => {
  const attempt = (run) => () => collectPageData(run.out, run.project);

  /** The lane fixture with both features ranked, then aggregated. */
  function rankedRun() {
    const { run } = aggregatedRun();
    writeRanks(run, 'F1', [rankEntry('F1-1', 'P1', 'Wrong result in a used flow.')]);
    writeRanks(run, 'F2', [rankEntry('F2-1', 'P0', 'Corrupts stored data.')]);
    aggregateOk(run);
    return run;
  }

  it('carries each finding\'s priority and reason, in aggregate\'s order, and the level counts', () => {
    const run = rankedRun();
    const data = collectPageData(run.out, run.project);
    expect(data.findings.map((finding) => [finding.id, finding.priority, finding.priorityReason])).toEqual([
      ['F2-1', 'P0', 'Corrupts stored data.'],
      ['F1-1', 'P1', 'Wrong result in a used flow.'],
    ]);
    expect(data.findings).toEqual(run.readJson('findings.json').findings);
    expect(data.counts.findings).toEqual({ product: 1, technical: 1, priority: { P0: 1, P1: 1, P2: 0, unranked: 0 } });
    expect(data.features.map((feature) => feature.counts.findings.priority)).toEqual([
      { P0: 0, P1: 1, P2: 0, unranked: 0 },
      { P0: 1, P1: 0, P2: 0, unranked: 0 },
    ]);
  });

  it('carries null for the findings of a feature whose file is missing', () => {
    const { run } = aggregatedRun();
    const data = collectPageData(run.out, run.project);
    expect(data.findings.map((finding) => [finding.priority, finding.priorityReason])).toEqual([[null, null], [null, null]]);
    expect(data.counts.findings.priority).toEqual({ P0: 0, P1: 0, P2: 0, unranked: 2 });
  });

  it('refuses a priorities file added after aggregate, and passes again after aggregate', () => {
    const { run } = aggregatedRun();
    expect(attempt(run)).not.toThrow();
    writeRanks(run, 'F1', [rankEntry('F1-1', 'P2')]);
    expect(attempt(run)).toThrow(UsageError);
    expect(attempt(run)).toThrow(/findings\.json does not hold the current findings of F1.*prd\.mjs aggregate/);
    expect(attempt(run)).toThrow(/F1's recorded fields in index\.json differ from what its files give/);
    aggregateOk(run);
    expect(attempt(run)).not.toThrow();
  });

  it('refuses a priorities file changed after aggregate: another level or another reason', () => {
    const run = rankedRun();
    expect(attempt(run)).not.toThrow();
    writeRanks(run, 'F1', [rankEntry('F1-1', 'P0', 'Wrong result in a used flow.')]);
    expect(attempt(run)).toThrow(/findings\.json does not hold the current findings of F1.*prd\.mjs aggregate/);
    aggregateOk(run);
    expect(attempt(run)).not.toThrow();
    writeRanks(run, 'F1', [rankEntry('F1-1', 'P0', 'Another reason.')]);
    expect(attempt(run)).toThrow(/findings\.json does not hold the current findings of F1.*prd\.mjs aggregate/);
  });

  it('refuses a priorities file that stopped passing, and one removed', () => {
    const run = rankedRun();
    writeRanks(run, 'F2', [rankEntry('F2-1', 'P5')]);
    expect(attempt(run)).toThrow(/findings\.json does not hold the current findings of F2.*prd\.mjs aggregate/);
    writeRanks(run, 'F2', [rankEntry('F2-1', 'P0', 'Corrupts stored data.')]);
    expect(attempt(run)).not.toThrow();
    rmSync(join(run.out, 'priorities/F2.json'));
    expect(attempt(run)).toThrow(/F2.*prd\.mjs aggregate/);
  });

  it('refuses a run whose index.json and findings.json are from before priorities', () => {
    const run = rankedRun();
    const stored = run.readJson('findings.json');
    run.writeJson('findings.json', { ...stored, findings: stored.findings.map(({ priority, priorityReason, ...rest }) => rest) });
    expect(attempt(run)).toThrow(/findings\.json does not hold the current findings.*prd\.mjs aggregate/);
    aggregateOk(run);
    const index = run.readIndex();
    for (const feature of index.features) delete feature.counts.findings.priority;
    run.writeIndex(index);
    expect(attempt(run)).toThrow(/recorded fields in index\.json differ.*prd\.mjs aggregate/);
  });
});
