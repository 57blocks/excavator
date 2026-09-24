// Group 2 (openspec: changes/product-serialization-ceiling, capability
// `source-index`, design D1/D2) — line-oriented persistence for the source
// index. `buildSourceIndex` itself (chunking, BM25 postings, incremental
// rebuild) is already covered by tests/retrieval/build-source-index.test.mjs;
// this file owns the READ/WRITE round trip: strict deep equality with the
// in-memory build, byte-determinism, multi-byte-boundary safety, and every
// named validation failure. Purpose-built synthetic fixtures only (AGENTS.md).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { isDeepStrictEqual } from 'node:util';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSourceIndex } from '../../skills/excavator/build-source-index.mjs';
import { bm25Search } from '../../skills/excavator/retrieve.mjs';
import {
  SOURCE_INDEX_FILE,
  LEGACY_SOURCE_INDEX_FILE,
  SOURCE_INDEX_FORMAT,
  SourceIndexFormatError,
  writeSourceIndex,
  readSourceIndex,
} from '../../skills/excavator/source-index-store.mjs';

// ---------------------------------------------------------------------------
// Fixture — two small TS files, one of whose comment carries multi-byte
// characters (CJK plus an astral emoji, i.e. a UTF-16 surrogate pair) so a
// tiny `blockSize` can prove a multi-byte UTF-8 sequence split across a read
// boundary is decoded correctly, not merely ASCII content.
// ---------------------------------------------------------------------------
const FILE_A_PATH = 'src/orderService.ts';
const FILE_B_PATH = 'src/paymentHandler.ts';

const FILE_A_CONTENT = [
  '// Creates a new order for the given user — 处理订单 😀',
  'function createOrder(userId, items) {',
  '  const note = "order created for user";',
  '  return { userId, items, note };',
  '}',
  '',
  'class OrderService {',
  '  /* Handles order persistence */',
  '  save(order) {',
  '    return order;',
  '  }',
  '}',
].join('\n');

const FILE_B_CONTENT = [
  '// Handles payment retries',
  'function retryPayment(paymentId) {',
  '  return paymentId;',
  '}',
].join('\n');

function buildFixtureIndex() {
  const scan = {
    files: [
      { path: FILE_A_PATH, language: 'typescript' },
      { path: FILE_B_PATH, language: 'typescript' },
    ],
  };
  const structureAll = {
    results: [
      {
        path: FILE_A_PATH, language: 'typescript', fileCategory: 'code',
        totalLines: 12, nonEmptyLines: 11, status: 'parsed',
        functions: [{ name: 'createOrder', owner: '', startLine: 1, endLine: 5, params: ['userId', 'items'] }],
        classes: [{ name: 'OrderService', startLine: 7, endLine: 12, methods: ['save'], properties: [] }],
        metrics: {},
      },
      {
        path: FILE_B_PATH, language: 'typescript', fileCategory: 'code',
        totalLines: 4, nonEmptyLines: 4, status: 'parsed',
        functions: [{ name: 'retryPayment', owner: '', startLine: 1, endLine: 3, params: ['paymentId'] }],
        metrics: {},
      },
    ],
  };
  const contents = { [FILE_A_PATH]: FILE_A_CONTENT, [FILE_B_PATH]: FILE_B_CONTENT };
  const readFile = (p) => contents[p];
  return buildSourceIndex({ scan, structureAll, readFile, sourceRevision: 'rev-store-test' });
}

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'source-index-store-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------
// Constants — the on-disk contract this module names.
// ---------------------------------------------------------------------------
describe('exported constants', () => {
  it('names the current and legacy file, and the header format tag', () => {
    expect(SOURCE_INDEX_FILE).toBe('source-index.jsonl');
    expect(LEGACY_SOURCE_INDEX_FILE).toBe('source-index.json');
    expect(SOURCE_INDEX_FORMAT).toBe('excavator-source-index-lines/1');
  });
});

