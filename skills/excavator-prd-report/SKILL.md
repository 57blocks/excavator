---
name: excavator-prd-report
description: Write the As-Is PRD chapter and the product and technical findings of every feature of a project into an output directory, and assemble one PRD.md from the chapters. A script lists the entrypoint candidates, you group them into features with a conserved index, one subagent lane per feature writes its chapter and its findings, scripts check every lane, you verify each chapter against the code, and scripts aggregate the counts and assemble the PRD so it covers every flow in scope — not a curated subset.
argument-hint: "[path] [--role <audience>] [--language <lang>] [--scope <domain-or-subdir>] [--out <dir>] [--concurrency <n>] [--fresh]"
---

# /excavator-prd-report

Produce an **As-Is PRD** — a product document describing what the code **actually does today**, reverse-engineered from the source (and the knowledge graph when there is one). Default audience is a **product manager**.

Two rules govern everything below:

1. **As-Is only.** Describe behavior that exists in the code. Every claim must be traceable to real source; never invent fields, states, rules, or numbers. Where the code does not settle something, say so out loud (e.g. "not evident in the code" / "to be confirmed").
2. **All flows, not a curated subset.** The deliverable must reflect *every* flow in scope. The skill enforces this with an index whose candidates are conserved by script (Phase 1): every entrypoint candidate belongs to exactly one feature or is listed as unassigned, and every feature ends in exactly one status. Omitting a flow silently is a defect, not an editorial choice.

## How the work is split

| Who | Does |
|---|---|
| `prd.mjs` (a script, no model) | Lists the entrypoint candidates, checks the index, each lane and each priority file, records each dispatch and failure, merges the levels into the findings, counts, builds every table and assembles `PRD.md`. |
| You (the orchestrator) | Group the candidates into features, hunt the behavior the patterns cannot see, dispatch the lanes, verify each chapter, dispatch the ranking subagents, write the overview, and reply. |
| One subagent lane per feature | Reads that feature's code and writes its chapter and its findings — two files, nothing else. |
| One ranking subagent per batch of features | Reads those features' findings and the source their evidence names and writes one priority file per feature, nothing else. |

All files of a run live in `$OUT`:

| File | Written by |
|---|---|
| `entrypoints.json` | `prd.mjs entrypoints` |
| `plan.json`, `overview.md` | you |
| `index.json` | the jq command of Phase 1; then only `prd.mjs` changes it |
| `features/<id>.md`, `findings/<id>.json` | the lane of feature `<id>` |
| `verification/<id>.md`, `verification/<id>.txt` | you, following the `excavator-verify` procedure |
| `priorities/<id>.json` | the ranking subagent of the batch that holds feature `<id>` |
| `open-items/sources.json` | `prd.mjs check-open-items` |
| `open-items/merged.json` | the merge subagent |
| `open-items/checked.json` | the check subagent |
| `findings.json`, `tables/terminology.md`, `tables/roles.md`, `tables/open-items.md`, `tables/coverage.md`, `tables/verification.md` | `prd.mjs aggregate` |
| `PRD.md` | `prd.mjs assemble` |
| `report.html` | `prd.mjs page` |

`PRD.md` holds, in this order: the overview, `## Terminology`, `## Flow index`, `## Roles`, the `reference` chapters, the other chapters in chapter order, `## Open items` and `## Appendix`. The scripts generate the Terminology, Flow index, Roles and Open items sections from the index and the chapters' front-matter; you and the lanes write none of them.

## Why the patterns are not enough

Entrypoint patterns find route, page, job and `main` registrations. A lot of product-visible behavior has no such registration:

- outbound **notifications / messaging** (Slack, email, webhooks, push);
- **scheduled / background** work registered in an unusual way (queues, workers, reminders);
- **permission / authorization** rules (route guards, role checks, menu visibility);
- calls to **external services** across an HTTP/gRPC/message boundary (e.g. a frontend calling a backend — no source import connects them).

Phase 1 therefore has two halves: group the candidates the script lists, **and** hunt the source for the behavior it cannot see. Skipping the second half is how a PRD ends up "mentioning Slack but not who/what", or missing the cron reminders and the permission model entirely.

## Options

`$ARGUMENTS` may contain:
- A directory path — the project to document (default: current working directory).
- `--role <audience>` — who the PRD is written for (default: `product manager`). Shapes vocabulary and structure, not the facts.
- `--language <lang>` — the language of the PRD and everything said to the user during the run; English when it is not given.
- `--scope <domain-or-subdir>` — limit the PRD to one domain or subdirectory (e.g. a single feature area, or one member of a multi-repo). Within the scope, coverage must still be exhaustive.
- `--out <dir>` — where the run's files, the PRD and the report page go (default: `<project>/.excavator/prd-report`).
- `--concurrency <n>` — how many lanes run at once (default: 3).
- `--fresh` — start over instead of resuming an earlier run in the same `--out`.

## Graph tools

The graph is an **accelerator, not a dependency**: it helps you find a feature's files and chains, but the source tree is the ground truth and the skill runs fully without a graph. Prefer the excavator MCP graph tools when connected; otherwise fall back to `Grep` over `.excavator/knowledge-graph.jsonl` (one node or edge per line) and the source tree.

- `project_status` — snapshot, freshness, gaps.
- `recall` — find nodes by terms / ids / paths.
- `traverse` — follow fact edges (`one-hop` / `bfs` / `shortest-path`) from seed node ids.
- `read_evidence` — read a bounded current source range by path or node id.

Read efficiently: grep for the entries you need, follow edges for chains, don't dump the whole graph into context.

---

## Phase 0 — Setup

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

