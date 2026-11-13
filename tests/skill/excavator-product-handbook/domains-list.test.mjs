// Oracle of openspec change handbook-page-domain-map (task 1.1): `check domains` also checks
// domains.json, each rule with a red sample, the passing case records the file's digest in
// state.json, and the checks of the other chapters stay as they were.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FORM, chapterText, cite, newMdRun } from './md-run-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const C1 = `${FORM}:5-6`;
const C2 = `${FORM}:10-11`;
const DOMAINS_MD = `# Domains

The domains of the product:

- Order handling and Automatic work (${cite('5')})

## Order handling

Orders and the archive live here (${cite('5')}).

- Orders (F1) hands work to Reminders (F3) (\`${C1}\`).
- Archive (F2) is read by Admin tool (F4) (\`${C2}\`).

## Automatic work

Reminders (F3) send mail (${cite('10')}).
`;

const goodList = () => ({
  domains: [
    { name: 'Order handling', features: ['F1', 'F2', 'F5'] },
    { name: 'Automatic work', features: ['F3', 'F4'] },
  ],
  handovers: [
    { from: 'Order handling', to: 'Automatic work', what: 'Orders (F1) hands work to Reminders (F3)', cites: [C1] },
    { from: 'Automatic work', to: 'Order handling', what: 'Admin tool (F4) reads Archive (F2)', cites: [C2] },
  ],
});

function newRun() {
  const run = newMdRun({});
  cleanups.push(run.cleanup);
  run.writeList = (value) => writeFileSync(join(run.out, 'domains.json'), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  run.record = () => run.readJson('state.json').chapters.domains;
  return run;
}

/** `mutate(list)` must fail `check domains` with a line matching `expected`; the good list passes in the same run. */
function rejects(name, mutate, expected, text = DOMAINS_MD) {
  it(name, () => {
    const run = newRun();
    run.write('domains', text);
    const list = goodList();
    run.writeList(mutate(list) ?? list);
    const bad = run.check('domains');
    expect(bad.status, bad.stdout + bad.stderr).toBe(1);
    expect(bad.stdout).toMatch(expected);
    expect(run.record().json).toBeUndefined();
    run.writeList(goodList());
    const good = run.check('domains');
    expect(good.status, good.stdout + good.stderr).toBe(0);
  });
}

describe('domains.json: the passing case', () => {
  it('passes and records the sha256 of the file in the state record', () => {
    const run = newRun();
    run.write('domains', DOMAINS_MD);
    run.writeList(goodList());
    const result = run.check('domains');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const bytes = Buffer.from(`${JSON.stringify(goodList(), null, 2)}\n`);
    expect(run.record()).toEqual({ status: 'passed', attempts: 1, reasons: [], sha256: expect.any(String), json: createHash('sha256').update(bytes).digest('hex') });
    expect(run.readJson('state.json').format).toBe('excavator-product-handbook-state/2');
  });

  it('a rewrite that only fixes domains.json is a new attempt', () => {
    const run = newRun();
    run.write('domains', DOMAINS_MD);
    run.writeList({ ...goodList(), handovers: [{ ...goodList().handovers[0], cites: [] }] });
    expect(run.check('domains').status).toBe(1);
    expect(run.record().attempts).toBe(1);
    run.writeList(goodList());
    expect(run.check('domains').status).toBe(0);
    expect(run.record().attempts).toBe(2);
    expect(run.check('domains').status).toBe(0);
    expect(run.record().attempts).toBe(2);
  });

  it('a list with no hand-overs passes', () => {
    const run = newRun();
    run.write('domains', DOMAINS_MD);
    run.writeList({ ...goodList(), handovers: [] });
    expect(run.check('domains').status).toBe(0);
  });
});

describe('domains.json: the file', () => {
  it('a missing file fails the chapter and records no json', () => {
    const run = newRun();
    run.write('domains', DOMAINS_MD);
    const result = run.check('domains');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/domains\.json: the file does not exist/);
    expect(run.record().status).toBe('failed');
    expect(run.record().json).toBeUndefined();
  });

  it('a file that is not JSON fails', () => {
    const run = newRun();
    run.write('domains', DOMAINS_MD);
    run.writeList('{ "domains": ');
    expect(run.check('domains').stdout).toMatch(/domains\.json: is not valid JSON/);
  });

  rejects('an extra top-level key fails', (list) => ({ ...list, extra: 1 }), /exactly the keys "domains" and "handovers"/);
  rejects('a domain with an extra key fails', (list) => { list.domains[0].intro = 'x'; }, /domains\[0\] must be an object with exactly/);
  rejects('features that are not a list of texts fail', (list) => { list.domains[1].features = [3]; }, /domains\[1\] must be an object with exactly/);
  rejects('a hand-over without cites fails the shape', (list) => { delete list.handovers[0].cites; }, /handovers\[0\] must be an object with exactly/);
  rejects('domains that are not a list fail', (list) => ({ ...list, domains: {} }), /"domains" must be a list/);
});

