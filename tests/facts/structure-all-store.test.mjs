// openspec: changes/knowledge-graph-line-store, design D4 — line-oriented
// persistence for the structure extraction result. Round trip, key order,
// block boundaries, the per-record limit, and every named format failure.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { isDeepStrictEqual } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  STRUCTURE_ALL_FILE,
  LEGACY_STRUCTURE_ALL_FILE,
  STRUCTURE_ALL_FORMAT,
  StructureAllFormatError,
  writeStructureAll,
  readStructureAll,
  readStructureAllPath,
} from '../../skills/excavator/structure-all-store.mjs';
import { ProductTooLargeError } from '../../skills/excavator/product-serialization.mjs';

function output() {
  return {
    scriptCompleted: true,
    chunkSize: 50,
    filesRequested: 2,
    filesAnalyzed: 2,
    filesOutOfScope: [],
    filesSkipped: [],
    analysisOutcomes: { structure: { succeeded: 2 }, callGraph: { succeeded: 1 } },
    byStatus: { parsed: 2 },
    results: [
      { path: 'src/a.ts', language: 'typescript', status: 'parsed', functions: [{ name: 'run', startLine: 1, endLine: 3, params: [] }],
        callGraph: [{ caller: 'run', callee: 'helper', lineNumber: 2 }] },
      // CJK plus an astral emoji, so tiny read blocks split a multi-byte sequence.
      { path: 'src/处理订单😀.ts', language: 'typescript', status: 'parsed', functions: [] },
    ],
  };
}

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'structure-all-store-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('structure-all store', () => {
  it('names the current and legacy files and the format tag', () => {
    expect(STRUCTURE_ALL_FILE).toBe('structure-all.jsonl');
    expect(LEGACY_STRUCTURE_ALL_FILE).toBe('structure-all.json');
    expect(STRUCTURE_ALL_FORMAT).toBe('excavator-structure-all-lines/1');
  });

  it('reads back strictly deep-equal with the same key order, at any block size, and reports the longest line', () => {
    const path = join(dir, STRUCTURE_ALL_FILE);
    const written = writeStructureAll(path, output());
    for (const blockSize of [1, 3, 7, 4096]) {
      const stats = {};
      const read = readStructureAll(path, { blockSize, stats });
      expect(isDeepStrictEqual(read, output())).toBe(true);
      expect(Object.keys(read)).toEqual(Object.keys(output()));
      expect(stats.maxLineChars).toBe(written.maxLineChars);
    }
    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toMatchObject({ record: 'header', format: STRUCTURE_ALL_FORMAT, resultCount: 2 });
  });

  it('writes byte-identically twice, and re-writes a read result byte-identically', () => {
    const a = join(dir, 'a.jsonl');
    const b = join(dir, 'b.jsonl');
    writeStructureAll(a, output());
    writeStructureAll(b, readStructureAll(a));
    expect(readFileSync(b).equals(readFileSync(a))).toBe(true);
  });

  it('fails a single over-limit record as a named ProductTooLargeError, while a large result of small records fits', () => {
    const big = output();
    for (let i = 0; i < 100; i += 1) big.results.push({ path: `src/f${i}.ts`, status: 'parsed' });
    expect(JSON.stringify(big).length).toBeGreaterThan(1_000);
    expect(() => writeStructureAll(join(dir, 'ok.jsonl'), big, { limit: 1_000 })).not.toThrow();
    const huge = output();
    huge.results[0].note = 'x'.repeat(2_000);
    expect(() => writeStructureAll(join(dir, 'huge.jsonl'), huge, { limit: 1_000 })).toThrow(ProductTooLargeError);
  });

  it('readStructureAllPath reads .jsonl through the store and any other path as one JSON document', () => {
    const lines = join(dir, STRUCTURE_ALL_FILE);
    const json = join(dir, 'fixture.json');
    writeStructureAll(lines, output());
    writeFileSync(json, JSON.stringify(output()));
    expect(readStructureAllPath(lines)).toEqual(output());
    expect(readStructureAllPath(json)).toEqual(output());
  });

  describe('named format failures', () => {
    function written() {
      const path = join(dir, STRUCTURE_ALL_FILE);
      writeStructureAll(path, output());
      return { path, lines: readFileSync(path, 'utf-8').split('\n').filter(Boolean) };
    }
    const save = (path, lines) => writeFileSync(path, lines.join('\n') + '\n');
    const expectError = (path, pattern) => {
      expect(() => readStructureAll(path)).toThrow(StructureAllFormatError);
      expect(() => readStructureAll(path)).toThrow(pattern);
    };

    it('an empty file', () => {
      const path = join(dir, STRUCTURE_ALL_FILE);
      writeFileSync(path, '');
      expectError(path, /missing header/);
    });
    it('a first line that is not the header', () => {
      const { path, lines } = written();
      save(path, lines.slice(1));
      expectError(path, /first line to be a header/);
    });
    it('a truncated file (fewer results than declared)', () => {
      const { path, lines } = written();
      save(path, lines.slice(0, 2));
      expectError(path, /result count mismatch/);
    });
    it('a second header', () => {
      const { path, lines } = written();
      save(path, [...lines, lines[0]]);
      expectError(path, /second header/);
    });
    it('an unknown record type', () => {
      const { path, lines } = written();
      save(path, [...lines, '{"record":"node","node":{}}']);
      expectError(path, /unknown record type/);
    });
    it('a header missing a listed field', () => {
      const { path, lines } = written();
      const header = JSON.parse(lines[0]);
      delete header.fields.chunkSize;
      save(path, [JSON.stringify(header), ...lines.slice(1)]);
      expectError(path, /carries no value/);
    });
  });
});
