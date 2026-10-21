/** The Code page's pure functions (line ranges, tree, filter, wording), run in Node through `vm`. */

import { describe, expect, it } from 'vitest';

import { load } from './viewer-load.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));
const { code } = load();

describe('parseLines', () => {
  it.each([
    ['7', { start: 7, end: 7 }],
    ['12-20', { start: 12, end: 20 }],
    ['5-5', { start: 5, end: 5 }],
    ['001-002', { start: 1, end: 2 }],
  ])('reads %j', (text, range) => {
    expect(plain(code.parseLines(text))).toEqual(range);
  });

  it.each(['', '0', '0-3', '5-2', 'a', '1-', '-3', '1-2-3', ' 1', '1 ', '1.5', '1,2', '+1'])('refuses %j', (text) => {
    expect(code.parseLines(text)).toBeNull();
  });

  it('refuses what is not a string', () => {
    expect(code.parseLines(undefined)).toBeNull();
    expect(code.parseLines(7)).toBeNull();
  });
});

describe('rangeText', () => {
  it('writes the range a product records', () => {
    expect(code.rangeText([3, 9])).toBe('3-9');
    expect(code.rangeText([4, 4])).toBe('4');
    expect(code.rangeText([4])).toBe('4');
    expect(code.rangeText(12)).toBe('12');
    expect(code.rangeText('3-9')).toBe('3-9');
  });

  it('gives null when there is no usable range', () => {
    expect(code.rangeText(null)).toBeNull();
    expect(code.rangeText(undefined)).toBeNull();
    expect(code.rangeText('x')).toBeNull();
    expect(code.rangeText([])).toBeNull();
    expect(code.rangeText(['a', 'b'])).toBeNull();
  });
});

