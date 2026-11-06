/**
 * The topics as the page data holds them (openspec change handbook-topics, design
 * D6): `{ approval, time, handoffs, access, repeated }`, each a list of rows
 * `{ fields, basis }`, written from the same model as the handbook
 * (topics-model.mjs). `fields` are the columns as the reader sees them (a data
 * row's domains and an access row's feature by name); `basis` is what the row rests
 * on: `{ id, kind: 'item', feature, text }` for a verified item, or `{ id, kind:
 * 'group', category, level, text }` for a group of findings (`id` the first
 * finding's id, `level` P0 to P2 or null). No path is in it; the places of an item
 * are the technical part's (`topicLocations`), those of a finding its
 * `findingLocations`.
 */

import { TOPIC_IDS } from './topics-shape.mjs';
import { UNRANKED } from './topics-facts.mjs';

const basisOf = (cite) => (cite.kind === 'item'
  ? { id: cite.id, kind: 'item', feature: cite.feature, text: cite.text }
  : { id: cite.firstId, kind: 'group', category: cite.category, level: cite.level === UNRANKED ? null : cite.level, text: cite.text });

/** The page's `topics` of a model built by `withTopics`. */
export const topicsPageSection = (topics) => Object.fromEntries(TOPIC_IDS.map((id) => [id, topics.topics[id].map((row) => ({ fields: { ...row.fields }, basis: row.cites.map(basisOf) }))]));

/** The text of a left-out row for the coverage: its non-empty columns, joined. */
export const droppedText = (row) => Object.values(row.fields).filter((value) => value.trim() !== '').join(' / ');

/** The page's `coverage.topics` of a model. */
export const topicsCoveragePage = (topics) => ({
  finished: topics.finished,
  stale: topics.stale,
  entriesRead: topics.entriesRead,
  groupsRead: topics.groupsRead,
  lanes: topics.lanes.map((lane) => ({ id: lane.id, name: lane.name, status: lane.status, kept: lane.kept, dropped: lane.dropped })),
  dropped: topics.dropped.map((row) => ({ id: row.id, topic: row.topic, text: droppedText(row), reasons: row.reasons })),
});
