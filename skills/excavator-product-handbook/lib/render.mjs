/**
 * handbook.md (design D11, D14), rendered from data already checked: the map, the
 * verified entries, the state, the candidates, the fixed-text table and the
 * system facts (system-facts.mjs), whose overview section comes first. Pure
 * and deterministic: the same input gives the same bytes, with no time, no
 * path and no citation in the text. Every fixed text comes from `ui`.
 */

import { OPERATION_PARTS, partList } from './entry-parts.mjs';
import { operationSequence, sequenceMermaid } from './flows.mjs';
import { dataBlock } from './render-data.mjs';
import { dictionaryBlock } from './render-dict.mjs';
import { appendixBlocks } from './render-appendix.mjs';
import { historyChapter } from './render-history.mjs';
import { REACHES } from './map-shape.mjs';
import { inline, table } from './markdown.mjs';
import { applicationCells, listCell } from './render-application.mjs';
import { applicationDomainMatrix, applicationsSection, domainParts, flowDiagram, locationLines, roleFeatureMatrix, rolesSection, structureDiagram, systemsSection } from './render-entities.mjs';
import { outlineChapters, outlineCoverage, shiftHeadings } from './render-outline.mjs';
import { featureFindingsLines, findingsChapter, findingsCoverage } from './render-findings.mjs';
import { EMPTY_PRIORITY } from './priority-model.mjs';
import { EMPTY_REMEDIES } from './remedies-model.mjs';
import { recommendationsChapter, remediesCoverage } from './render-remedies.mjs';
import { topicsChapter, topicsCoverage } from './render-topics.mjs';
import { EMPTY_APPENDIX } from './appendix.mjs';
import { NO_HISTORY_FILE } from './history-model.mjs';
import { EMPTY_TOPICS } from './topics-model.mjs';
import { automaticLines, notificationsLines, statesLines, unknownsLines, whereLines, whoLines } from './render-sheet.mjs';
import { chapterBody, unverifiedCoverage } from './render-chapter-entry.mjs';
import { fill } from './ui.mjs';

const NONE_ROW = '-';

/** The reach counts, one per reach in a fixed order, zeros included. */
export function reachCounts(map) {
  return REACHES.map((reach) => ({ reach, count: map.features.filter((feature) => feature.reach === reach).length }));
}

function screensBlock(entry, t) {
  if (entry.screens.length === 0) return [t('md.none'), ''];
  const out = [];
  for (const screen of entry.screens) {
    out.push(`##### ${inline(fill(t('md.screen.heading'), { name: screen.name }))}`, '');
    if (screen.fields.length === 0) {
      out.push(t('md.none'), '');
      continue;
    }
    const rows = screen.fields.map((field) => {
      const side = (name) => field.rules.filter((rule) => rule.side === name).map((rule) => inline(rule.text)).join('<br>') || NONE_ROW;
      return [field.label, side('frontend'), side('backend')];
    });
    out.push(table([t('md.table.field'), t('md.table.frontendRules'), t('md.table.backendRules')], rows), '');
  }
  return out;
}

/** The parts of an operation besides its steps, each a bold label and a list; a part with no element writes nothing. `keys` picks the parts. */
function operationPartLines(operation, names, t, keys) {
  const out = [];
  for (const part of OPERATION_PARTS.filter((one) => keys.includes(one.key))) {
    const elements = partList(operation, part);
    if (elements.length === 0) continue;
    out.push(`**${t(part.uiKey)}**`, '');
    for (const element of elements) {
      const text = part.key === 'edges'
        ? fill(t('md.edge.item'), { when: element.when, then: element.then })
        : part.key === 'handoffs'
          ? fill(t('md.handoff.item'), { feature: names.get(element.feature) ?? element.feature, text: element.text })
          : element.text;
      out.push(`- ${inline(text)}`);
    }
    out.push('');
  }
  return out;
}

const BEFORE_STEPS = ['triggers'];
const AFTER_STEPS = ['calculations', 'changes', 'edges', 'handoffs'];

/**
 * One operation: what starts it, its steps numbered, the sequence diagram the script draws from the steps' citations
 * (flows.mjs) with its fixed note, then its other parts. `applications` are the system facts' application rows.
 */
