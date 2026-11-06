## Phase 4c: Findings

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The findings section states, for each feature, the defects its code shows today: where the code does something that is wrong, with the situation in which it happens and the code that shows it. One subagent per feature writes them from the code once the map has passed; the scripts check them with the checks of an entry and one more, the words of advice, and two verifiers and two tracers confirm each finding (Phases 5 and 6, exactly as for a feature, with the id `<id>.findings` where `<id>` is the feature's id). A findings unit does not depend on the feature's entry: it is written, checked and verified whether or not the entry is, and its verified findings are in the handbook either way. A feature may have no finding: the lane writes an empty list, and the script records the unit as verified at once.

1. List the lanes this run dispatches. `<ids>` is `$SELECTED` space-separated, or empty without `--features`. A `state.json` without a `findings` key, as an output directory from before the findings has, reads as every unit planned with no attempt:
   ```bash
   jq -r --arg ids "<ids>" '($ids | split(" ") | map(select(. != ""))) as $want | (.findings // {}) as $found | .features | to_entries[] | select(($want | length) == 0 or (.key | IN($want[]))) | [(.key + ".findings"), ($found[.key].status // "planned"), ($found[.key].attempts // 0)] | @tsv' "$OUT/state.json"
   jq -r '.features[] | [.id, .reach, .name] | @tsv' "$OUT/map.json"
   ```
   A unit that is `checked`, `confirmed` or `verified` is not written again. A unit that is `dispatched` and has a findings file (an earlier run stopped after its lane wrote) goes to step 3 first, as if its lane had just returned. Every other unit with `attempts` below 2 gets a lane; one with `attempts` 2 that is not `checked`, `confirmed` or `verified` stays as it is. Before you dispatch a lane again, delete the file its earlier attempt left: `rm -f "$OUT/entries/<id>.findings.json"`. A unit that is `failed` with `attempts` 1 (an earlier run stopped before its second attempt) gets its second attempt as step 3 describes, with the reasons `state.json` kept from the first: `jq -r '.findings["<id>"].failure.reasons[]' "$OUT/state.json"`.
2. Right before you dispatch lanes, record their dispatches. Put the `mark` calls of one batch in one Bash command, one after another, before the message that dispatches the batch, one line per lane:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" mark "$OUT" <id>.findings dispatched --project "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" mark "$OUT" <next id>.findings dispatched --project "$PROJECT_ROOT"
   ```
   Dispatch at most `$CONCURRENCY` lanes in one message so they run concurrently, each a subagent in the foreground with the prompt below, its placeholders filled in from `map.json` and `candidates.json` and `$PLUGIN_ROOT`, `$PROJECT_ROOT`, `$OUT` and `$LANGUAGE` written as their values. Wait for every lane of the message to return before you send the next; never in the background: a run without a terminal stops waiting for background subagents.
3. As each lane returns, check it. Run `check-findings` for one lane at a time, as each returns, never two at once:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-findings "$OUT" <id>.findings --project "$PROJECT_ROOT"
   ```
   `check-findings` records its result in `state.json` itself: `checked`, `verified` when the file holds no finding (there is nothing to prove), or `failed` with the lines it printed as the reasons. A lane that wrote no file fails with `lane-wrote-nothing`.
   - Exit 0: the findings are checked, or verified with none.
   - Exit 1: the file failed its checks. The last line it prints is a `Next:` line. Follow it:
     - `Next: delete <id>.findings's entry, mark it dispatched and re-dispatch it once with the lines above (attempt 2 of 2)`: delete the file (`rm -f "$OUT/entries/<id>.findings.json"`), mark the dispatch (as in step 2) and re-dispatch the lane once with its prompt followed by this line and then each line `check-findings` printed except the `Next:` line: `Your previous attempt failed these checks; fix them and write the file again:`. Check it again when it returns.
     - `Next: <id>.findings stays failed (2 of 2 attempts)`: leave the unit failed, with its file kept for the user to see. Never make a third attempt.
     - A `Next:` line that starts `Next: write ui.json first`: the fixed text of a non-English run is missing or fails `check-ui`, nothing was recorded and this is not an attempt. Stop dispatching, go back to Phase 2, then check this lane again.
   - Exit 2: the command could not run. Show its message and stop.

   Never edit `entries/<id>.findings.json` or `state.json` yourself, and never widen a passage or reword a finding to make it pass. A lane that fails its checks is fixed only by its own second attempt. Statuses and attempts change only through these commands.

   Then tell the user `Findings <id> <n>/<N>: <status>`, where `<n>` counts the lanes this run has checked, `<N>` is the number of lanes listed in step 1 and `<status>` is `checked`, `verified` or `failed`, in `$LANGUAGE`.

The lane prompt:

````text
You write the findings of one feature of a product handbook, from the source of the project at $PROJECT_ROOT: the defects that the code of the feature shows today. Your feature: <id> "<name>" in the area "<area name>"; readers reach it <reach, in words: from the menu / by a link / automatically / as an interface for other systems / as an operator command>.

Your scope. Start with these files, the seed files: <seedFiles, one per line>. Beyond them, open only the files that **Following out of the seed files** allows, and search the whole project as that paragraph and **Negative statements** ask. Its entrypoints: <candidates, one per line: id, kind, file:line, text>. The other features of this handbook, which other lanes write: <id and name of every other feature, one per line>. A defect that belongs to another feature is written by that feature's lane. Read code only; never run, build or change anything in the project. Never read anything under `.excavator/` and never read a document that an Excavator skill generated (PRD.md, handbook.md, reports, findings, tours); every searched path you open is project source or configuration. Exclude `.excavator`, `.git`, `node_modules`, `vendor`, `dist` and `build` from every search (for example `grep -rn --exclude-dir=.excavator --exclude-dir=node_modules ...`).

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
  "id": "<id>.findings",
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

**Check your file before you reply.** Run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" try-findings "$OUT" <id>.findings --project "$PROJECT_ROOT"`. It runs the same checks the orchestrator runs on your file and records nothing; when $LANGUAGE has its own script, it also refuses a narrative value that is written only in ASCII letters. Fix the file for every line it prints and run it again until it prints `<id>.findings: ok`, at most 5 runs. A passage reported as not in its file is most often a real line that sits in another file: search for it (`grep -rnF`) and cite the file it is in. A finding whose source you cannot find leaves the file, or goes into `unknowns`; never cut a passage down until it happens to match.

Write only `$OUT/entries/<id>.findings.json`, and nothing else anywhere. Reply with one line: `<id>.findings: written`, and nothing else.
````

---

