/**
 * `<out>/chapters/<id>.md`, the free chapter written next to a /3 entry
 * (openspec change handbook-free-chapter): where it is, and the check of the
 * file against the project. A missing file is "chapter missing".
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkChapter } from './chapter-check.mjs';
import { adviceWordsOf } from './word-lists.mjs';
import { loadUi } from './ui.mjs';

export const chapterPath = (id) => `chapters/${id}.md`;

/** `{ problems, items, counts }` of the chapter of feature `id`; `ctx` as checkChapter takes it, with `adviceWords` read from the run's table. */
export function checkChapterFile(outDir, id, { files, memberDirs, languageCheck }) {
  const path = join(outDir, chapterPath(id));
  if (!existsSync(path)) {
    return { problems: [`${chapterPath(id)}: chapter missing; a /3 entry is written with its chapter at ${chapterPath(id)}`], notes: [], noteLines: [], items: [], counts: null };
  }
  const ui = loadUi(outDir);
  if (!ui.ok) return { problems: ui.lines, notes: [], noteLines: [], items: [], counts: null };
  const result = checkChapter(readFileSync(path, 'utf-8'), { files, memberDirs, languageCheck, adviceWords: adviceWordsOf(ui.strings) });
  return { ...result, problems: result.problems.map((line) => `${chapterPath(id)} ${line}`) };
}
