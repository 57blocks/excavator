#!/usr/bin/env node
/**
 * prd.mjs — the deterministic half of /excavator-prd (openspec change
 * prd-feature-pipeline). Zero model calls; reads the target project's source
 * statically and never builds or runs it.
 *
 * Subcommands:
 *   entrypoints <projectRoot> [--scope <subdir>]
 *       Print the entrypoint candidates as JSON (design D1).
 *
 * Exit codes: 0 ok; 1 a check failed (every reason printed, one per line);
 * 2 usage or IO error.
 */

import { listEntrypoints } from './lib/entrypoints.mjs';
import { UsageError } from './lib/errors.mjs';

const USAGE = `Usage: node prd.mjs <command> [arguments]

Commands:
  entrypoints <projectRoot> [--scope <subdir>]
      List the entrypoint candidates (routes, pages, jobs, mains) as JSON.

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

const COMMANDS = {
  async entrypoints(args) {
    const { positionals, options } = parseArgs(args, ['scope']);
    if (positionals.length !== 1) throw new UsageError('entrypoints takes exactly one <projectRoot>');
    const result = await listEntrypoints(positionals[0], { scope: options.scope ?? null });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
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
