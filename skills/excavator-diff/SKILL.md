---
name: excavator-diff
description: Use when you need to analyze git diffs or pull requests to understand what changed, affected components, and risks
---

# /excavator-diff

Analyze the current code changes against the knowledge graph in the project's data directory (`.excavator/knowledge-graph.jsonl`).

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

1. **Check that `.excavator/knowledge-graph.jsonl` exists.** If not, tell the user to run `/excavator` first.

2. **Get the changed files list** (do NOT read the graph yet):
   - If on a branch with uncommitted changes: `git diff --name-only`
   - If on a feature branch: `git diff main...HEAD --name-only` (or the base branch)
   - If the user specifies a PR number: get the diff from that PR

3. **Read project metadata and check graph freshness** — use Grep or Read with a line limit to extract the `"project"` section for name/description/languages/frameworks, then check freshness via the ONE shared, deterministic freshness helper instead of computing a separate gitCommitHash/git-diff comparison in this skill:
   - Resolve `$PROJECT_ROOT` and `$PLUGIN_ROOT`:
     ```bash
     PROJECT_ROOT="$(pwd)"
     SKILL_REAL=$(realpath ~/.agents/skills/excavator-diff 2>/dev/null || readlink -f ~/.agents/skills/excavator-diff 2>/dev/null || echo "")
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
   - `stale`: warn before impact analysis that the graph may omit recent changes. Suggest: Run `/excavator` to refresh the graph.
   - `missing` (no `source-manifest.json` yet): give a brief best-effort note and continue instead of blocking.
   - `fresh`: proceed with no warning.

4. **Find nodes for changed files** — for each changed file path, use Grep to search the knowledge graph for:
   - Nodes with matching `"filePath"` values (e.g., `grep "changed/file/path"`)
   - This finds file-level nodes (including non-code types) AND function/class nodes defined in those files
   - Note the `id` values of all matched nodes

5. **Find connected edges (1-hop)** — for each matched node ID, Grep for that ID in the edges to find:
   - What imports or depends on the changed nodes (upstream callers)
   - What the changed nodes import or call (downstream dependencies)
   - These are the "affected components" — things that might break or need updating

6. **Identify affected layers** — Grep for the matched node IDs in the `"layers"` section to determine which architectural layers are touched.

7. **Provide structured analysis**:
   - **Changed Components**: What was directly modified (with summaries from matched nodes)
   - **Affected Components**: What might be impacted (from 1-hop edges)
   - **Affected Layers**: Which architectural layers are touched and cross-layer concerns
   - **Risk Assessment**: Based on node `complexity` values, number of cross-layer edges, and blast radius (number of affected components)
   - Suggest what to review carefully and any potential issues