1. Resolve `PROJECT_ROOT` from the path argument (default: `pwd`). Parse `--role` (default `product manager`), `--language` (`$LANGUAGE`: English when it is not given), `--scope`, `--out` (`$OUT`, default `$PROJECT_ROOT/.excavator/prd-report`), `--concurrency` (`$CONCURRENCY`, default `3`) and `--fresh`. `$ROLE` is the `--role` value and `$SCOPE` the `--scope` value.
2. Resolve `PLUGIN_ROOT` and check the facts:
   ```bash
   PROJECT_ROOT="$(pwd)"   # or the path argument
   OUT="$PROJECT_ROOT/.excavator/prd-report"   # or the --out value
   SKILL_REAL=$(realpath ~/.agents/skills/excavator-prd-report 2>/dev/null || readlink -f ~/.agents/skills/excavator-prd-report 2>/dev/null || echo "")
   SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
   PLUGIN_ROOT=""
   for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do
     if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then PLUGIN_ROOT="$candidate"; break; fi
   done
   echo "PROJECT_ROOT=$PROJECT_ROOT"; echo "OUT=$OUT"; echo "PLUGIN_ROOT=$PLUGIN_ROOT"
   node "$PLUGIN_ROOT/skills/excavator/consumer-freshness.mjs" "$PROJECT_ROOT"
   ```
   Each bash call starts a new shell: in every later command, write `$PROJECT_ROOT`, `$OUT` and `$PLUGIN_ROOT` as the values this block printed. Every `prd.mjs` command that reads `$OUT` takes `--project "$PROJECT_ROOT"`: it resolves the project's files under that root, never under the root `index.json` names, and refuses an index that names another. Its `currentSourceRevision` is the current source revision; keep it for Phase 1 and for the resume check below. Its `status` says whether the knowledge graph in `.excavator/` matches the source: `fresh` → use the graph; `stale` or `missing` is only reported: tell the user the graph is behind the source or absent, so the run reads the source directly (offer `/excavator` as a faster future option), and continue. This skill never runs `/excavator`, `sync_facts` or any other command that rebuilds the facts in `.excavator/`, and never changes a file there. Write only under `$OUT`. When a `prd.mjs` command exits 2 naming `$OUT/index.json.lock` and no other `prd.mjs` command of this run is still running (this skill runs them one at a time), delete that lock file and run the command again; never delete it while a command runs.
3. Start over or resume:
   - With `--fresh`, delete `$OUT` and start over. Delete it only when it does not exist, is empty or holds an `index.json` with `"format": "excavator-prd-report/1"` or `"format": "excavator-prd-report/2"`; otherwise tell the user `$OUT` holds other files, and stop.
   - When `$OUT/index.json` exists and `--fresh` is not given, resume. Read its revision with `jq -r .sourceRevision "$OUT/index.json"`. If its `sourceRevision` differs from the current one, do not resume: tell the user to run again with `--fresh`, and stop. Otherwise check the index the earlier run left:
     ```bash
     node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" check-index "$OUT" --project "$PROJECT_ROOT"
     ```
     When a `prd.mjs` command prints `index: <out> was written by an earlier version (excavator-prd-report/1); run again with --fresh`, tell the user to run again with `--fresh`, and stop; never repair that index; the next sentence is for every other failure. When `check-index` exits 1, fix the index, and dispatch no lane until `check-index` exits 0. Never rebuild `index.json` from `plan.json` on a resume: that drops each feature's `status`, `attempts` and `failure`. Fix only the candidates and seed files `check-index` named, with `jq` edits to `$OUT/index.json`, and run `check-index` again. A candidate it says differs from `entrypoints.json` is copied back from that file's item of the same id. When it exits 0, bring every feature's status up to date from the files the earlier run left:
     ```bash
     node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" aggregate "$OUT" --project "$PROJECT_ROOT"
     jq -r '.features[] | [.id, .status, .attempts, .name] | @tsv' "$OUT/index.json"
     ```
     When `aggregate` exits 1, show its lines and stop. Otherwise: `verified` features are kept as they are; `written` and `checked` features only get the later steps (Phase 3); `planned` features, and `failed` features with `attempts` below 2, go back to Phase 2; `failed` features with `attempts` 2 stay failed. Features whose `priorities/<id>.json` passes `check-priorities` are not ranked again (Phase 3), and an output directory with verified chapters and no `priorities/` only gets the ranking step and the steps after it. Passing `open-items/merged.json` and `open-items/checked.json` are kept; the merge and the check are done again only when the open items changed. Skip Phase 1 and continue with Phase 2.
   - Otherwise create `$OUT` (`mkdir -p "$OUT"`) and continue with Phase 1.

---

## Phase 1 — Overview and index

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The index is the anti-cherry-pick device. Build it **before** any chapter is written. Do not prune it for length.

### 1a. List the entrypoint candidates

```bash
node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" entrypoints "$PROJECT_ROOT" > "$OUT/entrypoints.json"
jq 'del(.items)' "$OUT/entrypoints.json"
jq -r '.items[] | [.id, .kind, .framework, "\(.file):\(.line)", .text] | @tsv' "$OUT/entrypoints.json"
```

When `--scope` names a subdirectory, add `--scope "$SCOPE"` to the first command. When it names a domain, list the whole project and put the candidates outside the domain in `unassigned`. The header says which frameworks were found, which have patterns (`covered`) and which have none (`uncovered`), and what the scan skipped (`files.skipped`, `skippedDirectories`, `residualAssumptions`). A framework in `uncovered` has entrypoints the script cannot list: find them yourself in 1b.

### 1b. Behavior the patterns cannot see (do not skip)

For each category below, `Grep` the source (then read the lines to confirm) and add what you find as an inferred candidate. These patterns are starting points — **adapt to the languages and frameworks actually present**; the goal is the behavior, not the keyword.

