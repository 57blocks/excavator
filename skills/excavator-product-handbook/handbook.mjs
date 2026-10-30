#!/usr/bin/env node
/**
 * handbook.mjs - the deterministic half of /excavator-product-handbook
 * (openspec change product-handbook-map). Zero model calls; reads the target
 * project's source statically and never builds or runs it.
 *
 * Subcommands:
 *   candidates <projectRoot> [--scope <subdir>]
 *       Print the entrypoint candidates as JSON (design D2).
 *   check-map <out> --project <root>
 *       Check <out>/map.json: shape, candidate conservation, reach and labels,
 *       roles, seed files, citations, values, banned words; create state.json.
 *   select <out> --features <list> --project <root>
 *       Resolve a --features list of ids or feature names to ids against the
 *       checked map; exit 1 and list every id and name when an item does not
 *       match exactly one feature. Changes no file.
 *   check-entry <out> <featureId> --project <root>
 *       Check <out>/entries/<featureId>.json and record the result in state.json.
 *   try-entry <out> <featureId> --project <root>
 *       The same checks for the lane itself; records nothing.
 *   mark <out> <featureId> dispatched | failed lane <reason>... --project <root>
 *       Record a lane dispatch or a lane that wrote nothing in state.json.
 *   check-ui <out>
 *       Check <out>/ui.json against the shipped English table, or copy that
 *       table there when the run's language is English.
 *   assemble <out> --project <root>
 *       Write <out>/handbook.md, byte for byte the same from the same input.
 *   reply <out> --project <root>
 *       Print the lines the run ends with (paths, feature counts by status,
 *       candidate conservation), computed from the checked run.
 *   page <out> --project <root>
 *       Write <out>/handbook.html from the same checked run: one file that
 *       opens from disk, no network, the same bytes from the same input.
 *
 * check-map, check-entry and mark hold <out>/state.json.lock while they run.
 *
 * Exit codes: 0 ok; 1 a check failed (every reason printed, one per line);
 * 2 usage or IO error.
 */

import { resolve } from 'node:path';

import { assemble } from './lib/assemble.mjs';
import { candidatesOutput } from './lib/candidates.mjs';
import { checkEntry, tryEntry } from './lib/entry-check.mjs';
import { checkMap } from './lib/check-map.mjs';
import { UsageError } from './lib/errors.mjs';
import { withStateLock } from './lib/lock.mjs';
import { mark } from './lib/mark.mjs';
import { writePage } from './lib/page.mjs';
import { projectRootOption } from './lib/project-root.mjs';
import { replyLines } from './lib/reply.mjs';
import { selectFeatures } from './lib/select.mjs';
import { checkUi } from './lib/ui.mjs';

