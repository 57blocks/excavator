---
name: excavator-domain
description: Extract business domain knowledge from a codebase as a queryable domain graph. Works standalone or derives from an existing /excavator knowledge graph.
argument-hint: "[--full]"
---

# /excavator-domain

Extracts business domain knowledge — domains, business flows, and process steps — from a codebase and saves a queryable domain graph.

## How It Works

- If a knowledge graph already exists (`.excavator/knowledge-graph.json`), derives domain knowledge from it (cheap, no file scanning)
- If no knowledge graph exists, performs a lightweight scan: file tree + entry point detection + sampled files
- Use `--full` flag to force a fresh scan even if a knowledge graph exists

## Instructions

### Phase 0: Resolve `PROJECT_ROOT`

Set `PROJECT_ROOT` to the current working directory.

**Worktree isolation.** If `PROJECT_ROOT` is inside a git worktree (not the main checkout), Excavator writes `.excavator/` **inside that worktree** and never sends output anywhere else. The domain graph corresponds only to that worktree's SourceSnapshot revision, which is what keeps two worktrees on different branches/HEADs from silently overwriting each other's graph. The trade-off: deleting the worktree deletes its `.excavator/` cache along with it — this reopens issue #133's data-loss risk by design (a deliberate choice for snapshot correctness, see plan §10), and is expected behavior rather than an error. Detect a worktree by comparing `git rev-parse --git-dir` against `git rev-parse --git-common-dir`; in a normal checkout or submodule they resolve to the same path, in a worktree they differ.

```bash
COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)
GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null)
if [ -n "$COMMON_DIR" ] && [ -n "$GIT_DIR" ]; then
  COMMON_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR" 2>/dev/null && pwd -P)
  GIT_ABS=$(cd "$PROJECT_ROOT" && cd "$GIT_DIR" 2>/dev/null && pwd -P)
  if [ -n "$COMMON_ABS" ] && [ "$COMMON_ABS" != "$GIT_ABS" ]; then
    echo "[excavator-domain] Detected git worktree at $PROJECT_ROOT"
    echo "[excavator-domain] The domain graph is written here, inside this worktree, and corresponds only to this worktree's revision."
    echo "[excavator-domain] Deleting this worktree deletes its .excavator/ cache with it."
  fi
fi
```

Use `$PROJECT_ROOT` (not the bare CWD) for every reference to "the current project" / `<project-root>` in subsequent phases.

**Resolve the data directory `$DATA_DIR`.** All Excavator artifacts live in the project's data directory, `.excavator/`. Resolve it once, now that `$PROJECT_ROOT` is known, and reuse `$DATA_DIR` for every read and write in later phases:
```bash
DATA_DIR="$PROJECT_ROOT/.excavator"
```
Because each phase may run in a fresh shell, carry `$DATA_DIR` forward like `$PROJECT_ROOT`, re-resolving it with the line above if a later command block needs it.

**Important:** do **not** assume the plugin root is simply two directories above the skill path string. In many installations `~/.agents/skills/excavator-domain` is a symlink into the real plugin checkout. Try, in order: the Claude Code runtime root, the universal install symlink, then the self-relative path resolved from the skill symlink.

Resolve the plugin root like this:

```bash
SKILL_REAL=$(realpath ~/.agents/skills/excavator-domain 2>/dev/null || readlink -f ~/.agents/skills/excavator-domain 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")

PLUGIN_ROOT=""
for candidate in \
  "${CLAUDE_PLUGIN_ROOT}" \
  "$HOME/.excavator-plugin" \
  "$SELF_RELATIVE"; do
  if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then
    PLUGIN_ROOT="$candidate"
    break
  fi
done

if [ -z "$PLUGIN_ROOT" ]; then
  echo "Error: Cannot find the excavator plugin root."
  echo "Checked:"
  echo "  - ${CLAUDE_PLUGIN_ROOT:-<unset CLAUDE_PLUGIN_ROOT>}"
  echo "  - $HOME/.excavator-plugin"
  echo "  - ${SELF_RELATIVE:-<unresolved path derived from ~/.agents/skills/excavator-domain>}"
  echo "Make sure the plugin is installed correctly."
  exit 1
fi
```

Use `$PLUGIN_ROOT` for every reference to agent definitions in subsequent phases.

