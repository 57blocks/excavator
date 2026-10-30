// Oracle O3 of openspec change product-handbook-map: check-entry rejects each
// class of bad entry with the line that names it, passes the control cases
// (thousands commas, a banned fragment inside a verified label), and records
// state: a second failure stays failed, a checked feature is not written again.
// Every rejection is a pair: the bad entry fails with its line, then the good
// entry (restored) passes.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { clone, makeCheckedMapRun, runHandbook } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function newRun(adjustMap) {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  if (adjustMap) {
    const map = clone(run.map);
    adjustMap(map);
    run.writeMap(map);
    expect(run.run('check-map').status).toBe(0);
  }
  return run;
}

const check = (run, id = 'F1') => run.run('check-entry', id);
const form = 'src/forms/order-form.js';

/** A bad entry (built by `mutate`) must fail with `expected`; the good entry then passes. */
function rejects(name, mutate, expected, { adjustMap, prepare } = {}) {
  it(name, () => {
    const run = newRun(adjustMap);
    prepare?.(run);
    const entry = clone(run.entry);
    mutate(entry, run);
    run.writeEntry('F1', entry);
    const bad = check(run);
    expect(bad.status, `${bad.stdout}${bad.stderr}`).toBe(1);
    expect(bad.stdout).toMatch(expected);
    run.writeEntry('F1', run.entry);
    const good = check(run);
    expect(good.status, `${good.stdout}${good.stderr}`).toBe(0);
  });
}

describe('check-entry: the good entry', () => {
  it('passes and records the feature as checked', () => {
    const run = newRun();
    run.writeEntry();
    const result = check(run);
    expect(result.lines).toEqual(['F1: checked']);
    expect(result.status).toBe(0);
    expect(run.readJson('state.json').features.F1).toEqual({ status: 'checked', attempts: 0 });
  });

  it('accepts a number written with thousands commas against source that has none, and with an underscore separator', () => {
    const run = newRun();
    expect(JSON.stringify(run.entry)).toContain('35,000');
    expect(JSON.stringify(run.entry)).toContain('35000');
    expect(JSON.stringify(run.entry)).toContain('100,000');
    expect(JSON.stringify(run.entry)).toContain('100_000');
    run.writeEntry();
    expect(check(run).status).toBe(0);
  });
});

describe('check-entry: structure and evidence', () => {
  rejects('an extra key', (entry) => {
    entry.purpose.mood = 'cheerful';
  }, /purpose: unexpected key "mood"/);

  rejects('a missing top-level array', (entry) => {
    delete entry.notifications;
  }, /\(top level\): missing key "notifications"/);

  rejects('a wrong type', (entry) => {
    entry.states = {};
  }, /states: must be an array, found an object/);

  rejects('a rule with no evidence', (entry) => {
    delete entry.screens[0].fields[1].rules[0].evidence;
  }, /screens\[0\]\.fields\[1\]\.rules\[0\]: missing key "evidence"/);

  rejects('a narrative sentence with an empty evidence list', (entry) => {
    entry.operations[0].sentences[1].evidence = [];
  }, /operations\[0\]\.sentences\[1\]\.evidence: must have at least 1 item/);

  rejects('a rule side that is neither frontend nor backend', (entry) => {
    entry.screens[0].fields[0].rules[0].side = 'middle';
  }, /screens\[0\]\.fields\[0\]\.rules\[0\]\.side: must be one of frontend, backend, found "middle"/);

  rejects('an operation with no sentences', (entry) => {
    entry.operations[0].sentences = [];
  }, /operations\[0\]\.sentences: must have at least 1 item/);

  rejects('an entry whose id is another feature', (entry) => {
    entry.id = 'F2';
  }, /id: "F2" is not "F1"/);

  rejects('a passage that is not in the file, named by its place in the entry', (entry) => {
    entry.screens[0].fields[1].rules[1].evidence[0].passage = 'const MAX_UPLOAD = 9;';
  }, /screens\[0\]\.fields\[1\]\.rules\[1\]\.evidence\[0\]: passage not in src\/forms\/order-form\.js/);

  rejects('a passage that occurs twice', (entry) => {
    entry.purpose.evidence[0].passage = 'label:';
  }, /purpose\.evidence\[0\]: passage occurs 2 times in src\/forms\/order-form\.js; quote more of it/);

  rejects('a citation into .excavator', (entry) => {
    entry.purpose.evidence[0] = { file: '.excavator/notes.txt', passage: 'Staff place new orders.' };
  }, /purpose\.evidence\[0\]: \.excavator\/notes\.txt is under \.excavator/, {
    prepare: (run) => {
      mkdirSync(join(run.root, '.excavator'));
      writeFileSync(join(run.root, '.excavator/notes.txt'), 'Staff place new orders.\n');
    },
  });

  rejects('a citation that leaves the project with ..', (entry) => {
    entry.purpose.evidence[0].file = '../project/src/roles.js';
  }, /purpose\.evidence\[0\]: \.\.\/project\/src\/roles\.js leaves the project/);

  rejects('a role that is not in map.roles', (entry) => {
    entry.who[0].role = 'Auditor';
  }, /who\[0\]\.role: "Auditor" is not a role in map\.json \(roles: "Clerk", "Approver"\)/);
});

