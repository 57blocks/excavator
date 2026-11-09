/**
 * The id of a system findings unit (openspec change handbook-system-findings):
 * `app<n>.system`, `n` counted from 1 in the order `handbook.mjs applications`
 * prints the application roots. The suffix `.system` keeps it apart from the
 * findings of a feature (`.findings`) and from a feature id, which has no dot
 * (ID_PATTERN). Its file, `entries/app<n>.system.json`, has the shape of a
 * findings file, so findings-shape.mjs checks it; only the `id` differs.
 */

export const SYSTEM_SUFFIX = '.system';
const SYSTEM_ID = /^app([1-9][0-9]*)\.system$/;

export const isSystemId = (id) => SYSTEM_ID.test(id);
export const systemUnitId = (n) => `app${n}${SYSTEM_SUFFIX}`;
/** The 1-based application number of a system unit id. */
export const applicationNumber = (id) => Number(SYSTEM_ID.exec(id)[1]);
/** The key of a system unit in `state.systemFindings`: `app<n>`. */
export const systemKey = (id) => id.slice(0, -SYSTEM_SUFFIX.length);

/** `app<n>` or `app<n>.system` as the unit id, or null for anything else. */
export function systemUnitIdOf(text) {
  const id = /^app[1-9][0-9]*$/.test(text) ? `${text}${SYSTEM_SUFFIX}` : text;
  return isSystemId(id) ? id : null;
}
