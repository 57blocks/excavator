// artifact-view tasks 2.1-2.3: the excavator-view-bundle/1 codec. One file
// encodes (bake script) and decodes (bake self-check and the page), so these
// round trips run the exact decoder the browser runs.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BUNDLE_FORMAT,
  BundleDecodeError,
  BundleFormatError,
  CELL_ABSENT,
  CELL_NULL,
  Int32Builder,
  Interner,
  cellValue,
  decodeBundle,
  decodeSegments,
  encodeBundle,
  isTable,
  table,
} from '../../skills/excavator-view/bundle-codec.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const codecPath = join(repoRoot, 'skills/excavator-view/bundle-codec.mjs');

const EDGE_TYPES = ['contains', 'imports', 'exports', 'calls', 'inherits', 'implements', 'mentions', 'references', 'injects'];

/** A synthetic graph-shaped bundle: every edge type, every evidence field,
 *  null/absent/non-string cells, and JSON segments. */
function fullFixture() {
  const interner = new Interner();
  const nodeIds = ['file:src/a.ts', 'function:src/a.ts:run', 'class:src/b.ts:Helper', 'file:src/b.ts'];
  const nodes = {
    id: new Int32Builder(), type: new Int32Builder(), name: new Int32Builder(), path: new Int32Builder(),
    line0: new Int32Builder(), line1: new Int32Builder(), owner: new Int32Builder(),
  };
  nodeIds.forEach((id, i) => {
    nodes.id.push(interner.cell(id));
    nodes.type.push(interner.cell(id.split(':')[0]));
    nodes.name.push(interner.cell(id.split(':').at(-1)));
    nodes.path.push(interner.cell(id.split(':')[1]));
    nodes.line0.push(i === 0 ? -1 : i + 1);
    nodes.line1.push(i === 0 ? -1 : i + 4);
    nodes.owner.push(i === 2 ? interner.cell('function:src/a.ts:run') : interner.cell(undefined));
  });
  const edges = { src: new Int32Builder(), dst: new Int32Builder(), type: new Int32Builder(), weight: new Int32Builder(), evCount: new Int32Builder(), evOffset: new Int32Builder() };
  const evidence = {
    file: new Int32Builder(), line: new Int32Builder(), endLine: new Int32Builder(), source: new Int32Builder(),
    token: new Int32Builder(), context: new Int32Builder(), resolution: new Int32Builder(),
  };
  EDGE_TYPES.forEach((type, i) => {
    edges.src.push(interner.cell(nodeIds[i % 4]));
    edges.dst.push(interner.cell(nodeIds[(i + 1) % 4]));
    edges.type.push(interner.cell(type));
    edges.weight.push(interner.cell([0.5, 0.7, 1][i % 3]));
    edges.evCount.push(2);
    edges.evOffset.push(evidence.file.length);
    for (let k = 0; k < 2; k += 1) {
      evidence.file.push(interner.cell('src/a.ts'));
      evidence.line.push(10 + i);
      evidence.endLine.push(k === 0 ? -1 : 20 + i);
      evidence.source.push(interner.cell('tree-sitter'));
      evidence.token.push(k === 0 ? interner.cell(undefined) : interner.cell(`tok-${type}`));
      evidence.context.push(k === 0 ? interner.cell(null) : interner.cell({ attribute: 'ref', depth: 2 }));
      evidence.resolution.push(interner.cell(k === 0 ? undefined : 'relative'));
    }
  });
  const finish = (cols) => Object.fromEntries(Object.entries(cols).map(([k, b]) => [k, b.finish()]));
  return {
    meta: { format: BUNDLE_FORMAT, project: { name: 'synthetic' }, counts: { nodes: 4, edges: EDGE_TYPES.length } },
    strings: interner.strings,
    values: interner.values(),
    nodes: table(nodeIds.length, finish(nodes)),
    edges: table(EDGE_TYPES.length, finish(edges)),
    evidence: table(EDGE_TYPES.length * 2, finish(evidence)),
    coverage: { files: 2, byLanguage: { typescript: { files: 2, parsed: 2 } } },
    gaps: [{ kind: 'unsupported-language', scope: 'file', samples: ['x.zz'] }],
    'evidenceText.strings': ['  run();', 'ünïcödé — 漢字 ✓'],
  };
}

