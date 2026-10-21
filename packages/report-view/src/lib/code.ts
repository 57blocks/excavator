/**
 * The Code page's pure functions (openspec: changes/viewer-app, design D5):
 * line ranges, the file tree, the path filter and the wording of the five
 * classes a referenced file can fall into. The class and range rules are the
 * ones the Code page and the code drawer share.
 */

import type { SourceBucket, SourceManifest } from '../data/manifest';
import { formatNumber } from './format';
import { buildHash } from './route';

export const BUCKETS: readonly SourceBucket[] = ['embedded', 'binary', 'tooLarge', 'notInSnapshot', 'notEmbeddedOnRequest'];

const BUCKET_LABELS: Record<SourceBucket, string> = {
  embedded: 'Embedded',
  binary: 'Binary',
  tooLarge: 'Too large',
  notInSnapshot: 'Not in snapshot',
  notEmbeddedOnRequest: 'Not embedded on request',
};

export interface LineRange {
  start: number;
  end: number;
}

/** '12' gives {start:12,end:12}; '12-20' gives {start:12,end:20}; anything else, including 0 and a reversed range, gives null. */
export function parseLines(text: unknown): LineRange | null {
  if (typeof text !== 'string') return null;
  const match = /^(\d+)(?:-(\d+))?$/.exec(text);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  const end = match[2] === undefined ? start : parseInt(match[2], 10);
  if (start < 1 || end < start) return null;
  return { start, end };
}

/** The text a link carries for a product's line range: [a, b], a number, or an already formatted 'a-b'; null when there is none. */
export function rangeText(range: unknown): string | null {
  if (Array.isArray(range) && range.length >= 1 && typeof range[0] === 'number') {
    const last = typeof range[1] === 'number' ? range[1] : range[0];
    return range[0] === last ? String(range[0]) : `${range[0]}-${last}`;
  }
  if (typeof range === 'number') return String(range);
  if (typeof range === 'string' && parseLines(range)) return range;
  return null;
}

/** The hash of the Code page for a file, and for the lines of it when a range is given. */
export function codeHash(path: string, range?: unknown): string {
  return buildHash('code', { path, lines: rangeText(range) });
}

/** The lines of a text: a final newline does not start another line, and an empty text has none. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

export type LineStatus =
  | { state: 'none' }
  | { state: 'invalid'; text: string }
  | { state: 'out-of-range'; line: number; start: number; end: number }
  | { state: 'ok'; start: number; end: number };

/**
 * What a requested range means for a file of `lineCount` lines:
 * none (no range asked), invalid (not a range), out-of-range (some line is past the end; `line` is the first
 * missing one and nothing is highlighted), or ok.
 */
export function lineStatus(linesParam: string | null | undefined, lineCount: number): LineStatus {
  if (linesParam === undefined || linesParam === null || linesParam === '') return { state: 'none' };
  const range = parseLines(linesParam);
  if (!range) return { state: 'invalid', text: String(linesParam) };
  if (range.end > lineCount) return { state: 'out-of-range', line: Math.max(range.start, lineCount + 1), start: range.start, end: range.end };
  return { state: 'ok', start: range.start, end: range.end };
}

export function bucketLabel(bucket: string): string {
  return Object.hasOwn(BUCKET_LABELS, bucket) ? BUCKET_LABELS[bucket as SourceBucket] : bucket;
}

/** The sentence that says why a file is not shown. */
export function bucketReason(bucket: string, info: { bytes?: number | null }, source: Pick<SourceManifest, 'limitBytes'>, snapshotRevision: string): string {
  if (bucket === 'tooLarge') {
    return `This file is ${formatNumber(info.bytes)} bytes; the limit for embedding a file is ${formatNumber(source.limitBytes)} bytes.`;
  }
  if (bucket === 'notEmbeddedOnRequest') return 'The page was packed without source text (--no-source); no file text is embedded.';
  if (bucket === 'binary') return 'This file is not text (a NUL byte in its first 8 KiB), so it is not embedded.';
  if (bucket === 'notInSnapshot') return `This path is not in the source snapshot (${snapshotRevision}).`;
  return '';
}

export interface SourceEntry {
  path: string;
  bucket: string;
  bytes: number | null;
}

/** [{path, bucket, bytes}] from the manifest's source.files, sorted by path. */
export function entriesFromSource(source: Pick<SourceManifest, 'files'> | undefined): SourceEntry[] {
  const files = source?.files ?? {};
  return Object.keys(files).sort().map((path) => ({
    path,
    bucket: files[path].bucket,
    bytes: typeof files[path].bytes === 'number' ? (files[path].bytes as number) : null,
  }));
}

/** Entries whose path contains `query` (case-insensitive); an empty query keeps all. */
export function filterEntries(entries: readonly SourceEntry[], query: string): readonly SourceEntry[] {
  const q = (query || '').trim().toLowerCase();
  if (q === '') return entries;
  return entries.filter((entry) => entry.path.toLowerCase().includes(q));
}

export interface TreeFile {
  name: string;
  path: string;
  bucket: string;
}

export interface TreeNode {
  name: string;
  path: string;
  dirs: TreeNode[];
  files: TreeFile[];
  count: number;
}

interface BuildNode {
  name: string;
  path: string;
  dirs: Map<string, BuildNode>;
  files: TreeFile[];
  count: number;
}

function finishTree(node: BuildNode): TreeNode {
  return {
    name: node.name,
    path: node.path,
    dirs: [...node.dirs.keys()].sort().map((name) => finishTree(node.dirs.get(name) as BuildNode)),
    files: node.files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    count: node.count,
  };
}

/** The directory tree of the entries: directories first, each sorted by name; a directory counts every file under it. */
export function buildTree(entries: readonly Pick<SourceEntry, 'path' | 'bucket'>[]): TreeNode {
  const root: BuildNode = { name: '', path: '', dirs: new Map(), files: [], count: 0 };
  for (const entry of entries) {
    const parts = entry.path.split('/').filter((part) => part !== '');
    let node = root;
    node.count += 1;
    for (const name of parts.slice(0, -1)) {
      let child = node.dirs.get(name);
      if (!child) {
        child = { name, path: node.path === '' ? name : `${node.path}/${name}`, dirs: new Map(), files: [], count: 0 };
        node.dirs.set(name, child);
      }
      node = child;
      node.count += 1;
    }
    node.files.push({ name: parts.length > 0 ? parts[parts.length - 1] : entry.path, path: entry.path, bucket: entry.bucket });
  }
  return finishTree(root);
}

/** The state the Code page shows in the navigation: included with embedded files, different revision when only absent paths are named, else not run. */
export function codeStatus(counts: Record<SourceBucket, number>): 'included' | 'different-revision' | 'not-run' {
  if (counts.embedded > 0) return 'included';
  return counts.notInSnapshot > 0 ? 'different-revision' : 'not-run';
}
