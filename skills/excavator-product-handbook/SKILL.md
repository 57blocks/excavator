---
name: excavator-product-handbook
description: Write a product handbook for non-technical readers from a project's source - a system overview (what the system is, who uses it, its applications and the external systems it calls), a map of the product's areas and features, one entry per feature with its screens, fields, rules, states and notifications, every value checked against a passage quoted from the source and every item confirmed by two verifiers that see only that item and the code it cites and then by two tracers that each read the whole project for code that contradicts it, assembled into handbook.md and a one-file HTML page in the language you choose, as a product view, a technical view or both. A script lists the entrypoint candidates and checks every step, you write the map, one subagent per feature writes its entry and others check it. It describes the product as it is and gives no advice.
argument-hint: "[path] [--language <lang>] [--out <dir>] [--features <list>] [--views <list>] [--sections <list>] [--concurrency <n>] [--fresh]"
---

# /excavator-product-handbook

Write a **product handbook**: a document for people who use or manage the product and do not read code. It describes what the product **actually does today**, reverse-engineered from the source, organized the way a reader sees the product: first the system as a whole (what it is, who uses it, its applications and external systems), then the business domains (the kinds of business the product handles, which can cover several areas of its navigation), then the features in each domain, then each feature's screens, fields, rules, states, notifications and automatic behavior.

Five rules govern everything below:

1. **As-Is only, no advice.** Describe behavior that exists in the code. Never write what the product should do, what is wrong with it, or how to change it. Where the code does not settle something, say so as an unknown and say what was searched.
2. **Nothing is dropped silently.** A script lists the entrypoint candidates (pages, routes, scheduled jobs, program starts). Every candidate belongs to exactly one feature or is listed as unassigned with a reason, and a script checks it.
3. **Every value has a source.** Each label, rule, number and sentence of an entry carries a passage copied from the source file. Scripts check that the passage is in the file exactly once, that every label and number is in its own passage, and that the file is project source.
4. **Readers see no code.** Reader-visible text contains no code-shaped words. A script refuses them; the rules are under **Reader text** in Phase 3.
5. **Nothing stays that the code does not back up.** A passage that exists can still be read wrongly. A verifier that sees one item and the code around its citations judges each item (Phase 5); an item it finds contradicted is removed at once, an item it cannot confirm is given other citations once (its text never changes), and removed if it is still not confirmed. Two tracers that each read the whole project then look for code that contradicts each item that is left (Phase 6), and what either finds is removed. Only a verified feature is written into the handbook, and every removed item is listed in its coverage section. The system overview that opens the handbook is checked the same way, item by item.

## How the work is split

| Who | Does |
|---|---|
| `handbook.mjs` (a script, no model) | Lists the entrypoint candidates and the application roots, checks the map, the business domains, the overview and each entry, computes every count and statistic of the system overview (languages, frameworks, files, lines, commits, authors, the roles of each domain), resolves `--features`, validates `--sections` and prints the phase files a run reads, records each dispatch and result, cuts each entry into the items a verifier judges and records the verdicts, removes what stays unverified, writes the trace files of each settled entry and records the tracers' verdicts, removes what they contradict, checks the fixed-text table, computes the entities and the relations between them (domains, roles, applications, external systems) from the verified entries and the source, assembles `handbook.md` (and `handbook-technical.md`), writes `handbook.html` and prints the closing lines. |
| You (the orchestrator) | Write the map and the business domains, dispatch the overview lane, the feature lanes, the verifiers, the rewriters, the tracers and the translation of the fixed text, and reply. |
| One subagent for the system overview (Phase 3b) | Reads the map, the application roots the script prints, each application's build manifests and entry files and the search hits for external systems, opens at most 30 other files, and writes `entries/overview.json`, one file, nothing else. |
| One subagent lane per feature | Reads that feature's seed files, follows calls and imports out of them to at most 20 more files, and writes its entry, one file, nothing else. |
| Two `excavator-handbook-verifier` subagents per part of a feature and round | Each reads the same verify file (the items of the part, each with its claim and the code it cites), without seeing the other, and judges each item `verified`, `unverified` or `contradicted`, with a one-line reason. |
| Two `excavator-handbook-tracer` subagents per part of a feature that two verifiers settled | Each reads the trace file (the items of the part, each with its claim and the files and lines it cites, no code) and the whole project, looks for code that contradicts each item, and judges it `holds` or `contradicted`, with a one-line reason and, for `contradicted`, where the code is. |
| One rewrite subagent per feature that has items to rewrite | Changes only the citations of the items the verifier could not confirm, in the entry file; never their text. |
| One subagent for the fixed text (only when the language is not English) | Translates the fixed-text table and writes `ui.json`. |

The text of the phases is split by section. This file holds the shared phases (0 to 2 and 5 to 7) and the Sections part; `stages/map.md` holds Phases 3 and 3c, `sections/overview.md` holds Phase 3b and `sections/features.md` holds Phase 4, each read only when the run needs it (see Sections).

All files of a run live in `$OUT`:

