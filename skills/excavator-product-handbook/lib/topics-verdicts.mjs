/**
 * `handbook.mjs topic-verdicts <out> [--lane <id>] --project <root>` (openspec
 * change handbook-topics, design D5): record the verdicts of the two judges of
 * each lane that passed check-topics, `<out>/topics/verdicts/<lane>.a.json` and
 * `<lane>.b.json`, `{ verdicts: [{ id, verdict, reason }] }`. Each file is checked on
 * its own, as the verdicts of the ranking are (one verdict for each row of the
 * judge file, `follows` or `doesNotFollow`, a non-empty one-line reason; the
 * reason of a `doesNotFollow` verdict reaches readers, so it passes the checks of
 * reader text). The judge file is compared with the one `topic-judge` wrote. Any
 * failure prints every problem, each led by its lane and letter
 * (`lane D1 judge a:`), and records nothing.
 *
 * A row is written into the handbook only when both judges say `follows`; any
 * other is recorded as dropped with the reasons of the judges that said
 * `doesNotFollow`, in letter order, rewritten and retried by no one. The lane is
 * then `verified`: a dropped row is a gap the outputs show, not a failure. A lane
 * without a row has no verdict file and is verified at once.
 */

import { readJson } from './json-file.mjs';
import { readerTextProblems } from './priority-context.mjs';
import { verdictFileProblems } from './priority-verdicts.mjs';
import { entryDigest, loadState, saveState } from './state.mjs';
import { loadTopicsContext, currentEntry } from './topics-context.mjs';
import { checkedLanes, judgeFile } from './topics-judge.mjs';
import { JUDGES, judgeFilePath, judgeVerdictPath, laneUnitId, partFilePath, rowsOf } from './topics-shape.mjs';
import { setUnitState } from './unit.mjs';
import { UsageError } from './errors.mjs';

const joinAnd = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

/** Run topic-verdicts. Returns { status, lines }. */
export function topicVerdicts(outDirArg, root, laneId) {
  const context = loadTopicsContext(outDirArg, root);
  if (context.stop) return context.stop;
  if (!context.hasLanes) return { status: 0, lines: ['Topics: no verified entry and no verified finding; nothing to record'] };
  const checked = checkedLanes(context, laneId);
  if (checked.stop) return checked.stop;
  const stateRead = loadState(context.outDir);
  if (!stateRead.ok) {
    if (stateRead.missing) throw new UsageError(stateRead.problem);
    return { status: 1, lines: [stateRead.problem] };
  }
  const { state } = stateRead;
  const { outDir, run, facts } = context;

  const lines = [];
  const missing = [];
  const rejected = [];
  const given = new Map();
  for (const { lane, doc } of checked.lanes) {
    if (doc.rows.length === 0) continue;
    const ids = rowsOf(doc).map((row) => row.id);
    const judgeRead = readJson(judgeFilePath(outDir, lane.id));
    if (!judgeRead.ok || JSON.stringify(judgeRead.value) !== JSON.stringify(judgeFile(lane, doc, facts))) {
      lines.push(`lane ${lane.id}: the judge file topics/judge/${lane.id}.json ${judgeRead.ok ? 'is not the one topic-judge wrote for this lane' : judgeRead.reason}`);
      rejected.push(...JUDGES.map((letter) => `${lane.id}.${letter}`));
      continue;
    }
    for (const letter of JUDGES) {
      const name = `${lane.id}.${letter}`;
      const label = `lane ${lane.id} judge ${letter}`;
      const read = readJson(judgeVerdictPath(outDir, lane.id, letter));
      const where = `topics/verdicts/${lane.id}.${letter}.json`;
      if (!read.ok) {
        (read.missing ? missing : rejected).push(name);
        lines.push(`${label}: ${where} ${read.reason}`);
        continue;
      }
      const problems = verdictFileProblems(read.value, ids);
      if (problems.length === 0) {
        const shown = read.value.verdicts.filter((one) => one.verdict === 'doesNotFollow').map((one) => ({ path: `${one.id}.reason`, text: one.reason.trim() }));
        problems.push(...readerTextProblems(shown, run));
      }
      if (problems.length > 0) {
        rejected.push(name);
        lines.push(...problems.map((problem) => `${label}: ${problem}`));
      } else given.set(name, new Map(read.value.verdicts.map((one) => [one.id, one])));
    }
  }
  if (missing.length > 0 || rejected.length > 0) {
    const names = [...new Set([...missing, ...rejected])].sort();
    const next = rejected.length === 0
      ? `Next: dispatch the topic judge once more for exactly the missing verdict ${names.length === 1 ? 'file' : 'files'}: ${joinAnd(names)}, each with its judge file and the verdict file path topic-judge printed for it`
      : `Next: delete the verdict ${names.length === 1 ? 'file' : 'files'} of ${joinAnd(names)} and dispatch the topic judge once more for ${joinAnd(names)} with the lines above; when a judge file was not the one topic-judge wrote, run topic-judge again first; nothing was recorded`;
    return { status: 1, lines: [...lines, next] };
  }

  const results = [];
  for (const { lane, doc } of checked.lanes) {
    const ids = rowsOf(doc).map((row) => row.id);
    const dropped = [];
    for (const id of doc.rows.length === 0 ? [] : ids) {
      const verdicts = JUDGES.map((letter) => given.get(`${lane.id}.${letter}`).get(id));
      if (verdicts.every((one) => one.verdict === 'follows')) continue;
      dropped.push({ id, reasons: verdicts.filter((one) => one.verdict === 'doesNotFollow').map((one) => one.reason.trim()) });
    }
    const entry = currentEntry(state, lane);
    setUnitState(state, laneUnitId(lane.id), {
      status: 'verified',
      attempts: entry.attempts,
      factsDigest: entry.factsDigest,
      entryDigest: entryDigest(partFilePath(outDir, lane.id)),
      ...(dropped.length > 0 ? { dropped } : {}),
    });
    results.push(`${laneUnitId(lane.id)}: verified (${ids.length} rows, ${ids.length - dropped.length} kept, ${dropped.length} removed)`);
  }
  saveState(outDir, state);
  return { status: 0, lines: results };
}
