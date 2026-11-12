## Phase 4d: System findings

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The system findings section states the defects in the parts of each application root that no single feature owns: the start-up, the registration of routes, middleware and scheduled jobs, and the code every feature calls. The defects in one feature's own code are written by that feature's findings lane (Phase 4c); the two sections do not overlap, and a script holds them apart. One subagent per application root writes its system findings from the code once the map has passed; the scripts check them with the checks of a finding and two more (a passage in the application, and ownership), and two verifiers and two tracers confirm each finding (Phases 5 and 6, exactly as for a feature, with the id `app<n>.system`, where `<n>` counts the application roots from 1 in the order `applications` prints them). A system findings unit does not depend on an entry or on the findings of a feature. An application may have no finding: the lane writes an empty list, and the script records the unit as verified at once. An application with no seed file has no lane at all.

1. List the units this run covers, `$UNITS`. Without `--applications`, they are every application root: run `applications`, read the number `<N>` on its first line, and take `app1.system` to `app<N>.system`:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" applications "$PROJECT_ROOT"
   ```
   With `--applications`, resolve the list with `select`, with the list as one single-quoted argument exactly as the user gave it:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" select "$OUT" --applications '<the --applications value>' --project "$PROJECT_ROOT"
   ```
   - Exit 0: it prints the unit ids, one per line, in the order of the roots. `$UNITS` is that list.
   - Exit 1: tell the user the lines it printed (each item that is not an application root and every root), and stop: dispatch no lane.
2. List the lanes this run dispatches. `<ids>` is `$UNITS` space-separated. A `state.json` without a `systemFindings` key, as an output directory from before the system findings has, reads as every unit planned with no attempt:
   ```bash
   jq -r --arg ids "<ids>" '($ids | split(" ") | map(select(. != ""))) as $units | (.systemFindings // {}) as $found | $units[] | [., ($found[sub("\\.system$"; "")].status // "planned"), ($found[sub("\\.system$"; "")].attempts // 0)] | @tsv' "$OUT/state.json"
   jq -r '.features[] | [.id, .name, (.seedFiles | join(", "))] | @tsv' "$OUT/map.json"
   ```
   A unit that is `checked`, `confirmed` or `verified` is not written again. A unit that is `dispatched` and has a file (an earlier run stopped after its lane wrote) goes to step 5 first, as if its lane had just returned. Every other unit with `attempts` below 2 gets a lane; one with `attempts` 2 that is not `checked`, `confirmed` or `verified` stays as it is. Before you dispatch a lane again, delete the file its earlier attempt left: `rm -f "$OUT/entries/<id>.json"`. A unit that is `failed` with `attempts` 1 (an earlier run stopped before its second attempt) gets its second attempt as step 5 describes, with the reasons `state.json` kept from the first: `jq -r '.systemFindings["app<n>"].failure.reasons[]' "$OUT/state.json"`. The second command prints each feature with its seed files, for the lane prompt.
3. Find the seed files of each unit that gets a lane:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" system-seeds "$OUT" <id> --project "$PROJECT_ROOT"
   ```
   It prints the seed files, one per line: the files of the application that hold a start-up or a scheduled job, and the files that register at least 5 entrypoints. When it prints nothing, the application has no seed file: dispatch no lane for it. Record it as verified with no finding by running `check-system-findings "$OUT" <id> --project "$PROJECT_ROOT"`, which writes the empty file itself and prints `<id>: verified (0 findings)`, and go on with the next unit. A line that says `state.json` records another application root for the unit exits 1: the source changed since the earlier run. Tell the user the line, as printed, and stop; the run needs `--fresh`. Exit 2: the command could not run. Show its message and stop.
4. Right before you dispatch lanes, record their dispatches. Put the `mark` calls of one batch in one Bash command, one after another, before the message that dispatches the batch, one line per lane:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" mark "$OUT" <id> dispatched --project "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" mark "$OUT" <next id> dispatched --project "$PROJECT_ROOT"
   ```
   Dispatch at most `$CONCURRENCY` lanes in one message so they run concurrently, each an `excavator-handbook-writer` subagent in the foreground with the prompt below, its placeholders filled in from `map.json`, `candidates.json`, the output of `applications` (the root directory `<dir>` of the application) and of `system-seeds`, and `$PLUGIN_ROOT`, `$PROJECT_ROOT`, `$OUT` and `$LANGUAGE` written as their values. Wait for every lane of the message to return before you send the next; never in the background: a run without a terminal stops waiting for background subagents.
