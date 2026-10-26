---
name: excavator-verify
description: Verify an As-Is document (for example a PRD written by excavator-prd) against the source code it describes. Checks only the statement classes where model-written documents go wrong — negative claims, reachability and ordering, trigger mechanisms, absolute or invariance claims, and open "to be confirmed" items — plus cross-section consistency. Reports a verdict with file:line evidence for every checked statement; with --fix, corrects the document in place.
argument-hint: "<document> [project-path] [--fix] [--no-summary] [--report <path>] [--language <lang>]"
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
| **O — Open item** | "to be confirmed" (in any language), "not evident in the code", "unclear" | The question is often settled by code the writer did not reach, or the tentative guess is wrong |

Statements outside these classes are not checked. The report must say so.

## Options

`$ARGUMENTS` may contain:
- The document path (required).
- The project path — the source tree the document describes (default: current working directory).
- `--fix` — after verification, correct the document in place (see Phase 5). Without it the document is not modified.
- `--no-summary` — with `--fix`, do not append the verification summary to the document; the counts stay in the report. Without `--fix` it has no effect.
- `--report <path>` — where to write the verification report (default: next to the document, `<document-stem>.verification.md`).
- `--language <lang>` — the language of the report and everything said to the user during the run; English when it is not given. Quotes and corrections stay in the document's language.

---

## Phase 0 — Setup

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

1. Resolve `DOC` and `PROJECT_ROOT`, and parse `--fix`, `--no-summary`, `--report` and `--language` (`$LANGUAGE`: English when it is not given). Record the source baseline: `git -C "$PROJECT_ROOT" rev-parse HEAD` if it is a Git repository, otherwise "non-Git snapshot".
2. Map the document without reading it whole: `grep -n '^#' "$DOC"` for headings and `wc -l "$DOC"` for size. Note the document's language as `DOC_LANGUAGE`: quotes, corrections and the summary `--fix` appends are in `DOC_LANGUAGE` and the document's style, whatever `$LANGUAGE` is.
3. Plan the split: group consecutive top-level sections into **section groups** of roughly similar line counts (aim for about 500–900 lines each; never more than 14 groups). Include every line of the document in exactly one group, including front matter and glossaries.

## Phase 1 — Dispatch section verifiers in parallel

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

Launch one subagent per section group, **all in a single message** so they run concurrently. Do not verify statements yourself in this phase; your context is for coordination. Give each subagent the prompt below with the placeholders filled in.

```text
You are verifying one section group of an As-Is document against source code. Work read-only: do not modify any file.

Document: <DOC>, lines <START>-<END> (read only this range; you may grep the rest of the document to check a fact).
Project source: <PROJECT_ROOT> (baseline <BASELINE>).
Document language: <DOC_LANGUAGE>.

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
     verdict: verified | contradicted | misattributed | unverifiable   (for class O: resolved-right | resolved-wrong | still-open)
     evidence: <file:line[, file:line]> and, for N or still-open, the searched scope
     correction: <for contradicted, misattributed, resolved-right, resolved-wrong: the replacement statement in <DOC_LANGUAGE>, matching the document's style, stating only what the evidence supports; otherwise empty>
   "contradicted" means the code says otherwise; "misattributed" means the behavior exists but the statement assigns it to the wrong flow, component, condition or case; "resolved-right" / "resolved-wrong" mean the code settles an open item and the document's tentative guess was right / wrong.
   End with counts per class and per verdict, and the number of candidates you selected.
```

Wait until every section verifier has returned before you continue — do not end your turn or write the report while any of them is still running, and do not stop one to save budget unless the user told you to. When all subagents return, check the books: for each group, the returned entries must equal the number of candidates it reported selecting. Any candidate a subagent selected but did not return is counted as **not-checked**. A group whose subagent failed entirely is reported as not-checked with its line range.

## Phase 2 — Cross-section consistency

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The same fact is often stated in two chapters. Dispatch one subagent with the list of all candidates (`id · line · subject · verdict · correction`) and `DOC`. Its job: for each subject, grep the document for other statements about the same subject outside the candidate's own line, and report every pair that disagrees — with both line numbers, both quotes, and which side the code supports (reuse the verdict evidence; read code only when the verdicts do not settle it). It returns a list of conflicts in the same block form, with `class: C` and a correction for the wrong side, in `DOC_LANGUAGE`.

## Phase 3 — Report

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

Write the report to the `--report` path in `$LANGUAGE`; quotes and corrections stay in `DOC_LANGUAGE`, as the document has them:

1. **Scope** — the five classes plus cross-section consistency; other statements were not checked. Baseline and document path.
2. **Counts** — a table of class × verdict, plus not-checked and conflicts. Fill every cell yourself by counting the returned entries (each entry carries its class and verdict); never copy a subagent's own summary counts, which do not always match its entries. Row totals must equal the candidates selected per class, and the grand total must equal the number of selected candidates.
3. **Errors** — every contradicted and misattributed entry and every conflict: line, quote, evidence, correction.
4. **Open items** — resolved-right and resolved-wrong (with the settled statement), still-open (with the searched scope). A resolved-wrong item is a wrong statement the document made, and counts with the errors.
5. **Run** — number of section groups and subagents.

## Phase 4 — Self-check

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

- The class × verdict table is filled cell by cell from the entries, and its rows and columns add up to the selected-candidate total; not-checked is reported, not hidden.
- Every contradicted, misattributed, resolved-right, resolved-wrong and conflict entry has `file:line` evidence.
- The report states the verification scope.

## Phase 5 — Fix (only with `--fix`)

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

Edit `DOC` in place, one entry at a time:
- **contradicted / misattributed / conflict** — replace the wrong statement (sentence, list item or table cell) with the correction. Keep the surrounding structure.
- **resolved-right / resolved-wrong open item** — replace the tentative statement and its open marker with the settled statement.
- **still-open** — leave it, and make sure the open marker says what was searched.
- Where the flow has an evidence `<details>` block, add the new evidence lines to it.

Do not add flows or sections, do not reorder, do not rewrite verified text, do not add recommendations. Then, unless `--no-summary` was given, append a short section at the end of `DOC` (heading in `DOC_LANGUAGE`, e.g. "Verification summary" for a document in English) with the date, baseline, scope, and the count table. With `--no-summary` append nothing to `DOC` after the corrections: the counts are in the report only. Then add a section **Fix** at the end of the report: of the entries that carry a correction (contradicted, misattributed, resolved-right, resolved-wrong and conflict), how many there are and how many you applied, and each one you could not apply with the reason.

## Phase 6 — Reply

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

When you follow this procedure for another skill (for example `excavator-prd`), skip this phase: that skill says what to report.

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

Then print the reply's lines with this command, putting in the report's path, the numbers in the report's table and, with `--fix`, the two numbers its Fix section gives and the document's path, each number as the report has it and none added up:

```bash
# the reply: where the report is, the counts by verdict and, with --fix, the corrections applied
printf '%s\n' \
  "<the report's path>" \
  "Statements: <V> verified, <X> contradicted, <Y> misattributed, <U> unverifiable" \
  "Open items: <RR> resolved right, <RW> resolved wrong, <S> still open" \
  "Cross-section conflicts: <C>; not checked: <K>" \
  "Corrections applied: <A> of <B>, in <the document's path>"
```

Reply with exactly the lines it prints and nothing else. Its first line, the report's path, is the reply's first line: write nothing before, between or after the lines, no word on the errors, the document or what was done, and no summary or notes; the errors are listed in the report. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply. In a language other than English, write the command's words translated; the paths and the numbers stay as they are. Without `--fix`, leave the last line out.
