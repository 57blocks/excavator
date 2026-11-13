---
name: excavator-product-handbook
description: Write a product handbook for non-technical readers from a project's source - a system chapter (what the system is, who uses it, its applications, stores and external systems), a map of the product's areas and features, one chapter per feature with its screens, fields, rules, states, notifications and problems, and chapters across the features (domains, roles, notifications and jobs, cross-cutting topics, defects with levels, remedies), each written once by a subagent as Markdown in which every fact cites the file and lines it rests on, checked by one script, assembled into handbook.md and a one-file HTML page in the language you choose (English by default), as a product view, a technical view or both. A script lists the entrypoint candidates and checks the map, you write the map and the outline, one subagent per feature writes its chapter. Runs resume where they stopped, and can write only some sections or features. It describes the product as it is and gives no advice, except in its remedies chapter.
argument-hint: "[path] [--language <lang>] [--out <dir>] [--features <list>] [--views <list>] [--sections <list>] [--concurrency <n>] [--fresh]"
---

# /excavator-product-handbook

Write a **product handbook**: a document for people who use or manage the product and do not read code. It describes what the product **actually does today**, reverse-engineered from the source, organized the way a reader sees the product: first the system as a whole, then the business domains and the people, then the features in each domain with their screens, fields, rules, states, notifications and automatic behavior, then what crosses the features, and last the defects and the remedies.

Five rules govern everything below:

1. **As-Is only, no advice, except the remedies.** Every chapter describes behavior that exists in the code. Only the remedies chapter (Phase 8) says what to do. The `Problems` sections and the defects chapter state defects and nothing else. Where the code does not settle something, the chapter says so under its open questions, with what was searched.
2. **Nothing is dropped silently.** A script lists the entrypoint candidates (pages, routes, scheduled jobs, program starts). Every candidate belongs to exactly one feature or is listed as unassigned with a reason, and a script checks it. Every feature of the map gets a chapter.
3. **Every fact cites its lines.** Each sentence, list item and table row that states a fact ends with the file and lines of the project it rests on. A chapter across features copies the citations of the chapter lines it rests on and reads no code.
4. **Readers see no code, and can scan.** Reader text has no code-shaped words; chapters are headings, short paragraphs, lists, tables and diagrams, never a wall of text.
5. **Every chapter is written once, checked by a script, and marked as not checked sentence by sentence.** `check` refuses a chapter whose citations do not resolve, whose facts lack citations, whose reader text holds code or advice, whose paragraphs are too long or whose required sections are missing. A refused chapter is written once more with the reasons; a chapter refused twice stays as written and is marked as not passing. No verifier reads a chapter after its check, and every chapter starts with a fixed sentence that says so. What a script computes (the data, the status dictionary, the code health) is not marked.

## How the work is split

| Who | Does |
|---|---|
| `handbook.mjs` (a script, no model) | Lists the entrypoint candidates and the application roots, checks the map and its conservation, resolves `--features`, prints the phase files a run reads, writes the data, the status dictionary and the code health, checks every chapter (`check`) and records the result, checks the fixed-text table, assembles `handbook.md` (and `handbook-technical.md`), writes `handbook.html` and prints the closing lines. |
| You (the orchestrator) | Write the map (Phase 3) and the outline (Phase 9), dispatch every writer and the translation of the fixed text, run the checks, and reply. |
| One `excavator-handbook-writer` subagent for the system (Phase 4) | Reads the manifests, configuration, start-up, registration and deployment files of every application root, and writes `chapters/system.md`. |
| One `excavator-handbook-writer` subagent per feature (Phase 5) | Reads the feature's seed files and follows the code out of them, and writes `chapters/<id>.md`, with its open questions and its problems. |
| One `excavator-handbook-writer` subagent per cross chapter (Phase 8) | Reads only the chapters already written, and writes `chapters/<name>.md` for `domains`, `roles`, `notifications`, `topics`, `defects` or `remedies`. |
| One `excavator-handbook-writer` subagent for the fixed text (only when the language is not English) | Translates the fixed-text table and writes `ui.json`. |

