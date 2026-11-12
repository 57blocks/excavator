/**
 * What the four priority commands and `mark priority` start from (openspec
 * change handbook-findings-priority): the checked run (load-run.mjs, so a run
 * whose files changed after their check is refused as `assemble` refuses it),
 * the groups of its verified findings with their keys, and the reader-text
 * check of a reason. Reads files only; the commands write what they record.
 */

import { adviceWordsOf } from './findings-check.mjs';
import { loadCheckedRun } from './load-run.mjs';
import { groupsDigest, loadGroups } from './priority-groups.mjs';
import { priorityEntry } from './priority-state.mjs';
import { reviewItems } from './review.mjs';
import { wordsIn } from './word-lists.mjs';

/**
 * `{ stop }` with the lines of a run that does not pass its checks, else
 * `{ run, outDir, groups, digest, entry }`: `groups` the groups of the verified
 * findings (each with its `key`), `digest` of their keys, `entry` the unit's state.
 */
export function loadPriorityContext(outDirArg, root) {
  const run = loadCheckedRun(outDirArg, root);
  if (!run.ok) return { stop: { status: 1, lines: run.lines } };
  const groups = loadGroups(run, root);
  return { run, outDir: run.outDir, groups, digest: groupsDigest(groups), entry: priorityEntry(run.state) };
}

/**
 * The problems of the reader text of each of `texts` (`[{ path, text }]`): the
 * banned-words gate with the labels the map verified, and the narrative language
 * check of the run. With `advice`, also the advice words of the run's table.
 */
export function readerTextProblems(texts, run, { advice = false } = {}) {
  const { files, memberDirs, languageCheck, mapLabels } = run.check;
  const items = texts.map(({ path, text }) => ({ path, strings: [{ path, text, label: false, numbers: false, narrative: true }], evidence: [], passages: [] }));
  const problems = reviewItems(items, { files, memberDirs, exemptLabels: mapLabels, languageCheck }).problems;
  if (advice) {
    const words = adviceWordsOf(run.ui);
    for (const { path, text } of texts) {
      const [found] = wordsIn(text, words);
      if (found !== undefined) problems.push(`${path}: ${JSON.stringify(found)} is a word of advice; write who can trigger it and what happens, not what to change`);
    }
  }
  return problems;
}
