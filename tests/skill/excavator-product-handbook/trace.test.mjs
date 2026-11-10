// Design D14 of openspec change product-handbook-map, the third check: once two
// verifiers settle a feature it is `confirmed`; `trace` writes the confirmed
// items as trace files (claim and cited line ranges, no code) for tracers that
// read the whole project and look only for counter-evidence; `trace-verdicts`
// records their `holds` or `contradicted` verdicts, deletes the contradicted
// items and makes the feature `verified`. Every rejection is paired with a
// control that passes.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { MARK, clone, confirmChecked, judge, makeCheckedMapRun, makeRun, markedEntry, markedMap, runHandbook, traceFeature, translatedUi } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const form = 'src/forms/order-form.js';
const ev = (file, passage) => ({ file, passage });
// The traced items of the good entry, in entry order: its 14 items without the purpose, the navigation path, the screen
// and the field labels, which the verifiers alone settle (design D5 of openspec change handbook-deep-entry).
const ALL_ITEMS = [
  'who[0]', 'screens[0].fields[0].rules[0]', 'screens[0].fields[1].rules[0]', 'screens[0].fields[1].rules[1]',
  'operations[0].sentences[0]', 'operations[0].sentences[1]', 'states[0]', 'states[1]',
];

const stateOf = (run, id = 'F1') => run.readJson('state.json').features[id];
const entryText = (run, id = 'F1') => readFileSync(join(run.out, 'entries', `${id}.json`), 'utf-8');
const tracePath = (run, part = 1, id = 'F1') => join(run.out, 'trace', id, `part-${part}.json`);
const verdictPath = (run, part = 1, id = 'F1', letter = 'a') => join(run.out, 'trace-verdicts', id, `part-${part}.${letter}.json`);
const readTrace = (run, part = 1) => JSON.parse(readFileSync(tracePath(run, part), 'utf-8'));
const AT = { file: form, line: 6 };

/** A run whose F1 entry passed check-entry and nothing more. */
function checkedRun() {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  run.writeEntry('F1', clone(run.entry));
  expect(run.run('check-entry', 'F1').status).toBe(0);
  return run;
}

/** A run whose F1 entry both verifiers confirmed: state `confirmed`. */
function confirmedRun(adjust) {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  const entry = clone(run.entry);
  adjust?.(run, entry);
  run.writeEntry('F1', entry);
  const checked = run.run('check-entry', 'F1');
  expect(checked.status, checked.stdout).toBe(0);
  confirmChecked(run);
  return run;
}

/** 26 traced items: the 8 of the good entry and 18 more states. */
const twentySix = (run, entry) => {
  for (let i = 0; i < 18; i += 1) {
    entry.states.push({ label: 'Draft', meaning: `The order is in stage ${String.fromCharCode(65 + i)}.`, evidence: [ev(form, "const statuses = ['Draft', 'Submitted'];")] });
  }
};

describe('verdicts: a settled feature is confirmed, not yet verified', () => {
  it('records round 1 with every item verified as confirmed and tells the next step', () => {
    const run = checkedRun();
    const result = judge(run, 'F1');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('F1: confirmed (14 items)');
    expect(result.lines.at(-1)).toMatch(/^Next: run trace for F1, dispatch two excavator-handbook-tracers per part, then run trace-verdicts$/);
    const state = stateOf(run);
    expect(state.status).toBe('confirmed');
    expect(state.attempts).toBe(0);
    expect(typeof state.entryDigest).toBe('string');
    expect(state.removed).toBeUndefined();
  });

  it('records round 2 as confirmed and keeps what it removed', () => {
    const run = checkedRun();
    expect(judge(run, 'F1', 1, (item) => (item.id === 'states[1]' ? 'unverified' : 'verified')).status).toBe(0);
    const result = judge(run, 'F1', 2, () => ({ verdict: 'unverified', reason: 'No line shown names the state.' }));
    expect(result.lines[0]).toBe('F1: confirmed, 1 item removed');
    expect(result.lines.at(-1)).toMatch(/^Next: run trace for F1/);
    const state = stateOf(run);
    expect(state.status).toBe('confirmed');
    expect(state.removed.map((record) => record.path)).toEqual(['states[1]']);
    expect(Object.keys(state).sort()).toEqual(['attempts', 'entryDigest', 'removed', 'status']);
  });

  it('still fails a feature with nothing proved at the step verify', () => {
    const run = checkedRun();
    expect(judge(run, 'F1', 1, () => 'unverified').status).toBe(0);
    const result = judge(run, 'F1', 2, () => ({ verdict: 'unverified', reason: 'Nothing shown says why.' }));
    expect(result.lines).toEqual(['F1: failed at verify: no item could be proved']);
    expect(stateOf(run).status).toBe('failed');
  });
});

describe('a confirmed feature is not written or verified again', () => {
  it('refuses a new dispatch of its lane', () => {
    const run = confirmedRun();
    const result = run.run('mark', 'F1', 'dispatched');
    expect(result.status).toBe(1);
    expect(result.lines).toEqual(['F1: already confirmed; it is not written again']);
  });

  it('refuses slices and points at trace', () => {
    const run = confirmedRun();
    const result = run.run('slices', 'F1');
    expect(result.status).toBe(1);
    expect(result.lines).toEqual(['F1: is confirmed; only a checked feature is verified', 'Next: run trace for F1']);
  });

  it('takes the trace files away when it is verified again from round 1', () => {
    const run = confirmedRun();
    expect(run.run('trace', 'F1').status).toBe(0);
    const changed = clone(run.entry);
    changed.purpose.text = 'Staff place new orders.';
    run.writeEntry('F1', changed);
    expect(run.run('check-entry', 'F1').status).toBe(0);
    expect(stateOf(run).status).toBe('checked');
    expect(run.run('slices', 'F1').status).toBe(0);
    expect(existsSync(join(run.out, 'trace', 'F1'))).toBe(false);
  });

  it('rejects a state.json whose removed record has a step or an at that is not valid', () => {
    const run = confirmedRun();
    const state = run.readJson('state.json');
    state.features.F1.removed = [{ path: 'states[1]', claim: 'x', verdict: 'contradicted', reason: 'y', step: 'later', at: [{ file: form, line: 1 }] }];
    run.writeJson(join(run.out, 'state.json'), state);
    expect(run.run('trace', 'F1').stdout).toContain('removed list that is not');
    state.features.F1.removed = [{ path: 'states[1]', claim: 'x', verdict: 'contradicted', reason: 'y', step: 'trace', at: [{ file: form, line: 'one' }] }];
    run.writeJson(join(run.out, 'state.json'), state);
    expect(run.run('trace', 'F1').stdout).toContain('removed list that is not');
    state.features.F1.removed = [{ path: 'states[1]', claim: 'x', verdict: 'contradicted', reason: 'y', step: 'trace', at: [{ file: form, line: 1 }] }];
    run.writeJson(join(run.out, 'state.json'), state);
    expect(run.run('trace', 'F1').stdout).not.toContain('removed list that is not');
  });

  it('accepts a removed record with reasons that is an array of strings, and rejects one that is not', () => {
    const run = confirmedRun();
    const state = run.readJson('state.json');
    const record = { path: 'states[1]', claim: 'x', verdict: 'contradicted', reason: 'y', step: 'trace', at: [{ file: form, line: 1 }] };
    for (const reasons of ['y', ['y', 2], { 0: 'y' }, null]) {
      state.features.F1.removed = [{ ...record, reasons }];
      run.writeJson(join(run.out, 'state.json'), state);
      expect(run.run('trace', 'F1').stdout, JSON.stringify(reasons)).toContain('removed list that is not');
    }
    state.features.F1.removed = [{ ...record, reasons: ['y', 'z'] }];
    run.writeJson(join(run.out, 'state.json'), state);
    expect(run.run('trace', 'F1').stdout).not.toContain('removed list that is not');
  });
});

