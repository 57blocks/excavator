## Phase 5: The feature chapters

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

One writer subagent per feature reads the feature's code once and writes one Markdown chapter, `$OUT/chapters/<id>.md`, with its open questions and its problems in it. Nothing else is written for a feature: no fact sheet, no separate defects file. The script checks each chapter once it is written, with `check`; a chapter that fails is written again once, with the reasons, and a chapter that fails twice stays as it is and is marked in the handbook as not passing.

1. List the features this run writes and what each needs. `<ids>` is `$SELECTED` space-separated, or empty without `--features`:
   ```bash
   jq -r --arg ids "<ids>" '($ids | split(" ") | map(select(. != ""))) as $want | .features[] | select(($want | length) == 0 or (.id | IN($want[]))) | [.id, .reach, .name] | @tsv' "$OUT/map.json"
   jq -r '(.chapters // {}) | to_entries[] | [.key, .value.status, .value.attempts] | @tsv' "$OUT/state.json" 2>/dev/null || true
   ls "$OUT/chapters" 2>/dev/null || true
   ```
   For each listed feature:
   - recorded `passed`: done, not written again;
   - recorded `failed` with attempts 2: done, it stays as it is;
   - a file `chapters/<id>.md` with no record (an earlier run stopped right after its writer returned): check it first, as step 3 says, and follow the result;
   - recorded `failed` with attempts 1 (an earlier run stopped before the second attempt): delete the file when it is there (`rm -f "$OUT/chapters/<id>.md"`) and dispatch it once more with the reasons `jq -r '.chapters["<id>"].reasons[]' "$OUT/state.json"` prints, as step 3 says;
   - no file and no record: dispatch it.

   Dispatch a writer for every feature that needs one, whatever the run has spent: never leave a feature unwritten to keep budget or time for later phases. When the run cannot go on, stop; the next run resumes from the files and `state.json` and writes only what is missing.

2. Dispatch at most `$CONCURRENCY` writers in one message so they run concurrently, each an `excavator-handbook-writer` subagent in the foreground with the prompt below. Write `$PLUGIN_ROOT`, `$PROJECT_ROOT`, `$OUT`, `$LANGUAGE`, `$OPEN_QUESTIONS`, `$PROBLEMS` and `$NONE` as their values everywhere, and fill in the block **Your feature** from `map.json` and `candidates.json`; leave the rest of the prompt exactly as written, `<id>` included, so that every writer of the run starts with the same text. Wait for every writer of the message to return before you send the next message; never dispatch in the background: a run without a terminal stops waiting for background subagents.

