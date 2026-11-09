/**
 * `handbook.mjs check-priority <out> --project <root>` (openspec change
 * handbook-findings-priority, design D3 and D4): check the part files the
 * ranking lanes wrote, `<out>/priority/part-<n>.json`, one per part of the
 * groups `priority-items` prints, each `{ schema, items: [{ key, consequence,
 * reason }] }`.
 *
 * Each part must hold exactly one item for each group key of its part (a key of
 * another part, a key that no group has now, a repeated key and a group without
 * an item are all problems), a consequence of the table (priority-shape.mjs) and
 * a reason of one line that passes the checks of reader text: no code-shaped
 * word, no file name, the run's language, no word of advice. When every part
 * holds, the items are merged in group order into `<out>/entries/priority.json`
 * and the unit is recorded as `checked` with the digest of that file; otherwise
 * it is recorded as `failed` with every problem, each led by its part, and the
 * last line is a `Next:` line naming the parts to rank again.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readJson, writeJson } from './json-file.mjs';
import { loadPriorityContext, readerTextProblems } from './priority-context.mjs';
import { partsOf } from './priority-groups.mjs';
import { PRIORITY_FILE, PRIORITY_FORMAT, PRIORITY_ID, partFilePath, priorityShapeProblems } from './priority-shape.mjs';
import { MAX_ATTEMPTS, entryDigest, loadState, saveState } from './state.mjs';
import { setUnitState } from './unit.mjs';
import { UsageError } from './errors.mjs';

const joinAnd = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

/** The problems of one part file against the groups of its part: `{ problems, items }`, items the valid ones in the order of the groups. */
function partProblems(doc, groups, run) {
  const shape = priorityShapeProblems(doc);
  if (shape.length > 0) return { problems: shape, items: [] };
  const wanted = new Set(groups.map((group) => group.key));
  const problems = [];
  const seen = new Set();
  for (const item of doc.items) {
    if (!wanted.has(item.key)) problems.push(`${item.key}: is not a group of this part (the findings changed, or the key was altered)`);
    else if (seen.has(item.key)) problems.push(`${item.key}: more than one item`);
    seen.add(item.key);
    if (/[\r\n]/.test(item.reason.trim())) problems.push(`${item.key}: the reason must be one line`);
  }
  for (const group of groups) if (!seen.has(group.key)) problems.push(`${group.key}: no item`);
  if (problems.length > 0) return { problems, items: [] };
  const texts = doc.items.map((item) => ({ path: `${item.key}.reason`, text: item.reason.trim() }));
  const readerProblems = readerTextProblems(texts, run, { advice: true });
  if (readerProblems.length > 0) return { problems: readerProblems, items: [] };
  const byKey = new Map(doc.items.map((item) => [item.key, { key: item.key, consequence: item.consequence, reason: item.reason.trim() }]));
  return { problems: [], items: groups.map((group) => byKey.get(group.key)) };
}

/** Run check-priority. Returns { status, lines }. */
export function checkPriority(outDir, root) {
  const context = loadPriorityContext(outDir, root);
  if (context.stop) return context.stop;
  const { run, groups, digest, entry } = context;
  if (groups.length === 0) return { status: 0, lines: ['Priority: no verified findings; nothing to check'] };
  // A ranking that two judges settled for these groups and whose file is unchanged is not checked again: that would drop what the judges recorded.
  const ranked = new Set((run.priority.doc?.items ?? []).map((item) => item.key));
  if (run.priority.doc !== null && groups.every((group) => ranked.has(group.key))) return { status: 0, lines: [`${PRIORITY_ID}: verified, unchanged since it was verified`] };
  const stateRead = loadState(context.outDir);
  if (!stateRead.ok) {
    if (stateRead.missing) throw new UsageError(stateRead.problem);
    return { status: 1, lines: [stateRead.problem] };
  }
  const { state } = stateRead;
  // Another input than the one the entry was made for starts the unit over: its attempts and what the judges left unranked do not carry.
  const fresh = entry.groupsDigest !== digest;
  const attempts = fresh ? 0 : entry.attempts;

  const parts = partsOf(groups);
  const problems = [];
  const again = [];
  const merged = [];
  parts.forEach((part, index) => {
    const number = index + 1;
    const path = partFilePath(context.outDir, number);
    if (!existsSync(path)) {
      problems.push(`part ${number}: lane-wrote-nothing: priority/part-${number}.json is missing`);
      again.push(number);
      return;
    }
    const read = readJson(path);
    if (!read.ok) {
      problems.push(`part ${number}: priority/part-${number}.json ${read.reason}`);
      again.push(number);
      return;
    }
    const checked = partProblems(read.value, part, run);
    if (checked.problems.length > 0) {
      problems.push(...checked.problems.map((line) => `part ${number}: ${line}`));
      again.push(number);
    } else merged.push(...checked.items);
  });

  if (problems.length > 0) {
    setUnitState(state, PRIORITY_ID, { status: 'failed', attempts, groupsDigest: digest, failure: { step: 'check-entry', reasons: problems } });
    saveState(context.outDir, state);
    const named = `${again.length === 1 ? 'part' : 'parts'} ${joinAnd(again.map(String))}`;
    const next = attempts < MAX_ATTEMPTS
      ? `Next: delete the part file of ${named}, mark priority dispatched and re-dispatch the ranking lane once for ${named} with the lines above (attempt 2 of 2)`
      : `Next: ${PRIORITY_ID} stays failed (${MAX_ATTEMPTS} of ${MAX_ATTEMPTS} attempts)`;
    return { status: 1, lines: [...problems, next] };
  }
  const file = join(context.outDir, PRIORITY_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeJson(file, { schema: PRIORITY_FORMAT, items: merged });
  setUnitState(state, PRIORITY_ID, { status: 'checked', attempts, groupsDigest: digest, entryDigest: entryDigest(file) });
  saveState(context.outDir, state);
  return { status: 0, lines: [`${PRIORITY_ID}: checked (${groups.length} groups, ${parts.length} ${parts.length === 1 ? 'part' : 'parts'})`, 'Next: run priority-judge'] };
}
