// openspec change handbook-process-review, task 2.1: `review compare-facts` computes the comparison candidates
// from the artifacts of an output directory, in five sources, and records a source whose artifact is missing as not
// computed instead of as empty.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { compareBatches } from '../../../skills/excavator-product-handbook/lib/review-compare.mjs';
import { rebindBatchFiles } from '../../../skills/excavator-product-handbook/lib/review-candidate-rebind.mjs';
import { runHandbook } from './helpers.mjs';

const bases = [];
afterEach(() => {
  while (bases.length > 0) rmSync(bases.pop(), { recursive: true, force: true });
});

const put = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof text === 'string' ? text : `${JSON.stringify(text, null, 2)}\n`);
};
const c = (spec) => `\`${spec}\``;

function chapter(title, lines, problems = 'None.') {
  return `# ${title}\n\n## Operations\n\n${lines.map((line) => `- ${line}`).join('\n')}\n\n## Known defects\n\n${problems}\n`;
}

/**
 * A project with two application roots (apps/old, apps/new) and a run whose map has F1..F4 in areas A1 (F1, F2)
 * and A2 (F3, F4): F1 has routes in both applications, F2 has two routes in one (titled New and Old).
 */
function make({ topics, skip = [] } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'xhb-cmp-')));
  bases.push(base);
  const root = join(base, 'project');
  const out = join(base, 'out');
  for (const app of ['old', 'new']) {
    put(join(root, 'apps', app, 'package.json'), '{}');
    put(join(root, 'apps', app, 'a.js'), 'x\n'.repeat(20));
  }
  put(join(root, 'apps', 'new', 'b.js'), 'x\n'.repeat(20));
  const item = (id, file) => ({ id, kind: 'route', file, line: 1 });
  put(join(out, 'candidates.json'), { format: 'x', items: [item('r1', 'apps/old/a.js'), item('r2', 'apps/new/a.js'), item('r3', 'apps/new/a.js'), item('r4', 'apps/new/b.js'), { id: 'j1', kind: 'job', file: 'apps/old/a.js', line: 2 }] });
  const feature = (id, area, candidates) => ({ id, name: id, area, candidates });
  put(join(out, 'map.json'), {
    language: 'English',
    areas: [{ id: 'A1', name: 'One' }, { id: 'A2', name: 'Two' }],
    features: [feature('F1', 'A1', ['r1', 'r2', 'r3', 'j1']), feature('F2', 'A1', ['r3', 'r4']), feature('F3', 'A2', []), feature('F4', 'A2', [])],
  });
  const chapters = {
    F1: chapter('F1', [`New approval ${c('apps/old/a.js:1-3')}`, `Old approval ${c('apps/new/a.js:10-12')}`], `- **x** **y** Problem text ${c('apps/old/a.js:9')}`),
    F2: chapter('F2', [`New approval ${c('apps/new/b.js:1-3')}`, `Old approval ${c('apps/new/b.js:4-6')}`]),
    F3: chapter('F3', [`Shared ${c('apps/new/a.js:2-4')}`, `Cross ${c('apps/new/c.js:1-3')}`]),
    F4: chapter('F4', [`Shared ${c('apps/new/a.js:3-5')}`, `Other ${c('apps/new/b.js:7')}`]),
  };
  for (const [id, text] of Object.entries(chapters)) put(join(out, 'chapters', `${id}.md`), text);
  put(join(out, 'dictionaries.json'), {
    dictionaries: [
      { id: 'apps/old/a.js:Status', line: 1, members: [{ file: 'apps/old/a.js', line: 2 }] },
      { id: 'apps/new/zzz.js:Status', line: 1, members: [{ file: 'apps/new/zzz.js', line: 2 }] },
      { id: 'apps/old/a.js:Kind', line: 15, members: [{ file: 'apps/old/a.js', line: 16 }] },
      { id: 'apps/new/r.js:Kind', line: 1, members: [] },
    ],
    mismatches: [
      { key: 'status', left: { id: 'apps/old/a.js:Status', application: 'apps/old', name: 'Status' }, right: { id: 'apps/new/zzz.js:Status', application: 'apps/new', name: 'Status' }, onlyLeft: [{ value: 'a' }, { value: 'b' }], onlyRight: [{ value: 'c' }] },
      { key: 'kind', left: { id: 'apps/old/a.js:Kind', application: 'apps/old', name: 'Kind' }, right: { id: 'apps/new/r.js:Kind', application: 'apps/new', name: 'Kind' }, onlyLeft: [], onlyRight: [{ value: 1 }] },
    ],
  });
  put(join(out, 'data.json'), {
    tables: [
      { name: 'orders', mentions: { 'apps/old': [{ file: 'apps/old/a.js', line: 1, rule: 'a' }], 'apps/new': [{ file: 'apps/new/b.js', line: 2, rule: 'a' }, { file: 'apps/new/b.js', line: 3, rule: 'a' }] } },
      { name: 'noapp', mentions: { '': [{ file: 'apps/new/a.js', line: 1, rule: 'a' }], 'apps/new': [{ file: 'apps/new/a.js', line: 2, rule: 'a' }] } },
      { name: 'solo', mentions: { 'apps/new': [{ file: 'apps/new/a.js', line: 1, rule: 'a' }] } },
      { name: 'none', mentions: { 'apps/x': [{ file: 'nowhere.js', line: 1, rule: 'a' }], 'apps/y': [{ file: 'nowhere2.js', line: 1, rule: 'a' }] } },
    ],
  });
  put(join(out, 'chapters', 'topics.md'), topics ?? [
    '# Topics', '', '## Shared rules', '', '### Approvals', '',
    '| Topic | Features |', '| --- | --- |',
    `| Approval rule | Orders (F1), Archive (F2) ${c('apps/old/a.js:1-3')} |`,
    '| Single | Orders (F1) |',
    `| Repeated problem | Orders (F1), Admin (F4) ${c('apps/old/a.js:9')} |`,
    '', '- Free list item naming (F3) and (F4)', '',
  ].join('\n'));
  // Pair F3/F4 across batches: both cite apps/new/a.js lines 3-4 (A2, same batch) and F1 cites 1-3 only; F2/F3 cross.
  put(join(out, 'chapters', 'F2.md'), chapter('F2', [`New approval ${c('apps/new/b.js:1-3')}`, `Old approval ${c('apps/new/b.js:4-6')}`, `Cross ${c('apps/new/c.js:2')}`]));
  const result = (...args) => runHandbook(['review', 'compare-facts', out, '--project', root, ...args]);
  return { base, root, out, result, read: () => JSON.parse(readFileSync(join(out, 'entries', 'review-compare.json'), 'utf-8')) };
}