3. As each writer returns, check its chapter, one at a time:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" <id> --project "$PROJECT_ROOT"
   ```
   - Exit 0: the chapter passed. It is final.
   - Exit 1 with `failed (attempt 1)`: delete the chapter (`rm -f "$OUT/chapters/<id>.md"`) and dispatch its writer once more, with its prompt followed by the line `Your previous attempt failed these checks; write the chapter again and fix each of them:` and the reason lines `check` printed for it. Check it again when it returns.
   - Exit 1 with `failed (attempt 2)`: keep the chapter as it is. Never make a third attempt.
   - A writer that wrote no file: dispatch it once more as for attempt 1, with the reason `the chapter was not written`; a second writer that writes none leaves the feature without a chapter, and the handbook lists it as not written.
   - Exit 1 with a line that says `state.json` is from an older version: stop and tell the user to run again with `--fresh`.
   - Exit 2: the command could not run. Show its message and stop.

   Never edit a chapter or `state.json` yourself, and never widen a citation or reword a sentence to make a chapter pass: a chapter is fixed only by its own second attempt.

   Then tell the user `Feature <id> <n>/<N>: <status>`, where `<n>` counts the chapters this run has checked, `<N>` is the number of features step 1 dispatched and `<status>` is `passed` or `failed`, in `$LANGUAGE`.

The writer's prompt:

````text
You write one chapter of a product handbook, for readers who do not read code, from the source of the project at $PROJECT_ROOT. The block **Your feature** at the end says which feature you write and where its code starts. In this prompt `<id>` stands for your feature's id. Write the chapter to `$OUT/chapters/<id>.md` and nothing else anywhere.

**Scope.** Start with the seed files. They are where you start, not a fence: when a file you have read hands part of the feature to code in another file (an imported module, a called function or method, a constant, an enum, a template, a message text, a validation rule, a component), find where it is defined with `grep -rn` and open that file. In a language whose package spans the files of one directory, such as Go, the files beside a seed call each other without an import. When code emits an event, publishes a message or puts a job on a queue, search the whole project for that name, find every listener or consumer, and write one hand-over sentence (who takes over, what it does) without describing the other feature's own flow. There is no limit on the number of files you open, but open a file only because a file you read or a search leads to it; never list or walk a directory to see what is in it. In a file another feature also uses, read only what your feature uses. Read code only; never run, build or change anything in the project. Never read anything under `.excavator/`, and no Markdown or document file of the project (README, AGENTS, PRD, specifications, reports). Exclude `.excavator`, `.git`, `node_modules`, `vendor`, `dist` and `build` from every search (for example `grep -rn --exclude-dir=.excavator --exclude-dir=node_modules ...`).

**What the chapter covers**, as far as the code shows it:
- what the feature is for and who uses it; where it is in the menu and its routes;
- every screen, with its fields, filters, columns, default sort, buttons and the messages it shows;
- every operation the user can do and what happens step by step, in the frontend and the backend;
- every rule and check, with its exact condition, and every exception as its own item;
- every calculation, with its inputs, rate, rounding and cap, and from which date or input;
- the states a record goes through and which action moves it from one to the next;
- every notification, with its trigger, recipient, channel and content;
- what happens automatically (schedules, events, listeners);
- where the feature hands over to another feature.

Every displayed or computed number gets its calculation and inputs; every configurable item says what configuring it does.

**Exceptions before a general rule.** Before you write a rule for every type, every office or region, or everyone, look for the branches that keep it from being general: an early branch by type; sets of offices or regions read separately in the frontend and the backend (when they differ, write each with its own citation); the acting person being the approver or the leader; a switch that skips, defers or turns off a step; a fixed error text shown only when the server sends no message of its own. Write the main rule with its condition and each exception as its own item, so the main rule claims no more than the code does.

**Negative and absolute statements.** Before you write that something never happens, always happens, is not checked, is done for all or only for some, or is done by a job or an event, search the whole project (every module, listeners and their registrations, scheduler registrations, SQL and migration scripts, configuration). A function's name does not say which records it returns or which people it picks: open it and write the filters it applies. When several handlers share a field or a step, check each before you say where its value comes from. If you cannot settle a point, do not write it as a fact: put it under **$OPEN_QUESTIONS** with what you searched.

**Citations.** Every sentence, list item and table row that states a fact ends with its citation group: one or more citations in parentheses, each in backticks, written as the file's path from the project root, a colon and its lines (`<path>:<a>-<b>`, or `<path>:<n>`), several separated by "; ". For example: The request is saved as a draft (`src/requests/save.ts:40-52`; `src/requests/model.ts:12`). Cite the lines that by themselves prove the fact, at most 80 lines per citation, never a whole file or function: for who may act, cite the condition the code checks, not a function name; for "every" or "any", cite the whole condition. A table row puts its citation group in its last cell. Backticks are for citations only; quote labels with quotation marks. A line that ends with a colon and introduces a list, a table or a diagram needs no citation; every other fact does. In a paragraph, every sentence carries its own citation group. In a language written with full-width punctuation, such as Chinese or Japanese, the group's parentheses and the sentence's full stop are that language's (U+FF08 and U+FF09 around the group, U+3002 after it), never the ASCII ones.

**Form.** Write Markdown in $LANGUAGE for a reader who scans, never a wall of text:
- Start with one level-1 heading: the feature's name as the block **Your feature** gives it.
- Use these level-2 headings, in this order, written in $LANGUAGE: overview, screens, operations, rules, states, notifications and automatic behavior, hand-overs, then `## $OPEN_QUESTIONS` and `## $PROBLEMS` exactly as written here. Leave out a heading that would have nothing under it, except the last two. Under a long section, add level-3 headings so that no heading holds more than about 8 items.
- A paragraph has at most 4 sentences; most have 1 or 2. A blank line ends a paragraph.
- A set of 3 or more things of one kind (types, fields, filters, buttons, options, conditions, exceptions) is a list, one per line.
- Things that share attributes are a table, one row each and one column per attribute: a field with its label, whether it is required and its rule; a column with what it shows; a state with its meaning and what moves it on; a notification with its trigger, recipient, channel and content.
- The steps of an operation are a numbered list, one step per item.
- An operation of 3 or more steps also gets a mermaid flowchart before its steps; a record with 3 or more states gets a mermaid `stateDiagram-v2`. A diagram is a ```` ```mermaid ```` fence whose first line is the diagram type (`flowchart TD`, `stateDiagram-v2`); its labels are plain words and the source's labels, no citations inside the fence. The numbered steps after it carry the citations.
- Introduce a list or a table with one line that ends with a colon.

The form changes how the facts are laid out, never how many: every fact that **What the chapter covers** asks for is still written. Never merge several conditions, exceptions, notifications or calculations into one row or item to keep a table short.

**Labels, numbers and plain words.** Keep every label, button text, state name and type name exactly as the source writes it, in the source's language, in quotation marks; never translate a label, and put only text copied from the source in quotation marks. Write numbers as Arabic numerals. Reader text has no identifier with an underscore, no camel-case or mixed-case word, no path that starts with `/`, no file name with a source extension, no name followed by `(`: say it in plain words, except a quoted label. Never print a raw code, flag or `field=value`: read the enum or constant and write its meaning. Describe what the product does today; give no advice and no opinion anywhere in the chapter: no "should", "must", "needs to", "better", "fix", "recommend" or "consider", nor their equivalents in $LANGUAGE.

**$OPEN_QUESTIONS.** Each item says what the code does not settle and what you searched. These items need no citation. When there is none, write the one line `$NONE` under the heading.

**$PROBLEMS.** List the defects the code of this feature shows today that a reader can reproduce from your words, one per list item, each starting with its category in bold and saying what happens in which situation, with its citations. A defect is something the code does today that is wrong: the same thing done two ways in two places; a check on one side that the other lacks; a failure that still answers success; a caller and a callee that do not match; a value written into the code that should come from data. Style, readability and "may" or "might" are not defects. Cite the lines that by themselves show it: for a missing check, the code that performs the action; for two places that disagree, both. The category is exactly one of:
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

Write only defects you can show from the code, and no advice. When there is none, write the one line `$NONE` under the heading.

**Check before you reply.** Run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" <id> --project "$PROJECT_ROOT" --no-record`. It records nothing. Fix the chapter for every reason it prints and run it again, at most 4 runs. A citation out of range or too long: open the file again and cite the lines that say the fact. A fact without a citation: cite it, or move it to **$OPEN_QUESTIONS** when no line proves it. A paragraph that is too long: split it, or turn it into a list. Never drop a fact only to pass.

Reply with one line: `<id>: written`.

**Your feature.**
- Feature: <id> "<name>" in the area "<area name>"; readers reach it <reach, in words: from the menu / by a link / automatically / as an interface for other systems / as an operator command><, shown to readers as "<label>" when the feature has a label>.
- The seed files, where you start: <seedFiles, one per line>.
- Its entrypoints: <candidates, one per line: id, kind, file:line, text>.
- The other features of this handbook, which other writers cover; a hand-over names one of them: <id and name of every other feature, one per line>.
````
