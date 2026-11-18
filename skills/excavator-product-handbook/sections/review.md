## Phase 8b: The design problems

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The `review` chapter lists what the chapters show to be badly designed, not wrongly coded: two features that do the same thing, two places with different rules, an operation of many steps, a state with no way out. It is optional and runs only because `$SECTIONS` holds `review`. It reads only the chapters already in `$OUT/chapters/`, never the project's code, and it gives no advice (the remedies, Phase 8c, do). Writers do not write Markdown: each writes the items of one batch of features to `$OUT/entries/review/<batch>.json`, a script checks every item against the chapters and writes the chapter, and one verifier per batch then judges each item against the chapter lines it cites; an item the verifier judges unsupported is removed, never reworded and never tried again.

A batch is a business domain (when the domains chapter passed) or else an area of the map: `b1`, `b2` and so on. The problems that span batches are found from comparison candidates that a script computes (two dictionaries under one key, a table several applications use, a row of the cross-cutting topics chapter, the same code cited by two features): the comparison batches `c-data-1`, `c-topics-1`, `c-code-1` and so on, at most 25 candidates each, written after every domain batch is done.

1. Check that every feature has its chapter:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" --before review --project "$PROJECT_ROOT"
   ```
   - Exit 0: go on.
   - Exit 1 in a run whose `$SECTIONS` holds `features`: go back to Phase 5 for the features it lists, then run this command again. When it still exits 1, tell the user the lines it printed and skip to the next phase.
   - Exit 1 in a run whose `$SECTIONS` does not hold `features`: skip this phase. Tell the user, in `$LANGUAGE`, what the lines say is missing (no map, or how many features have no chapter) and that a run with `--sections features` on the same `--out` writes them. The remedies are written all the same, without design problems to read.
   - Exit 2: show its message and stop.

2. Compute the facts and the batches, and tell the user how many batches there are:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review facts "$OUT"
   ```
   It writes `$OUT/entries/review-facts.json` and prints the `BATCH` lines (`<batch>`, its name, its feature ids), the `FEATURE` lines of every feature (its operations, the steps of each operation, its states and transitions, its server-side steps, its hand-overs; a section it could not recognize is named, not counted) and the `PAIR` lines (one line for two features whose chapters cite the same lines of one file, with every such file; a file cited by more than 3 features is shared code and is not listed, and one `Shared files` line counts them). Exit 1 or 2: show its message and stop.

2a. Compute the comparison candidates:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review compare-facts "$OUT" --project "$PROJECT_ROOT"
   ```
   It writes `$OUT/entries/review-compare.json`, which also says which comparison batches there are; its output is not shown to the user, and the writers of steps 4 and 5 get their batch's candidates from that file. Exit 1 or 2: show its message and stop.

3. Find what each batch needs, from its files:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review status "$OUT" --project "$PROJECT_ROOT"
   ```
   It prints one line per batch, `<batch>`, a state and the batch name, with the reasons under a `write` batch whose file is refused:
   - `done`: pruned, nothing to do;
   - `wait`: a comparison batch while a domain batch is not `done`: step 5;
   - `prune`: its verdicts are written (or it has no item): step 7 applies them;
   - `verify`: its items pass the check and are not judged yet: step 6;
   - `write`: no file, or a file the check refuses: step 4 for `b1`, `b2` and so on, step 5 for a comparison batch. Clear the files of each such batch first, so that no verdict or removal of an earlier file is kept: `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review reset "$OUT" <batch>`.

