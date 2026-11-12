/**
 * The Cross-cutting topics chapter of handbook.md and the topics part of the
 * coverage section (openspec change handbook-topics, design D6). Written from the
 * rows the judges kept (topics-model.mjs); every fixed text is a ui key. A topic is
 * one section with one table whose last column is the basis: for each cited item
 * its feature and text (the technical view adds the file and lines), for each
 * cited group of findings its level, category and statement. The data between
 * domains also has a diagram that this file draws from the kept rows. A topic
 * without a kept row says which verified entries or groups it read and that they
 * state none of it; it never says the system has none. Pure and deterministic.
 */

import { categoryKey } from './findings-shape.mjs';
import { inline, table } from './markdown.mjs';
import { levelName } from './render-remedies.mjs';
import { placeText } from './render-findings.mjs';
import { droppedText } from './topics-page.mjs';
import { TOPICS } from './topics-shape.mjs';
import { fill } from './ui.mjs';

const NONE_CELL = '-';

/** The basis of one cited fact, in words; the technical view adds where its passages are. */
function basisText(cite, { view, t }) {
  const places = view === 'technical' ? cite.places.map((place) => placeText(place, t)).join('; ') : '';
  if (cite.kind === 'item') {
    const values = { feature: cite.feature, text: cite.text };
    return places === '' ? fill(t('md.topics.basisItem'), values) : fill(t('md.topics.basisItemTechnical'), { ...values, places });
  }
  const values = { level: levelName(cite.level, t), category: t(categoryKey(cite.category)), statement: cite.text };
  return places === '' ? fill(t('md.remedies.groupLine'), values) : fill(t('md.remedies.groupLineTechnical'), { ...values, places });
}

/** One topic's table: the columns of the topic, then the basis. */
function topicTable(topic, rows, context) {
  const { t } = context;
  const headers = [...topic.columns.map((column) => t(`md.topics.col.${topic.id}.${column}`)), t('md.topics.col.basis')];
  return table(headers, rows.map((row) => [
    ...topic.columns.map((column) => (row.fields[column].trim() === '' ? NONE_CELL : row.fields[column])),
    row.cites.map((cite) => inline(basisText(cite, context))).join('<br>'),
  ]));
}

const label = (text) => inline(text).replace(/"/g, "'");

/** The diagram of the data between domains: one node for each domain a kept row names, one edge for each row, labelled with its content. */
export function handoffDiagram(rows, domainNames) {
  const nodes = [];
  for (const row of rows) for (const id of [row.refs.from, row.refs.to]) if (!nodes.includes(id)) nodes.push(id);
  return [
    '```mermaid',
    'flowchart LR',
    ...nodes.map((id) => `  ${id}["${label(domainNames[id] ?? id)}"]`),
    ...rows.map((row) => `  ${row.refs.from} -->|"${label(row.fields.content)}"| ${row.refs.to}`),
    '```',
  ];
}

/** The Cross-cutting topics chapter. Nothing when the handbook has no verified entry and no verified finding. */
export function topicsChapter({ topics, view, t }) {
  if (!topics.hasLanes) return [];
  const out = [`## ${t('md.topics.heading')}`, '', t('md.topics.note'), ''];
  if (topics.unverified === true) out.push(inline(t('md.topics.unverified')), '');
  if (!topics.anyVerified) return [...out, t('md.topics.notFinished'), ''];
  out.push(fill(t('md.topics.counts'), { lanes: topics.lanes.filter((lane) => ['verified', 'checked'].includes(lane.status)).length, entries: topics.entriesRead, groups: topics.groupsRead, rows: topics.rowsKept }), '');
  for (const topic of TOPICS) {
    const rows = topics.topics[topic.id];
    out.push(`### ${t(`md.topics.${topic.id}.heading`)}`, '');
    const written = topic.lane === 'domain' ? topics.domainWritten : topics.repeatedWritten;
    if (!written) out.push(t('md.topics.laneNotFinished'), '');
    else if (rows.length === 0) out.push(fill(t(topic.lane === 'domain' ? 'md.topics.emptyEntries' : 'md.topics.emptyGroups'), { count: topic.lane === 'domain' ? topics.entriesRead : topics.groupsRead }), '');
    else {
      out.push(topicTable(topic, rows, { view, t }), '');
      if (topic.id === 'handoffs') out.push(t('md.topics.diagramNote'), '', ...handoffDiagram(rows, topics.domainNames), '');
    }
  }
  return out;
}

/** The status of a lane as the coverage writes it. */
const statusText = (status, t) => t(status === 'verified' ? 'md.topics.laneStatus.verified' : status === 'checked' ? 'md.topics.laneStatus.checked' : status === 'stale' ? 'md.topics.laneStatus.stale' : `md.status.${status}`);

/** The part of the coverage section about the topics: each lane with its status, the rows the judges left out with their reasons, or that a lane did not finish. */
export function topicsCoverage({ topics, t }) {
  const out = [`### ${t('md.coverage.topicsHeading')}`, ''];
  if (!topics.hasLanes) return [...out, t('md.none'), ''];
  if (topics.unverified === true) out.push(t('md.coverage.topicsUnverified'), '');
  out.push(table(
    [t('md.topics.tableLane'), t('md.table.status'), t('md.topics.tableKept'), t('md.topics.tableLeftOut')],
    topics.lanes.map((lane) => [lane.name === null ? t('md.topics.repeated.heading') : lane.name, statusText(lane.status, t), String(lane.kept), String(lane.dropped)]),
  ), '');
  if (!topics.finished) out.push(t(topics.stale ? 'md.coverage.topicsStale' : 'md.coverage.topicsNotFinished'), '');
  const label = (row) => fill(t('md.topics.droppedRow'), { topic: t(`md.topics.${row.topic}.heading`), text: droppedText(row) });
  if (topics.finished && topics.dropped.length === 0) out.push(t('md.coverage.topicsAllKept'), '');
  if (topics.dropped.length > 0) {
    out.push(fill(t('md.coverage.topicsDropped'), { count: topics.dropped.length }), '', table([t('md.remedies.tableText'), t('md.table.reason')], topics.dropped.map((row) => [label(row), row.reasons.length === 0 ? NONE_CELL : row.reasons.join('; ')])), '');
  }
  return out;
}