| Category | Search starting points |
|---|---|
| Notifications / messaging | `slack`, `webhook`, `notify`, `email`, `mail`, `sns`, `push`, `im`, `bot` |
| Scheduled / background / async | `cron`, `schedule`, `@Scheduled`, `ticker`, `setInterval`, `queue`, `worker`, `consumer`, `job`, `timer`, `reminder` |
| Permission / authorization | `middleware`, `guard`, `role`, `permission`, `authorize`, `rbac`, `policy`, `scope`, `menu` visibility/route role config |
| External services / integrations | HTTP/gRPC clients to other services, message brokers, third-party SDKs, `baseURL`/`endpoint` config |
| Config / feature flags | env vars and config toggles that change a flow's behavior |
| Entrypoints of an `uncovered` framework | its route, page, job and `main` registrations |

Each inferred candidate is `{"id": "i<n>", "kind": "route" | "page" | "job" | "main", "file": "<path from the project root>", "line": <n>, "text": "<the line>", "framework": "<framework or library>", "provenance": "inferred"}` — always with `provenance: "inferred"` and the exact `file` and `line` of what you read; `check-index` refuses a file or line that does not exist. For every one, note in product terms **when it fires, who/what it targets, what its content or effect is**: a notification without recipient and content, a job without schedule and effect, or a permission without who-can-do-what is an incomplete entry.

### 1c. Group the candidates into features

- **Resolve each UI page's real route from the router, not from its file location.** A page component often lives in one feature's directory but is *registered* in a shared router/outlet/layout file elsewhere (a hub that groups several features as tabs). Trace the route registration to record each page's actual URL and navigation context — the hub/tab it sits under and any default-landing route — and never infer the route from the directory path. A page whose component is in scope but whose mount lives outside it is still in scope.
- **Stitch each flow end-to-end (frontend ↔ backend).** Most user-facing flows cross a network boundary no import spans: for each frontend page, find the request it sends (URL / method / path) and match it to the backend route that serves it, then follow that route's chain into its side effects (notifications, jobs). One end-to-end flow is **one feature spanning both tiers**, not two.
- A feature is `kind: "flow"` (a user action from page to effect) or `kind: "automated"` (scheduled or background work, described with the same weight as user actions). Give each an id `F1`, `F2`, … in reading order, a product name, a `chapter` number (the order of the chapters in the PRD), its `entrypoints` (candidate ids), its `seedFiles` (the entrypoint files, the files they import or call directly, and the files that define the codes, enums and settings the feature reads — the lane reads only these) and its `tiers` (`frontend`, `backend`).
- **Shared models.** When the scope has a permission model (roles, policies, guards), make a feature with `kind: "reference"` named `Roles and permissions`, translated into `$LANGUAGE`. Its `seedFiles` are the files that define the roles, statuses, policies and guards; its `entrypoints` may be empty, and `seedFiles` is required. Treat any other model that several flows share (a token or session model, a shared status dictionary) the same way. Reference features take the lowest chapter numbers: `check-index` refuses a `reference` chapter that comes after a `flow` or `automated` chapter.
- **Callers outside the scope.** When `--scope` names a subdirectory, search outside the scope for the callers of every entrypoint in scope: the pages and clients that send the request, and the other services that call it. Add the files that hold them to that feature's `seedFiles`; only those files, not what they import. Their own flows stay out of scope: they get no feature and no candidate.
- Every candidate belongs to exactly one feature or is listed in `unassigned` (test code, dead registrations, out of scope); `check-index` counts both. The flow names of `.excavator/domain-graph.json`, when it exists, may help name the features; they are not candidates.
- **Name the actors of the project: each real actor once**, the user categories, the external systems, the other services and the operators, named as the product names them, with no name twice (a member of staff is one actor, not one per feature that mentions them). Write them as `actors` in `plan.json`; every chapter takes its actors from this list. `check-index` exits 1 and prints `index: actors must list each actor of the project once` when `actors` is missing, empty, holds an empty name or names an actor twice.
- Draft the glossary: the canonical source terms of the scope (entity and feature names and key UI labels, exactly as the code/UI spells them) with their meaning. Every lane writes these terms verbatim.

### 1d. Write and check the index

Write `$OUT/plan.json`:

```json
{
  "language": "<$LANGUAGE>",
  "role": "<$ROLE>",
  "scope": null,
  "inferred": [{"id": "i1", "kind": "job", "file": "...", "line": 1, "text": "...", "framework": "...", "provenance": "inferred"}],
  "features": [{"id": "F1", "name": "...", "kind": "flow", "chapter": 1, "entrypoints": ["c1", "i1"], "seedFiles": ["..."], "tiers": ["frontend", "backend"]}],
  "unassigned": ["c7"],
  "actors": ["..."],
  "glossary": [{"term": "...", "meaning": "..."}],
  "residualAssumptions": ["..."]
}
```

(`scope` is the `--scope` value as a string, or `null`.) Then build the index from it and the script's candidates — `sourceRevision`: the `currentSourceRevision` Phase 0 printed, passed as `rev` — and check it:

```bash
jq -n --slurpfile e "$OUT/entrypoints.json" --slurpfile p "$OUT/plan.json" --arg rev "<currentSourceRevision>" '$e[0] as $e | $p[0] as $p | {format: "excavator-prd-report/2", projectRoot: $e.projectRoot, sourceRevision: $rev, factsDigest: null, language: $p.language, role: $p.role, scope: $p.scope, frameworks: $e.frameworks, candidates: {byFramework: $e.byFramework, uncovered: $e.uncovered, items: ($e.items + $p.inferred)}, features: $p.features, unassigned: $p.unassigned, actors: $p.actors, glossary: $p.glossary, residualAssumptions: ($e.residualAssumptions + $p.residualAssumptions)}' > "$OUT/index.json"
node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" check-index "$OUT" --project "$PROJECT_ROOT"
```

