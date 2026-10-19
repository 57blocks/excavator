---
name: excavator-hotspots
description: Find the files and directories that change most, and the files that change together, from Git history. A deterministic script counts the commits, authors and changed lines of every selected file and directory, scores each by commits × lines, and counts the pairs of files changed in the same commits; you report the numbers as the product states them. Gives no advice and never edits code or Git state.
argument-hint: "[project-path] [--since YYYY-MM-DD]"
---

# /excavator-hotspots

Report where a project's history concentrates: the files and directories changed most often, weighted by their size, and the files changed in the same commits.

A **hotspot score** is `commits × lines`: the number of commits that changed a file in the window, times its line count at HEAD. A directory's score is the sum of its files' scores. The score ranks; it does not judge.

The work is split two ways:

| Who | What |
|---|---|
| `hotspots.mjs` | Reads the history reachable from HEAD with read-only `git` commands, follows renames to the current path, counts every selected file and directory and every pair of files changed in the same commits, checks that every change is counted once, and writes `.excavator/hotspots.json`. It writes nothing when the check fails. |
| You | Run it, read the product with `jq`, and report its numbers. |

The product does not depend on the knowledge graph: no `/excavator` run is needed first.

## Options

`$ARGUMENTS` may contain the project path (default: the current working directory) and `--since YYYY-MM-DD`: count only commits whose committer time is at or after that day's UTC midnight. Without it the whole history is read.

---

## Step 1 — Run the count

1. Resolve `PROJECT_ROOT`, `PLUGIN_ROOT` and the product:
   ```bash
   PROJECT_ROOT="$(pwd)"   # or the path argument
   SKILL_REAL=$(realpath ~/.agents/skills/excavator-hotspots 2>/dev/null || readlink -f ~/.agents/skills/excavator-hotspots 2>/dev/null || echo "")
   SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
   PLUGIN_ROOT=""
   for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do
     if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then PLUGIN_ROOT="$candidate"; break; fi
   done
   DATA="$PROJECT_ROOT/.excavator"
   HS="$DATA/hotspots.json"
   ```
