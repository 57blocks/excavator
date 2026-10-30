// Design D14 of openspec change product-handbook-map: only a verified feature
// is written into the handbook, the page data and the reply count it; the
// coverage section names a feature whose verification did not finish and lists,
// per feature, the items removed with each verdict and reason.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clone, judge, makeCheckedMapRun, runHandbook, verifyChecked } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

/** A run whose F1 entry passed check-entry and nothing more. */
function checkedRun() {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  run.writeEntry('F1', clone(run.entry));
  expect(run.run('check-entry', 'F1').status).toBe(0);
  return run;
}

/** A run whose F1 entry had one backend rule removed in round 2 and one state with it. */
function removedRun() {
  const run = checkedRun();
  const bad = { 'screens[0].fields[1].rules[0]': 'contradicted', 'states[1]': 'unverified' };
  expect(judge(run, 'F1', 1, (item) => (bad[item.id] ? { verdict: bad[item.id], reason: `Round 1: ${item.id}.` } : 'verified')).status).toBe(0);
  const round2 = judge(run, 'F1', 2, (item) => (item.id === 'states[1]'
    ? { verdict: 'unverified', reason: 'No line shown names the state.' }
    : { verdict: 'contradicted', reason: 'The condition shown caps the count at 50.' }));
  expect(round2.status, round2.stdout).toBe(0);
  return run;
}

/** Round 1 and round 2 judge every item not verified, so nothing is proved and the feature fails at verify. */
function failedAtVerifyRun() {
  const run = checkedRun();
  expect(judge(run, 'F1', 1, () => 'unverified').status).toBe(0);
  const round2 = judge(run, 'F1', 2, () => ({ verdict: 'unverified', reason: 'Nothing shown says why.' }));
  expect(round2.lines).toEqual(['F1: failed at verify: no item could be proved']);
  return run;
}

/** Round 2 removes only the purpose: the feature stays verified without it. */
function purposeRemovedRun() {
  const run = checkedRun();
  expect(judge(run, 'F1', 1, (item) => (item.id === 'purpose' ? 'unverified' : 'verified')).status).toBe(0);
  const round2 = judge(run, 'F1', 2, () => ({ verdict: 'unverified', reason: 'No line shown says why.' }));
  expect(round2.lines).toEqual(['F1: verified, 1 item removed']);
  return run;
}

const assemble = (run) => {
  const result = run.run('assemble');
  expect(result.status, result.stdout).toBe(0);
  return readFileSync(join(run.out, 'handbook.md'), 'utf-8');
};
const page = (run) => runHandbook(['page', run.out, '--project', run.root], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
const dataOf = (run) => JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(readFileSync(join(run.out, 'handbook.html'), 'utf-8'))[1]);

describe('assemble: only a verified feature is in the body', () => {
  it('leaves a checked feature out of the body and names it in the coverage section as verification not finished', () => {
    const run = checkedRun();
    const text = assemble(run);
    expect(text).not.toContain('### Orders\n\nHow readers get to it');
    expect(text).not.toContain('Staff place new orders for customers.');
    expect(text).toContain('| F1 Orders (Order handling) | Written, verification not finished |');
  });

  it('puts the same feature into the body once it is verified, and out of the unwritten list', () => {
    const run = checkedRun();
    verifyChecked(run);
    const text = assemble(run);
    expect(text).toContain('### Orders\n\nHow readers get to it: From the menu');
    expect(text).not.toContain('F1 Orders (Order handling) |');
  });

  it('leaves a feature that waits for its rewrite out of the body', () => {
    const run = checkedRun();
    judge(run, 'F1', 1, (item) => (item.id === 'purpose' ? 'unverified' : 'verified'));
    const text = assemble(run);
    expect(text).not.toContain('Staff place new orders for customers.');
    expect(text).toContain('| F1 Orders (Order handling) | Written, verification not finished |');
  });
});

