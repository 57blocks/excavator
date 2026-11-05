/**
 * Project-relative paths that come from a model-written file (a citation, a
 * seed file) are untrusted: each must stay inside the project root, symlinks
 * included, must not sit under a directory that holds dependencies, build
 * output or tool products, and must name a regular file. A path that fails is
 * refused before anything is read, so a file outside the root is never opened.
 */

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import { SKIPPED_DIRECTORIES } from './entrypoints.mjs';

/** The first excluded directory name among the directories of a relative POSIX path, or null. Only directories count, not the file name. */
function excludedDirectory(path) {
  return path.split('/').slice(0, -1).find((segment) => SKIPPED_DIRECTORIES.includes(segment)) ?? null;
}

/**
 * A reader of the project's files under `projectRoot`.
 * `resolve(path)` returns `{ ok: true, path, text }` or `{ ok: false, reason }`; reads are cached.
 */
export function projectFiles(projectRoot) {
  const root = realpathSync(projectRoot);
  const cache = new Map();

  function refusal(path) {
    if (typeof path !== 'string' || path.trim() === '') return 'is not a path';
    if (path.includes('\\')) return 'has a backslash; use forward slashes';
    if (isAbsolute(path) || /^[A-Za-z]:/.test(path)) return 'is absolute; give it relative to the project';
    const segments = path.split('/');
    if (segments.includes('..')) return 'leaves the project';
    if (segments.some((segment) => segment === '' || segment === '.')) return 'is not a normalized relative path';
    const named = excludedDirectory(path);
    if (named !== null) return `is under ${named}, a directory that holds dependencies, build output or tool products; cite project source`;
    let real;
    try {
      real = realpathSync(join(root, path));
    } catch {
      return 'is not a file in the project';
    }
    const rel = relative(root, real);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return 'resolves outside the project';
    const realNamed = excludedDirectory(rel.split(sep).join('/'));
    if (realNamed !== null) return `resolves into ${realNamed}, a directory that holds dependencies, build output or tool products; cite project source`;
    if (!statSync(real).isFile()) return 'is not a file in the project';
    return null;
  }

  function resolve(path) {
    if (cache.has(path)) return cache.get(path);
    const reason = refusal(path);
    const result = reason === null
      ? { ok: true, path, text: readFileSync(join(root, path), 'utf-8') }
      : { ok: false, reason };
    cache.set(path, result);
    return result;
  }

  return { root, resolve };
}