describe('review compare-facts', () => {
  it('writes the file with sources in order, ids across sources and a stable shape', () => {
    const run = make();
    const result = run.result();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const file = run.read();
    expect(file.format).toBe('excavator-product-handbook-review-compare/1');
    expect(file.sources.map((entry) => entry.source)).toEqual(['dual', 'dict', 'table', 'topic', 'code']);
    expect(file.sources.every((entry) => entry.computed === true)).toBe(true);
    expect(file.candidates.map((entry) => entry.id)).toEqual(file.candidates.map((_, at) => `X${at + 1}`));
    expect(file.candidates.map((entry) => entry.source)).toEqual(['dual', 'dict', 'dict', 'table', 'table', 'topic', 'topic', 'code']);
    expect(result.lines.slice(0, 6)).toEqual(['SOURCE dual 1', 'SOURCE dict 2', 'SOURCE table 2', 'SOURCE topic 2', 'SKIPPED topic 1 lines rest only on problems lines', 'SOURCE code 1']);
    expect(result.lines.filter((line) => line.startsWith('SKIPPED'))).toEqual(['SKIPPED topic 1 lines rest only on problems lines']);
    expect(result.lines.filter((line) => line.startsWith('CANDIDATE')).every((line) => line.length < 220 && !line.includes('\t') && !/[\t\n]/.test(line))).toBe(true);
  });

  it('a feature with routes in two applications is a dual candidate; two operations titled new and old in one application are not', () => {
    const run = make();
    run.result();
    const dual = run.read().candidates.filter((entry) => entry.source === 'dual');
    expect(dual).toEqual([{ id: 'X1', source: 'dual', features: ['F1'], batch: 'b1', facts: { applications: [{ application: 'apps/new', routes: 2 }, { application: 'apps/old', routes: 1 }] }, places: [{ file: 'apps/old/a.js', a: 1, b: 1 }, { file: 'apps/new/a.js', a: 1, b: 1 }] }]);
  });

  it('dict and table candidates find their features through chapter citations; none cited gives an empty list', () => {
    const run = make();
    const result = run.result();
    const by = Object.fromEntries(run.read().candidates.filter((entry) => ['dict', 'table'].includes(entry.source)).map((entry) => [entry.facts.key ?? entry.facts.table, entry]));
    expect(by.status.features).toEqual(['F1']);
    expect(by.status.batch).toBe('c-data-1');
    expect(by.status.places).toEqual([{ file: 'apps/old/a.js', a: 1, b: 1 }, { file: 'apps/old/a.js', a: 2, b: 2 }, { file: 'apps/new/zzz.js', a: 1, b: 1 }, { file: 'apps/new/zzz.js', a: 2, b: 2 }]);
    expect(by.orders.places).toEqual([{ file: 'apps/old/a.js', a: 1, b: 1 }, { file: 'apps/new/b.js', a: 2, b: 2 }, { file: 'apps/new/b.js', a: 3, b: 3 }]);
    expect(by.status.facts).toEqual({ key: 'status', left: { application: 'apps/old', name: 'Status' }, right: { application: 'apps/new', name: 'Status' }, onlyLeft: { count: 2, values: ['a', 'b'] }, onlyRight: { count: 1, values: ['c'] } });
    // apps/old/a.js is cited by F1, but not at lines 15-16
    expect(by.kind.features).toEqual([]);
    expect(by.orders.features).toEqual(['F1', 'F2']);
    expect(by.orders.facts.applications).toEqual([{ application: 'apps/old', mentions: 1 }, { application: 'apps/new', mentions: 2 }]);
    expect(by.solo).toBeUndefined();
    expect(by.noapp).toBeUndefined();
    expect(result.lines.some((line) => /^CANDIDATE X\d+ dict - c-data-1 /.test(line))).toBe(true);
  });

  it('topic rows with 2 or more features are candidates, one feature is not, and rows resting only on problems lines are skipped and counted', () => {
    const run = make();
    run.result();
    const topics = run.read().candidates.filter((entry) => entry.source === 'topic');
    expect(topics.map((entry) => entry.features)).toEqual([['F1', 'F2'], ['F3', 'F4']]);
    expect(topics[0].batch).toBe('c-topics-1');
    expect(topics[0].places).toEqual([{ file: 'apps/old/a.js', a: 1, b: 3 }]);
    expect(topics[0].facts).toMatchObject({ line: 9, h2: 'Shared rules', h3: 'Approvals' });
    expect(topics[1].facts.text).toBe('- Free list item naming (F3) and (F4)');
    expect(run.read().sources.find((entry) => entry.source === 'topic')).toMatchObject({ computed: true, count: 2, skipped: 1 });
  });

  it('a printed topic line keeps non-ASCII text', () => {
    const word = String.fromCharCode(0x5ba1, 0x6279);
    const run = make({ topics: `# Topics\n\n## S\n\n- ${word} (F1) (F2)\n` });
    const result = run.result();
    const line = result.lines.find((entry) => entry.startsWith('CANDIDATE') && entry.includes(' topic '));
    expect(line).toContain(word);
    expect(line).not.toContain('?');
  });

  it('code candidates are only the pairs across batches', () => {
    const run = make();
    run.result();
    const code = run.read().candidates.filter((entry) => entry.source === 'code');
    expect(code).toHaveLength(1);
    expect(code[0]).toMatchObject({ features: ['F2', 'F3'], batch: 'c-code-1', facts: { files: ['apps/new/c.js'], batches: ['b1', 'b2'] } });
    expect(code[0].places).toEqual([{ file: 'apps/new/c.js', a: 2, b: 2 }]);
  });

  it('a missing data.json leaves table not computed with its reason and the other sources as they are', () => {
    const run = make();
    rmSync(join(run.out, 'data.json'));
    const result = run.result();
    expect(result.status).toBe(0);
    expect(result.lines).toContain('SOURCE table not computed: data.json is missing');
    expect(result.lines).toContain('SOURCE dual 1');
    expect(result.lines).toContain('SOURCE code 1');
    expect(run.read().sources.find((entry) => entry.source === 'table')).toEqual({ source: 'table', computed: false, reason: 'data.json is missing' });
    expect(run.read().candidates.some((entry) => entry.source === 'table')).toBe(false);
  });

  it('a missing dictionaries.json or topics.md is not computed, and the ids keep counting over the sources that ran', () => {
    const run = make();
    rmSync(join(run.out, 'dictionaries.json'));
    rmSync(join(run.out, 'chapters', 'topics.md'));
    const result = run.result();
    expect(result.lines).toContain('SOURCE dict not computed: dictionaries.json is missing');
    expect(result.lines).toContain('SOURCE topic not computed: chapters/topics.md is missing');
    expect(run.read().candidates.map((entry) => `${entry.id}:${entry.source}`)).toEqual(['X1:dual', 'X2:table', 'X3:table', 'X4:code']);
  });

  it('a usage error exits 2', () => {
    const run = make();
    const result = runHandbook(['review', 'compare-facts', run.out]);
    expect(result.status).toBe(2);
  });
});

