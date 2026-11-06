/**
 * The files the data section reads (openspec change handbook-data-tables,
 * design D2 and D4): the project walked as the candidate lister walks it (same
 * skipped directories, no link followed), each file with the application it
 * belongs to and, when it sits under a directory named like a migration
 * directory, which one. The application roots are applications.mjs's.
 */

import { readFileSync } from 'node:fs';

import { isUnder, scanProject } from './applications.mjs';
import { MAX_FILE_BYTES, walk } from './entrypoints.mjs';

/** A directory with this name holds migrations. */
export const MIGRATION_DIRECTORY = /^migrat(?:e|ion|ions)$/i;
/** The application key of a file that is under no application root. */
export const NO_APPLICATION = '';

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const byteOrder = compare;
const dirOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.');

/** The nearest migration directory above a file: `{ directory, direct }` (`direct`: the file is a direct child), or null. */
function migrationContext(rel) {
  const dirs = rel.split('/').slice(0, -1);
  for (let i = dirs.length - 1; i >= 0; i -= 1) {
    if (MIGRATION_DIRECTORY.test(dirs[i])) return { directory: dirs.slice(0, i + 1).join('/'), direct: i === dirs.length - 1 };
  }
  return null;
}

/**
 * Walk the project once. Returns `{ root, roots, files, symlinks, applicationOf }`;
 * `files` are `{ rel, abs, size, application, migration }` in the walk's
 * order, `application` is the root directory a file is under or
 * NO_APPLICATION, `symlinks` is the number of links the walk did not follow.
 */
export function listProject(projectRootArg) {
  const scan = scanProject(projectRootArg);
  const stats = { seen: 0, skipped: { symlink: 0, unreadable: 0 }, skippedDirectories: {} };
  const applicationOf = (rel) => {
    const dir = dirOf(rel);
    return scan.roots.find((root) => isUnder(dir, root)) ?? NO_APPLICATION;
  };
  const files = [];
  walk(scan.root, null, stats, (rel, abs, size) => {
    files.push({ rel, abs, size, application: applicationOf(rel), migration: migrationContext(rel) });
  });
  return { root: scan.root, roots: scan.roots, files, symlinks: stats.skipped.symlink, applicationOf };
}

/** `{ text }`, or `{ skipped: 'binary' | 'tooLarge' | 'unreadable' }` for a file that is not read as text. */
export function readText(file) {
  if (file.size > MAX_FILE_BYTES) return { skipped: 'tooLarge' };
  let bytes;
  try {
    bytes = readFileSync(file.abs);
  } catch {
    return { skipped: 'unreadable' };
  }
  if (bytes.includes(0)) return { skipped: 'binary' };
  return { text: bytes.toString('utf-8') };
}
