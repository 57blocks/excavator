/**
 * optional-artifacts.mjs
 *
 * Readers for the bake's optional inputs (openspec change `artifact-view`,
 * design D3/D6): `fingerprints.json` (per-file line counts), the streamed
 * `source-index.jsonl` (chunk terms and postings), and the three semantic
 * products with their per-item freshness. Each reader returns the segments it
 * contributes; an artifact that exists but cannot be read becomes an
 * `invalid` inventory entry with its reason (never an empty section passed
 * off as real).
 *
 * Freshness reuses the owners' own rules so the page can never disagree with
 * the terminal: semantic cache entries go through `semantic-cache.mjs`'s
 * `freshnessOf` against the manifest's per-file `contentHash`; the domain
 * graph goes through `domain-freshness.mjs`'s `isDomainGraphUsable` against
 * the manifest's `sourceRevision` and the graph header's `factsDigest`; the
 * semantic graph compares its `factDigest` with the header's `factsDigest`.
 */

import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import { Int32Builder, table } from '../bundle-codec.mjs';
import { SOURCE_INDEX_FORMAT } from '../../excavator/source-index-store.mjs';
import { freshnessOf } from '../../excavator/semantic-cache.mjs';
import { isDomainGraphUsable } from '../../excavator-domain/domain-freshness.mjs';

export class OptionalArtifactError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'OptionalArtifactError';
  }
}

/** @param {string} path */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new OptionalArtifactError(`not valid JSON (${/** @type {Error} */ (error).message})`);
  }
}

/**
 * The `files` table: one row per manifest entry (the selected files), with
 * `totalLines` from fingerprints when available (-1 otherwise).
 *
 * @param {Array<{ path: string, contentHash: string }>} manifestEntries
 * @param {string|null} fingerprintsPath
 * @param {import('../bundle-codec.mjs').Interner} interner
 */
export function buildFilesTable(manifestEntries, fingerprintsPath, interner) {
  /** @type {Record<string, any> | null} */
  let fingerprints = null;
  if (fingerprintsPath) {
    const parsed = readJson(fingerprintsPath);
    if (parsed === null || typeof parsed !== 'object' || parsed.files === null || typeof parsed.files !== 'object') {
      throw new OptionalArtifactError('has no "files" object');
    }
    fingerprints = parsed.files;
  }
  const path = new Int32Builder(manifestEntries.length);
  const totalLines = new Int32Builder(manifestEntries.length);
  const contentHash = new Int32Builder(manifestEntries.length);
  let withoutLineCount = 0;
  for (const entry of manifestEntries) {
    path.push(interner.cell(entry.path));
    contentHash.push(interner.cell(entry.contentHash));
    const fp = fingerprints && Object.hasOwn(fingerprints, entry.path) ? fingerprints[entry.path] : null;
    const lines = fp && Number.isInteger(fp.totalLines) && fp.totalLines >= 0 ? fp.totalLines : -1;
    if (lines === -1) withoutLineCount += 1;
    totalLines.push(lines);
  }
  return {
    files: table(manifestEntries.length, { path: path.finish(), totalLines: totalLines.finish(), contentHash: contentHash.finish() }),
    withoutLineCount,
  };
}

/**
 * Stream `source-index.jsonl` into four tables: chunk rows, their flat token
 * list, term rows, and the flat posting list (chunk ordinals). Validates the
 * header format and the declared chunk/term counts.
 *
 * A chunk's `comments` and `strings` are verbatim source text (comment and
 * string-literal content). With `includeLiterals: false` (the bake's
 * --no-source) they are not embedded and their offset/count columns are -1,
 * which the page reads as "not embedded", distinct from an empty list.
 *
 * @param {string} indexPath
 * @param {import('../bundle-codec.mjs').Interner} interner
 * @param {{ includeLiterals?: boolean }} [options]
 */
