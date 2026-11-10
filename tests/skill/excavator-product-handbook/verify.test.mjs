// Design D14 of openspec change product-handbook-map: `slices` cuts a checked
// entry into items with their claim and the source around each cited passage;
// `verdicts` records the verifier's verdicts (one per item, nothing recorded
// when that does not hold), lists every item not both verified for a rewrite
// (round 1 removes nothing; the rewrite may narrow a claim but never rename),
// and after round 2 removes what is still not verified. Every rejection is paired with a
// control that passes.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { MARK, clone, judge, makeCheckedMapRun, markedEntry, markedMap, traceFeature, translatedUi, verifyChecked } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const ev = (file, passage) => ({ file, passage });
const form = 'src/forms/order-form.js';
const LONG = 'src/long.js';

/** A run whose F1 entry (adjusted by `adjust`) passed check-entry. */
function checkedRun(adjust) {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  const entry = clone(run.entry);
  adjust?.(entry, run);
  run.writeEntry('F1', entry);
  const checked = run.run('check-entry', 'F1');
  expect(checked.status, checked.stdout).toBe(0);
  return run;
}

const verifyPath = (run, round = 1, id = 'F1', part = 1) => join(run.out, 'verify', `round-${round}`, id, `part-${part}.json`);
const verdictPath = (run, round = 1, id = 'F1', part = 1, letter = 'a') => join(run.out, 'verdicts', `round-${round}`, id, `part-${part}.${letter}.json`);
const readVerify = (run, round = 1) => JSON.parse(readFileSync(verifyPath(run, round), 'utf-8'));
const rewritePath = (run, id = 'F1') => join(run.out, 'rewrite', `${id}.json`);
const stateOf = (run, id = 'F1') => run.readJson('state.json').features[id];
const ids = (verify) => verify.items.map((item) => item.id);

/** Both verifiers of the part give the same verdicts. */
function writeVerdicts(run, round, verdicts, part = 1) {
  mkdirSync(join(run.out, 'verdicts', `round-${round}`, 'F1'), { recursive: true });
  for (const letter of ['a', 'b']) writeFileSync(verdictPath(run, round, 'F1', part, letter), `${JSON.stringify({ verdicts }, null, 2)}\n`);
}

/** A source file of 100 numbered lines with three markers, at lines 10, 51 and 95. */
function writeLongSource(run) {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
  lines[9] = 'marker-a';
  lines[50] = 'marker-b';
  lines[94] = 'marker-c';
  writeFileSync(join(run.root, LONG), `${lines.join('\n')}\n`);
}

const ALL_ITEMS = [
  'purpose', 'who[0]', 'where[0]', 'where[1]', 'screens[0]',
  'screens[0].fields[0]', 'screens[0].fields[0].rules[0]',
  'screens[0].fields[1]', 'screens[0].fields[1].rules[0]', 'screens[0].fields[1].rules[1]',
  'operations[0].sentences[0]', 'operations[0].sentences[1]', 'states[0]', 'states[1]',
];

describe('slices: which features', () => {
  it('refuses a feature whose entry has not passed check-entry, with a Next line', () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    run.writeEntry();
    const planned = run.run('slices', 'F1');
    expect(planned.status).toBe(1);
    expect(planned.lines[0]).toMatch(/^F1: .*planned/);
    expect(planned.lines.at(-1)).toMatch(/^Next: /);
    expect(existsSync(verifyPath(run))).toBe(false);
    expect(run.run('check-entry', 'F1').status).toBe(0);
    expect(run.run('slices', 'F1').status).toBe(0);
  });

  it('refuses a feature that is not in the map, as a usage error', () => {
    const run = checkedRun();
    expect(run.run('slices', 'F9').status).toBe(2);
  });

  it('refuses a feature that is failed', () => {
    const run = checkedRun();
    run.writeEntry('F1', { ...clone(run.entry), who: [{ role: 'Boss', can: 'x', evidence: run.entry.who[0].evidence }] });
    expect(run.run('check-entry', 'F1').status).toBe(1);
    const result = run.run('slices', 'F1');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toMatch(/failed/);
  });
});

describe('slices: the verify file of round 1', () => {
  it('writes one item per entry item with evidence, named by its JSON path, and prints the two paths', () => {
    const run = checkedRun();
    const result = run.run('slices', 'F1');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('F1: round 1, 14 items in 1 part');
    expect(result.lines[1]).toBe(`Part 1/1: Verify file: ${verifyPath(run)} | Verdict files: ${verdictPath(run, 1, 'F1', 1, 'a')} ${verdictPath(run, 1, 'F1', 1, 'b')}`);
    expect(result.lines).toHaveLength(3);
    expect(result.lines[2]).toMatch(/^Next: dispatch two excavator-handbook-verifier subagents for each part of F1/);
    const verify = readVerify(run);
    expect(Object.keys(verify)).toEqual(['feature', 'round', 'part', 'parts', 'items']);
    expect(verify.feature).toBe('F1');
    expect(verify.round).toBe(1);
    expect(verify.part).toBe(1);
    expect(verify.parts).toBe(1);
    expect(ids(verify)).toEqual(ALL_ITEMS);
    for (const item of verify.items) {
      expect(Object.keys(item)).toEqual(['id', 'claim', 'evidence']);
      expect(item.evidence.length).toBeGreaterThan(0);
      for (const block of item.evidence) expect(Object.keys(block)).toEqual(['file', 'lines', 'code']);
    }
  });

  it('skips unknowns and the operation name, which has no evidence of its own', () => {
    const run = checkedRun();
    run.run('slices', 'F1');
    const verify = readVerify(run);
    expect(ids(verify)).not.toContain('operations[0]');
    expect(ids(verify).some((id) => id.startsWith('unknowns'))).toBe(false);
  });

  it('gives each claim the context a reader needs: side, screen and field; the operation name; role and can; the four notification parts', () => {
    const run = checkedRun((entry) => {
      entry.notifications.push({
        trigger: 'An order is sent', recipient: 'The approver', channel: 'Message', content: 'A new order waits.',
        evidence: [ev(form, "const statuses = ['Draft', 'Submitted'];")],
      });
      entry.automatic.push({ when: 'Every night', effect: 'Drafts are cleared.', evidence: [ev(form, "const statuses = ['Draft', 'Submitted'];")] });
    });
    run.run('slices', 'F1');
    const claim = (id) => readVerify(run).items.find((item) => item.id === id).claim;
    expect(claim('screens[0].fields[1].rules[0]')).toBe('Screen: New Order > Field: Item Count > Backend rules > At most 35,000 items.');
    expect(claim('screens[0].fields[1].rules[1]')).toBe('Screen: New Order > Field: Item Count > Frontend rules > An upload may hold up to 100,000 bytes.');
    expect(claim('screens[0].fields[0]')).toBe('Screen: New Order > Field: Customer Name');
    expect(claim('operations[0].sentences[1]')).toBe('Operations > Place an order > The item count is limited to 35000.');
    expect(claim('who[0]')).toBe('Roles > Clerk: Create an order.');
    expect(claim('states[0]')).toBe('State: Draft; Meaning: The order is not sent yet.');
    expect(claim('notifications[0]')).toBe('Trigger: An order is sent; Recipient: The approver; Channel: Message; Content: A new order waits.');
    expect(claim('automatic[0]')).toBe('Automatic behavior > Every night: Drafts are cleared.');
    expect(claim('purpose')).toBe('Purpose > Staff place new orders for customers.');
  });

  it('writes the claim connecting words from the run\'s fixed-text table', () => {
    const run = checkedRun();
    const table = JSON.parse(readFileSync(join(process.cwd(), 'skills/excavator-product-handbook/ui-strings.json'), 'utf-8'));
    table.strings['md.table.backendRules'] = 'Server rules';
    run.writeJson(join(run.out, 'ui.json'), table);
    expect(run.run('slices', 'F1').status).toBe(0);
    expect(readVerify(run).items.find((item) => item.id === 'screens[0].fields[1].rules[0]').claim).toContain('Server rules');
  });
});