5. As each lane returns, check it. Run `check-system-findings` for one lane at a time, as each returns, never two at once:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-system-findings "$OUT" <id> --project "$PROJECT_ROOT"
   ```
   `check-system-findings` records its result in `state.json` itself: `checked`, `verified` when the file holds no finding (there is nothing to prove), or `failed` with the lines it printed as the reasons. A lane that wrote no file fails with `lane-wrote-nothing`.
   - Exit 0: the findings are checked, or verified with none.
   - Exit 1: the file failed its checks. The last line it prints is a `Next:` line. Follow it:
     - `Next: delete <id>'s entry, mark it dispatched and re-dispatch it once with the lines above (attempt 2 of 2)`: delete the file (`rm -f "$OUT/entries/<id>.json"`), mark the dispatch (as in step 4) and re-dispatch the lane once with its prompt followed by this line and then each line `check-system-findings` printed except the `Next:` line: `Your previous attempt failed these checks; fix them and write the file again:`. Check it again when it returns.
     - `Next: <id> stays failed (2 of 2 attempts)`: leave the unit failed, with its file kept for the user to see. Never make a third attempt.
     - A `Next:` line that starts `Next: write ui.json first`: the fixed text of a non-English run is missing or fails `check-ui`, nothing was recorded and this is not an attempt. Stop dispatching, go back to Phase 2, then check this lane again.
   - Exit 2: the command could not run. Show its message and stop.

   Never edit `entries/<id>.json` or `state.json` yourself, and never widen a passage or reword a finding to make it pass. A lane that fails its checks is fixed only by its own second attempt. Statuses and attempts change only through these commands.

   Then tell the user `System findings <id> <n>/<N>: <status>`, where `<n>` counts the units this run has checked (an application with no seed file included), `<N>` is the number of units listed in step 2 and `<status>` is `checked`, `verified` or `failed`, in `$LANGUAGE`.

The lane prompt:

````text
You write the system findings of one application of a product handbook, from the source of the project at $PROJECT_ROOT: the defects in the parts of the application that no single feature owns. Your application: <id>, whose root directory is `<dir>`.

Your scope. Start with these files, the seed files of this application: <seed files, one per line>. They hold the start-up and the scheduled work of the application and the places where many routes or pages are registered. Beyond them, open only the files that **Following out of the seed files** allows, and search the whole project as that paragraph and **Negative statements** ask. Its entrypoints in the seed files: <the candidates of the seed files, one per line: id, kind, file:line, text>. The features of this handbook, each with the seed files its own lane reads, which other lanes write: <id, name and seed files of every feature, one per line>. What you write is the defects in the parts of this application that the features share: start-up and shutdown, the reading of configuration, the registration of routes and middleware (which group of routes carries which middleware), the registration of scheduled jobs, and the shared code that the seed files hand work to (authentication, error handling, the sending of messages, calendar and time zone). A defect that lies only in the code of one feature belongs to that feature's lane: do not write it. A finding cites at least one passage in a file under `<dir>`, and a script refuses a finding whose every cited file is a seed file of one feature and none of them a seed file of this application. Read code only; never run, build or change anything in the project. Never read anything under `.excavator/` and never read a document that an Excavator skill generated (PRD.md, handbook.md, reports, findings, tours); every searched path you open is project source or configuration. Exclude `.excavator`, `.git`, `node_modules`, `vendor`, `dist` and `build` from every search (for example `grep -rn --exclude-dir=.excavator --exclude-dir=node_modules ...`).

Write in `$LANGUAGE`, in plain words for a reader who does not read code.

**What a finding is.** A finding is something the code does today that is wrong, that a reader can reproduce from your words. Examples: the same thing done two ways in two places; a check on one side that the other side lacks; a failure that still answers success; a caller and a callee that do not match; a value written into the code that should come from data. It is not a matter of style or readability, and not a "may" or "might": when you cannot show that the code does it, it is not a finding. Write only the findings you can prove; a feature with no defect has an empty list, never pad it.

**Categories.** Each finding has one category, the root cause, exactly one of these words:
- `authorization`: no check of who owns the record, who is assigned to it or which role acts;
- `error-handling`: an error is swallowed, or a failure answers success;
- `notification`: a notification is not sent, goes to the wrong people or says the wrong thing;
- `consistency`: data becomes inconsistent through a transaction, concurrency, a repeated request or a replay;
- `calculation`: a calculation or a statistic is wrong;
- `hard-coded`: a value written into the code, a placeholder feature, code that cannot be reached;
- `contract`: the caller and the callee do not match: path, method, parameter or field;
- `security`: secrets, injection, transport or infrastructure;
- `display`: a defect of the page's interaction or display;
- `time`: a defect of dates, time zones or calendar rules;
- `other`: none of the above.

