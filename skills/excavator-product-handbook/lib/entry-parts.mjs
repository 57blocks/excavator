/**
 * The parts of an operation beyond its steps (openspec change
 * handbook-deep-entry, entry format /2), in the order an operation is read:
 * what starts it, what it calculates, which data it changes, its edge cases and
 * the hand-overs to other features. One descriptor per part is the single place
 * the shape, items, claims, trimming, topic facts and rendering read, so a part
 * is added in one list. A /1 entry has none of these lists and no `transitions`;
 * `partList` and `transitionList` read a missing list as empty.
 *
 * `strings` are the reader-visible string keys of an element (in claim order),
 * `uiKey` the fixed text that names the part, `itemKind` the topic-fact kind.
 * `evidence` is carried by every element.
 */

export const OPERATION_PARTS = Object.freeze([
  { key: 'triggers', strings: ['text'], uiKey: 'md.operation.triggers', itemKind: 'trigger' },
  { key: 'calculations', strings: ['text'], uiKey: 'md.operation.calculations', itemKind: 'calculation' },
  { key: 'changes', strings: ['text'], uiKey: 'md.operation.changes', itemKind: 'change' },
  { key: 'edges', strings: ['when', 'then'], uiKey: 'md.operation.edges', itemKind: 'edge', itemUiKey: 'md.edge.item' },
  { key: 'handoffs', strings: ['text'], uiKey: 'md.operation.handoffs', itemKind: 'handoff', itemUiKey: 'md.handoff.item' },
]);

/** The elements of part `part` of `operation`; an operation of a /1 entry has none. */
export const partList = (operation, part) => operation[part.key] ?? [];

/** The state transitions of an entry; an entry of /1 has none. */
export const transitionList = (entry) => entry.transitions ?? [];