The text of the phases is split by section. This file holds Phases 0 to 2, the Sections part and Phase 10; the other phases are in `stages/` and `sections/`, each read only when the run needs it (see Sections).

## Files

All under `$OUT`:

| File | Written by |
|---|---|
| `candidates.json` | `handbook.mjs candidates` (Phase 1) |
| `ui.json` | the translation subagent (Phase 2); for English, none: the script uses its shipped table |
| `map.json` | you (Phase 3) |
| `chapters/system.md` | the system subagent (Phase 4) |
| `chapters/<id>.md` | the subagent of feature `<id>` (Phase 5) |
| `data.json`, `dictionaries.json` | `handbook.mjs data` (Phase 6) |
| `entries/history.json` | `handbook.mjs history` (Phase 7) |
| `chapters/domains.md`, `roles.md`, `notifications.md`, `topics.md`, `defects.md`, `remedies.md` | one subagent each (Phase 8) |
| `outline.json` | you (Phase 9) |
| `state.json` | `handbook.mjs check` only: the result, attempts and reasons of each chapter |
| `handbook.md`, `handbook-technical.md` | `handbook.mjs assemble` (Phase 10) |
| `handbook.html` | `handbook.mjs page` (Phase 10) |

## Options

`$ARGUMENTS` may contain:
- A directory path - the project to document (default: current working directory).
- `--language <lang>` - the language of the chapters, the area names, the fixed text and everything said to the user during the run; English when it is not given. Labels quoted from the source stay in their source language.
- `--out <dir>` - where the run's files, the handbook and the page go (default: `<project>/.excavator/product-handbook`).
- `--features <list>` - write chapters only for these features, as a comma-separated list of feature ids or feature names (a name is matched ignoring case, as a whole name). The map still covers every candidate; a feature without a chapter is listed in the handbook as not written, and the cross chapters wait until every feature has one. Feature ids exist only after the map is written, which is why names are accepted: Phase 3 resolves the list with `select`.
- `--views <list>` - which views are written: `product`, `technical` or both separated by a comma (default: `product`). The product view shows no file paths; the technical view shows each citation as a file and its lines. With both, the page has a switch between them that stays on the same chapter. The option only decides what `assemble`, `page` and `reply` write, and is not recorded.
- `--sections <list>` - which sections this run writes: `system`, `features`, `domains`, `roles`, `notifications`, `topics`, `defects`, `remedies` (each a chapter or, for `features`, one per feature), `data` and `history` (written by scripts) and `outline` (written by you), separated by a comma (default: all). The option only decides which phases run and is not recorded: running again with other sections never writes again a chapter that passed, and Phase 10 assembles whatever `$OUT` holds.
- `--concurrency <n>` - how many writers run at once (default: 3).
- `--fresh` - start over instead of resuming an earlier run in the same `--out`.

**Resuming.** A run that stops for any reason (a closed terminal, a spent budget, an error) is resumed by running the same command again on the same `--out`, without `--fresh`: every phase skips what its files and `state.json` show done, and a chapter written but not yet checked is checked first. A run without a terminal (for example `claude -p`) is complete only when its reply ends with `Run: complete`; the host's own exit status or result type does not say so.

## Sources

Read only the project's source code and configuration. Never read anything under `.excavator/` (except the files of this run in `$OUT`, which you write and check), and never read a document that an Excavator skill generated (`PRD.md`, `handbook.md`, reports, findings, tours): a handbook built from another generated document proves nothing about the code. Never run, build or change anything in the project. Write only under `$OUT`. Never copy a secret, a password, a key or a token into any file. This skill never runs `/excavator` or any command that rebuilds the facts in `.excavator/`.

---

## Phase 0: Setup

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

