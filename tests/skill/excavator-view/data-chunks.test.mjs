/**
 * The data of the explorer page in compressed parts (openspec: changes/explorer-chunked-data,
 * design D2-D3, D6, oracle O1 and O5): a tiny part limit cuts small data into several parts,
 * no part decodes to more than the limit unless it holds one element, one non-array field or
 * one source, the parts rebuild the data as it was, and a value too large for one string is an
 * error that names the data file and the field.
 */

import { readFileSync, rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chunkExplorerData, PART_CHARS } from '../../../skills/excavator-view/data-chunks.mjs';
import { assembleExplorerPage } from '../../../skills/excavator-view/page-assembly.mjs';
import { packProject } from '../../../skills/excavator-view/pack.mjs';
import { hotspotsProduct, makeGitProject, writeProduct } from './fixture.mjs';
import { blockText, explorerIndex, explorerPage, pageContent, partTexts } from './page.mjs';
import { writeTemplate } from './plugin-fixture.mjs';

let templateDir;
let templatePath;
beforeAll(() => {
  ({ dir: templateDir, path: templatePath } = writeTemplate());
});
afterAll(() => rmSync(templateDir, { recursive: true, force: true }));

const MANIFEST = { m: 1 };
const ACCENT = String.fromCharCode(0x00e9);
const pageOf = (data, partChars) => assembleExplorerPage({ templatePath, data, manifest: MANIFEST, partChars }).toString('utf-8');
const readBack = (data, partChars) => explorerPage(pageOf(data, partChars)).data;

/** A small data object shaped like the page's: arrays and plain fields mixed, a source table, a non-ASCII string, a key that only some files have. */
function sample() {
  const sources = Object.create(null);
  for (const path of ['src/z.js', 'src/a.js', 'src/m.js', 'lib/b.js']) {
    sources[path] = { path, content: `// ${path}\nexport const v = "${'x'.repeat(30)}";\n`, sizeBytes: 60, lineCount: 2 };
  }
  return {
    'knowledge-graph.json': {
      version: '1.0.0',
      project: { name: 'p', languages: ['javascript'] },
      nodes: Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, name: `node ${i} ${ACCENT}` })),
      edges: Array.from({ length: 20 }, (_, i) => ({ source: `n${i % 12}`, target: `n${(i + 1) % 12}`, type: 'calls' })),
      layers: [],
      coverage: { files: 12 },
    },
    'meta.json': { theme: 'violet' },
    'products.json': { snapshotRevision: 'r', products: [{ name: 'unused-code' }, { name: 'hotspots' }] },
    sources,
    'diff-overlay.json': { changedNodeIds: ['n1'], affectedNodeIds: [] },
  };
}

/** Which parts hold one member only: an array element, a non-array field or a source. */
function holdsOneMember(text) {
  const value = JSON.parse(text);
  return Array.isArray(value) ? value.length === 1 : Object.keys(value).length === 1;
}

describe('the part limit', () => {
  it('is 16 Mi characters by default, far under the one-string limit of V8', () => {
    expect(PART_CHARS).toBe(16 * 1024 * 1024);
    expect(PART_CHARS * 31).toBeLessThan(536870888);
  });

  it('cuts small data into several parts when the limit is tiny, and into one part per piece of data when it is not', () => {
    const tiny = partTexts(pageOf(sample(), 200));
    const roomy = partTexts(pageOf(sample()));
    expect(tiny.length).toBeGreaterThan(8);
    expect(roomy.length).toBeLessThan(tiny.length);
  });

  it.each([60, 200, 500, 5000])('no part decodes to more than %i characters unless it holds one member', (limit) => {
    for (const text of partTexts(pageOf(sample(), limit))) {
      if (text.length > limit) expect(holdsOneMember(text)).toBe(true);
    }
  });

  it('puts a member larger than the limit in a part of its own', () => {
    const data = { 'a.json': { rows: [1, 'x'.repeat(100), 2, 3], plain: 'y'.repeat(100), other: 1 } };
    const texts = partTexts(pageOf(data, 30));
    const big = texts.filter((text) => text.length > 30);
    expect(big.map((text) => holdsOneMember(text))).toEqual([true, true]);
    expect(readBack(data, 30)).toEqual(data);
  });

  it('keeps every array out of the header, so the header holds only the plain fields', () => {
    const data = sample();
    const file = data['knowledge-graph.json'];
    const { index } = chunkExplorerData(data, { partChars: 100000 });
    const texts = partTexts(pageOf(data, 100000));
    const fields = index.files['knowledge-graph.json'].fields;
    for (const field of fields.filter((f) => 'part' in f)) expect(Array.isArray(file[field.key])).toBe(false);
    for (const field of fields.filter((f) => 'parts' in f)) {
      expect(Array.isArray(file[field.key])).toBe(true);
      expect(field.parts.every((n) => Array.isArray(JSON.parse(texts[n])))).toBe(true);
    }
    expect(fields.map((f) => f.key)).toEqual(Object.keys(file));
  });
});

