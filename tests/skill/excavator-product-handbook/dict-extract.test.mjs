// O1 of openspec change handbook-status-dictionary: the value-set extraction on
// a purpose-built project with three applications (Go, TypeScript, JavaScript).
// Every expectation below is written by hand from the fixture files, never
// produced by the code.
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { extractDictionaries } from '../../../skills/excavator-product-handbook/lib/dict-extract.mjs';
import { repoRoot } from './helpers.mjs';

const FIXTURE = join(repoRoot, 'tests/fixtures/product-handbook/dict-project');
const CONSTS = 'go-app/status/consts.go';
const TYPES = 'go-app/status/types.go';
const ENUMS = 'web-app/src/enums.ts';
const CONSTANTS = 'node-app/src/constants.js';

const data = extractDictionaries(FIXTURE);
const dict = (id) => {
  const found = data.dictionaries.find((entry) => entry.id === id);
  expect(found, id).toBeDefined();
  return found;
};
/** `[name, value, computed, line]` of each member, the shape the expectations below are written in. */
const members = (id) => dict(id).members.map((member) => [member.name, member.value, member.computed, member.line]);
const member = (id, name) => dict(id).members.find((entry) => entry.name === name);

describe('the value sets of the fixture', () => {
  it('lists each value set once, sorted by file and line, with its form, application and base type', () => {
    expect(data.dictionaries.map((entry) => [entry.id, entry.form, entry.application, entry.line])).toEqual([
      ['go-app/billing/invoice.go:InvoiceState', 'go-type', 'go-app', 4],
      [`${TYPES}:Status`, 'go-type', 'go-app', 4],
      [`${TYPES}:Kind`, 'go-type', 'go-app', 7],
      [`${TYPES}:Level`, 'go-type', 'go-app', 8],
      [`${TYPES}:Flags`, 'go-type', 'go-app', 9],
      [`${TYPES}:Phase`, 'go-type', 'go-app', 10],
      [`${CONSTANTS}:UserStatus`, 'js-object', 'node-app', 3],
      [`${CONSTANTS}:INVOICE_STATE`, 'js-object', 'node-app', 17],
      [`${CONSTANTS}:OrderStage`, 'js-object', 'node-app', 23],
      ['node-app/src/leave.js:LeaveType', 'js-object', 'node-app', 1],
      [`${ENUMS}:InvoiceState`, 'ts-enum', 'web-app', 1],
      [`${ENUMS}:Priority`, 'ts-enum', 'web-app', 9],
      [`${ENUMS}:Mixed`, 'ts-enum', 'web-app', 16],
      [`${ENUMS}:Status`, 'ts-enum', 'web-app', 31],
      [`${ENUMS}:LeaveType`, 'ts-enum', 'web-app', 40],
    ]);
    expect(data.dictionaries.filter((entry) => entry.form === 'go-type').map((entry) => [entry.name, entry.baseType])).toEqual([
      ['InvoiceState', 'string'], ['Status', 'int'], ['Kind', 'string'], ['Level', 'uint8'], ['Flags', 'uint16'], ['Phase', 'int32'],
    ]);
    expect(data.applications).toEqual([{ directory: 'go-app', dictionaries: 6 }, { directory: 'node-app', dictionaries: 4 }, { directory: 'web-app', dictionaries: 5 }]);
  });
});

