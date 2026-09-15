// Group 2 — source-index contract (openspec: changes/hybrid-retrieval,
// specs/source-index/spec.md). Chunk source is reused from structure-all
// (see extract-structure-result.mjs's buildResult() row shape) — these
// fixtures are small, synthetic, in-memory structureAll-shaped rows, matching
// the convention tests/facts/build-fact-graph.test.mjs already uses. No CLI
// process is spawned and no model is called; `readFile` is injected so the
// whole suite runs on in-memory content.
import { describe, expect, it } from 'vitest';
import {
  buildSourceIndex,
  updateSourceIndex,
  splitIdentifier,
  extractCommentsAndStrings,
} from '../../skills/excavator/build-source-index.mjs';
import { bm25Search } from '../../skills/excavator/retrieve.mjs';

// ---------------------------------------------------------------------------
// Fixture: two small TS files. File A has a function (with a leading line
// comment inside its lineRange) and a class (with a block comment inside its
// lineRange) whose identifiers all revolve around "order"; File B has one
// function about "payment" — a weak/unrelated match for an "order" query.
// ---------------------------------------------------------------------------
const FILE_A_PATH = 'src/orderService.ts';
const FILE_B_PATH = 'src/paymentHandler.ts';

const FILE_A_CONTENT = [
  '// Creates a new order for the given user',
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

function baseFixture() {
  const scan = {
    files: [
      { path: FILE_A_PATH, language: 'typescript', sizeLines: 12, fileCategory: 'code' },
      { path: FILE_B_PATH, language: 'typescript', sizeLines: 4, fileCategory: 'code' },
    ],
  };

  const structureAll = {
    results: [
      {
        path: FILE_A_PATH, language: 'typescript', fileCategory: 'code',
        totalLines: 12, nonEmptyLines: 11, status: 'parsed',
        functions: [
          { name: 'createOrder', owner: '', startLine: 1, endLine: 5, params: ['userId', 'items'] },
        ],
        classes: [
          { name: 'OrderService', startLine: 7, endLine: 12, methods: ['save'], properties: [] },
        ],
        metrics: {},
      },
      {
        path: FILE_B_PATH, language: 'typescript', fileCategory: 'code',
        totalLines: 4, nonEmptyLines: 4, status: 'parsed',
        functions: [
          { name: 'retryPayment', owner: '', startLine: 1, endLine: 3, params: ['paymentId'] },
        ],
        metrics: {},
      },
    ],
  };

  const contents = { [FILE_A_PATH]: FILE_A_CONTENT, [FILE_B_PATH]: FILE_B_CONTENT };
  const readFile = (path) => contents[path];

  return { scan, structureAll, readFile, contents };
}

// ---------------------------------------------------------------------------
// splitIdentifier — subword tokenizer used for chunk identifiers.
// ---------------------------------------------------------------------------
describe('splitIdentifier', () => {
  it('splits camelCase into lowercase subwords', () => {
    expect(splitIdentifier('createOrder')).toEqual(['create', 'order']);
  });

  it('splits snake_case into lowercase subwords', () => {
    expect(splitIdentifier('user_id')).toEqual(['user', 'id']);
  });

  it('splits an acronym run before a new capitalized word', () => {
    expect(splitIdentifier('HTTPServer')).toEqual(['http', 'server']);
  });

  it('splits free text with embedded punctuation (e.g. a param signature)', () => {
    expect(splitIdentifier('userId: string')).toEqual(['user', 'id', 'string']);
  });

  it('returns an empty array for empty/non-string input', () => {
    expect(splitIdentifier('')).toEqual([]);
    expect(splitIdentifier(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractCommentsAndStrings — heuristic text-scan over a chunk's own source
// lines (not a language parser; best-effort recall aid).
// ---------------------------------------------------------------------------
describe('extractCommentsAndStrings', () => {
  it('extracts a leading line comment', () => {
    const { comments } = extractCommentsAndStrings(FILE_A_CONTENT.split('\n').slice(0, 5).join('\n'));
    expect(comments).toContain('Creates a new order for the given user');
  });

  it('extracts a block comment', () => {
    const { comments } = extractCommentsAndStrings(FILE_A_CONTENT.split('\n').slice(6, 12).join('\n'));
    expect(comments).toContain('Handles order persistence');
  });

  it('extracts a string literal', () => {
    const { strings } = extractCommentsAndStrings(FILE_A_CONTENT.split('\n').slice(0, 5).join('\n'));
    expect(strings).toContain('order created for user');
  });
});

// ---------------------------------------------------------------------------
// chunk shape — Requirement "symbol-aware source chunk shape".
// ---------------------------------------------------------------------------
describe('buildSourceIndex — chunk shape', () => {
  it('a function chunk carries path/owner/symbol/lineRange, identifier subwords, comments and strings', () => {
    const { scan, structureAll, readFile } = baseFixture();
    const index = buildSourceIndex({ scan, structureAll, readFile, sourceRevision: 'rev-1' });

    const chunk = index.chunks.find((c) => c.path === FILE_A_PATH && c.symbol === 'createOrder');
    expect(chunk).toBeDefined();
    expect(chunk.path).toBe(FILE_A_PATH);
    expect(chunk.owner).toBeNull();
    expect(chunk.symbol).toBe('createOrder');
    expect(chunk.lineRange).toEqual([1, 5]);
    expect(chunk.type).toBe('function');
    expect(chunk.identifiers).toEqual(expect.arrayContaining(['create', 'order', 'user', 'id', 'items']));
    expect(chunk.comments).toEqual(expect.arrayContaining(['Creates a new order for the given user']));
    expect(chunk.strings).toEqual(expect.arrayContaining(['order created for user']));
  });

  it('a class chunk carries its own owner-less symbol and picks up its block comment', () => {
    const { scan, structureAll, readFile } = baseFixture();
    const index = buildSourceIndex({ scan, structureAll, readFile, sourceRevision: 'rev-1' });

    const chunk = index.chunks.find((c) => c.path === FILE_A_PATH && c.symbol === 'OrderService');
    expect(chunk).toBeDefined();
    expect(chunk.type).toBe('class');
    expect(chunk.lineRange).toEqual([7, 12]);
    expect(chunk.comments).toEqual(expect.arrayContaining(['Handles order persistence']));
    expect(chunk.identifiers).toEqual(expect.arrayContaining(['order', 'service']));
  });

  it('every function/class chunk carries a nodeId matching node-identity (fact-graph parity)', async () => {
    const { deriveNodeId } = await import('../../skills/excavator/node-identity.mjs');
    const { scan, structureAll, readFile } = baseFixture();
    const index = buildSourceIndex({ scan, structureAll, readFile, sourceRevision: 'rev-1' });

    const fnChunk = index.chunks.find((c) => c.symbol === 'createOrder');
    expect(fnChunk.nodeId).toBe(deriveNodeId({
      type: 'function', path: FILE_A_PATH, name: 'createOrder', owner: '',
      params: ['userId', 'items'],
    }));

    const fileChunk = index.chunks.find((c) => c.path === FILE_A_PATH && c.symbol === null);
    expect(fileChunk).toBeDefined();
    expect(fileChunk.nodeId).toBe(deriveNodeId({ type: 'file', path: FILE_A_PATH }));
  });

  it('builds only from deterministic inputs — zero model calls (pure function of its arguments)', () => {
    const { scan, structureAll, readFile } = baseFixture();
    const a = buildSourceIndex({ scan, structureAll, readFile, sourceRevision: 'rev-1' });
    const b = buildSourceIndex({ scan, structureAll, readFile, sourceRevision: 'rev-1' });
    expect(b).toEqual(a);
  });

  it('a file whose content cannot be read still gets structural chunks, with the gap recorded visibly', () => {
    const { scan, structureAll } = baseFixture();
    const readFile = (path) => {
      if (path === FILE_B_PATH) throw new Error('simulated unreadable file');
      return FILE_A_CONTENT;
    };
    const index = buildSourceIndex({ scan, structureAll, readFile, sourceRevision: 'rev-1' });

    expect(index.filesContentUnavailable).toContain(FILE_B_PATH);
    const chunk = index.chunks.find((c) => c.symbol === 'retryPayment');
    expect(chunk).toBeDefined();
    expect(chunk.contentAvailable).toBe(false);
    expect(chunk.comments).toEqual([]);
    expect(chunk.strings).toEqual([]);
    // Structural identifiers (from the symbol/params themselves) are still present.
    expect(chunk.identifiers).toEqual(expect.arrayContaining(['retry', 'payment']));
  });
});

// ---------------------------------------------------------------------------
// BM25 — Requirement "BM25 lexical retrieval" (implementation lives in retrieve.mjs;
// this test exercises the index this module builds end-to-end).
// ---------------------------------------------------------------------------
describe('buildSourceIndex + bm25Search — lexical retrieval', () => {
  it('returns score-ranked candidates, with a strong match outranking a weak one', () => {
    const { scan, structureAll, readFile } = baseFixture();
    const index = buildSourceIndex({ scan, structureAll, readFile, sourceRevision: 'rev-1' });

    const results = bm25Search(index, ['order'], 10);
    expect(results.length).toBeGreaterThan(0);
    // Every result must actually be about file A ("order"), never file B
    // ("payment") — a term with zero postings overlap must not appear.
    expect(results.every((r) => r.chunk.path === FILE_A_PATH)).toBe(true);
    // Scores are sorted descending.
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});

// ---------------------------------------------------------------------------
// Persistence — Requirement "persist by sourceRevision and incrementally rebuild".
// ---------------------------------------------------------------------------
describe('buildSourceIndex — persistence keyed by sourceRevision', () => {
  it('carries the given sourceRevision on the output', () => {
    const { scan, structureAll, readFile } = baseFixture();
    const index = buildSourceIndex({ scan, structureAll, readFile, sourceRevision: 'rev-abc123' });
    expect(index.sourceRevision).toBe('rev-abc123');
  });
});

describe('updateSourceIndex — single-file incremental rebuild', () => {
  it('rebuilds only the changed file\'s chunks; every other chunk is byte-identical (same reference)', () => {
    const { scan, structureAll, readFile } = baseFixture();
    const previousIndex = buildSourceIndex({ scan, structureAll, readFile, sourceRevision: 'rev-1' });

    // File A changes: the comment text changes and the function grows by one
    // line. File B is untouched.
    const newFileAContent = [
      '// Creates and validates a new order for the given user',
      'function createOrder(userId, items) {',
      '  const note = "order created for user";',
      '  const extra = true;',
      '  return { userId, items, note, extra };',
      '}',
      '',
      'class OrderService {',
      '  /* Handles order persistence */',
      '  save(order) {',
      '    return order;',
      '  }',
      '}',
    ].join('\n');
    const newStructureAll = {
      results: [
        {
          ...structureAll.results[0],
          totalLines: 13,
          functions: [
            { name: 'createOrder', owner: '', startLine: 1, endLine: 6, params: ['userId', 'items'] },
          ],
          classes: [
            { name: 'OrderService', startLine: 8, endLine: 13, methods: ['save'], properties: [] },
          ],
        },
        structureAll.results[1],
      ],
    };

    let calledForFileB = false;
    const newReadFile = (path) => {
      if (path === FILE_B_PATH) {
        calledForFileB = true;
        throw new Error('updateSourceIndex must not re-read an unchanged file');
      }
      return newFileAContent;
    };

    const updated = updateSourceIndex({
      previousIndex,
      structureAll: newStructureAll,
      changed: { added: [], modified: [FILE_A_PATH], removed: [] },
      readFile: newReadFile,
      sourceRevision: 'rev-2',
    });

    expect(calledForFileB).toBe(false);

    const oldFileBChunks = previousIndex.chunks.filter((c) => c.path === FILE_B_PATH);
    const newFileBChunks = updated.chunks.filter((c) => c.path === FILE_B_PATH);
    expect(newFileBChunks).toEqual(oldFileBChunks);
    // Stronger proof than deep-equality: the untouched file's chunk objects
    // are the SAME references, not merely equal after a full re-derivation.
    for (const oldChunk of oldFileBChunks) {
      expect(newFileBChunks).toContain(oldChunk);
    }

    const rebuiltFn = updated.chunks.find((c) => c.path === FILE_A_PATH && c.symbol === 'createOrder');
    expect(rebuiltFn.lineRange).toEqual([1, 6]);
    expect(rebuiltFn.comments).toEqual(
      expect.arrayContaining(['Creates and validates a new order for the given user']),
    );

    expect(updated.sourceRevision).toBe('rev-2');
  });

  it('drops chunks for a removed file entirely, including its postings', () => {
    const { scan, structureAll, readFile } = baseFixture();
    const previousIndex = buildSourceIndex({ scan, structureAll, readFile, sourceRevision: 'rev-1' });

    const newStructureAll = { results: [structureAll.results[0]] };
    const updated = updateSourceIndex({
      previousIndex,
      structureAll: newStructureAll,
      changed: { added: [], modified: [], removed: [FILE_B_PATH] },
      readFile,
      sourceRevision: 'rev-2',
    });

    expect(updated.chunks.some((c) => c.path === FILE_B_PATH)).toBe(false);
    const paymentResults = bm25Search(updated, ['payment'], 10);
    expect(paymentResults).toEqual([]);
  });
});

// Regression: real source tokens like `constructor`/`toString`/`hasOwnProperty`
// collide with Object.prototype. A plain-object postings map crashed the build
// (postings["constructor"].push is not a function) on the wcp TS/Vue corpus;
// a JSON-parsed index also makes an un-indexed colliding query term resolve to
// an inherited function on the read side. Caught by group-6 real-corpus
// acceptance, not by Go/synthetic fixtures.
describe('prototype-colliding tokens', () => {
  const P = 'src/proto.ts';
  const CONTENT = [
    'class Widget {',
    '  constructor(name) { this.name = name; }',
    '}',
    'function toString(x) { return String(x); }',
  ].join('\n');
  const scan = { files: [{ path: P, language: 'typescript', sizeLines: 4, fileCategory: 'code' }] };
  const structureAll = {
    results: [{
      path: P, language: 'typescript', fileCategory: 'code', totalLines: 4, nonEmptyLines: 4, status: 'parsed',
      functions: [
        { name: 'constructor', owner: 'Widget', startLine: 2, endLine: 2, params: ['name'] },
        { name: 'toString', owner: '', startLine: 4, endLine: 4, params: ['x'] },
      ],
      classes: [{ name: 'Widget', startLine: 1, endLine: 3, methods: ['constructor'], properties: [] }],
      metrics: {},
    }],
  };
  const readFile = (p) => (p === P ? CONTENT : '');

  it('builds and searches without crashing on Object.prototype-colliding tokens', () => {
    const index = buildSourceIndex({ scan, structureAll, readFile, sourceRevision: 'rev-1' });
    // Round-trip through JSON to mirror persistence — the read side must be safe too.
    const persisted = JSON.parse(JSON.stringify(index));
    expect(() => bm25Search(persisted, ['constructor'], 20)).not.toThrow();
    expect(() => bm25Search(persisted, ['toString'], 20)).not.toThrow();
    expect(() => bm25Search(persisted, ['hasOwnProperty'], 20)).not.toThrow(); // never indexed
    // an indexed colliding term still retrieves its chunk
    expect(bm25Search(persisted, ['constructor'], 20).length).toBeGreaterThan(0);
    // an un-indexed colliding term is a clean miss, not a crash
    expect(bm25Search(persisted, ['hasOwnProperty'], 20)).toEqual([]);
  });
});
