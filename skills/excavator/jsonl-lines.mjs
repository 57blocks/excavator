/**
 * jsonl-lines.mjs
 *
 * Shared line-oriented file I/O for the `.jsonl` products
 * (`source-index.jsonl`, `knowledge-graph.jsonl`, `structure-all.jsonl`;
 * openspec: changes/knowledge-graph-line-store, design D2). Neither writing
 * nor reading ever holds a whole product in one string: a product is a
 * sequence of lines, each one JSON record, so the longest string involved is
 * the longest single line.
 *
 * Writer (`writeLineFile`): the caller pushes already-serialized lines; they
 * are buffered and flushed through one file descriptor roughly every 8 MB of
 * characters (a batching heuristic, not a correctness requirement). Every
 * line, including the last, ends in '\n'.
 *
 * Reader (`readLineFile`): synchronous, because every caller already uses
 * these products synchronously. Reads fixed-size blocks via `readSync` and
 * decodes each through a `StringDecoder('utf8')`, so a multi-byte UTF-8
 * character split across a block boundary is never misread, then splits on
 * '\n'. A non-empty final segment without a trailing '\n' is still a line;
 * the empty segment after a well-formed file's last '\n' is not.
 *
 * This module only moves lines. Parsing, record validation and the product's
 * own format live in each product's store module.
 */

import { closeSync, openSync, readSync, statSync, writeSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

/** Flush the writer's line buffer roughly every this many characters (a
 *  cheap proxy for bytes). */
const FLUSH_THRESHOLD_CHARS = 8 * 1024 * 1024;

/** Default read block size. Callers (mainly tests) may pass a much smaller
 *  `blockSize` to exercise multi-byte characters split across a block
 *  boundary. */
export const DEFAULT_READ_BLOCK_SIZE = 4 * 1024 * 1024;

/**
 * Write a line file. `writeAll` receives `push(line)` and calls it once per
 * line, in order; `line` must not contain '\n'.
 *
 * @param {string} path
 * @param {(push: (line: string) => void) => void} writeAll
 * @returns {{ bytes: number, lines: number, maxLineChars: number }}
 */
export function writeLineFile(path, writeAll) {
  const fd = openSync(path, 'w');
  let buffered = [];
  let bufferedChars = 0;
  let lines = 0;
  let maxLineChars = 0;

  function flush() {
    if (buffered.length === 0) return;
    writeSync(fd, buffered.join('\n') + '\n');
    buffered = [];
    bufferedChars = 0;
  }

  function push(line) {
    if (line.length > maxLineChars) maxLineChars = line.length;
    buffered.push(line);
    bufferedChars += line.length + 1; // +1 for the '\n' this line gets on flush
    lines += 1;
    if (bufferedChars >= FLUSH_THRESHOLD_CHARS) flush();
  }

  try {
    writeAll(push);
    flush();
  } finally {
    closeSync(fd);
  }

  // The real on-disk size, not the char-based estimate above: UTF-8 byte
  // length differs from character count for non-ASCII content.
  return { bytes: statSync(path).size, lines, maxLineChars };
}

/**
 * Read a line file, calling `onLine(line)` for each line in order. If
 * `onLine` returns `false`, reading stops there (used to read only a file's
 * header line).
 *
 * @param {string} path
 * @param {(line: string) => (boolean|void)} onLine
 * @param {{ blockSize?: number }} [options]
 */
export function readLineFile(path, onLine, { blockSize = DEFAULT_READ_BLOCK_SIZE } = {}) {
  const fd = openSync(path, 'r');
  try {
    const decoder = new StringDecoder('utf8');
    const block = Buffer.allocUnsafe(blockSize);
    let carry = '';
    let stopped = false;

    function consumeText(text, { final = false } = {}) {
      const parts = (carry + text).split('\n');
      carry = parts.pop();
      for (const part of parts) {
        if (onLine(part) === false) {
          stopped = true;
          return;
        }
      }
      if (final && carry.length > 0) onLine(carry);
    }

    for (let bytesRead; !stopped && (bytesRead = readSync(fd, block, 0, block.length, null)) > 0;) {
      consumeText(decoder.write(block.subarray(0, bytesRead)));
    }
    if (!stopped) consumeText(decoder.end(), { final: true });
  } finally {
    closeSync(fd);
  }
}

export default { DEFAULT_READ_BLOCK_SIZE, writeLineFile, readLineFile };
