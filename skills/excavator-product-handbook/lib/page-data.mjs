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

import { chapterPageBlocks, noteCounts } from './chapter-output.mjs';
import { pageSection } from './data-section.mjs';
import { dictionariesPageSection } from './dict-section.mjs';
import { OPERATION_PARTS, partList, transitionList } from './entry-parts.mjs';
import { operationSequence } from './flows.mjs';
import { findingsStatus } from './findings-model.mjs';
import { handbookModel } from './handbook-model.mjs';
import { historyPageSection, historyPlaces } from './history-page.mjs';
import { reachCounts } from './render.mjs';
import { remediesPageSection } from './remedies-page.mjs';
import { topicsCoveragePage, topicsPageSection } from './topics-page.mjs';
import { languageTag } from './language-tag.mjs';
import { withoutRootPaths } from './root-paths.mjs';
import { DEFAULT_VIEWS } from './views.mjs';

/**
 * The format is /18 since openspec change handbook-outline: `outline` is the parts and chapters the navigation, the chapter titles and the order of
 * the chapters follow (outline.mjs `resolveOutline`: the written outline, or the default one with the problem lines of why), each chapter holding one block or one
 * list of entity pages and `technical` when only the technical view has it, and the blocks it left out with their reasons.
 * (/17, openspec change handbook-domain-page: each domain of `entities.domains` carries its `relations` with other
 * domains, its `states` and `transitions`, `entities.domainFlows` sums those relations per direction between two domains, and the technical part holds `domainFiles`, the files the verified entries of each domain quote.)
 * (/16, openspec change handbook-deep-entry: each operation of an entry carries the parts of entry format /2
 * (triggers, calculations, changes, edges, handoffs) and `sequence`, the participants and arrows of its sequence diagram
 * (flows.mjs), and an entry carries its state `transitions`.) (/15, openspec change handbook-page-chunked-data: `chunks` is the index of the part files of a page whose data is
 * large (the part ids and, for each unit, the parts that hold it); here it is always empty, and `page` fills it when it splits the data
 * (page-units.mjs, page-chunks.mjs).) (/14, openspec change handbook-history-appendix: `history` holds the code health (the commits of each year, the
 * applications, the files that change most by name, the files changed together across applications, the source and test files) and
 * `appendix` the open questions, the glossary and the sources and scope; the technical part holds the path of each file of `history`.
 * (/13, openspec change handbook-topics: `topics` holds the rows of the five cross-cutting topics with their basis, the
 * coverage says which lanes finished and what the judges left out, and the technical part holds the places of the cited items.
 * (/12, openspec change handbook-remedies: `remedies` holds the common cause and measure of each category and the
 * recommendations with the groups and facts they rest on, and the coverage says what the judges left out. /11: each group of findings
 * carries its priority, and the coverage says which groups have none.)
 */
export const PAGE_FORMAT = 'excavator-product-handbook-page/18';

const PARTS = Object.fromEntries(OPERATION_PARTS.map((part) => [part.key, part]));

/**
 * An entry without its evidence, in the page's shape; `sequenceOf` gives an operation's sequence diagram (flows.mjs). A checked /3 entry (openspec
 * change handbook-free-chapter) has no operations and no fields: it carries the `chapter` blocks (chapter-output.mjs, no citation) and its top-level `handoffs`.
 */
