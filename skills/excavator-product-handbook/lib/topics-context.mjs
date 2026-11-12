/**
 * What the topics commands and `mark topics:<lane>` start from (openspec change
 * handbook-topics): the checked run (load-run.mjs, so a run whose files changed
 * after their check is refused as `assemble` refuses it), the lanes with the
 * facts each may cite (topics-facts.mjs) and the unit's state. Reads files only;
 * the commands write what they record.
 */

import { UsageError } from './errors.mjs';
import { loadCheckedRun } from './load-run.mjs';
import { laneEntry } from './topics-state.mjs';
import { loadTopicFacts } from './topics-facts.mjs';

/**
 * `{ stop }` with the lines of a run that does not pass its checks, else `{ run, outDir, facts, hasLanes }`: `facts` is the
 * result of `loadTopicFacts`, `hasLanes` whether there is any lane (without one there is nothing to write).
 */
export function loadTopicsContext(outDirArg, root) {
  const run = loadCheckedRun(outDirArg, root);
  if (!run.ok) return { stop: { status: 1, lines: run.lines } };
  const facts = loadTopicFacts(run, root);
  return { run, outDir: run.outDir, facts, hasLanes: facts.lanes.length > 0 };
}

/** The lane `id` of a context, or a UsageError that says which lanes exist. */
export function requireLane(context, id) {
  if (id === undefined) throw new UsageError('this command needs --lane <id>; topic-lanes lists the lanes');
  const found = context.facts.byLane.get(id);
  if (found === undefined) throw new UsageError(`${JSON.stringify(id)} is not a lane; topic-lanes lists the lanes (${context.facts.lanes.map((lane) => lane.id).join(', ') || 'none'})`);
  return found;
}

/**
 * The status of a lane for the facts as they are now: its state entry when that entry was made for these facts, else planned
 * (a lane whose facts changed starts over).
 */
export function currentEntry(state, lane) {
  const entry = laneEntry(state, lane.id);
  return entry.factsDigest === lane.digest ? entry : { status: 'planned', attempts: 0 };
}
