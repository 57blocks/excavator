---
name: excavator-domain
description: Extract business domain knowledge from a codebase as a queryable domain graph. Works standalone or derives from an existing /excavator knowledge graph.
argument-hint: "[--full]"
---

# /excavator-domain

Extracts business domain knowledge — domains, business flows, and process steps — from a codebase and saves a queryable domain graph.

## How It Works

- A script lists the candidate material: the source files, their entry points (HTTP routes, CLI commands, event handlers, cron jobs, exported handlers) and a signature of every file.
- A second script groups the files into modules (one per directory) and packs the modules into bounded **areas**. When a knowledge graph exists (`.excavator/knowledge-graph.jsonl`) and `--full` was not passed, each area also carries the graph nodes of its own files, so steps can cite real node ids.
- One domain-analyzer runs per area, on that area only. No analyzer has to fit the whole project.
- A third script merges the area results into one domain graph and writes a coverage report: per area, per module and per entry-point file, which ones came back with no flow. A skipped module is listed, not hidden.
- Use `--full` to leave the knowledge graph out of the areas even if one exists.

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

1. Check if `$DATA_DIR/knowledge-graph.jsonl` exists
2. If it exists AND `--full` was NOT passed, check freshness before deriving from it via the ONE shared, deterministic freshness helper (`$PLUGIN_ROOT` was already resolved in Phase 0), instead of computing a separate gitCommitHash/git-diff comparison in this skill:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator/consumer-freshness.mjs" "$PROJECT_ROOT"
   ```
   - It prints `{ status, currentSourceRevision, manifestSourceRevision, reason }` as JSON. `status` is `fresh`, `stale`, or `missing`: it compares the CURRENT `sourceRevision` — resolved via SourceSnapshot, so a git project reads HEAD only (an uncommitted working-tree change never flips this — no working-tree leak) and a plain-directory project is guarded by a content hash over every tracked file (any content drift is caught) — against the `sourceRevision` persisted in `.excavator/source-manifest.json`.
   - `stale`: warn that domain extraction may omit recent changes. Suggest: Run `/excavator` to refresh the knowledge graph.
   - `missing` (no `source-manifest.json` yet): give a brief best-effort note and continue instead of blocking.
   - `fresh`: proceed with no warning.
3. After that preflight, proceed to Phase 2; Phase 3 then attaches the graph's nodes to the areas (derive from the existing graph).
4. Otherwise, proceed to Phase 2 without the graph. When `--full` is used, skip this preflight because the command performs a fresh scan instead of consuming the existing graph.

### Phase 2: Extract Candidate Material

Run the preprocessing script on every path, with or without a knowledge graph:

```bash
python3 "$PLUGIN_ROOT/skills/excavator-domain/extract-domain-context.py" "$PROJECT_ROOT"
```

It writes `$DATA_DIR/intermediate/domain-context.json`: the file tree, the detected entry points with a snippet each, a signature (exports, imports, a short preview) for every source file, and project metadata. No model reads this file whole. If its `truncated` counts are not all 0, tell the user how many files or entry points the extractor's limits left out.

### Phase 3: Split into Areas

With a knowledge graph and without `--full`:

```bash
node "$PLUGIN_ROOT/skills/excavator-domain/split-domain-areas.mjs" "$PROJECT_ROOT" \
  --graph "$DATA_DIR/knowledge-graph.jsonl"
