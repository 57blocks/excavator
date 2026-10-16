---
name: excavator-unused-code
description: Find the methods and functions nothing in a project uses. A deterministic script lists every function no route reaches and the facts about each; you decide which of them are program entries (framework callbacks, jobs, listeners, main, tests, published API); the script then reports the rest as unused, grouped by what references what, each with a confidence computed from fixed rules. Never edits code.
argument-hint: "[project-path]"
---

# /excavator-unused-code

Report the code in a project that nothing uses, with a confidence the user can act on.

**Unused** means: a method, function or constructor that no entry of the program reaches along references (`calls`, `routes`, and `implements` / `overrides` in both directions). A node nothing references is `unreferenced`; a node referenced only by unused code is `only-reachable-from-unused`. A node reached only from tests is `test-only`, not unused. Unreachable statements inside a method are out of scope.

The work is split three ways, and each part stays with its owner:

| Who | What |
|---|---|
| `unused-code.mjs candidates` | Every function node no route reaches, with its facts. Claims about absence need the whole index, so a script does it. |
| You | Which candidates are entries: what calls them from outside the repository's own call graph. |
| `unused-code.mjs report` | Applies your decisions, computes reasons, groups and confidence by fixed rules, writes `.excavator/unused-code.json`. |

## Options

`$ARGUMENTS` may contain the project path (default: the current working directory).

---

## Step 1 — Check the facts

1. Resolve `PROJECT_ROOT`, `PLUGIN_ROOT` and the script:
   ```bash
   PROJECT_ROOT="$(pwd)"   # or the path argument
   SKILL_REAL=$(realpath ~/.agents/skills/excavator-unused-code 2>/dev/null || readlink -f ~/.agents/skills/excavator-unused-code 2>/dev/null || echo "")
   SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
   PLUGIN_ROOT=""
   for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do
     if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then PLUGIN_ROOT="$candidate"; break; fi
   done
   UC="$PLUGIN_ROOT/skills/excavator/unused-code.mjs"
   DATA="$PROJECT_ROOT/.excavator"
   CANDS="$DATA/unused-candidates.json"
   ```