/** Parse the segment header lines of an encoded payload. */
function headerLines(lines) {
  return lines.slice(1).filter((_, i) => i % 2 === 0).map((line) => line.split(' '));
}

describe('bundle codec: encode', () => {
  it('writes the format line first and one header + payload line per segment', async () => {
    const { lines, segments } = await encodeBundle(fullFixture());
    expect(lines[0]).toBe(BUNDLE_FORMAT);
    expect(lines.length).toBe(1 + 2 * Object.keys(fullFixture()).length);
    expect(segments.map((s) => s.name)).toEqual(Object.keys(fullFixture()));
    for (const line of lines) expect(line).not.toContain('<');
  });

  it("records each segment's raw byte count exactly", async () => {
    const fixture = fullFixture();
    const { lines } = await encodeBundle(fixture, { compress: false });
    for (const [tag, kind, rawBytes, storedBytes, codec] of headerLines(lines)) {
      const value = fixture[tag.slice(1)];
      const expected = kind === 'i32'
        ? value.rows * Object.keys(value.columns).length * 4
        : Buffer.byteLength(JSON.stringify(value), 'utf-8');
      expect(Number(rawBytes), tag).toBe(expected);
      expect(storedBytes).toBe(rawBytes);
      expect(codec).toBe('raw');
    }
  });

  it('rejects a table whose columns disagree with its row count', async () => {
    await expect(encodeBundle({ nodes: table(3, { id: new Int32Array(2) }) })).rejects.toThrow(BundleFormatError);
  });

  it('interns strings once and keeps null, absent and non-string values distinguishable', () => {
    const interner = new Interner();
    const cells = ['a', 'b', 'a', null, undefined, 0.5, { k: 1 }, 0.5].map((v) => interner.cell(v));
    expect(cells[0]).toBe(cells[2]);
    expect(cells[3]).toBe(CELL_NULL);
    expect(cells[4]).toBe(CELL_ABSENT);
    expect(cells[5]).toBe(cells[7]);
    expect(interner.strings).toEqual(['a', 'b']);
    const values = interner.values();
    expect(cells.map((c) => cellValue(c, interner.strings, values))).toEqual(['a', 'b', 'a', null, undefined, 0.5, { k: 1 }, 0.5]);
  });

  it('grows an Int32 column past its initial capacity', () => {
    const builder = new Int32Builder(16);
    for (let i = 0; i < 1000; i += 1) builder.push(i * 3);
    const out = builder.finish();
    expect(out.length).toBe(1000);
    expect(out[999]).toBe(2997);
  });
});

describe('bundle codec: decode round trip', () => {
  it.each([
    ['empty bundle', {}],
    ['single node', { strings: ['file:a.ts'], nodes: table(1, { id: Int32Array.of(0), line0: Int32Array.of(-1) }) }],
    ['zero-row table', { nodes: table(0, { id: new Int32Array(0) }), gaps: [] }],
    ['full fixture', fullFixture()],
  ])('%s decodes to the encoded segments (gzip and raw)', async (_label, fixture) => {
    const gz = await decodeBundle((await encodeBundle(fixture)).lines);
    const raw = await decodeBundle((await encodeBundle(fixture, { compress: false })).lines);
    expect(gz.segments).toEqual(fixture);
    expect(raw.segments).toEqual(fixture);
    expect(Object.keys(gz.segments)).toEqual(Object.keys(fixture));
    for (const [name, value] of Object.entries(fixture)) {
      if (isTable(value)) {
        for (const [col, data] of Object.entries(value.columns)) {
          expect(gz.segments[name].columns[col]).toBeInstanceOf(Int32Array);
          expect(Array.from(gz.segments[name].columns[col]), `${name}.${col}`).toEqual(Array.from(data));
        }
      }
    }
  });

  it('decodes the page form (one string, surrounding blank lines) the same as the line array', async () => {
    const { lines } = await encodeBundle(fullFixture());
    const fromPage = await decodeBundle(`\n${lines.join('\n')}\n`);
    expect(fromPage.segments).toEqual(fullFixture());
  });

  it('keeps an empty raw payload line in place', async () => {
    const fixture = { nodes: table(0, { id: new Int32Array(0) }), gaps: [{ kind: 'x' }] };
    const { lines } = await encodeBundle(fixture, { compress: false });
    expect(lines[2]).toBe('');
    expect((await decodeBundle(`${lines.join('\n')}\n`)).segments).toEqual(fixture);
  });
});