1. Resolve `PROJECT_ROOT` from the path argument (default: `pwd`). Parse `--language` (`$LANGUAGE`: English when it is not given), `--out` (`$OUT`, default `$PROJECT_ROOT/.excavator/product-handbook`), `--features` (`$FEATURES`: the value, or none), `--views` (`$VIEWS`: the value, or `product` when it is not given; when it holds anything but `product` and `technical`, separated by a comma, tell the user those two values and stop), `--sections` (the value, or empty when it is not given; the Sections part checks it), `--concurrency` (`$CONCURRENCY`, default `3`) and `--fresh`. The run's language name, `$RUN_LANGUAGE`, is `English` whenever `$LANGUAGE` is English however it was spelled (`en`, `english`), and `$LANGUAGE` as given otherwise; the script treats only the name `English` as English.
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
   Each bash call starts a new shell: in every later command, write `$PROJECT_ROOT`, `$OUT`, `$PLUGIN_ROOT` and `$VIEWS` as the values this block printed. When `SCRIPT=missing`, tell the user the plugin root was not found, and stop. Every `handbook.mjs` command that reads the project takes `--project "$PROJECT_ROOT"`. When a `handbook.mjs` command exits 2 naming `$OUT/state.json.lock` and no other `handbook.mjs` command of this run is still running (this skill runs them one at a time), delete that lock file and run the command again; never delete it while a command runs.
3. Start over or resume:
   - With `--fresh`, run this block (write the value for `OUT`); it deletes `$OUT` only when it does not exist, is empty, or holds a `state.json` or `candidates.json` of this skill:
     ```bash
     OUT="<the value Phase 0 printed>"
     STATE_FORMAT=$(jq -r .format "$OUT/state.json" 2>/dev/null)
     if [ -z "$OUT" ] || [ ! -e "$OUT" ] || [ -z "$(ls -A "$OUT")" ]; then
       echo "fresh: nothing to delete"
     elif [ "$STATE_FORMAT" = "excavator-product-handbook-state/1" ] || [ "$STATE_FORMAT" = "excavator-product-handbook-state/2" ] || [ "$(jq -r .format "$OUT/candidates.json" 2>/dev/null)" = "excavator-product-handbook-candidates/1" ]; then
       rm -rf -- "$OUT"; echo "fresh: deleted"
     else
       echo "fresh: refused, the directory holds other files"
     fi
     ```
     When it prints `fresh: refused, the directory holds other files`, tell the user `$OUT` holds other files, and stop.
   - Without `--fresh`, an `$OUT` that holds files of an earlier run is resumed. First check its version: when `jq -r .format "$OUT/state.json"` prints `excavator-product-handbook-state/1`, the directory is from an older version of this skill: tell the user to run again with `--fresh`, and stop. `candidates.json` is kept as it is (a run over changed source needs `--fresh`). When `$OUT/map.json` exists and `jq -r .language "$OUT/map.json"` differs from `$RUN_LANGUAGE`, tell the user to run again with `--fresh`, and stop; do the same when `$OUT/ui.json` exists and `jq -r .language "$OUT/ui.json"` differs from `$RUN_LANGUAGE`.
   - Create `$OUT` when it does not exist (`mkdir -p "$OUT/chapters"`) and continue with Phase 1.

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

The headings, table headers and other fixed words of the handbook and of the page come from a table of fixed text that ships with this skill in English. Every chapter uses three of them: the headings of its open questions and its problems, and the line written under a heading that has nothing.

- When `$RUN_LANGUAGE` is `English`, there is nothing to translate: the script uses the shipped table.
- Otherwise, when `$OUT/ui.json` exists, run `check-ui` first; when it exits 0 skip the translation. Otherwise dispatch one `excavator-handbook-writer` subagent in the foreground with the prompt below, then check its file:
  ```bash
  node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-ui "$OUT" --language "$RUN_LANGUAGE"
  ```
  Exit 1 prints one line for each key that is missing or extra, each value that is empty and each `{placeholder}` that is lost or added. Delete the file (`rm -f "$OUT/ui.json"`) and dispatch the `excavator-handbook-writer` subagent once more with its prompt followed by this line and then each line printed: `Your previous attempt failed these checks; fix them and write the file again:`. When `check-ui` still exits 1, the run fails: tell the user the lines it printed, as printed, and stop.

