/**
 * index-lines.mjs
 *
 * Reads the streamed `source-index.jsonl` (chunk tokens and literal text;
 * postings are rebuilt by the page) one line at a time. Pure: the caller
 * supplies the lines, so the bake and a dropped directory apply the same
 * rules.
 */

import { CELL_ABSENT, Int32Builder, table } from '../bundle-codec.mjs';
import { TextTable } from './text-table.mjs';
import { OptionalArtifactError } from './errors.mjs';
import { SOURCE_INDEX_FORMAT } from './formats.mjs';

/** Every posting line the source-index writer produces starts with this. */
const POSTING_PREFIX = '{"record":"posting"';

/**
 * Read `source-index.jsonl`, one line at a time, into the chunk table and
 * its flat token list, plus (unless `includeLiterals` is false) the comment and string-literal
 * text in a separate, droppable `indexLiterals` segment. Validates the header
 * format and the declared chunk/term counts.
 *
 * Postings are not embedded: the page rebuilds the term -> chunk index from
 * the chunk tokens (and the literals, when embedded). Posting lines are only
 * counted against the header's `termCount`, never parsed.
 *
 * A chunk's `comments` and `strings` are verbatim source text, so they live
 * in their own string table (`indexLiterals.strings`) and count toward the
 * source budget. `commentOffset`/`stringOffset` index rows of the
 * `indexLiterals` table. With `includeLiterals: false` (the bake's
 * --no-source) they are not read at all, and when the literals are not
 * embedded (`dropLiterals()`, used by --no-source and by the budget) the four
 * offset/count columns are -1, which the page reads as "not embedded",
 * distinct from an empty list.
 *
 * @param {import('../bundle-codec.mjs').Interner} interner
 * @param {{ includeLiterals?: boolean, makeError?: (message: string) => Error }} [options]
 */
export function createSourceIndexReader(interner, { includeLiterals = true, makeError = (message) => new OptionalArtifactError(message) } = {}) {
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
  const literalText = new TextTable();
  const literals = new Int32Builder();
  let postingLines = 0;
  let filesIndexed = 0;
  let filesContentUnavailable = 0;

  /** @param {string} message */
  const fail = (message) => {
    throw makeError(`${message} (line ${lineNo})`);
  };
  /** @param {unknown} list @param {Int32Builder} offset @param {Int32Builder} count */
  const pushTokens = (list, offset, count) => {
    const items = Array.isArray(list) ? list : [];
    offset.push(tokens.length);
    count.push(items.length);
    for (const item of items) tokens.push(interner.cell(item));
  };
  /** @param {unknown} list @param {Int32Builder} offset @param {Int32Builder} count */
  const pushLiterals = (list, offset, count) => {
    const items = Array.isArray(list) ? list : [];
    offset.push(literals.length);
    count.push(items.length);
    // Non-string items (never written by the index builder) stay visible as absent.
    for (const item of items) literals.push(typeof item === 'string' ? literalText.id(item) : CELL_ABSENT);
  };

  /** @param {string} line one line of the file, without its line break */
  const read = (line) => {
    lineNo += 1;
    if (line.length === 0) return;
    if (header !== null && line.startsWith(POSTING_PREFIX)) {
      postingLines += 1;
      return;
    }
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
      return;
    }
    switch (record?.record) {
      case 'file-indexed': filesIndexed += 1; break;
      case 'file-content-unavailable': filesContentUnavailable += 1; break;
      case 'chunk': {
        const c = record.chunk ?? {};
        chunk.node.push(interner.cell(c.nodeId));
        chunk.language.push(interner.cell(c.language));
        chunk.docLength.push(Number.isInteger(record.docLength) ? record.docLength : -1);
        pushTokens(c.identifiers, chunk.idOffset, chunk.idCount);
        if (includeLiterals) {
          pushLiterals(c.comments, chunk.commentOffset, chunk.commentCount);
          pushLiterals(c.strings, chunk.stringOffset, chunk.stringCount);
        } else {
          for (const col of [chunk.commentOffset, chunk.commentCount, chunk.stringOffset, chunk.stringCount]) col.push(-1);
        }
        break;
      }
      case 'posting':
        // A posting line in an unexpected spelling: counted, not embedded.
        postingLines += 1;
        break;
      default:
        fail(`unknown record type ${JSON.stringify(record?.record)}`);
    }
  };

  const finish = () => {
    if (header === null) fail('missing header record (file is empty)');
    if (chunk.node.length !== header.chunkCount) fail(`chunk count mismatch: header declares ${header.chunkCount}, found ${chunk.node.length}`);
    if (postingLines !== header.termCount) fail(`term count mismatch: header declares ${header.termCount}, found ${postingLines}`);

    const finishTable = (/** @type {Record<string, Int32Builder>} */ cols) => {
      const entries = Object.entries(cols).map(([k, b]) => [k, b.finish()]);
      return table(entries[0][1].length, Object.fromEntries(entries));
    };
    const chunks = finishTable(chunk);
    const literalsSegments = includeLiterals ? {
      'indexLiterals.strings': literalText.strings,
      indexLiterals: table(literals.length, { text: literals.finish() }),
    } : null;
    return {
      meta: {
        sourceRevision: header.sourceRevision ?? null,
        k1: header.k1, b: header.b, N: header.N, avgDocLength: header.avgDocLength,
        chunkCount: header.chunkCount, termCount: header.termCount,
        filesIndexed, filesContentUnavailable,
        literals: includeLiterals ? 'embedded' : 'omitted',
      },
      segments: {
        'index.chunks': chunks,
        'index.tokens': table(tokens.length, { token: tokens.finish() }),
      },
      /** Comment/string-literal text, or null when it was not read (--no-source). */
      literals: literalsSegments ? { bytes: literalText.bytes, segments: literalsSegments } : null,
      /** Mark the literals not embedded: offset/count columns become -1. */
      dropLiterals() {
        for (const name of ['commentOffset', 'commentCount', 'stringOffset', 'stringCount']) chunks.columns[name].fill(-1);
      },
    };
  };
  return { line: read, finish };
}
