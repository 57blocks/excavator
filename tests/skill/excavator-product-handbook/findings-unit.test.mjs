// O1 (unit) of openspec change handbook-feature-findings: slices, verdicts (two
// rounds), trace, trace-verdicts and mark run on the unit id `<feature>.findings`
// with the rules the features have; the state is kept under `state.findings`;
// removed findings are recorded; a unit that loses every finding is verified
// with none, never failed.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { clone, judge, traceFeature, verifyChecked } from './helpers.mjs';
import { checkedFindingsRun, unitId } from './findings-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const ID = unitId('F1');
const readJsonAt = (path) => JSON.parse(readFileSync(path, 'utf-8'));
const stateOf = (run) => run.readState().findings.F1;
const ITEMS = ['findings[0]', 'findings[1]', 'findings[2]'];

describe('slices: the findings are cut into the items a verifier judges', () => {
  it('refuses a unit that has not passed check-findings and cuts a checked one, one item per finding (the unknowns carry no evidence)', () => {
    const run = checkedFindingsRun(cleanups);
    const result = run.run('slices', ID);
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('F1.findings: round 1, 3 items in 1 part');
    const verify = readJsonAt(join(run.out, 'verify', 'round-1', ID, 'part-1.json'));
    expect(verify.feature).toBe(ID);
    expect(verify.items.map((item) => item.id)).toEqual(ITEMS);
    for (const item of verify.items) expect(item.evidence.length).toBeGreaterThan(0);
    expect(run.run('slices', 'F3.findings').lines[0]).toBe('F3.findings: is planned; only a checked feature is verified');
  });

  it('writes the claim of each finding from the fixed texts: Finding, the category name, the statement', () => {
    const run = checkedFindingsRun(cleanups);
    run.run('slices', ID);
    const { items } = readJsonAt(join(run.out, 'verify', 'round-1', ID, 'part-1.json'));
    expect(items[0].claim).toBe('Finding > Missing check of who may do it > Deleting an order asks nothing about who calls: the handler removes the order and answers success to every caller.');
    expect(items[1].claim.startsWith('Finding > Errors swallowed or answered as success > ')).toBe(true);
    expect(items[2].claim.startsWith('Finding > Hard-coded values, placeholders and unreachable code > ')).toBe(true);
  });
});

