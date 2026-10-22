---
name: excavator-prd
description: Generate an As-Is PRD (product requirements document) from a codebase. A script lists the entrypoint candidates, you group them into features with a conserved index, one subagent lane per feature writes its chapter and its findings, scripts check every lane, you verify each chapter against the code, and scripts aggregate the counts and assemble one PRD that covers every flow in scope — not a curated subset.
argument-hint: "[path] [--role <audience>] [--language <lang>] [--scope <domain-or-subdir>] [--out <dir>] [--concurrency <n>] [--fresh]"
---

# /excavator-prd

Produce an **As-Is PRD** — a product document describing what the code **actually does today**, reverse-engineered from the source (and the knowledge graph when there is one). Default audience is a **product manager**.

Two rules govern everything below:

1. **As-Is only.** Describe behavior that exists in the code. Every claim must be traceable to real source; never invent fields, states, rules, or numbers. Where the code does not settle something, say so out loud (e.g. "not evident in the code" / "to be confirmed").
2. **All flows, not a curated subset.** The deliverable must reflect *every* flow in scope. The skill enforces this with an index whose candidates are conserved by script (Phase 1): every entrypoint candidate belongs to exactly one feature or is listed as unassigned, and every feature ends in exactly one status. Omitting a flow silently is a defect, not an editorial choice.

## How the work is split

| Who | Does |
|---|---|
| `prd.mjs` (a script, no model) | Lists the entrypoint candidates, checks the index and each lane, records each dispatch and failure, counts, builds every table and assembles `PRD.md`. |
| You (the orchestrator) | Group the candidates into features, hunt the behavior the patterns cannot see, dispatch the lanes, verify each chapter, write the overview, and reply. |
| One subagent lane per feature | Reads that feature's code and writes its chapter and its findings — two files, nothing else. |

All files of a run live in `$OUT`:

| File | Written by |
|---|---|
| `entrypoints.json` | `prd.mjs entrypoints` |
| `plan.json`, `overview.md` | you |
| `index.json` | the jq command of Phase 1; then only `prd.mjs` changes it |
| `features/<id>.md`, `findings/<id>.json` | the lane of feature `<id>` |
| `verification/<id>.md`, `verification/<id>.txt` | you, following the `excavator-verify` procedure |
| `findings.json`, `tables/*.md` | `prd.mjs aggregate` |
| `PRD.md` | `prd.mjs assemble` |

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
- `--out <dir>` — where the run's files and the PRD go (default: `<project>/.excavator/prd`).
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

1. Resolve `PROJECT_ROOT` from the path argument (default: `pwd`). Parse `--role` (default `product manager`), `--language` (`$LANGUAGE`: English when it is not given), `--scope`, `--out` (`$OUT`, default `$PROJECT_ROOT/.excavator/prd`), `--concurrency` (`$CONCURRENCY`, default `3`) and `--fresh`. `$ROLE` is the `--role` value and `$SCOPE` the `--scope` value.
2. Resolve `PLUGIN_ROOT` and check the facts:
   ```bash
   PROJECT_ROOT="$(pwd)"   # or the path argument
   OUT="$PROJECT_ROOT/.excavator/prd"   # or the --out value
   SKILL_REAL=$(realpath ~/.agents/skills/excavator-prd 2>/dev/null || readlink -f ~/.agents/skills/excavator-prd 2>/dev/null || echo "")
   SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
   PLUGIN_ROOT=""
   for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do
     if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then PLUGIN_ROOT="$candidate"; break; fi
   done
   echo "PROJECT_ROOT=$PROJECT_ROOT"; echo "OUT=$OUT"; echo "PLUGIN_ROOT=$PLUGIN_ROOT"
   node "$PLUGIN_ROOT/skills/excavator/consumer-freshness.mjs" "$PROJECT_ROOT"
   ```
   Each bash call starts a new shell: in every later command, write `$PROJECT_ROOT`, `$OUT` and `$PLUGIN_ROOT` as the values this block printed. Every `prd.mjs` command that reads `$OUT` takes `--project "$PROJECT_ROOT"`: it resolves the project's files under that root, never under the root `index.json` names, and refuses an index that names another. Its `currentSourceRevision` is the current source revision; keep it for Phase 1 and for the resume check below. Its `status` says whether the knowledge graph in `.excavator/` matches the source: `fresh` → use the graph; `stale` or `missing` is only reported: tell the user the graph is behind the source or absent, so the run reads the source directly (offer `/excavator` as a faster future option), and continue. This skill never runs `/excavator`, `sync_facts` or any other command that rebuilds the facts in `.excavator/`, and never changes a file there. Write only under `$OUT`.
