/**
 * file-reader.mjs
 *
 * The page's file access for a dropped or picked `.excavator/` directory: the
 * `DataDirReader` (parse-data-dir.mjs) over File API objects (`Blob.stream()`
 * through a `TextDecoderStream`, line by line). Nothing leaves the browser:
 * files are read where they are. Uses only Web APIs (also present in Node
 * >= 22, so tests run it as is); no `node:` import.
 */

import { ARTIFACT_NAMES } from './inventory-rules.mjs';

const KNOWLEDGE_GRAPH = 'knowledge-graph.jsonl';
const MANIFEST = 'source-manifest.json';

/**
 * @typedef {{ path: string, file: Blob }} DroppedFile
 * `path`: the file's path relative to what was dropped or picked, with `/`
 * separators (a picked directory's `webkitRelativePath`, e.g.
 * `my-project/.excavator/knowledge-graph.jsonl`).
 */

/** @param {string} path */
function parentOf(path) {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

/** @param {string} dir */
function depth(dir) {
  return dir === '' ? 0 : dir.split('/').length;
}

/**
 * Find the data directory among the dropped files: the shallowest directory
 * holding `knowledge-graph.jsonl` (else the shallowest holding
 * `source-manifest.json`, else the shallowest directory with any file), and
 * the artifacts directly in it. Files below it (`intermediate/`) and
 * elsewhere are never read; they are counted in `ignored`.
 *
 * @param {DroppedFile[]} entries
 * @returns {{ directory: string, files: Map<string, Blob>, ignored: number }}
 */
export function locateDataDirectory(entries) {
  const normalized = entries.map((e) => ({ path: e.path.replace(/\\/g, '/').replace(/^\/+/, ''), file: e.file }));
  const dirsWith = (/** @type {string} */ name) => normalized
    .filter((e) => e.path === name || e.path.endsWith(`/${name}`))
    .map((e) => parentOf(e.path));
  const shallowest = (/** @type {string[]} */ dirs) => [...dirs].sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0))[0];
  let candidates = dirsWith(KNOWLEDGE_GRAPH);
  if (candidates.length === 0) candidates = dirsWith(MANIFEST);
  if (candidates.length === 0) candidates = normalized.map((e) => parentOf(e.path));
  const directory = candidates.length === 0 ? '' : shallowest(candidates);
  /** @type {Map<string, Blob>} */
  const files = new Map();
  let ignored = 0;
  for (const entry of normalized) {
    const name = entry.path.slice(directory === '' ? 0 : directory.length + 1);
    if (parentOf(entry.path) === directory && ARTIFACT_NAMES.includes(name)) files.set(name, entry.file);
    else ignored += 1;
  }
  return { directory, files, ignored };
}

/**
 * Split decoded text chunks into lines the way Node's readline does with
 * `crlfDelay: Infinity`: CR LF, LF and a lone CR each end a line; a final
 * line without a break is yielded; nothing is yielded after a final break.
 *
 * @param {AsyncIterable<string>} chunks
 * @returns {AsyncGenerator<string>}
 */
export async function* splitLines(chunks) {
  let buffer = '';
  let scanFrom = 0;
  for await (const chunk of chunks) {
    buffer += chunk;
    let start = 0;
    let i = scanFrom;
    for (; i < buffer.length; i += 1) {
      const c = buffer.charCodeAt(i);
      if (c === 10) {
        yield buffer.slice(start, i);
        start = i + 1;
      } else if (c === 13) {
        if (i + 1 === buffer.length) break; // a CR LF may straddle chunks
        yield buffer.slice(start, i);
        if (buffer.charCodeAt(i + 1) === 10) i += 1;
        start = i + 1;
      }
    }
    buffer = buffer.slice(start);
    scanFrom = i - start;
  }
  if (buffer.endsWith('\r')) yield buffer.slice(0, -1);
  else if (buffer.length > 0) yield buffer;
}

/** @param {ReadableStream<any>} stream */
async function* iterate(stream) {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * @param {{ directory: string, files: Map<string, Blob> }} located
 * @returns {import('./parse-data-dir.mjs').DataDirReader & { sizeOf(name: string): number | null }}
 */
export function fileDataDirReader({ directory, files }) {
  const blob = (/** @type {string} */ name) => {
    const file = files.get(name);
    if (!file) throw new Error(`${name} is not in the dropped directory`);
    return file;
  };
  return {
    sizeOf: (name) => files.get(name)?.size ?? null,
    path: (name) => (directory === '' ? name : `${directory}/${name}`),
    lines: (name) => splitLines(iterate(blob(name).stream().pipeThrough(new TextDecoderStream('utf-8')))),
    chunks: (name) => iterate(blob(name).stream()),
    text: (name) => blob(name).text(),
  };
}
