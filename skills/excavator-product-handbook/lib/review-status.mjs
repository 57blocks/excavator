/**
 * The resume and report commands of the design-problems phase (openspec change handbook-design-review, D4):
 * `review status` says what each batch still needs from the files it has, `review reset` and `review skip` clear
 * or empty a batch, `review titles` lists the items of the domain batches for the comparison writers and `review summary`
 * prints the kept and removed counts of each batch. The phase text decides nothing the files can decide.
 */

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { readJson, writeJson } from './json-file.mjs';
import { compareStatus, compareStatusLines } from './review-compare-status.mjs';
import { batchFile, reviewContext, validateBatch } from './review-render.mjs';
import { REMOVED_FILE, unprunedFile, verdictsFile } from './review-verify.mjs';

/** One of write (no valid file), verify (valid items to judge), prune (verdicts, or no item, to apply) or done (pruned). */
function batchState(ctx, batch) {
  const has = (file) => existsSync(join(ctx.outDir, file));
  if (batch.compare === true && ctx.facts.batches.some((domain) => batchState(ctx, domain).state !== 'done')) return { state: 'wait', reasons: [] };
  if (has(unprunedFile(batch.id))) return { state: 'done', reasons: [] };
  if (has(verdictsFile(batch.id))) return { state: 'prune', reasons: [] };
  if (!has(batchFile(batch.id))) return { state: 'write', reasons: [] };
  const checked = validateBatch(ctx, batch);
  if (checked.reasons.length > 0) return { state: 'write', reasons: checked.reasons };
  return { state: checked.items.length === 0 ? 'prune' : 'verify', reasons: [] };
}

function openContext(outDir, root) {
  const ctx = reviewContext(outDir, root);
  return ctx.ok ? ctx : { ok: false, result: { status: 1, lines: ctx.lines } };
}

/** `review status <out> --project <root>`: one `<batch><TAB><state><TAB><name>` line per batch, and the reasons of a file that does not pass. */
export function reviewStatus(outDir, root) {
  const ctx = openContext(outDir, root);
  if (!ctx.ok) return ctx.result;
  const lines = [];
  for (const batch of ctx.batches) {
    const { state, reasons } = batchState(ctx, batch);
    lines.push([batch.id, state, batch.name].join('\t'), ...reasons.map((reason) => `  ${reason}`));
  }
  return { status: 0, lines };
}

const checked = (ctx, id) => {
  const batch = ctx.batches.find((entry) => entry.id === id);
  return batch === undefined ? null : batch;
};

/** `review reset <out> <batch>`: delete the batch file, its verdicts, its unpruned copy and its removal records. */
export function resetBatch(outDir, id, { empty = false } = {}) {
  const ctx = openContext(outDir, undefined);
  if (!ctx.ok) return ctx.result;
  if (checked(ctx, id) === null) return { status: 1, lines: [`${id} is not a batch; the batches are ${ctx.batches.map((entry) => entry.id).join(', ')}`] };
  for (const file of [batchFile(id), verdictsFile(id), unprunedFile(id)]) rmSync(join(outDir, file), { force: true });
  const recorded = readJson(join(outDir, REMOVED_FILE));
  if (recorded.ok && Array.isArray(recorded.value?.removed)) writeJson(join(outDir, REMOVED_FILE), { removed: recorded.value.removed.filter((entry) => entry.batch !== id) });
  if (empty) writeJson(join(outDir, batchFile(id)), { items: [] });
  return { status: 0, lines: [empty ? `${id}: emptied` : `${id}: cleared`] };
}

/** `review titles <out> --project <root>`: the items of every domain batch whose file passes, one line each; the comparison writers read it. */
export function reviewTitles(outDir, root) {
  const ctx = openContext(outDir, root);
  if (!ctx.ok) return ctx.result;
  const lines = [];
  for (const batch of ctx.facts.batches) {
    const result = validateBatch(ctx, batch);
    if (result.reasons.length > 0) continue;
    result.items.forEach((item, at) => lines.push([batch.id, `item ${at}`, item.dimension, item.impact, item.features.join(','), item.title].join('\t')));
  }
  return { status: 0, lines: lines.length > 0 ? lines : ['(no item in any batch)'] };
}

/** `review summary <out>`: one `<batch><TAB><name><TAB>kept=<n><TAB>removed=<m>` line for each batch that has been pruned. */
export function reviewSummary(outDir) {
  const ctx = openContext(outDir, undefined);
  if (!ctx.ok) return ctx.result;
  const removed = readJson(join(outDir, REMOVED_FILE));
  const records = removed.ok && Array.isArray(removed.value?.removed) ? removed.value.removed : [];
  const lines = [];
  for (const batch of ctx.batches) {
    if (!existsSync(join(outDir, unprunedFile(batch.id)))) continue;
    const items = readJson(join(outDir, batchFile(batch.id)));
    const kept = items.ok && Array.isArray(items.value?.items) ? items.value.items.length : 0;
    lines.push([batch.id, batch.name, `kept=${kept}`, `removed=${records.filter((entry) => entry.batch === batch.id).length}`].join('\t'));
  }
  return { status: 0, lines: lines.length > 0 ? lines : ['(no batch has been pruned)'] };
}

/** `review compare-status <out> --project <root>`: the COMPARE and UNJUDGED lines; writes no file. */
export function compareStatusReport(outDir, root) {
  const ctx = openContext(outDir, root);
  if (!ctx.ok) return ctx.result;
  return { status: 0, lines: compareStatusLines(compareStatus(outDir, ctx.batches.map((batch) => batch.id))) };
}
