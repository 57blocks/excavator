/**
 * Findings at the same place are one (openspec change handbook-system-findings,
 * design D7). Two findings are in one group when their category is the same and
 * a passage of each lies in the same file with overlapping line ranges; the
 * grouping is transitive (a union of the pairs). The rule looks at category and
 * place only, so two different defects on one line are one group: the outputs
 * write every statement of a group, and only the count is by group.
 * Pure: the caller gives the findings in the order the groups take (the
 * features in map order, then the system units, then the order inside a unit)
 * with each passage located (`{ file, startLine, endLine }`, null lines for a
 * passage that could not be located, which overlaps nothing).
 */

/** Whether two located passages are in the same file and share a line. */
export function rangesOverlap(a, b) {
  if (a.file !== b.file || a.startLine === null || a.endLine === null || b.startLine === null || b.endLine === null) return false;
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

/**
 * `rows` is `[{ id, category, citations: [{ file, startLine, endLine }] }]`;
 * returns the groups as lists of the rows themselves, each in input order, the
 * groups ordered by their first row: the first row of a group is its representative.
 */
export function groupFindings(rows) {
  const parent = rows.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    for (let step = index; parent[step] !== root; step = parent[step]) [parent[step], step] = [root, parent[step]];
    return root;
  };
  const join = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
  };
  // Only rows of one category and one file can meet, so the pairs are tried inside those buckets.
  const buckets = new Map();
  rows.forEach((row, index) => {
    for (const citation of row.citations) {
      const key = `${row.category}\0${citation.file}`;
      buckets.set(key, [...(buckets.get(key) ?? []), { index, citation }]);
    }
  });
  for (const entries of buckets.values()) {
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        if (entries[i].index !== entries[j].index && rangesOverlap(entries[i].citation, entries[j].citation)) join(entries[i].index, entries[j].index);
      }
    }
  }
  const groups = new Map();
  rows.forEach((row, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), row]);
  });
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, members]) => members);
}
