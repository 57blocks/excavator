---
name: excavator-relations
description: Find how a project's runtime units talk to each other - HTTP calls from a frontend to a backend, service-to-service HTTP and RPC, messages through queues and topics, realtime socket events, and calls to external systems - and save them as a queryable relations graph. Scripts decide the units and the files to read; one subagent per area writes each call site and receiving site with a quote of its code; a script checks every quote, pairs the two sides by address, and gives every site and file a visible bucket. Gives no advice.
argument-hint: "[--reunit] [--max-lines <n>] [--no-graph] [--language <lang>]"
---

# /excavator-relations

Finds where a project's runtime units (a browser app, an API server, a worker, a service) send requests, messages or events to each other or to external systems, and where they receive them, and writes `.excavator/relations-graph.json`.

## How It Works

- A script decides the project's **units** once, by fixed rules: every directory with a manifest (`package.json`, `go.mod`, `pom.xml`, `build.gradle`, `pyproject.toml`, `*.csproj`, ...) is a unit, `runtime` when it shows an entry (a `main`, a start script, a route the knowledge graph found), `container` when it only declares sub-projects, `library` otherwise. The units are stored in `.excavator/relations-units.json` and reused while their input is unchanged; `--reunit` decides them again.
- A second script chooses the **candidate files** of every unit (a line that imports an HTTP, RPC, message, socket or external-service client, registers a route or calls a path; a file that imports a client wrapper; a file with a route of the knowledge graph), gives every other source file a visible status, and packs the candidates into **areas** within one unit and a line budget, each with the unit's address configuration. It also lists every **call line** of each candidate: a line where a fixed, language-generic pattern finds a call or a registration written (a request with a path argument, also when the argument starts on the next line or the method takes type arguments; a request object with a `url`; a route; a subscription; an emitted event). The list is a floor for the analyzer, never a relation by itself.
- One relations-analyzer runs per area and writes each **end** it finds: the caller (the line that sends) or the receiver (the line that registers the handler), with its file, line, a verbatim quote, the address it names and the lines that prove the address. It writes only the ends in its own files; the other side is found by another analyzer or not at all.
- A merge script checks every end against the source (a quote not on its line, an address word not in the cited lines, a file outside the area: rejected, with the reason), pairs callers with receivers on other units by normalized address, and puts every end in one bucket: `linked`, `ambiguous`, `caller-only`, `receiver-only`, `address-unresolved` or `quote-failed`; each analyzer runs the same check over its own output before it finishes (`check-relations-area.mjs`); every candidate file is `cited`, `declared-skip`, `ends-rejected` or `silent-zero`; every call line is `ended`, `evidence`, `ends-rejected`, `declared-skip` (skipped by the analyzer with a reason), `file-skipped`, `unaccounted` or `area-missing`; the counts must add up. An external system's id never comes from the analyzer's free-form name: it is the organization of a host a cited line holds (`api.vendor.com` -> `vendor`), else the name looked up in a fixed table of services (`external-services.json`); a library or protocol name with no host (`axios`, `nodemailer`, `ldap`) is `address-unresolved`, and any other name is its own id, counted as `name` on the `external keys` line. It also measures, per kind, how often quotes fail, how many addresses stay unresolved and, against the previous run on the same input, how much the linked pairs agree, and splits the keys the two runs do not share into `key-mismatch` (one site keyed two ways), `previous-only` and `current-only` (a site one run alone linked).
- Later kinds (shared database tables, shared caches and files, authentication trust, scheduled triggers, deployment wiring) are only counted as `out-of-scope`.

## Instructions

`$ARGUMENTS` may hold `--reunit` (decide the units again), `--max-lines <n>` (the line budget of an area, default 4000), `--no-graph` (leave the knowledge graph out even if one exists) and `--language <lang>`: the language of everything said to the user during the run; English when it is not given.

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

### Phase 0: Resolve the roots

Set `PROJECT_ROOT` to the current working directory and `DATA_DIR="$PROJECT_ROOT/.excavator"`. Each command block may run in a fresh shell: write the resolved values into every later block.

