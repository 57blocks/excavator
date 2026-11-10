/**
 * Remove items from an entry (design D14, round 2): the items still not
 * verified go, and what hangs on them goes with them: a screen takes its
 * fields and their rules, a field its rules, an operation that has no sentence
 * left goes itself with its other parts (triggers, calculations, changes, edges, handoffs). Items are named by the paths of items.mjs, all read
 * against the entry as it is before anything is removed.
 */

import { OPERATION_PARTS, partList } from './entry-parts.mjs';

/**
 * Returns `{ entry, together }`: a copy of `entry` without the items of the
 * path set `removed`, and the paths that went with them, in entry order
 * (descendants of a removed item, and the operations left without a sentence).
 */
export function trimEntry(entry, removed) {
  const out = structuredClone(entry);
  const together = [];
  const gone = (path) => removed.has(path);
  const alongWith = (path) => {
    if (!gone(path)) together.push(path);
  };
  // A removed purpose leaves no key, like an item filtered out of a list.
  if (gone('purpose')) delete out.purpose;
  out.who = entry.who.filter((_, i) => !gone(`who[${i}]`));
  out.where = entry.where.filter((_, i) => !gone(`where[${i}]`));
  out.states = entry.states.filter((_, i) => !gone(`states[${i}]`));
  if (entry.transitions !== undefined) out.transitions = entry.transitions.filter((_, i) => !gone(`transitions[${i}]`));
  out.notifications = entry.notifications.filter((_, i) => !gone(`notifications[${i}]`));
  out.automatic = entry.automatic.filter((_, i) => !gone(`automatic[${i}]`));

  out.screens = [];
  entry.screens.forEach((screen, i) => {
    const sPath = `screens[${i}]`;
    const screenGone = gone(sPath);
    const fields = [];
    screen.fields.forEach((field, j) => {
      const fPath = `${sPath}.fields[${j}]`;
      const fieldGone = screenGone || gone(fPath);
      if (screenGone) alongWith(fPath);
      const rules = [];
      field.rules.forEach((rule, k) => {
        const rPath = `${fPath}.rules[${k}]`;
        if (fieldGone) alongWith(rPath);
        else if (!gone(rPath)) rules.push(rule);
      });
      if (!fieldGone) fields.push({ ...field, rules });
    });
    if (!screenGone) out.screens.push({ ...screen, fields });
  });

  out.operations = [];
  entry.operations.forEach((operation, i) => {
    const sentences = operation.sentences.filter((_, j) => !gone(`operations[${i}].sentences[${j}]`));
    if (sentences.length === 0) {
      // An operation without a step goes with its other parts.
      for (const part of OPERATION_PARTS) partList(operation, part).forEach((_, k) => alongWith(`operations[${i}].${part.key}[${k}]`));
      together.push(`operations[${i}]`);
    } else {
      const kept = { ...operation, sentences };
      for (const part of OPERATION_PARTS) {
        if (operation[part.key] !== undefined) kept[part.key] = operation[part.key].filter((_, k) => !gone(`operations[${i}].${part.key}[${k}]`));
      }
      out.operations.push(kept);
    }
  });
  return { entry: out, together };
}