describe('domains.json: the domains', () => {
  rejects('an empty name', (list) => { list.domains[0].name = '  '; }, /domains\[0\]: the name is empty/);
  rejects('a duplicated name', (list) => { list.domains[1].name = 'Order handling'; }, /domain "Order handling": the name is listed more than once/);
  rejects('a name that is not a level-2 heading', (list) => { list.domains[0].name = 'Order'; list.handovers = []; }, /domain "Order": the name is not exactly the text of a level-2 heading/);
  rejects('a name that is a level-3 heading only', (list) => { list.domains[0].name = 'Sub part'; list.handovers = []; }, /domain "Sub part": the name is not exactly/, `${DOMAINS_MD}\n### Sub part\n\nMore (${cite('5')}).\n`);
  rejects('a feature in no domain', (list) => { list.domains[0].features = ['F1', 'F2']; }, /features not in any domain: F5/);
  rejects('a feature in two domains', (list) => { list.domains[1].features.push('F1'); }, /feature F1 is listed more than once \("Order handling", "Automatic work"\)/);
  rejects('a feature id that is not in the map', (list) => { list.domains[1].features.push('F99'); }, /feature ids not in map\.json: F99/);
});

describe('domains.json: the hand-overs', () => {
  rejects('an end that is not a listed domain', (list) => { list.handovers[0].to = 'Billing'; }, /hand-over 0 \(Order handling -> Billing\): "to" is not a listed domain/);
  rejects('a from that is not a listed domain', (list) => { list.handovers[1].from = 'Billing'; }, /hand-over 1 \(Billing -> Order handling\): "from" is not a listed domain/);
  rejects('the same domain at both ends', (list) => { list.handovers[0].to = 'Order handling'; }, /hand-over 0 \(Order handling -> Order handling\): .*same domain/);
  rejects('a duplicate hand-over', (list) => { list.handovers.push({ ...list.handovers[0] }); }, /hand-over 2 \(Order handling -> Automatic work\): the same hand-over/);
  rejects('an empty what', (list) => { list.handovers[0].what = ' '; }, /hand-over 0 \(.*\): "what" is empty/);
  rejects('a what with a backtick', (list) => { list.handovers[0].what = 'uses `x`'; }, /hand-over 0 \(.*\): "what" holds a backtick or a citation group/);
  rejects('a what with a citation group', (list) => { list.handovers[0].what = `Orders (F1) (\`${C1}\`)`; }, /"what" holds a backtick or a citation group/);
  rejects('empty cites', (list) => { list.handovers[0].cites = []; }, /hand-over 0 \(.*\): "cites" is empty/);
  rejects('a citation of the wrong form', (list) => { list.handovers[0].cites = [`${FORM}:5`]; }, /citation "src\/forms\/order-form\.js:5" is not written as <path>:<a>-<b>/);
  rejects('a citation with a after b', (list) => { list.handovers[0].cites = [`${FORM}:9-3`]; }, /citation ".*:9-3" is not written as/);
  rejects('a citation with a zero start', (list) => { list.handovers[0].cites = [`${FORM}:0-3`]; }, /citation ".*:0-3" is not written as/);
  rejects('a citation that is not in domains.md', (list) => { list.handovers[1].cites = [`${FORM}:20-21`]; }, /hand-over 1 \(Automatic work -> Order handling\): citation "src\/forms\/order-form\.js:20-21" does not occur in domains\.md/);
});

describe('domains.json: other chapters are unchanged', () => {
  it('the other cross chapters and the feature chapters need no domains.json', () => {
    const run = newRun();
    run.write('F1', chapterText('Orders'));
    run.write('roles', `# Roles\n\n- Clerk (${cite('5')})\n`);
    run.write('system', chapterText('System'));
    const result = run.check();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    for (const name of ['F1', 'roles', 'system']) expect(run.readJson('state.json').chapters[name].json).toBeUndefined();
  });

  it('a bad domains.json does not fail another chapter checked in the same run', () => {
    const run = newRun();
    run.write('domains', DOMAINS_MD);
    run.write('F1', chapterText('Orders'));
    const result = run.check();
    expect(result.stdout).toContain('chapters/F1.md: passed');
    expect(result.stdout).toContain('chapters/domains.md: failed');
  });

  it('--no-record prints the domains.json reasons and writes no state', () => {
    const run = newRun();
    run.write('domains', DOMAINS_MD);
    const result = run.check('domains', '--no-record');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/domains\.json: the file does not exist/);
    expect(() => run.readJson('state.json')).toThrow();
  });
});