describe('comparison batches', () => {
  const batchesOf = (run) => run.read().candidates.map((entry) => entry.batch);
  const manyMismatches = (run, count) => {
    const file = JSON.parse(readFileSync(join(run.out, 'dictionaries.json'), 'utf-8'));
    const template = file.mismatches[0];
    file.mismatches = Array.from({ length: count }, (_, at) => ({ ...template, key: `k${at}` }));
    put(join(run.out, 'dictionaries.json'), file);
  };

  it('cuts a group into chunks of 25 in candidate order, with the suffix also for one chunk; dict and table share the c-data chunks', () => {
    const run = make();
    manyMismatches(run, 27);
    run.result();
    const candidates = run.read().candidates;
    const data = candidates.filter((entry) => entry.source === 'dict' || entry.source === 'table');
    expect(data).toHaveLength(29);
    expect(data.map((entry) => entry.batch)).toEqual([...Array(25).fill('c-data-1'), ...Array(4).fill('c-data-2')]);
    expect(data.slice(25).map((entry) => entry.source)).toEqual(['dict', 'dict', 'table', 'table']);
    expect(candidates.find((entry) => entry.source === 'topic').batch).toBe('c-topics-1');
    expect(candidates.find((entry) => entry.source === 'code').batch).toBe('c-code-1');
    expect(candidates.find((entry) => entry.source === 'dual').batch).toBe('b1');
    expect(compareBatches(run.out).map((batch) => batch.id)).toEqual(['c-data-1', 'c-data-2', 'c-topics-1', 'c-code-1']);
    expect(compareBatches(run.out)[0]).toEqual({ id: 'c-data-1', name: 'c-data-1', features: [], compare: true });
  });

  it('a group with no candidate has no batch, and a missing or unreadable file has no comparison batches', () => {
    const run = make();
    rmSync(join(run.out, 'data.json'));
    rmSync(join(run.out, 'dictionaries.json'));
    run.result();
    expect(batchesOf(run).some((id) => String(id).startsWith('c-data'))).toBe(false);
    expect(compareBatches(run.out).map((batch) => batch.id)).toEqual(['c-topics-1', 'c-code-1']);
    put(join(run.out, 'entries', 'review-compare.json'), '{ nope');
    expect(compareBatches(run.out)).toEqual([]);
    rmSync(join(run.out, 'entries', 'review-compare.json'));
    expect(compareBatches(run.out)).toEqual([]);
  });

  it('removes the c-* batch files of batches that no longer exist, keeps the others and the removal records', () => {
    const run = make();
    manyMismatches(run, 27);
    run.result();
    const dir = join(run.out, 'entries', 'review');
    for (const name of ['c-data-1.json', 'c-data-2.json', 'c-data-2.verdicts.json', 'c-data-3.json', 'c-data-3.unpruned.json', 'c-data-3.verdicts.json', 'b1.json', 'b9.json']) put(join(dir, name), { items: [] });
    put(join(run.out, 'entries', 'review-removed.json'), { removed: [{ batch: 'cross' }] });
    // 25 mismatches keep c-data-1 as it was; c-data-2 now holds only the two tables.
    manyMismatches(run, 25);
    const result = run.result();
    expect(existsSync(join(dir, 'c-data-2.json'))).toBe(false);
    expect(existsSync(join(dir, 'c-data-2.verdicts.json'))).toBe(false);
    expect(existsSync(join(dir, 'c-data-3.unpruned.json'))).toBe(false);
    for (const name of ['c-data-1.json', 'b1.json', 'b9.json']) expect(existsSync(join(dir, name)), name).toBe(true);
    expect(result.lines).toContain('Removed stale comparison batch files: c-data-2.json, c-data-2.verdicts.json, c-data-3.json, c-data-3.unpruned.json, c-data-3.verdicts.json');
    expect(existsSync(join(run.out, 'entries', 'review-removed.json'))).toBe(true);
  });

  it('keeps the files of a batch whose candidates are unchanged and removes those of a batch whose candidates changed', () => {
    const run = make();
    manyMismatches(run, 27);
    run.result();
    const dir = join(run.out, 'entries', 'review');
    for (const name of ['c-data-1.json', 'c-data-1.verdicts.json', 'c-data-2.json']) put(join(dir, name), { items: [] });
    const again = run.result();
    for (const name of ['c-data-1.json', 'c-data-1.verdicts.json', 'c-data-2.json']) expect(existsSync(join(dir, name)), name).toBe(true);
    expect(again.lines.some((line) => line.startsWith('Removed stale comparison batch files'))).toBe(false);
    const file = JSON.parse(readFileSync(join(run.out, 'dictionaries.json'), 'utf-8'));
    file.mismatches[1] = { ...file.mismatches[1], key: 'k1-renamed' };
    put(join(run.out, 'dictionaries.json'), file);
    const changed = run.result();
    expect(run.read().candidates.filter((entry) => entry.batch === 'c-data-1')).toHaveLength(25);
    expect(changed.lines).toContain('Removed stale comparison batch files: c-data-1.json, c-data-1.verdicts.json');
    expect(existsSync(join(dir, 'c-data-2.json'))).toBe(true);
  });

  describe('the candidate ids of a domain batch file', () => {
    const setCandidates = (run, edits) => {
      const map = JSON.parse(readFileSync(join(run.out, 'map.json'), 'utf-8'));
      for (const feature of map.features) if (edits[feature.id] !== undefined) feature.candidates = edits[feature.id];
      put(join(run.out, 'map.json'), map);
    };
    const dualOf = (run, feature) => run.read().candidates.find((entry) => entry.source === 'dual' && entry.features[0] === feature);
    const reviewed = (ids) => ({ items: [{ title: 'Two forms', candidates: ids.items }, { title: 'No candidates' }], dismissed: ids.dismissed.map((candidate) => ({ candidate, reason: 'intended' })) });

    it('follow their candidates when an earlier candidate goes, and drop a candidate that is gone', () => {
      const run = make();
      // F2 also gets a route in apps/old, so F1 and F2 both have two implementations, in domain batch b1.
      setCandidates(run, { F2: ['r1', 'r3', 'r4'] });
      run.result();
      const [f1, f2] = [dualOf(run, 'F1'), dualOf(run, 'F2')];
      expect([f1.id, f2.id, f1.batch, f2.batch]).toEqual(['X1', 'X2', 'b1', 'b1']);
      const dir = join(run.out, 'entries', 'review');
      put(join(dir, 'b1.json'), reviewed({ items: ['X2'], dismissed: ['X1'] }));
      put(join(dir, 'b1.unpruned.json'), reviewed({ items: ['X2', 'X1'], dismissed: [] }));
      put(join(dir, 'b1.verdicts.json'), { verdicts: ['X1'] });
      const unchanged = run.result();
      expect(unchanged.lines.some((line) => line.startsWith('Rewrote comparison candidate ids'))).toBe(false);
      // F1 loses its route in apps/new: its candidate goes, F2's becomes X1 and every later id moves down by one.
      setCandidates(run, { F1: ['r1', 'j1'] });
      const changed = run.result();
      expect(dualOf(run, 'F1')).toBeUndefined();
      expect(dualOf(run, 'F2').id).toBe('X1');
      expect(changed.lines).toContain('Rewrote comparison candidate ids in batch files: b1.json (1 renamed, 1 dropped), b1.unpruned.json (1 renamed, 1 dropped)');
      const read = (name) => JSON.parse(readFileSync(join(dir, name), 'utf-8'));
      expect(read('b1.json')).toEqual({ items: [{ title: 'Two forms', candidates: ['X1'] }, { title: 'No candidates' }], dismissed: [] });
      expect(read('b1.unpruned.json').items[0]).toEqual({ title: 'Two forms', candidates: ['X1'] });
      expect(read('b1.verdicts.json')).toEqual({ verdicts: ['X1'] });
    });

    it('drops an item\'s candidates key when none is left, and every id when the previous candidates file is unreadable', () => {
      const run = make();
      run.result();
      const dir = join(run.out, 'entries', 'review');
      put(join(dir, 'b1.json'), reviewed({ items: ['X1'], dismissed: [] }));
      put(join(run.out, 'entries', 'review-compare.json'), '{ nope');
      expect(run.result().lines).toContain('Rewrote comparison candidate ids in batch files: b1.json (0 renamed, 1 dropped)');
      expect(JSON.parse(readFileSync(join(dir, 'b1.json'), 'utf-8')).items[0]).toEqual({ title: 'Two forms' });
    });
  });

  it('rebindBatchFiles drops an id whose candidate moved to another batch, pairs equal candidates in order, and leaves c-* files and already wrong ids alone', () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'xhb-rebind-')));
    bases.push(base);
    const dir = join(base, 'entries', 'review');
    const same = { source: 'dual', features: ['F1'], facts: {}, places: [] };
    const previous = [{ id: 'X1', batch: 'b1', ...same }, { id: 'X2', batch: 'b1', ...same }, { id: 'X3', batch: 'b1', source: 'dual', features: ['F2'], facts: {}, places: [] }];
    const candidates = [{ id: 'X1', batch: 'b2', source: 'dual', features: ['F2'], facts: {}, places: [] }, { id: 'X2', batch: 'b1', ...same }, { id: 'X3', batch: 'b1', ...same }];
    put(join(dir, 'b1.json'), { items: [{ candidates: ['X1', 'X2', 'X3'] }] });
    put(join(dir, 'c-data-1.json'), { items: [{ candidates: ['X1'] }] });
    // Ids that were already wrong (another batch's candidate, an unknown id) are left for the batch check to report.
    put(join(dir, 'p1.json'), { items: [{ candidates: ['X1'] }] });
    put(join(dir, 'b9.json'), { items: [{ candidates: ['X3', 'X7'] }], dismissed: [{ candidate: 'X2', reason: 'intended' }] });
    expect(rebindBatchFiles(base, previous, candidates)).toEqual([{ name: 'b1.json', renamed: 2, dropped: 1 }]);
    const read = (name) => JSON.parse(readFileSync(join(dir, name), 'utf-8'));
    expect(read('b1.json').items[0].candidates).toEqual(['X2', 'X3']);
    expect(read('c-data-1.json').items[0].candidates).toEqual(['X1']);
    expect(read('p1.json').items[0].candidates).toEqual(['X1']);
    expect(read('b9.json')).toEqual({ items: [{ candidates: ['X3', 'X7'] }], dismissed: [{ candidate: 'X2', reason: 'intended' }] });
  });

  it('removes every c-* batch file when the previous candidates file is unreadable', () => {
    const run = make();
    run.result();
    const dir = join(run.out, 'entries', 'review');
    put(join(dir, 'c-data-1.json'), { items: [] });
    put(join(run.out, 'entries', 'review-compare.json'), '{ nope');
    expect(run.result().lines).toContain('Removed stale comparison batch files: c-data-1.json');
  });
});

