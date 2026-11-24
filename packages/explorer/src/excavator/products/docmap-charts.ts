/**
 * The files of a unit's evidence (what the node panel matches a file against).
 */

import type { UnitRow } from './docmap';

/** The distinct files of a unit's evidence, in the order they first appear. */
export function unitFiles(row: Pick<UnitRow, 'evidence'>): string[] {
  const files: string[] = [];
  for (const item of row.evidence) if (item.file !== null && !files.includes(item.file)) files.push(item.file);
  return files;
}
