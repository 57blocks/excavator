## Phase 8a: The business processes

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The `processes` chapter lists the business processes of the product as the chapters show them: the chains of operations, often across features and roles, through which one piece of business gets done, each step naming the operation of a feature chapter that does it. It is optional and runs only because `$SECTIONS` holds `processes`. It is written by one `excavator-handbook-writer` subagent that reads only the chapters already in `$OUT/chapters/` and the facts a script prints, never the project's code, and it gives no advice. The script checks that the bold operation of every step is, word for word, an operation heading of the feature the step names; the assembled handbook and the page number the processes (`P1`, `P2` and so on) and list at the end of the chapter the operations that no step names.

1. Check that every feature has its chapter:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" --before processes --project "$PROJECT_ROOT"
   ```
   - Exit 0: go on.
   - Exit 1 in a run whose `$SECTIONS` holds `features`: go back to Phase 5 for the features it lists, then run this command again. When it still exits 1, tell the user the lines it printed and skip to the next phase.
   - Exit 1 in a run whose `$SECTIONS` does not hold `features`: skip this phase. Tell the user, in `$LANGUAGE`, what the lines say is missing (no map, or how many features have no chapter) and that a run with `--sections features` on the same `--out` writes them.
   - Exit 2: show its message and stop.
2. Find whether `processes` is still to write: `jq -r '.chapters.processes // empty | "\(.status) \(.attempts)"' "$OUT/state.json"` prints its recorded status and attempts, or nothing when it has no record; `$OUT/chapters/processes.md` is its file. Treat it as Phase 5 step 1 treats a feature: `passed` or `failed` with attempts 2 is done; a file with no record is checked first; `failed` with attempts 1 is written once more with its recorded reasons (`jq -r '.chapters.processes.reasons[]' "$OUT/state.json"`); no file and no record is written.
3. Dispatch one `excavator-handbook-writer` subagent in the foreground. Its prompt is the block **Every cross chapter** (in `stages/cross-prompt.md`) followed by the block below.
4. When it returns, check it with `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" processes --project "$PROJECT_ROOT"` and follow the result exactly as Phase 5 step 3 says. Then tell the user `Chapter processes: <status>`, in `$LANGUAGE`.

**processes** (`$OUT/chapters/processes.md`):

````text
Your chapter is `processes`: the business processes of the product as the chapters show them. A process is a chain of operations through which one piece of business gets done, from the operation that starts it to the one after which nothing more happens to it; for example a leave from the request to the approval and the hours it changes, or a new hire from candidate to employee. You state what exists, in the order the chapters show; you never judge a process or say how it should be.

First print the operations of every feature, the links between features and the fixed text of the chapter:

`node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" processes facts "$OUT"`

`jq -r '.strings | to_entries[] | select((.key | startswith("chapter.processes.")) or .key == "chapter.domain.mainLine") | "\(.key)=\(.value)"' "$OUT/ui.json"`

The first command prints, one per line and separated by tabs: `OP <feature id> <chapter file>:<line> <operation>` for every operation heading of every feature chapter; `EDGE <feature id> <feature id> <chapter file>:<line>` where a feature's hand-overs section names another feature; `HANDOVER <domain> -> <domain>: <what>` for the hand-overs between business domains; `UNREAD <feature id> <reason>` for a feature whose operations could not be read; and a last line of counts. Its output is long, more than one tool output holds in a large product: print it in two parts, the links and counts with `| grep -v '^OP'` and then the operations with `| grep '^OP'`; when a part comes back cut, print it again in pieces, `| sed -n '1,200p'`, then `'201,400p'` and so on, until you have read all of it. The second prints the fixed text; below, `<key>` stands for the value printed after that key.

Find the processes from the links: the HANDOVER and EDGE lines, the main line of each business domain in `$OUT/chapters/domains.md` (the level-3 sections `<chapter.domain.mainLine>`; find them with `grep -n`), and, in a feature chapter, what an operation leads to (a state another operation picks up, a record another feature reads, a hand-over). Read an operation where its OP line points, with `sed -n '<line>,<line + 40>p' "$OUT/chapters/<feature id>.md"`, to see who does it and what follows. Read the sections you need, never every chapter in full.

Write this structure, which takes the place of the **Form** rules above; the check enforces only the step rule below, the rest is what the reader expects:

1. One level-1 heading, exactly `<chapter.processes.title>`; not a title of your own.
2. One level-2 heading per process: its name, saying what gets done, in $LANGUAGE (for example "Leave: from the request to the balance"). No other level-2 heading, no level-3 heading, no paragraph and no table.
3. Under each, a numbered list of the steps in the order they happen. Each step is one list item in this form: `<role>: **<operation>** (<feature title> (F<n>))` followed by one sentence of what happens in this step, and its citation group. `<operation>` is copied exactly, every character, from the last field of an OP line, and `F<n>` is that OP line's feature id; the check refuses a step whose bold text is not an operation of the feature it names, and a step without the bold operation or without the feature id. `<role>` is the role as the chapter of that feature writes it, in quotation marks when it is quoted there; a step done by the system (a scheduled job, an automatic mail) names the system as its role. The citation group is copied from the lines of that operation in its feature chapter.
4. After the steps, at most one line `<chapter.processes.end>: <the state the record is in at the end, as the chapter writes it>` with its citation group, when the chapters say it.
5. A process has 2 or more steps. Write a process for every chain the chapters show: one that crosses features (a hand-over, a record or a state one feature leaves and another takes up) or one inside one feature of 3 or more operations done one after another. An operation may be a step of several processes. An operation that stands on its own (viewing a list, filtering, opening a detail page) need not be in any process; the handbook lists after your chapter the operations no step names, as information, not as an error.
6. Order the processes by business domain, in the order of `$OUT/chapters/domains.md`, and within a domain from the process that starts the business to the ones that follow it.
7. Never write a step the chapters do not show, never join two operations that the chapters do not link, and never fill a gap with a step of your own: where the chapters do not show what comes next, the process ends there.
````
