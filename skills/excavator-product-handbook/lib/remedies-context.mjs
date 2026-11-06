/**
 * What the four remedies commands and `mark remedies` start from (openspec
 * change handbook-remedies): the checked run (load-run.mjs, so a run whose
 * files changed after their check is refused as `assemble` refuses it), the
 * facts a lane may cite (remedies-facts.mjs) and the unit's state. Reads files
 * only; the commands write what they record.
 */

import { loadCheckedRun } from './load-run.mjs';
import { loadRemedyFacts } from './remedies-facts.mjs';
import { remediesEntry } from './remedies-state.mjs';

/**
 * `{ stop }` with the lines of a run that does not pass its checks, else `{ run, outDir, facts, hasGroups, entry }`: `facts` the
 * facts of remedies-facts.mjs, `hasGroups` whether any verified finding exists (without one there is nothing to write), `entry`
 * the unit's state.
 */
export function loadRemediesContext(outDirArg, root) {
  const run = loadCheckedRun(outDirArg, root);
  if (!run.ok) return { stop: { status: 1, lines: run.lines } };
  const facts = loadRemedyFacts(run, root);
  return { run, outDir: run.outDir, facts, hasGroups: facts.groups.length > 0, entry: remediesEntry(run.state) };
}
