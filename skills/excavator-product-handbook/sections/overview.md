## Phase 3b: System overview

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The handbook opens with the system as a whole: what it is, who uses it, which applications it is made of and which external systems it calls. One subagent writes this overview from the code once the map has passed; the scripts check it, two verifiers and two tracers confirm each of its items (Phases 5 and 6, exactly as for a feature, with the id `overview`), and the script, not the subagent, computes every statistic next to it: each application's languages, frameworks, files and lines, its first and last commit date, commits and authors, the counts of the system and the roles of each domain. `--features` does not skip the overview: it is written whenever it is not already, even when `$SELECTED` lists one feature.

1. Read the overview's state (a `state.json` without an `overview` key, as an output directory from before the overview has, reads as planned with no attempt):
   ```bash
   jq -r '(.overview // {status: "planned", attempts: 0}) | [.status, .attempts] | @tsv' "$OUT/state.json"
   ```
   - `checked`, `confirmed` or `verified`: the overview is not written again; go to Phase 4.
   - `dispatched` with `$OUT/entries/overview.json` present (an earlier run stopped after the subagent wrote): go to step 3 as if it had just returned.
   - `failed` with `attempts` 1 (an earlier run stopped before the second attempt): step 2 with the reasons `state.json` kept, `jq -r '.overview.failure.reasons[]' "$OUT/state.json"`, as the retry in step 3 gives them.
   - Any other state with `attempts` below 2: step 2. With `attempts` 2 and not `checked`, `confirmed` or `verified`, leave it as it is and go to Phase 4; the handbook then says the overview was not written and where it stopped.
2. Print what the prompt below needs, delete the file an earlier attempt left, record the dispatch and dispatch one subagent in the foreground (never in the background: a run without a terminal stops waiting for background subagents):
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" applications "$PROJECT_ROOT"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" names "$PROJECT_ROOT"
   jq -r '.areas[] | [.id, .name] | @tsv' "$OUT/map.json"
   jq -r '.features[] | [.id, .area, .reach, .name] | @tsv' "$OUT/map.json"
   jq -r '.roles[].label' "$OUT/map.json"
   jq 'del(.items) | del(.projectRoot)' "$OUT/candidates.json"
   rm -f "$OUT/entries/overview.json"
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" mark "$OUT" overview dispatched --project "$PROJECT_ROOT"
   ```
   Fill the prompt's placeholders with those outputs and `$PLUGIN_ROOT`, `$PROJECT_ROOT`, `$OUT` and `$LANGUAGE` with their values.
3. When the subagent returns, check its file:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-overview "$OUT" --project "$PROJECT_ROOT"
   ```
   It records its result in `state.json` itself: `checked`, or `failed` with the lines it printed as the reasons; a subagent that wrote no file fails with `lane-wrote-nothing`.
   - Exit 0: the overview is checked.
   - Exit 1: it failed its checks. The last line is a `Next:` line; follow it as Phase 4 step 3 does for a lane, with `overview` for the id: `Next: delete overview's entry, mark it dispatched and re-dispatch it once with the lines above (attempt 2 of 2)` means delete `$OUT/entries/overview.json`, run the `mark` line of step 2 again and dispatch once more with the prompt followed by `Your previous attempt failed these checks; fix them and write the file again:` and each line printed except the `Next:` line; check it again when it returns. `Next: overview stays failed (2 of 2 attempts)` leaves it failed, with its file kept for the user to see: never a third attempt. A `Next:` line that starts `Next: write ui.json first` is not an attempt: go back to Phase 2, then check again.
   - Exit 2: the command could not run. Show its message and stop.

   Never edit `entries/overview.json` or `state.json` yourself, and never widen a passage or reword the overview to make it pass.

   Then tell the user `Overview: <status>`, where `<status>` is `checked` or `failed`, in `$LANGUAGE`.

The overview prompt:

