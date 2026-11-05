---
name: excavator-product-handbook
description: Write a product handbook for non-technical readers from a project's source - a system overview (what the system is, who uses it, its applications and the external systems it calls), a map of the product's areas and features, one entry per feature with its screens, fields, rules, states and notifications, every value checked against a passage quoted from the source and every item confirmed by two verifiers that see only that item and the code it cites and then by two tracers that each read the whole project for code that contradicts it, assembled into handbook.md and a one-file HTML page in the language you choose. A script lists the entrypoint candidates and checks every step, you write the map, one subagent per feature writes its entry and others check it. It describes the product as it is and gives no advice.
argument-hint: "[path] [--language <lang>] [--out <dir>] [--features <list>] [--concurrency <n>] [--fresh]"
---

# /excavator-product-handbook

Write a **product handbook**: a document for people who use or manage the product and do not read code. It describes what the product **actually does today**, reverse-engineered from the source, organized the way a reader sees the product: first the system as a whole (what it is, who uses it, its applications and external systems), then the areas, then the features in each area, then each feature's screens, fields, rules, states, notifications and automatic behavior.

Five rules govern everything below:

1. **As-Is only, no advice.** Describe behavior that exists in the code. Never write what the product should do, what is wrong with it, or how to change it. Where the code does not settle something, say so as an unknown and say what was searched.
2. **Nothing is dropped silently.** A script lists the entrypoint candidates (pages, routes, scheduled jobs, program starts). Every candidate belongs to exactly one feature or is listed as unassigned with a reason, and a script checks it.
3. **Every value has a source.** Each label, rule, number and sentence of an entry carries a passage copied from the source file. Scripts check that the passage is in the file exactly once, that every label and number is in its own passage, and that the file is project source.
4. **Readers see no code.** Reader-visible text contains no code-shaped words. A script refuses them; the rules are under **Reader text** in Phase 3.
5. **Nothing stays that the code does not back up.** A passage that exists can still be read wrongly. A verifier that sees one item and the code around its citations judges each item (Phase 5); an item it finds contradicted is removed at once, an item it cannot confirm is given other citations once (its text never changes), and removed if it is still not confirmed. Two tracers that each read the whole project then look for code that contradicts each item that is left (Phase 6), and what either finds is removed. Only a verified feature is written into the handbook, and every removed item is listed in its coverage section. The system overview that opens the handbook is checked the same way, item by item.

## How the work is split

| Who | Does |
|---|---|
| `handbook.mjs` (a script, no model) | Lists the entrypoint candidates and the application roots, checks the map, the overview and each entry, computes every count and statistic of the system overview (languages, frameworks, files, lines, commits, authors, the roles of each area), resolves `--features`, records each dispatch and result, cuts each entry into the items a verifier judges and records the verdicts, removes what stays unverified, writes the trace files of each settled entry and records the tracers' verdicts, removes what they contradict, checks the fixed-text table, assembles `handbook.md`, writes `handbook.html` and prints the closing lines. |
| You (the orchestrator) | Write the map, dispatch the overview lane, the feature lanes, the verifiers, the rewriters, the tracers and the translation of the fixed text, and reply. |
| One subagent for the system overview (Phase 3b) | Reads the map, the application roots the script prints, each application's build manifests and entry files and the search hits for external systems, opens at most 30 other files, and writes `entries/overview.json`, one file, nothing else. |
| One subagent lane per feature | Reads that feature's seed files, follows calls and imports out of them to at most 20 more files, and writes its entry, one file, nothing else. |
| Two `excavator-handbook-verifier` subagents per part of a feature and round | Each reads the same verify file (the items of the part, each with its claim and the code it cites), without seeing the other, and judges each item `verified`, `unverified` or `contradicted`, with a one-line reason. |
| Two `excavator-handbook-tracer` subagents per part of a feature that two verifiers settled | Each reads the trace file (the items of the part, each with its claim and the files and lines it cites, no code) and the whole project, looks for code that contradicts each item, and judges it `holds` or `contradicted`, with a one-line reason and, for `contradicted`, where the code is. |
| One rewrite subagent per feature that has items to rewrite | Changes only the citations of the items the verifier could not confirm, in the entry file; never their text. |
| One subagent for the fixed text (only when the language is not English) | Translates the fixed-text table and writes `ui.json`. |

All files of a run live in `$OUT`:

| File | Written by |
|---|---|
| `candidates.json` | `handbook.mjs candidates` (you save its output) |
| `map.json` | you |
| `entries/<id>.json` | the lane of feature `<id>` |
| `entries/overview.json` | the overview subagent (Phase 3b) |
| `state.json` | `handbook.mjs` only (`check-map`, `check-entry`, `mark`, `verdicts`, `trace-verdicts`), and `check-overview` for the overview, whose state is under its key `overview` |
| `verify/round-<r>/<id>/part-<n>.json` | `handbook.mjs slices` (the items of a feature, or of the overview whose id is `overview`, with their claims and code, cut by size into parts); `verify/round-1/<id>.entry.json` is the entry as round 1 saw it |
| `verdicts/round-<r>/<id>/part-<n>.a.json` and `part-<n>.b.json` | the two verifiers of part `<n>` of feature `<id>`, one file each |
| `rewrite/<id>.json` | `handbook.mjs verdicts --round 1` (the items to rewrite, with the verdicts) |
| `trace/<id>/part-<n>.json` | `handbook.mjs trace` (the items a settled feature still holds, with their claims and cited line ranges, cut into parts of at most 25 items) |
| `trace-verdicts/<id>/part-<n>.a.json` and `part-<n>.b.json` | the two tracers of part `<n>` of feature `<id>`, one file each |
| `ui.json` | the translation subagent; for English, the script copies its shipped table |
| `handbook.md` | `handbook.mjs assemble` |
| `handbook.html` | `handbook.mjs page` |

