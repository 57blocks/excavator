// scripts/review-eval/score.mjs (openspec change review-eval, design D4,
// oracle O1). Synthetic cases and results in a throwaway directory.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/review-eval/score.mjs');

let dir;
let results;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'review-eval-'));
  results = join(dir, 'results');
  mkdirSync(results);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function span(path, start, end = start) {
  return { path, start, end };
}

function defect(id, ...spans) {
  return { id, spans };
}

function finding(severity, path, line) {
  return { severity, path, line, title: 't', body: 'b' };
}

function score(cases, outputs) {
  writeFileSync(join(dir, 'cases.json'), JSON.stringify({ cases }));
  for (const [id, text] of Object.entries(outputs)) {
    writeFileSync(join(results, `${id}.json`), typeof text === 'string' ? text : JSON.stringify(text));
  }
  return spawnSync(process.execPath, [SCRIPT, join(dir, 'cases.json'), results], { encoding: 'utf-8' });
}

// The bucket each defect lands in, by defect id.
function buckets(result) {
  const found = {};
  for (const line of result.stdout.split('\n')) {
    const match = /^ {2}(hit|wrong severity|missed|not scored)\s+(\S+)$/.exec(line);
    if (match) found[match[2]] = match[1];
  }
  return found;
}

function total(result, label) {
  return result.stdout.split('\n').find((line) => line.startsWith(`${label}: `));
}

const ONE = [{ id: 'c1', range: 'a^..a', defects: [defect('d1', span('src/a.mjs', 10, 12))] }];

describe('a defect is hit by an Important finding on its lines', () => {
  it('counts a finding inside the span', () => {
    const result = score(ONE, { c1: [finding('Important', 'src/a.mjs', 11)] });
    expect(result.status).toBe(0);
    expect(buckets(result)).toEqual({ d1: 'hit' });
    expect(total(result, 'recall')).toBe('recall: 1/1 defects hit');
  });

  it('counts a finding three lines outside the span, on either side', () => {
    expect(buckets(score(ONE, { c1: [finding('Important', 'src/a.mjs', 7)] }))).toEqual({ d1: 'hit' });
    expect(buckets(score(ONE, { c1: [finding('Important', 'src/a.mjs', 15)] }))).toEqual({ d1: 'hit' });
  });

  it('misses a finding four lines outside the span', () => {
    expect(buckets(score(ONE, { c1: [finding('Important', 'src/a.mjs', 6)] }))).toEqual({ d1: 'missed' });
    expect(buckets(score(ONE, { c1: [finding('Important', 'src/a.mjs', 16)] }))).toEqual({ d1: 'missed' });
  });

  it('misses a finding on another path', () => {
    const result = score(ONE, { c1: [finding('Important', 'src/b.mjs', 11)] });
    expect(buckets(result)).toEqual({ d1: 'missed' });
    expect(total(result, 'defect cases')).toBe('defect cases: Important on no known defect 1');
  });

  it('counts a finding on the second span of a defect', () => {
    const cases = [{ id: 'c1', range: 'a^..a', defects: [defect('d1', span('src/a.mjs', 10), span('ci.yml', 40, 44))] }];
    expect(buckets(score(cases, { c1: [finding('Important', 'ci.yml', 42)] }))).toEqual({ d1: 'hit' });
  });
});

describe('a finding at another severity is not a hit', () => {
  it('puts a Nit on the defect lines in the wrong-severity bucket', () => {
    const result = score(ONE, { c1: [finding('Nit', 'src/a.mjs', 11)] });
    expect(buckets(result)).toEqual({ d1: 'wrong severity' });
    expect(total(result, 'recall')).toBe('recall: 0/1 defects hit');
  });

  it('puts a Pre-existing finding there too, and a far Nit nowhere', () => {
    expect(buckets(score(ONE, { c1: [finding('Pre-existing', 'src/a.mjs', 13)] }))).toEqual({ d1: 'wrong severity' });
    expect(buckets(score(ONE, { c1: [finding('Nit', 'src/a.mjs', 30)] }))).toEqual({ d1: 'missed' });
  });
});