// ---------------------------------------------------------------------------
// Round trip — Requirement "持久化不受单字符串上限约束且往返无损".
// ---------------------------------------------------------------------------
describe('writeSourceIndex + readSourceIndex — lossless round trip', () => {
  it('the comparator sees a known one-field difference BEFORE we trust it on the real pair', () => {
    const index = buildFixtureIndex();
    const path = join(dir, SOURCE_INDEX_FILE);
    writeSourceIndex(path, index);
    const back = readSourceIndex(path);

    // Instrument check (verify-the-instrument-first): prove isDeepStrictEqual
    // actually detects a difference on this exact shape before relying on it
    // to prove equality below.
    const mutated = structuredClone(back);
    mutated.chunks[0] = { ...mutated.chunks[0], symbol: `${mutated.chunks[0].symbol}#mutated` };
    expect(isDeepStrictEqual(mutated, index)).toBe(false);

    expect(isDeepStrictEqual(back, index)).toBe(true);
  });

  it('reconstructs the exact in-memory shape: postings a plain sorted-key object, docLengths null-prototype', () => {
    const index = buildFixtureIndex();
    const path = join(dir, SOURCE_INDEX_FILE);
    writeSourceIndex(path, index);
    const back = readSourceIndex(path);

    expect(Object.getPrototypeOf(back.postings)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(back.docLengths)).toBeNull();
    expect(Object.keys(back.postings)).toEqual(Object.keys(index.postings)); // already sorted by the writer
    for (const term of Object.keys(index.postings)) {
      expect(back.postings[term]).toEqual(index.postings[term]);
      for (const entry of back.postings[term]) expect(Object.keys(entry).sort()).toEqual(['chunkId', 'tf']);
    }
  });

  it('carries a chunk whose text includes CJK characters and an astral emoji (surrogate pair) losslessly', () => {
    const index = buildFixtureIndex();
    const path = join(dir, SOURCE_INDEX_FILE);
    writeSourceIndex(path, index);
    const back = readSourceIndex(path);
    const fileChunk = back.chunks.find((c) => c.path === FILE_A_PATH && c.symbol === null);
    expect(fileChunk.comments.join(' ')).toContain('处理订单');
    expect(fileChunk.comments.join(' ')).toContain('😀');
  });

  it('a tiny read blockSize (splitting multi-byte characters across block boundaries) still round-trips exactly', () => {
    const index = buildFixtureIndex();
    const path = join(dir, SOURCE_INDEX_FILE);
    writeSourceIndex(path, index);
    for (const blockSize of [1, 2, 3, 5, 8, 16, 64]) {
      const back = readSourceIndex(path, { blockSize });
      expect(isDeepStrictEqual(back, index)).toBe(true);
    }
  });

  it('writing the same index twice produces byte-identical output (deterministic)', () => {
    const index = buildFixtureIndex();
    const pathA = join(dir, 'a.jsonl');
    const pathB = join(dir, 'b.jsonl');
    writeSourceIndex(pathA, index);
    writeSourceIndex(pathB, index);
    expect(readFileSync(pathA)).toEqual(readFileSync(pathB));
  });

  it('returns {bytes, lines, maxLineChars} matching the file actually written', () => {
    const index = buildFixtureIndex();
    const path = join(dir, SOURCE_INDEX_FILE);
    const stats = writeSourceIndex(path, index);
    const onDisk = readFileSync(path, 'utf-8');
    expect(stats.bytes).toBe(Buffer.byteLength(onDisk, 'utf-8'));
    expect(stats.lines).toBe(onDisk.split('\n').filter((l) => l.length > 0).length);
    const longestLine = Math.max(...onDisk.split('\n').filter((l) => l.length > 0).map((l) => l.length));
    expect(stats.maxLineChars).toBe(longestLine);
  });
});

// ---------------------------------------------------------------------------
// BM25 equivalence — Requirement "持久化不受单字符串上限约束且往返无损": the read-back
// index must be strictly deep-equal to the built one, so the same query
// terms' BM25 results are identical either way (task 2.2).
// ---------------------------------------------------------------------------
describe('bm25Search — identical results against the built index and the round-tripped index', () => {
  it('for a fixed set of query terms, scores/chunkIds/order all match exactly', () => {
    const index = buildFixtureIndex();
    const path = join(dir, SOURCE_INDEX_FILE);
    writeSourceIndex(path, index);
    const back = readSourceIndex(path);

    for (const terms of [['order'], ['payment'], ['order', 'payment'], ['createOrder'], ['retryPayment'], ['nonexistentTerm']]) {
      const fromBuilt = bm25Search(index, terms, 20);
      const fromRead = bm25Search(back, terms, 20);
      expect(fromRead).toEqual(fromBuilt);
    }
  });
});

