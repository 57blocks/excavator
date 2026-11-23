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
