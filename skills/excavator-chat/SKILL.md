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

0. **Capture request-local state before retrieval.** Keep these values in working memory only:
   - `$ORIGINAL_QUESTION` — copy `$ARGUMENTS` exactly, including its original language and any explicit answer-language request. Never replace it with a translation or normalized query.
   - `$ENGLISH_RETRIEVAL_EXPRESSIONS` — in this same inference, derive a short list of English business/code search expressions and common code synonyms. This list is for retrieval only, not for answering.
   - `$LITERAL_IDENTIFIERS` — copy any exact code identifiers or source-owned literals separately; non-English identifiers belong here, not in the English expression list.
   - Three language signals: an explicit requested answer language, the current question's predominant natural language, and the most recent confidently identifiable conversation language. Use `null` for an identifier-only question or an unavailable signal.

   After `$PLUGIN_ROOT` is resolved in step 2, pass those values to `createChatRequestState()` from `<PLUGIN_ROOT>/skills/excavator-chat/request-language.mjs`. Keep the returned state in memory. It deliberately has no `answerLanguage` yet. If an English retrieval expression is rejected, regenerate that expression in English while keeping `$ORIGINAL_QUESTION` and `$LITERAL_IDENTIFIERS` unchanged. **Do not persist request or answer language** to config, cache, graph, metadata, or any other `.excavator/` file.

1. **Check that `.excavator/knowledge-graph.json` exists** in the current project root. If not, tell the user to run `/excavator` first.