3. Start over or resume:
   - With `--fresh`, delete `$OUT` and start over. Delete it only when it does not exist, is empty or holds an `index.json` with `"format": "excavator-prd/1"`; otherwise tell the user `$OUT` holds other files, and stop.
   - When `$OUT/index.json` exists and `--fresh` is not given, resume. Read its revision with `jq -r .sourceRevision "$OUT/index.json"`. If its `sourceRevision` differs from the current one, do not resume: tell the user to run again with `--fresh`, and stop. Otherwise bring every feature's status up to date from the files the earlier run left:
     ```bash
     node "$PLUGIN_ROOT/skills/excavator-prd/prd.mjs" aggregate "$OUT" --project "$PROJECT_ROOT"
     jq -r '.features[] | [.id, .status, .attempts, .name] | @tsv' "$OUT/index.json"
     ```
     When `aggregate` exits non-zero, the earlier run stopped before its index was complete: go to Phase 1 and finish the index from `$OUT/plan.json`. Otherwise: `verified` features are kept as they are; `written` and `checked` features only get the later steps (Phase 3); `planned` features, and `failed` features with `attempts` below 2, go back to Phase 2; `failed` features with `attempts` 2 stay failed. Skip Phase 1 and continue with Phase 2.
   - Otherwise create `$OUT` (`mkdir -p "$OUT"`) and continue with Phase 1.

---

## Phase 1 — Overview and index

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The index is the anti-cherry-pick device. Build it **before** any chapter is written. Do not prune it for length.

### 1a. List the entrypoint candidates

```bash
node "$PLUGIN_ROOT/skills/excavator-prd/prd.mjs" entrypoints "$PROJECT_ROOT" > "$OUT/entrypoints.json"
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
- Every candidate belongs to exactly one feature or is listed in `unassigned` (test code, dead registrations, out of scope); `check-index` counts both. The flow names of `.excavator/domain-graph.json`, when it exists, may help name the features; they are not candidates.
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
  "glossary": [{"term": "...", "meaning": "..."}],
  "residualAssumptions": ["..."]
}
```

(`scope` is the `--scope` value as a string, or `null`.) Then build the index from it and the script's candidates — `sourceRevision`: the `currentSourceRevision` Phase 0 printed, passed as `rev` — and check it:

```bash
jq -n --slurpfile e "$OUT/entrypoints.json" --slurpfile p "$OUT/plan.json" --arg rev "<currentSourceRevision>" '$e[0] as $e | $p[0] as $p | {format: "excavator-prd/1", projectRoot: $e.projectRoot, sourceRevision: $rev, factsDigest: null, language: $p.language, role: $p.role, scope: $p.scope, frameworks: $e.frameworks, candidates: {byFramework: $e.byFramework, uncovered: $e.uncovered, items: ($e.items + $p.inferred)}, features: $p.features, unassigned: $p.unassigned, glossary: $p.glossary, residualAssumptions: ($e.residualAssumptions + $p.residualAssumptions)}' > "$OUT/index.json"
node "$PLUGIN_ROOT/skills/excavator-prd/prd.mjs" check-index "$OUT" --project "$PROJECT_ROOT"
```

`check-index` exits 1 and prints, one per line, every candidate assigned twice or not at all, every schema problem, and every candidate's file or line and every seed file that does not exist. Fix `plan.json`, build the index again and rerun it. Do not dispatch any lane until `check-index` exits 0. Then print the features to the user, one line each: id, name, kind and the number of entrypoints.

---

## Phase 2 — Feature lanes

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

1. List the lanes this run dispatches, in chapter order — the `planned` features and, on a resume, the `failed` ones with `attempts` below 2:
   ```bash
   jq -r '.features | sort_by(.chapter)[] | select(.status == "planned" or (.status == "failed" and .attempts < 2)) | [.id, .attempts, .name] | @tsv' "$OUT/index.json"
   ```
   Before you dispatch a lane again, delete the files its earlier attempt left (`rm -f "$OUT/features/<id>.md" "$OUT/findings/<id>.json"`).
