/**
 * `handbook.mjs priority-judge <out> --project <root>` (openspec change
 * handbook-findings-priority, design D5): for a ranking that passed
 * check-priority, write the judge files and print where each judge reads and
 * writes. A judge file, `<out>/priority/judge/part-<n>.json`, holds for each
 * group of its part the statements, the consequence the lane chose with what the
 * consequence means, and the reason; it holds nothing else, so a judge sees no
 * code, no category, no level and no other group. Each part has two judges that
 * do not see each other, each with its own verdict file
 * `<out>/priority/verdicts/part-<n>.<a|b>.json`. The older judge and verdict
 * files are cleared first, so a judge never reads or answers for another ranking.
 * Changes only files under `<out>/priority`.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readJson, writeJson } from './json-file.mjs';
import { loadPriorityContext } from './priority-context.mjs';
import { partsOf } from './priority-groups.mjs';
import { PRIORITY_FILE, PRIORITY_DIR, JUDGES, judgeFilePath, judgeVerdictDir, judgeVerdictPath, meaningOf, priorityShapeProblems } from './priority-shape.mjs';
import { entryDigest } from './state.mjs';

/**
 * The ranking of a context that passed check-priority, or the lines that stop a judge command: the unit must be
 * `checked` for the groups of today, and the file must be the one that was checked and still hold an item for each group.
 * Returns `{ stop }` or `{ items }` (a Map from group key to its item).
 */
export function checkedRanking(context) {
  const { entry, digest, groups, outDir } = context;
  const rerun = 'Next: run priority-items, rank the groups, then run check-priority';
  if (entry.status !== 'checked') return { stop: { status: 1, lines: [`priority: is ${entry.status}; only a checked ranking is judged`, rerun] } };
  if (entry.groupsDigest !== digest) return { stop: { status: 1, lines: ['priority: the findings changed after the ranking was checked', rerun] } };
  const path = join(outDir, PRIORITY_FILE);
  const read = readJson(path);
  if (!read.ok || priorityShapeProblems(read.value).length > 0 || entryDigest(path) !== entry.entryDigest) {
    return { stop: { status: 1, lines: [`priority: ${PRIORITY_FILE} changed after it was checked`, rerun] } };
  }
  const items = new Map(read.value.items.map((item) => [item.key, item]));
  if (!groups.every((group) => items.has(group.key))) return { stop: { status: 1, lines: ['priority: the ranking has no item for a group of the findings as they are now', rerun] } };
  return { items };
}

/** The judge file of one part: `{ unit, part, parts, groups: [{ id, statements, consequence, meaning, reason }] }`. */
export function judgeFile(part, number, total, items) {
  return {
    unit: 'priority',
    part: number,
    parts: total,
    groups: part.map((group) => {
      const item = items.get(group.key);
      return { id: group.key, statements: group.items.map((one) => one.text), consequence: item.consequence, meaning: meaningOf(item.consequence), reason: item.reason };
    }),
  };
}

/** Run priority-judge. Returns { status, lines }. */
export function priorityJudge(outDirArg, root) {
  const context = loadPriorityContext(outDirArg, root);
  if (context.stop) return context.stop;
  if (context.groups.length === 0) return { status: 0, lines: ['Priority: no verified findings; nothing to judge'] };
  const checked = checkedRanking(context);
  if (checked.stop) return checked.stop;
  const { outDir } = context;
  const parts = partsOf(context.groups);
  rmSync(join(outDir, PRIORITY_DIR, 'judge'), { recursive: true, force: true });
  rmSync(judgeVerdictDir(outDir), { recursive: true, force: true });
  mkdirSync(join(outDir, PRIORITY_DIR, 'judge'), { recursive: true });
  mkdirSync(judgeVerdictDir(outDir), { recursive: true });
  const lines = [`priority: ${context.groups.length} groups in ${parts.length} ${parts.length === 1 ? 'part' : 'parts'}`];
  parts.forEach((part, index) => {
    const number = index + 1;
    const path = judgeFilePath(outDir, number);
    mkdirSync(dirname(path), { recursive: true });
    writeJson(path, judgeFile(part, number, parts.length, checked.items));
    lines.push(`Part ${number}/${parts.length}: ${part.length} groups | Judge file: ${path} | Verdict files: ${JUDGES.map((letter) => judgeVerdictPath(outDir, number, letter)).join(' ')}`);
  });
  lines.push('Next: dispatch two excavator-handbook-priority-judge subagents per part, one for each verdict file, then run priority-verdicts');
  return { status: 0, lines };
}