| File | Written by |
|---|---|
| `candidates.json` | `handbook.mjs candidates` (you save its output) |
| `map.json` | you |
| `domains.json` | you (Phase 3c) |
| `entries/<id>.json` | the lane of feature `<id>` |
| `entries/overview.json` | the overview subagent (Phase 3b) |
| `state.json` | `handbook.mjs` only (`check-map`, `check-entry`, `mark`, `verdicts`, `trace-verdicts`), and `check-overview` for the overview, whose state is under its key `overview` |
| `verify/round-<r>/<id>/part-<n>.json` | `handbook.mjs slices` (the items of a feature, or of the overview whose id is `overview`, with their claims and code, cut by size into parts); `verify/round-1/<id>.entry.json` is the entry as round 1 saw it |
| `verdicts/round-<r>/<id>/part-<n>.a.json` and `part-<n>.b.json` | the two verifiers of part `<n>` of feature `<id>`, one file each |
| `rewrite/<id>.json` | `handbook.mjs verdicts --round 1` (the items to rewrite, with the verdicts) |
| `trace/<id>/part-<n>.json` | `handbook.mjs trace` (the items a settled feature still holds, with their claims and cited line ranges, cut into parts of at most 25 items) |
| `trace-verdicts/<id>/part-<n>.a.json` and `part-<n>.b.json` | the two tracers of part `<n>` of feature `<id>`, one file each |
| `ui.json` | the translation subagent; for English, the script copies its shipped table |
| `handbook.md` | `handbook.mjs assemble` (the product view) |
| `handbook-technical.md` | `handbook.mjs assemble` (the technical view, only when `--views` has `technical`) |
| `handbook.html` | `handbook.mjs page` (the views `--views` names) |

## Options

`$ARGUMENTS` may contain:
- A directory path - the project to document (default: current working directory).
- `--language <lang>` - the language of the handbook's narrative, its area and domain names and fixed text, and of everything said to the user during the run; English when it is not given. Labels quoted from the source stay in their source language.
- `--out <dir>` - where the run's files, the handbook and the page go (default: `<project>/.excavator/product-handbook`).
- `--features <list>` - write entries only for these features, as a comma-separated list of feature ids or feature names (a name is matched ignoring case, as a whole name). The map still covers every candidate; the features without an entry are listed in the handbook as not written. The system overview is not a feature: this option never skips it (Phase 3b). Feature ids exist only after the map is written, which is why names are accepted: Phase 3 resolves the list with `select`.
- `--views <list>` - which views of the handbook are written: `product`, `technical` or both separated by a comma (default: `product`). The product view is organized by domain and never shows a file path; the technical view is organized by application and shows, next to each item, the file and lines of the passages quoted for it, and adds the applications, the external systems and a matrix of applications by domain. With both, the page has a switch between them that stays on the same entity. The option only decides what `assemble`, `page` and `reply` write; it changes no phase and is not recorded, so running again with other views only repeats Phase 7.
- `--sections <list>` - which sections of the handbook this run writes: `overview` (the system overview), `features` (the entries) or both separated by a comma (default: both). Each section's phases are in a file that is read only when the section is selected (see Sections). The option only decides which phases run; it is not recorded, so running again with other sections skips the units already done, and Phase 7 assembles whatever `$OUT` holds.
- `--concurrency <n>` - how many lanes run at once (default: 3).
- `--fresh` - start over instead of resuming an earlier run in the same `--out`.

## Sources

Read only the project's source code and configuration. Never read anything under `.excavator/` (except the files of this run in `$OUT`, which you write and check), and never read a document that an Excavator skill generated (`PRD.md`, `handbook.md`, reports, findings, tours, anything under `.excavator/`): a handbook built from another generated document proves nothing about the code. Never run, build or change anything in the project. Write only under `$OUT`. This skill never runs `/excavator` or any command that rebuilds the facts in `.excavator/`.

---

## Phase 0: Setup

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

1. Resolve `PROJECT_ROOT` from the path argument (default: `pwd`). Parse `--language` (`$LANGUAGE`: English when it is not given), `--out` (`$OUT`, default `$PROJECT_ROOT/.excavator/product-handbook`), `--features` (`$FEATURES`: the value, or none), `--views` (`$VIEWS`: the value, or `product` when it is not given; when it holds anything but `product` and `technical`, separated by a comma, tell the user those two values and stop), `--sections` (`$SECTIONS`: the value, or empty when it is not given; the Sections part checks it), `--concurrency` (`$CONCURRENCY`, default `3`) and `--fresh`. The run's language name, `$RUN_LANGUAGE`, is `English` whenever `$LANGUAGE` is English however it was spelled (`en`, `english`), and `$LANGUAGE` as given otherwise; the script treats only the name `English` as English.
2. Resolve `PLUGIN_ROOT` and check the script:
   ```bash
   PROJECT_ROOT="$(pwd)"   # or the path argument, as an absolute path
   OUT="$PROJECT_ROOT/.excavator/product-handbook"   # or the --out value
   VIEWS="product"   # or the --views value
   SKILL_REAL=$(realpath ~/.agents/skills/excavator-product-handbook 2>/dev/null || readlink -f ~/.agents/skills/excavator-product-handbook 2>/dev/null || echo "")
   SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
   PLUGIN_ROOT=""
   for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do
     if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then PLUGIN_ROOT="$candidate"; break; fi
   done
   echo "PROJECT_ROOT=$PROJECT_ROOT"; echo "OUT=$OUT"; echo "PLUGIN_ROOT=$PLUGIN_ROOT"
   echo "VIEWS=$VIEWS"
   if [ -f "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" ]; then echo "SCRIPT=found"; else echo "SCRIPT=missing"; fi
   ```
   Each bash call starts a new shell: in every later command, write `$PROJECT_ROOT`, `$OUT` and `$PLUGIN_ROOT` as the values this block printed. Write `$VIEWS` the same way. When `SCRIPT=missing`, tell the user the plugin root was not found, and stop. Every `handbook.mjs` command that reads the project takes `--project "$PROJECT_ROOT"`: it resolves every cited file under that root and refuses a candidate list that names another. When a `handbook.mjs` command exits 2 naming `$OUT/state.json.lock` and no other `handbook.mjs` command of this run is still running (this skill runs them one at a time), delete that lock file and run the command again; never delete it while a command runs.
