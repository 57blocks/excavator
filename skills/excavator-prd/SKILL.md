---
name: excavator-prd
description: Generate an As-Is PRD (product requirements document) from a codebase's knowledge graph. Explores every flow, supplements behavior the call-graph cannot see (notifications, scheduled jobs, permissions, external services), and writes an audience-scoped PRD that covers all flows — not a curated subset.
argument-hint: "[path] [--role <audience>] [--language <lang>] [--scope <domain-or-subdir>]"
---

# /excavator-prd

Produce an **As-Is PRD** — a product document describing what the code **actually does today**, reverse-engineered from the knowledge graph plus targeted source reads. Default audience is a **product manager**.

Two rules govern everything below:

1. **As-Is only.** Describe behavior that exists in the code. Every claim must be traceable to real source; never invent fields, states, rules, or numbers. Where the code does not settle something, say so out loud (e.g. "not evident in the code" / "to be confirmed").
2. **All flows, not a curated subset.** The deliverable must reflect *every* flow in scope. The skill enforces this with an explicit flow inventory (Phase 1) and a coverage self-check (Phase 4). Omitting a flow silently is a defect, not an editorial choice.

## Why this skill is not "just read the graph"

The knowledge graph is a **call/structure graph** (`imports`, `contains`, `calls`, `exports`). A lot of product-visible behavior is **not** a call edge and will be **absent from the graph**:

- outbound **notifications / messaging** (Slack, email, webhooks, push);
- **scheduled / background** work (cron, tickers, queues, workers, reminders);
- **permission / authorization** rules (route guards, role checks, menu visibility);
- calls to **external services** across an HTTP/gRPC/message boundary (e.g. a frontend calling a backend — no source import connects them).

Phase 1 therefore has two halves: read the graph for call-flows, **and** hunt the source for off-graph behavior. Skipping the second half is how a PRD ends up "mentioning Slack but not who/what", or missing the cron reminders and the permission model entirely.

## Options

`$ARGUMENTS` may contain:
- A directory path — the project to document (default: current working directory).
- `--role <audience>` — who the PRD is written for (default: `product manager`). Shapes vocabulary and structure, not the facts.
- `--language <lang>` — output language of the PRD (default: match the codebase's primary human language / the user's request). This skill's own prose stays English; only the generated PRD follows `--language`.
- `--scope <domain-or-subdir>` — limit the PRD to one domain or subdirectory (e.g. a single feature area, or one member of a multi-repo). Within the scope, coverage must still be exhaustive.

## Graph tools

The graph is an **accelerator, not a dependency**: it speeds up flow discovery (Phase 1a), but the source tree is the ground truth and the skill runs fully without a graph (source-only mode, see Phase 0). Prefer the excavator MCP graph tools when connected; otherwise fall back to `Grep`/`Read` over `.excavator/knowledge-graph.json` and the source tree.

- `project_status` — snapshot, freshness, gaps.
- `recall` — find nodes by terms / ids / paths.
- `traverse` — follow fact edges (`one-hop` / `bfs` / `shortest-path`) from seed node ids.
- `read_evidence` — read a bounded current source range by path or node id.

Read efficiently: grep for the entries you need, follow edges for chains, don't dump the whole graph into context.

---

## Phase 0 — Setup

1. Resolve `PROJECT_ROOT` from the path argument (default: `pwd`). Parse `--role` (default `product manager`), `--language`, `--scope`.
2. Detect whether a graph exists: `project_status`, or check `.excavator/knowledge-graph.json`. Pick the mode — do **not** stop when it is missing:
   - **Graph present → graph-assisted mode** (default): use the graph to accelerate flow discovery in Phase 1a, then run the freshness check below.
   - **Graph missing → source-only mode**: skip the freshness check (step 3), tell the user no graph was found so flows will be discovered by reading source directly (offer `/excavator` as a faster future option, but continue now), and treat the source tree as the sole ground truth. Everything else applies unchanged — Phase 1b is already source-based, and Phase 1a has a source-only path.
3. **Graph-assisted mode only** — check freshness (reuse the shared helper, same pattern as `excavator-onboard`):
   ```bash
   PROJECT_ROOT="$(pwd)"   # or the path argument
   SKILL_REAL=$(realpath ~/.agents/skills/excavator-prd 2>/dev/null || readlink -f ~/.agents/skills/excavator-prd 2>/dev/null || echo "")
   SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
   PLUGIN_ROOT=""
   for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do
     if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then PLUGIN_ROOT="$candidate"; break; fi
   done
   node "$PLUGIN_ROOT/skills/excavator/consumer-freshness.mjs" "$PROJECT_ROOT"
   ```
   `stale` → warn that the PRD may miss recent changes (suggest re-running `/excavator`). `missing` → best-effort note, continue. `fresh` → proceed.

