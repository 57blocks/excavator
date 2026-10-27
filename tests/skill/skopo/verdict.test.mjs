/**
 * The verdict the runner trusts instead of the model's report (openspec change skopo-extension,
 * design D10, oracle O5). Each check is shown to fail on a fixture broken in exactly one way.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { verdict } from '../../../skills/skopo-create/lib/verdict.mjs';
import { assembleReport, writeReportPage } from '../../../skills/skopo-create/lib/report.mjs';
import { cleanup, makeOut, REVISION } from './helpers.mjs';

const outs = [];
const fixture = (stage, options) => {
  const out = makeOut(stage, options);
  outs.push(out);
  return out;
};
afterEach(() => {
  for (const out of outs.splice(0)) cleanup(out);
});

const editRun = (out, change) => {
  const path = join(out, 'run', 'run.json');
  writeFileSync(path, JSON.stringify(change(JSON.parse(readFileSync(path, 'utf8')))));
};

describe('verdict plan', () => {
  it('passes a planned run', () => {
    expect(verdict(fixture('planned'), { stage: 'plan', revision: REVISION })).toEqual({ ok: true, problems: [] });
  });

  it.each([
    ['a stopped run', (out) => editRun(out, (r) => ({ ...r, decisions: { ...r.decisions, stopped: 'off the default branch' } })), /stopped: off the default branch/],
    ['no plan decision', (out) => editRun(out, (r) => ({ ...r, decisions: {} })), /no plan decision/],
    ['no research', (out) => rmSync(join(out, 'run', 'research', 'world.md')), /holds no research report/],
    ['an empty plan', (out) => writeFileSync(join(out, 'run', 'plan.md'), '  \n'), /plan\.md is missing or empty/],
  ])('fails %s', (_name, breakIt, expected) => {
    const out = fixture('planned');
    breakIt(out);
    const result = verdict(out, { stage: 'plan', revision: REVISION });
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(expected);
  });

  it('fails a run of another source revision', () => {
    const result = verdict(fixture('planned'), { stage: 'plan', revision: 'git:2222222222222222222222222222222222222222' });
    expect(result.problems.join('\n')).toMatch(/the source is now git:2222/);
  });
});

describe('verdict create', () => {
  it('passes a finished run with a lint-clean skopository', () => {
    expect(verdict(fixture('created'), { stage: 'create', revision: REVISION })).toEqual({ ok: true, problems: [] });
  });

  it('fails with the lint error when an anchor is broken', () => {
    const out = fixture('created');
    const file = join(out, 'skopo', 'spec', 'permits.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace('^R-cxsjfa', '^R-cx'));
    const result = verdict(out, { stage: 'create', revision: REVISION });
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.startsWith('lint: error '))).toBe(true);
  });

  it('fails a run that was not finished', () => {
    const out = fixture('created');
    editRun(out, (r) => ({ ...r, endedAt: null }));
    expect(verdict(out, { stage: 'create', revision: REVISION }).problems.join('\n')).toMatch(/no end time/);
  });

  it('fails a question that cites an ID the skopository lacks', () => {
    const out = fixture('created');
    writeFileSync(join(out, 'run', 'questions.md'), '| 1 | money | Fees? | a · b | R-zzzzzz |\n');
    expect(verdict(out, { stage: 'create', revision: REVISION }).problems.join('\n')).toMatch(/questions\.md:1 {2}R-zzzzzz is cited but not defined/);
  });

  it('fails a run with no skopository', () => {
    expect(verdict(fixture('planned'), { stage: 'create', revision: REVISION }).problems).toContain('skopo/skopo.json is missing');
  });
});

describe('verdict report', () => {
  it('passes once the report is assembled and its page written, and not before', () => {
    const out = fixture('reported');
    expect(verdict(out, { stage: 'report', revision: REVISION }).problems).toEqual(['report/report.md is missing', 'report/report.html is missing']);
    assembleReport(out);
    writeReportPage(out);
    expect(verdict(out, { stage: 'report', revision: REVISION })).toEqual({ ok: true, problems: [] });
  });
});

describe('verdict input', () => {
  it('refuses an unknown stage and a directory without a run', () => {
    expect(() => verdict(fixture('planned'), { stage: 'lock', revision: REVISION })).toThrow(/stage must be one of/);
    const out = fixture('planned');
    rmSync(join(out, 'run', 'run.json'));
    expect(verdict(out, { stage: 'plan', revision: REVISION }).problems[0]).toMatch(/holds no skopo run/);
  });
});