function operationLines(operation, feature, names, applications, t) {
  const out = [`##### ${inline(operation.name)}`, ''];
  out.push(...operationPartLines(operation, names, t, BEFORE_STEPS));
  out.push(`**${t('md.operation.steps')}**`, '');
  out.push(...operation.sentences.map((sentence, at) => `${at + 1}. ${inline(sentence.text)}`), '');
  out.push(...sequenceMermaid(operationSequence(operation, feature.reach, applications, t)), '', t('md.flow.note'), '');
  out.push(...operationPartLines(operation, names, t, AFTER_STEPS));
  return out;
}

/** `areaName`: the name of the feature's area when the handbook groups by business domain (the area is then a property of the feature), else null. `findingsPart` is the findings context of render-findings.mjs. `applications` are the system facts' application rows. */
function entryBlock(feature, entry, map, t, locations, areaName, findingsPart, applications, chapter, technical) {
  const reachText = t(`md.reach.${feature.reach}`);
  const names = new Map(map.features.map((other) => [other.id, other.name]));
  const out = [`### ${inline(feature.name)}`, '', inline(fill(t('md.feature.reach'), { reach: reachText })), ''];
  if (areaName !== null) out.push(inline(fill(t('md.feature.area'), { area: areaName })), '');
  if (feature.label !== undefined) out.push(inline(fill(t('md.feature.label'), { label: feature.label })), '');
  if (chapter !== undefined) {
    // A checked /3 entry: not verified, so its chapter and the quick reference of its fact sheet stand where the entry's sections would; its citations are in the chapter text.
    out.push(...chapterBody({ entry, chapter, names, t, technical }), ...featureFindingsLines(feature.id, findingsPart));
    return out;
  }
  if (entry.purpose !== undefined) out.push(`#### ${t('md.section.purpose')}`, '', inline(entry.purpose.text), '');
  out.push(...whoLines(entry, t), ...whereLines(entry, t));
  out.push(`#### ${t('md.section.screens')}`, '', ...screensBlock(entry, t));
  out.push(`#### ${t('md.section.operations')}`, '');
  if (entry.operations.length === 0) out.push(t('md.none'), '');
  for (const operation of entry.operations) out.push(...operationLines(operation, feature, names, applications, t));
  out.push(...statesLines(entry, t), ...notificationsLines(entry, t), ...automaticLines(entry, t), ...unknownsLines(entry, t));
  out.push(...featureFindingsLines(feature.id, findingsPart));
  if (locations !== undefined) out.push(`#### ${t('md.locations.heading')}`, '', ...locationLines(locations, t));
  return out;
}

/** The notification table and the scheduled-job table (summary.mjs): two blocks, each starting with its heading. */
function summaryBlocks(summary, map, t) {
  const name = new Map(map.features.map((feature) => [feature.id, feature.name]));
  const featureText = (id) => fill(t('md.summary.feature'), { id, name: name.get(id) });
  const { counts } = summary;
  const out = [`## ${t('md.summary.notifications.heading')}`, ''];
  out.push(fill(t('md.summary.notifications.counts'), { verified: counts.featuresWithEntry, total: counts.featureTotal, count: counts.notificationRows }), '');
  out.push(t('md.summary.notifications.note'), '');
  out.push(summary.notifications.length === 0
    ? t('md.summary.notifications.none')
    : table(
      [t('md.table.feature'), t('md.table.trigger'), t('md.table.recipient'), t('md.table.channel'), t('md.table.content')],
      summary.notifications.map((n) => [featureText(n.feature), n.trigger, n.recipient, n.channel, n.content]),
    ), '');

  const scheduleText = ({ bucket, literal }) => (bucket === 'literal' ? `\`${literal}\`` : t(`md.summary.schedule.${bucket}`));
  const jobs = [`## ${t('md.summary.jobs.heading')}`, ''];
  jobs.push(fill(t('md.summary.jobs.counts'), { total: counts.jobRows, ...counts.schedule, described: counts.described }), '');
  jobs.push(t('md.summary.jobs.note'), '');
  jobs.push(summary.jobs.length === 0
    ? t('md.summary.jobs.none')
    : table(
      [t('md.table.candidate'), t('md.table.feature'), t('md.table.schedule'), t('md.table.does')],
      summary.jobs.map((job) => [
        job.candidate,
        job.feature === null ? fill(t('md.summary.unassigned'), { reason: job.reason }) : featureText(job.feature),
        scheduleText(job.schedule),
        job.automatic.length === 0 ? t('md.summary.noDescription') : job.automatic.map((a) => inline(fill(t('md.automatic.item'), a))).join('<br>'),
      ]),
    ), '');
  return { notifications: out, jobs };
}

