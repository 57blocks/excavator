// `prd.mjs aggregate <out>`: statuses recomputed from the files, the verify
// reply lines parsed, findings.json and the three tables written, the status
// buckets conserved, and the reply's counts printed (openspec change
// prd-feature-pipeline, design D5, D7, D9).
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

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

/** The reply's 17 placeholders (the contract test of SKILL.md pins the same list). */
const FIELD_PATHS = [
  'prdPath',
  'features.total', 'features.written', 'features.failed',
  'diagrams',
  'findings.product', 'findings.technical',
  'verification.verified', 'verification.contradicted', 'verification.misattributed', 'verification.unverifiable',
  'verification.resolvedRight', 'verification.resolvedWrong', 'verification.stillOpen',
  'verification.conflicts', 'verification.notChecked',
  'uncovered',
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
  expect(runPrd(['check-index', run.out]).status).toBe(0);
  return run;
}

describe('prd.mjs aggregate', () => {
  it('prints exactly the reply\'s fields, summed from each verified feature\'s counts', () => {
    const run = runWithPlannedFeature();
    const out = runPrd(['aggregate', run.out]);
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(leafPaths(out.json).sort()).toEqual([...FIELD_PATHS].sort());
    // F2's verification counts are all 0, so a sum that counted features instead of counts would differ.
    expect(out.json).toEqual({
      prdPath: join(run.out, 'PRD.md'),
      features: { total: 3, written: 2, failed: 0 },
      diagrams: 2,
      findings: { product: 1, technical: 1 },
      verification: {
        verified: 7, contradicted: 2, misattributed: 1, unverifiable: 3,
        resolvedRight: 2, resolvedWrong: 1, stillOpen: 4, conflicts: 1, notChecked: 5,
      },
      uncovered: [],
    });
  });

  it('records each feature\'s status, counts and failure in index.json, and the buckets add up to the features', () => {
    const run = runWithPlannedFeature();
    expect(runPrd(['aggregate', run.out]).status).toBe(0);
    const features = run.readIndex().features;
    expect(features.map((f) => f.status)).toEqual(['verified', 'verified', 'planned']);
    expect(features[1].counts).toEqual({
      diagrams: 1, evidence: 2, findings: { product: 0, technical: 1 },
      verification: { verified: 0, contradicted: 0, misattributed: 0, unverifiable: 0, resolvedRight: 0, resolvedWrong: 0, stillOpen: 0, conflicts: 0, notChecked: 0 },
    });
    expect(features[2].counts.verification).toBeNull();
    expect(features.every((f) => f.failure === null)).toBe(true);
    expect(run.readIndex().conservation.holds).toBe(true);
  });

  it('fails a feature whose verification reply misses a line, with the reason, and keeps it out of the sums', () => {
    const run = runWithPlannedFeature();
    run.writeText('verification/F1.txt', run.readText('verification/F1.txt').replace(/^Open items: .*\n/m, ''));
    const out = runPrd(['aggregate', run.out]);
    expect(out.status, out.stdout).toBe(0);
    expect(out.json.features).toEqual({ total: 3, written: 1, failed: 1 });
    expect(out.json.verification.verified).toBe(0);
    expect(out.json.diagrams).toBe(1);
    const f1 = run.readIndex().features[0];
    expect(f1.status).toBe('failed');
    expect(f1.failure.step).toBe('verify');
    expect(f1.failure.reasons.join('\n')).toMatch(/verification-reply-unparsed.*Open items/);
  });

  it('leaves a lane without verification checked, and fails a lane the checks refuse', () => {
    const run = runWithPlannedFeature();
    rmSync(join(run.out, 'verification/F2.txt'));
    const findings = run.readJson('findings/F1.json');
    findings.findings[0].statement = 'The route should check the quantity.';
    run.writeJson('findings/F1.json', findings);
    const out = runPrd(['aggregate', run.out]);
    expect(out.status).toBe(0);
    const features = run.readIndex().features;
    expect(features.map((f) => f.status)).toEqual(['failed', 'checked', 'planned']);
    expect(features[0].failure).toEqual({ step: 'check-lane', reasons: ['F1-1: the statement gives advice ("should"); state the defect as it is'] });
    expect(out.json.features).toEqual({ total: 3, written: 1, failed: 1 });
    expect(out.json.findings).toEqual({ product: 0, technical: 1 });
  });

  it('fails as lane-wrote-nothing a feature with no files after two attempts', () => {
    const run = runWithPlannedFeature();
    const index = run.readIndex();
    index.features[2].attempts = 2;
    run.writeIndex(index);
    expect(runPrd(['aggregate', run.out]).status).toBe(0);
    const f3 = run.readIndex().features[2];
    expect(f3.status).toBe('failed');
    expect(f3.failure.step).toBe('lane');
    expect(f3.failure.reasons[0]).toMatch(/^lane-wrote-nothing/);
  });

  it('writes findings.json with each finding\'s feature, its line and verdict anchor-checked, from passing lanes only', () => {
    const run = runWithPlannedFeature();
    expect(runPrd(['aggregate', run.out]).status).toBe(0);
    const product = run.readJson('findings.json');
    expect(product.format).toBe('excavator-prd-findings/1');
    expect(product.sourceRevision).toBe('directory:synthetic');
    expect(product.findings.map((f) => [f.id, f.feature, f.verdict])).toEqual([
      ['F1-1', 'F1', 'anchor-checked'],
      ['F2-1', 'F2', 'anchor-checked'],
    ]);
    expect(product.findings[1].evidence[0].line).toBe(11);
  });

  it('writes the three tables', () => {
    const run = runWithPlannedFeature();
    const index = run.readIndex();
    index.candidates.items.push({ id: 'c9', kind: 'route', file: 'src/orders/routes.js', line: 8, text: 'module.exports = router;', framework: 'express' });
    index.unassigned = ['c9'];
    index.candidates.uncovered = ['spring'];
    run.writeIndex(index);
    expect(runPrd(['aggregate', run.out]).status).toBe(0);
    const roles = run.readText('tables/roles-by-feature.md');
    expect(roles).toContain('| Feature | customer | support agent |');
    expect(roles).toContain('| F1 Order placement | x |  |');
    expect(roles).toContain('| F2 Order cancellation |  | x |');
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
    expect(runPrd(['aggregate', run.out]).json.uncovered).toEqual(['spring', 'django']);
  });

  it('fails when the candidates are not conserved, and writes no findings.json', () => {
    const run = runWithPlannedFeature();
    const index = run.readIndex();
    index.features[2].entrypoints = [];
    run.writeIndex(index);
    const out = runPrd(['aggregate', run.out]);
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('c3: in no feature and not in unassigned');
    expect(existsSync(join(run.out, 'findings.json'))).toBe(false);
  });

  it('fails a status no bucket holds', () => {
    const run = runWithPlannedFeature();
    const index = run.readIndex();
    index.features[2].status = 'half-done';
    run.writeIndex(index);
    const out = runPrd(['aggregate', run.out]);
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(/F3: status "half-done"/);
  });
});
