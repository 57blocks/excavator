// `prd.mjs aggregate <out>`: statuses recomputed from the files, the verify
// reply lines parsed, findings.json and the three tables written, the status
// buckets conserved, and the reply's counts printed (openspec change
// prd-feature-pipeline, design D5, D7, D9).
import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { TABLE_FILES, computeAggregate } from '../../../skills/excavator-prd-report/lib/aggregate.mjs';
import { makeLaneRun, runPrd } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
function laneRun() {
  const run = makeLaneRun();
  cleanups.push(run.cleanup);
  return run;
}

/** The reply's 18 placeholders (the contract test of SKILL.md pins the same list), then the four priority totals and the features to retry that aggregate also prints. */
const FIELD_PATHS = [
  'prdPath',
  'features.total', 'features.written', 'features.failed',
  'diagrams',
  'findings.product', 'findings.technical',
  'findings.priority.P0', 'findings.priority.P1', 'findings.priority.P2', 'findings.priority.unranked',
  'verification.verified', 'verification.contradicted', 'verification.misattributed', 'verification.unverifiable',
  'verification.resolvedRight', 'verification.resolvedWrong', 'verification.stillOpen',
  'verification.conflicts', 'verification.notChecked',
  'uncovered',
  'outIsDefault',
  'retryable',
];
/** Every leaf path of a JSON value; an array is a leaf. */
function leafPaths(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
}

/** The lane fixture plus F3, a planned feature whose lane has not run. */
function runWithPlannedFeature() {
  const run = laneRun();
  const index = run.readIndex();
  index.candidates.items.push({ id: 'c3', kind: 'job', file: 'src/orders/service.js', line: 15, text: 'function reopenOrder(order) {', framework: 'custom', provenance: 'inferred' });
  index.features.push({ id: 'F3', name: 'Order reopening', kind: 'automated', chapter: 3, entrypoints: ['c3'], seedFiles: ['src/orders/service.js'], tiers: ['backend'] });
  run.writeIndex(index);
  expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
  return run;
}

