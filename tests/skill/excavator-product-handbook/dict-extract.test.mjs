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
const ALIASES = 'go-app/status/aliases.go';
const TS_CONSTS = 'web-app/src/consts.ts';
const TABLES = 'node-app/src/tables.js';
const VARS = 'go-app/status/vars.go';
const PLURAL = 'node-app/src/plural.js';
const TS_PLURAL = 'web-app/src/plural.ts';
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
      [`${ALIASES}:Mode`, 'go-type', 'go-app', 3],
      [`${ALIASES}:Tier`, 'go-type', 'go-app', 6],
      [`${TYPES}:Status`, 'go-type', 'go-app', 4],
      [`${TYPES}:Kind`, 'go-type', 'go-app', 7],
      [`${TYPES}:Level`, 'go-type', 'go-app', 8],
      [`${TYPES}:Flags`, 'go-type', 'go-app', 9],
      [`${TYPES}:Phase`, 'go-type', 'go-app', 10],
      [`${VARS}:Tone`, 'go-type', 'go-app', 3],
      [`${VARS}:Shade`, 'go-type', 'go-app', 4],
      [`${CONSTANTS}:UserStatus`, 'js-object', 'node-app', 3],
      [`${CONSTANTS}:INVOICE_STATE`, 'js-object', 'node-app', 17],
      [`${CONSTANTS}:OrderStage`, 'js-object', 'node-app', 23],
      ['node-app/src/leave.js:LeaveType', 'js-object', 'node-app', 1],
      [`${PLURAL}:OrderLevels`, 'js-object', 'node-app', 1],
      [`${PLURAL}:Statuses`, 'js-object', 'node-app', 2],
      [`${PLURAL}:TicketCategories`, 'js-object', 'node-app', 3],
      [`${PLURAL}:AllTypes`, 'js-object', 'node-app', 4],
      [`${PLURAL}:Roles`, 'js-object', 'node-app', 5],
      [`${TABLES}:RoleType`, 'js-object', 'node-app', 1],
      [`${TABLES}:NoteKind`, 'js-object', 'node-app', 11],
      [`${TS_CONSTS}:TicketStatus`, 'ts-const-object', 'web-app', 1],
      [`${TS_CONSTS}:RetryMode`, 'ts-const-object', 'web-app', 9],
      [`${ENUMS}:InvoiceState`, 'ts-enum', 'web-app', 1],
      [`${ENUMS}:Priority`, 'ts-enum', 'web-app', 9],
      [`${ENUMS}:Mixed`, 'ts-enum', 'web-app', 16],
      [`${ENUMS}:Status`, 'ts-enum', 'web-app', 31],
      [`${ENUMS}:LeaveType`, 'ts-enum', 'web-app', 40],
      [`${TS_PLURAL}:AlertModes`, 'ts-const-object', 'web-app', 1],
    ]);
    expect(data.dictionaries.filter((entry) => entry.form === 'go-type').map((entry) => [entry.name, entry.baseType])).toEqual([
      ['InvoiceState', 'string'], ['Mode', 'uint8'], ['Tier', 'string'], ['Status', 'int'], ['Kind', 'string'], ['Level', 'uint8'], ['Flags', 'uint16'], ['Phase', 'int32'], ['Tone', 'string'], ['Shade', 'uint8'],
    ]);
    expect(data.applications).toEqual([{ directory: 'go-app', dictionaries: 10 }, { directory: 'node-app', dictionaries: 11 }, { directory: 'web-app', dictionaries: 8 }]);
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

describe('the name filter takes a plural of a state word', () => {
  it('takes Levels, Statuses, Categories, Types and Roles in JavaScript, and Modes in a TypeScript as const object', () => {
    expect(members(`${PLURAL}:OrderLevels`)).toEqual([['low', 1, true, 1], ['high', 2, true, 1]]);
    expect(members(`${PLURAL}:Statuses`)).toEqual([['on', 'on', true, 2], ['off', 'off', true, 2]]);
    expect(members(`${PLURAL}:TicketCategories`)).toEqual([['bug', 'bug', true, 3]]);
    expect(members(`${PLURAL}:AllTypes`)).toEqual([['a', 1, true, 4]]);
    expect(members(`${PLURAL}:Roles`)).toEqual([['x', 1, true, 5]]);
    expect(members(`${TS_PLURAL}:AlertModes`)).toEqual([['quiet', 'quiet', true, 1]]);
  });

  it('does not take a name that only looks like one: a word that is no plural of a state word, or a double s', () => {
    const names = data.dictionaries.map((entry) => entry.name);
    for (const name of ['Settings', 'Statess', 'Wishes']) expect(names).not.toContain(name);
  });
});

describe('Go: typed variables are members too', () => {
  it('takes the members of var blocks and of single var declarations, in source order, with literal values as they are', () => {
    expect(members(`${VARS}:Tone`)).toEqual([['ToneWarm', 'warm', true, 7], ['ToneCold', 'cold', true, 8], ['ToneMix', 'pick()', false, 9]]);
    expect(members(`${VARS}:Shade`)).toEqual([['ShadeDark', 1, true, 10], ['ShadeBad', 'iota', false, 11], ['ShadeLight', 2, true, 14]]);
  });

  it('shows an expression as written and not computed, and does not compute iota in a var', () => {
    expect(member(`${VARS}:Tone`, 'ToneMix').reason).toBe('expression');
    expect(member(`${VARS}:Shade`, 'ShadeBad').computed).toBe(false);
  });

  it('records that a member was declared with var, and leaves the mark off the members declared with const', () => {
    for (const entry of [...dict(`${VARS}:Tone`).members, ...dict(`${VARS}:Shade`).members]) expect(entry.declaredAs, entry.name).toBe('var');
    for (const entry of dict(`${TYPES}:Status`).members) expect(Object.hasOwn(entry, 'declaredAs'), entry.name).toBe(false);
  });

  it('puts a typed var with a value in member or otherType, and reads neither an untyped var nor one with no value', () => {
    expect(data.candidates.filter((row) => row.kind === 'go-var').map((row) => [row.name, row.line, row.bucket, row.type ?? null])).toEqual([
      ['ToneWarm', 7, 'member', 'Tone'],
      ['ToneCold', 8, 'member', 'Tone'],
      ['ToneMix', 9, 'member', 'Tone'],
      ['ShadeDark', 10, 'member', 'Shade'],
      ['ShadeBad', 11, 'member', 'Shade'],
      ['ShadeLight', 14, 'member', 'Shade'],
      ['Handle', 18, 'otherType', 'time.Duration'],
    ]);
  });
});