describe('trace: the trace files', () => {
  it('writes part-1.json for a confirmed feature: claims as the verify files hold them, citations as file and line range, no code', () => {
    const run = confirmedRun();
    const result = run.run('trace', 'F1');
    expect(result.status, result.stdout).toBe(0);
    const file = readTrace(run);
    expect(Object.keys(file)).toEqual(['feature', 'part', 'parts', 'items']);
    expect([file.feature, file.part, file.parts]).toEqual(['F1', 1, 1]);
    expect(file.items.map((item) => item.id)).toEqual(ALL_ITEMS);
    const verify = JSON.parse(readFileSync(join(run.out, 'verify', 'round-1', 'F1', 'part-1.json'), 'utf-8'));
    expect(file.items.map((item) => [item.id, item.claim])).toEqual(verify.items.filter((item) => ALL_ITEMS.includes(item.id)).map((item) => [item.id, item.claim]));
    for (const item of file.items) {
      expect(Object.keys(item)).toEqual(['id', 'claim', 'citations']);
      expect(item.citations.length).toBeGreaterThan(0);
      for (const citation of item.citations) {
        expect(Object.keys(citation)).toEqual(['file', 'lines']);
        expect(citation.lines).toMatch(/^\d+-\d+$/);
      }
    }
    // The passage itself, not the 20 lines around it: one line of the form file.
    const countCap = file.items.find((item) => item.id === 'screens[0].fields[1].rules[0]');
    expect(countCap.citations).toEqual([{ file: form, lines: '6-6' }]);
    const countRule = file.items.find((item) => item.id === 'screens[0].fields[1].rules[1]');
    expect(countRule.citations).toEqual([{ file: form, lines: '9-9' }]);
    const text = readFileSync(tracePath(run), 'utf-8');
    expect(text).not.toContain('"code"');
    expect(text).not.toContain('title:');
    expect(text).not.toContain('35000 }');
  });

  it('prints the parts with the trace file and the two verdict files of each, and the next step', () => {
    const run = confirmedRun();
    const result = run.run('trace', 'F1');
    expect(result.lines).toEqual([
      'F1: 8 items in 1 part',
      `Part 1/1: 8 items | Trace file: ${tracePath(run)} | Verdict files: ${verdictPath(run, 1, 'F1', 'a')} ${verdictPath(run, 1, 'F1', 'b')}`,
      'Next: dispatch two excavator-handbook-tracer subagents per part of F1, one per verdict file, each with the trace file, its verdict file and the project root of its line above, then run trace-verdicts for F1',
    ]);
  });

  it('cuts 26 items into two parts in entry order, 25 and 1', () => {
    const run = confirmedRun(twentySix);
    const result = run.run('trace', 'F1');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('F1: 26 items in 2 parts');
    expect(result.lines[1]).toMatch(/^Part 1\/2: 25 items \| Trace file: /);
    expect(result.lines[2]).toMatch(/^Part 2\/2: 1 item \| Trace file: /);
    const [one, two] = [readTrace(run, 1), readTrace(run, 2)];
    expect([one.part, one.parts, two.part, two.parts]).toEqual([1, 2, 2, 2]);
    expect(one.items).toHaveLength(25);
    expect(two.items.map((item) => item.id)).toEqual(['states[19]']);
    expect([...one.items, ...two.items].map((item) => item.id)).toEqual([...ALL_ITEMS, ...Array.from({ length: 18 }, (_, i) => `states[${i + 2}]`)]);
  });

  it('writes the items that are still in the entry: an item round 2 removed is not traced', () => {
    const run = checkedRun();
    expect(judge(run, 'F1', 1, (item) => (item.id === 'states[1]' ? 'unverified' : 'verified')).status).toBe(0);
    expect(judge(run, 'F1', 2, () => ({ verdict: 'unverified', reason: 'No line shown names the state.' })).status).toBe(0);
    expect(run.run('trace', 'F1').lines[0]).toBe('F1: 7 items in 1 part');
    expect(readTrace(run).items.map((item) => item.id)).not.toContain('states[1]');
  });

  it('removes the older trace and verdict files of the feature first', () => {
    const run = confirmedRun(twentySix);
    expect(run.run('trace', 'F1').status).toBe(0);
    mkdirSync(join(run.out, 'trace-verdicts', 'F1'), { recursive: true });
    for (const letter of ['a', 'b']) for (const part of [1, 2]) writeFileSync(verdictPath(run, part, 'F1', letter), '{}');
    writeFileSync(join(run.out, 'trace-verdicts', 'F1', 'part-1.json'), '{}');
    writeFileSync(join(run.out, 'trace', 'F1', 'part-7.json'), '{}');
    expect(run.run('trace', 'F1').status).toBe(0);
    expect(existsSync(join(run.out, 'trace', 'F1', 'part-7.json'))).toBe(false);
    for (const letter of ['a', 'b']) for (const part of [1, 2]) expect(existsSync(verdictPath(run, part, 'F1', letter))).toBe(false);
    expect(existsSync(join(run.out, 'trace-verdicts', 'F1', 'part-1.json'))).toBe(false);
    expect(existsSync(tracePath(run, 2))).toBe(true);
  });

  it('refuses a feature that is not confirmed, with a Next line, and writes nothing', () => {
    const run = checkedRun();
    const checked = run.run('trace', 'F1');
    expect(checked.status).toBe(1);
    expect(checked.lines[0]).toBe('F1: is checked; only a confirmed feature is traced');
    expect(checked.lines.at(-1)).toMatch(/^Next: /);
    expect(existsSync(join(run.out, 'trace'))).toBe(false);
    const planned = run.run('trace', 'F2');
    expect(planned.status).toBe(1);
    expect(planned.lines[0]).toBe('F2: is planned; only a confirmed feature is traced');
    // The control: the same feature once confirmed is traced.
    confirmChecked(run);
    expect(run.run('trace', 'F1').status).toBe(0);
  });

  it('refuses a verified feature', () => {
    const run = confirmedRun();
    expect(traceFeature(run).status).toBe(0);
    const again = run.run('trace', 'F1');
    expect(again.status).toBe(1);
    expect(again.lines[0]).toBe('F1: is verified; only a confirmed feature is traced');
    expect(again.lines.at(-1)).toBe('Next: nothing; it is verified');
  });

  it('refuses an entry that changed after it was confirmed', () => {
    const run = confirmedRun();
    const entry = JSON.parse(entryText(run));
    entry.states[0].meaning = 'The order is not sent yet, by anyone.';
    run.writeEntry('F1', entry);
    const result = run.run('trace', 'F1');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('F1: entries/F1.json changed after it was confirmed');
    expect(result.lines.at(-1)).toMatch(/^Next: run check-entry for F1/);
  });

  it('needs --project and a feature of the map', () => {
    const run = confirmedRun();
    expect(run.run('trace', 'F9').status).toBe(2);
  });
});

