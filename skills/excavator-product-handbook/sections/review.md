## Phase 8b: The design problems

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The `review` chapter lists what the chapters show to be badly designed, not wrongly coded: two features that do the same thing, two places with different rules, an operation of many steps, a state with no way out. It is optional and runs only because `$SECTIONS` holds `review`. It reads only the chapters already in `$OUT/chapters/`, never the project's code, and it gives no advice (the remedies, Phase 8c, do). Writers do not write Markdown: each writes the items of one batch of features to `$OUT/entries/review/<batch>.json`, a script checks every item against the chapters and writes the chapter, and one verifier per batch then judges each item against the chapter lines it cites; an item the verifier judges unsupported is removed, never reworded and never tried again.

A batch is a business domain (when the domains chapter passed) or else an area of the map: `b1`, `b2` and so on, then the batch `cross` for the problems that span batches.

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

3. Find what each batch needs, from its files:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review status "$OUT" --project "$PROJECT_ROOT"
   ```
   It prints one line per batch, `<batch>`, a state and the batch name, with the reasons under a `write` batch whose file is refused:
   - `done`: pruned, nothing to do;
   - `prune`: its verdicts are written (or it has no item): step 7 applies them;
   - `verify`: its items pass the check and are not judged yet: step 6;
   - `write`: no file, or a file the check refuses: step 4 (or 5 for `cross`). Clear the files of each such batch first, so that no verdict or removal of an earlier file is kept: `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review reset "$OUT" <batch>`.

4. Write the batches `b1`, `b2` and so on that are in the state `write`. Dispatch at most `$CONCURRENCY` writers in one message so they run concurrently, each an `excavator-handbook-writer` subagent in the foreground with the prompt **Every design-problems writer** followed by the block **Your batch**. Write `$OUT`, `$LANGUAGE`, `$PLUGIN_ROOT`, `$PROJECT_ROOT` and `$PROBLEMS` as their values everywhere, fill in the block **Your batch** from the `BATCH` line of the batch, and leave the rest exactly as written, `<batch>` included, so that every writer of the run starts with the same text. Wait for every writer of the message to return before you send the next message; never dispatch in the background. As each returns, check its file:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review render "$OUT" <batch> --project "$PROJECT_ROOT"
   ```
   - Exit 0: the batch is written. Tell the user `Design problems <batch name>: written`, in `$LANGUAGE`.
   - Exit 1, or a writer that wrote no file, the first time: run `review reset "$OUT" <batch>` and dispatch its writer once more, with its prompt followed by the line `Your previous attempt failed these checks; write the batch again and fix each of them:` and the reason lines that were printed (`the batch was not written` when there was no file).
   - Exit 1 the second time: run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review skip "$OUT" <batch>`, which leaves the batch without items, and tell the user, in `$LANGUAGE`, that the batch has no design problems because its writer's items did not pass. Never make a third attempt.
   - Exit 2: show its message and stop.

5. Write the batch `cross` when its state is `write`, after every other batch has a file that passed (after step 4 the state of each is `verify`, `prune` or `done`). Print what the writer reads, then dispatch one `excavator-handbook-writer` subagent in the foreground with the prompt **Every design-problems writer** followed by the block **Your batch: cross**, with the same substitutions as step 4 and the three outputs below pasted in the places the block names. Check it with `review render "$OUT" cross --project "$PROJECT_ROOT"` and follow step 4's rules for the result.
   ```bash
   jq -r 'if (.handovers | length) > 0 then .handovers[] | "\(.from) -> \(.to): \(.what) (\(.cites | join("; ")))" else empty end' "$OUT/domains.json" 2>/dev/null || true
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review facts "$OUT" cross | grep -E '^(BATCH|PAIR|Shared)'
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review titles "$OUT" --project "$PROJECT_ROOT"
   ```

6. Verify. Run `review status` again. For each batch in the state `verify`, dispatch one `excavator-handbook-writer` subagent per batch in the foreground, at most `$CONCURRENCY` in one message, with the prompt **The verifier** followed by the line `The items:` and the output of this command pasted unchanged, and nothing else:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review claims "$OUT" <batch>
   ```
   The verifier writes `$OUT/entries/review/<batch>.verdicts.json`. Write `$OUT`, `$LANGUAGE` and `<batch>` as their values in its prompt; it reads nothing else. As each returns, tell the user `Design problems <batch name>: judged`, in `$LANGUAGE`.

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
You write the design problems of one batch of features of a product handbook, for readers who do not read code. The handbook's chapters are written, in `$OUT/chapters/`: one `F<n>.md` for each feature. You read only those chapters, the files named below and the output of the commands named below; you never open, search or read the project's code or any other file. You write only the file `$OUT/entries/review/<batch>.json` (`<batch>` is your batch's id, given in the block **Your batch**) and nothing else anywhere.

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
  "cites": ["<path>:<a>-<b>"]
}] }
```

Rules, all checked by the script:
- `features` are feature ids of your batch, at least one, each once; a problem that needs a feature of another batch is not yours (the batch `cross` covers it).
- `cites` are citations `<path>:<a>-<b>` (or `<path>:<n>`), each copied exactly, without backticks, from a line of a chapter of one of the listed features; never one you did not copy, and never changed. `duplication`, `contradiction`, `inconsistency` and `access` need citations from at least 2 different chapter lines.
- `title`, `situation` and `consequence` are plain reader text in $LANGUAGE, with no backtick and no citation group (the script adds the citations). `situation` and `consequence` are one sentence each. No identifier with an underscore, no camel-case word, no path that starts with `/`, no file name with a source extension, no name followed by `(` and no word of advice ("should", "must", "better", "fix", "recommend" or their equivalents in $LANGUAGE). Keep labels as the chapters write them, in quotation marks. Name a feature as its chapter's title gives it, with its id in parentheses, for example "Leave requests (F12)".
- A number in `title`, `situation` or `consequence` is a number that a cited chapter line holds, or a number of the facts of a listed feature; never a number you counted or computed yourself.

**What a good item is.** The consequence names what a user has to do or cannot do (enter it twice, go to another screen, wait for an administrator, get stuck); "complex", "confusing" or "not user-friendly" are not consequences. A claim that something does not exist ("there is no way to ...") names, in the situation, the chapters in which you looked for it. Write only what the cited lines show; where the chapters do not settle a point, leave it out. Do not write the same problem twice.

**Read what you need.** Print the facts of your batch (every feature's operations, steps, states, hand-overs and the pairs of features that cite the same lines): `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review facts "$OUT" <batch>`. Read every chapter of your batch's features in full, with `sed -n '<a>,<b>p'` on `$OUT/chapters/<id>.md`; read the chapters of another feature only where a hand-over or a pair sends you to them.

**Check before you reply.** Run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" review render "$OUT" <batch> --project "$PROJECT_ROOT"` (the path in this command is for the check only; never read it). It prints one line for each refused item, with the item's index counted from 0 and the rule. Fix the items it names and run it again, at most 4 runs. When the 4th run still refuses an item, take the refused items out of the file and stop. Never keep an item the check refuses.

Reply with one line: `<batch>: written`.
````

**Your batch.**

````text
- Batch: `<batch>` "<batch name>".
- The features of the batch, whose chapters you read: <the feature ids of the BATCH line, each with its name, one per line>.
````

**Your batch: cross.**

````text
- Batch: `cross`. Your problems span two or more batches: every item lists features of at least 2 batches, and the check refuses one that does not. The batches and their features:
<the BATCH lines, one per line>
- You read only these three things, and the passages of the chapters that they point to (find a cited line with `grep -n` in `$OUT/chapters/`, read it with `sed -n`). Skip the `$PROBLEMS` command of the instructions: your job is not a batch's own problems.
  1. The hand-overs between business domains (the domains chapter's list, one per line; empty when there is none):
<the first command's output>
  2. The pairs of features of different batches whose chapters cite the same lines of one file (`PAIR` lines, `across`, one line for two features with every such file; code that more than 3 features cite is not listed, the `Shared` line counts it): they show shared code, which is evidence of the same thing done in two places but not proof; open both chapters before you write an item:
<the second command's output>
  3. The problems the batches found, each with its batch, item, dimension, impact, features and title, so that you do not write them again:
<the third command's output>
````

**The verifier.**

````text
You judge the items of one batch of design problems of a product handbook against the chapter lines they cite. Your whole input is the list of items at the end of this prompt: each item with its fields, and under each citation the chapter lines that hold it. Read no file and run no command except the one that writes your answer; never open the project or any other chapter. You write only `$OUT/entries/review/<batch>.verdicts.json` and nothing else anywhere.

For each item, decide `supported` or `unsupported`:
- `supported` only when all three hold: the cited chapter lines say what the situation says; the consequence follows from the situation (nothing in it is added from outside the lines); and the item describes a design problem, not only a defect of the code restated in other words (a check that is missing, a failure that answers success, a value that is wrong);
- `unsupported` when one does not hold, for example when the lines say less than the situation claims, when a claim that something does not exist is not shown by the lines, or when the cited lines are about another matter.

Judge only what the lines show. Do not rewrite, correct or improve an item, and do not judge whether the problem is important. When you cannot tell from the lines, the verdict is `unsupported`.

Write the file in this exact shape, one verdict for each item of the list, once each, `index` being the number after `ITEM`, and a reason of one line in $LANGUAGE for every verdict, supported ones too:

```json
{ "verdicts": [{ "index": 0, "verdict": "supported", "reason": "<one line>" }] }
```

Reply with one line: `<batch>: written`.
````