## Options

`$ARGUMENTS` may contain:
- A directory path - the project to document (default: current working directory).
- `--language <lang>` - the language of the handbook's narrative, its area names and fixed text, and of everything said to the user during the run; English when it is not given. Labels quoted from the source stay in their source language.
- `--out <dir>` - where the run's files, the handbook and the page go (default: `<project>/.excavator/product-handbook`).
- `--features <list>` - write entries only for these features, as a comma-separated list of feature ids or feature names (a name is matched ignoring case, as a whole name). The map still covers every candidate; the features without an entry are listed in the handbook as not written. The system overview is not a feature: this option never skips it (Phase 3b). Feature ids exist only after the map is written, which is why names are accepted: Phase 3 resolves the list with `select`.
- `--concurrency <n>` - how many lanes run at once (default: 3).
- `--fresh` - start over instead of resuming an earlier run in the same `--out`.

## Sources

Read only the project's source code and configuration. Never read anything under `.excavator/` (except the files of this run in `$OUT`, which you write and check), and never read a document that an Excavator skill generated (`PRD.md`, `handbook.md`, reports, findings, tours, anything under `.excavator/`): a handbook built from another generated document proves nothing about the code. Never run, build or change anything in the project. Write only under `$OUT`. This skill never runs `/excavator` or any command that rebuilds the facts in `.excavator/`.

---

## Phase 0: Setup

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

1. Resolve `PROJECT_ROOT` from the path argument (default: `pwd`). Parse `--language` (`$LANGUAGE`: English when it is not given), `--out` (`$OUT`, default `$PROJECT_ROOT/.excavator/product-handbook`), `--features` (`$FEATURES`: the value, or none), `--concurrency` (`$CONCURRENCY`, default `3`) and `--fresh`. The run's language name, `$RUN_LANGUAGE`, is `English` whenever `$LANGUAGE` is English however it was spelled (`en`, `english`), and `$LANGUAGE` as given otherwise; the script treats only the name `English` as English.
2. Resolve `PLUGIN_ROOT` and check the script:
   ```bash
   PROJECT_ROOT="$(pwd)"   # or the path argument, as an absolute path
   OUT="$PROJECT_ROOT/.excavator/product-handbook"   # or the --out value
   SKILL_REAL=$(realpath ~/.agents/skills/excavator-product-handbook 2>/dev/null || readlink -f ~/.agents/skills/excavator-product-handbook 2>/dev/null || echo "")
   SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
   PLUGIN_ROOT=""
   for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do
     if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then PLUGIN_ROOT="$candidate"; break; fi
   done
   echo "PROJECT_ROOT=$PROJECT_ROOT"; echo "OUT=$OUT"; echo "PLUGIN_ROOT=$PLUGIN_ROOT"
   if [ -f "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" ]; then echo "SCRIPT=found"; else echo "SCRIPT=missing"; fi
   ```
   Each bash call starts a new shell: in every later command, write `$PROJECT_ROOT`, `$OUT` and `$PLUGIN_ROOT` as the values this block printed. When `SCRIPT=missing`, tell the user the plugin root was not found, and stop. Every `handbook.mjs` command that reads the project takes `--project "$PROJECT_ROOT"`: it resolves every cited file under that root and refuses a candidate list that names another. When a `handbook.mjs` command exits 2 naming `$OUT/state.json.lock` and no other `handbook.mjs` command of this run is still running (this skill runs them one at a time), delete that lock file and run the command again; never delete it while a command runs.
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
   - Without `--fresh`, an `$OUT` that holds files of an earlier run is resumed: each phase below skips what its files already show done. `candidates.json` is kept as it is (a run over changed source needs `--fresh`). When `$OUT/map.json` exists, read its language with `jq -r .language "$OUT/map.json"`; when it differs from `$RUN_LANGUAGE`, tell the user to run again with `--fresh`, and stop. The fixed text (Phase 2) is written before the map, so an `$OUT` can hold a `ui.json` and no map: when `$OUT/ui.json` exists and `jq -r .language "$OUT/ui.json"` differs from `$RUN_LANGUAGE`, do the same. A `ui.json` written before the skill gained new fixed texts lacks their keys: for a run in another language Phase 2 finds it with `check-ui` (exit 1, one line for each missing key) and translates the table again; for a run in English delete `$OUT/ui.json` (the script then uses the shipped table), since Phase 2 has nothing to do for English. An `$OUT` from before the system overview has no `overview` key in `state.json`: the script reads that as planned with no attempt, so a resumed run writes the overview in Phase 3b and nothing is migrated; an overview that is already `checked`, `confirmed` or `verified` is not written again.
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