3. Start over or resume:
   - With `--fresh`, run this block (write the values for `OUT`); it deletes `$OUT` only when it does not exist, is empty, or holds a `state.json` or `candidates.json` of this skill:
     ```bash
     OUT="<the value Phase 0 printed>"
     if [ -z "$OUT" ] || [ ! -e "$OUT" ] || [ -z "$(ls -A "$OUT")" ]; then
       echo "fresh: nothing to delete"
     elif [ "$(jq -r .format "$OUT/state.json" 2>/dev/null)" = "excavator-product-handbook-state/1" ] || [ "$(jq -r .format "$OUT/candidates.json" 2>/dev/null)" = "excavator-product-handbook-candidates/1" ]; then
       rm -rf -- "$OUT"; echo "fresh: deleted"
     else
       echo "fresh: refused, the directory holds other files"
     fi
     ```
     When it prints `fresh: refused, the directory holds other files`, tell the user `$OUT` holds other files, and stop.
   - Without `--fresh`, an `$OUT` that holds files of an earlier run is resumed: each phase below skips what its files already show done. `candidates.json` is kept as it is (a run over changed source needs `--fresh`). When `$OUT/map.json` exists, read its language with `jq -r .language "$OUT/map.json"`; when it differs from `$RUN_LANGUAGE`, tell the user to run again with `--fresh`, and stop. The fixed text (Phase 2) is written before the map, so an `$OUT` can hold a `ui.json` and no map: when `$OUT/ui.json` exists and `jq -r .language "$OUT/ui.json"` differs from `$RUN_LANGUAGE`, do the same. A `ui.json` written before the skill gained new fixed texts lacks their keys: for a run in another language Phase 2 finds it with `check-ui` (exit 1, one line for each missing key) and translates the table again; for a run in English delete `$OUT/ui.json` (the script then uses the shipped table), since Phase 2 has nothing to do for English. An `$OUT` from before the system overview has no `overview` key in `state.json`: the script reads that as planned with no attempt, so a resumed run writes the overview in Phase 3b and nothing is migrated; an overview that is already `checked`, `confirmed` or `verified` is not written again. A `domains.json` that passes `check-domains` is kept (Phase 3c), and an `$OUT` from before business domains gets one written there with nothing else rewritten.
   - Create `$OUT` when it does not exist (`mkdir -p "$OUT/entries"`) and continue with Phase 1.

---

## Phase 1: Candidates

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

When `$OUT/candidates.json` exists, skip the listing and read the header (second command). Otherwise list the entrypoint candidates, which are the pages, routes, scheduled jobs and program starts the script finds in the source:

```bash
node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" candidates "$PROJECT_ROOT" > "$OUT/candidates.json"
jq 'del(.items)' "$OUT/candidates.json"
jq -r '.items[] | [.id, .kind, .framework, "\(.file):\(.line)", .text] | @tsv' "$OUT/candidates.json"
```

The header says which frameworks were found, which have patterns (`covered`) and which have none (`uncovered`), and what the scan skipped. The frameworks always come from the project's build files (`detection.source` is `build-files`), even when `.excavator/` holds a knowledge graph: the script does not open it, and neither do you. Tell the user in one line which frameworks are `uncovered`: their pages and routes are not in the list, so the handbook may lack those features. Do not add candidates yourself: the list is the script's, and the conservation check counts exactly these ids.

---

## Phase 2: Fixed text

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The headings, table headers and other fixed words of `handbook.md` and of the page come from a table of fixed text that ships with this skill in English. This phase runs before the map on purpose: for a language with its own script the scripts check the narrative against the translated table (see **Language of the narrative** in Phase 3), so `check-map` and `check-entry` refuse a non-English run that has no checked `ui.json`.

- When `$RUN_LANGUAGE` is `English`, there is nothing to do: the script uses the shipped table.
- Otherwise, when `$OUT/ui.json` exists, run `check-ui` first; when it exits 0 skip the translation. Otherwise dispatch one subagent in the foreground with the prompt below, then check its file (`--language` is `$RUN_LANGUAGE`: there is no `map.json` yet to read the language from):
  ```bash
  node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-ui "$OUT" --language "$RUN_LANGUAGE"
  ```
  Exit 1 prints one line for each key that is missing or extra, each value that is empty and each `{placeholder}` that is lost or added. Delete the file (`rm -f "$OUT/ui.json"`) and dispatch the subagent once more with its prompt followed by this line and then each line printed: `Your previous attempt failed these checks; fix them and write the file again:`. When `check-ui` still exits 1, the run fails: tell the user the lines it printed, as printed, and stop; run no further phase.

