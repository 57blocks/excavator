/**
 * read-evidence.mjs
 *
 * The lines a Full-mode subagent must read for one fact node, and the check
 * that a model-written semantic patch or verdict quotes one of them
 * (openspec: changes/semantic-read-evidence).
 *
 * A node's `readRange` is its `lineRange` when it has one; a node without one
 * (a file node, for example) reads the head of its file. Phase F2's batch
 * planner sizes batches by these ranges, and the commit scripts check every
 * quoted line against the same range, so what the analyzer is asked to read
 * and what it must cite are one definition.
 *
 * Pure: callers pass the file's lines in. Calls no model.
 */

import { readFileSync } from 'node:fs';
import { resolveWithinRoot } from './validate-graph.mjs';

/** Lines a node without a lineRange reads: the head of its file. */
export const FILE_HEAD_LINES = 300;

/** A quote shorter than this (non-whitespace characters) must cover its whole line. */
export const MIN_QUOTE_CHARS = 8;

/** Split file text into lines; a trailing newline does not add an empty line. */
export function splitSourceLines(text) {
  const lines = String(text).split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

function isLineNumber(value) {
  return Number.isInteger(value) && value >= 1;
}

function hasLineRange(node) {
  const range = node?.lineRange;
  return Array.isArray(range) && range.length === 2 && isLineNumber(range[0]) && isLineNumber(range[1])
    && range[1] >= range[0];
}

/**
 * The 1-based inclusive line range a subagent reads for `node`, or null when
 * there is nothing to read (an unreadable or empty file).
 *
 * @param {{ lineRange?: [number, number] }} node
 * @param {number|null} lineCount the file's line count, null when unreadable
 * @returns {[number, number]|null}
 */
export function readRangeFor(node, lineCount) {
  if (!Number.isInteger(lineCount) || lineCount < 1) return null;
  if (hasLineRange(node)) return [node.lineRange[0], node.lineRange[1]];
  return [1, Math.min(lineCount, FILE_HEAD_LINES)];
}

/**
 * Reader of project files with a per-path cache. A path outside the project
 * root is never read and reads as null, the same as a missing file.
 */
export function createLineReader(projectRoot) {
  const cache = new Map();
  return (filePath) => {
    if (!cache.has(filePath)) {
      const absolute = resolveWithinRoot(projectRoot, filePath);
      let lines = null;
      if (absolute !== null) {
        try {
          lines = splitSourceLines(readFileSync(absolute, 'utf-8'));
        } catch {
          lines = null;
        }
      }
      cache.set(filePath, lines);
    }
    return cache.get(filePath);
  };
}

function collapse(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function nonWhitespaceLength(text) {
  return String(text).replace(/\s+/g, '').length;
}

/**
 * Check that `evidence` quotes a line the subagent must have read for `node`.
 * The first failing rule decides the status:
 *
 * - `evidence-missing`: no evidence, `line` not a positive integer, or `quote`
 *   not a one-line string;
 * - `evidence-source-unreadable`: `lines` is null (missing, unreadable or
 *   outside the project root);
 * - `evidence-line-outside-range`: `line` is outside the node's `readRange`;
 * - `evidence-declaration-line`: the node spans several lines and `line` is
 *   the first, which the node's name alone lets a writer guess;
 * - `evidence-quote-trivial`: the quote has no letter or digit, or fewer than
 *   `min(MIN_QUOTE_CHARS, the line's)` non-whitespace characters;
 * - `evidence-quote-not-on-line`: with whitespace runs collapsed, the quote is
 *   not a substring of the cited line.
 *
 * @param {{ evidence: unknown, node: { lineRange?: [number, number] }, lines: string[]|null }} args
 * @returns {{ ok: true } | { ok: false, status: string }}
 */
export function checkReadEvidence({ evidence, node, lines }) {
  const line = evidence?.line;
  const quote = evidence?.quote;
  if (!isLineNumber(line) || typeof quote !== 'string' || /[\r\n]/.test(quote)) {
    return { ok: false, status: 'evidence-missing' };
  }
  if (!Array.isArray(lines)) return { ok: false, status: 'evidence-source-unreadable' };
  const range = readRangeFor(node, lines.length);
  if (range === null || line < range[0] || line > range[1] || line > lines.length) {
    return { ok: false, status: 'evidence-line-outside-range' };
  }
  if (hasLineRange(node) && node.lineRange[1] > node.lineRange[0] && line === node.lineRange[0]) {
    return { ok: false, status: 'evidence-declaration-line' };
  }
  const sourceLine = lines[line - 1];
  const needed = Math.min(MIN_QUOTE_CHARS, nonWhitespaceLength(sourceLine));
  if (!/[\p{L}\p{N}]/u.test(quote) || nonWhitespaceLength(quote) < Math.max(1, needed)) {
    return { ok: false, status: 'evidence-quote-trivial' };
  }
  if (!collapse(sourceLine).includes(collapse(quote))) {
    return { ok: false, status: 'evidence-quote-not-on-line' };
  }
  return { ok: true };
}

const LINE_REFERENCE = /\blines?\s+\d+/i;
const FILE_LINE_REFERENCE = /[\w.-]+\.[A-Za-z][\w]*:\d+/;

/**
 * True when `text` transcribes the node's anchor instead of describing the
 * code: a line reference (`line 12`, `lines 12-31`), a `<file>.<ext>:<n>`
 * reference, or the node's own path when the path has a directory. A file at
 * the project root may name itself; its name is not a location.
 *
 * @param {unknown} text
 * @param {{ filePath?: string }} node
 */
export function citesAnchor(text, node) {
  if (typeof text !== 'string') return false;
  if (LINE_REFERENCE.test(text) || FILE_LINE_REFERENCE.test(text)) return true;
  const filePath = node?.filePath;
  return typeof filePath === 'string' && filePath.includes('/') && text.includes(filePath);
}
