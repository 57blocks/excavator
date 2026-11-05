/**
 * `handbook.mjs reply <out> --project <root>`: the lines the orchestrator
 * answers the user with at the end of a run, in a fixed order, computed from
 * the checked run so the model adds nothing up and writes none of them: the
 * path of handbook.md, the page line, the feature counts by status, the
 * status of the system overview and the candidate conservation line. Changes no file.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { HANDBOOK_FILE } from './assemble.mjs';
import { loadCheckedRun } from './load-run.mjs';
import { PAGE_FILE } from './page.mjs';
import { STATUSES } from './state.mjs';
import { OVERVIEW_ID, unitState } from './unit.mjs';

/** Returns { status, lines }; status 1 with the reasons when the run does not pass its checks or handbook.md is missing. */
export function replyLines(outDirArg, root) {
  const run = loadCheckedRun(outDirArg, root);
  if (!run.ok) return { status: 1, lines: run.lines };
  const outDir = resolve(outDirArg);
  const handbook = join(outDir, HANDBOOK_FILE);
  if (!existsSync(handbook)) return { status: 1, lines: [`${HANDBOOK_FILE}: missing`, 'Next: run assemble, then this command again'] };
  const page = join(outDir, PAGE_FILE);
  const features = run.map.features;
  const counts = Object.fromEntries(STATUSES.map((status) => [status, features.filter((feature) => run.state.features[feature.id].status === status).length]));
  const overview = unitState(run.state, OVERVIEW_ID).status;
  const failed = [...features.filter((feature) => run.state.features[feature.id].status === 'failed').map((feature) => feature.id), ...(overview === 'failed' ? [OVERVIEW_ID] : [])];
  const assigned = features.reduce((sum, feature) => sum + feature.candidates.length, 0);
  const lines = [
    `Handbook: ${handbook}`,
    existsSync(page) ? `Page: ${page}` : 'Page: not written',
    `Features: ${features.length} (${STATUSES.map((status) => `${status} ${counts[status]}`).join(', ')})`,
    `Overview: ${overview}`,
  ];
  if (failed.length > 0) lines.push(`Failed: ${failed.join(', ')}`);
  lines.push(`Candidates: ${run.candidates.length} listed, ${assigned} in features, ${run.map.unassigned.length} unassigned; none missing, none counted twice`);
  return { status: 0, lines };
}
