/**
 * manifest.mjs
 *
 * Shared, adapter-agnostic helpers for the SourceSnapshot contract (design
 * decisions D3/D7): content hashing, the `{path, contentHash}` manifest
 * digest formula every `revision` is built from, the selection-rule digest,
 * and a generic manifest diff used by the contract's `diff(previousManifest)`
 * member. No filesystem or git I/O lives here — every function is a pure
 * transform over already-read bytes or already-listed paths, so it is trivial
 * to unit test and share verbatim across GitCommitSnapshot, DirectorySnapshot
 * and MultiRepoSnapshot.
 */

import { createHash } from 'node:crypto';

/** Domain separation so this hash space can never collide with an unrelated
 *  digest that happens to reuse the same {path, contentHash} shape. */
const MANIFEST_DIGEST_DOMAIN = 'excavator:source-manifest:v1\0';
const SELECTION_DIGEST_DOMAIN = 'excavator:selection-digest:v1\0';
const MEMBER_LIST_DIGEST_DOMAIN = 'excavator:multi-repo-members:v1\0';
const MULTI_REPO_REVISION_DIGEST_DOMAIN = 'excavator:multi-repo-revision:v1\0';

/** sha256 hex of a Buffer/string — the per-file content hash every adapter's
 *  manifest entries are built from. */
export function contentHash(bufferOrString) {
  return createHash('sha256').update(bufferOrString).digest('hex');
}

/**
 * The revision digest formula (D3): sha256 over the path-sorted list of
 * `{path, contentHash}` entries. Path-sorted so entry ORDER never affects the
 * digest, only the (path, hash) pairs themselves.
 *
 * @param {Array<{path: string, contentHash: string}>} entries
 * @returns {string} lowercase hex sha256
 */
export function manifestDigest(entries) {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash('sha256');
  hash.update(MANIFEST_DIGEST_DOMAIN);
  for (const { path, contentHash: h } of sorted) {
    hash.update(String(path));
    hash.update('\0');
    hash.update(String(h));
    hash.update('\n');
  }
  return hash.digest('hex');
}

/**
 * The selectionDigest formula: a stable hash of the effective ignore/exclude
 * rule set, expressed as an ordered list of opaque rule-description strings
 * (the caller decides what a "rule" is — a default pattern, a whole
 * `.excavatorignore` file's content, an extra CLI pattern, ...). Order is
 * significant here (unlike manifestDigest) because it doubles as a cheap way
 * to make "defaults changed" and "user file changed" distinguishable in a
 * debugger without re-hashing — callers pass rules in a fixed, documented
 * order (see each adapter's `computeSelectionDigest`).
 *
 * @param {string[]} ruleDescriptors
 * @returns {string} lowercase hex sha256
 */
export function selectionDigest(ruleDescriptors) {
  const hash = createHash('sha256');
  hash.update(SELECTION_DIGEST_DOMAIN);
  for (const rule of ruleDescriptors) {
    hash.update(String(rule));
    hash.update('\n');
  }
  return hash.digest('hex');
}

/**
 * The MultiRepoSnapshot revision formula (D3): sha256 over the path-sorted
 * list of `{id, headSha}` member pairs. Deliberately a SEPARATE domain from
 * `manifestDigest` even though the tuple shape is superficially identical
 * (member id + head sha vs. file path + content hash) — collapsing the two
 * would let a directory manifest and a member list collide on the same hash
 * whenever a member id happens to equal some file's path and its HEAD sha
 * happens to equal that file's content hash. Astronomically unlikely, but
 * domain separation makes it impossible rather than merely unlikely.
 *
 * @param {Array<{id: string, headSha: string}>} members
 * @returns {string} lowercase hex sha256
 */
export function memberListDigest(members) {
  const sorted = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const hash = createHash('sha256');
  hash.update(MEMBER_LIST_DIGEST_DOMAIN);
  for (const { id, headSha } of sorted) {
    hash.update(String(id));
    hash.update('\0');
    hash.update(String(headSha));
    hash.update('\n');
  }
  return hash.digest('hex');
}

/**
 * The MultiRepoSnapshot `revision` digest (D3, Fix A): folds the sorted
 * member (id, headSha) list TOGETHER WITH the parent (non-member) directory
 * digest into one sha256, so a parent-only content change also changes
 * `revision` (source-snapshot spec, "MultiRepoSnapshot determined by member HEADs"
 * requirement: "parent non-member source content changes SHALL change the revision" — otherwise a
 * parent-only edit would never produce a freshness mismatch and
 * revision-sync would silently miss it). Deliberately its own domain, and
 * deliberately combines the two ALREADY-COMPUTED digests (member list +
 * parent manifest) rather than re-deriving a new formula over their raw
 * inputs — the point is exactly to bind two independent digests together.
 *
 * @param {Array<{id: string, headSha: string}>} members
 * @param {string} parentDirectoryDigest a `manifestDigest(...)`-shaped hex
 *   sha256 over the parent's own non-member `{path, contentHash}` entries.
 * @returns {string} lowercase hex sha256
 */
export function multiRepoRevisionDigest(members, parentDirectoryDigest) {
  const hash = createHash('sha256');
  hash.update(MULTI_REPO_REVISION_DIGEST_DOMAIN);
  hash.update(memberListDigest(members));
  hash.update('\0');
  hash.update(String(parentDirectoryDigest));
  return hash.digest('hex');
}

/**
 * Generic manifest diff: compares two `{path, contentHash}` entry lists and
 * classifies every path as added / modified / removed. Shared by every
 * adapter's `diff(previousManifest)` — the contract member group 5
 * (revision-sync) will drive for real; groups 1-4 only need it to exist and
 * behave correctly in isolation.
 *
 * @param {Array<{path: string, contentHash: string}>} previousEntries
 * @param {Array<{path: string, contentHash: string}>} currentEntries
 * @returns {{ added: string[], modified: string[], removed: string[] }}
 */
export function diffEntries(previousEntries, currentEntries) {
  const prevByPath = new Map((previousEntries ?? []).map((e) => [e.path, e.contentHash]));
  const currByPath = new Map((currentEntries ?? []).map((e) => [e.path, e.contentHash]));

  const added = [];
  const modified = [];
  for (const [path, hash] of currByPath) {
    if (!prevByPath.has(path)) added.push(path);
    else if (prevByPath.get(path) !== hash) modified.push(path);
  }
  const removed = [];
  for (const path of prevByPath.keys()) {
    if (!currByPath.has(path)) removed.push(path);
  }

  added.sort();
  modified.sort();
  removed.sort();
  return { added, modified, removed };
}
