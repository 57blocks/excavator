---
name: excavator-onboard
description: Use when you need to generate an onboarding guide for new team members joining a project
argument-hint: "[--language <lang>]"
---

# /excavator-onboard

Generate a comprehensive onboarding guide from the project's knowledge graph.

## Options

`--language <lang>` — the language of the guide and everything said to the user during the run; English when it is not given.

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
     SKILL_REAL=$(realpath ~/.agents/skills/excavator-onboard 2>/dev/null || readlink -f ~/.agents/skills/excavator-onboard 2>/dev/null || echo "")
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
   - `stale`: warn before generating the guide that onboarding content may omit recent changes, and open the guide with the same note. Suggest: Run `/excavator` to refresh the graph.
   - `missing` (no `source-manifest.json` yet): give a brief best-effort note and continue instead of blocking.
   - `fresh`: proceed with no warning.

3. **Read project metadata** — use Grep or Read with a line limit to extract the `"project"` section (name, description, languages, frameworks).

4. **Read layers** — Grep for `"record":"layer"` to get every layer line, one per layer: {id, name, description, nodeIds[]}. These define the architecture and will structure the guide. If no line matches, the graph has no layers.

5. **Read file-level structural nodes only** — use Grep to find nodes with file-level types (`file`, `config`, `document`, `service`, `pipeline`, `table`, `schema`, `resource`, `endpoint`) in the knowledge graph. Skip function-level and class-level nodes to keep the guide high-level. Extract each node's `name`, `filePath`, `summary`, and `complexity`.

6. **Identify complexity hotspots** — from the file-level nodes, find those with the highest `complexity` values. These are areas new developers should approach carefully.

7. **Write the onboarding guide** in `$LANGUAGE`, as clean markdown, to `.excavator/onboarding-guide.md` in the project, with these sections:
   - **Project Overview**: name, languages, frameworks, description (from project metadata)
   - **Architecture Layers**: each layer's name, description, and key files (from the layer lines + file nodes); when the graph has no layers, say so here instead of grouping the files yourself
   - **Key Concepts**: important patterns and design decisions (from node summaries and tags)
   - **File Map**: what each key file does (from file-level nodes, organized by layer)
   - **Complexity Hotspots**: areas to approach carefully (from complexity values)

8. **Save and reply.** The guide stays in `.excavator/onboarding-guide.md`, Excavator's data directory: copy it to `docs/EXCAVATOR_ONBOARDING.md`, or a path the user gives, only when the user says so.

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

Then print the reply's lines with this command, putting in the guide's path:

```bash
# the reply: where the guide is and the offer to save it
printf '%s\n' \
  "<the guide's path>" \
  "To save it in the project, say so: it goes to docs/EXCAVATOR_ONBOARDING.md unless you give another path. Commit it to share it with the team."
```

Reply with exactly the lines it prints and nothing else. Its first line, the guide's path, is the reply's first line and the offer to save its last: write nothing before, between or after them, no word on the guide or what was done, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply. In a language other than English, write the command's words translated; the path stays as it is.
