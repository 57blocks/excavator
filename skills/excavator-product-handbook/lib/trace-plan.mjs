/**
 * The items a tracer reads (design D14, the third check) and what both trace
 * commands share. A `confirmed` feature is cut into trace parts: each item
 * that still carries evidence is `{ id, claim, citations }`, the id its JSON
 * path, the claim exactly as the verifiers saw it, and the citations the file
 * and line range of each cited passage, no code: the tracer reads the project
 * itself. Parts hold at most `PART_MAX_ITEMS` items, in entry order, in
 * `<out>/trace/<id>/part-<n>.json`; each part is traced by two tracers that do
 * not see each other (design D1 of handbook-dual-tracer), each writing its
 * verdicts to its own file `<out>/trace-verdicts/<id>/part-<n>.a.json` or
 * `part-<n>.b.json`.
 */

import { join } from 'node:path';

import { itemClaims } from './claims.mjs';
import { checkEntryFile, entryPath, loadForEntry } from './entry-check.mjs';
import { entryItems } from './items.mjs';
import { readJson } from './json-file.mjs';
import { locatePassage } from './locate.mjs';
import { entryDigest, featureState, loadState } from './state.mjs';
import { loadUi } from './ui.mjs';
import { UsageError } from './errors.mjs';
import { PART_MAX_ITEMS, VERIFIERS } from './verify-plan.mjs';

export const TRACE_DIR = 'trace';
export const TRACE_VERDICT_DIR = 'trace-verdicts';

export const traceDirPath = (outDir, id) => join(outDir, TRACE_DIR, id);
export const tracePartPath = (outDir, id, part) => join(traceDirPath(outDir, id), `part-${part}.json`);
export const traceVerdictDirPath = (outDir, id) => join(outDir, TRACE_VERDICT_DIR, id);
/** The verdict file of the tracer `letter` (one of `VERIFIERS`, the letters the two verifiers of a part use too) of a part. */
export const traceVerdictPath = (outDir, id, part, letter) => join(traceVerdictDirPath(outDir, id), `part-${part}.${letter}.json`);
export const TRACERS = VERIFIERS;

/** The content of a trace part file. */
export const tracePartFile = (feature, part, parts, items) => ({ feature, part, parts, items });

/** The trace items of `entry`: the items that carry evidence, in entry order. `ui` is the fixed-text table; `files` a projectFiles reader. */
export function traceItems(entry, { ui, files }) {
  const claims = itemClaims(entry, ui);
  return entryItems(entry).filter((item) => item.evidence.length > 0).map((item) => {
    const claim = claims.get(item.path);
    if (claim === undefined) throw new Error(`no claim for item ${item.path}`);
    const citations = [];
    for (const { file, passage } of item.evidence) {
      const resolved = files.resolve(file);
      if (!resolved.ok) throw new Error(`${file} ${resolved.reason}`);
      const found = locatePassage(resolved.text, passage);
      if (found === null) throw new Error(`passage not in ${file} exactly once`);
      const lines = `${found.startLine}-${found.endLine}`;
      if (!citations.some((one) => one.file === file && one.lines === lines)) citations.push({ file, lines });
    }
    return { id: item.path, claim, citations };
  });
}

/** Cut the trace items into parts of at most `PART_MAX_ITEMS`, in order; at least one part, empty when there is no item. */
export function splitTraceParts(items) {
  const parts = [];
  for (let from = 0; from < items.length; from += PART_MAX_ITEMS) parts.push(items.slice(from, from + PART_MAX_ITEMS));
  return parts.length === 0 ? [[]] : parts;
}

const nextAfter = (status) => {
  if (status === 'verified') return 'nothing; it is verified';
  if (status === 'failed') return 'nothing; it failed';
  return `settle it with the verifiers first (check-entry, slices, the verifiers, verdicts), then run trace`;
};

/**
 * The plan of the trace of feature `id`, or the lines that stop the command:
 * only a `confirmed` feature is traced, its entry must still pass check-entry
 * as a settled entry and must still be the file that was confirmed. Returns
 * `{ stop }` or `{ state, current, entry, loaded, items, claims, parts }`
 * (`parts`: the item lists of the trace parts).
 */
export function confirmedPlan(outDir, id, root) {
  const stateRead = loadState(outDir);
  if (!stateRead.ok) {
    if (stateRead.missing) throw new UsageError(stateRead.problem);
    return { stop: { status: 1, lines: [stateRead.problem] } };
  }
  const { state } = stateRead;
  const current = featureState(state, id);
  if (current.status !== 'confirmed') {
    return { stop: { status: 1, lines: [`${id}: is ${current.status}; only a confirmed feature is traced`, `Next: ${nextAfter(current.status)}`] } };
  }
  const loaded = loadForEntry(outDir, id, root);
  if (loaded.stop) return { stop: loaded.stop };
  const again = `Next: run check-entry for ${id}, then verify it again (slices, the verifiers, verdicts) before trace`;
  const result = checkEntryFile(outDir, id, root, loaded, { settled: true });
  if (result.problems.length > 0) return { stop: { status: 1, lines: [...result.problems, `${id}: ${entryPath(id)} no longer passes check-entry`, again] } };
  if (entryDigest(join(outDir, entryPath(id))) !== current.entryDigest) {
    return { stop: { status: 1, lines: [`${id}: ${entryPath(id)} changed after it was confirmed`, again] } };
  }
  const ui = loadUi(outDir);
  if (!ui.ok) return { stop: { status: 1, lines: ui.lines } };
  const entry = readJson(join(outDir, entryPath(id))).value;
  const items = traceItems(entry, { ui: ui.strings, files: loaded.files });
  return { state, current, entry, loaded, items, claims: new Map(items.map((item) => [item.id, item.claim])), parts: splitTraceParts(items) };
}
