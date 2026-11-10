/**
 * `--sections` (openspec change handbook-sections, design D2): which sections
 * of the handbook a run writes, and which phase files the run reads for them.
 * The dependency table is here, not in the model: a section lists its own
 * file and the stage files it needs, and a later section is one more row.
 * A section whose phase has to run after the trace has `afterTrace`: the table
 * still lists its file, but `handbook.mjs sections` prints it as `AFTER_TRACE=`.
 * Not recorded in state.json: like `--views`, it decides only what this run
 * does, so a run resumed with other sections skips the units already done.
 */

/** Sections in run order. `files` are relative to the skill directory; `stages` are shared phase files read first, once. */
const TABLE = Object.freeze([
  Object.freeze({ id: 'overview', stages: Object.freeze(['stages/map.md']), file: 'sections/overview.md' }),
  Object.freeze({ id: 'features', stages: Object.freeze(['stages/map.md']), file: 'sections/features.md' }),
  Object.freeze({ id: 'data', stages: Object.freeze([]), file: 'sections/data.md' }),
  // The code health (openspec change handbook-history-appendix) is a script section like the data: it reads git and the project files and
  // needs no map, no stage file and no subagent; it is read where the run reaches it, right after the data file.
  Object.freeze({ id: 'history', stages: Object.freeze([]), file: 'sections/history.md' }),
  Object.freeze({ id: 'findings', stages: Object.freeze(['stages/map.md']), file: 'sections/findings.md' }),
  Object.freeze({ id: 'system-findings', stages: Object.freeze(['stages/map.md']), file: 'sections/system-findings.md' }),
  // The ranking of the findings (openspec change handbook-findings-priority) works on the findings the trace left verified, so its
  // phase runs after Phase 6: its file is not a READ= file, it is the AFTER_TRACE= line, and it needs no stage file (it reads no map).
  Object.freeze({ id: 'priority', stages: Object.freeze([]), file: 'sections/priority.md', afterTrace: true }),
  // The causes, measures and recommendations (openspec change handbook-remedies) cite the verified and ranked findings, so they run after
  // the trace and after the ranking: the same AFTER_TRACE= line, printed after the priority one; they need no map and no stage file.
  Object.freeze({ id: 'remedies', stages: Object.freeze([]), file: 'sections/remedies.md', afterTrace: true }),
  // The cross-cutting topics (openspec change handbook-topics) gather the verified entries and findings by a question that crosses features,
  // so they run after the trace and after the remedies: the third AFTER_TRACE= line; they need no map and no stage file.
  Object.freeze({ id: 'topics', stages: Object.freeze([]), file: 'sections/topics.md', afterTrace: true }),
  // The outline (openspec change handbook-outline) places the blocks of the handbook into the parts and chapters of this project, so it runs
  // after everything that writes a block: the fourth AFTER_TRACE= line. It needs the map but no stage file, since the map is already in
  // `$OUT` by then, and its file is a stage file only in name: nothing else reads it.
  Object.freeze({ id: 'outline', stages: Object.freeze([]), file: 'stages/outline.md', afterTrace: true }),
]);

export const SECTIONS = Object.freeze(TABLE.map((row) => row.id));
export const DEFAULT_SECTIONS = SECTIONS;

/**
 * `{ ok: true, sections }` with the sections in the fixed order, or
 * `{ ok: false, lines }` naming the value that is not a section and the
 * allowed ones. `text` undefined or blank is every section.
 */
export function parseSections(text) {
  if (text === undefined || String(text).trim() === '') return { ok: true, sections: [...DEFAULT_SECTIONS] };
  const parts = String(text).split(',').map((part) => part.trim());
  const bad = parts.filter((part) => !SECTIONS.includes(part));
  if (bad.length > 0) {
    return {
      ok: false,
      lines: [
        `--sections: ${bad.map((part) => JSON.stringify(part)).join(', ')} is not a section`,
        `--sections takes ${SECTIONS.join(', ')}, any of them separated by a comma (default: all)`,
      ],
    };
  }
  return { ok: true, sections: SECTIONS.filter((section) => parts.includes(section)) };
}

/** The files to read for the sections (already in the fixed order) when the run reaches them: the stage files first, each once, then the section files; a section that runs after the trace is not here. */
export function readPlan(sections) {
  const rows = TABLE.filter((row) => sections.includes(row.id) && row.afterTrace !== true);
  const stages = [...new Set(rows.flatMap((row) => row.stages))];
  return [...stages, ...rows.map((row) => row.file)];
}

/** The files of the sections that run after the trace (Phase 6), read at the end of Phase 6 and not before. */
export const afterTracePlan = (sections) => TABLE.filter((row) => sections.includes(row.id) && row.afterTrace === true).map((row) => row.file);

/** The lines `handbook.mjs sections` prints for a valid list. */
export function sectionLines(sections) {
  return [`SECTIONS=${sections.join(',')}`, ...readPlan(sections).map((file) => `READ=${file}`), ...afterTracePlan(sections).map((file) => `AFTER_TRACE=${file}`)];
}
