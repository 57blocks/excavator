---
name: excavator-product-handbook
description: Write a product handbook for non-technical readers from a project's source - a system overview (what the system is, who uses it, its applications and the external systems it calls), a map of the product's areas and features, one entry per feature with its screens, fields, rules, states and notifications, every value checked against a passage quoted from the source and every item confirmed by two verifiers that see only that item and the code it cites and then by two tracers that each read the whole project for code that contradicts it, assembled into handbook.md and a one-file HTML page in the language you choose, as a product view, a technical view or both. A script lists the entrypoint candidates and checks every step, you write the map, one subagent per feature writes its entry and others check it. It describes the product as it is and gives no advice, except in its remedies chapter, which says what to do about the findings it lists.
argument-hint: "[path] [--language <lang>] [--out <dir>] [--features <list>] [--applications <list>] [--views <list>] [--sections <list>] [--concurrency <n>] [--fresh]"
---

# /excavator-product-handbook

Write a **product handbook**: a document for people who use or manage the product and do not read code. It describes what the product **actually does today**, reverse-engineered from the source, organized the way a reader sees the product: first the system as a whole (what it is, who uses it, its applications and external systems), then the business domains (the kinds of business the product handles, which can cover several areas of its navigation), then the features in each domain, then each feature's screens, fields, rules, states, notifications and automatic behavior.

Five rules govern everything below:

1. **As-Is only, no advice, except the remedies.** Describe behavior that exists in the code. Never write what the product should do or how to change it, in any part but one: the remedies (Phase 6c) may say what to do, and only about the findings and the computed facts the handbook already lists, each cited and judged. Only the findings (Phases 4c and 4d, the Findings chapter of the handbook) say what is wrong with the product, and they state the defect and nothing else; every other part states only what exists. Where the code does not settle something, say so as an unknown and say what was searched.
2. **Nothing is dropped silently.** A script lists the entrypoint candidates (pages, routes, scheduled jobs, program starts). Every candidate belongs to exactly one feature or is listed as unassigned with a reason, and a script checks it.
3. **Every value has a source.** Each label, rule, number and sentence of an entry carries a passage copied from the source file. Scripts check that the passage is in the file exactly once, that every label and number is in its own passage, and that the file is project source.
4. **Readers see no code.** Reader-visible text contains no code-shaped words. A script refuses them; the rules are under **Reader text** in Phase 3.
5. **Nothing stays that the code does not back up.** A passage that exists can still be read wrongly. A verifier that sees one item and the code around its citations judges each item (Phase 5); an item that is not confirmed, contradicted or not, is rewritten once (other citations, or a claim narrowed to what the code shows, never a name or a label), and removed if it is still not confirmed. Two tracers that each read the whole project then look for code that contradicts each item that is left (Phase 6), and what either finds is removed; a feature's purpose, navigation path, screens and field labels, whose claims are a label or one sentence of purpose, are settled by the two verifiers only, and the coverage section says so. Only a verified feature is written into the handbook, and every removed item is listed in its coverage section. The system overview that opens the handbook is checked the same way, item by item.

## How the work is split

