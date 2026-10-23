/**
 * Project-relative paths that come from a model-written file (index.json, a
 * chapter's anchors, a finding's evidence) are untrusted: each must stay
 * inside the project root, symlinks included, and name a regular file. Reads
 * are cached per check run.
 */

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

/**
 * A reader of the project's files under `projectRoot`.
 * `resolve(path)` returns `{ ok: true, path, text, lines }` or `{ ok: false, reason }`.
 */
export function projectFiles(projectRoot) {
  const root = realpathSync(projectRoot);
  const cache = new Map();

  function check(path) {
    if (typeof path !== 'string' || path.trim() === '') return 'is not a path';
    if (path.includes('\\')) return 'has a backslash; use forward slashes';
    if (isAbsolute(path) || /^[A-Za-z]:/.test(path)) return 'is absolute; give it relative to the project';
    const segments = path.split('/');
    if (segments.includes('..')) return 'leaves the project';
    if (segments.some((segment) => segment === '' || segment === '.')) return 'is not a normalized relative path';
    let real;
    try {
      real = realpathSync(join(root, path));
    } catch {
      return 'is not a file in the project';
    }
    const rel = relative(root, real);
    if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) return 'resolves outside the project';
    if (!statSync(real).isFile()) return 'is not a file in the project';
    return null;
  }

  function resolve(path) {
    if (cache.has(path)) return cache.get(path);
    const reason = check(path);
    let result;
    if (reason !== null) {
      result = { ok: false, reason };
    } else {
      const text = readFileSync(join(root, path), 'utf-8');
      const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
      result = { ok: true, path, text, lines };
    }
    cache.set(path, result);
    return result;
  }

  return { root, resolve };
}
