// Oracle O1 of openspec change handbook-deep-entry (script side, entry format /2):
// the shape accepts and rejects the new parts, handoff ids are read against the map,
// transition states are label-checked, each new element is its own verify item whose
// claim names the section, the operation and the part, an operation with no step left
// takes its other parts with it, a settled /1 entry still assembles, and the topic facts
// carry the new kinds.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { entryShapeProblems } from '../../../skills/excavator-product-handbook/lib/entry-shape.mjs';
import { entryItems } from '../../../skills/excavator-product-handbook/lib/items.mjs';
import { trimEntry } from '../../../skills/excavator-product-handbook/lib/trim-entry.mjs';
import { entryFactRows } from '../../../skills/excavator-product-handbook/lib/topics-facts.mjs';
import { entryDigest } from '../../../skills/excavator-product-handbook/lib/state.mjs';
import { clone, goodEntry, judge, makeCheckedMapRun, runHandbook, traceFeature } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const form = 'src/forms/order-form.js';
const nameField = "{ label: 'Customer Name', required: true },";
const countField = "{ label: 'Item Count', max: 35000 },";
const statuses = "const statuses = ['Draft', 'Submitted'];";
const ev = (file, passage) => ({ file, passage });

/** The good entry with every new part filled once: one trigger, calculation, change, edge and handoff, and one transition. */
function deepEntry() {
  const entry = goodEntry();
  const operation = entry.operations[0];
  operation.triggers = [{ text: 'The clerk opens the new order form.', evidence: [ev(form, "title: 'New Order',")] }];
  operation.calculations = [{ text: 'The item count is capped at 35000.', evidence: [ev(form, countField)] }];
  operation.changes = [{ text: 'The customer name is stored with the order.', evidence: [ev(form, nameField)] }];
  operation.edges = [{ when: 'The item count is above 35000', then: 'The order is refused.', evidence: [ev(form, countField)] }];
  operation.handoffs = [{ feature: 'F2', text: 'Finished orders move to the archive.', evidence: [ev(form, nameField)] }];
  entry.transitions = [{ from: 'Draft', to: 'Submitted', by: 'The clerk sends the order.', evidence: [ev(form, statuses)] }];
  return entry;
}

function checkedRun(entry) {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  run.writeEntry('F1', entry);
  const checked = run.run('check-entry', 'F1');
  expect(checked.status, checked.stdout).toBe(0);
  return run;
}

function rejects(name, mutate, expected) {
  it(name, () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    const entry = deepEntry();
    mutate(entry);
    run.writeEntry('F1', entry);
    const bad = run.run('check-entry', 'F1');
    expect(bad.status, bad.stdout).toBe(1);
    expect(bad.stdout).toMatch(expected);
    run.writeEntry('F1', deepEntry());
    const good = run.run('check-entry', 'F1');
    expect(good.status, good.stdout).toBe(0);
  });
}

