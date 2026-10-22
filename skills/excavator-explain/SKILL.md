---
name: excavator-explain
description: Use when you need a deep-dive explanation of a specific file, function, or module in the codebase
argument-hint: "[file-path] [--language <lang>]"
---

# /excavator-explain

Provide a thorough, in-depth explanation of a specific code component.

## Options

`$ARGUMENTS` holds the component to explain and may hold `--language <lang>`: the language of the explanation and everything said to the user during the run; English when it is not given.

## Graph Structure Reference

The knowledge graph `knowledge-graph.jsonl` stores one JSON record per line:
- Line 1 — `{"record":"header", "fields":{…}, "counts":{…}}`: `fields.project` is {name, description, languages, frameworks, analyzedAt, gitCommitHash}; `counts` gives the number of nodes, edges, layers and gaps
- `{"record":"node","node":{…}}` — one line per node: {id, type, name, filePath?, summary, tags[], complexity, languageNotes?}
  - Code node types: file, function, class, module, concept
  - Non-code node types: config, document, service, table, endpoint, pipeline, schema, resource
  - Domain/knowledge node types: domain, flow, step, article, entity, topic, claim, source
  - IDs use the node type as prefix, e.g. `file:path`, `function:path:name`, `config:path`, `article:path`
- `{"record":"edge","edge":{…}}` — one line per edge: {source, target, type, direction, weight}
  - Key types: imports, contains, calls, depends_on, configures, documents, deploys, triggers, contains_flow, flow_step, related, cites
- `{"record":"layer","layer":{…}}` — one line per layer: {id, name, description, nodeIds[]}
- `{"record":"tour","step":{…}}` — compatibility records; new service graphs have none
- `{"record":"coverage",…}` and `{"record":"gap",…}` — the coverage ledger and the named gaps

## How to Read Efficiently

1. Grep the file for relevant entries BEFORE reading anything else — every node and edge is one line, so a hit is a whole record (e.g. `grep '"record":"node"' "$DATA_DIR/knowledge-graph.jsonl" | grep 'src/index.ts'`)
2. Only read the lines you need — never read the whole file into context; it can be hundreds of megabytes
3. Node names and summaries are the most useful fields for understanding
4. Edges tell you how components connect — follow imports and calls for dependency chains

## Instructions

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

1. **Check that `.excavator/knowledge-graph.jsonl` exists.** If not, tell the user to run `/excavator` first.

2. **Check graph freshness before using graph-derived context** — use the ONE shared, deterministic freshness helper instead of computing a separate gitCommitHash/git-diff comparison in this skill:
   - Resolve `$PROJECT_ROOT` and `$PLUGIN_ROOT`:
     ```bash
     PROJECT_ROOT="$(pwd)"
     LANGUAGE="English"   # or the --language value
     SKILL_REAL=$(realpath ~/.agents/skills/excavator-explain 2>/dev/null || readlink -f ~/.agents/skills/excavator-explain 2>/dev/null || echo "")
     SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
     PLUGIN_ROOT=""
     for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do
       if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then
         PLUGIN_ROOT="$candidate"
         break
       fi
     done
     ```
   - Run the helper:
     ```bash
     node "$PLUGIN_ROOT/skills/excavator/consumer-freshness.mjs" "$PROJECT_ROOT"
     ```
   - It prints `{ status, currentSourceRevision, manifestSourceRevision, reason }` as JSON. `status` is `fresh`, `stale`, or `missing`: it compares the CURRENT `sourceRevision` — resolved via SourceSnapshot, so a git project reads HEAD only (an uncommitted working-tree change never flips this — no working-tree leak) and a plain-directory project is guarded by a content hash over every tracked file (any content drift is caught) — against the `sourceRevision` persisted in `.excavator/source-manifest.json`.
   - `stale`: the explanation says, as the first line under its first heading, that graph-derived context may omit recent changes. Suggest: Run `/excavator` to refresh the graph.
   - `missing` (no `source-manifest.json` yet): the explanation gives a brief best-effort note in the same place; continue instead of blocking.
   - `fresh`: proceed with no warning.

3. **Find the target node** — use Grep to search the knowledge graph for the component named in `$ARGUMENTS` (without `--language` and its value)
   - For file paths (e.g., `src/auth/login.ts`): search for `"filePath"` matches
   - For function notation (e.g., `src/auth/login.ts:verifyToken`): search for the function name in `"name"` fields filtered by the file path
   - Note the exact node `id`, `type`, `summary`, `tags`, and `complexity`

4. **Find all connected edges** — Grep for the target node's ID in the edges section:
   - `"source"` matches → things this node calls/imports/depends on (outgoing)
   - `"target"` matches → things that call/import/depend on this node (incoming)
   - Note the connected node IDs and edge types

5. **Read connected nodes** — for each connected node ID from step 4, Grep for those IDs in the nodes section to get their `name`, `summary`, and `type`. This builds the component's neighborhood.

6. **Identify the layer** — Grep for the target node's ID in the `"layers"` section to find which architectural layer it belongs to and that layer's description.

7. **Read the actual source file** — Read the source file at the node's `filePath` for the deep-dive analysis.

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

8. **Write the explanation** in `$LANGUAGE`, as markdown, to a file of this run's own: the path this command prints, run from the project root.

   ```bash
   # this run's file for the explanation
   echo "$(pwd)/.excavator/explanation-$(date -u +%Y%m%dT%H%M%SZ)-$$.md"
   ```

   Write it under these five `##` headings, in this order:
   - **Role**: its role in the architecture (which layer, why it exists)
   - **Internal Structure**: functions and classes it contains (from `contains` edges)
   - **External Connections**: what it imports, what calls it, what it depends on (from edges)
   - **Data Flow**: inputs → processing → outputs (from source code)
   - **Worth Knowing**: patterns, idioms or complexity worth understanding

   Explain clearly, assuming the reader may not know the programming language. The file starts with the first heading and ends with the last section's text. It is at most 25,000 bytes: step 9 prints it whole as the reply, and hosts cut longer command output (Claude Code past 30,000 characters by default). In a language other than English, write the headings translated; code identifiers and paths stay as they are.

9. **Reply.** Print the explanation with this command, run from the project root, putting in the path step 8 printed:

   ```bash
   # the reply: the explanation
   f="<the path step 8 printed>"
   if [ ! -f "$f" ]; then echo "$f does not exist" >&2; false
   elif [ "$(wc -c < "$f")" -gt 25000 ]; then echo "$f is longer than 25000 bytes" >&2; false
   else cat "$f" && mv -f "$f" "$(dirname "$f")/explanation.md"; fi
   ```

   It prints the file, then keeps it as `.excavator/explanation.md` in place of any earlier one. When the file does not exist or is longer than 25,000 bytes, it prints nothing and fails: write the explanation to that path, or shorten it, and run the command again. Never print another file in its place.

   Reply with exactly the lines it prints and nothing else: write nothing before or after them, no word on what was done, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.
