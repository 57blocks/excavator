---
name: excavator-chat
description: Use when you need to ask questions about a codebase or understand code using a knowledge graph
argument-hint: "[query]"
---

# /excavator-chat

Answer questions about this codebase using the knowledge graph in the project's data directory (`.excavator/knowledge-graph.json`).

## Graph Structure Reference

The knowledge graph JSON has this structure:
- `project` — {name, description, languages, frameworks, analyzedAt, gitCommitHash}
- `nodes[]` — each has {id, type, name, filePath?, summary, tags[], complexity, languageNotes?}
  - Code node types: file, function, class, module, concept
  - Non-code node types: config, document, service, table, endpoint, pipeline, schema, resource
  - Domain/knowledge node types: domain, flow, step, article, entity, topic, claim, source
  - IDs use the node type as prefix, e.g. `file:path`, `function:path:name`, `config:path`, `article:path`
- `edges[]` — each has {source, target, type, direction, weight}
  - Key types: imports, contains, calls, depends_on, configures, documents, deploys, triggers, contains_flow, flow_step, related, cites
- `layers[]` — each has {id, name, description, nodeIds[]}
- `tour[]` — compatibility field; new service graphs always store an empty array and Q&A does not read it

## How to Read Efficiently

1. Use Grep to search within the JSON for relevant entries BEFORE reading the full file
2. Only read sections you need — don't dump the entire graph into context
3. Node names and summaries are the most useful fields for understanding
4. Edges tell you how components connect — follow imports and calls for dependency chains

## Instructions

1. **Check that `.excavator/knowledge-graph.json` exists** in the current project root. If not, tell the user to run `/excavator` first.

2. **Check graph freshness before using graph-derived context**:
   - Read `project.gitCommitHash` from the graph metadata as `GRAPH_COMMIT_RAW`. Resolve it as a commit before using it in any Git diff, then compare it with `git rev-parse HEAD` and inspect project-scoped committed and working-tree changes from the project root:
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
   - If the committed diff or any working-tree command reports project files, warn before answering that graph-derived context may omit those changes. Suggest: Run `/excavator` to refresh the graph.
   - Run the commit diff only when `GRAPH_COMMIT_RAW` resolves successfully. If the graph commit or Git metadata is missing, invalid, or unavailable, give a brief best-effort warning and continue instead of blocking.

3. **Read project metadata only** — use Grep or Read with a line limit to extract just the `"project"` section from the top of the file for context (name, description, languages, frameworks).

4. **Search for relevant nodes** — use Grep to search the knowledge graph file for the user's query keywords: "$ARGUMENTS"
   - Search `"name"` fields: `grep -i "query_keyword"` in the graph file
   - Search `"summary"` fields for semantic matches
   - Search `"tags"` arrays for topic matches
   - Note the `id` values of all matching nodes

5. **Find connected edges** — for each matched node ID, Grep for that ID in the `edges` section to find:
   - What it imports or depends on (downstream)
   - What calls or imports it (upstream)
   - This gives you the 1-hop subgraph around the query

6. **Read layer context** — Grep for `"layers"` to understand which architectural layers the matched nodes belong to.

7. **Answer the query** using only the relevant subgraph:
   - Reference specific files, functions, and relationships from the graph
   - Explain which layer(s) are relevant and why
   - Be concise but thorough — link concepts to actual code locations
   - If the query doesn't match any nodes, say so and suggest related terms from the graph

## Lazy mode: answer structural questions directly, retrieve on-demand for semantic ones

A Lazy graph carries deterministic facts only: node `summary` is empty and `tags`/`layers` may be empty. Route by question type:

- **Structural questions** (which files/symbols exist, which methods a class has, who imports or calls whom, a node's 1-hop neighbours, contains/depends relationships): answer straight from the fact nodes and fact edges — grep `id` / `name` / `type` and the `edges` (`contains` / `imports` / `calls` / `exports`). **No summary is needed, and do not trigger any semantic supplement, hybrid retrieval, or whole-project analysis.**
- **Semantic questions** (what a module/service is responsible for, business meaning, a cross-file business flow, especially when phrased in a business/domain language such as Chinese over English-named code): follow the **hybrid retrieval** recipe below (openspec: changes/hybrid-retrieval) instead of degrading immediately.
- Fact edges (`calls` / `imports` / `contains` / `exports`) and `gaps` are authoritative: to answer "can we be sure A calls B", go by the fact edge; a call the engine could not resolve is recorded in `gaps`, so say "the engine could not determine that connection" rather than guessing.

### Hybrid retrieval for semantic questions (openspec: changes/hybrid-retrieval)

This on-demand path replaces Slice A's "always degrade honestly" for a semantic question. It stays the FALLBACK: fall back to it whenever a step below cannot complete (no model available for step (a), or the cache write in step (c) fails/is declined) — never fabricate to avoid degrading.

**Resolve `$PLUGIN_ROOT` and `$DATA_DIR` first** (only needed for this path — the structural path above never needs them):

```bash
PROJECT_ROOT="$(pwd)"
DATA_DIR="$PROJECT_ROOT/.excavator"
SKILL_REAL=$(realpath ~/.agents/skills/excavator-chat 2>/dev/null || readlink -f ~/.agents/skills/excavator-chat 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
PLUGIN_ROOT=""
for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do
  if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then
    PLUGIN_ROOT="$candidate"
    break
  fi
done
```

If `$PLUGIN_ROOT` cannot be resolved, or `$DATA_DIR/source-index.json` does not exist (an older Lazy graph built before this slice), fall back to the honest degrade: say plainly that this semantics has not been generated/retrieved yet and suggest `/excavator --mode=full` or re-running `/excavator` to produce a `source-index.json`. **Do not auto-trigger Full** — whether to fill semantics for the whole project is the user's explicit choice.

**(a) Expand the question into code search terms — same inference, no subagent.** Before running any retrieval, produce (as part of this same reasoning turn) a short list of English/code search terms for the user's question: literal identifiers you already suspect, English translations of the business terms, and common code synonyms (e.g. a non-English business question about placing an order might expand to `order`, `createOrder`, `checkout`, `placeOrder`). Do **not** dispatch a separate query-expansion agent/subagent for this — the whole point of same-inference expansion is that it costs no extra model round trip.

**(b) Retrieve — merge candidates, then traverse within budget.**

1. Exact hits: grep the term list (and any literal identifiers) against `nodes[].id` / `.name` / `.type` in `$DATA_DIR/knowledge-graph.json`, exactly as the structural search above already does.
2. BM25 hits over `$DATA_DIR/source-index.json`:
   ```bash
   node --input-type=module -e "
   import { readFileSync } from 'node:fs';
   import { bm25Search } from '$PLUGIN_ROOT/skills/excavator/retrieve.mjs';
   const index = JSON.parse(readFileSync('$DATA_DIR/source-index.json', 'utf-8'));
   const terms = process.argv.slice(1);
   console.log(JSON.stringify(bm25Search(index, terms, 20)));
   " -- <term1> <term2> ...
   ```
3. Source-text hits: Grep the project source tree directly for the same terms (this IS the "SourceSnapshot source-text search" candidate source — no script needed, a project-root Grep is the source of truth for current text).
4. Valid semantic-cache hits: read `$DATA_DIR/semantic-cache.json` (if present) and keep only entries whose `semanticSourceHash` still matches that file's CURRENT `contentHash` in `$DATA_DIR/source-manifest.json` — i.e. only entries `isFresh` would call fresh:
   ```bash
   node --input-type=module -e "
   import { readFileSync, existsSync } from 'node:fs';
   import { isFresh } from '$PLUGIN_ROOT/skills/excavator/semantic-cache.mjs';
   const cachePath = '$DATA_DIR/semantic-cache.json';
   if (!existsSync(cachePath)) { console.log('[]'); process.exit(0); }
   const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
   const manifest = JSON.parse(readFileSync('$DATA_DIR/source-manifest.json', 'utf-8'));
   const hashOf = (path) => manifest.entries.find((e) => e.path === path)?.contentHash ?? null;
   // fill in nodeId -> filePath from the knowledge-graph nodes you already matched
   "
   ```
   Only a hash-fresh entry's `summary`/`tags` text may feed retrieval — a stale or missing entry is simply not a candidate (never partially trusted).
5. Merge all four lists with `mergeCandidates` (weights an exact id/symbol/path match highest, then source-search, semantic-cache, BM25 — see `$PLUGIN_ROOT/skills/excavator/retrieve.mjs`'s own doc comment for the exact rationale):
   ```bash
   node --input-type=module -e "
   import { mergeCandidates } from '$PLUGIN_ROOT/skills/excavator/retrieve.mjs';
   console.log(JSON.stringify(mergeCandidates({ exact, bm25, sourceSearch, semanticCacheText })));
   "
   ```
6. Pick ONE traversal primitive over the fact edges in `knowledge-graph.json` (`contains`/`imports`/`exports`/`calls` only — a semantic/domain edge, if any exist, never supplies a path, only ranking), based on the question's shape:
   - "locate this" / "who calls this directly" -> `oneHop(edges, seedIds)`
   - "what does this flow/process affect" / dependency questions -> `boundedBFS(edges, seedIds)` (default 4 hops)
   - "how does A reach B" (an explicit pair) -> `boundedShortestPath(edges, seedIds, targetIds)` (default 6 hops)

   All three return a `boundary` object (`reason`, `truncated`, budgets). **If `boundary.truncated` is true, say so in the answer** — name what was covered and that the graph was larger than the budget (seed ≤20 / nodes ≤80 / edges ≤160 / ~12k tokens of context), rather than presenting a partial subgraph as the whole picture.

**(c) Generate and cache a NODE-LOCAL summary, on demand.** For each node your answer actually needs to explain, read that node's own source (its `filePath`/`lineRange` from `knowledge-graph.json`, or the chunk's own text from `source-index.json`) and write a summary of ONLY that node's own responsibility. Persist it via `semantic-cache.mjs` **only when all three cacheable conditions hold**: you read the node's full local source range, the summary reliably captures that node's OWN responsibility, and it depends on no unverified cross-file inference. Never persist a cross-file conclusion, a business flow, or answer text — the module enforces this with a field whitelist regardless, but do not even attempt it for content you know is out of scope.

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { commitSemanticCacheEntry } from '$PLUGIN_ROOT/skills/excavator/semantic-cache.mjs';
const manifest = JSON.parse(readFileSync('$DATA_DIR/source-manifest.json', 'utf-8'));
const filePath = '<the node\'s filePath>';
const semanticSourceHash = manifest.entries.find((e) => e.path === filePath)?.contentHash;
const result = await commitSemanticCacheEntry({
  projectRoot: '$PROJECT_ROOT',
  nodeId: '<the node id you just summarized>',
  filePath,
  fields: {
    summary: '<one paragraph about ONLY this node\'s own responsibility>',
    tags: ['<short local tags>'],
    semanticSourceHash,
    model: '<this model id>',
    generatedAt: new Date().toISOString(),
  },
});
console.log(JSON.stringify(result));
"
```

`result.ok === false` (a rejected field, a stale CAS hash, a held lock, or an I/O error) is expected occasionally and MUST NOT block the answer — the summary you already generated is still valid for THIS answer, it simply was not persisted for reuse.

**(d) Seeds are re-verified before they enter the answer.** A semantic-cache or domain hit from step (b)/(c) only ever SEEDS which nodes/files to look at — it is never itself the evidence for a claim in the final answer. Before a conclusion derived from such a hit goes into the answer, re-check it against the fact graph's edges/nodes or the current source text (via SourceSnapshot/Grep on the project root). If it does not hold up, drop or qualify the claim; do not present an unverified cached seed as a checked fact.

**(e) Structural questions never trigger this path.** If the question is purely structural (per the routing at the top of this section), answer directly from facts as before — do not run query expansion, retrieval, or semantic-cache generation for it.

**Honest-degrade fallback.** If step (a) has no model available, if retrieval in step (b) finds nothing usable, or if you cannot produce a reliable node-local summary in step (c), say plainly that this semantics has not been generated yet (rather than fabricating a summary/responsibility/business conclusion), and suggest `/excavator --mode=full` for the whole project. You may still state, from fact edges and source evidence, that "structurally it connects to X" — but never present a structural connection as a business responsibility.