describe('Go: types, constants and iota', () => {
  it('takes iota + 1 for the first item and repeats the expression for the names that follow, across two files', () => {
    expect(members(`${TYPES}:Status`)).toEqual([
      ['StatusDraft', 1, true, 5],
      ['StatusSubmitted', 2, true, 7],
      ['StatusApproved', 3, true, 10],
      ['StatusRejected', 4, true, 11],
      ['StatusLegacy', 'legacyBase + 1', false, 12],
    ]);
    expect(dict(`${TYPES}:Status`).members.every((entry) => entry.file === CONSTS)).toBe(true);
    expect(dict(`${TYPES}:Status`).file).toBe(TYPES);
  });

  it('writes a value that refers to another constant as written and marks it not computed, keeping the constant in the set', () => {
    const legacy = member(`${TYPES}:Status`, 'StatusLegacy');
    expect(legacy.computed).toBe(false);
    expect(legacy.reason).toBe('expression');
  });

  it('computes 1 << iota and 1 << (iota + k) and a typed blank item, and starts iota at 0', () => {
    expect(members(`${TYPES}:Level`)).toEqual([['LevelLow', 1, true, 22], ['LevelMid', 2, true, 23], ['LevelHigh', 4, true, 24]]);
    expect(members(`${TYPES}:Flags`)).toEqual([['FlagA', 4, true, 28], ['FlagB', 8, true, 29], ['FlagC', 16, true, 30]]);
    // a blank identifier with the type is a member named "_" that takes iota 0
    expect(members(`${TYPES}:Phase`)).toEqual([['_', 0, true, 34], ['PhaseOne', 1, true, 35], ['PhaseTwo', 2, true, 36]]);
  });

  it('takes string constants as they are, and leaves an untyped constant that points at a member out of the set', () => {
    expect(members(`${TYPES}:Kind`)).toEqual([['KindInternal', 'internal', true, 16], ['KindExternal', 'external', true, 17]]);
    expect(members('go-app/billing/invoice.go:InvoiceState')).toEqual([['InvoiceOpen', 'open', true, 7], ['InvoicePaid', 'paid', true, 8], ['InvoiceVoid', 'void', true, 9]]);
  });
});

describe('TypeScript: enums', () => {
  it('takes the values written and counts up from the previous number, from 0 for the first member (a const enum too)', () => {
    expect(members(`${ENUMS}:Priority`)).toEqual([['Low', 0, true, 10], ['Normal', 1, true, 11], ['High', 10, true, 12], ['Urgent', 11, true, 13]]);
    expect(members(`${ENUMS}:InvoiceState`)).toEqual([['Open', 'open', true, 2], ['Paid', 'paid', true, 3], ['Void', 'void', true, 4], ['Refunded', 'refunded', true, 5]]);
  });

  it('does not count up after a string member or an expression it cannot compute, and says so', () => {
    expect(members(`${ENUMS}:Mixed`)).toEqual([
      ['A', 'a', true, 17],
      ['B', null, false, 18],
      ['C', 5, true, 19],
      ['D', 6, true, 20],
      ['E', '1 << 2', false, 21],
      ['F', null, false, 22],
      ['quoted-name', 7, true, 23],
      ['G', -3, true, 24],
      ['H', -2, true, 25],
    ]);
    expect(['B', 'E', 'F'].map((name) => member(`${ENUMS}:Mixed`, name).reason)).toEqual(['after-uncomputed', 'expression', 'after-uncomputed']);
  });

  it('does not take an enum inside a comment or a string for one', () => {
    expect(data.dictionaries.map((entry) => entry.name)).not.toContain('Fake');
    expect(data.dictionaries.map((entry) => entry.name)).not.toContain('Ghost');
  });
});

describe('JavaScript: objects', () => {
  it('takes the literal members of an object assigned to a name that ends in a state word, by const, let, var and exports', () => {
    expect(members(`${CONSTANTS}:UserStatus`)).toEqual([['active', 1, true, 4], ['blocked', 2, true, 6], ['deleted', 3, true, 7], ['pending', 0, true, 9]]);
    expect(members(`${CONSTANTS}:INVOICE_STATE`)).toEqual([['open', 'open', true, 17], ['paid', 'paid', true, 17], ['void', 'void', true, 17]]);
    expect(members(`${CONSTANTS}:OrderStage`)).toEqual([['created', 'created', true, 24], ['done', 'done', true, 25]]);
    expect(members('node-app/src/leave.js:LeaveType')).toEqual([['annual', 'annual', true, 2], ['sick', 'sick', true, 3]]);
  });

  it('counts the top-level members that are not literals, and a nested object that is not a reverse table', () => {
    expect(dict(`${CONSTANTS}:UserStatus`).skippedMembers).toBe(0);
    expect(dict(`${CONSTANTS}:OrderStage`).skippedMembers).toBe(1);
    // a call, a boolean, a spread and a method
    expect(dict('node-app/src/leave.js:LeaveType').skippedMembers).toBe(4);
  });

  it('does not take an object whose name has no state word, one in a comment, or one with no literal member as a value set', () => {
    const names = data.dictionaries.map((entry) => entry.name);
    expect(names).not.toContain('Config');
    expect(names).not.toContain('CommentedStatus');
    expect(names).not.toContain('EmptyKind');
  });
});