/** The domain table of the overview: one row per domain (per area when the handbook groups by area), from the map and the verified entries, so it does not depend on the overview being written. */
function domainTable(system, basis, t) {
  return table(
    [t(basis === 'domains' ? 'md.table.domain' : 'md.table.area'), t('md.table.features'), t('md.table.verified'), t('md.table.roles')],
    system.domains.map((row) => [row.name, String(row.features), String(row.verified), listCell(row.roles)]),
  );
}

/** The applications table: one row per application root with the script's facts, the name and responsibility from the verified overview or the fixed not-verified text. */
function applicationsTable(system, t) {
  if (system.applications.length === 0) return t('md.none');
  return table(
    [t('md.table.directory'), t('md.table.name'), t('md.table.does'), t('md.table.languages'), t('md.table.frameworks'), t('md.table.files'), t('md.table.lines'),
      t('md.table.firstCommit'), t('md.table.lastCommit'), t('md.table.commits'), t('md.table.authors')],
    system.applications.map((application) => applicationCells(application, t)),
  );
}

/**
 * The system overview (system-facts.mjs), the first section of the handbook.
 * The count line, the applications table and the area table are the script's
 * and do not depend on the overview; an overview that is not verified replaces
 * only the sections a model writes with a line saying where it stopped.
 */
function overviewBlock(system, basis, t, locations) {
  const out = [`## ${inline(t('md.overview.heading'))}`, ''];
  const { overview, counts } = system;
  if (overview?.name == null) out.push(inline(t('md.overview.nameMissing')), '');
  if (overview === null) out.push(inline(fill(t('md.overview.notWritten'), { step: t(`md.status.${system.status}`) })), '');
  out.push(fill(t(basis === 'domains' ? 'md.overview.countsWithDomains' : 'md.overview.counts'), { ...counts, verified: counts.featuresWithEntry }), '');
  if (overview !== null) {
    out.push(`### ${t('md.section.purpose')}`, '', overview.summary.length === 0 ? t('md.none') : overview.summary.map(inline).join(' '), '');
    out.push(`### ${t('md.overview.audiencesHeading')}`, '');
    out.push(overview.audiences.length === 0 ? t('md.none') : table([t('md.table.who'), t('md.table.does')], overview.audiences.map((entry) => [entry.who, entry.does])), '');
  }
  out.push(`### ${t('md.overview.applicationsHeading')}`, '', applicationsTable(system, t), '');
  if (overview !== null) {
    out.push(`### ${t('md.overview.integrationsHeading')}`, '');
    out.push(overview.integrations.length === 0
      ? t('md.none')
      : table([t('md.table.system'), t('md.table.use'), t('md.table.callers')], overview.integrations.map((entry) => [entry.system, entry.use, entry.callers.join(', ')])), '');
    out.push(`### ${t('md.section.unknowns')}`, '');
    if (overview.unknowns.length === 0) out.push(t('md.none'), '');
    else out.push(...overview.unknowns.map((u) => `- ${inline(fill(t('md.unknown.item'), { item: u.item, searched: u.searched }))}`), '');
  }
  out.push(`### ${t(basis === 'domains' ? 'md.overview.domainsHeading' : 'md.overview.areasHeading')}`, '', domainTable(system, basis, t), '');
  if (locations !== undefined) out.push(`### ${t('md.locations.overviewHeading')}`, '', ...locationLines(locations, t));
  return out;
}

