/**
 * source-index-store.mjs
 *
 * Line-oriented persistence for the source index (openspec: changes/
 * product-serialization-ceiling, capability `source-index`, design D1/D2).
 * Replaces a single whole-document `JSON.stringify`/`JSON.parse` of
 * `source-index.json` — which, on apache/hadoop's real 150k-chunk index,
 * produced a 1.36 GB single string (253% of V8's own single-string ceiling,
 * `buffer.constants.MAX_STRING_LENGTH`) — with `source-index.jsonl`: one JSON
 * record per line, so neither writing nor reading ever needs the whole index
 * in one string. A line's length is bounded by a single term's posting list
 * or a single chunk, never by the index as a whole.
 *
 * Record order (fixed, one record type per line):
 *   1. exactly one `header` record (must be line 1)
 *   2. one `file-indexed` record per entry of `filesIndexed`, in that order
 *   3. one `file-content-unavailable` record per entry of
 *      `filesContentUnavailable`, in that order
 *   4. one `chunk` record per entry of `chunks`, in that order — a chunk's
 *      ordinal (used by `posting` records below) is simply its position
 *      among these records (0-based)
 *   5. one `posting` record per term, in ascending term order — the
 *      inverted list references chunks by ordinal (a parallel `chunks`
 *      index array) plus a parallel `tf` array, instead of repeating each
 *      chunk's id string once per posting (the single biggest contributor to
 *      the old format's size: every posting entry duplicated a whole chunk
 *      id string). Because chunks are stored sorted by id and a term's
 *      posting list is sorted by chunkId (`buildPostings` in
 *      build-source-index.mjs), a term's ordinals are always strictly
 *      increasing — the reader validates this instead of merely assuming it.
 *
 * Writer: buffers lines in memory and flushes them through one file
 * descriptor roughly every 8 MB (a batching heuristic, not a correctness
 * requirement) — it never joins or stringifies the whole index at once.
 *
 * Reader: synchronous (every caller — MCP project-service, sync-fact-graph,
 * the build-source-index CLI, excavator-chat's inline read — uses the index
 * synchronously already, so there is no reason to fan this out into an async
 * streaming API). Reads the file in fixed-size blocks via `readSync`,
 * decodes each block through a `StringDecoder('utf8')` (so a multi-byte
 * UTF-8 character split across a block boundary is never misread), and
 * splits on `\n`. Every record is validated as it is read (D2): the first
 * line must be a `header` with the expected `format`; the actual number of
 * chunk/term/file-indexed/file-content-unavailable records read must equal
 * what the header declared; every posting's `chunks`/`tf` arrays must be the
 * same length, every ordinal must be an integer inside `[0, chunkCount)`,
 * and a term's ordinals must be strictly increasing; a chunk's `docLength`
 * must be a non-negative integer and a file record's `path` must be a
 * string; chunk ids across the whole file, and posting terms across the
 * whole file, must EACH be strictly increasing (catches a duplicate chunk id
 * — which would otherwise silently collide in `docLengths` — and a
 * duplicate term — which would otherwise silently overwrite an earlier
 * posting while `termCount` still matched); any other record shape (unknown
 * `record` type, a header appearing again after line 1, invalid JSON) fails
 * immediately. `postings` entries are assigned via `Object.defineProperty`,
 * not bracket assignment, so a crafted term literally named `__proto__`
 * becomes a safe own property instead of reassigning the object's own
 * prototype through the inherited accessor setter. On any validation failure
 * the reader throws `SourceIndexFormatError` rather than returning a partial
 * or corrupted index — callers
 * map that to a visible "invalid product" gap (D3), never a silent partial
 * read.
 *
 * The object `readSourceIndex` returns is built to be STRICTLY deep-equal
 * (`node:util`'s `isDeepStrictEqual`) to what `buildSourceIndex`/
 * `updateSourceIndex` (build-source-index.mjs) produce in memory:
 *   - `postings` is a plain object (the file already lists terms in
 *     ascending order, matching `sortObjectKeys`'s output, though
 *     `isDeepStrictEqual` does not itself depend on key enumeration order);
 *     each posting entry is a fresh `{ chunkId, tf }` object.
 *   - `docLengths` is a null-prototype object (`Object.create(null)`), same
 *     as `buildPostings`'s own null-prototype map — a real source token like
 *     `constructor`/`toString` must not resolve to an inherited
 *     `Object.prototype` member (see build-source-index.mjs's own comment on
 *     this; caught on the wcp TS/Vue corpus).
 *   - `chunks` are the original chunk objects, verbatim, in their original
 *     (sorted-by-id) order.
 * `retrieve.mjs`'s `bm25Search` is therefore usable, unmodified, against a
 * round-tripped index exactly as it is against a freshly built one.
 *
 * `source-index.json` (the old whole-document format) is never read by this
 * module or by anything downstream of it (zero-compat, per AGENTS.md and
 * design D3/D6) — `LEGACY_SOURCE_INDEX_FILE` is exported only so a caller can
 * name it in an honest gap/diagnostic ("only the legacy file exists"),
 * never to parse it.
 *
 * Contract: openspec/changes/product-serialization-ceiling/specs/
 *           source-index/spec.md
 */

