// `lib/priorities.mjs` and `prd.mjs check-priorities <out>` (openspec change
// prd-report-finding-priority, design D4): the check of one feature's
// priorities file against its findings, the batching, and the command's lines.
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';

import {
  BATCH_MAX, REASON_MAX, priorityCounts, prioritiesPath, rankBatches, rankFeature, readFeatureRanks,
} from '../../../skills/excavator-prd-report/lib/priorities.mjs';
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

const cjk = (...points) => String.fromCodePoint(...points);
const IDS = ['F3-1', 'F3-2'];
const present = (priorities) => ({ ok: true, value: { priorities } });
const good = [rankEntry('F3-1', 'P0'), rankEntry('F3-2', 'P2')];
const check = (read, ids = IDS) => rankFeature('F3', ids, read);

describe('rankFeature: the check of one priorities file against its feature\'s findings', () => {
  it('accepts a file that ranks every finding exactly once, and returns each rank by finding id', () => {
    const result = check(present(good));
    expect(result.problems).toEqual([]);
    expect([...result.ranks]).toEqual([
      ['F3-1', { priority: 'P0', reason: good[0].reason }],
      ['F3-2', { priority: 'P2', reason: good[1].reason }],
    ]);
  });

  it('accepts a feature with no findings whatever its file holds, or lacks', () => {
    for (const read of [{ ok: false, missing: true, reason: 'is missing' }, present([]), present([rankEntry('F3-1', 'P0')]), { ok: false, reason: 'is not valid JSON (x)' }]) {
      const result = check(read, []);
      expect(result.problems).toEqual([]);
      expect(result.ranks.size).toBe(0);
    }
  });

  it('reports a missing file, with its path', () => {
    const result = check({ ok: false, missing: true, reason: 'is missing' });
    expect(result.problems).toEqual([`${prioritiesPath('F3')} is missing`]);
    expect(result.ranks).toBeNull();
  });

  it('reports a file that cannot be parsed, with the reason', () => {
    const result = check({ ok: false, reason: 'is not valid JSON (Unexpected token)' });
    expect(result.problems).toEqual([`${prioritiesPath('F3')} is not valid JSON (Unexpected token)`]);
    expect(result.ranks).toBeNull();
  });

  it('reports a file that is not { "priorities": [ ... ] }', () => {
    for (const value of [[], 'P0', null, { priorities: 'P0' }, { items: [] }]) {
      const result = check({ ok: true, value });
      expect(result.problems[0], JSON.stringify(value)).toBe(`${prioritiesPath('F3')} is not { "priorities": [ ... ] }`);
      expect(result.ranks).toBeNull();
    }
  });

  it('reports a key of the file other than priorities', () => {
    const result = check({ ok: true, value: { priorities: good, note: 'x' } });
    expect(result.problems).toEqual([`${prioritiesPath('F3')} key "note" is not allowed; the file holds priorities`]);
    expect(result.ranks).toBeNull();
  });

  it('reports an entry that is not { id, priority, reason }: a missing key, a non-string id or reason', () => {
    const cases = [
      [{ id: 'F3-1', priority: 'P0' }], [{ id: 'F3-1', reason: 'r' }], [{ priority: 'P0', reason: 'r' }],
      [{ id: 7, priority: 'P0', reason: 'r' }], [{ id: 'F3-1', priority: 'P0', reason: 7 }], ['F3-1'], [null],
    ];
    for (const entries of cases) {
      const result = check(present([...entries, rankEntry('F3-2', 'P1')]));
      expect(result.problems[0], JSON.stringify(entries)).toBe('priorities[0] is not { id, priority, reason }');
      expect(result.ranks).toBeNull();
    }
  });

  it('reports a key of an entry other than id, priority and reason', () => {
    const result = check(present([{ ...good[0], confidence: 'high' }, good[1]]));
    expect(result.problems).toEqual(['F3-1 key "confidence" is not allowed; an entry holds id, priority, reason']);
  });

  it('reports a finding that is not ranked, by its id', () => {
    const result = check(present([good[0]]));
    expect(result.problems).toEqual(['F3-2 has no priority']);
    expect(result.ranks).toBeNull();
  });

  it('reports an id that appears twice', () => {
    const result = check(present([...good, rankEntry('F3-1', 'P1')]));
    expect(result.problems).toEqual(['F3-1 appears twice']);
    expect(result.ranks).toBeNull();
  });

  it('reports an id that is not a finding of the feature', () => {
    const result = check(present([...good, rankEntry('F9-1', 'P1'), rankEntry('F3-3', 'P1')]));
    expect(result.problems).toEqual(['F9-1 is not a finding of F3', 'F3-3 is not a finding of F3']);
    expect(result.ranks).toBeNull();
  });

  it('reports a level other than P0, P1 and P2', () => {
    for (const level of ['P3', 'p0', 'high', 0, null, ['P0']]) {
      const result = check(present([{ ...good[0], priority: level }, good[1]]));
      expect(result.problems, JSON.stringify(level)).toEqual([`F3-1 priority ${JSON.stringify(level)} is not P0, P1 or P2`]);
    }
  });

  it('reports an empty reason, a blank one included', () => {
    for (const reason of ['', '   ', '\n']) {
      const result = check(present([{ ...good[0], reason }, good[1]]));
      expect(result.problems, JSON.stringify(reason)).toEqual(['F3-1 reason is empty']);
    }
  });

  it('reports a reason over 300 characters, and accepts exactly 300', () => {
    expect(REASON_MAX).toBe(300);
    const over = check(present([{ ...good[0], reason: 'a'.repeat(301) }, good[1]]));
    expect(over.problems).toEqual(['F3-1 reason is 301 characters, over 300']);
    expect(check(present([{ ...good[0], reason: 'a'.repeat(300) }, good[1]])).problems).toEqual([]);
    // A character is a code point: 300 astral characters are 600 UTF-16 units and still pass.
    expect(check(present([{ ...good[0], reason: cjk(0x1f600).repeat(300) }, good[1]])).problems).toEqual([]);
  });

  it('reports an English advice word in the reason', () => {
    const result = check(present([{ ...good[0], reason: 'The route should check the amount; every payer is affected.' }, good[1]]));
    expect(result.problems).toEqual(['F3-1 reason gives advice ("should"); say which criterion the evidence meets and who is affected']);
    expect(result.ranks).toBeNull();
  });

  it('reports a Chinese advice word in the reason', () => {
    const word = cjk(0x5e94, 0x8be5);
    const result = check(present([{ ...good[0], reason: `The route ${word} check the amount.` }, good[1]]));
    expect(result.problems).toEqual([`F3-1 reason gives advice (${JSON.stringify(word)}); say which criterion the evidence meets and who is affected`]);
  });

  it('lists every problem it finds, in the file\'s order and then the findings\' order', () => {
    const result = check(present([rankEntry('F9-1', 'P0'), { ...good[0], priority: 'P5' }]), ['F3-1', 'F3-2', 'F3-3']);
    expect(result.problems).toEqual(['F9-1 is not a finding of F3', 'F3-1 priority "P5" is not P0, P1 or P2', 'F3-2 has no priority', 'F3-3 has no priority']);
  });
});