describe('splitLines', () => {
  it('does not count the newline that ends a file as another line', () => {
    expect(code.splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(code.splitLines('a\nb')).toEqual(['a', 'b']);
    expect(code.splitLines('a\n\n')).toEqual(['a', '']);
  });

  it('gives no lines for an empty file and one empty line for a lone newline', () => {
    expect(code.splitLines('')).toEqual([]);
    expect(code.splitLines('\n')).toEqual(['']);
  });

  it('drops the carriage return of a Windows line end', () => {
    expect(code.splitLines('a\r\nb\r\n')).toEqual(['a', 'b']);
  });
});

describe('lineStatus', () => {
  it('has no range when none was asked for', () => {
    for (const none of [undefined, null, '']) expect(code.lineStatus(none, 10)).toEqual({ state: 'none' });
  });

  it('accepts a range inside the file, including its last line', () => {
    expect(plain(code.lineStatus('3-9', 10))).toEqual({ state: 'ok', start: 3, end: 9 });
    expect(plain(code.lineStatus('10', 10))).toEqual({ state: 'ok', start: 10, end: 10 });
    expect(plain(code.lineStatus('1-10', 10))).toEqual({ state: 'ok', start: 1, end: 10 });
  });

  it('names the first missing line when the range goes past the end, and marks nothing', () => {
    expect(plain(code.lineStatus('11', 10))).toEqual({ state: 'out-of-range', line: 11, start: 11, end: 11 });
    expect(plain(code.lineStatus('40-50', 10))).toEqual({ state: 'out-of-range', line: 40, start: 40, end: 50 });
    expect(plain(code.lineStatus('8-14', 10))).toEqual({ state: 'out-of-range', line: 11, start: 8, end: 14 });
  });

  it('puts every line past the end of an empty file', () => {
    expect(plain(code.lineStatus('1', 0))).toEqual({ state: 'out-of-range', line: 1, start: 1, end: 1 });
  });

  it('calls a text that is not a range invalid', () => {
    expect(plain(code.lineStatus('abc', 10))).toEqual({ state: 'invalid', text: 'abc' });
    expect(plain(code.lineStatus('0', 10))).toEqual({ state: 'invalid', text: '0' });
    expect(plain(code.lineStatus('9-3', 10))).toEqual({ state: 'invalid', text: '9-3' });
  });
});

describe('class wording', () => {
  const source = { limitBytes: 1048576 };
  it('labels the five classes', () => {
    expect(['embedded', 'binary', 'tooLarge', 'notInSnapshot', 'notEmbeddedOnRequest'].map(code.bucketLabel)).toEqual([
      'Embedded', 'Binary', 'Too large', 'Not in snapshot', 'Not embedded on request',
    ]);
    expect(code.bucketLabel('constructor')).toBe('constructor');
  });

  it('says why each other class is not shown', () => {
    expect(code.bucketReason('tooLarge', { bytes: 2500000 }, source, 'git:1')).toBe(
      'This file is 2,500,000 bytes; the limit for embedding a file is 1,048,576 bytes.');
    expect(code.bucketReason('notEmbeddedOnRequest', {}, source, 'git:1')).toMatch(/--no-source/);
    expect(code.bucketReason('binary', {}, source, 'git:1')).toMatch(/not text/);
    expect(code.bucketReason('notInSnapshot', {}, source, 'git:abc')).toBe('This path is not in the source snapshot (git:abc).');
    expect(code.bucketReason('embedded', {}, source, 'git:1')).toBe('');
  });
});

describe('entries, filter and tree', () => {
  const source = {
    files: {
      'src/b.js': { bucket: 'embedded', bytes: 10 },
      'src/a/deep/c.js': { bucket: 'binary', bytes: 5 },
      'README.md': { bucket: 'notInSnapshot' },
      'src/a.js': { bucket: 'tooLarge', bytes: 2000000 },
      'Other/Thing.js': { bucket: 'embedded', bytes: 3 },
    },
  };
  const entries = code.entriesFromSource(source);

  it('lists the manifest rows sorted by path', () => {
    expect(entries.map((e) => e.path)).toEqual(['Other/Thing.js', 'README.md', 'src/a.js', 'src/a/deep/c.js', 'src/b.js']);
    expect(entries.find((e) => e.path === 'README.md').bytes).toBeNull();
    expect(code.entriesFromSource(undefined)).toEqual([]);
  });

  it('keeps the paths that contain the filter text, whatever its case', () => {
    expect(code.filterEntries(entries, 'SRC/A').map((e) => e.path)).toEqual(['src/a.js', 'src/a/deep/c.js']);
    expect(code.filterEntries(entries, '  thing ').map((e) => e.path)).toEqual(['Other/Thing.js']);
    expect(code.filterEntries(entries, '')).toBe(entries);
    expect(code.filterEntries(entries, 'zzz')).toEqual([]);
  });

  it('builds a tree with directories first and every file counted once under each parent', () => {
    const tree = plain(code.buildTree(entries));
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
    const tree = plain(code.buildTree([{ path: 'a/x.js', bucket: 'embedded' }, { path: 'b/x.js', bucket: 'embedded' }]));
    expect(tree.dirs.map((d) => d.files.map((f) => f.path))).toEqual([['a/x.js'], ['b/x.js']]);
  });

  it('survives a directory named like an object property', () => {
    const tree = plain(code.buildTree([{ path: 'constructor/__proto__/x.js', bucket: 'embedded' }, { path: 'toString/y.js', bucket: 'embedded' }]));
    expect(tree.dirs.map((d) => d.name)).toEqual(['constructor', 'toString']);
    expect(tree.dirs[0].dirs[0].name).toBe('__proto__');
  });
});

describe('the status dot of the Code page', () => {
  const counts = (over) => ({ source: { counts: { embedded: 0, binary: 0, tooLarge: 0, notInSnapshot: 0, notEmbeddedOnRequest: 0, ...over } } });
  it('is included with embedded files, different revision when only absent paths are named, else not run', () => {
    expect(code.status(counts({ embedded: 2, notInSnapshot: 1 }))).toBe('included');
    expect(code.status(counts({ notInSnapshot: 1 }))).toBe('different-revision');
    expect(code.status(counts({ notEmbeddedOnRequest: 4 }))).toBe('not-run');
    expect(code.status(counts({}))).toBe('not-run');
  });
});

describe('codeLink', () => {
  function fakeDocument() {
    return {
      createElement: (tag) => {
        const el = { tag, attributes: {}, children: [] };
        el.setAttribute = (name, value) => { el.attributes[name] = value; };
        el.appendChild = (child) => { el.children.push(child); return child; };
        el.addEventListener = () => {};
        return el;
      },
      createTextNode: (text) => ({ text }),
    };
  }
  const XV = load({ document: fakeDocument() });

  it('links to the file and to its line range', () => {
    const link = XV.codeLink('src/a b.js', [3, 9]);
    expect(link.tag).toBe('a');
    expect(link.attributes.href).toBe('#/code?path=src%2Fa%20b.js&lines=3-9');
    expect(link.children).toEqual([{ text: 'src/a b.js:3-9' }]);
    expect(link.attributes.title).toBe('Open src/a b.js at 3-9 in the Code page');
  });

  it('links to the file alone when there is no range', () => {
    const link = XV.codeLink('x.js', null);
    expect(link.attributes.href).toBe('#/code?path=x.js');
    expect(link.children).toEqual([{ text: 'x.js' }]);
  });

  it('links a one-line range with a single number and keeps a hostile path as text', () => {
    const hostile = '"><img src=x onerror=1>.js';
    const link = XV.codeLink(hostile, [5, 5]);
    expect(link.attributes.href).toBe(`#/code?path=${encodeURIComponent(hostile)}&lines=5`);
    expect(link.children).toEqual([{ text: `${hostile}:5` }]);
  });

  it('parses back what it builds', () => {
    const link = XV.codeLink('dir/a&b=c.js', [2, 4]);
    expect(plain(XV.router.parseRoute(link.attributes.href))).toEqual({ page: 'code', rest: '', params: { path: 'dir/a&b=c.js', lines: '2-4' } });
  });
});