## Phase 3: The map

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The map is the handbook's spine: the areas of the product, the features in each area, how a reader gets to each feature, and where every candidate went. When `$OUT/map.json` exists, run `check-map` first; when it exits 0, skip the writing and go to the `--features` step.

### Writing the map

If you split this reading across subagents, dispatch them in the foreground and wait for them, as for the lanes. Read the source that shows the product as a reader meets it: navigation and menu configuration, route tables, page and tab titles, sign-in and public pages, the messages and emails the product sends, scheduled-job and queue registrations, command-line entry files. Read code only. Then write `$OUT/map.json`:

```json
{
  "format": "excavator-product-handbook-map/1",
  "language": "<$RUN_LANGUAGE>",
  "areas": [{"id": "A1", "name": "<area as the reader sees it>", "evidence": [{"file": "<path from the project root>", "passage": "<text copied from that file>"}]}],
  "features": [{"id": "F1", "name": "<what the reader does>", "area": "A1", "reach": "menu", "label": "<menu text>", "evidence": [{"file": "...", "passage": "..."}], "candidates": ["c1", "c2"], "seedFiles": ["<path from the project root>"]}],
  "unassigned": [{"candidate": "c7", "reason": "<why no feature holds it, in plain words>"}],
  "roles": [{"label": "<role name as the product shows it>", "evidence": [{"file": "...", "passage": "..."}]}],
  "names": [{"label": "<external product or system name>", "evidence": [{"file": "...", "passage": "..."}]}]
}
```

- **Areas, as the reader sees them.** An area is a group of features under one heading a reader knows: a menu group, a section of the navigation, a page family. Take the names from the navigation configuration and the page titles, in order. An area name quoted from the source carries `evidence`; an area name you give yourself (for the work that runs by itself, for example) has none, is written in `$LANGUAGE` and passes the same reader-text rules. Give the areas ids `A1`, `A2`, ... in navigation order.
- **Features, one per thing a reader does.** A feature is a task or a place in the product ("place an order", "approve a request", "the audit list"), not a route, a file or a layer. A page, the requests it sends and the backend code that serves them are one feature spanning both sides: for each page find the request it sends and the route that serves it, and put both candidates in the feature. A reader-facing feature takes its name from the product's own label where there is one. Give features ids `F1`, `F2`, ... in reading order. Two features may share a name when they sit in different areas; the ids stay distinct.
- **Reach: how a reader gets to the feature.** Exactly one of:
  - `menu` - the reader opens it from a navigation menu. `label` is the menu text, `evidence` is the menu configuration line that holds it.
  - `link` - the reader can get there, but no menu entry shows it: a public link (sign-in, sign-up, password reset, a shared page), a link inside an email or message the product sends, a jump from another page, a menu entry that is commented out or hidden while its route is still registered. `label` is the text the reader sees there (or the commented-out menu text), `evidence` is the route registration, the place the link is built or the commented-out menu line. The `link` features are shown in their own list in the handbook; putting a feature there is a statement of how it is reached, not a judgment.
  - `automated` - scheduled or background work the reader does not start: jobs, queue consumers, event listeners.
  - `interface` - endpoints that other systems or external clients call (webhooks, public APIs), not the ones the product's own pages call.
  - `operator` - commands an operator runs: program starts, command-line tools, maintenance scripts.
  A `menu` or `link` feature needs `label` and `evidence`, and the label must occur in the quoted passage.
- **Labels, quoted from the source.** A label is the text exactly as the product shows it, in the source's language, never translated. Quote the line that holds it. When a menu text lives in a translation file under a key, quote the translation file's line that holds the text, so the label occurs in the passage.
- **Roles.** `roles` lists the user categories or permission levels the project defines, each with the line that defines it. Entries can name only these roles. Prefer the role name the product shows to its users: the entries of a role list or the options of a role select in the interface, a table of display names. Quote that line, so the label is the name a reader knows. Use the key the code uses (an enum value, often with an underscore) only when the product shows no name for that role: a code key passes the banned-word gate because it is a quoted label, and the reader would then see a code word where the product has a name.
- **Names.** `names` lists the external products, systems and integrations the source names (a messaging service, a code host, a payment provider), each as written in the source with the line that shows it. They are often written in camel or mixed case; a name listed here, with its passage, may appear in reader text.
- **Conservation.** Every candidate id in `candidates.json` appears in exactly one feature's `candidates` or in `unassigned` with a reason: test code, a dead registration, an outbound HTTP call a pattern mistook for a route, a health check no reader uses. The check prints each candidate that is missing and each that is assigned twice.
- **Seed files.** A feature's `seedFiles` are the files its lane reads first; from them the lane follows calls and imports to at most 20 more files, so list here what the feature is built from: the entrypoint files, the files they call or import directly, the files that define the forms, validation, constants, enums, statuses and settings the feature reads, the menu file its `where` labels come from, and for a page the code that sends its requests and the backend handlers that serve them. Every path exists inside the project and is not under `.git`, `node_modules`, `vendor`, `dist`, `build` or `.excavator`.

