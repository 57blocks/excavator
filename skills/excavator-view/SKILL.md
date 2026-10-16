---
name: excavator-view
description: Write a static, self-contained HTML view of a project's Excavator analysis and open it in the default browser. One file that works from file://, with no server, no network and no installed tools; share it by copying it.
argument-hint: "[project-path] [--out <path>] [--no-source] [--raw] [--source-budget <MB>] [--no-open]"
---

# /excavator-view

Writes `.excavator/view.html`: one HTML file holding the page and the analysis data, which anyone can open by double-clicking. The data travels in the `excavator-view-bundle/1` format described in `FORMAT.md` next to this file; `bundle-codec.mjs` is its single encoder and decoder, shared with the page template in `packages/view`.

The bake is deterministic: it never calls a model, never builds or runs the analyzed project, and writes nothing but the output file. This skill never starts a server or any long-running process; the file is handed to the operating system's file opener and the skill ends.

Do not edit anything under `.excavator/` other than the output file, and never try to fix a failed bake by rewriting artifacts by hand.

## Arguments

Parse `$ARGUMENTS`:

- The first argument that does not start with `--` is the project path (optional; default: the current directory).
- `--out <path>`: write somewhere other than `$PROJECT_ROOT/.excavator/view.html`.
- `--no-source`: embed no source text (no evidence lines, no symbol excerpts, no comment or string-literal text from the source index).
- `--raw`: store the data uncompressed, for browsers without `DecompressionStream`. The file grows several times over.
- `--source-budget <MB>`: budget for embedded source text (default 64). Over budget, excerpts, then source-index literals, then evidence lines are dropped, each as a whole.
- `--no-open`: do not open the file; only print its path. This flag is handled by this skill and is NOT passed to the bake script.

Pass `--out`, `--no-source`, `--raw` and `--source-budget` through to the bake script unchanged. Reject any other flag with a one-line usage message built from the argument hint above.

## Instructions

1. **Resolve `$PROJECT_ROOT`, `$DATA_DIR` and `$PLUGIN_ROOT`, and make sure the core build exists.** `PROJECT_PATH` below stands for the optional project path argument.
   ```bash
   PROJECT_ROOT="$(cd "${PROJECT_PATH:-.}" && pwd)"
   DATA_DIR="$PROJECT_ROOT/.excavator"
   SKILL_REAL=$(realpath ~/.agents/skills/excavator-view 2>/dev/null || readlink -f ~/.agents/skills/excavator-view 2>/dev/null || echo "")
   SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
   PLUGIN_ROOT=""
   for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do
     if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then
       PLUGIN_ROOT="$candidate"
       break
     fi
   done
   if [ -z "$PLUGIN_ROOT" ]; then
     echo "Error: Cannot find the excavator plugin root. Make sure the plugin is installed correctly."
     exit 1
   fi
   if [ ! -f "$PLUGIN_ROOT/packages/core/dist/index.js" ]; then
     (cd "$PLUGIN_ROOT" && (pnpm install --frozen-lockfile 2>/dev/null || pnpm install) && pnpm --filter @excavator/core build)
   fi
   ```
   The freshness helper and the bake both import `@excavator/core`, so the core build must exist before step 3.

   If `pnpm` is missing, report to the user: "Install Node.js ≥ 22 and pnpm ≥ 10, then re-run `/excavator`." and STOP.

2. **Check that the knowledge graph exists.**
   ```bash
   test -f "$DATA_DIR/knowledge-graph.jsonl" && echo present || echo absent
   ```
   If it is absent, tell the user this project has not been analyzed yet and to run `/excavator` first, then STOP. Write no file.

