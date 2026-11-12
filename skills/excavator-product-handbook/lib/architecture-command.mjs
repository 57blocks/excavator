/**
 * check-architecture <out> --project <root> and try-architecture <out> --project <root> (openspec change
 * handbook-architecture-chapter, D1): check `<out>/architecture.json` and `<out>/chapters/architecture.md`. check-architecture
 * records the attempt in state.json under `architecture`: `{ status, attempts, notes }` (a failed one also `reasons`), at most three
 * attempts; try-architecture is the writer's own check, runs the same checks and records nothing. The caller holds the state lock for
 * check-architecture. The checks need the checked map only for the run's language.
 */

import { existsSync } from 'node:fs';

import { ARCHITECTURE_CHAPTER_FILE, ARCHITECTURE_FILE } from './architecture-check.mjs';
import { checkArchitectureFiles } from './architecture-state.mjs';
import { memberDirectories } from './banned-words.mjs';
import { notesLine } from './chapter-check.mjs';
import { UsageError } from './errors.mjs';
import { languageGate } from './language-check.mjs';
import { readMap } from './map-check.mjs';
import { projectFiles } from './project-files.mjs';
import { MAX_ARCHITECTURE_ATTEMPTS, loadState, saveState } from './state.mjs';

const LAST = `Next: architecture stays failed (${MAX_ARCHITECTURE_ATTEMPTS} of ${MAX_ARCHITECTURE_ATTEMPTS} attempts)`;
const again = (next) => `Next: delete the architecture files and re-dispatch it once with the lines above (attempt ${next} of ${MAX_ARCHITECTURE_ATTEMPTS})`;

/** The facts the checks read, or the lines that stop the command. */
function load(outDir, root) {
  if (!existsSync(outDir)) throw new UsageError(`out directory ${outDir} does not exist`);
  const mapRead = readMap(outDir);
  if (!mapRead.ok) return { stop: { status: 1, lines: [mapRead.line] } };
  const gate = languageGate(outDir, mapRead.value);
  if (!gate.ok) return { stop: { status: 1, lines: gate.lines } };
  return { ctx: { files: projectFiles(root), memberDirs: memberDirectories(root), languageCheck: gate.check } };
}

/** Returns { status, lines }. */
export function checkArchitecture(outDir, root) {
  const loaded = load(outDir, root);
  if (loaded.stop) return loaded.stop;
  const stateRead = loadState(outDir);
  if (!stateRead.ok) {
    if (stateRead.missing) throw new UsageError(stateRead.problem);
    return { status: 1, lines: [stateRead.problem] };
  }
  const { state } = stateRead;
  const before = state.architecture;
  if (before?.status === 'failed' && before.attempts >= MAX_ARCHITECTURE_ATTEMPTS) {
    return { status: 1, lines: [`architecture: ${before.attempts} of ${MAX_ARCHITECTURE_ATTEMPTS} attempts failed already; no further attempt is made`, LAST] };
  }
  const attempts = (before?.attempts ?? 0) + 1;
  const result = checkArchitectureFiles(outDir, loaded.ctx);
  if (result.problems.length === 0) {
    state.architecture = { status: 'checked', attempts, notes: result.notes };
    saveState(outDir, state);
    return { status: 0, lines: ['architecture: checked', ...result.countsLines, ...result.noteLines, notesLine(result.notes)] };
  }
  state.architecture = { status: 'failed', attempts, notes: [], reasons: result.problems };
  saveState(outDir, state);
  return { status: 1, lines: [...result.problems, attempts < MAX_ARCHITECTURE_ATTEMPTS ? again(attempts + 1) : LAST] };
}

/** Returns { status, lines }; reads no state and writes none. */
export function tryArchitecture(outDir, root) {
  const loaded = load(outDir, root);
  if (loaded.stop) return loaded.stop;
  const result = checkArchitectureFiles(outDir, loaded.ctx);
  if (result.problems.length > 0) return { status: 1, lines: [...result.problems, `Next: fix each line above in ${ARCHITECTURE_FILE} and ${ARCHITECTURE_CHAPTER_FILE} and run try-architecture again`] };
  return { status: 0, lines: [...result.countsLines, ...result.noteLines, notesLine(result.notes), 'architecture: ok'] };
}