### Reader text

Everything a reader sees (area names, feature names, labels, reasons, and later the narrative of the entries) follows these rules, and the scripts enforce them:

- No code-shaped words. Refused: identifiers with an underscore (`order_status`), camel-case and mixed-case words (`orderStatus`, `PayPal`), paths that start with `/` (`/api/orders`), file names with a source extension (`.go`, `.ts`, `.tsx`, `.js`, `.jsx`, `.java`, `.py`, `.sql`, `.json`, `.yaml`, `.yml`), a name followed by `(` and the names of the project's member repositories. Say it in plain words. The one exception is a label or name that was quoted from the source and passed its check.
- Numbers are Arabic numerals, always ("2 levels", not "two levels"). A number in reader text must occur in the item's own quoted passages, so do not number features or areas in their names unless the source does.
- Labels stay in the source's language. The narrative, the area names you give and the reasons are written in `$LANGUAGE`.
- Describe the product as it is. No advice, no judgment of the product.

**Language of the narrative.** Everything you write yourself in the map (an area name without `evidence`, a feature name without a `label`, every reason in `unassigned`) is written in `$LANGUAGE`; a name quoted from the source stays as the source writes it. The scripts do not rely on this line alone: for a language with its own script (Chinese, Japanese, Korean, Russian and the like) they refuse any such text that holds no letter outside ASCII, and say which field. The fixed text of Phase 2 tells them which languages those are; a language written in Latin letters (French, Spanish) is not checked, and there the rule rests on you. A text made only of numbers and labels quoted from the source is not refused.

### Check and fix

```bash
node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-map "$OUT" --project "$PROJECT_ROOT"
```

`check-map` exits 1 and prints, one per line, every candidate assigned twice or not at all, every shape problem, every label that is not in its passage, every passage that is not in its file exactly once (a short passage found twice needs a longer one), every path that is outside the project or under a skipped directory, every missing seed file, every code-shaped word in reader text and, for a language with its own script, every name or reason of yours written only in ASCII letters. When `$RUN_LANGUAGE` is not English and `$OUT/ui.json` is missing or fails `check-ui`, it prints one line saying so and a `Next:` line: go back to Phase 2, then run it again. Fix `map.json` for each line and run it again; dispatch no lane until it exits 0. Fix the cause: quote the right passage, rename the feature, change its reach; never drop a candidate into `unassigned` with a reason that is not true. On exit 0 it prints `map ok: ...` and creates `state.json` with every feature planned. Then print the areas and the features to the user, one line each: id, name and reach.

### `--features`

Without `--features`, every feature gets an entry. With `--features`, run this once `check-map` passes, with the list as one single-quoted argument exactly as the user gave it:

```bash
node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" select "$OUT" --features '<the --features value>' --project "$PROJECT_ROOT"
```

- Exit 0: it prints the selected feature ids, one per line, in map order. Only those get lanes in Phase 4; `$SELECTED` is that list. Every other feature stays planned and is listed in the handbook as not written.
- Exit 1: an item matched no feature or several (two features share a name). It prints each failing item, then every feature as `id  name`, then a `Next:` line. Stop the run here: tell the user the lines it printed, as printed, dispatch no lane and run no further command.
- Exit 2: show its message and stop.

---

## Phase 3b: System overview

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The handbook opens with the system as a whole: what it is, who uses it, which applications it is made of and which external systems it calls. One subagent writes this overview from the code once the map has passed; the scripts check it, two verifiers and two tracers confirm each of its items (Phases 5 and 6, exactly as for a feature, with the id `overview`), and the script, not the subagent, computes every statistic next to it: each application's languages, frameworks, files and lines, its first and last commit date, commits and authors, the counts of the system and the roles of each area. `--features` does not skip the overview: it is written whenever it is not already, even when `$SELECTED` lists one feature.

1. Read the overview's state (a `state.json` without an `overview` key, as an output directory from before the overview has, reads as planned with no attempt):
   ```bash
   jq -r '(.overview // {status: "planned", attempts: 0}) | [.status, .attempts] | @tsv' "$OUT/state.json"
   ```
   - `checked`, `confirmed` or `verified`: the overview is not written again; go to Phase 4.
   - `dispatched` with `$OUT/entries/overview.json` present (an earlier run stopped after the subagent wrote): go to step 3 as if it had just returned.
   - `failed` with `attempts` 1 (an earlier run stopped before the second attempt): step 2 with the reasons `state.json` kept, `jq -r '.overview.failure.reasons[]' "$OUT/state.json"`, as the retry in step 3 gives them.
   - Any other state with `attempts` below 2: step 2. With `attempts` 2 and not `checked`, `confirmed` or `verified`, leave it as it is and go to Phase 4; the handbook then says the overview was not written and where it stopped.