`check-index` exits 1 and prints, one per line, every candidate assigned twice or not at all, every schema problem, every candidate's file or line and every seed file that does not exist, and every candidate without `provenance: "inferred"` that is not the item of the same id in `$OUT/entrypoints.json`, field for field. Fix `plan.json`, build the index again and rerun it. Do not dispatch any lane until `check-index` exits 0. Then print the features to the user, one line each: id, name, kind and the number of entrypoints.

---

## Phase 2 — Feature lanes

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

1. Run `aggregate` right after `check-index` passes, before you list the lanes, so the statuses come from the files; then list the lanes this run dispatches, in chapter order — the `planned` features and, on a resume, the `failed` ones with `attempts` below 2:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" aggregate "$OUT" --project "$PROJECT_ROOT"
   jq -r '.features | sort_by(.chapter)[] | select(.status == "planned" or (.status == "failed" and .attempts < 2)) | [.id, .attempts, .name] | @tsv' "$OUT/index.json"
   ```
   Before you dispatch a lane again, delete the files its earlier attempt left (`rm -f "$OUT/features/<id>.md" "$OUT/findings/<id>.json" "$OUT/verification/<id>.txt" "$OUT/verification/<id>.md"`).
2. Right before you dispatch lanes, record their dispatches. Put the `mark` calls of one batch in one Bash command, one after another, before the message that dispatches the batch, one line per lane:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" mark "$OUT" <id> dispatched --project "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" mark "$OUT" <next id> dispatched --project "$PROJECT_ROOT"
   ```
   Dispatch at most `$CONCURRENCY` lanes in one message so they run concurrently, each a subagent in the foreground with the prompt below, its placeholders filled in from the index and `$PROJECT_ROOT`, `$OUT`, `$LANGUAGE` and `$ROLE` written as their values. Wait for every lane of the message to return before you send the next; never in the background: a run without a terminal stops waiting for background subagents.
3. As each lane returns, check it. Run `check-lane` for one lane at a time, as each returns, never two at once:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" check-lane "$OUT" <id> --project "$PROJECT_ROOT"
   ```
   `check-lane` records its result in `index.json` itself: `checked`, or `failed` at `check-lane` with the lines it printed as the reasons.
   - Exit 0: the lane is checked. The command wrote each finding's `line` into its file.
   - Exit 1: the lane failed its checks, or a file it should have written is missing (`lane-wrote-nothing`). The last line it prints is a `Next:` line. Follow it:
     - `Next: delete <id>'s files, mark it dispatched and re-dispatch it once with the lines above (attempt 2 of 2)`: delete the lane's files (as in step 1), mark the dispatch (as in step 2) and re-dispatch the lane once with its prompt followed by this line and then each line `check-lane` printed: `Your previous attempt failed these checks; fix them and write both files again:`. Pass every line `check-lane` printed, including the findings lines, except the `Next:` line. Check it again when it returns.
     - `Next: <id> stays failed (2 of 2 attempts)`: leave the feature `failed` at `check-lane`, as `check-lane` recorded it, with its files kept for the user to see. When the lane wrote nothing, also record the failure:
       ```bash
       node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" mark "$OUT" <id> failed lane lane-wrote-nothing --project "$PROJECT_ROOT"
       ```
     On a resume, the lines are the reasons `index.json` holds: `jq -r '.features[] | select(.id == "<id>") | .failure.reasons[]' "$OUT/index.json"`.
   - Exit 2: the command could not run. Show its message and stop.

   Never edit `features/<id>.md` or `findings/<id>.json` yourself. A lane that fails its checks is fixed only by its own second attempt, never by you widening an anchor or rewording a finding to pass the check.

   Then tell the user `Lane <id> <n>/<N>: <status>`, where `<n>` counts the lanes this run has checked, `<N>` is the number listed in step 1 and `<status>` is `checked` or `failed`, in `$LANGUAGE`. Statuses and attempts change only through these commands: never edit `index.json` yourself.

The lane prompt:

````text
You write one chapter of an As-Is PRD (product requirements document) for the project at $PROJECT_ROOT, and the findings of that chapter. Your feature: <id> "<name>" (<kind>), chapter <chapter>.

Your scope. Read only these files: <seedFiles, one per line>. The one exception is the whole-project search that **Prove the statements that tend to be wrong** asks for. Its entrypoints: <entrypoints, one per line: id, kind, file:line, text>. The other features of this PRD, which other lanes write: <id, name and kind of every other feature, one per line>. Describe the hand-over to another feature in one sentence, not its flow. Read code only; never run, build or change anything in the project.

The actors of this PRD: <index actors, one per line>.

Write in `$LANGUAGE`, in product language for `$ROLE`.

**As-Is only.** Describe behavior that exists in the code. Every claim must be traceable to real source; never invent fields, states, rules, or numbers. Where the code does not settle something, say so out loud (e.g. "not evident in the code" / "to be confirmed").

**Every flow in your scope.** Cover every entrypoint listed above and every behavior its code reaches within your feature — notifications, scheduled work, permissions, external calls. Omitting one silently is a defect, not an editorial choice.

**No code in the body.** The chapter describes behavior, not implementation. Do not paste code, function/route signatures, SQL, or config literals into the prose. Name an identifier only when it is genuinely user-facing (a status label, an on-screen field); otherwise describe it in business terms. Anything code-level (snippets, `file:line`) belongs only in the fold-away `<details>` blocks described below.

**Translate codes — never print raw values.** Numeric enum/status codes, boolean flags, and database field values are meaningless to the reader. Always render them as their human meaning: a numeric status code becomes its status label, a boolean flag becomes the condition it represents, a type code becomes the type it names — never a raw `status=2` / `field=true` / `type=1` in the prose. Resolve every code by reading the enum/constant definition in source (do not guess the mapping). When the code-to-meaning mapping itself is worth recording, put it in a **field-dictionary table** (columns: value | meaning), never inline in prose. A bare code, flag, or `field=value` left in the running text is a defect: before you finish, search your chapter for `=` and for bare numbers or booleans in the prose, and translate any you find outside a field-dictionary table or a `<details>` block.

