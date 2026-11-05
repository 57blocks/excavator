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
 *   check-domains <out> --project <root>
 *       Check <out>/domains.json, the business domains the map's features are
 *       grouped into: shape, ids D1, D2, ..., no empty domain, every map feature
 *       in exactly one domain, reader text and narrative language of the names.
 *   select <out> --features <list> --project <root>
 *       Resolve a --features list of ids or feature names to ids against the
 *       checked map; exit 1 and list every id and name when an item does not
 *       match exactly one feature. Changes no file.
 *   applications <projectRoot>
 *       Print the application roots of the project: the topmost directories
 *       that hold a build manifest, found with the candidate lister's walk.
 *   check-overview <out> --project <root>
 *       Check <out>/entries/overview.json (the system overview): the checks of
 *       an entry, no citation of a documentation file, and the applications
 *       against the application roots; record the result in state.json.
 *   try-overview <out> --project <root>
 *       The same checks for the overview lane itself; records nothing.
 *   check-entry <out> <featureId> --project <root>
 *       Check <out>/entries/<featureId>.json and record the result in state.json.
 *   try-entry <out> <featureId> --project <root>
 *       The same checks for the lane itself; records nothing.
 *   mark <out> <featureId> dispatched | failed lane <reason>... --project <root>
 *       Record a lane dispatch or a lane that wrote nothing in state.json.
 *       The slices, verdicts, trace, trace-verdicts and mark commands also take
 *       the unit id `overview` for the system overview.
 *   slices <out> <featureId> --project <root> [--round 2]
 *       Cut a checked entry into the items a verifier judges, each with its
 *       claim and the source around its cited passages (design D14); round 2
 *       covers only the items the one rewrite touched.
 *   verdicts <out> <featureId> --round <r> --project <root>
 *       Record the verifier's verdicts for the round: one per item, nothing
 *       recorded when that does not hold; round 1 removes what is contradicted
 *       and lists the unverified items to rewrite (citations only),
 *       round 2 removes what is still not verified and verifies the feature.
 *   trace <out> <featureId> --project <root>
 *       For a confirmed feature (both verifiers settled it), write the items it
 *       still holds as trace files for two tracers per part that read the whole
 *       project and look only for code that contradicts a claim (design D14).
 *   trace-verdicts <out> <featureId> --project <root>
 *       Record the tracers' verdicts, two files per part: one verdict per item in
 *       each, holds or contradicted, a contradicted one with a position inside
 *       the project; remove the items either tracer contradicted and verify the
 *       feature, nothing recorded when any file does not hold.
 *   check-ui <out> [--language <name>]
 *       Check <out>/ui.json against the shipped English table, or copy that
 *       table there when the run's language is English. The fixed text is
 *       written before the map: the language is --language, else map.json's.
 *   assemble <out> --project <root> [--views <list>]
 *       Write <out>/handbook.md (product view) and/or <out>/handbook-technical.md
 *       (technical view), byte for byte the same from the same input.
 *   reply <out> --project <root> [--views <list>]
 *       Print the lines the run ends with (paths, feature counts by status,
 *       candidate conservation), computed from the checked run.
 *   page <out> --project <root> [--views <list>]
 *       Write <out>/handbook.html from the same checked run: one file that
 *       opens from disk, no network, the same bytes from the same input.
 *
 * check-map, check-entry, check-overview, mark, verdicts and trace-verdicts hold <out>/state.json.lock while they run.
 * In a run whose language is not English, check-map, check-entry, try-entry,
 * assemble and page also check that each narrative text holds a letter of the
 * language when it has its own script (design D12); they need a checked
 * <out>/ui.json for that and refuse without one.
 *
 * Exit codes: 0 ok; 1 a check failed (every reason printed, one per line);
 * 2 usage or IO error.
 */

import { resolve } from 'node:path';

import { assemble } from './lib/assemble.mjs';
import { applicationLines, scanProject } from './lib/applications.mjs';
import { candidatesOutput } from './lib/candidates.mjs';
import { checkEntry, tryEntry } from './lib/entry-check.mjs';
import { checkMap } from './lib/check-map.mjs';
import { checkDomains } from './lib/domains-check.mjs';
import { UsageError } from './lib/errors.mjs';
import { withStateLock } from './lib/lock.mjs';
import { mark } from './lib/mark.mjs';
import { writePage } from './lib/page.mjs';
import { projectRootOption } from './lib/project-root.mjs';
import { replyLines } from './lib/reply.mjs';
import { selectFeatures } from './lib/select.mjs';
import { slices } from './lib/slices.mjs';
import { trace } from './lib/trace.mjs';
import { traceVerdicts } from './lib/trace-verdicts.mjs';
import { checkUi } from './lib/ui.mjs';
import { OVERVIEW_ID } from './lib/overview-shape.mjs';
import { ROUNDS } from './lib/verify-plan.mjs';
import { parseViews } from './lib/views.mjs';
import { verdicts } from './lib/verdicts.mjs';

