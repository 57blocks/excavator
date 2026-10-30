---
name: excavator-product-handbook
description: Write a product handbook for non-technical readers from a project's source - a map of the product's areas and features, one entry per feature with its screens, fields, rules, states and notifications, every value checked against a passage quoted from the source and every item confirmed by a verifier that sees only that item and the code it cites, assembled into handbook.md and a one-file HTML page in the language you choose. A script lists the entrypoint candidates and checks every step, you write the map, one subagent per feature writes its entry and a second one checks it. It describes the product as it is and gives no advice.
argument-hint: "[path] [--language <lang>] [--out <dir>] [--features <list>] [--concurrency <n>] [--fresh]"
---

# /excavator-product-handbook

Write a **product handbook**: a document for people who use or manage the product and do not read code. It describes what the product **actually does today**, reverse-engineered from the source, organized the way a reader sees the product: areas, then the features in each area, then each feature's screens, fields, rules, states, notifications and automatic behavior.

Five rules govern everything below:

1. **As-Is only, no advice.** Describe behavior that exists in the code. Never write what the product should do, what is wrong with it, or how to change it. Where the code does not settle something, say so as an unknown and say what was searched.
2. **Nothing is dropped silently.** A script lists the entrypoint candidates (pages, routes, scheduled jobs, program starts). Every candidate belongs to exactly one feature or is listed as unassigned with a reason, and a script checks it.
3. **Every value has a source.** Each label, rule, number and sentence of an entry carries a passage copied from the source file. Scripts check that the passage is in the file exactly once, that every label and number is in its own passage, and that the file is project source.
4. **Readers see no code.** Reader-visible text contains no code-shaped words. A script refuses them; the rules are under **Reader text** in Phase 3.
5. **Nothing stays that the code does not back up.** A passage that exists can still be read wrongly. A verifier that sees one item and the code around its citations judges each item (Phase 5); an item it cannot confirm is rewritten once, and removed if it is still not confirmed. Only a verified feature is written into the handbook, and every removed item is listed in its coverage section.

## How the work is split

| Who | Does |
|---|---|
| `handbook.mjs` (a script, no model) | Lists the entrypoint candidates, checks the map and each entry, resolves `--features`, records each dispatch and result, cuts each entry into the items a verifier judges and records the verdicts, removes what stays unverified, checks the fixed-text table, assembles `handbook.md`, writes `handbook.html` and prints the closing lines. |
| You (the orchestrator) | Write the map, dispatch the lanes, the verifiers, the rewriters and the translation of the fixed text, and reply. |
| One subagent lane per feature | Reads that feature's files and writes its entry, one file, nothing else. |
| Two `excavator-handbook-verifier` subagents per part of a feature and round | Each reads the same verify file (the items of the part, each with its claim and the code it cites), without seeing the other, and judges each item `verified`, `unverified` or `contradicted`, with a one-line reason. |
| One rewrite subagent per feature that has items to rewrite | Changes only the items the verifier did not confirm, in the entry file. |
| One subagent for the fixed text (only when the language is not English) | Translates the fixed-text table and writes `ui.json`. |

All files of a run live in `$OUT`:

| File | Written by |
|---|---|
| `candidates.json` | `handbook.mjs candidates` (you save its output) |
| `map.json` | you |
| `entries/<id>.json` | the lane of feature `<id>` |
| `state.json` | `handbook.mjs` only (`check-map`, `check-entry`, `mark`, `verdicts`) |
| `verify/round-<r>/<id>/part-<n>.json` | `handbook.mjs slices` (the items of a feature, with their claims and code, cut by size into parts); `verify/round-1/<id>.entry.json` is the entry as round 1 saw it |
| `verdicts/round-<r>/<id>/part-<n>.a.json` and `part-<n>.b.json` | the two verifiers of part `<n>` of feature `<id>`, one file each |
| `rewrite/<id>.json` | `handbook.mjs verdicts --round 1` (the items to rewrite, with the verdicts) |
| `ui.json` | the translation subagent; for English, the script copies its shipped table |
| `handbook.md` | `handbook.mjs assemble` |
| `handbook.html` | `handbook.mjs page` |

## Options

