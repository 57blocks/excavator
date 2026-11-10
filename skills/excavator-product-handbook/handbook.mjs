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
 *   outline-facts <out> --project <root>
 *       Print every block the outline can place, one line each: id, block or
 *       list, the views that have it, and its default title in the run's fixed text.
 *   check-outline <out> --project <root>
 *       Check <out>/outline.json, the parts and chapters of the handbook: the
 *       shape, the language (the map's), every block placed once or left out
 *       with a reason, and the reader text of the titles and reasons.
 *   outline-facts <out> --project <root>
      Print every block the outline can place, one line each, tab separated:
      the id, block or list, technical or both views, and the default title in
      the run's fixed text. Needs the map to pass check-map. Changes no file.
  check-outline <out> --project <root>
      Check <out>/outline.json against the project and the map: the shape, the
      language (the map's), every block placed in exactly one chapter or left
      out in "unplaced" with a reason (each block missing, placed twice or
      unknown is named; a list is written as "list", a block as "block"), no
      part without chapters, and for each title and reason the banned-words
      and narrative-language checks a domain name gets. Prints every problem;
      exits 1 when there is one. Changes no file.
  select <out> --features <list> --project <root>
 *       Resolve a --features list of ids or feature names to ids against the
 *       checked map; exit 1 and list every id and name when an item does not
 *       match exactly one feature. Changes no file.
 *   select <out> --applications <list> --project <root>
 *       Resolve a list of application root directories to the unit ids
 *       app<n>.system; exit 1 and list every root when an item is not one.
 *   applications <projectRoot>
 *       Print the application roots of the project: the topmost directories
 *       that hold a build manifest, found with the candidate lister's walk.
 *   names <projectRoot>
 *       Print the system name candidates the code and the configuration write
 *       (a web manifest, an HTML title, a package, module or build file), each
 *       with its source, file and line, found in the application roots only.
 *   data <projectRoot> <out>
 *       Write <out>/data.json (the tables of the project, its migrations and
 *       where each table name appears) and <out>/dictionaries.json (the value
 *       sets: Go named types with their constants, TypeScript enums, JavaScript
 *       state objects, each member with its comment and display name), from the
 *       source alone; print one count line for each (Data:, Dictionaries:).
 *   history <out> --project <root>
 *       Write <out>/entries/history.json (the code health: commits per year,
 *       the first and last commit, commits and authors of each application, the
 *       files that change most, the files changed together across applications,
 *       the source and test files of each application) from git and the project
 *       files, in memory, writing nothing under the project; print one line.
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
 *   check-findings <out> <featureId>.findings --project <root>
 *       Check <out>/entries/<featureId>.findings.json (the findings of a
 *       feature): the checks of an entry plus the advice-word check; record
 *       the result in state.json under "findings".
 *   try-findings <out> <featureId>.findings --project <root>
 *       The same checks for the findings lane itself; records nothing.
 *   system-seeds <out> app<n> --project <root>
 *       Print the seed files of the system findings of the n-th application root
 *       (the order of `applications`), one per line, sorted: the files under the
 *       root with a main or a job candidate, or at least 5 candidates.
 *   check-system-findings <out> app<n> --project <root>
 *       Check <out>/entries/app<n>.system.json: the checks of a findings file plus
 *       a passage in the application and the ownership check; record the result
 *       in state.json under "systemFindings". An application with no seed file is
 *       recorded as verified with no finding.
 *   try-system-findings <out> app<n> --project <root>
 *       The same checks for the lane itself; records nothing.
 *   priority-items <out> --project <root> [--part <n>]
 *       Print the groups of the verified findings a ranking lane ranks, one line
 *       each (group key, category, representative statement, other statements),
 *       or one `Priority:` line when there is nothing to rank (design D3).
 *   check-priority <out> --project <root>
 *       Check the part files of the ranking lanes against those groups and write
 *       <out>/entries/priority.json; record the result under "priority".
 *   priority-judge <out> --project <root>
 *       Write the judge files of a checked ranking and print the paths of the
 *       two verdict files of each part.
 *   priority-verdicts <out> --project <root>
 *       Record the two judges' verdicts: a group has a priority only when both
 *       say follows; the others are recorded unranked with their reasons.
 *   remedy-facts <out> --project <root>
 *       Print the facts a remedies lane may cite, one line each (the verified
 *       groups with level and category, the applications, the shared tables, the
 *       counts), or one `Remedies:` line when there is nothing to write (design D2).
 *   check-remedies <out> --project <root>
 *       Check <out>/entries/remedies.json against those facts; record the result
 *       under "remedies".
 *   remedy-judge <out> --project <root>
 *       Write the judge file of checked remedies and print the paths of the two
 *       verdict files.
 *   remedy-verdicts <out> --project <root>
 *       Record the two judges' verdicts: a paragraph or recommendation is kept
 *       only when both say follows; the others are recorded as dropped.
 *   topic-lanes <out> --project <root>
 *       Print the lanes of the cross-cutting topics that have something to write
 *       (a business domain with a verified entry, and repeated when verified
 *       findings exist), one line each, or one `Topics:` line when there is none.
 *   topic-facts <out> --lane <id> --project <root>
 *       Print the facts a topics lane may cite, one line each (the verified items
 *       of its domain's entries, or the groups of the verified findings), or one
 *       `Topics:` line when there is nothing to write for the lane (design D2).
 *   check-topics <out> [--lane <id>] --project <root>
 *       Check <out>/topics/part-<lane>.json against the facts of its lane; record the
 *       result under "topics". Without --lane, check every lane and merge the rows
 *       into <out>/entries/topics.json.
 *   topic-judge <out> [--lane <id>] --project <root>
 *       Write the judge file of each checked lane and print the paths of the two
 *       verdict files of each.
 *   topic-verdicts <out> [--lane <id>] --project <root>
 *       Record the two judges' verdicts: a row is kept only when both say follows;
 *       the others are recorded as dropped with their reasons.
 *   mark <out> <featureId> dispatched | failed lane <reason>... --project <root>
 *       Record a lane dispatch or a lane that wrote nothing in state.json.
 *       The slices, verdicts, trace, trace-verdicts and mark commands also take
 *       the unit id `overview` for the system overview, `<featureId>.findings`
 *       for the findings of a feature and `app<n>.system` for the system
 *       findings of an application root.
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
 *   sections [<list>]
 *       Validate a --sections list (overview, features, data, history, findings, system-findings, priority, remedies, topics, outline; default all) and print
 *       SECTIONS=<list>, one READ=<file> line per phase file the run reads,
 *       in reading order, the shared map file once, and an AFTER_TRACE=<file> line
 *       for a section whose phase runs after the trace (priority, remedies, topics, outline); exit 1 for a
 *       value that is not a section. Reads and changes no file.
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
 * check-map, check-entry, check-overview, check-findings, check-priority, priority-verdicts, check-remedies, remedy-verdicts, check-topics, topic-verdicts, mark, verdicts and trace-verdicts hold <out>/state.json.lock while they run.
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
import { runData } from './lib/data-run.mjs';
import { checkEntry, tryEntry } from './lib/entry-check.mjs';
import { checkMap } from './lib/check-map.mjs';
import { checkDomains } from './lib/domains-check.mjs';
import { checkOutline, outlineFacts } from './lib/outline.mjs';
import { UsageError } from './lib/errors.mjs';
import { withStateLock } from './lib/lock.mjs';
import { mark } from './lib/mark.mjs';
import { nameCandidates, nameLines } from './lib/name-candidates.mjs';
import { writePage } from './lib/page.mjs';
import { checkPriority } from './lib/priority-check.mjs';
import { priorityItems } from './lib/priority-items.mjs';
import { priorityJudge } from './lib/priority-judge.mjs';
import { priorityVerdicts } from './lib/priority-verdicts.mjs';
import { checkRemedies } from './lib/remedies-check.mjs';
import { remedyFacts } from './lib/remedies-items.mjs';
import { remedyJudge } from './lib/remedies-judge.mjs';
import { remedyVerdicts } from './lib/remedies-verdicts.mjs';
import { checkTopics } from './lib/topics-check.mjs';
import { topicFacts, topicLanes } from './lib/topics-items.mjs';
import { topicJudge } from './lib/topics-judge.mjs';
import { topicVerdicts } from './lib/topics-verdicts.mjs';
import { projectRootOption } from './lib/project-root.mjs';
import { replyLines } from './lib/reply.mjs';
import { parseSections, sectionLines } from './lib/sections.mjs';
import { selectFeatures } from './lib/select.mjs';
import { selectApplications } from './lib/select-applications.mjs';
import { slices } from './lib/slices.mjs';
import { trace } from './lib/trace.mjs';
import { traceVerdicts } from './lib/trace-verdicts.mjs';
import { checkUi } from './lib/ui.mjs';
import { isFindingsId } from './lib/findings-shape.mjs';
import { systemContext } from './lib/system-unit.mjs';
import { systemUnitIdOf } from './lib/system-shape.mjs';
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
  select <out> --applications <list> --project <root>
      Resolve the --applications list (comma-separated application root
      directories, exactly as applications prints them) to the unit ids
      app<n>.system, one per line, in the order of the roots. An item that is
      not an application root exits 1: print each such item, then every root as
      "app<n>  <dir>", then a Next: line. Changes no file.
  sections [<list>]
      Validate the --sections list (comma-separated: overview, features, data, history, findings, system-findings, priority, remedies, topics, outline; empty
      or absent is all) and print "SECTIONS=<the sections in fixed order>",
      then one "READ=<path>" line per phase file to read, relative to the skill
      directory, in reading order: the stage files first (the map file once),
      then each section's file. The file of a section whose phase runs after the
      trace (priority, remedies, topics, outline) is printed as "AFTER_TRACE=<path>" instead: it is read at
      the end of Phase 6. A value that is not a section exits 1 and the
      allowed values are printed. Reads and changes no file.
  applications <projectRoot>
      Print "Application roots: <n>" and then one line "<dir><TAB><manifests>"
      for each application root: a directory that holds a build manifest
      (package.json, go.mod, pom.xml, build.gradle, build.gradle.kts,
      pyproject.toml, setup.py, requirements.txt, Cargo.toml, composer.json,
      Gemfile, *.csproj, *.sln) with no other such directory between it and the
      project root; the project root itself is ".". It walks the project as the
      candidates command does (same skipped directories, no link followed).
  names <projectRoot>
      Print "Name candidates: <n>" and then one line "<value><TAB><source><TAB>
      <file>:<line><TAB><resolved|unresolved>" for each system name the code or
      the configuration writes, in the application roots (the roots that
      applications prints) and their public directories only, never below and
      never in a document: the name and short_name of manifest.json and
      *.webmanifest (web-manifest-name, web-manifest-short-name), the title of
      each *.html (html-title; a title that refers to a variable as %NAME%,
      \${NAME} or import.meta.env.NAME is listed as written, unresolved, and the
      value of the first definition of the variable in .env, .env.production,
      .env.development of the root is listed at its line there), the productName,
      displayName and name of package.json (package-product-name,
      package-display-name, package-name), the last segment of the module of
      go.mod (go-module), the name and artifactId of the root of pom.xml
      (maven-name, maven-artifact) and the rootProject.name of settings.gradle
      and settings.gradle.kts (gradle-root). An empty value is not listed. Then
      "Files not read: <n>" and one line "<file><TAB><reason>" for each file that
      exists and was not read (a link, over the size cap, a NUL byte, JSON that
      does not parse). Reads the source statically, never builds or runs it.
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
  check-findings <out> <featureId>.findings --project <root>
      Check <out>/entries/<featureId>.findings.json, the findings of a feature
      (each a category from the fixed list, a statement of the defect and when it
      happens, and evidence): the same checks as check-entry (shape, id,
      citations, numbers, banned words, the narrative language), plus the
      advice-word check: the statement may not hold a word of the run's list
      (the fixed text md.findings.adviceWords). Records the result in state.json
      under "findings", by feature id (absent means planned, attempts 0); a file
      with no finding is recorded as verified at once. A failure ends with a
      Next: line. The id is the unit id; the feature must be in map.json.
  try-findings <out> <featureId>.findings --project <root>
      The same checks as check-findings, for the lane to run on its own file
      before it replies. Reads and writes no state.json.
  system-seeds <out> app<n> --project <root>
      Print the seed files of the system findings of the n-th application root
      (n from 1, in the order applications prints the roots), one per line,
      sorted: the files under that root that hold a main or a job candidate, or
      at least 5 candidates of any kind. Prints nothing when there is none. Reads
      candidates.json and the project; changes no file. app<n>.system is accepted
      for app<n> in this command and the two below.
  check-system-findings <out> app<n> --project <root>
      Check <out>/entries/app<n>.system.json, the findings no single feature owns
      in the n-th application root: the same checks as check-findings (shape, id,
      citations, numbers, banned words, the narrative language, advice words)
      plus two: each finding has at least one passage in a file under the
      application root, and a finding whose every cited file is a seed file of
      one and the same feature of the map, and of no one else here, is refused
      with the feature's id. Records the result in state.json under
      "systemFindings", by app<n>, with the application root; a state that
      records another root for it exits 1 and asks for --fresh. A file with no
      finding is verified at once; an application with no seed file has its empty
      file written and is verified at once. A failure ends with a Next: line.
  try-system-findings <out> app<n> --project <root>
      The same checks as check-system-findings, for the lane to run on its own
      file before it replies. Reads and writes no state.json.
  priority-items <out> --project <root> [--part <n>]
      Print the groups of the verified findings a ranking lane ranks, one line
      per group, tab-separated: the group key, the display name of the category,
      the representative statement and the other statements of the group joined
      with " | ". The key holds the unit and the index of the representative and a
      digest of every statement of the group, so a group whose statement or
      members changed is another key. --part <n> prints the groups of part n (at
      most 40 groups a part). When there is nothing to rank (no verified finding,
      a ranking that is current, one waiting for its judges, one that failed
      twice) it prints one line that starts with "Priority:" and no group.
  check-priority <out> --project <root>
      Check <out>/priority/part-<n>.json for each part: exactly one item for each
      group of the part, a consequence of the table (othersRecords, money,
      dataLoss, secret, wrongResult, notification, blocked, display, inert), and a
      reason of one line that passes the reader-text checks and holds no word of
      advice. Writes <out>/entries/priority.json (the parts merged, in group
      order) and records "priority" as checked; a failure records it failed and
      ends with a Next: line naming the parts to rank again.
  priority-judge <out> --project <root>
      For a checked ranking, write <out>/priority/judge/part-<n>.json (the
      statements, the consequence with its meaning and the reason of each group)
      and print, for each part, the judge file and the two verdict files.
  priority-verdicts <out> --project <root>
      Record the verdicts of the two judges of each part: one per group, follows or
      doesNotFollow, with a one-line reason. A group has a priority when both say
      follows; any other group is recorded unranked with the reasons of the
      judges that said doesNotFollow, and "priority" is verified. Nothing is
      recorded when a file does not hold.
  remedy-facts <out> --project <root>
      Print the facts a remedies lane may cite, one line each, tab-separated, the
      first field the id a paragraph cites: a group of the verified findings (key,
      level or unranked, category, representative statement), an application
      (app:<dir>, name, main language, source files, lines, commits, authors; "-"
      without a version history), tables-shared (the number of tables that two or
      more applications mention, then each table with those applications) and
      counts (groups, groups of each level, groups of each category). When there
      is nothing to write (no verified finding, remedies that are current, ones
      waiting for their judges, ones that failed twice) it prints one line that
      starts with "Remedies:" and no fact.
  check-remedies <out> --project <root>
      Check <out>/entries/remedies.json: a paragraph for each category at most
      once and only for a category with a verified group, a paragraph of a category
      citing only groups of that category, 1 to 10 recommendations, every cited id
      a fact of remedy-facts, the reader-text checks (the advice words are
      allowed) and every number of a text occurring in the facts it cites. Records
      "remedies" as checked; a failure records it failed and ends with a Next: line.
  remedy-judge <out> --project <root>
      For checked remedies, write <out>/remedies/judge.json (each paragraph with
      what it cites) and print the judge file and the two verdict files.
  remedy-verdicts <out> --project <root>
      Record the verdicts of the two judges: one per paragraph or recommendation,
      follows or doesNotFollow, with a one-line reason. A paragraph is kept when
      both say follows; any other is recorded as dropped with the reasons of the
      judges that said doesNotFollow, and "remedies" is verified. Nothing is
      recorded when a file does not hold.
  topic-lanes <out> --project <root>
      Print the lanes of the cross-cutting topics that have something to write, one
      line each, tab-separated: the lane id (a business domain id, or an area id
      when the handbook groups by area, that has at least one verified entry;
      repeated when verified groups of findings exist), the name of its domain (-
      for repeated), the number of facts and the status of the lane for the facts
      as they are now (planned, dispatched, checked, verified or failed). With no
      lane it prints one line that starts with "Topics:".
  topic-facts <out> --lane <id> --project <root>
      Print the facts a topics lane may cite, one line each, tab-separated, the
      first field the id a row cites. A domain lane: <featureId>#<item path>, the
      feature name, the kind (who, sentence, state, automatic, notification) and the
      text of each verified item of its domain's entries. The repeated lane: a group
      of the verified findings (key, level or unranked, category key, representative
      statement, application directories or -). When there is nothing for the lane
      to write (it is verified, waiting for its judges, or failed twice) it prints
      one line that starts with "Topics:" and no fact.
  check-topics <out> [--lane <id>] --project <root>
      Check <out>/topics/part-<lane>.json: each row's topic is one of approval, time,
      handoffs, access, repeated and its fields are exactly the columns of the
      topic; a domain lane writes only the first four topics and the repeated lane
      only the last; every cited id is a fact of the lane now; a handoff's using
      domain is the lane and its providing domain another domain; an access row
      names a feature of the lane and cites an item of it; reader-text checks
      (no code word, no file name, the run's language, no word of advice) and every
      number of a text occurring in the items it cites. Records the lane in
      "topics" as checked or failed. Without --lane it checks every lane and merges
      the rows of the lanes that hold into <out>/entries/topics.json.
  topic-judge <out> [--lane <id>] --project <root>
      For each checked lane, write <out>/topics/judge/<lane>.json (each row with
      everything it cites) and print the judge file and the two verdict files.
  topic-verdicts <out> [--lane <id>] --project <root>
      Record the verdicts of the two judges of each checked lane: one per row,
      follows or doesNotFollow, with a one-line reason. A row is kept when both say
      follows; any other is recorded as dropped with the reasons of the judges that
      said doesNotFollow, and the lane is verified. Nothing is recorded when a file
      does not hold.
  mark <out> <featureId> dispatched --project <root>
      Count one more dispatch of the feature's lane in state.json. The id may be
      overview: the system overview is a unit like a feature (so it is for
      slices, verdicts, trace and trace-verdicts below), and its state is kept
      under "overview" in state.json (absent means planned, attempts 0). The
      findings of a feature are a unit too, with the id <featureId>.findings,
      and so are the system findings of an application root, app<n>.system, kept
      under "systemFindings". The id priority is the ranking of the findings, kept
      under "priority": a dispatch for groups other than the ones it was recorded
      for starts it over with no attempt. The id remedies is the remedies of the
      findings, kept under "remedies": a dispatch for other facts starts it over.
      The id topics:<lane> is a lane of the cross-cutting topics (topic-lanes
      lists them), kept under "topics" by lane: a dispatch for other facts than the
      lane was recorded for starts it over.
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

/** The findings commands take the unit id of a feature's findings. */
function requireFindingsId(id) {
  if (!isFindingsId(id)) throw new UsageError(`${id} is not the id of a findings unit; use <featureId>.findings`);
}

/** The unit id of the system findings an `app<n>` or `app<n>.system` argument names. */
function requireSystemId(id) {
  const unit = systemUnitIdOf(id);
  if (unit === null) throw new UsageError(`${id} is not the id of a system findings unit; use app<n> (for example app1)`);
  return unit;
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
  'outline-facts'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('outline-facts takes exactly one <out> directory');
    return report(outlineFacts(positionals[0], projectRootOption(options.project)));
  },
  'check-outline'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('check-outline takes exactly one <out> directory');
    return report(checkOutline(positionals[0], projectRootOption(options.project)));
  },
  select(args) {
    const { positionals, options } = parseArgs(args, ['project', 'features', 'applications']);
    if (positionals.length !== 1) throw new UsageError('select takes exactly one <out> directory');
    if (options.features !== undefined && options.applications !== undefined) throw new UsageError('select takes --features <list> or --applications <list>, not both');
    if (options.features === undefined && options.applications === undefined) throw new UsageError('select needs --features <list> or --applications <list>');
    const root = projectRootOption(options.project);
    if (options.applications !== undefined) return report(selectApplications(root, options.applications));
    return report(selectFeatures(positionals[0], root, options.features));
  },
  'system-seeds'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 2) throw new UsageError('system-seeds takes <out> and app<n>');
    const id = requireSystemId(positionals[1]);
    const context = systemContext(resolve(positionals[0]), projectRootOption(options.project), id);
    if (context.stop) return report(context.stop);
    return report({ status: 0, lines: [...context.seeds] });
  },
  'check-system-findings'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 2) throw new UsageError('check-system-findings takes <out> and app<n>');
    const id = requireSystemId(positionals[1]);
    const root = projectRootOption(options.project);
    return withStateLock(positionals[0], () => report(checkEntry(positionals[0], id, root)));
  },
  'try-system-findings'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 2) throw new UsageError('try-system-findings takes <out> and app<n>');
    return report(tryEntry(positionals[0], requireSystemId(positionals[1]), projectRootOption(options.project)));
  },
  applications(args) {
    const { positionals } = parseArgs(args, []);
    if (positionals.length !== 1) throw new UsageError('applications takes exactly one <projectRoot>');
    return report({ status: 0, lines: applicationLines(scanProject(projectRootOption(positionals[0]))) });
  },
  names(args) {
    const { positionals } = parseArgs(args, []);
    if (positionals.length !== 1) throw new UsageError('names takes exactly one <projectRoot>');
    return report({ status: 0, lines: nameLines(nameCandidates(scanProject(projectRootOption(positionals[0])))) });
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
  'check-findings'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 2) throw new UsageError('check-findings takes <out> and <featureId>.findings');
    requireFindingsId(positionals[1]);
    const root = projectRootOption(options.project);
    return withStateLock(positionals[0], () => report(checkEntry(positionals[0], positionals[1], root)));
  },
  'try-findings'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 2) throw new UsageError('try-findings takes <out> and <featureId>.findings');
    requireFindingsId(positionals[1]);
    return report(tryEntry(positionals[0], positionals[1], projectRootOption(options.project)));
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
  'priority-items'(args) {
    const { positionals, options } = parseArgs(args, ['project', 'part']);
    if (positionals.length !== 1) throw new UsageError('priority-items takes exactly one <out> directory');
    const part = options.part === undefined ? undefined : /^\d+$/.test(options.part) ? Number(options.part) : 0;
    return report(priorityItems(positionals[0], projectRootOption(options.project), part));
  },
  'check-priority'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('check-priority takes exactly one <out> directory');
    const root = projectRootOption(options.project);
    return withStateLock(positionals[0], () => report(checkPriority(positionals[0], root)));
  },
  'priority-judge'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('priority-judge takes exactly one <out> directory');
    return report(priorityJudge(positionals[0], projectRootOption(options.project)));
  },
  'priority-verdicts'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('priority-verdicts takes exactly one <out> directory');
    const root = projectRootOption(options.project);
    return withStateLock(positionals[0], () => report(priorityVerdicts(positionals[0], root)));
  },
  'remedy-facts'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('remedy-facts takes exactly one <out> directory');
    return report(remedyFacts(positionals[0], projectRootOption(options.project)));
  },
  'check-remedies'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('check-remedies takes exactly one <out> directory');
    const root = projectRootOption(options.project);
    return withStateLock(positionals[0], () => report(checkRemedies(positionals[0], root)));
  },
  'remedy-judge'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('remedy-judge takes exactly one <out> directory');
    return report(remedyJudge(positionals[0], projectRootOption(options.project)));
  },
  'remedy-verdicts'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('remedy-verdicts takes exactly one <out> directory');
    const root = projectRootOption(options.project);
    return withStateLock(positionals[0], () => report(remedyVerdicts(positionals[0], root)));
  },
  'topic-lanes'(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length !== 1) throw new UsageError('topic-lanes takes exactly one <out> directory');
    return report(topicLanes(positionals[0], projectRootOption(options.project)));
  },
  'topic-facts'(args) {
    const { positionals, options } = parseArgs(args, ['project', 'lane']);
    if (positionals.length !== 1) throw new UsageError('topic-facts takes exactly one <out> directory');
    if (options.lane === undefined) throw new UsageError('topic-facts needs --lane <id>; topic-lanes lists the lanes');
    return report(topicFacts(positionals[0], projectRootOption(options.project), options.lane));
  },
  'check-topics'(args) {
    const { positionals, options } = parseArgs(args, ['project', 'lane']);
    if (positionals.length !== 1) throw new UsageError('check-topics takes exactly one <out> directory');
    const root = projectRootOption(options.project);
    return withStateLock(positionals[0], () => report(checkTopics(positionals[0], root, options.lane)));
  },
  'topic-judge'(args) {
    const { positionals, options } = parseArgs(args, ['project', 'lane']);
    if (positionals.length !== 1) throw new UsageError('topic-judge takes exactly one <out> directory');
    return report(topicJudge(positionals[0], projectRootOption(options.project), options.lane));
  },
  'topic-verdicts'(args) {
    const { positionals, options } = parseArgs(args, ['project', 'lane']);
    if (positionals.length !== 1) throw new UsageError('topic-verdicts takes exactly one <out> directory');
    const root = projectRootOption(options.project);
    return withStateLock(positionals[0], () => report(topicVerdicts(positionals[0], root, options.lane)));
  },
  mark(args) {
    const { positionals, options } = parseArgs(args, ['project']);
    if (positionals.length < 3) throw new UsageError('mark takes <out>, <featureId> and dispatched, or failed lane <reason>...');
    const [out, id, event, ...rest] = positionals;
    const root = projectRootOption(options.project);
    return withStateLock(out, () => report(mark(out, id, event, rest, root)));
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
  sections(args) {
    const { positionals } = parseArgs(args, []);
    if (positionals.length > 1) throw new UsageError('sections takes one comma-separated list at most');
    const parsed = parseSections(positionals[0]);
    if (!parsed.ok) return report({ status: 1, lines: parsed.lines });
    return report({ status: 0, lines: sectionLines(parsed.sections) });
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
