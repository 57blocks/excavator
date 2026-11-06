/**
 * The appendix of the handbook (openspec change handbook-history-appendix, design
 * D3), computed at assembly from the loaded run and the models the outputs share,
 * and nothing else: no file outside the output directory is read, no model is
 * called, and no text is written that a verified entry does not already hold. Three
 * lists:
 *
 *  - `open`: the unknowns of the verified entries and of the verified system
 *    overview, each with its own words and the place searched, the overview's first
 *    (`feature` and `domain` null), then by domain and by feature in the order of
 *    the handbook (`feature` and `domain` are ids);
 *  - `glossary`: appendix-glossary.mjs;
 *  - `sources`: appendix-sources.mjs.
 *
 * An item the checks removed is not in an entry any more, so it is in none of the
 * lists. Both outputs build it here, so the handbook and the page cannot differ.
 */

import { buildGlossary } from './appendix-glossary.mjs';
import { buildSources } from './appendix-sources.mjs';
import { OVERVIEW_ID } from './unit.mjs';

/** The verified entries in the order of the handbook: `[{ id, domain, entry }]`, by domain and by feature in it. */
export function orderedEntries(run, entities) {
  return entities.domains.flatMap((domain) => domain.features.filter((id) => run.entries.has(id)).map((id) => ({ id, domain: domain.id, entry: run.entries.get(id) })));
}

/** `{ open, glossary, sources }` of a loaded run; `entities`, `findings`, `remedies` and `topics` are the models of handbook-model.mjs; `applications` the number of application roots. */
export function buildAppendix(run, { entities, findings, remedies, topics, applications }) {
  const rows = orderedEntries(run, entities);
  const overview = run.entries.get(OVERVIEW_ID);
  const open = [
    ...(overview === undefined ? [] : overview.unknowns.map((one) => ({ feature: null, domain: null, item: one.item, searched: one.searched }))),
    ...rows.flatMap((row) => row.entry.unknowns.map((one) => ({ feature: row.id, domain: row.domain, item: one.item, searched: one.searched }))),
  ];
  return {
    open,
    glossary: buildGlossary(rows),
    sources: buildSources(run, { applications, findings, remedies, topics }),
  };
}

/** The appendix of an output that was given none (an older caller): no question, no term and no section. */
export const EMPTY_APPENDIX = Object.freeze({
  open: Object.freeze([]),
  glossary: Object.freeze([]),
  sources: Object.freeze({
    parts: Object.freeze(['overview', 'features', 'findings', 'system-findings'].map((id) => Object.freeze({ id, units: 0, verified: 0, items: 0, removedVerify: 0, removedTrace: 0, again: 0 }))),
    ranked: Object.freeze({ priority: Object.freeze({ kept: 0, left: 0 }), remedies: Object.freeze({ kept: 0, left: 0 }), topics: Object.freeze({ kept: 0, left: 0 }) }),
  }),
});