describe('trace-verdicts: the verdict files are checked before anything is recorded', () => {
  /** Trace F1, write an all-holds verdict file for each part, let `mutate` spoil it, and run trace-verdicts. */
  const attempt = (run, mutate, extra = () => {}) => {
    const result = traceFeature(run, 'F1', () => 'holds', mutate);
    extra();
    return result;
  };
  const untouched = (run, before) => {
    expect(stateOf(run).status).toBe('confirmed');
    expect(entryText(run)).toBe(before.entry);
    expect(JSON.stringify(stateOf(run))).toBe(before.state);
  };
  const snapshot = (run) => ({ entry: entryText(run), state: JSON.stringify(stateOf(run)) });
  /** The spoiled file is refused with `line` and records nothing; the same file made right is recorded. */
  const refuses = (mutate, line, { fixed = (verdicts) => verdicts } = {}) => {
    const run = confirmedRun();
    const before = snapshot(run);
    const bad = attempt(run, mutate);
    expect(bad.status, bad.stdout).toBe(1);
    expect(bad.lines.find((one) => one.includes(line)), bad.stdout).toBeDefined();
    expect(bad.lines.at(-1)).toMatch(/^Next: /);
    untouched(run, before);
    // Control: the right file passes.
    const good = JSON.parse(readFileSync(verdictPath(run), 'utf-8'));
    writeFileSync(verdictPath(run), `${JSON.stringify({ verdicts: fixed(good.verdicts) }, null, 2)}\n`);
    return { run, bad };
  };
  const goodList = (run) => readTrace(run).items.map((item) => ({ id: item.id, verdict: 'holds', reason: `Nothing disagrees with ${item.id}.` }));
  const repair = (run) => writeFileSync(verdictPath(run), `${JSON.stringify({ verdicts: goodList(run) }, null, 2)}\n`);

  it('rejects an item without a verdict, names its part, and records nothing', () => {
    const { run, bad } = refuses((_, verdicts) => verdicts.splice(2, 1), 'part 1a: screens[0].fields[1].rules[0]: no verdict');
    expect(bad.lines.at(-1)).toBe('Next: delete the verdict file of part 1a and dispatch the tracer once more for part 1a with the lines above; nothing was recorded');
    repair(run);
    expect(run.run('trace-verdicts', 'F1').status).toBe(0);
  });

  it('rejects an id that is not an item of its part, and a repeated id', () => {
    const extra = refuses((_, verdicts) => verdicts.push({ id: 'states[7]', verdict: 'holds', reason: 'Looked.' }), 'part 1a: states[7]: is not an item of the trace file');
    repair(extra.run);
    expect(extra.run.run('trace-verdicts', 'F1').status).toBe(0);
    const twice = refuses((_, verdicts) => verdicts.push({ ...verdicts[0] }), 'part 1a: who[0]: more than one verdict');
    repair(twice.run);
    expect(twice.run.run('trace-verdicts', 'F1').status).toBe(0);
  });

  it('rejects a verdict that is not holds or contradicted, in particular the verifier words', () => {
    for (const word of ['maybe', 'verified', 'unverified']) {
      const { run } = refuses((_, verdicts) => { verdicts[3].verdict = word; }, `part 1a: screens[0].fields[1].rules[1]: verdict "${word}" is not one of holds, contradicted`);
      repair(run);
      expect(run.run('trace-verdicts', 'F1').status).toBe(0);
    }
  });

  it('rejects a contradicted verdict without an at entry, and one whose at is empty or malformed', () => {
    const none = refuses((_, verdicts) => { verdicts[0] = { id: 'who[0]', verdict: 'contradicted', reason: 'The code lets another role in.' }; }, 'part 1a: who[0]: a contradicted verdict needs at least one at entry');
    repair(none.run);
    expect(none.run.run('trace-verdicts', 'F1').status).toBe(0);
    const empty = refuses((_, verdicts) => { verdicts[0] = { id: 'who[0]', verdict: 'contradicted', reason: 'The code lets another role in.', at: [] }; }, 'part 1a: who[0]: a contradicted verdict needs at least one at entry');
    repair(empty.run);
    const malformed = refuses((_, verdicts) => { verdicts[0] = { id: 'who[0]', verdict: 'contradicted', reason: 'The code lets another role in.', at: [{ file: form }] }; }, 'part 1a: who[0]: at[0]: must be { file, line }');
    repair(malformed.run);
    expect(malformed.run.run('trace-verdicts', 'F1').status).toBe(0);
  });

  it('rejects an empty reason and a reason of more than one line', () => {
    const empty = refuses((_, verdicts) => { verdicts[0].reason = '  '; }, 'part 1a: who[0]: the reason must be a non-empty string');
    repair(empty.run);
    expect(empty.run.run('trace-verdicts', 'F1').status).toBe(0);
    const lines = refuses((_, verdicts) => { verdicts[0].reason = 'Looked.\nThen looked again.'; }, 'part 1a: who[0]: the reason must be one line');
    repair(lines.run);
    expect(lines.run.run('trace-verdicts', 'F1').status).toBe(0);
  });

  describe('two holds verdicts of one part never share a reason', () => {
    const SAME = 'Read the function that picks the reviewers and the query it runs: it selects every active member.';

    it('rejects the same holds reason on two items of a part, names both ids, and records nothing', () => {
      const { run, bad } = refuses((_, verdicts) => { verdicts[0].reason = SAME; verdicts[2].reason = SAME; }, `part 1a: screens[0].fields[1].rules[0]: the same holds reason as who[0]: trace each item on its own`);
      expect(bad.lines.at(-1)).toBe('Next: delete the verdict file of part 1a and dispatch the tracer once more for part 1a with the lines above; nothing was recorded');
      repair(run);
      expect(run.run('trace-verdicts', 'F1').status).toBe(0);
    });

    it('treats reasons that differ only in white space as the same', () => {
      const { run } = refuses((_, verdicts) => { verdicts[0].reason = SAME; verdicts[1].reason = `  ${SAME.replace(/ /g, '   ')} `; }, 'the same holds reason as who[0]: trace each item on its own');
      repair(run);
      expect(run.run('trace-verdicts', 'F1').status).toBe(0);
    });

    it('allows the same reason on two contradicted items', () => {
      const run = confirmedRun();
      const result = traceFeature(run, 'F1', (item) => (['states[0]', 'states[1]'].includes(item.id)
        ? { verdict: 'contradicted', reason: 'The order starts in another state.', at: [AT] }
        : 'holds'));
      expect(result.status, result.stdout).toBe(0);
    });

    it('does not compare a holds reason with the reasons of another part', () => {
      const run = confirmedRun(twentySix);
      const result = traceFeature(run, 'F1', () => 'holds', (part, verdicts) => { if (part === 2) verdicts[0].reason = 'Looked at purpose.'; });
      expect(result.status, result.stdout).toBe(0);
      expect(stateOf(run).status).toBe('verified');
    });
  });

  it('rejects a verdict file that is missing or not JSON, and names exactly the part-letters to dispatch again', () => {
    const run = confirmedRun(twentySix);
    expect(run.run('trace', 'F1').status).toBe(0);
    mkdirSync(join(run.out, 'trace-verdicts', 'F1'), { recursive: true });
    const one = `${JSON.stringify({ verdicts: readTrace(run, 1).items.map((item) => ({ id: item.id, verdict: 'holds', reason: `Looked at ${item.id}.` })) })}\n`;
    for (const letter of ['a', 'b']) writeFileSync(verdictPath(run, 1, 'F1', letter), one);
    writeFileSync(verdictPath(run, 2, 'F1', 'a'), `${JSON.stringify({ verdicts: [{ id: 'states[19]', verdict: 'holds', reason: 'Looked.' }] })}\n`);
    const missing = run.run('trace-verdicts', 'F1');
    expect(missing.status).toBe(1);
    expect(missing.lines[0]).toBe('part 2b: trace-verdicts/F1/part-2.b.json is missing');
    expect(missing.lines.at(-1)).toMatch(/^Next: dispatch the tracer once more for F1 for exactly the missing part: 2b,/);
    expect(missing.lines.at(-1)).not.toContain('2a');
    writeFileSync(verdictPath(run, 2, 'F1', 'b'), 'not json');
    const broken = run.run('trace-verdicts', 'F1');
    expect(broken.status).toBe(1);
    expect(broken.lines[0]).toMatch(/^part 2b: trace-verdicts\/F1\/part-2\.b\.json is not valid JSON/);
    expect(broken.lines.at(-1)).toBe('Next: delete the verdict file of part 2b and dispatch the tracer once more for part 2b with the lines above; nothing was recorded');
    expect(stateOf(run).status).toBe('confirmed');
    // The control: part 2b written right records the feature.
    writeFileSync(verdictPath(run, 2, 'F1', 'b'), `${JSON.stringify({ verdicts: [{ id: 'states[19]', verdict: 'holds', reason: 'Looked.' }] })}\n`);
    const done = run.run('trace-verdicts', 'F1');
    expect(done.status, done.stdout).toBe(0);
    expect(done.lines).toEqual(['F1: verified (26 items)']);
  });

  it('names every missing part-letter in part order, and every rejected one in the delete-and-dispatch line', () => {
    const run = confirmedRun(twentySix);
    expect(run.run('trace', 'F1').status).toBe(0);
    mkdirSync(join(run.out, 'trace-verdicts', 'F1'), { recursive: true });
    writeFileSync(verdictPath(run, 1, 'F1', 'a'), `${JSON.stringify({ verdicts: readTrace(run, 1).items.map((item) => ({ id: item.id, verdict: 'holds', reason: `Looked at ${item.id}.` })) })}\n`);
    const missing = run.run('trace-verdicts', 'F1');
    expect(missing.lines.at(-1)).toMatch(/^Next: dispatch the tracer once more for F1 for exactly the missing parts: 1b, 2a and 2b,/);
    writeFileSync(verdictPath(run, 1, 'F1', 'b'), 'x');
    const mixed = run.run('trace-verdicts', 'F1');
    expect(mixed.lines.at(-1)).toBe('Next: delete the verdict file of part 1b and dispatch the tracer once more for parts 1b, 2a and 2b with the lines above; nothing was recorded');
  });

  it('refuses when the trace files are gone or the entry changed since trace wrote them', () => {
    const run = confirmedRun();
    const before = run.run('trace-verdicts', 'F1');
    expect(before.status).toBe(1);
    expect(before.lines.at(-1)).toBe('Next: run trace for F1 first');
    expect(run.run('trace', 'F1').status).toBe(0);
    const entry = JSON.parse(entryText(run));
    entry.states[0].meaning = 'The order is not sent yet, by anyone.';
    run.writeEntry('F1', entry);
    const result = run.run('trace-verdicts', 'F1');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('F1: entries/F1.json changed after it was confirmed');
  });

  describe('the at position of a contradicted verdict', () => {
    const contradict = (at) => (_, verdicts) => {
      verdicts[2] = { id: 'screens[0].fields[1].rules[0]', verdict: 'contradicted', reason: 'The code caps the count at fifty.', at };
    };
    const wanted = (message) => `part 1a: screens[0].fields[1].rules[0]: at[0]: ${message}`;
    const withAt = (at, message) => refuses(contradict(at), wanted(message));

    it('rejects a path that leaves the project with .., and does not read the file', () => {
      const run = confirmedRun();
      writeFileSync(join(run.base, 'outside.js'), 'const x = 1;\n');
      const before = snapshot(run);
      const bad = attempt(run, contradict([{ file: '../outside.js', line: 1 }]));
      expect(bad.status).toBe(1);
      expect(bad.lines).toContain(wanted('../outside.js leaves the project'));
      untouched(run, before);
      repair(run);
      expect(run.run('trace-verdicts', 'F1').status).toBe(0);
    });

    it('rejects an absolute path, also one inside the project', () => {
      for (const file of ['/etc/hosts', null]) {
        const run = confirmedRun();
        const absolute = file ?? join(run.root, form);
        const before = snapshot(run);
        const bad = attempt(run, contradict([{ file: absolute, line: 1 }]));
        expect(bad.status).toBe(1);
        expect(bad.lines).toContain(wanted(`${absolute} is absolute; give it relative to the project`));
        untouched(run, before);
      }
    });

    it('rejects a symlink inside the project that points outside it', () => {
      const run = confirmedRun();
      writeFileSync(join(run.base, 'outside.js'), 'const secret = 1;\nconst more = 2;\n');
      symlinkSync(join(run.base, 'outside.js'), join(run.root, 'src', 'escape.js'));
      const before = snapshot(run);
      const bad = attempt(run, contradict([{ file: 'src/escape.js', line: 1 }]));
      expect(bad.status).toBe(1);
      expect(bad.lines).toContain(wanted('src/escape.js resolves outside the project'));
      untouched(run, before);
      // The control: a symlink that stays inside the project is a file of the project.
      symlinkSync(join(run.root, form), join(run.root, 'src', 'inside.js'));
      const inside = attempt(run, contradict([{ file: 'src/inside.js', line: 6 }]));
      expect(inside.status, inside.stdout).toBe(0);
    });

    it('rejects a file that does not exist, and a directory', () => {
      const missing = withAt([{ file: 'src/nope.js', line: 1 }], 'src/nope.js is not a file in the project');
      expect(missing.run.run('trace-verdicts', 'F1').status).toBe(1);
      repair(missing.run);
      expect(missing.run.run('trace-verdicts', 'F1').status).toBe(0);
      const dir = withAt([{ file: 'src', line: 1 }], 'src is not a file in the project');
      repair(dir.run);
      expect(dir.run.run('trace-verdicts', 'F1').status).toBe(0);
    });

    it('rejects a file under .excavator or node_modules', () => {
      const run = confirmedRun();
      mkdirSync(join(run.root, 'node_modules', 'dep'), { recursive: true });
      writeFileSync(join(run.root, 'node_modules', 'dep', 'index.js'), 'const x = 1;\n');
      const bad = attempt(run, contradict([{ file: 'node_modules/dep/index.js', line: 1 }]));
      expect(bad.status).toBe(1);
      expect(bad.stdout).toContain('node_modules');
      expect(stateOf(run).status).toBe('confirmed');
    });

    it('rejects line 0, a line past the end of the file, a negative, fractional or non-number line', () => {
      for (const line of [0, 13, 999, -2, 2.5, '6', null]) {
        const run = confirmedRun();
        const before = snapshot(run);
        const bad = attempt(run, contradict([{ file: form, line }]));
        expect(bad.status, `line ${JSON.stringify(line)}`).toBe(1);
        expect(bad.lines).toContain(wanted(`line ${JSON.stringify(line)} is not a line of ${form} (1 to 12)`));
        untouched(run, before);
      }
    });

    it('accepts the first and the last line of the file', () => {
      for (const line of [1, 12]) {
        const run = confirmedRun();
        const result = attempt(run, contradict([{ file: form, line }]));
        expect(result.status, result.stdout).toBe(0);
        expect(result.lines).toEqual(['F1: verified, 1 item removed']);
      }
    });

    it('checks every at entry, not only the first', () => {
      const run = confirmedRun();
      const bad = attempt(run, contradict([AT, { file: form, line: 40 }]));
      expect(bad.status).toBe(1);
      expect(bad.lines).toContain(`part 1a: screens[0].fields[1].rules[0]: at[1]: line 40 is not a line of ${form} (1 to 12)`);
    });
  });

  describe('the reason of a contradicted verdict reaches readers', () => {
    const contradict = (reason) => (_, verdicts) => {
      verdicts[2] = { id: 'screens[0].fields[1].rules[0]', verdict: 'contradicted', reason, at: [AT] };
    };

    it.each([
      ['a name followed by a call', 'The code runs capCount(items) before saving.', 'screens[0].fields[1].rules[0].reason: "capCount("'],
      ['an identifier with an underscore', 'The limit comes from max_items in the form.', 'screens[0].fields[1].rules[0].reason: "max_items"'],
      ['a camel-case word', 'The limit comes from maxItems in the form.', 'screens[0].fields[1].rules[0].reason: "maxItems"'],
      ['a source file name', 'The limit is set in order-form.js and is lower.', 'screens[0].fields[1].rules[0].reason: "order-form.js"'],
    ])('rejects %s, then accepts plain words', (_, reason, line) => {
      const run = confirmedRun();
      const before = snapshot(run);
      const bad = attempt(run, contradict(reason));
      expect(bad.status, bad.stdout).toBe(1);
      expect(bad.stdout).toContain(`part 1a: ${line}`);
      untouched(run, before);
      const good = attempt(run, contradict('The code caps the count at fifty.'));
      expect(good.status, good.stdout).toBe(0);
    });

    it('rejects a reason that names the file it points at or a cited file', () => {
      const run = confirmedRun();
      const bad = attempt(run, contradict(`The cap is in ${form} at line 6.`));
      expect(bad.status).toBe(1);
      expect(bad.stdout).toContain(`part 1a: screens[0].fields[1].rules[0]: the reason names the file ${form}`);
      expect(stateOf(run).status).toBe('confirmed');
    });

    it('does not gate the reason of a holds verdict: it is not shown to readers', () => {
      const run = confirmedRun();
      const result = attempt(run, (_, verdicts) => { verdicts[2].reason = 'Read capCount(items) in max_items.js and found nothing against it.'; });
      expect(result.status, result.stdout).toBe(0);
      expect(result.lines).toEqual(['F1: verified (8 items)']);
    });
  });
});

