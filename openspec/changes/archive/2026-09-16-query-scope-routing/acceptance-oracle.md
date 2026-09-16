# Query scope routing — frozen acceptance oracle

Frozen for the AI-first design on 2026-09-16.

Authority: the proposal, delta spec, design, tasks, and repository `AGENTS.md`.
Real-provider fixture: `test-repo/conduit-realworld-example-app` at
`5e127d8569b300e0a21dc2c20ea680da4967b1aa`. The fixture source and generated
`.excavator/` data stay outside this repository.

This oracle scores observable host behavior. It does not prescribe a production
query-plan object, policy function, validator, executor, result schema, or
keyword classifier. The host AI judges scope, chooses retrieval expressions and
selects relevant graph identities in the same inference. Deterministic code
provides retrieval mechanics and hard resource fuses only.

## 1. Evidence captured from each real session

Keep an acceptance transcript containing:

1. the exact user question and the English retrieval expressions the host chose;
2. the ordered recall candidates actually considered, capped at 20;
3. the retrieval primitive actually used and, for graph traversal, the current
   fact-node seeds and optional target selected by the host;
4. every raw traversal boundary: `reason`, `truncated`, effective budgets,
   covered nodes/edges, and known uncovered candidates or gaps;
5. current fact/source evidence for the final claims and the answer's explicit
   coverage limits.

This transcript is acceptance evidence, not a file format or runtime API. It may
come from the host's tool calls, command output, and final answer. A reviewer
must be able to distinguish what the host inferred from what deterministic
retrieval returned.

Shared acceptance limits:

- recall retains up to 20 candidates;
- graph expansion uses at most 5 current, deduplicated, question-relevant seeds;
- deterministic traversal stops at 5 seeds, 80 nodes, or 160 edges;
- bounded shortest path uses at most 6 hops;
- the host keeps assembled answer context near 12,000 tokens;
- reaching a fuse is a visible degradation, never evidence of completeness.

## 2. Q1 — local publish requirements

Exact question:

```text
发布文章需要填写和校验哪些字段
```

Observable routing pass conditions:

- The host recognizes a bounded fields/validation request and uses local
  source-first inspection. The word “发布” must not cause BFS.
- No one-hop, BFS, or shortest-path traversal is invoked.
- The top-20 recall pool retains the relevant current candidates, including the
  form, request service, and create controller when those nodes are present:
  - `function:frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx:ArticleEditorForm()`
  - `function:frontend/src/services/setArticle.js:setArticle()`
  - `function:backend/controllers/articles.js:createArticle(req,res,next)`
- The answer checks current source and distinguishes:
  1. UI `required`: `title`, `description`, and `body`; tags have no `required`
     attribute.
  2. Submitted payload: `title`, `description`, `body`, and `tagList`; create
     selects POST.
  3. Server create checks: authenticated user, non-empty `title`, `description`,
     and `body`, plus title uniqueness before `Article.create`.
  4. `tagList`: there is no explicit server `FieldRequiredError`, while the
     controller iterates it. Neither fact proves “the server requires tags” or
     “the server safely accepts a missing tagList”.

Minimum evidence is current source in the form component, `setArticle` request
construction, and create controller. A semantic summary alone does not pass.

## 3. Q2 — editor-to-database flow

Exact question:

```text
文章从编辑器提交到数据库如何流转
```

Observable routing pass conditions:

- The host recognizes an end-to-end flow and uses separately bounded fact
  segments plus current-source bridges. It does not claim one graph-native,
  directed editor-to-database path.
- Recall retains up to 20 candidates and includes enough current anchors to
  verify the editor/form, request service, backend route/controller, and Article
  persistence model.
- Before each graph expansion, the host selects at most 5 deduplicated current
  fact-node ids from this recall pool. Unmapped or stale candidates are excluded
  from traversal and recorded as gaps.
- Every fact segment reports the actual deterministic boundary. A segment that
  stops at `max-hops`, `seed-budget`, `node-budget`, or `edge-budget` names what
  was covered and what remains uncovered. The session fails if a partial segment
  is presented as complete.
- No segment should need to hit the 80-node or 160-edge fuse for this fixture. A
  changed result is reviewed from the raw boundary instead of normalized to an
  expected count.

Required source-verified bridges, which are not graph edges:

1. The frontend service sends POST to literal `api/articles`;
   `backend/index.js` mounts the article router at `/api/articles`; the router
   maps POST `/` through `verifyToken` to `createArticle`.
2. `createArticle` calls `Article.create`; the dynamic model loader and
   `Article.init` establish the Sequelize model used for persistence.

The answer may narrate the verified stages in order, but must label fact
segments and source bridges separately.

## 4. Q3 — repository-wide flow inventory

Exact question:

```text
这个项目有哪些主要用户流程，请逐个说明前后端细节
```

Observable routing pass conditions:

- The host recognizes repository-wide enumeration and checks the Domain/flow
  inventory before exploring examples.
- The pinned fixture has no Domain inventory and zero `domain`/`flow` nodes, so
  the answer visibly reports `inventory-unavailable`, absent inventory coverage,
  and a `missing-domain-inventory` gap.
- No repository-wide BFS is invoked as a substitute and the answer does not
  claim a complete list of flows.
- Current-source examples are allowed only when clearly scoped as examples,
  with their own evidence and uncovered scope. Building the missing inventory
  remains outside this change.

## 5. Five independent review gates

Review all five gates independently against the transcript. An aggregate pass
cannot hide a failed gate.

1. **Routing:** Q1 is local/source-first with no graph expansion; Q2 is bounded
   segmented flow; Q3 is inventory/no repository flood. An explicit A→B sample
   uses bounded shortest path, and a direct-caller sample uses one-hop.
2. **Recall and seeds:** recall keeps at most 20 candidates and includes the
   question's evidence anchors. Any traversal uses at most 5 unique current
   fact ids selected for the requested operation; invalid candidates become
   visible gaps rather than seeds.
3. **Graph boundaries:** raw boundary reason, truncation state, effective
   budgets, coverage, and uncovered scope are visible. A sixth supplied seed is
   mechanically cut off with `seed-budget`; node/edge fuses remain 80/160.
4. **Evidence coverage:** every business, validation, and bridge claim points to
   current fact/source evidence. Frontend UI validation and backend enforcement
   are stated separately.
5. **Unsupported claims:** there is no fabricated continuous or directed
   cross-protocol graph path and no complete inventory claim when inventory is
   unavailable.

Known-false probes for the review apparatus:

- remove a required recall anchor;
- show six traversal seeds or a stale/non-current seed;
- hide `truncated=true` or uncovered scope from a bounded segment;
- support a backend requirement only with frontend form evidence;
- describe source bridges as one graph path or mark the missing inventory
  complete.

Each probe must fail its corresponding review gate. These probes belong to the
acceptance review of real transcripts; they must not be implemented as a fake
policy executor or a second semantic rules engine.

## 6. Non-goals and mechanical coverage

Focused deterministic tests remain responsible for BM25 top-20 behavior,
candidate merging, fact-edge filtering, shortest path, and seed/node/edge
boundaries. Real Conduit sessions are responsible for semantic routing,
inventory behavior, bridge narration, and evidence wording.

This change does not add directional traversal, protocol edges, a Domain
inventory generator, persisted query state, adaptive retrieval memory, a second
freshness rule, or a keyword classifier. Existing undirected deterministic-edge
traversal remains authoritative inside each bounded fact segment.