2. Print what the prompt below needs, delete the file an earlier attempt left, record the dispatch and dispatch one subagent in the foreground (never in the background: a run without a terminal stops waiting for background subagents):
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" applications "$PROJECT_ROOT"
   jq -r '.areas[] | [.id, .name] | @tsv' "$OUT/map.json"
   jq -r '.features[] | [.id, .area, .reach, .name] | @tsv' "$OUT/map.json"
   jq -r '.roles[].label' "$OUT/map.json"
   jq 'del(.items) | del(.projectRoot)' "$OUT/candidates.json"
   rm -f "$OUT/entries/overview.json"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" mark "$OUT" overview dispatched --project "$PROJECT_ROOT"
   ```
   Fill the prompt's placeholders with those outputs and `$PLUGIN_ROOT`, `$PROJECT_ROOT`, `$OUT` and `$LANGUAGE` with their values.
3. When the subagent returns, check its file:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-overview "$OUT" --project "$PROJECT_ROOT"
   ```
   It records its result in `state.json` itself: `checked`, or `failed` with the lines it printed as the reasons; a subagent that wrote no file fails with `lane-wrote-nothing`.
   - Exit 0: the overview is checked.
   - Exit 1: it failed its checks. The last line is a `Next:` line; follow it as Phase 4 step 3 does for a lane, with `overview` for the id: `Next: delete overview's entry, mark it dispatched and re-dispatch it once with the lines above (attempt 2 of 2)` means delete `$OUT/entries/overview.json`, run the `mark` line of step 2 again and dispatch once more with the prompt followed by `Your previous attempt failed these checks; fix them and write the file again:` and each line printed except the `Next:` line; check it again when it returns. `Next: overview stays failed (2 of 2 attempts)` leaves it failed, with its file kept for the user to see: never a third attempt. A `Next:` line that starts `Next: write ui.json first` is not an attempt: go back to Phase 2, then check again.
   - Exit 2: the command could not run. Show its message and stop.

   Never edit `entries/overview.json` or `state.json` yourself, and never widen a passage or reword the overview to make it pass.

   Then tell the user `Overview: <status>`, where `<status>` is `checked` or `failed`, in `$LANGUAGE`.

The overview prompt:

````text
You write the system overview of a product handbook, for readers who do not read code, from the source of the project at $PROJECT_ROOT. It says what the system is, who uses it, which applications it is made of and which external systems it calls, as the code is today.

Your scope. Read: the areas, features and roles of the map below; the head of the candidate list below; the application roots below (one line each: the directory, `.` being the project root, and its build manifests); each application's build manifests and its entry files; and the hits of searches over the whole project for external SDKs, HTTP clients, queue and mail clients and credential or endpoint configuration (for example `grep -rnIE --exclude-dir=.excavator --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=vendor --exclude-dir=dist --exclude-dir=build '<pattern>' .`). Open at most 30 files that are not build manifests, in all; searches do not count. Never open a file to look at what a directory holds. Never read anything under `.excavator/`, never read a document that an Excavator skill generated (PRD.md, handbook.md, reports, findings, tours), and never read an explanatory document: no `.md`, `.mdx`, `.txt`, `.rst` or `.adoc` file and no docs folder. A document may be out of date, and the overview says what the code does today. Read code only; never run, build or change anything in the project.

The areas of the map (id, name): <areas, one per line>
The features of the map (id, area, how readers reach it, name): <features, one per line>
The roles of the map: <roles, one label per line>
The head of the candidate list (frameworks found, what was skipped): <the output of the jq line, as printed>
The application roots (directory, build manifests): <the output of the applications command, as printed>

Write in `$LANGUAGE`, in plain words for a reader who does not read code. Describe what the system does today. Give no advice, no opinion and no defect report: never write what the system should do or what is wrong with it.

Write one JSON file with exactly these keys, and no others. `E` stands for an evidence list, a non-empty array of `{"file": "<path from the project root>", "passage": "<text copied from that file>"}`:

```json
{
  "format": "excavator-product-handbook-overview/1",
  "id": "overview",
  "summary": [{"text": "<one plain sentence: what the system is and does>", "evidence": E}],
  "audiences": [{"who": "<a kind of user: staff, customers, partners, other systems>", "does": "<what they do in the system>", "evidence": E}],
  "applications": [{"dir": "<a directory that holds a build manifest: an application root above, or one below it; . is the project root>", "name": "<the application's name as readers know it>", "does": "<what it is responsible for>", "evidence": E}],
  "integrations": [{"system": "<external system as the source writes its name>", "use": "<what the system uses it for>", "callers": ["<the dir of an application listed above>"], "evidence": E}],
  "unknowns": [{"item": "<what the code does not settle>", "searched": "<what you searched>"}]
}
```

Every key is always there: write an empty list when nothing applies (`"integrations": []`), never leave a key out and never add one. `summary` has one to three items; `applications` has at least one. `unknowns` has no evidence.

**Applications.** Every application root listed above must be covered: list at least one application whose `dir` is that root or lies below it (a repository that holds several applications can list each of them, a directory below the root that holds its own build manifest). Two applications never name the same directory, and a `dir` must hold a build manifest: a directory with none is refused. Each application is named by what readers call it and says what it is responsible for.