The translation prompt:

````text
You translate the fixed text of a product handbook into $LANGUAGE.

Your scope. Read only `$PLUGIN_ROOT/skills/excavator-product-handbook/ui-strings.json`; read no other file and no code. It holds a `format`, a `language` and `strings`, an object from keys to English texts: headings, table headers, short labels, buttons and sentences of a document for readers who do not read code.

Translate every value into $LANGUAGE, in plain words, as short as the English. Keep every `{placeholder}` of a value exactly as written (same name, in braces) in the translated text, and add none: the program fills them with names, numbers and values. `page.documentTitle` is a pattern whose `{page}` receives the text of `page.nav.overview` or of `page.notFound.heading`, so write it to read right with either. Never translate a key. Add no key and leave none out.

Write only `$OUT/ui.json`, and nothing else anywhere, in this shape: `{"format": "excavator-product-handbook-ui/1", "language": "$LANGUAGE", "strings": {"<key>": "<translated value>", ...}}` with exactly the keys of the English file and a non-empty string for each.

Reply with one line: `ui: written`, and nothing else.
````

---

## Sections

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The phases from the map to the entries (Phases 3, 3c, 3b and 4) are not in this file. Each section of the handbook has its phases in a file of its own under `$PLUGIN_ROOT/skills/excavator-product-handbook/`, read only when the section is selected: `stages/map.md` holds Phase 3 (the map) and Phase 3c (the business domains), which the overview and the features both need; `sections/overview.md` holds Phase 3b (the system overview, section `overview`); `sections/features.md` holds Phase 4 (the entries, section `features`). `$SECTIONS` is the sections of this run: the `--sections` value, or all of them when it is not given.

1. Ask the script which files this run reads. Write the `--sections` value between the quotes (empty quotes when it is not given):
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" sections "<the --sections value, or empty>"
   ```
   On exit 1, tell the user the lines it printed (the values that are not sections and the valid ones), and stop. Otherwise record `$SECTIONS` as the value of the `SECTIONS=` line and the `READ=` lines, in the order printed, as the files to read.
2. Read each `READ=` file in that order with the Read tool, at `$PLUGIN_ROOT/skills/excavator-product-handbook/` followed by the path printed. Read a file at the moment you get there, not before: do that file's phases (each begins at its `## Phase` heading) before you read the next file. Read no file `sections` did not print, and never run a phase from memory.
3. A phase in a file you did not read does not run. Where the text of a phase says to go to Phase N and Phase N does not run in this run, go to the next phase this run runs.
4. Phases 5 and 6 take only the units of the selected sections: the system overview (the unit `overview`) only when `overview` is in `$SECTIONS`, and the features' entries only when `features` is. A unit of a section that is not selected is neither verified nor traced in this run, even when an earlier run left it `checked`. `--features` applies only to the `features` section: with `overview` alone, `select` still resolves the list (Phase 3), but no entry lane is dispatched.
5. Phase 7 does not look at `$SECTIONS`: it assembles what `$OUT` holds.

---

## Phase 5: Verify

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

A `checked` feature has an entry whose shape, citations, labels, numbers and words the scripts checked. That does not show that each item says what its passage does: a passage can be real and be read wrongly (a function name read as a role, a condition that stops two cases read as "every case"). Readers cannot read the code to find out, so each item is judged by a verifier that sees nothing of the map, the other features or the writer's reasons. A feature whose items both verifiers confirm (after an item either found contradicted was removed, and the one re-citing of the others, with what they still did not confirm removed) is `confirmed`: Phase 6 traces it, and only a `verified` feature is written into the handbook.

The system overview of Phase 3b goes through this phase and Phase 6 as one more unit, with the id `overview` where a step says `<id>`: the same `slices`, `verdicts`, prompts and rules, with these differences. Where a step says `check-entry`, run `check-overview "$OUT" --project "$PROJECT_ROOT"` for it; where the rewrite prompt says `try-entry "$OUT" <id>`, the rewriter runs `try-overview "$OUT"`, and its rule about roles from the map does not apply to the overview. The overview's state is under the key `overview` in `state.json`. The units of this phase are the overview, when its state is `checked` (the recipe of step 1), and the features that step 1 lists; the overview takes part whatever `--features` says.

1. List the features that need this phase, and for each whether it is at round 1 (`verify`) or waits for its one rewrite (`rewrite`):
   ```bash
   jq -r '.features | to_entries[] | select(.value.status == "checked") | [.key, (if .value.rewriting then "rewrite" else "verify" end)] | @tsv' "$OUT/state.json"
   ```
   Then the overview, which `state.json` keeps under its own key (nothing is printed when it is not `checked`):
   ```bash
   jq -r '(.overview // {status: "planned"}) | select(.status == "checked") | ["overview", (if .rewriting then "rewrite" else "verify" end)] | @tsv' "$OUT/state.json"
   ```
   A feature that is `confirmed`, `verified`, `failed`, `planned` or `dispatched` is not in the list, and the same holds for the overview: `confirmed` goes to Phase 6, `verified` is done, the others have no entry that passed the checks. With no unit in the lists, go to Phase 6.
   A resumed run continues each listed feature where its files show it stopped. At `verify`: when `$OUT/verdicts/round-1/<id>/` exists, run the `verdicts` command of step 3 for it first (it names the part-letters still to dispatch), and when that exits 1 start at step 2 (`slices` clears the older files of the feature); otherwise start at step 2. At `rewrite`: when `$OUT/verdicts/round-2/<id>/` exists, go to step 7 for it; when `$OUT/verify/round-2/<id>/` exists, go to step 6; otherwise go to step 4.