import { closeSync, openSync, readSync, statSync, writeSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

/** The current on-disk file name. One line per record; never a single
 *  whole-document JSON value. */
export const SOURCE_INDEX_FILE = 'source-index.jsonl';

/** The RETIRED whole-document format's file name. Named here only so a
 *  caller can report "only the legacy file is present" as a visible gap
 *  (design D3) — this module never opens or parses it. */
export const LEGACY_SOURCE_INDEX_FILE = 'source-index.json';

/** The `format` value stamped on every header record. Bumping the line
 *  layout in an incompatible way means bumping this string. */
export const SOURCE_INDEX_FORMAT = 'excavator-source-index-lines/1';

/** Flush the writer's line buffer roughly every this many characters (a
 *  cheap proxy for bytes — see the module doc's "Writer" paragraph). */
const FLUSH_THRESHOLD_CHARS = 8 * 1024 * 1024;

/** Default read block size for `readSourceIndex`. Callers (mainly tests)
 *  may pass a much smaller `blockSize` to exercise multi-byte characters
 *  split across a block boundary. */
const DEFAULT_READ_BLOCK_SIZE = 4 * 1024 * 1024;

export class SourceIndexFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SourceIndexFormatError';
  }
}

/** Same plain lexicographic ordering `fact-graph-resolve.mjs`'s
 *  `compareStrings` and `coverage-ledger.mjs`'s `sortObjectKeys` use —
 *  mirrored locally (a one-line pure function) rather than imported, so this
 *  module stays a self-contained persistence primitive with no dependency on
 *  the fact-graph/node-identity machinery (same reasoning build-source-
 *  index.mjs's own header gives for its small private mirrors). */
function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Persist a source index (the shape `buildSourceIndex`/`updateSourceIndex`
 * return) to `path` as `source-index.jsonl`. Never builds the whole index as
 * one string — lines are buffered and flushed through one file descriptor in
 * ~8 MB batches.
 *
 * @param {string} path
 * @param {{
 *   sourceRevision: string, k1: number, b: number, N: number, avgDocLength: number,
 *   chunks: Array<{id: string, [key: string]: *}>,
 *   postings: Record<string, Array<{chunkId: string, tf: number}>>,
 *   docLengths: Record<string, number>,
 *   filesIndexed: string[], filesContentUnavailable: string[],
 * }} index
 * @returns {{ bytes: number, lines: number, maxLineChars: number }}
 */
