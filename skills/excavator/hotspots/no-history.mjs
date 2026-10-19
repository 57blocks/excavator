/**
 * no-history.mjs
 *
 * Why a project that the source snapshot read as a plain directory has no
 * history (openspec: changes/hotspots-no-history-reason). Decided by structure
 * only: whether git starts, whether `git rev-parse --show-toplevel` succeeds in
 * the project root, and where a `.git` exists. git's messages are localized, so
 * their text is quoted in errors but never matched.
 *
 *   - the root is inside a work tree rooted elsewhere -> 'inside-repository'
 *   - a `.git` that cannot be read (git does not start, or git does not accept
 *     it) -> an Error: a product saying "no history" would hide history that exists
 *   - otherwise -> 'not-a-repository'
 *
 * Ancestors are searched for a `.git` only when git does not start. When it
 * does, its own discovery decides: a stray `.git` that git rejects above the
 * project must not refuse every project below it. Git runs with the same
 * environment the snapshot's detection uses, so both read the user's git
 * configuration the same way.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { isGitRepoRoot } from '../source-snapshot/git-utils.mjs';

const posix = (path) => path.split(sep).join('/');

const showToplevel = (dir) => spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf-8' });

const firstLine = (text) => (text ?? '').trim().split('\n')[0] || 'no message';

function ancestorsOf(dir) {
  const found = [];
  for (let current = dir, parent = dirname(dir); parent !== current; current = parent, parent = dirname(parent)) {
    found.push(parent);
  }
  return found;
}

/** Direct child directories holding a `.git`, as the multi-repo detection looks for them. */
function childrenWithGit(root) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== '.git' && entry.name !== '.excavator')
    .map((entry) => join(root, entry.name))
    .filter((dir) => existsSync(join(dir, '.git')))
    .sort();
}

const notARepository = () => ({ reason: 'not-a-repository', repositoryRoot: null, pathInRepository: null });

/**
 * The `noHistory` header of a project with no readable repository.
 *
 * @param {string} root canonical project root
 * @returns {{ reason: 'not-a-repository' | 'inside-repository', repositoryRoot: string | null, pathInRepository: string | null }}
 */
export function explainNoHistory(root) {
  const here = realpathSync(root);
  const gitLabel = (dir) => posix(relative(here, join(dir, '.git')));
  const probe = showToplevel(here);

  if (probe.error) {
    const found = [here, ...ancestorsOf(here), ...childrenWithGit(here)].filter((dir) => existsSync(join(dir, '.git')));
    if (found.length > 0) {
      throw new Error(`git could not be started (${probe.error.code ?? probe.error.message}), `
        + `so the history in ${found.map(gitLabel).join(', ')} cannot be read`);
    }
    return notARepository();
  }

  if (probe.status === 0) {
    const top = realpathSync(probe.stdout.trim());
    if (top === here) throw new Error(`git reads ${here} as a repository root, but the source snapshot read it as a plain directory`);
    return { reason: 'inside-repository', repositoryRoot: posix(relative(here, top)), pathInRepository: posix(relative(top, here)) };
  }

  if (existsSync(join(here, '.git'))) {
    throw new Error(`git does not accept .git in the project root, so its history cannot be read: ${firstLine(probe.stderr)}`);
  }
  for (const dir of childrenWithGit(here)) {
    if (isGitRepoRoot(dir)) continue; // a repository with no commit yet: not a member, and no history
    throw new Error(`git does not accept ${gitLabel(dir)}, so its history cannot be read: ${firstLine(showToplevel(dir).stderr)}`);
  }
  return notARepository();
}
