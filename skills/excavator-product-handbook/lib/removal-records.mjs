/**
 * The records of the items a settling step removes from an entry (design D14):
 * `verdicts --round 2` removes what the two verifiers did not both confirm,
 * `trace-verdicts` removes what either tracer contradicted. Either way what hangs on
 * a removed item goes with it, and each record names the item's path, its
 * claim, the verdict and the reason; the records go to state.json and the
 * coverage section lists them.
 */

import { entryItems } from './items.mjs';
import { trimEntry } from './trim-entry.mjs';

const isAncestor = (ancestor, path) => path.startsWith(`${ancestor}.`);

/**
 * `{ trimmed, records }` for removing the items `removedByVerdict` (paths) from
 * `entry`: the trimmed entry and a record for each item gone, in entry order,
 * plus one for each operation left without a sentence. `verdictOf(path)` is
 * `{ verdict, reason }` and `claimOf(path)` the claim of an item. With
 * `options.step` every record carries it (`step: "trace"`), with
 * `options.reasonsOf(path)` a record of a removed item carries the reasons it
 * returns, and with `options.atOf(path)` the positions it returns; records of
 * the earlier step keep their older shape (no step).
 */
export function removalRecords(entry, removedByVerdict, verdictOf, claimOf, options = {}) {
  const { step, reasonsOf, atOf } = options;
  const removed = new Set(removedByVerdict);
  const { entry: trimmed, together } = trimEntry(entry, removed);
  const order = entryItems(entry).map((item) => item.path);
  const emptiedOperations = together.filter((path) => /^operations\[\d+\]$/.test(path));
  const paths = [...new Set([...removed, ...together.filter((path) => !emptiedOperations.includes(path))])].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const stamp = (record) => (step === undefined ? record : { ...record, step });
  const records = paths.map((path) => {
    const underRemoved = [...removed].some((ancestor) => isAncestor(ancestor, path));
    if (!removed.has(path) || underRemoved) return stamp({ path, claim: claimOf(path), verdict: 'withParent', reason: '' });
    const base = { path, claim: claimOf(path), verdict: verdictOf(path).verdict, reason: verdictOf(path).reason };
    const withReasons = reasonsOf === undefined ? base : { ...base, reasons: reasonsOf(path) };
    return stamp(atOf === undefined ? withReasons : { ...withReasons, at: atOf(path) });
  });
  for (const path of emptiedOperations) {
    const index = Number(path.match(/\d+/)[0]);
    records.push(stamp({ path, claim: entry.operations[index].name, verdict: 'withParent', reason: '' }));
  }
  return { trimmed, records };
}
