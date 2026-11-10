## Phase 4: Entries

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

1. List the lanes this run dispatches. `<ids>` is `$SELECTED` space-separated, or empty without `--features`:
   ```bash
   jq -r --arg ids "<ids>" '($ids | split(" ") | map(select(. != ""))) as $want | .features | to_entries[] | select(($want | length) == 0 or (.key | IN($want[]))) | [.key, .value.status, .value.attempts] | @tsv' "$OUT/state.json"
   jq -r '.features[] | [.id, .reach, .name] | @tsv' "$OUT/map.json"
   ```
   A feature that is `checked`, `confirmed` or `verified` is not written again. A feature that is `dispatched` and has an entry file (an earlier run stopped after its lane wrote) goes to step 3 first, as if its lane had just returned. Every other feature with `attempts` below 2 gets a lane; one with `attempts` 2 that is not `checked`, `confirmed` or `verified` stays as it is. Before you dispatch a lane again, delete the file its earlier attempt left: `rm -f "$OUT/entries/<id>.json"`. A feature that is `failed` with `attempts` 1 (an earlier run stopped before its second attempt) gets its second attempt as step 3 describes, with the reasons `state.json` kept from the first: `jq -r '.features["<id>"].failure.reasons[]' "$OUT/state.json"`.
2. Right before you dispatch lanes, record their dispatches. Put the `mark` calls of one batch in one Bash command, one after another, before the message that dispatches the batch, one line per lane:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" mark "$OUT" <id> dispatched --project "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" mark "$OUT" <next id> dispatched --project "$PROJECT_ROOT"
   ```
   Dispatch at most `$CONCURRENCY` lanes in one message so they run concurrently, each an `excavator-handbook-writer` subagent in the foreground with the prompt below. Fill in only the placeholders of its last block, **Your feature**, from `map.json` and `candidates.json`, and write `$PLUGIN_ROOT`, `$PROJECT_ROOT`, `$OUT` and `$LANGUAGE` as their values everywhere; leave the rest of the prompt exactly as written, `<id>` included, so that every lane of the run starts with the same text. Wait for every lane of the message to return before you send the next; never in the background: a run without a terminal stops waiting for background subagents.
3. As each lane returns, check it. Run `check-entry` for one lane at a time, as each returns, never two at once:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-entry "$OUT" <id> --project "$PROJECT_ROOT"
   ```
   `check-entry` records its result in `state.json` itself: `checked`, or `failed` with the lines it printed as the reasons. A lane that wrote no file fails with `lane-wrote-nothing`.
   - Exit 0: the entry is checked.
   - Exit 1: the entry failed its checks. The last line it prints is a `Next:` line. Follow it:
     - `Next: delete <id>'s entry, mark it dispatched and re-dispatch it once with the lines above (attempt 2 of 2)`: delete the entry (`rm -f "$OUT/entries/<id>.json"`), mark the dispatch (as in step 2) and re-dispatch the lane once with its prompt followed by this line and then each line `check-entry` printed except the `Next:` line: `Your previous attempt failed these checks; fix them and write the file again:`. Check it again when it returns.
     - `Next: <id> stays failed (2 of 2 attempts)`: leave the feature failed, with its file kept for the user to see. Never make a third attempt.
     - A `Next:` line that starts `Next: write ui.json first`: the fixed text of a non-English run is missing or fails `check-ui`, nothing was recorded and this is not an attempt. Stop dispatching, go back to Phase 2, then check this lane again.
   - Exit 2: the command could not run. Show its message and stop.

   Never edit `entries/<id>.json` or `state.json` yourself, and never widen a passage or reword an entry to make it pass. A lane that fails its checks is fixed only by its own second attempt. Statuses and attempts change only through these commands.

   Then tell the user `Lane <id> <n>/<N>: <status>`, where `<n>` counts the lanes this run has checked, `<N>` is the number of lanes listed in step 1 and `<status>` is `checked` or `failed`, in `$LANGUAGE`.

The lane prompt:

````text
You write one entry of a product handbook, for readers who do not read code, from the source of the project at $PROJECT_ROOT. The last block of this prompt, **Your feature**, says which feature you write, where its code starts, which other features exist and which roles and names you may use. In this prompt `<id>` stands for the id of your feature.

Your scope. Start with the seed files of your feature. Beyond them, open only the files that **Following out of the seed files** allows, and search the whole project as that paragraph and **Negative and absolute statements** ask. Read code only; never run, build or change anything in the project. Never read anything under `.excavator/` and never read a document that an Excavator skill generated (PRD.md, handbook.md, reports, findings, tours); every searched path you open is project source or configuration. Exclude `.excavator`, `.git`, `node_modules`, `vendor`, `dist` and `build` from every search (for example `grep -rn --exclude-dir=.excavator --exclude-dir=node_modules ...`).