describe('comments: the text next to a member, verbatim', () => {
  const comments = (id, name) => member(id, name).comments.map((c) => [c.text, c.file, c.line, c.where]);

  it('takes the comment above a member and the comment after it on the same line, both when both are there', () => {
    expect(comments(`${TYPES}:Status`, 'StatusDraft')).toEqual([
      ['StatusDraft is the initial state.', CONSTS, 4, 'above'],
      ['created by the user', CONSTS, 5, 'same-line'],
    ]);
    expect(comments(`${TYPES}:Status`, 'StatusSubmitted')).toEqual([['waiting for the first approval', CONSTS, 6, 'above']]);
  });

  it('does not take a comment that is separated from the member by a blank line', () => {
    expect(comments(`${TYPES}:Status`, 'StatusApproved')).toEqual([]);
    expect(comments(`${TYPES}:Status`, 'StatusRejected')).toEqual([]);
  });

  it('takes a trailing block comment, a JSDoc block above an enum member and a trailing line comment in TypeScript, and both kinds in JavaScript', () => {
    expect(comments(`${TYPES}:Flags`, 'FlagC')).toEqual([['the third flag', CONSTS, 30, 'same-line']]);
    expect(comments(`${ENUMS}:Status`, 'Draft')).toEqual([['The record is a draft.', ENUMS, 32, 'above']]);
    expect(comments(`${ENUMS}:Status`, 'Submitted')).toEqual([['sent to the manager', ENUMS, 34, 'same-line']]);
    expect(comments(`${CONSTANTS}:UserStatus`, 'blocked')).toEqual([['temporarily blocked', CONSTANTS, 5, 'above']]);
    expect(comments(`${CONSTANTS}:UserStatus`, 'deleted')).toEqual([['soft deleted', CONSTANTS, 7, 'same-line']]);
    expect(comments(`${CONSTANTS}:UserStatus`, 'pending')).toEqual([['not yet used', CONSTANTS, 8, 'above']]);
  });

  it('does not give the comment above the type or the enum to its first member', () => {
    expect(dict(`${TYPES}:Status`).members.flatMap((entry) => entry.comments.map((c) => c.text))).not.toContain('Status is the state of an order.');
    expect(dict(`${ENUMS}:Priority`).members.flatMap((entry) => entry.comments)).toEqual([]);
  });
});

