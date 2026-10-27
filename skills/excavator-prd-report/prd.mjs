#!/usr/bin/env node
/**
 * prd.mjs — the deterministic half of /excavator-prd-report (openspec change
 * prd-feature-pipeline). Zero model calls; reads the target project's source
 * statically and never builds or runs it.
 *
 * Subcommands:
 *   entrypoints <projectRoot> [--scope <subdir>]
 *       Print the entrypoint candidates as JSON (design D1).
 *   check-index <out> --project <root>
 *       Check <out>/index.json: schema, candidate conservation, inferred
 *       candidates and seed files (design D2); write the conservation back.
 *   check-lane <out> <featureId> --project <root>
 *       Check a feature lane's chapter and findings (design D3); write each
 *       evidence passage's line back and record the result in index.json.
 *   check-priorities <out> --project <root>
 *       Check every written feature's priorities/<id>.json against its
 *       findings and print the features still to rank in batches (change
 *       prd-report-finding-priority, design D4); writes nothing.
 *   check-open-items <out> --project <root>
 *       List the open items of the written chapters in open-items/sources.json
 *       and check open-items/merged.json, the merge of the items that ask the
 *       same question (change prd-report-dedupe, design D5).
 *   aggregate <out> --project <root>
 *       Recompute every feature's status, write findings.json and tables/,
 *       and print the reply's counts as JSON (design D5, D7, D9).
 *   assemble <out> --project <root>
 *       Concatenate the overview, the tables and the written chapters into
 *       <out>/PRD.md, byte for byte the same from the same input (design D7).
 *   page <out> --project <root>
 *       Write <out>/report.html, the report page: the run's overview, features,
 *       findings and coverage in one file that opens from disk (change
 *       prd-report-page, design D7). Refuses a run whose files disagree.
 *   mark <out> <featureId> dispatched | failed lane <reason>... --project <root>
 *       Record a lane dispatch (attempts + 1) or a lane that wrote nothing
 *       in index.json (design D4, D6).
 *   reply <out> --project <root>
 *       Print the skill's reply lines from the summary aggregate recorded
 *       (design D9); writes nothing.
 *
 * check-index, check-lane, mark and aggregate hold <out>/index.json.lock
 * while they run, so concurrent commands on one run never lose a write.
 *
 * Exit codes: 0 ok; 1 a check failed (every reason printed, one per line);
 * 2 usage or IO error.
 */

import { listEntrypoints } from './lib/entrypoints.mjs';
import { UsageError } from './lib/errors.mjs';
import { checkIndex } from './lib/index-check.mjs';
import { checkLane } from './lib/lane-check.mjs';
import { checkPriorities } from './lib/check-priorities.mjs';
import { checkOpenItems } from './lib/check-open-items.mjs';
import { aggregate } from './lib/aggregate.mjs';
import { assemble } from './lib/assemble.mjs';
import { writePage } from './lib/page.mjs';
import { withIndexLock } from './lib/index-lock.mjs';
import { mark } from './lib/mark.mjs';
import { reply } from './lib/reply.mjs';
import { projectRootOption } from './lib/project-root.mjs';

const USAGE = `Usage: node prd.mjs <command> [arguments]

Commands:
  entrypoints <projectRoot> [--scope <subdir>]
      List the entrypoint candidates (routes, pages, jobs, mains) as JSON.
  check-index <out> --project <root>
      Check <out>/index.json and write the computed conservation back.
  check-lane <out> <featureId> --project <root>
      Check features/<featureId>.md and findings/<featureId>.json under <out>,
      write each evidence passage's line back, and record the result under
      the feature in index.json (a failure with its reasons, or none).
  check-priorities <out> --project <root>
      Check priorities/<id>.json of every written feature against its findings
      (each finding ranked once, P0, P1 or P2, a reason of at most 300
      characters with no advice). Prints one line per feature, the batches of
      the features to rank (at most 120 findings each), and the totals; exit 1
      while a feature is unranked. Writes nothing.
  check-open-items <out> --project <root>
      List the open items of the written chapters, numbered, in
      <out>/open-items/sources.json (the only file it writes), and check
      <out>/open-items/merged.json against them: its digest, every id an open
      item, no id in two groups, no group without an also. Prints one line for
      each problem, then \`Open items: <n> written in the chapters, <m> after
      merging\` or \`..., not merged\`; exit 1 unless the merge passes or there
      are fewer than two items.
  aggregate <out> --project <root>
      Recompute every feature's status from the files under <out>, write
      findings.json and tables/*.md, and print the reply's counts as JSON.
  assemble <out> --project <root>
      Write <out>/PRD.md from overview.md, the tables and the written chapters;
      failed features go to the appendix. Prints the path.
  page <out> --project <root>
      Write <out>/report.html from the run's files: one page, no network, the
      same bytes from the same run. Needs the template that pnpm -r build writes.
      Refuses a run whose index.json, findings.json and feature files disagree
      (run aggregate first) and then writes nothing. Prints the path.
  mark <out> <featureId> dispatched --project <root>
      Count one more dispatch of the feature's lane in <out>/index.json.
  mark <out> <featureId> failed lane <reason>... --project <root>
      Record the feature's lane as failed without writing its files, each
      further argument one reason. lane is the only step mark records.
  reply <out> --project <root>
      Print the reply's lines in English: the PRD path, the counts the last
      aggregate recorded, the features to retry when some failed after one
      attempt, the frameworks without patterns when there are some, and the offer to save the PRD when <out> is the default
      <root>/.excavator/prd-report. Reads only; writes nothing.

check-index, check-lane, mark and aggregate hold <out>/index.json.lock while
they run and wait up to 10 s for another command's lock (exit 2 after that).

<out> is the run's output directory (index.json, features/, findings/,
verification/). --project <root> is required by every command that reads
<out>: the project the run documents. Files are resolved under it, never
under the index's projectRoot, which must name the same directory. Every command reads the target project statically; none
calls a model or builds or runs the project.

Exit codes: 0 ok; 1 a check failed; 2 usage or IO error.`;