describe('review candidate-lines', () => {
  const lines = (run, id) => runHandbook(['review', 'candidate-lines', run.out, id]);

  it('prints the candidate, its facts and only the chapter lines whose citation meets a place', () => {
    const run = make();
    run.result();
    const id = run.read().candidates.find((entry) => entry.source === 'dict' && entry.facts.key === 'status').id;
    // F1 cites apps/old/a.js:1-3 (meets the definition line 1); add a line citing the same file elsewhere.
    const path = join(run.out, 'chapters', 'F1.md');
    writeFileSync(path, `${readFileSync(path, 'utf-8')}\n- Elsewhere ${c('apps/old/a.js:5-8')}\n`);
    const result = lines(run, id);
    expect(result.status).toBe(0);
    expect(result.lines[0]).toMatch(new RegExp(`^CANDIDATE ${id} dict F1 c-data-1 `));
    expect(result.lines[1]).toBe(`FACTS ${JSON.stringify(run.read().candidates.find((entry) => entry.id === id).facts)}`);
    expect(result.lines.slice(2)).toEqual(['FEATURE F1', 'F1.md:5: - New approval `apps/old/a.js:1-3`']);
    expect(result.stdout).not.toContain('Elsewhere');
  });

  it('prints the TOPIC row of a topic candidate, and a feature with no citing line says so', () => {
    const run = make();
    run.result();
    const id = run.read().candidates.find((entry) => entry.source === 'topic').id;
    const result = lines(run, id);
    expect(result.lines[2]).toMatch(/^TOPIC topics\.md:9 \| Approval rule /);
    expect(result.lines).toContain('FEATURE F2');
    expect(result.lines[result.lines.indexOf('FEATURE F2') + 1]).toBe('  no chapter line cites these places');
  });

  it('exits 1 for an unknown id, and says so for a candidate without places', () => {
    const run = make();
    run.result();
    const missing = lines(run, 'X99');
    expect(missing.status).toBe(1);
    expect(missing.stdout + missing.stderr).toContain('entries/review-compare.json');
    const file = run.read();
    delete file.candidates[1].places;
    put(join(run.out, 'entries', 'review-compare.json'), file);
    expect(lines(run, 'X2').lines).toContain('no places recorded; run review compare-facts again');
  });
});

