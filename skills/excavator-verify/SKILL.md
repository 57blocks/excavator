---
name: excavator-verify
description: Verify an As-Is document (for example a PRD written by excavator-prd) against the source code it describes. Checks only the statement classes where model-written documents go wrong — negative claims, reachability and ordering, trigger mechanisms, absolute or invariance claims, and open "to be confirmed" items — plus cross-section consistency. Reports a verdict with file:line evidence for every checked statement; with --fix, corrects the document in place.
argument-hint: "<document> [project-path] [--fix] [--report <path>]"
---

# /excavator-verify

Check a written As-Is document against the code, and catch the errors that survive a careful writer: true names, wrong conclusions.

Rules that govern everything below:

1. **The code decides.** Every verdict rests on source code read in this run. Documentation files in the project (`*.md`, `*.adoc`, wikis) are not evidence — they may be stale or may be the very thing being checked.
2. **Zero fabrication applies to you too.** A correction must be backed by `file:line` evidence. If the code does not settle a statement, say so; never replace one guess with another.
3. **As-Is only.** Correct what is wrong; do not add flows, opinions, or recommendations.
4. **Every checked statement gets a visible verdict.** Nothing silently drops out of the counts.

## Why only some statements

Measured on a large PRD: every cited file and identifier existed, and plain facts (fields, numbers, defaults, enum values) were right. All the errors sat in five kinds of statement, where the writer concludes something about code it did not fully trace:

| Class | What it looks like | How it goes wrong |
|---|---|---|
| **N — Negative** | "X sends no event", "the flag is never used", "no permission exists", "does not post accounting entries" | Only the nearby code was read; the behavior lives in a listener, a scheduler, or another module |
| **R — Reachability / order** | "rule Y is unreachable", "A is checked before B", "only if Z" | The real order of checks or early exits was not traced |
| **T — Trigger mechanism** | "recalculated via event E", "done by the nightly job", "called directly from S" | A listener's supported-event list or the actual call site was not checked |
| **A — Absolute / invariance** | "always", "regardless of the setting", "fixed at 30/365", "every case" | One code path was read; another branch varies the value |
| **O — Open item** | "to be confirmed", "待确认", "not evident in the code", "unclear" | The question is often settled by code the writer did not reach, or the tentative guess is wrong |

Statements outside these classes are not checked. The report must say so.

## Options

`$ARGUMENTS` may contain:
- The document path (required).
- The project path — the source tree the document describes (default: current working directory).
- `--fix` — after verification, correct the document in place (see Phase 5). Without it the document is not modified.
- `--report <path>` — where to write the verification report (default: next to the document, `<document-stem>.verification.md`).

---

## Phase 0 — Setup

1. Resolve `DOC` and `PROJECT_ROOT`. Record the source baseline: `git -C "$PROJECT_ROOT" rev-parse HEAD` if it is a Git repository, otherwise "non-Git snapshot".
2. Map the document without reading it whole: `grep -n '^#' "$DOC"` for headings and `wc -l "$DOC"` for size. Note the document's language — corrections are written in that language and style.
3. Plan the split: group consecutive top-level sections into **section groups** of roughly similar line counts (aim for about 500–900 lines each; never more than 14 groups). Include every line of the document in exactly one group, including front matter and glossaries.

## Phase 1 — Dispatch section verifiers in parallel

Launch one subagent per section group, **all in a single message** so they run concurrently. Do not verify statements yourself in this phase; your context is for coordination. Give each subagent the prompt below with the placeholders filled in.

