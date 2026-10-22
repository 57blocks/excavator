/**
 * The project root of a PRD run comes from the caller's `--project`, never
 * from index.json: the model writes the index, so its `projectRoot` is only
 * checked against the given root (openspec change prd-feature-pipeline,
 * design D2). Both are compared after realpath.
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

/** A problem line when the index's projectRoot is not `root`, or null. */
export function projectRootProblem(index, root) {
  let real = null;
  try {
    real = realpathSync(index.projectRoot);
  } catch {
    real = null;
  }
  return real === root ? null : `index: projectRoot ${index.projectRoot} is not the project given with --project (${root})`;
}
