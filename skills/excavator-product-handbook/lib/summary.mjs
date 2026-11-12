/**
 * The two cross-cutting tables of the handbook (openspec change
 * handbook-summary-tables): every notification of every verified entry, and one
 * row per scheduled-job candidate. Pure and deterministic, no model: the same
 * loaded run and source give the same object. Both `render.mjs` and
 * `page-data.mjs` take their tables from here, so the markdown and the page
 * cannot differ. The output holds no evidence, no file and no path.
 *
 * What a job does is only what a verified automatic item of its own feature
 * says about the registration line itself: one of its citations is in the
 * candidate's file and its located line range holds the candidate's line.
 * There is no fallback to the same file or the same feature, since a file that
 * registers many jobs would lend one job's description to another.
 */

import { citationLocator } from './citation-locator.mjs';
import { scheduleBucket } from './schedule.mjs';

/**
 * The automatic items of `entry` (`{ when, effect }`, in entry order) with a
 * citation that covers line `line` of `file`. A citation that does not locate
 * (file unreadable, passage absent or ambiguous) is no match.
 */
function describing(entry, file, line, locate) {
  return entry.automatic
    .filter((item) => item.evidence.some((citation) => {
      if (citation.file !== file) return false;
      const found = locate(citation);
      return found !== null && found.startLine <= line && line <= found.endLine;
    }))
    .map((item) => ({ when: item.when, effect: item.effect }));
}

/**
 * `{ notifications, jobs, counts }` of a loaded run (`loadCheckedRun`'s result)
 * over the project at `root`. Notifications follow the map's areas, then the
 * features of each area in map order, then the entry's order; jobs follow the
 * candidates' order. A job row has `feature` (an id, or null when the map left
 * it unassigned, then with the map's `reason`), `schedule` and `automatic`.
 */
export function buildSummary(run, root) {
  const { map, entries, candidates } = run;
  const locate = citationLocator(root);

  const notifications = [];
  for (const area of map.areas) {
    for (const feature of map.features.filter((item) => item.area === area.id && entries.has(item.id))) {
      for (const n of entries.get(feature.id).notifications) {
        notifications.push({ feature: feature.id, trigger: n.trigger, recipient: n.recipient, channel: n.channel, content: n.content });
      }
    }
  }

  const owner = new Map(map.features.flatMap((feature) => feature.candidates.map((id) => [id, feature.id])));
  const reasons = new Map(map.unassigned.map((item) => [item.candidate, item.reason]));
  const jobs = candidates.filter((item) => item.kind === 'job').map((item) => {
    const featureId = owner.get(item.id) ?? null;
    if (featureId === null && !reasons.has(item.id)) throw new Error(`job candidate ${item.id} is neither in a feature nor unassigned in the map`);
    const entry = featureId === null ? undefined : entries.get(featureId);
    return {
      kind: 'job',
      candidate: item.id,
      feature: featureId,
      reason: featureId === null ? reasons.get(item.id) : null,
      schedule: scheduleBucket(typeof item.text === 'string' ? item.text : ''),
      automatic: entry === undefined ? [] : describing(entry, item.file, item.line, locate),
    };
  });

  const bucket = (name) => jobs.filter((row) => row.schedule.bucket === name).length;
  return {
    notifications,
    jobs,
    counts: {
      featureTotal: map.features.length,
      // Labelled verified, so a checked /3 entry (in `entries`, not verified) is not counted.
      featuresWithEntry: map.features.filter((feature) => entries.has(feature.id) && !(run.chapters?.has(feature.id))).length,
      notificationRows: notifications.length,
      jobRows: jobs.length,
      schedule: { literal: bucket('literal'), computed: bucket('computed'), absent: bucket('absent') },
      described: jobs.filter((row) => row.automatic.length > 0).length,
    },
  };
}
