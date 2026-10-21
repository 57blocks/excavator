---
name: excavator-chat
description: Use when you need to ask questions about a codebase or understand code using a knowledge graph
argument-hint: "[query]"
---

# /excavator-chat

Answer questions about this codebase using the knowledge graph in the project's data directory (`.excavator/knowledge-graph.jsonl`).

When the seven `excavator` MCP tools are available and `project_status.data.projectRoot` matches this project, use the same request-local AI routing below with the MCP workflow: `project_status` → explicit-term `recall` → explicit-seed `traverse` as needed → `read_evidence` → `semantic_plan`/`semantic_commit` only for trustworthy node-local English summaries. The host AI still chooses route, search terms and evidence sufficiency, and every route still selects the final answer language with its **Answer language** step. For that step, resolve `$PLUGIN_ROOT` as step 2 does. Never treat a truncated `boundary` as complete. If MCP is not registered or is bound to another root, use the CLI/Skill path below; installing this Skill alone does not install MCP. See `docs/mcp.md` at the plugin root.

## Graph Structure Reference

The knowledge graph `knowledge-graph.jsonl` stores one JSON record per line:
- Line 1 — `{"record":"header", "fields":{…}, "counts":{…}}`: `fields.project` is {name, description, languages, frameworks, analyzedAt, gitCommitHash}; `counts` gives the number of nodes, edges, layers and gaps
- `{"record":"node","node":{…}}` — one line per node: {id, type, name, filePath?, summary, tags[], complexity, languageNotes?}
  - Code node types: file, function, class, module, concept
  - Non-code node types: config, document, service, table, endpoint, pipeline, schema, resource
  - Domain/knowledge node types: domain, flow, step, article, entity, topic, claim, source
  - IDs use the node type as prefix, e.g. `file:path`, `function:path:name`, `config:path`, `article:path`
- `{"record":"edge","edge":{…}}` — one line per edge: {source, target, type, direction, weight}
  - Key types: imports, contains, calls, depends_on, configures, documents, deploys, triggers, contains_flow, flow_step, related, cites
- `{"record":"layer","layer":{…}}` — one line per layer: {id, name, description, nodeIds[]}
- `{"record":"tour","step":{…}}` — compatibility records; new service graphs have none and Q&A does not read them
- `{"record":"coverage",…}` and `{"record":"gap",…}` — the coverage ledger and the named gaps

## How to Read Efficiently

1. Grep the file for relevant entries BEFORE reading anything else — every node and edge is one line, so a hit is a whole record (e.g. `grep '"record":"node"' "$DATA_DIR/knowledge-graph.jsonl" | grep 'src/index.ts'`)
2. Only read the lines you need — never read the whole file into context; it can be hundreds of megabytes
3. Node names and summaries are the most useful fields for understanding
4. Edges tell you how components connect — follow imports and calls for dependency chains

## Instructions

0. **Capture request-local state before reading anything.** Keep these values in working memory only:
   - `$ORIGINAL_QUESTION` — copy `$ARGUMENTS` exactly, including its original language and any explicit answer-language request. Never replace it with a translation or normalized query.
   - `$ENGLISH_RETRIEVAL_EXPRESSIONS` — in this same inference, derive a short list of English business/code search expressions and common code synonyms. This list is for retrieval only, not for answering.
   - `$LITERAL_IDENTIFIERS` — copy any exact code identifiers or source-owned literals separately; non-English identifiers belong here, not in the English expression list.
   - Three language signals, judged now from the question as the user wrote it and from the user's own earlier messages, before you read any product, document, source or project file: an answer language the user explicitly asked for, the current question's predominant natural language, and the most recent confidently identifiable language of the user's own messages. Use `none` for an identifier-only question or an unavailable signal. Nothing you read later changes them. Every route's **Answer language** step passes them to `request-language.mjs`.

   On the graph route, after `$PLUGIN_ROOT` is resolved in step 2, check the English expressions with `createChatRequestState()` from `<PLUGIN_ROOT>/skills/excavator-chat/request-language.mjs`, passing it only `originalQuestion`, `englishRetrievalExpressions` and `literalIdentifiers` (the language signals go to the **Answer language** step, not here); it rejects an expression with non-Latin prose. If an English retrieval expression is rejected, regenerate that expression in English while keeping `$ORIGINAL_QUESTION` and `$LITERAL_IDENTIFIERS` unchanged. **Do not persist request or answer language** to config, cache, graph, metadata, or any other `.excavator/` file.

