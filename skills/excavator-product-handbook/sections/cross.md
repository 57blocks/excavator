## Phase 8: The cross-feature chapters

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

Five chapters look across the features: `domains`, `roles`, `notifications`, `topics` and `defects`. Each is written by one writer subagent that reads only the chapters already in `$OUT/chapters/`, never the project's code, and copies into each statement the citation group of the chapter line it rests on. The script checks them with the same `check` as every chapter. Only the sections of `$SECTIONS` among these five are written. The design problems (`review`) and the remedies (`remedies`) have phases of their own after this one.

1. Make sure every feature has its chapter:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" --before cross --project "$PROJECT_ROOT"
   ```
   - Exit 0: go on.
   - Exit 1 in a run with `--features`: the other features are not written yet. Skip this phase and tell the user, in `$LANGUAGE`, how many features have no chapter yet and that a run without `--features` on the same `--out` writes them and then this phase. Go on to the next phase.
   - Exit 1 in a run without `--features`: go back to Phase 5 for the features it lists, then run this command again. When it still exits 1, tell the user the lines it printed and stop.
   - Exit 2: show its message and stop.

2. Find which of the five are still to write. For each `<name>` of the five that is in `$SECTIONS`:
   ```bash
   jq -r --arg n "<name>" '(.chapters[$n] // {status: "none", attempts: 0}) | [$n, .status, .attempts] | @tsv' "$OUT/state.json"
   ```
   Treat each as Phase 5 step 1 treats a feature: `passed` or `failed` with attempts 2 is done; a file with no record is checked first; `failed` with attempts 1 is written once more with its recorded reasons; no file and no record is written. A `domains` record that is `passed` but has no `json` field (the digest of `domains.json`, which an older run never recorded) counts as still to write: delete `$OUT/chapters/domains.md` and write it again, with `domains.json`.

3. Dispatch in two rounds, each writer an `excavator-handbook-writer` subagent in the foreground: first `domains`, `roles`, `notifications` and `topics`, at most `$CONCURRENCY` in one message; then `defects`. The prompt of each is the block **Every cross chapter** (in `stages/cross-prompt.md`) followed by the block of that chapter below.

4. As each returns, check it with `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" <name> --project "$PROJECT_ROOT"` and follow the result exactly as Phase 5 step 3 says. Then tell the user `Chapter <name>: <status>`, in `$LANGUAGE`.

**domains** (`$OUT/chapters/domains.md`):

````text
Your chapter is `domains`: the business domains of the product. Group the features into the domains a reader of this product would name (from the menus, the screens and the words the chapters use), each feature in exactly one domain. For each domain: a level-2 heading with its name; one or two sentences on what it is for; a table of its features (name with id, what it is for, who uses it); the hand-overs between its features and to features of other domains, as a list; and, when it has a main line of work that crosses 3 or more features or states, a mermaid `flowchart LR` of that line followed by its numbered steps. Start the chapter with a short list of the domains and a mermaid `flowchart LR` of the hand-overs between domains. Give no advice and no judgment.

You also write `$OUT/domains.json`, from what you wrote in the chapter only, in this exact shape:

```json
{ "domains": [{ "name": "<the text of a level-2 heading of the chapter>", "features": ["F1"] }],
  "handovers": [{ "from": "<domain name>", "to": "<domain name>", "what": "<one reader sentence>", "cites": ["<path>:<a>-<b>"] }] }
```

Rules, all checked by the script:
- `domains`: one entry per domain, in the chapter's order; `name` is exactly the text of that domain's level-2 heading; `features` are the feature ids of its table. Every feature id of the map is in exactly one domain, and no id outside the map appears.
- `handovers`: only hand-overs between two different domains, one entry for each; a hand-over inside one domain stays in the chapter and is not listed. `from` and `to` are listed domain names; no two entries have the same `from`, `to` and `what`.
- `what` is plain reader text in $LANGUAGE: no backtick and no citation group; a feature is written as its name with its id in parentheses, for example "Leave requests (F12)".
- `cites` has at least one entry, each a citation `<path>:<a>-<b>` (1 <= a <= b) copied exactly from the chapter line of that hand-over; never a citation that is not in the chapter.
- No other keys anywhere.

Your check (the `--no-record` command above) also prints the reasons of `domains.json`; fix both files for every reason, within the same limit of 4 runs.
````

**roles** (`$OUT/chapters/roles.md`):

````text
Your chapter is `roles`: the people who use the product and what each may do. Start with a table of the roles (the role as the chapters write it, who it is, how it signs in). Then one level-2 heading per role with a table of what it can do: the feature (name with id), the action and the condition under which it may. Where two chapters say different things about the same role and action, write both statements, each with its citations. Give no advice and no judgment.
````

**notifications** (`$OUT/chapters/notifications.md`):

````text
Your chapter is `notifications`: every notification and every scheduled or background job the chapters describe. A level-2 heading for notifications, with a table grouped under level-3 headings by domain or feature: the feature (name with id), the trigger, the recipient, the channel and the content. A level-2 heading for scheduled and background jobs, with a table: the job in plain words, its schedule or trigger, what it does and the features it touches. Give no advice and no judgment.
````

**topics** (`$OUT/chapters/topics.md`):

````text
Your chapter is `topics`: questions that cross features, each under its own level-2 heading, in this order, written in $LANGUAGE: approval routes (who approves what, in which order, per feature); calendars, dates and time zones (how each feature counts days, terms and deadlines, and where two features count differently); data shared between domains (which feature writes what another reads); access (how each feature decides who may see and act, and where two decide differently); the same problem in several places (a defect the `$PROBLEMS` sections of two or more chapters describe in the same way). Leave out a heading the chapters give nothing for. Use tables where items share attributes. Give no advice and no judgment.
````

**defects** (`$OUT/chapters/defects.md`):

````text
Your chapter is `defects`: every defect the `$PROBLEMS` sections of the chapters list, in one place, each with a level. Read the `$PROBLEMS` section of `system.md` and of every feature chapter (the command above prints them). Merge items that describe the same defect in the same code: one defect, every feature it appears in, the citations of each. Do not drop an item: every item of every `$PROBLEMS` section is in exactly one defect.

Give each defect one level, by these fixed rules and nothing else:
- `P0`: a reader can make it leak data to someone who may not see it, compute or move money wrongly, or act beyond their permission;
- `P1`: a reader meets wrong behavior in normal use;
- `P2`: everything else.

Write a level-2 heading per level, `P0`, `P1` and `P2`, in that order; under each, one list item per defect: its category in bold, the defect and the situation in which it happens, the features it appears in (names with ids), one sentence on why it has this level, and the copied citations. Start the chapter with a table of the counts per level and category, and one sentence saying that the levels follow the fixed rules above. A level with no defect has the one line `$NONE`. Say what the code does; give no advice: no "should", "fix", "recommend" or their equivalents in $LANGUAGE.
````