2. **Check graph freshness before using graph-derived context** — use the ONE shared, deterministic freshness helper instead of computing a separate gitCommitHash/git-diff comparison in this skill:
   - Resolve `$PROJECT_ROOT` and `$PLUGIN_ROOT`:
     ```bash
     PROJECT_ROOT="$(pwd)"
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
   - Run the helper:
     ```bash
     node "$PLUGIN_ROOT/skills/excavator/consumer-freshness.mjs" "$PROJECT_ROOT"
     ```
   - It prints `{ status, currentSourceRevision, manifestSourceRevision, reason }` as JSON. `status` is `fresh`, `stale`, or `missing`: it compares the CURRENT `sourceRevision` — resolved via SourceSnapshot, so a git project reads HEAD only (an uncommitted working-tree change never flips this — no working-tree leak) and a plain-directory project is guarded by a content hash over every tracked file (any content drift is caught) — against the `sourceRevision` persisted in `.excavator/source-manifest.json`.
   - `stale`: warn before answering that graph-derived context may omit recent changes. Suggest: Run `/excavator` to refresh the graph.
   - `missing` (no `source-manifest.json` yet): give a brief best-effort note and continue instead of blocking.
   - `fresh`: proceed with no warning.

3. **Read project metadata only** — use Grep or Read with a line limit to extract just the `"project"` section from the top of the file for context (name, description, languages, frameworks).

4. **Search for relevant nodes** — use Grep to search the knowledge graph with `$ENGLISH_RETRIEVAL_EXPRESSIONS` plus `$LITERAL_IDENTIFIERS`. Keep `$ORIGINAL_QUESTION` intact for intent and final presentation; do not substitute it with the English expressions.
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

### Evidence verification gate and answer language

This gate applies to every route above and below, including direct structural answers and honest-degrade responses.

1. **Evidence verification gate:** before producing answer prose, check every code or business claim against current fact nodes/edges or current source text. A semantic cache entry, summary, layer description, domain result, or English retrieval expression can select where to inspect, but is not evidence by itself. Preserve exact code identifiers and quoted source spans in their source language.
2. Only after that check, call `finalizeVerifiedAnswerLanguage($CHAT_REQUEST_STATE, { evidenceVerified: true })` from `request-language.mjs`. The helper applies this precedence: explicit answer-language request → current question's predominant natural language → recent identifiable conversation language → English. An identifier-only question therefore falls back to recent conversation language, then English.
3. Write the final answer in the returned `answerLanguage`. Restate the verified conclusions naturally in that language; do not translate a cached English summary and present the translation as evidence.
4. Do not persist the selected answer language or rewritten answer. Answer-language changes must leave `.excavator/config.json`, `knowledge-graph.json`, and every semantic product unchanged except for independently justified English node-local cache writes from step (c).

## Lazy mode: answer structural questions directly, retrieve on-demand for semantic ones

A Lazy graph carries deterministic facts only: node `summary` is empty and `tags`/`layers` may be empty. Route by question type:

- **Structural questions** (which files/symbols exist, which methods a class has, who imports or calls whom, a node's 1-hop neighbours, contains/depends relationships): answer straight from the fact nodes and fact edges — grep `id` / `name` / `type` and the `edges` (`contains` / `imports` / `calls` / `exports`). **No summary is needed, and do not trigger any semantic supplement, hybrid retrieval, or whole-project analysis.**
- **Semantic questions** (what a module/service is responsible for, business meaning, a cross-file business flow, especially when phrased in a business/domain language such as Chinese over English-named code): follow the **hybrid retrieval** recipe below instead of degrading immediately.
- Fact edges (`calls` / `imports` / `contains` / `exports`) and `gaps` are authoritative: to answer "can we be sure A calls B", go by the fact edge; a call the engine could not resolve is recorded in `gaps`, so say "the engine could not determine that connection" rather than guessing.

### Hybrid retrieval for semantic questions

This on-demand path is the FALLBACK for semantic questions: use it whenever a step below cannot complete (no model available for step (a), or the cache write in step (c) fails/is declined) — never fabricate to avoid degrading.

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

If `$PLUGIN_ROOT` cannot be resolved, or `$DATA_DIR/source-index.json` does not exist, fall back to the honest degrade: say plainly that this semantics has not been generated/retrieved yet and suggest `/excavator --mode=full` or re-running `/excavator` to produce a `source-index.json`. **Do not auto-trigger Full** — whether to fill semantics for the whole project is the user's explicit choice.

**(a) Use the request-local search expressions — same inference, no subagent.** Use `$ENGLISH_RETRIEVAL_EXPRESSIONS` and `$LITERAL_IDENTIFIERS` captured before retrieval. For example, a non-English business question about placing an order might produce English/code expressions such as `order`, `createOrder`, `checkout`, `placeOrder`, while `$ORIGINAL_QUESTION` remains byte-for-byte unchanged. Do **not** dispatch a separate query-expansion agent/subagent for this — the whole point of same-inference expansion is that it costs no extra model round trip.

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
4. Valid semantic-cache hits: read `$DATA_DIR/semantic-cache.json` (if present) and keep only entries whose cache has the current schema plus `contentLanguage: "en"` and whose `semanticSourceHash` still matches that file's CURRENT `contentHash` in `$DATA_DIR/source-manifest.json` — i.e. only entries `isFresh(entry, hash, cache)` would call fresh. A missing or non-English cache marker is visibly `noncanonical-language`, never a retrieval candidate:
   ```bash
   node --input-type=module -e "
   import { readFileSync, existsSync } from 'node:fs';
   import { isFresh } from '$PLUGIN_ROOT/skills/excavator/semantic-cache.mjs';
   const cachePath = '$DATA_DIR/semantic-cache.json';
   if (!existsSync(cachePath)) { console.log('[]'); process.exit(0); }
   const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
   const manifest = JSON.parse(readFileSync('$DATA_DIR/source-manifest.json', 'utf-8'));
   const hashOf = (path) => manifest.entries.find((e) => e.path === path)?.contentHash ?? null;
   // Pass the complete cache as the third argument so schema/language identity
   // is checked together with the entry's source hash.
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

**(c) Freeze the bounded need set, plan reuse, then generate only the difference.** After candidate merge and bounded fact-edge traversal, select the exact node ids that this answer actually needs explained. Keep them within the traversal boundary and deduplicate them by exact id in first-occurrence order. This `$NEEDED_NODE_IDS` list is fixed before any semantic generation.

Invoke the read-only planner with every needed id as a separate `--node-id` argument. Never concatenate ids into a command string, evaluate them as shell/code, or treat their contents as options. For example, repeated arguments are safe when each exact id is a separately quoted argument:

```bash
node "$PLUGIN_ROOT/skills/excavator/semantic-cache-reuse.mjs" "$PROJECT_ROOT" \
  --node-id 'function:src/article.ts:favorite()' \
  --node-id 'function:src/article.ts:unfavorite()' \
  --node-id 'function:src/article.ts:favorite()'
```

The planner reads the current fact graph, source manifest, and semantic cache for this invocation, then returns `reuse[]`, `generate[]`, `unavailable[]`, and conserving `counts`:

- `reuse[]` is seed/context only. Recheck current facts or source before using any related claim. Never send a reused node to the generator or semantic-cache writer, and never restamp or rewrite its entry.
- `generate[]` is the only semantic generation loop. For each item, first read and verify that node's full local source range (its `filePath`/`lineRange` from `knowledge-graph.json`, or the chunk's own full text from `source-index.json`). Then write the model-owned `summary` and `tags` in **English**, regardless of the user's question language. Preserve source-owned identifiers and literals verbatim and describe ONLY that node's own responsibility.
- `unavailable[]` is a visible degraded result. Report each unavailable node id and its `unknown-node` or `path-not-in-manifest` reason; never generate or write semantics for it.

An all-fresh plan means zero generator calls, zero semantic-cache writer calls, and a byte-identical `semantic-cache.json`, including every existing entry's model, `generatedAt`, and audit. For an overlapping question, preserve every `reuse[]` intersection entry byte-for-byte and generate/commit only the `generate[]` difference. A repeated plan after that commit should reuse the newly fresh entries without another write.

Only a verified `generate[]` item may reach `commitSemanticCacheEntry`. Persist it **only when all three cacheable conditions hold**: you read the node's full local source range, the summary reliably captures that node's OWN responsibility, and it depends on no unverified cross-file inference. Never persist a cross-file conclusion, a business flow, or answer text — the module enforces this with a field whitelist regardless, but do not even attempt it for content you know is out of scope.

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { commitSemanticCacheEntry } from '$PLUGIN_ROOT/skills/excavator/semantic-cache.mjs';
const manifest = JSON.parse(readFileSync('$DATA_DIR/source-manifest.json', 'utf-8'));
// Repeat this block only for one verified item from plan.generate.
const nodeId = '<exact generate[].nodeId>';
const filePath = '<exact generate[].filePath>';
const semanticSourceHash = manifest.entries.find((e) => e.path === filePath)?.contentHash;
const result = await commitSemanticCacheEntry({
  projectRoot: '$PROJECT_ROOT',
  nodeId,
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

`result.ok === false` (noncanonical language, a rejected field, a stale CAS hash, a held lock, or an I/O error) is expected occasionally and MUST NOT block the answer — the verified summary generated for THIS answer remains available for this answer, but the cache entry was not committed. Recheck or qualify affected claims if current evidence moved after planning.

**(d) Seeds are re-verified before they enter the answer.** A semantic-cache or domain hit from step (b)/(c) only ever SEEDS which nodes/files to look at — it is never itself the evidence for a claim in the final answer. Before a conclusion derived from such a hit goes into the answer, re-check it against the fact graph's edges/nodes or the current source text (via SourceSnapshot/Grep on the project root). If it does not hold up, drop or qualify the claim; do not present an unverified cached seed as a checked fact. Once this and the global **Evidence verification gate** are complete, finalize the answer language; never choose it early merely because retrieval used English expressions.

**(e) Structural questions never trigger this path.** If the question is purely structural (per the routing at the top of this section), answer directly from facts as before — do not run query expansion, retrieval, or semantic-cache generation for it.

**Honest-degrade fallback.** If step (a) has no model available, if retrieval in step (b) finds nothing usable, or if you cannot produce a reliable node-local summary in step (c), say plainly that this semantics has not been generated yet (rather than fabricating a summary/responsibility/business conclusion), and suggest `/excavator --mode=full` for the whole project. You may still state, from fact edges and source evidence, that "structurally it connects to X" — but never present a structural connection as a business responsibility.
