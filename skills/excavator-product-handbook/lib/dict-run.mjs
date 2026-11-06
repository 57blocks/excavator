/**
 * The report line of the status dictionary (openspec change
 * handbook-status-dictionary, design D1), computed from the counts the shape
 * check holds the lists to. `data-run.mjs` writes the file and prints it.
 */

/** `Dictionaries: ...`, one line. */
export function dictionariesLine(counts) {
  const { goTypes, goConstants, goVars, tsConstObjects, jsObjects, mapEntries } = counts.candidates;
  const other = goTypes.noConstants + goTypes.duplicate + goConstants.untypedIota + goConstants.otherType + goConstants.plain + goVars.otherType + tsConstObjects.noLiteralMembers + jsObjects.noLiteralMembers + mapEntries.unmatchedKey + mapEntries.ambiguousKey;
  const buckets = `${goTypes.noConstants} Go types without constants, ${goTypes.duplicate} Go types declared again, ${goConstants.untypedIota} untyped iota constants, ${goConstants.otherType} constants of another type, ${goConstants.plain} plain constants, ${goVars.otherType} variables of another type, ${tsConstObjects.noLiteralMembers} TS const objects without literal members, ${jsObjects.noLiteralMembers} JS objects without literal members, ${mapEntries.unmatchedKey} unmatched keys, ${mapEntries.ambiguousKey} ambiguous keys`;
  return `Dictionaries: ${counts.dictionaries.total} value sets (${counts.dictionaries.goType} Go types, ${counts.dictionaries.tsEnum} TS enums, ${counts.dictionaries.tsConstObject} TS const objects, ${counts.dictionaries.jsObject} JS objects); ${counts.members.total} members (${counts.members.computed} computed, ${counts.members.notComputed} not computed); ${counts.comments} comments; ${counts.labels} display names; ${counts.mismatches} same names with different values; ${counts.skippedMembers} skipped members; ${other} other candidates (${buckets}).`;
}
