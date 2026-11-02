/**
 * `handbook.mjs trace-verdicts <out> <id> --project <root>` (design D14, the
 * third check): record the verdicts of the tracers of a `confirmed` feature.
 *
 * Each part of the trace files has one verdict file
 * `trace-verdicts/<id>/part-<n>.json` `{ verdicts: [{ id, verdict, reason, at? }] }`.
 * It must hold exactly one verdict per item of that part (an id of another part
 * is an extra id), each `holds` or `contradicted`, with a non-empty one-line
 * reason; within one part no two `holds` verdicts share a reason (equal after
 * trimming and collapsing white space), since the same words for two items show
 * they were not traced one by one (contradicted reasons may repeat). A `contradicted` verdict needs at least one `at` entry `{ file, line }`
 * that points into the project: a path the project's file reader accepts (so
 * `..`, an absolute path, a symlink that resolves outside the root, or a path
 * under a directory of dependencies or tool products is refused before any read)
 * and a line from 1 to the file's last. The reason of a `contradicted` verdict
 * reaches readers (the coverage section lists it), so it passes the gate of
 * reader text like the reason of a verifier; the reason of a `holds` verdict is
 * shown to no one and is not gated. Any failure prints every problem, each led
 * by its part, and records nothing.
 *
 * When every file is valid, each contradicted item is removed from the entry
 * (what hangs on it goes with it) and recorded in state.json with
 * `step: "trace"` and its `at` positions, which stay in state.json and are not
 * shown to readers. The feature is then `verified`; when no item with evidence
 * is left it is `failed` at the step `trace`.
 */

import { join } from 'node:path';

import { entryPath, entryProblems } from './entry-check.mjs';
import { isObject, readJson, writeJson } from './json-file.mjs';
import { removalRecords } from './removal-records.mjs';
import { entryItems } from './items.mjs';
import { entryDigest, saveState } from './state.mjs';
import { confirmedPlan, tracePartFile, tracePartPath, traceVerdictPath } from './trace-plan.mjs';
import { reasonProblems } from './verdicts.mjs';

export const TRACE_VERDICTS = Object.freeze(['holds', 'contradicted']);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const joinAnd = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);
const partNoun = (list) => (list.length === 1 ? 'part' : 'parts');

