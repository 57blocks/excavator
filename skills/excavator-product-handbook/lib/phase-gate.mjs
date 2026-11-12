/**
 * The gate in front of the phases that run after the features (openspec change
 * handbook-phase-gate, design D1): priority-items, remedy-facts, topic-lanes and
 * outline-facts call `phaseGate` before anything else they print. Once the
 * feature phase has started (some feature unit or findings unit has an attempt),
 * a feature of this run that is not written (planned, dispatched, or failed with
 * fewer than two attempts), or a findings unit of it in the same state when the
 * findings phase has started, stops the command with exit 1, the unwritten units
 * and a Next: line that sends the orchestrator back to Phase 4. Reads files only.
 */

import { join } from 'node:path';

import { findingsId } from './findings-shape.mjs';
import { readJson } from './json-file.mjs';
import { loadState, MAX_ATTEMPTS } from './state.mjs';

export const GATE_NEXT = 'Next: go back to Phase 4, write these lanes, then run this command again';

/** The ids of `--features` (space separated, as `$SELECTED` prints them); empty or absent means every feature. */
const wanted = (list) => String(list ?? '').split(/\s+/).filter((id) => id !== '');

const unwritten = (entry) => entry.status === 'planned' || entry.status === 'dispatched' || (entry.status === 'failed' && entry.attempts < MAX_ATTEMPTS);

/** Returns null when the command may go on, or `{ status: 1, lines }`. */
export function phaseGate(outDir, featuresOption) {
  const loaded = loadState(outDir);
  if (!loaded.ok) return null; // the command reports a missing or broken state in its own words
  const { state } = loaded;
  const mapRead = readJson(join(outDir, 'map.json'));
  const mapIds = mapRead.ok && Array.isArray(mapRead.value?.features) ? mapRead.value.features.map((feature) => feature?.id).filter((id) => typeof id === 'string') : [];
  const order = mapIds.length > 0 ? mapIds : Object.keys(state.features);
  const asked = wanted(featuresOption);
  const unknown = asked.filter((id) => !order.includes(id));
  if (unknown.length > 0) return { status: 1, lines: [`--features: unknown feature id ${unknown.join(', ')}; use ids of map.json`] };
  const ids = asked.length === 0 ? order : order.filter((id) => asked.includes(id));

  const findings = state.findings ?? {};
  const featurePhase = Object.values(state.features).some((entry) => entry.attempts > 0);
  const findingsPhase = Object.values(findings).some((entry) => entry?.attempts > 0);
  if (!featurePhase && !findingsPhase) return null;

  const left = [];
  for (const id of ids) {
    const entry = state.features[id];
    if (entry !== undefined && unwritten(entry)) left.push(id);
    if (findingsPhase) {
      const found = findings[id] ?? { status: 'planned', attempts: 0 };
      if (unwritten(found)) left.push(findingsId(id));
    }
  }
  if (left.length === 0) return null;
  return { status: 1, lines: [`Features not written: ${left.join(' ')}`, GATE_NEXT] };
}