describe('trace-verdicts: the reason in a run in a language with its own script', () => {
  function chineseRun() {
    const run = makeRun();
    cleanups.push(run.cleanup);
    run.writeJson(join(run.out, 'ui.json'), translatedUi('Chinese'));
    run.writeMap(markedMap(run.map, 'Chinese'));
    expect(run.run('check-map').status).toBe(0);
    run.writeEntry('F1', markedEntry(run.entry));
    expect(run.run('check-entry', 'F1').status).toBe(0);
    confirmChecked(run);
    return run;
  }
  const contradict = (reason) => (_, verdicts) => {
    verdicts[2] = { id: 'screens[0].fields[1].rules[0]', verdict: 'contradicted', reason, at: [AT] };
  };

  it('rejects a reason of a contradicted verdict written only in ASCII letters, then accepts one with a letter of the language', () => {
    const run = chineseRun();
    const bad = traceFeature(run, 'F1', () => 'holds', contradict('The code caps the count at fifty.'));
    expect(bad.status, bad.stdout).toBe(1);
    expect(bad.stdout).toContain("part 1a: screens[0].fields[1].rules[0].reason: written only in ASCII letters; the run's language is Chinese; write it in that language (labels quoted from the source stay as they are)");
    expect(stateOf(run).status).toBe('confirmed');
    const good = traceFeature(run, 'F1', () => 'holds', contradict(`${MARK}The code caps the count at fifty.`));
    expect(good.status, good.stdout).toBe(0);
    expect(good.lines).toEqual(['F1: verified, 1 item removed']);
  });

  it('does not ask a holds verdict to be written in the language', () => {
    const run = chineseRun();
    const result = traceFeature(run, 'F1', () => 'holds');
    expect(result.status, result.stdout).toBe(0);
  });
});