**Preserve source-owned names; translate only the generic prose.** When `$LANGUAGE` differs from the source's language, keep product/feature names, module names, and UI-visible labels — menu items, page/tab titles, button text, field labels, status names — in their original source form, exactly as they appear in the code/UI, and translate only the generic connective and descriptive words around them. The reader must be able to map every term back to what they see in the product, so never translate a name into a target-language equivalent. Use that source name in **every** mention of the entity — running prose, section headings, tables, and mermaid diagram labels alike — and never coin a translated synonym for it, even when referring to it as a common noun. When unsure whether a term is source-owned, check how it appears in the source/UI and keep that exact form.

**Terminology.** The PRD's glossary (source term | meaning): <glossary, one per line>. Reuse each listed term verbatim everywhere — prose, headings, tables, diagram labels — never a translation of it. Before you finish, list the words your chapter uses for the feature's entities and labels, and replace any translated variant with the source term.

**Cite only files inside the project root.** Code outside the project (dependency caches, the standard library, installed packages) is never evidence: describe a dependency's behaviour from the project's own code and config, or write it as an open item. A path under `node_modules`, `vendor` or another dependency or build directory fails the check.

**Describe each flow end-to-end, across tiers.** A flow is one story from the user's action to the final effect — not a frontend part and a separate backend part. For each flow, as one continuous description, cover:
- **Frontend** — the page/entry and its real route, form fields and their **validation rules**, UI states, and what the user sees at each step. When your seed files hold callers outside the scope (pages and clients that send the request, other services that call it), write the Frontend and hand-over parts from them.
- **Backend** — the validation and processing the request goes through, what data is created/changed, transaction boundaries, and downstream effects (notifications, jobs).
- **The seam** — which user action invokes which backend capability (the request the frontend sends and the route the backend serves).

For each flow also give: purpose (what problem it solves, for whom), roles involved, trigger, the step sequence, business rules, and edge cases as *user-visible outcomes* (not error codes).

Depth requirements (these are where thin PRDs fail):
- **Every displayed/computed number** — give the calculation method, its inputs, and what is included/excluded.
- **Every configurable item** — state what configuring it *does*, who it affects, and where it takes effect — not only how to configure it.
- **Every notification/message** — trigger, recipient, and content/composition.
- **Permissions** — in each flow, which roles may start it and what each sees; the role × capability matrix, the dictionary tables and the settings several flows share belong to the `reference` chapter of this PRD (a feature of kind `reference` in the list of other features); a flow chapter names that chapter instead of repeating them.
- **Automated behavior** — scheduled/background work described with the same weight as user actions.

**Prove the statements that tend to be wrong.** Five kinds of statement are where model-written PRDs go wrong while every cited name is real: **negative** claims ("sends no event", "never used", "posts no accounting entry"), **reachability / order** ("this rule is unreachable", "checked before"), **trigger mechanism** ("recalculated via an event", "done by the nightly job"), **absolute / invariance** claims ("always", "regardless of the setting"), and **open items** (to be confirmed). Before writing one of the first four, search the **whole project** — every module, event listeners and their registrations, scheduler/batch registrations, SQL and migration scripts, configuration — and keep the searched scope with the evidence. If you cannot settle it, write it as to be confirmed and state what you searched. If you delegate research to subagents, pass this rule to them verbatim.

**Chapter structure.** The chapter has exactly one `##` heading, the first one: `## <name>`; everything under it uses `###` and deeper. Each flow is one `###` section. A `reference` chapter holds the dictionary tables (value | meaning), a role × capability matrix, the decision procedure and one diagram, and has no flow. A flow chapter refers to a `reference` chapter by name instead of repeating it. In a `flow` or `automated` chapter every `###` section is one flow listed in `flows`, except the last one, the open items section. The text under `## <name>` before the first `###` is the chapter's introduction: the feature's flowchart, a short overview and the hand-overs to other features. A section that is not a flow (overview, permissions, dictionary, configuration) fails the check, which prints for a section named Permissions: `### "Permissions" is neither a listed flow nor the open items heading; a flow chapter holds only its flows and its open items`.

Readability is a requirement, not a nicety: **tables** for fields, rules, permission matrices and edge cases; **lists** for step sequences.

**Mermaid is required, not optional.** Give the feature a `flowchart`, and every cross-tier end-to-end flow a `sequenceDiagram` (frontend, backend, notification/job). Keep each diagram to one clear idea. A chapter with no diagram fails its check.

**Evidence stays foldable.** Keep the body clean and code-free; put `file:line` traceability inside a collapsible block, with paths from the project root and line numbers that exist, typically one block per flow:
```markdown
<details><summary>Evidence</summary>

- Frontend form rules — `path/to/Form.tsx:95-140`
- Backend handler — `path/to/handler.go:200-260`

</details>
```

Write each anchor in backticks, as `path:line` or `path:line-line`, with the path from the project root.

Before you finish, check the last line of every anchor against the number of lines of its file (`awk 'END { print NR }' <file>`): an anchor that ends past the last line fails the check.

**Findings.** While you read, note the defects the code shows today, in two classes:
- `product` — user-visible behavior defects: behavior that is inconsistent (two paths treat the same case differently), missing (a case the flow does not handle) or asymmetric (an action without its counterpart, a check on one tier only).
- `technical` — code-level problems: dead or unreachable code, duplicated logic that has diverged, errors swallowed, values hard-coded where the rest of the code reads them from configuration.

