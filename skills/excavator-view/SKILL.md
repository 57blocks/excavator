---
name: excavator-view
description: Pack the products in a project's .excavator/ folder (knowledge graph, domain graph, unused-code, doc-map, hotspots, the tour and the relations graph) into one self-contained HTML file and open it with the system's default browser. A deterministic script writes the page and gives each product a visible state; the page needs no network, no server and nothing to install. It runs no analysis, edits no other file and gives no advice.
argument-hint: "[project-path] [--source] [--no-source] [--out <path>] [--language <lang>]"
---

# /excavator-view

Write one HTML file that shows the products already in `.excavator/`, and open it in the browser. Nothing is analysed here: a product that was never produced shows as **not run**, with the command that produces it.

| Who | What |
|---|---|
| `pack.mjs` | Reads the products and the source snapshot's revision, gives every product one state (included, not run, unreadable, different revision; semantics and the tour are not shown when they pass their own checks but no knowledge graph can be read whole; the relations graph's coverage report has a state of its own and is packed only when the same run wrote it), and writes `.excavator/explorer.html` through a temporary file and a rename. The page is the template `packages/explorer` builds (`pnpm build` writes it to `packages/explorer/dist/explorer.html`) with the policy and the products inserted: an index block and the data as gzip-compressed parts (`data-chunks.mjs`), each part small enough to be one string, so a very large project still opens; the page decodes a product the first time its view is opened. It prints one JSON result. |
| `translations.mjs` | Only for a language other than English: lists the names the page shows that the translation table beside the page lacks (`plan`), then checks the translations a subagent wrote and merges the good ones into the table (`check`). It makes no model call. |
| `excavator-view-translator` | The only model call of this skill, made only for a language other than English: translates the names of one batch file into the result file. |
| You | Translate first when a language other than English was asked for, run the packer, open the file, and print the reply lines. |

## Options

`$ARGUMENTS` may contain the project path (default: the current working directory), `--source`: put the source text of the files the products name into the file (without it the page holds no source text; `--no-source` says the same explicitly), `--out <path>`: write the page there instead of `.excavator/explorer.html`, and `--language <lang>`: show the names of nodes, domains, flows and steps, the feature group labels, and the relations graph's unit names, external system labels and reasons of at most 60 characters, in that language, with the English original beside each (`en`, `english`, `en-...` and `en_...` mean English, which is also what no `--language` means). The language name is trimmed and lower-cased, may hold only letters, digits, `-` and `_`, and is the file name of the translation table. The table is written beside the page, so `--out` moves it too.

---

## Step 1 — Translate the names

**Language.** Write everything you tell the user during this run in English: each line between commands and the final reply. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

**Names in another language.** Do this only when the user gave `--language <lang>` and the language is not English. For no `--language`, for `en`, `english`, `en-...` and `en_...`, this step does nothing: run no `translations.mjs` command, dispatch no subagent, create no file, and go on to Step 2.

The names on the page come from the analysis in English. `plan` lists the ones the table lacks, a subagent translates them, `check` tests what it wrote and merges the good ones into the table; Step 2 then reads the table and makes no model call.

```bash
PROJECT_ROOT="$(pwd)"   # or the path argument
SKILL_REAL=$(realpath ~/.agents/skills/excavator-view 2>/dev/null || readlink -f ~/.agents/skills/excavator-view 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
PLUGIN_ROOT=""
for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do
  if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then PLUGIN_ROOT="$candidate"; break; fi
done
echo "plugin root: $PLUGIN_ROOT"
node "$PLUGIN_ROOT/skills/excavator-view/translations.mjs" plan "$PROJECT_ROOT" --language "<lang>"            # add --out <path> only when the user gave it
```