1. **Change-history questions do not need the graph.** A question about how often, how recently or by how many authors files or directories changed (which files change most, hotspots, churn, who has changed this directory), or about which files changed in the same commits as a file (what usually changes along with it), or about how changes spread over the years and which parts have not changed for a long time, or about whether a part is changed mostly by one or a few people, or about which features change most, is answered as **Change-history questions** below says, whether or not a graph exists; skip steps 2–8 for it. **Document questions do not need the graph either.** A question about the functions, use cases or requirements documents describe (where the code of one is, whether one is implemented, which ones a document describes, which of them have no code found and what was searched, which have evidence in a file or directory) or about which code has no documentation is answered as **Document questions** below says, whether or not a graph exists; skip steps 2–8 for it. So is a question whether a function is implemented, or where its code is, when `.excavator/doc-map.json` lists a unit by that name or id (look it up with the first query of step 3 there). Answer document questions only from `.excavator/doc-map.json`: when that file is missing, run step 5 of **Document questions** first, say so in the language it prints and suggest running `/excavator-doc-map`, and never answer them from the graph, the documents or the source instead. For every other question, **check that `.excavator/knowledge-graph.jsonl` exists** in the current project root. If not, resolve `$PLUGIN_ROOT` as step 2 does, run the **Answer language** command of step 8, and tell the user in the language it prints to run `/excavator` first.

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
     echo "PLUGIN_ROOT=$PLUGIN_ROOT"
     ```
     Each command runs in a new shell, so later commands that use `$PLUGIN_ROOT` take the path this prints.
   - Run the helper:
     ```bash
     node "$PLUGIN_ROOT/skills/excavator/consumer-freshness.mjs" "$PROJECT_ROOT"
     ```
   - It prints `{ status, currentSourceRevision, manifestSourceRevision, reason }` as JSON. `status` is `fresh`, `stale`, or `missing`: it compares the CURRENT `sourceRevision` — resolved via SourceSnapshot, so a git project reads HEAD only (an uncommitted working-tree change never flips this — no working-tree leak) and a plain-directory project is guarded by a content hash over every tracked file (any content drift is caught) — against the `sourceRevision` persisted in `.excavator/source-manifest.json`.
   - `stale`: start the reply with a warning that graph-derived context may omit recent changes. Suggest: Run `/excavator` to refresh the graph.
   - `missing` (no `source-manifest.json` yet): note briefly in the reply that this is best-effort, and continue instead of blocking.
   - `fresh`: proceed with no warning.

3. **Read project metadata only** — use Grep or Read with a line limit to extract just the `"project"` section from the top of the file for context (name, description, languages, frameworks).

4. **Choose the request-local route** — follow the ordered intent contract under **Lazy mode** below. Judge the operation and scope requested by `$ORIGINAL_QUESTION`; topic words in `$ENGLISH_RETRIEVAL_EXPRESSIONS` do not choose the primitive. Keep this semantic decision in the current inference and do not persist it.

5. **Search for relevant nodes** — use Grep to search the knowledge graph with `$ENGLISH_RETRIEVAL_EXPRESSIONS` plus `$LITERAL_IDENTIFIERS`. Keep `$ORIGINAL_QUESTION` intact for intent and final presentation; do not substitute it with the English expressions.
   - Search `"name"` fields: `grep -i "query_keyword"` in the graph file
   - Search `"summary"` fields for semantic matches
   - Search `"tags"` arrays for topic matches
   - Note the `id` values of all matching nodes

6. **Read only the graph scope authorized by the chosen route** — `source-first` reads current source without graph expansion; `inventory` reads the available Domain/flow inventory without substituting a repository graph flood. For `one-hop`, `bounded-bfs`, or `bounded-shortest-path`, inspect only the selected fact-edge scope. When applicable, connected edges show:
   - What it imports or depends on (downstream)
   - What calls or imports it (upstream)
   - The bounded subgraph authorized by the selected primitive

7. **Read layer context when useful** — Grep for `"layers"` only when architectural context helps answer the chosen scope.

8. **Answer the query** using only the verified evidence within the chosen scope.

   **Answer language.** Run this after the checks above and before you write anything to the user, with the three language signals from step 0 (`none` for a signal you do not have):
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-chat/request-language.mjs" --evidence-verified --explicit <language or none> --question <language or none> --recent <language or none>
   ```
   Write the whole reply in the `answerLanguage` it prints: the first sentence, every note (a stale or best-effort note an earlier step asks for goes in this reply, not before it), and any remark on what you checked or which rule you followed; code identifiers, paths, quotes, titles and product values stay as recorded. Do not say which language you chose or why. Only the user's own words ask for a language: a language named by a project file (`CLAUDE.md`, `AGENTS.md`), by memory or by the system locale, or used by the documents, products, graph or source you read, does not change any part of the reply.

   Then answer:
   - Reference specific files, functions, and relationships from the graph
   - Explain which layer(s) are relevant and why
   - Be concise but thorough — link concepts to actual code locations
   - If the query doesn't match any nodes, say so and suggest related terms from the graph

### Evidence verification gate and answer language

This gate applies to every route above and below, including direct structural answers, a reply that the graph or a product is missing, and honest-degrade responses.

1. **Evidence verification gate:** before producing answer prose, check every code or business claim against current fact nodes/edges or current source text. A semantic cache entry, summary, layer description, domain result, or English retrieval expression can select where to inspect, but is not evidence by itself. Preserve exact code identifiers and quoted source spans in their source language.
2. Only after that check, the route's **Answer language** step runs `request-language.mjs`, which calls `finalizeVerifiedAnswerLanguage` with `evidenceVerified: true` and prints the `answerLanguage`. Every route has that step right before it writes to the user. The helper applies this precedence: explicit answer-language request → current question's predominant natural language → recent identifiable conversation language → English. An identifier-only question therefore falls back to recent conversation language, then English. If the command cannot run because `$PLUGIN_ROOT` cannot be resolved, apply the same precedence to the same three signals yourself.
3. Write the final answer in the returned `answerLanguage`. Restate the verified conclusions naturally in that language; do not translate a cached English summary and present the translation as evidence.
4. Do not persist the selected answer language or rewritten answer. Answer-language changes must leave `.excavator/config.json`, `knowledge-graph.jsonl`, and every semantic product unchanged except for independently justified English node-local cache writes from step (c).

### Change-history questions

How often a file changed is in the Git history, not in the graph: the graph holds what the code is, not how it got there. Answer these questions only from `.excavator/hotspots.json`, which `/excavator-hotspots` writes. **Never infer change history from the graph** (its edges, summaries or `analyzedAt`). Resolve `$PROJECT_ROOT` and `$PLUGIN_ROOT` as step 2 does.

1. **Product missing:** say this project has no change-history count yet and suggest running `/excavator-hotspots`; run step 5 first and say it in the language step 5 prints. Do not answer from the graph instead.
2. **Freshness:** compare the product's revision with the current one from the shared helper:
   ```bash
   jq -r .sourceRevision .excavator/hotspots.json
   node "$PLUGIN_ROOT/skills/excavator/consumer-freshness.mjs" "$PROJECT_ROOT" 2>/dev/null | jq -r .currentSourceRevision
   ```
   Different → say the product is stale (there are commits or source changes since it was counted) and suggest re-running `/excavator-hotspots`. You may still quote it, labelled stale. Do not estimate how much the new commits change the counts or the ranking, and do not inspect them to judge it: the product cannot show that.