2. Right before you dispatch a lane, record the dispatch:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-prd/prd.mjs" mark "$OUT" <id> dispatched --project "$PROJECT_ROOT"
   ```
   Dispatch at most `$CONCURRENCY` lanes in one message so they run concurrently, each a subagent in the foreground with the prompt below, its placeholders filled in from the index and `$PROJECT_ROOT`, `$OUT`, `$LANGUAGE` and `$ROLE` written as their values. Wait for every lane of the message to return before you send the next; never in the background: a run without a terminal stops waiting for background subagents.
3. As each lane returns, check it:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-prd/prd.mjs" check-lane "$OUT" <id> --project "$PROJECT_ROOT"
   ```
   - Exit 0: the lane is checked. The command wrote each finding's `line` into its file.
   - It prints `lane-wrote-nothing` (a file is missing): when the lane's `attempts` is 1, re-dispatch it once (mark the dispatch first, as in step 2). When it is 2, record the failure:
     ```bash
     node "$PLUGIN_ROOT/skills/excavator-prd/prd.mjs" mark "$OUT" <id> failed lane lane-wrote-nothing --project "$PROJECT_ROOT"
     ```
   - Any other line: the lane failed its checks. Record the failure with each printed line as one quoted reason, and leave the files for the user to see:
     ```bash
     node "$PLUGIN_ROOT/skills/excavator-prd/prd.mjs" mark "$OUT" <id> failed check-lane "<line 1>" "<line 2>" --project "$PROJECT_ROOT"
     ```
   - Exit 2: the command could not run. Show its message and stop.

   Then tell the user `Lane <id> <n>/<N>: <status>`, where `<n>` counts the lanes this run has checked, `<N>` is the number listed in step 1 and `<status>` is `checked` or `failed`, in `$LANGUAGE`. Statuses and attempts change only through these commands: never edit `index.json` yourself.

The lane prompt:

````text
You write one chapter of an As-Is PRD (product requirements document) for the project at $PROJECT_ROOT, and the findings of that chapter. Your feature: <id> "<name>" (<kind>), chapter <chapter>.

Your scope. Read only these files: <seedFiles, one per line>. The one exception is the whole-project search that **Prove the statements that tend to be wrong** asks for. Its entrypoints: <entrypoints, one per line: id, kind, file:line, text>. The other features of this PRD, which other lanes write: <id and name of every other feature, one per line>. Describe the hand-over to another feature in one sentence, not its flow. Read code only; never run, build or change anything in the project.

Write in `$LANGUAGE`, in product language for `$ROLE`.

**As-Is only.** Describe behavior that exists in the code. Every claim must be traceable to real source; never invent fields, states, rules, or numbers. Where the code does not settle something, say so out loud (e.g. "not evident in the code" / "to be confirmed").

**Every flow in your scope.** Cover every entrypoint listed above and every behavior its code reaches within your feature — notifications, scheduled work, permissions, external calls. Omitting one silently is a defect, not an editorial choice.

**No code in the body.** The chapter describes behavior, not implementation. Do not paste code, function/route signatures, SQL, or config literals into the prose. Name an identifier only when it is genuinely user-facing (a status label, an on-screen field); otherwise describe it in business terms. Anything code-level (snippets, `file:line`) belongs only in the fold-away `<details>` blocks described below.

**Translate codes — never print raw values.** Numeric enum/status codes, boolean flags, and database field values are meaningless to the reader. Always render them as their human meaning: a numeric status code becomes its status label, a boolean flag becomes the condition it represents, a type code becomes the type it names — never a raw `status=2` / `field=true` / `type=1` in the prose. Resolve every code by reading the enum/constant definition in source (do not guess the mapping). When the code-to-meaning mapping itself is worth recording, put it in a **field-dictionary table** (columns: value | meaning), never inline in prose. A bare code, flag, or `field=value` left in the running text is a defect.

**Preserve source-owned names; translate only the generic prose.** When `$LANGUAGE` differs from the source's language, keep product/feature names, module names, and UI-visible labels — menu items, page/tab titles, button text, field labels, status names — in their original source form, exactly as they appear in the code/UI, and translate only the generic connective and descriptive words around them. The reader must be able to map every term back to what they see in the product, so never translate a name into a target-language equivalent. Use that source name in **every** mention of the entity — running prose, section headings, tables, and mermaid diagram labels alike — and never coin a translated synonym for it, even when referring to it as a common noun. When unsure whether a term is source-owned, check how it appears in the source/UI and keep that exact form.

**Terminology.** The PRD's glossary (source term | meaning): <glossary, one per line>. Reuse each listed term verbatim everywhere — prose, headings, tables, diagram labels — never a translation of it. Before you finish, list the words your chapter uses for the feature's entities and labels, and replace any translated variant with the source term.

**Describe each flow end-to-end, across tiers.** A flow is one story from the user's action to the final effect — not a frontend part and a separate backend part. For each flow, as one continuous description, cover:
- **Frontend** — the page/entry and its real route, form fields and their **validation rules**, UI states, and what the user sees at each step.
- **Backend** — the validation and processing the request goes through, what data is created/changed, transaction boundaries, and downstream effects (notifications, jobs).
- **The seam** — which user action invokes which backend capability (the request the frontend sends and the route the backend serves).