describe('entry /2: shape and checks', () => {
  it('passes check-entry with every new part filled', () => {
    checkedRun(deepEntry());
  });

  rejects('a handoff to a feature that is not in the map', (entry) => {
    entry.operations[0].handoffs[0].feature = 'F9';
  }, /operations\[0\]\.handoffs\[0\]\.feature: .*F9.*not a feature in map\.json/);

  rejects('a handoff to the feature itself', (entry) => {
    entry.operations[0].handoffs[0].feature = 'F1';
  }, /operations\[0\]\.handoffs\[0\]\.feature: .*F1.*itself/);

  rejects('a transition whose to-state is not in its passages', (entry) => {
    entry.transitions[0].to = 'Approved';
  }, /transitions\[0\]\.to: label "Approved" does not occur/);

  rejects('a transition whose from-state is not in its passages', (entry) => {
    entry.transitions[0].from = 'Pending';
  }, /transitions\[0\]\.from: label "Pending" does not occur/);

  rejects('an edge without its then', (entry) => {
    delete entry.operations[0].edges[0].then;
  }, /operations\[0\]\.edges\[0\]: missing key "then"/);

  rejects('a new list with a missing evidence list', (entry) => {
    entry.operations[0].triggers[0].evidence = [];
  }, /operations\[0\]\.triggers\[0\]\.evidence: must have at least 1 item/);

  rejects('an operation without a new list', (entry) => {
    delete entry.operations[0].calculations;
  }, /operations\[0\]: missing key "calculations"/);

  rejects('an entry without transitions', (entry) => {
    delete entry.transitions;
  }, /\(top level\): missing key "transitions"/);

  rejects('a number in a calculation that its passages do not hold', (entry) => {
    entry.operations[0].calculations[0].text = 'The item count is capped at 777.';
  }, /operations\[0\]\.calculations\[0\]\.text: number 777 does not occur/);

  rejects('a code-shaped word in an edge', (entry) => {
    entry.operations[0].edges[0].then = 'The itemCount check refuses it.';
  }, /operations\[0\]\.edges\[0\]\.then: .*itemCount/);

  it('rejects a newly written /1 entry and says new entries are /2', () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    const entry = clone(goodEntry());
    entry.format = 'excavator-product-handbook-entry/1';
    run.writeEntry('F1', entry);
    const bad = run.run('check-entry', 'F1');
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/format: .*excavator-product-handbook-entry\/2.*new entr/);
  });

  it('accepts a /1 entry only as a settled one, with the new lists absent', () => {
    const v1 = clone(goodEntry());
    v1.format = 'excavator-product-handbook-entry/1';
    for (const operation of v1.operations) for (const key of ['triggers', 'calculations', 'changes', 'edges', 'handoffs']) delete operation[key];
    delete v1.transitions;
    expect(entryShapeProblems(v1, { settled: true })).toEqual([]);
    expect(entryShapeProblems(v1).join('\n')).toMatch(/entry\/2/);
    // A settled /2 entry keeps the new keys required.
    const v2 = clone(goodEntry());
    delete v2.transitions;
    expect(entryShapeProblems(v2, { settled: true }).join('\n')).toMatch(/missing key "transitions"/);
  });
});

describe('entry /2: items and claims', () => {
  it('makes each new element a verify item whose claim names the section, the operation and the part', () => {
    const run = checkedRun(deepEntry());
    expect(run.run('slices', 'F1').status).toBe(0);
    const verify = JSON.parse(readFileSync(join(run.out, 'verify', 'round-1', 'F1', 'part-1.json'), 'utf-8'));
    const claim = (id) => verify.items.find((item) => item.id === id)?.claim;
    expect(claim('operations[0].triggers[0]')).toBe('Operations > Place an order > Starts when > The clerk opens the new order form.');
    expect(claim('operations[0].calculations[0]')).toBe('Operations > Place an order > Calculations > The item count is capped at 35000.');
    expect(claim('operations[0].changes[0]')).toBe('Operations > Place an order > Data changes > The customer name is stored with the order.');
    expect(claim('operations[0].edges[0]')).toBe('Operations > Place an order > Edge cases > When The item count is above 35000: The order is refused.');
    // The handoff's claim names the feature it hands to (its map name), so the link is judged with the text.
    expect(claim('operations[0].handoffs[0]')).toBe('Operations > Place an order > Hands over to > Archive: Finished orders move to the archive.');
    expect(claim('transitions[0]')).toBe('State changes > From Draft to Submitted, caused by The clerk sends the order.');
    expect(claim('operations[0].sentences[0]')).toBe('Operations > Place an order > The clerk fills in the customer name.');
  });

  it('lists the new items after the sentences of their operation, and the transitions after the states', () => {
    const paths = entryItems(deepEntry()).map((item) => item.path);
    const at = (path) => paths.indexOf(path);
    expect(at('operations[0].sentences[1]')).toBeLessThan(at('operations[0].triggers[0]'));
    expect(at('operations[0].triggers[0]')).toBeLessThan(at('operations[0].calculations[0]'));
    expect(at('operations[0].handoffs[0]')).toBeLessThan(at('states[0]'));
    expect(at('states[1]')).toBeLessThan(at('transitions[0]'));
  });

  it('skips the label, number and banned-word checks of a handoff feature id, which is not reader text', () => {
    const handoff = entryItems(deepEntry()).find((item) => item.path === 'operations[0].handoffs[0]');
    expect(handoff.strings.map((string) => string.path)).toEqual(['operations[0].handoffs[0].text']);
  });
});

