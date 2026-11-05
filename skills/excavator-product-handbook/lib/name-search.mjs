/**
 * The literal search for external-system names (openspec change
 * handbook-entities-and-views, design D2). It looks in the files the scan of
 * the project lists (applications.mjs `scanProject`: the candidate lister's
 * walk and skip rules, only source languages, no test file, nothing over the
 * size cap), skips a file with a NUL byte as the counts of the system facts
 * do, and matches the name as it is written: case sensitive, a comment counts.
 * It says only that the name occurs; it does not say the file calls anything.
 */

import { readFileSync } from 'node:fs';

/** `Map<name, string[]>`: for each distinct name, the project-relative files whose text holds it, in the scan's file order. Reads each file once. */
export function filesNaming(scan, names) {
  const wanted = [...new Set(names)];
  const found = new Map(wanted.map((name) => [name, []]));
  if (wanted.length === 0) return found;
  for (const file of scan.sourceFiles) {
    let bytes;
    try {
      bytes = readFileSync(file.abs);
    } catch {
      continue;
    }
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf-8');
    for (const name of wanted) if (text.includes(name)) found.get(name).push(file.rel);
  }
  return found;
}