---

## Phase 1 — Build the complete flow inventory

The inventory is the anti-cherry-pick device. Build it **before** writing anything. Do not prune it for length.

### 1a. Call-flows (graph-assisted, or source-only)

- Find **entrypoints**: route/endpoint/handler registrations, UI pages/routers, CLI/`main` entries, and job entrypoints.
  - **Graph-assisted:** use `recall` with the framework's route/controller/handler vocabulary to locate entrypoint nodes (`endpoint`, `service` types; files under `routes`/`controllers`/`handlers`), then `traverse` (`bfs` over `calls`/`contains`) to map each chain.
  - **Source-only (no graph):** `Grep` the source for the same entrypoints (route/controller/handler registration, page router config, `main`/CLI, job registration), then read the files and follow their imports/calls by hand to map each chain.
- Record each as a flow: **name · trigger · entrypoint · participating modules**.

### 1b. Off-graph behavior from the source (do not skip)

For each category below, `Grep` the source (then `read_evidence` to confirm) and add what you find to the inventory with evidence (`file:line`). These patterns are starting points — **adapt to the languages and frameworks actually present**; the goal is the behavior, not the keyword.

| Category | Search starting points |
|---|---|
| Notifications / messaging | `slack`, `webhook`, `notify`, `email`, `mail`, `sns`, `push`, `im`, `bot` |
| Scheduled / background / async | `cron`, `schedule`, `@Scheduled`, `ticker`, `setInterval`, `queue`, `worker`, `consumer`, `job`, `timer`, `reminder` |
| Permission / authorization | `middleware`, `guard`, `role`, `permission`, `authorize`, `rbac`, `policy`, `scope`, `menu` visibility/route role config |
| External services / integrations | HTTP/gRPC clients to other services, message brokers, third-party SDKs, `baseURL`/`endpoint` config |
| Config / feature flags | env vars and config toggles that change a flow's behavior |

For every off-graph item capture, in product terms: **when it fires, who/what it targets, what its content or effect is.** A notification without recipient+content, a job without schedule+effect, or a permission without who-can-do-what is an incomplete inventory entry.

### 1c. Stitch each flow end-to-end (frontend ↔ backend)

Most user-facing flows cross a network boundary the graph cannot span: the frontend calls a backend over HTTP/gRPC, so no call edge links them. Reconstruct the whole path yourself — for each frontend entrypoint, find the request it sends (URL / method / path) and match it to the backend route that serves it; then continue into that route's backend chain and any side effects (notifications, jobs) from 1b. Record the flow as a **single end-to-end entry spanning both tiers**, not two separate entries.

### 1d. Emit the inventory

Print the full numbered inventory (end-to-end call-flows + off-graph items). If `--scope` was given, restrict to that scope but stay exhaustive within it. This list is the contract Phase 4 is checked against.

---

## Phase 2 — Plan the outline for the audience

Draft the PRD outline **for `--role`** (product manager by default): organize by product themes a PM reads — capabilities, user roles & permissions, each feature's flows, automated/background behavior, notifications, calculations & rules, edge cases — **not** by call stacks or API lists.

Map **every** inventory item (1a + 1b) to an outline section. If something has no home, the outline is incomplete — extend it. Present the outline first.

---

## Phase 3 — Write the PRD

Write in `--language`, in product language for `--role`. Start with a short **Doc Info** block (version, date, project/domain, source baseline/revision, audience) — localized to `--language`. Then cover **every** inventoried flow — no exceptions.

**No code in the body.** The PRD describes behavior, not implementation. Do not paste code, function/route signatures, SQL, or config literals into the prose. Name an identifier only when it is genuinely user-facing (a status label, an on-screen field); otherwise describe it in business terms. Anything code-level (snippets, `file:line`) belongs only in the fold-away `<details>` blocks described below.

**Translate codes — never print raw values.** Numeric enum/status codes, boolean flags, and database field values are meaningless to the reader. Always render them as their human meaning: a numeric status code becomes its status label, a boolean flag becomes the condition it represents, a type code becomes the type it names — never a raw `status=2` / `field=true` / `type=1` in the prose. Resolve every code by reading the enum/constant definition in source (do not guess the mapping). When the code↔meaning mapping itself is worth recording, put it in a **field-dictionary table** (columns: value | meaning), never inline in prose. A bare code, flag, or `field=value` left in the running text is a defect — the reader should never have to look up a number.