`$ARGUMENTS` may contain:
- A directory path - the project to document (default: current working directory).
- `--language <lang>` - the language of the handbook's narrative, its area names and fixed text, and of everything said to the user during the run; English when it is not given. Labels quoted from the source stay in their source language.
- `--out <dir>` - where the run's files, the handbook and the page go (default: `<project>/.excavator/product-handbook`).
- `--features <list>` - write entries only for these features, as a comma-separated list of feature ids or feature names (a name is matched ignoring case, as a whole name). The map still covers every candidate; the features without an entry are listed in the handbook as not written. Feature ids exist only after the map is written, which is why names are accepted: Phase 3 resolves the list with `select`.
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
   - Without `--fresh`, an `$OUT` that holds files of an earlier run is resumed: each phase below skips what its files already show done. `candidates.json` is kept as it is (a run over changed source needs `--fresh`). When `$OUT/map.json` exists, read its language with `jq -r .language "$OUT/map.json"`; when it differs from `$RUN_LANGUAGE`, tell the user to run again with `--fresh`, and stop. The fixed text (Phase 2) is written before the map, so an `$OUT` can hold a `ui.json` and no map: when `$OUT/ui.json` exists and `jq -r .language "$OUT/ui.json"` differs from `$RUN_LANGUAGE`, do the same.
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
- **Seed files.** A feature's `seedFiles` are the files its lane reads, and the lane reads nothing else except for searches: the entrypoint files, the files they call or import directly, the files that define the forms, validation, constants, enums, statuses and settings the feature reads, the menu file its `where` labels come from, and for a page the code that sends its requests and the backend handlers that serve them. Every path exists inside the project and is not under `.git`, `node_modules`, `vendor`, `dist`, `build` or `.excavator`.

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

## Phase 4: Entries

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

1. List the lanes this run dispatches. `<ids>` is `$SELECTED` space-separated, or empty without `--features`:
   ```bash
   jq -r --arg ids "<ids>" '($ids | split(" ") | map(select(. != ""))) as $want | .features | to_entries[] | select(($want | length) == 0 or (.key | IN($want[]))) | [.key, .value.status, .value.attempts] | @tsv' "$OUT/state.json"
   jq -r '.features[] | [.id, .reach, .name] | @tsv' "$OUT/map.json"
   ```
   A feature that is `checked` is not written again. A feature that is `dispatched` and has an entry file (an earlier run stopped after its lane wrote) goes to step 3 first, as if its lane had just returned. Every other feature with `attempts` below 2 gets a lane; one with `attempts` 2 that is not `checked` stays as it is. Before you dispatch a lane again, delete the file its earlier attempt left: `rm -f "$OUT/entries/<id>.json"`. A feature that is `failed` with `attempts` 1 (an earlier run stopped before its second attempt) gets its second attempt as step 3 describes, with the reasons `state.json` kept from the first: `jq -r '.features["<id>"].failure.reasons[]' "$OUT/state.json"`.
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

Your scope. Read only these files: <seedFiles, one per line>. The one exception is the whole-project search that **Negative and absolute statements** asks for. Its entrypoints: <candidates, one per line: id, kind, file:line, text>. The other features of this handbook, which other lanes write: <id and name of every other feature, one per line>. Describe a hand-over to another feature in one sentence, not its flow. Read code only; never run, build or change anything in the project. Never read anything under `.excavator/` and never read a document that an Excavator skill generated (PRD.md, handbook.md, reports, findings, tours); every searched path you open is project source or configuration. Exclude `.excavator`, `.git`, `node_modules`, `vendor`, `dist` and `build` from every search (for example `grep -rn --exclude-dir=.excavator --exclude-dir=node_modules ...`).

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

A `checked` feature has an entry whose shape, citations, labels, numbers and words the scripts checked. That does not show that each item says what its passage does: a passage can be real and be read wrongly (a function name read as a role, a condition that stops two cases read as "every case"). Readers cannot read the code to find out, so each item is judged by a verifier that sees nothing of the map, the other features or the writer's reasons. Only a `verified` feature is written into the handbook.

