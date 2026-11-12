/**
 * `handbook.mjs priority-verdicts <out> --project <root>` (openspec change
 * handbook-findings-priority, design D5): record the verdicts of the two judges
 * of each part, `<out>/priority/verdicts/part-<n>.a.json` and `part-<n>.b.json`,
 * `{ verdicts: [{ id, verdict, reason }] }`. Each file is checked on its own: one
 * verdict for each group of its part (an id of another part is an extra id, a
 * group without a verdict is a missing one), each `follows` or `doesNotFollow`,
 * with a non-empty one-line reason; the reason of a `doesNotFollow` verdict
 * reaches readers (the coverage section lists it), so it passes the checks of
 * reader text like the reason of a verifier. A judge file the script wrote is
 * compared with the one on disk, so a verdict for another ranking is refused.
 * Any failure prints every problem, each led by its part and letter
 * (`part 1b:`), and records nothing.
 *
 * A group has a priority only when both judges say `follows`; any other group
 * is recorded as unranked with the reasons of the judges that said
 * `doesNotFollow`, in letter order, rewritten and retried by no one. The unit is
 * then `verified`: a group without a rank is a gap the outputs show, not a failure.
 */

import { isObject, readJson } from './json-file.mjs';
import { loadPriorityContext, readerTextProblems } from './priority-context.mjs';
import { partsOf } from './priority-groups.mjs';
import { checkedRanking, judgeFile } from './priority-judge.mjs';
import { JUDGES, JUDGE_VERDICTS, PRIORITY_ID, judgeFilePath, judgeVerdictPath } from './priority-shape.mjs';
import { loadState, saveState } from './state.mjs';
import { setUnitState } from './unit.mjs';
import { UsageError } from './errors.mjs';

const joinAnd = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

/** Every way a verdict file departs from one valid verdict for each of `ids`. */
export function verdictFileProblems(raw, ids) {
  if (!isObject(raw) || !Array.isArray(raw.verdicts)) return ['verdicts: must be an array in an object { "verdicts": [...] }'];
  const problems = [];
  const wanted = new Set(ids);
  const seen = new Set();
  raw.verdicts.forEach((entry, index) => {
    if (!isObject(entry) || typeof entry.id !== 'string') {
      problems.push(`verdicts[${index}]: must be an object with id, verdict and reason`);
      return;
    }
    const { id } = entry;
    if (!wanted.has(id)) problems.push(`${id}: is not a group of the judge file`);
    else if (seen.has(id)) problems.push(`${id}: more than one verdict`);
    seen.add(id);
    if (!JUDGE_VERDICTS.includes(entry.verdict)) problems.push(`${id}: verdict ${JSON.stringify(entry.verdict)} is not one of ${JUDGE_VERDICTS.join(', ')}`);
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') problems.push(`${id}: the reason must be a non-empty string`);
    else if (/[\r\n]/.test(entry.reason.trim())) problems.push(`${id}: the reason must be one line`);
  });
  for (const id of ids) if (!seen.has(id)) problems.push(`${id}: no verdict`);
  return problems;
}

/** Run priority-verdicts. Returns { status, lines }. */
export function priorityVerdicts(outDirArg, root) {
  const context = loadPriorityContext(outDirArg, root);
  if (context.stop) return context.stop;
  if (context.groups.length === 0) return { status: 0, lines: ['Priority: no verified findings; nothing to record'] };
  const checked = checkedRanking(context);
  if (checked.stop) return checked.stop;
  const stateRead = loadState(context.outDir);
  if (!stateRead.ok) {
    if (stateRead.missing) throw new UsageError(stateRead.problem);
    return { status: 1, lines: [stateRead.problem] };
  }
  const { state } = stateRead;
  const { outDir, run } = context;
  const parts = partsOf(context.groups);

  const lines = [];
  const missing = [];
  const rejected = [];
  const given = new Map();
  parts.forEach((part, index) => {
    const number = index + 1;
    const expected = judgeFile(part, number, parts.length, checked.items);
    const read = readJson(judgeFilePath(outDir, number));
    if (!read.ok || JSON.stringify(read.value) !== JSON.stringify(expected)) {
      lines.push(`part ${number}: the judge file priority/judge/part-${number}.json ${read.ok ? 'is not the one priority-judge wrote for this ranking' : read.reason}`);
      rejected.push(`${number}a`, `${number}b`);
      return;
    }
    const ids = part.map((group) => group.key);
    for (const letter of JUDGES) {
      const label = `part ${number}${letter}`;
      const verdictRead = readJson(judgeVerdictPath(outDir, number, letter));
      const where = `priority/verdicts/part-${number}.${letter}.json`;
      if (!verdictRead.ok) {
        (verdictRead.missing ? missing : rejected).push(`${number}${letter}`);
        lines.push(`${label}: ${where} ${verdictRead.reason}`);
        continue;
      }
      const problems = verdictFileProblems(verdictRead.value, ids);
      if (problems.length === 0) {
        const shown = verdictRead.value.verdicts.filter((entry) => entry.verdict === 'doesNotFollow').map((entry) => ({ path: `${entry.id}.reason`, text: entry.reason.trim() }));
        problems.push(...readerTextProblems(shown, run));
      }
      if (problems.length > 0) {
        rejected.push(`${number}${letter}`);
        lines.push(...problems.map((problem) => `${label}: ${problem}`));
      } else given.set(`${number}${letter}`, new Map(verdictRead.value.verdicts.map((entry) => [entry.id, entry])));
    }
  });
  if (missing.length > 0 || rejected.length > 0) {
    const names = [...new Set([...missing, ...rejected])].sort();
    const next = rejected.length === 0
      ? `Next: dispatch the priority judge once more for exactly the missing ${names.length === 1 ? 'verdict file' : 'verdict files'}: ${joinAnd(names)}, each with its judge file and the verdict file path priority-judge printed for it`
      : `Next: delete the verdict ${names.length === 1 ? 'file' : 'files'} of ${joinAnd(names)} and dispatch the priority judge once more for ${joinAnd(names)} with the lines above; when a judge file was not the one priority-judge wrote, run priority-judge again first; nothing was recorded`;
    return { status: 1, lines: [...lines, next] };
  }

  const unranked = [];
  parts.forEach((part, index) => {
    for (const group of part) {
      const verdicts = JUDGES.map((letter) => given.get(`${index + 1}${letter}`).get(group.key));
      if (verdicts.every((entry) => entry.verdict === 'follows')) continue;
      unranked.push({ key: group.key, reasons: verdicts.filter((entry) => entry.verdict === 'doesNotFollow').map((entry) => entry.reason.trim()) });
    }
  });
  const { entry } = context;
  setUnitState(state, PRIORITY_ID, {
    status: 'verified',
    attempts: entry.attempts,
    groupsDigest: entry.groupsDigest,
    entryDigest: entry.entryDigest,
    ...(unranked.length > 0 ? { unranked } : {}),
  });
  saveState(outDir, state);
  const total = context.groups.length;
  return { status: 0, lines: [`${PRIORITY_ID}: verified (${total} groups, ${total - unranked.length} ranked, ${unranked.length} unranked)`] };
}
