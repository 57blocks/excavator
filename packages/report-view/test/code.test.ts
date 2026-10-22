import { describe, expect, it } from 'vitest';

import {
  bucketLabel, bucketReason, buildTree, codeHash, codeStatus, entriesFromSource, filterEntries, lineStatus, parseLines, rangeText, splitLines,
} from '../src/lib/code';
import { parseRoute } from '../src/lib/route';

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('parseLines', () => {
  it.each([
    ['7', { start: 7, end: 7 }],
    ['12-20', { start: 12, end: 20 }],
    ['5-5', { start: 5, end: 5 }],
    ['001-002', { start: 1, end: 2 }],
  ])('reads %j', (text, range) => {
    expect(parseLines(text)).toEqual(range);
  });

  it.each(['', '0', '0-3', '5-2', 'a', '1-', '-3', '1-2-3', ' 1', '1 ', '1.5', '1,2', '+1'])('refuses %j', (text) => {
    expect(parseLines(text)).toBeNull();
  });

  it('refuses what is not a string', () => {
    expect(parseLines(undefined)).toBeNull();
    expect(parseLines(7)).toBeNull();
  });
});

describe('rangeText', () => {
  it('writes the range a product records', () => {
    expect(rangeText([3, 9])).toBe('3-9');
    expect(rangeText([4, 4])).toBe('4');
    expect(rangeText([4])).toBe('4');
    expect(rangeText(12)).toBe('12');
    expect(rangeText('3-9')).toBe('3-9');
  });

  it('gives null when there is no usable range', () => {
    expect(rangeText(null)).toBeNull();
    expect(rangeText(undefined)).toBeNull();
    expect(rangeText('x')).toBeNull();
    expect(rangeText([])).toBeNull();
    expect(rangeText(['a', 'b'])).toBeNull();
  });
});

describe('codeHash', () => {
  it('links to the file and to its line range', () => {
    expect(codeHash('src/a b.js', [3, 9])).toBe('#/code?path=src%2Fa%20b.js&lines=3-9');
  });

  it('links to the file alone when there is no range', () => {
    expect(codeHash('x.js')).toBe('#/code?path=x.js');
    expect(codeHash('x.js', null)).toBe('#/code?path=x.js');
  });

  it('links a one-line range with a single number and keeps a hostile path as data', () => {
    const hostile = '"><img src=x onerror=1>.js';
    expect(codeHash(hostile, [5, 5])).toBe(`#/code?path=${encodeURIComponent(hostile)}&lines=5`);
  });

  it('parses back what it builds', () => {
    expect(plain(parseRoute(codeHash('dir/a&b=c.js', [2, 4])))).toEqual({ page: 'code', rest: '', params: { path: 'dir/a&b=c.js', lines: '2-4' } });
  });
});

describe('splitLines', () => {
  it('does not count the newline that ends a file as another line', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
  });

  it('gives no lines for an empty file and one empty line for a lone newline', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('\n')).toEqual(['']);
  });

  it('drops the carriage return of a Windows line end', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b']);
  });
});

describe('lineStatus', () => {
  it('has no range when none was asked for', () => {
    for (const none of [undefined, null, '']) expect(lineStatus(none, 10)).toEqual({ state: 'none' });
  });

  it('accepts a range inside the file, including its last line', () => {
    expect(lineStatus('3-9', 10)).toEqual({ state: 'ok', start: 3, end: 9 });
    expect(lineStatus('10', 10)).toEqual({ state: 'ok', start: 10, end: 10 });
    expect(lineStatus('1-10', 10)).toEqual({ state: 'ok', start: 1, end: 10 });
  });

  it('names the first missing line when the range goes past the end, and marks nothing', () => {
    expect(lineStatus('11', 10)).toEqual({ state: 'out-of-range', line: 11, start: 11, end: 11 });
    expect(lineStatus('40-50', 10)).toEqual({ state: 'out-of-range', line: 40, start: 40, end: 50 });
    expect(lineStatus('8-14', 10)).toEqual({ state: 'out-of-range', line: 11, start: 8, end: 14 });
  });

  it('puts every line past the end of an empty file', () => {
    expect(lineStatus('1', 0)).toEqual({ state: 'out-of-range', line: 1, start: 1, end: 1 });
  });

  it('calls a text that is not a range invalid', () => {
    expect(lineStatus('abc', 10)).toEqual({ state: 'invalid', text: 'abc' });
    expect(lineStatus('0', 10)).toEqual({ state: 'invalid', text: '0' });
    expect(lineStatus('9-3', 10)).toEqual({ state: 'invalid', text: '9-3' });
  });
});

