---
name: excavator-hotspots
description: Find the files, directories and features that change most, and the files that change together, from Git history. A deterministic script counts the commits, authors and changed lines of every selected file and directory, scores each by commits × lines, counts the pairs of files changed in the same commits, and counts each feature over the files a groups file lists for it; you report the numbers as the product states them. Gives no advice and never edits code or Git state.
argument-hint: "[project-path] [--since YYYY-MM-DD] [--language <lang>]"
---

# /excavator-hotspots

Report where a project's history concentrates: the files and directories changed most often, weighted by their size, and the files changed in the same commits.

A **hotspot score** is `commits × lines`: the number of commits that changed a file in the window, times its line count at HEAD. A directory's score is the sum of its files' scores. The score ranks; it does not judge.

The work is split two ways:

| Who | What |
|---|---|
| `hotspots.mjs` | Reads the history reachable from HEAD with read-only `git` commands, follows renames to the current path, counts every selected file and directory, every pair of files changed in the same commits and every feature group it is given, checks that every change is counted once, and writes `.excavator/hotspots.json`. It writes nothing when the check fails. |
| You | Find the feature groups, run it, read the product with `jq`, and report its numbers. |

The product does not depend on the knowledge graph: no `/excavator` run is needed first. Only the counts by feature need groups, from a person or from the business flows of `/excavator-domain` (Step 1).

## Options

`$ARGUMENTS` may contain the project path (default: the current working directory), `--since YYYY-MM-DD`: count only commits whose committer time is at or after that day's UTC midnight (without it the whole history is read), and `--language <lang>`: the language of the report and everything said to the user during the run; English when it is not given.

---

## Step 1 — Run the count

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

1. Resolve `PROJECT_ROOT`, `PLUGIN_ROOT` and the product:
   ```bash
   PROJECT_ROOT="$(pwd)"   # or the path argument
   LANGUAGE="English"   # or the --language value
   SKILL_REAL=$(realpath ~/.agents/skills/excavator-hotspots 2>/dev/null || readlink -f ~/.agents/skills/excavator-hotspots 2>/dev/null || echo "")
   SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
   PLUGIN_ROOT=""
   for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do
     if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then PLUGIN_ROOT="$candidate"; break; fi
   done
   DATA="$PROJECT_ROOT/.excavator"
   HS="$DATA/hotspots.json"
   ```
2. Find the feature groups. Which files make up a feature is a judgement this skill does not make: take groups only from a groups file a person wrote or from the business flows `/excavator-domain` found, and never write, extend or edit groups yourself.
   ```bash
   FEATURE_GROUPS=""
   if [ -f "$DATA/feature-groups.json" ]; then
     FEATURE_GROUPS="$DATA/feature-groups.json"
   elif [ -f "$DATA/domain-graph.json" ]; then
     DOMAIN_CHECK=$(node "$PLUGIN_ROOT/skills/excavator-domain/domain-freshness.mjs" "$PROJECT_ROOT"); echo "domain graph check: $DOMAIN_CHECK"
     if [ "$(printf '%s' "$DOMAIN_CHECK" | jq -r .usable)" = true ]; then
       jq '.edges as $e | (.nodes | map({key: .id, value: .}) | from_entries) as $n | [.nodes[] | select(.type == "flow") | .id as $f | ((.name | select(type == "string" and . != "")) // $f) as $flow | ([$e[] | select(.type == "contains_flow" and .target == $f) | $n[.source].name | select(type == "string" and . != "")] | unique | join(", ")) as $d | {flow: $f, name: (if $d == "" then $flow else "\($d) / \($flow)" end), paths: ([$e[] | select(.type == "flow_step" and .source == $f) | $n[.target].filePath | select(type == "string" and . != "")] | unique)}] | group_by(.name) | {groups: [.[] | if length > 1 then map(.name += " (\(.flow))") else . end | .[] | {name, paths}]}' "$DATA/domain-graph.json" > "$DATA/feature-groups-from-domain.json" && FEATURE_GROUPS="$DATA/feature-groups-from-domain.json"
     fi
   fi
   echo "groups file: ${FEATURE_GROUPS:-none}"
   ```
   - `$DATA/feature-groups.json` exists: a person wrote the groups. Use it as it stands.
   - Otherwise, when `$DATA/domain-graph.json` passes its freshness check (`"usable": true`), the export writes one group per business flow to `$DATA/feature-groups-from-domain.json`, named `<domain> / <flow>`, with the `filePath` of each of the flow's steps as its paths. It runs on every run, so an export from an older domain graph is never used. A person who wants other groups copies it to `feature-groups.json` and edits that.
   - The check prints `"usable": false`: there are no groups. Keep its `reason` for the report.
   - Neither file exists: there are no groups.