/** Split `args` into positionals and `--name value` options; unknown options are a usage error. */
function parseArgs(args, known) {
  const positionals = [];
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (!known.includes(name)) throw new UsageError(`unknown option ${arg}`);
      if (i + 1 >= args.length) throw new UsageError(`option ${arg} needs a value`);
      options[name] = args[i + 1];
      i += 1;
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, options };
}

/** Print a check's lines to stdout and return its exit status. */
function report({ status, lines }) {
  process.stdout.write(lines.map((line) => `${line}\n`).join(''));
  return status;
}

const COMMANDS = {
  async entrypoints(args) {
    const { positionals, options } = parseArgs(args, ['scope']);
    if (positionals.length !== 1) throw new UsageError('entrypoints takes exactly one <projectRoot>');
    const result = await listEntrypoints(positionals[0], { scope: options.scope ?? null });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  },
  'check-index'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('check-index takes exactly one <out> directory');
    const root = projectRootOption(options.project);
    return withIndexLock(positionals[0], () => report(checkIndex(positionals[0], root)));
  },
  'check-lane'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 2) throw new UsageError('check-lane takes <out> and <featureId>');
    const root = projectRootOption(options.project);
    return withIndexLock(positionals[0], () => report(checkLane(positionals[0], positionals[1], root)));
  },
  'check-priorities'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('check-priorities takes exactly one <out> directory');
    return report(checkPriorities(positionals[0], projectRootOption(options.project)));
  },
  'check-open-items'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('check-open-items takes exactly one <out> directory');
    return report(checkOpenItems(positionals[0], projectRootOption(options.project)));
  },
  aggregate(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('aggregate takes exactly one <out> directory');
    const root = projectRootOption(options.project);
    const outcome = withIndexLock(positionals[0], () => aggregate(positionals[0], root));
    if (outcome.status !== 0) return report(outcome);
    process.stdout.write(`${JSON.stringify(outcome.result, null, 2)}\n`);
    return 0;
  },
  assemble(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('assemble takes exactly one <out> directory');
    return report(assemble(positionals[0], projectRootOption(options.project)));
  },
  page(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('page takes exactly one <out> directory');
    return report(writePage(positionals[0], projectRootOption(options.project)));
  },
  mark(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length < 3) throw new UsageError('mark takes <out>, <featureId> and dispatched, or failed lane <reason>...');
    const [out, id, event, ...rest] = positionals;
    const root = projectRootOption(options.project);
    return withIndexLock(out, () => report(mark(out, id, event, rest, root)));
  },
  reply(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('reply takes exactly one <out> directory');
    return report(reply(positionals[0], projectRootOption(options.project)));
  },
};

const HELP = new Set(['--help', '-h', 'help']);

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === undefined) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (HELP.has(command) || rest.some((arg) => arg === '--help' || arg === '-h')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const run = COMMANDS[command];
  if (!run) {
    process.stderr.write(`prd.mjs: unknown command ${command}\n${USAGE}\n`);
    return 2;
  }
  try {
    return await run(rest);
  } catch (error) {
    // Any other error is an IO failure (unreadable directory, vanished file): exit 2, never 1, which means a check failed.
    const message = error instanceof UsageError ? error.message : `${error?.stack ?? error}`;
    process.stderr.write(`prd.mjs ${command}: ${message}\n`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
