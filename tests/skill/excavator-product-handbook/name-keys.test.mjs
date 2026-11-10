// Round 2 of the verification (openspec change handbook-recall): a listed item may
// change its claim and its citations, never a name or a label. name-keys.mjs lists
// those keys in one place, for the entry, the overview and the two findings formats.
import { describe, expect, it } from 'vitest';

import { identityKeys, nameChanges } from '../../../skills/excavator-product-handbook/lib/name-keys.mjs';

const ev = [{ file: 'a.js', passage: 'x' }];
const entry = () => ({
  who: [{ role: 'Clerk', can: 'Create.', evidence: ev }],
  where: [{ label: 'Orders', evidence: ev }],
  screens: [{ name: 'Form', evidence: ev, fields: [{ label: 'Amount', evidence: ev, rules: [{ side: 'backend', text: 'Positive.', evidence: ev }] }] }],
  operations: [{
    name: 'Place',
    sentences: [{ text: 'It places.', evidence: ev }],
    triggers: [], calculations: [], changes: [], edges: [],
    handoffs: [{ feature: 'F2', text: 'Moves on.', evidence: ev }],
  }],
  states: [{ label: 'Draft', meaning: 'Not sent.', evidence: ev }],
  transitions: [{ from: 'Draft', to: 'Sent', by: 'Send.', evidence: ev }],
  notifications: [], automatic: [], unknowns: [],
});
const overview = () => ({
  name: { text: 'Tool', evidence: ev },
  summary: [{ text: 'It does.', evidence: ev }],
  audiences: [{ who: 'Clerk', does: 'Works.', evidence: ev }],
  applications: [{ dir: '.', name: 'Desk', does: 'Serves.', evidence: ev }],
  integrations: [{ system: 'Chat', use: 'Alerts.', callers: ['.'], evidence: ev }],
  unknowns: [],
});
const findings = () => ({ findings: [{ category: 'time', text: 'A defect.', evidence: ev }], unknowns: [] });

describe('identityKeys: the name and label keys of each format, in one table', () => {
  it('lists the keys of a feature entry', () => {
    expect(Object.fromEntries(identityKeys('feature', entry()))).toEqual({
      'who[0]': { role: 'Clerk' },
      'where[0]': { label: 'Orders' },
      'screens[0]': { name: 'Form' },
      'screens[0].fields[0]': { label: 'Amount' },
      'screens[0].fields[0].rules[0]': { side: 'backend' },
      'operations[0]': { name: 'Place' },
      'operations[0].handoffs[0]': { feature: 'F2' },
      'states[0]': { label: 'Draft' },
      'transitions[0]': { from: 'Draft', to: 'Sent' },
    });
  });

  it('lists the keys of an overview', () => {
    expect(Object.fromEntries(identityKeys('overview', overview()))).toEqual({
      name: { text: 'Tool' },
      'audiences[0]': { who: 'Clerk' },
      'applications[0]': { dir: '.', name: 'Desk' },
      'integrations[0]': { system: 'Chat', callers: ['.'] },
    });
  });

  it('lists the category of a finding, for a feature findings unit and a system findings unit', () => {
    for (const kind of ['findings', 'system-findings']) {
      expect(Object.fromEntries(identityKeys(kind, findings()))).toEqual({ 'findings[0]': { category: 'time' } });
    }
  });

  it('reads an entry of format 1 (no transitions, no handoffs) and an overview without a name', () => {
    const v1 = entry();
    delete v1.transitions;
    delete v1.operations[0].handoffs;
    expect(identityKeys('feature', v1).has('transitions[0]')).toBe(false);
    const bare = overview();
    delete bare.name;
    expect(identityKeys('overview', bare).has('name')).toBe(false);
  });
});

describe('nameChanges: the keys that differ on the node of an item and on its ancestors', () => {
  const change = (mutate, path) => {
    const before = entry();
    const after = entry();
    mutate(after);
    return nameChanges(identityKeys('feature', before), identityKeys('feature', after), path);
  };

  it('names the node and the key of each kind of change', () => {
    expect(change((e) => { e.who[0].role = 'Approver'; }, 'who[0]')).toEqual(['who[0].role']);
    expect(change((e) => { e.where[0].label = 'Other'; }, 'where[0]')).toEqual(['where[0].label']);
    expect(change((e) => { e.screens[0].name = 'Other'; }, 'screens[0]')).toEqual(['screens[0].name']);
    expect(change((e) => { e.screens[0].fields[0].label = 'Other'; }, 'screens[0].fields[0]')).toEqual(['screens[0].fields[0].label']);
    expect(change((e) => { e.screens[0].fields[0].rules[0].side = 'frontend'; }, 'screens[0].fields[0].rules[0]')).toEqual(['screens[0].fields[0].rules[0].side']);
    expect(change((e) => { e.states[0].label = 'Other'; }, 'states[0]')).toEqual(['states[0].label']);
    expect(change((e) => { e.transitions[0].from = 'Other'; e.transitions[0].to = 'More'; }, 'transitions[0]')).toEqual(['transitions[0].from', 'transitions[0].to']);
    expect(change((e) => { e.operations[0].handoffs[0].feature = 'F3'; }, 'operations[0].handoffs[0]')).toEqual(['operations[0].handoffs[0].feature']);
  });

  it('reads the ancestors of an item: a renamed screen or operation is found through a field, a rule or a sentence below it', () => {
    expect(change((e) => { e.screens[0].name = 'Other'; }, 'screens[0].fields[0].rules[0]')).toEqual(['screens[0].name']);
    expect(change((e) => { e.operations[0].name = 'Other'; }, 'operations[0].sentences[0]')).toEqual(['operations[0].name']);
    expect(change((e) => { e.operations[0].name = 'Other'; }, 'operations[0].handoffs[0]')).toEqual(['operations[0].name']);
  });

  it('finds nothing when the text, the evidence or an unrelated name changed', () => {
    expect(change((e) => { e.states[0].meaning = 'Changed.'; e.states[0].evidence = []; }, 'states[0]')).toEqual([]);
    expect(change((e) => { e.states[0].label = 'Other'; }, 'who[0]')).toEqual([]);
  });

  it('compares the array keys of an overview as values', () => {
    const before = overview();
    const after = overview();
    after.integrations[0].callers = ['src'];
    expect(nameChanges(identityKeys('overview', before), identityKeys('overview', after), 'integrations[0]')).toEqual(['integrations[0].callers']);
  });
});
