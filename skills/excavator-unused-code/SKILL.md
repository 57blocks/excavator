---
name: excavator-unused-code
description: Find the methods and functions nothing in a project uses. A deterministic script lists every function no route reaches and the facts about each; you decide which of them are program entries (framework callbacks, jobs, listeners, main, tests, published API); the script then reports the rest as unused, grouped by what references what, each with a confidence computed from fixed rules. Never edits code.
argument-hint: "[project-path] [--language <lang>]"
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

`$ARGUMENTS` may contain the project path (default: the current working directory) and `--language <lang>`: the language of the report, the reasons of your decisions and everything said to the user during the run; English when it is not given.

---

## Step 1 — Check the facts

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

1. Resolve `PROJECT_ROOT`, `PLUGIN_ROOT` and the script:
   ```bash
   PROJECT_ROOT="$(pwd)"   # or the path argument
   LANGUAGE="English"   # or the --language value
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

Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.

```bash
node "$UC" candidates "$PROJECT_ROOT"
```

It writes `$CANDS` and prints the counts. Read the counts and the census header; never read `$CANDS` whole (it is tens of megabytes on a large project). Query it with `jq` only:

```bash
jq '{counts, census}' "$CANDS"
```

Each candidate has `id`, `name`, `language`, `file`, `lineRange`, `owner` (a key of `.types`), `visibility`, `modifiers`, `annotations`, `entry` (nothing outside its own strongly connected component references it), `component`, `referrers` and `census` (occurrences of its name in the selected files that the facts do not explain). `null` means unknown, `[]` means known and empty. `.types[<owner>]` has the owner's `annotations`, `outsideSupertypes` (`own`, `ancestors`, `descendants`: supertypes the repository does not declare), `referencedBy` and `annotationClassLiterals`.

## Step 3 — Decide the entries

Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.

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
3. Establish the two things the groups do not show:
   - **Test code.** Write `TEST_CODE`, a regular expression that matches the `file` of every candidate in test code and of no other: the test source directories (`src/test/`, a `tests` package, `_test.go`, `.spec.ts`) and the modules that only tests depend on — read in the build files which modules depend on a test-support module. A module the build publishes for other projects (an SDK, with the build or its README saying so) is not test code even when only tests use it inside the repository; the published-API rule in item 4 decides it. With no test code, use `'^$'`. Step 4's script makes it `test_code` and refuses an `entry` that selects test code and a `test-entry` that selects anything else.
   - **Launch methods.** A candidate named `main` that nothing in the facts calls is a program's launch: `main` in Java, Kotlin, C# or Go, or a script's `main` that its top-level code calls. List them, and check each one's launch (a build line, the top-level call). Step 4's script refuses to finish while one of them is undecided:
     ```bash
     jq -r '.candidates[] | select(.entry and .name == "main") | "\(.language)\t\(.file):\(.lineRange[0])"' "$CANDS"
     ```
   - **Launches from top-level code.** A name query finds `main`, not a function a script calls from its top-level code. List the script files whose functions nothing in the facts calls:
     ```bash
     jq -r '.counts.byLanguage as $l | [.candidates[] | select(.entry and $l[.language].calls > 0 and (.language | IN("python", "javascript", "typescript", "ruby", "php", "shell")))] | group_by(.file)[] | "\(.[0].file)\t\(map(.name) | unique | join(" "))"' "$CANDS"
     ```
     Add any other language whose files run top to bottom. Read each listed file's code outside its functions (an `if __name__ == "__main__":` block, module-level statements, shell statements outside any function) and decide the listed functions it calls, by `.file` and `.name`. A language whose `calls` is 0 is not listed: the facts hold no calls for it, so every function in it is a candidate whatever calls it, and Step 6 reports it that way.
4. Decide group by group. Rules for this step:
   - **Decide an entry only when you can name its caller and the mechanism** — "the scheduler runs methods annotated `@Scheduled`", "JUnit runs `@Test` methods", "the JVM calls `main`". Read at least three members of the group first and check the mechanism applies to each kind of member the query selects.
   - **When unsure, do not decide.** A decision can only remove candidates. An undecided candidate stays in the report with a confidence the rules compute: a non-private or annotated method can reach at most `medium`, which already means "needs confirmation". Leaving it costs nothing; a wrong entry hides unused code.
   - **The same annotation can mean different things.** An HTTP method annotation on a server resource class is an entry; the same annotation on a declarative HTTP interface the code itself calls is not. Narrow the query (owner annotation, owner kind, path) until it selects one meaning.
   - **A handler the facts did not link is still an entry.** A route, message or event handler whose route or binding the fact build could not resolve (a path written as a constant, a resource registered by configuration) has no `routes` edge and stays a candidate: decide it by its annotations.
   - **An override of an outside type is called by that type's caller.** An `@Override` (or the language's equivalent) in a type whose `outsideSupertypes` are non-empty may implement a method declared outside the repository (`toString`, `run`, a framework interface); decide such a group once you have checked the overridden methods come from those outside types.
   - **Public is not an entry by itself.** Only a module whose purpose is to be consumed by other projects — an SDK, a library other projects link against, a plugin or extension API — makes its public members entries; decide them by module, with the evidence (the manifest that publishes it and what says it is for outside consumers) in the reason. A build that publishes every module of an application as an artifact does not make each module an API: leave those undecided.
   - **Tests:** mark what the runner invokes (test annotations, the runner's naming convention) as `test-entry`. Do not mark a whole test directory: a helper there that no test reaches is unused too.
   - **Test code is a `test-entry`, whatever calls it.** A method in test code — what `TEST_CODE` matches: test source directories, and modules that only tests depend on — stays `test-entry` even when a production mechanism invokes it: a test fake implementing a production interface, an extension the test runner loads, an `equals` override. As `entry`, it would make the production code it reaches count as used in production. A mechanism that spans both is two decisions: the `entry` with `(test_code | not)`, the `test-entry` with `test_code`.
   - **A program's launch is an entry.** The language's launch method (`main` in Java, Kotlin, C# or Go) and a function that a script's top-level code calls (item 3) are called by whoever runs the program. Decide them in every run, with the build line or the top-level call in the reason when there is one. Whether anyone still runs a program is not in the repository; deciding it only withholds a report.
   - **Members follow their entries.** A candidate with `entry: false` is removed automatically when a decided node reaches it. Decide one individually only with a concrete outside caller (a reflective string, a descriptor line) that you have read.

## Step 4 — Write the decisions

Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.

Write every decision through one script, so the decisions are reproducible and a fix is an edit and a re-run. Create `$DATA/unused-decisions.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
DATA="$1/.excavator"; CANDS="$DATA/unused-candidates.json"; DRAFT="$DATA/unused-decisions.draft.jsonl"
TEST_CODE='(^|/)src/test/'  # from Step 3: matches the file of every candidate in test code, and of no other
: > "$DRAFT"
decide() {  # decide <entry|test-entry> <reason> <query>; the query may use test_code
  line=$(jq -c --arg kind "$1" --arg reason "$2" --arg query "$3" --arg tc "$TEST_CODE" \
    'def test_code: .file | test($tc); [ '"$3"' ] as $hit
     | {kind: $kind, reason: $reason, query: ("def test_code: .file | test(\($tc | tojson)); " + $query),
        ids: ([$hit[].id] | unique),
        misplaced: ([$hit[] | select(if $kind == "entry" then test_code else (test_code | not) end) | .id] | unique | length)}' "$CANDS")
  hits=$(printf '%s' "$line" | jq '.ids | length')
  [ "$hits" -gt 0 ] || { echo "decide: no candidate matches: $3" >&2; exit 1; }
  misplaced=$(printf '%s' "$line" | jq '.misplaced')
  [ "$misplaced" -eq 0 ] || { echo "decide: $misplaced ids on the wrong side of TEST_CODE (an entry selects no test code, a test-entry only test code): $3" >&2; exit 1; }
  overlap=$(printf '%s\n' "$line" | jq --slurpfile done "$DRAFT" '([$done[].ids[]] | map({(.): true}) | add // {}) as $seen | [.ids[] | select($seen[.])] | length')
  [ "$overlap" -eq 0 ] || { echo "decide: $overlap ids already decided by an earlier decision: $3" >&2; exit 1; }
  printf '%s\n' "$line" | jq -c 'del(.misplaced)' >> "$DRAFT"; echo "decide: $1 $hits"
}

decide test-entry 'JUnit runs methods annotated @Test' \
  '.candidates[] | select(.entry and any(.annotations[]?; . == "Test"))'
# ... one decide call per group

launch=$(jq -r --slurpfile done "$DRAFT" '([$done[].ids[]] | map({(.): true}) | add // {}) as $seen | [.candidates[] | select(.entry and .name == "main" and ($seen[.id] | not)) | "\(.file):\(.lineRange[0])"] | join(" ")' "$CANDS")
[ -z "$launch" ] || { echo "decide: launch methods not decided: $launch" >&2; exit 1; }
jq -s --arg digest "$(jq -r .factsDigest "$CANDS")" '{factsDigest: $digest, decisions: .}' "$DRAFT" > "$DATA/unused-decisions.json"
```

Run it with `bash "$DATA/unused-decisions.sh" "$PROJECT_ROOT"`. Rules for this step:

- **Never type, paste or edit an id.** The `ids` of a decision are exactly what its `query` selects; that is how the product can be checked and the decision re-run on new facts. To change which ids a decision covers, change its query.
- Write each query in single quotes, so the shell does not expand `$p`.
- `reason` names the caller and the mechanism you established in Step 3, in one sentence in `$LANGUAGE`.
- When `decide` reports an overlap, narrow the later query so the two decisions select disjoint sets (for example add `and (any(.annotations[]?; . == "Test") | not)`). Each id belongs to one decision.
- **Set `TEST_CODE` before the first decision, and split on it.** When `decide` reports ids on the wrong side of `TEST_CODE`, split that decision: the `entry` with `and (test_code | not)`, and the test part as a `test-entry` with `and test_code`. Widen `TEST_CODE` only for a directory or module you established as test code in Step 3, never to make a decision pass.
- **Every launch method is decided.** The script refuses to finish while a candidate named `main` that nothing calls is in no decision: decide it as an `entry`, or as a `test-entry` when it is test code.

## Step 5 — Run the report

Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.

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

Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.

Gather the sections with `jq` over `$DATA/unused-code.json`:

```bash
jq '.counts' "$DATA/unused-code.json"
# high, by group: entries first, then members
jq -r '[.unused[] | select(.confidence == "high")] | group_by(.group) | sort_by(-length) | .[:30][] | "group \(.[0].group): " + (map("\(.name) \(.file):\(.lineRange[0]) [\(.reason)]") | join("; "))' "$DATA/unused-code.json"
# medium, by directory and owner
jq -r '[.unused[] | select(.confidence == "medium") | "\(.file | split("/")[:-1] | join("/")) \(.owner // "-" | split(":") | last)"] | group_by(.) | map([length, .[0]]) | sort_by(-.[0]) | .[:30][] | @tsv' "$DATA/unused-code.json"
# medium, by the signals that keep it from high
jq -r '[.unused[] | select(.confidence == "medium") | [.signals[].signal] | sort | join("+")] | group_by(.) | map([length, .[0]]) | sort_by(-.[0]) | .[:10][] | @tsv' "$DATA/unused-code.json"
# low, by the signals that make a node low
jq -r '[.unused[] | select(.confidence == "low") | .signals[].signal | select(IN("name-elsewhere", "owner-referenced", "owner-class-literal", "visible-with-outside-supertype", "capped"))] | group_by(.) | map([length, .[0]]) | sort_by(-.[0])[] | @tsv' "$DATA/unused-code.json"
# the residual assumptions, to list as they stand
jq -r '.residualAssumptions[]' "$DATA/unused-code.json"
```

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

Your reply is the report, in `$LANGUAGE`: it opens with the counts and ends with the line on `/excavator-chat`; write nothing before or after them, and no summary or conclusion of your own. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply. The words these steps give in quotes are for an English report; in another language, write them translated.

Report, in this order:
1. Counts: candidates, removed by decision, `test-only`, unused by confidence, groups; per language when one language has most of the candidates. **A language whose `calls` is 0 has no call facts:** every function in it is a candidate whatever calls it, so say its results show only that the facts hold no calls for it.
2. `high`, by group: the group's entries first (removing them is what makes the members unused), each with `file:line`.
3. `medium`, headed "its name occurs nowhere else; needs confirmation", by directory and class, with the signals that keep them from `high`.
4. `low`: counts by signal only, unless the user asks for the list.
5. `test-only`: the count and the files with the most.
6. Your decisions: kind, reason and hits of each.
7. The residual assumptions, every one, as the product states them.
8. Close with the words "For questions about one method, file or group, /excavator-chat answers from the same product."

Rules for this step:
- **Never call a `medium` or `low` candidate unused.** Say "its name occurs nowhere else; needs confirmation" for `medium`, and "signs of use found" with the signal for `low`. Only `high` may be called unused, and even then deleting it is the user's decision.
- **`unreferenced` is about the facts.** It means no reference in the facts, and calls the facts did not resolve have no edge (the residual assumptions). Never turn it into "nothing calls it".
- **Explain a count only from the product.** Why there are few or no `high` items is in the signals tally of the `medium` ones; say that, and not a reason about the codebase you have not counted.
- **Never edit, move or delete project files.** This skill reports; it does not clean up, refactor or open a change.
- Every listed item carries `file:line` from the product. Do not add items the product does not list.
