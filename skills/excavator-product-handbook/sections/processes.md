## Phase 8a: The business processes

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The `processes` chapter lists the business processes of the product as the chapters show them: the chains of operations, often across features and roles, through which one piece of business gets done, each step naming the operation of a feature chapter that does it. It is optional and runs only because `$SECTIONS` holds `processes`. It is written in parts, one per business domain (the same parts as the domain batches of the design problems, `b1`, `b2` and so on): one `excavator-handbook-writer` subagent per part writes the processes that start in its domain to `$OUT/entries/processes/<part>.md`, reading only the chapters already in `$OUT/chapters/` and the facts a script prints, never the project's code, and giving no advice. A script checks each part, joins the parts into `$OUT/chapters/processes.md` with the fixed title, and the chapter is then checked as every chapter is. The check refuses a step whose bold operation is not, word for word, an operation heading of the feature the step names, and a process that starts in another part's domain; the assembled handbook and the page number the processes (`P1`, `P2` and so on) and list at the end of the chapter the operations that no step names.

1. Check that every feature has its chapter:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" --before processes --project "$PROJECT_ROOT"
   ```
   - Exit 0: go on.
   - Exit 1 in a run whose `$SECTIONS` holds `features`: go back to Phase 5 for the features it lists, then run this command again. When it still exits 1, tell the user the lines it printed and skip to the next phase.
   - Exit 1 in a run whose `$SECTIONS` does not hold `features`: skip this phase. Tell the user, in `$LANGUAGE`, what the lines say is missing (no map, or how many features have no chapter) and that a run with `--sections features` on the same `--out` writes them.
   - Exit 2: show its message and stop.
2. Find whether `processes` is still to write: `jq -r '.chapters.processes // empty | "\(.status) \(.attempts)"' "$OUT/state.json"` prints its recorded status and attempts, or nothing when it has no record. `passed`, or `failed` with attempts 2, is done: tell the user `Chapter processes: <status>`, in `$LANGUAGE`, and go to the next phase. Otherwise go on.
3. Find what each part needs, from its file, and tell the user how many parts there are:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" processes parts "$OUT" --project "$PROJECT_ROOT"
   ```
   It prints one line per part, `<part><TAB><state><TAB><domain name><TAB><feature ids>`: `done` when its file passes the check, `write` when it has no file or its file does not pass, with the reasons on the lines after it. Exit 1: show its lines and skip to the next phase.
4. Write the parts in the state `write`. Dispatch at most `$CONCURRENCY` writers in one message so they run concurrently, each an `excavator-handbook-writer` subagent in the foreground with the prompt **Every cross chapter** (in `stages/cross-prompt.md`) followed by the block **Your part of the processes** below. Write `$OUT`, `$LANGUAGE`, `$PLUGIN_ROOT` and `$PROJECT_ROOT` as their values everywhere, fill in its first line from the part's line (its id, its domain name, its feature ids) and leave the rest exactly as written, `<part>` included, so that every writer of the run starts with the same text. Wait for every writer of the message to return before you send the next message; never dispatch in the background. As each returns, check its file:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" processes check-part "$OUT" <part> --project "$PROJECT_ROOT"
   ```
   - Exit 0: tell the user `Processes <domain name>: written`, in `$LANGUAGE`.
   - Exit 1 the first time: run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" processes reset "$OUT" <part>` and dispatch its writer once more, with its prompt followed by the line `Your previous attempt failed these checks; write the part again and fix each of them:` and the reason lines that were printed.
   - Exit 1 the second time: run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" processes skip "$OUT" <part>`, which leaves the part without processes, and tell the user, in `$LANGUAGE`, that the domain has no processes in the chapter because its writer's part did not pass. Never make a third attempt.
5. Join the parts and check the chapter:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" processes join "$OUT" --project "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" processes --project "$PROJECT_ROOT"
   ```
   `join` exits 1 and lists the parts that are not `done` when one is still to write: do step 4 for them, then join again. Then tell the user `Chapter processes: <status>`, in `$LANGUAGE`, from the line `check` prints. When `check` refuses the joined chapter, show its lines; do not write the chapter by hand.

**Your part of the processes** (`$OUT/entries/processes/<part>.md`):

````text
Your part: <part>, the business domain "<domain name>", whose features are <feature ids>.

You write one part of the chapter `processes`: the business processes of the product as the chapters show them. A process is a chain of operations through which one piece of business gets done, from the operation that starts it to the one after which nothing more happens to it; for example a leave from the request to the approval and the hours it changes, or a new hire from candidate to employee. You write the processes that start with an operation of one of your features; their later steps may be operations of any feature. You state what exists, in the order the chapters show; you never judge a process or say how it should be.

First print the operations of your features and of the features linked to them, the links, and the fixed text of the chapter:

`node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" processes facts "$OUT" <part>`