```

Otherwise:

```bash
node "$PLUGIN_ROOT/skills/excavator-domain/split-domain-areas.mjs" "$PROJECT_ROOT"
```

The script groups the non-test source files into modules (one per directory) and packs them, in path order, into areas that stay within a byte budget and an entry-point budget; a module over either budget is split by file into numbered parts. It first deletes any earlier `intermediate/domain-areas/` and `intermediate/domain-analysis.json`, then writes `intermediate/domain-areas/manifest.json` and one context file per area carrying this run's token. It prints one line per area:

```
area-001 modules=10 files=12 entryPoints=38 graphNodes=0 bytes=19969 context=<context file> output=<output file>
```

Keep these lines; Phase 4 dispatches from them. Tell the user how many areas there are: that is how many analyzers will run.

### Phase 4: Domain Analysis

1. Read the domain-analyzer agent prompt from `$PLUGIN_ROOT/agents/excavator-domain-analyzer.md`.
2. Dispatch **one subagent per area** with that prompt. Give each one only: the project root, the path of its area's context file, and the path of its output file (both from its Phase 3 line), and tell it to use **Option C**. Do not paste the context into the prompt, and do not give it any other area's files. Explicitly require every model-owned domain field to be written in English while preserving source-owned identifiers, paths, literals, and excerpts verbatim. The areas are independent; they may run concurrently.
3. When every subagent has returned, merge:

   ```bash
   node "$PLUGIN_ROOT/skills/excavator-domain/merge-domain-areas.mjs" "$PROJECT_ROOT"
   ```

   It writes the merged graph to `$DATA_DIR/intermediate/domain-analysis.json` and the coverage report to `$DATA_DIR/reports/domain-coverage.json`, and prints one line per area, the module buckets, and one `silent-zero` line per module that has entry points but no flow and was not declared skipped.

   If it exits 3, some areas were `missing` or rejected (`rejected-stale`: the output does not carry this run's token, for example an earlier file copied into place; `rejected-parse`: not JSON). Dispatch a fresh subagent for each of those areas once, exactly as in step 2, then run the merge again. If it still exits 3, continue with what was accepted and tell the user which areas are missing. Never write or copy an area's output yourself.

4. Domain names can differ between areas for the same business area. Read the merged domains:

   ```bash
   jq -c '[.nodes[] | select(.type=="domain") | {id, name, summary}]' "$DATA_DIR/intermediate/domain-analysis.json"
   ```

   Only if two ids clearly name the same business area, write `$DATA_DIR/intermediate/domain-areas/aliases.json` as `{"domain:<duplicate>": "domain:<kept>"}` and run the merge again with `--aliases "$DATA_DIR/intermediate/domain-areas/aliases.json"`. The script applies only entries whose two ends are existing domains and reports the rest under `aliasesRejected`. Do not re-dispatch any analyzer for this.

5. Report to the user, from the merge output: the number of areas accepted, domains, flows and steps; the module buckets `covered`, `declared-skip`, `silent-zero` and `no-candidates`; every `silent-zero` module; and how many entry-point files no step cites. These are the gaps of this run. Do not describe the coverage as complete while `silent-zero` is above 0.

### Phase 4.5: Anchor Steps

This phase is **additive**: it changes nothing about how the domain analysis is
produced. A business step's whole value is the claim "this is where that
happens in the code", so each `step` node is tied to real knowledge-graph node
ids before the graph is saved.

```bash
node "$PLUGIN_ROOT/skills/excavator-domain/annotate-domain.mjs" "$PROJECT_ROOT"
```

Reads `$DATA_DIR/intermediate/domain-analysis.json` and
`$DATA_DIR/knowledge-graph.jsonl`, and updates the analysis in place (on every
path, `--full` included, whenever the knowledge graph exists):

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
standalone path (no knowledge graph) it warns and leaves every step
unanchored rather than inventing ids.

Then run the source-touching validator on the result. A step's `nodeIds` name
nodes of the knowledge graph, which the domain graph does not contain, so give
the validator the knowledge graph as a reference whenever it exists. The
reference only resolves step anchors; nothing else of it is validated or
merged. A step with no resolvable `nodeIds` and no `provenance: "inferred"` is
counted as `step-unanchored`:

```bash
if [ -f "$DATA_DIR/knowledge-graph.jsonl" ]; then
  node "$PLUGIN_ROOT/skills/excavator/validate-graph.mjs" "$PROJECT_ROOT" \
    --graph "$DATA_DIR/intermediate/domain-analysis.json" \
    --out "$DATA_DIR/intermediate/domain-validated.json" \
    --report "$DATA_DIR/intermediate/domain-validation.json" \
    --reference "$DATA_DIR/knowledge-graph.jsonl"
else
  node "$PLUGIN_ROOT/skills/excavator/validate-graph.mjs" "$PROJECT_ROOT" \
    --graph "$DATA_DIR/intermediate/domain-analysis.json" \
    --out "$DATA_DIR/intermediate/domain-validated.json" \
    --report "$DATA_DIR/intermediate/domain-validation.json"
