/**
 * The data of the handbook page (design D13): one object built from a loaded,
 * checked run, with its keys in a fixed order. It holds the text of the map
 * and of each verified entry, never their evidence, so it holds no citation
 * path; and no time and no absolute path: the same run gives the same object.
 * The caller loads the run (load-run.mjs); the only other read is the cited
 * source the summary locates its job descriptions in (summary.mjs).
 */

import { basename } from 'node:path';

import { handbookModel } from './handbook-model.mjs';
import { reachCounts } from './render.mjs';
import { languageTag } from './language-tag.mjs';
import { withoutRootPaths } from './root-paths.mjs';
import { DEFAULT_VIEWS } from './views.mjs';

export const PAGE_FORMAT = 'excavator-product-handbook-page/5';

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
 * string; the first is the real path, which the summary reads the source from.
 * `views` are the views the page has (views.mjs). `areas` are the map's areas and
 * `domains` the groups the page navigates by: the business domains of domains.json,
 * or the areas again with `domainBasis` `areas` when there is none; each feature
 * carries both its area and its domain. Everything outside the key
 * `technical` is the product part and holds no citation path; `technical`, only
 * there when the technical view is selected, holds the application relations,
 * the external systems with both relations to applications, and the file and
 * lines of each cited item.
 */
export function buildPageData(run, roots, { views = DEFAULT_VIEWS } = {}) {
  const { map, entries, state, candidates, ui } = run;
  const project = basename(roots[0]);
  const kind = new Map(candidates.map((candidate) => [candidate.id, candidate.kind]));
  const { summary, system, entities, locations } = handbookModel(run, roots[0], views);
  const domainOf = new Map(entities.domains.flatMap((domain) => domain.features.map((id) => [id, domain.id])));
  const data = {
    format: PAGE_FORMAT,
    project,
    language: map.language,
    languageTag: languageTag(map.language),
    ui: { strings: ui },
    views: [...views],
    areas: map.areas.map((area) => ({ id: area.id, name: area.name })),
    domains: entities.domains.map((domain) => ({ id: domain.id, name: domain.name })),
    domainBasis: entities.domainBasis,
    features: map.features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      area: feature.area,
      domain: domainOf.get(feature.id),
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
      removedOverview: (state.overview?.removed ?? []).map((item) => ({ claim: item.claim, verdict: item.verdict, reason: item.reason })),
      removed: map.features
        .filter((feature) => (state.features[feature.id].removed ?? []).length > 0)
        .map((feature) => ({
          feature: feature.id,
          items: state.features[feature.id].removed.map((item) => ({ claim: item.claim, verdict: item.verdict, reason: item.reason })),
        })),
    },
    summary,
    system,
    entities: {
      domains: entities.domains,
      roles: entities.roles,
      roleFeature: entities.matrices.roleFeature,
    },
  };
  if (views.includes('technical')) {
    data.technical = {
      featureApplication: entities.relations.featureApplication,
      unattributed: entities.relations.unattributed,
      applicationDomain: entities.matrices.applicationDomain,
      integrations: entities.integrations,
      jobs: entities.jobs,
      locations,
    };
  }
  return withoutRootPaths(data, roots, project);
}