describe('the data read back', () => {
  it.each([undefined, 40, 200, 100000])('equals the data that went in, with the keys and fields in their order, for a limit of %s', (limit) => {
    const data = sample();
    const back = readBack(data, limit);
    expect(back).toEqual(data);
    expect(Object.keys(back)).toEqual(Object.keys(data));
    expect(Object.keys(back['knowledge-graph.json'])).toEqual(Object.keys(data['knowledge-graph.json']));
    expect(Object.keys(back.sources)).toEqual(Object.keys(data.sources));
  });

  it('keeps an empty array as an empty array, with no part for it', () => {
    const data = { 'a.json': { rows: [], more: [], plain: 1 } };
    const { index, parts } = chunkExplorerData(data);
    expect(index.files['a.json'].fields).toEqual([{ key: 'rows', parts: [] }, { key: 'more', parts: [] }, { key: 'plain', part: 0 }]);
    expect(parts).toHaveLength(1);
    expect(readBack(data)).toEqual(data);
  });

  it('keeps an object with no fields, and a file that holds nothing but arrays', () => {
    const data = { 'empty.json': {}, 'rows.json': { rows: [1, 2, 3] } };
    expect(readBack(data, 4)).toEqual(data);
  });

  it('keeps a value that is not an object as one value, whatever its type', () => {
    const data = { 'list.json': [1, { a: 2 }, 'x'], 'text.json': 'plain', 'number.json': 7, 'null.json': null, 'flag.json': false };
    const { index } = chunkExplorerData(data, { partChars: 3 });
    expect(Object.values(index.files).every((entry) => Number.isInteger(entry.value))).toBe(true);
    const back = readBack(data, 3);
    expect(back).toEqual(data);
    expect(Object.keys(back)).toEqual(Object.keys(data));
  });

  it('leaves out a field or a file whose value JSON does not write, as JSON does', () => {
    const data = { 'a.json': { kept: 1, gone: undefined, rows: [undefined, 2] }, 'b.json': undefined };
    expect(readBack(data, 20)).toEqual({ 'a.json': { kept: 1, rows: [null, 2] } });
  });

  it('keeps keys and fields named like Object.prototype members as own ones', () => {
    const fields = JSON.parse('{"__proto__": {"x": 1}, "constructor": [1, 2], "toString": "t"}');
    const back = readBack({ 'a.json': fields }, 12)['a.json'];
    expect(Object.keys(back)).toEqual(['__proto__', 'constructor', 'toString']);
    expect(Object.getOwnPropertyDescriptor(back, '__proto__').value).toEqual({ x: 1 });
    expect(back.constructor).toEqual([1, 2]);
  });
});

describe('the text of the page', () => {
  it('is not in the file as written, but is in the content a check looks through', () => {
    const html = pageOf({ 'a.json': { note: 'a sentence that only the data holds' } });
    expect(html).not.toContain('only the data holds');
    expect(pageContent(html)).toContain('only the data holds');
  });
});

describe('the sources', () => {
  const table = (paths) => Object.fromEntries(paths.map((path) => [path, { path, content: path.repeat(3), sizeBytes: 1, lineCount: 1 }]));

  it('are grouped by path order into parts, and the index names each path\'s part in the table\'s own order', () => {
    const paths = ['src/z.js', 'src/a.js', 'src/m.js', 'lib/b.js'];
    const { index } = chunkExplorerData({ sources: table(paths) }, { partChars: 120 });
    const entry = index.files.sources.paths;
    expect(Object.keys(entry)).toEqual(paths);
    const sorted = [...paths].sort();
    expect(sorted.map((path) => entry[path])).toEqual([...sorted.map((path) => entry[path])].sort((a, b) => a - b));
    expect(new Set(Object.values(entry)).size).toBeGreaterThan(1);
  });

  it('put a file larger than the limit in a part of its own', () => {
    const big = { path: 'big.js', content: 'q'.repeat(500), sizeBytes: 500, lineCount: 1 };
    const data = { sources: { 'a.js': { path: 'a.js', content: '1', sizeBytes: 1, lineCount: 1 }, 'big.js': big, 'c.js': { path: 'c.js', content: '2', sizeBytes: 1, lineCount: 1 } } };
    const texts = partTexts(pageOf(data, 100));
    expect(texts.filter((text) => text.length > 100).map(holdsOneMember)).toEqual([true]);
    expect(readBack(data, 100)).toEqual(data);
  });

  it('are found in the index by path, with a path that closes a script element escaped', () => {
    const odd = '</script><b>.js';
    const html = pageOf({ sources: table([odd, 'a.js']) }, 80);
    expect(blockText(html, 'xv-explorer-index')).not.toContain('<');
    expect(Object.keys(explorerIndex(html).files.sources.paths)).toEqual([odd, 'a.js']);
    expect(explorerPage(html).data.sources[odd].path).toBe(odd);
  });
});