describe('verdicts and trace-verdicts on a findings unit', () => {
  it('removes a contradicted finding at once, records it under state.findings and confirms the rest', () => {
    const run = checkedFindingsRun(cleanups);
    const result = judge(run, ID, 1, (item) => (item.id === 'findings[1]' ? { verdict: 'contradicted', reason: 'The code shown stores the order.' } : 'verified'));
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('F1.findings: confirmed, 1 item removed');
    expect(stateOf(run).status).toBe('confirmed');
    expect(stateOf(run).removed.map((record) => [record.path, record.verdict, record.reason])).toEqual([['findings[1]', 'contradicted', 'The code shown stores the order.']]);
    expect(stateOf(run).removed[0].claim.startsWith('Finding > Errors swallowed or answered as success > ')).toBe(true);
    expect(run.readFindings('F1').findings.map((finding) => finding.category)).toEqual(['authorization', 'hard-coded']);
    expect(run.readState().features.F1.status).toBe('planned');
  });

  it('two findings, both confirmed, a tracer finds counter-evidence for the second: only the first stays, the second is recorded with the tracer\'s reason', () => {
    const run = checkedFindingsRun(cleanups);
    const doc = run.findingsDoc('F1');
    doc.findings = doc.findings.slice(0, 2);
    run.writeFindings('F1', doc);
    expect(run.run('check-findings', ID).status).toBe(0);
    expect(judge(run, ID).lines[0]).toBe('F1.findings: confirmed (2 items)');
    const traced = traceFeature(run, ID, (item) => (item.id === 'findings[1]' ? { verdict: 'contradicted', reason: 'A step before the route stores the order.', at: [{ file: 'src/app.js', line: 6 }] } : 'holds'), () => {}, () => 'holds');
    expect(traced.status, traced.stdout).toBe(0);
    expect(traced.lines).toEqual(['F1.findings: verified, 1 item removed']);
    expect(stateOf(run)).toMatchObject({ status: 'verified' });
    expect(stateOf(run).removed).toHaveLength(1);
    expect(stateOf(run).removed[0]).toMatchObject({ path: 'findings[1]', verdict: 'contradicted', step: 'trace', reason: 'A step before the route stores the order.' });
    expect(run.readFindings('F1').findings).toHaveLength(1);
    expect(typeof stateOf(run).entryDigest).toBe('string');
  });

  it('an unverified finding goes to one rewrite of its citations; round 2 removes what is still not verified and confirms', () => {
    const run = checkedFindingsRun(cleanups);
    const first = judge(run, ID, 1, (item) => (item.id === 'findings[2]' ? { verdict: 'unverified', reason: 'No line shown says what was created.' } : 'verified'));
    expect(first.status, first.stdout).toBe(0);
    expect(first.lines[0]).toBe('F1.findings: 1 item to rewrite');
    expect(stateOf(run).rewriting).toBe(true);
    expect(readJsonAt(join(run.out, 'rewrite', `${ID}.json`)).items.map((item) => item.id)).toEqual(['findings[2]']);
    const second = judge(run, ID, 2, () => ({ verdict: 'unverified', reason: 'Still nothing says it.' }));
    expect(second.status, second.stdout).toBe(0);
    expect(second.lines[0]).toBe('F1.findings: confirmed, 1 item removed');
    expect(run.readFindings('F1').findings).toHaveLength(2);
  });

  it('every finding removed by the verifiers leaves a confirmed unit with none, not a failed one; trace then needs no tracer and verifies it', () => {
    const run = checkedFindingsRun(cleanups);
    const result = judge(run, ID, 1, () => ({ verdict: 'contradicted', reason: 'The code shown does not say so.' }));
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('F1.findings: confirmed, 3 items removed');
    expect(stateOf(run).status).toBe('confirmed');
    expect(run.readFindings('F1').findings).toEqual([]);
    expect(stateOf(run).removed.map((record) => record.path)).toEqual(ITEMS);
    const traced = run.run('trace', ID);
    expect(traced.status, traced.stdout).toBe(0);
    expect(traced.lines[0]).toBe('F1.findings: 0 items in 0 parts');
    expect(traced.lines.some((line) => line.startsWith('Part '))).toBe(false);
    const settled = run.run('trace-verdicts', ID);
    expect(settled.status, settled.stdout).toBe(0);
    expect(settled.lines).toEqual(['F1.findings: verified (0 findings)']);
    expect(stateOf(run).status).toBe('verified');
    expect(stateOf(run).removed).toHaveLength(3);
  });

  it('every finding removed by the tracers leaves a verified unit with none, with the removals recorded', () => {
    const run = checkedFindingsRun(cleanups);
    expect(judge(run, ID).status).toBe(0);
    const traced = traceFeature(run, ID, () => ({ verdict: 'contradicted', reason: 'Another step of the code does it.', at: [{ file: 'src/app.js', line: 6 }] }));
    expect(traced.status, traced.stdout).toBe(0);
    expect(traced.lines).toEqual(['F1.findings: verified, 3 items removed']);
    expect(stateOf(run).status).toBe('verified');
    expect(stateOf(run).removed.map((record) => [record.path, record.step])).toEqual(ITEMS.map((path) => [path, 'trace']));
    expect(run.readFindings('F1').findings).toEqual([]);
  });

  it('a feature entry keeps its rule: removing every item of it fails the feature', () => {
    const run = checkedFindingsRun(cleanups);
    run.writeEntry('F1');
    expect(run.run('check-entry', 'F1').status).toBe(0);
    expect(judge(run, 'F1', 1, () => 'unverified').status).toBe(0);
    const round2 = judge(run, 'F1', 2, () => ({ verdict: 'unverified', reason: 'Nothing shown says it.' }));
    expect(round2.lines).toEqual(['F1: failed at verify: no item could be proved']);
    expect(run.readState().features.F1.status).toBe('failed');
    // The findings unit of the same feature is a unit of its own.
    expect(run.readState().findings.F1.status).toBe('checked');
  });

  it('a verified unit is the file the tracers saw: a changed file starts over as checked', () => {
    const run = checkedFindingsRun(cleanups);
    verifyChecked(run, ID);
    expect(stateOf(run).status).toBe('verified');
    const doc = clone(run.readFindings('F1'));
    doc.findings[0].text = 'Deleting an order answers success to every caller.';
    run.writeFindings('F1', doc);
    expect(run.run('check-findings', ID).lines).toEqual(['F1.findings: checked']);
    expect(stateOf(run)).toEqual({ status: 'checked', attempts: 0 });
  });

  it('refuses a third dispatch and a dispatch of a unit that is already checked', () => {
    const run = checkedFindingsRun(cleanups);
    expect(run.run('mark', ID, 'dispatched').lines).toEqual(['F1.findings: already checked; it is not written again']);
    const other = checkedFindingsRun(cleanups, 'F3');
    expect(other.run('mark', 'F1.findings', 'dispatched').status).toBe(0);
    expect(other.run('mark', 'F1.findings', 'failed', 'lane', 'wrote nothing').status).toBe(0);
    expect(other.run('mark', 'F1.findings', 'dispatched').status).toBe(0);
    expect(other.run('mark', 'F1.findings', 'dispatched').lines[0]).toBe('F1.findings: attempts is already 2, the most a lane gets');
    expect(existsSync(join(other.out, 'entries', 'F1.findings.json'))).toBe(false);
  });
});
