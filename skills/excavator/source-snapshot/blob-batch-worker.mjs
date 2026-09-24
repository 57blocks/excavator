/**
 * blob-batch-worker.mjs
 *
 * Helper process for blob-batch.mjs (design D1, snapshot-resolve-performance).
 * Reads ONE JSON job from stdin, spawns a SINGLE `git cat-file --batch` in
 * `job.cwd`, and parses its output strictly one object at a time so no blob
 * is ever buffered whole beyond what each mode actually needs (a `prefix`
 * capture is bounded; `hash` never retains bytes; `write`/`search` hold one
 * object at a time, matching the memory profile of today's per-file `git
 * show`).
 *
 * Job shape (JSON on stdin):
 *   { cwd, mode: 'prefix'|'hash'|'write'|'search', items: [{oid, path}],
 *     prefixBytes?, dest?, terms? }
 *
 * stdout (mode-dependent):
 *   - prefix: binary frames `<index> <len>\n<bytes>`, one per item in input
 *             order; len is -1 for a missing object (no bytes follow).
 *   - hash:   one JSON line `[index, hexDigestOrNull]` per item, in order.
 *   - write:  nothing; each blob is written to `dest/<path>`.
 *   - search: JSON lines `{path, line, text, term}` in the same order the
 *             existing per-file GitCommitSnapshot.search() would produce.
 *
 * A missing object never aborts the run — the object is "processed" (the
 * index still advances) so the overall count check below stays meaningful
 * as a protocol-desync guard rather than a "some blob is missing" guard.
 * Whenever at least one object was missing, a machine-readable summary line
 * is written to stderr (`BLOB_BATCH_MISSING <json array of indices>`) so
 * blob-batch.mjs can turn it into a `BlobBatchError` for the modes whose
 * public contract does not have a null/-1 slot to report it inline (write,
 * search).
 *
 * Exit code is non-zero when `git cat-file --batch` itself fails, or when
 * the number of objects it produced does not match `items.length` — either
 * signals a framing desync that must never be silently swallowed.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const NEWLINE = 0x0a;
const MODES = new Set(['prefix', 'hash', 'write', 'search']);

function readStdin() {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolvePromise(Buffer.concat(chunks)));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const raw = await readStdin();
  let job;
  try {
    job = JSON.parse(raw.toString('utf-8'));
  } catch (err) {
    process.stderr.write(`blob-batch-worker: invalid job JSON: ${err.message}\n`);
    process.exitCode = 2;
    return;
  }

  const { cwd, mode, items, prefixBytes, dest, terms } = job;
  if (!MODES.has(mode)) {
    process.stderr.write(`blob-batch-worker: unknown mode "${mode}"\n`);
    process.exitCode = 2;
    return;
  }
  if (!Array.isArray(items) || items.length === 0) {
    process.exitCode = 0;
    return;
  }

  await runBatch({ cwd, mode, items, prefixBytes, dest, terms });
}

function runBatch({ cwd, mode, items, prefixBytes, dest, terms }) {
  return new Promise((resolveDone, rejectDone) => {
    const git = spawn('git', ['cat-file', '--batch'], { cwd, stdio: ['pipe', 'pipe', 'inherit'] });

    // Batch small stdout writes into fewer syscalls, but never hold more
    // than FLUSH_THRESHOLD bytes of already-finished output in memory.
    const outChunks = [];
    let outLen = 0;
    const FLUSH_THRESHOLD = 4 * 1024 * 1024;
    function emit(buf) {
      outChunks.push(buf);
      outLen += buf.length;
      if (outLen >= FLUSH_THRESHOLD) flush();
    }
    function flush() {
      if (outChunks.length === 0) return;
      process.stdout.write(Buffer.concat(outChunks));
      outChunks.length = 0;
      outLen = 0;
    }

    let index = 0;
    let buffered = Buffer.alloc(0);
    let need = null; // remaining bytes (content + trailing framing '\n') for the current object
    let kept = []; // 'prefix' mode: prefix chunks collected so far for the current object
    let keptLen = 0;
    let hasher = null; // 'hash' mode
    let whole = []; // 'write'/'search' modes: full content of the current object
    const missingIndices = [];

    function finishPresentObject() {
      const item = items[index];
      if (mode === 'prefix') {
        const prefixBuf = Buffer.concat(kept);
        emit(Buffer.from(`${index} ${prefixBuf.length}\n`));
        emit(prefixBuf);
      } else if (mode === 'hash') {
        emit(Buffer.from(`${JSON.stringify([index, hasher.digest('hex')])}\n`));
      } else if (mode === 'write') {
        const target = join(dest, item.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, Buffer.concat(whole));
      } else if (mode === 'search') {
        const bytes = Buffer.concat(whole);
        if (!bytes.includes(0)) {
          const lines = bytes.toString('utf-8').split('\n');
          for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            for (const term of terms) {
              if (lines[lineIndex].includes(term)) {
                emit(Buffer.from(`${JSON.stringify({ path: item.path, line: lineIndex + 1, text: lines[lineIndex], term })}\n`));
              }
            }
          }
        }
      }
      index++;
      kept = [];
      keptLen = 0;
      hasher = null;
      whole = [];
    }

    function finishMissingObject() {
      missingIndices.push(index);
      if (mode === 'prefix') emit(Buffer.from(`${index} -1\n`));
      else if (mode === 'hash') emit(Buffer.from(`${JSON.stringify([index, null])}\n`));
      // 'write'/'search': nothing to write for a missing object; the caller
      // (blob-batch.mjs) turns `missingIndices` (below, via stderr) into a
      // BlobBatchError for those two modes.
      index++;
    }

    git.stdin.end(items.map((item) => item.oid).join('\n') + '\n');

    git.stdout.on('data', (chunk) => {
      buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk;
      for (;;) {
        if (need === null) {
          const nl = buffered.indexOf(NEWLINE);
          if (nl < 0) break;
          const header = buffered.subarray(0, nl).toString('utf-8');
          buffered = buffered.subarray(nl + 1);
          if (header.endsWith(' missing')) {
            finishMissingObject();
            continue;
          }
          const size = Number(header.split(' ')[2]);
          if (!Number.isInteger(size) || size < 0) {
            rejectDone(new Error(`blob-batch-worker: malformed cat-file header: ${header}`));
            return;
          }
          need = size + 1; // +1 for the trailing newline git appends after object content
          if (mode === 'hash') hasher = createHash('sha256');
        }
        if (buffered.length === 0) break;
        const take = Math.min(need, buffered.length);
        const part = buffered.subarray(0, take);
        buffered = buffered.subarray(take);
        need -= take;
        // Once `need` reaches 0 the last byte just consumed SHOULD be the
        // trailing framing newline, not object content. Strict framing
        // (design D1's "帧格式严格" risk mitigation): verify it actually is
        // a newline before stripping it — a desynced stream must fail
        // loudly here rather than silently eating a content byte.
        if (need === 0 && part[part.length - 1] !== NEWLINE) {
          rejectDone(new Error(
            `blob-batch-worker: expected trailing newline after object content `
            + `(index ${index}, mode=${mode}, got byte 0x${part[part.length - 1].toString(16).padStart(2, '0')})`,
          ));
          return;
        }
        const content = need === 0 ? part.subarray(0, part.length - 1) : part;
        if (mode === 'prefix') {
          if (keptLen < prefixBytes) {
            const slice = content.subarray(0, prefixBytes - keptLen);
            kept.push(Buffer.from(slice));
            keptLen += slice.length;
          }
        } else if (mode === 'hash') {
          hasher.update(content);
        } else {
          whole.push(Buffer.from(content));
        }
        if (need === 0) {
          need = null;
          finishPresentObject();
        }
      }
    });

    git.on('error', (err) => rejectDone(err));
    git.on('close', (code) => {
      flush();
      if (missingIndices.length > 0) {
        process.stderr.write(`BLOB_BATCH_MISSING ${JSON.stringify(missingIndices)}\n`);
      }
      if (code !== 0) {
        process.stderr.write(`blob-batch-worker: git cat-file --batch exited ${code}\n`);
        process.exitCode = 2;
      } else if (index !== items.length) {
        process.stderr.write(`blob-batch-worker: processed ${index}/${items.length} objects\n`);
        process.exitCode = 2;
      }
      resolveDone();
    });
  });
}

main().catch((err) => {
  process.stderr.write(`blob-batch-worker: ${(err && err.stack) || err}\n`);
  process.exitCode = 2;
});
