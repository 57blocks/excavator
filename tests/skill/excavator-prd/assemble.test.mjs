// `prd.mjs assemble <out>`: one PRD.md, byte for byte the same from the same
// input, chapters in `chapter` order, failed features only in the appendix
// (openspec change prd-feature-pipeline, design D7).
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { makeLaneRun, runPrd } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
function aggregated(mutate = () => {}) {
  const run = makeLaneRun();
  cleanups.push(run.cleanup);
  mutate(run);
  expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
  expect(runPrd(['aggregate', run.out, '--project', run.project]).status).toBe(0);
  return run;
}
const prd = (run) => readFileSync(join(run.out, 'PRD.md'), 'utf-8');

describe('prd.mjs assemble', () => {
  it('writes PRD.md: overview, the roles table, the chapters without front-matter, then the appendix', () => {
    const run = aggregated();
    const out = runPrd(['assemble', run.out, '--project', run.project]);
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(out.stdout.trim()).toBe(join(run.out, 'PRD.md'));
    const text = prd(run);
    const at = (part) => text.indexOf(part);
    expect(text.startsWith('# Orders\n')).toBe(true);
    expect(at('## Roles by feature')).toBeGreaterThan(at('An overview of the synthetic orders product.'));
    expect(at('## Order placement')).toBeGreaterThan(at('## Roles by feature'));
    expect(at('## Order cancellation')).toBeGreaterThan(at('## Order placement'));
    expect(at('## Appendix')).toBeGreaterThan(at('## Order cancellation'));
    expect(at('### Coverage')).toBeGreaterThan(at('## Appendix'));
    expect(at('### Verification')).toBeGreaterThan(at('### Coverage'));
    expect(text).not.toMatch(/^id: F1$/m);
    expect(text).not.toContain('\n---\n');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('gives the same bytes on a second run', () => {
    const run = aggregated();
    expect(runPrd(['assemble', run.out, '--project', run.project]).status).toBe(0);
    const first = prd(run);
    expect(runPrd(['assemble', run.out, '--project', run.project]).status).toBe(0);
    expect(prd(run)).toBe(first);
  });

  it('orders the chapters by chapter, not by id', () => {
    const run = aggregated((r) => {
      const index = r.readIndex();
      index.features[0].chapter = 2;
      index.features[1].chapter = 1;
      r.writeIndex(index);
      r.writeText('features/F1.md', r.readText('features/F1.md').replace('chapter: 1', 'chapter: 2'));
      r.writeText('features/F2.md', r.readText('features/F2.md').replace('chapter: 2', 'chapter: 1'));
    });
    expect(runPrd(['assemble', run.out, '--project', run.project]).status).toBe(0);
    const text = prd(run);
    expect(text.indexOf('## Order cancellation')).toBeLessThan(text.indexOf('## Order placement'));
  });

  it('lists a failed feature with its reasons in the appendix and leaves its chapter out of the body', () => {
    const run = aggregated((r) => {
      const findings = r.readJson('findings/F2.json');
      findings.findings[0].evidence[0].passage = 'return order;';
      r.writeJson('findings/F2.json', findings);
    });
    expect(runPrd(['assemble', run.out, '--project', run.project]).status).toBe(0);
    const text = prd(run);
    expect(text).not.toContain('## Order cancellation');
    expect(text).not.toContain('A support agent cancels an order');
    const appendix = text.slice(text.indexOf('## Appendix'));
    expect(appendix).toContain('### Failed features');
    expect(appendix).toContain('| F2 | Order cancellation | check-lane | F2-1: the passage occurs 2 times in src/orders/service.js; quote more of it until it occurs once |');
  });

  it('lists a feature that was never written in the appendix', () => {
    const run = aggregated((r) => {
      rmSync(join(r.out, 'features/F2.md'));
      rmSync(join(r.out, 'findings/F2.json'));
      rmSync(join(r.out, 'verification/F2.txt'));
    });
    expect(runPrd(['assemble', run.out, '--project', run.project]).status).toBe(0);
    const appendix = prd(run).slice(prd(run).indexOf('## Appendix'));
    expect(appendix).toContain('### Features not written');
    expect(appendix).toContain('| F2 | Order cancellation | planned |');
  });

  it('strips front-matter from the overview too', () => {
    const run = aggregated((r) => r.writeText('overview.md', `---\ntitle: Orders\n---\n${r.readText('overview.md')}`));
    expect(runPrd(['assemble', run.out, '--project', run.project]).status).toBe(0);
    expect(prd(run).startsWith('# Orders\n')).toBe(true);
  });

  it('refuses to assemble before overview.md or the tables exist', () => {
    const run = aggregated();
    rmSync(join(run.out, 'overview.md'));
    const noOverview = runPrd(['assemble', run.out, '--project', run.project]);
    expect(noOverview.status).toBe(1);
    expect(noOverview.stdout).toMatch(/overview\.md/);
    const fresh = makeLaneRun();
    cleanups.push(fresh.cleanup);
    const noTables = runPrd(['assemble', fresh.out, '--project', fresh.project]);
    expect(noTables.status).toBe(1);
    expect(noTables.stdout).toMatch(/aggregate/);
  });
});
