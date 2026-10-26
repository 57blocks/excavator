/**
 * The lock on a run's index.json (openspec change prd-feature-pipeline,
 * design D4). check-index, check-lane, mark and aggregate read index.json,
 * change it and write it back; two of them on the same run at once would
 * lose one write (two concurrent dispatches counted as one). Each holds
 * `<out>/index.json.lock`, created with an exclusive open, for the whole
 * command, waits up to 10 s for another command's lock and removes its own
 * when it ends. A lock still there after the wait is reported, never broken:
 * only the user can tell that no other command runs.
 */

import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { UsageError } from './errors.mjs';

export const LOCK_FILE = 'index.json.lock';
const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_MS = 25;
/** Tests shorten the wait with this variable; the skill never sets it. */
const TIMEOUT_VARIABLE = 'EXCAVATOR_PRD_LOCK_TIMEOUT_MS';

function timeoutMs() {
  const value = Number(process.env[TIMEOUT_VARIABLE]);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function holder(path) {
  try {
    const pid = readFileSync(path, 'utf-8').trim();
    return pid === '' ? 'another prd.mjs command' : `pid ${pid}`;
  } catch {
    return 'another prd.mjs command';
  }
}

/** Create the lock; false when `<out>` does not exist (the command then reports that itself). */
function acquire(path) {
  const wait = timeoutMs();
  const deadline = Date.now() + wait;
  for (;;) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      if (error.code !== 'EEXIST') throw error;
    }
    if (Date.now() >= deadline) {
      throw new UsageError(`${path} is held by ${holder(path)} after waiting ${wait / 1000} s; when no other prd.mjs command of this run is still running, delete it and run the command again; never delete it while a command runs`);
    }
    sleep(RETRY_MS);
  }
}

/** Run `work` while holding `<out>/index.json.lock`; returns what `work` returns. */
export function withIndexLock(outDirArg, work) {
  const path = join(resolve(outDirArg), LOCK_FILE);
  if (!acquire(path)) return work();
  const release = () => {
    try {
      unlinkSync(path);
    } catch {
      // Already gone.
    }
  };
  const onSignal = (signal) => {
    release();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    return work();
  } finally {
    release();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
