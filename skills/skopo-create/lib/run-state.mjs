/**
 * The output directory the three skopo skills share, and the one state it is in (openspec change
 * skopo-extension, design D4). Zero model calls; never reads the target project.
 *
 *   <out>/run/run.json   the run record: the shape the vendored run.mjs reads and extends, plus
 *                        format, projectRoot, sourceRevision and scope
 *   <out>/run/plan.md    the recovery plan (skopo-plan)
 *   <out>/skopo/         the skopository (skopo-create)
 *   <out>/report/        the report (skopo-report)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, normalize, sep } from 'node:path';

export const RUN_FORMAT = 'excavator-skopo/1';

/** Every state an output directory can be in; each directory is in exactly one. */
export const STATES = Object.freeze(['none', 'foreign', 'stale', 'other-scope', 'started', 'planned', 'created']);

export class RunStateError extends Error {}

export function outPaths(out) {
  const run = join(out, 'run');
  return {
    run,
    runJson: join(run, 'run.json'),
    plan: join(run, 'plan.md'),
    research: join(run, 'research'),
    questions: join(run, 'questions.md'),
    notes: join(run, 'notes.md'),
    metrics: join(run, 'metrics.json'),
    skopo: join(out, 'skopo'),
    report: join(out, 'report'),
  };
}

/**
 * A scope as the run records it: null for the whole project, otherwise a relative path inside the
 * project without `.`, `..` or a trailing separator. Throws on an absolute path or one that leaves
 * the project.
 */
export function normalizeScope(scope) {
  if (scope === undefined || scope === null || scope === '' || scope === '.') return null;
  if (isAbsolute(scope)) throw new RunStateError(`scope must be a path relative to the project, got ${scope}`);
  const clean = normalize(scope).split(sep).filter((part) => part !== '' && part !== '.').join('/');
  if (clean === '') return null;
  if (clean.split('/').includes('..')) throw new RunStateError(`scope must stay inside the project, got ${scope}`);
  return clean;
}

const isEmptyDir = (dir) => !existsSync(dir) || (statSync(dir).isDirectory() && readdirSync(dir).length === 0);

/** The run record when it is this format's; null when it is missing, unreadable or another format. */
export function readRun(out) {
  const { runJson } = outPaths(out);
  if (!existsSync(runJson)) return null;
  try {
    const run = JSON.parse(readFileSync(runJson, 'utf8'));
    return run && run.format === RUN_FORMAT ? run : null;
  } catch {
    return null;
  }
}

const nonEmptyFile = (path) => existsSync(path) && statSync(path).isFile() && readFileSync(path, 'utf8').trim() !== '';

/**
 * The state of `out` for a run of `revision` over `scope`, with the facts that decided it.
 * Checked in this order, so each directory lands in exactly one state: none, foreign, stale,
 * other-scope, created, planned, started.
 */
export function runState(out, { revision, scope = null }) {
  if (isEmptyDir(out)) return { state: 'none' };
  const run = readRun(out);
  if (!run) return { state: 'foreign', reason: `${out} is not empty and holds no ${RUN_FORMAT} run/run.json` };
  const paths = outPaths(out);
  const facts = {
    sourceRevision: run.sourceRevision ?? null,
    scope: run.scope ?? null,
    stopped: run.decisions?.stopped ?? null,
    phases: (run.phases ?? []).map((p) => p.name),
    research: existsSync(paths.research) ? readdirSync(paths.research).filter((f) => f.endsWith('.md')).sort() : [],
  };
  if (run.sourceRevision !== revision) {
    return { state: 'stale', reason: `the run read ${run.sourceRevision}; the source is now ${revision}`, ...facts };
  }
  const wanted = normalizeScope(scope);
  if ((run.scope ?? null) !== wanted) {
    return { state: 'other-scope', reason: `the run covers ${run.scope ?? 'the whole project'}, not ${wanted ?? 'the whole project'}`, ...facts };
  }
  if (existsSync(join(paths.skopo, 'skopo.json')) && run.endedAt) return { state: 'created', ...facts };
  if (nonEmptyFile(paths.plan) && run.decisions?.plan) return { state: 'planned', ...facts };
  return { state: 'started', ...facts };
}

/** Creates the run directory of a new run; refuses unless `out` is in state none. Returns the run directory. */
export function startRun(out, { projectRoot, revision, scope = null, plugin, now = new Date() }) {
  if (!revision) throw new RunStateError('start needs the current source revision');
  const { state, reason } = runState(out, { revision, scope });
  if (state !== 'none') throw new RunStateError(`cannot start in ${out}: state is ${state}${reason ? ` (${reason})` : ''}`);
  const paths = outPaths(out);
  for (const dir of [paths.research, join(paths.run, 'lint')]) mkdirSync(dir, { recursive: true });
  const id = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const run = {
    format: RUN_FORMAT,
    runId: id,
    plugin,
    projectRoot,
    sourceRevision: revision,
    scope: normalizeScope(scope),
    workspace: out,
    startedAt: now.toISOString(),
    endedAt: null,
    node: process.version,
    decisions: {},
    phases: [],
    lintPasses: [],
  };
  writeFileSync(paths.runJson, `${JSON.stringify(run, null, 1)}\n`);
  return paths.run;
}

/** Deletes `out` when it is empty or holds this format's run; refuses a foreign directory. Returns whether it removed anything. */
export function freshOut(out) {
  if (isEmptyDir(out)) {
    if (existsSync(out)) rmSync(out, { recursive: true, force: true });
    return false;
  }
  if (!readRun(out)) throw new RunStateError(`refusing to delete ${out}: it is not empty and holds no ${RUN_FORMAT} run/run.json`);
  rmSync(out, { recursive: true, force: true });
  return true;
}