State each defect as it is. Do not write how to fix it: a statement with "should", "recommend", "suggest", "refactor", "ought to", "better to", "it would be better", or the same words in `$LANGUAGE`, is refused. Give no severity and no confidence. Each finding has this shape: `{"findings": [{"id": "<id>-1", "class": "product", "statement": "<the defect as it is>", "flows": ["<id>"], "evidence": [{"file": "<path from the project root>", "passage": "<text copied from the file>"}]}]}`. Number the ids `<id>-1`, `<id>-2`, …; `flows` holds `<id>` and any other feature id the defect involves. Copy each passage verbatim from the file — part of a line or whole lines — long enough that it occurs exactly once in that file; a script checks this and refuses a passage it cannot find once. With no finding, write `{"findings": []}`. The findings go only in the findings file: the chapter has no findings section and does not mention the findings file.

Write only these two files, and nothing else anywhere:
1. `$OUT/features/<id>.md` — this front-matter, then the chapter, starting with `## <name>` and using `###` and deeper inside it:
   ```markdown
   ---
   id: <id>
   name: <name>
   kind: <kind>
   actors: [<each actor of that list that starts or takes part in a flow>]
   permissionRoles: [<each named role of the permission model, spelled as in the code>]
   triggers:
     - <each trigger, one per line>
   flows:
     - "<the exact text of each flow's ### heading>"
   openItems: <the text of the last ### heading, which holds the open items>
   chapter: <chapter>
   ---
   ```
   `actors` takes only names from the list of the actors of this PRD, spelled exactly as listed; a name outside the list fails the check. `actors` and `permissionRoles` are two lists with no name in common; either may be `[]`. `flows` holds the exact text of the `###` heading of each flow: at least one flow for a `flow` or `automated` feature, none (`flows: []`) for a `reference` feature. `flows` lists only flows, each a path from one trigger to one outcome; an overview, a configuration, a permissions or a findings section is not a flow. `openItems` is the text of the last `###` heading of the chapter, which holds its open items; leave the key out when the chapter has none. The open items section holds one table of three columns — the item, what is known, what was searched — with its header in `$LANGUAGE` and nothing else: no list, no paragraph before or after the table. Any other shape fails the check, which prints `the open items section is not one table of three columns (item, what is known, what was searched)`.
2. `$OUT/findings/<id>.json` — the findings, in the shape above.

Reply with one line: `<id>: <D> diagrams, <F> findings`, and nothing else.
````

---

## Phase 3 — Verify and aggregate

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

1. Bring the statuses up to date and list the chapters to verify:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" aggregate "$OUT" --project "$PROJECT_ROOT"
   jq -r '.features | sort_by(.chapter)[] | select(.status == "checked") | [.id, .name] | @tsv' "$OUT/index.json"
   ```
   Never edit `features/<id>.md` or `findings/<id>.json` yourself. The only change a chapter gets after its lane is the one the verification's `--fix` step makes in step 2; a finding is never changed after `check-lane`.
2. Verify each listed chapter yourself, one at a time, not in a lane (a lane cannot reliably dispatch the subagents the verification needs, and the verification needs a clean context): take `$OUT/features/<id>.md` and follow the procedure in `$PLUGIN_ROOT/skills/excavator-verify/SKILL.md` on it with `--fix --no-summary`, `--language` set to `$LANGUAGE` and `PROJECT_ROOT` as the project path, and `--report` set to `$OUT/verification/<id>.md`. It checks the five statement classes and the consistency of the chapter, and corrects the chapter in place. The chapter keeps its one `##` heading and gets no verification summary; `aggregate` fails a feature whose verified chapter has another `##` heading.
3. Then run the reply command of its Phase 6 and store the lines it prints verbatim in `$OUT/verification/<id>.txt` (`printf '%s\n' … > "$OUT/verification/<id>.txt"`), even though Phase 6 of `excavator-verify` says to skip its reply when another skill follows its procedure: `aggregate` reads the counts from those lines by their position, in any language, and fails the feature when they are not there or `verification/<id>.md` is missing. Do not show these lines to the user; tell them `Verify <id> <n>/<N>: done` in `$LANGUAGE`.
4. Rank the findings. Each finding gets the level P0, P1 or P2 from a ranking subagent that reads only the findings and the source their evidence names, so one rubric sets the scale for every feature; a lane never ranks its own findings. The scripts check the files, merge the levels into `findings.json`, sort and count them: you never rank, sort or add up a level. Never write or edit `priorities/<id>.json` yourself. Only the ranking subagent writes it, the same rule as the lane files.
   1. Run `aggregate`, then `check-priorities`:
      ```bash
      node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" aggregate "$OUT" --project "$PROJECT_ROOT"
      node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" check-priorities "$OUT" --project "$PROJECT_ROOT"
      ```
      It prints one line for each written feature, `<id>: ranked` or its problems, then one line `batch N: <ids>` for each batch of the features still to rank (at most 120 findings to a batch, in chapter order), then `Rank: <n> features ranked, <m> unranked`. A feature whose file passes is not ranked again, so a resumed run ranks only the rest. It exits 0 when every feature is ranked: go on to the next step.
   2. When it exits 1, for each `batch N:` line it printed, dispatch one ranking subagent with the prompt below, in the foreground, at most `$CONCURRENCY` in one message, never in the background: a run without a terminal stops waiting for background subagents. Fill in the placeholders from the line (the ids) and the index (`jq -r '.features[] | [.id, .name] | @tsv' "$OUT/index.json"`), with `$PROJECT_ROOT`, `$OUT` and `$LANGUAGE` written as their values. Wait for every subagent of the message to return before you send the next.
   3. Run `check-priorities` again. For each feature it still reports problems for: delete its file (`rm -f "$OUT/priorities/<id>.json"`), dispatch one ranking subagent for it alone, in the foreground, with the prompt followed by this line and then each problem line printed for it: `Your previous attempt failed these checks; fix them and write the file again:`. Run `check-priorities` again. When the feature still has problems, delete its file: its findings are unranked. Tell the user `Rank <id>: unranked` in `$LANGUAGE`.
   4. Run `check-priorities` a last time and tell the user its last line, `Rank: <n> features ranked, <m> unranked`, as printed, translated into `$LANGUAGE` with the numbers unchanged. A feature that stays unranked is not a failure of the run: its status does not change and `PRD.md` is assembled as before.

