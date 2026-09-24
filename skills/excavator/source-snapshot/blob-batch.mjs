/**
 * blob-batch.mjs
 *
 * Synchronous, batched blob-reading API over git's plumbing (design D1/D2,
 * snapshot-resolve-performance). Each exported function spawns
 * `blob-batch-worker.mjs` once per batch of at most BLOB_BATCH_SIZE objects
 * via `child_process.spawnSync` — one `git cat-file --batch` per worker
 * invocation, not one subprocess per file — so callers (GitCommitSnapshot)
 * keep the fully synchronous surface every consumer already relies on.
 *
 * `opts.spawnSync` is an injectable seam (defaults to the real
 * `node:child_process.spawnSync`) purely so tests can count/observe worker
 * invocations without touching real git. `opts.batchSize` overrides
 * BLOB_BATCH_SIZE, for tests that want to exercise multi-batch behavior on a
 * small fixture instead of needing 4,096+ real objects.
 *
 * A missing git object never aborts the worker (see blob-batch-worker.mjs).
 * `readBlobPrefixes` and `hashBlobs` see it inline in their own per-index
 * output (a `null` prefix/digest) and turn that into their documented
 * null-slot / `BlobBatchError` behavior directly. `writeBlobs` and
 * `searchBlobs` have no per-item output slot for a missing object, so the
 * worker additionally reports it via a `BLOB_BATCH_MISSING <json indices>`
 * line on stderr, parsed by `missingIndicesFromStderr` below into a
 * `BlobBatchError`.
 */
import { spawnSync as realSpawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, 'blob-batch-worker.mjs');

/** Objects per worker invocation. A `prefix` batch's stdout is bounded by
 *  roughly BLOB_BATCH_SIZE * prefixBytes (~16MB at the 4096-byte private-key
 *  prefix length); `write` and `search` hold at most one blob at a time
 *  inside the worker regardless of batch size, so they do not scale with it. */
export const BLOB_BATCH_SIZE = 4096;

// Generous ceiling for the worker's stdout, matching the ceiling git-utils.mjs
// already uses for single `git show` calls on this codebase's large-repo path.
const MAX_BUFFER = 1024 * 1024 * 1024; // 1GB

export class BlobBatchError extends Error {
  constructor(message, { cwd, mode, paths } = {}) {
    super(message);
    this.name = 'BlobBatchError';
    this.cwd = cwd;
    this.mode = mode;
    this.paths = paths ?? [];
  }
}

function chunk(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/** Run one batch through the worker and return its raw spawnSync result. */
function runBatch(cwd, mode, items, extra, opts) {
  const spawnSyncFn = opts.spawnSync ?? realSpawnSync;
  const job = JSON.stringify({ cwd, mode, items, ...extra });
  const result = spawnSyncFn(process.execPath, [WORKER_PATH], {
    input: job,
    cwd,
    maxBuffer: MAX_BUFFER,
  });
  if (result.error) {
    throw new BlobBatchError(`blob-batch worker failed to start (mode=${mode}): ${result.error.message}`, { cwd, mode });
  }
  if (result.status !== 0) {
    const stderrText = result.stderr ? result.stderr.toString('utf-8') : '';
    throw new BlobBatchError(`blob-batch worker exited ${result.status} (mode=${mode}): ${stderrText.trim()}`, { cwd, mode });
  }
  return result;
}

/** Extract the missing-object indices the worker reported on stderr, if any. */
function missingIndicesFromStderr(result) {
  const stderrText = result.stderr ? result.stderr.toString('utf-8') : '';
  const match = stderrText.match(/BLOB_BATCH_MISSING (\[[^\]]*\])/);
  return match ? JSON.parse(match[1]) : [];
}

function parsePrefixFrames(stdout, expectedCount) {
  const frames = new Array(expectedCount).fill(null);
  let pos = 0;
  for (let seen = 0; seen < expectedCount; seen++) {
    const nl = stdout.indexOf(0x0a, pos);
    const header = stdout.subarray(pos, nl).toString('utf-8');
    const spaceIndex = header.indexOf(' ');
    const localIndex = Number(header.slice(0, spaceIndex));
    const len = Number(header.slice(spaceIndex + 1));
    pos = nl + 1;
    if (len < 0) {
      frames[localIndex] = null;
    } else {
      frames[localIndex] = Buffer.from(stdout.subarray(pos, pos + len));
      pos += len;
    }
  }
  return frames;
}