2. Cut each `verify` feature into items, one command per feature (the commands of a batch in one Bash command, one after another):
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" slices "$OUT" <id> --project "$PROJECT_ROOT"
   ```
   It prints `<id>: round 1, <n> items in <k> parts`, then one line per part, `Part <p>/<k>: Verify file: <path> | Verdict files: <path> <path>`: the verify file of that part and the two verdict files of its two verifiers (`part-<p>.a.json` and `part-<p>.b.json`). A feature with many items is cut into parts so that no verify file is more than a verifier can read at once (at most 25 items and about 60,000 bytes a part). Each item of a verify file has an id (its place in the entry), a claim (everything a reader is told by that item, with the context to read it: field, screen, side, operation) and the code its citations point to, 20 lines before and after each passage. Exit 1 prints why (the entry no longer passes its checks, or the source changed since the entry was checked) and a `Next:` line: follow it once; when it cannot be followed, leave the feature as it is. It stays `checked` and the handbook lists it as verification not finished.
3. Dispatch two subagents per part with the `excavator-handbook-verifier` agent type, one for each of the part's two verdict files, up to 10 in one message so they run concurrently; send the next 10 when those have returned. Why two: a single pass sometimes overlooks one wrong fact in a long claim, so two independent passes must both confirm an item. The two verifiers of a part get the same prompt, and only their own verdict path differs; they must not see each other's file, so never name one's file or verdicts to the other. The parts of one feature, and of different features, are independent of one another. The plugin registers that agent type, so there is no file to look for: name it as the subagent type. Dispatch them in the foreground, never as background tasks: a run without a terminal stops waiting for background subagents. Give each the prompt below with the verify file of its part's line and its own verdict file (the `.a.json` path for the first verifier, the `.b.json` path for the second) filled in, and nothing else: not the entry, the map, a summary or any reason.

````text
You are checking the items of one part of one feature of a product handbook against the code shown with them. Write nothing but the one output file named below.

Verify file:  <the verify file of the line>
Verdict file: <your verdict file of the line: its .a.json path or its .b.json path>

Read the verify file and nothing else, and write one verdict per item id as your agent definition says.
````

   When every verifier of every part of a feature has returned, record its verdicts, one command per feature and one at a time, never two at once:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" verdicts "$OUT" <id> --round 1 --project "$PROJECT_ROOT"
   ```
   - Exit 0 and `<id>: confirmed (<n> items)`: both verifiers confirmed every item, whatever the number of the feature's parts, and the feature is `confirmed`. Nothing more to do for it in this phase: Phase 6 traces it.
   - Exit 0 and `<id>: confirmed, <n> items removed`, then `No rewrite file: no item is left to rewrite`: round 1 removed the items either verifier judged `contradicted` (see the next bullet), and both verifiers confirmed every item left. The feature is `confirmed` and has no rewrite file. Nothing more to do for it in this phase: Phase 6 traces it.
   - Exit 0 and `<id>: <n> items to rewrite`, then `Rewrite file: <path>`, preceded by `<id>: <m> items removed` when round 1 removed any: an item either verifier judged `contradicted` was removed from the entry at once, together with what hangs on it, and is recorded in `state.json` with its claim, verdict and reason; the handbook's coverage section lists it. A removed item is never rewritten and never put back: a verifier reads only the code around the citations, so what it says the code "actually" does is not a basis for a new claim. The items the two verifiers did not both confirm and neither judged `contradicted` are `unverified`; they are in the rewrite file with the claim, the verdict and the reason of each. Go to step 4 for it.
   - Exit 0 and `<id>: failed at verify: no item could be proved`: round 1 removed every item that carried evidence, so nothing of the entry is left to prove. The feature is `failed`; its entry file stays for the user to see, and there is no rewrite file.
   - Exit 1: nothing was recorded. Each line says why, led by its part and verifier (`part <p><x>: ...`, `<x>` being `a` or `b`): that verdict file is missing (the verifier wrote nothing), or does not hold exactly one verdict for each item of that part (a verdict for an item of another part counts as extra), or a verdict is not one of the three words, or a reason is empty, has more than one line, names a file, or (for a verdict that is not `verified`, which readers see) holds a code-shaped word or, in a language with its own script, no letter of it. Dispatch a verifier once more for each part-letter the `Next:` line names (a file of its own: `1b` is the second verifier of part 1), and for no other. For a missing file, the prompt as it was. For a rejected file, the prompt followed by this line and then each line printed for that part-letter except the `Next:` line (the lines that start with `part <p><x>:`, without that start): `Your previous verdict file was rejected for these reasons; write it again:`. Delete the old verdict file of a rejected part-letter first (`rm -f "<the verdict file>"`). Then run `verdicts` again. When `verdicts` still exits 1, leave the feature as it is, `checked`: it is listed in the handbook as verification not finished. Never write or change a verdict yourself, and never edit `state.json`.