describe('prd.mjs aggregate', () => {
  it('prints exactly the reply\'s fields, summed from each verified feature\'s counts', () => {
    const run = runWithPlannedFeature();
    const out = runPrd(['aggregate', run.out, '--project', run.project]);
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(leafPaths(out.json).sort()).toEqual([...FIELD_PATHS].sort());
    // F2's verification counts are all 0, so a sum that counted features instead of counts would differ.
    expect(out.json).toEqual({
      prdPath: join(run.out, 'PRD.md'),
      features: { total: 3, written: 2, failed: 0 },
      diagrams: 2,
      findings: { product: 1, technical: 1, priority: { P0: 0, P1: 0, P2: 0, unranked: 2 } },
      verification: {
        verified: 7, contradicted: 2, misattributed: 1, unverifiable: 3,
        resolvedRight: 2, resolvedWrong: 1, stillOpen: 4, conflicts: 1, notChecked: 5,
      },
      uncovered: [],
      outIsDefault: false,
      retryable: [],
    });
  });

  it('records each feature\'s status, counts and failure in index.json, and the buckets add up to the features', () => {
    const run = runWithPlannedFeature();
    expect(runPrd(['aggregate', run.out, '--project', run.project]).status).toBe(0);
    const features = run.readIndex().features;
    expect(features.map((f) => f.status)).toEqual(['verified', 'verified', 'planned']);
    expect(features[1].counts).toEqual({
      diagrams: 1, evidence: 2, findings: { product: 0, technical: 1, priority: { P0: 0, P1: 0, P2: 0, unranked: 1 } },
      verification: { verified: 0, contradicted: 0, misattributed: 0, unverifiable: 0, resolvedRight: 0, resolvedWrong: 0, stillOpen: 0, conflicts: 0, notChecked: 0 },
    });
    expect(features[2].counts.verification).toBeNull();
    expect(features.every((f) => f.failure === null)).toBe(true);
    expect(run.readIndex().conservation.holds).toBe(true);
  });

  it('fails a feature whose verification reply misses a line, with the reason, and keeps it out of the sums', () => {
    const run = runWithPlannedFeature();
    run.writeText('verification/F1.txt', run.readText('verification/F1.txt').replace(/^Open items: .*\n/m, ''));
    const out = runPrd(['aggregate', run.out, '--project', run.project]);
    expect(out.status, out.stdout).toBe(0);
    expect(out.json.features).toEqual({ total: 3, written: 1, failed: 1 });
    expect(out.json.verification.verified).toBe(0);
    expect(out.json.diagrams).toBe(1);
    const f1 = run.readIndex().features[0];
    expect(f1.status).toBe('failed');
    expect(f1.failure.step).toBe('verify');
    expect(f1.failure.reasons).toEqual(['verification-reply-unparsed: verification/F1.txt: 3 lines hold counts, not 4']);
  });

  it('keeps a check-lane failure check-lane recorded, even when the files pass now', () => {
    const run = runWithPlannedFeature();
    const findings = run.readJson('findings/F1.json');
    const good = JSON.stringify(findings);
    findings.findings[0].statement = 'The route should check the quantity.';
    run.writeJson('findings/F1.json', findings);
    expect(runPrd(['check-lane', run.out, '--project', run.project, 'F1']).status).toBe(1);
    run.writeJson('findings/F1.json', JSON.parse(good));
    const out = runPrd(['aggregate', run.out, '--project', run.project]);
    expect(out.status, out.stdout).toBe(0);
    const f1 = run.readIndex().features[0];
    expect(f1.status).toBe('failed');
    expect(f1.failure).toEqual({ step: 'check-lane', reasons: ['F1-1: the statement gives advice ("should"); state the defect as it is'] });
    expect(out.json.features).toEqual({ total: 3, written: 1, failed: 1 });
    expect(runPrd(['check-lane', run.out, '--project', run.project, 'F1']).status).toBe(0);
    expect(runPrd(['aggregate', run.out, '--project', run.project]).json.features).toEqual({ total: 3, written: 2, failed: 0 });
    expect(run.readIndex().features[0].status).toBe('verified');
  });

  // Change prd-report-dedupe, design D4: the two chapter rules of the new shape are check-lane's alone.
  it('does not fail a verified chapter for a section that is not a flow or for a two column open items table', () => {
    const run = runWithPlannedFeature();
    run.writeText('features/F1.md', run.readText('features/F1.md')
      .replace('chapter: 1', 'openItems: Open items\nchapter: 1')
      .replace('<details>', '### Permissions\n\nWho may place an order.\n\n<details>')
      .concat('\n### Open items\n\n| Item | Searched |\n|---|---|\n| Refund rule | the whole project |\n'));
    const lane = runPrd(['check-lane', run.out, '--project', run.project, 'F1']);
    expect(lane.status).toBe(1);
    expect(lane.stdout).toContain('F1: ### "Permissions" is neither a listed flow');
    expect(lane.stdout).toContain('F1: the open items section is not one table of three columns');
    run.writeIndex({ ...run.readIndex(), features: run.readIndex().features.map((f) => (f.id === 'F1' ? { ...f, status: 'checked', failure: null } : f)) });
    const out = runPrd(['aggregate', run.out, '--project', run.project]);
    expect(out.status, out.stdout + out.stderr).toBe(0);
    const f1 = run.readIndex().features.find((f) => f.id === 'F1');
    expect(f1.status).toBe('verified');
    expect(f1.failure).toBe(null);
    expect(out.json.features).toEqual({ total: 3, written: 2, failed: 0 });
  });

  it('prints outIsDefault true only when <out> is the project\'s .excavator/prd-report', () => {
    const run = runWithPlannedFeature();
    expect(runPrd(['aggregate', run.out, '--project', run.project]).json.outIsDefault).toBe(false);
    const legacy = join(run.project, '.excavator', 'prd');
    cpSync(run.out, legacy, { recursive: true });
    expect(runPrd(['aggregate', legacy, '--project', run.project]).json.outIsDefault).toBe(false);
    const inside = join(run.project, '.excavator', 'prd-report');
    cpSync(run.out, inside, { recursive: true });
    const out = runPrd(['aggregate', inside, '--project', run.project]);
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(out.json.outIsDefault).toBe(true);
    expect(out.json.prdPath).toBe(join(inside, 'PRD.md'));
  });

  it('fails as verification-report-missing a feature with the reply lines but no report', () => {
    const run = runWithPlannedFeature();
    rmSync(join(run.out, 'verification/F1.md'));
    const out = runPrd(['aggregate', run.out, '--project', run.project]);
    expect(out.status, out.stdout).toBe(0);
    const f1 = run.readIndex().features[0];
    expect(f1.status).toBe('failed');
    expect(f1.failure).toEqual({ step: 'verify', reasons: ['verification-report-missing: verification/F1.md is missing'] });
    expect(out.json.verification.verified).toBe(0);
  });

  it('leaves a lane without verification checked, and fails a lane the checks refuse', () => {
    const run = runWithPlannedFeature();
    rmSync(join(run.out, 'verification/F2.txt'));
    const findings = run.readJson('findings/F1.json');
    findings.findings[0].statement = 'The route should check the quantity.';
    run.writeJson('findings/F1.json', findings);
    const out = runPrd(['aggregate', run.out, '--project', run.project]);
    expect(out.status).toBe(0);
    const features = run.readIndex().features;
    expect(features.map((f) => f.status)).toEqual(['failed', 'checked', 'planned']);
    expect(features[0].failure).toEqual({ step: 'check-lane', reasons: ['F1-1: the statement gives advice ("should"); state the defect as it is'] });
    expect(out.json.features).toEqual({ total: 3, written: 1, failed: 1 });
    expect(out.json.findings).toEqual({ product: 0, technical: 1, priority: { P0: 0, P1: 0, P2: 0, unranked: 1 } });
  });

  it('fails as lane-wrote-nothing a feature with no files after two attempts', () => {
    const run = runWithPlannedFeature();
    const index = run.readIndex();
    index.features[2].attempts = 2;
    run.writeIndex(index);
    expect(runPrd(['aggregate', run.out, '--project', run.project]).status).toBe(0);
    const f3 = run.readIndex().features[2];
    expect(f3.status).toBe('failed');
    expect(f3.failure.step).toBe('lane');
    expect(f3.failure.reasons[0]).toMatch(/^lane-wrote-nothing/);
  });

  it('writes findings.json with each finding\'s feature, its line and verdict anchor-checked, from passing lanes only', () => {
    const run = runWithPlannedFeature();
    expect(runPrd(['aggregate', run.out, '--project', run.project]).status).toBe(0);
    const product = run.readJson('findings.json');
    expect(product.format).toBe('excavator-prd-report-findings/1');
    expect(product.sourceRevision).toBe('directory:synthetic');
    expect(product.findings.map((f) => [f.id, f.feature, f.verdict])).toEqual([
      ['F1-1', 'F1', 'anchor-checked'],
      ['F2-1', 'F2', 'anchor-checked'],
    ]);
    expect(product.findings[1].evidence[0].line).toBe(11);
  });

  it('writes the five tables: terminology, roles, open items, coverage and verification', () => {
    const run = runWithPlannedFeature();
    const index = run.readIndex();
    index.candidates.items.push({ id: 'c9', kind: 'route', file: 'src/orders/routes.js', line: 8, text: 'module.exports = router;', framework: 'express' });
    index.unassigned = ['c9'];
    index.candidates.uncovered = ['spring'];
    run.writeIndex(index);
    expect(runPrd(['aggregate', run.out, '--project', run.project]).status).toBe(0);
    expect(TABLE_FILES).toEqual(['tables/terminology.md', 'tables/roles.md', 'tables/open-items.md', 'tables/coverage.md', 'tables/verification.md']);
    for (const rel of TABLE_FILES) expect(existsSync(join(run.out, rel)), rel).toBe(true);
    expect(existsSync(join(run.out, 'tables/roles-by-feature.md'))).toBe(false);
    expect(run.readText('tables/terminology.md')).toBe('| Term | Meaning |\n|---|---|\n| Order | A customer\'s request for goods, with a status of open or cancelled. |\n');
    const roles = run.readText('tables/roles.md');
    expect(roles).toContain('| Feature | customer | support agent |');
    expect(roles).toContain('| F1 Order placement | x |  |');
    expect(roles).toContain('| F2 Order cancellation |  | x |');
    expect(roles).not.toContain('F3 Order reopening');
    expect(run.readText('tables/open-items.md')).toBe('None.\n');
    const coverage = run.readText('tables/coverage.md');
    expect(coverage).toContain('| c1 | route | `src/orders/routes.js:5` | express | F1 Order placement | verified |');
    expect(coverage).toContain('| c3 | job | `src/orders/service.js:15` | custom (inferred) | F3 Order reopening | planned |');
    expect(coverage).toContain('| c9 | route | `src/orders/routes.js:8` | express | unassigned | - |');
    expect(coverage).toMatch(/spring/);
    const verification = run.readText('tables/verification.md');
    expect(verification).toContain('| F1 Order placement | verified | 7 | 2 | 1 | 3 | 2 | 1 | 4 | 1 | 5 |');
    expect(verification).toContain('| F3 Order reopening | planned | - | - | - | - | - | - | - | - | - |');
    expect(verification).toContain('| Total |  | 7 | 2 | 1 | 3 | 2 | 1 | 4 | 1 | 5 |');
  });

  it('prints the uncovered frameworks from the index', () => {
    const run = runWithPlannedFeature();
    const index = run.readIndex();
    index.candidates.uncovered = ['spring', 'django'];
    run.writeIndex(index);
    expect(runPrd(['aggregate', run.out, '--project', run.project]).json.uncovered).toEqual(['spring', 'django']);
  });

  it('fails when the candidates are not conserved, and writes no findings.json', () => {
    const run = runWithPlannedFeature();
    const index = run.readIndex();
    index.features[2].entrypoints = [];
    run.writeIndex(index);
    const out = runPrd(['aggregate', run.out, '--project', run.project]);
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('c3: in no feature and not in unassigned');
    expect(existsSync(join(run.out, 'findings.json'))).toBe(false);
  });

  it('fails a status no bucket holds', () => {
    const run = runWithPlannedFeature();
    const index = run.readIndex();
    index.features[2].status = 'half-done';
    run.writeIndex(index);
    const out = runPrd(['aggregate', run.out, '--project', run.project]);
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(/F3: status "half-done"/);
  });

  it('computes what it writes without writing: computeAggregate gives the contents aggregate then writes', () => {
    const run = runWithPlannedFeature();
    const before = { index: run.readText('index.json'), listing: readdirSync(run.out).sort() };
    const computed = computeAggregate(run.out, run.readIndex(), run.project);
    expect(run.readText('index.json')).toBe(before.index);
    expect(readdirSync(run.out).sort()).toEqual(before.listing);
    expect(computed.problems).toEqual([]);
    expect(runPrd(['aggregate', run.out, '--project', run.project]).status).toBe(0);
    expect(run.readJson('index.json')).toEqual(computed.updated);
    expect(run.readJson('findings.json')).toEqual(computed.findingsFile);
    for (const [rel, text] of Object.entries(computed.tables)) expect(readFileSync(join(run.out, rel), 'utf-8')).toBe(text);
  });
});
