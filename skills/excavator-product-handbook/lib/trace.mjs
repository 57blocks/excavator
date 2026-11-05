/**
 * `handbook.mjs trace <out> <id> --project <root>` (design D14, the third
 * check): for a `confirmed` feature, write the items that still carry evidence
 * as trace files, one per part of at most 25 items, for two tracers per part
 * that read the whole project and look only for code that contradicts a claim.
 * A trace file holds each item's id, claim and the file and line range of each
 * cited passage, and no code; both tracers of a part read it and each writes
 * its own verdict file. Removes the feature's older trace and trace-verdict
 * files first. Changes no other file and no state.
 */

import { mkdirSync, rmSync } from 'node:fs';

import { writeJson } from './json-file.mjs';
import { TRACERS, confirmedPlan, traceDirPath, tracePartFile, tracePartPath, traceVerdictDirPath, traceVerdictPath } from './trace-plan.mjs';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Run trace. Returns { status, lines }. */
export function trace(outDir, id, root) {
  const plan = confirmedPlan(outDir, id, root);
  if (plan.stop) return plan.stop;
  for (const stale of [traceDirPath(outDir, id), traceVerdictDirPath(outDir, id)]) rmSync(stale, { recursive: true, force: true });
  mkdirSync(traceDirPath(outDir, id), { recursive: true });
  const lines = [`${id}: ${plural(plan.items.length, 'item')} in ${plural(plan.parts.length, 'part')}`];
  plan.parts.forEach((items, index) => {
    const number = index + 1;
    writeJson(tracePartPath(outDir, id, number), tracePartFile(id, number, plan.parts.length, items));
    const verdictFiles = TRACERS.map((letter) => traceVerdictPath(outDir, id, number, letter));
    lines.push(`Part ${number}/${plan.parts.length}: ${plural(items.length, 'item')} | Trace file: ${tracePartPath(outDir, id, number)} | Verdict files: ${verdictFiles.join(' ')}`);
  });
  lines.push(`Next: dispatch two excavator-handbook-tracer subagents per part of ${id}, one per verdict file, each with the trace file, its verdict file and the project root of its line above, then run trace-verdicts for ${id}`);
  return { status: 0, lines };
}
