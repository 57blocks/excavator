/**
 * `handbook.mjs remedy-verdicts <out> --project <root>` (openspec change
 * handbook-remedies, design D5): record the verdicts of the two judges,
 * `<out>/remedies/verdicts/a.json` and `b.json`, `{ verdicts: [{ id, verdict,
 * reason }] }`. Each file is checked on its own, as the verdicts of the ranking
 * are (one verdict for each paragraph of the judge file, `follows` or
 * `doesNotFollow`, a non-empty one-line reason; the reason of a `doesNotFollow`
 * verdict reaches readers, so it passes the checks of reader text). The judge file
 * is compared with the one `remedy-judge` wrote. Any failure prints every problem,
 * each led by its letter (`judge a:`), and records nothing.
 *
 * A paragraph or recommendation is written into the handbook only when both
 * judges say `follows`; any other is recorded as dropped with the reasons of the
 * judges that said `doesNotFollow`, in letter order, rewritten and retried by no
 * one. The unit is then `verified`: a dropped paragraph is a gap the outputs show,
 * not a failure.
 */

import { readJson } from './json-file.mjs';
import { readerTextProblems } from './priority-context.mjs';
import { verdictFileProblems } from './priority-verdicts.mjs';
import { loadRemediesContext } from './remedies-context.mjs';
import { checkedRemedies, judgeFile } from './remedies-judge.mjs';
import { JUDGES, REMEDIES_ID, judgeFilePath, judgeVerdictPath, paragraphsOf } from './remedies-shape.mjs';
import { loadState, saveState } from './state.mjs';
import { setUnitState } from './unit.mjs';
import { UsageError } from './errors.mjs';

const joinAnd = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

/** Run remedy-verdicts. Returns { status, lines }. */
export function remedyVerdicts(outDirArg, root) {
  const context = loadRemediesContext(outDirArg, root);
  if (context.stop) return context.stop;
  if (!context.hasGroups) return { status: 0, lines: ['Remedies: no verified findings; nothing to record'] };
  const checked = checkedRemedies(context);
  if (checked.stop) return checked.stop;
  const stateRead = loadState(context.outDir);
  if (!stateRead.ok) {
    if (stateRead.missing) throw new UsageError(stateRead.problem);
    return { status: 1, lines: [stateRead.problem] };
  }
  const { state } = stateRead;
  const { outDir, run, facts, entry } = context;
  const paragraphs = paragraphsOf(checked.doc);

  const expected = judgeFile(checked.doc, facts);
  const judgeRead = readJson(judgeFilePath(outDir));
  if (!judgeRead.ok || JSON.stringify(judgeRead.value) !== JSON.stringify(expected)) {
    return { status: 1, lines: [`the judge file remedies/judge.json ${judgeRead.ok ? 'is not the one remedy-judge wrote for these remedies' : judgeRead.reason}`, 'Next: run remedy-judge again, then dispatch both judges; nothing was recorded'] };
  }
  const ids = paragraphs.map((paragraph) => paragraph.id);
  const lines = [];
  const missing = [];
  const rejected = [];
  const given = new Map();
  for (const letter of JUDGES) {
    const label = `judge ${letter}`;
    const read = readJson(judgeVerdictPath(outDir, letter));
    const where = `remedies/verdicts/${letter}.json`;
    if (!read.ok) {
      (read.missing ? missing : rejected).push(letter);
      lines.push(`${label}: ${where} ${read.reason}`);
      continue;
    }
    const problems = verdictFileProblems(read.value, ids);
    if (problems.length === 0) {
      const shown = read.value.verdicts.filter((one) => one.verdict === 'doesNotFollow').map((one) => ({ path: `${one.id}.reason`, text: one.reason.trim() }));
      problems.push(...readerTextProblems(shown, run));
    }
    if (problems.length > 0) {
      rejected.push(letter);
      lines.push(...problems.map((problem) => `${label}: ${problem}`));
    } else given.set(letter, new Map(read.value.verdicts.map((one) => [one.id, one])));
  }
  if (missing.length > 0 || rejected.length > 0) {
    const names = [...new Set([...missing, ...rejected])].sort();
    const next = rejected.length === 0
      ? `Next: dispatch the remedy judge once more for exactly the missing verdict ${names.length === 1 ? 'file' : 'files'}: ${joinAnd(names)}, each with the judge file and the verdict file path remedy-judge printed for it`
      : `Next: delete the verdict ${names.length === 1 ? 'file' : 'files'} of judge ${joinAnd(names)} and dispatch the remedy judge once more for ${names.length === 1 ? 'it' : 'them'} with the lines above; nothing was recorded`;
    return { status: 1, lines: [...lines, next] };
  }

  const dropped = [];
  for (const id of ids) {
    const verdicts = JUDGES.map((letter) => given.get(letter).get(id));
    if (verdicts.every((one) => one.verdict === 'follows')) continue;
    dropped.push({ id, reasons: verdicts.filter((one) => one.verdict === 'doesNotFollow').map((one) => one.reason.trim()) });
  }
  setUnitState(state, REMEDIES_ID, { status: 'verified', attempts: entry.attempts, factsDigest: entry.factsDigest, entryDigest: entry.entryDigest, ...(dropped.length > 0 ? { dropped } : {}) });
  saveState(outDir, state);
  return { status: 0, lines: [`${REMEDIES_ID}: verified (${ids.length} paragraphs, ${ids.length - dropped.length} kept, ${dropped.length} removed)`] };
}