const USAGE = `Usage: node handbook.mjs <command> [arguments]

Commands:
  candidates <projectRoot> [--scope <subdir>]
      List the entrypoint candidates (routes, pages, jobs, mains) as JSON on
      standard output; save it as <out>/candidates.json.
  check-map <out> --project <root>
      Check <out>/map.json against <out>/candidates.json and the project: the
      shape, every candidate in exactly one feature or in unassigned, reach and
      labels, roles, seed files, citations, values and banned words. Creates
      <out>/state.json (every feature planned) when the map passes.
  select <out> --features <list> --project <root>
      Resolve the --features list (comma-separated feature ids or feature names;
      a name is equal ignoring case and surrounding spaces) to feature ids
      against the checked map and print the ids, one per line, in map order.
      Every item must match exactly one feature; otherwise print each failing
      item and then every feature as "id  name", end with a Next: line and
      exit 1. No fuzzy matching. Changes no file.
  check-entry <out> <featureId> --project <root>
      Check <out>/entries/<featureId>.json: shape, roles from the map,
      citations, labels, numbers and banned words, and record the result in
      state.json. A failure ends with a Next: line.
  try-entry <out> <featureId> --project <root>
      The same checks as check-entry, for the lane to run on its own file
      before it replies. Reads and writes no state.json: it is not an attempt
      and records no result. Prints "<featureId>: ok" or each problem and a
      Next: line.
  mark <out> <featureId> dispatched --project <root>
      Count one more dispatch of the feature's lane in state.json.
  mark <out> <featureId> failed lane <reason>... --project <root>
      Record the feature's lane as failed without writing its entry, each
      further argument one reason. lane is the only step mark records.
  check-ui <out>
      Run in English with no <out>/ui.json: copy the shipped English table
      there. Otherwise check <out>/ui.json: the same keys as the English table,
      a non-empty string for each, the same {placeholders} in each.
  assemble <out> --project <root>
      Write <out>/handbook.md from the map and the checked entries. Checks the
      map, every checked entry and the fixed-text table again first, and then
      writes nothing if any of them fails. Prints the path.
  page <out> --project <root>
      Write <out>/handbook.html: the same run, checked the same way, as one
      self-contained page (navigation by area, a page per feature, a coverage
      page; light and dark; every fixed text from <out>/ui.json). Removes an
      earlier handbook.html first, so a refused run leaves none. Needs the
      built template: run \`pnpm -r build\` at the plugin root. Prints the path.

  reply <out> --project <root>
      Print the lines a finished run is answered with, in this order: the path
      of handbook.md; "Page: <path>" or "Page: not written"; "Features: <n>"
      with the count of each status; "Failed: <ids>" when a feature failed; the
      candidate conservation line. Checks the run again first; exits 1 with a
      Next: line when handbook.md is missing. Changes no file.

<out> is the run's output directory (candidates.json, map.json, entries/,
state.json, ui.json). --project <root> is the project the run documents; files
are resolved under it. Every command reads the target project statically; none
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
  async candidates(args) {
    const { positionals, options } = parseArgs(args, ['scope']);
    if (positionals.length !== 1) throw new UsageError('candidates takes exactly one <projectRoot>');
    process.stdout.write(`${JSON.stringify(await candidatesOutput(positionals[0], options.scope), null, 2)}\n`);
    return 0;
  },
  'check-map'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('check-map takes exactly one <out> directory');
    const root = projectRootOption(options.project);
    return withStateLock(positionals[0], () => report(checkMap(positionals[0], root)));
  },
  select(args) {
    const { positionals, options } = parseArgs(args, ['project', 'features']);
    if (positionals.length !== 1) throw new UsageError('select takes exactly one <out> directory');
    if (options.features === undefined) throw new UsageError('select needs --features <list>');
    const root = projectRootOption(options.project);
    return report(selectFeatures(positionals[0], root, options.features));
  },
  'check-entry'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 2) throw new UsageError('check-entry takes <out> and <featureId>');
    const root = projectRootOption(options.project);
    return withStateLock(positionals[0], () => report(checkEntry(positionals[0], positionals[1], root)));
  },
  'try-entry'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 2) throw new UsageError('try-entry takes <out> and <featureId>');
    return report(tryEntry(positionals[0], positionals[1], projectRootOption(options.project)));
  },
  mark(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length < 3) throw new UsageError('mark takes <out>, <featureId> and dispatched, or failed lane <reason>...');
    const [out, id, event, ...rest] = positionals;
    projectRootOption(options.project);
    return withStateLock(out, () => report(mark(out, id, event, rest)));
  },
  'check-ui'(args) {
    const { positionals } = parseArgs(args, []);
    if (positionals.length !== 1) throw new UsageError('check-ui takes exactly one <out> directory');
    return report(checkUi(positionals[0]));
  },
  assemble(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('assemble takes exactly one <out> directory');
    return report(assemble(positionals[0], projectRootOption(options.project)));
  },
  reply(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('reply takes exactly one <out> directory');
    return report(replyLines(positionals[0], projectRootOption(options.project)));
  },
  page(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('page takes exactly one <out> directory');
    const root = projectRootOption(options.project);
    return report(writePage(positionals[0], root, { rootAliases: [resolve(options.project)] }));
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
    process.stderr.write(`handbook.mjs: unknown command ${command}\n${USAGE}\n`);
    return 2;
  }
  try {
    return await run(rest);
  } catch (error) {
    // Any other error is an IO failure (unreadable directory, vanished file): exit 2, never 1, which means a check failed.
    const message = error instanceof UsageError ? error.message : `${error?.stack ?? error}`;
    process.stderr.write(`handbook.mjs ${command}: ${message}\n`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
