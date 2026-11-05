// O1 (unit) of openspec change handbook-system-overview: slices, verdicts (two
// rounds), trace, trace-verdicts and mark run on the unit id `overview` with
// the rules the features have; the state is kept under `state.overview`, and a
// state file without that key is read as planned.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { clone, judge, traceFeature, verifyChecked } from './helpers.mjs';
import { checkedOverviewRun, overviewRun } from './overview-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const stateOf = (run) => run.readJson('state.json');
const entryOf = (run) => run.readJson('entries/overview.json');
const readJsonAt = (path) => JSON.parse(readFileSync(path, 'utf-8'));
const ITEMS = ['summary[0]', 'audiences[0]', 'applications[0]', 'integrations[0]'];

describe('slices: the overview is cut into the items a verifier judges', () => {
  it('refuses an overview that has not passed check-overview, with a Next line, and cuts a checked one', () => {
    const run = overviewRun(cleanups);
    const planned = run.run('slices', 'overview');
    expect(planned.status).toBe(1);
    expect(planned.lines[0]).toMatch(/^overview: is planned; only a checked feature is verified/);
    expect(run.run('check-overview').status).toBe(0);
    const result = run.run('slices', 'overview');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('overview: round 1, 4 items in 1 part');
    const verify = readJsonAt(join(run.out, 'verify', 'round-1', 'overview', 'part-1.json'));
    expect(verify.feature).toBe('overview');
    expect(verify.items.map((item) => item.id)).toEqual(ITEMS);
  });

  it('writes the claim of each item from the fixed texts, with the context to read it', () => {
    const run = checkedOverviewRun(cleanups);
    run.run('slices', 'overview');
    const { items } = readJsonAt(join(run.out, 'verify', 'round-1', 'overview', 'part-1.json'));
    const claim = Object.fromEntries(items.map((item) => [item.id, item.claim]));
    expect(claim['summary[0]']).toBe('System overview > Purpose > Staff place and review orders for customers.');
    expect(claim['audiences[0]']).toBe('Who: Clerk; What it does: Creates orders.');
    expect(claim['applications[0]']).toBe('Application . (Order tool) > Serves the order pages and sends reminders.');
    expect(claim['integrations[0]']).toBe('External system: Slack; What it is used for: Reminders go to a team channel.; Called by, in the quoted code: .');
    for (const item of items) expect(item.evidence.length).toBeGreaterThan(0);
  });

  it('refuses an id that is neither a feature of the map nor overview, as a usage error', () => {
    const run = checkedOverviewRun(cleanups);
    expect(run.run('slices', 'F9').status).toBe(2);
    expect(run.run('slices', 'Overview').status).toBe(2);
  });
});

describe('verdicts: round 1 and round 2 on the overview', () => {
  it('removes an item either verifier judged contradicted at once, records it under state.overview and lists the unverified one', () => {
    const run = checkedOverviewRun(cleanups);
    const bad = {
      'applications[0]': { verdict: 'contradicted', reason: 'The code shown names another tool.' },
      'audiences[0]': { verdict: 'unverified', reason: 'No line shown names who uses it.' },
    };
    const result = judge(run, 'overview', 1, (item) => bad[item.id] ?? 'verified');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['overview: 1 item removed', 'overview: 1 item to rewrite', `Rewrite file: ${join(run.out, 'rewrite', 'overview.json')}`, result.lines[3]]);
    const { overview } = stateOf(run);
    expect(overview.status).toBe('checked');
    expect(overview.rewriting).toBe(true);
    expect(overview.removed.map((record) => [record.path, record.verdict, record.reason])).toEqual([['applications[0]', 'contradicted', 'The code shown names another tool.']]);
    expect(entryOf(run).applications).toEqual([]);
    expect(stateOf(run).features.F1.status).toBe('planned');
    expect(readJsonAt(join(run.out, 'rewrite', 'overview.json')).items.map((item) => item.id)).toEqual(['audiences[0]']);
  });

  it('a verifier that says contradicted wins over the other, as for a feature', () => {
    const run = checkedOverviewRun(cleanups);
    const result = judge(run, 'overview', 1, (item) => (item.id === 'integrations[0]' ? 'contradicted' : 'verified'), () => 'verified');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('overview: confirmed, 1 item removed');
    expect(entryOf(run).integrations).toEqual([]);
  });

  it('round 2 removes what is still not verified and confirms the overview; the rewrite may change citations only', () => {
    const run = checkedOverviewRun(cleanups);
    expect(judge(run, 'overview', 1, (item) => (item.id === 'summary[0]' ? 'unverified' : 'verified')).status).toBe(0);
    // A rewrite that changes the text is refused by slices --round 2, as for a feature.
    const changed = clone(entryOf(run));
    changed.summary[0].text = 'Staff place orders.';
    run.writeOverview(changed);
    expect(run.run('check-overview').status).toBe(0);
    const refused = run.run('slices', 'overview', '--round', '2');
    expect(refused.status).toBe(1);
    expect(refused.lines[0]).toBe('summary[0]: listed for rewriting, but its claim changed; only its citations may change');
    // Citations only.
    const kept = clone(entryOf(run));
    kept.summary[0].text = run.overview.summary[0].text;
    kept.summary[0].evidence = [{ file: 'src/menu.js', passage: "{ label: 'Orders', path: '/orders' }," }];
    run.writeOverview(kept);
    expect(run.run('check-overview').status).toBe(0);
    const round2 = judge(run, 'overview', 2, () => ({ verdict: 'unverified', reason: 'No line shown says so.' }));
    expect(round2.status, round2.stdout).toBe(0);
    expect(round2.lines[0]).toBe('overview: confirmed, 1 item removed');
    const { overview } = stateOf(run);
    expect(overview.status).toBe('confirmed');
    expect(overview.removed.map((record) => [record.path, record.verdict])).toEqual([['summary[0]', 'unverified']]);
    expect(entryOf(run).summary).toEqual([]);
    expect(typeof overview.entryDigest).toBe('string');
  });

  it('fails at verify when every item that carries evidence is removed, and leaves the file as written', () => {
    const run = checkedOverviewRun(cleanups);
    const before = readFileSync(join(run.out, 'entries', 'overview.json'), 'utf-8');
    expect(judge(run, 'overview', 1, () => 'unverified').status).toBe(0);
    const round2 = judge(run, 'overview', 2, () => ({ verdict: 'unverified', reason: 'Nothing shown says why.' }));
    expect(round2.lines).toEqual(['overview: failed at verify: no item could be proved']);
    expect(stateOf(run).overview.status).toBe('failed');
    expect(stateOf(run).overview.removed).toHaveLength(4);
    expect(readFileSync(join(run.out, 'entries', 'overview.json'), 'utf-8')).toBe(before);
  });

  it('records nothing when a verdict file is missing, and names the part-letter', () => {
    const run = checkedOverviewRun(cleanups);
    expect(run.run('slices', 'overview').status).toBe(0);
    const result = run.run('verdicts', 'overview', '--round', '1');
    expect(result.status).toBe(1);
    expect(result.lines.at(-1)).toMatch(/^Next: dispatch the verifier once more for overview for exactly the missing parts: 1a and 1b/);
    expect(stateOf(run).overview.status).toBe('checked');
  });
});