describe('readFeatureRanks', () => {
  it('reads priorities/<id>.json under <out>: missing, not JSON, and valid', () => {
    const run = laneRun();
    const findings = [{ id: 'F1-1' }];
    expect(readFeatureRanks(run.out, 'F1', findings).problems).toEqual(['priorities/F1.json is missing']);
    rmSync(join(run.out, 'priorities'), { recursive: true, force: true });
    writeRanks(run, 'F1', [rankEntry('F1-1', 'P1')]);
    writeFileSync(join(run.out, 'priorities/F2.json'), '{ not json');
    expect(readFeatureRanks(run.out, 'F2', [{ id: 'F2-1' }]).problems[0]).toMatch(/^priorities\/F2\.json is not valid JSON/);
    const ok = readFeatureRanks(run.out, 'F1', findings);
    expect(ok.problems).toEqual([]);
    expect(ok.ranks.get('F1-1').priority).toBe('P1');
  });
});

describe('priorityCounts', () => {
  it('counts the findings by level, unranked when there is no rank or no ranks at all', () => {
    const findings = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const ranks = new Map([['a', { priority: 'P0', reason: 'r' }], ['b', { priority: 'P2', reason: 'r' }], ['c', { priority: 'P2', reason: 'r' }]]);
    expect(priorityCounts(findings, ranks)).toEqual({ P0: 1, P1: 0, P2: 2, unranked: 1 });
    expect(priorityCounts(findings, null)).toEqual({ P0: 0, P1: 0, P2: 0, unranked: 4 });
    expect(Object.keys(priorityCounts([], null))).toEqual(['P0', 'P1', 'P2', 'unranked']);
  });
});

