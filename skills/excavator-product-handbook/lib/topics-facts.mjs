/**
 * The facts a topics lane may cite (openspec change handbook-topics, design D2),
 * built by a script from the checked run and never by a model. One lane for each
 * business domain (or area, when the handbook groups by area) that has at least
 * one verified entry, and `repeated` when verified groups of findings exist.
 *
 * A domain lane lists the verified items of the entries of its features, one
 * line each, tab-separated, the first field the id a row cites:
 *
 *   <featureId>#<item path> <feature name> <kind> <text>
 *
 * with the kinds who (`<role>: <can>`), sentence (`<operation>: <sentence>`),
 * state (`<label>: <meaning>`), automatic (`<when>: <effect>`) and notification
 * (`<trigger> | <channel> | <recipient>`); the item paths are those of items.mjs.
 * The repeated lane lists the groups of the verified findings as remedy-facts
 * does, plus the names of the applications the group's passages are in (the
 * system name when the overview is verified, else the directory):
 *
 *   <group key> <level: P0|P1|P2|unranked> <category key> <statement> <application names|->
 *
 * The digest of a lane's lines is the input of the lane: changed facts start the
 * lane over. `laneFactsOf` is pure; `loadTopicFacts` builds them from a loaded run.
 */

import { createHash } from 'node:crypto';

import { isUnder, scanProject } from './applications.mjs';
import { domainGrouping } from './domain-grouping.mjs';
import { buildFindings } from './findings-model.mjs';
import { groupKey } from './priority-groups.mjs';
import { withPriority } from './priority-model.mjs';
import { buildSystem } from './system-facts.mjs';
import { REPEATED_LANE } from './topics-shape.mjs';

export const NONE = '-';
export const UNRANKED = 'unranked';
const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim();
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The line a row prints. */
export const factLine = (row) => [row.id, ...row.fields].join('\t');

/** The digest of a lane's fact lines: the input of the lane, kept in state.json. */
export const factsDigest = (rows) => createHash('sha256').update(rows.map(factLine).join('\n')).digest('hex');

/** The facts of one verified entry, in the order of the kinds: `{ id, kind: 'item', itemKind, feature, text, path, evidence, fields }`. */
export function entryFactRows(feature, entry) {
  const row = (path, itemKind, text, evidence) => ({
    id: `${feature.id}#${path}`,
    kind: 'item',
    itemKind,
    feature: { id: feature.id, name: oneLine(feature.name) },
    path,
    text: oneLine(text),
    evidence,
    fields: [oneLine(feature.name), itemKind, oneLine(text)],
  });
  return [
    ...entry.who.map((who, i) => row(`who[${i}]`, 'who', `${who.role}: ${who.can}`, who.evidence)),
    ...entry.operations.flatMap((operation, i) => operation.sentences.map((sentence, j) => row(`operations[${i}].sentences[${j}]`, 'sentence', `${operation.name}: ${sentence.text}`, sentence.evidence))),
    ...entry.states.map((state, i) => row(`states[${i}]`, 'state', `${state.label}: ${state.meaning}`, state.evidence)),
    ...entry.automatic.map((item, i) => row(`automatic[${i}]`, 'automatic', `${item.when}: ${item.effect}`, item.evidence)),
    ...entry.notifications.map((n, i) => row(`notifications[${i}]`, 'notification', `${n.trigger} | ${n.channel} | ${n.recipient}`, n.evidence)),
  ];
}

/** The application directory a project-relative file is under: the longest root that holds it, or null. */
function applicationOfFile(roots, file) {
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.';
  let best = null;
  for (const root of roots) if (isUnder(dir, root) && (best === null || root.length > best.length)) best = root;
  return best;
}

/** The facts of a group of the verified findings: `{ id, kind: 'group', level, category, statement, applications, items, fields }`. */
export function groupFactRow(group, { roots, places, nameOf = (dir) => dir }) {
  const dirs = new Set();
  for (const item of group.items) for (const place of places.get(item.id) ?? []) {
    const dir = applicationOfFile(roots, place.file);
    if (dir !== null) dirs.add(dir);
  }
  const applications = [...dirs].sort(compare);
  const level = group.priority === null || group.priority === undefined ? UNRANKED : group.priority.level;
  const statement = oneLine(group.items[0].text);
  return {
    id: group.key,
    kind: 'group',
    level,
    category: group.category,
    statement,
    applications,
    items: group.items,
    fields: [level, group.category, statement, applications.length === 0 ? NONE : applications.map((dir) => oneLine(nameOf(dir))).join(', ')],
  };
}

const lane = (id, kind, name, rows, extra = {}) => ({ id, kind, name, rows, byId: new Map(rows.map((row) => [row.id, row])), digest: factsDigest(rows), ...extra });

/**
 * The lanes and what they share: `{ lanes, byLane, domains, features }`. `lanes`: `[{ id, kind: 'domain' | 'repeated', name, rows, byId, digest,
 * featureIds? }]` in the order of the grouping, then `repeated`; `domains`: every group of the grouping with its id and name (a handoff's two ends
 * are among them); `features`: id -> name of the map's features. `groups` are the groups of the verified findings with their `key` and `priority`;
 * `places` maps a finding's id to the places of its passages.
 */
export function laneFactsOf({ map, domains, entries, groups, roots, places, nameOf }) {
  const grouping = domainGrouping(map, domains);
  const featureOf = new Map(map.features.map((feature) => [feature.id, feature]));
  const lanes = [];
  for (const group of grouping.groups) {
    const featureIds = group.features.filter((id) => entries.has(id));
    if (featureIds.length === 0) continue;
    const rows = featureIds.flatMap((id) => entryFactRows(featureOf.get(id), entries.get(id)));
    lanes.push(lane(group.id, 'domain', oneLine(group.name), rows, { featureIds }));
  }
  if (groups.length > 0) lanes.push(lane(REPEATED_LANE, 'repeated', NONE, groups.map((group) => groupFactRow(group, { roots, places, nameOf })), { featureIds: [] }));
  return {
    lanes,
    byLane: new Map(lanes.map((one) => [one.id, one])),
    domains: grouping.groups.map((group) => ({ id: group.id, name: oneLine(group.name) })),
    features: new Map(map.features.map((feature) => [feature.id, oneLine(feature.name)])),
  };
}

/** The facts of a loaded run (`loadCheckedRun`), with the project scan it may reuse. */
export function loadTopicFacts(run, root, scan = scanProject(root)) {
  const findings = withPriority(buildFindings(run, root, { technical: true, roots: scan.roots }), run.priority);
  const groups = findings.groups.map((group) => ({ ...group, key: group.key ?? groupKey(group) }));
  const applications = buildSystem(run, root, scan).applications;
  const nameOf = (dir) => applications.find((row) => row.dir === dir)?.name ?? dir;
  return laneFactsOf({ map: run.map, domains: run.domains, entries: run.entries, groups, roots: scan.roots, places: findings.locations, nameOf });
}