4. Write the batches `b1`, `b2` and so on that are in the state `write`. Dispatch at most `$CONCURRENCY` writers in one message so they run concurrently, each an `excavator-handbook-writer` subagent in the foreground with the prompt **Every design-problems writer** followed by the block **Your batch**. Write `$OUT`, `$LANGUAGE`, `$PLUGIN_ROOT`, `$PROJECT_ROOT` and `$PROBLEMS` as their values everywhere, fill in the block **Your batch** from the `BATCH` line of the batch and, before you dispatch the writer, run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review candidates "$OUT" <batch>` and paste its output unchanged under the candidates line of the block, and leave the rest exactly as written, `<batch>` included, so that every writer of the run starts with the same text. Wait for every writer of the message to return before you send the next message; never dispatch in the background. As each returns, check its file:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review render "$OUT" <batch> --project "$PROJECT_ROOT"
   ```
   - Exit 0: the batch is written. Tell the user `Design problems <batch name>: written`, in `$LANGUAGE`.
   - Exit 1, or a writer that wrote no file, the first time: run `review reset "$OUT" <batch>` and dispatch its writer once more, with its prompt followed by the line `Your previous attempt failed these checks; write the batch again and fix each of them:` and the reason lines that were printed (`the batch was not written` when there was no file).
   - Exit 1 the second time: run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review skip "$OUT" <batch>`, which leaves the batch without items, and tell the user, in `$LANGUAGE`, that the batch has no design problems because its writer's items did not pass. Never make a third attempt.
   - Exit 2: show its message and stop.

5. Write the comparison batches. They are in the state `wait` until every batch `b1`, `b2` and so on is `done`, so do steps 6 and 7 for the domain batches first, then run `review status` again: the comparison batches are then in the state `write` (or `verify`, `prune`, `done` in a run that resumes). Write those in the state `write` as step 4 says, with the same substitutions, the same dispatch rules and the same checks and retries, except that the prompt is **Every design-problems writer** followed by the block **Your comparison batch**, filled in from the batch id, with the output of `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review candidates "$OUT" <batch>` put under its candidates line exactly as printed. Then do steps 6 and 7 for the comparison batches, and go on to step 8.

6. Verify. Run `review status` again. For each batch in the state `verify`, count its items with `jq '.items | length' "$OUT/entries/review/<batch>.json"`, then dispatch one `excavator-handbook-writer` subagent per batch in the foreground, at most `$CONCURRENCY` in one message, with the prompt **The verifier** followed by the line `The batch has <n> items, index 0 to <n-1>.` with `<n>` and `<n-1>` written as numbers, and nothing else. Do not paste the items: the verifier prints them itself, one at a time. The verifier writes `$OUT/entries/review/<batch>.verdicts.json`. Write `$OUT`, `$LANGUAGE`, `$PLUGIN_ROOT` and `<batch>` as their values in its prompt; it reads nothing else, except that it searches the chapters of an item's listed features for a thing the item claims does not exist. As each returns, tell the user `Design problems <batch name>: judged`, in `$LANGUAGE`.

7. Apply the verdicts of every batch in the state `verify` or `prune`, one at a time:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review prune "$OUT" <batch> --project "$PROJECT_ROOT"
   ```
   - Exit 0: the unsupported items are removed and recorded in `$OUT/entries/review-removed.json`. Running it again with the same verdicts changes nothing.
   - Exit 1 (the verdicts do not cover every item once, or hold a verdict or a reason that is not allowed): the first time, delete the verdicts (`rm -f "$OUT/entries/review/<batch>.verdicts.json"`) and dispatch its verifier once more as step 6 says, with the line `Your previous verdicts failed these checks; write them again and fix each of them:` and the lines printed, then apply again. The second time, run `review skip "$OUT" <batch>` and then `review prune` for it: its items are not published, since nobody judged them; tell the user so, in `$LANGUAGE`.
   - Exit 2: show its message and stop.