describe('check-entry: values', () => {
  rejects('a number that no passage states', (entry) => {
    entry.screens[0].fields[1].rules[0].text = 'At most 36,000 items.';
  }, /screens\[0\]\.fields\[1\]\.rules\[0\]\.text: number 36000 does not occur in this item's passages \(src\/forms\/order-form\.js\)/);

  rejects('a number in a narrative sentence that its own passage lacks (another item states it)', (entry) => {
    // 100000 is in the passage of another rule of this entry, not in this sentence's passage.
    entry.operations[0].sentences[1].text = 'The item count is limited to 100000.';
  }, /operations\[0\]\.sentences\[1\]\.text: number 100000 does not occur/);

  rejects('a label that is not in its passage', (entry) => {
    entry.screens[0].fields[0].label = 'Customer';
    entry.screens[0].fields[0].evidence[0].passage = "{ label: 'Item Count', max: 35000 },";
  }, /screens\[0\]\.fields\[0\]\.label: label "Customer" does not occur in this item's passages \(src\/forms\/order-form\.js\)/);

  rejects('a state label that is not in its passage', (entry) => {
    entry.states[0].label = 'Pending';
  }, /states\[0\]\.label: label "Pending" does not occur/);

  rejects('a where label that is not in its passage', (entry) => {
    entry.where[1].label = 'Old Order';
  }, /where\[1\]\.label: label "Old Order" does not occur/);

  rejects('a screen name that is not in its passage', (entry) => {
    entry.screens[0].name = 'Create Order';
  }, /screens\[0\]\.name: label "Create Order" does not occur/);

  rejects('a number in an operation name that its sentences do not state', (entry) => {
    entry.operations[0].name = 'Place 7 orders';
  }, /operations\[0\]\.name: number 7 does not occur/);

  it('does not check the numbers of an unknown (it states what is not known)', () => {
    const run = newRun();
    const entry = clone(run.entry);
    entry.unknowns[0].searched = 'the 3 files of the orders area';
    run.writeEntry('F1', entry);
    expect(check(run).status).toBe(0);
  });
});

describe('check-entry: the banned-words gate, one example of each class', () => {
  const cases = [
    ['underscore identifier', 'Only clerk_admin may do this.', /who\[0\]\.can: "clerk_admin" is not allowed in reader text \(underscore identifier\)/],
    ['camelCase identifier', 'The itemCount is checked.', /operations\[0\]\.sentences\[0\]\.text: "itemCount" is not allowed in reader text \(camelCase identifier\)/],
    ['multi-hump word', 'Clerks use the OrderForm.', /"OrderForm" is not allowed in reader text \(multi-hump word\)/],
    ['path', 'The page lives at /orders/new.', /"\/orders\/new" is not allowed in reader text \(path\)/],
    ['source file extension', 'The rules are in order-form.js.', /"order-form\.js" is not allowed in reader text \(source file extension\)/],
    ['call form', 'The form calls validate(order).', /"validate\(" is not allowed in reader text \(call form\)/],
  ];
  it.each(cases)('rejects a %s, then accepts the same sentence in plain words', (_name, text, expected) => {
    const run = newRun();
    const entry = clone(run.entry);
    entry.who[0].can = text;
    entry.operations[0].sentences[0].text = text;
    run.writeEntry('F1', entry);
    const bad = check(run);
    expect(bad.status, bad.stdout).toBe(1);
    expect(bad.stdout).toMatch(expected);
    run.writeEntry();
    expect(check(run).status).toBe(0);
  });

  rejects('a member directory name (a first-level directory that holds a .git)', (entry) => {
    entry.who[0].can = 'Create an order in the member-repo service.';
  }, /who\[0\]\.can: "member-repo" is not allowed in reader text \(member directory name\)/, {
    prepare: (run) => {
      mkdirSync(join(run.root, 'member-repo/.git'), { recursive: true });
      writeFileSync(join(run.root, 'member-repo/readme.txt'), 'x\n');
    },
  });

  it('does not count an ordinary first-level directory as a member name', () => {
    const run = newRun();
    const entry = clone(run.entry);
    entry.who[0].can = 'Create an order; the src and bin folders hold no .git.';
    run.writeEntry('F1', entry);
    expect(check(run).status).toBe(0);
  });

  it('lets ordinary punctuation through: and/or, fractions, dates, a bare parenthesis', () => {
    const run = newRun();
    const entry = clone(run.entry);
    entry.who[0].can = 'Create and/or review an order (see the form).';
    run.writeEntry('F1', entry);
    expect(check(run).status).toBe(0);
  });

  describe('a banned fragment inside a verified label', () => {
    // The label WorkBoard is camel-cased; it is verified map-wide by `names`.
    const withBoard = (entry) => {
      entry.who[0].can = 'Open the WorkBoard to see orders.';
    };

    it('passes when the map verifies it map-wide (names)', () => {
      const run = newRun();
      const entry = clone(run.entry);
      withBoard(entry);
      run.writeEntry('F1', entry);
      expect(check(run).status).toBe(0);
    });

    it('fails once the map no longer lists it, and a hit that only starts inside the label still fails', () => {
      const run = newRun((map) => {
        map.names = [];
      });
      const entry = clone(run.entry);
      withBoard(entry);
      run.writeEntry('F1', entry);
      const bad = check(run);
      expect(bad.status).toBe(1);
      expect(bad.stdout).toMatch(/who\[0\]\.can: "WorkBoard" is not allowed in reader text \(multi-hump word\)/);
      run.writeEntry();
      expect(check(run).status).toBe(0);
    });

    it('does not exempt a longer token that merely contains the label', () => {
      const run = newRun();
      const entry = clone(run.entry);
      entry.who[0].can = 'Open the WorkBoards to see orders.';
      run.writeEntry('F1', entry);
      const bad = check(run);
      expect(bad.status).toBe(1);
      expect(bad.stdout).toMatch(/"WorkBoards" is not allowed in reader text \(multi-hump word\)/);
    });

    it('exempts an entry-own label in that entry only', () => {
      const run = newRun((map) => {
        map.names = [];
      });
      const entry = clone(run.entry);
      entry.where.push({ label: 'WorkBoard', evidence: [{ file: 'src/menu.js', passage: "{ label: 'WorkBoard', path: '/board' }," }] });
      withBoard(entry);
      run.writeEntry('F1', entry);
      expect(check(run).status, check(run).stdout).toBe(0);

      // F2 is another entry: the label of F1's own `where` does not exempt anything there.
      const other = clone(entry);
      other.id = 'F2';
      other.where = other.where.slice(0, 2);
      run.writeEntry('F2', other);
      const bad = check(run, 'F2');
      expect(bad.status).toBe(1);
      expect(bad.stdout).toMatch(/who\[0\]\.can: "WorkBoard" is not allowed/);
    });

    it('does not exempt a label whose own evidence fails', () => {
      const run = newRun((map) => {
        map.names = [];
      });
      const entry = clone(run.entry);
      entry.where.push({ label: 'WorkBoard', evidence: [{ file: 'src/menu.js', passage: "{ label: 'WorkBoard', path: '/elsewhere' }," }] });
      withBoard(entry);
      run.writeEntry('F1', entry);
      const bad = check(run);
      expect(bad.status).toBe(1);
      expect(bad.stdout).toMatch(/where\[2\]\.evidence\[0\]: passage not in src\/menu\.js/);
      expect(bad.stdout).toMatch(/who\[0\]\.can: "WorkBoard" is not allowed/);
    });
  });
});

describe('check-entry: state, attempts and retries', () => {
  const breakEntry = (run) => {
    const entry = clone(run.entry);
    entry.who[0].can = 'Only clerk_admin may do this.';
    run.writeEntry('F1', entry);
  };

  it('records a failure with its reasons; the Next line asks for one more attempt, then the feature stays failed', () => {
    const run = newRun();
    expect(run.run('mark', 'F1', 'dispatched').lines).toEqual(['F1: dispatched, attempts 1']);
    breakEntry(run);
    const first = check(run);
    expect(first.status).toBe(1);
    expect(first.lines.at(-1)).toBe("Next: delete F1's entry, mark it dispatched and re-dispatch it once with the lines above (attempt 2 of 2)");
    const state = run.readJson('state.json').features.F1;
    expect(state.status).toBe('failed');
    expect(state.attempts).toBe(1);
    expect(state.failure.step).toBe('check-entry');
    expect(state.failure.reasons.join('\n')).toMatch(/clerk_admin/);

    expect(run.run('mark', 'F1', 'dispatched').lines).toEqual(['F1: dispatched, attempts 2']);
    expect(run.readJson('state.json').features.F1).toEqual({ status: 'dispatched', attempts: 2 });
    const second = check(run);
    expect(second.status).toBe(1);
    expect(second.lines.at(-1)).toBe('Next: F1 stays failed (2 of 2 attempts)');
    expect(run.readJson('state.json').features.F1.status).toBe('failed');
    expect(run.readJson('state.json').features.F1.attempts).toBe(2);

    const third = run.run('mark', 'F1', 'dispatched');
    expect(third.status).toBe(1);
    expect(third.stdout).toMatch(/F1: attempts is already 2, the most a lane gets/);
    // The entry file is kept for inspection.
    expect(run.readJson('entries/F1.json').who[0].can).toMatch(/clerk_admin/);
  });

  it('records a checked feature and refuses to dispatch it again; check-map keeps it', () => {
    const run = newRun();
    run.writeEntry();
    expect(check(run).status).toBe(0);
    const again = run.run('mark', 'F1', 'dispatched');
    expect(again.status).toBe(1);
    expect(again.stdout).toMatch(/F1: already checked; it is not written again/);
    expect(run.run('check-map').status).toBe(0);
    expect(run.readJson('state.json').features.F1.status).toBe('checked');
  });

  it('records a missing entry file as lane-wrote-nothing, step lane', () => {
    const run = newRun();
    const result = check(run);
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('F1: lane-wrote-nothing: entries/F1.json is missing');
    expect(result.lines.at(-1)).toMatch(/^Next: delete F1's entry/);
    expect(run.readJson('state.json').features.F1.failure).toEqual({ step: 'lane', reasons: ['F1: lane-wrote-nothing: entries/F1.json is missing'] });
  });

  it('mark failed lane records the reasons and only the lane step', () => {
    const run = newRun();
    const ok = run.run('mark', 'F1', 'failed', 'lane', 'lane-wrote-nothing');
    expect(ok.status).toBe(0);
    expect(run.readJson('state.json').features.F1).toEqual({ status: 'failed', attempts: 0, failure: { step: 'lane', reasons: ['lane-wrote-nothing'] } });
    expect(run.run('mark', 'F1', 'failed', 'check-entry', 'x').status).toBe(2);
    expect(run.run('mark', 'F1', 'failed', 'lane').status).toBe(2);
    expect(run.run('mark', 'F9', 'dispatched').status).toBe(2);
    expect(run.run('mark', 'F1', 'finished').status).toBe(2);
  });

  it('records an entry that is not JSON as a check-entry failure', () => {
    const run = newRun();
    writeFileSync(join(run.out, 'entries/F1.json'), '{ nope');
    const result = check(run);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/entries\/F1\.json is not valid JSON/);
    expect(run.readJson('state.json').features.F1.failure.step).toBe('check-entry');
  });

  it('a feature that is not in the map is a usage error; so is a run without state.json', () => {
    const run = newRun();
    expect(check(run, 'F9').status).toBe(2);
    const fresh = makeCheckedMapRun();
    cleanups.push(fresh.cleanup);
    writeFileSync(join(fresh.out, 'entries/F1.json'), '{}');
    expect(runHandbook(['check-entry', join(fresh.base, 'nowhere'), 'F1', '--project', fresh.root]).status).toBe(2);
  });

  it('waits for the state lock and then reports it (exit 2) instead of writing around it', () => {
    const run = newRun();
    run.writeEntry();
    writeFileSync(join(run.out, 'state.json.lock'), '99999\n');
    const result = runHandbook(['check-entry', run.out, 'F1', '--project', run.root], { env: { ...process.env, EXCAVATOR_HANDBOOK_LOCK_TIMEOUT_MS: '200' } });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/state\.json\.lock is held by pid 99999/);
  });
});

describe('try-entry: the lane checks its own file and nothing is recorded', () => {
  const tryIt = (run, id = 'F1') => run.run('try-entry', id);

  it('prints the same problems as check-entry and leaves state.json as it was', () => {
    const run = newRun();
    const entry = clone(run.entry);
    entry.purpose.evidence[0].passage = 'a passage that is in no file of the project';
    run.writeEntry('F1', entry);
    const before = run.readJson('state.json');
    const tried = tryIt(run);
    expect(tried.status).toBe(1);
    expect(tried.stdout).toMatch(/purpose\.evidence\[0\]: passage not in /);
    expect(tried.lines.at(-1)).toBe('Next: fix each line above in entries/F1.json and run try-entry again');
    expect(run.readJson('state.json')).toEqual(before);
    const checked = check(run);
    expect(checked.lines.slice(0, -1)).toEqual(tried.lines.slice(0, -1));
  });

  it('prints ok for the good entry and records neither checked nor an attempt', () => {
    const run = newRun();
    run.writeEntry();
    const before = run.readJson('state.json');
    const tried = tryIt(run);
    expect(tried.lines).toEqual(['F1: ok']);
    expect(tried.status).toBe(0);
    expect(run.readJson('state.json')).toEqual(before);
  });

  it('reports a missing entry as the lane writing nothing, without recording it', () => {
    const run = newRun();
    const before = run.readJson('state.json');
    const tried = tryIt(run);
    expect(tried.status).toBe(1);
    expect(tried.stdout).toMatch(/F1: lane-wrote-nothing/);
    expect(run.readJson('state.json')).toEqual(before);
  });
});