describe('trace-verdicts: recording', () => {
  it('verifies the feature when every item holds, removing nothing', () => {
    const run = confirmedRun();
    const result = traceFeature(run, 'F1');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['F1: verified (8 items)']);
    const state = stateOf(run);
    expect(state.status).toBe('verified');
    expect(state.attempts).toBe(0);
    expect(state.removed).toBeUndefined();
    expect(state.failure).toBeUndefined();
    expect(typeof state.entryDigest).toBe('string');
    expect(run.run('assemble').status).toBe(0);
    expect(readFileSync(join(run.out, 'handbook.md'), 'utf-8')).toContain('At most 35,000 items.');
  });

  it('keeps what round 2 removed when every traced item holds', () => {
    const run = checkedRun();
    expect(judge(run, 'F1', 1, (item) => (item.id === 'states[1]' ? 'unverified' : 'verified')).status).toBe(0);
    expect(judge(run, 'F1', 2, () => ({ verdict: 'unverified', reason: 'No line shown names the state.' })).status).toBe(0);
    const result = traceFeature(run, 'F1');
    expect(result.lines).toEqual(['F1: verified (7 items)']);
    expect(stateOf(run).removed.map((record) => record.path)).toEqual(['states[1]']);
  });

  it('removes an item both tracers contradicted, records the step, the reasons and the position once, and writes the trimmed entry', () => {
    const run = confirmedRun();
    const reason = 'The code lets in at most fifty items, not 35,000.';
    const result = traceFeature(run, 'F1', (item) => (item.id === 'screens[0].fields[1].rules[0]'
      ? { verdict: 'contradicted', reason, at: [{ file: form, line: 6 }] }
      : 'holds'));
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['F1: verified, 1 item removed']);
    const state = stateOf(run);
    expect(state.status).toBe('verified');
    expect(state.removed).toEqual([{
      path: 'screens[0].fields[1].rules[0]',
      claim: 'Screen: New Order > Field: Item Count > Backend rules > At most 35,000 items.',
      verdict: 'contradicted',
      reason,
      reasons: [reason, reason],
      step: 'trace',
      at: [{ file: form, line: 6 }],
    }]);
    const entry = JSON.parse(entryText(run));
    expect(entry.screens[0].fields[1].rules.map((rule) => rule.text)).toEqual(['An upload may hold up to 100,000 bytes.']);
    // The state's digest is the trimmed file's: assemble accepts it.
    const assembled = run.run('assemble');
    expect(assembled.status, assembled.stdout).toBe(0);
  });

  it('lists a trace removal in the coverage section with its reason and no position, and keeps it out of the body', () => {
    const run = confirmedRun();
    const reason = 'The code lets in at most fifty items.';
    expect(traceFeature(run, 'F1', (item) => (item.id === 'screens[0].fields[1].rules[0]'
      ? { verdict: 'contradicted', reason, at: [{ file: form, line: 6 }] }
      : 'holds')).status).toBe(0);
    expect(run.run('assemble').status).toBe(0);
    const text = readFileSync(join(run.out, 'handbook.md'), 'utf-8');
    const [body, coverage] = text.split('## Coverage');
    expect(body).toContain('Customer Name');
    expect(body).not.toContain('At most 35,000 items.');
    expect(coverage).toContain('At most 35,000 items.');
    expect(coverage).toContain(reason);
    expect(coverage).toContain('The code shown says otherwise');
    expect(text).not.toContain(form);
    expect(text).not.toContain('order-form');
    expect(text).not.toMatch(/:\s*6\b.*order/);
  });

  it('takes what hangs on a contradicted item with it and records it as removed together with it', () => {
    // An operation whose every step is contradicted goes, and its other parts with it.
    const run = confirmedRun((_, entry) => {
      entry.operations[0].triggers = [{ text: 'The clerk opens the new order form.', evidence: [ev(form, "title: 'New Order',")] }];
    });
    const result = traceFeature(run, 'F1', (item) => (item.id.startsWith('operations[0].sentences')
      ? { verdict: 'contradicted', reason: 'The order is not placed this way.', at: [AT] }
      : 'holds'));
    expect(result.lines).toEqual(['F1: verified, 4 items removed']);
    const removed = stateOf(run).removed;
    expect(removed.map((record) => [record.path, record.verdict, record.step])).toEqual([
      ['operations[0].sentences[0]', 'contradicted', 'trace'],
      ['operations[0].sentences[1]', 'contradicted', 'trace'],
      ['operations[0].triggers[0]', 'withParent', 'trace'],
      ['operations[0]', 'withParent', 'trace'],
    ]);
    expect(removed[2].reason).toBe('');
    expect(removed[2].at).toBeUndefined();
  });

  it('appends to what round 2 removed and leaves those records as they were', () => {
    const run = checkedRun();
    expect(judge(run, 'F1', 1, (item) => (item.id === 'states[1]' ? 'unverified' : 'verified')).status).toBe(0);
    expect(judge(run, 'F1', 2, () => ({ verdict: 'unverified', reason: 'No line shown names the state.' })).status).toBe(0);
    const first = clone(stateOf(run).removed);
    const result = traceFeature(run, 'F1', (item) => (item.id === 'states[0]' ? { verdict: 'contradicted', reason: 'The order starts in another state.', at: [AT] } : 'holds'));
    expect(result.lines).toEqual(['F1: verified, 1 item removed']);
    const removed = stateOf(run).removed;
    expect(removed).toHaveLength(2);
    expect(removed[0]).toEqual(first[0]);
    expect(removed[1]).toMatchObject({ path: 'states[0]', step: 'trace', verdict: 'contradicted' });
  });

  it('keeps the items the verifiers alone settle when every traced item is contradicted, and the feature stays verified', () => {
    // Design D5 of handbook-deep-entry: the purpose, the navigation path, the screen and the field labels are not
    // traced, so a feature whose every traced item goes still holds them and is not failed.
    const run = confirmedRun();
    const result = traceFeature(run, 'F1', () => ({ verdict: 'contradicted', reason: 'The code says something else.', at: [AT] }));
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['F1: verified, 9 items removed']);
    const state = stateOf(run);
    expect(state.status).toBe('verified');
    expect(state.removed.filter((record) => record.step === 'trace' && record.verdict === 'contradicted')).toHaveLength(8);
    expect(state.removed.filter((record) => record.step === 'trace' && record.verdict === 'withParent').map((record) => record.path)).toEqual(['operations[0]']);
    const entry = JSON.parse(entryText(run));
    expect([entry.purpose.text, entry.where.length, entry.screens[0].fields.map((field) => field.label)]).toEqual(['Staff place new orders for customers.', 2, ['Customer Name', 'Item Count']]);
    expect([entry.who, entry.operations, entry.states]).toEqual([[], [], []]);
  });

  it('puts the removal of a feature that failed at trace in the coverage section like the others', () => {
    const run = confirmedRun();
    traceFeature(run, 'F1', () => ({ verdict: 'contradicted', reason: 'The code says something else.', at: [AT] }));
    expect(run.run('assemble').status).toBe(0);
    const text = readFileSync(join(run.out, 'handbook.md'), 'utf-8');
    expect(text).toContain('The code says something else.');
    expect(text).not.toContain(form);
  });

  it('does not trace the purpose: a verdict for it is refused as not an item of the trace file, and the purpose stays', () => {
    const run = confirmedRun();
    const bad = traceFeature(run, 'F1', () => 'holds', (_, verdicts) => verdicts.push({ id: 'purpose', verdict: 'contradicted', reason: 'Nobody places orders here.', at: [AT] }));
    expect(bad.status).toBe(1);
    expect(bad.lines).toContain('part 1a: purpose: is not an item of the trace file');
    const good = traceFeature(run, 'F1');
    expect(good.lines).toEqual(['F1: verified (8 items)']);
    expect(JSON.parse(entryText(run)).purpose.text).toBe('Staff place new orders for customers.');
  });
});