**External systems.** An integration is a system outside the project that the code calls or is called by: a payment or messaging service, a mail or storage service, an identity provider, another company's API. `system` is its name exactly as the passage writes it, so the name must occur in the item's own passages (a name that is not in the quoted lines is refused). `callers` lists the `dir` of each listed application that calls it, at least one. Cite the line that calls it (the client call, the SDK construction, the endpoint or credential setting), not a list of dependencies.

**Evidence.** Every item carries its own evidence. A passage is text copied verbatim from the file, part of a line or whole lines; a script finds it by ignoring differences in white space and line breaks, and it must occur **exactly once** in that file. When it occurs more than once, quote a longer one. A file is a path from the project root, inside the project, never under `.excavator`, `.git`, `node_modules`, `vendor`, `dist` or `build`, and never a document (`.md`, `.mdx`, `.txt`, `.rst`, `.adoc`): cite the code that shows it. An item may cite several passages; each is checked. Cite for each item the passage that by itself proves it: an item the code shown does not support is removed from the handbook by two verifiers that see only the item and the code around its citations, and by two tracers that read the whole project. A statement about the system as a whole ("a tool for ...") is hard to prove from one line; cite the entry file or the route table that shows what it does, and keep the sentence to what that code shows. When no passage proves it, write it in `unknowns`.

**Only what the quoted lines show.** Every detail you add is one more thing the verifiers must find in the code shown, and an item with one detail they cannot find is removed whole. So:
- A `summary` sentence names only what its passages name. Cite the menu or the route table and name the parts it lists; never write "all", "every" or a list longer than the lines you quote. Two short sentences that each cite their own table are better than one long one.
- An application's `does` says what its entry file or route table shows it serving; never "all the pages" or "every service" unless the quoted lines are the whole list.
- An audience cites the check that lets that kind of user in (the role test, the guard, the login of that kind of account) together with the route or screen of what they do there; do not add what they can see or not see unless the quoted check shows it.
- An integration's `use` says what the quoted call does (sends a message, uploads a file, asks for a completion), not who it is for or what triggers it, unless those are in the quoted lines too. Name the provider only as the passage writes it: a mail client that sends over SMTP is not proof of a particular mail service.
- When one item needs a fact the passage does not show, leave that fact out of the item, or move it to `unknowns`.

**Numbers and names.** Every number in your text must occur as a number in that item's own passages; write numbers as Arabic numerals; a count you made is not allowed. Every `system` must occur in that item's own passages.

**No code in reader text.** Everything except `evidence`, `dir` and `callers` is read by a reader. It contains no identifier with an underscore, no camel-case or mixed-case word, no path that starts with `/`, no file name with a source extension (.go .ts .tsx .js .jsx .java .py .sql .json .yaml .yml), no name followed by `(`, and no name of a member directory of the project. Say it in plain words. The only exceptions are a `system` that passed its own check and the names the map lists.

**Negative and absolute statements.** Before you write that something is never called, always done or the only one, search the whole project; when you cannot settle it, write it in `unknowns` with what you `searched`.

Every narrative value of the file is written in $LANGUAGE: `summary` texts, `who`, `does`, `name`, `use`, and the unknowns. `system`, `dir` and `callers` stay as the source and the list above write them.

**Check your file before you reply.** Run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" try-overview "$OUT" --project "$PROJECT_ROOT"`. It runs the checks the orchestrator runs on your file and records nothing; when $LANGUAGE has its own script, it also refuses a narrative value that is written only in ASCII letters. Fix the file for every line it prints and run it again until it prints `overview: ok`, at most 5 runs. A passage reported as not in its file is most often a real line that sits in another file: search for it (`grep -rnF`) and cite the file it is in. An item whose source you cannot find leaves the overview, or goes into `unknowns`; never cut a passage down until it happens to match.

Write only `$OUT/entries/overview.json`, and nothing else anywhere. Reply with one line: `overview: written`, and nothing else.
````

---

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
   Dispatch at most `$CONCURRENCY` lanes in one message so they run concurrently, each a subagent in the foreground with the prompt below, its placeholders filled in from `map.json` and `candidates.json` and `$PLUGIN_ROOT`, `$PROJECT_ROOT`, `$OUT` and `$LANGUAGE` written as their values. Wait for every lane of the message to return before you send the next; never in the background: a run without a terminal stops waiting for background subagents.
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
You write one entry of a product handbook, for readers who do not read code, from the source of the project at $PROJECT_ROOT. Your feature: <id> "<name>" in the area "<area name>"; readers reach it <reach, in words: from the menu / by a link / automatically / as an interface for other systems / as an operator command><, shown to readers as "<label>" when the feature has a label>.

Your scope. Start with these files, the seed files: <seedFiles, one per line>. Beyond them, open only the files that **Following out of the seed files** allows, and search the whole project as that paragraph and **Negative and absolute statements** ask. Its entrypoints: <candidates, one per line: id, kind, file:line, text>. The other features of this handbook, which other lanes write: <id and name of every other feature, one per line>. Describe a hand-over to another feature in one sentence, not its flow. Read code only; never run, build or change anything in the project. Never read anything under `.excavator/` and never read a document that an Excavator skill generated (PRD.md, handbook.md, reports, findings, tours); every searched path you open is project source or configuration. Exclude `.excavator`, `.git`, `node_modules`, `vendor`, `dist` and `build` from every search (for example `grep -rn --exclude-dir=.excavator --exclude-dir=node_modules ...`).