function coverageBlock(map, state, candidates, t, findings, remedies, topics, outline, view, chapters) {
  const areaName = new Map(map.areas.map((area) => [area.id, area.name]));
  const featureText = (key, feature) => `- ${inline(fill(t(key), { id: feature.id, name: feature.name, area: areaName.get(feature.area) }))}`;
  const claimed = map.features.reduce((sum, feature) => sum + feature.candidates.length, 0);
  const out = [`## ${t('md.coverage.heading')}`, ''];
  out.push(fill(t('md.coverage.conserved'), { total: candidates.length, assigned: claimed, unassigned: map.unassigned.length }), '');

  out.push(`### ${t('md.coverage.reachHeading')}`, '');
  out.push(table([t('md.table.reach'), t('md.table.features')], reachCounts(map).map(({ reach, count }) => [t(`md.reach.${reach}`), String(count)])), '');

  out.push(`### ${t('md.coverage.linkHeading')}`, '');
  const links = map.features.filter((feature) => feature.reach === 'link');
  out.push(...(links.length === 0 ? [t('md.none')] : links.map((feature) => featureText('md.coverage.linkItem', feature))), '');

  out.push(`### ${t('md.coverage.unassignedHeading')}`, '');
  if (map.unassigned.length === 0) {
    out.push(t('md.none'), '');
  } else {
    const kind = new Map(candidates.map((candidate) => [candidate.id, candidate.kind]));
    out.push(table(
      [t('md.table.candidate'), t('md.table.kind'), t('md.table.reason')],
      map.unassigned.map((entry) => [entry.candidate, t(`md.kind.${kind.get(entry.candidate)}`), entry.reason]),
    ), '');
  }

  out.push(`### ${t('md.coverage.unwrittenHeading')}`, '');
  // A checked /3 entry is written into the handbook, so it is not unwritten; its own part below says it is not verified.
  const unwritten = map.features.filter((feature) => state.features[feature.id].status !== 'verified' && !chapters.has(feature.id));
  if (unwritten.length === 0) {
    out.push(chapters.size === 0 ? t('md.coverage.allWritten') : t('md.none'));
  } else {
    out.push(table(
      [t('md.table.feature'), t('md.table.status')],
      unwritten.map((feature) => [
        fill(t('md.coverage.unwrittenItem'), { id: feature.id, name: feature.name, area: areaName.get(feature.area) }),
        t(`md.status.${state.features[feature.id].status}`),
      ]),
    ));
  }
  out.push('');

  out.push(...unverifiedCoverage(map, chapters, t));

  out.push(`### ${t('md.coverage.removedHeading')}`, '');
  out.push(t('md.coverage.untraced'), '');
  const withRemoved = map.features.filter((feature) => (state.features[feature.id].removed ?? []).length > 0);
  const overviewRemoved = state.overview?.removed ?? [];
  if (withRemoved.length === 0 && overviewRemoved.length === 0) out.push(t('md.none'), '');
  const removedTable = (removed) => table(
    [t('md.table.item'), t('md.table.result'), t('md.table.reason')],
    removed.map((item) => [item.claim, t(`md.verdict.${item.verdict}`), item.reason === '' ? NONE_ROW : item.reason]),
  );
  if (overviewRemoved.length > 0) {
    out.push(`#### ${inline(fill(t('md.coverage.removedOverview'), { name: t('md.overview.heading'), count: overviewRemoved.length }))}`, '', removedTable(overviewRemoved), '');
  }
  for (const feature of withRemoved) {
    const removed = state.features[feature.id].removed;
    out.push(`#### ${inline(fill(t('md.coverage.removedFeature'), { id: feature.id, name: feature.name, area: areaName.get(feature.area), count: removed.length }))}`, '');
    out.push(removedTable(removed), '');
  }
  out.push(...findingsCoverage({ map, state, findings, t, areaName }));
  out.push(...remediesCoverage({ remedies, t }));
  out.push(...topicsCoverage({ topics, t }));
  out.push(...outlineCoverage({ outline, view, t }));
  return out;
}

/**
 * The handbook text. `entries` maps the id of each verified feature to its
 * entry (only verified features have one); `candidates` is candidates.json's items; `ui` is the strings table;
 * `summary` is the two cross-cutting tables (summary.mjs); `system` the facts of the system overview (system-facts.mjs);
 * `entities` the entities and relations (entities.mjs), whose `domains` and `domainBasis` decide how the features are grouped (domain-grouping.mjs). `view` is `product` or `technical`: the technical view
 * also writes the data chapter after the system overview (from `data`, data-section.mjs, and in it, from `dictionaries`, dict-section.mjs, the status dictionary part), the application and external-system sections and, from `locations` (locations.mjs), the file and
 * lines of each item; the product view writes no citation path. `findings` (findings-model.mjs) is the verified findings of the features: both views write the Findings chapter
 * between the entity sections and the coverage section and each feature's own findings at the end of its section, the technical view with the file and lines of each finding.
 * `topics` (topics-model.mjs) are the Cross-cutting topics chapter after the Recommendations chapter and its part of the coverage section.
 * `history` (history-model.mjs) is the Code health chapter after the Cross-cutting topics chapter, and `appendix` (appendix.mjs) the Appendix chapter after the coverage section; both views write both.
 * `remedies` (remedies-model.mjs) are the common cause and measure under each category of the Findings chapter and the Recommendations chapter after it.
 * `outline` (outline.mjs `resolveOutline`) decides which chapters are written, in which order and under which titles: each block below is one
 * list of lines (render-outline.mjs), the coverage section is always last and says which outline was used and what it left out. The product view
 * writes no block that only the technical view has.
 */