Write one JSON file with exactly these keys, and no others. `E` stands for an evidence list, a non-empty array of `{"file": "<path from the project root>", "passage": "<text copied from that file>"}`:

```json
{
  "format": "excavator-product-handbook-findings/1",
  "id": "<id>",
  "findings": [{"category": "<one of the words above>", "text": "<what the code does that is wrong, and in which situation it happens>", "evidence": E}],
  "unknowns": [{"item": "<what the code does not settle>", "searched": "<what you searched>"}]
}
```

Every key is always there: write an empty list when nothing applies (`"findings": []`), never leave a key out and never add one. `unknowns` has no evidence.

**The statement.** `text` says the defect itself and the situation in which it happens, so that a reader can reproduce it: what the reader does or what arrives, and what the code then does. It never says how to change it and never judges it: no "should", "must", "needs to", "better", "fix", "recommend" or "consider"; a script refuses the words of its list and names the one it found. One finding is one defect: two defects are two findings.

**Cite what proves it.** A verifier that sees only one finding and the code around its citations judges it afterwards, and a finding the code shown does not prove is removed from the handbook. So cite the passage that by itself shows the defect. For a missing check, cite the whole piece of code that performs the write or the action, so that the reader sees that no check is in it. For two places that disagree, cite both. For a failure that answers success, cite the failing call and the answer. When no passage proves it, write it in `unknowns`. When the statement uses a word of scope (all, every, never, always, only and the like, in $LANGUAGE), cite the lines that decide when it happens, for example the condition that puts the thing on the page or the assignment; a tracer builds a case for each such word that the code must handle as the statement says. When no passage proves that scope, leave the word out and state only the case the passages show.

**Negative statements.** Before you write that something is never checked, never sent or not done, search the whole project (every module, middleware, interceptors, listeners and their registrations, scheduler registrations, SQL and migration scripts, configuration) for another place that does it. When you cannot settle it, do not write a finding: write it in `unknowns` with what you `searched`.

**Following out of the seed files.** The seed files are where you start, not a fence. When a file you have read hands part of the feature to code in another file, follow it there: find where the imported module, the called function or method, or the constant, validation rule or component it uses is defined (search with `grep -rn`; in a language whose package spans the files of one directory, such as Go, the files beside a seed call each other without an import), and open that file. Open at most 20 files that are not seed files, in all; searches do not count. Open only a file that a file you have read leads to, and never list or walk a directory to see what is in it. When the 20 are spent, open no more: write what is not settled in `unknowns`, and say in `searched`, in plain words, what you did not open.

**Numbers.** Every number in your text must occur as a number in that finding's own passages (the script ignores thousands commas, and underscores between digits in the source); write numbers as Arabic numerals. A number that is not in the passages (a count you made, an ordinal, a date) is not allowed: write the sentence without it, or cite the passage that holds it.

**No code in reader text.** Everything except `evidence` is read by a reader. It contains no identifier with an underscore, no camel-case or mixed-case word, no path that starts with `/`, no file name with a source extension (.go .ts .tsx .js .jsx .java .py .sql .json .yaml .yml), no name followed by `(`, and no name of a member directory of the project. Say it in plain words. Every narrative value (the statements and the unknowns) is written in $LANGUAGE.

**Evidence.** Every finding carries its own evidence. A passage is text copied verbatim from the file, part of a line or whole lines; a script finds it by ignoring differences in white space and line breaks, and it must occur **exactly once** in that file. When a passage occurs more than once, quote a longer one. A file is a path from the project root, inside the project, and never under `.excavator`, `.git`, `node_modules`, `vendor`, `dist` or `build`. A finding may cite several passages; each is checked.

**Check your file before you reply.** Run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" try-system-findings "$OUT" <id> --project "$PROJECT_ROOT"`. It runs the same checks the orchestrator runs on your file and records nothing; when $LANGUAGE has its own script, it also refuses a narrative value that is written only in ASCII letters. Fix the file for every line it prints and run it again until it prints `<id>: ok`, at most 5 runs. A passage reported as not in its file is most often a real line that sits in another file: search for it (`grep -rnF`) and cite the file it is in. A finding whose source you cannot find leaves the file, or goes into `unknowns`; never cut a passage down until it happens to match.

Write only `$OUT/entries/<id>.json`, and nothing else anywhere. Reply with one line: `<id>: written`, and nothing else.
````

---

