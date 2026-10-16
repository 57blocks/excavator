/**
 * members.mjs
 *
 * The member repositories of a multi-repo target, for the overview. Pure.
 */

/**
 * Members of a multi-repo target by first path segment: `files` counts the
 * manifest entries, `selected` the selection funnel's `selected` entries
 * (null when the manifest records no selection entries). The two can differ
 * (a selected path with no manifest entry); neither is adjusted to match.
 * @param {Array<{ path: string }>} entries
 * @param {any} selection
 */
export function memberRepositories(entries, selection) {
  const firstSegments = (/** @type {Iterable<string>} */ paths) => {
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const path of paths) {
      if (path.includes('/')) {
        const first = path.split('/')[0];
        counts.set(first, (counts.get(first) ?? 0) + 1);
      }
    }
    return counts;
  };
  const files = firstSegments(entries.map((e) => e.path));
  const selectionEntries = Array.isArray(selection?.entries) ? selection.entries : null;
  const selected = selectionEntries
    ? firstSegments(selectionEntries.filter((/** @type {any} */ e) => e?.kind === 'selected' && typeof e.path === 'string').map((/** @type {any} */ e) => e.path))
    : null;
  const names = [...new Set([...files.keys(), ...(selected ? selected.keys() : [])])];
  return names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((name) => ({
    name,
    files: files.get(name) ?? 0,
    selected: selected ? (selected.get(name) ?? 0) : null,
  }));
}