2. Check freshness:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator/consumer-freshness.mjs" "$PROJECT_ROOT"
   ```
   `fresh` → continue. `stale` or `missing` → run `/excavator` on the project (the default Lazy mode is enough), then start this step again. The candidates are only as current as the facts; do not continue on stale facts.

## Step 2 — List the candidates

```bash
node "$UC" candidates "$PROJECT_ROOT"
```

It writes `$CANDS` and prints the counts. Read the counts and the census header; never read `$CANDS` whole (it is tens of megabytes on a large project). Query it with `jq` only:

```bash
jq '{counts, census}' "$CANDS"
```

Each candidate has `id`, `name`, `language`, `file`, `lineRange`, `owner` (a key of `.types`), `visibility`, `modifiers`, `annotations`, `entry` (nothing outside its own strongly connected component references it), `component`, `referrers` and `census` (occurrences of its name in the selected files that the facts do not explain). `null` means unknown, `[]` means known and empty. `.types[<owner>]` has the owner's `annotations`, `outsideSupertypes` (`own`, `ancestors`, `descendants`: supertypes the repository does not declare), `referencedBy` and `annotationClassLiterals`.

## Step 3 — Decide the entries

An **entry** is code something outside the repository's call graph invokes: a framework or container callback (lifecycle, event, message or HTTP handler), a scheduled job, `main` or another launcher, a serialization or reflection convention, a plugin or service-loader hook, the published API of a library. A **test entry** is what a test runner invokes: test methods and their lifecycle hooks.

1. Read the addenda of the detected frameworks. They are written for graph analysis: they name the framework's annotations, descriptors and component roles, and some say outright that the container calls a method; most do not list every entry mechanism:
   ```bash
   head -1 "$DATA/knowledge-graph.jsonl" | jq -r '.fields.project.frameworks[]?'
   ```
   For each id, read `$PLUGIN_ROOT/skills/excavator/frameworks/<id>.md` if it exists. A missing addendum means nobody wrote that framework down; it is not a licence to reconstruct its conventions from memory. What you know about a framework only tells you where to look: a mechanism counts once you have found it in this repository — the annotation on each member the query selects, the descriptor line that registers the class (`web.xml`, a service-loader file under `META-INF/services`), the configuration that names it.
2. Group the entry candidates by their features. Start with the largest groups:
   ```bash
   # by method annotation
   jq -r '[.candidates[] | select(.entry) | (.annotations // [])[]] | group_by(.) | map([length, .[0]]) | sort_by(-.[0]) | .[:30][] | @tsv' "$CANDS"
   # by owner annotation
   jq -r '. as $p | [.candidates[] | select(.entry and .owner != null) | ($p.types[.owner].annotations // [])[]] | group_by(.) | map([length, .[0]]) | sort_by(-.[0]) | .[:30][] | @tsv' "$CANDS"
   # by supertype the repository does not declare (own or inherited)
   jq -r '. as $p | [.candidates[] | select(.entry and .owner != null) | ($p.types[.owner].outsideSupertypes | (.own // []) + .ancestors)[]] | group_by(.) | map([length, .[0]]) | sort_by(-.[0]) | .[:30][] | @tsv' "$CANDS"
   # by name
   jq -r '[.candidates[] | select(.entry) | .name] | group_by(.) | map([length, .[0]]) | sort_by(-.[0]) | .[:30][] | @tsv' "$CANDS"
   # by language and directory
   jq -r '[.candidates[] | select(.entry) | "\(.language) \(.file | split("/")[:-1] | join("/"))"] | group_by(.) | map([length, .[0]]) | sort_by(-.[0]) | .[:30][] | @tsv' "$CANDS"
   ```
   To look at a group, list a few members with their location and read those lines of source:
   ```bash
   jq -r '<query> | "\(.file):\(.lineRange[0])-\(.lineRange[1])\t\(.id)"' "$CANDS" | head -5
   ```
   A `<query>` is a `jq` expression over the whole candidates product that outputs candidate objects, for example `. as $p | .candidates[] | select(.entry and any(.annotations[]?; . == "Scheduled"))`. Its `select` may use any field above and the `.types` table through `$p`. A pipe binds loosest, so parenthesize it inside a condition: `(.file | test("/src/test/")) and ...`. Put a longer exploratory program in a file under `$DATA` and run it with `jq -f`.
3. Decide group by group. Rules for this step:
   - **Decide an entry only when you can name its caller and the mechanism** — "the scheduler runs methods annotated `@Scheduled`", "JUnit runs `@Test` methods", "the JVM calls `main`". Read at least three members of the group first and check the mechanism applies to each kind of member the query selects.
   - **When unsure, do not decide.** A decision can only remove candidates. An undecided candidate stays in the report with a confidence the rules compute: a non-private or annotated method can reach at most `medium`, which already means "needs confirmation". Leaving it costs nothing; a wrong entry hides unused code.
   - **The same annotation can mean different things.** An HTTP method annotation on a server resource class is an entry; the same annotation on a declarative HTTP interface the code itself calls is not. Narrow the query (owner annotation, owner kind, path) until it selects one meaning.
   - **A handler the facts did not link is still an entry.** A route, message or event handler whose route or binding the fact build could not resolve (a path written as a constant, a resource registered by configuration) has no `routes` edge and stays a candidate: decide it by its annotations.
   - **An override of an outside type is called by that type's caller.** An `@Override` (or the language's equivalent) in a type whose `outsideSupertypes` are non-empty may implement a method declared outside the repository (`toString`, `run`, a framework interface); decide such a group once you have checked the overridden methods come from those outside types.
   - **Public is not an entry by itself.** Only a module whose purpose is to be consumed by other projects — an SDK, a library other projects link against, a plugin or extension API — makes its public members entries; decide them by module, with the evidence (the manifest that publishes it and what says it is for outside consumers) in the reason. A build that publishes every module of an application as an artifact does not make each module an API: leave those undecided.
   - **Tests:** mark what the runner invokes (test annotations, the runner's naming convention) as `test-entry`. Do not mark a whole test directory: a helper there that no test reaches is unused too.
   - **Test code is a `test-entry`, whatever calls it.** A method in test sources stays `test-entry` even when a production mechanism invokes it: a test fake implementing a production interface, an extension the test runner loads. As `entry`, it would make the production code it reaches count as used in production.
   - **Members follow their entries.** A candidate with `entry: false` is removed automatically when a decided node reaches it. Decide one individually only with a concrete outside caller (a reflective string, a descriptor line) that you have read.

## Step 4 — Write the decisions

Write every decision through one script, so the decisions are reproducible and a fix is an edit and a re-run. Create `$DATA/unused-decisions.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
DATA="$1/.excavator"; CANDS="$DATA/unused-candidates.json"; DRAFT="$DATA/unused-decisions.draft.jsonl"
: > "$DRAFT"
decide() {  # decide <entry|test-entry> <reason> <query>
  line=$(jq -c --arg kind "$1" --arg reason "$2" --arg query "$3" \
    "{kind: \$kind, reason: \$reason, query: \$query, ids: ([ $3 | .id ] | unique)}" "$CANDS")
  hits=$(printf '%s' "$line" | jq '.ids | length')
  [ "$hits" -gt 0 ] || { echo "decide: no candidate matches: $3" >&2; exit 1; }
  overlap=$(printf '%s\n' "$line" | jq --slurpfile done "$DRAFT" '([$done[].ids[]] | map({(.): true}) | add // {}) as $seen | [.ids[] | select($seen[.])] | length')
  [ "$overlap" -eq 0 ] || { echo "decide: $overlap ids already decided by an earlier decision: $3" >&2; exit 1; }
  printf '%s\n' "$line" >> "$DRAFT"; echo "decide: $1 $hits"
}