describe('trace and trace-verdicts: the overview', () => {
  it('writes the trace files of a confirmed overview and verifies it when neither tracer finds counter-evidence', () => {
    const run = checkedOverviewRun(cleanups);
    expect(run.run('trace', 'overview').status).toBe(1);
    expect(judge(run, 'overview').status).toBe(0);
    const traced = run.run('trace', 'overview');
    expect(traced.status, traced.stdout).toBe(0);
    expect(traced.lines[0]).toBe('overview: 4 items in 1 part');
    const file = readJsonAt(join(run.out, 'trace', 'overview', 'part-1.json'));
    expect(file.items.map((item) => item.id)).toEqual(ITEMS);
    for (const item of file.items) expect(Object.keys(item)).toEqual(['id', 'claim', 'citations']);
    const result = traceFeature(run, 'overview');
    expect(result.lines).toEqual(['overview: verified (4 items)']);
    expect(stateOf(run).overview).toMatchObject({ status: 'verified', attempts: 0 });
  });

  it('removes an item either tracer contradicted, records it with step trace, and keeps the overview verified', () => {
    const run = checkedOverviewRun(cleanups);
    expect(judge(run, 'overview').status).toBe(0);
    const decide = (item) => (item.id === 'integrations[0]'
      ? { verdict: 'contradicted', reason: 'Another function sends it to a different channel.', at: [{ file: 'src/roles.js', line: 1 }] }
      : 'holds');
    const result = traceFeature(run, 'overview', () => 'holds', () => {}, decide);
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['overview: verified, 1 item removed']);
    const { overview } = stateOf(run);
    expect(overview.status).toBe('verified');
    expect(overview.removed).toHaveLength(1);
    expect(overview.removed[0]).toMatchObject({ path: 'integrations[0]', verdict: 'contradicted', step: 'trace', reasons: ['Another function sends it to a different channel.'] });
    expect(entryOf(run).integrations).toEqual([]);
  });

  it('refuses to trace an overview that is not confirmed and a trace-verdicts call without trace files', () => {
    const run = checkedOverviewRun(cleanups);
    expect(run.run('trace', 'overview').lines[0]).toBe('overview: is checked; only a confirmed feature is traced');
    expect(run.run('trace-verdicts', 'overview').status).toBe(1);
  });
});

describe('state: the overview key is optional', () => {
  it('a state file without the key is read: mark counts attempt 1 from planned, load-run works', () => {
    const run = overviewRun(cleanups);
    expect(Object.hasOwn(stateOf(run), 'overview')).toBe(false);
    expect(run.run('mark', 'overview', 'dispatched').lines).toEqual(['overview: dispatched, attempts 1']);
    expect(stateOf(run).overview).toEqual({ status: 'dispatched', attempts: 1 });
    expect(Object.keys(stateOf(run).features)).toHaveLength(5);
  });

  it('check-map still compares only the features with the map: an overview key does not change that', () => {
    const run = checkedOverviewRun(cleanups);
    const map = clone(run.map);
    map.features = map.features.slice(0, 4);
    map.unassigned = [...map.unassigned, ...run.map.features[4].candidates.map((candidate) => ({ candidate, reason: 'No reader uses it.' }))];
    run.writeMap(map);
    const result = run.run('check-map');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/state\.json lists the features F1, F2, F3, F4, F5 but map\.json has F1, F2, F3, F4/);
  });

  it('refuses a state whose overview entry is malformed', () => {
    const run = checkedOverviewRun(cleanups);
    const state = stateOf(run);
    state.overview = { status: 'nonsense', attempts: 0 };
    run.writeJson(join(run.out, 'state.json'), state);
    const result = run.run('slices', 'overview');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/state\.json: overview needs a status/);
  });

  it('verifyChecked runs the whole chain for the overview and leaves the features alone', () => {
    const run = checkedOverviewRun(cleanups);
    verifyChecked(run, 'overview');
    expect(stateOf(run).overview.status).toBe('verified');
    expect(Object.values(stateOf(run).features).every((feature) => feature.status === 'planned')).toBe(true);
    expect(existsSync(join(run.out, 'trace-verdicts', 'overview', 'part-1.a.json'))).toBe(true);
  });
});
