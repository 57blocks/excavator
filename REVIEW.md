# Review instructions

This repository builds Excavator: deterministic scripts and model-driven skills that read a codebase and report facts about it. The rules every change follows are in `AGENTS.md`. This file says what a review of a pull request reports, at which severity, and what it leaves out. It also holds the review procedure: risk tiers, answering findings and rounds. This file is in the high tier, so a pull request cannot loosen these rules without the user merging it.

## Risk tiers

A pull request's tier is the highest tier that any of its changed paths gives, as listed by `git diff --name-only origin/main...HEAD`. The author does not choose it.

| Tier | Paths | Before merging |
|---|---|---|
| High | `.github/`, `scripts/ci/`, `REVIEW.md`, `.claude/agents/reviewer.md` | Reviewed; every thread resolved; merged by the user |
| Medium | Every path in neither the high nor the low tier | Reviewed; every thread resolved; the agent may merge |
| Low | Markdown files under `openspec/` or `docs/`, `.openspec.yaml` files, and root Markdown files other than `AGENTS.md`, `CLAUDE.md` and `REVIEW.md` | The two required checks pass |

## What Important means here

Reserve Important for a change that would do one of these:

- **Make a report say something the source does not support**: a route, caller, field, quote, count or verdict that the code or document does not back. The same goes for an input that silently disappears instead of landing in a visible bucket such as unknown, unresolved or skipped.
- **Make a check pass when it should fail**: a gate, validator, audit or test that is fail-open, compares counts instead of content, no longer runs, or can no longer see the defect it exists for.
- **Put private material where it becomes public**: private names, corpus names, credentials, account identifiers or real-project output in a file, commit message, pull request text or public CI log.
- **Break a rule in `AGENTS.md`**, or weaken the merge and review procedure: the required checks, the risk tiers, answering findings, the reviewer eval in `scripts/review-eval/`, or this file.
- **Break behavior**: wrong logic, a crash, lost data, or a changed command, skill or MCP contract that its callers still rely on.

Everything else is Nit at most: naming, structure, wording, refactoring ideas, missing comments.

## Pre-existing

A defect that this pull request neither introduced nor made reachable is Pre-existing. Report it as Pre-existing, never as Important. It does not block the merge.

## Evidence

- Cite `file:line` in the code the finding is about, and state the input and the wrong result it produces.
- A claim inferred from a name, a comment, a commit message or a document is not evidence. Open the code it is about.
- If you cannot construct the failing case, do not report the finding as Important.

## Flag the class

When a finding is one instance of a pattern, say so and list every instance in this change, so one fix covers all of them.

## Cap the nits

Report at most five Nits per review.

## Do not report

- What CI already enforces: types, build, reference checks, OpenSpec validation, failing tests and the privacy scan.
- Anything in `pnpm-lock.yaml`, `dist/` or `openspec/changes/archive/`.
- The wording of the Chinese OpenSpec documents, unless a document contradicts the code or another document.
- A finding already raised on this pull request, whether it was fixed or answered.

## Always check

- New behavior has a test that would fail without it. A new or changed check has a case showing that it can fail.
- A script that reads a path from an artifact or a model's output keeps that path inside the project root.
- Code, comments, tests and skill prose contain no CJK characters, except as `\u` escapes in code. Code, comments and tests name no corpus.
- Nothing installs a language runtime, compiles the analysed project or fetches its dependencies. Excavator is build-free.
- The pull request's Risk tier matches the tier its paths give under Risk tiers above. A declared tier lower than the paths give is Important, because an agent may merge a medium-tier pull request on its own.
- A pull request that changes this file or `.claude/agents/reviewer.md` gives the eval scores that Changing the review rules below asks for. Missing scores are Important.

## Summary

Start the summary with the count by severity, for example "1 Important, 2 Nit, 0 Pre-existing." When nothing needs fixing, say so in that first sentence.

## Who reviews

Medium- and high-tier pull requests are reviewed by the reviewer agent that `.claude/agents/reviewer.md` defines, started with a fresh context. The session that wrote the change does not review it.

## Answering findings

The author answers every finding, then resolves its thread:

- **Fixed**: reply with the commit that fixes it.
- **Not fixed**: reply with the reason, which is one of wrong, intentional or doesn't matter, and say why.

Answer the findings in a review's summary in one pull request comment. Branch protection blocks the merge while any thread is unresolved.

## Rounds

- **Round 1** reviews the whole change.
- **Later rounds** review only the pull request's own commits after the last reviewed commit. That leaves out what a merge from `main` brought in: `git log -p --diff-merges=remerge <last>..<head> --not origin/main` shows a merge commit only as what the merge itself wrote. A later round never raises a finding already raised.
- **When to run another round**: only when the previous round had an Important finding that the author fixed in code, or when the pull request's own new commits touch a medium- or high-tier path.
- **A round counts once its review is posted.** If the reviewer returns its findings without posting them because the privacy scan has not passed, make the scan pass and run the same round again.
- **At most three rounds.** If either reason calls for a fourth, stop. Do not merge; tell the user and reconsider the approach.

## Changing the review rules

A pull request that changes this file or `.claude/agents/reviewer.md` runs the reviewer eval in `scripts/review-eval/` at two revisions: the version on `main` and the pull request's own version. Its Testing section gives both scores: recall, and the Important findings on clean cases.

- Both versions are run and scored with the eval as the pull request has it: its cases, scorer and run prompt, which move the score as much as the rules do. The score of the version on `main` can be cited from an earlier pull request instead of run again only when the run behind that score used the same `REVIEW.md`, `.claude/agents/reviewer.md` and `AGENTS.md` as `main` has now, and the same `scripts/review-eval/` as the pull request has. A pull request that changed these rules in answer to its own review merged rules no run scored, so the next one runs the version on `main` again.
- The pull request's own version is the one it first sends to review. Changes it makes later in answer to its own review need no new run: the Testing section lists them under the scores, and the user, who merges, decides whether to ask for one.
- Each case runs once, so a difference of one defect between two versions is within the noise.
- A defect that got past review and was fixed later goes into the eval, as `scripts/review-eval/README.md` describes.
