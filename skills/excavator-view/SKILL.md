---
name: excavator-view
description: Pack the products in a project's .excavator/ folder (knowledge graph, unused-code, doc-map, hotspots and their reports) into one self-contained HTML file and open it with the system's default browser. A deterministic script writes the page and gives each product a visible state; the page needs no network, no server and nothing to install. It runs no analysis, edits no other file and gives no advice.
argument-hint: "[project-path] [--no-source] [--out <path>]"
---

# /excavator-view

Write one HTML file that shows the products already in `.excavator/`, and open it in the browser. Nothing is analysed here: a product that was never produced shows as **not run**, with the command that produces it.

| Who | What |
|---|---|
| `pack.mjs` | Reads the products and the source snapshot's revision, gives every product one state (included, not run, unreadable, different revision), and writes `.excavator/view.html` through a temporary file and a rename. The page is the template `packages/report-view` builds (`pnpm build` writes it to `packages/report-view/dist/view.html`) with the policy and the data inserted. It prints one JSON result. |
| You | Run it, open the file, and print the four reply lines. |

## Options

`$ARGUMENTS` may contain the project path (default: the current working directory), `--no-source`: leave the source text out of the file, and `--out <path>`: write the page there instead of `.excavator/view.html`.

---

## Step 1 — Pack the page

**Language.** Write everything you tell the user during this run in English: each line between commands and the final reply. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

Run the packer in the foreground. It makes no model call and starts no process that keeps running.

```bash
PROJECT_ROOT="$(pwd)"   # or the path argument
SKILL_REAL=$(realpath ~/.agents/skills/excavator-view 2>/dev/null || readlink -f ~/.agents/skills/excavator-view 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
PLUGIN_ROOT=""
for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do
  if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then PLUGIN_ROOT="$candidate"; break; fi
done
echo "plugin root: $PLUGIN_ROOT"
node "$PLUGIN_ROOT/skills/excavator-view/pack.mjs" "$PROJECT_ROOT"            # add --no-source and --out <path> only when the user gave them
```

The result is one JSON line: `out` (the absolute path of the page), `bytes`, `snapshotRevision`, `products` (each with `name` and `status`, and `reason`, `revision` or `note` when it has one) and `source`.

A non-zero exit writes no new page and leaves an existing one as it was; without a built template the packer exits non-zero and its message says to run `pnpm build`. Give the message the script printed as it stands and stop: print no reply lines.

Every command runs in a new shell, so variables from this block are gone in the next: write the plugin root it printed as a literal path in the commands of Steps 2 and 3.

An empty `.excavator/` is not a failure: the page is written and every product is not run.

## Step 2 — Open the page

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

Do not start an HTTP server, do not run `/excavator`, `/excavator-unused-code`, `/excavator-doc-map` or `/excavator-hotspots` to fill a product that is not run, and do not create, change or delete any other file under `.excavator/`.

## Step 3 — Reply

Write what you tell the user during this step in English, as **Language** in Step 1 says.

Print the reply's four lines with one command. It reads the manifest inside the page, so the states are the page's own:

```bash
node "<the plugin root printed in Step 1>/skills/excavator-view/reply.mjs" "<the out path from the result>"
```

It prints, in this order:

```
View: <absolute path>
Size: <size in MB, one decimal> MB
Products: knowledge graph <state>; unused code <state>; doc map <state>; hotspots <state>; reports <state>
Source: <embedded (N files) | not embedded>
```

Reply with exactly the lines it prints and nothing else: write nothing before, between or after them, no word on what was packed, opened or left out, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.