describe('each finding counts for one defect at most', () => {
  const TWO = [{
    id: 'c1',
    range: 'a^..a',
    defects: [defect('d1', span('src/a.mjs', 10, 12)), defect('d2', span('src/a.mjs', 15, 16))],
  }];

  it('scores a case where one of two defects is hit', () => {
    const result = score(TWO, { c1: [finding('Important', 'src/a.mjs', 10)] });
    expect(buckets(result)).toEqual({ d1: 'hit', d2: 'missed' });
    expect(total(result, 'recall')).toBe('recall: 1/2 defects hit');
  });

  it('gives a finding in the overlap to the nearer defect only', () => {
    const result = score(TWO, { c1: [finding('Important', 'src/a.mjs', 14)] });
    expect(buckets(result)).toEqual({ d1: 'missed', d2: 'hit' });
  });

  it('breaks a tie towards the earlier defect', () => {
    const cases = [{
      id: 'c1',
      range: 'a^..a',
      defects: [defect('d1', span('src/a.mjs', 10, 12)), defect('d2', span('src/a.mjs', 14, 16))],
    }];
    expect(buckets(score(cases, { c1: [finding('Important', 'src/a.mjs', 13)] }))).toEqual({ d1: 'hit', d2: 'missed' });
  });

  it('hits both defects with two findings in the overlap', () => {
    const result = score(TWO, { c1: [finding('Important', 'src/a.mjs', 14), finding('Important', 'src/a.mjs', 13)] });
    expect(buckets(result)).toEqual({ d1: 'hit', d2: 'hit' });
    expect(total(result, 'defect cases')).toBe('defect cases: Important on no known defect 0');
  });
});

describe('clean cases', () => {
  it('counts the Important and Nit findings on them', () => {
    const cases = [...ONE, { id: 'k1', range: 'b^..b', defects: [] }, { id: 'k2', range: 'c^..c', defects: [] }];
    const result = score(cases, {
      c1: [finding('Important', 'src/a.mjs', 11), finding('Important', 'src/z.mjs', 1)],
      k1: [finding('Important', 'x.mjs', 1), finding('Nit', 'x.mjs', 2), finding('Pre-existing', 'x.mjs', 3)],
      k2: [finding('Nit', 'y.mjs', 2)],
    });
    expect(result.status).toBe(0);
    expect(total(result, 'clean cases')).toBe('clean cases: Important 1, Nit 2');
    expect(total(result, 'defect cases')).toBe('defect cases: Important on no known defect 1');
  });
});

describe('a partial run is not a score', () => {
  const CASES = [...ONE, { id: 'k1', range: 'b^..b', defects: [] }];

  it('exits 0 when every case was run and read', () => {
    expect(score(CASES, { c1: [], k1: [] }).status).toBe(0);
  });

  it('lists a case with no result file as not run, and exits 1', () => {
    const result = score(CASES, { k1: [] });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('c1  not run');
    expect(buckets(result)).toEqual({ d1: 'not scored' });
    expect(total(result, 'cases')).toBe('cases: 2, not run 1, unreadable 0');
  });

  it.each([
    ['not JSON', 'Important src/a.mjs:11'],
    ['not an array', { findings: [] }],
    ['a finding without a line', [{ severity: 'Important', path: 'src/a.mjs', title: 't', body: 'b' }]],
    ['an unknown severity', [finding('Critical', 'src/a.mjs', 11)]],
  ])('lists a result that is %s as unreadable, and exits 1', (_, output) => {
    const result = score(CASES, { c1: output, k1: [] });
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^c1 {2}unreadable: /m);
    expect(total(result, 'cases')).toBe('cases: 2, not run 0, unreadable 1');
  });
});

describe('invalid input', () => {
  it.each([
    ['a case id with a path separator', [{ id: '../c1', range: 'a^..a', defects: [] }]],
    ['a repeated id', [{ id: 'c1', range: 'a^..a', defects: [] }, { id: 'c1', range: 'b^..b', defects: [] }]],
    ['a span that ends before it starts', [{ id: 'c1', range: 'a^..a', defects: [defect('d1', span('a', 5, 4))] }]],
    ['a defect with no spans', [{ id: 'c1', range: 'a^..a', defects: [defect('d1')] }]],
  ])('exits 2 on %s', (_, cases) => {
    expect(score(cases, {}).status).toBe(2);
  });
});
