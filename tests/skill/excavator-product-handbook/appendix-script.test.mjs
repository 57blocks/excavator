// O1 (appendix) of openspec change handbook-history-appendix: the appendix is computed at assembly from the output directory
// and nothing else. The open questions are the `unknowns` of the verified entries and of the verified overview, grouped by
// domain, each with its own words and the place searched; the glossary holds the entry names, screen names, state labels
// (with their meanings) and roles (with what they can do) of the verified entries, once for each exact text, in Unicode
// code point order, with the features each occurs in; the sources hold the count of items written, removed by the two
// checks and written again for each section, and the kept and left-out counts of the ranking, the remedies and the topics,
// all equal to what state.json and the removal records hold. An item the checks removed is in none of the three lists.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildGlossary } from '../../../skills/excavator-product-handbook/lib/appendix-glossary.mjs';
import { handbookModel } from '../../../skills/excavator-product-handbook/lib/handbook-model.mjs';
import { loadCheckedRun } from '../../../skills/excavator-product-handbook/lib/load-run.mjs';
import { clone, makeCheckedMapRun, verifyChecked } from './helpers.mjs';
import { appendixRun, countEvidenceItems } from './appendix-fixture.mjs';
import { checkedOverviewRun } from './overview-fixture.mjs';
import { checkedTopicsRun, judgeTopics } from './topics-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

/** The appendix a run's checked state gives. */
function appendixOf(run, views = ['product']) {
  const loaded = loadCheckedRun(run.out, run.root);
  expect(loaded.ok, JSON.stringify(loaded.lines)).toBe(true);
  return handbookModel(loaded, run.root, views).appendix;
}

describe('the open questions', () => {
  it('are the unknowns of the verified entries, each with its own words and the place searched, by domain and then feature, and none of an entry that is not verified', () => {
    const run = appendixRun(cleanups);
    expect(appendixOf(run).open).toEqual([
      { feature: 'F1', domain: 'D1', item: 'Who approves a large order', searched: 'the order form and the routes of the orders area' },
      { feature: 'F3', domain: 'D2', item: 'Who approves a large order', searched: 'the order form and the routes of the orders area' },
    ]);
  });

  it('keeps two identical unknowns of two features as two rows', () => {
    const run = appendixRun(cleanups);
    const { open } = appendixOf(run);
    expect(open.filter((row) => row.item === 'Who approves a large order')).toHaveLength(2);
  });

  it('starts with the unknowns of the verified overview, which belong to no feature and no domain', () => {
    const run = checkedOverviewRun(cleanups);
    run.writeDomains();
    run.writeEntry('F1', clone(run.entry));
    expect(run.run('check-entry', 'F1').status).toBe(0);
    verifyChecked(run, 'F1');
    verifyChecked(run, 'overview');
    const { open } = appendixOf(run);
    expect(open[0]).toEqual({ feature: null, domain: null, item: 'Whether other tools call it', searched: 'the routes and the jobs' });
    expect(open[1]).toEqual({ feature: 'F1', domain: 'D1', item: 'Who approves a large order', searched: 'the order form and the routes of the orders area' });
    expect(open).toHaveLength(2);
  });

  it('is empty when no entry is verified', () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    expect(appendixOf(run).open).toEqual([]);
  });

  it('groups by the areas of the map when the run has no domains file', () => {
    const run = appendixRun(cleanups);
    // Without domains.json the groups are the areas A1 (F1, F2) and A2 (F3, F4, F5).
    run.writeJson(join(run.out, 'domains.json'), { not: 'a domains file' });
    expect(appendixOf(run).open.map((row) => [row.feature, row.domain])).toEqual([['F1', 'A1'], ['F3', 'A2']]);
  });
});

