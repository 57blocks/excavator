/** Citation check (design D6): the cited file is project source and the passage occurs in it exactly once. */

import { findOnce } from './normalize.mjs';

/** The problem lines of one `{ path, file, passage }` citation; an empty list means it holds. */
export function citationProblems(files, { path, file, passage }) {
  const resolved = files.resolve(file);
  if (!resolved.ok) return [`${path}: ${file} ${resolved.reason}`];
  const { count } = findOnce(resolved.text, passage);
  if (count === 0) return [`${path}: passage not in ${file}`];
  if (count > 1) return [`${path}: passage occurs ${count} times in ${file}; quote more of it`];
  return [];
}