describe('assemble: the removed items are listed in the coverage section', () => {
  it('lists, per feature, the count and each removed item with its result and reason, and writes none of them in the body', () => {
    const run = removedRun();
    const text = assemble(run);
    const body = text.slice(0, text.indexOf('## Coverage'));
    const section = text.slice(text.indexOf('### Items removed because the code did not back them up'));
    expect(section).toContain('#### F1 Orders (Order handling): items removed: 2');
    expect(section).toContain('| Item removed | Result | Reason |');
    expect(section).toContain('| Screen: New Order > Field: Item Count > Backend rules > At most 35,000 items. | The code shown says otherwise | The condition shown caps the count at 50. |');
    expect(section).toContain('| State: Submitted; Meaning: The order was sent. | The code shown does not settle it | No line shown names the state. |');
    expect(body).not.toContain('At most 35,000 items.');
    expect(body).not.toContain('The order was sent.');
    expect(body).toContain('The order is not sent yet.');
  });

  it('writes a feature whose purpose was removed without a purpose section, and lists the removed purpose in the coverage section', () => {
    const run = purposeRemovedRun();
    const text = assemble(run);
    const body = text.slice(0, text.indexOf('## Coverage'));
    expect(body).toContain('### Orders');
    expect(body).toContain('#### Who can use it');
    expect(body).not.toContain('#### Purpose');
    expect(body).not.toContain('Staff place new orders for customers.');
    expect(text).not.toContain('| F1 Orders (Order handling) | Failed the checks |');
    expect(text).toContain('| Purpose > Staff place new orders for customers. | The code shown does not settle it | No line shown says why. |');
  });

  it('says none when nothing was removed', () => {
    const run = checkedRun();
    verifyChecked(run);
    expect(assemble(run)).toContain('### Items removed because the code did not back them up\n\nNone.');
  });

  it('lists the items of a feature that failed at verify, and the feature as failed', () => {
    const run = failedAtVerifyRun();
    const text = assemble(run);
    expect(text).toContain('| F1 Orders (Order handling) | Failed the checks |');
    expect(text).toContain('#### F1 Orders (Order handling): items removed: 15');
    expect(text).toContain('| Purpose > Staff place new orders for customers. | The code shown does not settle it | Nothing shown says why. |');
  });

  it('shows a child that went with its parent with the text of that result and no reason', () => {
    const run = checkedRun();
    judge(run, 'F1', 1, (item) => (item.id === 'screens[0]' ? 'unverified' : 'verified'));
    judge(run, 'F1', 2, (item) => (item.id === 'screens[0]' ? { verdict: 'unverified', reason: 'No line names the screen.' } : 'verified'));
    const text = assemble(run);
    expect(text).toContain('items removed: 6');
    expect(text).toContain('| Screen: New Order > Field: Customer Name | Removed together with the item it belongs to | - |');
  });

  it('gives the same bytes on two runs, and holds no citation path, in the markdown or in the page', () => {
    const run = removedRun();
    const first = assemble(run);
    expect(assemble(run)).toBe(first);
    expect(page(run).status).toBe(0);
    const html = readFileSync(join(run.out, 'handbook.html'), 'utf-8');
    for (const file of ['src/forms/order-form.js', 'src/menu.js', 'src/roles.js']) {
      expect(first).not.toContain(file);
      expect(html).not.toContain(file);
    }
  });
});

describe('page: the status and the removed items', () => {
  it('gives a checked feature no entry and a verified one its entry, and lists the removed items by feature', () => {
    const run = removedRun();
    run.writeEntry('F2', { ...clone(run.entry), id: 'F2' });
    expect(run.run('check-entry', 'F2').status).toBe(0);
    expect(page(run).status).toBe(0);
    const data = dataOf(run);
    const [f1, f2] = data.features;
    expect(f1.status).toBe('verified');
    expect(f1.entry.screens[0].fields[1].rules).toEqual([{ side: 'frontend', text: 'An upload may hold up to 100,000 bytes.' }]);
    expect(f2.status).toBe('checked');
    expect(f2.entry).toBeNull();
    expect(data.coverage.removed).toEqual([{
      feature: 'F1',
      items: [
        { claim: 'Screen: New Order > Field: Item Count > Backend rules > At most 35,000 items.', verdict: 'contradicted', reason: 'The condition shown caps the count at 50.' },
        { claim: 'State: Submitted; Meaning: The order was sent.', verdict: 'unverified', reason: 'No line shown names the state.' },
      ],
    }]);
  });

  it('builds the page data of a verified feature whose purpose was removed: no purpose key, every other section, the purpose in the removed list', () => {
    const run = purposeRemovedRun();
    const built = page(run);
    expect(built.status, built.stdout).toBe(0);
    const data = dataOf(run);
    const entry = data.features[0].entry;
    expect(data.features[0].status).toBe('verified');
    expect(Object.hasOwn(entry, 'purpose')).toBe(false);
    expect(entry.who).toEqual([{ role: 'Clerk', can: expect.any(String) }]);
    expect(entry.screens).toHaveLength(1);
    expect(data.coverage.removed).toEqual([{
      feature: 'F1',
      items: [{ claim: 'Purpose > Staff place new orders for customers.', verdict: 'unverified', reason: 'No line shown says why.' }],
    }]);
  });

  it('has an empty removed list when nothing was removed', () => {
    const run = checkedRun();
    verifyChecked(run);
    expect(page(run).status).toBe(0);
    expect(dataOf(run).coverage.removed).toEqual([]);
  });
});

describe('reply: counts by status including verified', () => {
  it('counts a checked and a verified feature apart', () => {
    const run = checkedRun();
    run.writeEntry('F2', { ...clone(run.entry), id: 'F2' });
    expect(run.run('check-entry', 'F2').status).toBe(0);
    verifyChecked(run, 'F1');
    expect(run.run('assemble').status).toBe(0);
    expect(run.run('reply').lines[2]).toBe('Features: 5 (planned 3, dispatched 0, checked 1, verified 1, failed 0)');
  });

  it('counts a feature that failed at verify as failed and names it', () => {
    const run = failedAtVerifyRun();
    expect(run.run('assemble').status).toBe(0);
    const lines = run.run('reply').lines;
    expect(lines[2]).toBe('Features: 5 (planned 4, dispatched 0, checked 0, verified 0, failed 1)');
    expect(lines[3]).toBe('Failed: F1');
  });
});
