# Query scope routing — frozen acceptance oracle

Frozen before production or executable-fixture edits: 2026-09-16.
Authority: the proposal, delta spec, design, tasks, and repository `AGENTS.md`.
Real-provider fixture: `test-repo/conduit-realworld-example-app` at
`5e127d8569b300e0a21dc2c20ea680da4967b1aa`. The fixture source and generated
`.excavator/` data stay outside this repository.

This oracle fixes observable behavior, not a lexical classifier. The host agent
still judges intent in the same inference. Production code MUST NOT match these
Chinese strings or their English terms to select an intent.

## 1. Shared limits and exact plan shape

Every frozen plan has exactly these fields:

```text
intent, terms, recallLimit, primitive, hopLimit,
maxNodes, maxEdges, maxContextTokens
```

The shared hard ceilings are:

```text
recallLimit = 20
seedNodeIds.length <= 5
maxNodes = 80
maxEdges = 160
maxContextTokens = 12000
bounded-shortest-path hopLimit <= 6
```

`terms` below are a deterministic acceptance input for the three frozen
questions. They are English retrieval expressions or source-owned literals;
they are not a production phrase table. Recall order outside the named gold
members is not frozen.

Post-recall `seedNodeIds` and `targetNodeIds` are exact, ordered, deduplicated
fact-graph identities. Each selected id must occur in the current graph and in
the current top-20 recall pool. A report may include additional evidence paths,
but may not silently substitute path strings or same-named symbols for these
identities.

## 2. Q1 — local publish requirements

Exact question:

```text
发布文章需要填写和校验哪些字段
```

Exact expected plan:

```json
{
  "intent": "local-condition",
  "terms": [
    "article publish",
    "article title",
    "article description",
    "article body",
    "tagList",
    "required field",
    "createArticle",
    "setArticle"
  ],
  "recallLimit": 20,
  "primitive": "source-first",
  "hopLimit": 0,
  "maxNodes": 80,
  "maxEdges": 160,
  "maxContextTokens": 12000
}
```

Exact execution selection:

```json
{ "seedNodeIds": [], "targetNodeIds": [] }
```

The top-20 pool must contain all three gold identities:

```text
function:frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx:ArticleEditorForm()
function:frontend/src/services/setArticle.js:setArticle()
function:backend/controllers/articles.js:createArticle(req,res,next)
```

No graph primitive may be called. The answer must source-check and distinguish:

1. UI `required`: `title`, `description`, and `body`; the tags control has no
   `required` attribute.
2. Submitted payload: `title`, `description`, `body`, and `tagList`; creating an
   article selects POST.
3. Server create checks: authenticated user, non-empty `title`, `description`,
   and `body`, plus title uniqueness before `Article.create`.
4. `tagList`: no explicit server `FieldRequiredError`, but the controller
   iterates it. The answer must not convert either fact into the stronger claim
   “the server requires tags” or “the server safely accepts a missing tagList”.

Minimum current-source evidence is the form submit and controls in
`frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx`, the request
construction in `frontend/src/services/setArticle.js`, and create validation in
`backend/controllers/articles.js`. A semantic summary alone earns no evidence
credit.

## 3. Q2 — editor-to-database flow

Exact question:

```text
文章从编辑器提交到数据库如何流转
```

Exact expected plan:

```json
{
  "intent": "flow",
  "terms": [
    "ArticleEditorForm",
    "setArticle",
    "api/articles",
    "createArticle",
    "Article.create",
    "Article model",
    "database persistence"
  ],
  "recallLimit": 20,
  "primitive": "bounded-bfs",
  "hopLimit": 2,
  "maxNodes": 80,
  "maxEdges": 160,
  "maxContextTokens": 12000
}
```

The top-20 pool must contain every selected identity below. Exact execution
selection:

```json
{
  "seedNodeIds": [
    "function:frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx:ArticleEditorForm()",
    "file:backend/routes/articles.js",
    "file:backend/models/Article.js"
  ],
  "targetNodeIds": []
}
```

Run each seed as a separately bounded fact segment with `hopLimit=2`; do not
turn the three seeds into one claimed path. On the pinned graph the deterministic
boundary oracle is:

| Segment | Seed | Expected boundary | Covered size |
| --- | --- | --- | --- |
| frontend | `function:frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx:ArticleEditorForm()` | `reason=max-hops`, `truncated=true` | 27 nodes, 30 edges |
| backend route/controller | `file:backend/routes/articles.js` | `reason=max-hops`, `truncated=true` | 24 nodes, 39 edges |
| persistence model | `file:backend/models/Article.js` | `reason=exhausted`, `truncated=false` | 1 node, 0 edges |

Each segment reports its actual boundary and uncovered candidates. Aggregate
context stays at or below 12,000 tokens. No segment reaches the 80-node or
160-edge fuse. A changed deterministic count on the same pinned fixture is a
failed graph-boundary score until the fact graph change is reviewed; it must not
be normalized away.

Two source-verified bridges are required and are not graph edges:

1. HTTP bridge: the frontend service sends POST to the literal `api/articles`;
   `backend/index.js` mounts the article router at `/api/articles`; that router
   maps POST `/` through `verifyToken` to `createArticle`.
2. Persistence bridge: `createArticle` calls `Article.create`; the dynamic model
   loader in `backend/models/index.js` and `Article.init` in
   `backend/models/Article.js` establish the Sequelize model used for database
   persistence.

The answer may narrate these verified stages in order. It must label fact
segments and source bridges separately, and must not call their concatenation a
continuous graph path, a directed traversal result, or a fact edge from the
frontend request to the backend route/database.

## 4. Q3 — repository-wide flow inventory

Exact question:

```text
这个项目有哪些主要用户流程，请逐个说明前后端细节
```

Exact expected plan:

```json
{
  "intent": "inventory",
  "terms": ["user flow inventory", "frontend flow", "backend flow"],
  "recallLimit": 20,
  "primitive": "inventory",
  "hopLimit": 0,
  "maxNodes": 80,
  "maxEdges": 160,
  "maxContextTokens": 12000
}
```

Exact execution selection:

```json
{ "seedNodeIds": [], "targetNodeIds": [] }
```

The pinned fixture has no Domain inventory artifact and zero `domain`/`flow`
nodes. Expected result:

```json
{
  "status": "inventory-unavailable",
  "coverage": { "inventoryPresent": false, "stableFlowIds": [] },
  "gaps": ["missing-domain-inventory"],
  "fullRepositoryBfsCalls": 0,
  "complete": false
}
```

The response may give explicitly limited examples only after current-source
checks. It must not use one repository-wide BFS as a substitute, enumerate a
best-effort list under an “all flows” heading, or imply completeness. Building
the missing inventory is outside this change.

## 5. Five independent scores

The executable fixtures added by task 1.2 must return these five score objects
separately; an aggregate pass is the conjunction, never a substitute for the
individual results.

1. `recall`: top-20 count is at most 20 and all question-specific gold/selected
   identities are present. Known-false control: remove Q1's `createArticle`
   identity; only this score fails.
2. `seedSelection`: exact ids are unique, current, drawn from this recall pool,
   intent-relevant, and at most 5; source-first/inventory have none. Known-false
   controls: append a sixth id, duplicate an id, or add an out-of-recall id.
3. `graphBoundary`: primitive calls, per-segment reason/truncation, actual
   budgets, covered ids/counts, uncovered candidates, and gaps are visible.
   Known-false control: report the frontend `max-hops` segment as complete or
   omit its uncovered candidates.
4. `evidenceCoverage`: every business/validation/bridge claim points to current
   fact or source evidence, with frontend and backend enforcement distinct.
   Known-false control: support “server requires tags” only with the UI form.
5. `unsupportedClaims`: no continuous/directed cross-protocol graph path and no
   complete inventory claim when inventory is unavailable. Known-false controls:
   emit one frontend-to-database graph path, or set Q3 `complete=true`.

Each known-false control is applied to an otherwise passing fixture. The scorer
must identify the targeted failure without erasing the other four results. A
missing score, omitted input, or exception is a visible failure, not a skip.

## 6. Red-before-green and non-goals

Before production edits, task 1.2 must prove the current policy cannot enforce
all of the following: the closed intent/primitive matrix, top-5/current-recall
selection, shortest-path endpoints, segmented source bridges, and the inventory
no-flood rule. Import absence alone is not proof; fake executor spies must show
whether graph execution occurred.

This oracle does not add directional traversal, protocol edges, a Domain
inventory generator, persisted query plans, adaptive retrieval memory, a second
freshness rule, or a keyword classifier. Existing undirected deterministic-edge
traversal remains authoritative inside each bounded fact segment.