The roles an entry may name, and no others: <roles, one label per line>.
The names of external products and systems that the map lists: <names, one label per line>.

Write in `$LANGUAGE`, in plain words for a reader who does not read code. Describe what the product does today. Give no advice, no opinion and no defect report: never write what the product should do or what is wrong with it.

Every narrative value of the JSON file below is written in $LANGUAGE: the purpose, what a role can do, the names and sentences of the operations, the rule texts, the meanings of states, the parts of a notification, the automatic behavior and the unknowns. Labels, screen names, `where` labels and the roles stay exactly as the source and the list above write them.

Write one JSON file with exactly these keys, and no others. `E` stands for an evidence list, a non-empty array of `{"file": "<path from the project root>", "passage": "<text copied from that file>"}`:

```json
{
  "format": "excavator-product-handbook-entry/1",
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
  "operations": [{"name": "<what the reader does>", "sentences": [{"text": "<one sentence>", "evidence": E}]}],
  "states": [{"label": "<status as shown>", "meaning": "<what it means>", "evidence": E}],
  "notifications": [{"trigger": "<when>", "recipient": "<who gets it>", "channel": "<how>", "content": "<what it says>", "evidence": E}],
  "automatic": [{"when": "<schedule or trigger>", "effect": "<what happens>", "evidence": E}],
  "unknowns": [{"item": "<what the code does not settle>", "searched": "<what you searched>"}]
}
```

Every key is always there: when a part does not apply to your feature, write an empty list (`"notifications": []`), never leave the key out and never add a key. `unknowns` has no evidence. `operations` is the readable part: each operation is the story of one thing the reader does, from the action to the result across the frontend and the backend, as sentences, one `sentences` item per sentence, each with its own evidence. A field's `rules` keeps the frontend and the backend apart (`side` is `frontend` or `backend`): put a rule on the side that enforces it, and when only one side checks something, write it on that side only. Every displayed or computed number gets its calculation and inputs; every configurable item says what configuring it does; every notification gets its trigger, recipient and content.

**Following out of the seed files.** The seed files are where you start, not a fence. When a file you have read hands part of your feature to code in another file, follow it there: find where the imported module, the called function or method, or the constant, enum, template, message text, validation rule or component it uses is defined (search with `grep -rn`; in a language whose package spans the files of one directory, such as Go, the files beside a seed call each other without an import), and open that file. Follow every decision a reader sees to the code that makes it: who receives a notification and what it says; how a displayed or computed number is calculated, with which rate, rounding and cap, and from which date or input; when a step of an approval or a flow is skipped or added; which columns a list shows, how it is sorted by default and how it can be filtered; what a detail page shows. A function's name does not say which records it returns or which people it picks (a word such as all, list or a role name in it settles nothing): before you write who receives something, who may act or which records count, open the function and write the filters its query applies, or write the claim without "all" and "every". When several handlers or categories share a field or a step, check each one before you say where its value comes from (which date, which input, which rate), and say it per handler when they differ. Before you write an item in `unknowns`, follow the call or import that could settle it. Open at most 20 files that are not seed files, in all; searches do not count. Open only a file that a file you have read leads to, and never list or walk a directory to see what is in it. When the 20 are spent, open no more: write what is not settled in `unknowns`, and say in `searched`, in plain words, what you did not open. In a file another feature also uses, read only what your feature uses, and describe a hand-over to another feature in one sentence, as above.

**Evidence.** Every item carries its own evidence. A passage is text copied verbatim from the file, part of a line or whole lines; a script finds it by ignoring differences in white space and line breaks, and it must occur **exactly once** in that file. When a passage occurs more than once, quote a longer one (the whole line, or the lines around it). A file is a path from the project root, inside the project, and never under `.excavator`, `.git`, `node_modules`, `vendor`, `dist` or `build`. An item may cite several passages; each is checked.

**Cite what proves it.** A verifier that sees only one item and the code around its citations judges every item afterwards, and an item the code shown does not support is removed from the handbook. So cite, for each item, the passage that by itself proves it. For who may do something, cite the condition the code checks (the comparison, the role test, the guard that lets one role in and keeps another out), not the name of a function or variable: a name that contains a role word says nothing about who may act. For a claim of "every", "any" or "cannot already", cite the whole condition, so that a narrower one cannot hide outside the quote. When no passage proves it, write it in `unknowns`. The purpose is one plain sentence saying who uses the feature to do what, citing the screen or handler that shows it; conditions, filters and limits belong in the rules, not in the purpose, because every extra detail in it is one more thing the code shown has to prove.

**Labels and numbers must be in the item's own passages.** Every `label`, every screen `name` and every `where` label must occur in that item's own passages, exactly as the source writes it, in the source's language: never translate a label. Every number in your text must occur as a number in that item's own passages (the script ignores thousands commas, and underscores between digits in the source). Write numbers as Arabic numerals ("2 levels", never "two levels"). A number that is not in the item's passages (a count you made, an ordinal, a date) is not allowed: write the sentence without it, or cite the passage that holds it. The numbers of an operation's name are read against its sentences' passages.

