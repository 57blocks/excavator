/**
 * Remove items from an entry (design D14, round 2): the items still not
 * verified go, and what hangs on them goes with them: a screen takes its
 * fields and their rules, a field its rules, an operation that has no sentence
 * left goes itself. Items are named by the paths of items.mjs, all read
 * against the entry as it is before anything is removed.
 */

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
    if (sentences.length === 0) together.push(`operations[${i}]`);
    else out.operations.push({ ...operation, sentences });
  });
  return { entry: out, together };
}