8. Write the chapter from every batch, check it and tell the user the result:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review render "$OUT" --project "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" review --project "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review summary "$OUT"
   ```
   The chapter is generated, so a refusal is not written again by a model: when `render` exits 1, tell the user the lines it printed and go on to the next phase; when `check` exits 1, keep the chapter and tell the user the reasons. Then tell the user `Chapter review: <status>`, and one line per line of `review summary` (`<batch>`, its name, `kept=<n>`, `removed=<m>`): the batch name, the items kept and the items removed, in `$LANGUAGE`; never add the numbers up yourself.

Never edit a batch file, a verdicts file or the chapter yourself.

**Every design-problems writer.**

````text
You write the design problems of one batch of features of a product handbook, for readers who do not read code. The handbook's chapters are written, in `$OUT/chapters/`: one `F<n>.md` for each feature. You read only those chapters, the files named below and the output of the commands named below; you never open, search or read the project's code or any other file. You write only the file `$OUT/entries/review/<batch>.json` (`<batch>` is your batch's id, given in the block that follows these instructions) and nothing else anywhere.

**What a design problem is.** A design problem is something the chapters show the product does as designed, and that is badly designed for the people who use it. It is not a defect: do not restate a defect that the `$PROBLEMS` sections of the chapters of your batch list (this prints those sections, each line prefixed with its chapter, only so that you do not repeat them: `for f in <the chapter files of your batch>; do awk -v h="## $PROBLEMS" -v id="$(basename "$f" .md)" 'index($0, "## ") == 1 { on = ($0 == h) } on { print id ": " $0 }' "$f"; done`). Every item has exactly one dimension:
- `duplication`: two features, or two screens, let the user do the same thing, each its own way; for example "Orders" and "Order import" both create an order;
- `contradiction`: two chapters state different rules for the same thing; for example one says an order can be cancelled until 24 hours before delivery and another says 48;
- `complexity`: one operation takes many steps, screens or hand-overs compared with the others in the facts; for example sending an order takes 9 steps while the others take 3;
- `redundancy`: the same information is entered or kept twice; for example the customer's address is typed on the order and again on the invoice;
- `dead-end`: a user or a record cannot get out of a state, or no feature handles the next step; for example a rejected order cannot go back to draft and nobody can delete it;
- `inconsistency`: similar things work in different ways; for example one list filters by a range of dates and a similar list by one date only;
- `manual`: a user does by hand what the product could do, or a value is fixed in the product that users would need to change; for example an administrator types the closing date of every month, or a limit is fixed at 500 for everyone;
- `access`: who may do what is decided differently in two places, or a role can do more than its duty; for example the approver of a request can also edit it;
- `traceability`: a change or a decision leaves no record a user can see; for example an order can be edited and nothing shows who changed it;
- `other`: a design problem that fits none of the nine; use it rarely.

**Impact**, by these fixed rules and nothing else:
- `high`: in normal use the user gets results that contradict each other, gets stuck and cannot go on, or a role can do more than its duty;
- `medium`: the user has to take more steps, enter the same information twice, or take a detour;
- `low`: everything else.

**The file.** `$OUT/entries/review/<batch>.json`, in this exact shape and with no other key anywhere (an empty `items` list is allowed and is the right answer when the chapters show no design problem):

```json
{ "items": [{
  "dimension": "duplication",
  "impact": "medium",
  "features": ["F3", "F12"],
  "title": "<one phrase>",
  "situation": "<what the chapters say, one sentence>",
  "consequence": "<what the user has to do or cannot do because of it, one sentence>",
  "cites": ["<path>:<a>-<b>"],
  "candidates": ["X3"]
}], "dismissed": [{ "candidate": "X4", "reason": "different-subject" }] }
```

`candidates` (on an item: the comparison candidates the item handles) and `dismissed` (at the top level) are present only when your batch has comparison candidates; they are the only keys besides the ones shown.

Rules, all checked by the script:
- `features` are feature ids, at least one, each once: in a batch `b1`, `b2` and so on, ids of your batch only (a problem that needs a feature of another batch is not yours); in a comparison batch, any feature ids.
- `cites` are citations `<path>:<a>-<b>` (or `<path>:<n>`), each copied exactly, without backticks, from a line of a chapter of one of the listed features; never one you did not copy, and never changed. `duplication`, `contradiction`, `inconsistency` and `access` need citations from at least 2 different chapter lines.
- `title`, `situation` and `consequence` are plain reader text in $LANGUAGE, with no backtick and no citation group (the script adds the citations). `situation` and `consequence` are one sentence each. No identifier with an underscore, no camel-case word, no path that starts with `/`, no file name with a source extension, no name followed by `(` and no word of advice ("should", "must", "better", "fix", "recommend" or their equivalents in $LANGUAGE). Keep labels as the chapters write them, in quotation marks. Name a feature as its chapter's title gives it, with its id in parentheses, for example "Leave requests (F12)".
- For `duplication`, `contradiction`, `inconsistency` and `access` the situation is one sentence of two or more clauses, one for each side, in the form `<side>: <what that side's cited lines say>; <other side>: <...>`. Each clause names its feature (or the place of one feature) and holds only what the cited lines of that side say, never one summary of both sides. For example: "Orders (F3): a clerk creates an order on its form; Order import (F7): a clerk creates orders from an uploaded file".
- A number in `title`, `situation` or `consequence` is a number that a cited chapter line holds, or a number of the facts of a listed feature; never a number you counted or computed yourself.

**Comparison candidates.** The script found the candidates of your batch (the `CANDIDATE` lines of the block that follows these instructions); you judge them. Each one gets exactly one conclusion: an item that lists it in `candidates`, or an entry in `dismissed` with one reason: `same` (the two sides state the same thing; nothing differs), `different-subject` (the two sides are about different things; for two implementations of one feature: the applications do different jobs of the feature and no job is done in both), `not-in-chapters` (the chapters do not show the two sides) or `already-kept` (a comparison batch only: an item of a domain batch, printed by `review titles`, already states this problem). The check refuses a batch that leaves a candidate of the batch without a conclusion, names a candidate of another batch, or lists a candidate on an item that does not list its feature. A candidate of source `dual` is one feature whose routes lie in two applications, with the route count of each: when the chapter shows the same job reachable in both, write one `duplication` item with that feature in `features` and the candidate in `candidates`, whose situation says which operations each application serves, as the chapter shows them. A candidate is evidence, not proof: read the chapter before you decide.

**What a good item is.** The consequence names what a user has to do or cannot do (enter it twice, go to another screen, wait for an administrator, get stuck); "complex", "confusing" or "not user-friendly" are not consequences. The consequence states only what follows from the cited lines themselves, never one step further: not what happens to the record afterwards, not what a user then misses or gets wrong, not a state the lines do not name. When the lines show only that two sides differ, the consequence is what the user meets on each side (sees two different lists, gets two different answers), nothing more. A claim that something does not exist ("there is no way to ...") names, in the situation, the chapters in which you looked for it. Write only what the cited lines show; where the chapters do not settle a point, leave it out. Do not write the same problem twice.

**Read what you need.** Print the facts of your batch (every feature's operations, steps, states, hand-overs and the pairs of features that cite the same lines): `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review facts "$OUT" <batch>`. Read every chapter of your batch's features in full, with `sed -n '<a>,<b>p'` on `$OUT/chapters/<id>.md`; read the chapters of another feature only where a hand-over or a pair sends you to them.

**Check before you reply.** Run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review render "$OUT" <batch> --project "$PROJECT_ROOT"` (the path in this command is for the check only; never read it). It prints one line for each refused item, with the item's index counted from 0 and the rule. Fix the items it names and run it again, at most 4 runs. When the 4th run still refuses an item, take the refused items out of the file and stop. Never keep an item the check refuses.

Reply with one line: `<batch>: written`.
````

**Your batch.**

````text
- Batch: `<batch>` "<batch name>".
- The features of the batch, whose chapters you read: <the feature ids of the BATCH line, each with its name, one per line>.
- The comparison candidates of your batch, one per line (`none` when there is none):
<the output of review candidates>
````

**Your comparison batch.**

````text
- Batch: `<batch>`, a comparison batch. Your job is its comparison candidates, listed below; every item you write lists in `candidates` the candidates it handles (the check refuses an item that lists none), and its `features` may be feature ids of any batch. Skip the `$PROBLEMS` command and the paragraph **Read what you need** of the instructions above; read instead:
  1. For each candidate, what it rests on: `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review candidate-lines "$OUT" <candidate id>`. It prints the candidate, its facts as one JSON line (for a topic, the row of the cross-cutting topics chapter) and, for each of its features, the chapter lines that cite the same places, each with its chapter and line number. The output of one candidate can be long: when it comes back cut, print it again in parts, `| sed -n '1,100p'`, then `'101,200p'` and so on, until you have read all of it. Read more of a chapter around a printed line with `sed -n '<a>,<b>p' "$OUT/chapters/<id>.md"` when you need its context; read no other file.
  2. The problems the domain batches kept, each with its batch, item, dimension, impact, features and title: `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review titles "$OUT" --project "$PROJECT_ROOT"` (the path is for the check only; never read it). Do not write one of them again: a candidate that one of them already states is dismissed with `already-kept`.
- What each source is:
  - `dict`: two dictionaries (lists of values, such as statuses or offices) under one key in two applications, with the count and the first values that only one side has. When the chapters show both lists used for the same thing, the item is usually a `contradiction` (the two sides give different answers for one question) or an `inconsistency`; when no chapter line is printed for it, dismiss it with `not-in-chapters`.
  - `table`: one table that two or more applications read or write, with the mentions of each. It is a problem only when the chapters show the sides treating the same records differently (different rules, different fields, one side changing what the other takes as fixed); a table the sides share without such a difference is dismissed with `same`.
  - `topic`: one row of the cross-cutting topics chapter that names two or more features; the row often says itself how they differ. Write the item from the feature chapters' lines, not from the row: the row is where to look, and the check takes citations only from the chapters of the item's features.
  - `code`: two features of different domain batches whose chapters cite the same lines of code: evidence of the same job done in two places (`duplication`) or of one rule described two ways (`contradiction`), not proof. Shared code that both features merely call is `different-subject`.
- The candidates of your batch, one per line:
<the output of review candidates>
````

**The verifier.**

````text
You judge the items of one batch of design problems of a product handbook against the chapter lines they cite. The last line of this prompt says how many items the batch has. Print the items one at a time, from index 0 to the last, with `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review claims "$OUT" <batch> <index>`: each prints one item with its fields and, under each citation, the chapter lines that hold it. Judge every item. Read no other file and run no other command than this one, the search below and the one that writes your answer; never open the project. You write only `$OUT/entries/review/<batch>.verdicts.json` and nothing else anywhere.

For each item, decide `supported` or `unsupported`:
- `supported` only when all three hold: the cited chapter lines say what the situation says; the consequence follows from the situation (nothing in it is added from outside the lines); and the item describes a design problem, not only a defect of the code restated in other words (a check that is missing, a failure that answers success, a value that is wrong);
- `unsupported` when one does not hold, for example when the lines say less than the situation claims, or when the cited lines are about another matter.

A claim that something does not exist (no record, no other way in, nobody else can do it) cannot be shown by the lines that cite what does exist. For such a claim only, search the chapters of the item's listed features for it: `grep -n -i -E '<words of the thing claimed absent, in $LANGUAGE and in English, joined with |>' $OUT/chapters/<id>.md` for each listed feature id. The claim holds when no line of those chapters shows the thing; when a line shows it, the item is `unsupported`, and the reason names that line. Every other part of the situation must still be shown by the cited lines; a line found by the search never supports a claim that something exists.

Judge only what the lines show, and for a claim that something does not exist, what the search finds. Do not rewrite, correct or improve an item, and do not judge whether the problem is important. When you cannot tell, the verdict is `unsupported`.

Write the file in this exact shape, one verdict for each item of the batch, once each, `index` being the number after `ITEM`, and a reason of one line in $LANGUAGE for every verdict, supported ones too:

```json
{ "verdicts": [{ "index": 0, "verdict": "supported", "reason": "<one line>" }] }
```

Reply with one line: `<batch>: written`.
````