describe('review candidates', () => {
  const candidates = (run, batch) => runHandbook(['review', 'candidates', run.out, batch]);

  it('prints the CANDIDATE lines of one batch exactly as compare-facts printed them, and none for a batch without', () => {
    const run = make();
    const printed = run.result().lines.filter((line) => line.startsWith('CANDIDATE'));
    const file = run.read().candidates;
    for (const batch of new Set(file.map((entry) => entry.batch).filter((id) => id !== null))) {
      const expected = printed.filter((line) => line.split(' ')[4] === batch);
      const result = candidates(run, batch);
      expect(result.status).toBe(0);
      expect(result.lines).toEqual(expected);
      expect(expected.length).toBeGreaterThan(0);
    }
    expect(candidates(run, 'b9').lines).toEqual(['none']);
  });

  it('says none with the reason when the file is missing or does not parse, and exits 0', () => {
    const run = make();
    const missing = candidates(run, 'b1');
    expect(missing.status).toBe(0);
    expect(missing.lines[0]).toMatch(/^none: entries\/review-compare\.json /);
    put(join(run.out, 'entries', 'review-compare.json'), '{ not json');
    expect(candidates(run, 'b1').lines[0]).toMatch(/^none: entries\/review-compare\.json /);
    put(join(run.out, 'entries', 'review-compare.json'), { candidates: 3 });
    expect(candidates(run, 'b1').lines).toEqual(['none: entries/review-compare.json is not a comparison candidates file']);
  });

  it('needs exactly one batch', () => {
    const run = make();
    expect(runHandbook(['review', 'candidates', run.out]).status).toBe(2);
  });
});