Resolve the plugin root. Do **not** assume it is two directories above the skill path string: `~/.agents/skills/excavator-relations` may be a symlink into the real checkout.

```bash
SKILL_REAL=$(realpath ~/.agents/skills/excavator-relations 2>/dev/null || readlink -f ~/.agents/skills/excavator-relations 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
PLUGIN_ROOT=""
for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do
  if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then
    PLUGIN_ROOT="$candidate"
    break
  fi
done
if [ -z "$PLUGIN_ROOT" ]; then
  echo "Error: Cannot find the excavator plugin root."
  exit 1
fi
echo "PLUGIN_ROOT=$PLUGIN_ROOT"
```

Use the printed path as `$PLUGIN_ROOT` in every later block.

### Phase 1: Knowledge graph

If `$DATA_DIR/knowledge-graph.jsonl` exists and `--no-graph` was not passed, check its freshness with the shared helper:

```bash
node "$PLUGIN_ROOT/skills/excavator/consumer-freshness.mjs" "$PROJECT_ROOT"
```

It prints `{ status, ... }`. `stale`: tell the user the graph's node ids and routes may miss recent changes, suggest `/excavator` to refresh it, and continue. `missing` or `fresh`: continue. In Phases 2 and 3 pass `--graph "$DATA_DIR/knowledge-graph.jsonl"`; the graph adds route entry points and node ids. Without a graph (or with `--no-graph`) leave the flag out: the run works, with no node ids.

### Phase 2: Units

```bash
node "$PLUGIN_ROOT/skills/excavator-relations/plan-units.mjs" "$PROJECT_ROOT" --graph "$DATA_DIR/knowledge-graph.jsonl"
```

Leave out `--graph ...` as Phase 1 says; add `--reunit` only when the user passed it. The first line is `units=<reused|new|changed> ... units=<n> runtime=<n> library=<n> container=<n> unmanifested=<n>`, then one line per unit with its first evidence, then one line per change. Tell the user the counts and, when it is not `reused`, the changes.

### Phase 3: Areas

```bash
node "$PLUGIN_ROOT/skills/excavator-relations/split-relation-areas.mjs" "$PROJECT_ROOT" --graph "$DATA_DIR/knowledge-graph.jsonl"
```

Leave out `--graph ...` as Phase 1 says; add `--max-lines <n>` only when the user passed it. It deletes the previous `$DATA_DIR/intermediate/relations-areas`, writes one context file per area and a manifest, and prints one line per area:

```
area-001 unit=unit:web files=12 lines=3810 context=<context file> output=<output file>
```

then a summary line (`areas=... candidates=... not-candidate=... container-skipped=... test-excluded=...`). Keep the area lines; Phase 4 dispatches from them. Tell the user how many areas there are: that is how many analyzers will run. If there are 0 areas, tell the user no candidate file was found, and stop.

### Phase 4: Analyze