export function writeSourceIndex(path, index) {
  const chunkOrdinalById = new Map(index.chunks.map((chunk, ordinal) => [chunk.id, ordinal]));
  const terms = Object.keys(index.postings).sort(compareStrings);

  const fd = openSync(path, 'w');
  let buffered = [];
  let bufferedChars = 0;
  let lineCount = 0;
  let maxLineChars = 0;

  function flush() {
    if (buffered.length === 0) return;
    writeSync(fd, buffered.join('\n') + '\n');
    buffered = [];
    bufferedChars = 0;
  }

  function emit(record) {
    const line = JSON.stringify(record);
    if (line.length > maxLineChars) maxLineChars = line.length;
    buffered.push(line);
    bufferedChars += line.length + 1; // +1 for the '\n' this line will get on flush
    lineCount += 1;
    if (bufferedChars >= FLUSH_THRESHOLD_CHARS) flush();
  }

  try {
    emit({
      record: 'header',
      format: SOURCE_INDEX_FORMAT,
      sourceRevision: index.sourceRevision,
      k1: index.k1,
      b: index.b,
      N: index.N,
      avgDocLength: index.avgDocLength,
      chunkCount: index.chunks.length,
      termCount: terms.length,
      filesIndexedCount: index.filesIndexed.length,
      filesContentUnavailableCount: index.filesContentUnavailable.length,
    });
    for (const p of index.filesIndexed) emit({ record: 'file-indexed', path: p });
    for (const p of index.filesContentUnavailable) emit({ record: 'file-content-unavailable', path: p });
    for (const chunk of index.chunks) {
      emit({ record: 'chunk', docLength: index.docLengths[chunk.id], chunk });
    }
    for (const term of terms) {
      const postingList = index.postings[term];
      emit({
        record: 'posting',
        term,
        chunks: postingList.map((entry) => chunkOrdinalById.get(entry.chunkId)),
        tf: postingList.map((entry) => entry.tf),
      });
    }
    flush();
  } finally {
    closeSync(fd);
  }

  // Read back the real on-disk size rather than accumulating an estimate —
  // `bytes` must reflect exactly what landed on disk (UTF-8 byte length can
  // differ from the char-based flush heuristic above for non-ASCII content).
  return { bytes: statSync(path).size, lines: lineCount, maxLineChars };
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/**
 * Read a `source-index.jsonl` file written by `writeSourceIndex`, validating
 * it as it is read (design D2). Throws `SourceIndexFormatError` — never
 * returns a partial index — on any header/count/posting-shape mismatch or
 * unknown record.
 *
 * @param {string} path
 * @param {{ blockSize?: number }} [options]
 * @returns {{
 *   sourceRevision: string, k1: number, b: number, N: number, avgDocLength: number,
 *   chunks: object[], postings: Record<string, Array<{chunkId: string, tf: number}>>,
 *   docLengths: Record<string, number>,
 *   filesIndexed: string[], filesContentUnavailable: string[],
 * }}
 */
export function readSourceIndex(path, { blockSize = DEFAULT_READ_BLOCK_SIZE } = {}) {
  const fd = openSync(path, 'r');
  try {
    return readRecords(fd, blockSize, path);
  } finally {
    closeSync(fd);
  }
}

/** Reads and validates every record from an already-open fd, in one
 *  sequential pass. Split out from `readSourceIndex` only so the `finally
 *  closeSync` above stays visually adjacent to the `openSync` that opened
 *  it. */
function readRecords(fd, blockSize, path) {
  const decoder = new StringDecoder('utf8');
  const block = Buffer.allocUnsafe(blockSize);

  let header = null;
  let lineNo = 0;
  let carry = '';

  const chunks = [];
  const filesIndexed = [];
  const filesContentUnavailable = [];
  const docLengths = Object.create(null);
  /** Raw posting records, chunkId resolution deferred until every chunk
   *  record has been read and count-validated. A posting's ordinals ARE
   *  range/order-validated as soon as that line is parsed, using only
   *  `header.chunkCount` (known since line 1) — but resolving an ordinal to
   *  an actual chunkId needs the complete `chunks` array, so that step waits
   *  until the whole file has been read and its counts checked. */
  const rawPostings = [];
  /** Tracks strictly-increasing order for chunk ids and posting terms (F2
   *  fix, batch A acceptance): the writer always emits both in ascending
   *  order (chunks sorted by id, postings sorted by term), so a duplicate or
   *  out-of-order value is corruption, not merely unusual — and a duplicate
   *  chunk id would otherwise silently collide in `docLengths`, while a
   *  duplicate term would otherwise silently overwrite an earlier posting
   *  while `termCount` still (wrongly) appeared to match. `null` means "no
   *  chunk/term seen yet". */
  let lastChunkId = null;
  let lastTerm = null;

  function fail(message) {
    throw new SourceIndexFormatError(`${path}: ${message} (line ${lineNo})`);
  }

  function handleLine(line) {
    lineNo += 1;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      fail(`invalid JSON (${error.message})`);
    }

    if (header === null) {
      if (record === null || typeof record !== 'object' || record.record !== 'header' || record.format !== SOURCE_INDEX_FORMAT) {
        fail(`expected the first line to be a header record with format "${SOURCE_INDEX_FORMAT}"`);
      }
      for (const field of ['chunkCount', 'termCount', 'filesIndexedCount', 'filesContentUnavailableCount']) {
        if (!Number.isInteger(record[field]) || record[field] < 0) {
          fail(`header field "${field}" must be a non-negative integer`);
        }
      }
      header = record;
      return;
    }

    const kind = record !== null && typeof record === 'object' ? record.record : undefined;
    if (kind === 'header') fail('a second header record is not allowed after line 1');

    if (kind === 'file-indexed') {
      if (typeof record.path !== 'string') fail('file-indexed record must have a string path');
      filesIndexed.push(record.path);
    } else if (kind === 'file-content-unavailable') {
      if (typeof record.path !== 'string') fail('file-content-unavailable record must have a string path');
      filesContentUnavailable.push(record.path);
    } else if (kind === 'chunk') {
      const chunk = record.chunk;
      if (!chunk || typeof chunk.id !== 'string' || chunk.id.length === 0) {
        fail('chunk record is missing a valid chunk.id');
      }
      if (!Number.isInteger(record.docLength) || record.docLength < 0) {
        fail(`chunk record for "${chunk.id}" has an invalid docLength: ${JSON.stringify(record.docLength)}`);
      }
      if (lastChunkId !== null && compareStrings(chunk.id, lastChunkId) <= 0) {
        fail(`chunk ids must be strictly increasing (got "${chunk.id}" after "${lastChunkId}")`);
      }
      lastChunkId = chunk.id;
      chunks.push(chunk);
      docLengths[chunk.id] = record.docLength;
    } else if (kind === 'posting') {
      const { term, chunks: ordinals, tf } = record;
      if (typeof term !== 'string' || !Array.isArray(ordinals) || !Array.isArray(tf) || ordinals.length !== tf.length) {
        fail(`posting record for term ${JSON.stringify(term)} has mismatched or malformed chunks/tf arrays`);
      }
      if (lastTerm !== null && compareStrings(term, lastTerm) <= 0) {
        fail(`posting terms must be strictly increasing (got "${term}" after "${lastTerm}")`);
      }
      lastTerm = term;
      let previous = -1;
      for (const ordinal of ordinals) {
        if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= header.chunkCount) {
          fail(`posting for term "${term}" has an out-of-range chunk ordinal: ${ordinal}`);
        }
        if (ordinal <= previous) {
          fail(`posting for term "${term}" has chunk ordinals that are not strictly increasing`);
        }
        previous = ordinal;
      }
      rawPostings.push({ term, ordinals, tf });
    } else {
      fail(`unknown record type: ${JSON.stringify(kind)}`);
    }
  }

  // Buffers text across block reads, splitting on '\n'; only a complete line
  // (one with a following '\n') is dispatched to handleLine as it is found.
  // The one exception is the FINAL call (`final: true`, made once after
  // `decoder.end()`): a non-empty leftover there is itself the last line of
  // a file that happens not to end in '\n' — still a real record — but an
  // EMPTY leftover there is just the harmless trailing split artifact every
  // well-formed file has (every flush ends in '\n', so splitting always
  // yields one final empty segment) and must NOT be treated as a spurious
  // blank line.
  function consumeText(text, { final = false } = {}) {
    const parts = (carry + text).split('\n');
    carry = parts.pop();
    for (const part of parts) handleLine(part);
    if (final && carry.length > 0) handleLine(carry);
  }

  for (let bytesRead; (bytesRead = readSync(fd, block, 0, block.length, null)) > 0;) {
    consumeText(decoder.write(block.subarray(0, bytesRead)));
  }
  consumeText(decoder.end(), { final: true });

  if (header === null) fail('missing header record (file is empty)');
  if (chunks.length !== header.chunkCount) {
    fail(`chunk count mismatch: header declares ${header.chunkCount}, found ${chunks.length}`);
  }
  if (filesIndexed.length !== header.filesIndexedCount) {
    fail(`filesIndexed count mismatch: header declares ${header.filesIndexedCount}, found ${filesIndexed.length}`);
  }
  if (filesContentUnavailable.length !== header.filesContentUnavailableCount) {
    fail(
      `filesContentUnavailable count mismatch: header declares ${header.filesContentUnavailableCount}, ` +
      `found ${filesContentUnavailable.length}`,
    );
  }
  if (rawPostings.length !== header.termCount) {
    fail(`term count mismatch: header declares ${header.termCount}, found ${rawPostings.length}`);
  }

  // Object.defineProperty, not `postings[term] = ...` (F2 fix, batch A
  // acceptance): a term is untrusted file content, and `obj["__proto__"] =
  // x` on a plain object does NOT create an own property at all — it
  // invokes Object.prototype's `__proto__` ACCESSOR SETTER, replacing the
  // object's own prototype with `x` (verified empirically before relying on
  // this: `real["__proto__"] = [1,2,3]` leaves `Object.getPrototypeOf(real)`
  // as `[1,2,3]` itself, with `hasOwnProperty` false). `defineProperty`
  // bypasses that inherited accessor entirely and always creates a genuine
  // OWN data property — for every normal term this is indistinguishable from
  // plain assignment (same enumerability, writability, configurability,
  // `isDeepStrictEqual` result), so `postings` remains an ordinary plain
  // object matching the builder's `sortObjectKeys` output exactly.
  const postings = {};
  for (const { term, ordinals, tf } of rawPostings) {
    const entries = ordinals.map((ordinal, i) => ({ chunkId: chunks[ordinal].id, tf: tf[i] }));
    Object.defineProperty(postings, term, { value: entries, enumerable: true, writable: true, configurable: true });
  }

  return {
    sourceRevision: header.sourceRevision,
    k1: header.k1,
    b: header.b,
    N: header.N,
    avgDocLength: header.avgDocLength,
    chunks,
    postings,
    docLengths,
    filesIndexed,
    filesContentUnavailable,
  };
}

export default {
  SOURCE_INDEX_FILE,
  LEGACY_SOURCE_INDEX_FILE,
  SOURCE_INDEX_FORMAT,
  SourceIndexFormatError,
  writeSourceIndex,
  readSourceIndex,
};