describe('entry /2: trimming and removal records', () => {
  it('removes a single new element and keeps the rest', () => {
    const { entry, together } = trimEntry(deepEntry(), new Set(['operations[0].triggers[0]', 'transitions[0]']));
    expect(entry.operations[0].triggers).toEqual([]);
    expect(entry.operations[0].handoffs).toHaveLength(1);
    expect(entry.transitions).toEqual([]);
    expect(together).toEqual([]);
  });

  it('takes the other parts of an operation with it when no sentence is left, as withParent', () => {
    const run = checkedRun(deepEntry());
    const decide = (item) => (item.id.startsWith('operations[0].sentences') ? { verdict: 'contradicted', reason: 'The code shown says otherwise.' } : 'verified');
    expect(judge(run, 'F1', 1, decide).status).toBe(0);
    const records = run.readJson('state.json').features.F1.removed;
    const byPath = new Map(records.map((record) => [record.path, record]));
    for (const path of ['operations[0].triggers[0]', 'operations[0].calculations[0]', 'operations[0].changes[0]', 'operations[0].edges[0]', 'operations[0].handoffs[0]', 'operations[0]']) {
      expect(byPath.get(path)?.verdict, path).toBe('withParent');
    }
    expect(byPath.get('operations[0].sentences[0]').verdict).toBe('contradicted');
    const entry = run.readJson('entries/F1.json');
    expect(entry.operations).toEqual([]);
    expect(entry.transitions).toHaveLength(1);
  });
});