describe('trace-verdicts: two tracers per part, an item is removed when either contradicts it', () => {
  const RULE = 'screens[0].fields[1].rules[0]';
  const REASON_A = 'The code lets in at most fifty items.';
  const REASON_B = 'The count is cut to the first hundred before it is checked.';
  const contradicting = (reason, at) => (item) => (item.id === RULE ? { verdict: 'contradicted', reason, at } : 'holds');
  const snapshot = (run) => ({ entry: entryText(run), state: JSON.stringify(stateOf(run)) });

  it('removes an item only b contradicted, with b\'s reason, one reasons entry and b\'s at', () => {
    const run = confirmedRun();
    const result = traceFeature(run, 'F1', () => 'holds', () => {}, contradicting(REASON_B, [{ file: form, line: 9 }]));
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['F1: verified, 1 item removed']);
    const [record, ...rest] = stateOf(run).removed;
    expect(rest).toEqual([]);
    expect(record).toMatchObject({ path: RULE, verdict: 'contradicted', reason: REASON_B, reasons: [REASON_B], step: 'trace', at: [{ file: form, line: 9 }] });
  });

  it('removes an item only a contradicted the same way, with a\'s reason only', () => {
    const run = confirmedRun();
    const result = traceFeature(run, 'F1', contradicting(REASON_A, [AT]), () => {}, () => 'holds');
    expect(result.status, result.stdout).toBe(0);
    expect(stateOf(run).removed[0]).toMatchObject({ path: RULE, reason: REASON_A, reasons: [REASON_A], at: [AT] });
  });

  it('keeps a\'s reason first when both contradict, lists both reasons, and keeps a position both gave once', () => {
    const run = confirmedRun();
    const atA = [AT, { file: form, line: 9 }];
    const atB = [{ file: form, line: 9 }, { file: form, line: 3 }, { file: 'src/forms/other.js', line: 1 }];
    mkdirSync(join(run.root, 'src', 'forms'), { recursive: true });
    writeFileSync(join(run.root, 'src', 'forms', 'other.js'), 'const x = 1;\n');
    const result = traceFeature(run, 'F1', contradicting(REASON_A, atA), () => {}, contradicting(REASON_B, atB));
    expect(result.status, result.stdout).toBe(0);
    const [record] = stateOf(run).removed;
    expect(record.reason).toBe(REASON_A);
    expect(record.reasons).toEqual([REASON_A, REASON_B]);
    expect(record.at).toEqual([AT, { file: form, line: 9 }, { file: form, line: 3 }, { file: 'src/forms/other.js', line: 1 }]);
  });

  it('reduces every at entry to file and line', () => {
    const run = confirmedRun();
    const result = traceFeature(run, 'F1', contradicting(REASON_A, [{ ...AT, note: 'extra' }]), () => {}, () => 'holds');
    expect(result.status, result.stdout).toBe(0);
    expect(stateOf(run).removed[0].at).toEqual([AT]);
  });

  it('removes nothing when both tracers say holds, and records no reasons', () => {
    const run = confirmedRun();
    const result = traceFeature(run, 'F1');
    expect(result.lines).toEqual(['F1: verified (8 items)']);
    expect(stateOf(run).removed).toBeUndefined();
  });

  it('gives a record of the earlier step no reasons', () => {
    const run = checkedRun();
    expect(judge(run, 'F1', 1, (item) => (item.id === 'states[1]' ? 'unverified' : 'verified')).status).toBe(0);
    expect(judge(run, 'F1', 2, () => ({ verdict: 'unverified', reason: 'No line shown names the state.' })).status).toBe(0);
    expect(stateOf(run).removed[0].reasons).toBeUndefined();
  });

  it('shows the reader the reason of the first contradicting tracer only', () => {
    const run = confirmedRun();
    expect(traceFeature(run, 'F1', () => 'holds', () => {}, contradicting(REASON_B, [AT])).status).toBe(0);
    expect(run.run('assemble').status).toBe(0);
    const text = readFileSync(join(run.out, 'handbook.md'), 'utf-8');
    expect(text).toContain(REASON_B);
    expect(text).not.toContain(form);
  });

  it('records nothing and names exactly 1b when the b file is missing', () => {
    const run = confirmedRun();
    const before = snapshot(run);
    const traced = run.run('trace', 'F1');
    expect(traced.status).toBe(0);
    mkdirSync(join(run.out, 'trace-verdicts', 'F1'), { recursive: true });
    writeFileSync(verdictPath(run, 1, 'F1', 'a'), `${JSON.stringify({ verdicts: readTrace(run).items.map((item) => ({ id: item.id, verdict: 'holds', reason: `Looked at ${item.id}.` })) })}\n`);
    const result = run.run('trace-verdicts', 'F1');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('part 1b: trace-verdicts/F1/part-1.b.json is missing');
    expect(result.lines.at(-1)).toMatch(/^Next: dispatch the tracer once more for F1 for exactly the missing part: 1b,/);
    expect(snapshot(run)).toEqual(before);
  });

  it('rejects a b file whose at leaves the project although a is valid, led by part 1b, and records nothing', () => {
    const run = confirmedRun();
    const before = snapshot(run);
    writeFileSync(join(run.base, 'outside.js'), 'const x = 1;\n');
    const result = traceFeature(run, 'F1', () => 'holds', () => {}, contradicting(REASON_B, [{ file: '../outside.js', line: 1 }]));
    expect(result.status).toBe(1);
    expect(result.lines).toContain(`part 1b: ${RULE}: at[0]: ../outside.js leaves the project`);
    expect(result.lines.filter((line) => line.startsWith('part 1a:'))).toEqual([]);
    expect(result.lines.at(-1)).toBe('Next: delete the verdict file of part 1b and dispatch the tracer once more for part 1b with the lines above; nothing was recorded');
    expect(snapshot(run)).toEqual(before);
  });

  it('checks the two files on their own: a problem in each is reported under its own letter', () => {
    const run = confirmedRun();
    const spoil = (_, verdicts) => verdicts.splice(2, 1);
    const result = traceFeature(run, 'F1', () => 'holds', spoil, () => 'holds', spoil);
    expect(result.status).toBe(1);
    expect(result.lines).toContain('part 1a: screens[0].fields[1].rules[0]: no verdict');
    expect(result.lines).toContain('part 1b: screens[0].fields[1].rules[0]: no verdict');
    expect(result.lines.at(-1)).toBe('Next: delete the verdict files of parts 1a and 1b and dispatch the tracer once more for parts 1a and 1b with the lines above; nothing was recorded');
  });

  it('applies the reader-text gate to the contradicted reason of b', () => {
    const run = confirmedRun();
    const result = traceFeature(run, 'F1', () => 'holds', () => {}, contradicting('The limit comes from maxItems in the form.', [AT]));
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toContain(`part 1b: ${RULE}.reason: "maxItems"`);
  });

  it('rejects the same holds reason twice within the b file, and accepts the same reason across a and b', () => {
    const SAME = 'Read the function that picks the reviewers and the query it runs: it selects every active member.';
    const across = traceFeature(confirmedRun(), 'F1', () => 'holds', (_, verdicts) => { verdicts[0].reason = SAME; }, () => 'holds', (_, verdicts) => { verdicts[0].reason = SAME; });
    expect(across.status, across.stdout).toBe(0);
    const run = confirmedRun();
    const within = traceFeature(run, 'F1', () => 'holds', () => {}, () => 'holds', (_, verdicts) => { verdicts[0].reason = SAME; verdicts[2].reason = SAME; });
    expect(within.status).toBe(1);
    expect(within.lines).toContain('part 1b: screens[0].fields[1].rules[0]: the same holds reason as who[0]: trace each item on its own');
    expect(stateOf(run).status).toBe('confirmed');
  });
});