4. Rewrite, once. For each feature with a rewrite file, dispatch one rewrite subagent (a general-purpose subagent, in the foreground, up to `$CONCURRENCY` in one message) with the prompt below, its placeholders filled in:

````text
You correct some items of one entry of a product handbook, for readers who do not read code, so that each says only what the source of the project at $PROJECT_ROOT shows. Your feature: <id>.

Your scope. Read `<the rewrite file>`: the items a verifier could not confirm, each with its id (its place in the entry), its claim, its verdict and its reason. Every one is `unverified`: the code the verifier saw neither supports nor denies the item. The reason says what the verifier could not find in the code it was shown; it is not a statement about what the code does, so never change an item's text because of it. Read `$OUT/entries/<id>.json`, the entry you change, and the source files its listed items cite; search the project when you need another passage. The unchanged entry of round 1 is `$OUT/verify/round-1/<id>.entry.json`; read it only to put an item back as it was (it still holds the items round 1 removed: never put those back; an item after a removed one has a lower place in your entry than in that file). Read code only; never run, build or change anything in the project. Never read anything under `.excavator/` except those files of this run, and never read a document that an Excavator skill generated (PRD.md, handbook.md, reports, findings, tours). Exclude `.excavator`, `.git`, `node_modules`, `vendor`, `dist` and `build` from every search.

What you do. For each listed item, in the entry file, do one thing: change its citations only. Swap a citation for another passage, or add one, so that the passage by itself proves the item as it is written (for who may do something, the condition the code checks, not the name of a function or variable). The text of the item stays word for word as it is, and so do the screen name, field label or operation name it is written under: do not narrow, widen, correct or reword it, even when the code you read shows that the text is wrong. A wrong text is not yours to fix.
When an item cannot be saved (no passage proves it as it is written), leave it exactly as it is: the script removes it after the second check. Never delete or add an item, and never move one into `unknowns`.
Change nothing else. An item that is not listed stays exactly as it is: its text, its citations, and also the screen name, field label or operation name its claim is written under. A script compares the entry with round 1 and refuses an entry in which an item is missing or added, or an item that is not listed differs, or a listed item's text differs (only its citations may change). The items that hang on a listed item (the fields and rules of a listed screen, the rules of a listed field) count as listed: their citations may change, their text may not.

Every rule of the original entry still holds: the same shape and keys; every label and number of an item occurs in that item's own passages; no code-shaped words in reader text; roles only from the map's list (<roles, one label per line>); numbers as Arabic numerals; narrative in `$LANGUAGE`; labels exactly as the source writes them; no advice and no opinion.

Check your file before you reply. Run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" try-entry "$OUT" <id> --project "$PROJECT_ROOT"` and `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" slices "$OUT" <id> --round 2 --project "$PROJECT_ROOT"`. The first runs the checks of the entry and records nothing. The second prints each item that is missing or added, each item that is not listed and that you changed, and each listed item whose text you changed, when there is one: put it back as it is in the round 1 entry and keep only the new citations. Fix the file for every line either prints and run both again until `try-entry` prints `<id>: ok` and `slices` prints its `Verify file:` line, at most 5 runs.

Write only `$OUT/entries/<id>.json`, and nothing else anywhere. Reply with one line: `<id>: rewritten`, and nothing else.
````

5. As each rewrite subagent returns, check its entry and cut the rewritten items, one command at a time:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-entry "$OUT" <id> --project "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" slices "$OUT" <id> --round 2 --project "$PROJECT_ROOT"
   ```
   - `check-entry` exit 1: the feature is `failed` at the step `rewrite`; there is no second rewrite. Leave it and go on with the next feature.
   - `slices` exit 1: the rewrite changed an item that was not listed, or changed the text of a listed item (its line reads `<item id>: listed for rewriting, but its claim changed; only its citations may change`), or deleted or added an item, and the lines name each path. There is no second rewrite: leave the feature as it is, `checked`; it is listed in the handbook as verification not finished.
   - `slices` exit 0 prints the `Part <p>/<k>:` lines with the `Verify file:` and `Verdict files:` paths for round 2, and holds only the listed items and the items that hang on them.