Write in `$LANGUAGE`, in plain words for a reader who does not read code. Describe what the product does today. Give no advice, no opinion and no defect report: never write what the product should do or what is wrong with it.

Every narrative value of the JSON file below is written in $LANGUAGE: the purpose, what a role can do, the names and steps of the operations and what they start with, calculate, change, branch on and hand over, the rule texts, the meanings of states, how a state changes, the parts of a notification, the automatic behavior and the unknowns. Labels, screen names, `where` labels and the roles stay exactly as the source and the lists at the end write them.

Write one JSON file with exactly these keys, and no others. `E` stands for an evidence list, a non-empty array of `{"file": "<path from the project root>", "passage": "<text copied from that file>"}`:

```json
{
  "format": "excavator-product-handbook-entry/2",
  "id": "<id>",
  "purpose": {"text": "<one plain sentence: who uses the feature to do what>", "evidence": E},
  "who": [{"role": "<a label from the list of roles>", "can": "<what this role can do here>", "evidence": E}],
  "where": [{"label": "<menu group, menu item, tab or page title, one per step>", "evidence": E}],
  "screens": [{"name": "<screen title as shown>", "evidence": E, "fields": [
    {"label": "<field label as shown>", "evidence": E, "rules": [
      {"side": "frontend", "text": "<a rule the page enforces>", "evidence": E},
      {"side": "backend", "text": "<a rule the server enforces>", "evidence": E}
    ]}
  ]}],
  "operations": [{
    "name": "<what the reader does>",
    "sentences": [{"text": "<one step, one fact>", "evidence": E}],
    "triggers": [{"text": "<what starts the flow>", "evidence": E}],
    "calculations": [{"text": "<what is calculated, from which inputs, with which rounding and cap>", "evidence": E}],
    "changes": [{"text": "<what data is stored or changed>", "evidence": E}],
    "edges": [{"when": "<a boundary case or an error>", "then": "<what happens>", "evidence": E}],
    "handoffs": [{"feature": "<the id of another feature from the list at the end>", "text": "<what is handed over to it>", "evidence": E}]
  }],
  "states": [{"label": "<status as shown>", "meaning": "<what it means>", "evidence": E}],
  "transitions": [{"from": "<status label as shown>", "to": "<status label as shown>", "by": "<what causes the change>", "evidence": E}],
  "notifications": [{"trigger": "<when>", "recipient": "<who gets it>", "channel": "<how>", "content": "<what it says>", "evidence": E}],
  "automatic": [{"when": "<schedule or trigger>", "effect": "<what happens>", "evidence": E}],
  "unknowns": [{"item": "<what the code does not settle>", "searched": "<what you searched>"}]
}
```

Every key is always there: when a part does not apply to your feature, write an empty list (`"notifications": []`), never leave the key out and never add a key. `unknowns` has no evidence. `operations` is the readable part: each operation is the flow of one thing the reader does, from the action to the data it changes, across the frontend and the backend. `sentences` are its steps in order, one item per step, each with its own evidence. `triggers` say what starts the flow (a button, a route, a schedule, a call from another system), `calculations` what is calculated from which inputs with which rounding and cap, `changes` which data is stored or changed, `edges` the boundary cases and error branches (`when` and `then`), and `handoffs` where the flow passes to another feature: `feature` is the id of one of the other features listed at the end, never your own id, and `text` says what is handed over; do not describe the other feature's own flow. A list that does not apply to an operation is empty. `transitions` are the changes between the states you list: `from` and `to` are state labels exactly as the source writes them and must occur in the item's own passages, `by` says in words what causes the change. A field's `rules` keeps the frontend and the backend apart (`side` is `frontend` or `backend`): put a rule on the side that enforces it, and when only one side checks something, write it on that side only. Every displayed or computed number gets its calculation and inputs; every configurable item says what configuring it does; every notification gets its trigger, recipient and content.

**Following out of the seed files.** The seed files are where you start, not a fence. When a file you have read hands part of your feature to code in another file, follow it there: find where the imported module, the called function or method, or the constant, enum, template, message text, validation rule or component it uses is defined (search with `grep -rn`; in a language whose package spans the files of one directory, such as Go, the files beside a seed call each other without an import), and open that file. Follow every decision a reader sees to the code that makes it: who receives a notification and what it says; how a displayed or computed number is calculated, with which rate, rounding and cap, and from which date or input; when a step of an approval or a flow is skipped or added; which columns a list shows, how it is sorted by default and how it can be filtered; what a detail page shows. A function's name does not say which records it returns or which people it picks (a word such as all, list or a role name in it settles nothing): before you write who receives something, who may act or which records count, open the function and write the filters its query applies, or write the claim without "all" and "every". When several handlers or categories share a field or a step, check each one before you say where its value comes from (which date, which input, which rate), and say it per handler when they differ. Before you write an item in `unknowns`, follow the call or import that could settle it. Open at most 40 files that are not seed files, in all; searches do not count. Open only a file that a file you have read leads to, and never list or walk a directory to see what is in it. When the 40 are spent, open no more: write what is not settled in `unknowns`, and say in `searched`, in plain words, what you did not open. In a file another feature also uses, read only what your feature uses, and write a hand-over to another feature as a `handoffs` item, as above.