// ---------------------------------------------------------------------------
// Named failures — Requirement "持久化不受单字符串上限约束且往返无损": reading SHALL
// validate the header, record counts and ordinal ranges; a validation
// failure SHALL surface as a visible invalid-product gap (design D2). Each
// case corrupts one well-formed file and asserts a `SourceIndexFormatError`,
// never a partial index.
// ---------------------------------------------------------------------------
describe('readSourceIndex — named format failures, never a partial index', () => {
  let validPath;
  beforeEach(() => {
    validPath = join(dir, SOURCE_INDEX_FILE);
    writeSourceIndex(validPath, buildFixtureIndex());
  });

  /** Read the valid fixture file's lines, apply `mutate`, write the result to
   *  a fresh path, and return that path — the original valid file is left
   *  untouched for other assertions in the same test. */
  function corrupted(mutate) {
    const lines = readFileSync(validPath, 'utf-8').split('\n');
    mutate(lines);
    const path = join(dir, `corrupt-${Math.random().toString(36).slice(2)}.jsonl`);
    writeFileSync(path, lines.join('\n'));
    return path;
  }

  /** Mutate the first line whose parsed record satisfies `matches`. */
  function mutateFirstRecord(lines, matches, mutate) {
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]) continue;
      const record = JSON.parse(lines[i]);
      if (matches(record)) {
        mutate(record);
        lines[i] = JSON.stringify(record);
        return true;
      }
    }
    throw new Error('no matching record found in fixture — test setup is wrong');
  }

  /** Mutate the LAST line whose parsed record satisfies `matches` — used to
   *  create a duplicate/out-of-order id or term without changing the total
   *  record count (so the count-mismatch checks stay silent and the
   *  strictly-increasing-order check is what actually catches it). */
  function mutateLastRecord(lines, matches, mutate) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i]) continue;
      const record = JSON.parse(lines[i]);
      if (matches(record)) {
        mutate(record);
        lines[i] = JSON.stringify(record);
        return true;
      }
    }
    throw new Error('no matching record found in fixture — test setup is wrong');
  }

  function allRecordsOf(lines, kind) {
    return lines.filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.record === kind);
  }

  it('an empty file has no header at all', () => {
    const path = corrupted((lines) => { lines.length = 0; });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('a missing header (first line is not a header record)', () => {
    const path = corrupted((lines) => { lines.shift(); });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('a header with the wrong format tag', () => {
    const path = corrupted((lines) => {
      mutateFirstRecord(lines, (r) => r.record === 'header', (r) => { r.format = 'some-other-format/1'; });
    });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('a second header record after line 1', () => {
    const path = corrupted((lines) => {
      const header = JSON.parse(lines[0]);
      lines.splice(1, 0, JSON.stringify(header));
    });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('chunk count does not match the header\'s declared chunkCount', () => {
    const path = corrupted((lines) => {
      mutateFirstRecord(lines, (r) => r.record === 'header', (r) => { r.chunkCount += 1; });
    });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('filesIndexed count does not match the header\'s declared filesIndexedCount', () => {
    const path = corrupted((lines) => {
      mutateFirstRecord(lines, (r) => r.record === 'header', (r) => { r.filesIndexedCount += 1; });
    });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('term count does not match the header\'s declared termCount', () => {
    const path = corrupted((lines) => {
      mutateFirstRecord(lines, (r) => r.record === 'header', (r) => { r.termCount += 1; });
    });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('a posting\'s chunks/tf arrays have different lengths', () => {
    const path = corrupted((lines) => {
      mutateFirstRecord(lines, (r) => r.record === 'posting', (r) => { r.tf.push(1); });
    });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('a posting ordinal is out of range ([0, chunkCount))', () => {
    const path = corrupted((lines) => {
      mutateFirstRecord(lines, (r) => r.record === 'posting', (r) => { r.chunks[0] = 999_999; });
    });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('a posting\'s ordinals are not strictly increasing', () => {
    const path = corrupted((lines) => {
      mutateFirstRecord(lines, (r) => r.record === 'posting' && r.chunks.length >= 2, (r) => {
        [r.chunks[0], r.chunks[1]] = [r.chunks[1], r.chunks[0]];
      });
    });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('a duplicated ordinal (not strictly increasing) in a single-posting term', () => {
    const path = corrupted((lines) => {
      mutateFirstRecord(lines, (r) => r.record === 'posting', (r) => {
        r.chunks.push(r.chunks[0]);
        r.tf.push(r.tf[0]);
      });
    });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('an unrecognized record type', () => {
    const path = corrupted((lines) => { lines.splice(1, 0, JSON.stringify({ record: 'mystery' })); });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('invalid JSON on a non-header line', () => {
    const path = corrupted((lines) => { lines.splice(1, 0, '{not valid json'); });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  // F2 fixes (batch A acceptance): a corrupted file that keeps every DECLARED
  // count correct but silently duplicates a chunk id, duplicates a posting
  // term, or carries an invalid docLength/path must still be rejected — not
  // merged into a subtly-wrong index that happens to pass the count checks.
  it('a duplicated chunk id (chunk ids not strictly increasing across the file)', () => {
    const path = corrupted((lines) => {
      const chunkRecords = allRecordsOf(lines, 'chunk');
      expect(chunkRecords.length).toBeGreaterThanOrEqual(2); // fixture sanity
      const firstId = chunkRecords[0].chunk.id;
      mutateLastRecord(lines, (r) => r.record === 'chunk', (r) => { r.chunk = { ...r.chunk, id: firstId }; });
    });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('a duplicated posting term (terms not strictly increasing across the file)', () => {
    const path = corrupted((lines) => {
      const postingRecords = allRecordsOf(lines, 'posting');
      expect(postingRecords.length).toBeGreaterThanOrEqual(2); // fixture sanity
      const firstTerm = postingRecords[0].term;
      mutateLastRecord(lines, (r) => r.record === 'posting', (r) => { r.term = firstTerm; });
    });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('a chunk record with a negative docLength', () => {
    const path = corrupted((lines) => {
      mutateFirstRecord(lines, (r) => r.record === 'chunk', (r) => { r.docLength = -1; });
    });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('a chunk record with a non-integer docLength', () => {
    const path = corrupted((lines) => {
      mutateFirstRecord(lines, (r) => r.record === 'chunk', (r) => { r.docLength = 'not-a-number'; });
    });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('a file-indexed record whose path is not a string', () => {
    const path = corrupted((lines) => {
      mutateFirstRecord(lines, (r) => r.record === 'file-indexed', (r) => { r.path = 42; });
    });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('a file-content-unavailable record whose path is not a string', () => {
    const path = corrupted((lines) => {
      // The base fixture never has a content-unavailable file, so add one —
      // still keeping the header's filesContentUnavailableCount in sync.
      mutateFirstRecord(lines, (r) => r.record === 'header', (r) => { r.filesContentUnavailableCount += 1; });
      lines.splice(1, 0, JSON.stringify({ record: 'file-content-unavailable', path: null }));
    });
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('a truncated file (cut off mid-line, no trailing newline) still fails loudly rather than returning a partial index', () => {
    const raw = readFileSync(validPath, 'utf-8');
    const path = join(dir, 'truncated.jsonl');
    writeFileSync(path, raw.slice(0, Math.floor(raw.length / 2)));
    expect(() => readSourceIndex(path)).toThrow(SourceIndexFormatError);
  });

  it('the valid fixture file itself still reads cleanly (corruption helpers are not silently breaking every file)', () => {
    expect(() => readSourceIndex(validPath)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// F2(c) fix (batch A acceptance): a crafted posting term literally named
// "__proto__" must become a safe OWN property of `postings`, never mutate
// the object's actual prototype. `buildSourceIndex` itself can never produce
// this term (splitIdentifier tokenizes on non-alnum runs, so the two leading
// and trailing underscores are boundaries — "__proto__".split on that
// pattern yields only "proto" — verified before writing this test), so this
// is a hand-crafted file: the only way this term can appear at all is a
// corrupted/adversarial `.jsonl`, exactly the reader's threat model.
// ---------------------------------------------------------------------------
describe('readSourceIndex — a crafted "__proto__" posting term is prototype-pollution-safe', () => {
  it('becomes an own property; Object.getPrototypeOf(postings) stays Object.prototype', () => {
    const path = join(dir, 'crafted-proto.jsonl');
    const lines = [
      { record: 'header', format: SOURCE_INDEX_FORMAT, sourceRevision: 'rev-crafted', k1: 1.5, b: 0.75,
        N: 1, avgDocLength: 1, chunkCount: 1, termCount: 1, filesIndexedCount: 1, filesContentUnavailableCount: 0 },
      { record: 'file-indexed', path: 'src/a.ts' },
      { record: 'chunk', docLength: 1, chunk: { id: 'chunk:a', path: 'src/a.ts', symbol: 'a', owner: null, type: 'function', lineRange: [1, 1], identifiers: [], comments: [], strings: [], contentAvailable: true } },
      { record: 'posting', term: '__proto__', chunks: [0], tf: [1] },
    ].map((r) => JSON.stringify(r));
    writeFileSync(path, lines.join('\n') + '\n');

    const index = readSourceIndex(path);

    expect(Object.getPrototypeOf(index.postings)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(index.postings, '__proto__')).toBe(true);
    expect(index.postings['__proto__']).toEqual([{ chunkId: 'chunk:a', tf: 1 }]);
    expect(index.postings.__proto__).toEqual([{ chunkId: 'chunk:a', tf: 1 }]); // dot access also sees the own property, not the accessor
    // A fresh, unrelated plain object is unaffected — global Object.prototype was never touched.
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});
