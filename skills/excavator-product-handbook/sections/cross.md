## Phase 8: The cross-feature chapters

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

Six chapters look across the features: `domains`, `roles`, `notifications`, `topics`, `defects` and `remedies`. Each is written by one writer subagent that reads only the chapters already in `$OUT/chapters/`, never the project's code, and copies into each statement the citation group of the chapter line it rests on. The script checks them with the same `check` as every chapter. Only the sections of `$SECTIONS` among these six are written.

1. Make sure every feature has its chapter:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" --before cross --project "$PROJECT_ROOT"
   ```
   - Exit 0: go on.
   - Exit 1 in a run with `--features`: the other features are not written yet. Skip this phase and tell the user, in `$LANGUAGE`, how many features have no chapter yet and that a run without `--features` on the same `--out` writes them and then this phase. Go on to the next phase.
   - Exit 1 in a run without `--features`: go back to Phase 5 for the features it lists, then run this command again. When it still exits 1, tell the user the lines it printed and stop.
   - Exit 2: show its message and stop.

2. Find which of the six are still to write. For each `<name>` of the six that is in `$SECTIONS`:
   ```bash
   jq -r --arg n "<name>" '(.chapters[$n] // {status: "none", attempts: 0}) | [$n, .status, .attempts] | @tsv' "$OUT/state.json"
   ```
   Treat each as Phase 5 step 1 treats a feature: `passed` or `failed` with attempts 2 is done; a file with no record is checked first; `failed` with attempts 1 is written once more with its recorded reasons; no file and no record is written. `remedies` needs `chapters/defects.md`: when it is not there after the defects chapter's turn, skip `remedies` and tell the user why.

3. Dispatch in two rounds, each writer an `excavator-handbook-writer` subagent in the foreground: first `domains`, `roles`, `notifications` and `topics`, at most `$CONCURRENCY` in one message; then `defects`; then `remedies`. The prompt of each is the block **Every cross chapter** followed by the block of that chapter. Write `$OUT`, `$LANGUAGE`, `$PLUGIN_ROOT`, `$PROJECT_ROOT`, `$OPEN_QUESTIONS`, `$PROBLEMS` and `$NONE` as their values; never give a writer of this phase the project's path in any other way.

4. As each returns, check it with `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" <name> --project "$PROJECT_ROOT"` and follow the result exactly as Phase 5 step 3 says. Then tell the user `Chapter <name>: <status>`, in `$LANGUAGE`.

**Every cross chapter.**

````text
You write one chapter of a product handbook for readers who do not read code. The handbook's other chapters are already written, in `$OUT/chapters/`: `system.md` for the system as a whole and one `F<n>.md` for each feature. You read only those chapters (and, for the remedies, the one file named below); you never open, search or read the project's code or any other file. Write only the file named below, in Markdown in $LANGUAGE, and nothing else anywhere.

**Read what you need, not everything.** List the chapters with `ls "$OUT/chapters"`. Find what concerns your chapter with `grep -n` over them, and read the line ranges you need with `sed -n '<a>,<b>p'`. Every chapter ends with the sections `## $OPEN_QUESTIONS` and `## $PROBLEMS`; this prints one section of every feature chapter, each line prefixed with its chapter:
`for f in "$OUT"/chapters/F*.md; do awk -v h="## $PROBLEMS" -v id="$(basename "$f" .md)" 'index($0, "## ") == 1 { on = ($0 == h) } on { print id ": " $0 }' "$f"; done`

**Every statement rests on a chapter line.** Each sentence, list item and table row that states a fact ends with a citation group copied exactly from the chapter line or lines it rests on: the same backticked `<path>:<a>-<b>` citations in parentheses, several separated by "; ". Never write a citation you did not copy from a chapter, and never change its numbers. A statement that rests on lines of two chapters copies the citations of both. In a language written with full-width punctuation, such as Chinese or Japanese, the group's parentheses and the sentence's full stop are that language's (U+FF08 and U+FF09 around the group, U+3002 after it), never the ASCII ones. When you name a feature, write its name as its chapter's title gives it, with its id in parentheses, for example "Leave requests (F12)".

**Form.** Start with one level-1 heading: your chapter's title in $LANGUAGE. A reader scans; never a wall of text. A paragraph has at most 4 sentences. A set of 3 or more things of one kind is a list; things that share attributes are a table, one row each, with the citation group in the last cell. Introduce a list or a table with one line that ends with a colon. Use level-2 and level-3 headings so that no heading holds more than about 8 items. A mermaid fence's first line is its diagram type (`flowchart LR`, `stateDiagram-v2`); its labels are plain words, with no citations inside the fence.

**Plain words.** Keep labels, role names and state names as the chapters write them, in quotation marks when they are quoted there. No identifier with an underscore, no camel-case word, no path that starts with `/`, no file name with a source extension and no name followed by `(` in reader text. A cross chapter adds no fact the chapters do not state: where the chapters do not settle a point, say so in plain words, with no citation, in a last section `## $OPEN_QUESTIONS`, or leave it out.

**Check before you reply.** Run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" <your chapter's name> --project "$PROJECT_ROOT" --no-record` (the path in this command is for the check only; never read it). Fix the chapter for every reason it prints and run it again, at most 4 runs. A citation the check refuses was copied wrong: copy it again from its chapter.

Reply with one line: `<your chapter's name>: written`.
````

**domains** (`$OUT/chapters/domains.md`):

````text
Your chapter is `domains`: the business domains of the product. Group the features into the domains a reader of this product would name (from the menus, the screens and the words the chapters use), each feature in exactly one domain. For each domain: a level-2 heading with its name; one or two sentences on what it is for; a table of its features (name with id, what it is for, who uses it); the hand-overs between its features and to features of other domains, as a list; and, when it has a main line of work that crosses 3 or more features or states, a mermaid `flowchart LR` of that line followed by its numbered steps. Start the chapter with a short list of the domains and a mermaid `flowchart LR` of the hand-overs between domains. Give no advice and no judgment.
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

**remedies** (`$OUT/chapters/remedies.md`):

````text
Your chapter is `remedies`, the only chapter of the handbook that gives advice. Read `$OUT/chapters/defects.md`, and the code health facts in `$OUT/entries/history.json` when that file exists (the files that change most and the files changed together); read no other chapter unless a defect sends you to it.

For each category that has defects, a level-2 heading with: the common cause the defects of that category share, in one or two sentences, each with the citations copied from the defects it rests on; and the measure that would remove that cause, as a list. Then a level-2 heading for the recommendations: 1 to 10 numbered items, most urgent first, each saying what to do, which defects it addresses (by level and feature) and the copied citations of those defects. A statement about the product as it is today must rest on copied citations; a recommendation rests on the defects it names. Use the code health facts only to order the recommendations and to say where a measure applies; never quote a figure from them, since they cannot be cited.
````
