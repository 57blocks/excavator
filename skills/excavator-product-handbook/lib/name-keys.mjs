/**
 * The name and label keys a round-2 rewrite may not change (openspec change
 * handbook-recall). A listed item may change its claim text and its citations,
 * but what names it or places it stays: the script cannot judge whether a new
 * claim is a narrowing, so the keys that say which thing the item is about are
 * held to the round-1 values. This table is the one place that lists them, for
 * the feature entry, the overview and the findings formats; a key added to a
 * shape that names or classifies a node is added here.
 *
 *   feature entry: who.role, where.label, screens.name, fields.label, rules.side,
 *     operations.name, handoffs.feature, states.label, transitions.from and .to
 *   overview: name.text, audiences.who, applications.dir and .name,
 *     integrations.system and .callers
 *   findings and system findings: findings.category
 *
 * A text a model writes (a purpose, a rule text, a meaning, a statement) is not
 * here: that is what a narrowing changes. `side` and `category` classify the
 * item instead of naming it; they are held so a rewrite cannot turn an item
 * into a different kind of fact.
 */

import { OPERATION_PARTS, partList, transitionList } from './entry-parts.mjs';

const HANDOFFS = OPERATION_PARTS.find((part) => part.key === 'handoffs');

const pick = (node, keys) => Object.fromEntries(keys.map((key) => [key, node[key]]));

function entryKeys(entry, put) {
  entry.who.forEach((who, i) => put(`who[${i}]`, pick(who, ['role'])));
  entry.where.forEach((place, i) => put(`where[${i}]`, pick(place, ['label'])));
  entry.screens.forEach((screen, i) => {
    put(`screens[${i}]`, pick(screen, ['name']));
    screen.fields.forEach((field, j) => {
      put(`screens[${i}].fields[${j}]`, pick(field, ['label']));
      field.rules.forEach((rule, k) => put(`screens[${i}].fields[${j}].rules[${k}]`, pick(rule, ['side'])));
    });
  });
  entry.operations.forEach((operation, i) => {
    put(`operations[${i}]`, pick(operation, ['name']));
    partList(operation, HANDOFFS).forEach((handoff, k) => put(`operations[${i}].handoffs[${k}]`, pick(handoff, ['feature'])));
  });
  entry.states.forEach((state, i) => put(`states[${i}]`, pick(state, ['label'])));
  transitionList(entry).forEach((transition, i) => put(`transitions[${i}]`, pick(transition, ['from', 'to'])));
}

function overviewKeys(doc, put) {
  if (doc.name !== undefined && doc.name !== null) put('name', pick(doc.name, ['text']));
  doc.audiences.forEach((entry, i) => put(`audiences[${i}]`, pick(entry, ['who'])));
  doc.applications.forEach((entry, i) => put(`applications[${i}]`, pick(entry, ['dir', 'name'])));
  doc.integrations.forEach((entry, i) => put(`integrations[${i}]`, pick(entry, ['system', 'callers'])));
}

const findingsKeys = (doc, put) => doc.findings.forEach((finding, i) => put(`findings[${i}]`, pick(finding, ['category'])));

const READERS = Object.freeze({ feature: entryKeys, overview: overviewKeys, findings: findingsKeys, 'system-findings': findingsKeys });

/** A Map from node path to its `{ key: value }` name and label keys, for a document of the unit kind `kind` (unit.mjs). */
export function identityKeys(kind, doc) {
  const reader = READERS[kind];
  if (reader === undefined) throw new Error(`no name keys for the unit kind ${kind}`);
  const keys = new Map();
  reader(doc, (path, value) => keys.set(path, value));
  return keys;
}

/** `a[0].b[1]` gives `a[0]` and `a[0].b[1]`: the node paths from the top down to the path itself. */
const chain = (path) => path.split('.').map((_, index, parts) => parts.slice(0, index + 1).join('.'));

/**
 * The `<node path>.<key>` of every name or label key that differs between the
 * two key maps (`identityKeys`) on the node of `itemPath` and on the nodes
 * above it, in node order.
 */
export function nameChanges(before, after, itemPath) {
  const changed = [];
  for (const path of chain(itemPath)) {
    const old = before.get(path) ?? {};
    const now = after.get(path) ?? {};
    for (const key of new Set([...Object.keys(old), ...Object.keys(now)])) {
      if (JSON.stringify(old[key]) !== JSON.stringify(now[key])) changed.push(`${path}.${key}`);
    }
  }
  return changed;
}
