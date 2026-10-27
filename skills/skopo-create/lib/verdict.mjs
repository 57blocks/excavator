/**
 * The deterministic verdict on a skopo run's products, for the runner and for the skills' own
 * last step (openspec change skopo-extension, design D10). It reads files and reruns the vendored
 * lint; it never reads what the model said about its run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { citationProblems, statementKinds } from './citations.mjs';
import { checkSummary, reportPaths } from './report.mjs';
import { outPaths, readRun } from './run-state.mjs';

export const STAGES = Object.freeze(['plan', 'create', 'report']);

const LINT = fileURLToPath(new URL('../checker/lint.mjs', import.meta.url));
const nonEmpty = (path) => existsSync(path) && readFileSync(path, 'utf8').trim() !== '';

function planProblems(out, run, revision) {
  const paths = outPaths(out);
  const problems = [];
  if (run.sourceRevision !== revision) problems.push(`run.json: the run read ${run.sourceRevision}; the source is now ${revision}`);
  if (run.decisions?.stopped) problems.push(`run.json: the run stopped: ${run.decisions.stopped}`);
  if (!run.decisions?.plan) problems.push('run.json: no plan decision is recorded');
  if (!nonEmpty(paths.plan)) problems.push('run/plan.md is missing or empty');
  const reports = existsSync(paths.research) ? readdirSync(paths.research).filter((f) => f.endsWith('.md')) : [];
  if (reports.length === 0) problems.push('run/research/ holds no research report');
  return problems;
}

/** The lint's error lines for the skopository, or the reason it could not run. */
export function lintErrors(skopoDir) {
  const result = spawnSync(process.execPath, [LINT, skopoDir], { encoding: 'utf8' });
  if (result.status === 0) return [];
  const errors = (result.stdout ?? '').split('\n').filter((line) => line.startsWith('error '));
  if (errors.length > 0) return errors.map((line) => `lint: ${line}`);
  return [`lint: exited ${result.status}: ${`${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-3).join(' / ')}`];
}

function createProblems(out, run) {
  const paths = outPaths(out);
  if (!existsSync(join(paths.skopo, 'skopo.json'))) return ['skopo/skopo.json is missing'];
  const problems = [...lintErrors(paths.skopo)];
  if (!existsSync(paths.questions)) problems.push('run/questions.md is missing');
  let kinds = null;
  try {
    kinds = statementKinds(paths.skopo);
  } catch (error) {
    problems.push(`the skopository cannot be read: ${error.message}`);
  }
  if (kinds) {
    for (const [file, label] of [[paths.questions, 'questions.md'], [paths.notes, 'notes.md']]) {
      if (existsSync(file)) problems.push(...citationProblems(readFileSync(file, 'utf8'), kinds, label));
    }
  }
  if (!run.endedAt) problems.push('run.json: the run has no end time; it was not finished');
  return problems;
}

function reportProblems(out) {
  const paths = reportPaths(out);
  return [
    ...checkSummary(out),
    ...(existsSync(paths.markdown) ? [] : ['report/report.md is missing']),
    ...(existsSync(paths.page) ? [] : ['report/report.html is missing']),
  ];
}

/** `{ ok, problems }` for `stage` of the run in `out`, against the current source `revision`. */
export function verdict(out, { stage, revision }) {
  if (!STAGES.includes(stage)) throw new Error(`stage must be one of ${STAGES.join(', ')}, got ${stage}`);
  const run = readRun(out);
  if (!run) return { ok: false, problems: [`${out} holds no skopo run (run/run.json)`] };
  const problems = planProblems(out, run, revision);
  if (stage !== 'plan') problems.push(...createProblems(out, run));
  if (stage === 'report') problems.push(...reportProblems(out));
  return { ok: problems.length === 0, problems };
}