describe('slices: the code around each cited passage', () => {
  /** An entry whose purpose cites the three markers of the long source, and nothing else changed. */
  const longRun = () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    writeLongSource(run);
    const entry = clone(run.entry);
    entry.purpose.evidence = [ev(LONG, 'marker-a'), ev(LONG, 'marker-b'), ev(LONG, 'marker-c')];
    run.writeEntry('F1', entry);
    expect(run.run('check-entry', 'F1').status).toBe(0);
    expect(run.run('slices', 'F1').status).toBe(0);
    return run;
  };

  it('shows 20 lines before and after, clamped to the file, adjacent ranges merged and a gap kept apart', () => {
    const run = longRun();
    const blocks = readVerify(run).items.find((item) => item.id === 'purpose').evidence;
    // marker-a (line 10) shows 1-30, marker-b (line 51) shows 31-71 and is adjacent, marker-c (line 95) shows 75-100.
    expect(blocks.map((block) => [block.file, block.lines])).toEqual([[LONG, '1-71'], [LONG, '75-100']]);
  });

  it('prefixes every line with its number and keeps the cited text', () => {
    const run = longRun();
    const [first, second] = readVerify(run).items.find((item) => item.id === 'purpose').evidence;
    const lines = first.code.split('\n');
    expect(lines).toHaveLength(71);
    expect(lines[0]).toBe('1: line 1');
    expect(lines[9]).toBe('10: marker-a');
    expect(lines[50]).toBe('51: marker-b');
    expect(lines.at(-1)).toBe('71: line 71');
    expect(second.code.split('\n')[0]).toBe('75: line 75');
    expect(second.code).toContain('95: marker-c');
    expect(second.code.endsWith('100: line 100')).toBe(true);
  });

  it('shows a passage of two lines from its first to its last line, 20 more after the last', () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    writeLongSource(run);
    const entry = clone(run.entry);
    entry.purpose.evidence = [ev(LONG, 'line 60\nline 61')];
    run.writeEntry('F1', entry);
    expect(run.run('check-entry', 'F1').status).toBe(0);
    run.run('slices', 'F1');
    const [block] = readVerify(run).items.find((item) => item.id === 'purpose').evidence;
    expect(block.lines).toBe('40-81');
    expect(block.code.split('\n').at(-1)).toBe('81: line 81');
  });

  it('does not merge ranges of two files, and gives one block per file when the item cites two', () => {
    const run = checkedRun((entry) => {
      entry.purpose.evidence = [ev(form, "title: 'New Order',"), ev('src/roles.js', "const ROLES = ['Clerk', 'Approver'];")];
    });
    run.run('slices', 'F1');
    const blocks = readVerify(run).items.find((item) => item.id === 'purpose').evidence;
    expect(blocks.map((block) => block.file)).toEqual([form, 'src/roles.js']);
    expect(blocks[0].lines).toBe('1-12');
    expect(blocks[1].code).toBe("1: const ROLES = ['Clerk', 'Approver'];\n2: \n3: module.exports = ROLES;");
  });

  it('shows a passage that spans several lines from its first to its last line', () => {
    const run = checkedRun((entry) => {
      entry.purpose.evidence = [ev(form, "const MAX_UPLOAD = 100_000;\nconst statuses = ['Draft', 'Submitted'];")];
    });
    run.run('slices', 'F1');
    const [block] = readVerify(run).items.find((item) => item.id === 'purpose').evidence;
    expect(block.lines).toBe('1-12');
    expect(block.code).toContain("9: const MAX_UPLOAD = 100_000;");
  });
});

describe('slices: round 1 keeps a snapshot, and the output is deterministic', () => {
  it('saves the entry as verify/round-1/<id>.entry.json', () => {
    const run = checkedRun();
    run.run('slices', 'F1');
    const snapshot = JSON.parse(readFileSync(join(run.out, 'verify', 'round-1', 'F1.entry.json'), 'utf-8'));
    expect(snapshot).toEqual(run.entry);
  });

  it('gives the same bytes when run twice', () => {
    const run = checkedRun();
    run.run('slices', 'F1');
    const first = readFileSync(verifyPath(run));
    run.run('slices', 'F1');
    expect(readFileSync(verifyPath(run)).equals(first)).toBe(true);
  });
});

describe('verdicts: conservation', () => {
  const setup = () => {
    const run = checkedRun();
    run.run('slices', 'F1');
    return run;
  };
  const all = (verdict = 'verified') => ALL_ITEMS.map((id) => ({ id, verdict, reason: 'The code shown decides it.' }));

  it('records nothing and says to dispatch the verifier once more when the verdict file is missing', () => {
    const run = setup();
    const result = run.run('verdicts', 'F1', '--round', '1');
    expect(result.status).toBe(1);
    expect(result.lines.at(-1)).toMatch(/^Next: dispatch the verifier once more/);
    expect(stateOf(run).status).toBe('checked');
  });

  const rejects = (name, change, expected) => {
    it(name, () => {
      const run = setup();
      writeVerdicts(run, 1, change(all()));
      const bad = run.run('verdicts', 'F1', '--round', '1');
      expect(bad.status, bad.stdout).toBe(1);
      expect(bad.stdout).toMatch(expected);
      expect(stateOf(run)).toEqual({ status: 'checked', attempts: 0 });
      expect(existsSync(rewritePath(run))).toBe(false);
      // The control: the same file made whole passes.
      writeVerdicts(run, 1, all());
      const good = run.run('verdicts', 'F1', '--round', '1');
      expect(good.status, good.stdout).toBe(0);
      expect(stateOf(run).status).toBe('confirmed');
    });
  };

  rejects('rejects an item with no verdict and names it', (verdicts) => verdicts.filter((v) => v.id !== 'states[1]'), /states\[1\]: no verdict/);
  rejects('rejects an id that is not an item of the verify file', (verdicts) => [...verdicts, { id: 'states[7]', verdict: 'verified', reason: 'x' }], /states\[7\]: is not an item/);
  rejects('rejects an id given twice', (verdicts) => [...verdicts, { ...verdicts[0] }], /purpose: more than one verdict/);
  rejects('rejects a verdict that is not one of the three words', (verdicts) => verdicts.map((v) => (v.id === 'who[0]' ? { ...v, verdict: 'ok' } : v)), /who\[0\]: verdict "ok" is not one of verified, unverified, contradicted/);
  rejects('rejects an empty reason', (verdicts) => verdicts.map((v) => (v.id === 'purpose' ? { ...v, reason: '  ' } : v)), /purpose: the reason must be a non-empty string/);
  rejects('rejects a reason of more than one line', (verdicts) => verdicts.map((v) => (v.id === 'purpose' ? { ...v, reason: 'one\ntwo' } : v)), /purpose: the reason must be one line/);
  rejects('rejects a reason that names a cited file', (verdicts) => verdicts.map((v) => (v.id === 'purpose' ? { ...v, reason: `see ${form} line 3` } : v)), /purpose: the reason names the file src\/forms\/order-form\.js/);

  it('prints every problem at once', () => {
    const run = setup();
    writeVerdicts(run, 1, all().filter((v) => v.id !== 'states[1]' && v.id !== 'who[0]'));
    const bad = run.run('verdicts', 'F1', '--round', '1');
    expect(bad.stdout).toMatch(/states\[1\]: no verdict/);
    expect(bad.stdout).toMatch(/who\[0\]: no verdict/);
  });

  it('rejects a verdict file that is not JSON or has no verdicts array', () => {
    const run = setup();
    mkdirSync(join(run.out, 'verdicts', 'round-1', 'F1'), { recursive: true });
    writeFileSync(verdictPath(run), '{ nope');
    expect(run.run('verdicts', 'F1', '--round', '1').status).toBe(1);
    writeFileSync(verdictPath(run), '{"items": []}');
    const result = run.run('verdicts', 'F1', '--round', '1');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/part 1a: verdicts: must be an array/);
  });

  it('refuses when the entry or the source changed after slices (the verify file is stale)', () => {
    const run = setup();
    const entry = clone(run.entry);
    entry.who[0].can = 'Create orders.';
    run.writeEntry('F1', entry);
    writeVerdicts(run, 1, all());
    const result = run.run('verdicts', 'F1', '--round', '1');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/changed since slices/);
    expect(result.lines.at(-1)).toMatch(/^Next: run slices again/);
    expect(stateOf(run).status).toBe('checked');
  });

  it('refuses a feature that is not checked, and a round that is not 1 or 2', () => {
    const run = setup();
    writeVerdicts(run, 1, all());
    expect(run.run('verdicts', 'F1', '--round', '1').status).toBe(0);
    const again = run.run('verdicts', 'F1', '--round', '1');
    expect(again.status).toBe(1);
    expect(again.lines[0]).toMatch(/verified/);
    expect(run.run('verdicts', 'F1', '--round', '3').status).toBe(2);
  });
});