### Phase 1: Detect Existing Graph

1. Check if `$DATA_DIR/knowledge-graph.json` exists
2. If it exists AND `--full` was NOT passed, check freshness before deriving from it (openspec: changes/full-semantic-isolation, capability `consumer-freshness`) — via the ONE shared, deterministic freshness helper (`$PLUGIN_ROOT` was already resolved in Phase 0), instead of this skill computing its own gitCommitHash/git-diff comparison:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator/consumer-freshness.mjs" "$PROJECT_ROOT"
   ```
   - It prints `{ status, currentSourceRevision, manifestSourceRevision, reason }` as JSON. `status` is `fresh`, `stale`, or `missing`: it compares the CURRENT `sourceRevision` — resolved via SourceSnapshot, so a git project reads HEAD only (an uncommitted working-tree change never flips this — no working-tree leak) and a plain-directory project is guarded by a content hash over every tracked file (any content drift is caught) — against the `sourceRevision` persisted in `.excavator/source-manifest.json`.
   - `stale`: warn that domain extraction may omit recent changes. Suggest: Run `/excavator` to refresh the knowledge graph.
   - `missing` (no `source-manifest.json` yet — an older project, or one built before this capability): give a brief best-effort note and continue instead of blocking.
   - `fresh`: proceed with no warning.
3. After that preflight, proceed to Phase 3 (derive from graph).
4. Otherwise, proceed to Phase 2 (lightweight scan). When `--full` is used, skip this preflight because the command performs a fresh scan instead of consuming the existing graph.

### Phase 2: Lightweight Scan (Path 1)

The preprocessing script does NOT produce a domain graph — it produces **raw material** (file tree, entry points, exports/imports) so the domain-analyzer agent can focus on the actual domain analysis instead of spending dozens of tool calls exploring the codebase. Think of it as a cheat sheet: cheap Python preprocessing → expensive LLM gets a clean, small input → better results for less cost.

1. Run the preprocessing script bundled with this skill, passing `$PROJECT_ROOT` from Phase 0:
   ```
   python ./extract-domain-context.py "$PROJECT_ROOT"
   ```
   This outputs `$DATA_DIR/intermediate/domain-context.json` containing:
   - File tree (respecting `.gitignore`)
   - Detected entry points (HTTP routes, CLI commands, event handlers, cron jobs, exported handlers)
   - File signatures (exports, imports per file)
   - Code snippets for each entry point (signature + first few lines)
   - Project metadata (package.json, README, etc.)
2. Read the generated `domain-context.json` as context for Phase 4
3. Proceed to Phase 4

### Phase 3: Derive from Existing Graph (Path 2)

1. Read `$DATA_DIR/knowledge-graph.json`
2. Format the graph data as structured context:
   - All nodes with their types, names, summaries, and tags
   - All edges with their types (especially `calls`, `imports`, `contains`)
   - All layers with their descriptions
3. This is the context for the domain analyzer — no file reading needed
4. Proceed to Phase 4

### Phase 4: Domain Analysis

1. Read the domain-analyzer agent prompt from `$PLUGIN_ROOT/agents/excavator-domain-analyzer.md`
2. Dispatch a subagent with the domain-analyzer prompt + the context from Phase 2 or 3
3. The agent writes its output to `$DATA_DIR/intermediate/domain-analysis.json`

### Phase 4.5: Anchor Steps (added)

This phase is **additive**: it changes nothing about how the domain analysis is
produced. A business step's whole value is the claim "this is where that
happens in the code", so each `step` node is tied to real knowledge-graph node
ids before the graph is saved.

```bash
node "<SKILL_DIR>/annotate-domain.mjs" "$PROJECT_ROOT"
```

Reads `$DATA_DIR/intermediate/domain-analysis.json` and
`$DATA_DIR/knowledge-graph.json`, and updates the analysis in place:

- `nodeIds` the domain-analyzer supplied are **checked** against the knowledge
  graph. Ones that resolve stay, in the model's order; ones that do not move to
  `unresolvedNodeIds` and are counted under gap `step-nodeid-unresolved`, so a
  reconstructed id is visible instead of sitting in `nodeIds` looking like an
  anchor.
- `nodeIds` it did not supply are **derived**: knowledge-graph nodes on the
  same `filePath` whose `lineRange` intersects the step's, or that file's own
  node when the step gives no usable range (counted separately under
  `step-file-anchored`, because "somewhere in this file" is a weaker claim).
- `evidence` is written only where a matched node carries a real line; an
  anchored step with nothing citable is counted under
  `step-evidence-unavailable`.

Writes the counts to `$DATA_DIR/intermediate/domain-annotation.json`. On the
standalone path (Phase 2, no knowledge graph) it warns and leaves every step
unanchored rather than inventing ids.

Then run the source-touching validator on the result, which is where a step
with no resolvable `nodeIds` and no `provenance: "inferred"` is counted as
`step-unanchored`:

```bash
node "$PLUGIN_ROOT/skills/excavator/validate-graph.mjs" "$PROJECT_ROOT" \
  --graph "$DATA_DIR/intermediate/domain-analysis.json" \
  --out "$DATA_DIR/intermediate/domain-validated.json" \
  --report "$DATA_DIR/intermediate/domain-validation.json"
