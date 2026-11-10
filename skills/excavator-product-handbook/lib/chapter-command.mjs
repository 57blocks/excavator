/** check-chapter <out> <id>: the checks of a chapter alone, against the checked map and the project; records nothing. */

import { countsLine, notesLine } from './chapter-check.mjs';
import { checkChapterFile, chapterPath } from './chapter-file.mjs';
import { loadForEntry } from './entry-check.mjs';

/** Returns { status, lines }. */
export function checkChapterCommand(outDir, id, root) {
  const loaded = loadForEntry(outDir, id, root);
  if (loaded.stop) return loaded.stop;
  const result = checkChapterFile(outDir, id, loaded);
  if (result.problems.length > 0) return { status: 1, lines: [...result.problems, `Next: fix each line above in ${chapterPath(id)} and run check-chapter again`] };
  return { status: 0, lines: [`${id}: chapter ok`, countsLine(result.counts), ...result.noteLines, notesLine(result.notes)] };
}
