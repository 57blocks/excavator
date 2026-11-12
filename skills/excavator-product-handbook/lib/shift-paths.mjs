/**
 * Item paths after items were removed from an entry (design D14). Paths name
 * array positions (`states[1]`), so removing `states[0]` makes the item that was
 * `states[1]` become `states[0]`. `shiftedPath` gives the path an item has in the
 * trimmed entry, so the round-1 snapshot and the rewrite file can be read in the
 * coordinates of the entry the rewriter edits.
 */

const SEGMENT = /^(.+)\[(\d+)\]$/;

/**
 * The path `path` of the entry before the removal has after it. `gone` is the set
 * of every path the removal took (the records of removal-records.mjs name each:
 * the removed items, what went with them, an operation left without a sentence).
 * `path` itself must not be in `gone`.
 */
export function shiftedPath(path, gone) {
  let oldPrefix = '';
  const segments = path.split('.').map((segment) => {
    const match = SEGMENT.exec(segment);
    let shifted = segment;
    if (match !== null) {
      const index = Number(match[2]);
      let before = 0;
      for (let i = 0; i < index; i += 1) if (gone.has(`${oldPrefix}${match[1]}[${i}]`)) before += 1;
      shifted = `${match[1]}[${index - before}]`;
    }
    oldPrefix = `${oldPrefix}${segment}.`;
    return shifted;
  });
  return segments.join('.');
}
