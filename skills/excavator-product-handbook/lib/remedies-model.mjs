/**
 * The remedies as the outputs write them (openspec change handbook-remedies,
 * design D6). `withRemedies` takes what a loaded run holds (remedies-state.mjs)
 * and the facts of the findings as they are now (remedies-facts.mjs) and gives
 * the paragraphs and recommendations that two judges confirmed, each resolved
 * against the facts. Both outputs build it here, so the handbook and the page
 * cannot differ.
 *
 * The remedies are used only when the unit is verified, its file is still the one
 * the judges saw (load-run) and the facts they were written for are the facts now
 * (the digest in the state): otherwise `finished` is false and nothing is written,
 * and the coverage says which of the two it is (`stale`). The paragraphs the judges
 * dropped are listed with their reasons; the recommendations that are kept are
 * numbered again from 1 in the order of the file.
 */

import { paragraphsOf } from './remedies-shape.mjs';

const NONE = Object.freeze({ status: 'planned', doc: null, dropped: [], factsDigest: null });

/** A cited group as an output shows it: its key, level (or `unranked`), category and statement, with the first finding for the places. */
const groupOf = (row) => ({ key: row.key, level: row.level, category: row.category, text: row.statement, item: row.items[0] });

/**
 * `{ finished, stale, hasGroups, categories, recommendations, dropped, groupsCited }`.
 * `finished`: there is no group to write remedies for, or the remedies are verified and current. `stale`: verified, but for other facts.
 * `categories`: `[{ category, cause, measure }]` that were kept. `recommendations`: `[{ number, title, text, groups, facts }]` that were kept,
 * `groups` the cited groups (`groupOf`), `facts` the cited facts that are not groups (the rows of remedies-facts.mjs). `dropped`:
 * `[{ id, kind, category | title, text | cause, reasons }]` the paragraphs the judges did not both accept. `groupsCited`: the number of distinct
 * groups the kept recommendations cite.
 */
export function withRemedies(remedies = NONE, facts) {
  const hasGroups = facts.groups.length > 0;
  const current = remedies.doc !== null && remedies.factsDigest === facts.digest;
  const base = { hasGroups, finished: !hasGroups || current, stale: remedies.doc !== null && !current, categories: [], recommendations: [], dropped: [], groupsCited: 0 };
  if (!current) return base;
  const paragraphs = paragraphsOf(remedies.doc);
  const droppedIds = new Map(remedies.dropped.map((one) => [one.id, one.reasons]));
  const kept = paragraphs.filter((paragraph) => !droppedIds.has(paragraph.id));
  const categories = kept.filter((paragraph) => paragraph.kind === 'category').map((paragraph) => ({ category: paragraph.category, cause: paragraph.cause, measure: paragraph.measure }));
  const recommendations = kept.filter((paragraph) => paragraph.kind === 'recommendation').map((paragraph, index) => ({
    number: index + 1,
    title: paragraph.title,
    text: paragraph.text,
    groups: paragraph.cites.map((id) => facts.byId.get(id)).filter((row) => row.kind === 'group').map(groupOf),
    facts: paragraph.cites.map((id) => facts.byId.get(id)).filter((row) => row.kind !== 'group'),
  }));
  const dropped = paragraphs.filter((paragraph) => droppedIds.has(paragraph.id)).map((paragraph) => ({ ...paragraph, reasons: droppedIds.get(paragraph.id) }));
  const groupsCited = new Set(recommendations.flatMap((one) => one.groups.map((group) => group.key))).size;
  return { ...base, categories, recommendations, dropped, groupsCited };
}

/** The remedies of an output that was given none (an older caller): nothing to write, and no verified finding to write them for. */
export const EMPTY_REMEDIES = Object.freeze({ hasGroups: false, finished: true, stale: false, categories: Object.freeze([]), recommendations: Object.freeze([]), dropped: Object.freeze([]), groupsCited: 0 });
