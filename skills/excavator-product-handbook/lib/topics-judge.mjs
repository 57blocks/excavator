/**
 * `handbook.mjs topic-judge <out> [--lane <id>] --project <root>` (openspec change
 * handbook-topics, design D5): for each lane that passed check-topics, write the
 * judge file `<out>/topics/judge/<lane>.json` and print where each of the two
 * judges reads and writes. The judge file holds, for each row, its topic, its
 * columns and everything it cites (each cited fact with its id and content); a
 * data row also carries the names of its two domains and an access row the name of
 * its feature. It holds no code, no other row and nothing else. The two judges do
 * not see each other, each with its own verdict file
 * `<out>/topics/verdicts/<lane>.<a|b>.json`. Older judge and verdict files of the
 * lanes are cleared first. A lane without a row has nothing to judge and no file.
 * Changes only files under `<out>/topics`.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import { writeJson } from './json-file.mjs';
import { currentEntry, loadTopicsContext, requireLane } from './topics-context.mjs';
import { JUDGES, judgeFilePath, judgeVerdictPath, partFileName, rowsOf } from './topics-shape.mjs';
import { readLaneFile } from './topics-state.mjs';

const RERUN = 'Next: run topic-facts, write the rows of the lane, then run check-topics';

/**
 * The lanes of a context that passed check-topics (or the one named by `laneId`), or the lines that stop a judge command: a lane
 * must be `checked` for the facts of today and its file must be the one that was checked. Returns `{ stop }` or `{ lanes: [{ lane, doc }] }`.
 */
export function checkedLanes(context, laneId) {
  const chosen = laneId === undefined ? context.facts.lanes : [requireLane(context, laneId)];
  const lanes = [];
  for (const lane of chosen) {
    const entry = currentEntry(context.run.state, lane);
    if (entry.status !== 'checked') continue;
    const { doc } = readLaneFile(context.outDir, lane.id, entry);
    if (doc === null) return { stop: { status: 1, lines: [`topics:${lane.id}: ${partFileName(lane.id)} changed after it was checked`, RERUN] } };
    lanes.push({ lane, doc });
  }
  if (lanes.length === 0) return { stop: { status: 1, lines: ['topics: no lane is checked; only checked lanes are judged', RERUN] } };
  return { lanes };
}

/** What a judge reads of a cited fact: its fields, joined (the id is the key). */
const contentOf = (row) => row.fields.join(' | ');

/** The fields of a row as a judge reads them: a data row's domains and an access row's feature come with their names. */
function fieldsOf(row, facts) {
  const nameOf = (id) => facts.domains.find((domain) => domain.id === id)?.name ?? id;
  if (row.topic === 'handoffs') return { from: row.fields.from, fromName: nameOf(row.fields.from), to: row.fields.to, toName: nameOf(row.fields.to), content: row.fields.content };
  if (row.topic === 'access') return { feature: row.fields.feature, featureName: facts.features.get(row.fields.feature) ?? row.fields.feature, who: row.fields.who, pageCheck: row.fields.pageCheck, serverCheck: row.fields.serverCheck };
  return row.fields;
}

/** The judge file of one lane: `{ unit, lane, rows: [{ id, topic, fields, cites: [{ id, content }] }] }`. */
export function judgeFile(lane, doc, facts) {
  return {
    unit: 'topics',
    lane: lane.id,
    rows: rowsOf(doc).map((row) => ({ id: row.id, topic: row.topic, fields: fieldsOf(row, facts), cites: row.cites.map((id) => ({ id, content: contentOf(lane.byId.get(id)) })) })),
  };
}

/** Run topic-judge. Returns { status, lines }. */
export function topicJudge(outDirArg, root, laneId) {
  const context = loadTopicsContext(outDirArg, root);
  if (context.stop) return context.stop;
  if (!context.hasLanes) return { status: 0, lines: ['Topics: no verified entry and no verified finding; nothing to judge'] };
  const checked = checkedLanes(context, laneId);
  if (checked.stop) return checked.stop;
  const { outDir, facts } = context;
  const lines = [`topics: ${checked.lanes.length} ${checked.lanes.length === 1 ? 'lane' : 'lanes'}, ${checked.lanes.reduce((sum, { doc }) => sum + doc.rows.length, 0)} rows`];
  for (const { lane, doc } of checked.lanes) {
    rmSync(judgeFilePath(outDir, lane.id), { force: true });
    for (const letter of JUDGES) rmSync(judgeVerdictPath(outDir, lane.id, letter), { force: true });
    if (doc.rows.length === 0) {
      lines.push(`Lane ${lane.id}: no rows; nothing to judge`);
      continue;
    }
    const path = judgeFilePath(outDir, lane.id);
    mkdirSync(dirname(path), { recursive: true });
    mkdirSync(dirname(judgeVerdictPath(outDir, lane.id, 'a')), { recursive: true });
    writeJson(path, judgeFile(lane, doc, facts));
    lines.push(`Lane ${lane.id}: ${doc.rows.length} rows | Judge file: ${path} | Verdict files: ${JUDGES.map((letter) => judgeVerdictPath(outDir, lane.id, letter)).join(' ')}`);
  }
  lines.push('Next: dispatch two excavator-handbook-topic-judge subagents for each lane that has a judge file, one for each verdict file, then run topic-verdicts');
  return { status: 0, lines };
}