`plan` prints one JSON line: `language` (the table's name), `english`, `total` (names on the page), `missing` (names without a translation) and `batches` (each with the absolute `batch` and `result` paths). A non-zero exit (a language name that is not allowed, an unreadable table, no `.excavator/`) writes no batch: give the message as it stands and stop, and print no reply lines.

- `missing` is 0: nothing to translate, no batch file is written. Dispatch no subagent and go on to Step 2.
- Otherwise dispatch the subagent `excavator-view-translator` once for each entry of `batches`, with this prompt and nothing else: `Batch file: <batch path>. Result file: <result path>.` Dispatch them in the foreground, never in the background; several Agent calls may go in one message. Wait for every one to return.

Then check what they wrote. Every command runs in a new shell, so write the plugin root it printed as a literal path:

```bash
node "<the plugin root printed above>/skills/excavator-view/translations.mjs" check "<project root>" --language "<lang>"            # add --out <path> only when the user gave it
```

`check` prints one JSON line: `merged` (translations added to the table), `failed` (a count for each reason a translation was refused), `retry` (batches written for the refused ones) and `finalEnglish` (names that stay English in this export). If `retry` lists entries, dispatch `excavator-view-translator` once for each of them the same way, in the foreground, and run `check` again. Do this once: a name refused a second time stays English and is counted in the reply, and no third round is run. A name whose translation is refused twice is recorded in the translation table as refused and is not sent again until its English changes (deleting its table entry, or the table, sends it again), while a name the subagent wrote no usable result for (no result file, mismatched keys, or no entry for it) is sent again by the next export. `check` deletes the work directory when nothing is left to retry.

The subagent writes only its result file; only `check` writes the table. A name the table has no translation for shows in English on the page, and the reply's sixth line counts it.

## Step 2 — Pack the page

Run the packer in the foreground. It makes no model call, starts no process that keeps running, and with `--language` only reads the translation table: it never writes it.

```bash
PROJECT_ROOT="$(pwd)"   # or the path argument
SKILL_REAL=$(realpath ~/.agents/skills/excavator-view 2>/dev/null || readlink -f ~/.agents/skills/excavator-view 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
PLUGIN_ROOT=""
for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do
  if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then PLUGIN_ROOT="$candidate"; break; fi
done
echo "plugin root: $PLUGIN_ROOT"
node "$PLUGIN_ROOT/skills/excavator-view/pack.mjs" "$PROJECT_ROOT"            # add --source, --no-source, --out <path> and --language "<lang>" only when the user gave them
```

The result is one JSON line: `out` (the absolute path of the page), `bytes`, `snapshotRevision`, `products` (each with `name` and `status`, and `reason`, `revision` or `note` when it has one), `source` and `issues`.

A non-zero exit writes no new page and leaves an existing one as it was; without a built template the packer exits non-zero and its message says to run `pnpm build`. Give the message the script printed as it stands and stop: print no reply lines.

Every command runs in a new shell, so variables from this block are gone in the next: write the plugin root it printed as a literal path in the commands of Steps 3 and 4.

An empty `.excavator/` is not a failure: the page is written and every product is not run.

## Step 3 — Open the page

Open the file `out` names with the system's default browser. A missing opener is not a failure: the reply's first line gives the path.

```bash
OUT="<the out path from the result>"
case "$(uname -s)" in
  Darwin) command -v open >/dev/null 2>&1 && open "$OUT" ;;
  MINGW*|MSYS*|CYGWIN*) command -v cmd.exe >/dev/null 2>&1 && cmd.exe /c start "" "$OUT" ;;
  *) command -v xdg-open >/dev/null 2>&1 && { xdg-open "$OUT" >/dev/null 2>&1 & } ;;
esac
true
```

Do not start an HTTP server, do not run `/excavator`, `/excavator-unused-code`, `/excavator-doc-map`, `/excavator-hotspots`, `/excavator-tour` or `/excavator-relations` to fill a product that is not run, and do not create, change or delete any other file under `.excavator/` than the page and its translation table (`view-translations/`, with its work directory). With `--out` the table sits beside the page and nothing under `.excavator/` is written.

## Step 4 — Reply

Write what you tell the user during this step in English, as **Language** in Step 1 says. `--language` names the language of the page's names; it does not change the language you write.

Print the reply's five lines with one command. It reads the manifest inside the page, so the states are the page's own:

```bash
node "<the plugin root printed in Step 1>/skills/excavator-view/reply.mjs" "<the out path from the result>"
```

It prints, in this order:

```
Explorer: <absolute path>
Size: <size in MB, one decimal> MB
Issues: <N | not counted; knowledge graph <state>>
Products: knowledge graph <state>; semantics <state>; domain graph <state>; unused code <state>; doc map <state>; hotspots <state>; tour <state>; relations <state>
Source: <embedded (N files) | not embedded>
```

When the user gave a language other than English, the same command prints a sixth line after those five, from the translation counts in the page's manifest (`translated` and `english` add up to the number of names):

```
Translation: <language> <translated>/<names> names (<english> in English)
```

Reply with exactly the lines it prints and nothing else: write nothing before, between or after them, no word on what was packed, opened or left out, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.