| Who | Does |
|---|---|
| `handbook.mjs` (a script, no model) | Lists the entrypoint candidates and the application roots, checks the map, the business domains, the overview and each entry, computes every count and statistic of the system overview (languages, frameworks, files, lines, commits, authors, the roles of each domain), writes the code health facts (commits per year, the commits and authors of each application, the files that change most, the files changed together across applications, the source and test files of each application) from git and the project files with no write under the project, computes the appendix (the open questions, the glossary, the sources and scope) from the verified entries and the run's records, resolves `--features`, validates `--sections` and prints the phase files a run reads, records each dispatch and result, cuts each entry into the items a verifier judges and records the verdicts, removes what stays unverified, writes the trace files of each settled entry and records the tracers' verdicts, removes what they contradict, checks the fixed-text table, computes the entities and the relations between them (domains, roles, applications, external systems) from the verified entries and the source, assembles `handbook.md` (and `handbook-technical.md`), writes `handbook.html` and prints the closing lines. |
| You (the orchestrator) | Write the map, the business domains and the outline (Phase 6e: which parts and chapters the handbook has, in what order and under what names, from the blocks `outline-facts` lists), dispatch the overview lane, the feature lanes, the verifiers, the rewriters, the tracers and the translation of the fixed text, and reply. |
| One `excavator-handbook-writer` subagent for the system overview (Phase 3b) | Reads the map, the application roots the script prints, each application's build manifests and entry files and the search hits for external systems, opens at most 30 other files, and writes `entries/overview.json`, one file, nothing else. |
| One `excavator-handbook-writer` subagent lane per feature | Reads that feature's seed files, follows calls and imports out of them to at most 40 more files, and writes its entry, one file, nothing else. |
| One `excavator-handbook-writer` findings subagent per feature (Phase 4c) | Reads that feature's seed files, follows calls and imports out of them to at most 20 more files, and writes the defects the code shows today, each with a category, a statement and its evidence, in `entries/<id>.findings.json`, one file, nothing else. |
| One `excavator-handbook-writer` system findings subagent per application root (Phase 4d) | Reads that application's seed files (its start-up, its scheduled jobs and the files that register many routes), follows calls and imports out of them to at most 20 more files, and writes the defects in the shared parts of the application that no single feature owns, each with a category, a statement and its evidence, in `entries/app<n>.system.json`, one file, nothing else. An application with no seed file has none. |
| Two `excavator-handbook-verifier` subagents per part of a feature and round | Each reads the same verify file (the items of the part, each with its claim and the code it cites), without seeing the other, and judges each item `verified`, `unverified` or `contradicted`, with a one-line reason. |
| Two `excavator-handbook-tracer` subagents per part of a feature that two verifiers settled | Each reads the trace file (the items of the part, each with its claim and the files and lines it cites, no code) and the whole project, looks for code that contradicts each item, and judges it `holds` or `contradicted`, with a one-line reason and, for `contradicted`, where the code is. |
| One `excavator-handbook-writer` ranking subagent per part of the verified findings (Phase 6b) | Reads only the lines `priority-items` prints for its part (the groups of findings at the same place, with their statements), no code, chooses one consequence from a fixed list for each group and writes one sentence that says who can trigger it and what happens, using only what the statements say, in `priority/part-<p>.json`, one file, nothing else. A script turns the consequence into P0, P1 or P2. |
| Two `excavator-handbook-priority-judge` subagents per part of the ranking | Each reads the same judge file (for each group the statements, the consequence with its meaning and the sentence), without seeing the other, and judges each group `follows` or `doesNotFollow`, with a one-line reason; a group has a level only when both say `follows`. |
| One `excavator-handbook-writer` remedies subagent (Phase 6c) | Reads only the lines `remedy-facts` prints (each group of the verified findings with its level, each application's size and history, the tables that two or more applications mention, the counts), no code, and writes for each category that has a verified group a common cause and a measure, and 1 to 10 ordered recommendations, each citing groups or facts, in `entries/remedies.json`, one file, nothing else. It may give advice; every statement of how things are now must come from what it cites. |
| Two `excavator-handbook-remedy-judge` subagents | Each reads the same judge file (each paragraph or recommendation with everything it cites), without seeing the other, and judges each `follows` or `doesNotFollow`, with a one-line reason, only on whether each statement of how things are now is in the cited material and whether the common cause holds for every cited group; one is written into the handbook only when both say `follows`. |
| One `excavator-handbook-writer` topics subagent per lane (Phase 6d) | Reads only the lines `topic-facts` prints for its lane (the verified items of the entries of one domain, or the groups of the verified findings), no code, and writes rows for the cross-cutting topics (approval routes, calendars and time zones, data between domains, access; for the `repeated` lane, the same problem in several places), each citing items or groups, in `topics/part-<lane>.json`, one file, nothing else. It writes only what the cited items say. |
| Two `excavator-handbook-topic-judge` subagents per lane | Each reads the same judge file (each row with everything it cites), without seeing the other, and judges each row `follows` or `doesNotFollow`, with a one-line reason, only on whether every fact in the row is in the cited material; a row is written into the handbook only when both say `follows`. |
| One `excavator-handbook-writer` rewrite subagent per feature that has items to rewrite | Reads the items the two verifiers did not both confirm (`unverified` or `contradicted`) and, in the entry file, swaps or adds the citations that prove each, or narrows its claim to what the code it read shows (an added condition or exception, or the part no passage proves dropped); never widens it and never changes a name or a label. |
| One `excavator-handbook-writer` subagent for the fixed text (only when the language is not English) | Translates the fixed-text table and writes `ui.json`. |

The text of the phases is split by section. This file holds the shared phases (0 to 2 and 5 to 7) and the Sections part; `stages/map.md` holds Phases 3 and 3c, `sections/overview.md` holds Phase 3b, `sections/features.md` holds Phase 4, `sections/data.md` holds Phase 4b, `sections/history.md` holds Phase 4e, `sections/findings.md` holds Phase 4c, `sections/system-findings.md` holds Phase 4d and `sections/priority.md` holds Phase 6b and `sections/remedies.md` holds Phase 6c and `sections/topics.md` holds Phase 6d and `stages/outline.md` holds Phase 6e, each read only when the run needs it (see Sections).

All files of a run live in `$OUT`:

| File | Written by |
|---|---|
| `candidates.json` | `handbook.mjs candidates` (you save its output) |
| `map.json` | you |
| `domains.json` | you (Phase 3c) |
| `entries/<id>.json` | the lane of feature `<id>` |
| `entries/overview.json` | the overview subagent (Phase 3b) |
| `entries/<id>.findings.json` | the findings subagent of feature `<id>` (Phase 4c) |
| `entries/app<n>.system.json` | the system findings subagent of the `<n>`th application root (Phase 4d) |
| `entries/history.json` | `handbook.mjs history` (Phase 4e: the code health facts, computed from git and the project files; you write nothing in it) |
| `priority/part-<p>.json` | the ranking subagent of part `<p>` of the verified findings (Phase 6b); `entries/priority.json` is the merge of the parts that `handbook.mjs check-priority` writes |
| `priority/judge/part-<p>.json` | `handbook.mjs priority-judge` (the groups of part `<p>` with their statements, consequence and sentence) |
| `priority/verdicts/part-<p>.a.json` and `part-<p>.b.json` | the two judges of part `<p>` of the ranking, one file each |
| `entries/remedies.json` | the remedies subagent (Phase 6c) |
| `remedies/judge.json` | `handbook.mjs remedy-judge` (each paragraph or recommendation with what it cites) |
| `remedies/verdicts/a.json` and `b.json` | the two judges of the remedies, one file each |
| `outline.json` | you (Phase 6e) |
| `topics/part-<lane>.json` | the topics subagent of the lane `<lane>` (Phase 6d); `entries/topics.json` is the merge of the lanes that hold, which `handbook.mjs check-topics` writes |
| `topics/judge/<lane>.json` | `handbook.mjs topic-judge` (each row with what it cites) |
| `topics/verdicts/<lane>.a.json` and `<lane>.b.json` | the two judges of the lane, one file each |
| `state.json` | `handbook.mjs` only (`check-map`, `check-entry`, `mark`, `verdicts`, `trace-verdicts`), `check-overview` for the overview, whose state is under its key `overview`, `check-findings` for the findings of a feature, whose state is under the key `findings` by feature id, `check-system-findings` for the system findings of an application root, whose state is under the key `systemFindings` by `app<n>`, with the application's root directory, and `check-priority`, `priority-verdicts` and `mark` for the ranking of the findings, whose state is under the key `priority`, and `check-remedies`, `remedy-verdicts` and `mark` for the remedies, whose state is under the key `remedies`, and `check-topics`, `topic-verdicts` and `mark` for the topics, whose state is under the key `topics` by lane |
| `verify/round-<r>/<id>/part-<n>.json` | `handbook.mjs slices` (the items of a feature, of the overview whose id is `overview`, of the findings of a feature whose id is `<id>.findings`, or of the system findings of an application root whose id is `app<n>.system`, with their claims and code, cut by size into parts); `verify/round-1/<id>.entry.json` is the entry as round 1 saw it |
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
- `--applications <list>` - write system findings only for these application roots, as a comma-separated list of root directories exactly as `handbook.mjs applications` prints them (default: every application root). It applies only to the `system-findings` section and is not recorded, so a run in steps (the main service first, then the rest) writes the other roots later. Phase 4d resolves the list with `select`; a directory that is not an application root stops the run with every root listed.
- `--views <list>` - which views of the handbook are written: `product`, `technical` or both separated by a comma (default: `product`). The product view is organized by domain and never shows a file path; the technical view is organized by application and shows, next to each item, the file and lines of the passages quoted for it, and adds the applications, the external systems and a matrix of applications by domain. With both, the page has a switch between them that stays on the same entity. The option only decides what `assemble`, `page` and `reply` write; it changes no phase and is not recorded, so running again with other views only repeats Phase 7.
- `--sections <list>` - which sections of the handbook this run writes: `overview` (the system overview), `features` (the entries), `findings` (the defects each feature's code shows, with their root causes), `system-findings` (the defects in the parts of each application that no single feature owns), `priority` (a level, P0, P1 or P2, and a reason for each group of the verified findings; it runs after the trace, needs no map and changes no finding), `remedies` (a common cause and a measure for each category of the verified findings and 1 to 10 ordered recommendations, the only advice in the handbook, each resting on cited findings and facts and kept only when two judges agree; it runs after the trace and the ranking, needs no map and changes no finding) `topics` (rows for five cross-cutting tables, each resting on cited verified items or groups of findings and kept only when two judges agree: approval routes, calendars and time zones, data between domains, access, and the same problem in several places; it runs after the trace and the remedies, needs no map and changes no entry or finding) `outline` (the parts and chapters of the handbook, in the order and under the names this project's readers would use; written by you after the topics, needs the map, changes no entry, finding or other section; without it the handbook has the default order under the fixed names) and `data` (the tables, migrations and where each table name appears; written by a script, needs no map) and `history` (the code health: the commits of each year, the first and last commit, the commits and authors of each application, the files that change most, the files changed together across applications, the source and test files of each application; written by a script from git and the project files, needs no map, writes nothing under the project), any of them separated by a comma (default: all). Each section's phases are in a file that is read only when the section is selected (see Sections). The option only decides which phases run; it is not recorded, so running again with other sections skips the units already done, and Phase 7 assembles whatever `$OUT` holds.
- `--concurrency <n>` - how many lanes run at once (default: 3).
- `--fresh` - start over instead of resuming an earlier run in the same `--out`.

## Sources

Read only the project's source code and configuration. Never read anything under `.excavator/` (except the files of this run in `$OUT`, which you write and check), and never read a document that an Excavator skill generated (`PRD.md`, `handbook.md`, reports, findings, tours, anything under `.excavator/`): a handbook built from another generated document proves nothing about the code. Never run, build or change anything in the project. Write only under `$OUT`. This skill never runs `/excavator` or any command that rebuilds the facts in `.excavator/`.

---

## Phase 0: Setup

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

1. Resolve `PROJECT_ROOT` from the path argument (default: `pwd`). Parse `--language` (`$LANGUAGE`: English when it is not given), `--out` (`$OUT`, default `$PROJECT_ROOT/.excavator/product-handbook`), `--features` (`$FEATURES`: the value, or none), `--applications` (`$APPLICATIONS`: the value, or none), `--views` (`$VIEWS`: the value, or `product` when it is not given; when it holds anything but `product` and `technical`, separated by a comma, tell the user those two values and stop), `--sections` (`$SECTIONS`: the value, or empty when it is not given; the Sections part checks it), `--concurrency` (`$CONCURRENCY`, default `3`) and `--fresh`. The run's language name, `$RUN_LANGUAGE`, is `English` whenever `$LANGUAGE` is English however it was spelled (`en`, `english`), and `$LANGUAGE` as given otherwise; the script treats only the name `English` as English.
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
- Otherwise, when `$OUT/ui.json` exists, run `check-ui` first; when it exits 0 skip the translation. Otherwise dispatch one `excavator-handbook-writer` subagent in the foreground with the prompt below, then check its file (`--language` is `$RUN_LANGUAGE`: there is no `map.json` yet to read the language from):
  ```bash
  node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-ui "$OUT" --language "$RUN_LANGUAGE"
  ```
  Exit 1 prints one line for each key that is missing or extra, each value that is empty and each `{placeholder}` that is lost or added. Delete the file (`rm -f "$OUT/ui.json"`) and dispatch the `excavator-handbook-writer` subagent once more with its prompt followed by this line and then each line printed: `Your previous attempt failed these checks; fix them and write the file again:`. When `check-ui` still exits 1, the run fails: tell the user the lines it printed, as printed, and stop; run no further phase.

The translation prompt:

````text
You translate the fixed text of a product handbook into $LANGUAGE.

Your scope. Read only `$PLUGIN_ROOT/skills/excavator-product-handbook/ui-strings.json`; read no other file and no code. It holds a `format`, a `language` and `strings`, an object from keys to English texts: headings, table headers, short labels, buttons and sentences of a document for readers who do not read code.

Translate every value into $LANGUAGE, in plain words, as short as the English. Keep every `{placeholder}` of a value exactly as written (same name, in braces) in the translated text, and add none: the program fills them with names, numbers and values. `page.documentTitle` is a pattern whose `{page}` receives the text of `page.nav.overview` or of `page.notFound.heading`, so write it to read right with either. Never translate a key. Add no key and leave none out.

Keep the formal register of a reference document for every heading and label: noun phrases, not conversational questions (no "who can..." or "where to..." in the target language).

Write only `$OUT/ui.json`, and nothing else anywhere, in this shape: `{"format": "excavator-product-handbook-ui/1", "language": "$LANGUAGE", "strings": {"<key>": "<translated value>", ...}}` with exactly the keys of the English file and a non-empty string for each.

Reply with one line: `ui: written`, and nothing else.
````

---

## Sections

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The phases from the map to the entries (Phases 3, 3c, 3b and 4) are not in this file. Each section of the handbook has its phases in a file of its own under `$PLUGIN_ROOT/skills/excavator-product-handbook/`, read only when the section is selected: `stages/map.md` holds Phase 3 (the map) and Phase 3c (the business domains), which the overview and the features both need; `sections/overview.md` holds Phase 3b (the system overview, section `overview`); `sections/features.md` holds Phase 4 (the entries, section `features`); `sections/data.md` holds Phase 4b (the data, section `data`), which needs no map and no stage file; `sections/history.md` holds Phase 4e (the code health, section `history`), which needs no map and no stage file either; `sections/findings.md` holds Phase 4c (the findings of each feature, section `findings`), which needs the map; `sections/system-findings.md` holds Phase 4d (the system findings of each application root, section `system-findings`), which needs the map; `sections/priority.md` holds Phase 6b (the level of each group of the verified findings, section `priority`), which needs no map and no stage file and runs after the trace, so it is not read here (see the `AFTER_TRACE=` lines below); `sections/remedies.md` holds Phase 6c (the common causes, measures and recommendations, section `remedies`), which is read the same way, after the priority file; `sections/topics.md` holds Phase 6d (the cross-cutting topics, section `topics`), which is read the same way, after the remedies file; `stages/outline.md` holds Phase 6e (the outline, section `outline`), which needs the map (already in `$OUT` by then) and no stage file and runs after Phase 6d, so it is read the same way, after the topics file. `$SECTIONS` is the sections of this run: the `--sections` value, or all of them when it is not given.

1. Ask the script which files this run reads. Write the `--sections` value between the quotes (empty quotes when it is not given):
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" sections "<the --sections value, or empty>"
   ```
   On exit 1, tell the user the lines it printed (the values that are not sections and the valid ones), and stop. Otherwise record `$SECTIONS` as the value of the `SECTIONS=` line, the `READ=` lines, in the order printed, as the files to read, and the `AFTER_TRACE=` lines, when there are any, in the order printed, as the files that Phase 6 reads at its last step (`$AFTER_TRACE`; a section whose phase has to run after the trace, as the priority, remedies, topics and outline sections, prints it instead of a `READ=` line).
2. Read each `READ=` file in that order with the Read tool, at `$PLUGIN_ROOT/skills/excavator-product-handbook/` followed by the path printed. Read a file at the moment you get there, not before: do that file's phases (each begins at its `## Phase` heading) before you read the next file. Do not read the `AFTER_TRACE=` files now. Read no file `sections` did not print, and never run a phase from memory. Read every file it printed, also when `state.json` or the files in `$OUT` already show that file's phases done: whether a phase has work is decided by its own first step, which you only know once you have read it.
3. A phase in a file you did not read does not run. Where the text of a phase says to go to Phase N and Phase N does not run in this run, go to the next phase this run runs.
4. Phases 5 and 6 take only the units of the selected sections: the system overview (the unit `overview`) only when `overview` is in `$SECTIONS`, the features' entries only when `features` is, the findings units (the ids `<id>.findings`) only when `findings` is, and the system findings units (the ids `app<n>.system`) only when `system-findings` is. A unit of a section that is not selected is neither verified nor traced in this run, even when an earlier run left it `checked`. `--features` applies only to the `features` section: with `overview` alone, `select` still resolves the list (Phase 3), but no entry lane is dispatched. The `findings` section takes the same list for its lanes (Phase 4c). `--applications` applies only to the `system-findings` section (Phase 4d). The `data` section has no unit: with only `data` selected, Phases 5 and 6 have nothing to do. The `history` section has no unit either: with only `history` selected, Phases 5 and 6 have nothing to do. The `priority` section has no unit in Phases 5 and 6 either: it works on the findings units that are already `verified`, and its phase is Phase 6b, which Phase 6 reads at its last step; with only `priority` selected, Phases 5 and 6 have nothing to do but that step. The `remedies` section has no unit there either: it works on the findings units that are already `verified` and on the ranking, and its phase is Phase 6c, read at the same last step after Phase 6b. The `topics` section has no unit there either: it works on the entries and the findings units that are already `verified`, and its phase is Phase 6d, read at the same last step after Phase 6c. The `outline` section has no unit there either: it places the blocks of the handbook, and its phase is Phase 6e, read at the same last step after Phase 6d (after Phase 6c, 6b or the trace when those sections are not selected).
5. Phase 7 does not look at `$SECTIONS`: it assembles what `$OUT` holds, the ranking of the findings, the remedies and the topics included, so it runs after Phases 6b, 6c and 6d when the run has them. It follows the outline too, so it also runs after Phase 6e when the run has it. Assembling needs the map, so when only `data` is selected and `$OUT/map.json` does not exist, the run ends after the data phase: Phase 7 does not run, and `data.json` and `dictionaries.json` are the whole result. The same holds when `history` is selected, with or without `data`, and nothing else: the run ends after the history phase, and `entries/history.json` (with `data.json` and `dictionaries.json` when `data` is selected too) is the whole result.

---

## Phase 5: Verify

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

A `checked` feature has an entry whose shape, citations, labels, numbers and words the scripts checked. That does not show that each item says what its passage does: a passage can be real and be read wrongly (a function name read as a role, a condition that stops two cases read as "every case"). Readers cannot read the code to find out, so each item is judged by a verifier that sees nothing of the map, the other features or the writer's reasons. A feature whose items both verifiers confirm (after an item either found contradicted was removed, and the one re-citing of the others, with what they still did not confirm removed) is `confirmed`: Phase 6 traces it, and only a `verified` feature is written into the handbook.

A feature whose entry has the format `excavator-product-handbook-entry/3` (a fact sheet with a chapter in `$OUT/chapters/<id>.md`) is not verified or traced in this version: once `check-entry` records it `checked`, the handbook writes it marked as not verified. Its chapter alone can be checked again, recording nothing, with `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-chapter "$OUT" <id> --project "$PROJECT_ROOT"`.

The system overview of Phase 3b goes through this phase and Phase 6 as one more unit, with the id `overview` where a step says `<id>`: the same `slices`, `verdicts`, prompts and rules, with these differences. Where a step says `check-entry`, run `check-overview "$OUT" --project "$PROJECT_ROOT"` for it; where the rewrite prompt says `try-entry "$OUT" <id>`, the rewriter runs `try-overview "$OUT"`, and its rule about roles from the map does not apply to the overview. The overview's state is under the key `overview` in `state.json`. The units of this phase are the overview, when its state is `checked` (the recipe of step 1), and the features that step 1 lists; the overview takes part whatever `--features` says.

The findings of Phase 4c go through this phase and Phase 6 as one more kind of unit, with the id `<id>.findings` (`<id>` the feature's id) where a step says `<id>`: the same `slices`, `verdicts`, prompts and rules, with these differences. Where a step says `check-entry`, run `check-findings "$OUT" <id>.findings --project "$PROJECT_ROOT"` for it; where the rewrite prompt says `try-entry "$OUT" <id>`, the rewriter runs `try-findings "$OUT" <id>.findings`, and its rule about roles from the map does not apply to findings. The state of a findings unit is under the key `findings` in `state.json`, by the feature's id. A findings unit that loses every finding in this phase is `confirmed` with none, never `failed`. The findings units of this phase are those whose state is `checked` (the recipe of step 1), when `findings` is in `$SECTIONS`.

The system findings of Phase 4d go through this phase and Phase 6 as one more kind of unit, with the id `app<n>.system` where a step says `<id>`: the same `slices`, `verdicts`, prompts and rules as the findings of a feature, with these differences. Where a step says `check-entry`, run `check-system-findings "$OUT" <id> --project "$PROJECT_ROOT"` for it; where the rewrite prompt says `try-entry "$OUT" <id>`, the rewriter runs `try-system-findings "$OUT" <id>`, and its rule about roles from the map does not apply. The state of a system findings unit is under the key `systemFindings` in `state.json`, by `app<n>`. A unit that loses every finding in this phase is `confirmed` with none, never `failed`. The system findings units of this phase are those whose state is `checked` (the recipe of step 1), when `system-findings` is in `$SECTIONS`.

1. List the features that need this phase, and for each whether it is at round 1 (`verify`) or waits for its one rewrite (`rewrite`):
   ```bash
   jq -r '.features | to_entries[] | select(.value.status == "checked") | [.key, (if .value.rewriting then "rewrite" else "verify" end)] | @tsv' "$OUT/state.json"
   ```
   Then the overview, which `state.json` keeps under its own key (nothing is printed when it is not `checked`):
   ```bash
   jq -r '(.overview // {status: "planned"}) | select(.status == "checked") | ["overview", (if .rewriting then "rewrite" else "verify" end)] | @tsv' "$OUT/state.json"
   ```
   Then the findings units, which `state.json` keeps under the key `findings` by the feature's id (nothing is printed when none is `checked`):
   ```bash
   jq -r '(.findings // {}) | to_entries[] | select(.value.status == "checked") | [(.key + ".findings"), (if .value.rewriting then "rewrite" else "verify" end)] | @tsv' "$OUT/state.json"
   ```
   Then the system findings units, which `state.json` keeps under the key `systemFindings` by `app<n>` (nothing is printed when none is `checked`):
   ```bash
   jq -r '(.systemFindings // {}) | to_entries[] | select(.value.status == "checked") | [(.key + ".system"), (if .value.rewriting then "rewrite" else "verify" end)] | @tsv' "$OUT/state.json"
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
   - Exit 0 and `<id>: <n> items to rewrite`, then `Rewrite file: <path>`: round 1 removes nothing. Every item the two verifiers did not both confirm is in the rewrite file with its claim, its verdict (`contradicted` or `unverified`) and its reason, and the entry file is unchanged; what hangs on a listed item (the fields and rules of a listed screen, the rules of a listed field) counts as listed. A verifier reads only the code around the citations, so its reason only tells the rewriter where to look: it is never the basis of a new claim. Go to step 4 for it.
   - Exit 1: nothing was recorded. Each line says why, led by its part and verifier (`part <p><x>: ...`, `<x>` being `a` or `b`): that verdict file is missing (the verifier wrote nothing), or does not hold exactly one verdict for each item of that part (a verdict for an item of another part counts as extra), or a verdict is not one of the three words, or a reason is empty, has more than one line, names a file, or (for a verdict that is not `verified`, which readers see) holds a code-shaped word or, in a language with its own script, no letter of it. Dispatch a verifier once more for each part-letter the `Next:` line names (a file of its own: `1b` is the second verifier of part 1), and for no other. For a missing file, the prompt as it was. For a rejected file, the prompt followed by this line and then each line printed for that part-letter except the `Next:` line (the lines that start with `part <p><x>:`, without that start): `Your previous verdict file was rejected for these reasons; write it again:`. Delete the old verdict file of a rejected part-letter first (`rm -f "<the verdict file>"`). Then run `verdicts` again. When `verdicts` still exits 1, leave the feature as it is, `checked`: it is listed in the handbook as verification not finished. Never write or change a verdict yourself, and never edit `state.json`.
4. Rewrite, once. For each feature with a rewrite file, dispatch one rewrite subagent (an `excavator-handbook-writer` subagent, in the foreground, up to `$CONCURRENCY` in one message) with the prompt below, its placeholders filled in:

````text
You correct some items of one entry of a product handbook, for readers who do not read code, so that each says only what the source of the project at $PROJECT_ROOT shows. Your feature: <id>.

Your scope. Read `<the rewrite file>`: the items the two verifiers did not both confirm, each with its id (its place in the entry), its claim, its verdict and its reason. Each is `unverified` (the code the verifier saw neither supports nor denies the item) or `contradicted` (the code the verifier saw seems to say otherwise). The reason only tells you where to look; it is never the basis of a new claim, because a verifier read only the lines around the citations. Read `$OUT/entries/<id>.json`, the entry you change, and the source files its listed items cite; search the project when you need another passage. The unchanged entry of round 1 is `$OUT/verify/round-1/<id>.entry.json`; read it only to put an item back as it was. Read code only; never run, build or change anything in the project. Never read anything under `.excavator/` except those files of this run, and never read a document that an Excavator skill generated (PRD.md, handbook.md, reports, findings, tours). Exclude `.excavator`, `.git`, `node_modules`, `vendor`, `dist` and `build` from every search.

What you do. For each listed item, in the entry file, do one of two things.
(a) Swap a citation for another passage, or add one, so that the passages by themselves prove the item as it is written (for who may do something, the condition the code checks, not the name of a function or variable).
(b) NARROW the claim: add the condition, case or exception the code shows, or drop the part that no passage proves. Never widen it, never change its subject, never turn it into a different fact. The new text must be proved by its own passages, and you must have read those passages yourself.
Names and labels never change: the screen name, field label, operation name, state label, transition from and to, the target of a handoff, a role, the side of a rule and the category of a finding stay exactly as they are.
When the reason says that an effect, a send, a condition or a source is not shown, do this before you decide: start from the cited passage and (1) open the function it calls and find the line that really changes the data or sends the message; (2) find the condition around that line, or the start of the function; (3) find where the constant, the configuration value or the identity is defined; (4) when the other side of the product (the frontend or the backend) is needed, find its matching line. Add each passage you find to the citations and keep the old ones.
When an item cannot be saved (no passage proves it, and no narrower claim is proved either), leave it exactly as it is: the script removes it after the second check. Never delete or add an item, and never move one into `unknowns`.
Change nothing else. An item that is not listed stays exactly as it is: its text, its citations, and also the screen name, field label or operation name its claim is written under. A script compares the entry with round 1 and refuses an entry in which an item is missing or added, or an item that is not listed differs, or a listed item's name or label differs. The items that hang on a listed item (the fields and rules of a listed screen, the rules of a listed field) count as listed: their citations and their text may change, their names and labels may not.

Every rule of the original entry still holds: the same shape and keys, the format `excavator-product-handbook-entry/2` and the lists of each operation (triggers, calculations, changes, edges, handoffs) and the transitions included; a handoff's `feature` is an id, not text: leave it as it is; an item keeps stating one fact; every label and number of an item occurs in that item's own passages; no code-shaped words in reader text; roles only from the map's list (<roles, one label per line>); numbers as Arabic numerals; narrative in `$LANGUAGE`; labels exactly as the source writes them; no advice and no opinion.

Check your file before you reply. Run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" try-entry "$OUT" <id> --project "$PROJECT_ROOT"` and `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" slices "$OUT" <id> --round 2 --project "$PROJECT_ROOT"`. The first runs the checks of the entry and records nothing. The second prints each item that is missing or added, each item that is not listed and that you changed, and each listed item whose name or label you changed, when there is one: put it back as it is in the round 1 entry. Fix the file for every line either prints and run both again until `try-entry` prints `<id>: ok` and `slices` prints its `Verify file:` line, at most 5 runs.

Write only `$OUT/entries/<id>.json`, and nothing else anywhere. Reply with one line: `<id>: rewritten`, and nothing else.
````

5. As each rewrite subagent returns, check its entry and cut the rewritten items, one command at a time:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-entry "$OUT" <id> --project "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" slices "$OUT" <id> --round 2 --project "$PROJECT_ROOT"
   ```
   - `check-entry` exit 1: the feature is `failed` at the step `rewrite`; there is no second rewrite. Leave it and go on with the next feature.
   - `slices` exit 1: the rewrite changed an item that was not listed, or changed a name or label of a listed item (its line names the item and says that names and labels may not change), or deleted or added an item, and the lines name each path. There is no second rewrite: leave the feature as it is, `checked`; it is listed in the handbook as verification not finished.
   - `slices` exit 0 prints the `Part <p>/<k>:` lines with the `Verify file:` and `Verdict files:` paths for round 2, and holds only the listed items and the items that hang on them, each with its claim as the rewrite left it.
6. Dispatch the verifiers of round 2 as in step 3, two per part: the same agent type, the same prompt with the round 2 paths, up to 10 in one message, in the foreground; an item is verified only when both confirm it, as in round 1. Round 2 holds only the rewritten items, so it usually has one part. A verdict file that is missing or rejected is dispatched once more as in step 3; when it still fails, leave the feature as it is.
7. Settle each feature:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" verdicts "$OUT" <id> --round 2 --project "$PROJECT_ROOT"
   ```
   - `<id>: confirmed (<n> items)` or `<id>: confirmed, <n> items removed`: the feature is `confirmed`. An item the two verifiers did not both confirm, `unverified` like `contradicted`, was removed from the entry together with what hangs on it, and is recorded in `state.json` with its claim, verdict and reason. The handbook's coverage section lists each removed item. The removal is not a rewrite: never put a removed item back. An item whose claim the rewrite changed is also recorded in `state.json` under `narrowed` (its old claim, its new claim and whether it stayed) for the audit; the handbook does not show it.
   - The purpose is an item like any other: when the two verifiers do not both confirm it, it is removed and recorded, and the feature stays confirmed. Its section is then missing from the handbook and the page, and the coverage section lists the removed purpose.
   - `<id>: failed at verify: no item could be proved`: nothing of the entry was proved. It is `failed`; its entry file stays for the user to see.
   - Exit 1: nothing was recorded; handle it as in step 3 (dispatch the verifier once more with the printed lines, then leave the feature as it is).

Then tell the user `Verify <id> <n>/<N>: <status>` for each unit, where `<n>` counts the units of this phase that are settled, `<N>` is the number of units step 1 listed (features and overview) and `<status>` is `confirmed`, `failed` or `not finished`, in `$LANGUAGE`.

Never edit `entries/<id>.json`, a verify, verdict or rewrite file or `state.json` yourself. Statuses change only through the commands above.

---

## Phase 6: Trace

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

A `confirmed` feature has items that two verifiers, who saw only the lines each item cites, both confirmed. That does not show that nothing else in the project contradicts them: the condition may sit in a function the cited lines call, a cap may be applied before a sum, a position may come out one off when the code is run through by hand. A tracer reads the whole project, starting from the cited lines, and looks only for code that contradicts an item; two tracers do it for each part, independently, and an item either contradicts is removed and listed in the coverage section. Only a `verified` feature is written into the handbook. A feature's purpose, navigation path, screens and field labels are not traced: their claims are a label or one sentence of purpose, and the two verifiers settle them; the coverage section says so. The system overview is traced like a feature, with the id `overview`: the same `trace`, `trace-verdicts`, prompts and rules.

The findings units are traced like a feature too, with the id `<id>.findings`. A findings unit whose findings were all removed in Phase 5 has nothing left to trace: `trace` prints `<id>.findings: 0 items in 0 parts` and a `Next:` line, you dispatch no tracer, and `trace-verdicts` for it records the unit as `verified` with no finding. The system findings units (the ids `app<n>.system`) are traced the same way, with the same rule for a unit whose findings were all removed: `trace` prints `app<n>.system: 0 items in 0 parts`.

1. List the features that need this phase, and the overview when it is `confirmed`:
   ```bash
   jq -r '.features | to_entries[] | select(.value.status == "confirmed") | .key' "$OUT/state.json"
   jq -r '(.overview // {status: "planned"}) | select(.status == "confirmed") | "overview"' "$OUT/state.json"
   jq -r '(.findings // {}) | to_entries[] | select(.value.status == "confirmed") | (.key + ".findings")' "$OUT/state.json"
   jq -r '(.systemFindings // {}) | to_entries[] | select(.value.status == "confirmed") | (.key + ".system")' "$OUT/state.json"
   ```
   The last two lines list the findings units and the system findings units that are `confirmed`, when `findings` and `system-findings` are in `$SECTIONS`.
   With no unit in the lists, go to step 4. A resumed run needs nothing else: a `confirmed` feature goes straight to this phase, wherever the earlier run stopped. When `$OUT/trace-verdicts/<id>/` exists, run the `trace-verdicts` command of step 3 for it first (it names the part-letters still to dispatch), and when that exits 1 start at step 2 (`trace` clears the older files of the feature); otherwise start at step 2.
2. Write the trace files, one command per feature (the commands of a batch in one Bash command, one after another):
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" trace "$OUT" <id> --project "$PROJECT_ROOT"
   ```
   It prints `<id>: <n> items in <k> parts`, then one line per part, `Part <p>/<k>: <m> items | Trace file: <path> | Verdict files: <path> <path>`: the trace file of that part and the two verdict files of its two tracers (`part-<p>.a.json` and `part-<p>.b.json`). A trace file holds, for each item still in the entry (for a feature, not its purpose, navigation path, screens or field labels, which the verifiers alone settle; a field's rules are traced), its id, its claim and the files and line ranges it cites, and no code; a part holds at most 25 items. Exit 1 prints why (the feature is not `confirmed`, or its entry changed after it was confirmed or no longer passes its checks) and a `Next:` line: follow it once; when it cannot be followed, leave the feature as it is. It stays `confirmed` and the handbook lists it as verification not finished.
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

4. When the `sections` command printed `AFTER_TRACE=` lines (`$AFTER_TRACE`), read the first of those files now with the Read tool, at `$PLUGIN_ROOT/skills/excavator-product-handbook/` followed by the path printed, and do its phase (Phase 6b, which ranks the verified findings, for `sections/priority.md`; Phase 6c, which writes the remedies, for `sections/remedies.md`; Phase 6d, which writes the cross-cutting topics, for `sections/topics.md`). Read it even when no unit was traced in this phase, and whatever `$OUT` already holds: the first step of the phase decides whether it has work. When a second `AFTER_TRACE=` line was printed, read that file the same way when the first phase is done and do its phase; read a third one the same way when the second phase is done. The outline phase (Phase 6e, which writes the outline, `stages/outline.md`) is the last of them: when `AFTER_TRACE=stages/outline.md` was printed, read it the same way when the phase before it is done, or right after Phase 6 when it is the only one. Where the text of such a phase says to go to Phase 7 and an `AFTER_TRACE=` file is still to be read, read that file instead; go to Phase 7 when every `AFTER_TRACE=` file has been done. Without an `AFTER_TRACE=` line, go to Phase 7.

---

## Phase 7: Assemble, page and reply

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

1. Assemble the handbook and write the page:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" assemble "$OUT" --project "$PROJECT_ROOT" --views "$VIEWS"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" page "$OUT" --project "$PROJECT_ROOT" --views "$VIEWS"
   ```
   Both check the map, every verified entry (a confirmed one too, which they do not write) and the fixed text again before they write anything. Each of them groups the features by the business domains of `domains.json` and falls back to the areas of the map when that file is missing or does not pass `check-domains`, and says so in a fixed text. Only a `verified` feature has a section in the handbook. Both follow `$OUT/outline.json` (Phase 6e): the chapters, their order and their titles are the outline's, and on the page so are the navigation (one group for each part), the links to the previous and the next chapter and the heading of each page; `handbook.md` has the chapters only, no part level. When that file is missing or does not pass `check-outline`, they use the default order under the fixed names and say so in the coverage section, with the problem lines when the file failed; each block the outline leaves out is listed in the coverage section with its reason. `assemble` writes `$OUT/handbook.md`: each chapter is one block, computed by the script from the verified entries, the facts of the run and the records of the checks, so you write nothing for it (the system overview, written from the verified overview and its own counts, or a line saying where the overview stopped and the table of domains when the overview is not verified; the business flow between domains; the technical structure; the data; the roles and the matrix of roles by feature, the matrix of applications by domain and the status dictionary; every notification of the verified entries; one row for every scheduled-job candidate with the schedule its registration line gives; the cross-cutting topics; the code health (the commits of each year, the applications, the files that change most, the files changed together across applications, the source and test files of each application, from `entries/history.json`, or a line saying it was not written or that the project has no version history); the findings; the recommendations; the open questions, the glossary of the entry names, screen names, state labels and roles, and the sources and scope: what each section wrote and how many items each check removed), or one list of entities with a section for each (the business domains, each with its purposes, its handoffs and the sections of each of its verified features; the applications, with the features whose quoted passages fall in each; the external systems, with the callers the quoted code shows and, kept apart, the applications whose source contains the system's name). Only a `verified` feature has a section. The technical view alone has the technical structure, the data, the status dictionary, the applications, the external systems and the matrix of applications by domain, and the file and lines of the passages quoted for each item. The coverage section, which is always last, has the candidate counts, the unassigned candidates, the features reached by a link, the features without a verified entry, among them those whose verification or trace did not finish, the items verification and the trace removed, each with its reason, the overview's included, and which outline was used. `$VIEWS` decides what is written: `assemble` writes `$OUT/handbook.md` for the product view and `$OUT/handbook-technical.md` for the technical view, prints the path of each, and removes the file of a view that `$VIEWS` does not have. `page` writes `$OUT/handbook.html`, one page that opens from disk with a double click, with the same two tables on pages of their own, the entity pages and the two matrices too, a domain's page listing the full detail of each of its verified features after its features, and, when `$VIEWS` has both views, a switch in its top bar that stays on the same entity, and prints its path; when the page data is larger than 32 MB `page` also writes the folder `handbook-data/` next to it, which has to stay beside `handbook.html` (the page loads the data of each page from it when the page is opened); a failed `page` removes the page and the folder an earlier run left.
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
