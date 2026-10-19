/**
 * co-change.mjs
 *
 * Pairs of files changed in the same commits (openspec: changes/hotspots-co-change).
 * Derived after the history walk from each file's set of commit ids, so a pair
 * and the files' `commits` come from the same attribution; commit ids are
 * distinct per repository, so files of two repositories never pair.
 *
 * A commit that changed 2 to MAX_FILES_PER_COMMIT selected files counts once for
 * every pair of them. A larger one counts for no pair (a bulk edit would pair
 * everything it touched) and is counted in the header instead. Pairs changed
 * together fewer than MIN_TOGETHER times are counted, not listed. A share is
 * `together` over the file's commits in the window, larger commits included,
 * so leaving commits out can only make a share smaller, never larger.
 */

export const MAX_FILES_PER_COMMIT = 30;
export const MIN_TOGETHER = 3;

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** `together / commits`, rounded half up to two decimals from an integer numerator. */
const share = (together, commits) => Math.round((together * 100) / commits) / 100;

const rule = { maxFilesPerCommit: MAX_FILES_PER_COMMIT, minTogether: MIN_TOGETHER };

/** The `coChange` header of a project with no history: nothing was counted. */
export function coChangeWithoutHistory() {
  return {
    ...rule, commitsCounted: null, commitsOverLimit: null, pairsListed: null, pairsBelowMinimum: null,
  };
}

/**
 * @param {Map<string, { commits: Set<number> }>} histories per-file history by product path
 * @returns {{ header: object, pairs: Array<{ a: string, b: string, together: number, shareOfA: number, shareOfB: number }> }}
 *   `pairs` sorted by `together` descending, then `a`, then `b`
 */
export function countCoChanges(histories) {
  const paths = [...histories.keys()].sort(compareText);
  const filesOf = new Map(); // commit id -> indexes into `paths`, ascending
  paths.forEach((path, index) => {
    for (const commit of histories.get(path).commits) {
      const files = filesOf.get(commit);
      if (files === undefined) filesOf.set(commit, [index]);
      else files.push(index);
    }
  });

  const width = paths.length;
  const together = new Map(); // a * width + b (a < b) -> commits that changed both
  let commitsCounted = 0;
  let commitsOverLimit = 0;
  for (const files of filesOf.values()) {
    if (files.length < 2) continue;
    if (files.length > MAX_FILES_PER_COMMIT) {
      commitsOverLimit += 1;
      continue;
    }
    commitsCounted += 1;
    for (let i = 0; i < files.length; i += 1) {
      for (let j = i + 1; j < files.length; j += 1) {
        const key = files[i] * width + files[j];
        together.set(key, (together.get(key) ?? 0) + 1);
      }
    }
  }

  const pairs = [];
  let pairsBelowMinimum = 0;
  for (const [key, count] of together) {
    if (count < MIN_TOGETHER) {
      pairsBelowMinimum += 1;
      continue;
    }
    const a = paths[Math.floor(key / width)];
    const b = paths[key % width];
    pairs.push({
      a,
      b,
      together: count,
      shareOfA: share(count, histories.get(a).commits.size),
      shareOfB: share(count, histories.get(b).commits.size),
    });
  }
  pairs.sort((x, y) => y.together - x.together || compareText(x.a, y.a) || compareText(x.b, y.b));

  return {
    header: {
      ...rule, commitsCounted, commitsOverLimit, pairsListed: pairs.length, pairsBelowMinimum,
    },
    pairs,
  };
}

export default {
  MAX_FILES_PER_COMMIT, MIN_TOGETHER, coChangeWithoutHistory, countCoChanges,
};