6. Dispatch the verifiers of round 2 as in step 3, two per part: the same agent type, the same prompt with the round 2 paths, up to 10 in one message, in the foreground; an item is verified only when both confirm it, as in round 1. Round 2 holds only the rewritten items, so it usually has one part. A verdict file that is missing or rejected is dispatched once more as in step 3; when it still fails, leave the feature as it is.
7. Settle each feature:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" verdicts "$OUT" <id> --round 2 --project "$PROJECT_ROOT"
   ```
   - `<id>: confirmed (<n> items)` or `<id>: confirmed, <n> items removed`: the feature is `confirmed`. An item the two verifiers did not both confirm, `unverified` like `contradicted`, was removed from the entry together with what hangs on it, and is recorded in `state.json` with its claim, verdict and reason. The handbook's coverage section lists each removed item. The removal is not a rewrite: never put a removed item back.
   - The purpose is an item like any other: when the two verifiers do not both confirm it, it is removed and recorded, and the feature stays confirmed. Its section is then missing from the handbook and the page, and the coverage section lists the removed purpose.
   - `<id>: failed at verify: no item could be proved`: nothing of the entry was proved. It is `failed`; its entry file stays for the user to see.
   - Exit 1: nothing was recorded; handle it as in step 3 (dispatch the verifier once more with the printed lines, then leave the feature as it is).

Then tell the user `Verify <id> <n>/<N>: <status>` for each unit, where `<n>` counts the units of this phase that are settled, `<N>` is the number of units step 1 listed (features and overview) and `<status>` is `confirmed`, `failed` or `not finished`, in `$LANGUAGE`.

Never edit `entries/<id>.json`, a verify, verdict or rewrite file or `state.json` yourself. Statuses change only through the commands above.

---

## Phase 6: Trace

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

A `confirmed` feature has items that two verifiers, who saw only the lines each item cites, both confirmed. That does not show that nothing else in the project contradicts them: the condition may sit in a function the cited lines call, a cap may be applied before a sum, a position may come out one off when the code is run through by hand. A tracer reads the whole project, starting from the cited lines, and looks only for code that contradicts an item; two tracers do it for each part, independently, and an item either contradicts is removed and listed in the coverage section. Only a `verified` feature is written into the handbook. The system overview is traced like a feature, with the id `overview`: the same `trace`, `trace-verdicts`, prompts and rules.

1. List the features that need this phase, and the overview when it is `confirmed`:
   ```bash
   jq -r '.features | to_entries[] | select(.value.status == "confirmed") | .key' "$OUT/state.json"
   jq -r '(.overview // {status: "planned"}) | select(.status == "confirmed") | "overview"' "$OUT/state.json"
   ```
   With no unit in the lists, go to Phase 7. A resumed run needs nothing else: a `confirmed` feature goes straight to this phase, wherever the earlier run stopped. When `$OUT/trace-verdicts/<id>/` exists, run the `trace-verdicts` command of step 3 for it first (it names the part-letters still to dispatch), and when that exits 1 start at step 2 (`trace` clears the older files of the feature); otherwise start at step 2.
2. Write the trace files, one command per feature (the commands of a batch in one Bash command, one after another):
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" trace "$OUT" <id> --project "$PROJECT_ROOT"
   ```
   It prints `<id>: <n> items in <k> parts`, then one line per part, `Part <p>/<k>: <m> items | Trace file: <path> | Verdict files: <path> <path>`: the trace file of that part and the two verdict files of its two tracers (`part-<p>.a.json` and `part-<p>.b.json`). A trace file holds, for each item still in the entry, its id, its claim and the files and line ranges it cites, and no code; a part holds at most 25 items. Exit 1 prints why (the feature is not `confirmed`, or its entry changed after it was confirmed or no longer passes its checks) and a `Next:` line: follow it once; when it cannot be followed, leave the feature as it is. It stays `confirmed` and the handbook lists it as verification not finished.
3. Dispatch two subagents per part with the `excavator-handbook-tracer` agent type, one for each of the part's two verdict files, up to 10 in one message so they run concurrently; send the next 10 when those have returned. Why two: a single trace sometimes misses counter-evidence that a second independent trace of the same file finds, so an item is removed when either finds it. The two tracers of a part get the same three lines, and only their own verdict file differs; they must not see each other's file, so never name one's file or verdicts to the other. The parts of one feature, and of different features, are independent of one another. The plugin registers that agent type, so there is no file to look for: name it as the subagent type. Dispatch them in the foreground, never as background tasks: a run without a terminal stops waiting for background subagents. Give each the three lines below with the trace file of its part's line, its own verdict file (the `.a.json` path for the first tracer, the `.b.json` path for the second) and `$PROJECT_ROOT` written as its value, and nothing else: not the entry, the map, a summary, a hint about what to look for or any reason.