For each flow also give: purpose (what problem it solves, for whom), roles involved, trigger, the step sequence, business rules, and edge cases as *user-visible outcomes* (not error codes).

Depth requirements (these are where thin PRDs fail):
- **Every displayed/computed number** — give the calculation method, its inputs, and what is included/excluded.
- **Every configurable item** — state what configuring it *does*, who it affects, and where it takes effect — not only how to configure it.
- **Every notification/message** — trigger, recipient, and content/composition.
- **Permissions** — a role-by-capability table for the feature.
- **Automated behavior** — scheduled/background work described with the same weight as user actions.

**Prove the statements that tend to be wrong.** Five kinds of statement are where model-written PRDs go wrong while every cited name is real: **negative** claims ("sends no event", "never used", "posts no accounting entry"), **reachability / order** ("this rule is unreachable", "checked before"), **trigger mechanism** ("recalculated via an event", "done by the nightly job"), **absolute / invariance** claims ("always", "regardless of the setting"), and **open items** (to be confirmed). Before writing one of the first four, search the **whole project** — every module, event listeners and their registrations, scheduler/batch registrations, SQL and migration scripts, configuration — and keep the searched scope with the evidence. If you cannot settle it, write it as to be confirmed and state what you searched. If you delegate research to subagents, pass this rule to them verbatim.

Readability is a requirement, not a nicety: **tables** for fields, rules, permission matrices and edge cases; **lists** for step sequences.

**Mermaid is required, not optional.** Give the feature a `flowchart`, and every cross-tier end-to-end flow a `sequenceDiagram` (frontend, backend, notification/job). Keep each diagram to one clear idea. A chapter with no diagram fails its check.

**Evidence stays foldable.** Keep the body clean and code-free; put `file:line` traceability inside a collapsible block, with paths from the project root and line numbers that exist, typically one block per flow:
```markdown
<details><summary>Evidence</summary>

- Frontend form rules — `path/to/Form.tsx:95-140`
- Backend handler — `path/to/handler.go:200-260`

</details>
```

**Findings.** While you read, note the defects the code shows today, in two classes:
- `product` — user-visible behavior defects: behavior that is inconsistent (two paths treat the same case differently), missing (a case the flow does not handle) or asymmetric (an action without its counterpart, a check on one tier only).
- `technical` — code-level problems: dead or unreachable code, duplicated logic that has diverged, errors swallowed, values hard-coded where the rest of the code reads them from configuration.

State each defect as it is. Do not write how to fix it: a statement with "should", "recommend", "suggest", "refactor", "ought to", "better to", "it would be better", or the same words in `$LANGUAGE`, is refused. Give no severity and no confidence. Each finding has this shape: `{"findings": [{"id": "<id>-1", "class": "product", "statement": "<the defect as it is>", "flows": ["<id>"], "evidence": [{"file": "<path from the project root>", "passage": "<text copied from the file>"}]}]}`. Number the ids `<id>-1`, `<id>-2`, …; `flows` holds `<id>` and any other feature id the defect involves. Copy each passage verbatim from the file — part of a line or whole lines — long enough that it occurs exactly once in that file; a script checks this and refuses a passage it cannot find once. With no finding, write `{"findings": []}`.

Write only these two files, and nothing else anywhere:
1. `$OUT/features/<id>.md` — this front-matter, then the chapter, starting with `## <name>` and using `###` and deeper inside it:
   ```markdown
   ---
   id: <id>
   name: <name>
   kind: <kind>
   roles: [<each role the chapter names>]
   triggers:
     - <each trigger, one per line>
   chapter: <chapter>
   ---
   ```
2. `$OUT/findings/<id>.json` — the findings, in the shape above.

Reply with one line: `<id>: <D> diagrams, <F> findings`, and nothing else.
````

---

## Phase 3 — Verify and aggregate

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

