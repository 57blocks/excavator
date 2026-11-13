#!/usr/bin/env node
/**
 * handbook.mjs - the deterministic half of /excavator-product-handbook
 * (openspec change handbook-skill-first). Zero model calls; reads the target
 * project's source statically and never builds or runs it.
 *
 * Subcommands: candidates, applications, check-map, select, check-ui, data,
 * history, check, assemble, page, reply, sections, review. Run `handbook.mjs --help`
 * for the arguments of each.
 *
 * check-map and check hold <out>/state.json.lock while they run.
 * In a run whose language is not English, check-map also checks that each
 * narrative text of the map holds a letter of the language when it has its own
 * script; it needs a checked <out>/ui.json for that and refuses without one.
 *
 * Exit codes: 0 ok; 1 a check failed (every reason printed, one per line);
 * 2 usage or IO error.
 */

import { resolve } from 'node:path';

import { assemble } from './lib/assemble.mjs';
import { applicationLines, scanProject } from './lib/applications.mjs';
import { candidatesOutput } from './lib/candidates.mjs';
import { runData } from './lib/data-run.mjs';
import { checkCommand } from './lib/check.mjs';
import { checkMap } from './lib/check-map.mjs';
import { UsageError } from './lib/errors.mjs';
import { withStateLock } from './lib/lock.mjs';
import { writePage } from './lib/page.mjs';
import { projectRootOption } from './lib/project-root.mjs';
import { remediesState } from './lib/remedies-inputs.mjs';
import { replyLines } from './lib/reply.mjs';
import { reviewFacts } from './lib/review-facts.mjs';
import { renderReview } from './lib/review-render.mjs';
import { resetBatch, reviewStatus, reviewSummary, reviewTitles } from './lib/review-status.mjs';
import { pruneReview, reviewClaims } from './lib/review-verify.mjs';
import { parseSections, sectionLines } from './lib/sections.mjs';
import { selectFeatures } from './lib/select.mjs';
import { checkUi } from './lib/ui.mjs';
import { parseViews } from './lib/views.mjs';

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
      not English). Writes no file: state.json is created by check.
  select <out> --features <list> --project <root>
      Resolve the --features list (comma-separated feature ids or feature names;
      a name is equal ignoring case and surrounding spaces) to feature ids
      against the checked map and print the ids, one per line, in map order.
      Every item must match exactly one feature; otherwise print each failing
      item and then every feature as "id  name", end with a Next: line and
      exit 1. No fuzzy matching. Changes no file.
  sections [<list>] [--review]
      Validate the --sections list (comma-separated: system, features, data, history, domains, roles, notifications, topics,
      defects, review, remedies, outline; empty or absent is all but review) and print "SECTIONS=<the sections in fixed order>",
      then one "READ=<path>" line per phase file to read, relative to the skill
      directory, in reading order: the map stage file first, once, then each
      section's file, once (the five cross chapters before review share one). --review adds review; whenever review
      is selected, remedies and outline are selected too. A value that is not a section exits 1 and the
      allowed values are printed. Reads and changes no file.
  applications <projectRoot>
      Print "Application roots: <n>" and then one line "<dir><TAB><manifests>"
      for each application root: a directory that holds a build manifest
      (package.json, go.mod, pom.xml, build.gradle, build.gradle.kts,
      pyproject.toml, setup.py, requirements.txt, Cargo.toml, composer.json,
      Gemfile, *.csproj, *.sln) with no other such directory between it and the
      project root; the project root itself is ".". It walks the project as the
      candidates command does (same skipped directories, no link followed).
  data <projectRoot> <out>
      Write <out>/data.json (the data section; no model writes any of it): the
      tables the migrations leave when replayed in file name order (the up part
      of each migration) plus the tables models and .sql files declare, each with
      where it is declared; the migrations of each application; the tables a
      migration drops; where each table name appears outside the migrations (a
      string that is the whole name, or the name after FROM, JOIN, INTO, UPDATE
      or TABLE), per application; and the gaps (operations whose table name is
      not a literal, migration files without a readable up part, model table
      names that are not literals). Also writes <out>/dictionaries.json: the
      value sets (a Go named type with a string or integer type and the
      constants declared with it, iota computed by Go's rules; a TypeScript enum;
      a JavaScript object assigned to a name that ends in Status, State, Type
      and the like), each member with its value, its place, the comment next to
      it and the display names a mapping table gives it, and the same-named
      sets whose values differ between applications. Reads the source
      statically, never builds or runs it. Prints two count lines.
  history <out> --project <root>
      Write <out>/entries/history.json (the code health section; no model
      writes any of it): the commits of each year (author time in UTC; the total
      counts a commit once, the application columns count it in each application
      it changes); for each application root the first and last commit day, the
      commits without merges, the distinct author emails and the fewest authors
      whose commits make up 80%; the 15 files with the highest commits x lines
      (with the application and the verified features that cite the file); the 10
      pairs of files in different applications changed together most; and the
      source files and test files of each application (a test file follows one
      of the naming conventions the chapter lists). Reads git with read-only
      commands and the project files statically; writes nothing under the
      project. Prints one line. A project in no repository writes noHistory
      with the reason and counts the test files all the same.
  review facts <out> [<batch>]
      The whole-table facts the design-problems writers read: the batches (one per business domain when the domains
      chapter passed, else one per area of the map, b1..bn, then cross), for every feature its operations, the steps of
      each operation, its states and transitions, its server-side steps and its hand-overs counted from its chapter
      with the headings of <out>/ui.json (a section that is not recognized is not counted and is named), and the pairs
      of features whose chapters cite overlapping lines of one file, within a batch and across batches. Writes
      <out>/entries/review-facts.json and prints the facts; a batch name limits the printed pairs to those that touch it.
  review render <out> [<batch>...] --project <root>
      Check the items of <out>/entries/review/<batch>.json against the chapters: fields and values, the features of
      the batch (a cross item: features of 2 or more batches), each citation copied from a chapter of a listed feature,
      two different chapter lines for duplication, contradiction, inconsistency and access, every number in a cited line
      or a fact of a listed feature, and the reader-text rules of the chapters. One line per refusal, exit 1. With
      batches named, only those are checked and nothing is written; with none named, every batch is checked and, when
      all pass, <out>/chapters/review.md is written.
  review claims <out> <batch>
      Print each item of entries/review/<batch>.json (its index from 0, its fields) and, for each citation, the
      chapter lines of the listed features that hold it: the whole input of the verifier of the batch.
  review prune <out> <batch> --project <root>
      Read entries/review/<batch>.verdicts.json ({"verdicts": [{"index", "verdict": supported|unsupported, "reason"}]},
      one verdict for each item, exactly once), remove the unsupported items from the batch file, record them in
      entries/review-removed.json and, when every batch file exists and passes, write chapters/review.md again. The
      first prune keeps the items before pruning in entries/review/<batch>.unpruned.json, which the verdict indexes
      refer to; pruning again with the same verdicts changes nothing.
  review status <out> --project <root>
      One line per batch: "<batch>", a state and the batch name, the state being write (no file, or a file that does
      not pass render; the reasons follow), verify (items to judge), prune (verdicts to apply, or a batch with no
      item) or done (pruned). review reset <out> <batch> deletes a batch's file, verdicts, unpruned copy and removal
      records; review skip <out> <batch> does the same and leaves an empty batch. review titles <out> --project <root>
      lists the items of the non-cross batches (batch, item, dimension, impact, features, title). review summary <out>
      prints "<batch> <name> kept=<n> removed=<m>" for each pruned batch.
  remedies-state <out> --project <root>
      Print STATUS (the recorded status of the remedies chapter or none), ATTEMPTS, FILE (yes or no) and STALE (yes
      when it passed and the digest of defects.md and review.md differs from the one recorded with it, or none was
      recorded and review.md exists).
  check <out> [<chapter>...] [--before cross|review] [--no-record] --project <root>
      The final check of the Markdown chapters under <out>/chapters/ (system.md, <featureId>.md,
      the cross chapters; none named means every .md file there): each citation resolves, each
      fact line cites, paragraphs have at most 4 sentences, a feature chapter has a list or a
      table, mermaid blocks open with a diagram type, no code-shaped words, no advice outside
      remedies.md, and the Open questions and Problems sections. Prints one passed or failed
      line per chapter with its reasons and a Next: line, and records status, attempts and
      reasons in state.json (format /2); a state.json of another format exits 1 and asks for
      --fresh. --no-record prints the same without writing state.json. --before cross checks no
      chapter: it exits 0 when every feature has a passed chapter or one that failed twice;
      --before review checks no chapter either and holds the same rule, and also needs a map.
      Never changes a chapter.
  check-ui <out> [--language <name>] [--keep <file>]
      Run in English with no <out>/ui.json: copy the shipped English table
      there. Otherwise check <out>/ui.json: the same keys as the English table,
      a non-empty string for each, the same {placeholders} in each. The run's
      language is --language (the fixed text is written before the map), or
      map.json's language when the option is not given. --keep <file> first copies
      into <out>/ui.json every value of a previous table (<file>) for a key of the
      English table (a non-empty string; other keys are ignored), prints
      "ui.json: kept <n> values from <file>", then checks as above; a file that is
      missing or unreadable exits 1.
  assemble <out> --project <root> [--views <list>]
      Write the handbook of each selected view from the Markdown chapters
      under <out>/chapters/: <out>/handbook.md for the product view (every
      citation removed, the sentence punctuation kept) and
      <out>/handbook-technical.md for the technical view (chapters as written);
      the file of a view that is not selected is removed. --views is product,
      technical or both separated by a comma (default product). Every chapter
      must have a record in state.json (format /2) of its present bytes, or the
      command exits 1 and writes nothing. Chapters follow outline.json (format
      excavator-product-handbook-outline/2) when it holds every chapter,
      data, dictionaries and history block exactly once, else the default order
      (each break is printed as a line starting "Outline: "). Each chapter
      starts with the fixed not-verified sentence (and the not-passed sentence
      when it failed twice); the data and the status dictionary (technical view)
      and the code health are rendered from their files; the coverage section
      is last. Prints the Outline: lines, then the paths.
  page <out> --project <root> [--views <list>]
      Write <out>/handbook.html: the same run, checked the same way, as one
      self-contained page (a home page with the map of the domains and their
      hand-overs from a checked domains.json, else the outline's parts; a page per
      domain and per chapter, search, a switch between the views when both are
      selected, the data, status dictionary and code health pages, a coverage page;
      light and dark; every fixed text from <out>/ui.json). Removes an earlier handbook.html
      first, so a refused run leaves none. Needs the built template: run
      \`pnpm -r build\` at the plugin root. Prints the path.
  reply <out> --project <root> [--views <list>]
      Print the lines a finished run is answered with, in this order: the path
      of each handbook file of the selected views ("Handbook: <path>" for the
      product view, "Technical handbook: <path>" for the technical view);
      "Page: <path>" or "Page: not written"; "Chapters: <total> (passed <p>,
      failed <f>, not written <n>)" over the system chapter, every map feature
      and the six chapters across the features; "Failed: <names>" when one
      failed; "Not written: <feature ids>" when a feature has no chapter; the
      candidate conservation line. Refuses what assemble refuses; exits 1 with
      a Next: line when a handbook file is missing. Changes no file.

<out> is the run's output directory (candidates.json, map.json, chapters/,
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
  select(args) {
    const { positionals, options } = parseArgs(args, ['project', 'features']);
    if (positionals.length !== 1) throw new UsageError('select takes exactly one <out> directory');
    if (options.features === undefined) throw new UsageError('select needs --features <list>');
    return report(selectFeatures(positionals[0], projectRootOption(options.project), options.features));
  },
  applications(args) {
    const { positionals } = parseArgs(args, []);
    if (positionals.length !== 1) throw new UsageError('applications takes exactly one <projectRoot>');
    return report({ status: 0, lines: applicationLines(scanProject(projectRootOption(positionals[0]))) });
  },
  data(args) {
    const { positionals } = parseArgs(args, []);
    if (positionals.length !== 2) throw new UsageError('data takes <projectRoot> and <out>');
    return report(runData(projectRootOption(positionals[0]), resolve(positionals[1])));
  },
  async history(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('history takes exactly one <out> directory');
    // Loaded on demand: the git and hotspot modules are heavy and only this command needs them.
    const { runHistory } = await import('./lib/history-run.mjs');
    return report(await runHistory(projectRootOption(options.project), resolve(positionals[0])));
  },
  check(args) {
    const record = !args.includes('--no-record');
    const { positionals, options } = parseArgs(args.filter((arg) => arg !== '--no-record'), ['project', 'before']);
    if (positionals.length < 1) throw new UsageError('check takes <out> and optionally chapter names');
    return report(checkCommand(positionals[0], positionals.slice(1), projectRootOption(options.project), { before: options.before, record }));
  },
  review(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    const [sub, out, ...rest] = positionals;
    if (!['facts', 'render', 'claims', 'prune', 'status', 'reset', 'skip', 'titles', 'summary'].includes(sub)) throw new UsageError('review takes facts, render, claims, prune, status, reset, skip, titles or summary, then <out>');
    if (out === undefined) throw new UsageError(`review ${sub} takes an <out> directory`);
    if (sub === 'facts') {
      if (rest.length > 1) throw new UsageError('review facts takes <out> and at most one batch');
      return report(reviewFacts(resolve(out), rest[0]));
    }
    if (sub === 'status') return report(reviewStatus(resolve(out), projectRootOption(options.project)));
    if (sub === 'titles') return report(reviewTitles(resolve(out), projectRootOption(options.project)));
    if (sub === 'summary') return report(reviewSummary(resolve(out)));
    if (sub === 'reset' || sub === 'skip') {
      if (rest.length !== 1) throw new UsageError(`review ${sub} takes <out> and one batch`);
      return report(resetBatch(resolve(out), rest[0], { empty: sub === 'skip' }));
    }
    if (sub === 'claims' || sub === 'prune') {
      if (rest.length !== 1) throw new UsageError(`review ${sub} takes <out> and one batch`);
      return report(sub === 'claims' ? reviewClaims(resolve(out), rest[0]) : pruneReview(resolve(out), projectRootOption(options.project), rest[0]));
    }
    return report(renderReview(resolve(out), projectRootOption(options.project), rest));
  },
  'remedies-state'(args) {
    const { positionals } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('remedies-state takes exactly one <out> directory');
    return report(remediesState(resolve(positionals[0])));
  },
  sections(args) {
    const review = args.includes('--review');
    const { positionals } = parseArgs(args.filter((arg) => arg !== '--review'), []);
    if (positionals.length > 1) throw new UsageError('sections takes one comma-separated list at most');
    const parsed = parseSections(positionals[0], { review });
    if (!parsed.ok) return report({ status: 1, lines: parsed.lines });
    return report({ status: 0, lines: sectionLines(parsed.sections) });
  },
  'check-ui'(args) {
    const { positionals, options } = parseArgs(args, ['language', 'keep']);
    if (positionals.length !== 1) throw new UsageError('check-ui takes exactly one <out> directory');
    return report(checkUi(positionals[0], options.language, options.keep === undefined ? undefined : resolve(options.keep)));
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