describe('bundle codec: segment-at-a-time decode (4A.6)', () => {
  it('yields every segment in order, equal to decodeBundle, one at a time', async () => {
    for (const compress of [true, false]) {
      const { lines } = await encodeBundle(fullFixture(), { compress });
      const seen = [];
      for await (const segment of decodeSegments(lines)) seen.push([segment.name, segment.value, segment.rawBytes]);
      const whole = await decodeBundle(lines);
      expect(seen.map(([name]) => name)).toEqual(Object.keys(whole.segments));
      expect(Object.fromEntries(seen.map(([name, value]) => [name, value]))).toEqual(whole.segments);
      expect(seen.map(([, , raw]) => raw)).toEqual(whole.sizes.map((s) => s.rawBytes));
    }
  });

  it('fails like decodeBundle on a version mismatch, a truncated payload and a duplicate segment', async () => {
    const drain = async (payload) => {
      for await (const _segment of decodeSegments(payload)) { /* consume */ }
    };
    const { lines } = await encodeBundle(fullFixture());
    await expect(drain(['excavator-view-bundle/9'])).rejects.toThrow(BundleFormatError);
    await expect(drain(lines.slice(0, -1))).rejects.toThrow(/segment header without a payload line/);
    const truncated = [...lines];
    truncated[2] = truncated[2].slice(0, 8);
    await expect(drain(truncated)).rejects.toThrow(BundleFormatError);
    await expect(drain([lines[0], lines[1], lines[2], lines[1], lines[2]])).rejects.toThrow(/duplicate segment/);
  });
});

describe('bundle codec: named failures', () => {
  it('rejects an unknown format version with BundleFormatError', async () => {
    const { lines } = await encodeBundle(fullFixture());
    const future = ['excavator-view-bundle/2', ...lines.slice(1)];
    await expect(decodeBundle(future)).rejects.toThrow(BundleFormatError);
    await expect(decodeBundle(future)).rejects.toThrow(/unsupported view bundle version/);
  });

  it('rejects a truncated payload', async () => {
    const { lines } = await encodeBundle(fullFixture());
    const cut = [...lines];
    cut[4] = cut[4].slice(0, Math.floor(cut[4].length / 2));
    await expect(decodeBundle(cut)).rejects.toThrow(BundleFormatError);
    await expect(decodeBundle(lines.slice(0, -1))).rejects.toThrow(BundleFormatError);
  });

  it('rejects a header whose sizes disagree with its table shape', async () => {
    const { lines } = await encodeBundle({ nodes: table(2, { id: Int32Array.of(1, 2) }) }, { compress: false });
    const bad = [...lines];
    bad[1] = bad[1].replace(' 2 id', ' 3 id');
    await expect(decodeBundle(bad)).rejects.toThrow(/do not match/);
  });

  it('fails with BundleDecodeError when compressed data meets no DecompressionStream', async () => {
    const { lines } = await encodeBundle(fullFixture());
    const original = globalThis.DecompressionStream;
    globalThis.DecompressionStream = undefined;
    try {
      await expect(decodeBundle(lines)).rejects.toThrow(BundleDecodeError);
      await expect(decodeBundle(lines)).rejects.toThrow(/--raw/);
      const raw = await encodeBundle(fullFixture(), { compress: false });
      expect((await decodeBundle(raw.lines)).segments).toEqual(fullFixture());
    } finally {
      globalThis.DecompressionStream = original;
    }
  });
});

describe('bundle codec: browser-safe decode path', () => {
  it('has no static node: import (only the encoder loads node:zlib dynamically)', () => {
    const source = readFileSync(codecPath, 'utf-8');
    expect(source).not.toMatch(/^\s*import\s[^;]*?from\s+['"]node:/m);
    expect(source).not.toMatch(/^\s*import\s+['"]node:/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
    const dynamic = [...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    expect(dynamic).toEqual(['node:zlib']);
  });
});
