// Oracle O5 (assemble half) of openspec change product-handbook-map:
// handbook.md is the same bytes from the same input, holds no citation path,
// and its coverage counts equal the map's and candidates.json's.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SHIPPED_UI, clone, makeCheckedMapRun, runHandbook } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function newRun() {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  return run;
}

/** A run whose F1 entry is written and checked. */
function checkedRun(adjust) {
  const run = newRun();
  const entry = clone(run.entry);
  adjust?.(entry);
  run.writeEntry('F1', entry);
  const result = run.run('check-entry', 'F1');
  expect(result.status, result.stdout).toBe(0);
  return run;
}

const handbook = (run) => readFileSync(join(run.out, 'handbook.md'), 'utf-8');
const assemble = (run) => run.run('assemble');
const cjk = (...points) => String.fromCodePoint(...points);

/** Every file name that the map or an entry cites. */
function citedFiles(...documents) {
  const files = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') {
      if (typeof value.file === 'string' && typeof value.passage === 'string') files.add(value.file);
      Object.values(value).forEach(walk);
    }
  };
  documents.forEach(walk);
  return [...files];
}

describe('assemble: deterministic bytes', () => {
  it('writes handbook.md and prints its path', () => {
    const run = checkedRun();
    const result = assemble(run);
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual([join(run.out, 'handbook.md')]);
    expect(handbook(run).startsWith('# Product handbook\n')).toBe(true);
    expect(handbook(run).endsWith('\n')).toBe(true);
  });

  it('gives identical bytes on two runs, from separate copies of the same input, at different paths and times', () => {
    const first = checkedRun();
    const second = checkedRun();
    expect(first.root).not.toBe(second.root);
    assemble(first);
    const before = readFileSync(join(first.out, 'handbook.md'));
    assemble(first);
    expect(readFileSync(join(first.out, 'handbook.md')).equals(before)).toBe(true);
    assemble(second);
    expect(readFileSync(join(second.out, 'handbook.md')).equals(before)).toBe(true);
  });

  it('does not change when only the attempt count in state.json changes', () => {
    const run = checkedRun();
    assemble(run);
    const before = handbook(run);
    const state = run.readJson('state.json');
    state.features.F3.attempts = 1;
    run.writeJson(join(run.out, 'state.json'), state);
    assemble(run);
    expect(handbook(run)).toBe(before);
  });
});

describe('assemble: what the text holds', () => {
  it('holds no citation path, no project path, no out path and no candidate file name', () => {
    const run = checkedRun();
    assemble(run);
    const text = handbook(run);
    const files = citedFiles(run.map, run.entry);
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) expect(text).not.toContain(file);
    for (const file of run.candidates.items.map((item) => item.file)) expect(text).not.toContain(file);
    expect(text).not.toContain(run.root);
    expect(text).not.toContain(run.out);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toContain('.excavator');
  });

  it('lists areas with their features and the reach counts at the top', () => {
    const run = checkedRun();
    assemble(run);
    const text = handbook(run);
    const top = text.slice(0, text.indexOf('## Order handling'));
    expect(top).toContain('- **Order handling**\n  - Orders (From the menu)\n  - Archive (By a link)');
    expect(top).toContain('- **Automatic work**\n  - Reminders (Automatic)\n  - Admin tool (Operator command)\n  - Orders (Interface for other systems)');
    expect(top).toContain('| From the menu | 1 |');
  });

  it('writes the checked feature as a section with a fields table, an operation paragraph, states and unknowns', () => {
    const run = checkedRun();
    assemble(run);
    const text = handbook(run);
    expect(text).toContain('### Orders\n\nHow readers get to it: From the menu');
    expect(text).toContain('Orders > New Order');
    expect(text).toContain('| Field | Frontend rules | Backend rules |');
    expect(text).toContain('| Item Count | An upload may hold up to 100,000 bytes. | At most 35,000 items. |');
    expect(text).toContain('| Customer Name | The field is required. | - |');
    expect(text).toContain('The clerk fills in the customer name. The item count is limited to 35000.');
    expect(text).toContain('| Draft | The order is not sent yet. |');
    expect(text).toContain('- Clerk: Create an order.');
    expect(text).toContain('- Who approves a large order (searched: the order form and the routes of the orders area)');
    expect(text).toContain('#### Notifications\n\nNone.');
  });

  it('escapes a pipe and a line break inside a table cell', () => {
    const run = checkedRun((entry) => {
      entry.screens[0].fields[0].rules[0].text = 'Either one | the other,\nbut one of them.';
      entry.states[0].meaning = 'Not sent | not yet\nplanned.';
    });
    assemble(run);
    const text = handbook(run);
    expect(text).toContain('| Customer Name | Either one \\| the other, but one of them. | - |');
    expect(text).toContain('| Draft | Not sent \\| not yet planned. |');
  });
});