1. Bring the statuses up to date and list the chapters to verify:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-prd/prd.mjs" aggregate "$OUT" --project "$PROJECT_ROOT"
   jq -r '.features | sort_by(.chapter)[] | select(.status == "checked") | [.id, .name] | @tsv' "$OUT/index.json"
   ```
2. Verify each listed chapter yourself, one at a time, not in a lane (a lane cannot reliably dispatch the subagents the verification needs, and the verification needs a clean context): take `$OUT/features/<id>.md` and follow the procedure in `$PLUGIN_ROOT/skills/excavator-verify/SKILL.md` on it with `--fix`, `--language` set to `$LANGUAGE` and `PROJECT_ROOT` as the project path, and `--report` set to `$OUT/verification/<id>.md`. It checks the five statement classes and the consistency of the chapter, and corrects the chapter in place.
3. Then run the reply command of its Phase 6 and store the lines it prints verbatim in `$OUT/verification/<id>.txt` (`printf '%s\n' … > "$OUT/verification/<id>.txt"`), even though Phase 6 of `excavator-verify` says to skip its reply when another skill follows its procedure: `aggregate` reads the counts from those lines by their position, in any language, and fails the feature when they are not there or `verification/<id>.md` is missing. Do not show these lines to the user; tell them `Verify <id> <n>/<N>: done` in `$LANGUAGE`.
4. Write `$OUT/overview.md` in `$LANGUAGE`: a title (`# <project or product name>`), then a short **Doc Info** block (version, date, project/domain, source revision, audience, and **scope size**) — localized to `$LANGUAGE` — a product summary, the roles, an overview of the automated behavior, and the glossary as a list (`term — meaning`). Put no table in `overview.md`: the tables are made by `aggregate` and inserted by `assemble`. Scope size is counted by command, never estimated: run the following (`SCOPE` is the `--scope` path, or `.` for the whole project) and copy the two numbers into Doc Info as "N files, M lines":
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
5. Aggregate the lanes and assemble the PRD:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-prd/prd.mjs" aggregate "$OUT" --project "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-prd/prd.mjs" assemble "$OUT" --project "$PROJECT_ROOT"
   ```
   `aggregate` recomputes every status from the files, writes `findings.json` and `tables/*.md`, and prints the reply's fields as JSON: keep them for Phase 4. It exits 1 when a candidate or a status is not conserved, with each problem on a line: show the lines and stop. `assemble` writes `$OUT/PRD.md` — the overview, the roles table, the written chapters in chapter order, then an appendix with the coverage table, the verification table and the failed features with their reasons — and prints its path. It exits 1 when a file it needs is missing: write it and run it again.

---

## Phase 4 — Self-check and reply

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

1. **Self-check.** Read `$OUT/PRD.md` across the chapters, which separate lanes wrote:
   - **Enum check.** Grep it for raw code values left in prose — any `field=value` pattern (numbers, booleans such as `field=true` / `field=false`, and status/type codes) plus other untranslated flags. Any outside a field-dictionary table or `<details>` block is translated to its human meaning in the feature's chapter.
   - **Terminology check.** List the distinct words the chapters use for each glossary term. Any target-language translation or synonym is replaced with the source term in the feature's chapter (prose, headings, tables, diagram labels).

   When you changed a chapter, run `check-lane` for it, then `aggregate` and `assemble` again, and use the fields the last `aggregate` printed.
2. **Save and reply.** The PRD stays in `$OUT`: write it into the project only when the user says so, to `docs/PRD.md` (a scoped PRD: `docs/PRD-<scope>.md`) or a path the user gives. In the command, `<uncovered>` is the list exactly as `aggregate` printed it, brackets and quotes included, on one line; `jq` joins it.

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

Then print the reply's lines with this command, putting in the fields `aggregate` printed and the default path:

```bash
# the reply: where the PRD is, the counts aggregate printed and the offer to save it
printf '%s\n' \
  "<prdPath>" \
  "<features.written>/<features.total> features written, <features.failed> failed" \
  "<diagrams> diagrams" \
  "<findings.product> product, <findings.technical> technical findings, anchors checked" \
  "Statements: <verification.verified> verified, <verification.contradicted> contradicted, <verification.misattributed> misattributed, <verification.unverifiable> unverifiable; open items: <verification.resolvedRight> resolved right, <verification.resolvedWrong> resolved wrong, <verification.stillOpen> still open; cross-section conflicts: <verification.conflicts>, not checked: <verification.notChecked>" \
  "No entrypoint patterns for: $(printf '%s' '<uncovered>' | jq -r 'join(", ")')" \
  "To save it in the project, say so: it goes to <default path> unless you give another path. Commit it to share it with the team."
```

Reply with exactly the lines it prints and nothing else. Its first line, the PRD's path, is the reply's first line and the offer to save its last: write nothing before, between or after them, no word on the checks, the PRD or what was done, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply. In a language other than English, write the command's words translated; the path, the numbers and the framework names stay as they are. Leave the line of frameworks without patterns out when `uncovered` is empty, and the last line out when `--out` was given.