export async function streamSourceIndex(indexPath, interner, { includeLiterals = true } = {}) {
  /** @type {any} */
  let header = null;
  let lineNo = 0;
  const chunk = {
    node: new Int32Builder(), language: new Int32Builder(), docLength: new Int32Builder(),
    idOffset: new Int32Builder(), idCount: new Int32Builder(),
    commentOffset: new Int32Builder(), commentCount: new Int32Builder(),
    stringOffset: new Int32Builder(), stringCount: new Int32Builder(),
  };
  const tokens = new Int32Builder();
  const term = { term: new Int32Builder(), offset: new Int32Builder(), count: new Int32Builder() };
  const postings = new Int32Builder();
  let filesIndexed = 0;
  let filesContentUnavailable = 0;

  /** @param {string} message */
  const fail = (message) => {
    throw new OptionalArtifactError(`${message} (line ${lineNo})`);
  };
  /** @param {unknown} list @param {Int32Builder} offset @param {Int32Builder} count */
  const pushList = (list, offset, count) => {
    const items = Array.isArray(list) ? list : [];
    offset.push(tokens.length);
    count.push(items.length);
    for (const item of items) tokens.push(interner.cell(item));
  };

  const input = createReadStream(indexPath, { encoding: 'utf-8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      lineNo += 1;
      if (line.length === 0) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch (error) {
        fail(`invalid JSON (${/** @type {Error} */ (error).message})`);
      }
      if (header === null) {
        if (record?.record !== 'header' || record.format !== SOURCE_INDEX_FORMAT) {
          fail(`expected a header record with format "${SOURCE_INDEX_FORMAT}"`);
        }
        header = record;
        continue;
      }
      switch (record?.record) {
        case 'file-indexed': filesIndexed += 1; break;
        case 'file-content-unavailable': filesContentUnavailable += 1; break;
        case 'chunk': {
          const c = record.chunk ?? {};
          chunk.node.push(interner.cell(c.nodeId));
          chunk.language.push(interner.cell(c.language));
          chunk.docLength.push(Number.isInteger(record.docLength) ? record.docLength : -1);
          pushList(c.identifiers, chunk.idOffset, chunk.idCount);
          if (includeLiterals) {
            pushList(c.comments, chunk.commentOffset, chunk.commentCount);
            pushList(c.strings, chunk.stringOffset, chunk.stringCount);
          } else {
            for (const col of [chunk.commentOffset, chunk.commentCount, chunk.stringOffset, chunk.stringCount]) col.push(-1);
          }
          break;
        }
        case 'posting': {
          term.term.push(interner.cell(record.term));
          const ordinals = Array.isArray(record.chunks) ? record.chunks : [];
          term.offset.push(postings.length);
          term.count.push(ordinals.length);
          for (const ordinal of ordinals) postings.push(Number.isInteger(ordinal) ? ordinal : -1);
          break;
        }
        default:
          fail(`unknown record type ${JSON.stringify(record?.record)}`);
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (header === null) fail('missing header record (file is empty)');
  if (chunk.node.length !== header.chunkCount) fail(`chunk count mismatch: header declares ${header.chunkCount}, found ${chunk.node.length}`);
  if (term.term.length !== header.termCount) fail(`term count mismatch: header declares ${header.termCount}, found ${term.term.length}`);

  const finish = (/** @type {Record<string, Int32Builder>} */ cols) => {
    const entries = Object.entries(cols).map(([k, b]) => [k, b.finish()]);
    return table(entries[0][1].length, Object.fromEntries(entries));
  };
  return {
    meta: {
      sourceRevision: header.sourceRevision ?? null,
      k1: header.k1, b: header.b, N: header.N, avgDocLength: header.avgDocLength,
      chunkCount: header.chunkCount, termCount: header.termCount,
      filesIndexed, filesContentUnavailable,
      literals: includeLiterals ? 'embedded' : 'omitted',
    },
    segments: {
      'index.chunks': finish(chunk),
      'index.tokens': table(tokens.length, { token: tokens.finish() }),
      'index.terms': finish(term),
      'index.postings': table(postings.length, { chunk: postings.finish() }),
    },
  };
}

/**
 * The semantic cache, with each entry's freshness against the manifest.
 *
 * @param {string} cachePath
 * @param {Map<string, string>} nodeFile node id -> file path
 * @param {Map<string, string>} manifestHash file path -> contentHash
 */
export function readSemanticCache(cachePath, nodeFile, manifestHash) {
  const cache = readJson(cachePath);
  if (cache === null || typeof cache !== 'object' || cache.entries === null || typeof cache.entries !== 'object') {
    throw new OptionalArtifactError('has no "entries" object');
  }
  const entries = [];
  const tally = { fresh: 0, stale: 0, missing: 0, 'noncanonical-language': 0, notInGraph: 0 };
  for (const [nodeId, entry] of Object.entries(cache.entries)) {
    const file = nodeFile.get(nodeId);
    const freshness = file === undefined
      ? 'missing'
      : freshnessOf(entry, manifestHash.get(file) ?? null, cache);
    if (file === undefined) tally.notInGraph += 1;
    tally[freshness] += 1;
    entries.push({
      nodeId,
      summary: entry?.summary ?? null,
      tags: Array.isArray(entry?.tags) ? entry.tags : [],
      model: entry?.model ?? null,
      generatedAt: entry?.generatedAt ?? null,
      verification: entry?.verification ?? null,
      freshness,
      inGraph: file !== undefined,
    });
  }
  return {
    segment: { version: cache.version ?? null, contentLanguage: cache.contentLanguage ?? null, entries },
    summary: { entries: entries.length, nodesInGraph: nodeFile.size, ...tally },
  };
}

/**
 * @param {string} graphPath
 * @param {string|null} headerFactsDigest
 */
export function readSemanticGraph(graphPath, headerFactsDigest) {
  const graph = readJson(graphPath);
  if (graph === null || typeof graph !== 'object') throw new OptionalArtifactError('is not a JSON object');
  const fresh = typeof graph.factDigest === 'string' && graph.factDigest.length > 0 && graph.factDigest === headerFactsDigest;
  return {
    segment: {
      factDigest: graph.factDigest ?? null,
      headerFactsDigest,
      freshness: fresh ? 'fresh' : 'stale',
      contentLanguage: graph.contentLanguage ?? null,
      layers: Array.isArray(graph.layers) ? graph.layers : [],
      relations: Array.isArray(graph.relations) ? graph.relations : [],
      gaps: graph.gaps ?? null,
    },
    summary: { freshness: fresh ? 'fresh' : 'stale', layers: Array.isArray(graph.layers) ? graph.layers.length : 0 },
  };
}

/**
 * @param {string} domainPath
 * @param {string|null} manifestSourceRevision
 * @param {string|null} headerFactsDigest
 */
export function readDomainGraph(domainPath, manifestSourceRevision, headerFactsDigest) {
  const domainGraph = readJson(domainPath);
  if (domainGraph === null || typeof domainGraph !== 'object') throw new OptionalArtifactError('is not a JSON object');
  const verdict = isDomainGraphUsable({
    domainGraph,
    currentSourceRevision: manifestSourceRevision,
    currentFactDigest: headerFactsDigest,
  });
  return {
    segment: { freshness: verdict.status, reason: verdict.reason, graph: domainGraph },
    summary: { freshness: verdict.status, reason: verdict.reason },
  };
}
