/**
 * The coverage section's line about seed files outside the scope (openspec
 * change prd-report-prd-shape, design D7). Reads only the project's
 * directory listing: nothing is built or run.
 */

import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

/** The scope as a project-relative POSIX path when it is a directory inside the project, else null. */
function scopeDirectory(root, scope) {
  if (typeof scope !== 'string') return null;
  const path = scope.replace(/\/+$/, '');
  if (path === '' || path.includes('\\') || isAbsolute(path) || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  try {
    const real = realpathSync(join(root, path));
    const rel = relative(realpathSync(root), real);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !statSync(real).isDirectory()) return null;
  } catch {
    return null;
  }
  return path;
}

/** The first-level directory of a project-relative file, or `(root)` for a file directly in the project root. */
const firstLevel = (file) => (file.includes('/') ? file.slice(0, file.indexOf('/')) : '(root)');

/**
 * `Seed files read outside the scope: <dir> <n>, ...` over the distinct seed
 * files of all features that are not under the scope, counted by first-level
 * directory in name order; `... none.` when every seed file is under it; null
 * when the index has no scope or it is not a directory inside the project.
 */
export function outsideScopeLine(index, root) {
  const scope = scopeDirectory(root, index.scope);
  if (scope === null) return null;
  const outside = new Set();
  for (const feature of index.features) {
    for (const file of feature.seedFiles ?? []) {
      if (file !== scope && !file.startsWith(`${scope}/`)) outside.add(file);
    }
  }
  if (outside.size === 0) return 'Seed files read outside the scope: none.';
  const counts = new Map();
  for (const file of outside) counts.set(firstLevel(file), (counts.get(firstLevel(file)) ?? 0) + 1);
  const dirs = [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `Seed files read outside the scope: ${dirs.map(([dir, count]) => `${dir} ${count}`).join(', ')}.`;
}