describe('Go: aliases of a basic type are value sets too', () => {
  it('takes `type T = uint8` alone and in a group, with the same base type and the constants of the same directory', () => {
    expect(members(`${ALIASES}:Mode`)).toEqual([['ModeOff', 0, true, 13], ['ModeOn', 1, true, 14]]);
    expect(members(`${ALIASES}:Tier`)).toEqual([['TierGold', 'gold', true, 18], ['TierSilver', 'silver', true, 19]]);
    expect(dict(`${ALIASES}:Mode`).baseType).toBe('uint8');
    expect(dict(`${ALIASES}:Tier`).baseType).toBe('string');
  });

  it('puts an alias with no constant in noConstants, and does not take an alias of a named type', () => {
    const rows = data.candidates.filter((row) => row.kind === 'go-type' && row.file === ALIASES).map((row) => [row.name, row.line, row.bucket]);
    expect(rows).toEqual([['Mode', 3, 'dictionary'], ['Tier', 6, 'dictionary'], ['Count', 7, 'noConstants']]);
  });
});

describe('TypeScript: objects ending in as const', () => {
  it('takes the literal members of an exported or plain const object whose name ends in a state word and whose text ends in as const', () => {
    expect(members(`${TS_CONSTS}:TicketStatus`)).toEqual([['Open', 'open', true, 2], ['Pending', 'pending', true, 4], ['Closed', 'closed', true, 5]]);
    expect(members(`${TS_CONSTS}:RetryMode`)).toEqual([['Fast', 1, true, 9], ['Slow', 2, true, 9]]);
    expect(dict(`${TS_CONSTS}:TicketStatus`).skippedMembers).toBe(0);
  });

  it('does not take an object with no as const, a name with no state word, or one in a comment', () => {
    const names = data.dictionaries.map((entry) => entry.name);
    for (const name of ['LoosePhase', 'Settings', 'CommentedLevel']) expect(names).not.toContain(name);
  });

  it('puts an as const object with no literal member in noLiteralMembers', () => {
    expect(data.candidates.filter((row) => row.kind === 'ts-const-object').map((row) => [row.name, row.line, row.bucket])).toEqual([
      ['TicketStatus', 1, 'dictionary'],
      ['RetryMode', 9, 'dictionary'],
      ['EmptyKind', 15, 'noLiteralMembers'],
      ['AlertModes', 1, 'dictionary'],
    ]);
  });

  it('reads the reverse table of the object and a [Object.Member] key of another file as display names', () => {
    expect(member(`${TS_CONSTS}:TicketStatus`, 'Open').labels.map((l) => [l.text, l.file, l.line])).toEqual([['Open', TS_CONSTS, 6], ['Open ticket', 'web-app/src/ticket-labels.ts', 4]]);
    expect(member(`${TS_CONSTS}:TicketStatus`, 'Pending').labels.map((l) => [l.text, l.file, l.line])).toEqual([['Pending', TS_CONSTS, 6]]);
    expect(member(`${TS_CONSTS}:TicketStatus`, 'Closed').labels).toEqual([]);
  });

  it('takes the comments next to its members', () => {
    expect(member(`${TS_CONSTS}:TicketStatus`, 'Pending').comments.map((c) => [c.text, c.line, c.where])).toEqual([['waiting for the customer', 3, 'above']]);
    expect(member(`${TS_CONSTS}:TicketStatus`, 'Closed').comments.map((c) => [c.text, c.line, c.where])).toEqual([['no further changes', 5, 'same-line']]);
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
    // the names table of OrderStage has a key that is a value of the set, so it is a reverse table; a table with no such key is not
    expect(dict(`${CONSTANTS}:OrderStage`).skippedMembers).toBe(0);
    expect(dict(`${TABLES}:NoteKind`).skippedMembers).toBe(1);
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

  it('gives labels to the entries of a reverse table whose key is a member, and puts each other entry in the unmatchedKey bucket with its key and place', () => {
    expect(members(`${TABLES}:RoleType`)).toEqual([['admin', 1, true, 2], ['user', 2, true, 3]]);
    expect(labels(`${TABLES}:RoleType`, 'admin')).toEqual([['Admin', TABLES, 5]]);
    expect(labels(`${TABLES}:RoleType`, 'user')).toEqual([['User', TABLES, 6]]);
    expect(dict(`${TABLES}:RoleType`).skippedMembers).toBe(0);
    expect(labels(`${CONSTANTS}:OrderStage`, 'created')).toEqual([['Created', CONSTANTS, 26]]);
    expect(labels(`${CONSTANTS}:OrderStage`, 'done')).toEqual([]);
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
      [CONSTANTS, 26, 'gone'],
      [TABLES, 7, '16'],
      ['web-app/src/labels.ts', 7, 'InvoiceState.Missing'],
      ['web-app/src/ticket-labels.ts', 5, 'TicketStatus.Gone'],
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