3. Run the script, passing `--since` only when the user gave one and `--groups` only when the last step printed a groups file:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator/hotspots.mjs" "$PROJECT_ROOT"            # whole history
   node "$PLUGIN_ROOT/skills/excavator/hotspots.mjs" "$PROJECT_ROOT" --since 2025-01-01
   node "$PLUGIN_ROOT/skills/excavator/hotspots.mjs" "$PROJECT_ROOT" --groups "$FEATURE_GROUPS"   # add --since as above when given
   ```
   A non-zero exit writes no product. A message that begins `groups file` or names `groups[` means the groups file is malformed: run again without `--groups`, keep the message for the report, and do not change the file. For any other, report the script's message as it stands. A message that git could not be started or does not work here, or does not accept a `.git`, means a history exists but cannot be read here: never describe that project as having no history. A refused window means the date was not a real `YYYY-MM-DD` day: ask the user for one; do not convert a phrase such as "last year" into a date yourself.

## Step 2 — Read the header

Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.

Never read `$HS` whole; it lists every file and every pair. Read the header with `jq`:

```bash
jq 'del(.files, .directories, .pairs, .groups)' "$HS"
```

It has `sourceRevision`, `sourceKind` (`git`, `multi-repo` or `directory`), `historyAvailable`, `noHistory`, `repos` (each with `path`, `head`, `shallow`, `boundaryCommits`, `earliestVisibleCommit`), `window`, `counts`, `coChange`, `bots` (`emailMarker`, the rule for a bot, and `commits`, the counted commits by bots), `featureGroups`, `conservation` (`changesRead` = `attributed` + `outsideSelection`) and `residualAssumptions`.

Settle what the history can show before ranking anything:
- **`historyAvailable` is false:** every history field is `null`; only `lines` has values. Say first why, from `noHistory.reason`, give the file count and the binary count, and stop: there is no ranking to report.
  - `not-a-repository`: the project root is not inside a Git work tree, and no child directory is a Git repository with commits.
  - `inside-repository`: the project root is the directory `noHistory.pathInRepository` of the Git repository at `noHistory.repositoryRoot` (relative to the project root). History is read only from a repository root: say that running `/excavator-hotspots` on that repository root gives this directory's numbers in the directory row `noHistory.pathInRepository`. Never say this project is not a Git repository.
- **A repo with `shallow: true`:** a shallow clone. Its `boundaryCommits` are not counted (git shows each as adding every file it holds), and nothing before `earliestVisibleCommit` is visible. Say first that this repo's counts are lower bounds, with those two values.
- **`counts.filesWithoutHistory` above 0 in a `multi-repo` project:** those files belong to no member repository and have `null` history fields.
- **`window.since` set:** every count covers only the window; say so with the window.
- **`coChange`:** the rule for pairs, `maxFilesPerCommit` and `minTogether`, and its counts. `commitsCounted` commits changed 2 to `maxFilesPerCommit` selected files and are the ones counted for pairs; `commitsOverLimit` commits changed more than `maxFilesPerCommit` selected files and count for no pair. The two sets do not overlap, so never give one count as a part of the other; `pairsBelowMinimum` pairs changed together fewer than `minTogether` times and are not listed.
- **`bots`:** `commits` counts the commits whose author email's local part ends in `[bot]`, as GitHub app accounts' do. They are left out of every directory's `concentration`; commits by other automated accounts count as commits by people.
- **`featureGroups`:** `null` when the run had no groups. Otherwise `groupsListed` groups, `filesInAGroup` selected files in at least one of them, `filesInSeveralGroups` of those in more than one, and `pathsUnmatched` listed paths that matched no selected file (deleted, renamed or mistyped; each group keeps its own in `unmatchedPaths`).

## Step 3 — Read the rankings

Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.

The files are already sorted: by `score` descending, then `commits` descending, then path; files with a `null` score (binary files) come last.

```bash
# top files
jq -r '.files[:20][] | [.score, .commits, .authors, .lines, .added, .removed, .lastChanged, .lineageConflicts, .path] | @tsv' "$HS"
# top files by commits (a ranking by any field other than score needs its own query like this one)
jq -r '[.files[] | select(.commits != null)] | sort_by(-.commits) | .[:20][] | [.commits, .authors, .score, .path] | @tsv' "$HS"
# top directories at one depth (1 = top level; repeat with 2 for the level below)
jq -r --argjson d 1 '[.directories[] | select(.path != "." and (.path | split("/") | length) == $d and .score != null)] | sort_by(-.score) | .[:15][] | [.score, .commits, .authors, .files, .lines, .path] | @tsv' "$HS"
# commits per year over the whole project (the `.` row), after the time of its last counted commit
jq -r '.directories[] | select(.path == ".") | "last counted commit: \(.lastChanged)", (.commitsByYear // {} | to_entries[] | [.key, .value] | @tsv)' "$HS"
# directories at one depth with the most commits in the product's last two years (it prints the years first)
jq -r --argjson d 1 '(.directories[] | select(.path == ".") | .commitsByYear // {} | keys[-2:]) as $y | "years: \($y | join(", "))", ([.directories[] | select(.path != "." and (.path | split("/") | length) == $d and .commitsByYear != null) | {path, recent: ([.commitsByYear[$y[]]] | add // 0), commits}] | sort_by(-.recent, .path) | .[:15][] | [.recent, .commits, .path] | @tsv)' "$HS"
# files by the year of their last change; "none": a file with history but 0 commits counted
jq -r '[.files[] | select(.commits != null) | if .lastChanged == null then "none" else .lastChanged[:4] end] | "files by the year of their last change, each file once (none: 0 commits counted):", (group_by(.) | .[] | [.[0], length] | @tsv)' "$HS"
# directories at one depth by their last change, earliest first
jq -r --argjson d 1 '[.directories[] | select(.path != "." and (.path | split("/") | length) == $d and .commits != null)] | sort_by(.lastChanged // "", .path) | .[:10][] | [(.lastChanged // "none")[:10], .commits, .files, .path] | @tsv' "$HS"
# files by their last change, earliest first, after how many files have history but 0 commits counted
jq -r '[.files[] | select(.commits != null)] | "files with history but 0 commits counted: \([.[] | select(.lastChanged == null)] | length)", ([.[] | select(.lastChanged != null)] | sort_by(.lastChanged, .path) | .[:10][] | [.lastChanged[:10], .commits, .path] | @tsv)' "$HS"
# shares by author over the whole project (the `.` row): commits by people and by bots, the top author's share of the commits by people, and how few authors made 80% of them
jq -r '.bots.commits as $b | .directories[] | select(.path == ".") | "commits by people: \(.concentration.commitsByPeople); by bots: \($b); top author share: \(.concentration.topAuthorShare); authors for 80%: \(.concentration.authorsFor80Percent)"' "$HS"
# directories with at least 20 commits by people, by the top author's share, highest first (it prints the rule and how many directories meet it first)
jq -r --argjson min 20 '(reduce (.directories[] | select(.path != ".")) as $r ({}; .[($r.path | split("/") | .[:-1] | join("/") | if . == "" then "." else . end) + " " + ($r.files | tostring)] = true)) as $chain | [.directories[] | select(.path != "." and (.concentration.commitsByPeople // 0) >= $min and ($chain[.path + " " + (.files | tostring)] | not))] | "directories with at least \($min) commits by people (a directory whose files all sit in one subdirectory is shown as that subdirectory): \(length)", (sort_by(-.concentration.topAuthorShare, .concentration.authorsFor80Percent, -.concentration.commitsByPeople, .path) | .[:15][] | [.concentration.topAuthorShare, .concentration.authorsFor80Percent, .concentration.commitsByPeople, .commits, .path] | @tsv)' "$HS"
# feature groups by commits (it prints the group counts first; a group with no history comes last)
jq -r 'if .featureGroups == null then "no feature groups" else "groups: \(.featureGroups.groupsListed); files in a group: \(.featureGroups.filesInAGroup) of \(.files | length); files in several groups: \(.featureGroups.filesInSeveralGroups); listed paths that matched no file: \(.featureGroups.pathsUnmatched)", (.groups | sort_by(-(.commits // -1), .name) | .[:20][] | [.commits, .authors, .files, .lines, (.unmatchedPaths | length), .name] | @tsv) end' "$HS"
# the listed paths that matched no selected file, with their group
jq -r '[.groups[] | .name as $g | .unmatchedPaths[] | [$g, .]] | .[:20][] | @tsv' "$HS"
# files whose counts met a lineage conflict
jq -r '[.files[] | select(.lineageConflicts > 0)] | sort_by(-.lineageConflicts) | .[:20][] | [.lineageConflicts, .commits, .path] | @tsv' "$HS"
# pairs of files changed together most often
jq -r '.pairs[:20][] | [.together, .shareOfA, .shareOfB, .a, .b] | @tsv' "$HS"
# the same, leaving out every pair with a path that looks like a test by its name
jq -r '[.pairs[] | select([.a, .b] | all(test("(^|/)(tests?|specs?|__tests__|testing)(/|$)|[._-](test|spec)s?\\.[^/]+$|Tests?\\.[^/]+$|(^|/)test_[^/]+$") | not))] | .[:20][] | [.together, .shareOfA, .shareOfB, .a, .b] | @tsv' "$HS"
# the residual assumptions, to list as they stand
jq -r '.residualAssumptions[]' "$HS"
```

To look up one file or directory, select it by path:

```bash
jq --arg p "<path>" '.files[] | select(.path == $p)' "$HS"
jq --arg p "<path>" '.directories[] | select(.path == $p)' "$HS"
jq --arg g "<group>" '.groups[] | select(.name == $g)' "$HS"
# the files changed together with one file
jq -r --arg p "<path>" '[.pairs[] | select(.a == $p or .b == $p) | if .a == $p then {with: .b, together, shareOfThis: .shareOfA, shareOfOther: .shareOfB} else {with: .a, together, shareOfThis: .shareOfB, shareOfOther: .shareOfA} end] | "listed pairs with this file: \(length)", (.[:20][] | [.together, .shareOfThis, .shareOfOther, .with] | @tsv)' "$HS"
```

What the fields mean:
- `commits`, `authors`: commits and distinct author emails in the window. A directory counts a commit once however many of its files it changed.
- `added`, `removed`: lines added and removed in the window; `null` when git judged any change to the file binary.
- `lines`: lines at HEAD, blank lines and comments included; `null` for a binary file.
- `lastChanged`: committer time of the latest commit in the window, in the committer's own time zone as git records it; `null` when none. The last-change queries order by this recorded time, so two changes less than a day apart in different time zones can be in the other order in absolute time.
- `commitsByYear` (directories only): the directory's commits in each year of the committer date, the year `lastChanged` shows, with every year from the product's first counted commit to its last (0 for a year with none); they add up to `commits`. The last year runs only to the `.` row's `lastChanged` (the product's last counted commit, not the directory's), and the first starts at the window start or, without a window, no earlier than the earliest visible commit: both are usually partial years. Files have no yearly counts.
- `concentration` (directories only): `commitsByPeople`, the directory's commits in the window whose author is not a bot; `topAuthorShare`, the share of them made by the author with the most; `authorsFor80Percent`, how few authors made at least 80% of them. Both are `null` when no commit is by people. Authors are told apart by email, as for `authors`, which counts bots too. Files have no shares.
- Group rows (`groups`, in the groups file's order): `name`; `paths` as the groups file lists them, a path ending in `/` standing for every selected file below it; `unmatchedPaths`, the listed paths that matched no selected file; then `files`, `lines`, `commits`, `authors`, `added`, `removed`, `lastChanged`, `score`, `commitsByYear` and `concentration`, counted as a directory's are over the group's files: a commit counts once per group however many of its files it changed. A file in several groups counts in each, so the groups do not add up to the project. A group with no matched file, or no file with history, has `null` history fields.
- `together`: commits in the window that changed both files of a pair, counting only commits that changed at most `coChange.maxFilesPerCommit` selected files.
- `shareOfA`, `shareOfB` (and `shareOfThis`, `shareOfOther` in the one-file query): `together` divided by that file's `commits`, all its commits in the window, larger commits included.
- The one-file query prints first how many listed pairs include the file; when that is more than the rows you show, say how many you show out of how many.
- `lineageConflicts`: how many times the walk met a sign that branched history did not fit its single path map: two lineages claiming one path, a rename cutting a lineage, or an older change on a path after its lineage began there.

## Step 4 — Report to the user

Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.

Write the report to `$DATA/hotspots-report.md` in `$LANGUAGE`, in this order. The words these steps give in quotes are for an English report; in another language, write them translated.
1. What the history can show (Step 2): no history and its reason, shallow repos with their lower-bound note, the window. Lead with it when it applies.
2. Counts: files with history, without history, binary; `conservation` (changes read, attributed to selected files, outside the selection).
3. The top files, each with score, commits, authors, lines and path.
4. The top directories at depth 1, and at depth 2 when depth 1 has few entries.
5. Changes by feature. With groups, introduce it with the words "Counts by feature group: a group counts only the files its groups file lists, and a file in several groups counts in each." Then say where the groups came from: "The groups were written by a person in .excavator/feature-groups.json." or "The groups are the business flows /excavator-domain found, one group per flow, with the files its steps name." Then the first line of the groups query as it stands and every row it prints, each group under its name exactly as printed, each with commits, authors, files, lines, the number of unmatched paths and the name, and the rows of the unmatched paths query. Without groups, say there are no counts by feature and why: the domain graph check's `reason` and that running `/excavator-domain` again gives groups; a malformed groups file and the script's message; or, with neither file, that running `/excavator` and then `/excavator-domain`, or writing `.excavator/feature-groups.json`, gives groups for the next run.
6. Changes by year: the project's commits in each year, saying the last year runs only to its last counted commit and the first is usually partial; then the directories at depth 1 (and depth 2 when depth 1 has few entries) with the most commits in the two years the query names, naming those years.
7. Least recently changed: how many files had their last change in each year, then the number on the first line of the files query in these words: "<N> files have history but 0 commits counted; the product does not say why." Then the directories at depth 1 (and depth 2 when depth 1 has few entries) whose last change is earliest, each with the date of its last change. Show the rows as the query prints them, from the first, without leaving any out between those you show.
8. Shares by author: introduce it with the words "Shares of the commits by people in the window; the product counts commits, not knowledge of the code, and holds no names." Then the project's line from the first shares query, then the directories query: its first line (the rule and how many directories meet it) and every row it prints, each with the top author's share, the authors for 80%, the commits by people and the path.
9. Files changed together: the top pairs, then the top pairs where no path looks like a test by its name, introduced with the words "pairs where neither path looks like a test by its name (a filter on names, not on content)", each with `together`, both shares and both paths; and `coChange`'s counts. Show the second list whole, every row its query prints, and do not describe how it differs from the first (which rows it leaves out or adds): a count of those rows would be yours, not the product's.
10. Files with `lineageConflicts` above 0 among those you listed, and how many files have any (`counts.filesWithLineageConflicts`).
11. The residual assumptions, every one, as the product states them.
12. Close with the words "For questions about one file or directory, /excavator-chat answers from the same product."

Rules for this step:
- **State only numbers the product holds.** Every figure and path in the report comes from `$HS`. Do not explain a ranking with a cause you have not counted (team size, a release, code quality).
- **A ranking by another field comes from its own query over every file.** Which file has the most commits or authors is not in the score ranking; never state it from a list sorted by `score`. `lines` is the line count at HEAD, not lines changed.
- **Give no advice.** The report says where changes concentrate. It does not say what anyone should do about it: no refactoring, splitting, deleting, testing, reviewing or ownership suggestions, and no judgement that a file is risky or problematic.
- **Say what a conflict means.** For a listed file with `lineageConflicts` above 0, say its counts may miss part of its history or include another history that once had the same path. A 0 means no conflict was detected, not that the counts are complete; never call a count reliable or accurate.
- **A pair is a count, not a link.** Say that two files changed together in N commits and what share of each file's commits that is. Never say that one file depends on, calls, uses or causes changes in the other, and do not explain why they change together.
- **A year is a count, not a story.** Say how many commits a year had, naming the year. Never compare a partial first or last year with a full one without saying it is partial, never scale a partial year up to a whole one or guess a later count, and do not explain why a count rose or fell (a release, a team change, a rewrite) or call a part active, cooling or quiet.
- **Not changed is not unused.** For a file or directory with no change for years, say the year of its last change. Change history does not show whether code is used: never call it unused, dead, obsolete, abandoned or safe to delete, and do not say what kind of file it is (early, one-off, legacy). The product does not say why a file with history has 0 commits counted: give their number, not a reason.
- **A share is a count of commits, not of knowledge.** Give a part's commits by people, the share its most frequent author made and how many authors made 80% of them, and say how many commits by bots were left out. Do not call a share concentrated, spread, high or low, or say whether a part is changed mostly by one person: the numbers are the answer. Never name an author or look one up (no `git log`, `git shortlog` or `git blame` for names), never say that someone owns, knows, maintains or is responsible for a part, and never call a part at risk, a single point of failure, a silo or dependent on one person.
- **A group is the files it lists.** A group's numbers are those of the files its groups file lists: never call them the whole feature's changes, never explain why a feature changes often, and never add files to a group, move them between groups or propose groups of your own. A group's years and shares follow the rules for a directory's.
- **A shallow repo's counts are lower bounds.** Say so wherever you give one of its numbers.
- **Never edit, move or delete project files, and never run a `git` command that changes the repository.**

Then check the report for advice, causal wording, words that call code unused and words that turn a share into ownership or risk before showing it. The second pattern line holds the same words in Chinese, for a report written in Chinese:

```bash
python3 - "$DATA/hotspots-report.md" <<'EOF'
import re, sys
ADVICE = re.compile(
    r"\b(should|recommend(ed|s)?|consider|refactor(ing)?|split (it|up|into)|break (it )?up|clean ?up|worth|priorit(y|i[sz]e)|depends? on|calls|caus(e|es|ed|ing)|dead|unused|no longer used|obsolete|abandoned|safe to (delete|remove)|at risk|risky|bus factor|single point|silos?|owns|owned by|ownership|experts?|responsible for|knows|whole feature|entire feature)\b"
    r"|\u5efa\u8bae|\u5e94\u8be5|\u5e94\u5f53|\u91cd\u6784|\u62c6\u5206|\u503c\u5f97|\u4f18\u5148|\u4f9d\u8d56|\u8c03\u7528|\u5bfc\u81f4|\u6b7b\u4ee3\u7801|\u5e9f\u5f03|\u65e0\u7528|\u4e0d\u518d\u4f7f\u7528|\u98ce\u9669|\u5355\u70b9|\u5b64\u5c9b|\u8d1f\u8d23|\u4e13\u5bb6|\u719f\u6089|\u638c\u63e1|\u6574\u4e2a\u529f\u80fd",
    re.IGNORECASE)
for number, line in enumerate(open(sys.argv[1], encoding="utf-8"), 1):
    line = line.rstrip("\n")
    if ADVICE.search(line):
        print(f"{number}:{line}")
EOF
```

Each line it prints is a sentence to rewrite as a statement of the numbers; run it again until it prints nothing.

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

Then print the reply's lines with this command:

```bash
# the reply: the report's path and the advice check's line
echo "$DATA/hotspots-report.md"; echo 'advice check: 0 lines'
```

Reply with exactly the lines it prints and nothing else. Its first line, the report's path, is the reply's first line and `advice check: 0 lines` its last: write nothing before, between or after them, no word on the advice check, the report or what was done, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.
