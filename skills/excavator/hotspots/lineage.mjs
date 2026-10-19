/**
 * lineage.mjs
 *
 * The path map the history walk follows. Commits are visited newest first with
 * a map from history path to current path (the selected file whose lineage that
 * path belongs to), starting from every selected file mapping to itself.
 *
 *   - a change on a mapped path belongs to that current file;
 *   - an add, or the destination of a rename or copy, begins a lineage: the path
 *     is dropped from the map, so earlier files of the same name are other files;
 *   - a rename `old -> new` carries the lineage `new` had back to `old`;
 *   - when `new` has no lineage the rename ends the lineage `old` held: the older
 *     history of `old` falls outside the selection, never to another file;
 *   - a change on a path that maps nowhere falls outside the selection.
 *
 * The records of one commit take effect together: each is attributed by the map
 * as it stood after the commit, and only then is the map moved to before it. A
 * map updated record by record would let one record see another's update.
 *
 * One path map over a branched history is an approximation, so the walk records
 * where it can be wrong: a lineage conflict is counted on the affected current
 * file when
 *   - two lineages claim one path: a rename whose old path already belongs to a
 *     different file than the new path does (both files);
 *   - a rename cuts a lineage: the new path has none, the old path belongs to a
 *     file (that file);
 *   - an older change follows a cut: a lineage began on path `p` (an add or a
 *     rename or copy destination), and an older commit still has a change on `p`
 *     that is not a deletion (in linear history the only thing before a
 *     lineage begins is the deletion of the previous file); the file whose
 *     lineage began there. A rename that gives `p` a live lineage again clears it.
 */

/**
 * @param {Iterable<string>} selected current paths of the selected files
 * @returns {{ step: (records: Array<{ status: string, path: string, oldPath: string | null }>)
 *   => { targets: Array<string | undefined>, conflicts: string[] } }}
 *   `step` moves the walk over one commit's records: `targets[i]` is the current
 *   file record `i` belongs to (`undefined`: outside the selection) and
 *   `conflicts` lists the current files that got a lineage conflict, one entry
 *   per conflict.
 */
export function createLineage(selected) {
  const current = new Map([...selected].map((path) => [path, path]));
  const cut = new Map(); // path a lineage began on -> the file that lineage belongs to

  function step(records) {
    const targets = records.map((record) => current.get(record.path));
    const conflicts = [];

    records.forEach((record, i) => {
      if (targets[i] !== undefined || !cut.has(record.path)) return;
      if (record.status === 'D') cut.delete(record.path);
      else conflicts.push(cut.get(record.path));
    });

    for (const record of records) {
      if ((record.status === 'R' || record.status === 'A' || record.status === 'C') && current.has(record.path)) {
        cut.set(record.path, current.get(record.path));
        current.delete(record.path);
      }
    }

    records.forEach((record, i) => {
      if (record.status !== 'R') return;
      const held = current.get(record.oldPath);
      if (targets[i] === undefined) {
        if (held !== undefined) {
          conflicts.push(held);
          current.delete(record.oldPath);
        }
        return;
      }
      if (held !== undefined && held !== targets[i]) conflicts.push(held, targets[i]);
      current.set(record.oldPath, targets[i]);
      cut.delete(record.oldPath);
    });

    return { targets, conflicts };
  }

  return { step };
}

export default { createLineage };