````text
You write the system overview of a product handbook, for readers who do not read code, from the source of the project at $PROJECT_ROOT. It says what the system is, who uses it, which applications it is made of and which external systems it calls, as the code is today.

Your scope. Read: the areas, features and roles of the map below; the head of the candidate list below; the application roots below (one line each: the directory, `.` being the project root, and its build manifests); each application's build manifests and its entry files; and the hits of searches over the whole project for external SDKs, HTTP clients, queue and mail clients and credential or endpoint configuration (for example `grep -rnIE --exclude-dir=.excavator --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=vendor --exclude-dir=dist --exclude-dir=build '<pattern>' .`). Open at most 30 files that are not build manifests, in all; searches do not count. Never open a file to look at what a directory holds. Never read anything under `.excavator/`, never read a document that an Excavator skill generated (PRD.md, handbook.md, reports, findings, tours), and never read an explanatory document: no `.md`, `.mdx`, `.txt`, `.rst` or `.adoc` file and no docs folder. A document may be out of date, and the overview says what the code does today. Read code only; never run, build or change anything in the project.

The areas of the map (id, name): <areas, one per line>
The features of the map (id, area, how readers reach it, name): <features, one per line>
The roles of the map: <roles, one label per line>
The head of the candidate list (frameworks found, what was skipped): <the output of the jq line, as printed>
The application roots (directory, build manifests): <the output of the applications command, as printed>
The name candidates (value, source, file and line, resolved or unresolved): <the output of the names command, as printed>

Write in `$LANGUAGE`, in plain words for a reader who does not read code. Describe what the system does today. Give no advice, no opinion and no defect report: never write what the system should do or what is wrong with it.

Write one JSON file with exactly these keys, and no others. `E` stands for an evidence list, a non-empty array of `{"file": "<path from the project root>", "passage": "<text copied from that file>"}`:

```json
{
  "format": "excavator-product-handbook-overview/1",
  "id": "overview",
  "name": {"text": "<the value of one name candidate, copied exactly>", "evidence": E},
  "summary": [{"text": "<one plain sentence: what the system is and does>", "evidence": E}],
  "audiences": [{"who": "<a kind of user: staff, customers, partners, other systems>", "does": "<what they do in the system>", "evidence": E}],
  "applications": [{"dir": "<a directory that holds a build manifest: an application root above, or one below it; . is the project root>", "name": "<the application's name as readers know it>", "does": "<what it is responsible for>", "evidence": E}],
  "integrations": [{"system": "<external system as the source writes its name>", "use": "<what the system uses it for>", "callers": ["<the dir of an application listed above>"], "evidence": E}],
  "unknowns": [{"item": "<what the code does not settle>", "searched": "<what you searched>"}]
}
```

Every key is always there: write an empty list when nothing applies (`"integrations": []`), never leave a key out and never add one. `summary` has one to three items; `applications` has at least one. `unknowns` has no evidence.

**Applications.** Every application root listed above must be covered: list at least one application whose `dir` is that root or lies below it (a repository that holds several applications can list each of them, a directory below the root that holds its own build manifest). Two applications never name the same directory, and a `dir` must hold a build manifest: a directory with none is refused. Each application is named by what readers call it and says what it is responsible for.

**External systems.** An integration is a system outside the project that the code calls or is called by: a payment or messaging service, a mail or storage service, an identity provider, another company's API. `system` is its name exactly as the passage writes it, so the name must occur in the item's own passages (a name that is not in the quoted lines is refused). `callers` lists the `dir` of each listed application that calls it, at least one. Cite the line that calls it (the client call, the SDK construction, the endpoint or credential setting), not a list of dependencies.