describe('class wording', () => {
  const source = { limitBytes: 1048576 };
  it('labels the five classes', () => {
    expect(['embedded', 'binary', 'tooLarge', 'notInSnapshot', 'notEmbeddedOnRequest'].map(bucketLabel)).toEqual([
      'Embedded', 'Binary', 'Too large', 'Not in snapshot', 'Not embedded on request',
    ]);
    expect(bucketLabel('constructor')).toBe('constructor');
  });

  it('says why each other class is not shown', () => {
    expect(bucketReason('tooLarge', { bytes: 2500000 }, source, 'git:1')).toBe('This file is 2,500,000 bytes; the limit for embedding a file is 1,048,576 bytes.');
    expect(bucketReason('notEmbeddedOnRequest', {}, source, 'git:1')).toMatch(/--no-source/);
    expect(bucketReason('binary', {}, source, 'git:1')).toMatch(/not text/);
    expect(bucketReason('notInSnapshot', {}, source, 'git:abc')).toBe('This path is not in the source snapshot (git:abc).');
    expect(bucketReason('embedded', {}, source, 'git:1')).toBe('');
  });
});

describe('entries, filter and tree', () => {
  const source = {
    files: {
      'src/b.js': { bucket: 'embedded' as const, bytes: 10 },
      'src/a/deep/c.js': { bucket: 'binary' as const, bytes: 5 },
      'README.md': { bucket: 'notInSnapshot' as const },
      'src/a.js': { bucket: 'tooLarge' as const, bytes: 2000000 },
      'Other/Thing.js': { bucket: 'embedded' as const, bytes: 3 },
    },
  };
  const entries = entriesFromSource(source);

  it('lists the manifest rows sorted by path', () => {
    expect(entries.map((e) => e.path)).toEqual(['Other/Thing.js', 'README.md', 'src/a.js', 'src/a/deep/c.js', 'src/b.js']);
    expect(entries.find((e) => e.path === 'README.md')?.bytes).toBeNull();
    expect(entriesFromSource(undefined)).toEqual([]);
  });

  it('keeps the paths that contain the filter text, whatever its case', () => {
    expect(filterEntries(entries, 'SRC/A').map((e) => e.path)).toEqual(['src/a.js', 'src/a/deep/c.js']);
    expect(filterEntries(entries, '  thing ').map((e) => e.path)).toEqual(['Other/Thing.js']);
    expect(filterEntries(entries, '')).toBe(entries);
    expect(filterEntries(entries, 'zzz')).toEqual([]);
  });

  it('builds a tree with directories first and every file counted once under each parent', () => {
    const tree = buildTree(entries);
    expect(tree.count).toBe(5);
    expect(tree.dirs.map((d) => [d.name, d.count])).toEqual([['Other', 1], ['src', 3]]);
    expect(tree.files.map((f) => f.path)).toEqual(['README.md']);
    const src = tree.dirs[1];
    expect(src.path).toBe('src');
    expect(src.files.map((f) => f.name)).toEqual(['a.js', 'b.js']);
    expect(src.dirs[0]).toMatchObject({ name: 'a', path: 'src/a', count: 1 });
    expect(src.dirs[0].dirs[0]).toMatchObject({ name: 'deep', path: 'src/a/deep' });
    expect(src.dirs[0].dirs[0].files[0]).toEqual({ name: 'c.js', path: 'src/a/deep/c.js', bucket: 'binary' });
  });

  it('keeps two files of the same name in different directories apart', () => {
    const tree = buildTree([{ path: 'a/x.js', bucket: 'embedded' }, { path: 'b/x.js', bucket: 'embedded' }]);
    expect(tree.dirs.map((d) => d.files.map((f) => f.path))).toEqual([['a/x.js'], ['b/x.js']]);
  });

  it('survives a directory named like an object property', () => {
    const tree = buildTree([{ path: 'constructor/__proto__/x.js', bucket: 'embedded' }, { path: 'toString/y.js', bucket: 'embedded' }]);
    expect(tree.dirs.map((d) => d.name)).toEqual(['constructor', 'toString']);
    expect(tree.dirs[0].dirs[0].name).toBe('__proto__');
  });
});

describe('the state of the Code page in the navigation', () => {
  const counts = (over: Partial<Record<'embedded' | 'binary' | 'tooLarge' | 'notInSnapshot' | 'notEmbeddedOnRequest', number>>) => ({
    embedded: 0, binary: 0, tooLarge: 0, notInSnapshot: 0, notEmbeddedOnRequest: 0, ...over,
  });
  it('is included with embedded files, different revision when only absent paths are named, else not run', () => {
    expect(codeStatus(counts({ embedded: 2, notInSnapshot: 1 }))).toBe('included');
    expect(codeStatus(counts({ notInSnapshot: 1 }))).toBe('different-revision');
    expect(codeStatus(counts({ notEmbeddedOnRequest: 4 }))).toBe('not-run');
    expect(codeStatus(counts({}))).toBe('not-run');
  });
});