**Roles from the map.** `who.role` is one of the roles listed above, spelled the same. A role the list does not hold goes into `unknowns`.

**No code in reader text.** Everything except `evidence` is read by a reader. It contains no identifier with an underscore, no camel-case or mixed-case word, no path that starts with `/`, no file name with a source extension (.go .ts .tsx .js .jsx .java .py .sql .json .yaml .yml), no name followed by `(`, and no name of a member directory of the project. Say it in plain words. The only exceptions are a label quoted from the source that passes its own check and the names listed above. Never print a raw code, flag or `field=value`: read the enum or constant and write its meaning.

**Negative and absolute statements.** Before you write that something is never sent, never checked, not done, always done or done regardless of a setting, and before you write a trigger ("done by the nightly job", "recalculated by an event") or an ordering ("checked before"), search the whole project (every module, listeners and their registrations, scheduler registrations, SQL and migration scripts, configuration) and keep the searched scope in mind. If you cannot settle it, do not write it as a fact: write it in `unknowns` with `item` and what you `searched`.

**Check your file before you reply.** Run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" try-entry "$OUT" <id> --project "$PROJECT_ROOT"`. It runs the same checks the orchestrator runs on your file and records nothing; when $LANGUAGE has its own script, it also refuses a narrative value that is written only in ASCII letters, so write those values in $LANGUAGE and not in English. Fix the file for every line it prints and run it again until it prints `<id>: ok`, at most 5 runs. A passage reported as not in its file is most often a real line that sits in another file: search for it (`grep -rnF`) and cite the file it is in, or quote the line of the cited file that does say it. An item whose source you cannot find leaves the entry, or goes into `unknowns`; never cut a passage down until it happens to match.

Write only `$OUT/entries/<id>.json`, and nothing else anywhere. Reply with one line: `<id>: written`, and nothing else.
````

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
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" assemble "$OUT" --project "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" page "$OUT" --project "$PROJECT_ROOT"
   ```
   Both check the map, every verified entry (a confirmed one too, which they do not write) and the fixed text again before they write anything. Only a `verified` feature has a section in the handbook. `assemble` writes `$OUT/handbook.md` (the system overview first, which the script writes from the verified overview and its own counts, or a line saying where the overview stopped and the table of areas when the overview is not verified; then the areas and features, one section per verified feature, and a coverage section with the candidate counts, the unassigned candidates, the features reached by a link, the features without a verified entry, among them those whose verification or trace did not finish, and the items verification and the trace removed, each with its reason, the overview's included) and prints its path; between the feature sections and the coverage section it has two tables across features, every notification of the verified entries and one row for every scheduled-job candidate with the schedule its registration line gives, which the script writes from the verified entries and the source, so you write nothing for them. `page` writes `$OUT/handbook.html`, one page that opens from disk with a double click, with the same two tables on pages of their own, and prints its path; a failed `page` removes the page an earlier run left.
   - When `assemble` exits 1, show the lines. A line that says `entries/<id>.json no longer passes check-entry` (for the overview, `entries/overview.json no longer passes check-overview`) means the source changed after the entry was checked: run `check-entry` for that feature (`check-overview` for the overview), follow its `Next:` line as in Phase 4 (as in Phase 3b for the overview), verify it again as Phase 5 says and trace it as Phase 6 says, and run `assemble` again. A line that says `entries/<id>.json changed after it was verified` (or `confirmed`) means the entry file is not the one the verifiers and the tracers judged: run `check-entry` for that feature (it becomes `checked` again), verify it again as Phase 5 says and trace it as Phase 6 says, and run `assemble` again. Any other line: stop.
   - When `page` exits 2 because the page template does not exist, tell the user to run `pnpm -r build` at `$PLUGIN_ROOT` and then run this command again (a run resumes, so only this phase repeats). Any other non-zero exit: tell the user the lines it printed as they are; do not build or edit any page or product file yourself. Either way, go on to the reply: it prints `Page: not written`.
   - Then tell the user `Page: <status>`, where `<status>` is `written` or `failed`, in `$LANGUAGE`.
2. Reply. The handbook stays in `$OUT`: write it into the project only when the user says so.

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

Then print the reply's lines with this command:

```bash
node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" reply "$OUT" --project "$PROJECT_ROOT"
```

It prints, in this order: `Handbook:` and the path of `handbook.md`; `Page:` and the path of `handbook.html`, or `Page: not written`; `Features:` and the count of each status; `Overview:` and the status of the system overview (`planned` when it was never written); `Failed:` and the ids, when a feature or the overview failed; `Candidates:` and the conservation line. When it prints `handbook.md: missing`, run `assemble` and then this command again; when it exits 1 with other lines, show the lines and stop. Reply with exactly the lines it prints and nothing else: the same lines in the same order, none added and none left out. Write nothing before, between or after them, no word on the checks, the handbook or what was done, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply. When `$LANGUAGE` is not English, translate the words of those lines; the paths, the numbers and the ids stay as they are.
