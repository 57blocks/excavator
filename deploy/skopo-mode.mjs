/**
 * skopo-mode.mjs
 *
 * The pure pieces of the runner's skopo modes (openspec: changes/skopo-extension, design D10).
 * `skopo-plan`, `skopo-create` and `skopo-report` each run one skopo skill in Claude Code under
 * the same isolation as `full`, against the products in `<out>/skopo`, and are judged by
 * `skopo.mjs verdict` rather than by the model's own report. The orchestration that spawns
 * processes lives in run-excavator.mjs next to `full`'s.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { normalizeScope } from '../skills/skopo-create/lib/run-state.mjs';

/** Each skopo mode and the verdict stage that judges it. */
export const SKOPO_MODES = Object.freeze({
  'skopo-plan': 'plan',
  'skopo-create': 'create',
  'skopo-report': 'report',
});

/** The modes a scope applies to; skopo-report reads the scope its run recorded. */
export const SCOPED_MODES = Object.freeze(['skopo-plan', 'skopo-create']);

/** The skills' output directory, inside the runner's output directory. */
export const SKOPO_OUT_SUBDIR = 'skopo';

export const isSkopoMode = (mode) => Object.hasOwn(SKOPO_MODES, mode);

/**
 * EXCAVATOR_SCOPE as the config keeps it: null when unset, otherwise a normalized relative path.
 * Pushes a message onto `errors` when it is given for a mode it does not apply to, or leaves the
 * repository.
 */
export function parseScope(value, mode, errors) {
  if (value === undefined || value === '') return null;
  if (!SCOPED_MODES.includes(mode)) {
    errors.push(`EXCAVATOR_SCOPE applies only to ${SCOPED_MODES.join(' and ')}, not to ${JSON.stringify(mode ?? null)}`);
    return null;
  }
  if (/\s/.test(value)) {
    errors.push('EXCAVATOR_SCOPE must not contain whitespace');
    return null;
  }
  try {
    return normalizeScope(value);
  } catch (err) {
    errors.push(`EXCAVATOR_SCOPE is invalid: ${err.message}`);
    return null;
  }
}

/**
 * The `-p` prompt of a skopo mode. The skill reads its arguments split on whitespace, so a path
 * or scope that holds whitespace is refused rather than passed on split in two.
 */
export function buildSkopoPrompt({ mode, repoPath, outDir, scope, fresh = false }) {
  const parts = [`/excavator:${mode}`, repoPath, '--out', join(outDir, SKOPO_OUT_SUBDIR)];
  if (scope && SCOPED_MODES.includes(mode)) parts.push('--scope', scope);
  if (fresh && SCOPED_MODES.includes(mode)) parts.push('--fresh');
  const spaced = parts.find((part) => /\s/.test(part));
  if (spaced) throw new Error(`a skopo mode cannot pass a path or scope with whitespace: ${JSON.stringify(spaced)}`);
  return parts.join(' ');
}

/** Whether the run must build the facts first: anything but a fresh freshness status. */
export function needsFacts(freshness) {
  return !freshness || freshness.status !== 'fresh';
}

/**
 * Reads a `skopo.mjs verdict` result: exit 0 is a pass; exit 1 lists the problems, one per line,
 * before the closing `verdict <stage>: …` line; any other exit means the verdict could not run.
 */
export function readVerdictResult({ status, stdout = '', stderr = '' }) {
  const lines = stdout.split('\n').filter((line) => line.trim() !== '');
  if (status === 0) return { ok: true, reasons: [] };
  if (status === 1) {
    const reasons = lines.filter((line) => !/^verdict \w+: /.test(line));
    if (reasons.length > 0) return { ok: false, reasons };
    const detail = stderr.trim().split('\n').slice(-3).join(' / ');
    return { ok: false, reasons: [`skopo.mjs verdict failed without naming a problem${detail ? `: ${detail}` : ''}`] };
  }
  const detail = `${stderr}${stdout}`.trim().split('\n').slice(-3).join(' / ');
  return { ok: false, reasons: [`skopo.mjs verdict could not run (exit ${status}): ${detail || 'no output'}`] };
}

/** Runs `skopo.mjs verdict` for a mode's stage and reads its result. */
export function runSkopoVerdict({ pluginDir, outDir, mode, repoRoot, spawnSyncFn = spawnSync }) {
  const script = join(pluginDir, 'skills/skopo-create/skopo.mjs');
  const result = spawnSyncFn(process.execPath, [
    script, 'verdict', join(outDir, SKOPO_OUT_SUBDIR), '--stage', SKOPO_MODES[mode], '--project', repoRoot,
  ], { encoding: 'utf-8' });
  return readVerdictResult({ status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? result.error?.message ?? '' });
}