1. List the features that need this phase, and for each whether it is at round 1 (`verify`) or waits for its one rewrite (`rewrite`):
   ```bash
   jq -r '.features | to_entries[] | select(.value.status == "checked") | [.key, (if .value.rewriting then "rewrite" else "verify" end)] | @tsv' "$OUT/state.json"
   ```
   A feature that is `verified`, `failed`, `planned` or `dispatched` is not in the list: `verified` is done, the others have no entry that passed the checks. With no feature in the list, go to Phase 6.
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
   - Exit 0 and `<id>: verified (<n> items)`: the feature is verified, whatever the number of its parts. Nothing more to do for it.
   - Exit 0 and `<id>: <n> items to rewrite`, then `Rewrite file: <path>`: the items the two verifiers did not both confirm (`contradicted` when either said so, otherwise `unverified`, with the reason of a verifier that did not confirm it), `unverified` and `contradicted` alike, are in that file with the claim, the verdict and the reason of each. Go to step 4 for it.
   - Exit 1: nothing was recorded. Each line says why, led by its part and verifier (`part <p><x>: ...`, `<x>` being `a` or `b`): that verdict file is missing (the verifier wrote nothing), or does not hold exactly one verdict for each item of that part (a verdict for an item of another part counts as extra), or a verdict is not one of the three words, or a reason is empty, has more than one line, names a file, or (for a verdict that is not `verified`, which readers see) holds a code-shaped word or, in a language with its own script, no letter of it. Dispatch a verifier once more for each part-letter the `Next:` line names (a file of its own: `1b` is the second verifier of part 1), and for no other. For a missing file, the prompt as it was. For a rejected file, the prompt followed by this line and then each line printed for that part-letter except the `Next:` line (the lines that start with `part <p><x>:`, without that start): `Your previous verdict file was rejected for these reasons; write it again:`. Delete the old verdict file of a rejected part-letter first (`rm -f "<the verdict file>"`). Then run `verdicts` again. When `verdicts` still exits 1, leave the feature as it is, `checked`: it is listed in the handbook as verification not finished. Never write or change a verdict yourself, and never edit `state.json`.
4. Rewrite, once. For each feature with a rewrite file, dispatch one rewrite subagent (a general-purpose subagent, in the foreground, up to `$CONCURRENCY` in one message) with the prompt below, its placeholders filled in:

````text
You correct some items of one entry of a product handbook, for readers who do not read code, so that each says only what the source of the project at $PROJECT_ROOT shows. Your feature: <id>.

Your scope. Read `<the rewrite file>`: the items a verifier could not confirm, each with its id (its place in the entry), its claim, its verdict and its reason. `unverified` means the code the verifier saw neither supports nor denies the item; `contradicted` means it disagrees. Read `$OUT/entries/<id>.json`, the entry you change, and the source files its listed items cite; search the project when you need another passage. The unchanged entry of round 1 is `$OUT/verify/round-1/<id>.entry.json`; read it only to put an item back as it was. Read code only; never run, build or change anything in the project. Never read anything under `.excavator/` except those files of this run, and never read a document that an Excavator skill generated (PRD.md, handbook.md, reports, findings, tours). Exclude `.excavator`, `.git`, `node_modules`, `vendor`, `dist` and `build` from every search.

What you do. For each listed item, in the entry file, do one of these two:
- cite a passage that by itself proves the item (for who may do something, the condition the code checks, not the name of a function or variable), and change the text only as far as that passage needs;
- narrow the text to what the code shows (a statement for "every" case that the code limits to some cases is written for those cases);
When an item cannot be saved, leave it exactly as it is: the script removes it after the second check. Never delete or add an item, and never move one into `unknowns`.
Change nothing else. An item that is not listed stays exactly as it is: its text, its citations, and also the screen name, field label or operation name its claim is written under. A script compares the entry with round 1 and refuses an entry in which an item is missing or added, or an item that is not listed differs. The items that hang on a listed item (the fields and rules of a listed screen, the rules of a listed field) count as listed.

Every rule of the original entry still holds: the same shape and keys; every label and number of an item occurs in that item's own passages; no code-shaped words in reader text; roles only from the map's list (<roles, one label per line>); numbers as Arabic numerals; narrative in `$LANGUAGE`; labels exactly as the source writes them; no advice and no opinion.

Check your file before you reply. Run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" try-entry "$OUT" <id> --project "$PROJECT_ROOT"` and `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" slices "$OUT" <id> --round 2 --project "$PROJECT_ROOT"`. The first runs the checks of the entry and records nothing. The second prints each item that is missing or added, and each item that is not listed and that you changed, when there is one: put it back as it is in the round 1 entry. Fix the file for every line either prints and run both again until `try-entry` prints `<id>: ok` and `slices` prints its `Verify file:` line, at most 5 runs.

Write only `$OUT/entries/<id>.json`, and nothing else anywhere. Reply with one line: `<id>: rewritten`, and nothing else.
````

5. As each rewrite subagent returns, check its entry and cut the rewritten items, one command at a time:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-entry "$OUT" <id> --project "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" slices "$OUT" <id> --round 2 --project "$PROJECT_ROOT"
   ```
   - `check-entry` exit 1: the feature is `failed` at the step `rewrite`; there is no second rewrite. Leave it and go on with the next feature.
   - `slices` exit 1: the rewrite changed an item that was not listed, or deleted or added an item, and the lines name each path. There is no second rewrite: leave the feature as it is, `checked`; it is listed in the handbook as verification not finished.
   - `slices` exit 0 prints the `Part <p>/<k>:` lines with the `Verify file:` and `Verdict files:` paths for round 2, and holds only the listed items and the items that hang on them.
