## Phase 4: The system chapter

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

One writer subagent reads the manifests, configuration and start-up code of every application root and writes one Markdown chapter, `$OUT/chapters/system.md`: what the system is and who uses it, its applications and how they are built, run and connected, and the problems in the parts no single feature owns. `--features` does not skip it. It runs only with `system` in `$SECTIONS`, and before the feature chapters, since they share nothing and the reader meets the system first.

1. Find whether it is still to write:
   ```bash
   jq -r '(.chapters.system // {status: "none", attempts: 0}) | [.status, .attempts] | @tsv' "$OUT/state.json" 2>/dev/null || printf 'none\t0\n'
   test -f "$OUT/chapters/system.md" && echo "file present"
   ```
   - `passed`, or `failed` with attempts 2: done; go on to the next phase.
   - `none` with the file present (an earlier run stopped right after the writer returned): check it, as step 3 says.
   - `failed` with attempts 1: delete the file when it is there and dispatch once more with the reasons `jq -r '.chapters.system.reasons[]' "$OUT/state.json"` prints, as step 3 says.
   - `none` and no file: dispatch it.

2. Print what the prompt needs, then dispatch ONE `excavator-handbook-writer` subagent in the foreground (never in the background) with the prompt below. Write `$PROJECT_ROOT`, `$OUT`, `$LANGUAGE`, `$PLUGIN_ROOT`, `$OPEN_QUESTIONS`, `$PROBLEMS` and `$NONE` as their values, and fill the block **The system** from these outputs:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" applications "$PROJECT_ROOT"
   jq -r '.areas[] | [.id, .name] | @tsv' "$OUT/map.json"
   jq -r '.features[] | [.id, .area, .reach, .name, (.seedFiles | join(", "))] | @tsv' "$OUT/map.json"
   jq -r '.roles[]?.label' "$OUT/map.json"
   ```

3. When it returns, check the chapter:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" system --project "$PROJECT_ROOT"
   ```
   Follow the result exactly as Phase 5 step 3 says for a feature chapter: exit 0 is final; `failed (attempt 1)` means delete the file and dispatch once more with the prompt followed by `Your previous attempt failed these checks; write the chapter again and fix each of them:` and the reason lines; `failed (attempt 2)` keeps it as it is; a line about an older `state.json` stops the run with the advice to use `--fresh`; exit 2 stops the run with its message. Never edit the chapter or `state.json` yourself.

   Then tell the user `System chapter: <status>`, where `<status>` is `passed` or `failed`, in `$LANGUAGE`.

The writer's prompt:

````text
You write the system chapter of a product handbook, for readers who do not read code, from the source of the project at $PROJECT_ROOT. Write it to `$OUT/chapters/system.md` and nothing else anywhere.

**Scope.** Read the manifests (package files, module files, build files), the configuration, the start-up code, the route and middleware registration, the scheduler registration, the deployment files (container files, pipelines, infrastructure code) and the shared code every feature calls, of each application root listed in **The system**. Follow an import or a configuration key to the file that defines it with `grep -rn`; open a file only because a file you read or a search leads to it, and never list or walk a directory beyond the application roots' top level. The code of one feature belongs to that feature's own chapter: describe it here only as far as the system needs it. Read code and configuration only; never run, build or change anything. Never read anything under `.excavator/`, and no Markdown or document file of the project. Never copy a secret, a password, a key or a token into the chapter: say that one is configured and where, in plain words. Exclude `.excavator`, `.git`, `node_modules`, `vendor`, `dist` and `build` from every search.

**What the chapter covers**, as far as the code shows it:
- what the system is for and who uses it, by role;
- its applications: for each, what it is, its language and main frameworks, and how it starts;
- how the frontend reaches each backend, and how the backends call each other;
- the databases and other stores each application uses;
- the external systems and cloud services it calls, each with what it is used for;
- how it is built and deployed, as far as the project's files say;
- how sign-in works and how permissions are decided across the applications;
- scheduled jobs and background workers, each with its schedule and what it does.

**Form.** Markdown in $LANGUAGE for a reader who scans, never a wall of text:
- Start with one level-1 heading: the system's name as its own files and screens give it.
- Level-2 headings in this order, written in $LANGUAGE: overview, applications, how the parts connect, data stores, external systems, build and deployment, sign-in and permissions, scheduled and background work, then `## $OPEN_QUESTIONS` and `## $PROBLEMS` exactly as written here. Leave out a heading that would have nothing under it, except the last two.
- A paragraph has at most 4 sentences. A set of 3 or more things of one kind is a list. Applications, stores, external systems and jobs are tables, one row each, one column per attribute.
- Draw one mermaid `flowchart LR` of the applications, their stores and the external systems, with plain-word labels and no citations inside the fence; the table after it carries the citations. A fence's first line is the diagram type.
- Introduce a list or a table with one line that ends with a colon.

**Citations.** Every sentence, list item and table row that states a fact ends with its citation group: one or more citations in parentheses, each in backticks, written as `<path from the project root>:<a>-<b>` (or `:<n>`), several separated by "; ". Cite the lines that by themselves prove the fact, at most 80 lines each. A table row puts its group in its last cell. Backticks are for citations only. A line that ends with a colon and introduces a list, a table or a diagram needs no citation; every other fact does, and in a paragraph every sentence does. In a language written with full-width punctuation, such as Chinese or Japanese, the group's parentheses and the sentence's full stop are that language's (U+FF08 and U+FF09 around the group, U+3002 after it), never the ASCII ones.

**Plain words.** Keep product names, labels and role names as the source writes them; put copied labels in quotation marks. Reader text has no identifier with an underscore, no camel-case or mixed-case word, no path that starts with `/`, no file name with a source extension and no name followed by `(`: say it in plain words. Before you write that something never or always happens, or happens for all, search the whole project; if you cannot settle it, put it under **$OPEN_QUESTIONS**. Describe the system as it is today; give no advice anywhere: no "should", "must", "needs to", "better", "fix", "recommend" or "consider", nor their equivalents in $LANGUAGE.

**$OPEN_QUESTIONS.** Each item says what the code does not settle and what you searched; these need no citation. When there is none, write the one line `$NONE` under the heading.

**$PROBLEMS.** The defects the shared parts show today (start-up, registration of routes, middleware and jobs, configuration, the code every feature calls, build and deployment), one per list item, each starting with its category in bold (`authorization`, `error-handling`, `notification`, `consistency`, `calculation`, `hard-coded`, `contract`, `security`, `display`, `time` or `other`), saying what happens in which situation, with the citations that by themselves show it. A defect of one feature's own code belongs to that feature's chapter, not here. Style and "may" or "might" are not defects. When there is none, write the one line `$NONE`.

**Check before you reply.** Run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" system --project "$PROJECT_ROOT" --no-record`. It records nothing. Fix the chapter for every reason it prints and run it again, at most 4 runs. Never drop a fact only to pass.

Reply with one line: `system: written`.

**The system.**
- The application roots: <the lines `applications` printed>.
- The areas of the product: <id and name, one per line>.
- The features, with their seed files: <id, area, reach, name and seed files, one per line>.
- The roles the map names: <one per line>.
````