/**
 * @param {string} cwd repo working-tree root git commands run in
 * @param {Array<{oid:string,path:string}>} items
 * @param {number} prefixBytes
 * @param {{spawnSync?: Function, batchSize?: number}} [opts]
 * @returns {Array<Buffer|null>} aligned to `items`; null for a missing object
 */
export function readBlobPrefixes(cwd, items, prefixBytes, opts = {}) {
  const batchSize = opts.batchSize ?? BLOB_BATCH_SIZE;
  const results = [];
  for (const batchItems of chunk(items, batchSize)) {
    const result = runBatch(cwd, 'prefix', batchItems, { prefixBytes }, opts);
    results.push(...parsePrefixFrames(result.stdout, batchItems.length));
  }
  return results;
}

/**
 * @param {string} cwd
 * @param {Array<{oid:string,path:string}>} items
 * @param {{spawnSync?: Function, batchSize?: number}} [opts]
 * @returns {string[]} content hashes aligned to `items`; throws on any missing object
 */
export function hashBlobs(cwd, items, opts = {}) {
  const batchSize = opts.batchSize ?? BLOB_BATCH_SIZE;
  const results = [];
  for (const batchItems of chunk(items, batchSize)) {
    const result = runBatch(cwd, 'hash', batchItems, {}, opts);
    const localResults = new Array(batchItems.length).fill(null);
    for (const line of result.stdout.toString('utf-8').split('\n')) {
      if (!line) continue;
      const [localIndex, digest] = JSON.parse(line);
      localResults[localIndex] = digest;
    }
    results.push(...localResults);
  }
  const missing = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i] === null) missing.push(items[i].path);
  }
  if (missing.length > 0) {
    throw new BlobBatchError(`blob-batch: missing git object(s) for: ${missing.join(', ')}`, { cwd, mode: 'hash', paths: missing });
  }
  return results;
}

/**
 * Write every item's blob to `destDir/<path>`, creating parent directories.
 *
 * @param {string} cwd
 * @param {Array<{oid:string,path:string}>} items
 * @param {string} destDir
 * @param {{spawnSync?: Function, batchSize?: number}} [opts]
 */
export function writeBlobs(cwd, items, destDir, opts = {}) {
  const batchSize = opts.batchSize ?? BLOB_BATCH_SIZE;
  for (const batchItems of chunk(items, batchSize)) {
    const result = runBatch(cwd, 'write', batchItems, { dest: destDir }, opts);
    const missingIndices = missingIndicesFromStderr(result);
    if (missingIndices.length > 0) {
      const missing = missingIndices.map((i) => batchItems[i].path);
      throw new BlobBatchError(`blob-batch: missing git object(s) for: ${missing.join(', ')}`, { cwd, mode: 'write', paths: missing });
    }
  }
}

/**
 * @param {string} cwd
 * @param {Array<{oid:string,path:string}>} items
 * @param {string[]} terms
 * @param {{spawnSync?: Function, batchSize?: number}} [opts]
 * @returns {Array<{path:string,line:number,text:string,term:string}>}
 */
export function searchBlobs(cwd, items, terms, opts = {}) {
  const batchSize = opts.batchSize ?? BLOB_BATCH_SIZE;
  const results = [];
  for (const batchItems of chunk(items, batchSize)) {
    const result = runBatch(cwd, 'search', batchItems, { terms }, opts);
    const missingIndices = missingIndicesFromStderr(result);
    if (missingIndices.length > 0) {
      const missing = missingIndices.map((i) => batchItems[i].path);
      throw new BlobBatchError(`blob-batch: missing git object(s) for: ${missing.join(', ')}`, { cwd, mode: 'search', paths: missing });
    }
    for (const line of result.stdout.toString('utf-8').split('\n')) {
      if (!line) continue;
      results.push(JSON.parse(line));
    }
  }
  return results;
}