describe('display names: the map entries that give a member a name', () => {
  const labels = (id, name) => member(id, name).labels.map((l) => [l.text, l.file, l.line]);

  it('takes Go map entries keyed by the constant, by package.constant and by constant.Method(), in file order', () => {
    expect(labels(`${TYPES}:Status`, 'StatusDraft')).toEqual([['Draft (api)', 'go-app/api/labels.go', 6], ['Draft', 'go-app/status/labels.go', 4]]);
    expect(labels(`${TYPES}:Status`, 'StatusSubmitted')).toEqual([['Submitted', 'go-app/status/labels.go', 5]]);
    expect(labels(`${TYPES}:Status`, 'StatusApproved')).toEqual([['Approved (api)', 'go-app/api/labels.go', 7], ['Approved', 'go-app/status/labels.go', 8]]);
    expect(labels(`${TYPES}:Status`, 'StatusRejected')).toEqual([['Rejected', 'go-app/status/labels.go', 6]]);
    expect(labels(`${TYPES}:Status`, 'StatusLegacy')).toEqual([]);
  });

  it('takes TypeScript entries keyed [Enum.Member] and [Enum[\'Member\']], with either quote on the value', () => {
    expect(labels(`${ENUMS}:InvoiceState`, 'Open')).toEqual([['Open invoice', 'web-app/src/labels.ts', 4]]);
    expect(labels(`${ENUMS}:InvoiceState`, 'Paid')).toEqual([['Paid in full', 'web-app/src/labels.ts', 5]]);
    expect(labels(`${ENUMS}:InvoiceState`, 'Void')).toEqual([['Voided', 'web-app/src/labels.ts', 6]]);
    expect(labels(`${ENUMS}:InvoiceState`, 'Refunded')).toEqual([]);
    expect(labels(`${ENUMS}:Status`, 'Draft')).toEqual([['Draft', 'web-app/src/labels.ts', 11]]);
    expect(labels(`${ENUMS}:Status`, 'Approved')).toEqual([['Approved', 'web-app/src/labels.ts', 12]]);
  });

  it('takes the reverse table of a JavaScript object, at the line of its entry', () => {
    expect(labels(`${CONSTANTS}:UserStatus`, 'active')).toEqual([['active', CONSTANTS, 11]]);
    expect(labels(`${CONSTANTS}:UserStatus`, 'blocked')).toEqual([['blocked', CONSTANTS, 12]]);
    expect(labels(`${CONSTANTS}:UserStatus`, 'deleted')).toEqual([['deleted', CONSTANTS, 13]]);
    expect(labels(`${CONSTANTS}:UserStatus`, 'pending')).toEqual([]);
  });

  it('gives no name from a map whose values are not strings, whose keys are not references, from a comment, or from a ternary index', () => {
    const all = data.dictionaries.flatMap((entry) => entry.members.flatMap((m) => m.labels.map((l) => l.text)));
    expect(all).not.toContain('not a reference');
    expect(all).not.toContain('Commented');
    expect(all).not.toContain('Rejected in a comment');
    expect(all).not.toContain('x');
  });

  it('puts a key that looks like a member reference but is none in the unmatchedKey bucket, with its place', () => {
    const rows = data.candidates.filter((row) => row.kind === 'map-entry' && row.bucket === 'unmatchedKey').map((row) => [row.file, row.line, row.key]);
    expect(rows).toEqual([
      ['go-app/api/labels.go', 8, 'status.StatusMissing'],
      ['go-app/api/labels.go', 9, 'other.StatusDraft'],
      ['go-app/status/labels.go', 7, 'StatusNowhere'],
      ['web-app/src/labels.ts', 7, 'InvoiceState.Missing'],
    ]);
  });
});

describe('the same name on both sides', () => {
  const sides = (row) => [row.left.id, row.right.id];

  it('lists the names that differ by value, ignoring case and underscores, and not the ones that agree', () => {
    expect(data.mismatches.map((row) => [row.key, ...sides(row)])).toEqual([
      ['invoicestate', 'go-app/billing/invoice.go:InvoiceState', `${ENUMS}:InvoiceState`],
      ['invoicestate', `${CONSTANTS}:INVOICE_STATE`, `${ENUMS}:InvoiceState`],
      ['status', `${TYPES}:Status`, `${ENUMS}:Status`],
    ]);
    // the Go and the JavaScript invoice states have the same values: no entry between them; LeaveType agrees on both sides
    expect(data.mismatches.some((row) => row.key === 'leavetype')).toBe(false);
  });

  it('writes the value only one side has, and the member names of both sides for the values they share', () => {
    const status = data.mismatches.find((row) => row.key === 'status');
    expect(status.onlyLeft).toEqual([]);
    expect(status.onlyRight).toEqual([{ value: 5, members: ['Archived'] }]);
    expect(status.both).toEqual([
      { value: 1, left: ['StatusDraft'], right: ['Draft'] },
      { value: 2, left: ['StatusSubmitted'], right: ['Submitted'] },
      { value: 3, left: ['StatusApproved'], right: ['Approved'] },
      { value: 4, left: ['StatusRejected'], right: ['Rejected'] },
    ]);
    const invoice = data.mismatches.filter((row) => row.key === 'invoicestate');
    expect(invoice[0].onlyRight).toEqual([{ value: 'refunded', members: ['Refunded'] }]);
    expect(invoice[1].both).toEqual([
      { value: 'open', left: ['open'], right: ['Open'] },
      { value: 'paid', left: ['paid'], right: ['Paid'] },
      { value: 'void', left: ['void'], right: ['Void'] },
    ]);
  });

  it('writes the members whose value is not computed apart, as not compared', () => {
    const status = data.mismatches.find((row) => row.key === 'status');
    expect(status.uncompared).toEqual({ left: ['StatusLegacy'], right: [] });
    expect(status.left.application).toBe('go-app');
    expect(status.right.application).toBe('web-app');
  });
});
