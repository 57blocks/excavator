// O1 of openspec change handbook-status-dictionary: conservation. Every
// candidate input of the fixture lands in exactly one named bucket; the totals
// are counted by hand from the fixture files, and by reading those files line
// by line here, never from the extraction.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractDictionaries } from '../../../skills/excavator-product-handbook/lib/dict-extract.mjs';
import { repoRoot } from './helpers.mjs';

const FIXTURE = join(repoRoot, 'tests/fixtures/product-handbook/dict-project');
const data = extractDictionaries(FIXTURE);
const read = (rel) => readFileSync(join(FIXTURE, rel), 'utf-8').split('\n');
const rows = (kind) => data.candidates.filter((row) => row.kind === kind);
const count = (list, bucket) => list.filter((row) => row.bucket === bucket).length;

describe('the buckets of each kind of candidate', () => {
  it('a Go named type: dictionary or noConstants, and the numbers add up to the types found by reading the files', () => {
    let found = 0;
    for (const file of ['go-app/status/types.go', 'go-app/billing/invoice.go']) {
      let inGroup = false;
      for (const line of read(file)) {
        if (/^type \($/.test(line)) inGroup = true;
        else if (/^\)$/.test(line)) inGroup = false;
        else if (/^type \w+ (string|int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64)$/.test(line)) found += 1;
        else if (inGroup && /^\t\w+\s+(string|int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64)$/.test(line)) found += 1;
      }
    }
    expect(found).toBe(7);
    const types = rows('go-type');
    expect(types).toHaveLength(found);
    expect(count(types, 'dictionary')).toBe(6);
    expect(count(types, 'noConstants')).toBe(1);
    expect(count(types, 'duplicate')).toBe(0);
    expect(types.filter((row) => row.bucket === 'noConstants').map((row) => row.name)).toEqual(['Lonely']);
  });

  it('a Go constant item: member, untypedIota, otherType or plain, 26 of them found by counting the names in the const blocks', () => {
    let found = 0;
    for (const file of ['go-app/status/consts.go', 'go-app/status/other.go', 'go-app/status/types.go', 'go-app/billing/invoice.go']) {
      let inBlock = false;
      for (const line of read(file)) {
        if (/^const \($/.test(line)) inBlock = true;
        else if (/^\)$/.test(line)) inBlock = false;
        else if (/^const \w+ /.test(line)) found += 1;
        else if (inBlock && /^\t(\w+)(\s|$)/.test(line) && !/^\t\/\//.test(line)) found += 1;
      }
    }
    expect(found).toBe(26);
    const consts = rows('go-const');
    expect(consts).toHaveLength(found);
    expect(count(consts, 'member')).toBe(19);
    expect(count(consts, 'untypedIota')).toBe(2);
    expect(count(consts, 'otherType')).toBe(2);
    expect(count(consts, 'plain')).toBe(3);
    expect(consts.filter((row) => row.bucket === 'untypedIota').map((row) => row.name)).toEqual(['retryNone', 'retryOnce']);
    expect(consts.filter((row) => row.bucket === 'otherType').map((row) => [row.name, row.type])).toEqual([['Deadline', 'time.Duration'], ['MaxItems', 'int']]);
    expect(consts.filter((row) => row.bucket === 'plain').map((row) => row.name).sort()).toEqual(['KindOther', 'legacyBase', 'note']);
  });

  it('a TypeScript enum: dictionary, 5 found by their declaration lines', () => {
    const found = read('web-app/src/enums.ts').filter((line) => /^(export )?(const )?enum \w+ \{$/.test(line)).length;
    expect(found).toBe(5);
    expect(rows('ts-enum')).toHaveLength(found);
    expect(count(rows('ts-enum'), 'dictionary')).toBe(5);
  });

  it('a JavaScript object: dictionary or noLiteralMembers, 5 whose name has a state word and is assigned an object', () => {
    let found = 0;
    for (const file of ['node-app/src/constants.js', 'node-app/src/leave.js']) {
      for (const line of read(file)) {
        if (/^\s*\/\//.test(line)) continue;
        if (/(const|let|var|exports\.)\s*\w*(Status|STATE|Stage|Kind|Type)\s*=\s*\{/.test(line)) found += 1;
      }
    }
    expect(found).toBe(5);
    const objects = rows('js-object');
    expect(objects).toHaveLength(found);
    expect(count(objects, 'dictionary')).toBe(4);
    expect(count(objects, 'noLiteralMembers')).toBe(1);
    expect(objects.find((row) => row.bucket === 'noLiteralMembers').name).toBe('EmptyKind');
  });

  it('a map entry: label or unmatchedKey, 18 found by counting the entries of the maps by hand', () => {
    // status/labels.go 5, api/labels.go 4, web labels.ts 6, the JS reverse table of UserStatus 3
    const entries = rows('map-entry');
    expect(entries).toHaveLength(18);
    expect(count(entries, 'label')).toBe(14);
    expect(count(entries, 'unmatchedKey')).toBe(4);
    expect(count(entries, 'ambiguousKey')).toBe(0);
  });
});

describe('the ledger and the lists agree', () => {
  it('has no candidate outside the buckets of its kind, and no two rows for the same place and name', () => {
    const allowed = {
      'go-type': ['dictionary', 'noConstants', 'duplicate'],
      'go-const': ['member', 'untypedIota', 'otherType', 'plain'],
      'ts-enum': ['dictionary'],
      'js-object': ['dictionary', 'noLiteralMembers'],
      'map-entry': ['label', 'unmatchedKey', 'ambiguousKey'],
    };
    for (const row of data.candidates) expect(allowed[row.kind], `${row.kind} ${row.file}:${row.line}`).toContain(row.bucket);
    expect(data.candidates).toHaveLength(7 + 26 + 5 + 5 + 18);
    const keys = data.candidates.map((row) => `${row.kind}|${row.file}|${row.line}|${row.name ?? row.key}|${row.member ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every dictionary row points at one dictionary and every dictionary is pointed at once', () => {
    const pointed = data.candidates.filter((row) => row.bucket === 'dictionary').map((row) => row.dictionary);
    expect(new Set(pointed).size).toBe(pointed.length);
    expect(pointed.sort()).toEqual(data.dictionaries.map((entry) => entry.id).sort());
  });

  it('every member row of Go is a member of its dictionary, and the members of the Go dictionaries are exactly those rows', () => {
    const goMembers = data.dictionaries.filter((entry) => entry.form === 'go-type').flatMap((entry) => entry.members.map((m) => `${entry.id}|${m.file}|${m.line}|${m.name}`));
    const fromRows = rows('go-const').filter((row) => row.bucket === 'member').map((row) => `${row.dictionary}|${row.file}|${row.line}|${row.name}`);
    expect(fromRows.sort()).toEqual(goMembers.sort());
  });

  it('the labels of the members are exactly the label rows, and each label row names the member that has it', () => {
    const fromMembers = data.dictionaries.flatMap((entry) => entry.members.flatMap((m) => m.labels.map((l) => `${entry.id}|${m.name}|${l.file}|${l.line}`)));
    const fromRows = rows('map-entry').filter((row) => row.bucket === 'label').map((row) => `${row.dictionary}|${row.member}|${row.file}|${row.line}`);
    expect(fromRows.sort()).toEqual(fromMembers.sort());
    expect(fromMembers).toHaveLength(14);
  });

  it('the counts are the numbers of the lists, written by hand', () => {
    expect(data.counts).toEqual({
      dictionaries: { total: 15, goType: 6, tsEnum: 5, jsObject: 4 },
      members: { total: 54, computed: 50, notComputed: 4 },
      comments: 9,
      labels: 14,
      skippedMembers: 5,
      candidates: {
        goTypes: { total: 7, dictionary: 6, noConstants: 1, duplicate: 0 },
        goConstants: { total: 26, member: 19, untypedIota: 2, otherType: 2, plain: 3 },
        tsEnums: { total: 5, dictionary: 5 },
        jsObjects: { total: 5, dictionary: 4, noLiteralMembers: 1 },
        mapEntries: { total: 18, label: 14, unmatchedKey: 4, ambiguousKey: 0 },
      },
      mismatches: 3,
    });
  });

  it('every dictionary id is unique and every member of a dictionary has a place', () => {
    const ids = data.dictionaries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of data.dictionaries) for (const m of entry.members) expect(Number.isInteger(m.line) && m.file !== '').toBe(true);
  });
});
