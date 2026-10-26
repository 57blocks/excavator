// `prd.mjs reply <out>` (openspec change prd-feature-pipeline, design D9):
// the skill's reply lines, printed from the summary aggregate recorded in
// index.json, with the optional lines decided by the script.
import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeLaneRun, runPrd } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
/** A lane run with its index checked, aggregated and assembled; returns the run and the fields aggregate printed. */
function assembled(mutate = () => {}) {
  const run = makeLaneRun();
  cleanups.push(run.cleanup);
  mutate(run);
  expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
  const fields = runPrd(['aggregate', run.out, '--project', run.project]);
  expect(fields.status, fields.stdout).toBe(0);
  expect(runPrd(['assemble', run.out, '--project', run.project]).status).toBe(0);
  return { run, fields: fields.json };
}
const lines = (out) => out.stdout.split('\n').slice(0, -1);
const OFFER = (path) => `To save it in the project, say so: it goes to ${path} unless you give another path. Commit it to share it with the team.`;

describe('prd.mjs reply', () => {
  it('prints the five fixed lines from the fields aggregate printed, and nothing else when --out was given', () => {
    const { run, fields } = assembled();
    const out = runPrd(['reply', run.out, '--project', run.project]);
    expect(out.status, out.stderr).toBe(0);
    const v = fields.verification;
    expect(lines(out)).toEqual([
      join(run.out, 'PRD.md'),
      `${fields.features.written}/${fields.features.total} features written, ${fields.features.failed} failed`,
      `${fields.diagrams} diagrams`,
      `${fields.findings.product} product, ${fields.findings.technical} technical findings, anchors checked`,
      `Statements: ${v.verified} verified, ${v.contradicted} contradicted, ${v.misattributed} misattributed, ${v.unverifiable} unverifiable; open items: ${v.resolvedRight} resolved right, ${v.resolvedWrong} resolved wrong, ${v.stillOpen} still open; cross-section conflicts: ${v.conflicts}, not checked: ${v.notChecked}`,
    ]);
    expect(lines(out)[1]).toBe('2/2 features written, 0 failed');
  });

  it('adds the frameworks without patterns, joined with a comma, only when there are some', () => {
    const { run } = assembled((r) => {
      const index = r.readIndex();
      index.candidates.uncovered = ['gin', 'spring'];
      r.writeIndex(index);
    });
    expect(lines(runPrd(['reply', run.out, '--project', run.project]))[5]).toBe('No entrypoint patterns for: gin, spring');
  });

  it('offers to save the PRD only when <out> is the default, at docs/PRD.md or docs/PRD-<scope>.md', () => {
    const { run } = assembled();
    const inside = join(run.project, '.excavator', 'prd');
    cpSync(run.out, inside, { recursive: true });
    expect(runPrd(['assemble', inside, '--project', run.project]).status).toBe(0);
    const whole = lines(runPrd(['reply', inside, '--project', run.project]));
    expect(whole).toHaveLength(6);
    expect(whole[0]).toBe(join(inside, 'PRD.md'));
    expect(whole[5]).toBe(OFFER('docs/PRD.md'));
    for (const [scope, path] of [['billing', 'docs/PRD-billing.md'], ['services/billing/', 'docs/PRD-services-billing.md']]) {
      const indexPath = join(inside, 'index.json');
      const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
      writeFileSync(indexPath, `${JSON.stringify({ ...index, scope }, null, 2)}\n`);
      expect(lines(runPrd(['reply', inside, '--project', run.project])).at(-1), scope).toBe(OFFER(path));
    }
  });

  it('reads the summary aggregate recorded instead of the files, and writes nothing', () => {
    const { run } = assembled();
    const before = run.readText('index.json');
    rmSync(join(run.out, 'features', 'F1.md'));
    const out = runPrd(['reply', run.out, '--project', run.project]);
    expect(out.status, out.stderr).toBe(0);
    expect(lines(out)[1]).toBe('2/2 features written, 0 failed');
    expect(run.readText('index.json')).toBe(before);
    expect(existsSync(join(run.out, 'index.json.lock'))).toBe(false);
  });

  it('exits 1 when PRD.md is missing, and 2 for a missing --project', () => {
    const { run } = assembled();
    rmSync(join(run.out, 'PRD.md'));
    const out = runPrd(['reply', run.out, '--project', run.project]);
    expect(out.status).toBe(1);
    expect(out.stdout).toBe('PRD.md: missing; run assemble first\n');
    expect(runPrd(['reply', run.out]).status).toBe(2);
  });
});