describe('the glossary', () => {
  it('holds each text once, with the kinds it has and the verified features it occurs in, in code point order', () => {
    const run = appendixRun(cleanups);
    const { glossary } = appendixOf(run);
    expect(glossary.map((row) => row.term)).toEqual(['Clerk', 'Draft', 'New Order', 'Orders']);
    expect(glossary.find((row) => row.term === 'New Order')).toEqual({ term: 'New Order', kinds: ['entry', 'screen'], features: ['F1', 'F3'], meanings: [] });
    expect(glossary.find((row) => row.term === 'Orders')).toEqual({ term: 'Orders', kinds: ['entry'], features: ['F1', 'F3'], meanings: [] });
  });

  it('writes the meaning of a state and what a role can do, with the features each meaning comes from', () => {
    const run = appendixRun(cleanups);
    const { glossary } = appendixOf(run);
    expect(glossary.find((row) => row.term === 'Draft')).toEqual({ term: 'Draft', kinds: ['state'], features: ['F1', 'F3'], meanings: [{ text: 'The order is not sent yet.', features: ['F1', 'F3'] }] });
    expect(glossary.find((row) => row.term === 'Clerk')).toEqual({ term: 'Clerk', kinds: ['role'], features: ['F1', 'F3'], meanings: [{ text: 'Create an order.', features: ['F1', 'F3'] }] });
  });

  it('writes every meaning of a term that two entries explain differently, each with its own features', () => {
    const rows = [
      { id: 'F1', entry: entryOf({ states: [{ label: 'Open', meaning: 'Waiting for a clerk.' }] }) },
      { id: 'F2', entry: entryOf({ states: [{ label: 'Open', meaning: 'Waiting for a clerk.' }] }) },
      { id: 'F3', entry: entryOf({ states: [{ label: 'Open', meaning: 'Visible to every customer.' }] }) },
    ];
    expect(buildGlossary(rows)).toEqual([
      { term: 'Open', kinds: ['state'], features: ['F1', 'F2', 'F3'], meanings: [{ text: 'Waiting for a clerk.', features: ['F1', 'F2'] }, { text: 'Visible to every customer.', features: ['F3'] }] },
    ]);
  });

  it('treats texts that differ only in case or spacing as different terms', () => {
    const rows = [{ id: 'F1', entry: entryOf({ where: [{ label: 'Orders' }, { label: 'orders' }, { label: 'Orders ' }] }) }];
    expect(buildGlossary(rows).map((row) => row.term)).toEqual(['Orders', 'Orders ', 'orders']);
  });

  it('sorts by Unicode code point, not by UTF-16 code unit', () => {
    const astral = String.fromCodePoint(0x1f600); // two UTF-16 units, the first 0xD83D
    const wide = String.fromCodePoint(0xff21); // one unit, above 0xD83D
    const rows = [{ id: 'F1', entry: entryOf({ where: [{ label: astral }, { label: wide }, { label: 'a' }, { label: 'B' }] }) }];
    expect(buildGlossary(rows).map((row) => row.term)).toEqual(['B', 'a', wide, astral]);
  });

  it('leaves out an item the checks removed: the state "Submitted" and its meaning, and the role "Approver"', () => {
    const run = appendixRun(cleanups);
    const { glossary } = appendixOf(run);
    const text = JSON.stringify(glossary);
    expect(glossary.map((row) => row.term)).not.toContain('Submitted');
    expect(text).not.toContain('The order was sent.');
    expect(text).not.toContain('Approver');
    expect(text).not.toContain('Approve an order.');
  });

  it('leaves out the entry of a feature that is not verified', () => {
    const run = appendixRun(cleanups);
    const state = run.readJson('state.json');
    expect(state.features.F2.status).toBe('checked');
    const text = JSON.stringify(appendixOf(run));
    expect(text).not.toContain('Where the archive is kept');
    expect(text).not.toContain('"F2"');
  });

  it('is empty when no entry is verified', () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    expect(appendixOf(run).glossary).toEqual([]);
  });
});

/** A verified entry's text with the parts a test names; the other parts are empty. */
function entryOf({ where = [], screens = [], states = [], who = [] }) {
  return { where, screens, states, who, operations: [], notifications: [], automatic: [], unknowns: [] };
}

