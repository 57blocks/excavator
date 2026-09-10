---
name: excavator-domain
description: Extract business domain knowledge from a codebase and generate an interactive domain flow graph. Works standalone (lightweight scan) or derives from an existing /excavator knowledge graph.
argument-hint: "[--full]"
---

# /excavator-domain

Extracts business domain knowledge — domains, business flows, and process steps — from a codebase and produces an interactive horizontal flow graph in the dashboard.

## How It Works

- If a knowledge graph already exists (`.excavator/knowledge-graph.json`), derives domain knowledge from it (cheap, no file scanning)
- If no knowledge graph exists, performs a lightweight scan: file tree + entry point detection + sampled files
- Use `--full` flag to force a fresh scan even if a knowledge graph exists

## Instructions

### Phase 0: Resolve `PROJECT_ROOT`

Set `PROJECT_ROOT` to the current working directory.

**Worktree redirect.** If `PROJECT_ROOT` is inside a git worktree (not the main checkout), redirect output to the main repository root. Worktrees managed by Claude Code are ephemeral — the data directory (`.excavator/`) written there is destroyed when the session ends, taking the domain graph with it (issue #133). Detect a worktree by comparing `git rev-parse --git-dir` against `git rev-parse --git-common-dir`; in a normal checkout or submodule they resolve to the same path, in a worktree they differ and the parent of `--git-common-dir` is the main repo root.

```bash
COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)
GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null)
if [ -n "$COMMON_DIR" ] && [ -n "$GIT_DIR" ]; then
  COMMON_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR" 2>/dev/null && pwd -P)
  GIT_ABS=$(cd "$PROJECT_ROOT" && cd "$GIT_DIR" 2>/dev/null && pwd -P)
  if [ -n "$COMMON_ABS" ] && [ "$COMMON_ABS" != "$GIT_ABS" ]; then
    MAIN_ROOT=$(dirname "$COMMON_ABS")
    if [ -d "$MAIN_ROOT" ] && [ "${EXCAVATOR_NO_WORKTREE_REDIRECT:-0}" != "1" ]; then
      echo "[excavator-domain] Detected git worktree at $PROJECT_ROOT"
      echo "[excavator-domain] Redirecting output to main repo root: $MAIN_ROOT"
      echo "[excavator-domain] (Set EXCAVATOR_NO_WORKTREE_REDIRECT=1 to keep PROJECT_ROOT as the worktree.)"
      PROJECT_ROOT="$MAIN_ROOT"
    fi
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
2. If it exists AND `--full` was NOT passed, check freshness before deriving from it:
   - Read `project.gitCommitHash` from the graph metadata as `GRAPH_COMMIT_RAW`. Change to `$PROJECT_ROOT`, resolve it as a commit before using it in any Git diff, compare the resolved commit with `git rev-parse HEAD`, and inspect project-scoped committed and working-tree changes:
     ```bash
     GRAPH_COMMIT=$(git rev-parse --verify --end-of-options "${GRAPH_COMMIT_RAW}^{commit}" 2>/dev/null)
     git rev-parse HEAD
     git diff --name-only "$GRAPH_COMMIT" HEAD -- .
     git diff --cached --name-only -- .
     git diff --name-only -- .
     git ls-files --others --exclude-standard -- .
     ```
   - The `-- .` pathspec is required: commits that only touch a sibling monorepo project must not make this graph stale. A hash mismatch alone is not stale when the project diff is empty.
   - Ignore the `.excavator/` data directory in every command's output because it contains generated graph artifacts, not project source drift.
   - If the committed diff or any working-tree command reports project files, warn that domain extraction may omit those changes. Suggest: Run `/excavator` to refresh the knowledge graph.
   - Run the commit diff only when `GRAPH_COMMIT_RAW` resolves successfully. If the graph commit or Git metadata is missing, invalid, or unavailable, give a brief best-effort warning and continue instead of blocking.
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
   - Tour steps if available
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
5. Clean up `$DATA_DIR/intermediate/domain-analysis.json` and `$DATA_DIR/intermediate/domain-context.json`

### Phase 5.1: Publish Annotations (added)

Phase 4.5 anchored the steps in `$DATA_DIR/intermediate/domain-analysis.json`,
and Phase 5 step 5 deletes that file. Carry the anchors into the saved graph
first:

```bash
node "$PLUGIN_ROOT/skills/excavator/publish-annotations.mjs" "$PROJECT_ROOT" \
  --domain-annotated "$DATA_DIR/intermediate/domain-analysis.json"
```

It merges **only** the supplement fields — a step's `nodeIds`,
`unresolvedNodeIds`, `evidence`, `provenance`, plus the root `gaps` — into
`$DATA_DIR/domain-graph.json`, matching nodes by id. It adds no node and no
edge, and it cannot touch a `summary`, a `name` or a `weight`.

If Phase 5 step 5 already ran, `domain-analysis.json` is gone: the script
prints a note and exits 0, and the saved domain graph simply carries no
anchors. Run it between Phase 5 step 4 and step 5.

**Supplement, so not fatal.** Report a non-zero exit as a Phase 5.1 warning
and continue.

### Phase 6: Launch Dashboard

1. Auto-trigger `/excavator-dashboard` to visualize the domain graph
2. The dashboard will detect `domain-graph.json` and show the domain view by default