6. Dispatch the verifiers of round 2 as in step 3, two per part: the same agent type, the same prompt with the round 2 paths, up to 10 in one message, in the foreground; an item is verified only when both confirm it, as in round 1. Round 2 holds only the rewritten items, so it usually has one part. A verdict file that is missing or rejected is dispatched once more as in step 3; when it still fails, leave the feature as it is.
7. Settle each feature:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" verdicts "$OUT" <id> --round 2 --project "$PROJECT_ROOT"
   ```
   - `<id>: verified (<n> items)` or `<id>: verified, <n> items removed`: the feature is verified. An item the two verifiers did not both confirm, `unverified` like `contradicted`, was removed from the entry together with what hangs on it, and is recorded in `state.json` with its claim, verdict and reason. The handbook's coverage section lists each removed item. The removal is not a rewrite: never put a removed item back.
   - The purpose is an item like any other: when the two verifiers do not both confirm it, it is removed and recorded, and the feature stays verified. Its section is then missing from the handbook and the page, and the coverage section lists the removed purpose.
   - `<id>: failed at verify: no item could be proved`: nothing of the entry was proved. It is `failed`; its entry file stays for the user to see.
   - Exit 1: nothing was recorded; handle it as in step 3 (dispatch the verifier once more with the printed lines, then leave the feature as it is).

Then tell the user `Verify <id> <n>/<N>: <status>` for each feature, where `<n>` counts the features of this phase that are settled, `<N>` is the number of features step 1 listed and `<status>` is `verified`, `failed` or `not finished`, in `$LANGUAGE`.

Never edit `entries/<id>.json`, a verify, verdict or rewrite file or `state.json` yourself. Statuses change only through the commands above.

---

## Phase 6: Assemble, page and reply

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

1. Assemble the handbook and write the page:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" assemble "$OUT" --project "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" page "$OUT" --project "$PROJECT_ROOT"
   ```
   Both check the map, every verified entry and the fixed text again before they write anything. Only a `verified` feature has a section in the handbook. `assemble` writes `$OUT/handbook.md` (the areas and features, one section per verified feature, and a coverage section with the candidate counts, the unassigned candidates, the features reached by a link, the features without a verified entry, among them those whose verification did not finish, and the items verification removed, each with its reason) and prints its path. `page` writes `$OUT/handbook.html`, one page that opens from disk with a double click, and prints its path; a failed `page` removes the page an earlier run left.
   - When `assemble` exits 1, show the lines. A line that says `entries/<id>.json no longer passes check-entry` means the source changed after the entry was checked: run `check-entry` for that feature, follow its `Next:` line as in Phase 4, verify it again as Phase 5 says, and run `assemble` again. A line that says `entries/<id>.json changed after it was verified` means the entry file is not the one the verifier judged: run `check-entry` for that feature (it becomes `checked` again), verify it again as Phase 5 says, and run `assemble` again. Any other line: stop.
   - When `page` exits 2 because the page template does not exist, tell the user to run `pnpm -r build` at `$PLUGIN_ROOT` and then run this command again (a run resumes, so only this phase repeats). Any other non-zero exit: tell the user the lines it printed as they are; do not build or edit any page or product file yourself. Either way, go on to the reply: it prints `Page: not written`.
   - Then tell the user `Page: <status>`, where `<status>` is `written` or `failed`, in `$LANGUAGE`.
2. Reply. The handbook stays in `$OUT`: write it into the project only when the user says so.

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

Then print the reply's lines with this command:

```bash
node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" reply "$OUT" --project "$PROJECT_ROOT"
```

It prints, in this order: `Handbook:` and the path of `handbook.md`; `Page:` and the path of `handbook.html`, or `Page: not written`; `Features:` and the count of each status; `Failed:` and the ids, when a feature failed; `Candidates:` and the conservation line. When it prints `handbook.md: missing`, run `assemble` and then this command again; when it exits 1 with other lines, show the lines and stop. Reply with exactly the lines it prints and nothing else: the same lines in the same order, none added and none left out. Write nothing before, between or after them, no word on the checks, the handbook or what was done, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply. When `$LANGUAGE` is not English, translate the words of those lines; the paths, the numbers and the ids stay as they are.
