/**
 * blob-lines.mjs
 *
 * Line counts for the hotspot census. A file's size is the number of lines of
 * its HEAD content: the number of newline characters, plus one when the last
 * line has no newline and the content is not empty. A file is binary when a NUL
 * byte occurs in its first 8000 bytes, the same test git applies.
 *
 * Git blobs are read through `git cat-file --batch`, one process per batch of
 * objects (not one per file), and counted as they stream past, so memory does
 * not grow with blob size or batch size.
 */

import { spawn } from 'node:child_process';

import { BLOB_BATCH_SIZE } from '../source-snapshot/blob-batch.mjs';

const NEWLINE = 0x0a;

/** git's own binary probe length (xdiff's FIRST_FEW_BYTES). */
export const BINARY_PROBE_BYTES = 8000;

/** Accumulates one object's content, in any number of pieces. */
export class LineCounter {
  constructor() {
    this.size = 0;
    this.newlines = 0;
    this.last = -1;
    this.nul = false;
  }

  /** @param {Buffer} buf */
  push(buf) {
    if (!this.nul && this.size < BINARY_PROBE_BYTES) {
      const probe = buf.subarray(0, BINARY_PROBE_BYTES - this.size);
      if (probe.includes(0)) this.nul = true;
    }
    for (let at = buf.indexOf(NEWLINE); at !== -1; at = buf.indexOf(NEWLINE, at + 1)) this.newlines += 1;
    if (buf.length > 0) this.last = buf[buf.length - 1];
    this.size += buf.length;
  }

  /** @returns {{ lines: number, binary: boolean }} */
  result() {
    return {
      lines: this.newlines + (this.size > 0 && this.last !== NEWLINE ? 1 : 0),
      binary: this.nul,
    };
  }
}

/** @param {Buffer} buf @returns {{ lines: number, binary: boolean }} */
export function countBufferLines(buf) {
  const counter = new LineCounter();
  counter.push(buf);
  return counter.result();
}

async function countBatch(cwd, items, spawnGit) {
  const git = spawnGit('git', ['cat-file', '--batch'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  git.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolveExit, rejectExit) => {
    git.on('error', rejectExit);
    git.on('close', resolveExit);
  });
  exited.catch(() => {}); // surfaced by the await below; this only keeps an early failure from being unhandled
  git.stdin.on('error', () => {}); // git exiting early shows up in its exit code
  git.stdin.end(`${items.map((item) => item.oid).join('\n')}\n`);

  const results = [];
  let carry = Buffer.alloc(0); // an unfinished `<oid> <type> <size>` header line
  let counter = null; // the object being read
  let left = 0; // bytes of its frame still to come: the content plus git's trailing LF
  try {
    for await (const chunk of git.stdout) {
      const buf = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
      carry = Buffer.alloc(0);
      let pos = 0;
      while (pos < buf.length) {
        if (counter === null) {
          const eol = buf.indexOf(NEWLINE, pos);
          if (eol === -1) {
            carry = buf.subarray(pos);
            break;
          }
          const header = buf.toString('latin1', pos, eol);
          pos = eol + 1;
          const match = /^[0-9a-f]+ \w+ (\d+)$/.exec(header);
          if (!match) throw new Error(`git cat-file in ${cwd}: unreadable object (${header})`);
          counter = new LineCounter();
          left = Number(match[1]) + 1;
        }
        const end = pos + Math.min(left, buf.length - pos);
        left -= end - pos;
        if (left === 0) {
          if (buf[end - 1] !== NEWLINE) throw new Error(`git cat-file in ${cwd}: object frame is not newline-terminated`);
          counter.push(buf.subarray(pos, end - 1));
          results.push(counter.result());
          counter = null;
        } else {
          counter.push(buf.subarray(pos, end));
        }
        pos = end;
      }
    }
  } catch (error) {
    git.kill();
    throw error;
  }
  const code = await exited;
  if (code !== 0) throw new Error(`git cat-file in ${cwd} exited ${code}: ${stderr.trim()}`);
  if (results.length !== items.length || counter !== null || carry.length > 0) {
    throw new Error(`git cat-file in ${cwd}: read ${results.length} of ${items.length} objects`);
  }
  return results;
}

/**
 * @param {string} cwd repository working-tree root
 * @param {Array<{ oid: string, path: string }>} items blobs to count
 * @param {{ batchSize?: number, spawnGit?: typeof spawn }} [options]
 *   `spawnGit` is a seam so a test can count the processes started.
 * @returns {Promise<Array<{ lines: number, binary: boolean }>>} aligned to `items`
 */
export async function countBlobLines(cwd, items, { batchSize = BLOB_BATCH_SIZE, spawnGit = spawn } = {}) {
  const results = [];
  for (let at = 0; at < items.length; at += batchSize) {
    results.push(...await countBatch(cwd, items.slice(at, at + batchSize), spawnGit));
  }
  return results;
}

export default { BINARY_PROBE_BYTES, LineCounter, countBufferLines, countBlobLines };
