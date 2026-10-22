---
name: excavator-tour
description: Write a learning tour of a project, a route of 5 to 15 steps, each a short explanation that cites a few nodes of the knowledge graph, to .excavator/tour.json for the report viewer. A deterministic script computes the candidate nodes (entry files, most-used files, reading order from each repo's start-up file, representatives of each layer, domain-flow anchors, config files), checks the structure, cuts every step into numbered sentences with the source code they cite and settles the verdicts; you write the steps from the candidates only; a second subagent per step checks each sentence reading only that step's sentences and code. A sentence the code contradicts is rewritten once and then removed, and every removal is recorded. Gives no advice.
argument-hint: "[project-path] [--language <lang>]"
---

# /excavator-tour

Write a route through a project that a newcomer can read in order: 5 to 15 steps, each with a title, a short explanation and the graph nodes it is about. The report viewer shows it as a guided tour.

The work is split between a script and subagents, and each part stays with its owner:

| Who | What |
|---|---|
| `tour.mjs candidates` | Reads the knowledge graph, the semantic files and the domain graph and writes `.excavator/tour/candidates.json`: the nodes a step may cite, each with its summary, its verdict and why it was picked. No model call. |
| You | Choose steps from the candidates only and write each step's title, explanation and nodes to `.excavator/tour/draft.json`. |
| `tour.mjs check` | Checks the draft against the structure rules and the candidate set and prints every problem, or none. |
| `tour.mjs slices` | Splits each step into numbered sentences and cuts the source code of the nodes the step cites, one file per step. |
| Subagents | One per step, each reading only its step file: judge every sentence against the code shown as `verified`, `unverified` or `contradicted`, with a one-line reason. |
| `tour.mjs verdicts` | Records the verdicts, marks a sentence with none as `unchecked`, lists the steps with a `contradicted` sentence, and after the one rewrite removes what is still contradicted. |
| `tour.mjs report` | Writes `.excavator/tour.json` and prints the reply. |

## Options

`$ARGUMENTS` holds the project path (default: the current working directory) and `--language <lang>`: the language of the tour's titles, explanations and language lessons, of everything said to the user during the run and of the reply; English when it is not given.

---

## Step 1 — Candidates

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the tour's text and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory, the system locale and the language of the code or a subagent's reply do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, ids, commands, quotes and the product's values stay as they are.

1. Resolve the paths:
   ```bash
   PROJECT_ROOT="$(pwd)"   # or the project path argument
   SKILL_REAL=$(realpath ~/.agents/skills/excavator-tour 2>/dev/null || readlink -f ~/.agents/skills/excavator-tour 2>/dev/null || echo "")
   SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
   PLUGIN_ROOT=""
   for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do
     if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then PLUGIN_ROOT="$candidate"; break; fi
   done
   echo "plugin root: $PLUGIN_ROOT"
   TOUR="$PLUGIN_ROOT/skills/excavator/tour.mjs"
   TOUR_DIR="$PROJECT_ROOT/.excavator/tour"
   DRAFT="$TOUR_DIR/draft.json"
   LANGUAGE="English"   # or the --language value
   LANGUAGE_CODE="en"   # the two-letter lower-case code of that language
   ```
2. Compute the candidates. `/excavator` writes the knowledge graph; this skill never does:
   ```bash
   node "$TOUR" candidates "$PROJECT_ROOT"
   ```
   A non-zero exit writes nothing: report its message as it stands (when there is no knowledge graph it says to run `/excavator` first) and stop.
3. Read the candidates, never the whole file:
   ```bash
   # the counts per class, how many each quota cut, and where each reading order starts
   jq -r '.classes | to_entries[] | "\(.key): \(.value.total) (\(.value.truncated) cut)"' "$TOUR_DIR/candidates.json"
   jq -r '.classes.bfs.starts[] | "reading order of \(.member) starts at \(.start)"' "$TOUR_DIR/candidates.json"
   jq -r '.gaps[]' "$TOUR_DIR/candidates.json"
   # the layers
   jq -r '.layers[] | "\(.id)\t\(.name)\t\(.description)"' "$TOUR_DIR/candidates.json"
   # every candidate: id, type, lines, layer, why it was picked, the verdict on its summary, and the summary
   jq -r '.candidates[] | [.id, .type, (.lineRange | if . then "\(.[0])-\(.[1])" else "-" end), (.layer // "-"), (.reasons | join("; ")), (.verification // "-"), .summary] | @tsv' "$TOUR_DIR/candidates.json"
   ```
   A candidate's summary is a hint written by a model, and a `contradicted` verdict means it was blanked. Neither is evidence: a step's sentences are checked against the code, not against the summaries.

## Step 2 — Write the draft

Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.

Write `$DRAFT` as JSON:

```json
{
  "contentLanguage": "<LANGUAGE_CODE>",
  "steps": [
    {
      "order": 1,
      "title": "<at most 60 characters>",
      "description": "<2 to 5 sentences>",
      "nodeIds": ["<candidate id>", "..."],
      "languageLesson": "<optional, at most 3 sentences>"
    }
  ]
}
```

Rules for the draft:
- **Choose nodes only from `candidates.json`.** Copy each id from the listing exactly, 1 to 5 distinct ids per step. An id that is not a candidate fails the check.
- **Start from a reading-order start.** Step 1 is about a file the listing names as the start of a reading order. Then follow the order a reader would meet the code: from a start into the files it uses, then the layers and the flows, then the configuration. 5 to 15 steps, `order` running from 1 without a gap.
- **A sentence about specific behaviour cites the function or class node, not the whole file.** A file node shows its first lines and a list of what it contains; a claim about what one function does is checked against that function's own lines, so cite it. Cite a file node for sentences about what the file holds or defines.
- **Ground every claim in what the cited code shows.** Write what the cited nodes do, call and define, using names and conditions that are in their lines. Do not write a reason, a history, a caller that is not in the cited lines, or what the code is for beyond what it does.
- **No advice and no evaluation.** Describe the code as it is. Do not grade it, compare it with how code is usually written, say what to change, add, remove or avoid, or predict what will happen to it.
- **2 to 5 sentences per description.** One claim per sentence. A `languageLesson` is optional, at most 3 sentences, about a construct of the language that the cited code uses (such as how it declares an interface or returns an error); name the construct as the cited lines show it.
- Write `title`, `description` and `languageLesson` in `$LANGUAGE`; set `contentLanguage` to `$LANGUAGE_CODE`. Keep names, paths and quotes as the code writes them.

Then check the draft:

```bash
node "$TOUR" check "$DRAFT"
```

A non-zero exit prints every problem, one line each, and writes nothing. Wording that advises or evaluates is a problem like any other: the line names the sentence id, and you rewrite that sentence as a statement of what the cited code does. Fix each one in `$DRAFT` and run `check` again. After three runs that still fail, stop: report the problems that remain as they stand, and say that no tour was written.

## Step 3 — Check every sentence

Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.

A subagent per step, which sees nothing of the candidates, the other steps or your reasons, reads one step file and judges each of its sentences against the code in it.

1. Cut the steps and list them, one line per step with its sentences, the lines of code it shows and the lines cut, then its step file and the file its verdicts go to:
   ```bash
   node "$TOUR" slices "$DRAFT" > "$TOUR_DIR/slices-round-1.out" && jq -r '.steps[] | "step \(.order)\t\(.sentences) sentences\t\(.snippetLines) lines shown, \(.truncatedLines) cut\t\(.inputPath)\t\(.outputPath)"' "$TOUR_DIR/slices-round-1.out"
   ```
   A non-zero exit writes nothing and prints why (the draft fails the check, or the source or the facts are no longer the ones the candidates were made from): report the message as it stands and stop.
2. Dispatch one subagent per step using the `excavator-tour-verifier` agent definition (`agents/excavator-tour-verifier.md`), up to 10 in a single message so they run concurrently; send the next 10 when those have returned. Give each the prompt below with the two paths of its line filled in. Give it nothing else: not the draft, the candidates, a summary, the title of the step or any reason. When a subagent has returned and its verdict file is missing, dispatch that step once more.

```text
You are checking the sentences of one step of a learning tour against the code shown with them. Write nothing but the one output file named below.

Step file:   <the step file of the line>
Output file: <the output file of the line>

Read the step file and nothing else, and write one verdict per sentence id as your agent definition says.
```

3. List the verdict files that are still missing and record the verdicts:
   ```bash
   jq -r '.steps[].output' "$TOUR_DIR/round-1.json" | while read -r f; do [ -f "$TOUR_DIR/$f" ] || echo "missing: $f"; done
   node "$TOUR" verdicts "$DRAFT" --round 1
   ```
   A step whose verdict file is still missing after the second dispatch is recorded with every sentence `unchecked`; the product says so. Never write or change a verdict yourself.

## Step 4 — Rewrite once, then settle

Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.

Round 1 wrote `rewrite.json`: the steps with a sentence the code contradicts, with each sentence and the reason.

1. List them:
   ```bash
   jq -r '.steps[] | "step \(.order): \(.title)", (.contradicted[] | "  \(.id)\t\(.text)\t\(.reason)")' "$TOUR_DIR/rewrite.json"
   ```
2. When it lists none, go to item 4. Otherwise rewrite each listed step in `$DRAFT`, once: write its description (and language lesson) so that every sentence states what the cited code shows, and, when the sentence cannot be saved, cite the node that does what it claims or drop the claim. Change nothing else in the draft: a step that is not listed must stay exactly as it is, and `slices` refuses the draft when it does not. Then check it and cut the rewritten steps:
   ```bash
   node "$TOUR" check "$DRAFT"
   node "$TOUR" slices "$DRAFT" --round 2 > "$TOUR_DIR/slices-round-2.out" && jq -r '.steps[] | "step \(.order)\t\(.sentences) sentences\t\(.snippetLines) lines shown, \(.truncatedLines) cut\t\(.inputPath)\t\(.outputPath)"' "$TOUR_DIR/slices-round-2.out"
   ```
   The checks of Step 2 apply: after three failing `check` runs stop and report what remains.
3. Dispatch one subagent per listed step as in Step 3, with the same prompt and the same rules: up to 10 in a single message so they run concurrently, and when a subagent has returned and its verdict file is missing, dispatch that step once more. There is no second rewrite: a sentence still contradicted after this is removed.
4. Settle the tour:
   ```bash
   [ -f "$TOUR_DIR/round-2.json" ] && jq -r '.steps[].output' "$TOUR_DIR/round-2.json" | while read -r f; do [ -f "$TOUR_DIR/$f" ] || echo "missing: $f"; done
   node "$TOUR" verdicts "$DRAFT" --round 2
   ```
   A non-zero exit records nothing and prints why: report the message as it stands and stop.

## Step 5 — Write the tour and reply

Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.

Rules for this step:
- **State only what the product holds.** Every number and path in what you say comes from the command's output.
- **A sentence the code contradicts is not in the tour.** `report` leaves every `contradicted` sentence out of `steps` and keeps it, with its reason, in `removed`. Never add one back, and never edit `.excavator/tour.json` or any file under `.excavator/tour/` by hand.
- **No judgement.** Never grade the tour or the project, and never say what to change, add, remove or avoid.

**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the tour's text and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory, the system locale and the language of the code or a subagent's reply do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, ids, commands, quotes and the product's values stay as they are.

Then print the reply's lines with this command:

```bash
# the reply: the product's path, then its step count, its sentence counts by verdict, what was removed and the advice check's line
node "$TOUR" report "$DRAFT"
```

A non-zero exit writes no product: report its message as it stands and stop. Otherwise reply with exactly the lines it prints and nothing else. Its first line, the product's path, is the reply's first line: write nothing before, between or after the lines, no word on the verdicts, the steps or what was done, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply. Run no command after it.
