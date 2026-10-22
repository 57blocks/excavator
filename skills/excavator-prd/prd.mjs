#!/usr/bin/env node
/**
 * prd.mjs — the deterministic half of /excavator-prd (openspec change
 * prd-feature-pipeline). Zero model calls; reads the target project's source
 * statically and never builds or runs it.
 *
 * Subcommands:
 *   entrypoints <projectRoot> [--scope <subdir>]
 *       Print the entrypoint candidates as JSON (design D1).
 *   check-index <out>
 *       Check <out>/index.json: schema, candidate conservation, inferred
 *       candidates and seed files (design D2); write the conservation back.
 *   check-lane <out> <featureId>
 *       Check a feature lane's chapter and findings (design D3); write each
 *       evidence passage's line back.
 *
 * Exit codes: 0 ok; 1 a check failed (every reason printed, one per line);
 * 2 usage or IO error.
 */

import { listEntrypoints } from './lib/entrypoints.mjs';
import { UsageError } from './lib/errors.mjs';
import { checkIndex } from './lib/index-check.mjs';
import { checkLane } from './lib/lane-check.mjs';

const USAGE = `Usage: node prd.mjs <command> [arguments]

Commands:
  entrypoints <projectRoot> [--scope <subdir>]
      List the entrypoint candidates (routes, pages, jobs, mains) as JSON.
  check-index <out>
      Check <out>/index.json and write the computed conservation back.
  check-lane <out> <featureId>
      Check features/<featureId>.md and findings/<featureId>.json under <out>.

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
    const { positionals } = parseArgs(args, []);
    if (positionals.length !== 1) throw new UsageError('check-index takes exactly one <out> directory');
    return report(checkIndex(positionals[0]));
  },
  'check-lane'(args) {
    const { positionals } = parseArgs(args, []);
    if (positionals.length !== 2) throw new UsageError('check-lane takes <out> and <featureId>');
    return report(checkLane(positionals[0], positionals[1]));
  },
};

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    (command === undefined ? process.stderr : process.stdout).write(`${USAGE}\n`);
    return command === undefined ? 2 : 0;
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
