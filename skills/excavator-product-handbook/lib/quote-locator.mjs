/**
 * Where a quoted text sits in the project (openspec change handbook-run-precision D4): a note about a quote that is not in its cited
 * passage says where the text is, so the writer can cite the right lines. The first place wins: the cited file, then the project's
 * files in walk order. Comparison is the label check's (entities decoded, white space made one space, case kept). Each file is read
 * and normalized at most once per locator; the project's file list is walked on the first search that needs it. Documents
 * (Markdown, plain text and the like) are never named: the writer reads code and configuration only. A file is normalized only
 * when its raw text holds the label's longest run of letters and digits, which entity encoding and white space never change, so
 * a label found nowhere costs one raw read of each file instead of a normalization of the whole project. Source files come before
 * the other files (configuration, templates, design mockups), so a label in code is named where the code has it.
 */

import { MAX_FILE_BYTES, walk } from './entrypoints.mjs';
import { languageOf } from './source-languages.mjs';
import { comparable } from './values.mjs';

/** The sentence a note gets when the text is nowhere in the project. */
export const NOT_IN_PROJECT = 'that text does not occur in any file of the project';

/** Files the writer never reads, so a note never points at one. */
const DOCUMENT_FILE = /\.(?:md|mdx|markdown|rst|adoc|txt)$/i;

/** The longest run of letters and digits in a label, or null when it has none of two characters or more. */
function probeOf(label) {
  const runs = String(label).match(/[\p{L}\p{N}]+/gu) ?? [];
  const longest = runs.reduce((best, run) => (run.length > best.length ? run : best), '');
  return longest.length >= 2 ? longest : null;
}

/** `{ joined, segments }` of a file: its non-empty normalized lines joined by one space, each with its line number and offset. */
function indexOf(text) {
  const segments = [];
  let joined = '';
  text.replace(/\r\n?/g, '\n').split('\n').forEach((raw, at) => {
    const line = comparable(raw);
    if (line === '') return;
    segments.push({ line: at + 1, start: joined === '' ? 0 : joined.length + 1 });
    joined = joined === '' ? line : `${joined} ${line}`;
  });
  return { joined, segments };
}

/** `find(label, citedFiles)` returns `file:line` of the first occurrence of `label`, or null. `files` is a project reader (project-files.mjs). */
export function quoteLocator(files) {
  const indexes = new Map();
  let list = null;
  const indexFile = (path) => {
    if (!indexes.has(path)) {
      const read = files.resolve(path);
      indexes.set(path, read.ok && !read.text.includes('\u0000') ? indexOf(read.text) : null);
    }
    return indexes.get(path);
  };
  const projectList = () => {
    if (list === null) {
      list = [];
      walk(files.root, null, { seen: 0, skipped: { symlink: 0, unreadable: 0 }, skippedDirectories: {} }, (rel, _abs, size) => {
        if (size <= MAX_FILE_BYTES && !DOCUMENT_FILE.test(rel)) list.push(rel);
      });
      list = [...list.filter((rel) => languageOf(rel) !== null), ...list.filter((rel) => languageOf(rel) === null)];
    }
    return list;
  };
  const lineIn = (path, needle, probe) => {
    if (probe !== null && !indexes.has(path)) {
      const read = files.resolve(path);
      if (!read.ok || !read.text.includes(probe)) return null;
    }
    const index = indexFile(path);
    if (index === null) return null;
    const at = index.joined.indexOf(needle);
    if (at === -1) return null;
    let found = index.segments[0];
    for (const segment of index.segments) {
      if (segment.start > at) break;
      found = segment;
    }
    return found.line;
  };
  return (label, citedFiles) => {
    const needle = comparable(label);
    if (needle === '') return null;
    const probe = probeOf(label);
    for (const path of [...citedFiles, ...projectList().filter((rel) => !citedFiles.includes(rel))]) {
      const line = lineIn(path, needle, probe);
      if (line !== null) return `${path}:${line}`;
    }
    return null;
  };
}