1. Read the analyzer prompt from `$PLUGIN_ROOT/agents/excavator-relations-analyzer.md`.
2. Dispatch **one subagent per area** with that prompt. Give each one only: the project root, the path of its area's context file and the path of its output file, both from its Phase 3 line. Do not paste the context into the prompt and do not give it another area's files. Require every model-owned field in English, with paths, quotes and addresses exactly as in the code. Run the subagents in the foreground, up to 8 in one message, and send the next ones when those have returned.
3. When every area has returned, merge:

   ```bash
   node "$PLUGIN_ROOT/skills/excavator-relations/merge-relations.mjs" "$PROJECT_ROOT"
   ```

   It writes `$DATA_DIR/relations-graph.json` and `$DATA_DIR/reports/relations-coverage.json` and prints one line per area, then the summary lines from `callers` to `coverage report:`.

   - Exit 4: the buckets do not add up to the ends the analyzers wrote, or the call lines the merge read do not match the count the split wrote in the manifest. Report the `conservation FAILED` line and stderr, and **STOP**; no relations graph was written.
   - Exit 3: some areas are `missing`, `rejected-stale` (the output does not carry this run's token) or `rejected-parse` (not JSON). Dispatch a fresh subagent once for each of those areas, exactly as in step 2, then merge again. If it exits 3 again, continue with what was accepted and tell the user which areas are missing.
   - Never write, copy or edit an area's output, the relations graph or the coverage report yourself.

### Phase 5: Report

Your final reply is the merge's summary lines, from the `callers` line to the `coverage report:` line, copied unchanged in a code block, preceded by one sentence in `$LANGUAGE` naming `$DATA_DIR/relations-graph.json`, and followed by one sentence in `$LANGUAGE` for each of these that is above 0: the `quote-failed` ends (rejected, never paired), the `ends-rejected` files (candidates whose every end was rejected), the `silent-zero` files (candidates no analyzer cited or declared), the `unaccounted` call lines (call lines no analyzer wrote, cited or skipped), the missing areas. A `kind` line with `escalation=` names a kind whose measurement is below its threshold. Do not call the coverage complete while any of them is above 0, and add no advice.

After an exit 0 merge, delete `$DATA_DIR/intermediate/relations-areas`. Keep `$DATA_DIR/relations-units.json`: the next run reuses it, and keep `relations-graph.json`: the next run on the same input compares with it.

## Terminal queries

Before answering any question from `relations-graph.json`, check that it still describes the project:

```bash
node "$PLUGIN_ROOT/skills/excavator-relations/relations-freshness.mjs" "$PROJECT_ROOT"
```

It prints `{ usable, status, reason }`. `usable: false` means the graph MUST NOT be used in an answer: say so and suggest running `/excavator-relations` again. When it is usable, read it with `jq`; every relation carries the file, line and quote of each end, so cite them:

```bash
G="$PROJECT_ROOT/.excavator/relations-graph.json"
# Linked relations between units, one per line
jq -r '.relations[] | select(.bucket=="linked") | "\(.kind) \(.caller.unit) -> \(.receiver.unit // .receiver.external) \(.addressKey)  \(.caller.file):\(.caller.line)"' "$G"
# Everything one unit calls
jq -r --arg u "unit:web" '.relations[] | select(.caller.unit==$u) | "\(.bucket) \(.kind) \(.addressKey // "-") \(.caller.file):\(.caller.line)"' "$G"
# Who receives one address
jq -r --arg a "POST /api/orders" '.relations[] | select(.addressKey==$a or .receiver.addressKey==$a) | "\(.bucket) \(.caller.file // "-"):\(.caller.line // "-") -> \(.receiver.file // .receiver.external // "-"):\(.receiver.line // "-")"' "$G"
# External systems and their callers
jq -r '.relations[] | select(.kind=="external" and .bucket=="linked") | "\(.receiver.external) \(.caller.file):\(.caller.line)"' "$G"
# External systems: what each id rests on, and the names and hosts the analyzers wrote
jq -r '.externals[] | "\(.id) by=\(.keyBy | join(",")) callers=\(.callers) names=\(.names | join(",")) hosts=\(.hosts | join(","))"' "$G"
# Call lines no analyzer wrote, cited or skipped
jq -r '.callLines.unaccounted[] | "\(.file):\(.line) \(.signal)"' "$G"
# Calls with no receiver found, and receivers no caller reaches
jq -r '.relations[] | select(.bucket=="caller-only" or .bucket=="receiver-only") | "\(.bucket) \(.kind) \(.addressKey) \((.caller // .receiver).file):\((.caller // .receiver).line)"' "$G"
# Bucket counts and per-kind measurements
jq '{buckets, measurements: (.measurements | map_values({ends, linked, quoteFailureRate, unresolvedShare, agreement: .agreement.jaccard, keyMismatch: .agreement.keyMismatch, previousOnly: .agreement.previousOnly, currentOnly: .agreement.currentOnly, escalation: .escalation.reasons}))}' "$G"
```

A relation is a claim about the code at the cited lines; re-read those lines before you rely on it. `ambiguous` callers list their candidate receivers; `quote-failed` ends carry the rejection reason and were never paired.