describe('assemble: the coverage section equals the map and candidates.json', () => {
  it('counts candidates, assigned, unassigned and reaches exactly as the files do', () => {
    const run = checkedRun();
    assemble(run);
    const text = handbook(run);
    const total = run.candidates.items.length;
    const unassigned = run.map.unassigned.length;
    const assigned = run.map.features.reduce((sum, feature) => sum + feature.candidates.length, 0);
    expect(total).toBe(assigned + unassigned);
    expect(text).toContain(`Entrypoint candidates listed: ${total}. In exactly one feature: ${assigned}. In the unassigned list below: ${unassigned}.`);
    const coverage = text.slice(text.indexOf('## Coverage'));
    for (const [reach, label] of [['menu', 'From the menu'], ['link', 'By a link'], ['automated', 'Automatic'], ['interface', 'Interface for other systems'], ['operator', 'Operator command']]) {
      const count = run.map.features.filter((feature) => feature.reach === reach).length;
      expect(coverage).toContain(`| ${label} | ${count} |`);
    }
  });

  it('lists each unassigned candidate with id, kind and reason, without its file', () => {
    const run = checkedRun();
    assemble(run);
    const coverage = handbook(run).slice(handbook(run).indexOf('### Unassigned candidates'));
    const id = run.idOf('src/app.js', 8);
    expect(coverage).toContain(`| ${id} | Route | A health check that no reader uses. |`);
    expect(coverage).not.toContain('src/app.js');
  });

  it('lists the link features and the features without a checked entry, each with its status', () => {
    const run = checkedRun();
    run.run('mark', 'F3', 'dispatched');
    run.run('mark', 'F4', 'failed', 'lane', 'lane-wrote-nothing');
    assemble(run);
    const text = handbook(run);
    const links = text.slice(text.indexOf('### Features reached only by a link'), text.indexOf('### Unassigned candidates'));
    expect(links).toContain('- F2 Archive (Order handling)');
    const unwritten = text.slice(text.indexOf('### Features without a checked entry'));
    expect(unwritten).toContain('| F2 Archive (Order handling) | Not written |');
    expect(unwritten).toContain('| F3 Reminders (Automatic work) | Written but not checked |');
    expect(unwritten).toContain('| F4 Admin tool (Automatic work) | Failed the checks |');
    expect(unwritten).toContain('| F5 Orders (Automatic work) | Not written |');
    expect(unwritten).not.toContain('F1 Orders');
  });

  it('says so when every feature has a checked entry, and when there is nothing unassigned', () => {
    const run = checkedRun();
    const map = clone(run.map);
    map.features[4].candidates.push(run.idOf('src/app.js', 8));
    map.unassigned = [];
    run.writeMap(map);
    expect(run.run('check-map').status).toBe(0);
    for (const id of ['F2', 'F3', 'F4', 'F5']) {
      const entry = clone(run.entry);
      entry.id = id;
      run.writeEntry(id, entry);
      expect(run.run('check-entry', id).status, id).toBe(0);
    }
    assemble(run);
    const text = handbook(run);
    expect(text).toContain('Every feature has a checked entry.');
    expect(text).toContain('### Unassigned candidates\n\nNone.');
    expect(text).toContain('### Features reached only by a link\n\n- F2 Archive (Order handling)');
  });
});