Then print the texts every writer's prompt uses:

```bash
UI="$OUT/ui.json"; [ -f "$UI" ] || UI="$PLUGIN_ROOT/skills/excavator-product-handbook/ui-strings.json"
jq -r '.strings | "OPEN_QUESTIONS=\(.["chapter.openQuestions"])", "PROBLEMS=\(.["chapter.problems"])", "NONE=\(.["chapter.none"])", "S_OVERVIEW=\(.["chapter.section.overview"])", "S_SCREENS=\(.["chapter.section.screens"])", "S_OPERATIONS=\(.["chapter.section.operations"])", "S_RULES=\(.["chapter.section.rules"])", "S_STATES=\(.["chapter.section.states"])", "S_NOTIFICATIONS=\(.["chapter.section.notifications"])", "S_HANDOVERS=\(.["chapter.section.handovers"])", "SERVER_STEPS=\(.["chapter.serverSteps"])"' "$UI"
```

In every prompt of this run, write `$OPEN_QUESTIONS`, `$PROBLEMS`, `$NONE`, `$S_OVERVIEW`, `$S_SCREENS`, `$S_OPERATIONS`, `$S_RULES`, `$S_STATES`, `$S_NOTIFICATIONS`, `$S_HANDOVERS` and `$SERVER_STEPS` as the values it printed, exactly as printed.

The translation prompt:

````text
You translate the fixed text of a product handbook into $LANGUAGE.

Your scope. Read only `$PLUGIN_ROOT/skills/excavator-product-handbook/ui-strings.json`; read no other file and no code. It holds a `format`, a `language` and `strings`, an object from keys to English texts: headings, table headers, short labels, buttons and sentences of a document for readers who do not read code.

Translate every value into $LANGUAGE, in plain words, as short as the English. Keep every `{placeholder}` of a value exactly as written (same name, in braces) in the translated text, and add none: the program fills them with names, numbers and values. Never translate a key. Add no key and leave none out.

Keep the formal register of a reference document for every heading and label: noun phrases, not conversational questions (no "who can..." or "where to..." in the target language).

Write only `$OUT/ui.json`, and nothing else anywhere, in this shape: `{"format": "excavator-product-handbook-ui/1", "language": "$LANGUAGE", "strings": {"<key>": "<translated value>", ...}}` with exactly the keys of the English file and a non-empty string for each.

Reply with one line: `ui: written`, and nothing else.
````

---

## Sections

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

Phases 3 to 9 are in files of their own under `$PLUGIN_ROOT/skills/excavator-product-handbook/`, each read only when a selected section needs it: `stages/map.md` (Phase 3, the map, which every written chapter needs), `sections/system.md` (Phase 4, section `system`), `sections/features.md` (Phase 5, section `features`), `sections/data.md` (Phase 6, section `data`, no map needed), `sections/history.md` (Phase 7, section `history`, no map needed), `sections/cross.md` (Phase 8, sections `domains`, `roles`, `notifications`, `topics`, `defects` and `remedies`) and `stages/outline.md` (Phase 9, section `outline`). `$SECTIONS` is the sections of this run: the `--sections` value, or all of them when it is not given.

