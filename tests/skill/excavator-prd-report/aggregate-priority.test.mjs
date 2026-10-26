// `prd.mjs aggregate` with priorities (openspec change
// prd-report-finding-priority, design D5): a valid file's levels are merged
// into findings.json, the findings are ordered by level, feature and number,
// the levels are counted per feature and in all, and the counts must add up.
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { addWrittenFeature, makeLaneRun, rankEntry, runPrd, writeLaneFindings, writeRanks } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
function laneRun() {
  const run = makeLaneRun();
  cleanups.push(run.cleanup);
  return run;
}
const aggregateOk = (run) => {
  const out = runPrd(['aggregate', run.out, '--project', run.project]);
  expect(out.status, out.stdout + out.stderr).toBe(0);
  return out.json;
};
const sha = (text) => createHash('sha256').update(text).digest('hex');
const stringify = (value) => `${JSON.stringify(value, null, 2)}\n`;
const ids = (run) => run.readJson('findings.json').findings.map((finding) => finding.id);

/** The `aggregate` of commit 5a63f6bc (before priorities) on the lane fixture, as digests: the findings, tables and index it wrote. */
const BEFORE = {
  findings: '27cfbc230d97faca509fb5e9c718a790e6d15669a16866f883cc8500f33a7c7e',
  index: '62109e3c2305dbd76ce8e4d21d5d7b80868284577ad51d063bfdad6c89dfce91',
  tables: {
    'tables/coverage.md': 'c4e6573262f40f95939399c3c423aabe469ece1ab07af9c4b80bf5ddb5d0892f',
    'tables/roles-by-feature.md': 'b698bcbc0e2da8dc62a1e0de37e7c86c7e97ecc5069f76a4e35d9e6fd75239ed',
    'tables/verification.md': '4cd3c3215415cdd9795900aa29a9a578e57b5af12d8c696f35891ad20531441d',
  },
  lanes: {
    'findings/F1.json': 'b7da15908dc5067a3c42ff627f91e2520c6e02de9c9a868586dd5e27e2c2fd00',
    'findings/F2.json': '13690a115ab07d94a511a8771de6b96997ffe3377a21ebe208e51478f8b326f2',
  },
};

describe('aggregate with no priorities file (O2: nothing else changes)', () => {
  it('gives the findings of before, each only with priority and priorityReason null added', () => {
    const run = laneRun();
    aggregateOk(run);
    const stored = run.readJson('findings.json');
    expect(stored.findings.map((finding) => [finding.id, finding.priority, finding.priorityReason])).toEqual([['F1-1', null, null], ['F2-1', null, null]]);
    const stripped = { ...stored, findings: stored.findings.map(({ priority, priorityReason, ...rest }) => rest) };
    expect(sha(stringify(stripped))).toBe(BEFORE.findings);
    for (const finding of stored.findings) expect(Object.keys(finding).slice(-4)).toEqual(['feature', 'verdict', 'priority', 'priorityReason']);
  });

  it('writes the three tables byte for byte as before', () => {
    const run = laneRun();
    aggregateOk(run);
    for (const [rel, digest] of Object.entries(BEFORE.tables)) expect(sha(run.readText(rel)), rel).toBe(digest);
  });

  it('writes the lane findings files back as before', () => {
    const run = laneRun();
    aggregateOk(run);
    for (const [rel, digest] of Object.entries(BEFORE.lanes)) expect(sha(run.readText(rel)), rel).toBe(digest);
  });

  it('writes index.json as before, with only the priority counts of each feature added', () => {
    const run = laneRun();
    aggregateOk(run);
    const index = run.readIndex();
    expect(index.features.map((feature) => feature.counts.findings.priority)).toEqual([
      { P0: 0, P1: 0, P2: 0, unranked: 1 },
      { P0: 0, P1: 0, P2: 0, unranked: 1 },
    ]);
    for (const feature of index.features) delete feature.counts.findings.priority;
    expect(sha(stringify({ ...index, projectRoot: '__ROOT__' }))).toBe(BEFORE.index);
  });

  it('keeps the printed fields of before and adds the four totals under findings', () => {
    const run = laneRun();
    const printed = aggregateOk(run);
    expect(printed.findings).toEqual({ product: 1, technical: 1, priority: { P0: 0, P1: 0, P2: 0, unranked: 2 } });
    expect(Object.keys(printed.findings.priority)).toEqual(['P0', 'P1', 'P2', 'unranked']);
  });
});