2. Run the script, passing `--since` only when the user gave one:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator/hotspots.mjs" "$PROJECT_ROOT"            # whole history
   node "$PLUGIN_ROOT/skills/excavator/hotspots.mjs" "$PROJECT_ROOT" --since 2025-01-01
   ```
   A non-zero exit writes no product. Report the script's message as it stands. A message that git could not be started, or does not accept a `.git`, means a history exists but cannot be read here: never describe that project as having no history. A refused window means the date was not a real `YYYY-MM-DD` day: ask the user for one; do not convert a phrase such as "last year" into a date yourself.

## Step 2 — Read the header

Never read `$HS` whole; it lists every file and every pair. Read the header with `jq`:

```bash
jq 'del(.files, .directories, .pairs)' "$HS"
```

It has `sourceRevision`, `sourceKind` (`git`, `multi-repo` or `directory`), `historyAvailable`, `noHistory`, `repos` (each with `path`, `head`, `shallow`, `boundaryCommits`, `earliestVisibleCommit`), `window`, `counts`, `coChange`, `conservation` (`changesRead` = `attributed` + `outsideSelection`) and `residualAssumptions`.

Settle what the history can show before ranking anything:
- **`historyAvailable` is false:** every history field is `null`; only `lines` has values. Say first why, from `noHistory.reason`, give the file count and the binary count, and stop: there is no ranking to report.
  - `not-a-repository`: the project root is not inside a Git work tree, and no child directory is a Git repository with commits.
  - `inside-repository`: the project root is the directory `noHistory.pathInRepository` of the Git repository at `noHistory.repositoryRoot` (relative to the project root). History is read only from a repository root: say that running `/excavator-hotspots` on that repository root gives this directory's numbers in the directory row `noHistory.pathInRepository`. Never say this project is not a Git repository.
- **A repo with `shallow: true`:** a shallow clone. Its `boundaryCommits` are not counted (git shows each as adding every file it holds), and nothing before `earliestVisibleCommit` is visible. Say first that this repo's counts are lower bounds, with those two values.
- **`counts.filesWithoutHistory` above 0 in a `multi-repo` project:** those files belong to no member repository and have `null` history fields.
- **`window.since` set:** every count covers only the window; say so with the window.
- **`coChange`:** the rule for pairs, `maxFilesPerCommit` and `minTogether`, and its counts. `commitsCounted` commits changed 2 to `maxFilesPerCommit` selected files and are the ones counted for pairs; `commitsOverLimit` commits changed more than `maxFilesPerCommit` selected files and count for no pair. The two sets do not overlap, so never give one count as a part of the other; `pairsBelowMinimum` pairs changed together fewer than `minTogether` times and are not listed.

## Step 3 — Read the rankings

The files are already sorted: by `score` descending, then `commits` descending, then path; files with a `null` score (binary files) come last.

```bash
# top files
jq -r '.files[:20][] | [.score, .commits, .authors, .lines, .added, .removed, .lastChanged, .lineageConflicts, .path] | @tsv' "$HS"
# top files by commits (a ranking by any field other than score needs its own query like this one)
jq -r '[.files[] | select(.commits != null)] | sort_by(-.commits) | .[:20][] | [.commits, .authors, .score, .path] | @tsv' "$HS"
# top directories at one depth (1 = top level; repeat with 2 for the level below)
jq -r --argjson d 1 '[.directories[] | select(.path != "." and (.path | split("/") | length) == $d and .score != null)] | sort_by(-.score) | .[:15][] | [.score, .commits, .authors, .files, .lines, .path] | @tsv' "$HS"
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
# the files changed together with one file
jq -r --arg p "<path>" '[.pairs[] | select(.a == $p or .b == $p) | if .a == $p then {with: .b, together, shareOfThis: .shareOfA, shareOfOther: .shareOfB} else {with: .a, together, shareOfThis: .shareOfB, shareOfOther: .shareOfA} end] | "listed pairs with this file: \(length)", (.[:20][] | [.together, .shareOfThis, .shareOfOther, .with] | @tsv)' "$HS"
```

What the fields mean:
- `commits`, `authors`: commits and distinct author emails in the window. A directory counts a commit once however many of its files it changed.
- `added`, `removed`: lines added and removed in the window; `null` when git judged any change to the file binary.
- `lines`: lines at HEAD, blank lines and comments included; `null` for a binary file.
- `lastChanged`: committer time of the latest commit in the window; `null` when none.
- `together`: commits in the window that changed both files of a pair, counting only commits that changed at most `coChange.maxFilesPerCommit` selected files.
- `shareOfA`, `shareOfB` (and `shareOfThis`, `shareOfOther` in the one-file query): `together` divided by that file's `commits`, all its commits in the window, larger commits included.
- The one-file query prints first how many listed pairs include the file; when that is more than the rows you show, say how many you show out of how many.
- `lineageConflicts`: how many times the walk met a sign that branched history did not fit its single path map: two lineages claiming one path, a rename cutting a lineage, or an older change on a path after its lineage began there.

## Step 4 — Report to the user

Write the report to `$DATA/hotspots-report.md`, in this order:
1. What the history can show (Step 2): no history and its reason, shallow repos with their lower-bound note, the window. Lead with it when it applies.
2. Counts: files with history, without history, binary; `conservation` (changes read, attributed to selected files, outside the selection).
3. The top files, each with score, commits, authors, lines and path.
4. The top directories at depth 1, and at depth 2 when depth 1 has few entries.
5. Files changed together: the top pairs, then the top pairs where no path looks like a test by its name (say the filter is by name), each with `together`, both shares and both paths; and `coChange`'s counts.
6. Files with `lineageConflicts` above 0 among those you listed, and how many files have any (`counts.filesWithLineageConflicts`).
7. The residual assumptions, every one, as the product states them.

Rules for this step:
- **State only numbers the product holds.** Every figure and path in the report comes from `$HS`. Do not explain a ranking with a cause you have not counted (team size, a release, code quality).
- **A ranking by another field comes from its own query over every file.** Which file has the most commits or authors is not in the score ranking; never state it from a list sorted by `score`. `lines` is the line count at HEAD, not lines changed.
- **Give no advice.** The report says where changes concentrate. It does not say what anyone should do about it: no refactoring, splitting, deleting, testing, reviewing or ownership suggestions, and no judgement that a file is risky or problematic.
- **Say what a conflict means.** For a listed file with `lineageConflicts` above 0, say its counts may miss part of its history or include another history that once had the same path. A 0 means no conflict was detected, not that the counts are complete; never call a count reliable or accurate.
- **A pair is a count, not a link.** Say that two files changed together in N commits and what share of each file's commits that is. Never say that one file depends on, calls, uses or causes changes in the other, and do not explain why they change together.
- **A shallow repo's counts are lower bounds.** Say so wherever you give one of its numbers.
- **Never edit, move or delete project files, and never run a `git` command that changes the repository.**

Then check the report for advice and for causal wording before showing it:

```bash
grep -niE '\b(should|recommend(ed|s)?|consider|refactor(ing)?|split (it|up|into)|break (it )?up|clean ?up|worth|priorit(y|i[sz]e)|depends? on|calls|caus(e|es|ed|ing))\b|建议|应该|应当|重构|拆分|值得|优先|依赖|调用|导致' "$DATA/hotspots-report.md"
```

Each line it prints is a sentence to rewrite as a statement of the numbers; run it again until it prints nothing. Then show the report, ending with the line `advice check: 0 lines`. Point the user at `/excavator-chat` for questions about one file or directory; it answers from the same product.
