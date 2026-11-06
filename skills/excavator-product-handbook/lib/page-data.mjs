/**
 * The data of the handbook page (design D13): one object built from a loaded,
 * checked run, with its keys in a fixed order. It holds the text of the map
 * and of each verified entry, never their evidence, so it holds no citation
 * path; and no time and no absolute path: the same run gives the same object.
 * `project` is the system name of the verified overview, or null (design D3 of
 * openspec change handbook-system-name); the project's directory name is not in
 * the data except where it replaces a path inside a string.
 * The caller loads the run (load-run.mjs); the only other read is the cited
 * source the summary locates its job descriptions in (summary.mjs).
 */

import { basename } from 'node:path';

import { pageSection } from './data-section.mjs';
import { dictionariesPageSection } from './dict-section.mjs';
import { findingsStatus } from './findings-model.mjs';
import { handbookModel } from './handbook-model.mjs';
import { reachCounts } from './render.mjs';
import { languageTag } from './language-tag.mjs';
import { withoutRootPaths } from './root-paths.mjs';
import { DEFAULT_VIEWS } from './views.mjs';

export const PAGE_FORMAT = 'excavator-product-handbook-page/8';

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
 * the external systems with both relations to applications, the file and
 * lines of each cited item and of each finding (`findingLocations`), the data section (`data`, null with the reason in
 * `dataState` when data.json is missing or malformed) and the status dictionary
 * (`dictionaries` and `dictionariesState`, the same for dictionaries.json).
 */
export function buildPageData(run, roots, { views = DEFAULT_VIEWS } = {}) {
  const { map, entries, state, candidates, ui } = run;
  // The directory name only rewrites the project path in the strings; the page shows the verified system name, never the directory.
  const directory = basename(roots[0]);
  const kind = new Map(candidates.map((candidate) => [candidate.id, candidate.kind]));
  const { summary, system, entities, locations, findings, data: dataSection, dictionaries: dictionariesSection } = handbookModel(run, roots[0], views);
  const domainOf = new Map(entities.domains.flatMap((domain) => domain.features.map((id) => [id, domain.id])));
  const data = {
    format: PAGE_FORMAT,
    project: system.overview?.name ?? null,
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
      findingsStatus: findingsStatus(state, feature.id),
    })),
    findings: findings.list.map((finding) => ({ id: finding.id, feature: finding.feature, category: finding.category, text: finding.text })),
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
      findingsUnfinished: map.features
        .filter((feature) => !['verified', 'planned'].includes(findingsStatus(state, feature.id)))
        .map((feature) => ({ feature: feature.id, status: findingsStatus(state, feature.id) })),
      findingsNotWritten: map.features.filter((feature) => findingsStatus(state, feature.id) === 'planned').length,
      findingsRemoved: map.features
        .filter((feature) => (state.findings?.[feature.id]?.removed ?? []).length > 0)
        .map((feature) => ({
          feature: feature.id,
          items: state.findings[feature.id].removed.map((item) => ({ claim: item.claim, verdict: item.verdict, reason: item.reason })),
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
      findingLocations: findings.list.map((finding) => ({ id: finding.id, citations: findings.locations.get(finding.id) })),
      data: dataSection.state === 'ok' ? pageSection(dataSection.data) : null,
      dataState: dataSection.state,
      dictionaries: dictionariesSection.state === 'ok' ? dictionariesPageSection(dictionariesSection.data) : null,
      dictionariesState: dictionariesSection.state,
    };
  }
  return withoutRootPaths(data, roots, directory);
}