fi
```

When `knowledge-graph.jsonl` does not exist, the flag is left out and every
step without `provenance: "inferred"` is reported unanchored. When it exists,
the flag is passed whichever path produced the analysis, `--full` included.

Report `stepsTotal`, `stepsAnchored`, `stepsInferred` and `stepUnanchored` from
that report to the user; the last three add up to the first. A domain graph has
no code nodes and its edges cite no lines, so `nodesChecked` and `edgesChecked`
are 0 and the anchor and edge checks do not apply to it. Do not report
`anchorMismatch` or `edgeContradicted` as findings, and never present their
zero counts as a pass.

If `annotate-domain.mjs` exits 2 with `status=noncanonical-language`, read
`$DATA_DIR/intermediate/domain-annotation.json`, report its rejected field
paths, and **STOP**. Do not save or publish `domain-graph.json`; regenerate the
model-owned fields in English first. For any other non-zero exit, report
stderr as a Phase 4.5 warning and continue to Phase 5 with the analysis
unchanged. The source-touching validator remains supplementary and non-fatal.

### Phase 5: Validate and Save

1. Read the domain analysis output
2. Validate using the standard graph validation pipeline (the schema now supports domain/flow/step types)
3. If validation fails, log warnings but save what's valid (error tolerance)
4. Save to `$DATA_DIR/domain-graph.json` only when the annotated input carries
   `languageAudit.status: "accepted"` and its terminal buckets account for
   every inspected model-owned field.

   **Publish the step anchors before step 5.** Phase 4.5
   anchored the steps in `$DATA_DIR/intermediate/domain-analysis.json`, and
   step 5 below deletes that file — so this has to happen here, not after the
   phase:

   ```bash
   node "$PLUGIN_ROOT/skills/excavator/publish-annotations.mjs" "$PROJECT_ROOT" \
     --domain-annotated "$DATA_DIR/intermediate/domain-analysis.json" \
     --reports-dir "$DATA_DIR/reports"
   ```

   `--reports-dir` keeps the preserved reports (among them
   `domain-annotation.json`) in `$DATA_DIR/reports/`, next to
   `domain-coverage.json`.

   It merges **only** the supplement fields — a step's `nodeIds`,
   `unresolvedNodeIds`, `evidence`, `provenance`, plus the root `gaps` — into
   the file step 4 just saved, matching nodes by id. It adds no node and no
   edge, and it cannot touch a `summary`, a `name` or a `weight`. It is
   idempotent, so a second run changes nothing.

   **Supplement, so not fatal.** Report a non-zero exit as a warning and
   continue to step 5.

5. Clean up `$DATA_DIR/intermediate/domain-analysis.json`, `$DATA_DIR/intermediate/domain-context.json` and the directory `$DATA_DIR/intermediate/domain-areas`

### Phase 5.1: Publish Annotations

The runnable block is **inside Phase 5, between steps 4 and 5**. This heading
only makes that operation visible in the phase sequence. Do not run it again
here: step 5 has already deleted `domain-analysis.json`.

### Phase 6: Service Ready

Report the saved `$DATA_DIR/domain-graph.json` path and that it is ready for terminal queries. Do not start a browser or HTTP server.

**Freshness contract for any later consumer.** `domain-graph.json` carries top-level `contentLanguage: "en"`, `sourceRevision`, and `factDigest`. ANY later consumer that reads `domain-graph.json` to answer a question (this skill's own terminal queries, or any other skill) MUST check it against the CURRENT semantic schema/language identity and fact layer before treating its content as current:

```bash
node "$PLUGIN_ROOT/skills/excavator-domain/domain-freshness.mjs" "$PROJECT_ROOT"
```

This prints `{ usable, status, reason }` as JSON. `usable: false` (`noncanonical-language`, a `sourceRevision` or `factDigest` mismatch, or no domain graph at all) means the domain graph MUST NOT be used in the answer — say so and suggest re-running `/excavator-domain`. `usable: true` means it may be used, but only as a HINT: domain/flow/step content is re-verified against the fact graph and source evidence before it enters a final answer (it is never itself the evidence for a claim).
