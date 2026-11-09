/**
 * `handbook.mjs priority-items <out> --project <root> [--part <n>]` (openspec
 * change handbook-findings-priority, design D3): print the groups of the
 * verified findings a ranking lane ranks, one line each, computed from the
 * findings as they are now (a group whose statement or members changed has
 * another key, so it is listed again). A line is tab-separated: the group key,
 * the display name of the category, the representative statement and the other
 * statements of the group joined with ` | ` (empty for none). `--part <n>`
 * prints only the lines of part n (at most 40 groups, in the order printed).
 * When there is nothing for a lane to do, it prints one line that starts with
 * `Priority:` and no group line: no verified finding, a ranking that is current,
 * one waiting for its judges, or one that failed twice. Changes no file.
 */

import { UsageError } from './errors.mjs';
import { categoryKey } from './findings-shape.mjs';
import { groupLine, partsOf } from './priority-groups.mjs';
import { loadPriorityContext } from './priority-context.mjs';
import { MAX_ATTEMPTS } from './state.mjs';

const note = (text) => ({ status: 0, lines: [`Priority: ${text}`] });

/** Run priority-items. Returns { status, lines }; a `part` outside the parts is a UsageError. */
export function priorityItems(outDir, root, part) {
  const context = loadPriorityContext(outDir, root);
  if (context.stop) return context.stop;
  const { run, groups, digest, entry } = context;
  if (groups.length === 0) return note('no verified findings; nothing to rank');
  const ranked = new Set((run.priority.doc?.items ?? []).map((item) => item.key));
  if (run.priority.doc !== null && groups.every((group) => ranked.has(group.key))) return note(`verified (${groups.length} groups); nothing to rank`);
  if (entry.status === 'checked' && entry.groupsDigest === digest) return note('checked; next: run priority-judge');
  if (entry.status === 'failed' && entry.attempts >= MAX_ATTEMPTS && entry.groupsDigest === digest) return note(`failed (${MAX_ATTEMPTS} of ${MAX_ATTEMPTS} attempts); the groups stay unranked`);
  const parts = partsOf(groups);
  if (part !== undefined && !(Number.isInteger(part) && part >= 1 && part <= parts.length)) throw new UsageError(`--part must be a number from 1 to ${parts.length}`);
  const chosen = part === undefined ? groups : parts[part - 1];
  return { status: 0, lines: chosen.map((group) => groupLine(group, run.ui[categoryKey(group.category)])) };
}