describe('aggregate with priorities (O4: order and conservation)', () => {
  /** F1 and F2 with three findings each, F1 ranked [P2, P0, P1] and F2 ranked [P1, P2, P0]. */
  function mixedRun() {
    const run = laneRun();
    writeLaneFindings(run, 'F1', 3);
    writeLaneFindings(run, 'F2', 3);
    writeRanks(run, 'F1', [rankEntry('F1-1', 'P2', 'Fixed value in code.'), rankEntry('F1-2', 'P0', 'Lets an outsider read orders.'), rankEntry('F1-3', 'P1', 'Hides a failure from users.')]);
    writeRanks(run, 'F2', [rankEntry('F2-1', 'P1', 'Wrong result in a used flow.'), rankEntry('F2-2', 'P2', 'Duplicated code.'), rankEntry('F2-3', 'P0', 'Corrupts stored data.')]);
    return run;
  }

  it('orders the findings by level, then by feature position, then by number, and merges level and reason', () => {
    const run = mixedRun();
    aggregateOk(run);
    expect(ids(run)).toEqual(['F1-2', 'F2-3', 'F1-3', 'F2-1', 'F1-1', 'F2-2']);
    const stored = run.readJson('findings.json').findings;
    expect(stored[0]).toMatchObject({ id: 'F1-2', feature: 'F1', priority: 'P0', priorityReason: 'Lets an outsider read orders.' });
    expect(stored[3]).toMatchObject({ id: 'F2-1', priority: 'P1', priorityReason: 'Wrong result in a used flow.' });
  });

  it('breaks a tie of level by the feature\'s position in index.json, not by its chapter or id', () => {
    const run = mixedRun();
    const index = run.readIndex();
    index.features.reverse();
    index.features[0].chapter = 5;
    run.writeIndex(index);
    run.writeText('features/F2.md', run.readText('features/F2.md').replace('chapter: 2', 'chapter: 5'));
    aggregateOk(run);
    expect(ids(run)).toEqual(['F2-3', 'F1-2', 'F2-1', 'F1-3', 'F2-2', 'F1-1']);
  });

  it('orders the finding ids by number, not as text, whatever the order of the lane file', () => {
    const run = laneRun();
    writeLaneFindings(run, 'F1', 11, { descending: true });
    writeRanks(run, 'F1', Array.from({ length: 11 }, (_, k) => rankEntry(`F1-${k + 1}`, 'P1')));
    aggregateOk(run);
    expect(ids(run).filter((id) => id.startsWith('F1'))).toEqual(Array.from({ length: 11 }, (_, k) => `F1-${k + 1}`));
  });

  it('lists the findings of a feature whose file does not pass last, as unranked with null, whatever its position', () => {
    const run = mixedRun();
    writeRanks(run, 'F1', [rankEntry('F1-1', 'P0')]);
    const printed = aggregateOk(run);
    expect(ids(run)).toEqual(['F2-3', 'F2-1', 'F2-2', 'F1-1', 'F1-2', 'F1-3']);
    const stored = run.readJson('findings.json').findings;
    expect(stored.slice(3).map((finding) => [finding.priority, finding.priorityReason])).toEqual([[null, null], [null, null], [null, null]]);
    expect(printed.findings.priority).toEqual({ P0: 1, P1: 1, P2: 1, unranked: 3 });
  });

  it('treats a missing or unparsable file as unranked, and a feature with no findings as nothing to rank', () => {
    const run = mixedRun();
    rmSync(join(run.out, 'priorities/F1.json'));
    writeFileSync(join(run.out, 'priorities/F2.json'), '{ not json');
    expect(aggregateOk(run).findings.priority).toEqual({ P0: 0, P1: 0, P2: 0, unranked: 6 });
    expect(ids(run)).toEqual(['F1-1', 'F1-2', 'F1-3', 'F2-1', 'F2-2', 'F2-3']);
    addWrittenFeature(run, 'F3', 0);
    expect(aggregateOk(run).findings.priority.unranked).toBe(6);
  });

  it('counts the levels of each feature in index.json and of all features in the printed fields, and each adds up to the findings', () => {
    const run = mixedRun();
    const printed = aggregateOk(run);
    const features = run.readIndex().features;
    expect(features.map((feature) => feature.counts.findings)).toEqual([
      { product: 1, technical: 2, priority: { P0: 1, P1: 1, P2: 1, unranked: 0 } },
      { product: 1, technical: 2, priority: { P0: 1, P1: 1, P2: 1, unranked: 0 } },
    ]);
    expect(printed.findings).toEqual({ product: 2, technical: 4, priority: { P0: 2, P1: 2, P2: 2, unranked: 0 } });
    const sum = (counts) => counts.P0 + counts.P1 + counts.P2 + counts.unranked;
    for (const feature of features) expect(sum(feature.counts.findings.priority)).toBe(feature.counts.findings.product + feature.counts.findings.technical);
    expect(sum(printed.findings.priority)).toBe(run.readJson('findings.json').findings.length);
  });

  it('counts the findings of a feature that is not written as unranked, so each feature still adds up', () => {
    const run = mixedRun();
    run.writeText('features/F2.md', run.readText('features/F2.md').replace(/```mermaid[\s\S]*?```\n/, ''));
    const printed = aggregateOk(run);
    const f2 = run.readIndex().features[1];
    expect(f2.status).toBe('failed');
    expect(f2.counts.findings).toEqual({ product: 1, technical: 2, priority: { P0: 0, P1: 0, P2: 0, unranked: 3 } });
    expect(printed.findings).toEqual({ product: 1, technical: 2, priority: { P0: 1, P1: 1, P2: 1, unranked: 0 } });
  });

  it('runs again to the same files', () => {
    const run = mixedRun();
    aggregateOk(run);
    const first = [run.readText('findings.json'), run.readText('index.json')];
    aggregateOk(run);
    expect([run.readText('findings.json'), run.readText('index.json')]).toEqual(first);
  });
});