**Evidence.** Every item carries its own evidence. A passage is text copied verbatim from the file, part of a line or whole lines; a script finds it by ignoring differences in white space and line breaks, and it must occur **exactly once** in that file. When a passage occurs more than once, quote a longer one (the whole line, or the lines around it). A file is a path from the project root, inside the project, and never under `.excavator`, `.git`, `node_modules`, `vendor`, `dist` or `build`. An item may cite several passages; each is checked.

**Cite what proves it.** A verifier that sees only one item and the code around its citations judges every item afterwards, and an item the code shown does not support is removed from the handbook. So cite, for each item, the passage that by itself proves it. For who may do something, cite the condition the code checks (the comparison, the role test, the guard that lets one role in and keeps another out), not the name of a function or variable: a name that contains a role word says nothing about who may act. For a claim of "every", "any" or "cannot already", cite the whole condition, so that a narrower one cannot hide outside the quote. When no passage proves it, write it in `unknowns`. The purpose is one plain sentence saying who uses the feature to do what, citing the screen or handler that shows it; conditions, filters and limits belong in the rules, not in the purpose.

**One fact per item, each step cites its own hop.** An item states one fact. A step cites its own hop: the handler, the call, the query or the condition that does that step, not the whole function around it. A sentence that holds two facts becomes two items, each with the passage of its own fact; an item whose citation proves only one of its facts is removed as a whole, and so is everything it says beyond that fact. Write the flow in as many steps as the code has hops, and give each trigger, calculation, change, edge and handoff its own item and its own citation.

**Labels and numbers must be in the item's own passages.** Every `label`, every screen `name` and every `where` label must occur in that item's own passages, exactly as the source writes it, in the source's language: never translate a label. Every number in your text must occur as a number in that item's own passages (the script ignores thousands commas, and underscores between digits in the source). Write numbers as Arabic numerals ("2 levels", never "two levels"). A number that is not in the item's passages (a count you made, an ordinal, a date) is not allowed: write the sentence without it, or cite the passage that holds it. The numbers of an operation's name are read against its steps' passages. A handoff's `feature` is an id, not reader text: it is checked against the list of features, not against the passages.

**Roles from the map.** `who.role` is one of the roles listed at the end, spelled the same. A role the list does not hold goes into `unknowns`.

**No code in reader text.** Everything except `evidence` is read by a reader. It contains no identifier with an underscore, no camel-case or mixed-case word, no path that starts with `/`, no file name with a source extension (.go .ts .tsx .js .jsx .java .py .sql .json .yaml .yml), no name followed by `(`, and no name of a member directory of the project. Say it in plain words. The only exceptions are a label quoted from the source that passes its own check and the names listed at the end. Never print a raw code, flag or `field=value`: read the enum or constant and write its meaning.

**Negative and absolute statements.** Before you write that something is never sent, never checked, not done, always done or done regardless of a setting, and before you write a trigger ("done by the nightly job", "recalculated by an event") or an ordering ("checked before"), search the whole project (every module, listeners and their registrations, scheduler registrations, SQL and migration scripts, configuration) and keep the searched scope in mind. If you cannot settle it, do not write it as a fact: write it in `unknowns` with `item` and what you `searched`.

**Check your file before you reply.** Run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" try-entry "$OUT" <id> --project "$PROJECT_ROOT"`. It runs the same checks the orchestrator runs on your file and records nothing; when $LANGUAGE has its own script, it also refuses a narrative value that is written only in ASCII letters, so write those values in $LANGUAGE and not in English. Fix the file for every line it prints and run it again until it prints `<id>: ok`, at most 5 runs. A passage reported as not in its file is most often a real line that sits in another file: search for it (`grep -rnF`) and cite the file it is in, or quote the line of the cited file that does say it. An item whose source you cannot find leaves the entry, or goes into `unknowns`; never cut a passage down until it happens to match.

Write only `$OUT/entries/<id>.json`, and nothing else anywhere. Reply with one line: `<id>: written`, and nothing else.

**Your feature.**
- Feature: <id> "<name>" in the area "<area name>"; readers reach it <reach, in words: from the menu / by a link / automatically / as an interface for other systems / as an operator command><, shown to readers as "<label>" when the feature has a label>.
- The seed files, where you start: <seedFiles, one per line>.
- Its entrypoints: <candidates, one per line: id, kind, file:line, text>.
- The other features of this handbook, which other lanes write; a handoff names one of them by its id: <id and name of every other feature, one per line>.
- The roles an entry may name, and no others: <roles, one label per line>.
- The names of external products and systems that the map lists: <names, one label per line>.
````

---