````text
Trace file:   <the trace file of the line>
Verdict file: <your verdict file of the line: its .a.json path or its .b.json path>
Project root: <$PROJECT_ROOT as its value>
````

   When every tracer of every part of a feature has returned, record its verdicts, one command per feature and one at a time, never two at once:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" trace-verdicts "$OUT" <id> --project "$PROJECT_ROOT"
   ```
   - Exit 0 and `<id>: verified (<n> items)`: neither tracer found code that contradicts an item, and the feature is `verified`, whatever the number of its parts. Nothing more to do for it.
   - Exit 0 and `<id>: verified, <n> items removed`: either tracer pointed at code that contradicts some items. Each was removed from the entry together with what hangs on it, and is recorded in `state.json` with its claim, its reason and where the code is (the readers of the handbook see the reason, not the place). The feature is `verified` without them, and the handbook's coverage section lists each removed item. The removal is not a rewrite: never put a removed item back.
   - Exit 0 and `<id>: failed at trace: no item could be proved`: no item with a source was left. It is `failed`; its entry file stays for the user to see.
   - Exit 1: nothing was recorded. Each line says why, led by its part and tracer (`part <p><x>: ...`, `<x>` being `a` or `b`): that verdict file is missing or is not JSON, or does not hold exactly one verdict for each item of that part (a verdict for an item of another part counts as extra), or a verdict is not `holds` or `contradicted`, or a reason is empty or has more than one line, or a `contradicted` item has no position, or its position is a file outside the project or one that does not exist or a line that is not in the file, or its reason holds a code-shaped word or a file name or, in a language with its own script, no letter of it. Dispatch a tracer once more for each part-letter the `Next:` line names (a file of its own: `1b` is the second tracer of part 1), and for no other. For a missing file, the three lines as they were. For a rejected file, the three lines followed by this line and then each line printed for that part-letter except the `Next:` line (the lines that start with `part <p><x>:`, without that start): `Your previous verdict file was rejected for these reasons; write it again:`. Delete the old verdict file of a rejected part-letter first (`rm -f "<the verdict file>"`). Then run `trace-verdicts` again. When it still exits 1, leave the feature as it is, `confirmed`: it is listed in the handbook as verification not finished. Never write or change a verdict yourself, and never edit `state.json`.

Then tell the user `Trace <id> <n>/<N>: <status>` for each unit, where `<n>` counts the units of this phase that are settled, `<N>` is the number of units step 1 listed (features and overview) and `<status>` is `verified`, `failed` or `not finished`, in `$LANGUAGE`.

Never edit `entries/<id>.json`, a trace or verdict file or `state.json` yourself. Statuses change only through the commands above.

---

## Phase 7: Assemble, page and reply

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

1. Assemble the handbook and write the page:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" assemble "$OUT" --project "$PROJECT_ROOT" --views "$VIEWS"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" page "$OUT" --project "$PROJECT_ROOT" --views "$VIEWS"
   ```
   Both check the map, every verified entry (a confirmed one too, which they do not write) and the fixed text again before they write anything. Each of them groups the features by the business domains of `domains.json` and falls back to the areas of the map when that file is missing or does not pass `check-domains`, and says so in a fixed text. Only a `verified` feature has a section in the handbook. `assemble` writes `$OUT/handbook.md` (the system overview first, which the script writes from the verified overview and its own counts, or a line saying where the overview stopped and the table of domains when the overview is not verified; then the domains and their features, one section per verified feature, each with the area of the navigation it sits in, and a coverage section with the candidate counts, the unassigned candidates, the features reached by a link, the features without a verified entry, among them those whose verification or trace did not finish, and the items verification and the trace removed, each with its reason, the overview's included) and prints its path; between the feature sections and the coverage section it has two tables across features, every notification of the verified entries and one row for every scheduled-job candidate with the schedule its registration line gives, which the script writes from the verified entries and the source, so you write nothing for them. After the tables it has the entity sections, all computed by the script from the verified entries and the source, so you write nothing for them either: the domains (each with only the purposes of its verified features), the roles (what the verified entries say each role can do) and a matrix of roles by feature, and, in the technical view only, the applications (the features whose quoted passages fall in each), the external systems (the callers the quoted code shows and, kept apart, the applications whose source contains the system's name) and a matrix of applications by domain. `$VIEWS` decides what is written: `assemble` writes `$OUT/handbook.md` for the product view and `$OUT/handbook-technical.md` for the technical view, which also shows the file and lines of the passages quoted for each item, prints the path of each, and removes the file of a view that `$VIEWS` does not have. `page` writes `$OUT/handbook.html`, one page that opens from disk with a double click, with the same two tables on pages of their own, the entity pages and the two matrices too, and, when `$VIEWS` has both views, a switch in its top bar that stays on the same entity, and prints its path; a failed `page` removes the page an earlier run left.
   - When `assemble` exits 1, show the lines. A line that says `entries/<id>.json no longer passes check-entry` (for the overview, `entries/overview.json no longer passes check-overview`) means the source changed after the entry was checked: run `check-entry` for that feature (`check-overview` for the overview), follow its `Next:` line as in Phase 4 (as in Phase 3b for the overview), verify it again as Phase 5 says and trace it as Phase 6 says, and run `assemble` again. A line that says `entries/<id>.json changed after it was verified` (or `confirmed`) means the entry file is not the one the verifiers and the tracers judged: run `check-entry` for that feature (it becomes `checked` again), verify it again as Phase 5 says and trace it as Phase 6 says, and run `assemble` again. Any other line: stop.
   - When `page` exits 2 because the page template does not exist, tell the user to run `pnpm -r build` at `$PLUGIN_ROOT` and then run this command again (a run resumes, so only this phase repeats). Any other non-zero exit: tell the user the lines it printed as they are; do not build or edit any page or product file yourself. Either way, go on to the reply: it prints `Page: not written`.
   - Then tell the user `Page: <status>`, where `<status>` is `written` or `failed`, in `$LANGUAGE`.
2. Reply. The handbook stays in `$OUT`: write it into the project only when the user says so.

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

Then print the reply's lines with this command:

```bash
node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" reply "$OUT" --project "$PROJECT_ROOT" --views "$VIEWS"
```

It prints, in this order: `Handbook:` and the path of `handbook.md`, when `$VIEWS` has the product view; `Technical handbook:` and the path of `handbook-technical.md`, when it has the technical view; `Page:` and the path of `handbook.html`, or `Page: not written`; `Features:` and the count of each status; `Overview:` and the status of the system overview (`planned` when it was never written); `Failed:` and the ids, when a feature or the overview failed; `Candidates:` and the conservation line. When it prints `<file>: missing` (`handbook.md` or `handbook-technical.md`), run `assemble` and then this command again; when it exits 1 with other lines, show the lines and stop. Reply with exactly the lines it prints and nothing else: the same lines in the same order, none added and none left out. Write nothing before, between or after them, no word on the checks, the handbook or what was done, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply. When `$LANGUAGE` is not English, translate the words of those lines; the paths, the numbers and the ids stay as they are.