3. **Read what the history can show** before quoting a number:
   ```bash
   jq '{sourceKind, historyAvailable, noHistory, repos, window, counts, coChange, bots, featureGroups, conservation}' .excavator/hotspots.json
   ```
   `historyAvailable` false: every history field is `null`, so do not rank; say why from `noHistory.reason`. `not-a-repository`: the project root is not inside a Git work tree, and no child directory is a Git repository with commits. `inside-repository`: the project root is the directory `noHistory.pathInRepository` of the Git repository at `noHistory.repositoryRoot`; history is read only from a repository root, so running `/excavator-hotspots` on that root gives this directory's numbers in the directory row `noHistory.pathInRepository`. Never say such a project is not a Git repository. A repo with `shallow: true`: its counts are lower bounds; say so with its `earliestVisibleCommit`. `window.since` set: the counts cover only the window. A whole history (not shallow, no window) still leaves the residual assumptions: never call the counts complete, reliable or accurate.
4. **Find the file or directory** with `jq` (never read the product whole):
   ```bash
   jq --arg p "<path>" '.files[] | select(.path == $p)' .excavator/hotspots.json
   jq --arg p "<path>" '.directories[] | select(.path == $p)' .excavator/hotspots.json
   jq '{byScore: [.files[:10][] | {path, score, commits, authors, lines, lineageConflicts}], mostCommits: ([.files[] | select(.commits != null)] | sort_by(-.commits) | .[:3] | map({path, commits})), mostAuthors: ([.files[] | select(.authors != null)] | sort_by(-.authors) | .[:3] | map({path, authors}))}' .excavator/hotspots.json
   jq -r --arg d "<dir>/" '[.files[] | select(.path | startswith($d))][:20][] | [.score, .commits, .authors, .lines, .path] | @tsv' .excavator/hotspots.json
   jq -r '[.files[] | select(.commits != null)] | sort_by(-.commits) | .[:20][] | [.commits, .authors, .score, .path] | @tsv' .excavator/hotspots.json
   jq -r --arg p "<path>" '[.pairs[] | select(.a == $p or .b == $p) | if .a == $p then {with: .b, together, shareOfThis: .shareOfA, shareOfOther: .shareOfB} else {with: .a, together, shareOfThis: .shareOfB, shareOfOther: .shareOfA} end] | "listed pairs with this file: \(length)", (.[:20][] | [.together, .shareOfThis, .shareOfOther, .with] | @tsv)' .excavator/hotspots.json
   jq -r '.directories[] | select(.path == ".") | "last counted commit: \(.lastChanged)", (.commitsByYear // {} | to_entries[] | [.key, .value] | @tsv)' .excavator/hotspots.json
   jq -r --argjson d 1 '(.directories[] | select(.path == ".") | .commitsByYear // {} | keys[-2:]) as $y | "years: \($y | join(", "))", ([.directories[] | select(.path != "." and (.path | split("/") | length) == $d and .commitsByYear != null) | {path, recent: ([.commitsByYear[$y[]]] | add // 0), commits}] | sort_by(-.recent, .path) | .[:15][] | [.recent, .commits, .path] | @tsv)' .excavator/hotspots.json
   jq -r '[.files[] | select(.commits != null) | if .lastChanged == null then "none" else .lastChanged[:4] end] | "files by the year of their last change, each file once (none: 0 commits counted):", (group_by(.) | .[] | [.[0], length] | @tsv)' .excavator/hotspots.json
   jq -r --argjson d 1 '[.directories[] | select(.path != "." and (.path | split("/") | length) == $d and .commits != null)] | sort_by(.lastChanged // "", .path) | .[:10][] | [(.lastChanged // "none")[:10], .commits, .files, .path] | @tsv' .excavator/hotspots.json
   jq -r '[.files[] | select(.commits != null)] | "files with history but 0 commits counted: \([.[] | select(.lastChanged == null)] | length)", ([.[] | select(.lastChanged != null)] | sort_by(.lastChanged, .path) | .[:10][] | [.lastChanged[:10], .commits, .path] | @tsv)' .excavator/hotspots.json
   jq -r --arg p "<dir>" '.directories[] | select(.path == $p) | "commits: \(.commits); by people: \(.concentration.commitsByPeople); by bots: \(.commits - .concentration.commitsByPeople); top author share: \(.concentration.topAuthorShare); authors for 80%: \(.concentration.authorsFor80Percent); authors (every distinct email, bots included): \(.authors)"' .excavator/hotspots.json
   jq -r --argjson min 20 '(reduce (.directories[] | select(.path != ".")) as $r ({}; .[($r.path | split("/") | .[:-1] | join("/") | if . == "" then "." else . end) + " " + ($r.files | tostring)] = true)) as $chain | [.directories[] | select(.path != "." and (.concentration.commitsByPeople // 0) >= $min and ($chain[.path + " " + (.files | tostring)] | not))] | "directories with at least \($min) commits by people (a directory whose files all sit in one subdirectory is shown as that subdirectory): \(length)", (sort_by(-.concentration.topAuthorShare, .concentration.authorsFor80Percent, -.concentration.commitsByPeople, .path) | .[:15][] | [.concentration.topAuthorShare, .concentration.authorsFor80Percent, .concentration.commitsByPeople, .commits, .path] | @tsv)' .excavator/hotspots.json
   jq -r 'if .featureGroups == null then "no feature groups" else "groups: \(.featureGroups.groupsListed); files in a group: \(.featureGroups.filesInAGroup) of \(.files | length); files in several groups: \(.featureGroups.filesInSeveralGroups); listed paths that matched no file: \(.featureGroups.pathsUnmatched)", (.groups | sort_by(-(.commits // -1), .name) | .[:20][] | [.commits, .authors, .files, .lines, (.unmatchedPaths | length), .name] | @tsv) end' .excavator/hotspots.json
   jq --arg g "<group>" '.groups[] | select(.name == $g) | {name, files, lines, commits, authors, lastChanged, commitsByYear, concentration, unmatchedPaths, pathsListed: (.paths | length), paths: .paths[:20]}' .excavator/hotspots.json
   jq -r --arg p "<dir>" '(.directories[] | select(.path == ".") | .lastChanged) as $end | .directories[] | select(.path == $p) | "last counted commit of the product: \($end); last change of this directory: \(.lastChanged)", (.commitsByYear // {} | to_entries[] | [.key, .value] | @tsv)' .excavator/hotspots.json
   ```
   The files are sorted by `score`. For "which files change most", use the first query: it gives the score ranking together with the files that lead on `commits` and on `authors` over the whole list. **A ranking by any other field comes from its own query over every file**, like the one sorted by `-.commits`; never state which file leads on a field from a list sorted by `score`. For what usually changes along with a file, use the `.pairs[]` query: the files changed together with it, with the share of its commits (`shareOfThis`) and of the other file's (`shareOfOther`). Its first line is how many listed pairs include the file; when that is more than the rows you show, say how many you show out of how many. A file in no listed pair was not changed together with any file at least `coChange.minTogether` times, counting only commits that changed at most `coChange.maxFilesPerCommit` selected files; say that, never that it does not change with other files. A question about what depends on or calls a file is about the code, not its history: answer it from the graph. For a directory's changes over the years, use the `<dir>` query with `commitsByYear`: commits per year of the committer date, the year `lastChanged` shows. Its first line gives the last counted commit of the product: the last year runs only to that date (not to the directory's own last change), so after the years give it in these words: "<year> runs only to <date>, the product's last counted commit, so its count is partial." Never scale it up to a whole year or guess a later count. Say nothing else about how the counts move: not that they rise, fall or hold steady, not that the directory is active, cooling or quiet, and not why a year is higher or lower, the partial year included. Files have no yearly counts: for a file, give its `commits` and `lastChanged`, say the product counts years only per directory, and never work out a file's count for a year. For what has not changed for a long time, use the last-change queries: they order by the time each committer's zone recorded. Show every row a query prints, in its order, one row each; do not merge, group or summarize rows. For files with history but 0 commits counted, give the number on the first line of the files query in these words: "<N> files have history but 0 commits counted; the product does not say why." After the lists, give in these words: "The product records when each file last changed, not whether it is still used or why it has not changed." Describe none of the files or directories: not what they are (early, one-off, legacy, leftover, a script, a test, a document), not why they have not changed, and not how the counts by year move. For whether a part is changed mostly by one or a few people, use the `<dir>` shares query: commits by people, the commits by bots it leaves out, the share of the author with the most and how few authors made 80% of the commits by people; for which parts, use the directories query and show every row it prints after its first line. Give a directory's shares in these words: "The author with the most commits made <topAuthorShare as a percentage> of its <commitsByPeople> commits by people, and <authorsFor80Percent> authors made at least 80% of them." When asked whether one person makes most of the changes, answer from `topAuthorShare` alone: above 0.5 in the words "the author with the most commits made more than half of them", below 0.5 "less than half of them", and 0.5 "about half of them" (the share is rounded). Do not call the shares concentrated, spread, high or low, and do not say whether the other authors are few or many: the numbers are the answer. Say nothing else about the authors: not that one person or a group maintains, owns or knows the part, in any language (维护, 负责, 拥有, 熟悉). Files have no shares: for a file, give its `authors` and `commits`. The product holds no names: when asked who, say it has only shares and counts, and never look a name up with git or in any file. A share is a count of commits: never say that someone owns, knows, maintains or is responsible for a part, or that it is at risk, a silo or dependent on one person. For which features change most, or how much one feature changed, use the groups query, then the `<group>` query with a name from its rows. `featureGroups` `null` means the product has no counts by feature: say so, say that running `/excavator-domain` (after `/excavator`) and then `/excavator-hotspots` again, or writing `.excavator/feature-groups.json` (groups, each a name and the paths of its files), gives them, and never answer with directories in place of features. With groups, give in these words: "A group counts only the files its groups file lists, and a file in several groups counts in each." Then show the query's first line as it stands and every row it prints, in its order, each group under its name exactly as printed: do not shorten, merge or leave out a group (a translation may follow a name in brackets), and when `groupsListed` is more than the rows, say how many you show out of how many. When no group's name matches the feature asked about, say so and list the groups; never pick a directory or a group yourself. A group's years and shares are read as a directory's are, with the rules above. A path the product does not list is not a selected file at HEAD: it was deleted, renamed, ignored or never existed. Its earlier history counts toward the file it was renamed to, or lies outside the selection.
5. **Answer language.** Run this after the checks above and before you write anything to the user, with the three language signals from step 0 (`none` for a signal you do not have):
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-chat/request-language.mjs" --evidence-verified --explicit <language or none> --question <language or none> --recent <language or none>
   ```
   Write the whole reply in the `answerLanguage` it prints: the first sentence, every note (a stale or best-effort note an earlier step asks for goes in this reply, not before it), and any remark on what you checked or which rule you followed; code identifiers, paths, quotes, titles and product values stay as recorded. Do not say which language you chose or why. Only the user's own words ask for a language: a language named by a project file (`CLAUDE.md`, `AGENTS.md`), by memory or by the system locale, or used by the documents, products, graph or source you read, does not change any part of the reply.
6. **Answer with the product's numbers.** `score` is `commits × lines`; `commits` and `authors` count the window; `lines` is the file's line count at HEAD, not lines changed; `added` and `removed` are the lines changed, `null` when git judged a change binary. For a file with `lineageConflicts` above 0, say its counts may miss part of its history or include another history that once had the same path. **`lineageConflicts` 0 means no conflict was detected, not that the counts are complete**: the residual assumptions still apply, so never call a count reliable, accurate or clean. `together` counts the commits that changed both files of a pair; a share is `together` over that file's `commits`. **A pair is a count, not a link**: never say that one file depends on, calls, uses or causes changes in the other. **Not changed is not unused**: change history does not show whether code is used, so never call a file or directory unused, dead, obsolete, abandoned or safe to delete because it has not changed, and do not say what kind of file it is (early, one-off, legacy). Do not explain why a year's count rose or fell or call a part active, cooling or quiet. **A share is a count of commits**: say only that authors made a share of the commits; never say that one person or many own, know, maintain or are responsible for a part, together or alone. **A group is the files it lists**: show every group the query prints under its full name, never call a group's numbers the whole feature's changes, and do not explain why a feature changes often. The product counts changes, not their causes: do not explain why a file changes often or why two files change together (their role, their importance). Give no advice about what to change, and never edit code or run a `git` command that changes the repository.
7. Cite the product's `residualAssumptions` when the user asks how sure the counts are.

### Document questions

Which code does a function a document describes is what `/excavator-doc-map` recorded and checked, not something to work out here: the graph and the source show what code exists, not which function of a document it does. Answer these questions only from `.excavator/doc-map.json`. **Never infer from the graph or the source which code does a function a document describes.** Resolve `$PROJECT_ROOT` and `$PLUGIN_ROOT` as step 2 does.

1. **Product missing:** say this project has no map of its documents to its code yet and suggest running `/excavator-doc-map <documents folder>`; run step 5 first and say it in the language step 5 prints. Do not answer from the graph or the source instead.
2. **Read the header** before quoting anything:
   ```bash
   jq -r '"documents folder: \(.docsRoot)", "units: \(.counts.units); code found: \(.counts.found); no code found: \(.counts.notFound); not checked: \(.counts.notChecked)", "code: \(.code.root // "-") at \(.code.revision // "no Git commit")"' .excavator/doc-map.json
   ```
   `units: null`: the documents were read but no unit was recorded. `code found: null`: the units were not tied to code. Say so, and answer only with what the product holds.
3. **Find the unit or the place** with `jq` (never read the product whole). A unit's number is its place in the order recorded:
   ```bash
   jq -r --arg q "<id or word>" '.units | to_entries[] | select(.value.id == $q or (.value.title | ascii_downcase | contains($q | ascii_downcase))) | [(.key + 1), .value.document, (.value.id // "-"), .value.title, (if .value.page then "page \(.value.page)" else "line \(.value.line)" end), .value.code.status, ([.value.code.evidence[]? | "\(.file):\(.line)"] | join(", "))] | @tsv' .excavator/doc-map.json
   jq -r --arg d "<document>" '.units | to_entries[] | select(.value.document == $d) | [(.key + 1), (.value.id // "-"), .value.title, .value.code.status] | @tsv' .excavator/doc-map.json
   jq -r '.units | to_entries[] | select(.value.code.status == "not-found") | [(.key + 1), .value.document, (.value.id // "-"), .value.title, (.value.code.searched | join("; "))] | @tsv' .excavator/doc-map.json
   jq -r --arg p "<file or directory>" '.units | to_entries[] | [.value.code.evidence[]? | select((.file | ltrimstr("./")) as $f | $f == $p or ($f | startswith($p + "/")))] as $at | select($at | length > 0) | [(.key + 1), .value.title, ($at | map("\(.file):\(.line)") | join(", "))] | @tsv' .excavator/doc-map.json
   ```
   The first finds a unit by its id or a word of its title; the second lists one document's units; the third the units with no code found, each with the searches listed; the fourth the units with evidence in a file or under a directory.
4. **The code with and without evidence.** Read the counts:
   ```bash
   jq -r 'if .coverage == null then "no coverage" else .coverage | "files analysed: \(.counts.files); documents: \(.counts.documents); code files: \(.counts.code); with evidence: \(.counts.withEvidence); without evidence: \(.counts.withoutEvidence)", "pieces of evidence: \(.counts.evidence); not in a code file: \(.counts.outside)", "facts: \(.sourceRevision)" end' .excavator/doc-map.json
   ```
   `no coverage`: say the code has not been counted, and that `/excavator-doc-map` counts it when the project's `/excavator` facts are fresh, running `/excavator --mode=lazy` first when they are not. Otherwise compare the digest of the facts the counts came from with the current one:
   ```bash
   jq -r .coverage.factsDigest .excavator/doc-map.json
   head -1 .excavator/intermediate/fact-graph.jsonl | jq -r .fields.factsDigest
   ```
   Different, or no fact graph: say the counts are stale (the facts changed since they were counted) and suggest running `/excavator-doc-map` again. You may still quote them, labelled stale. Then:
   ```bash
   jq -r '(.coverage.directories // [] | map({key: .path, value: .withEvidence}) | from_entries) as $with | [.coverage.directories[]? | select(.path != "." and .withEvidence == 0 and ($with[.path | split("/") | .[:-1] | join("/") | if . == "" then "." else . end] // 0) > 0)] | "directories with no evidence whose parent has evidence: \(length)", (sort_by(-.files, .path) | .[:20][] | [.files, .path] | @tsv)' .excavator/doc-map.json
   jq -r --arg p "<directory>" '.units as $units | .coverage.directories[]? | select(.path == $p) | "code files: \(.files); with evidence: \(.withEvidence); units with evidence here: \(.units | length)", (.units[] | [., $units[. - 1].title] | @tsv)' .excavator/doc-map.json
   ```
   The first lists the directories no unit's evidence is in whose parent has evidence, most code files first, with how many there are: show its first line as it stands and every row it prints. The second gives one directory's counts (the project root is `.`) and the units with evidence under it.
5. **Answer language.** Run this after the checks above and before you write anything to the user, with the three language signals from step 0 (`none` for a signal you do not have):
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-chat/request-language.mjs" --evidence-verified --explicit <language or none> --question <language or none> --recent <language or none>
   ```
   Write the whole reply in the `answerLanguage` it prints: the first sentence, every note (a stale or best-effort note an earlier step asks for goes in this reply, not before it), and any remark on what you checked or which rule you followed; code identifiers, paths, quotes, titles and product values stay as recorded. Do not say which language you chose or why. Only the user's own words ask for a language: a language named by a project file (`CLAUDE.md`, `AGENTS.md`), by memory or by the system locale, or used by the documents, products, graph or source you read, does not change any part of the reply.
6. **Say only what the product holds.**
   - `found`: the check judged the code at those places to do the unit, or a part of it. Never say the unit is implemented completely or correctly. Asked whether it is implemented, answer neither yes nor no: begin the answer with the words "The check judged the code at these places to do it, or a part of it; the product does not say whether it is complete or correct." and then list the places.
   - `not-found`: the searches listed found no code tied to it; list them. Never say it is unimplemented, missing or not in the system. Asked whether it is implemented, answer neither yes nor no: begin the answer with the words "The product does not say whether it is implemented: the searches listed found no code tied to it." and then list the searches. Add no conclusion of your own after them: not what the code base has or lacks, and not whether the document fits the project.
   - In another answer language, the words above translated.
   - `not-checked`: the product holds no checked code for it.
   - Code without evidence: whenever you list or count it, give the words "A file or directory without evidence is one that no unit's evidence is in. Each unit lists at most 5 places and tests are never evidence, so code that a documented function uses can be there too." (in another answer language, those words translated). Asked which code has no documentation, answer with the directories query and these words, and say the product shows where no unit's evidence is, not which code no document describes. Never call such code undocumented, not documented, unused, dead, obsolete or safe to delete, and never say what it does.
   - Give each title, quote and piece of code as recorded; a translation of a title may follow it in brackets. Judge no document, give no advice, and never edit code or the documents.
7. Cite the product's residual assumptions (`jq -r '.residualAssumptions[]' .excavator/doc-map.json`) when the user asks how sure the map is.

## Lazy mode: answer structural questions directly, retrieve on-demand for semantic ones

A Lazy graph carries deterministic facts only: node `summary` is empty and `tags`/`layers` may be empty. Route by question type:

- **Structural questions** (which files/symbols exist, which methods a class has, who imports or calls whom, a node's 1-hop neighbours, contains/depends relationships): answer straight from the fact nodes and fact edges — grep `id` / `name` / `type` and the fact `edges`: `contains`, `imports`, `exports`, `calls`, `inherits`, `implements`, `overrides`, `mentions`, `references`, `injects` and `routes`. These are the types in `DETERMINISTIC_EDGE_TYPES`; the comment above it in `$PLUGIN_ROOT/skills/excavator/retrieve.mjs` says what each one links. **No summary is needed, and do not trigger any semantic supplement, hybrid retrieval, or whole-project analysis.**
- **Semantic questions** (what a module/service is responsible for, business meaning, a cross-file business flow, especially when phrased in a business/domain language such as Chinese over English-named code): follow the **hybrid retrieval** recipe below instead of degrading immediately.
- Fact edges (every type listed above) and `gaps` are authoritative: to answer "can we be sure A calls B", go by the fact edge; a call the engine could not resolve is recorded in `gaps`, so say "the engine could not determine that connection" rather than guessing.
- **Unused-code questions** (is this method used, what code is unused, why is X reported as unused): answer from the unused-code product, as **Unused-code questions** below says. Never conclude from the graph that code is unused.

### Unused-code questions

Whether code is used is a claim about absence: the graph has no edge from a framework callback, a reflective call or another language. Answer it only from `.excavator/unused-code.json`, which `/excavator-unused-code` writes after deciding the entries. Resolve `$PROJECT_ROOT` and `$PLUGIN_ROOT` as step 2 does.

1. **Product missing:** say this project has no unused-code analysis yet and suggest running `/excavator-unused-code`; run step 4 first and say it in the language step 4 prints. Do not answer from the graph instead.
2. **Freshness:** compare the product's `factsDigest` with the facts it was computed from:
   ```bash
   jq -r .factsDigest .excavator/unused-code.json
   head -1 .excavator/intermediate/fact-graph.jsonl | jq -r .fields.factsDigest
   ```
   Different → say the product is stale (the facts changed since it was computed) and suggest re-running `/excavator-unused-code`. You may still quote it, labelled stale.
3. **Find the node** by id, name or file with `jq` (never read the product whole):
   ```bash
   jq --arg q "<name>" '.unused[] | select(.name == $q)' .excavator/unused-code.json
   jq --arg f "<path>" '[.unused[] | select(.file == $f) | {name, lineRange, confidence, reason}]' .excavator/unused-code.json
   jq --arg q "<name>" '.testOnly[] | select(.name == $q)' .excavator/unused-code.json
   jq --arg id "<id>" '.decisions[] | select(.ids | index($id)) | {kind, reason, query}' .excavator/unused-code.json
   ```
4. **Answer language.** Run this after the checks above and before you write anything to the user, with the three language signals from step 0 (`none` for a signal you do not have):
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-chat/request-language.mjs" --evidence-verified --explicit <language or none> --question <language or none> --recent <language or none>
   ```
   Write the whole reply in the `answerLanguage` it prints: the first sentence, every note (a stale or best-effort note an earlier step asks for goes in this reply, not before it), and any remark on what you checked or which rule you followed; code identifiers, paths, quotes, titles and product values stay as recorded. Do not say which language you chose or why. Only the user's own words ask for a language: a language named by a project file (`CLAUDE.md`, `AGENTS.md`), by memory or by the system locale, or used by the documents, products, graph or source you read, does not change any part of the reply.
5. **Answer by where it is:**
   - In `unused`: its `reason` (`unreferenced`, or `only-reachable-from-unused` with the `referrers` that make it so), its group's `entries`, its `confidence` and the `signals` behind it. If `.counts.byLanguage[<its language>].calls` is 0, the facts hold no calls for that language: say being listed shows only that, not that nothing calls it.
   - In `testOnly`: only tests reach it.
   - In a decision's `ids`: the analysis decided it is an entry (`entry`) or a test entry (`test-entry`); give the decision's `reason`.
   - None of these: if `.excavator/unused-candidates.json` lists it, a decided entry reaches it; otherwise a route reaches it or it is not a function node. Either way the analysis found it used.
6. **Confidence wording.** `high`: private, no sign of use anywhere in the selected files, no annotation, no outside supertype — it may be called unused. `medium`: its name occurs nowhere else in the selected files, but it is visible outside its file, annotated, or its owner inherits a type the repository does not declare; say "its name occurs nowhere else; needs confirmation" (a use that does not spell the name, such as a property `foo` bound to `getFoo`, is not seen). `low`: a sign of use exists (`name-elsewhere`, `owner-referenced`, `owner-class-literal`, `visible-with-outside-supertype`); name it. `capped` means a referrer that is itself unused has a lower confidence. **Never call a `medium` or `low` node unused**, and never edit code to act on the answer.
7. Cite `file:line` from the product, and the `residualAssumptions` when the user asks how sure the analysis is.

### Request-local AI routing contract

Before recall or graph expansion, choose the first matching route by the
operation and scope the user requests. This is an AI judgment held in working
memory, not a persisted object or a keyword/regex classifier:

1. `inventory` — repository-wide enumeration such as all user or business
   flows. Use primitive `inventory`; never replace a missing inventory with one
   repository-wide BFS.
2. `local-condition` — fields, conditions, validation, requirements, or other
   bounded facts about one operation. Prefer `source-first`; use `one-hop` only
   when an immediate owner/caller relationship is needed.
3. `explicit-path` — the user names both endpoints and asks how A reaches B.
   Use `bounded-shortest-path`, at most 6 hops.
4. `direct-neighbor` — direct callers, callees, imports, or dependants. Use
   `one-hop` with `hopLimit: 1`.
5. `flow` — an end-to-end flow, impact, or dependency exploration that is not
   an explicit endpoint pair. Use `bounded-bfs` over separately bounded fact
   segments.
6. `source-locate` — locate current source or the best evidence when none of
   the operations above applies. Use `source-first`.

Higher-priority scope wins over lower-priority topic words. If code naming is
irregular, abbreviated, or misspelled, first inspect the project tree, nearby
identifiers, and small source snippets; then refine the English retrieval
expressions with observed source-owned literals. Do not assume that a business
word has a matching symbol name. For example:

- “Which fields must be filled in and validated to publish an article?” is
  `local-condition` + `source-first`, even if the wording also mentions a
  publishing flow; it does not run BFS.
- “How does an article flow from the editor to the database?” is `flow` +
  `bounded-bfs`; HTTP/API gaps are source-verified boundaries between fact
  segments, not invented graph edges.
- “How does component A reach component B?” is `explicit-path` +
  `bounded-shortest-path`.
- “Who calls `createArticle` directly?” is `direct-neighbor` + `one-hop`.

Keep the chosen route, English retrieval expressions, source-owned literals,
hop bound, and resource boundaries in request-local working memory. Recall is
at most 20; graph expansion is at most 5 seeds, 80 nodes, and 160 edges;
shortest path is at most 6 hops; assembled context stays near 12,000 tokens.
Check the choice against this ordered contract before graph execution. If it is
incompatible, narrow or correct the route rather than falling back to a broader
primitive.

### Hybrid retrieval for semantic questions

This on-demand path is the FALLBACK for semantic questions: use it whenever a step below cannot complete (no model available for step (a), or the cache write in step (c) fails/is declined) — never fabricate to avoid degrading.

**Resolve `$PLUGIN_ROOT` and `$DATA_DIR` first** (`$DATA_DIR` is only needed for this path; the structural path above uses only the `$PLUGIN_ROOT` that step 2 resolves):

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

If `$PLUGIN_ROOT` cannot be resolved, or `$DATA_DIR/source-index.jsonl` does not exist, fall back to the honest degrade: say plainly that this semantics has not been generated/retrieved yet and suggest `/excavator --mode=full` or re-running `/excavator` to produce a `source-index.jsonl`. **Do not auto-trigger Full** — whether to fill semantics for the whole project is the user's explicit choice.

**(a) Use the request-local search expressions — same inference, no subagent.** Use `$ENGLISH_RETRIEVAL_EXPRESSIONS` and `$LITERAL_IDENTIFIERS` captured before retrieval. For example, a non-English business question about placing an order might produce English/code expressions such as `order`, `createOrder`, `checkout`, `placeOrder`, while `$ORIGINAL_QUESTION` remains byte-for-byte unchanged. Do **not** dispatch a separate query-expansion agent/subagent for this — the whole point of same-inference expansion is that it costs no extra model round trip.

**(b) Retrieve — merge candidates, then traverse within budget.**

1. Exact hits: grep the term list (and any literal identifiers) against the node records' `id` / `name` / `type` in `$DATA_DIR/knowledge-graph.jsonl` (one node per line), exactly as the structural search above already does.
2. BM25 hits over `$DATA_DIR/source-index.jsonl` (line-oriented — read it through the store's own reader, never a bare `JSON.parse`; a whole index can be gigabytes as a single string):
   ```bash
   node --input-type=module -e "
   import { readSourceIndex } from '$PLUGIN_ROOT/skills/excavator/source-index-store.mjs';
   import { bm25Search } from '$PLUGIN_ROOT/skills/excavator/retrieve.mjs';
   const index = readSourceIndex('$DATA_DIR/source-index.jsonl');
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
5. Merge all four lists with `mergeCandidates` (weights an exact id/symbol/path match highest, then source-search, semantic-cache, BM25 — see `$PLUGIN_ROOT/skills/excavator/retrieve.mjs`'s own doc comment for the exact rationale), then keep the first 20 ranked candidates as the recall pool. Keep the other evidence locations available for direct source checking, but do not turn them into traversal seeds:
   ```bash
   node --input-type=module -e "
   import { mergeCandidates } from '$PLUGIN_ROOT/skills/excavator/retrieve.mjs';
   console.log(JSON.stringify(mergeCandidates({ exact, bm25, sourceSearch, semanticCacheText }).slice(0, 20)));
   "
   ```
6. Pick ONE traversal primitive authorized by the current AI route. Only fact edges of the types listed above are traversable — a semantic/domain edge, if any exist, never supplies a path, only ranking:
   - `inventory` -> follow the inventory protocol below; do not call a fact-graph traversal primitive
   - `source-first` -> inspect current source; do not call a graph traversal primitive
   - `one-hop` -> `oneHop(edges, seedIds)`
   - `bounded-bfs` -> `boundedBFS(edges, seedIds)`
   - `bounded-shortest-path` -> `boundedShortestPath(edges, seedIds, targetIds)`

   Before calling a graph primitive, map recall candidates to the CURRENT fact
   graph. Select at most 5 unique ids that are relevant to the requested
   operation; do not simply pass all 20 recalled candidates. A shortest-path
   request also needs a non-empty current target. Put stale, unmapped, or
   out-of-scope candidates in visible gaps and continue with the remaining
   recall pool.

   All three graph primitives return a `boundary` object (`reason`,
   `truncated`, effective budgets). Report the actual reason and coverage even
   when the result is not truncated. **If `boundary.truncated` is true, say so
   in the answer** — name what was covered and what remains uncovered (seed ≤5
   / nodes ≤80 / edges ≤160 / ~12k tokens of context), rather than presenting a
   partial subgraph as the whole picture.

### Inventory and segmented-flow protocols

For repository-wide flow enumeration, run the shared Domain freshness check
before reading `.excavator/domain-graph.json`:

```bash
node "$PLUGIN_ROOT/skills/excavator-domain/domain-freshness.mjs" "$PROJECT_ROOT"
```

If it returns `usable: true`, use stable Domain/flow identities to form a
coverage-aware inventory, then expand flows in bounded batches and re-verify
their details against current facts/source. If it is missing, stale, or
otherwise unusable, report, in the language the **Answer language** command of
step 8 prints, `inventory-unavailable`, the freshness reason,
coverage, and gaps; suggest `/excavator-domain`; and do not replace the missing
inventory with one repository-wide BFS or claim all flows were found.

For an end-to-end flow, select separate relevant anchors for each
fact-connected segment and traverse each segment within the same 5/80/160 hard
fuses. HTTP/API literals, queue topics, dynamic framework wiring, ORM/model
lookup, or other boundaries without fact edges are not graph paths. Inspect
current source on both sides of such a boundary and label the result a
`source-verified bridge`; then begin a separately bounded fact segment from the
verified downstream anchor. Never describe the combined segments as one
continuous or directed graph traversal.

Before answering, list stale navigation candidates and uncovered segments as
gaps. For every field or validation statement, verify frontend UI behavior and
backend enforcement independently; a UI prompt or `required` attribute does
not prove a server-side requirement.

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
- `generate[]` is the only semantic generation loop. Treat each generate item as frozen for this turn. For each item, first read the containing file's complete bytes and confirm their SHA-256 equals that item's `currentContentHash`; this whole-file comparison is the file-level freshness authority. If it does not match, stop processing that item and re-plan. Once it matches, keep that verified file snapshot fixed and extract the node's full local source range from the same snapshot using its `filePath`/`lineRange` in `knowledge-graph.jsonl` (a file node uses the whole file). Do not compare a node-range hash to `currentContentHash` and do not reread a different snapshot for generation. Then write the model-owned `summary` and `tags` in **English**, regardless of the user's question language. Preserve source-owned identifiers and literals verbatim and describe ONLY that node's own responsibility.
- `unavailable[]` is a visible degraded result. Report each unavailable node id and its `unknown-node` or `path-not-in-manifest` reason; never generate or write semantics for it.

An all-fresh plan means zero generator calls, zero semantic-cache writer calls, and a byte-identical `semantic-cache.json`, including every existing entry's model, `generatedAt`, and audit. For an overlapping question, preserve every `reuse[]` intersection entry byte-for-byte and generate/commit only the `generate[]` difference. A repeated plan after that commit should reuse the newly fresh entries without another write.

Only a verified `generate[]` item may reach `commitSemanticCacheEntry`. Its frozen `currentContentHash` is the only allowed `semanticSourceHash` for the summary generated in this turn. You may re-read the manifest or source to recheck evidence, but MUST NOT replace the planned hash with a later hash; passing the frozen hash lets the writer's CAS reject any post-plan drift. Persist it **only when all three cacheable conditions hold**: you read the node's full local source range, the summary reliably captures that node's OWN responsibility, and it depends on no unverified cross-file inference. Never persist a cross-file conclusion, a business flow, or answer text — the module enforces this with a field whitelist regardless, but do not even attempt it for content you know is out of scope.

```bash
node --input-type=module -e "
import { commitSemanticCacheEntry } from '$PLUGIN_ROOT/skills/excavator/semantic-cache.mjs';
// Repeat this block only for one verified item from plan.generate.
const generateItem = {
  nodeId: '<exact plan.generate[].nodeId>',
  filePath: '<exact plan.generate[].filePath>',
  currentContentHash: '<exact plan.generate[].currentContentHash>',
};
const plannedSemanticSourceHash = generateItem.currentContentHash;
const result = await commitSemanticCacheEntry({
  projectRoot: '$PROJECT_ROOT',
  nodeId: generateItem.nodeId,
  filePath: generateItem.filePath,
  verifyNodePath: true,
  onlyIfNotFresh: true,
  fields: {
    summary: '<one paragraph about ONLY this node\'s own responsibility>',
    tags: ['<short local tags>'],
    semanticSourceHash: plannedSemanticSourceHash,
    model: '<this model id>',
    generatedAt: new Date().toISOString(),
  },
});
console.log(JSON.stringify(result));
"
```

`result.ok === false` (noncanonical language, a rejected field, a stale CAS hash, a held lock, or an I/O error) is expected occasionally and MUST NOT block the answer — the verified summary generated for THIS answer remains available for this answer, but the cache entry was not committed. Recheck or qualify affected claims if current evidence moved after planning.

**(d) Seeds are re-verified before they enter the answer.** A semantic-cache or domain hit from step (b)/(c) only ever SEEDS which nodes/files to look at — it is never itself the evidence for a claim in the final answer. Before a conclusion derived from such a hit goes into the answer, re-check it against the fact graph's edges/nodes or the current source text (via SourceSnapshot/Grep on the project root). If it does not hold up, drop or qualify the claim; do not present an unverified cached seed as a checked fact. Once this and the global **Evidence verification gate** are complete, the **Answer language** command of step 8 selects the answer language; never choose it early merely because retrieval used English expressions.

**(e) Structural questions never trigger this path.** If the question is purely structural (per the routing at the top of this section), answer directly from facts as before — do not run query expansion, retrieval, or semantic-cache generation for it.

**Honest-degrade fallback.** If step (a) has no model available, if retrieval in step (b) finds nothing usable, or if you cannot produce a reliable node-local summary in step (c), say plainly, in the language the **Answer language** command of step 8 prints, that this semantics has not been generated yet (rather than fabricating a summary/responsibility/business conclusion), and suggest `/excavator --mode=full` for the whole project. You may still state, from fact edges and source evidence, that "structurally it connects to X" — but never present a structural connection as a business responsibility.
