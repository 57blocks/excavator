/**
 * The two readers that walk the knowledge graph's bytes line by line (openspec: changes/explorer-chunked-data):
 * `referencedPaths` (sources.mjs) and `readSemantics` (semantics.mjs). Neither may decode the whole graph into one
 * string: a graph product can hold more characters than one string can. The graph's bytes are a Buffer whose
 * `toString` throws for a range that covers the whole buffer.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readSemantics } from '../../../skills/excavator-view/semantics.mjs';
import { referencedPaths } from '../../../skills/excavator-view/sources.mjs';
import { factGraphJsonl, semanticCache, semanticEntry, sourceManifest, writeProduct } from './fixture.mjs';

const DIGEST = 'a'.repeat(64);
const HASH_A = '1'.repeat(64);
const NODES = [
  { id: 'file:src/a.js', filePath: 'src/a.js' },
  { id: 'function:src/a.js:run', filePath: 'src/a.js' },
  { id: 'file:src/b.js', filePath: 'src/b.js' },
];

/** The text as a Buffer that refuses to decode all of itself in one call. */
function guarded(text) {
  const bytes = Buffer.from(text, 'utf-8');
  const original = bytes.toString.bind(bytes);
  bytes.toString = (encoding, start, end) => {
    if ((start ?? 0) === 0 && (end ?? bytes.length) === bytes.length) throw new RangeError('Cannot create a string longer than 0x1fffffe8 characters');
    return original(encoding, start, end);
  };
  return bytes;
}

const graphText = () => factGraphJsonl({ factsDigest: DIGEST, nodes: NODES });

describe('the guarded buffer', () => {
  it('throws for the whole buffer and decodes a part of it', () => {
    const bytes = guarded('ab\ncd\n');
    expect(() => bytes.toString('utf-8')).toThrow(RangeError);
    expect(bytes.toString('utf-8', 0, 2)).toBe('ab');
  });
});

describe('referencedPaths', () => {
  it('reads the graph\'s file nodes without decoding the whole graph', () => {
    const payloads = [{ id: 'knowledge-graph', bytes: guarded(graphText()) }];
    expect(referencedPaths(payloads)).toEqual(['src/a.js', 'src/b.js']);
  });

  it('gives the same paths as it gives for an ordinary buffer, with an empty line and a line that is not JSON in the graph', () => {
    const text = `${graphText()}\nnot json\n\r\n`;
    const plain = referencedPaths([{ id: 'knowledge-graph', bytes: Buffer.from(text, 'utf-8') }]);
    expect(referencedPaths([{ id: 'knowledge-graph', bytes: guarded(text) }])).toEqual(plain);
    expect(plain).toEqual(['src/a.js', 'src/b.js']);
  });
});

describe('readSemantics', () => {
  let root;
  let dataDir;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'xv-graph-lines-'));
    dataDir = join(root, '.excavator');
    writeProduct(root, 'source-manifest.json', sourceManifest(`git:${'f'.repeat(40)}`, [{ path: 'src/a.js', contentHash: HASH_A }]));
    writeProduct(root, 'semantic-cache.json', semanticCache({ 'file:src/a.js': semanticEntry({ summary: 'Runs the job.', semanticSourceHash: HASH_A }) }));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('reads the facts digest and the node files without decoding the whole graph', () => {
    const result = readSemantics(dataDir, guarded(graphText()));
    expect(result.state).toBe('ok');
    expect(result.counts).toMatchObject({ entries: 1, stale: 0 });
  });

  it('gives the same result as it gives for an ordinary buffer', () => {
    const plain = readSemantics(dataDir, Buffer.from(graphText(), 'utf-8'));
    const result = readSemantics(dataDir, guarded(graphText()));
    expect(result.bytes.toString('utf-8')).toBe(plain.bytes.toString('utf-8'));
    expect(result.counts).toEqual(plain.counts);
  });
});