**System name.** `name` is the name readers know the system by, taken from the name candidates above, and nowhere else: never from a document, a directory name or your own wording. `text` is the value of one candidate, copied exactly as the list prints it, in whatever case and language the code spells it; it is not translated, not shortened and not rephrased, and none of the reader-text rules below applies to it. `evidence` is exactly one passage, not several: the line of that candidate in its file (the file and line are on its row), which must hold the value. Choose the full product name a reader would recognise rather than a package name, a module name or an abbreviation when the candidates offer one; never choose a candidate marked `unresolved`, which is a reference to a variable, not a name. When no candidate looks like the name of a product, write `"name": null` and add an item to `unknowns` that says which candidates you looked at and why none is the name.

**Evidence.** Every item carries its own evidence. A passage is text copied verbatim from the file, part of a line or whole lines; a script finds it by ignoring differences in white space and line breaks, and it must occur **exactly once** in that file. When it occurs more than once, quote a longer one. A file is a path from the project root, inside the project, never under `.excavator`, `.git`, `node_modules`, `vendor`, `dist` or `build`, and never a document (`.md`, `.mdx`, `.txt`, `.rst`, `.adoc`): cite the code that shows it. An item may cite several passages; each is checked. Cite for each item the passage that by itself proves it: an item the code shown does not support is removed from the handbook by two verifiers that see only the item and the code around its citations, and by two tracers that read the whole project. A statement about the system as a whole ("a tool for ...") is hard to prove from one line; cite the entry file or the route table that shows what it does, and keep the sentence to what that code shows. When no passage proves it, write it in `unknowns`.

**Only what the quoted lines show.** Every detail you add is one more thing the verifiers must find in the code shown, and an item with one detail they cannot find is removed whole. So:
- A `summary` sentence names only what its passages name. Cite the menu or the route table and name the parts it lists; never write "all", "every" or a list longer than the lines you quote. Two short sentences that each cite their own table are better than one long one.
- An application's `does` says what its entry file or route table shows it serving; never "all the pages" or "every service" unless the quoted lines are the whole list.
- An audience cites the check that lets that kind of user in (the role test, the guard, the login of that kind of account) together with the route or screen of what they do there; do not add what they can see or not see unless the quoted check shows it.
- An integration's `use` says what the quoted call does (sends a message, uploads a file, asks for a completion), not who it is for or what triggers it, unless those are in the quoted lines too. Name the provider only as the passage writes it: a mail client that sends over SMTP is not proof of a particular mail service.
- When one item needs a fact the passage does not show, leave that fact out of the item, or move it to `unknowns`.

**Numbers and names.** Every number in your text must occur as a number in that item's own passages; write numbers as Arabic numerals; a count you made is not allowed. Every `system` must occur in that item's own passages.

**No code in reader text.** Everything except `evidence`, `dir` and `callers` is read by a reader. It contains no identifier with an underscore, no camel-case or mixed-case word, no path that starts with `/`, no file name with a source extension (.go .ts .tsx .js .jsx .java .py .sql .json .yaml .yml), no name followed by `(`, and no name of a member directory of the project. Say it in plain words. The only exceptions are a `system` that passed its own check and the names the map lists.

**Negative and absolute statements.** Before you write that something is never called, always done or the only one, search the whole project; when you cannot settle it, write it in `unknowns` with what you `searched`.

Every narrative value of the file is written in $LANGUAGE: `summary` texts, `who`, `does`, `name`, `use`, and the unknowns. `system`, `dir` and `callers` stay as the source and the list above write them.

**Check your file before you reply.** Run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" try-overview "$OUT" --project "$PROJECT_ROOT"`. It runs the checks the orchestrator runs on your file and records nothing; when $LANGUAGE has its own script, it also refuses a narrative value that is written only in ASCII letters. Fix the file for every line it prints and run it again until it prints `overview: ok`, at most 5 runs. A passage reported as not in its file is most often a real line that sits in another file: search for it (`grep -rnF`) and cite the file it is in. An item whose source you cannot find leaves the overview, or goes into `unknowns`; never cut a passage down until it happens to match.

Write only `$OUT/entries/overview.json`, and nothing else anywhere. Reply with one line: `overview: written`, and nothing else.
````

---

