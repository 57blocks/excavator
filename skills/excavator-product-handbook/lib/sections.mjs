/**
 * `--sections` (openspec change handbook-sections, design D2): which sections
 * of the handbook a run writes, and which phase files the run reads for them.
 * The dependency table is here, not in the model: a section lists its own
 * file and the stage files it needs, and a later section is one more row.
 * Not recorded in state.json: like `--views`, it decides only what this run
 * does, so a run resumed with other sections skips the units already done.
 */

/**
 * Sections in run order (openspec change handbook-skill-first). `file` is relative to the skill directory; `stages` are shared phase
 * files read first, once. Several sections can share one file: the five cross chapters before the design problems are written from `sections/cross.md`, read once,
 * at the place of the first of them that the run selects. `review` and `remedies` each have a file of their own. Every row is read in order; nothing waits for a later trace.
 */
const MAP = Object.freeze(['stages/map.md']);
const CROSS = 'sections/cross.md';
const CROSS_PROMPT = 'stages/cross-prompt.md';
const WITH_PROMPT = Object.freeze([...MAP, CROSS_PROMPT]);
const TABLE = Object.freeze([
  Object.freeze({ id: 'system', stages: MAP, file: 'sections/system.md' }),
  Object.freeze({ id: 'features', stages: MAP, file: 'sections/features.md' }),
  Object.freeze({ id: 'data', stages: Object.freeze([]), file: 'sections/data.md' }),
  Object.freeze({ id: 'history', stages: Object.freeze([]), file: 'sections/history.md' }),
  Object.freeze({ id: 'domains', stages: WITH_PROMPT, file: CROSS }),
  Object.freeze({ id: 'roles', stages: WITH_PROMPT, file: CROSS }),
  Object.freeze({ id: 'notifications', stages: WITH_PROMPT, file: CROSS }),
  Object.freeze({ id: 'topics', stages: WITH_PROMPT, file: CROSS }),
  Object.freeze({ id: 'defects', stages: WITH_PROMPT, file: CROSS }),
  Object.freeze({ id: 'review', stages: MAP, file: 'sections/review.md' }),
  Object.freeze({ id: 'remedies', stages: WITH_PROMPT, file: 'sections/remedies.md' }),
  Object.freeze({ id: 'outline', stages: MAP, file: 'stages/outline.md' }),
]);

export const SECTIONS = Object.freeze(TABLE.map((row) => row.id));
/** `review` is optional (openspec change handbook-design-review, D1): it costs more than the rest and is one more layer of judgment, so it is not in the default. */
export const OPTIONAL_SECTIONS = Object.freeze(['review']);
export const DEFAULT_SECTIONS = Object.freeze(SECTIONS.filter((id) => !OPTIONAL_SECTIONS.includes(id)));
/** What a run that writes `review` writes with it: the remedies cover it and the outline places it. */
const WITH_REVIEW = Object.freeze(['remedies', 'outline']);

/**
 * `{ ok: true, sections }` with the sections in the fixed order, or
 * `{ ok: false, lines }` naming the value that is not a section and the
 * allowed ones. `text` undefined or blank is the default sections (every one but
 * `review`); `review: true` (the `--review` option) adds `review` to them, and
 * whenever `review` is selected `remedies` and `outline` are selected too.
 */
export function parseSections(text, { review = false } = {}) {
  const blank = text === undefined || String(text).trim() === '';
  const parts = blank ? [...DEFAULT_SECTIONS] : String(text).split(',').map((part) => part.trim());
  const bad = parts.filter((part) => !SECTIONS.includes(part));
  if (bad.length > 0) {
    return {
      ok: false,
      lines: [
        `--sections: ${bad.map((part) => JSON.stringify(part)).join(', ')} is not a section`,
        `--sections takes ${SECTIONS.join(', ')}, any of them separated by a comma (default: all but review; --review adds review)`,
      ],
    };
  }
  const chosen = new Set(parts);
  if (review) chosen.add('review');
  if (chosen.has('review')) for (const id of WITH_REVIEW) chosen.add(id);
  return { ok: true, sections: SECTIONS.filter((section) => chosen.has(section)) };
}

/** The files to read for the sections (already in the fixed order): the stage files first, each once, then the section files, each once, at its first place. */
export function readPlan(sections) {
  const rows = TABLE.filter((row) => sections.includes(row.id));
  const stages = [...new Set(rows.flatMap((row) => row.stages))];
  return [...stages, ...new Set(rows.map((row) => row.file))];
}

/** The lines `handbook.mjs sections` prints for a valid list. */
export function sectionLines(sections) {
  return [`SECTIONS=${sections.join(',')}`, ...readPlan(sections).map((file) => `READ=${file}`)];
}
