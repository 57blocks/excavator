/**
 * The priority each group of findings has in the outputs (openspec change
 * handbook-findings-priority, design D6). `withPriority` takes the findings of
 * findings-model.mjs and the ranking a loaded run holds (priority-state.mjs) and
 * gives each group `priority`, `{ level, consequence, reason }` or null. Both
 * outputs build it here, so the handbook and the page cannot differ.
 *
 * The keys are computed again from the groups as they are now: an item of the
 * priority file whose key no group has (the statement or the members changed
 * after the ranking) is not written, and its group is unranked. A group has a
 * priority only when the unit is checked or verified (its file still the one
 * that was checked) and the judges did not leave it unranked. A checked unit is
 * final (openspec change handbook-light-scheme): the judges left nothing out, so
 * every group the file holds keeps the level the writer gave it. The groups are then sorted by level
 * (P0, P1, P2, unranked), stably, so inside a category the order is by level and
 * then the order the handbook had.
 */

import { groupKey } from './priority-groups.mjs';
import { LEVELS, levelOf } from './priority-shape.mjs';

const NONE = Object.freeze({ status: 'planned', doc: null, unranked: [] });

/** The rank of a level for sorting: P0 first, no priority last. */
const rankOf = (priority) => (priority === null ? LEVELS.length : LEVELS.indexOf(priority.level));

/**
 * `{ ...findings, groups, priority }`: `groups` sorted, each with `priority` and its `key`; `priority`
 * is `{ finished, counts, unranked }`: `finished` false when groups exist and the unit is not verified (all
 * groups are then unranked), `counts` the groups of each level and without one, `unranked` the groups without a priority,
 * `[{ group, reasons }]` in the sorted order, with the reasons of the judges (empty when none judged the group).
 */
export function withPriority(findings, ranking = NONE) {
  const items = new Map((ranking.doc?.items ?? []).map((item) => [item.key, item]));
  const left = new Map(ranking.unranked.map((entry) => [entry.key, entry.reasons]));
  const ranked = findings.groups.map((group) => {
    const key = groupKey(group);
    const item = items.get(key);
    const priority = item === undefined || left.has(key) ? null : { level: levelOf(item.consequence), consequence: item.consequence, reason: item.reason };
    return { ...group, key, priority };
  });
  const groups = ranked
    .map((group, index) => ({ group, index }))
    .sort((a, b) => rankOf(a.group.priority) - rankOf(b.group.priority) || a.index - b.index)
    .map(({ group }) => group);
  const counts = { ...Object.fromEntries(LEVELS.map((level) => [level, groups.filter((group) => group.priority?.level === level).length])), unranked: groups.filter((group) => group.priority === null).length };
  return {
    ...findings,
    groups,
    priority: {
      finished: groups.length === 0 || ranking.doc !== null,
      // A checked ranking (openspec change handbook-light-scheme) is written, not verified: the outputs say so at its head.
      ...(ranking.unverified === true && ranking.doc !== null ? { unverified: true } : {}),
      counts,
      unranked: groups.filter((group) => group.priority === null).map((group) => ({ group, reasons: left.get(group.key) ?? [] })),
    },
  };
}

/** The counts of a findings model, for a findings model that was never given a ranking (an older caller): every group is unranked. */
export const EMPTY_PRIORITY = Object.freeze({ finished: true, counts: Object.freeze({ P0: 0, P1: 0, P2: 0, unranked: 0 }), unranked: Object.freeze([]) });
