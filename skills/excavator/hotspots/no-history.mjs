/**
 * no-history.mjs
 *
 * Why a project that the source snapshot read as a plain directory has no
 * history (openspec: changes/hotspots-no-history-reason, hotspots-unaccepted-git).
 * Decided by structure only: whether git works, whether `git rev-parse
 * --show-toplevel` names the directory itself in the project root and in each
 * direct child that holds a `.git`, and where a `.git` exists. git's messages
 * are localized, so their text is quoted in errors but never matched.
 *
 *   - a `.git` that cannot be read (git does not start or does not work, or git
 *     does not accept it) -> an Error: a product saying "no history" would hide
 *     history that exists. This is decided first, so a root inside another work
 *     tree does not hide a `.git` that git skips in the root or in a child
 *   - the root is inside a work tree rooted elsewhere -> 'inside-repository'
 *   - otherwise -> 'not-a-repository'
 *
 * git accepts the `.git` of a directory when `rev-parse --show-toplevel` run
 * there names that directory, as the snapshot's detection of a repository root
 * does; a repository with no commit yet is accepted. Otherwise git either fails
 * or skips that `.git` and reads a work tree above it, and the Error says which.
 * `assertGitAccepted` is that check; hotspots.mjs also runs it for a multi-repo
 * parent. The children of a repository root are not checked: a repository
 * inside it is not in its history.
 *
 * Git works when a configuration read outside any repository succeeds, and
 * starts when it can be spawned; a git that starts but fails there (a broken
 * user configuration) is a git that does not work, and no `.git` is to blame.
 *
 * Ancestors are searched for a `.git` only when git does not work. When it
 * does, its own discovery decides: a stray `.git` that git rejects above the
 * project must not refuse every project below it. Git runs with the same
 * environment the snapshot's detection uses, so both read the user's git
 * configuration the same way.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const posix = (path) => path.split(sep).join('/');

const showToplevel = (dir) => spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf-8' });

const firstLine = (text) => (text ?? '').trim().split('\n')[0] || 'no message';

/**
 * Why git cannot be used here, or null when it can. `--git-dir=/dev/null` reads
 * the same system, user and environment configuration as every other command but
 * discovers no repository, so a broken `.git` anywhere cannot make it fail.
 * `GIT_CONFIG` is dropped: only `git config` reads it, so it must not decide.
 */
function whyGitDoesNotWork(here) {
  const { GIT_CONFIG, ...env } = process.env;
  const probe = spawnSync('git', ['--git-dir=/dev/null', 'config', '--list'], {
    cwd: here, env, encoding: 'utf-8', stdio: ['ignore', 'ignore', 'pipe'], // the configuration itself is never read
  });
  if (probe.error) return `git could not be started (${probe.error.code ?? probe.error.message})`;
  if (probe.status !== 0) return `git does not work here (${firstLine(probe.stderr)})`;
  return null;
}

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

/** `<dir>/.git` as the project-relative POSIX path an error names. */
const gitLabel = (here, dir) => posix(relative(here, join(dir, '.git')));

/**
 * Why git does not accept the `.git` of `dir` as the repository of `dir`, or
 * null when it does (a repository with no commit yet included).
 */
function whyNotAccepted(dir, here) {
  const probe = showToplevel(dir);
  if (probe.status !== 0) return firstLine(probe.stderr);
  const top = realpathSync(probe.stdout.trim());
  if (top === realpathSync(dir)) return null;
  return `git skips it and reads the work tree at ${posix(relative(here, top)) || '.'}`;
}

/**
 * Throws when git does not accept the `.git` of the project root or of a direct
 * child directory; returns otherwise. Assumes git starts.
 *
 * @param {string} root canonical project root
 */
export function assertGitAccepted(root) {
  const here = realpathSync(root);
  const refuseUnless = (dir, label) => {
    const reason = whyNotAccepted(dir, here);
    if (reason !== null) throw new Error(`git does not accept ${label}, so its history cannot be read: ${reason}`);
  };
  if (existsSync(join(here, '.git'))) refuseUnless(here, '.git in the project root');
  for (const dir of childrenWithGit(here)) refuseUnless(dir, gitLabel(here, dir));
}

/**
 * The `noHistory` header of a project with no readable repository.
 *
 * @param {string} root canonical project root
 * @returns {{ reason: 'not-a-repository' | 'inside-repository', repositoryRoot: string | null, pathInRepository: string | null }}
 */
export function explainNoHistory(root) {
  const here = realpathSync(root);
  const unusable = whyGitDoesNotWork(here);

  if (unusable !== null) {
    const found = [here, ...ancestorsOf(here), ...childrenWithGit(here)].filter((dir) => existsSync(join(dir, '.git')));
    if (found.length > 0) {
      throw new Error(`${unusable}, so the history in ${found.map((dir) => gitLabel(here, dir)).join(', ')} cannot be read`);
    }
    return notARepository();
  }

  assertGitAccepted(here);

  const probe = showToplevel(here);
  if (probe.status !== 0) return notARepository();
  const top = realpathSync(probe.stdout.trim());
  if (top === here) throw new Error(`git reads ${here} as a repository root, but the source snapshot read it as a plain directory`);
  return { reason: 'inside-repository', repositoryRoot: posix(relative(here, top)), pathInRepository: posix(relative(top, here)) };
}