describe('rankBatches: features in chapter order, at most 120 findings to a batch', () => {
  const batches = (...counts) => rankBatches(counts.map((findings, at) => ({ id: `F${at + 1}`, findings })));

  it('packs features in order up to the limit and starts a batch where the next would pass it', () => {
    expect(BATCH_MAX).toBe(120);
    expect(batches(100, 20, 1)).toEqual([['F1', 'F2'], ['F3']]);
    expect(batches(100, 21)).toEqual([['F1'], ['F2']]);
    expect(batches(10, 10, 10)).toEqual([['F1', 'F2', 'F3']]);
  });

  it('gives a feature of more than 120 findings a batch of its own, whatever is next to it', () => {
    expect(batches(121, 1, 1)).toEqual([['F1'], ['F2', 'F3']]);
    expect(batches(1, 121, 1)).toEqual([['F1'], ['F2'], ['F3']]);
    expect(batches(120, 1)).toEqual([['F1'], ['F2']]);
  });

  it('gives no batch when nothing needs ranking', () => {
    expect(rankBatches([])).toEqual([]);
  });
});

describe('prd.mjs check-priorities', () => {
  const lines = (out) => out.stdout.split('\n').slice(0, -1);
  const run_ = (run) => runPrd(['check-priorities', run.out, '--project', run.project]);

  it('prints one ranked line per feature and the totals, exit 0, when every file passes', () => {
    const run = laneRun();
    writeRanks(run, 'F1', [rankEntry('F1-1', 'P1')]);
    writeRanks(run, 'F2', [rankEntry('F2-1', 'P0')]);
    const out = run_(run);
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(lines(out)).toEqual(['F1: ranked', 'F2: ranked', 'Rank: 2 features ranked, 0 unranked']);
  });

  it('prints each problem of a feature on its own line, then the batch of the features to rank, exit 1', () => {
    const run = laneRun();
    writeRanks(run, 'F1', [rankEntry('F1-1', 'P1')]);
    const out = run_(run);
    expect(out.status).toBe(1);
    expect(lines(out)).toEqual(['F1: ranked', 'F2: priorities/F2.json is missing', 'batch 1: F2', 'Rank: 1 features ranked, 1 unranked']);

    writeRanks(run, 'F2', [rankEntry('F2-1', 'P3'), rankEntry('F9-1', 'P0')]);
    const second = run_(run);
    expect(second.status).toBe(1);
    expect(lines(second)).toEqual([
      'F1: ranked',
      'F2: F2-1 priority "P3" is not P0, P1 or P2',
      'F2: F9-1 is not a finding of F2',
      'batch 1: F2',
      'Rank: 1 features ranked, 1 unranked',
    ]);
  });

  it('names the finding a file leaves out', () => {
    const run = laneRun();
    writeLaneFindings(run, 'F2', 3);
    writeRanks(run, 'F2', [rankEntry('F2-1', 'P0'), rankEntry('F2-3', 'P2')]);
    writeRanks(run, 'F1', [rankEntry('F1-1', 'P2')]);
    const out = run_(run);
    expect(out.status).toBe(1);
    expect(lines(out)).toContain('F2: F2-2 has no priority');
  });

  it('reports a file that is not JSON as a problem of its feature', () => {
    const run = laneRun();
    writeRanks(run, 'F1', [rankEntry('F1-1', 'P1')]);
    writeRanks(run, 'F2', []);
    writeFileSync(join(run.out, 'priorities/F2.json'), '{ not json');
    const out = run_(run);
    expect(out.status).toBe(1);
    expect(lines(out)[1]).toMatch(/^F2: priorities\/F2\.json is not valid JSON/);
  });

  it('counts a feature with no findings as ranked, without a file, and lists none of the features that are not written', () => {
    const run = laneRun();
    addWrittenFeature(run, 'F3', 0);
    const index = run.readIndex();
    index.candidates.items.push({ id: 'c4', kind: 'job', file: 'src/orders/service.js', line: 15, text: 'function reopenOrder(order) {', framework: 'custom', provenance: 'inferred' });
    index.features.push({ id: 'F4', name: 'Not written', kind: 'automated', chapter: 4, entrypoints: ['c4'], seedFiles: ['src/orders/service.js'], tiers: ['backend'] });
    run.writeIndex(index);
    writeRanks(run, 'F1', [rankEntry('F1-1', 'P1')]);
    writeRanks(run, 'F2', [rankEntry('F2-1', 'P0')]);
    const out = run_(run);
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(lines(out)).toEqual(['F1: ranked', 'F2: ranked', 'F3: ranked', 'Rank: 3 features ranked, 0 unranked']);
  });

  it('batches the features to rank in chapter order, at most 120 findings to a batch', () => {
    const run = laneRun();
    writeLaneFindings(run, 'F1', 100);
    writeLaneFindings(run, 'F2', 20);
    addWrittenFeature(run, 'F3', 1);
    const out = run_(run);
    expect(out.status).toBe(1);
    expect(lines(out).filter((line) => line.startsWith('batch') || line.startsWith('Rank'))).toEqual(['batch 1: F1 F2', 'batch 2: F3', 'Rank: 0 features ranked, 3 unranked']);
  });

  it('gives a feature of more than 120 findings a batch of its own', () => {
    const run = laneRun();
    writeLaneFindings(run, 'F2', 121);
    addWrittenFeature(run, 'F3', 1);
    const out = run_(run);
    expect(out.status).toBe(1);
    expect(lines(out).filter((line) => line.startsWith('batch'))).toEqual(['batch 1: F1', 'batch 2: F2', 'batch 3: F3']);
  });

  it('batches only the features still to rank', () => {
    const run = laneRun();
    writeLaneFindings(run, 'F1', 5);
    writeRanks(run, 'F1', [1, 2, 3, 4, 5].map((k) => rankEntry(`F1-${k}`, 'P2')));
    addWrittenFeature(run, 'F3', 1);
    const out = run_(run);
    expect(lines(out).filter((line) => line.startsWith('batch'))).toEqual(['batch 1: F2 F3']);
  });

  it('writes nothing', () => {
    const run = laneRun();
    writeRanks(run, 'F1', [rankEntry('F1-1', 'P1')]);
    const before = run.readText('index.json');
    run_(run);
    expect(run.readText('index.json')).toBe(before);
    expect(runPrd(['check-priorities', run.out, '--project', run.project]).stderr).toBe('');
  });

  it('refuses a project that is not the index\'s, like the other commands, and needs --project', () => {
    const run = laneRun();
    const wrong = runPrd(['check-priorities', run.out, '--project', run.root]);
    expect(wrong.status).toBe(1);
    expect(wrong.stdout).toMatch(/projectRoot .* is not the project given with --project/);
    const none = runPrd(['check-priorities', run.out]);
    expect(none.status).toBe(2);
    expect(none.stderr).toMatch(/--project/);
    expect(runPrd(['check-priorities', join(run.root, 'nowhere'), '--project', run.project]).status).toBe(2);
  });
});
