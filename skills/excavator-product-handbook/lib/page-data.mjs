/**
 * The data of the handbook page (design D13): one object built from a loaded,
 * checked run, with its keys in a fixed order. It holds the text of the map
 * and of each verified entry, never their evidence, so it holds no citation
 * path; and no time and no absolute path: the same run gives the same object.
 * Pure: the caller loads the run (load-run.mjs).
 */

import { basename } from 'node:path';

import { reachCounts } from './render.mjs';
import { languageTag } from './language-tag.mjs';
import { withoutRootPaths } from './root-paths.mjs';

export const PAGE_FORMAT = 'excavator-product-handbook-page/1';

/** An entry without its evidence, in the page's shape. */
function pageEntry(entry) {
  return {
    ...(entry.purpose === undefined ? {} : { purpose: entry.purpose.text }),
    who: entry.who.map((who) => ({ role: who.role, can: who.can })),
    where: entry.where.map((place) => place.label),
    screens: entry.screens.map((screen) => ({
      name: screen.name,
      fields: screen.fields.map((field) => ({ label: field.label, rules: field.rules.map((rule) => ({ side: rule.side, text: rule.text })) })),
    })),
    operations: entry.operations.map((operation) => ({ name: operation.name, sentences: operation.sentences.map((sentence) => sentence.text) })),
    states: entry.states.map((state) => ({ label: state.label, meaning: state.meaning })),
    notifications: entry.notifications.map((n) => ({ trigger: n.trigger, recipient: n.recipient, channel: n.channel, content: n.content })),
    automatic: entry.automatic.map((item) => ({ when: item.when, effect: item.effect })),
    unknowns: entry.unknowns.map((item) => ({ item: item.item, searched: item.searched })),
  };
}

/**
 * The page data of a loaded run (`loadCheckedRun`'s result). `roots` are the
 * paths of the project, each replaced by the project's directory name in every
 * string; the first is the real path.
 */
export function buildPageData(run, roots) {
  const { map, entries, state, candidates, ui } = run;
  const project = basename(roots[0]);
  const kind = new Map(candidates.map((candidate) => [candidate.id, candidate.kind]));
  const data = {
    format: PAGE_FORMAT,
    project,
    language: map.language,
    languageTag: languageTag(map.language),
    ui: { strings: ui },
    areas: map.areas.map((area) => ({ id: area.id, name: area.name })),
    features: map.features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      area: feature.area,
      reach: feature.reach,
      label: feature.label,
      status: state.features[feature.id].status,
      entry: entries.has(feature.id) ? pageEntry(entries.get(feature.id)) : null,
    })),
    coverage: {
      candidateTotal: candidates.length,
      assigned: map.features.reduce((sum, feature) => sum + feature.candidates.length, 0),
      unassigned: map.unassigned.map((item) => ({ candidate: item.candidate, kind: kind.get(item.candidate), reason: item.reason })),
      reachCounts: reachCounts(map),
      removed: map.features
        .filter((feature) => (state.features[feature.id].removed ?? []).length > 0)
        .map((feature) => ({
          feature: feature.id,
          items: state.features[feature.id].removed.map((item) => ({ claim: item.claim, verdict: item.verdict, reason: item.reason })),
        })),
    },
  };
  return withoutRootPaths(data, roots, project);
}