const USAGE = `Usage: node handbook.mjs <command> [arguments]

Commands:
  candidates <projectRoot> [--scope <subdir>]
      List the entrypoint candidates (routes, pages, jobs, mains) as JSON on
      standard output; save it as <out>/candidates.json.
  check-map <out> --project <root>
      Check <out>/map.json against <out>/candidates.json and the project: the
      shape, every candidate in exactly one feature or in unassigned, reach and
      labels, roles, seed files, citations, values and banned words, and, in a
      language with its own script, that the names and reasons the model wrote
      hold a letter of it (needs a checked <out>/ui.json when the language is
      not English). Creates <out>/state.json (every feature planned) when the
      map passes.
  check-domains <out> --project <root>
      Check <out>/domains.json against the checked map and the project: the
      shape, the language (the map's), ids D1, D2, ... in order without a gap, no
      domain without features, every feature of the map in exactly one domain
      (each feature that is missing, listed twice or not in the map is named),
      and for each domain name the same checks an area name gets: its citations
      and label when it carries evidence, banned words and, in a language with
      its own script, a letter of it. Exit 1 prints every problem, one per line.
      Changes no file. A missing domains.json exits 2.
  select <out> --features <list> --project <root>
      Resolve the --features list (comma-separated feature ids or feature names;
      a name is equal ignoring case and surrounding spaces) to feature ids
      against the checked map and print the ids, one per line, in map order.
      Every item must match exactly one feature; otherwise print each failing
      item and then every feature as "id  name", end with a Next: line and
      exit 1. No fuzzy matching. Changes no file.
  applications <projectRoot>
      Print "Application roots: <n>" and then one line "<dir><TAB><manifests>"
      for each application root: a directory that holds a build manifest
      (package.json, go.mod, pom.xml, build.gradle, build.gradle.kts,
      pyproject.toml, setup.py, requirements.txt, Cargo.toml, composer.json,
      Gemfile, *.csproj, *.sln) with no other such directory between it and the
      project root; the project root itself is ".". It walks the project as the
      candidates command does (same skipped directories, no link followed).
  check-overview <out> --project <root>
      Check <out>/entries/overview.json, the system overview: the same checks
      as check-entry (shape, citations, labels, numbers, banned words, the
      narrative language), plus: a citation may not point to a documentation
      file (.md, .mdx, .txt, .rst, .adoc), the name of an external system must
      occur in its own citations, every application names a directory that
      holds a build manifest, no two name the same directory, every application
      root is covered by at least one application, and every caller of an
      external system is a listed application. Records the result in state.json
      under "overview"; a failure ends with a Next: line.
  try-overview <out> --project <root>
      The same checks as check-overview, for the lane to run on its own file
      before it replies. Reads and writes no state.json.
  check-entry <out> <featureId> --project <root>
      Check <out>/entries/<featureId>.json: shape, roles from the map,
      citations, labels, numbers and banned words, and the narrative language
      (as check-map), and record the result in state.json. A failure ends with
      a Next: line.
  try-entry <out> <featureId> --project <root>
      The same checks as check-entry, for the lane to run on its own file
      before it replies. Reads and writes no state.json: it is not an attempt
      and records no result. Prints "<featureId>: ok" or each problem and a
      Next: line.
  mark <out> <featureId> dispatched --project <root>
      Count one more dispatch of the feature's lane in state.json. The id may be
      overview: the system overview is a unit like a feature (so it is for
      slices, verdicts, trace and trace-verdicts below), and its state is kept
      under "overview" in state.json (absent means planned, attempts 0).
  mark <out> <featureId> failed lane <reason>... --project <root>
      Record the feature's lane as failed without writing its entry, each
      further argument one reason. lane is the only step mark records.
  slices <out> <featureId> --project <root> [--round 2]
      Only for a feature whose entry passed check-entry (state checked). Write
      <out>/verify/round-<r>/<featureId>/part-<n>.json: the items of the entry
      that carry evidence, each with its id (its JSON path), its claim (all its
      reader text with the context to read it) and the source around every cited
      passage (20 lines before and after, numbered, ranges of one file merged),
      cut into parts in item order (at most 25 items and 60000 bytes a part; an
      item over the byte limit alone is a part of its own). Round 1 also saves a
      snapshot of the entry. Round 2 covers only the items listed in
      <out>/rewrite/<featureId>.json and refuses an entry in which an item that
      was not listed differs from the snapshot, or a listed item has another
      claim (only its citations may change), printing each path. Prints, for
      each part, the verify file and the verdict file its verifier must write.
  verdicts <out> <featureId> --round <1|2> --project <root>
      Read <out>/verdicts/round-<r>/<featureId>/part-<n>.json for every part
      ({ "verdicts": [{ "id", "verdict", "reason" }] }): exactly one verdict
      per item of the round, in the file of the part that holds the item, each
      verified, unverified or contradicted, with a one-line reason. Any failure
      prints every problem by part, names the parts to dispatch again, and
      records nothing. Round 1 removes every contradicted item from the entry
      (what hangs on it goes with it) and records it in state.json, and writes
      the unverified items to <out>/rewrite/<featureId>.json (none: the
      feature is confirmed at once, with no rewrite file).
      Round 2 removes the items that are still not verified from the entry
      (what hangs on them goes with them), records them in state.json and
      confirms the feature, the purpose included (it is removed like any
      item); only when every item that carries evidence is removed does it
      fail at step verify. A confirmed feature still has to be traced.
  trace <out> <featureId> --project <root>
      Only for a confirmed feature. Write <out>/trace/<featureId>/part-<n>.json:
      the items of the entry that still carry evidence, each with its id, its
      claim (as the verify files hold it) and the file and line range of each
      cited passage, no code, in entry order, at most 25 items a part. Removes
      the feature's older trace and trace-verdict files first. Prints, for each
      part, the trace file and the two verdict files its two tracers must write.
  trace-verdicts <out> <featureId> --project <root>
      Read <out>/trace-verdicts/<featureId>/part-<n>.a.json and part-<n>.b.json
      for every part ({ "verdicts": [{ "id", "verdict", "reason", "at"? }] }),
      each file on its own: exactly one verdict per item of the part, each
      holds or contradicted, with a one-line reason; a contradicted verdict
      needs at least one at entry { file, line } that names an existing file inside the project (never read outside it)
      and a line of that file, and its reason passes the reader-text gate. Any
      failure prints every problem by part and tracer (part 1b), names the
      part-letters to dispatch again, and records nothing. Otherwise each item
      either tracer contradicted is removed from the entry (what hangs on it
      goes with it) and recorded in state.json with step trace, the reasons of
      the tracers that contradicted it and their at positions, and the feature
      is verified; when no item that carries evidence is left, it fails at
      step trace.
  check-ui <out> [--language <name>]
      Run in English with no <out>/ui.json: copy the shipped English table
      there. Otherwise check <out>/ui.json: the same keys as the English table,
      a non-empty string for each, the same {placeholders} in each. The run's
      language is --language (the fixed text is written before the map), or
      map.json's language when the option is not given.
  assemble <out> --project <root> [--views <list>]
      Write the handbook of each selected view from the map and the checked
      entries: <out>/handbook.md for the product view, <out>/handbook-technical.md
      for the technical view; the file of a view that is not selected is removed.
      --views is product, technical or both separated by a comma (default
      product; any other value exits 1 and prints the two). Each file's first
      section is the system overview (the verified overview with the facts the
      script computes: languages, frameworks, files, lines and git history of
      each application, the counts of the system, the roles of each domain), or
      a line saying where the overview stopped and the domain table. The
      features are grouped by the business domains of <out>/domains.json when it
      passes check-domains, and by the areas of the map, with a fixed text that
      says they are areas drawn by the navigation, when it does not (or is
      missing); a feature's area is shown next to it in the first case. After the
      features come the two cross-cutting tables, the entity sections (the
      domains, the roles and the roles-by-feature matrix, computed from verified
      entries only) and the coverage section. The technical file adds the
      applications (features by where their quoted passages fall), the external
      systems (the callers the quoted code shows, and the applications whose
      source contains the name, kept apart), the applications-by-domain matrix
      and, for each item, the file and lines of its quoted passages. The product
      file holds no citation path. Checks the map, every checked entry and the
      fixed-text table again first, and then writes nothing if any of them
      fails. Prints the paths.
  page <out> --project <root> [--views <list>]
      Write <out>/handbook.html: the same run, checked the same way, as one
      self-contained page (navigation by domain in the product view, by application
      in the technical view, a switch between them when both are selected, a page
      per feature and per entity, the matrices, a coverage page; light and dark;
      every fixed text from <out>/ui.json). Removes an earlier handbook.html
      first, so a refused run leaves none. Needs the built template: run
      \`pnpm -r build\` at the plugin root. Prints the path.

  reply <out> --project <root> [--views <list>]
      Print the lines a finished run is answered with, in this order: the path
      of each handbook file of the selected views ("Handbook: <path>" for the
      product view, "Technical handbook: <path>" for the technical view);
      "Page: <path>" or "Page: not written"; "Features: <n>"
      with the count of each status; "Overview: <status>"; "Failed: <ids>" when a
      feature or the overview failed; the
      candidate conservation line. Checks the run again first; exits 1 with a
      Next: line when a handbook file is missing. Changes no file.

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

/** The round an option names (1 or 2), or 0 when it names neither. */
const roundOption = (text) => (ROUNDS.includes(Number(text)) && /^\d+$/.test(text) ? Number(text) : 0);

/** The views of `--views`, or null when the value is not a view (the lines are printed and the command exits 1). */
function viewsOf(options) {
  const parsed = parseViews(options.views);
  if (!parsed.ok) {
    process.stdout.write(parsed.lines.map((line) => `${line}\n`).join(''));
    return null;
  }
  return parsed.views;
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
  'check-domains'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('check-domains takes exactly one <out> directory');
    return report(checkDomains(positionals[0], projectRootOption(options.project)));
  },
  select(args) {
    const { positionals, options } = parseArgs(args, ['project', 'features']);
    if (positionals.length !== 1) throw new UsageError('select takes exactly one <out> directory');
    if (options.features === undefined) throw new UsageError('select needs --features <list>');
    const root = projectRootOption(options.project);
    return report(selectFeatures(positionals[0], root, options.features));
  },
  applications(args) {
    const { positionals } = parseArgs(args, []);
    if (positionals.length !== 1) throw new UsageError('applications takes exactly one <projectRoot>');
    return report({ status: 0, lines: applicationLines(scanProject(projectRootOption(positionals[0]))) });
  },
  'check-overview'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('check-overview takes exactly one <out> directory');
    const root = projectRootOption(options.project);
    return withStateLock(positionals[0], () => report(checkEntry(positionals[0], OVERVIEW_ID, root)));
  },
  'try-overview'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('try-overview takes exactly one <out> directory');
    return report(tryEntry(positionals[0], OVERVIEW_ID, projectRootOption(options.project)));
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
  slices(args) {
    const { positionals, options } = parseArgs(args, ['project', 'round']);
    if (positionals.length !== 2) throw new UsageError('slices takes <out> and <featureId>');
    const round = options.round === undefined ? 1 : roundOption(options.round);
    if (round === 0) throw new UsageError('slices --round must be 2 (round 1 is the default)');
    const root = projectRootOption(options.project);
    return report(slices(positionals[0], positionals[1], root, round));
  },
  verdicts(args) {
    const { positionals, options } = parseArgs(args, ['project', 'round']);
    if (positionals.length !== 2) throw new UsageError('verdicts takes <out> and <featureId>');
    if (options.round === undefined) throw new UsageError('verdicts needs --round 1 or --round 2');
    const round = roundOption(options.round);
    if (round === 0) throw new UsageError('verdicts --round must be 1 or 2');
    const root = projectRootOption(options.project);
    return withStateLock(positionals[0], () => report(verdicts(positionals[0], positionals[1], root, round)));
  },
  trace(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 2) throw new UsageError('trace takes <out> and <featureId>');
    return report(trace(positionals[0], positionals[1], projectRootOption(options.project)));
  },
  'trace-verdicts'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 2) throw new UsageError('trace-verdicts takes <out> and <featureId>');
    const root = projectRootOption(options.project);
    return withStateLock(positionals[0], () => report(traceVerdicts(positionals[0], positionals[1], root)));
  },
  'check-ui'(args) {
    const { positionals, options } = parseArgs(args, ['language']);
    if (positionals.length !== 1) throw new UsageError('check-ui takes exactly one <out> directory');
    return report(checkUi(positionals[0], options.language));
  },
  assemble(args) {
    const { positionals, options } = parseArgs(args, ['project', 'views']);
    if (positionals.length !== 1) throw new UsageError('assemble takes exactly one <out> directory');
    const views = viewsOf(options);
    if (views === null) return 1;
    return report(assemble(positionals[0], projectRootOption(options.project), { views }));
  },
  reply(args) {
    const { positionals, options } = parseArgs(args, ['project', 'views']);
    if (positionals.length !== 1) throw new UsageError('reply takes exactly one <out> directory');
    const views = viewsOf(options);
    if (views === null) return 1;
    return report(replyLines(positionals[0], projectRootOption(options.project), { views }));
  },
  page(args) {
    const { positionals, options } = parseArgs(args, ['project', 'views']);
    if (positionals.length !== 1) throw new UsageError('page takes exactly one <out> directory');
    const views = viewsOf(options);
    if (views === null) return 1;
    const root = projectRootOption(options.project);
    return report(writePage(positionals[0], root, { rootAliases: [resolve(options.project)], views }));
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