```

Report the `stepUnanchored`, `anchorMismatch` and `edgeContradicted` counts
from that report to the user.

**Supplement, so not fatal.** If either script exits non-zero, report its
stderr as a Phase 4.5 warning and continue to Phase 5 with the analysis
unchanged.

### Phase 5: Validate and Save

1. Read the domain analysis output
2. Validate using the standard graph validation pipeline (the schema now supports domain/flow/step types)
3. If validation fails, log warnings but save what's valid (error tolerance)
4. Save to `$DATA_DIR/domain-graph.json`

   **Publish the step anchors (added; do this before step 5).** Phase 4.5
   anchored the steps in `$DATA_DIR/intermediate/domain-analysis.json`, and
   step 5 below deletes that file — so this has to happen here, not after the
   phase:

   ```bash
   node "$PLUGIN_ROOT/skills/excavator/publish-annotations.mjs" "$PROJECT_ROOT" \
     --domain-annotated "$DATA_DIR/intermediate/domain-analysis.json"
   ```

   It merges **only** the supplement fields — a step's `nodeIds`,
   `unresolvedNodeIds`, `evidence`, `provenance`, plus the root `gaps` — into
   the file step 4 just saved, matching nodes by id. It adds no node and no
   edge, and it cannot touch a `summary`, a `name` or a `weight`. It is
   idempotent, so a second run changes nothing.

   **Supplement, so not fatal.** Report a non-zero exit as a warning and
   continue to step 5.

5. Clean up `$DATA_DIR/intermediate/domain-analysis.json` and `$DATA_DIR/intermediate/domain-context.json`

### Phase 5.1: Publish Annotations (added)

This step runs **inside Phase 5, between steps 4 and 5** — the block under step
4 above. It is named here only so the phase sequence accounts for it; there is
nothing left to run at this point, because step 5 has already deleted
`domain-analysis.json` by the time you reach it. That is why the original
wording of this section was wrong: a model following the phases in order would
have found the documented no-op instead of the anchors.

### Phase 6: Service Ready

Report the saved `$DATA_DIR/domain-graph.json` path and that it is ready for terminal queries. Do not start a browser or HTTP server.

**Freshness contract for any later consumer (added; openspec: changes/full-semantic-isolation, capability `domain-freshness`).** `domain-graph.json` now carries top-level `sourceRevision` and `factDigest` (stamped by Phase 4.5's `annotate-domain.mjs`, carried through by Phase 5's `publish-annotations.mjs` — see their own doc comments). ANY later consumer that reads `domain-graph.json` to answer a question (this skill's own terminal queries, or any other skill) MUST check it against the CURRENT fact layer before treating its content as current:

```bash
node "$PLUGIN_ROOT/skills/excavator-domain/domain-freshness.mjs" "$PROJECT_ROOT"
```

This prints `{ usable, status, reason }` as JSON. `usable: false` (a `sourceRevision` or `factDigest` mismatch, or no domain graph at all) means the domain graph MUST NOT be used in the answer — say so and suggest re-running `/excavator-domain`. `usable: true` means it may be used, but only as a HINT: domain/flow/step content is re-verified against the fact graph and source evidence before it enters a final answer (it is never itself the evidence for a claim).
