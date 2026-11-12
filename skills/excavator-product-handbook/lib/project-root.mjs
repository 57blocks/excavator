/**
 * The project root of a handbook run comes from the caller's `--project`,
 * never from a file the model wrote: candidates.json names a root that is only
 * compared with it, after realpath.
 */

import { existsSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { UsageError } from './errors.mjs';

/** The real path of `--project`; a usage error when it is not given or not a directory. */
export function projectRootOption(value) {
  if (typeof value !== 'string' || value === '') throw new UsageError('--project <root> is required: the project the run documents');
  const path = resolve(value);
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new UsageError(`--project ${path} is not a directory`);
  return realpathSync(path);
}

/** A problem line when `recordedRoot` does not resolve to `root`, or null. */
export function projectRootProblem(recordedRoot, root) {
  let real = null;
  try {
    real = realpathSync(recordedRoot);
  } catch {
    real = null;
  }
  return real === root ? null : `candidates.json: projectRoot ${recordedRoot} is not the project given with --project (${root})`;
}