describe('the sources', () => {
  it('counts the items kept, the items the verifiers removed and the items the tracers removed, as state.json records them', () => {
    const run = appendixRun(cleanups);
    const state = run.readJson('state.json');
    const records = Object.values(state.features).flatMap((entry) => entry.removed ?? []);
    const byTrace = records.filter((record) => record.step === 'trace').length;
    const byVerify = records.filter((record) => record.step !== 'trace').length;
    expect(byVerify).toBe(2);
    expect(byTrace).toBe(1);
    const row = appendixOf(run).sources.parts.find((part) => part.id === 'features');
    expect(row).toMatchObject({ id: 'features', units: 5, verified: 2, removedVerify: byVerify, removedTrace: byTrace });
    // The items that still carry a citation in the two verified entries after the removals.
    const kept = [run.readJson('entries/F1.json'), run.readJson('entries/F3.json')].reduce((sum, doc) => sum + countEvidenceItems(doc), 0);
    expect(row.items).toBe(kept);
  });

  it('counts the units written again from the attempts of state.json', () => {
    const run = appendixRun(cleanups);
    const state = run.readJson('state.json');
    state.features.F1.attempts = 2;
    state.features.F3.attempts = 2;
    run.writeJson(join(run.out, 'state.json'), state);
    const row = appendixOf(run).sources.parts.find((part) => part.id === 'features');
    const extra = Object.values(state.features).reduce((sum, entry) => sum + Math.max(0, entry.attempts - 1), 0);
    expect(row.again).toBe(extra);
    expect(extra).toBeGreaterThanOrEqual(2);
  });

  it('lists the four unit sections in the order of the handbook, the overview and the system findings counted by their own units', () => {
    const run = appendixRun(cleanups);
    const { parts } = appendixOf(run).sources;
    expect(parts.map((part) => part.id)).toEqual(['overview', 'features', 'findings', 'system-findings']);
    expect(parts[0]).toEqual({ id: 'overview', units: 1, verified: 0, items: 0, removedVerify: 0, removedTrace: 0, again: 0 });
    expect(parts[2]).toMatchObject({ units: 5, verified: 0, items: 0 });
    expect(parts[3]).toMatchObject({ units: 1, verified: 0, items: 0 });
  });

  it('counts the verified overview and the verified findings by their own items', () => {
    const run = checkedTopicsRun(cleanups);
    const { sources } = appendixOf(run);
    const model = handbookModel(loadCheckedRun(run.out, run.root), run.root, ['product']);
    expect(sources.parts.find((part) => part.id === 'findings')).toMatchObject({ units: 5, verified: 2, items: model.findings.list.length });
  });

  it('counts the groups kept and left out by the ranking, the remedies and the topics', () => {
    const run = checkedTopicsRun(cleanups);
    expect(judgeTopics(run, (row, letter) => (row.id === 'D2#1' && letter === 'a' ? { verdict: 'doesNotFollow', reason: 'The row names a rule that is not cited.' } : 'follows')).status).toBe(0);
    const { sources } = appendixOf(run);
    const model = handbookModel(loadCheckedRun(run.out, run.root), run.root, ['product']);
    expect(model.topics.dropped).toHaveLength(1);
    expect(sources.ranked.topics).toEqual({ kept: 4, left: 1 });
    // No ranking and no remedies were written: the four groups of findings are not ranked and no paragraph was kept or left out.
    expect(sources.ranked.priority).toEqual({ kept: 0, left: 4 });
    expect(sources.ranked.remedies).toEqual({ kept: 0, left: 0 });
  });

  it('counts the ranking from the groups that have a level and the ones that have none', () => {
    const run = checkedTopicsRun(cleanups);
    const model = handbookModel(loadCheckedRun(run.out, run.root), run.root, ['product']);
    const { counts } = model.findings.priority;
    expect(appendixOf(run).sources.ranked.priority).toEqual({ kept: counts.P0 + counts.P1 + counts.P2, left: counts.unranked });
  });
});

describe('the model of the handbook', () => {
  it('holds the appendix and reads nothing outside the output directory it was given and the project', () => {
    const run = appendixRun(cleanups);
    const text = readFileSync(join(run.out, 'state.json'), 'utf-8');
    const loaded = loadCheckedRun(run.out, run.root);
    const model = handbookModel(loaded, run.root, ['product']);
    expect(Object.keys(model.appendix)).toEqual(['open', 'glossary', 'sources']);
    expect(readFileSync(join(run.out, 'state.json'), 'utf-8')).toBe(text);
  });
});
