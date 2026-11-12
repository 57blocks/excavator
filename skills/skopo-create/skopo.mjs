#!/usr/bin/env node
/**
 * skopo.mjs — the deterministic half of /skopo-plan, /skopo-create and /skopo-report (openspec
 * change skopo-extension). Zero model calls; reads the target project only through the vendored
 * checker and the source snapshot, and writes only under <out>.
 *
 * Subcommands:
 *   start <out> --project <root> [--scope <dir>]
 *       Create <out>/run/ for a new run and print its path. Refuses unless <out> is in state none.
 *   status <out> --project <root> [--scope <dir>]
 *       Print one JSON line: the state of <out> (none, foreign, stale, other-scope, started,
 *       planned, created), the current source revision and the facts that decided the state.
 *   fresh <out>
 *       Delete <out> when it is empty or holds a skopo run; refuse any other directory.
 *   verdict <out> --stage plan|create|report --project <root>
 *       Judge the run's products from its files; print each problem, then the verdict.
 *   report-check <out>
 *       Check report/summary.md: title, citations, owned headings.
 *   report-assemble <out>
 *       Write report/report.md from the summary and the run's files.
 *   report-page <out>
 *       Write report/report.html from report/report.md.
 *
 * Exit codes: 0 ok; 1 a check failed (every reason printed, one per line); 2 the command could
 * not run (arguments, missing files).
 */
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveFreshness } from '../excavator/consumer-freshness.mjs';
import { assembleReport, checkSummary, writeReportPage } from './lib/report.mjs';
import { freshOut, RunStateError, runState, startRun } from './lib/run-state.mjs';
import { verdict } from './lib/verdict.mjs';

const PACKAGE = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));
export const PLUGIN = `excavator@${PACKAGE.version}`;

const USAGE = 'usage: skopo.mjs start|status|fresh|verdict|report-check|report-assemble|report-page <out> [--project <root>] [--scope <dir>] [--stage plan|create|report]';

class UsageError extends Error {}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      flags[arg.slice(2)] = value;
      i += 1;
    } else positional.push(arg);
  }
  if (!command) throw new UsageError(USAGE);
  if (positional.length !== 1) throw new UsageError(`${command} needs exactly one output directory`);
  return { command, out: resolve(positional[0]), flags };
}

async function currentRevision(flags) {
  if (!flags.project) throw new UsageError('--project <root> is required');
  const freshness = await resolveFreshness(resolve(flags.project));
  if (!freshness.currentSourceRevision) throw new UsageError(`cannot read the source revision of ${flags.project}: ${freshness.reason}`);
  return freshness.currentSourceRevision;
}

const lines = (list) => list.map((line) => `${line}\n`).join('');

/** Runs one command; returns `{ code, stdout }`. */
export async function run(argv) {
  const { command, out, flags } = parseArgs(argv);
  switch (command) {
    case 'start': {
      const revision = await currentRevision(flags);
      const dir = startRun(out, { projectRoot: resolve(flags.project), revision, scope: flags.scope ?? null, plugin: PLUGIN });
      return { code: 0, stdout: `${dir}\n` };
    }
    case 'status': {
      const revision = await currentRevision(flags);
      return { code: 0, stdout: `${JSON.stringify({ ...runState(out, { revision, scope: flags.scope ?? null }), currentSourceRevision: revision })}\n` };
    }
    case 'fresh':
      return { code: 0, stdout: freshOut(out) ? `removed ${out}\n` : `nothing to remove at ${out}\n` };
    case 'verdict': {
      if (!flags.stage) throw new UsageError('--stage plan|create|report is required');
      const revision = await currentRevision(flags);
      const result = verdict(out, { stage: flags.stage, revision });
      const tail = result.ok ? `verdict ${flags.stage}: ok` : `verdict ${flags.stage}: ${result.problems.length} problems`;
      return { code: result.ok ? 0 : 1, stdout: lines([...result.problems, tail]) };
    }
    case 'report-check': {
      const problems = checkSummary(out);
      return { code: problems.length ? 1 : 0, stdout: lines([...problems, problems.length ? `summary: ${problems.length} problems` : 'summary: ok']) };
    }
    case 'report-assemble':
      try {
        return { code: 0, stdout: `${assembleReport(out)}\n` };
      } catch (error) {
        return { code: 1, stdout: lines(error.message.split('\n')) };
      }
    case 'report-page':
      return { code: 0, stdout: `${writeReportPage(out)}\n` };
    default:
      throw new UsageError(USAGE);
  }
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    const { code, stdout } = await run(process.argv.slice(2));
    process.stdout.write(stdout);
    process.exit(code);
  } catch (error) {
    const known = error instanceof UsageError || error instanceof RunStateError;
    process.stderr.write(`skopo: ${known ? error.message : error.stack ?? error.message}\n`);
    process.exit(2);
  }
}