The ranking prompt:

````text
You rank the findings of the features listed below, for the As-Is PRD of the project at $PROJECT_ROOT. Your features: <id and name of each feature of the batch, one per line>.

Your scope. Read only these files: <$OUT/findings/<id>.json of each feature of the batch, one per line>, and the source files their evidence names, a few dozen lines around each passage. Read code only; never run, build or change anything in the project.

Give every finding of your features a level by this rubric:

- P0 — the defect lets someone do what they are not allowed to (pass an authentication or permission check meant to stop them, read or change another user's data, see a secret), loses or corrupts stored data, produces a wrong amount of money, or makes a main flow of the feature fail for every user.
- P1 — the defect gives users a wrong, inconsistent or missing result in a flow they use, hides a failure from users or operators (an error swallowed, success reported after a failure), or fails on ordinary input.
- P2 — any other defect: a value fixed in code, dead or duplicated code, inconsistent naming, gaps in logging or documentation.
Give the highest level whose condition the evidence shows. When the evidence does not show it (for example, it is not evident that an outsider can reach the endpoint), give the lower level and say in the reason what is not evident.

Write only `$OUT/priorities/<id>.json` for each feature of your batch, and nothing else anywhere, each in this shape: `{"priorities": [{"id": "<finding id>", "priority": "P0", "reason": "<one sentence>"}]}`. It holds one entry for each finding of the feature, each id exactly as the findings file spells it and listed once, `priority` one of `P0`, `P1` or `P2`, and no other key. The reason is one sentence in `$LANGUAGE`, at most 300 characters, that says which criterion the evidence meets and who is affected. Describe the defect's effect as it is: a reason with "should", "recommend", "suggest", "refactor", "ought to", "better to", "it would be better", or the same words in `$LANGUAGE`, is refused.

Reply with one line: `<ids of your features>: ranked`, and nothing else.
````

5. Merge the open items. The same open question is often asked in several chapters: one merge subagent groups the items that ask the same question, a check subagent then decides for each merged item whether answering the kept item also answers it, and the scripts check both files and write one row per group in the Open items section; an item the check rejects goes back to its own row. In this step you never group, merge, check or write an item, and never write or edit `open-items/merged.json` or `open-items/checked.json`. Only the merge subagent writes the first and only the check subagent writes the second, the same rule as the lane files.
   1. Run `aggregate`, then `check-open-items`:
      ```bash
      node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" aggregate "$OUT" --project "$PROJECT_ROOT"
      node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" check-open-items "$OUT" --project "$PROJECT_ROOT"
      ```
      It prints one line for each problem of the two files (for example `open-items/merged.json is missing`), then one status line: `Open items: <n> written in the chapters, <m> after merging`, `Open items: <n> written in the chapters, <m> after merging; the check put back <k> of <j> merged items`, `Open items: <n> written in the chapters, not merged` or `Open items: none written in the chapters`. It exits 0 when the merge passes and the check passes or is not needed, or there are fewer than two items: then skip to telling the user the line (sub-step 5).
   2. When it exits 1, choose the subagent by the problem lines (not the status line). When a line names `open-items/merged.json`, delete both files (`rm -f "$OUT/open-items/merged.json" "$OUT/open-items/checked.json"`) and dispatch one merge subagent with the merge prompt below. When the lines name only `open-items/checked.json`, delete it (`rm -f "$OUT/open-items/checked.json"`) and dispatch one check subagent with the check prompt below. Dispatch in the foreground, never in the background: a run without a terminal stops waiting for background subagents. Write `$OUT` and `$LANGUAGE` in the prompt as their values.
   3. Run `check-open-items` again and choose again in the same way: after the merge passed, the check is the next dispatch. Each of the two subagents gets one retry: dispatch it again the same way, with its prompt followed by this line and then each problem line that named its file: `Your previous attempt failed these checks; fix them and write the file again:`.
   4. When `check-open-items` still exits 1 after the retry of the subagent it calls for, delete both files (`rm -f "$OUT/open-items/merged.json" "$OUT/open-items/checked.json"`): the open items stay unmerged, each on its own row, and the coverage section says so. This is not a failure of the run.
   5. Tell the user its last line as printed, translated into `$LANGUAGE` with the numbers unchanged.

   A resumed run needs nothing more: `check-open-items` checks the digest, so after a chapter changed the merge and the check are done again; passing files are kept.

The merge prompt:

````text
You merge the open items of an As-Is PRD.

Your scope. Read only `$OUT/open-items/sources.json`; read no other file and no code. It holds a `digest` and a list of items. Each item has an `id`, the `feature` that asked it, and `item`, `known`, `searched`: the question, what is known and where it was searched.

Group the items that ask the same question: answering one answers the others. Items about the same subject that ask different things are not grouped. Items that share only a missing piece of evidence, such as nothing found in the code or a gateway or deployment that is not visible, ask different questions. When in doubt, leave the items apart: a missed merge costs one row, a wrong merge puts a question under another question's answer. Items in the same chapter can be grouped too. An item that matches no other is in no group.

For each group choose `keep`: the item whose text says the most (what is known and what was searched). Its text is shown for the whole group, and the items of the others are listed under it.

Write only `$OUT/open-items/merged.json`, and nothing else anywhere, in this shape: `{"digest": "<the digest of sources.json, copied>", "groups": [{"keep": "<id>", "also": ["<id>", ...]}]}`. Write every id exactly as sources.json spells it, each id in at most one group, `also` non-empty, `keep` not in `also`, no other key. Write no text of your own: no item, summary or reason. With no group, write `"groups": []`.

Reply with one line: `Open items: merged`, and nothing else.
````

The check prompt:

````text
You check the merged open items of an As-Is PRD.

Your scope. Read only `$OUT/open-items/sources.json` and `$OUT/open-items/merged.json`; read no other file and no code. sources.json holds a `digest` and a list of items. Each item has an `id`, the `feature` that asked it, and `item`, `known`, `searched`: the question, what is known and where it was searched. merged.json holds groups, each with a `keep` id and an `also` list of ids.

For every id in each group's `also`, decide whether answering the question of that group's `keep` item also answers this item's question. `same` is true only then. Items about the same subject that ask different things are not the same. Items that share only a missing piece of evidence, such as nothing found in the code or a gateway or deployment that is not visible, are not the same. When in doubt, `same` is false.

Write only `$OUT/open-items/checked.json`, and nothing else anywhere, in this shape: `{"digest": "<the digest of sources.json, copied>", "members": [{"keep": "<id>", "id": "<id>", "same": true}]}`. Write one entry for every pair of a group's `keep` and one id of its `also`, none missing and none twice. Write every id exactly as sources.json spells it, `same` as true or false, no other key. Write no text of your own: no item, summary or reason.

Reply with one line: `Open items: checked`, and nothing else.
````

6. Write `$OUT/overview.md` in `$LANGUAGE`, with these parts in this order: a title (`# <project or product name>`) on its first line; a short **Doc Info** block (version, date, project/domain, source revision, audience, and **scope size**) — localized to `$LANGUAGE`; the purpose and the capability map: a short product summary, one table of the consumers of the product, and one mermaid capability diagram; and an overview of the automated behavior. It MUST NOT hold the glossary, the roles, a list of the flows or the open items: `aggregate` and `assemble` generate the Terminology, Flow index, Roles and Open items sections. `assemble` exits 1 and prints one of these lines when the overview does not start with a `#` heading, has no mermaid block or ends inside an open code fence: `index: overview.md must start with one # heading, the document title, on its first line`, `index: overview.md has no mermaid block; write the capability map with one` or `index: overview.md ends inside an open code fence; close it`. Scope size is counted by command, never estimated: run the following (`SCOPE` is the `--scope` path, or `.` for the whole project) and copy the two numbers into Doc Info as "N files, M lines":
   ```bash
   cd "$PROJECT_ROOT"
   if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
     git ls-files -- "$SCOPE" | wc -l                               # files
     git ls-files -z -- "$SCOPE" | xargs -0 cat -- | wc -l           # lines
   else
     find "$SCOPE" -type f -not -path '*/.git/*' -not -path '*/.excavator/*' | wc -l
     find "$SCOPE" -type f -not -path '*/.git/*' -not -path '*/.excavator/*' -exec cat -- {} + | wc -l
   fi
   ```
   If `--scope` names a domain rather than a directory, list the directories it covers and count each. A project root that holds several Git repositories is not itself a work tree: count each member repository with the Git branch inside it, and add the numbers up.
7. Aggregate the lanes, assemble the PRD and write the report page:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" aggregate "$OUT" --project "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" assemble "$OUT" --project "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" page "$OUT" --project "$PROJECT_ROOT"
   ```
   `aggregate` recomputes every status from the files, writes `findings.json` (each finding with its level and reason, ordered by level) and the tables of `tables/`, and prints the counts as JSON. `aggregate` exits 1 when a candidate or a status is not conserved, with each problem on a line: show the lines and stop. `reply` (Phase 4) prints the reply from what `aggregate` recorded. `assemble` writes `$OUT/PRD.md` — the sections listed after the file table above, with the failed features and their reasons in the appendix — and prints its path. It exits 1 when a file it needs is missing: write it and run it again.

   `page` writes `$OUT/report.html`, one page that opens from disk with a double click and holds the overview, every feature with its findings, all findings and the coverage; it reads the files `aggregate` and `assemble` left, changes none of them, and prints the page's path; a failed `page` removes the page an earlier run left. Then tell the user `Page: <status>`, where `<status>` is `written` or `failed`, in `$LANGUAGE`. When `page` exits non-zero, tell the user the lines it printed as they are, do not build or edit any page or product file yourself, and go on to Phase 4: `reply` prints `Report page: not written`.

---

## Phase 4 — Self-check and reply

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

1. **Self-check.** Confirm that `assemble` printed the path of `$OUT/PRD.md`. Change no file: each lane ran the enum and terminology checks on its own chapter, and the verification corrected what it found. The chapters, the findings and `PRD.md` stay as the scripts and the verification left them.
2. **Save and reply.** The PRD stays in `$OUT`: write it into the project only when the user says so, to `docs/PRD.md` (a scoped PRD: `docs/PRD-<scope>.md`) or a path the user gives. `reply` prints, in this order: the path of `PRD.md`; the report page line, `Report page: <path>` or `Report page: not written`; the counts; the `Retry:` line, when a feature failed after one attempt, `Retry: <ids> failed after one attempt; running the command again without --fresh retries them`; the frameworks without patterns, when there are some; and the offer to save the PRD, when `$OUT` is the default. The offer names the default path.

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

Then print the reply's lines with this command:

```bash
node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" reply "$OUT" --project "$PROJECT_ROOT"
```

When it prints `PRD.md: missing`, run `assemble` (Phase 3) and then this command again; when it exits 1 with another line, show the lines and stop. Reply with exactly the lines it prints and nothing else: the same lines in the same order, none added and none left out. Write nothing before, between or after them, no word on the checks, the PRD or what was done, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply. When `$LANGUAGE` is not English, translate the words of those lines; the paths, the numbers and the framework names stay as they are.