/** The number of lines of a file's text: a final newline does not start a line. */
function lineCount(text) {
  const lines = text.split('\n');
  return lines.length > 1 && lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

/** The problems of the `at` list of a contradicted verdict, each led by `at[i]:`; `files` is the project reader. */
function atProblems(at, files) {
  if (!Array.isArray(at) || at.length === 0) return ['a contradicted verdict needs at least one at entry { file, line }: where in the project the code that disagrees is'];
  const problems = [];
  at.forEach((entry, index) => {
    const label = `at[${index}]`;
    if (!isObject(entry) || typeof entry.file !== 'string' || !Object.hasOwn(entry, 'line')) {
      problems.push(`${label}: must be { file, line }`);
      return;
    }
    const resolved = files.resolve(entry.file);
    if (!resolved.ok) {
      problems.push(`${label}: ${entry.file} ${resolved.reason}`);
      return;
    }
    const total = lineCount(resolved.text);
    const { line } = entry;
    if (!Number.isInteger(line) || line < 1 || line > total) problems.push(`${label}: line ${JSON.stringify(line)} is not a line of ${entry.file} (1 to ${total})`);
  });
  return problems;
}

/** Every way a verdict file departs from one valid verdict per item of its part; `citedFiles` are the files the items cite. */
export function traceVerdictProblems(raw, items, files, citedFiles) {
  if (!isObject(raw) || !Array.isArray(raw.verdicts)) return ['verdicts: must be an array in an object { "verdicts": [...] }'];
  const problems = [];
  const ids = new Set(items.map((item) => item.id));
  const seen = new Set();
  const holdsReasons = new Map();
  raw.verdicts.forEach((entry, index) => {
    if (!isObject(entry) || typeof entry.id !== 'string') {
      problems.push(`verdicts[${index}]: must be an object with id, verdict and reason`);
      return;
    }
    const { id } = entry;
    if (!ids.has(id)) problems.push(`${id}: is not an item of the trace file`);
    else if (seen.has(id)) problems.push(`${id}: more than one verdict`);
    seen.add(id);
    if (!TRACE_VERDICTS.includes(entry.verdict)) problems.push(`${id}: verdict ${JSON.stringify(entry.verdict)} is not one of ${TRACE_VERDICTS.join(', ')}`);
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') problems.push(`${id}: the reason must be a non-empty string`);
    else if (/[\r\n]/.test(entry.reason.trim())) problems.push(`${id}: the reason must be one line`);
    if (entry.verdict === 'holds' && typeof entry.reason === 'string' && entry.reason.trim() !== '') {
      // The same words for two items show they were not traced one by one.
      const key = entry.reason.trim().replace(/\s+/g, ' ');
      if (holdsReasons.has(key)) problems.push(`${id}: the same holds reason as ${holdsReasons.get(key)}: trace each item on its own`);
      else holdsReasons.set(key, id);
    }
    if (entry.verdict !== 'contradicted') return;
    problems.push(...atProblems(entry.at, files).map((problem) => `${id}: ${problem}`));
    if (typeof entry.reason === 'string') {
      const pointed = Array.isArray(entry.at) ? entry.at.filter(isObject).map((at) => at.file) : [];
      const named = [...citedFiles, ...pointed].find((file) => typeof file === 'string' && entry.reason.includes(file));
      if (named !== undefined) problems.push(`${id}: the reason names the file ${named}; describe what the code does in words, with no file name`);
    }
  });
  for (const item of items) if (!seen.has(item.id)) problems.push(`${item.id}: no verdict`);
  return problems;
}

/**
 * Read the trace files and the verdict file of every part and check them.
 * Returns `{ verdictList }` (every verdict of all parts in part order) or
 * `{ stop }` with the problem lines, each led by its part, and a Next line.
 */
function readParts(outDir, id, plan) {
  const missingTrace = [];
  const stale = [];
  plan.parts.forEach((items, index) => {
    const number = index + 1;
    const read = readJson(tracePartPath(outDir, id, number));
    if (!read.ok) missingTrace.push(`part ${number}: trace/${id}/part-${number}.json ${read.reason}`);
    else if (JSON.stringify(read.value) !== JSON.stringify(tracePartFile(id, number, plan.parts.length, items))) stale.push(number);
  });
  if (missingTrace.length > 0) return { stop: { status: 1, lines: [...missingTrace, `Next: run trace for ${id} first`] } };
  if (stale.length > 0) {
    return { stop: { status: 1, lines: [`${id}: the entry or the source changed since trace wrote the files of trace/${id}/ (${partNoun(stale)} ${joinAnd(stale)})`, `Next: run trace again for ${id}, then send each part to its tracer`] } };
  }

  const { files } = plan.loaded;
  const citedFiles = [...new Set(plan.items.flatMap((item) => item.citations.map((citation) => citation.file)))];
  const lines = [];
  const missing = [];
  const rejected = [];
  const verdictList = [];
  plan.parts.forEach((items, index) => {
    const number = index + 1;
    const read = readJson(traceVerdictPath(outDir, id, number));
    const where = `trace-verdicts/${id}/part-${number}.json`;
    if (!read.ok) {
      (read.missing ? missing : rejected).push(number);
      lines.push(`part ${number}: ${where} ${read.reason}`);
      return;
    }
    const problems = traceVerdictProblems(read.value, items, files, citedFiles);
    if (problems.length === 0) {
      const contradicted = read.value.verdicts.filter((entry) => entry.verdict === 'contradicted');
      problems.push(...reasonProblems(contradicted, plan));
    }
    if (problems.length > 0) {
      rejected.push(number);
      lines.push(...problems.map((problem) => `part ${number}: ${problem}`));
    } else {
      verdictList.push(...read.value.verdicts);
    }
  });
  if (missing.length === 0 && rejected.length === 0) return { verdictList };
  const again = [...missing, ...rejected].sort((a, b) => a - b);
  if (rejected.length === 0) {
    return { stop: { status: 1, lines: [...lines, `Next: dispatch the tracer once more for ${id} for exactly the missing ${partNoun(missing)}: ${joinAnd(missing)}, each with the trace file and the verdict file path trace printed for it`] } };
  }
  const bad = [...rejected].sort((a, b) => a - b);
  return { stop: { status: 1, lines: [...lines, `Next: delete the verdict ${bad.length === 1 ? 'file' : 'files'} of ${partNoun(bad)} ${joinAnd(bad)} and dispatch the tracer once more for ${partNoun(again)} ${joinAnd(again)} with the lines above; nothing was recorded`] } };
}

/** Run trace-verdicts. Returns { status, lines }. */
export function traceVerdicts(outDir, id, root) {
  const plan = confirmedPlan(outDir, id, root);
  if (plan.stop) return plan.stop;
  const checked = readParts(outDir, id, plan);
  if (checked.stop) return checked.stop;

  const verdictOf = new Map(checked.verdictList.map((entry) => [entry.id, { verdict: entry.verdict, reason: entry.reason.trim(), at: entry.at }]));
  const contradicted = plan.items.filter((item) => verdictOf.get(item.id).verdict === 'contradicted').map((item) => item.id);
  const { state, current, entry } = plan;
  const { attempts } = current;
  const earlier = current.removed ?? [];
  const atOf = (path) => verdictOf.get(path).at.map(({ file, line }) => ({ file, line }));
  const { trimmed, records } = removalRecords(entry, contradicted, (path) => verdictOf.get(path), (path) => plan.claims.get(path), { step: 'trace', atOf });
  const removed = [...earlier, ...records];

  // Nothing left that carries evidence: nothing was proved. The entry file stays as written for the user to see.
  if (!entryItems(trimmed).some((item) => item.evidence.length > 0)) {
    const text = 'no item could be proved';
    state.features[id] = { status: 'failed', attempts, failure: { step: 'trace', reasons: [text] }, removed };
    saveState(outDir, state);
    return { status: 0, lines: [`${id}: failed at trace: no item could be proved`] };
  }
  const problems = entryProblems(trimmed, id, plan.loaded, { settled: true });
  if (problems.length > 0) throw new Error(`the trimmed entry of ${id} fails check-entry (a bug in trace-verdicts):\n${problems.join('\n')}`);
  if (records.length > 0) writeJson(join(outDir, entryPath(id)), trimmed);
  const next = { status: 'verified', attempts, entryDigest: entryDigest(join(outDir, entryPath(id))) };
  if (removed.length > 0) next.removed = removed;
  state.features[id] = next;
  saveState(outDir, state);
  return { status: 0, lines: [records.length > 0 ? `${id}: verified, ${plural(records.length, 'item')} removed` : `${id}: verified (${plural(plan.items.length, 'item')})`] };
}