**Preserve source-owned names; translate only the generic prose.** When `--language` differs from the source's language, keep product/feature names, module names, and UI-visible labels — menu items, page/tab titles, button text, field labels, status names — in their original source form, exactly as they appear in the code/UI, and translate only the generic connective and descriptive words around them. The reader must be able to map every PRD term back to what they see in the product, so never translate a name into a target-language equivalent — reproduce it exactly as the code/UI spells it. Use that source name in **every** mention of the entity — running prose, section headings, tables, and mermaid diagram labels alike — and never coin a translated synonym for it, even when referring to it as a common noun (write the source name plus a generic word, not a translated stand-in). When unsure whether a term is source-owned, check how it appears in the source/UI and keep that exact form. This is the same "preserve source-owned identifiers and literals verbatim" rule the other excavator skills follow, applied to the reader-facing names in the PRD.

To make this concrete and self-consistent instead of a per-sentence judgment call, **anchor names with a Terminology list**: before writing the body, extract the scoped feature's canonical source terms (the entity/feature name and its key UI labels, exactly as the code/UI spells them) and list them in a short **Terminology** section near the top of the PRD (columns: source term | meaning). Then reuse each listed term **verbatim** everywhere — prose, headings, tables, diagram labels — never a translation of it, even where it reads as an ordinary noun. Declaring the terms yourself and reusing them is far more reliable than deciding word-by-word; the declared list is exactly what the Phase 4 terminology check audits against.

**Describe each flow end-to-end, across tiers.** A flow is one story from the user's action to the final effect — not a frontend chapter and a separate backend chapter. For each flow, as one continuous description, cover:
- **Frontend** — the page/entry, form fields and their **validation rules**, UI states, and what the user sees at each step.
- **Backend** — the validation and processing the request goes through, what data is created/changed, transaction boundaries, and downstream effects (notifications, jobs).
- **The seam** — which user action invokes which backend capability (the request the frontend sends ↔ the route the backend serves), so the reader follows the whole path even though the two tiers live in different code/repos.

For each flow also give: purpose (what problem it solves, for whom), roles involved, trigger, the step sequence, business rules, and edge cases as *user-visible outcomes* (not error codes).

Depth requirements (these are where thin PRDs fail):
- **Every displayed/computed number** — give the calculation method, its inputs, and what is included/excluded. Not "it totals hours" but the actual rule.
- **Every configurable item** — state what configuring it *does*, who it affects, and where it takes effect — not only how to configure it.
- **Every notification/message** — trigger, recipient, and content/composition.
- **Permissions** — a dedicated section with a role × capability matrix.
- **Automated behavior** — scheduled/background work described with the same weight as user actions.

Readability is a requirement, not a nicety:
- **Tables** for fields, rules, permission matrices, edge cases, and the flow index.
- **Lists** for step sequences.
- **Mermaid is required, not optional.** Give every major flow group a `flowchart`, and every cross-tier end-to-end flow a `sequenceDiagram` (frontend → backend → notification/job). Keep each diagram to one clear idea. A PRD with no diagrams fails the Phase 4 check — do not skip them to save effort.
- **Evidence stays foldable.** Keep the body clean and code-free; put `file:line` traceability (and any snippet a reader might want to confirm) inside a collapsible block, typically one per flow:
  ```markdown
  <details><summary>Evidence</summary>

  - Frontend form rules — `path/to/Form.tsx:95-140`
  - Backend handler — `path/to/handler.go:200-260`
  - Slack notification — `path/to/notify.js:40-72`

  </details>
  ```

---

## Phase 4 — Coverage self-check, then save

1. **Coverage check (enforces "all flows").** Produce a short table mapping every Phase 1 inventory item → the PRD section that covers it. Every item must map. If any is unaddressed, either add it or state explicitly why it is out of scope — **no silent drops.** Report the count: `N/N flows covered`.
2. **Diagram check.** Confirm the readability requirement was met: at least one mermaid `flowchart` per major flow group and a `sequenceDiagram` for each cross-tier end-to-end flow. If diagrams are missing, add them before finishing — a code-free PRD still needs flowcharts/sequence diagrams to be readable. Report the count: `N diagrams`.
3. **Enum check.** Grep your own draft for raw code values left in prose — any `field=value` pattern (numbers, booleans such as `field=true` / `field=false`, and status/type codes) plus other untranslated flags. If any survive outside a field-dictionary table or `<details>` block, translate them to their human meaning before finishing.
4. **Terminology check.** List the distinct words the document uses to refer to the scoped feature/entity and its key labels. Each MUST be the canonical source term from the Terminology section — if any is a target-language translation or synonym, replace it with the source term everywhere (prose, headings, tables, diagram labels). Enumerating your own usages is the point: it surfaces a translated variant you would otherwise not notice. Report: `N terms; 0 translated-variant leaks`.
5. **Save.** Offer to write the PRD to the project (default `docs/PRD.md`, or a path the user gives; a scoped PRD may use `docs/PRD-<scope>.md`). Suggest committing it for the team.
