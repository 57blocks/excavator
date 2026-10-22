#!/usr/bin/env node
/**
 * prd.mjs — the deterministic half of /excavator-prd (openspec change
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
 *       evidence passage's line back.
 *   aggregate <out> --project <root>
 *       Recompute every feature's status, write findings.json and tables/,
 *       and print the reply's counts as JSON (design D5, D7, D9).
 *   assemble <out> --project <root>
 *       Concatenate the overview, the tables and the written chapters into
 *       <out>/PRD.md, byte for byte the same from the same input (design D7).
 *   mark <out> <featureId> dispatched | failed <step> <reason>... --project <root>
 *       Record a lane dispatch (attempts + 1) or a failure in index.json
 *       (design D4, D6).
 *
 * Exit codes: 0 ok; 1 a check failed (every reason printed, one per line);
 * 2 usage or IO error.
 */

import { listEntrypoints } from './lib/entrypoints.mjs';
import { UsageError } from './lib/errors.mjs';
import { checkIndex } from './lib/index-check.mjs';
import { checkLane } from './lib/lane-check.mjs';
import { aggregate } from './lib/aggregate.mjs';
import { assemble } from './lib/assemble.mjs';
import { mark } from './lib/mark.mjs';
import { projectRootOption } from './lib/project-root.mjs';

const USAGE = `Usage: node prd.mjs <command> [arguments]

Commands:
  entrypoints <projectRoot> [--scope <subdir>]
      List the entrypoint candidates (routes, pages, jobs, mains) as JSON.
  check-index <out> --project <root>
      Check <out>/index.json and write the computed conservation back.
  check-lane <out> <featureId> --project <root>
      Check features/<featureId>.md and findings/<featureId>.json under <out>
      and write each evidence passage's line back.
  aggregate <out> --project <root>
      Recompute every feature's status from the files under <out>, write
      findings.json and tables/*.md, and print the reply's counts as JSON.
  assemble <out> --project <root>
      Write <out>/PRD.md from overview.md, the tables and the written chapters;
      failed features go to the appendix. Prints the path.
  mark <out> <featureId> dispatched --project <root>
      Count one more dispatch of the feature's lane in <out>/index.json.
  mark <out> <featureId> failed <step> <reason>... --project <root>
      Record the feature as failed at <step> (lane, check-lane or verify),
      each further argument one reason.

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
    return report(checkIndex(positionals[0], projectRootOption(options.project)));
  },
  'check-lane'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 2) throw new UsageError('check-lane takes <out> and <featureId>');
    return report(checkLane(positionals[0], positionals[1], projectRootOption(options.project)));
  },
  aggregate(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('aggregate takes exactly one <out> directory');
    const outcome = aggregate(positionals[0], projectRootOption(options.project));
    if (outcome.status !== 0) return report(outcome);
    process.stdout.write(`${JSON.stringify(outcome.result, null, 2)}\n`);
    return 0;
  },
  assemble(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('assemble takes exactly one <out> directory');
    return report(assemble(positionals[0], projectRootOption(options.project)));
  },
  mark(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length < 3) throw new UsageError('mark takes <out>, <featureId> and dispatched, or failed <step> <reason>...');
    const [out, id, event, ...rest] = positionals;
    return report(mark(out, id, event, rest, projectRootOption(options.project)));
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