1. Ask the script which files this run reads. Write the `--sections` value between the quotes (empty quotes when it is not given):
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" sections "<the --sections value, or empty>"
   ```
   On exit 1, tell the user the lines it printed (the values that are not sections and the valid ones), and stop. Otherwise record `$SECTIONS` as the value of the `SECTIONS=` line, and the `READ=` lines, in the order printed, as the files to read.
2. Read each `READ=` file in that order with the Read tool, at `$PLUGIN_ROOT/skills/excavator-product-handbook/` followed by the path printed. Read a file when you get to it, not before, and do its phases before you read the next file. Read no file `sections` did not print, and never run a phase from memory. Read every file it printed, also when `$OUT` already shows its phases done: whether a phase has work is decided by its own first step.
3. A phase in a file you did not read does not run. Where the text of a phase says to go to Phase N and Phase N does not run in this run, go to the next phase this run runs.
4. A phase writes only the chapters of the sections in `$SECTIONS`; a chapter of a section that is not selected is not written in this run, whatever an earlier run left. `--features` applies only to Phase 5.
5. Phase 10 does not look at `$SECTIONS`: it assembles what `$OUT` holds. Assembling needs the map, so when only `data` and `history` are selected and `$OUT/map.json` does not exist, the run ends after their phases, and their files are the whole result.

---

## Phase 10: Assemble, page and reply

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

1. Assemble the handbook and write the page:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" assemble "$OUT" --project "$PROJECT_ROOT" --views "$VIEWS"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" page "$OUT" --project "$PROJECT_ROOT" --views "$VIEWS"
   ```
   `assemble` joins the chapters in the order of `outline.json` (or the default order when there is none or it does not hold every chapter exactly once), adds the data, the status dictionary and the code health that the scripts wrote, and ends with the coverage section: the candidate counts, the unassigned candidates, the features reached by a link, the features without a chapter, every chapter that did not pass its check with its number of reasons, and which outline was used. Every chapter starts with the fixed sentence that it was not checked sentence by sentence; a chapter that did not pass also says so. It writes `$OUT/handbook.md` for the product view (citations removed) and `$OUT/handbook-technical.md` for the technical view (citations shown), as `$VIEWS` says, and removes the file of a view `$VIEWS` does not have. `page` writes `$OUT/handbook.html`, one page that opens from disk with a double click, rendered from the same chapters, with the tables, lists and diagrams drawn, a navigation by the outline's parts and, with both views, a switch that stays on the same chapter; when its data is larger than 32 MB it also writes the folder `handbook-data/` next to it, which has to stay beside `handbook.html`.
   - When `assemble` prints lines that start `Outline:`, the outline does not hold every chapter exactly once: fix `outline.json` for those lines (Phase 9) and run `assemble` again, at most twice; then leave it.
   - When `assemble` exits 1 with other lines, show them and stop.
   - When `page` exits 2 because the page template does not exist, tell the user to run `pnpm -r build` at `$PLUGIN_ROOT` and then run this command again (a run resumes, so only this phase repeats). Any other non-zero exit: tell the user the lines it printed as they are; do not build or edit any page or product file yourself. Either way, go on to the reply: it prints `Page: not written`.
   - Then tell the user `Page: <status>`, where `<status>` is `written` or `failed`, in `$LANGUAGE`.
2. Reply. The handbook stays in `$OUT`: write it into the project only when the user says so.

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

Then print the reply's lines with this command:

```bash
node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" reply "$OUT" --project "$PROJECT_ROOT" --views "$VIEWS"
```

It prints, in this order: `Handbook:` and the path of `handbook.md`, when `$VIEWS` has the product view; `Technical handbook:` and the path of `handbook-technical.md`, when it has the technical view; `Page:` and the path of `handbook.html`, or `Page: not written`; `Chapters:` and the counts of passed, failed and not written; `Failed:` and the chapter names, when one failed; `Not written:` and the feature ids, when a feature has no chapter; `Candidates:` and the conservation line; and last `Run: complete` or `Run: incomplete (<n> not written, <m> failed once); the same command on the same --out resumes`. The `Run:` line is copied exactly as printed, never translated, in every language. When it prints `<file>: missing` (`handbook.md` or `handbook-technical.md`), run `assemble` and then this command again; when it exits 1 with other lines, show the lines and stop. Reply with exactly the lines it prints and nothing else: the same lines in the same order, none added and none left out. Write nothing before, between or after them, no word on the checks, the handbook or what was done, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply. When `$LANGUAGE` is not English, translate the words of those lines except the `Run:` line; the paths, the numbers and the ids stay as they are.
