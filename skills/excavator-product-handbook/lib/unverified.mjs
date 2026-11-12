/**
 * Which parts of a run's output are written but not verified (openspec change
 * handbook-light-scheme): a `checked` overview, findings unit or system unit,
 * ranking, remedies and topics lane is final and goes into the outputs under a
 * fixed not-verified sentence. `unverified` is the set of unit ids load-run.mjs
 * returns; the ranking, the remedies and the topics carry their own flag in their
 * models. Both outputs read the parts here, so the handbook and the page cannot differ.
 */

import { isFindingsId } from './findings-shape.mjs';
import { OVERVIEW_ID } from './overview-shape.mjs';
import { isSystemId } from './system-shape.mjs';

/** `{ overview, findings, systemFindings }`: whether the overview is unverified and how many findings units and system units are. */
export function unverifiedCounts(unverified = new Set()) {
  const ids = [...unverified];
  return { overview: ids.includes(OVERVIEW_ID), findings: ids.filter(isFindingsId).length, systemFindings: ids.filter(isSystemId).length };
}

/**
 * The parts that are written but not verified, with only the keys that hold: `overview` true, `findings` and `systemFindings` the number of
 * units, `priority`, `remedies` and `topics` true. `findings`, `remedies` and `topics` are the models of handbook-model.mjs.
 */
export function unverifiedParts(unverified, { findings, remedies, topics }) {
  const counts = unverifiedCounts(unverified);
  return {
    ...(counts.overview ? { overview: true } : {}),
    ...(counts.findings > 0 ? { findings: counts.findings } : {}),
    ...(counts.systemFindings > 0 ? { systemFindings: counts.systemFindings } : {}),
    ...(findings?.priority?.unverified === true ? { priority: true } : {}),
    ...(remedies?.unverified === true ? { remedies: true } : {}),
    ...(topics?.unverified === true ? { topics: true } : {}),
  };
}
