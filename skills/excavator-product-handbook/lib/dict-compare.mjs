/**
 * The same name on both sides (openspec change handbook-status-dictionary,
 * design D5). Value sets are grouped by name, compared without case and
 * without underscores; where one name is in two or more applications, each
 * pair from different applications is compared by the VALUES of the members,
 * not their names, since the languages name members differently. A value one
 * side has and the other does not goes to `onlyLeft` or `onlyRight`; a value
 * both have is listed with the member names of each side; the members whose
 * value was not computed are listed apart as not compared. A pair with a
 * value on one side only is a mismatch; a pair with no computed value on one
 * side has nothing to compare and is not listed.
 */

const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The key a name is compared by. */
export const normalizeName = (name) => name.toLowerCase().replace(/_/g, '');

/** Values order: numbers first, ascending, then strings in byte order. */
const byValue = (a, b) => (typeof a.value === typeof b.value ? (typeof a.value === 'number' ? a.value - b.value : byteOrder(a.value, b.value)) : typeof a.value === 'number' ? -1 : 1);

/** `{ values: Map, uncompared: [names] }` of a value set. */
function valuesOf(dictionary) {
  const values = new Map();
  const uncompared = [];
  for (const member of dictionary.members) {
    if (!member.computed) {
      uncompared.push(member.name);
      continue;
    }
    const key = `${typeof member.value}:${member.value}`;
    const entry = values.get(key) ?? { value: member.value, members: [] };
    entry.members.push(member.name);
    values.set(key, entry);
  }
  return { values, uncompared };
}

/** The mismatches of a list of value sets, ordered by key, then by the two ids. */
export function computeMismatches(dictionaries) {
  const groups = new Map();
  const ordered = [...dictionaries].sort((a, b) => byteOrder(a.application, b.application) || byteOrder(a.id, b.id));
  for (const dictionary of ordered) {
    const key = normalizeName(dictionary.name);
    groups.set(key, [...(groups.get(key) ?? []), dictionary]);
  }
  const rows = [];
  for (const [key, list] of groups) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const [left, right] = [list[i], list[j]];
        if (left.application === right.application) continue;
        const a = valuesOf(left);
        const b = valuesOf(right);
        if (a.values.size === 0 || b.values.size === 0) continue;
        const onlyLeft = [...a.values.entries()].filter(([k]) => !b.values.has(k)).map(([, entry]) => entry).sort(byValue);
        const onlyRight = [...b.values.entries()].filter(([k]) => !a.values.has(k)).map(([, entry]) => entry).sort(byValue);
        if (onlyLeft.length === 0 && onlyRight.length === 0) continue;
        const both = [...a.values.entries()].filter(([k]) => b.values.has(k)).map(([k, entry]) => ({ value: entry.value, left: entry.members, right: b.values.get(k).members })).sort(byValue);
        const side = (dictionary) => ({ id: dictionary.id, application: dictionary.application, name: dictionary.name });
        rows.push({ key, left: side(left), right: side(right), onlyLeft, onlyRight, both, uncompared: { left: a.uncompared, right: b.uncompared } });
      }
    }
  }
  return rows.sort((x, y) => byteOrder(x.key, y.key) || byteOrder(x.left.id, y.left.id) || byteOrder(x.right.id, y.right.id));
}
