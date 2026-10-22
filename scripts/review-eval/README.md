# Reviewer eval

Scores the reviewer agent, `.claude/agents/reviewer.md` with the rules in `REVIEW.md`, on defects this repository has fixed and on changes no fix has touched since. `REVIEW.md` asks for these scores when a pull request changes either file.

## The cases

`cases.json` holds the cases. Each case is a git range, read the way the reviewer reads a range; so far each range is one commit.

- A **defect case** lists the defects its range introduced. Each defect gives the commit that fixed it, the input that fails and the wrong result, and its spans: the lines in the commit's own tree where it sits.
- A **clean case** has no defects: no later `fix` commit has touched its files.

When one commit introduced several defects, they are one case, reviewed once.

## Running one case

Pick the rules revision `<rules>`: the commit whose `REVIEW.md` and `.claude/agents/reviewer.md` you score. Pick a results directory outside the repository. Make one worktree for the eval, also outside the repository:

```bash
git worktree add --detach <worktree> <head>
```

For each case, check out the commit its range ends at, so the working tree holds only what the reviewer may read:

```bash
git -C <worktree> checkout -q --detach <head>
```

Then start a fresh subagent on Opus, with no context from the calling session, and give it this prompt with the values filled in. A general-purpose subagent works; the loaded `reviewer` agent type does not, because its definition is the one the session started with, not the one at `<rules>`.

```text
You are running as this repository's reviewer agent on one eval case. Your instructions are a file in the repository at a fixed revision. Read them first and follow them, with the changes below.

Values:
- repository: <worktree> (a worktree checked out detached at the head below, with a clean working tree)
- rules revision: <rules>
- target: `range <the case's range>`, round 1; the head is <the full SHA the range ends at>
- result file: <results>/<case id>.json

1. Read your instructions with `git -C <repository> show <rules revision>:.claude/agents/reviewer.md`. Follow them for a range, with these changes:
   - Read the rules with `git -C <repository> show <rules revision>:REVIEW.md` and `git -C <repository> show <rules revision>:AGENTS.md`, not from `origin/main`. Do not fetch.
   - Run every git command as `git -C <repository> ...`. Do not `cd`, and do not define shell functions or aliases.
2. The history after the head is closed to you. Read only the head and its ancestors: no other branch, tag or remote ref apart from the two rules files above, no `--all`, no reflog. Read no files outside the repository. Never read anything about this eval: `scripts/review-eval/` and any OpenSpec change named `review-eval`, at any revision or path. Do not search the web.
3. Write the JSON array of findings that your instructions print for a range to the result file, with the Write tool. It is the only file you write. Write `[]` when you have no findings.
4. The first line of your reply is `WRITES: <every path you wrote>`. The second is `HISTORY: closed`, or `HISTORY: read <what>` if you read anything step 2 closes. Then give the reply your instructions describe, in English.
```

Step 2 is what makes the score mean anything: a fix commit's message names the defect it fixes. Run the cases one at a time, and record each run's tokens, tool calls and time.

## Scoring

```bash
node scripts/review-eval/score.mjs scripts/review-eval/cases.json <results>
```

A defect is hit when an Important finding on one of its paths has its line inside a span or at most three lines outside it. Each finding counts for one defect at most. A defect that is not hit is in the wrong-severity bucket when a Nit or Pre-existing finding is on the same lines, and missed otherwise. The script prints each case, then recall, the Important findings on no known defect in the defect cases, and the Important and Nit findings on the clean cases. It exits 1 when a case has no result or a result it cannot read, since a partial run is not a score.

The script judges hits by place only. Then check by hand, and report recall twice: by place, and confirmed.

- **Each hit's body.** It describes this defect: its failing input or its mechanism. An Important finding about something else can land within three lines of a defect; count that defect as missed. The body also argues from the code at the head. A body that names the later fix, or a change the head does not hold, is a leak: count the defect as missed and say so.
- **What each reviewer read.** The second line of its reply says whether it read closed history, but check the commands it ran too: apart from the three rules files at `<rules>`, every revision a command names is the head or an ancestor (`git merge-base --is-ancestor <rev> <head>`), and no command names a remote ref, `--all` or the reflog. A case whose reviewer read closed history is not scored; run it again.
- **Each Important finding on a clean case.** A clean case is one no fix has touched, which is not proof it has no defect. Decide whether the finding is real, and report the real ones apart from the false ones.

## Growing the set

A defect that got past review and was fixed later becomes a case when all of these hold:

1. The fix changes code, not only prompt prose in Markdown. A defect in a test counts: `REVIEW.md` asks the reviewer to check that tests can fail.
2. `git blame -w <fix>^ -- <file>` on the lines the fix removes or rewrites finds the commit that introduced them, and `git show` confirms that commit added them.
3. The defect is visible statically: from the introducing commit's diff and the code around it at that commit, a careful reader can construct the failing input without running anything.
4. The introducing commit changes at most about 600 lines.

Read the spans at the introducing commit with `git show <commit>:<path>` before you add them. A clean case is a change of 50 to 400 code lines on whose files `git log <head>..origin/main -- <files>` finds no `fix` commit.

Prefer a clean case that covers a whole pull request: its range runs from the parent of the pull request's first commit to its last. A single commit in the middle of a pull request can be judged on a state that a later commit of the same pull request completes, which a review of the whole pull request would not see.

When the first set was mined, most rejected fixes failed rule 4. Those larger introducing commits are the next candidates if the rule is relaxed.

## Cost

The baseline run, with the rules at 1ceb17a7 and the eight cases run one at a time on Opus, took 1.26M tokens and 59 minutes: 130k to 187k tokens, 16 to 49 tool calls and 4 to 9 minutes per case. Scoring both revisions for a rules change costs twice that.
