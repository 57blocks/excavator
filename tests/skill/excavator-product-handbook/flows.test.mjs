// Oracle O1 of openspec change handbook-deep-entry, diagram half (design D4): the participants and arrows of an
// operation's sequence diagram are computed from the verified steps' citations only (the starter by the feature's
// reach, then the application owning each step's first cited file, named by the overview when it names it, other
// code for a file under no application), each step an arrow from the previous step's participant, numbered like
// the step; the state graph names each state once; the mermaid text cannot break out of a label; and the same
// input gives the same bytes.
import { describe, expect, it } from 'vitest';

import { mermaidText, operationSequence, sequenceMermaid, stateGraph, stateMermaid } from '../../../skills/excavator-product-handbook/lib/flows.mjs';

const ui = {
  'md.flow.actor.menu': 'User',
  'md.flow.actor.link': 'User',
  'md.flow.actor.automated': 'Scheduled job',
  'md.flow.actor.interface': 'Other system',
  'md.flow.actor.operator': 'Operator',
  'md.flow.other': 'Other code',
};
const t = (key) => ui[key];
const step = (file) => ({ text: `A step in ${file}.`, evidence: file === undefined ? [] : [{ file, passage: 'x' }, { file: 'web/other.js', passage: 'y' }] });
const applications = [
  { dir: 'web', name: 'Web shop' },
  { dir: 'api', name: null },
  { dir: 'api/billing', name: 'Billing' },
];

describe('operationSequence', () => {
  it('starts with the starter of the reach and adds each owning application once, in the order first cited', () => {
    const operation = { sentences: [step('web/form.js'), step('api/orders.js'), step('api/billing/charge.js'), step('web/done.js')] };
    expect(operationSequence(operation, 'menu', applications, t)).toEqual({
      participants: ['User', 'Web shop', 'api', 'Billing'],
      steps: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 1 }],
    });
  });

  it('uses only the first citation of a step, the longest matching application, and the directory when the overview names none', () => {
    const operation = { sentences: [step('api/billing/x.js'), step('api/y.js')] };
    const { participants } = operationSequence(operation, 'menu', applications, t);
    expect(participants).toEqual(['User', 'Billing', 'api']);
    expect(participants).not.toContain('Web shop');
  });

  it('keeps a step that stays with the same participant as an arrow to itself', () => {
    const operation = { sentences: [step('web/a.js'), step('web/b.js')] };
    expect(operationSequence(operation, 'menu', applications, t).steps).toEqual([{ from: 0, to: 1 }, { from: 1, to: 1 }]);
  });

  it('names the starter by the reach of the feature', () => {
    const operation = { sentences: [step('web/a.js')] };
    for (const [reach, starter] of Object.entries({ menu: 'User', link: 'User', automated: 'Scheduled job', interface: 'Other system', operator: 'Operator' })) {
      expect(operationSequence(operation, reach, applications, t).participants[0]).toBe(starter);
    }
  });

  it('puts a step whose file is under no application, or that cites nothing, on one participant for other code', () => {
    const operation = { sentences: [step('scripts/run.sh'), step(undefined), step('web/a.js')] };
    expect(operationSequence(operation, 'automated', applications, t)).toEqual({
      participants: ['Scheduled job', 'Other code', 'Web shop'],
      steps: [{ from: 0, to: 1 }, { from: 1, to: 1 }, { from: 1, to: 2 }],
    });
  });

  it('has only the starter and no arrow for an operation with no step', () => {
    expect(operationSequence({ sentences: [] }, 'menu', applications, t)).toEqual({ participants: ['User'], steps: [] });
  });
});

describe('stateGraph', () => {
  it('names each state once in the order it first appears and keeps every transition', () => {
    const entry = { transitions: [
      { from: 'Draft', to: 'Submitted', by: 'Send' },
      { from: 'Submitted', to: 'Draft', by: 'Return' },
      { from: 'Submitted', to: 'Approved', by: 'Approve' },
    ] };
    expect(stateGraph(entry)).toEqual({
      states: ['Draft', 'Submitted', 'Approved'],
      edges: [{ from: 0, to: 1, by: 'Send' }, { from: 1, to: 0, by: 'Return' }, { from: 1, to: 2, by: 'Approve' }],
    });
  });

  it('is empty for an entry without transitions (format /1)', () => {
    expect(stateGraph({})).toEqual({ states: [], edges: [] });
  });
});

describe('mermaid text', () => {
  it('takes out line breaks and every character mermaid reads as syntax, and never leaves a label empty', () => {
    expect(mermaidText('a "b"; c: d\n# e <f> {g} [h] `i` |j| %k')).toBe('a b c d e f g h i j k');
    expect(mermaidText(' ;: ')).toBe('-');
  });

  it('writes a sequence diagram with one participant line each and arrows numbered like the steps', () => {
    const lines = sequenceMermaid({ participants: ['User', 'Web: shop'], steps: [{ from: 0, to: 1 }, { from: 1, to: 1 }] });
    expect(lines).toEqual([
      '```mermaid',
      'sequenceDiagram',
      '  participant P0 as User',
      '  participant P1 as Web shop',
      '  P0->>P1: 1',
      '  P1->>P1: 2',
      '```',
    ]);
  });

  it('writes a state diagram with quoted state names and the cause on each edge', () => {
    const lines = stateMermaid({ states: ['Draft "new"', 'Done'], edges: [{ from: 0, to: 1, by: 'Send; now' }] });
    expect(lines).toEqual([
      '```mermaid',
      'stateDiagram-v2',
      '  state "Draft new" as S0',
      '  state "Done" as S1',
      '  S0 --> S1: Send now',
      '```',
    ]);
  });

  it('gives the same bytes for the same input', () => {
    const operation = { sentences: [step('web/form.js'), step('api/orders.js')] };
    const once = sequenceMermaid(operationSequence(operation, 'menu', applications, t)).join('\n');
    const twice = sequenceMermaid(operationSequence(structuredClone(operation), 'menu', structuredClone(applications), t)).join('\n');
    expect(twice).toBe(once);
  });
});