describe('verdicts: the reason of a verdict that is not verified is reader text', () => {
  const setup = () => {
    const run = checkedRun();
    run.run('slices', 'F1');
    return run;
  };
  const withReason = (id, verdict, reason) => ALL_ITEMS.map((item) => (item === id ? { id: item, verdict, reason } : { id: item, verdict: 'verified', reason: 'The code shown decides it.' }));

  const refused = (name, reason, expected) => {
    it(name, () => {
      const run = setup();
      writeVerdicts(run, 1, withReason('who[0]', 'contradicted', reason));
      const bad = run.run('verdicts', 'F1', '--round', '1');
      expect(bad.status, bad.stdout).toBe(1);
      expect(bad.stdout).toMatch(expected);
      expect(bad.lines.at(-1)).toMatch(/^Next: delete the verdict files of parts 1a and 1b and dispatch the verifier once more for parts 1a and 1b with the lines above/);
      expect(stateOf(run)).toEqual({ status: 'checked', attempts: 0 });
      expect(existsSync(rewritePath(run))).toBe(false);
      // The control: the same verdict with a plain reason is recorded.
      writeVerdicts(run, 1, withReason('who[0]', 'contradicted', 'The check at line 20 lets the approver in.'));
      expect(run.run('verdicts', 'F1', '--round', '1').status).toBe(0);
    });
  };

  refused('refuses a reason with an underscore identifier and names the verdict and the category', 'The check in is_admin lets the approver in.', /who\[0\]\.reason: "is_admin" is not allowed in reader text \(/);
  refused('refuses a reason with a camel-case code name', 'The function canCancel only lets the approver in.', /who\[0\]\.reason: "canCancel" is not allowed/);
  refused('refuses a reason with a call shape', 'The code calls check(role) first.', /who\[0\]\.reason: "check\(" is not allowed/);
  refused('refuses a reason with a path', 'See /api/orders for the guard.', /who\[0\]\.reason: "\/api\/orders" is not allowed/);

  it('does not gate the reason of a verified item, which no reader sees', () => {
    const run = setup();
    writeVerdicts(run, 1, ALL_ITEMS.map((id) => ({ id, verdict: 'verified', reason: 'Line 5 holds is_admin.' })));
    expect(run.run('verdicts', 'F1', '--round', '1').status).toBe(0);
  });

  it('prints the problem of every reason at once, each with its item', () => {
    const run = setup();
    writeVerdicts(run, 1, ALL_ITEMS.map((id) => (id === 'who[0]' || id === 'purpose' ? { id, verdict: 'unverified', reason: `Name ${id === 'purpose' ? 'is_x' : 'isY'} only.` } : { id, verdict: 'verified', reason: 'ok' })));
    const bad = run.run('verdicts', 'F1', '--round', '1');
    expect(bad.stdout).toMatch(/purpose\.reason: "is_x"/);
    expect(bad.stdout).toMatch(/who\[0\]\.reason: "isY"/);
  });

  it('lets a label of the map pass, as the entry check does', () => {
    const run = setup();
    writeVerdicts(run, 1, withReason('who[0]', 'contradicted', 'The WorkBoard menu line shows another role.'));
    const result = run.run('verdicts', 'F1', '--round', '1');
    expect(result.status, result.stdout).toBe(0);
  });

  it('lets a label that this entry verifies pass, and refuses it in a reason of an entry that does not verify it', () => {
    const run = checkedRun((entry, current) => {
      writeFileSync(join(current.root, 'src/extra.js'), "const provider = 'PayPal';\n");
      entry.states.push({ label: 'PayPal', meaning: 'Paid through the provider.', evidence: [ev('src/extra.js', "const provider = 'PayPal';")] });
    });
    // The label exists only in this entry; without the file the entry would not have passed.
    run.run('slices', 'F1');
    const items = readVerify(run).items.map((item) => item.id);
    const verdicts = items.map((id) => (id === 'states[2]' ? { id, verdict: 'unverified', reason: 'No line shows how PayPal is chosen.' } : { id, verdict: 'verified', reason: 'ok' }));
    writeVerdicts(run, 1, verdicts);
    const result = run.run('verdicts', 'F1', '--round', '1');
    expect(result.status, result.stdout).toBe(0);
    const other = setup();
    writeVerdicts(other, 1, withReason('who[0]', 'contradicted', 'No line shows how PayPal is chosen.'));
    expect(other.run('verdicts', 'F1', '--round', '1').stdout).toMatch(/who\[0\]\.reason: "PayPal" is not allowed/);
  });

  describe('in a run whose language has its own script', () => {
    const chineseRun = () => {
      const run = makeCheckedMapRun();
      cleanups.push(run.cleanup);
      run.writeJson(join(run.out, 'ui.json'), translatedUi('Chinese'));
      run.writeMap(markedMap(run.map));
      expect(run.run('check-map').status).toBe(0);
      run.writeEntry('F1', markedEntry(run.entry));
      expect(run.run('check-entry', 'F1').status).toBe(0);
      expect(run.run('slices', 'F1').status).toBe(0);
      return run;
    };
    const verdictsWith = (run, reason) => readVerify(run).items.map((item) => (item.id === 'who[0]' ? { id: item.id, verdict: 'contradicted', reason } : { id: item.id, verdict: 'verified', reason: 'ok' }));

    it('refuses a reason written only in ASCII letters, and accepts one that holds a letter of the language', () => {
      const run = chineseRun();
      writeVerdicts(run, 1, verdictsWith(run, 'The check at line 20 lets the approver in.'));
      const bad = run.run('verdicts', 'F1', '--round', '1');
      expect(bad.status, bad.stdout).toBe(1);
      expect(bad.stdout).toMatch(/who\[0\]\.reason: written only in ASCII letters; the run's language is Chinese/);
      expect(stateOf(run).status).toBe('checked');
      writeVerdicts(run, 1, verdictsWith(run, `${MARK} line 20`));
      expect(run.run('verdicts', 'F1', '--round', '1').status).toBe(0);
    });

    it('does not check the language of the reason in an English run', () => {
      const run = setup();
      writeVerdicts(run, 1, withReason('who[0]', 'contradicted', 'The check at line 20 lets the approver in.'));
      expect(run.run('verdicts', 'F1', '--round', '1').status).toBe(0);
    });
  });
});

describe('verdicts: round 1', () => {
  it('records the feature as confirmed at once when every item is verified, with the digest of its entry', () => {
    const run = checkedRun();
    const result = judge(run);
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('F1: confirmed (14 items)');
    const state = stateOf(run);
    expect(state.status).toBe('confirmed');
    expect(state.attempts).toBe(0);
    expect(state.entryDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(state.rewriting).toBeUndefined();
    expect(existsSync(rewritePath(run))).toBe(false);
  });

  it('writes every unverified item to the rewrite file and says what to do next', () => {
    const run = checkedRun();
    const result = judge(run, 'F1', 1, (item) => {
      if (item.id === 'who[0]') return { verdict: 'unverified', reason: 'No line shown names this role.' };
      if (item.id === 'states[1]') return { verdict: 'unverified', reason: 'No line shown names this state.' };
      return 'verified';
    });
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('F1: 2 items to rewrite');
    expect(result.lines).toContain(`Rewrite file: ${rewritePath(run)}`);
    expect(result.lines.at(-1)).toMatch(/^Next: dispatch one rewrite subagent for F1/);
    expect(result.lines.join('\n')).not.toMatch(/removed/);
    const rewrite = JSON.parse(readFileSync(rewritePath(run), 'utf-8'));
    expect(rewrite.feature).toBe('F1');
    expect(rewrite.items).toEqual([
      { id: 'who[0]', claim: 'Roles > Clerk: Create an order.', verdict: 'unverified', reason: 'No line shown names this role.' },
      { id: 'states[1]', claim: 'State: Submitted; Meaning: The order was sent.', verdict: 'unverified', reason: 'No line shown names this state.' },
    ]);
    expect(stateOf(run)).toEqual({ status: 'checked', attempts: 0, rewriting: true });
  });

  it('lists a contradicted item for the rewrite with its verdict and reason, and removes nothing', () => {
    const run = checkedRun();
    const before = readFileSync(join(run.out, 'entries', 'F1.json'), 'utf-8');
    const result = judge(run, 'F1', 1, (item) => {
      if (item.id === 'who[0]') return { verdict: 'contradicted', reason: 'The check lets Approver in, not Clerk.' };
      if (item.id === 'states[1]') return { verdict: 'unverified', reason: 'No line shown names this state.' };
      return 'verified';
    });
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines.slice(0, 2)).toEqual(['F1: 2 items to rewrite', `Rewrite file: ${rewritePath(run)}`]);
    expect(result.stdout).not.toMatch(/removed/);
    expect(result.lines.at(-1)).toMatch(/^Next: dispatch one rewrite subagent for F1/);
    expect(result.lines.at(-1)).not.toMatch(/citations only/);
    expect(JSON.parse(readFileSync(rewritePath(run), 'utf-8')).items).toEqual([
      { id: 'who[0]', claim: 'Roles > Clerk: Create an order.', verdict: 'contradicted', reason: 'The check lets Approver in, not Clerk.' },
      { id: 'states[1]', claim: 'State: Submitted; Meaning: The order was sent.', verdict: 'unverified', reason: 'No line shown names this state.' },
    ]);
    expect(readFileSync(join(run.out, 'entries', 'F1.json'), 'utf-8')).toBe(before);
    expect(stateOf(run)).toEqual({ status: 'checked', attempts: 0, rewriting: true });
    expect(run.run('check-entry', 'F1').status).toBe(0);
    expect(stateOf(run).removed).toBeUndefined();
  });

  it('lists a contradicted field and an unverified rule under another field, each under its own path, and keeps the entry whole', () => {
    const run = checkedRun();
    const result = judge(run, 'F1', 1, (item) => {
      if (item.id === 'screens[0].fields[0]') return { verdict: 'contradicted', reason: 'The field is not on this screen.' };
      if (item.id === 'screens[0].fields[1].rules[1]') return { verdict: 'unverified', reason: 'No line shown gives this limit.' };
      return 'verified';
    });
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('F1: 2 items to rewrite');
    expect(JSON.parse(readFileSync(rewritePath(run), 'utf-8')).items.map((item) => [item.id, item.verdict])).toEqual([
      ['screens[0].fields[0]', 'contradicted'], ['screens[0].fields[1].rules[1]', 'unverified'],
    ]);
    const entry = JSON.parse(readFileSync(join(run.out, 'entries', 'F1.json'), 'utf-8'));
    expect(entry.screens[0].fields.map((field) => field.label)).toEqual(['Customer Name', 'Item Count']);
  });

  it('lists a contradicted purpose with the other items; the entry keeps its purpose until round 2 settles it', () => {
    const run = checkedRun();
    const result = judge(run, 'F1', 1, (item) => {
      if (item.id === 'purpose') return { verdict: 'contradicted', reason: 'The form is not about customers.' };
      if (item.id === 'who[0]') return { verdict: 'unverified', reason: 'No line shown names this role.' };
      return 'verified';
    });
    expect(result.status, result.stdout).toBe(0);
    expect(Object.hasOwn(JSON.parse(readFileSync(join(run.out, 'entries', 'F1.json'), 'utf-8')), 'purpose')).toBe(true);
    rewrite(run, (entry) => { entry.who[0].evidence.push(ev(form, "title: 'New Order',")); });
    expect(run.run('slices', 'F1', '--round', '2').status).toBe(0);
    expect(judge(run, 'F1', 2, (item) => (item.id === 'purpose' ? { verdict: 'contradicted', reason: 'Still not about customers.' } : 'verified')).status).toBe(0);
    expect(stateOf(run).removed.map((item) => [item.path, item.verdict])).toEqual([['purpose', 'contradicted']]);
    expect(stateOf(run).status).toBe('confirmed');
  });

  it('lists every item when all are contradicted: round 1 cannot fail the feature, round 2 can', () => {
    const run = checkedRun();
    const before = readFileSync(join(run.out, 'entries', 'F1.json'), 'utf-8');
    const result = judge(run, 'F1', 1, () => ({ verdict: 'contradicted', reason: 'The code says something else.' }));
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('F1: 14 items to rewrite');
    const state = stateOf(run);
    expect(state).toEqual({ status: 'checked', attempts: 0, rewriting: true });
    expect(JSON.parse(readFileSync(rewritePath(run), 'utf-8')).items.map((item) => item.id)).toEqual(ALL_ITEMS);
    expect(readFileSync(join(run.out, 'entries', 'F1.json'), 'utf-8')).toBe(before);
    expect(run.run('slices', 'F1', '--round', '2').status).toBe(0);
    const second = judge(run, 'F1', 2, () => ({ verdict: 'contradicted', reason: 'The code still says something else.' }));
    expect(second.lines).toEqual(['F1: failed at verify: no item could be proved']);
    expect(stateOf(run).removed.map((item) => item.path)).toEqual(expect.arrayContaining(ALL_ITEMS));
  });

  it('a contradicted item that round 2 still contradicts is removed there and listed in the coverage section', () => {
    const run = checkedRun();
    judge(run, 'F1', 1, (item) => (item.id === 'states[1]' ? { verdict: 'contradicted', reason: 'The code shows no such state.' } : 'verified'));
    expect(judge(run, 'F1', 2, () => ({ verdict: 'contradicted', reason: 'The code shows no such state.' })).status).toBe(0);
    expect(stateOf(run).status).toBe('confirmed');
    expect(JSON.parse(readFileSync(join(run.out, 'entries', 'F1.json'), 'utf-8')).states.map((state) => state.label)).toEqual(['Draft']);
    expect(traceFeature(run).status).toBe(0);
    const assembled = run.run('assemble');
    expect(assembled.status, assembled.stdout).toBe(0);
    const text = readFileSync(join(run.out, 'handbook.md'), 'utf-8');
    expect(text.slice(text.indexOf('## Coverage'))).toContain('The code shows no such state.');
  });

  it('leaves no stale rewrite or round 2 file when a verified feature is verified again from round 1', () => {
    const run = checkedRun();
    judge(run, 'F1', 1, (item) => (item.id === 'purpose' ? 'unverified' : 'verified'));
    expect(existsSync(rewritePath(run))).toBe(true);
    expect(judge(run, 'F1', 2).status).toBe(0);
    expect(existsSync(verdictPath(run, 2))).toBe(true);
    // The entry file is written again as a different file than the confirmed one, so check-entry starts the feature over as
    // checked; slices round 1 clears what the earlier verification left.
    const changed = clone(run.entry);
    changed.purpose.text = 'Staff place new orders.';
    run.writeEntry('F1', changed);
    expect(run.run('check-entry', 'F1').status).toBe(0);
    expect(verifyChecked(run).status).toBe(0);
    expect(existsSync(rewritePath(run))).toBe(false);
    expect(existsSync(verdictPath(run, 2))).toBe(false);
    expect(existsSync(verifyPath(run, 2))).toBe(false);
    expect(stateOf(run).status).toBe('verified');
  });
});

/** Round 1 with `bad` items judged not verified; returns the run, ready for the rewrite. */
function rewriteRun(bad, adjust) {
  const run = checkedRun(adjust);
  const result = judge(run, 'F1', 1, (item) => (Object.hasOwn(bad, item.id) ? { verdict: bad[item.id], reason: `Round 1: ${item.id} is ${bad[item.id]}.` } : 'verified'));
  expect(result.status, result.stdout).toBe(0);
  return run;
}
/** A rewrite that only adds a citation to `item`: its claim is unchanged. */
const recite = (item) => { item.evidence.push(ev(form, "title: 'New Order',")); };
/** The entry as the rewriter leaves it: `change` edits a copy of the current file. */
function rewrite(run, change) {
  const entry = JSON.parse(readFileSync(join(run.out, 'entries', 'F1.json'), 'utf-8'));
  change(entry);
  run.writeEntry('F1', entry);
  const checked = run.run('check-entry', 'F1');
  expect(checked.status, checked.stdout).toBe(0);
}

describe('slices: round 2', () => {
  it('slices only the listed items, as they are in the rewritten entry, with the citations the rewrite gave', () => {
    const run = rewriteRun({ 'who[0]': 'unverified', 'screens[0].fields[1].rules[0]': 'unverified' });
    rewrite(run, (entry) => {
      recite(entry.who[0]);
      recite(entry.screens[0].fields[1].rules[0]);
    });
    const result = run.run('slices', 'F1', '--round', '2');
    expect(result.status, result.stdout).toBe(0);
    const verify = readVerify(run, 2);
    expect(verify.round).toBe(2);
    expect(ids(verify)).toEqual(['who[0]', 'screens[0].fields[1].rules[0]']);
    expect(verify.items[0].claim).toBe('Roles > Clerk: Create an order.');
    expect(verify.items[0].evidence.map((block) => block.file)).toEqual(['src/roles.js', form]);
    expect(result.lines).toContain(`Part 1/1: Verify file: ${verifyPath(run, 2)} | Verdict files: ${verdictPath(run, 2, 'F1', 1, 'a')} ${verdictPath(run, 2, 'F1', 1, 'b')}`);
  });

  it('refuses without a rewrite file, with round 1 not done, or on a feature that is not waiting for its rewrite', () => {
    const run = checkedRun();
    const early = run.run('slices', 'F1', '--round', '2');
    expect(early.status).toBe(1);
    expect(early.lines.at(-1)).toMatch(/^Next: /);
    judge(run);
    expect(run.run('slices', 'F1', '--round', '2').status).toBe(1);
  });

  const refuses = (name, change, expected, bad = { 'who[0]': 'unverified' }) => {
    it(name, () => {
      const run = rewriteRun(bad);
      rewrite(run, (entry) => {
        recite(entry.who[0]);
        change(entry);
      });
      const result = run.run('slices', 'F1', '--round', '2');
      expect(result.status, result.stdout).toBe(1);
      expect(result.stdout).toMatch(expected);
      expect(existsSync(verifyPath(run, 2))).toBe(false);
    });
  };

  refuses('refuses an item that is not listed and was changed, and prints its path', (entry) => {
    entry.states[0].meaning = 'The order has not been sent.';
  }, /states\[0\]: not listed for rewriting, but changed/);
  refuses('refuses an item path that is missing, because an item was deleted', (entry) => {
    entry.states.pop();
  }, /states\[1\]: missing/);
  refuses('refuses an item that was added', (entry) => {
    entry.states.push({ label: 'Draft', meaning: 'Kept as a draft.', evidence: [ev(form, "const statuses = ['Draft', 'Submitted'];")] });
  }, /states\[2\]: added/);
  refuses('refuses the change of an operation name, which changes its sentences', (entry) => {
    entry.operations[0].name = 'Send an order';
  }, /operations\[0\]\.sentences\[0\]: not listed for rewriting, but changed/);
  refuses('refuses a changed citation of an item that is not listed', (entry) => {
    entry.where[0].evidence = [ev('src/menu.js', "{ label: 'Orders', path: '/orders' },"), ev(form, "title: 'New Order',")];
  }, /where\[0\]: not listed for rewriting, but changed/);

  it('prints every offending path', () => {
    const run = rewriteRun({ 'who[0]': 'unverified' });
    rewrite(run, (entry) => {
      entry.states[0].meaning = 'Changed.';
      entry.states[1].meaning = 'Changed too.';
    });
    const result = run.run('slices', 'F1', '--round', '2');
    expect(result.stdout).toMatch(/states\[0\]/);
    expect(result.stdout).toMatch(/states\[1\]/);
  });

  it('refuses the deletion of a listed item too: the rewrite never deletes, the script removes', () => {
    const run = rewriteRun({ 'screens[0].fields[1].rules[0]': 'unverified' });
    rewrite(run, (entry) => { entry.screens[0].fields[1].rules.shift(); });
    const result = run.run('slices', 'F1', '--round', '2');
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toMatch(/screens\[0\]\.fields\[1\]\.rules\[1\]: missing/);
    expect(result.lines.at(-1)).toMatch(/never delete or add an item/);
  });

  it('prints each added path and each missing path', () => {
    const run = rewriteRun({ 'who[0]': 'unverified' });
    rewrite(run, (entry) => {
      entry.states.pop();
      entry.where.push({ label: 'Orders', evidence: [ev('src/menu.js', "{ label: 'Orders', path: '/orders' },")] });
    });
    const result = run.run('slices', 'F1', '--round', '2');
    expect(result.stdout).toMatch(/where\[2\]: added/);
    expect(result.stdout).toMatch(/states\[1\]: missing/);
  });

  it('counts the descendants of a listed item as listed: the rules under a listed field may change their citations', () => {
    const run = rewriteRun({ 'screens[0].fields[1]': 'unverified' });
    rewrite(run, (entry) => { recite(entry.screens[0].fields[1].rules[0]); });
    const result = run.run('slices', 'F1', '--round', '2');
    expect(result.status, result.stdout).toBe(0);
    expect(ids(readVerify(run, 2))).toEqual(['screens[0].fields[1]', 'screens[0].fields[1].rules[0]', 'screens[0].fields[1].rules[1]']);
  });

  describe('a listed item may narrow its claim and change its citations, never a name or a label', () => {
    const menu = ev('src/menu.js', "{ label: 'Orders', path: '/orders' },");
    const countField = "{ label: 'Item Count', max: 35000 },";
    const nameLine = (id) => new RegExp(`^${id.replace(/[[\]]/g, '\\$&')}: listed for rewriting, but a name or label changed .*names and labels may not change`, 'm');
    const withTransitionAndHandoff = (entry) => {
      entry.transitions.push({ from: 'Draft', to: 'Submitted', by: 'The clerk sends it.', evidence: [ev(form, "const statuses = ['Draft', 'Submitted'];")] });
      entry.operations[0].handoffs.push({ feature: 'F2', text: 'Finished orders move to the archive.', evidence: [ev(form, "const statuses = ['Draft', 'Submitted'];")] });
    };

    it('accepts a rewrite that only swaps, adds or drops citations of a listed item', () => {
      const run = rewriteRun({ 'who[0]': 'unverified', 'states[1]': 'unverified' });
      rewrite(run, (entry) => {
        entry.who[0].evidence = [ev(form, "title: 'New Order',")];
        recite(entry.states[1]);
      });
      const result = run.run('slices', 'F1', '--round', '2');
      expect(result.status, result.stdout).toBe(0);
      expect(ids(readVerify(run, 2))).toEqual(['who[0]', 'states[1]']);
    });

    it('accepts a listed item whose claim changed, of every kind a reader sees, and slices the new claim', () => {
      const adjust = (entry) => {
        entry.notifications.push({ trigger: 'An order is sent', recipient: 'The approver', channel: 'Message', content: 'A new order waits.', evidence: [ev(form, "const statuses = ['Draft', 'Submitted'];")] });
      };
      const run = rewriteRun({ 'who[0]': 'unverified', 'screens[0].fields[1].rules[0]': 'contradicted', 'states[1]': 'unverified', 'notifications[0]': 'unverified' }, adjust);
      rewrite(run, (entry) => {
        entry.who[0].can = 'Create an order, except for a locked customer.';
        entry.screens[0].fields[1].rules[0].text = 'At most 35,000 items, unless the customer is exempt.';
        entry.states[1].meaning = 'The order went out.';
        entry.notifications[0].channel = 'Email';
      });
      const result = run.run('slices', 'F1', '--round', '2');
      expect(result.status, result.stdout).toBe(0);
      const verify = readVerify(run, 2);
      expect(ids(verify)).toEqual(['who[0]', 'screens[0].fields[1].rules[0]', 'states[1]', 'notifications[0]']);
      expect(verify.items[0].claim).toBe('Roles > Clerk: Create an order, except for a locked customer.');
    });

    it('accepts a rule under a listed field whose text changed, and a sentence whose own text changed', () => {
      const run = rewriteRun({ 'screens[0].fields[1]': 'unverified', 'operations[0].sentences[1]': 'contradicted' });
      rewrite(run, (entry) => {
        entry.screens[0].fields[1].rules[0].text = 'At most 35000 items for a standard customer.';
        entry.operations[0].sentences[1].text = 'The item count is limited to 35000 for a standard customer.';
      });
      expect(run.run('slices', 'F1', '--round', '2').status).toBe(0);
    });

    const renames = [
      ['a role', 'who[0]', (entry) => { entry.who[0].role = 'Approver'; }, {}],
      ['a navigation label', 'where[1]', (entry) => { entry.where[1].label = 'Orders'; entry.where[1].evidence.push(menu); }, {}],
      ['a screen name', 'screens[0]', (entry) => { entry.screens[0].name = 'Orders'; entry.screens[0].evidence.push(menu); }, {}],
      ['a field label', 'screens[0].fields[0]', (entry) => { entry.screens[0].fields[0].label = 'Item Count'; entry.screens[0].fields[0].evidence.push(ev(form, countField)); }, {}],
      ['the side of a rule', 'screens[0].fields[1].rules[0]', (entry) => { entry.screens[0].fields[1].rules[0].side = 'frontend'; }, {}],
      ['a state label', 'states[1]', (entry) => { entry.states[1].label = 'Draft'; }, {}],
      ['the from state of a transition', 'transitions[0]', (entry) => { entry.transitions[0].from = 'Submitted'; }, { adjust: withTransitionAndHandoff }],
      ['the to state of a transition', 'transitions[0]', (entry) => { entry.transitions[0].to = 'Draft'; }, { adjust: withTransitionAndHandoff }],
      ['the target feature of a handoff', 'operations[0].handoffs[0]', (entry) => { entry.operations[0].handoffs[0].feature = 'F3'; }, { adjust: withTransitionAndHandoff }],
      ['an operation name, with a listed sentence below it', 'operations[0].sentences[0]', (entry) => { entry.operations[0].name = 'Send an order'; }, {}],
    ];
    for (const [name, listed, change, options] of renames) {
      it(`refuses ${name}, prints the item path and that names and labels may not change, and writes no verify file`, () => {
        const run = rewriteRun({ [listed]: 'unverified' }, options.adjust);
        rewrite(run, change);
        const result = run.run('slices', 'F1', '--round', '2');
        expect(result.status, result.stdout).toBe(1);
        expect(result.stdout).toMatch(nameLine(listed));
        expect(result.lines.at(-1)).toMatch(/^Next: /);
        expect(existsSync(verifyPath(run, 2))).toBe(false);
      });
    }

    it('refuses the rename of a screen below which a field is listed, naming the listed field', () => {
      const run = rewriteRun({ 'screens[0].fields[0]': 'unverified' });
      rewrite(run, (entry) => { entry.screens[0].name = 'Orders'; entry.screens[0].evidence.push(menu); });
      const result = run.run('slices', 'F1', '--round', '2');
      expect(result.status, result.stdout).toBe(1);
      expect(result.stdout).toMatch(nameLine('screens[0].fields[0]'));
    });

    it('does not say the claim may not change: the old refusal line is gone', () => {
      const run = rewriteRun({ 'who[0]': 'unverified' });
      rewrite(run, (entry) => { entry.who[0].role = 'Approver'; });
      const result = run.run('slices', 'F1', '--round', '2');
      expect(result.stdout).not.toMatch(/only its citations may change/);
      expect(result.stdout).not.toMatch(/claim changed/);
    });

    it('still compares an item that is not listed by its fingerprint, so a changed claim or citation of it is refused', () => {
      const run = rewriteRun({ 'who[0]': 'unverified' });
      rewrite(run, (entry) => { entry.states[0].evidence.push(ev(form, "title: 'New Order',")); });
      const result = run.run('slices', 'F1', '--round', '2');
      expect(result.status, result.stdout).toBe(1);
      expect(result.lines).toContain('states[0]: not listed for rewriting, but changed');
    });
  });

  describe('after items were removed at round 1 (a state written before round 1 stopped removing)', () => {
    /** A run in the state an older round 1 left: `where[0]` and `states[0]` removed, `who[0]` and `states[1]` (now `states[0]`) listed. */
    const removedFirstRun = () => {
      const run = checkedRun();
      const bad = { 'who[0]': 'unverified', 'states[1]': 'unverified' };
      const result = judge(run, 'F1', 1, (item) => (Object.hasOwn(bad, item.id) ? { verdict: bad[item.id], reason: `Round 1: ${item.id}.` } : 'verified'));
      expect(result.status, result.stdout).toBe(0);
      const entry = JSON.parse(readFileSync(join(run.out, 'entries', 'F1.json'), 'utf-8'));
      entry.where.shift();
      entry.states.shift();
      run.writeEntry('F1', entry);
      const state = run.readJson('state.json');
      state.features.F1.removed = [
        { path: 'where[0]', claim: 'Where > Orders', verdict: 'contradicted', reason: 'The menu has no such entry.' },
        { path: 'states[0]', claim: 'State: Draft; Meaning: The order is not sent yet.', verdict: 'contradicted', reason: 'The code shows no such state.' },
      ];
      run.writeJson(join(run.out, 'state.json'), state);
      const listed = JSON.parse(readFileSync(rewritePath(run), 'utf-8'));
      listed.items.find((item) => item.id === 'states[1]').id = 'states[0]';
      run.writeJson(rewritePath(run), listed);
      return run;
    };

    it('does not report the removed items as missing, and reads the items after them at their new paths', () => {
      const run = removedFirstRun();
      rewrite(run, (entry) => {
        recite(entry.who[0]);
        recite(entry.states[0]);
      });
      const result = run.run('slices', 'F1', '--round', '2');
      expect(result.status, result.stdout).toBe(0);
      expect(result.stdout).not.toMatch(/missing/);
      const verify = readVerify(run, 2);
      expect(ids(verify)).toEqual(['who[0]', 'states[0]']);
      expect(verify.items[1].claim).toBe('State: Submitted; Meaning: The order was sent.');
    });

    it('accepts a narrowed claim of the shifted item, and refuses its renamed label; still refuses what round 1 did not remove when it is missing', () => {
      const run = removedFirstRun();
      rewrite(run, (entry) => {
        entry.states[0].meaning = 'The order went out.';
        entry.where.pop();
      });
      const missing = run.run('slices', 'F1', '--round', '2');
      expect(missing.status, missing.stdout).toBe(1);
      expect(missing.stdout).not.toMatch(/states\[0\]/);
      expect(missing.lines).toContain('where[0]: missing');
      const other = removedFirstRun();
      rewrite(other, (entry) => { entry.states[0].label = 'Draft'; });
      const renamed = other.run('slices', 'F1', '--round', '2');
      expect(renamed.status, renamed.stdout).toBe(1);
      expect(renamed.stdout).toMatch(/^states\[0\]: listed for rewriting, but a name or label changed .*names and labels may not change/m);
    });

    it('refuses an item that comes back after round 1 removed it', () => {
      const run = removedFirstRun();
      rewrite(run, (entry) => { entry.states.push({ label: 'Draft', meaning: 'The order is not sent yet.', evidence: [ev(form, "const statuses = ['Draft', 'Submitted'];")] }); });
      const result = run.run('slices', 'F1', '--round', '2');
      expect(result.status, result.stdout).toBe(1);
      expect(result.lines).toContain('states[1]: added');
    });

    it('ends with the records of both rounds', () => {
      const run = removedFirstRun();
      rewrite(run, (entry) => { recite(entry.who[0]); });
      const result = judge(run, 'F1', 2, (item) => (item.id === 'states[0]' ? { verdict: 'unverified', reason: 'Still no line names it.' } : 'verified'));
      expect(result.status, result.stdout).toBe(0);
      expect(result.lines[0]).toBe('F1: confirmed, 3 items removed');
      const state = stateOf(run);
      expect(state.status).toBe('confirmed');
      expect(state.removed.map((item) => [item.path, item.verdict, item.reason])).toEqual([
        ['where[0]', 'contradicted', 'The menu has no such entry.'],
        ['states[0]', 'contradicted', 'The code shows no such state.'],
        ['states[0]', 'unverified', 'Still no line names it.'],
      ]);
      expect(state.removed[2].claim).toBe('State: Submitted; Meaning: The order was sent.');
      const entry = JSON.parse(readFileSync(join(run.out, 'entries', 'F1.json'), 'utf-8'));
      expect(entry.states).toEqual([]);
      expect(entry.where.map((place) => place.label)).toEqual(['New Order']);
      expect(run.run('try-entry', 'F1').status).toBe(0);
    });
  });

  it('does not count a sibling or a parent of a listed item as listed', () => {
    const run = rewriteRun({ 'screens[0].fields[1].rules[0]': 'unverified' });
    rewrite(run, (entry) => { entry.screens[0].fields[1].rules[1].text = 'An upload may hold up to 100,000 bytes at most.'; });
    const result = run.run('slices', 'F1', '--round', '2');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/screens\[0\]\.fields\[1\]\.rules\[1\]: not listed for rewriting, but changed/);
  });

  it('accepts a rewrite that leaves the listed items unchanged', () => {
    const run = rewriteRun({ purpose: 'unverified' });
    expect(run.run('slices', 'F1', '--round', '2').status).toBe(0);
    expect(ids(readVerify(run, 2))).toEqual(['purpose']);
  });
});

describe('verdicts: round 2', () => {
  const entryOf = (run) => JSON.parse(readFileSync(join(run.out, 'entries', 'F1.json'), 'utf-8'));

  it('confirms the feature when the rewritten items are verified, clears the rewriting mark and keeps nothing removed', () => {
    const run = rewriteRun({ 'who[0]': 'unverified' });
    rewrite(run, (entry) => { recite(entry.who[0]); });
    const result = judge(run, 'F1', 2);
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('F1: confirmed (1 item)');
    const state = stateOf(run);
    expect(state.status).toBe('confirmed');
    expect(state.rewriting).toBeUndefined();
    expect(state.removed).toBeUndefined();
    expect(state.entryDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('removes an item that is still contradicted from the entry in place and records it with its full claim, verdict and reason', () => {
    const run = rewriteRun({ 'screens[0].fields[1].rules[0]': 'unverified' });
    const result = judge(run, 'F1', 2, () => ({ verdict: 'contradicted', reason: 'The limit shown is 50.' }));
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('F1: confirmed, 1 item removed');
    const entry = entryOf(run);
    expect(entry.screens[0].fields[1].rules.map((rule) => rule.side)).toEqual(['frontend']);
    expect(stateOf(run).removed).toEqual([{
      path: 'screens[0].fields[1].rules[0]',
      claim: 'Screen: New Order > Field: Item Count > Backend rules > At most 35,000 items.',
      verdict: 'contradicted',
      reason: 'The limit shown is 50.',
    }]);
    // The trimmed entry passes check-entry, and the verified state holds the digest of the trimmed file.
    expect(run.run('try-entry', 'F1').status).toBe(0);
    expect(run.run('assemble').status).toBe(0);
  });

  it('removes an unverified item exactly like a contradicted one', () => {
    const run = rewriteRun({ 'states[1]': 'unverified' });
    const result = judge(run, 'F1', 2, () => ({ verdict: 'unverified', reason: 'No line names it.' }));
    expect(result.status, result.stdout).toBe(0);
    expect(entryOf(run).states.map((state) => state.label)).toEqual(['Draft']);
    expect(stateOf(run).removed.map((item) => [item.path, item.verdict])).toEqual([['states[1]', 'unverified']]);
    expect(stateOf(run).status).toBe('confirmed');
  });

  it('keeps an item that was not listed, however round 2 judges the listed one', () => {
    const run = rewriteRun({ 'states[1]': 'unverified' });
    judge(run, 'F1', 2, () => 'unverified');
    expect(entryOf(run).states.map((state) => state.label)).toEqual(['Draft']);
    expect(entryOf(run).purpose).toEqual(run.entry.purpose);
  });

  it('takes the fields and rules of a removed screen with it, and records them as removed with it', () => {
    const run = rewriteRun({ 'screens[0]': 'unverified' });
    // Only the screen is judged not verified; its fields and rules were verified, and go with it all the same.
    const result = judge(run, 'F1', 2, (item) => (item.id === 'screens[0]' ? { verdict: 'unverified', reason: 'No line names the screen.' } : 'verified'));
    expect(result.status, result.stdout).toBe(0);
    expect(entryOf(run).screens).toEqual([]);
    const removed = stateOf(run).removed;
    expect(removed.map((item) => item.path)).toEqual([
      'screens[0]',
      'screens[0].fields[0]', 'screens[0].fields[0].rules[0]',
      'screens[0].fields[1]', 'screens[0].fields[1].rules[0]', 'screens[0].fields[1].rules[1]',
    ]);
    expect(removed[0].verdict).toBe('unverified');
    for (const child of removed.slice(1)) expect(child.verdict).toBe('withParent');
    expect(removed[1].claim).toBe('Screen: New Order > Field: Customer Name');
    expect(run.run('try-entry', 'F1').status).toBe(0);
  });

  it('takes the rules of a removed field with it', () => {
    const run = rewriteRun({ 'screens[0].fields[1]': 'unverified' });
    judge(run, 'F1', 2, (item) => (item.id === 'screens[0].fields[1]' ? 'contradicted' : 'verified'));
    expect(entryOf(run).screens[0].fields.map((field) => field.label)).toEqual(['Customer Name']);
    expect(stateOf(run).removed.map((item) => item.path)).toEqual([
      'screens[0].fields[1]', 'screens[0].fields[1].rules[0]', 'screens[0].fields[1].rules[1]',
    ]);
  });

  it('removes an operation that has no sentence left, and records it with its sentences', () => {
    const run = rewriteRun({ 'operations[0].sentences[0]': 'unverified', 'operations[0].sentences[1]': 'unverified' });
    const result = judge(run, 'F1', 2, () => 'contradicted');
    expect(result.status, result.stdout).toBe(0);
    expect(entryOf(run).operations).toEqual([]);
    expect(stateOf(run).removed.map((item) => item.path)).toEqual(['operations[0].sentences[0]', 'operations[0].sentences[1]', 'operations[0]']);
    expect(stateOf(run).removed[2]).toMatchObject({ claim: 'Place an order', verdict: 'withParent' });
    expect(run.run('try-entry', 'F1').status).toBe(0);
  });

  it('keeps an operation that still has a sentence', () => {
    const run = rewriteRun({ 'operations[0].sentences[1]': 'unverified' });
    judge(run, 'F1', 2, () => 'contradicted');
    expect(entryOf(run).operations[0].sentences.map((sentence) => sentence.text)).toEqual(['The clerk fills in the customer name.']);
  });

  it('removes a who, where, state, notification and automatic item', () => {
    const adjust = (entry) => {
      entry.notifications.push({ trigger: 'An order is sent', recipient: 'The approver', channel: 'Message', content: 'A new order waits.', evidence: [ev(form, "const statuses = ['Draft', 'Submitted'];")] });
      entry.automatic.push({ when: 'Every night', effect: 'Drafts are cleared.', evidence: [ev(form, "const statuses = ['Draft', 'Submitted'];")] });
    };
    const run = rewriteRun({ 'who[0]': 'unverified', 'where[1]': 'unverified', 'notifications[0]': 'unverified', 'automatic[0]': 'unverified' }, adjust);
    const result = judge(run, 'F1', 2, () => 'unverified');
    expect(result.status, result.stdout).toBe(0);
    const entry = entryOf(run);
    expect(entry.who).toEqual([]);
    expect(entry.where.map((place) => place.label)).toEqual(['Orders']);
    expect(entry.notifications).toEqual([]);
    expect(entry.automatic).toEqual([]);
    expect(run.run('try-entry', 'F1').status).toBe(0);
  });

  it('removes a purpose that is still not verified like any other item: the feature stays confirmed, the entry has no purpose key, the handbook has no purpose section and the coverage section lists it', () => {
    const run = rewriteRun({ purpose: 'unverified' });
    const result = judge(run, 'F1', 2, () => ({ verdict: 'unverified', reason: 'No line shows why the order form exists.' }));
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('F1: confirmed, 1 item removed');
    const state = stateOf(run);
    expect(state.status).toBe('confirmed');
    expect(state.failure).toBeUndefined();
    expect(state.rewriting).toBeUndefined();
    expect(state.entryDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(state.removed).toEqual([{
      path: 'purpose',
      claim: 'Purpose > Staff place new orders for customers.',
      verdict: 'unverified',
      reason: 'No line shows why the order form exists.',
    }]);
    const entry = entryOf(run);
    expect(Object.hasOwn(entry, 'purpose')).toBe(false);
    expect(entry.who).toEqual(run.entry.who);
    expect(entry.screens).toEqual(run.entry.screens);
    // The trimmed entry is a settled one: it is no longer a written entry, so check-entry and try-entry still ask for a purpose.
    expect(run.run('try-entry', 'F1').stdout).toMatch(/missing key "purpose"/);

    // Only a traced feature is written into the handbook.
    expect(traceFeature(run).status).toBe(0);
    const assembled = run.run('assemble');
    expect(assembled.status, assembled.stdout).toBe(0);
    const text = readFileSync(join(run.out, 'handbook.md'), 'utf-8');
    expect(text).toContain('### Orders');
    expect(text).toContain('#### Roles');
    expect(text).not.toContain('#### Purpose');
    const coverageAt = text.indexOf('## Coverage');
    expect(text.slice(0, coverageAt)).not.toContain('Staff place new orders for customers.');
    const coverage = text.slice(coverageAt);
    expect(coverage).toContain('Purpose > Staff place new orders for customers.');
    expect(coverage).toContain('No line shows why the order form exists.');
  });

  it('fails the feature at verify, recording every removed item and leaving the entry file as it is, when no item that carries evidence is left', () => {
    const run = rewriteRun(Object.fromEntries(ALL_ITEMS.map((id) => [id, 'unverified'])));
    const before = readFileSync(join(run.out, 'entries', 'F1.json'), 'utf-8');
    const result = judge(run, 'F1', 2, () => ({ verdict: 'unverified', reason: 'No line shown proves it.' }));
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['F1: failed at verify: no item could be proved']);
    const state = stateOf(run);
    expect(state.status).toBe('failed');
    expect(state.failure).toEqual({ step: 'verify', reasons: ['no item could be proved'] });
    expect(state.removed.map((item) => item.path)).toEqual(expect.arrayContaining(ALL_ITEMS));
    expect(state.rewriting).toBeUndefined();
    expect(state.entryDigest).toBeUndefined();
    expect(readFileSync(join(run.out, 'entries', 'F1.json'), 'utf-8')).toBe(before);
  });

  it('does not fail a feature that has one item left, even when everything else including the purpose was removed', () => {
    const bad = Object.fromEntries(ALL_ITEMS.filter((id) => id !== 'states[0]').map((id) => [id, 'unverified']));
    const run = rewriteRun(bad);
    const result = judge(run, 'F1', 2, (item) => (item.id === 'states[0]' ? 'verified' : 'unverified'));
    expect(result.lines[0]).toMatch(/^F1: confirmed, \d+ items removed$/);
    expect(stateOf(run).status).toBe('confirmed');
    expect(Object.hasOwn(entryOf(run), 'purpose')).toBe(false);
    expect(entryOf(run).states.map((state) => state.label)).toEqual(['Draft']);
  });

  it('refuses round 2 on a feature that is not waiting for it, and conservation applies in round 2 too', () => {
    const run = rewriteRun({ purpose: 'unverified', 'who[0]': 'unverified' });
    expect(run.run('slices', 'F1', '--round', '2').status).toBe(0);
    writeVerdicts(run, 2, [{ id: 'purpose', verdict: 'verified', reason: 'ok' }]);
    const bad = run.run('verdicts', 'F1', '--round', '2');
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/who\[0\]: no verdict/);
    expect(stateOf(run)).toEqual({ status: 'checked', attempts: 0, rewriting: true });
    writeVerdicts(run, 2, [{ id: 'purpose', verdict: 'verified', reason: 'ok' }, { id: 'who[0]', verdict: 'verified', reason: 'ok' }]);
    expect(run.run('verdicts', 'F1', '--round', '2').status).toBe(0);
    expect(run.run('verdicts', 'F1', '--round', '2').status).toBe(1);
  });
});

describe('verdicts: round 2 records the claims the rewrite narrowed', () => {
  const FROM = 'Roles > Clerk: Create an order.';
  const TO = 'Roles > Clerk: Create an order, except for a locked customer.';
  const narrowWho = (entry) => { entry.who[0].can = 'Create an order, except for a locked customer.'; };

  it('records the old and the new claim of a narrowed item that stayed, and keeps it through the tracers', () => {
    const run = rewriteRun({ 'who[0]': 'contradicted' });
    rewrite(run, narrowWho);
    const result = judge(run, 'F1', 2);
    expect(result.status, result.stdout).toBe(0);
    expect(stateOf(run).narrowed).toEqual([{ path: 'who[0]', from: FROM, to: TO, kept: true }]);
    expect(stateOf(run).removed).toBeUndefined();
    expect(traceFeature(run).status).toBe(0);
    expect(stateOf(run).status).toBe('verified');
    expect(stateOf(run).narrowed).toEqual([{ path: 'who[0]', from: FROM, to: TO, kept: true }]);
    // The record is for the audit: neither the handbook nor the page data shows it.
    expect(run.run('assemble').status).toBe(0);
    const text = readFileSync(join(run.out, 'handbook.md'), 'utf-8');
    expect(text).toContain('Create an order, except for a locked customer.');
    expect(text).not.toContain('narrowed');
  });

  it('records a narrowed item that round 2 removed as not kept, and the removal itself as before', () => {
    const run = rewriteRun({ 'who[0]': 'unverified' });
    rewrite(run, narrowWho);
    const result = judge(run, 'F1', 2, () => ({ verdict: 'unverified', reason: 'No line shown proves the exception.' }));
    expect(result.status, result.stdout).toBe(0);
    expect(stateOf(run).narrowed).toEqual([{ path: 'who[0]', from: FROM, to: TO, kept: false }]);
    expect(stateOf(run).removed).toEqual([{ path: 'who[0]', claim: TO, verdict: 'unverified', reason: 'No line shown proves the exception.' }]);
  });

  it('records no narrowed key when no claim differs, and does not record an item whose citations only changed', () => {
    const run = rewriteRun({ 'who[0]': 'unverified', 'states[1]': 'unverified' });
    rewrite(run, (entry) => { recite(entry.who[0]); entry.states[1].meaning = 'The order went out.'; });
    expect(judge(run, 'F1', 2).status).toBe(0);
    expect(stateOf(run).narrowed.map((item) => item.path)).toEqual(['states[1]']);
    const plain = rewriteRun({ 'who[0]': 'unverified' });
    rewrite(plain, (entry) => { recite(entry.who[0]); });
    expect(judge(plain, 'F1', 2).status).toBe(0);
    expect(Object.hasOwn(stateOf(plain), 'narrowed')).toBe(false);
  });

  it('records the changed rules under a listed field, and marks them not kept when the field goes', () => {
    const run = rewriteRun({ 'screens[0].fields[1]': 'contradicted' });
    rewrite(run, (entry) => { entry.screens[0].fields[1].rules[0].text = 'At most 35,000 items for a standard customer.'; });
    const result = judge(run, 'F1', 2, (item) => (item.id === 'screens[0].fields[1]' ? { verdict: 'unverified', reason: 'No line shown names the field.' } : 'verified'));
    expect(result.status, result.stdout).toBe(0);
    expect(stateOf(run).narrowed.map((item) => [item.path, item.kept])).toEqual([['screens[0].fields[1].rules[0]', false]]);
    expect(stateOf(run).removed.map((item) => item.path)).toContain('screens[0].fields[1].rules[0]');
  });

  it('keeps the record when round 2 fails the feature', () => {
    const run = rewriteRun(Object.fromEntries(ALL_ITEMS.map((id) => [id, 'unverified'])));
    rewrite(run, narrowWho);
    const result = judge(run, 'F1', 2, () => ({ verdict: 'unverified', reason: 'No line shown proves it.' }));
    expect(result.lines).toEqual(['F1: failed at verify: no item could be proved']);
    expect(stateOf(run).narrowed).toEqual([{ path: 'who[0]', from: FROM, to: TO, kept: false }]);
  });

  it('refuses a state whose narrowed list is malformed', () => {
    const run = rewriteRun({ 'who[0]': 'unverified' });
    const state = run.readJson('state.json');
    state.features.F1.narrowed = [{ path: 'who[0]', from: 'a', to: 'b' }];
    run.writeJson(join(run.out, 'state.json'), state);
    expect(run.run('check-entry', 'F1').stdout).toMatch(/narrowed/);
  });
});

describe('check-entry after a rewrite', () => {
  it('keeps a feature that is waiting for its rewrite checked, and the rewrite flag', () => {
    const run = rewriteRun({ 'who[0]': 'unverified' });
    rewrite(run, (entry) => { recite(entry.who[0]); });
    expect(stateOf(run)).toEqual({ status: 'checked', attempts: 0, rewriting: true });
  });

  it('keeps what round 1 removed while the feature waits for its rewrite, and when the rewrite fails', () => {
    const run = checkedRun();
    judge(run, 'F1', 1, (item) => (item.id === 'who[0]' ? 'unverified' : 'verified'));
    // A state written before round 1 stopped removing: states[1] is gone and recorded.
    const trimmed = JSON.parse(readFileSync(join(run.out, 'entries', 'F1.json'), 'utf-8'));
    trimmed.states.pop();
    run.writeEntry('F1', trimmed);
    const older = run.readJson('state.json');
    older.features.F1.removed = [{ path: 'states[1]', claim: 'State: Submitted; Meaning: The order was sent.', verdict: 'contradicted', reason: 'The code shows no such state.' }];
    run.writeJson(join(run.out, 'state.json'), older);
    const { removed } = stateOf(run);
    rewrite(run, (entry) => { recite(entry.who[0]); });
    expect(stateOf(run)).toEqual({ status: 'checked', attempts: 0, rewriting: true, removed });
    const entry = JSON.parse(readFileSync(join(run.out, 'entries', 'F1.json'), 'utf-8'));
    entry.who[0].can = 'Only clerk_admin may do this.';
    run.writeEntry('F1', entry);
    expect(run.run('check-entry', 'F1').status).toBe(1);
    expect(stateOf(run)).toMatchObject({ status: 'failed', failure: { step: 'rewrite' }, removed });
  });

  it('records a rewrite that fails check-entry as failed at rewrite, with a Next line that allows no second rewrite', () => {
    const run = rewriteRun({ 'who[0]': 'unverified' });
    const entry = clone(run.entry);
    entry.who[0].can = 'Only clerk_admin may do this.';
    run.writeEntry('F1', entry);
    const result = run.run('check-entry', 'F1');
    expect(result.status).toBe(1);
    expect(result.lines.at(-1)).toBe('Next: F1 stays failed (its one rewrite did not pass check-entry)');
    const state = stateOf(run);
    expect(state.status).toBe('failed');
    expect(state.failure.step).toBe('rewrite');
    expect(state.failure.reasons[0]).toMatch(/clerk_admin/);
    expect(state.rewriting).toBeUndefined();
    expect(run.run('slices', 'F1', '--round', '2').status).toBe(1);
  });

  it('a feature that was not waiting for a rewrite still fails at check-entry', () => {
    const run = checkedRun();
    const entry = clone(run.entry);
    entry.who[0].can = 'Only clerk_admin may do this.';
    run.writeEntry('F1', entry);
    run.run('check-entry', 'F1');
    expect(stateOf(run).failure.step).toBe('check-entry');
  });

  it('puts a verified feature back to checked when check-entry is run on a changed entry file', () => {
    const run = checkedRun();
    verifyChecked(run);
    const changed = clone(run.entry);
    changed.purpose.text = 'Staff place new orders.';
    run.writeEntry('F1', changed);
    expect(run.run('check-entry', 'F1').status).toBe(0);
    expect(stateOf(run)).toEqual({ status: 'checked', attempts: 0 });
  });

  it('refuses to dispatch a feature that is verified or waiting for its rewrite', () => {
    const run = checkedRun();
    verifyChecked(run);
    const verified = run.run('mark', 'F1', 'dispatched');
    expect(verified.status).toBe(1);
    expect(verified.lines[0]).toBe('F1: already verified; it is not written again');
  });
});

describe('a verified feature is invalidated when its entry changes later', () => {
  it('assemble refuses an entry whose bytes differ from the verified digest, even when it still passes check-entry', () => {
    const run = checkedRun();
    verifyChecked(run);
    expect(run.run('assemble').status).toBe(0);
    const entry = clone(run.entry);
    entry.who[0].can = 'Create orders.';
    run.writeEntry('F1', entry);
    expect(run.run('try-entry', 'F1').status).toBe(0);
    const result = run.run('assemble');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/F1: entries\/F1\.json changed after it was verified/);
    expect(result.lines.at(-1)).toMatch(/run check-entry for F1/);
  });
});