function pageEntry(entry, sequenceOf, chapter) {
  return {
    ...(entry.purpose === undefined ? {} : { purpose: entry.purpose.text }),
    who: entry.who.map((who) => ({ role: who.role, can: who.can })),
    where: entry.where.map((place) => place.label),
    screens: entry.screens.map((screen) => ({
      name: screen.name,
      fields: (screen.fields ?? []).map((field) => ({ label: field.label, rules: field.rules.map((rule) => ({ side: rule.side, text: rule.text })) })),
    })),
    operations: (entry.operations ?? []).map((operation) => ({
      name: operation.name,
      sentences: operation.sentences.map((sentence) => sentence.text),
      triggers: partList(operation, PARTS.triggers).map((x) => x.text),
      calculations: partList(operation, PARTS.calculations).map((x) => x.text),
      changes: partList(operation, PARTS.changes).map((x) => x.text),
      edges: partList(operation, PARTS.edges).map((x) => ({ when: x.when, then: x.then })),
      handoffs: partList(operation, PARTS.handoffs).map((x) => ({ feature: x.feature, text: x.text })),
      sequence: sequenceOf(operation),
    })),
    states: entry.states.map((state) => ({ label: state.label, meaning: state.meaning })),
    transitions: transitionList(entry).map((x) => ({ from: x.from, to: x.to, by: x.by })),
    notifications: entry.notifications.map((n) => ({ trigger: n.trigger, recipient: n.recipient, channel: n.channel, content: n.content })),
    automatic: entry.automatic.map((item) => ({ when: item.when, effect: item.effect })),
    unknowns: entry.unknowns.map((item) => ({ item: item.item, searched: item.searched })),
    ...(chapter === undefined ? {} : { handoffs: (entry.handoffs ?? []).map((x) => ({ feature: x.feature, text: x.text })), chapter: chapterPageBlocks(chapter.text) }),
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
  const chapters = run.chapters ?? new Map();
  // The directory name only rewrites the project path in the strings; the page shows the verified system name, never the directory.
  const directory = basename(roots[0]);
  const kind = new Map(candidates.map((candidate) => [candidate.id, candidate.kind]));
  const { summary, system, entities, locations, findings, remedies, topics, history, appendix, outline, data: dataSection, dictionaries: dictionariesSection } = handbookModel(run, roots[0], views);
  const domainOf = new Map(entities.domains.flatMap((domain) => domain.features.map((id) => [id, domain.id])));
  const data = {
    format: PAGE_FORMAT,
    chunks: { parts: [], units: {} },
    project: system.overview?.name ?? null,
    language: map.language,
    languageTag: languageTag(map.language),
    ui: { strings: ui },
    views: [...views],
    areas: map.areas.map((area) => ({ id: area.id, name: area.name })),
    domains: entities.domains.map((domain) => ({ id: domain.id, name: domain.name })),
    domainBasis: entities.domainBasis,
    outline,
    features: map.features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      area: feature.area,
      domain: domainOf.get(feature.id),
      reach: feature.reach,
      label: feature.label,
      status: state.features[feature.id].status,
      entry: entries.has(feature.id) ? pageEntry(entries.get(feature.id), (operation) => operationSequence(operation, feature.reach, system.applications, (key) => ui[key]), chapters.get(feature.id)) : null,
      findingsStatus: findingsStatus(state, feature.id),
      // Only a feature written but not verified has the key (a checked /3 entry), so the data of a run with none is as it was.
      ...(chapters.has(feature.id) ? { unverified: true } : {}),
    })),
    findings: findings.groups.map((group) => ({
      category: group.category,
      owners: group.owners.map((owner) => ({ kind: owner.kind, id: owner.id, name: owner.name })),
      items: group.items.map((item) => ({ id: item.id, owner: { kind: item.owner.kind, id: item.owner.id, name: item.owner.name }, text: item.text })),
      priority: group.priority === null ? null : { level: group.priority.level, consequence: group.priority.consequence, reason: group.priority.reason },
    })),
    remedies: remediesPageSection(remedies),
    topics: topicsPageSection(topics),
    history: historyPageSection(history),
    appendix,
    coverage: {
      candidateTotal: candidates.length,
      assigned: map.features.reduce((sum, feature) => sum + feature.candidates.length, 0),
      unassigned: map.unassigned.map((item) => ({ candidate: item.candidate, kind: kind.get(item.candidate), reason: item.reason })),
      reachCounts: reachCounts(map),
      unverified: map.features.filter((feature) => chapters.has(feature.id)).map((feature) => ({ feature: feature.id, notes: noteCounts(chapters.get(feature.id).notes) })),
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
      systemFindingsTotal: findings.applications.length,
      systemFindingsUnfinished: findings.applications
        .filter((application) => !['verified', 'planned'].includes(application.status))
        .map((application) => ({ id: application.id, name: application.name, status: application.status })),
      systemFindingsNotWritten: findings.applications.filter((application) => application.status === 'planned').length,
      priority: {
        finished: findings.priority.finished,
        unranked: findings.priority.unranked.map(({ group, reasons }) => ({ id: group.items[0].id, category: group.category, text: group.items[0].text, reasons })),
      },
      remedies: { finished: remedies.finished, stale: remedies.stale, dropped: remedies.dropped.map((paragraph) => ({ id: paragraph.id, kind: paragraph.kind, text: paragraph.kind === 'category' ? paragraph.cause : paragraph.text, ...(paragraph.kind === 'category' ? { category: paragraph.category } : { title: paragraph.title }), reasons: paragraph.reasons })) },
      topics: topicsCoveragePage(topics),
      systemFindingsRemoved: findings.applications
        .filter((application) => application.removed.length > 0)
        .map((application) => ({
          id: application.id,
          name: application.name,
          items: application.removed.map((item) => ({ claim: item.claim, verdict: item.verdict, reason: item.reason })),
        })),
    },
    summary,
    system,
    entities: {
      domains: entities.domains,
      domainFlows: entities.domainFlows,
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
      topicLocations: topics.places.map((entry) => ({ id: entry.id, citations: entry.citations })),
      findingLocations: findings.groups.flatMap((group) => group.items).map((item) => ({ id: item.id, citations: findings.locations.get(item.id) })),
      history: historyPlaces(history),
      domainFiles: entities.domainFiles,
      data: dataSection.state === 'ok' ? pageSection(dataSection.data) : null,
      dataState: dataSection.state,
      dictionaries: dictionariesSection.state === 'ok' ? dictionariesPageSection(dictionariesSection.data) : null,
      dictionariesState: dictionariesSection.state,
    };
  }
  return withoutRootPaths(data, roots, directory);
}
