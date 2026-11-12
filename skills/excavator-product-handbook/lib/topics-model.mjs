/**
 * The topics as the outputs write them (openspec change handbook-topics, design
 * D6). `withTopics` takes what a loaded run holds (topics-state.mjs) and the facts
 * of the lanes as they are now (topics-facts.mjs) and gives the rows that the two
 * judges kept, each resolved against the facts, by topic. Both outputs build it
 * here, so the handbook and the page cannot differ.
 *
 * A lane is used only when it is verified, its file is still the one the judges
 * saw (load-run) and the facts it was written for are the facts now (the digest in
 * the state): otherwise it writes no row, and the coverage says what stage it is
 * at (`stale` for a lane written for other facts). The rows the judges dropped are
 * listed with their reasons. The rows are in the order of the chapter: by topic,
 * then by lane, then in the order of the lane's file.
 */

import { TOPIC_IDS, mergeRows } from './topics-shape.mjs';

const NONE_LOADED = Object.freeze({ lanes: new Map() });

/** The status of a lane for the outputs: `verified`, `stale` (written for other facts), or the state's own status. */
function statusOf(own, current) {
  if (current) return 'verified';
  if (own.doc !== null || own.status === 'verified') return 'stale';
  return own.status;
}

/** A cited fact as an output shows it. `locate` maps an evidence citation to its lines (null in the product view); `findingPlaces` the places of a finding by id. */
function citeOf(id, fact, { locate, findingPlaces }) {
  if (fact.kind === 'item') {
    const places = locate === null ? [] : fact.evidence.map((citation) => {
      const found = locate(citation);
      return { file: citation.file, startLine: found?.startLine ?? null, endLine: found?.endLine ?? null };
    });
    return { id, kind: 'item', feature: fact.feature.name, featureId: fact.feature.id, text: fact.text, places };
  }
  const first = fact.items[0].id;
  return { id, kind: 'group', key: id, firstId: first, level: fact.level, category: fact.category, text: fact.statement, places: findingPlaces?.get(first) ?? [] };
}

/** The columns of a row as the reader sees them: a data row's two domains and an access row's feature by name. */
function shownFields(row, facts) {
  const domain = (id) => facts.domains.find((one) => one.id === id)?.name ?? id;
  if (row.topic === 'handoffs') return { from: domain(row.fields.from), to: domain(row.fields.to), content: row.fields.content };
  if (row.topic === 'access') return { ...row.fields, feature: facts.features.get(row.fields.feature) ?? row.fields.feature };
  return { ...row.fields };
}

/**
 * `{ hasLanes, finished, stale, anyVerified, lanes, entriesRead, groupsRead, rowsKept, topics, dropped, domainWritten, repeatedWritten, places }`.
 * `finished`: there is no lane, or every lane is verified for the facts now. `stale`: some lane is verified for other facts.
 * `lanes`: `[{ id, name, kind, status, kept, dropped }]` for each lane of the facts, `name` null for the repeated lane. `entriesRead`: the
 * verified entries the verified domain lanes read; `groupsRead`: the groups of findings the verified repeated lane read. `topics`: topic id ->
 * `[{ id, lane, topic, fields, refs, cites }]` of the rows that were kept (`fields` as the reader sees them, `refs` the ids of a data row's
 * domains); `dropped`: `[{ id, lane, topic, fields, reasons }]`. `domainWritten`, `repeatedWritten`: whether a lane of that kind is verified.
 * `places`: `[{ id, citations }]`, the places of each cited item (empty unless `locate` is given).
 */
export function withTopics(loaded = NONE_LOADED, facts, { locate = null, findingPlaces = null } = {}) {
  const hasLanes = facts.lanes.length > 0;
  const states = facts.lanes.map((lane) => {
    const own = loaded.lanes.get(lane.id) ?? { status: 'planned', doc: null, dropped: [], factsDigest: null };
    const current = own.doc !== null && own.factsDigest === lane.digest;
    return { lane, own, current, status: statusOf(own, current) };
  });
  const verified = states.filter((one) => one.current);
  const droppedBy = new Map(verified.flatMap(({ own }) => own.dropped.map((one) => [one.id, one.reasons])));
  const merged = mergeRows(verified.map(({ own }) => own.doc));
  const laneFacts = (id) => facts.byLane.get(id);
  const resolve = (row) => ({
    id: row.id,
    lane: row.lane,
    topic: row.topic,
    fields: shownFields(row, facts),
    refs: row.topic === 'handoffs' ? { from: row.fields.from, to: row.fields.to } : {},
    cites: row.cites.map((id) => citeOf(id, laneFacts(row.lane).byId.get(id), { locate, findingPlaces })),
  });
  const kept = merged.filter((row) => !droppedBy.has(row.id)).map(resolve);
  const dropped = merged.filter((row) => droppedBy.has(row.id)).map((row) => ({ id: row.id, lane: row.lane, topic: row.topic, fields: shownFields(row, facts), reasons: droppedBy.get(row.id) }));
  const topics = Object.fromEntries(TOPIC_IDS.map((id) => [id, kept.filter((row) => row.topic === id)]));
  const lanes = states.map(({ lane, current, status }) => ({
    id: lane.id,
    name: lane.kind === 'repeated' ? null : lane.name,
    kind: lane.kind,
    status,
    kept: current ? kept.filter((row) => row.lane === lane.id).length : 0,
    dropped: current ? dropped.filter((row) => row.lane === lane.id).length : 0,
  }));
  const seen = new Map();
  for (const row of kept) for (const cite of row.cites) if (cite.kind === 'item' && !seen.has(cite.id)) seen.set(cite.id, cite.places);
  return {
    hasLanes,
    finished: !hasLanes || states.every((one) => one.current),
    stale: states.some((one) => one.status === 'stale'),
    anyVerified: verified.length > 0,
    lanes,
    entriesRead: verified.filter(({ lane }) => lane.kind === 'domain').reduce((sum, { lane }) => sum + lane.featureIds.length, 0),
    groupsRead: verified.filter(({ lane }) => lane.kind === 'repeated').reduce((sum, { lane }) => sum + lane.rows.length, 0),
    rowsKept: kept.length,
    topics,
    dropped,
    domainWritten: verified.some(({ lane }) => lane.kind === 'domain'),
    repeatedWritten: verified.some(({ lane }) => lane.kind === 'repeated'),
    places: locate === null ? [] : [...seen].map(([id, citations]) => ({ id, citations })),
    domainNames: Object.fromEntries(facts.domains.map((domain) => [domain.id, domain.name])),
  };
}

/** The topics of an output that was given none (an older caller): no lane, nothing to write. */
export const EMPTY_TOPICS = Object.freeze({
  hasLanes: false, finished: true, stale: false, anyVerified: false, lanes: Object.freeze([]), entriesRead: 0, groupsRead: 0, rowsKept: 0,
  topics: Object.freeze(Object.fromEntries(TOPIC_IDS.map((id) => [id, Object.freeze([])]))), dropped: Object.freeze([]),
  domainWritten: false, repeatedWritten: false, places: Object.freeze([]), domainNames: Object.freeze({}),
});

