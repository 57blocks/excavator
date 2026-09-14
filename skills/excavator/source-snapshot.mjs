/**
 * source-snapshot.mjs
 *
 * SourceSnapshot — the single take-source abstraction the Lazy analysis
 * driver (and, later, retrieval and source-of-truth citation) reads
 * through, instead of each caller directly invoking `git rev-parse HEAD` or
 * reading the working directory for itself (openspec change
 * `source-snapshot`, capability `source-snapshot`).
 *
 * Contract every adapter implements:
 *   { revision, selectionDigest, listFiles(), readFile(path), search(terms),
 *     diff(previousManifest), materialize(), runGuarded(producer, publish) }
 *
 * `revision` is that source version's ONE baseline; `selectionDigest` is a
 * stable hash of the effective ignore/exclude rules; together with a
 * `pipelineVersion` constant (owned by the caller — see lazy-analyze.mjs)
 * they form `source-manifest.json`'s three fields (see the spec's
 * "source-manifest records and drives rebuild" requirement). `materialize()` copies the
 * snapshot's content into a fresh temp directory so the EXISTING
 * scan/structure/import-map scripts can run against it unmodified (design
 * D5) — they read the filesystem directly and are not being rewritten to
 * consume this API. `runGuarded(producer, publish)` runs `producer` against
 * a materialization and only calls `publish` if nothing about the source
 * changed for the whole duration (D7's consistency guard); every adapter
 * implements the same shape so a caller can treat all three uniformly, even
 * though only DirectorySnapshot's non-git content can actually drift.
 *
 * Adapter detection order (D2), tried in this order against `root`:
 *   1. `root` is itself a git repository        -> GitCommitSnapshot
 *   2. `root` contains >=1 member git repos      -> MultiRepoSnapshot
 *   3. otherwise                                 -> DirectorySnapshot
 *
 * Split into `source-snapshot/` per adapter (design D1: split per adapter when this file approaches the line ceiling) — this file is only the public entrypoint + detection.
 *
 * Contract: openspec/changes/source-snapshot/specs/source-snapshot/spec.md
 */

import { resolve } from 'node:path';

import { isGitRepoRoot, headSha } from './source-snapshot/git-utils.mjs';
import { GitCommitSnapshot } from './source-snapshot/git-commit-snapshot.mjs';
import { DirectorySnapshot } from './source-snapshot/directory-snapshot.mjs';
import { MultiRepoSnapshot, findGitMembers } from './source-snapshot/multi-repo-snapshot.mjs';
import { contentHash, manifestDigest, memberListDigest, selectionDigest, diffEntries } from './source-snapshot/manifest.mjs';

/**
 * Resolve the right SourceSnapshot adapter for `root` (D2's detection
 * order). Printing the "uncommitted changes ignored" terminal notice
 * happens here (once, for a top-level GitCommitSnapshot only) rather than
 * inside the class itself, so a GitCommitSnapshot constructed internally
 * for a MultiRepoSnapshot MEMBER does not also print it — the notice is
 * about the TOP-LEVEL analysis target, and multi-repo has no analogous
 * single-HEAD framing.
 *
 * @param {string} root
 * @param {{ extraExcludePatterns?: string[] }} [options]
 * @returns {GitCommitSnapshot|MultiRepoSnapshot|DirectorySnapshot}
 */
export function resolveSourceSnapshot(root, options = {}) {
  const resolvedRoot = resolve(root);
  const extraExcludePatterns = options.extraExcludePatterns ?? [];

  if (isGitRepoRoot(resolvedRoot)) {
    const sha = headSha(resolvedRoot);
    if (sha === null) {
      throw new Error(
        `resolveSourceSnapshot: ${resolvedRoot} is a git repository with no commits (unborn HEAD) — nothing to analyze`,
      );
    }
    const snapshot = new GitCommitSnapshot(resolvedRoot, sha, { extraExcludePatterns });
    process.stderr.write(`${snapshot.noticeLine}\n`);
    return snapshot;
  }

  const members = findGitMembers(resolvedRoot);
  if (members.length > 0) {
    return new MultiRepoSnapshot(resolvedRoot, members, { extraExcludePatterns });
  }

  return new DirectorySnapshot(resolvedRoot, { extraExcludePatterns });
}

export {
  GitCommitSnapshot,
  DirectorySnapshot,
  MultiRepoSnapshot,
  findGitMembers,
  isGitRepoRoot,
  headSha,
  contentHash,
  manifestDigest,
  memberListDigest,
  selectionDigest,
  diffEntries,
};

export default {
  resolveSourceSnapshot,
  GitCommitSnapshot,
  DirectorySnapshot,
  MultiRepoSnapshot,
  findGitMembers,
};