decide test-entry 'JUnit runs methods annotated @Test' \
  '.candidates[] | select(.entry and any(.annotations[]?; . == "Test"))'
# ... one decide call per group

jq -s --arg digest "$(jq -r .factsDigest "$CANDS")" '{factsDigest: $digest, decisions: .}' "$DRAFT" > "$DATA/unused-decisions.json"
```

Run it with `bash "$DATA/unused-decisions.sh" "$PROJECT_ROOT"`. Rules for this step:

- **Never type, paste or edit an id.** The `ids` of a decision are exactly what its `query` selects; that is how the product can be checked and the decision re-run on new facts. To change which ids a decision covers, change its query.
- Write each query in single quotes, so the shell does not expand `$p`.
- `reason` names the caller and the mechanism you established in Step 3, in one sentence.
- When `decide` reports an overlap, narrow the later query so the two decisions select disjoint sets (for example add `and (any(.annotations[]?; . == "Test") | not)`). Each id belongs to one decision.

## Step 5 — Run the report

```bash
node "$UC" report "$PROJECT_ROOT"
```

It refuses decisions made on another candidate set, ids that are not candidates and ids decided twice, and writes nothing then. Fix the decision script and run it again; if it says the candidate set is stale, go back to Step 2 and re-run the decision script (the queries carry over).

The product `$DATA/unused-code.json` has `counts`, `decisions` (each with `hits`), `unused` (each with `reason`, `referrers`, `group`, `confidence`, `signals`), `groups` (each with `entries` and `members`), `testOnly` and `residualAssumptions`. Query it with `jq`; do not read it whole. In `counts`, `removedByDecision` is the `entry` ids and everything they reach; `testOnly` is the `test-entry` ids and everything only they reach, so it includes the test methods themselves.

How confidence is computed (fixed rules; you never assign it):
- `low` — a sign of use: the name occurs elsewhere (`name-elsewhere`), the owner is referenced by views, descriptors or injection (`owner-referenced`) or named as an annotation class literal (`owner-class-literal`), or a non-private, non-static method's owner touches a supertype the repository does not declare (`visible-with-outside-supertype`).
- `high` — no sign of use, `private`, no annotation on the method or its owner, the owner and its ancestors declare no outside supertype, and every one of these facts is known.
- `medium` — the rest: its name occurs nowhere else in the selected files, but it is visible outside its file, annotated, or its owner inherits an outside type, so a caller outside the repository or a framework may exist. The signals say which. A use that does not spell the name (a property `foo` bound to `getFoo`) is not seen.
- A node is never above any unused node that references it (`capped`).

## Step 6 — Report to the user

Gather the sections with `jq` over `$DATA/unused-code.json`:

```bash
jq '.counts' "$DATA/unused-code.json"
# high, by group: entries first, then members
jq -r '[.unused[] | select(.confidence == "high")] | group_by(.group) | sort_by(-length) | .[:30][] | "group \(.[0].group): " + (map("\(.name) \(.file):\(.lineRange[0]) [\(.reason)]") | join("; "))' "$DATA/unused-code.json"
# medium, by directory and owner
jq -r '[.unused[] | select(.confidence == "medium") | "\(.file | split("/")[:-1] | join("/")) \(.owner // "-" | split(":") | last)"] | group_by(.) | map([length, .[0]]) | sort_by(-.[0]) | .[:30][] | @tsv' "$DATA/unused-code.json"
# low, by the signals that make a node low
jq -r '[.unused[] | select(.confidence == "low") | .signals[].signal | select(IN("name-elsewhere", "owner-referenced", "owner-class-literal", "visible-with-outside-supertype", "capped"))] | group_by(.) | map([length, .[0]]) | sort_by(-.[0])[] | @tsv' "$DATA/unused-code.json"
```

Report, in this order:
1. Counts: candidates, removed by decision, `test-only`, unused by confidence, groups; per language when one language has most of the candidates. **A language whose `calls` is 0 has no call facts:** every function in it is a candidate whatever calls it, so say its results show only that the facts hold no calls for it.
2. `high`, by group: the group's entries first (removing them is what makes the members unused), each with `file:line`.
3. `medium`, by directory and class, with the signals that put them there.
4. `low`: counts by signal only, unless the user asks for the list.
5. `test-only`: the count and the files with the most.
6. Your decisions: kind, reason and hits of each.
7. The residual assumptions, as the product states them.

Rules for this step:
- **Never call a `medium` or `low` candidate unused.** Say "its name occurs nowhere else; needs confirmation" for `medium`, and "signs of use found" with the signal for `low`. Only `high` may be called unused, and even then deleting it is the user's decision.
- **Never edit, move or delete project files.** This skill reports; it does not clean up, refactor or open a change.
- Every listed item carries `file:line` from the product. Do not add items the product does not list.
- Point the user at `/excavator-chat` for questions about one method, file or group; it answers from the same product.
