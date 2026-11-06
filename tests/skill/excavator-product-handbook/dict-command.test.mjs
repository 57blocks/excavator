// O1 of openspec change handbook-status-dictionary: `handbook.mjs data` writes
// <out>/dictionaries.json after data.json and prints a second count line; the
// shape check refuses what the command does not write; the reading's edge
// cases (comments, multi-name constants, a duplicate type, an ambiguous key,
// files that are not read) end in visible buckets, not in silence. Every
// project here is purpose-built; the expectations are written by hand.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { extractDictionaries } from '../../../skills/excavator-product-handbook/lib/dict-extract.mjs';
import { checkDictionariesShape } from '../../../skills/excavator-product-handbook/lib/dict-shape.mjs';
import { repoRoot, runHandbook } from './helpers.mjs';

const FIXTURE = join(repoRoot, 'tests/fixtures/product-handbook/dict-project');
const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function tempDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A throwaway project from `{ path: text }`; returns its real path. */
function project(files) {
  const root = tempDir('xhb-dict-');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const goProject = (files) => project({ 'go.mod': 'module example.com/x\n', ...files });
const jsProject = (files) => project({ 'package.json': '{}', ...files });
const byName = (data, name) => data.dictionaries.find((entry) => entry.name === name);
const members = (dictionary) => dictionary.members.map((member) => [member.name, member.value]);

describe('handbook.mjs data writes the dictionaries', () => {
  it('prints the Data line and then the Dictionaries line, and writes dictionaries.json next to data.json', () => {
    const out = tempDir('xhb-out-');
    const result = runHandbook(['data', FIXTURE, out]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatch(/^Data: /);
    expect(result.lines[1]).toBe('Dictionaries: 29 value sets (10 Go types, 5 TS enums, 3 TS const objects, 11 JS objects); 80 members (74 computed, 6 not computed); 11 comments; 20 display names; 3 same names with different values; 5 skipped members; 19 other candidates (2 Go types without constants, 0 Go types declared again, 2 untyped iota constants, 2 constants of another type, 3 plain constants, 1 variables of another type, 1 TS const objects without literal members, 1 JS objects without literal members, 7 unmatched keys, 0 ambiguous keys).');
    const written = JSON.parse(readFileSync(join(out, 'dictionaries.json'), 'utf-8'));
    expect(written).toEqual(extractDictionaries(FIXTURE));
    expect(written.format).toBe('excavator-product-handbook-dictionaries/1');
    expect(checkDictionariesShape(written)).toEqual([]);
    expect(JSON.parse(readFileSync(join(out, 'data.json'), 'utf-8')).format).toBe('excavator-product-handbook-data/1');
  });

  it('writes the same bytes from the same input, with no local path in it', () => {
    const a = tempDir('xhb-out-');
    const b = tempDir('xhb-out-');
    expect(runHandbook(['data', FIXTURE, a]).status).toBe(0);
    expect(runHandbook(['data', FIXTURE, b]).status).toBe(0);
    const text = readFileSync(join(a, 'dictionaries.json'), 'utf-8');
    expect(text).toBe(readFileSync(join(b, 'dictionaries.json'), 'utf-8'));
    expect(text).not.toContain(FIXTURE);
    expect(text).not.toContain(repoRoot);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('writes an empty dictionaries.json with zero counts for a project with no value set, and says every application has none', () => {
    const root = project({ 'app/package.json': '{}', 'app/src/index.js': 'module.exports = 1;\n' });
    const out = tempDir('xhb-out-');
    const result = runHandbook(['data', root, out]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.lines[1]).toMatch(/^Dictionaries: 0 value sets \(0 Go types, 0 TS enums, 0 TS const objects, 0 JS objects\); 0 members/);
    const written = JSON.parse(readFileSync(join(out, 'dictionaries.json'), 'utf-8'));
    expect(written.dictionaries).toEqual([]);
    expect(written.candidates).toEqual([]);
    expect(written.applications).toEqual([{ directory: 'app', dictionaries: 0 }]);
    expect(written.scanned).toEqual({ filesSearched: 1, skippedBinary: 0, skippedTooLarge: 0, skippedUnreadable: 0 });
  });

  it('describes dictionaries.json in the usage text', () => {
    const result = runHandbook(['--help']);
    expect(result.stdout).toContain('dictionaries.json');
  });
});

describe('the shape check', () => {
  const good = () => JSON.parse(JSON.stringify(extractDictionaries(FIXTURE)));

  it('accepts what the extraction writes', () => {
    expect(checkDictionariesShape(good())).toEqual([]);
  });

  it('refuses a value that is not an object, another format and a missing field', () => {
    expect(checkDictionariesShape(null).length).toBeGreaterThan(0);
    expect(checkDictionariesShape([]).length).toBeGreaterThan(0);
    const other = good();
    other.format = 'excavator-product-handbook-dictionaries/2';
    expect(checkDictionariesShape(other).join('\n')).toContain('format');
    const missing = good();
    delete missing.mismatches;
    expect(checkDictionariesShape(missing).join('\n')).toContain('mismatches');
  });

  it('refuses a count that does not match its list, and a count that is not known', () => {
    const wrong = good();
    wrong.counts.members.total += 1;
    expect(checkDictionariesShape(wrong).join('\n')).toContain('counts.members');
    const nested = good();
    nested.counts.candidates.goConstants.plain = 0;
    expect(checkDictionariesShape(nested).join('\n')).toContain('counts.candidates');
    const extra = good();
    extra.counts.invented = 1;
    expect(checkDictionariesShape(extra).join('\n')).toContain('counts.invented');
  });

  it('refuses a bucket that is not one of the buckets of its kind', () => {
    const bad = good();
    bad.candidates.find((row) => row.kind === 'go-const').bucket = 'misc';
    expect(checkDictionariesShape(bad).join('\n')).toContain('candidates[');
    const wrongKind = good();
    wrongKind.candidates.find((row) => row.kind === 'ts-enum').bucket = 'noConstants';
    expect(checkDictionariesShape(wrongKind).join('\n')).toContain('candidates[');
  });

  it('refuses a row that points at a dictionary that is not listed, and a dictionary that no dictionary row points at', () => {
    const dangling = good();
    dangling.candidates.find((row) => row.bucket === 'member').dictionary = 'no/such/file.go:T';
    expect(checkDictionariesShape(dangling).join('\n')).toContain('no/such/file.go:T');
    const unpointed = good();
    const index = unpointed.candidates.findIndex((row) => row.bucket === 'dictionary');
    unpointed.candidates.splice(index, 1);
    expect(checkDictionariesShape(unpointed).join('\n')).toContain('pointed at 0 times');
  });

  it('refuses a computed member with no value, a member that is not computed with no reason, and an id listed twice', () => {
    const noValue = good();
    noValue.dictionaries[0].members[0].value = null;
    expect(checkDictionariesShape(noValue).join('\n')).toContain('computed and has no value');
    const noReason = good();
    const legacy = noReason.dictionaries.flatMap((entry) => entry.members).find((member) => !member.computed);
    delete legacy.reason;
    expect(checkDictionariesShape(noReason).join('\n')).toContain('reason');
    const twice = good();
    twice.dictionaries[1].id = twice.dictionaries[0].id;
    expect(checkDictionariesShape(twice).join('\n')).toContain('listed twice');
  });

  it('refuses mismatches that the dictionaries do not give, and a label that is not backed by a label row', () => {
    const edited = good();
    edited.mismatches[0].onlyRight = [];
    expect(checkDictionariesShape(edited).join('\n')).toContain('mismatches');
    const dropped = good();
    dropped.mismatches.pop();
    expect(checkDictionariesShape(dropped).join('\n')).toContain('mismatches');
    const label = good();
    label.dictionaries.flatMap((entry) => entry.members).find((member) => member.labels.length > 0).labels.pop();
    expect(checkDictionariesShape(label).join('\n')).toContain('label rows');
  });

  it('refuses a comment with another place of saying (where) and a line that is not a line', () => {
    const where = good();
    where.dictionaries.flatMap((entry) => entry.members).find((member) => member.comments.length > 0).comments[0].where = 'below';
    expect(checkDictionariesShape(where).join('\n')).toContain('dictionaries[');
    const line = good();
    line.dictionaries[0].members[0].line = 0;
    expect(checkDictionariesShape(line).join('\n')).toContain('dictionaries[');
  });
});

describe('comments', () => {
  it('joins the lines of a run of // comments and of a block comment with one space, markers and the star of a block removed, text unchanged', () => {
    const root = goProject({
      'a.go': [
        'package a',
        'type T string',
        'const (',
        '\t// first line',
        '\t//second line (no space after the marker)',
        '\tA T = "a"',
        '\t/**',
        '\t * block line one',
        '\t * block line two',
        '\t */',
        '\tB T = "b"',
        ')',
        '',
      ].join('\n'),
    });
    const data = extractDictionaries(root);
    const [a, b] = byName(data, 'T').members;
    expect(a.comments).toEqual([{ text: 'first line second line (no space after the marker)', file: 'a.go', line: 4, endLine: 5, where: 'above' }]);
    expect(b.comments).toEqual([{ text: 'block line one block line two', file: 'a.go', line: 7, endLine: 10, where: 'above' }]);
  });

  it('gives a trailing comment to the member before it on the line, not to the one that starts the line', () => {
    const root = jsProject({ 'a.js': 'const OrderState = {\n  open: 1, shut: 2, // closed for good\n  held: 3,\n};\n' });
    const data = extractDictionaries(root);
    const [open, shut, held] = byName(data, 'OrderState').members;
    expect(open.comments).toEqual([]);
    expect(shut.comments.map((c) => c.text)).toEqual(['closed for good']);
    expect(held.comments).toEqual([]);
  });

  it('does not take a comment that is not directly above, nor one that is the trailing comment of the member above', () => {
    const root = jsProject({ 'a.js': 'const OrderState = {\n  open: 1, // about open\n  shut: 2,\n\n  // far above\n\n  held: 3,\n};\n' });
    const [, shut, held] = byName(extractDictionaries(root), 'OrderState').members;
    expect(shut.comments).toEqual([]);
    expect(held.comments).toEqual([]);
  });

  it('is not confused by // inside a string value or a raw string', () => {
    const root = goProject({ 'a.go': 'package a\ntype T string\nconst (\n\tA T = "http://x/y" // a link\n\tB T = `raw // not a comment`\n)\n' });
    const [a, b] = byName(extractDictionaries(root), 'T').members;
    expect([a.value, a.comments.map((c) => c.text)]).toEqual(['http://x/y', ['a link']]);
    expect([b.value, b.comments]).toEqual(['raw // not a comment', []]);
  });
});

describe('Go: the reading of constants', () => {
  it('reads several names in one spec, with their own iota expressions and the implicit repetition of the list', () => {
    const root = goProject({ 'a.go': 'package a\ntype T int\nconst (\n\tA, B T = iota, iota * 10\n\tC, D\n)\n' });
    expect(members(byName(extractDictionaries(root), 'T'))).toEqual([['A', 0], ['B', 0], ['C', 1], ['D', 10]]);
  });

  it('repeats a string expression, reads a single const outside a group, and starts iota at 0 for it', () => {
    const root = goProject({ 'a.go': 'package a\ntype T string\ntype U uint8\nconst (\n\tA T = "x"\n\tB\n)\nconst C U = iota\nconst D U = 0x1F\n' });
    const data = extractDictionaries(root);
    expect(members(byName(data, 'T'))).toEqual([['A', 'x'], ['B', 'x']]);
    expect(members(byName(data, 'U'))).toEqual([['C', 0], ['D', 31]]);
  });

  it('does not read a const or a type inside a function, and does not take a type that is not a named basic type', () => {
    const root = goProject({ 'a.go': 'package a\ntype S struct{ N int }\ntype F func()\ntype M map[string]int\ntype T int\nfunc f() {\n\tconst X T = 1\n\ttype Local int\n}\nconst Y T = 2\n' });
    const data = extractDictionaries(root);
    expect(data.candidates.filter((row) => row.kind === 'go-type').map((row) => row.name)).toEqual(['T']);
    expect(data.candidates.filter((row) => row.kind === 'go-const').map((row) => [row.name, row.bucket])).toEqual([['Y', 'member']]);
  });

  it('puts the type with the same name in another directory in its own set, and a constant of a type of another package in otherType', () => {
    const root = goProject({
      'a/a.go': 'package a\ntype T int\nconst X T = 1\n',
      'b/b.go': 'package b\ntype T int\nconst Y T = 2\nconst Z a.T = 3\n',
    });
    const data = extractDictionaries(root);
    expect(data.dictionaries.map((entry) => [entry.id, entry.members.map((m) => m.name)])).toEqual([['a/a.go:T', ['X']], ['b/b.go:T', ['Y']]]);
    expect(data.candidates.find((row) => row.name === 'Z').bucket).toBe('otherType');
  });

  it('puts a type declared again in the same directory in the duplicate bucket, and gives its constants to the first', () => {
    const root = goProject({
      'a/one.go': 'package a\ntype T int\nconst X T = 1\n',
      'a/two.go': 'package a\ntype T int\nconst Y T = 2\n',
    });
    const data = extractDictionaries(root);
    expect(data.dictionaries.map((entry) => entry.id)).toEqual(['a/one.go:T']);
    expect(members(data.dictionaries[0])).toEqual([['X', 1], ['Y', 2]]);
    expect(data.candidates.filter((row) => row.kind === 'go-type').map((row) => [row.file, row.bucket])).toEqual([['a/one.go', 'dictionary'], ['a/two.go', 'duplicate']]);
    expect(checkDictionariesShape(data)).toEqual([]);
  });
});

describe('display names: resolution', () => {
  it('puts a package-qualified key that two packages of the application could own in ambiguousKey, and gives no name', () => {
    const root = goProject({
      'one/status/s.go': 'package status\ntype T int\nconst A T = 1\n',
      'two/status/s.go': 'package status\ntype T int\nconst A T = 1\n',
      'use/u.go': 'package use\nvar names = map[int]string{\n\tstatus.A: "Alpha",\n}\n',
    });
    const data = extractDictionaries(root);
    expect(data.candidates.filter((row) => row.kind === 'map-entry').map((row) => [row.key, row.bucket])).toEqual([['status.A', 'ambiguousKey']]);
    expect(data.dictionaries.flatMap((entry) => entry.members.flatMap((m) => m.labels))).toEqual([]);
    expect(data.counts.candidates.mapEntries).toEqual({ total: 1, label: 0, unmatchedKey: 0, ambiguousKey: 1 });
  });

  it('resolves a bare key in the directory of the map only, and a key in another application not at all', () => {
    const root = project({
      'a-app/go.mod': 'module a\n',
      'a-app/s/s.go': 'package s\ntype T int\nconst A T = 1\nvar n = map[T]string{ A: "Alpha" }\n',
      'b-app/go.mod': 'module b\n',
      'b-app/s/s.go': 'package s\nvar n = map[int]string{ A: "Other app" }\n',
      'a-app/t/t.go': 'package t\nvar n = map[int]string{ A: "Other package" }\n',
    });
    const data = extractDictionaries(root);
    expect(byName(data, 'T').members[0].labels.map((l) => l.text)).toEqual(['Alpha']);
    expect(data.candidates.filter((row) => row.bucket === 'unmatchedKey').map((row) => row.file)).toEqual(['a-app/t/t.go', 'b-app/s/s.go']);
  });

  it('gives a name to every member that shares the value in a reverse table, and one row for each', () => {
    const root = jsProject({ 'a.js': "const DirKind = { up: 1, north: 1, down: 2, names: { 1: 'Up', 2: 'Down' } };\n" });
    const data = extractDictionaries(root);
    expect(byName(data, 'DirKind').members.map((m) => [m.name, m.labels.map((l) => l.text)])).toEqual([['up', ['Up']], ['north', ['Up']], ['down', ['Down']]]);
    expect(data.counts.candidates.mapEntries.label).toBe(3);
    expect(checkDictionariesShape(data)).toEqual([]);
  });

  it('does not take a map whose entries have a non-literal value or a key that is a call with arguments', () => {
    const root = goProject({ 'a.go': 'package a\ntype T int\nconst A T = 1\nvar n = map[T]string{ A: name(), T(1): "one", foo(): "two" }\n' });
    const data = extractDictionaries(root);
    expect(data.candidates.filter((row) => row.kind === 'map-entry')).toEqual([]);
  });
});

describe('TypeScript and JavaScript: edge cases', () => {
  it('reads a declare enum, string escapes in a value and a quoted member name, and counts what it cannot read as skipped', () => {
    const root = jsProject({ 'a.ts': "declare enum E {\n  A = 'it\\'s',\n  [x] = 1,\n  B = `t`,\n}\n" });
    const dictionary = byName(extractDictionaries(root), 'E');
    expect(members(dictionary)).toEqual([['A', "it's"], ['B', 't']]);
    expect(dictionary.skippedMembers).toBe(1);
  });

  it('reads an object in a TypeScript file only when it ends in as const, and does not read the enum form in a JavaScript file', () => {
    const root = jsProject({ 'a.ts': "export const OrderState = { open: 'open' } as const;\nconst LoanState = { open: 'open' };\nlet TaskState = { open: 'open' } as const;\nconst RoomState = { open: 'open' } as const satisfies Record<string, string>;\n", 'b.js': 'enum Fake { A }\nconst CaseState = { open: 1 } as const;\n' });
    const data = extractDictionaries(root);
    expect(data.dictionaries.map((entry) => [entry.id, entry.form])).toEqual([['a.ts:OrderState', 'ts-const-object'], ['a.ts:RoomState', 'ts-const-object'], ['b.js:CaseState', 'js-object']]);
  });

  it('keeps two sets with the same name in one file apart by line in the id', () => {
    const root = jsProject({ 'a.js': "var OrderState = { open: 1 };\nvar OrderState = { open: 2 };\n" });
    expect(extractDictionaries(root).dictionaries.map((entry) => entry.id)).toEqual(['a.js:OrderState', 'a.js:OrderState#2']);
  });
});

describe('files that are not read, and the speed', () => {
  it('counts a Go, TypeScript or JavaScript file that is binary or over the size cap, and does not read it', () => {
    const root = jsProject({ 'ok.js': 'const OrderState = { open: 1 };\n' });
    writeFileSync(join(root, 'blob.js'), Buffer.from([0x63, 0, 0x6f]));
    writeFileSync(join(root, 'huge.go'), `package a\ntype T int\nconst A T = 1\n${'x'.repeat(2 * 1024 * 1024 + 10)}`);
    const data = extractDictionaries(root);
    expect(data.scanned).toEqual({ filesSearched: 1, skippedBinary: 1, skippedTooLarge: 1, skippedUnreadable: 0 });
    expect(data.dictionaries.map((entry) => entry.name)).toEqual(['OrderState']);
  });

  it('reads 130 Go types and 70 enums among 500 files quickly, each once', () => {
    const files = { 'go.mod': 'module x\n', 'web/package.json': '{}' };
    for (let i = 0; i < 130; i += 1) {
      const consts = Array.from({ length: 8 }, (_, k) => `\tT${i}V${k}${k === 0 ? ` T${i} = iota + 1` : ''} // note ${k}`).join('\n');
      files[`pkg${i}/t.go`] = `package pkg${i}\ntype T${i} int\nconst (\n${consts}\n)\n`;
    }
    for (let i = 0; i < 70; i += 1) files[`web/src/e${i}.ts`] = `export enum E${i} {\n  A,\n  B,\n  C = 'c',\n}\n`;
    for (let i = 0; i < 300; i += 1) files[`web/src/f${i}.ts`] = `export const value${i} = ${i};\n`;
    const root = project(files);
    const started = Date.now();
    const data = extractDictionaries(root);
    const elapsed = Date.now() - started;
    expect(data.counts.dictionaries).toEqual({ total: 200, goType: 130, tsEnum: 70, tsConstObject: 0, jsObject: 0 });
    expect(data.counts.members.total).toBe(130 * 8 + 70 * 3);
    expect(data.counts.comments).toBe(130 * 8);
    expect(data.scanned.filesSearched).toBe(500);
    expect(checkDictionariesShape(data)).toEqual([]);
    expect(elapsed).toBeLessThan(5000);
  });
});