3. **Check graph freshness** with the ONE shared, deterministic freshness helper; do not compute a separate gitCommitHash or git-diff comparison in this skill:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator/consumer-freshness.mjs" "$PROJECT_ROOT"
   ```
   It prints `{ status, currentSourceRevision, manifestSourceRevision, reason }` as JSON. `status` is `fresh`, `stale`, or `missing`: it compares the CURRENT `sourceRevision`, resolved via SourceSnapshot (a git project reads HEAD only, so an uncommitted working-tree change never flips it; a plain-directory project is guarded by a content hash over every tracked file), against the `sourceRevision` persisted in `.excavator/source-manifest.json`.
   - `stale`: warn the user that the view shows the analysis of an older revision and may omit recent changes. Suggest: Run `/excavator` to refresh the graph. Then continue with the bake; a stale analysis still bakes, and the page shows the stale state too.
   - `missing` (no `source-manifest.json`, or the revision cannot be resolved): give a brief best-effort note with the helper's `reason` and continue.
   - `fresh`: continue with no warning.

4. **Make sure the page template is built.** The bake injects the data into `packages/view/dist/index.html`, which a fresh checkout does not contain:
   ```bash
   if [ ! -f "$PLUGIN_ROOT/packages/view/dist/index.html" ]; then
     (cd "$PLUGIN_ROOT" && (pnpm install --frozen-lockfile 2>/dev/null || pnpm install) && pnpm --filter @excavator/view build)
   fi
   ```
   If `pnpm` is missing, report to the user: "Install Node.js ≥ 22 and pnpm ≥ 10, then re-run `/excavator`." and STOP. If the build fails, relay its error output and STOP.

5. **Run the bake**, adding only the pass-through flags the user gave:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-view/build-view.mjs" "$PROJECT_ROOT" [--out <path>] [--no-source] [--raw] [--source-budget <MB>]
   ```
   On failure the script exits non-zero and prints one line on stderr naming the error:
   - `MissingArtifactError`: a required artifact is absent; tell the user the command that generates it (normally `/excavator`).
   - `KnowledgeGraphFormatError`: the graph is malformed; suggest re-running `/excavator`.
   - `ViewTooLargeError`: suggest `--no-source` or a smaller `--source-budget`.
   - `ViewTemplateError`: the template is missing or broken; rebuild it as in step 4.
   - `ViewSelfCheckError`: the encoded data did not decode to the same counts; relay the details.

   Relay the error and STOP. A failed bake leaves any existing `view.html` byte-identical.

6. **Read the JSON report** the script prints on stdout (one line) and tell the user, briefly:
   - `path` and `bytes` (as MB);
   - `inventory`: which artifacts were embedded (`present`), which are `missing` together with the command that generates each, and which are `invalid` with the reason;
   - `embeds` and `dropped`: which source-text segments were embedded, and each dropped one with its reason (`no-source` or `budget`), or that nothing was dropped;
   - `freshness`: the fact-layer status from the shared helper, plus any semantic product whose per-item freshness is not current;
   - `counts`: nodes, edges and gaps from the graph header, and that the decoded counts match them.

7. **Open the file** unless the user passed `--no-open`. `VIEW_PATH` is the report's `path`; use the host's file opener:

   | Host | Command |
   |---|---|
   | macOS | `open "$VIEW_PATH"` |
   | Linux | `xdg-open "$VIEW_PATH"` |
   | Windows | `start "" "$VIEW_PATH"` (cmd), or `cmd.exe /c start "" "$VIEW_PATH"` from Git Bash |

   If no opener is available (a remote or headless session) or it fails, print the path and tell the user to open it in a browser. With `--no-open`, print only the path.

8. **Remind the user**, in one or two sentences:
   - By default the file embeds source text verbatim: evidence lines, symbol excerpts and the source index's comment and string-literal text. Before sending it outside the team, re-run with `--no-source`.
   - The page carries a Content-Security-Policy that blocks every network request; it reads only its own embedded data.
   - The page can also show another analysis without a new bake: use **Open directory** (or drag a `.excavator/` folder onto the page) to read that folder locally in the browser.

## Notes

- Browser requirements and typical file sizes are described in `docs/view.md` at the plugin root.
- `--template <path>` (bake a different template) is a script option for development; this skill does not use it.