`jq -r '.strings | to_entries[] | select((.key | startswith("chapter.processes.")) or .key == "chapter.domain.mainLine") | "\(.key)=\(.value)"' "$OUT/ui.json"`

The first command prints, one per line and separated by tabs: `OP <feature id> <chapter file>:<line> <operation>` for every operation heading of your features and of the features linked to them; `EDGE <feature id> <feature id> <chapter file>:<line>` where a feature's hand-overs section names another feature; `HANDOVER <domain> -> <domain>: <what>` for the hand-overs from and to your domain; `UNREAD <feature id> <reason>` for a feature whose operations could not be read; and a last line of counts. When its output comes back cut, print it again in pieces, `| sed -n '1,200p'`, then `'201,400p'` and so on, until you have read all of it. For a feature it does not list, `grep -n '^### ' "$OUT/chapters/<feature id>.md"` prints its headings. The second command prints the fixed text; below, `<key>` stands for the value printed after that key.

Find the processes from the links: the HANDOVER and EDGE lines, the main line of your domain in `$OUT/chapters/domains.md` (its level-3 section `<chapter.domain.mainLine>`; find it with `grep -n`), and, in a feature chapter, what an operation leads to (a state another operation picks up, a record another feature reads, a hand-over). Go through the operations of your features one by one, in the order the OP lines print them, and for each ask whether the chapters show what leads to it or what follows from it; a chain that starts there is a process of your part. Read an operation where its OP line points, with `sed -n '<line>,<line + 40>p' "$OUT/chapters/<feature id>.md"`, to see who does it and what follows. Read the sections you need, never every chapter in full.

Write `$OUT/entries/processes/<part>.md` in this structure, which takes the place of the **Form** rules above; the check enforces the step rule and the start rule below, the rest is what the reader expects:

1. No level-1 heading: the chapter's title is added when the parts are joined.
2. One level-2 heading per process: its name, saying what gets done, in $LANGUAGE (for example "Leave: from the request to the balance"). No other level-2 heading, no level-3 heading, no paragraph and no table.
3. Under each, a numbered list of the steps in the order they happen. Each step is one list item in this form: `<role>: **<operation>** (<feature title> (F<n>))` followed by one sentence of what happens in this step, and its citation group. `<operation>` is copied exactly, every character, from the last field of an OP line or a heading the grep printed, and `F<n>` is that feature's id; the check refuses a step whose bold text is not an operation of the feature it names, and a step without the bold operation or without the feature id. `<role>` is the role as the chapter of that feature writes it, in quotation marks when it is quoted there; a step done by the system (a scheduled job, an automatic mail) names the system as its role. The citation group is copied from the lines of that operation in its feature chapter.
4. The first step of every process is an operation of one of your features (<feature ids>); the check refuses a process that starts elsewhere, which another part writes.
5. After the steps, at most one line `<chapter.processes.end>: <the state the record is in at the end, as the chapter writes it>` with its citation group, when the chapters say it.
6. A process has 2 or more steps. Write a process for every chain the chapters show that starts in your domain: one that crosses features (a hand-over, a record or a state one feature leaves and another takes up) or one inside one feature of 3 or more operations done one after another, including the chains that turn back or end early (a rejection, a cancellation, a withdrawal) and the ones that set up what another operation uses. An operation may be a step of several processes. An operation that stands on its own (viewing a list, filtering, opening a detail page) need not be in any process; the handbook lists after the chapter the operations no step names, as information, not as an error.
7. Order your processes from the one that starts the business of your domain to the ones that follow it.
8. Never write a step the chapters do not show, never join two operations that the chapters do not link, and never fill a gap with a step of your own: where the chapters do not show what comes next, the process ends there.

**Check before you reply.** Run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" processes check-part "$OUT" <part> --project "$PROJECT_ROOT"`. It prints one line for each problem, with the line of your file. Fix the lines it names and run it again, at most 4 runs. When the 4th run still refuses a process, take that process out of the file and stop. When your domain shows no chain, write an empty file.
````
