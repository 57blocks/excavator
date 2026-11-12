/**
 * The two files of the architecture section (openspec change handbook-architecture-chapter) checked together against the project:
 * `architecture.json` (architecture-check.mjs) and `chapters/architecture.md` (the chapter check, unchanged). Shared by the
 * commands and by the load of a run for the outputs.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ARCHITECTURE_CHAPTER_FILE, ARCHITECTURE_FILE, architectureCountsLine, architectureProblems } from './architecture-check.mjs';
import { countsLine } from './chapter-check.mjs';
import { checkChapterFile } from './chapter-file.mjs';
import { readJson } from './json-file.mjs';

export const ARCHITECTURE_ID = 'architecture';

/**
 * Check both files. Returns `{ problems, notes, noteLines, countsLines, model, chapter, absent }`: `absent` is true when neither file
 * exists, `missing` true when one of them does not; `model` and `chapter` (`{ text, items, notes }`) are set only when there is no problem.
 */
export function checkArchitectureFiles(outDir, { files, memberDirs, languageCheck }) {
  const jsonPath = join(outDir, ARCHITECTURE_FILE);
  const chapterExists = existsSync(join(outDir, ARCHITECTURE_CHAPTER_FILE));
  const read = readJson(jsonPath);
  const absent = read.missing === true && !chapterExists;
  const missing = read.missing === true || !chapterExists;
  if (absent) return { problems: [`architecture: lane-wrote-nothing: ${ARCHITECTURE_FILE} and ${ARCHITECTURE_CHAPTER_FILE} are missing`], notes: [], noteLines: [], countsLines: [], model: null, chapter: null, absent, missing };
  const problems = [];
  let arch = { notes: [], noteLines: [], counts: null, model: null };
  if (read.missing) problems.push(`${ARCHITECTURE_FILE} is missing; write it in ${outDir} next to ${ARCHITECTURE_CHAPTER_FILE}`);
  else if (!read.ok) problems.push(`${ARCHITECTURE_FILE} ${read.reason}`);
  else {
    arch = architectureProblems(read.value, { files, memberDirs, languageCheck });
    problems.push(...arch.problems);
  }
  const chapter = checkChapterFile(outDir, ARCHITECTURE_ID, { files, memberDirs, languageCheck });
  problems.push(...chapter.problems);
  const ok = problems.length === 0;
  return {
    problems,
    notes: [...chapter.notes, ...arch.notes],
    noteLines: [...chapter.noteLines, ...arch.noteLines],
    countsLines: [...(chapter.counts === null ? [] : [countsLine(chapter.counts)]), ...(arch.counts === null ? [] : [architectureCountsLine(arch.counts)])],
    model: ok ? arch.model : null,
    chapter: ok ? { text: readFileSync(join(outDir, ARCHITECTURE_CHAPTER_FILE), 'utf-8'), items: chapter.items, notes: chapter.notes } : null,
    absent,
    missing,
  };
}

/**
 * What the outputs make of the section for a loaded run: `{ status: 'none' }` when no attempt is recorded, `{ status: 'failed' }` when
 * the last attempt failed or the files no longer pass, `{ status: 'missing' }` when it was checked and a file is gone, and
 * `{ status: 'checked', model, chapter }` otherwise. Never a reason to refuse a run.
 */
export function loadArchitecture(outDir, state, ctx) {
  const recorded = state.architecture;
  if (recorded === undefined) return { status: 'none' };
  if (recorded.status !== 'checked') return { status: 'failed' };
  const result = checkArchitectureFiles(outDir, ctx);
  if (result.missing) return { status: 'missing' };
  if (result.problems.length > 0) return { status: 'failed' };
  return { status: 'checked', model: result.model, chapter: result.chapter };
}