```text
You are verifying one section group of an As-Is document against source code. Work read-only: do not modify any file.

Document: <DOC>, lines <START>-<END> (read only this range; you may grep the rest of the document to check a fact).
Project source: <PROJECT_ROOT> (baseline <BASELINE>).
Document language: <LANGUAGE>.

1. Select candidates. Read your line range and list every statement that belongs to one of these classes (decide by meaning, not by keywords):
   N negative — something does not happen / is not used / does not exist / produces no effect;
   R reachability or order — a rule is (un)reachable, A happens before B, something applies only if a condition holds;
   T trigger mechanism — what invokes a behavior (event listener, scheduled job or batch step, direct call, which component);
   A absolute or invariance — always / never / regardless of / fixed / for every case;
   O open item — marked as to be confirmed, unclear, not evident, or similar.
   Plain facts outside these classes are out of scope; do not list them.

2. Verify each candidate against the code. The code decides; documentation files are not evidence. Cited line numbers in the document may be slightly off — judge the statement, not the citation.
   N: search the WHOLE project before accepting a negative: all modules, event listeners and their registrations, scheduler / batch / job registrations, SQL and migration scripts, configuration files. Record the scope you searched.
   R: read the actual sequence of checks, including early returns and thrown exceptions, and decide whether the rule can be reached and in what order.
   T: find the real invocation path — direct call sites, listener registration and the exact list of events a listener accepts, scheduler or batch-step registration.
   A: find every code path that sets or computes the value; any branch that varies it falsifies the claim.
   O: settle it if the code settles it; otherwise keep it open and record what you searched.

3. Return one entry per candidate, in this exact form (one block each):
   - id: <section-group>-<n>
     line: <line number in DOC>
     class: N | R | T | A | O
     subject: <short subject, e.g. "Reschedule approval → delinquency recalculation">
     quote: <the statement, verbatim, shortened only with … if very long>
     verdict: verified | contradicted | misattributed | unverifiable   (for class O: resolved | still-open | contradicted)
     evidence: <file:line[, file:line]> and, for N or still-open, the searched scope
     correction: <for contradicted, misattributed, resolved: the replacement statement in <LANGUAGE>, matching the document's style, stating only what the evidence supports; otherwise empty>
   "contradicted" means the code says otherwise; "misattributed" means the behavior exists but the statement assigns it to the wrong flow, component, condition or case; "resolved" means an open item the code settles (whether or not the document's tentative guess was right — say which in the correction).
   End with counts per class and per verdict, and the number of candidates you selected.
```

When all subagents return, check the books: for each group, the returned entries must equal the number of candidates it reported selecting. Any candidate a subagent selected but did not return is counted as **not-checked**. A group whose subagent failed entirely is reported as not-checked with its line range.

## Phase 2 — Cross-section consistency

The same fact is often stated in two chapters. Dispatch one subagent with the list of all candidates (`id · line · subject · verdict · correction`) and `DOC`. Its job: for each subject, grep the document for other statements about the same subject outside the candidate's own line, and report every pair that disagrees — with both line numbers, both quotes, and which side the code supports (reuse the verdict evidence; read code only when the verdicts do not settle it). It returns a list of conflicts in the same block form, with `class: C` and a correction for the wrong side.

## Phase 3 — Report

Write the report to the `--report` path in the document's language:

1. **Scope** — the five classes plus cross-section consistency; other statements were not checked. Baseline and document path.
2. **Counts** — a table of class × verdict, plus not-checked and conflicts. The totals must equal the number of selected candidates.
3. **Errors** — every contradicted and misattributed entry and every conflict: line, quote, evidence, correction.
4. **Open items** — resolved (with the settled statement, and whether the original guess was right), still-open (with the searched scope), contradicted.
5. **Run** — number of section groups and subagents.

In the final message, give the counts and the errors list (line + one-line summary each).

## Phase 4 — Self-check

- Counts add up to the selected-candidate total; not-checked is reported, not hidden.
- Every contradicted, misattributed, resolved and conflict entry has `file:line` evidence.
- The report states the verification scope.

## Phase 5 — Fix (only with `--fix`)

Edit `DOC` in place, one entry at a time:
- **contradicted / misattributed / conflict** — replace the wrong statement (sentence, list item or table cell) with the correction. Keep the surrounding structure.
- **resolved open item** — replace the tentative statement and its open marker with the settled statement.
- **still-open** — leave it, and make sure the open marker says what was searched.
- Where the flow has an evidence `<details>` block, add the new evidence lines to it.

Do not add flows or sections, do not reorder, do not rewrite verified text, do not add recommendations. Then append a short section at the end of `DOC` (heading in the document's language, e.g. "Verification summary" / "核对摘要") with the date, baseline, scope, and the count table. Report how many entries were applied, and list any correction you could not apply with the reason.