describe('the sizes of the keys', () => {
  it('are the byte length of each key\'s JSON text, from the pieces', () => {
    const data = sample();
    data['text.json'] = `plain ${ACCENT}`;
    data['odd.json'] = { kept: 1, gone: undefined, rows: [undefined, 'x'] };
    const { keyBytes } = chunkExplorerData(data, { partChars: 50 });
    expect(Object.keys(keyBytes)).toEqual(Object.keys(data));
    for (const [key, value] of Object.entries(data)) expect(keyBytes[key]).toBe(Buffer.byteLength(JSON.stringify(value)));
  });
});

describe('a value too large for one string', () => {
  /** A value JSON.stringify cannot write: the RangeError V8 throws for a string over its limit, without allocating one. */
  const tooBig = () => ({ toJSON() { throw new RangeError('Invalid string length'); } });

  it('in a plain field is an error naming the data file and the field', () => {
    expect(() => chunkExplorerData({ 'meta.json': { fine: 1, huge: tooBig() } })).toThrow(/meta\.json field "huge"/);
  });

  it('in an array element is an error naming the data file, the field and the element', () => {
    expect(() => chunkExplorerData({ 'unused-code.json': { unused: [1, 2, tooBig()] } })).toThrow(/unused-code\.json field "unused" element 2/);
  });

  it('in a source is an error naming the source', () => {
    expect(() => chunkExplorerData({ sources: { 'src/a.js': tooBig() } })).toThrow(/sources entry "src\/a\.js"/);
  });

  it('as a whole file is an error naming the file', () => {
    expect(() => chunkExplorerData({ 'list.json': tooBig() })).toThrow(/list\.json \(the whole file\)/);
  });

  it('says the value is too large, and is raised before a page is made', () => {
    expect(() => pageOf({ 'a.json': { huge: tooBig() } })).toThrow(/too large/);
  });

  it('passes on any other error as it is', () => {
    const broken = { toJSON() { throw new TypeError('not a RangeError'); } };
    expect(() => chunkExplorerData({ 'a.json': { broken } })).toThrow(TypeError);
  });
});

describe('the pack with a tiny part limit', () => {
  let project;
  beforeAll(() => {
    project = makeGitProject({ 'src/a.js': 'export const a = 1;\n', 'src/b.js': 'export const b = 2;\n' });
    writeProduct(project.root, 'hotspots.json', hotspotsProduct(project.revision));
  });
  afterAll(() => project.cleanup());

  const pack = (partChars, out) => packProject(project.root, { explorerTemplate: templatePath, partChars, out });

  it('writes several parts, reads back what the default limit reads back, and reports the same sizes', () => {
    const roomy = pack(undefined);
    const roomyHtml = readFileSync(roomy.out, 'utf-8');
    const tiny = pack(64);
    const tinyHtml = readFileSync(tiny.out, 'utf-8');
    expect(partTexts(tinyHtml).length).toBeGreaterThan(partTexts(roomyHtml).length);
    expect(explorerPage(tinyHtml).data).toEqual(explorerPage(roomyHtml).data);
    expect(tiny.keys).toEqual(roomy.keys);
    expect(tiny.bytes).toBe(readFileSync(tiny.out).length);
  });

  it('is byte-identical when packed twice', () => {
    const first = readFileSync(pack(64).out);
    const second = readFileSync(pack(64).out);
    expect(second.equals(first)).toBe(true);
  });
});

describe('determinism', () => {
  it('gives the same bytes for the same data, parts included', () => {
    const first = assembleExplorerPage({ templatePath, data: sample(), manifest: MANIFEST, partChars: 100 });
    const second = assembleExplorerPage({ templatePath, data: sample(), manifest: MANIFEST, partChars: 100 });
    expect(second.equals(first)).toBe(true);
  });

  it('numbers the parts by the data\'s key order and then the part order', () => {
    const html = pageOf(sample(), 100);
    const ids = [...html.matchAll(/id="xv-part-(\d+)"/g)].map((match) => Number(match[1]));
    expect(ids).toEqual(ids.map((_, i) => i));
    const index = explorerIndex(html);
    const firstPartOf = (name) => {
      const entry = index.files[name];
      if ('value' in entry) return entry.value;
      if ('paths' in entry) return Math.min(...Object.values(entry.paths));
      return Math.min(...entry.fields.flatMap((f) => ('parts' in f ? f.parts : [f.part])));
    };
    const firsts = Object.keys(index.files).map(firstPartOf);
    expect(firsts).toEqual([...firsts].sort((a, b) => a - b));
  });
});