describe('assemble: refuses what check-entry or check-ui would refuse, and then writes nothing', () => {
  it('refuses a checked feature whose entry was changed into a bad one afterwards', () => {
    const run = checkedRun();
    const entry = clone(run.entry);
    entry.who[0].can = 'Only clerk_admin may do this.';
    run.writeEntry('F1', entry);
    const result = assemble(run);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/F1: who\[0\]\.can: "clerk_admin" is not allowed/);
    expect(result.stdout).toMatch(/F1: entries\/F1\.json no longer passes check-entry; run check-entry for F1/);
    expect(existsSync(join(run.out, 'handbook.md'))).toBe(false);
  });

  it('refuses a checked feature whose entry file is gone', () => {
    const run = checkedRun();
    rmSync(join(run.out, 'entries/F1.json'));
    const result = assemble(run);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/F1: lane-wrote-nothing/);
  });

  it('refuses a map that no longer passes check-map', () => {
    const run = checkedRun();
    const map = clone(run.map);
    map.features[2].name = 'send_reminders';
    run.writeMap(map);
    const result = assemble(run);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/map\.json: features\[2\]\.name: "send_reminders"/);
    expect(existsSync(join(run.out, 'handbook.md'))).toBe(false);
  });

  it('refuses a ui.json that check-ui would refuse', () => {
    const run = checkedRun();
    const table = JSON.parse(readFileSync(SHIPPED_UI, 'utf-8'));
    delete table.strings['md.title'];
    run.writeJson(join(run.out, 'ui.json'), table);
    const result = assemble(run);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('ui.json: missing key "md.title"');
    expect(existsSync(join(run.out, 'handbook.md'))).toBe(false);
  });

  it('an English run with no ui.json assembles with the shipped table and does not create ui.json', () => {
    const run = checkedRun();
    expect(assemble(run).status).toBe(0);
    expect(existsSync(join(run.out, 'ui.json'))).toBe(false);
    const written = handbook(run);
    // Once check-ui has copied the table, the bytes do not change.
    expect(runHandbook(['check-ui', run.out]).status).toBe(0);
    expect(existsSync(join(run.out, 'ui.json'))).toBe(true);
    assemble(run);
    expect(handbook(run)).toBe(written);
  });
});

describe('assemble: fixed texts come from ui.json', () => {
  it('writes the headings and table headers of a translated table, keeps source labels as written', () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    const map = clone(run.map);
    map.language = 'Chinese';
    run.writeMap(map);
    expect(run.run('check-map').status).toBe(0);
    const table = JSON.parse(readFileSync(SHIPPED_UI, 'utf-8'));
    table.language = 'Chinese';
    const mark = (word) => `${cjk(0x624b, 0x518c)}${word}`;
    for (const key of Object.keys(table.strings)) {
      table.strings[key] = table.strings[key].replace(/[A-Za-z]+(?: [A-Za-z]+)*/g, (piece, offset, whole) => (whole[offset - 1] === '{' ? piece : mark(key)));
    }
    run.writeJson(join(run.out, 'ui.json'), table);
    expect(runHandbook(['check-ui', run.out]).status).toBe(0);
    const entry = clone(run.entry);
    run.writeEntry('F1', entry);
    expect(run.run('check-entry', 'F1').status).toBe(0);
    const result = assemble(run);
    expect(result.status, result.stdout).toBe(0);
    const text = handbook(run);
    expect(text.startsWith(`# ${mark('md.title')}\n`)).toBe(true);
    expect(text).toContain(`## ${mark('md.coverage.heading')}`);
    expect(text).toContain(`#### ${mark('md.section.purpose')}`);
    // Not one English fixed text is left.
    for (const english of ['Product handbook', 'Coverage', 'Purpose', 'Field', 'Not written']) expect(text).not.toContain(english);
    // The source labels are untouched.
    expect(text).toContain('Customer Name');
    expect(text).toContain('Orders > New Order');
  });
});