describe('a confirmed feature is not finished: assemble, page and reply list it so', () => {
  it('keeps it out of the handbook body and lists it in the coverage section as not finished', () => {
    const run = confirmedRun();
    const result = run.run('assemble');
    expect(result.status, result.stdout).toBe(0);
    const text = readFileSync(join(run.out, 'handbook.md'), 'utf-8');
    const [body, coverage] = text.split('## Coverage');
    expect(body).not.toContain('Customer Name');
    expect(body).not.toContain('Staff place new orders');
    expect(coverage).toContain('F1');
    expect(coverage).toContain('Written, final check not finished');
  });

  it('counts it on its own in the reply line', () => {
    const run = confirmedRun();
    expect(run.run('assemble').status).toBe(0);
    const result = run.run('reply');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[2]).toBe('Features: 5 (planned 4, dispatched 0, checked 0, confirmed 1, verified 0, failed 0)');
  });

  it('refuses the run when the confirmed entry changed after it was confirmed', () => {
    const run = confirmedRun();
    const entry = JSON.parse(entryText(run));
    entry.states[0].meaning = 'The order is not sent yet, by anyone.';
    run.writeEntry('F1', entry);
    const result = run.run('assemble');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('F1: entries/F1.json changed after it was confirmed');
  });

  it('does not refuse a confirmed entry that is as it was confirmed, and refuses one that no longer passes check-entry', () => {
    const run = confirmedRun();
    expect(run.run('assemble').status).toBe(0);
    const entry = JSON.parse(entryText(run));
    entry.who[0].role = 'Nobody';
    run.writeEntry('F1', entry);
    const result = run.run('assemble');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('F1: entries/F1.json no longer passes check-entry');
  });

  it('gives the page data the status and no entry', () => {
    const run = confirmedRun();
    const stubPath = join(run.base, 'template.html');
    writeFileSync(stubPath, '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>');
    const page = runHandbook(['page', run.out, '--project', run.root], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
    expect(page.status, page.stdout + page.stderr).toBe(0);
    const html = readFileSync(join(run.out, 'handbook.html'), 'utf-8');
    const data = JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(html)[1]);
    expect(data.features[0]).toMatchObject({ id: 'F1', status: 'confirmed', entry: null });
    expect(data.ui.strings['md.status.confirmed']).toBe('Written, final check not finished');
    expect(html).not.toContain('Staff place new orders');
  });
});