describe('entry /2: handbook.md and a settled /1 entry', () => {
  const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
  const stubDir = mkdtempSync(join(tmpdir(), 'xhb-deep-'));
  const stubPath = join(stubDir, 'template.html');
  writeFileSync(stubPath, STUB);
  afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

  function verifiedRun(entry) {
    const run = checkedRun(entry);
    expect(judge(run, 'F1').status).toBe(0);
    expect(traceFeature(run).status).toBe(0);
    return run;
  }
  const assemble = (run) => {
    const result = run.run('assemble');
    expect(result.status, result.stdout).toBe(0);
    return readFileSync(join(run.out, 'handbook.md'), 'utf-8');
  };

  it('writes the new parts under their operation and the transitions under the states', () => {
    const text = assemble(verifiedRun(deepEntry()));
    const operation = text.slice(text.indexOf('##### Place an order'), text.indexOf('#### States'));
    for (const line of [
      'Starts when', '- The clerk opens the new order form.',
      'Calculations', '- The item count is capped at 35000.',
      'Data changes', '- The customer name is stored with the order.',
      'Edge cases', '- When The item count is above 35000: The order is refused.',
      'Hands over to', '- Archive: Finished orders move to the archive.',
    ]) expect(operation, line).toContain(line);
    const states = text.slice(text.indexOf('#### States'), text.indexOf('#### Notifications'));
    expect(states).toContain('State changes');
    expect(states).toContain('- From Draft to Submitted, caused by The clerk sends the order.');
  });

  it('numbers the steps and follows them with the sequence diagram and its note, and draws the transitions as a state diagram', () => {
    const text = assemble(verifiedRun(deepEntry()));
    const operation = text.slice(text.indexOf('##### Place an order'), text.indexOf('#### States'));
    expect(operation).toMatch(/\*\*Steps\*\*\n\n1\. /);
    const diagram = operation.slice(operation.indexOf('```mermaid'));
    expect(diagram.startsWith('```mermaid\nsequenceDiagram\n  participant P0 as User\n')).toBe(true);
    expect(diagram).toContain('  P0->>P1: 1');
    expect(operation.indexOf('```mermaid')).toBeGreaterThan(operation.indexOf('1. '));
    expect(operation.indexOf('```mermaid')).toBeLessThan(operation.indexOf('Calculations'));
    expect(operation).toContain('each arrow is numbered like the step it stands for');
    const states = text.slice(text.indexOf('#### States'), text.indexOf('#### Notifications'));
    expect(states).toContain('```mermaid\nstateDiagram-v2\n  state "Draft" as S0\n  state "Submitted" as S1\n  S0 --> S1: The clerk sends the order.\n```');
  });

  it('assembles and builds the page for a settled /1 entry, with only the steps', () => {
    const run = verifiedRun(deepEntry());
    const file = join(run.out, 'entries', 'F1.json');
    const v1 = JSON.parse(readFileSync(file, 'utf-8'));
    v1.format = 'excavator-product-handbook-entry/1';
    for (const operation of v1.operations) for (const key of ['triggers', 'calculations', 'changes', 'edges', 'handoffs']) delete operation[key];
    delete v1.transitions;
    writeFileSync(file, `${JSON.stringify(v1, null, 2)}\n`);
    const state = run.readJson('state.json');
    state.features.F1.entryDigest = entryDigest(file);
    writeFileSync(join(run.out, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
    const text = assemble(run);
    expect(text).toContain('The clerk fills in the customer name.');
    expect(text).not.toContain('Starts when');
    expect(text).not.toContain('State changes');
    expect(text).not.toContain('stateDiagram-v2');
    expect(text).toContain('sequenceDiagram');
    const page = runHandbook(['page', run.out, '--project', run.root], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
    expect(page.status, page.stdout + page.stderr).toBe(0);
  });
});

describe('entry /2: topic facts', () => {
  it('gives each new element its own row with the kind named, the handoff with the feature it hands to', () => {
    const rows = entryFactRows({ id: 'F1', name: 'Orders' }, deepEntry());
    const kinds = rows.map((row) => [row.path, row.itemKind]);
    expect(kinds).toEqual(expect.arrayContaining([
      ['operations[0].triggers[0]', 'trigger'],
      ['operations[0].calculations[0]', 'calculation'],
      ['operations[0].changes[0]', 'change'],
      ['operations[0].edges[0]', 'edge'],
      ['operations[0].handoffs[0]', 'handoff'],
      ['transitions[0]', 'transition'],
    ]));
    const handoff = rows.find((row) => row.itemKind === 'handoff');
    expect(handoff.fields).toEqual(['Orders', 'handoff', 'Place an order: Finished orders move to the archive.', 'F2']);
    expect(handoff.toFeature).toBe('F2');
    expect(rows.find((row) => row.itemKind === 'transition').text).toBe('Draft -> Submitted: The clerk sends the order.');
    expect(rows.find((row) => row.itemKind === 'edge').text).toBe('Place an order: The item count is above 35000: The order is refused.');
  });

  it('gives a /1 entry the rows it had before', () => {
    const v1 = clone(goodEntry());
    for (const operation of v1.operations) for (const key of ['triggers', 'calculations', 'changes', 'edges', 'handoffs']) delete operation[key];
    delete v1.transitions;
    expect(entryFactRows({ id: 'F1', name: 'Orders' }, v1).map((row) => row.itemKind)).toEqual(['who', 'sentence', 'sentence', 'state', 'state']);
  });
});

// Design D5 of handbook-deep-entry: the purpose, the navigation path, the screens and the field labels of a feature
// are settled by the two verifiers only; the trace file leaves them out, the field rules and every other item stay,
// and the coverage section says which kinds were not traced.
describe('entry /2: the trace leaves out the label and purpose items', () => {
  it('writes no purpose, navigation path, screen or field label to the trace file, and keeps the rules and the rest', () => {
    const run = checkedRun(deepEntry());
    expect(judge(run, 'F1').status).toBe(0);
    const traced = run.run('trace', 'F1');
    expect(traced.status, traced.stdout).toBe(0);
    const ids = run.readJson('trace/F1/part-1.json').items.map((item) => item.id);
    for (const id of ids) expect(id).not.toMatch(/^(purpose|where\[\d+\]|screens\[\d+\](\.fields\[\d+\])?)$/);
    for (const id of ['who[0]', 'screens[0].fields[0].rules[0]', 'operations[0].sentences[0]', 'operations[0].triggers[0]', 'operations[0].handoffs[0]', 'states[0]', 'transitions[0]']) expect(ids).toContain(id);
  });

  it('keeps the untraced items in the verified entry and says in the coverage section that they were not traced', () => {
    const run = checkedRun(deepEntry());
    expect(judge(run, 'F1').status).toBe(0);
    expect(traceFeature(run).status).toBe(0);
    const entry = run.readJson('entries/F1.json');
    expect(entry.purpose).toBeDefined();
    expect(entry.where).toHaveLength(2);
    expect(entry.screens[0].fields).toHaveLength(2);
    const assembled = run.run('assemble');
    expect(assembled.status, assembled.stdout).toBe(0);
    const text = readFileSync(join(run.out, 'handbook.md'), 'utf-8');
    const coverage = text.slice(text.indexOf('## Coverage'));
    expect(coverage).toContain('The purpose, the navigation path, the screens and the field labels of a feature are checked by the two verifiers only; they are not traced.');
  });
});