export function renderHandbook({ map, entries, chapters = new Map(), state, candidates, ui, summary, system, entities, view = 'product', locations = null, data = null, dictionaries = null, findings = { list: [], groups: [], locations: null, applications: [], priority: EMPTY_PRIORITY }, remedies = EMPTY_REMEDIES, topics = EMPTY_TOPICS, history = NO_HISTORY_FILE, appendix = EMPTY_APPENDIX, outline }) {
  const t = (key) => {
    if (!Object.hasOwn(ui, key)) throw new Error(`the fixed-text table has no key ${key}`);
    return ui[key];
  };
  const technical = view === 'technical';
  const placesOf = new Map((technical ? locations ?? [] : []).map((unit) => [unit.id, unit]));
  const basis = entities.domainBasis;
  const areaName = new Map(map.areas.map((area) => [area.id, area.name]));
  const featureOf = new Map(map.features.map((feature) => [feature.id, feature]));
  const findingsPart = { state, findings, t };
  const name = system.overview?.name ?? null;
  const title = name === null ? t(technical ? 'md.titleTechnical' : 'md.title') : fill(t(technical ? 'md.titleTechnicalNamed' : 'md.titleNamed'), { name });
  const placed = placesOf.get('overview');
  const domainPart = domainParts({ map, entities, t });
  const domainsBlock = [`## ${t(basis === 'domains' ? 'md.domains.heading' : 'md.areas.heading')}`, ''];
  if (basis === 'areas') domainsBlock.push(t('md.domains.fromAreas'), '');
  for (const domain of entities.domains) {
    domainsBlock.push(`- **${inline(domain.name)}**`);
    if (domain.features.length === 0) domainsBlock.push(`  - ${t('md.areas.noFeatures')}`);
    for (const id of domain.features) {
      domainsBlock.push(`  - ${inline(fill(t('md.areas.featureLine'), { name: featureOf.get(id).name, reach: t(`md.reach.${featureOf.get(id).reach}`) }))}${chapters.has(id) ? ` - ${inline(t('md.status.unverified'))}` : ''}`);
    }
  }
  domainsBlock.push('', table([t('md.table.reach'), t('md.table.features')], reachCounts(map).map(({ reach, count }) => [t(`md.reach.${reach}`), String(count)])), '', ...domainPart.intro);
  for (const [at, domain] of entities.domains.entries()) {
    domainsBlock.push(`### ${inline(domain.name)}`, '', ...domainPart.domains[at].lines);
    for (const id of domain.features.filter((one) => entries.has(one))) {
      domainsBlock.push(...shiftHeadings(entryBlock(featureOf.get(id), entries.get(id), map, t, placesOf.get(id), basis === 'domains' ? areaName.get(featureOf.get(id).area) : null, findingsPart, system.applications, chapters.get(id), technical), 1));
    }
  }
  const summaries = summaryBlocks(summary, map, t);
  const appendixParts = appendixBlocks({ appendix, map, entities, t });
  const entityInput = { map, entities, summary, system, t };
  const blocks = new Map([
    ['overview', overviewBlock(system, basis, t, placed)],
    ['business', flowDiagram(entities, t)],
    ['architecture', structureDiagram(entities, t)],
    ['data', data === null ? [] : dataBlock(data, t)],
    ['roles-matrix', [...rolesSection(entityInput), ...shiftHeadings(roleFeatureMatrix(entityInput), 1)]],
    ['applications-matrix', applicationDomainMatrix(entityInput)],
    ['dictionaries', dictionaries === null ? [] : dictionaryBlock(dictionaries, t)],
    ['applications', applicationsSection(entityInput)],
    ['domains', domainsBlock],
    ['systems', systemsSection(entityInput)],
    ['notifications', summaries.notifications],
    ['jobs', summaries.jobs],
    ['topics', topicsChapter({ topics, view, t })],
    ['history', historyChapter({ history, map, view, t })],
    ['findings', findingsChapter({ map, state, findings, remedies, view, t })],
    ['recommendations', recommendationsChapter({ findings, remedies, view, t })],
    ...Object.entries(appendixParts),
  ]);
  const out = [`# ${inline(title)}`, '', ...outlineChapters({ outline, blocks, view }), ...coverageBlock(map, state, candidates, t, findings, remedies, topics, outline, view, chapters)];
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
