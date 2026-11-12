/**
 * `handbook.mjs topic-lanes <out> --project <root>` and `handbook.mjs topic-facts
 * <out> --lane <id> --project <root>` (openspec change handbook-topics, design
 * D2). `topic-lanes` prints the lanes that have something to write, one line each,
 * tab-separated: the lane id, the name of its domain (`-` for `repeated`), the
 * number of facts and its status for the facts as they are now. `topic-facts`
 * prints the facts a lane may cite, one line each (topics-facts.mjs holds the
 * line formats), or, when there is nothing for the lane to do (it is verified,
 * waiting for its judges, or failed twice), one line that starts with `Topics:`
 * and no fact. A domain lane's lines end with one line `domain:<id>` and the name for each other domain of the handbook, which a data row
 * may name as its provider; they are not facts and cannot be cited. Both print one `Topics:` line when there is no lane at all.
 * Neither changes a file.
 */

import { loadTopicsContext, currentEntry, requireLane } from './topics-context.mjs';
import { factLine } from './topics-facts.mjs';
import { MAX_ATTEMPTS } from './state.mjs';

export const DOMAIN_PREFIX = 'domain:';
export const NO_LANE_NOTE = 'no verified entry and no verified finding; nothing to write';

/** Run topic-lanes. Returns { status, lines }. */
export function topicLanes(outDir, root) {
  const context = loadTopicsContext(outDir, root);
  if (context.stop) return context.stop;
  if (!context.hasLanes) return { status: 0, lines: [`Topics: ${NO_LANE_NOTE}`] };
  return {
    status: 0,
    lines: context.facts.lanes.map((lane) => [lane.id, lane.name, String(lane.rows.length), currentEntry(context.run.state, lane).status].join('\t')),
  };
}

/** Run topic-facts for the lane `laneId`. Returns { status, lines }; an unknown or missing lane is a UsageError. */
export function topicFacts(outDir, root, laneId) {
  const context = loadTopicsContext(outDir, root);
  if (context.stop) return context.stop;
  if (!context.hasLanes) return { status: 0, lines: [`Topics: ${NO_LANE_NOTE}`] };
  const lane = requireLane(context, laneId);
  const entry = currentEntry(context.run.state, lane);
  const note = (text) => ({ status: 0, lines: [`Topics: ${lane.id}: ${text}`] });
  if (entry.status === 'verified' || entry.status === 'checked') return note(`${entry.status}; nothing to write`);
  if (entry.status === 'failed' && entry.attempts >= MAX_ATTEMPTS) return note(`failed (${MAX_ATTEMPTS} of ${MAX_ATTEMPTS} attempts); its rows are not written`);
  // A domain lane also sees the other domains (id and name), so a data row can name its provider; those lines are not facts a row may cite.
  const others = lane.kind === 'domain' ? context.facts.domains.filter((domain) => domain.id !== lane.id).map((domain) => `${DOMAIN_PREFIX}${domain.id}\t${domain.name}`) : [];
  return { status: 0, lines: [...lane.rows.map(factLine), ...others] };
}
