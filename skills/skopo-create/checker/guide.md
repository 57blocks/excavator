# Writing a skopository

The rules for what goes into a skopo and how it is written, for the Skopo Specification 0.1.0. Read all of it before
planning; come back to it while writing.

## What a skopository is

Intent documentation: what must be true about a system, what form it takes for the people who use
it, and how it is designed, written one level above the code. It is a companion of the code, not
a copy of it and not a wiki. A recovered skopo is a proposal: nothing in it is confirmed until a
person merges it.

**Never put in a skopo:** status, progress, plans, assignees, open questions, meeting notes,
discussion, research, how-to guides, onboarding, changelogs, people's names (use roles), and any
reference to where code sits (paths, file names of the code, modules, symbols, line numbers).
Questions go to the run's `questions.md`; working notes go to `notes.md`.

## Three layers, three tests

| Layer | Holds | Kinds | Test |
|---|---|---|---|
| `spec/` | what must be true in the world | T A R W E | **Clerk test**: still true if a clerk with a paper ledger replaced the whole system |
| `bindings/product/<product>.md` | what the product's consumers see and rely on | F | **Counterpart test**: would a consumer notice the change? |
| `bindings/tech/<product>.md` | what only the product's developers see, at design level | D | **Refactor test**: survives any refactor that keeps the design |

Place every statement with the tests in order:

1. Would an outside party (client, partner, regulator, a standard published by a body outside the
   system's makers) object to changing it? Then it is **spec**, even if it names something outside the system ("results conform to
   SEP-58").
2. Does it survive the clerk test? Then it is **spec**.
3. Would the product's consumers notice a change (users, integrators, API callers, operators who
   run the software themselves)? Then it is a **form decision** in the product binding.
4. Is it a decision about how the product is built that a refactor would keep (components, stores,
   protocols between components, what each component may touch)? Then it is a **design decision**
   in the tech binding.
5. Otherwise it is code, or a coding convention. Leave it out.

When the product *is* an API, the API's operations, protocol, errors and published documents
are form (consumers see them); how the API is produced and how components talk to each other are
design. When the software is run by others, what running it takes (a database, a cloud, a queue) is
form for them; how the components use those is design. Write each side once and let the design
decision cite the form decision. When the makers run it themselves, the people who use it are the
consumers, and how it runs is design. An API that only the makers' own applications call is not a
product surface: it is an internal interface, and belongs in the tech binding.

When the system is a format, a protocol or a specification, its "world" is its own model, and the
clerk test does not tell the model from its syntax. Read it as "would it hold under another
encoding?": the model (what the format's parts are and what tools must do with them) goes in the
spec; the encoding (file names and layout, syntax, field names, algorithms) is form, in the product
binding of the document or library that defines it, whose consumers are its implementers.

**References point up only.** spec ← product binding ← tech binding ← code. A spec statement
cites only spec IDs; a product binding cites spec and F IDs; a tech binding cites spec, F and D IDs.
The skopo never cites code.

## When sources disagree

Write the statement as the most deliberate source states it, and raise a question in the run's
`questions.md`. From most to least deliberate:

1. a promise made to someone outside: terms, a contract, a published standard;
2. a recorded decision: a decision record, or a commit or pull-request message that states a
   decision and its reason;
3. a design document, a specification, a README;
4. the code;
5. a comment.

Between two sources of the same rank, the later one wins. If the code contradicts a later decision
that claims to have changed it, the question is whether the change happened: say so. Never settle a
disagreement silently, and never leave a note about it in the skopo.

Inside the code, the same holds between places: where one place departs from what the rest of the
code does (one path without the check every other path has), write the pattern, and raise the
departure as a question.

Only the default branch is a source for statements. Work on other branches, merged nowhere yet,
may help phrase a question ("an unmerged branch makes staff passkey-only"), never a statement.

## Products

A product is anything with its own consumers. Find them before writing bindings: an open-source
service and the deployment a company runs from it are two products; a backend and its mobile app
may be one product with two surfaces. Each product gets `bindings/product/<name>.md` and
`bindings/tech/<name>.md` with the same file name.

## The tree

```
<skopo>/
  skopo.json                   {"specVersion": "0.1.0"}
  README.md                    what this is, how to read it, what is not here (template below)
  keywords.json                copied from the plugin
  spec/
    <shared>.md                words every domain uses (an outside platform's vocabulary, for example)
    <domain>/
      charter.md               the domain's words (T) and principles (R): five to seven principles
      <topic>.md               detailed rules that refine the charter, with acts and examples
    local/<jurisdiction>.md    rules for one office, market, regulator or operator; they refine general rules
    <domain>.md                a small domain may be one file
  bindings/
    product/<product>.md
    tech/<product>.md
  rationale/<date>-<slug>.md   optional; only where a source states the reason
```

Cut domains where a word changes meaning (a bounded context). A topic file answers one thing a
reader asks about and is readable in one sitting: under about 800 words. A cut is wrong when a word
is defined twice, when a file mostly uses another file's words, or when every change would touch
the same two files.

`local/` holds a jurisdiction's own rules: the promises of one operator among several who run the
software, or the rules of one market, office or regulator among several. A local rule refines the
general rule it narrows: `(refines R-…)`. When there is only one jurisdiction (the makers run the
system for one place), its rules are ordinary spec rules and there is no `local/`. A market,
office or operator with no live operation (in maintenance, archived, planned) gets no `local/`
file; its status is a question.

## Statements

A statement is one Markdown element that ends with an anchor: a paragraph, a list item, a block
quote, or a table row. Everything else is connective text.

| Kind | Letter | Write it as |
|---|---|---|
| term | T | `- A **verifier** is one independent party that … ^T-@verifier` (bold the word being defined) |
| act | A | `- A submitter asks for a **preflight**. The verifier reports … ^A-@preflight` |
| rule | R | `- A job **must not** take its verdict from another job. ^R-@no-borrowed-verdict` |
| assumption | W | `- Two Wasm files with the same hash are the same program. ^W-@hash-pure` (true of the world, not enforced by us) |
| example | E | `> *Example.* A contract is upgraded while its job waits … ^E-@upgrade-in-queue (R-@fresh-wasm)` |
| form decision | F | `- People submit through a web console; no CLI ships. ^F-@console (A-@submit)` |
| design decision | D | `- The builder **must not** hold any credential. ^D-@builder-holds-nothing (R-@isolated)` |

**Anchors and IDs.** While writing, use a placeholder: the kind letter, `-@`, and a short label in
lowercase with hyphens (`^R-@fresh-wasm`). Cite it the same way: `(R-@fresh-wasm)`. A placeholder
is its kind and its label together: `T-@loan-limit` and `R-@loan-limit` are two statements. It means
one statement for the whole run, and keeps its ID after it has one, so you may go on citing it by
placeholder in later files and in the run's `questions.md` and `notes.md`. After each file or domain, run `assign-ids.mjs`; it replaces every
placeholder with a random ID. Never invent an ID by hand.

**Parentheses after an anchor** hold upward links: the IDs an example checks, the IDs a form or
design decision serves, or `refines R-…` for a rule that narrows another rule.

**Force.** Only a bold keyword carries force: `**must**`, `**must not**`, `**may**`. Use them only
in rules, form decisions and design decisions. Never put a bold keyword in connective text, terms,
acts, assumptions or examples. Text in backticks is quoted, not used: a keyword, an ID or a
placeholder inside a code span carries no force and cites nothing, so a statement can quote syntax
that way.

**Recommendations.** The keywords are requirement, prohibition and permission; there is no
"should", on purpose. When a source recommends without requiring, either leave the recommendation
out, or write it as a definitional rule under a heading or a table stem that says these are
recommendations ("Recommendations for authors:"), and say in the README what that heading means.
Never turn a recommendation into **must**, and never drop it into **may**.

Every obligation, prohibition or permission in a rule carries a bold keyword. Write "A member
**must not** hold more books than the loan limit", never "A member cannot hold…", "…is refused",
"…never…" or "only … can". The keyword is what lint, translation and review read; a rule written in
the indicative loses its force in all three. A rule without a keyword is a definition: it says what
a word or a state means ("`mismatched` is a successful verification"), never what someone must or
must not do. Lint warns when a rule without a keyword says cannot, can, never, only, is refused, is
required and the like; when it does, add the keyword, or rewrite the rule as the definition it is.
When lint reports a plain "must" or "may", bold it; do not reword to escape the warning.

**A declared leak.** A spec rule that holds only for some forms opens with a bold `**Where**`:
`- **Where** a submitter uses the console, the terms **must** be shown before submission. ^R-@…`.
Prefer moving form out of the spec; use **Where** only when the rule really is world-level for
that form.

**Granularity.** One statement, one thing a reviewer would accept or reject. More than three bold
keywords in one statement: split it into list items. A whole list or table can be one statement
when its parts only make sense together: end it with a paragraph that holds only the anchor.

**Tables of statements** need a stem paragraph right above them ending with ":" (or "："), and the first cell
of each row is the row's ID:

```
Retention periods:

| ID | Data | Kept for |
|---|---|---|
| R-@job-30 | a job never published | 30 days |
```

A table row cannot carry links (no `refines`, no IDs it serves or checks). When a statement needs
links, write it as a list item.

**Examples** are short, concrete scenarios: who, what happens, what the rule makes true. Write one
where a rule could be misread or where the boundary matters, not one per rule: across the spec
that usually comes to between a tenth and a third of its words.

**Acts** are easy to miss when the sources state everything as requirements, as a standard or a
format does. Look for the verbs behind the rules (someone submits, accepts, publishes, retires,
recovers) and write each as an act before the rules that govern it.

## Style

- English by default; if the project's own documents are in another language, ask in the plan
  checkpoint. `keywords.json` holds the keywords per language.
- Short declarative sentences in the present tense. Name the actor. No "should", "ideally",
  "currently", "for now", "TODO".
- Words of the world, not of the code: "a job ends", not "the job row moves to `FAILED`". Code
  names may appear only when they are also the world's names (a published status value, a standard's
  field name), in backticks.
- General rules carry no tuning numbers (timeouts, batch sizes, rate limits). A number that is a
  promise or a rule of the world (a loan lasts 14 days, data is deleted after 30) is a spec rule:
  in `local/` when it belongs to one of several jurisdictions, otherwise in its topic file.

## Product binding: what to look for

Surfaces and channels (console, apps, API, CLI, notifications), the public API's operations,
protocol, authentication and error contract, published formats and file layouts, hosts and
environments that consumers see, what self-hosting requires and offers, licensing and versioning
promises, service-level posture. Thin: a form decision is a decision, not a feature list.

## Tech binding: what to look for

The shape (services or a monolith, languages and frameworks), components and what each may touch,
trust boundaries, stores and what lives in each, queues and asynchronous flows, internal interfaces
and their versioning, configuration and secrets, and for a deployment: cloud layout, environments,
isolation, data lifetimes, how changes reach production. Write the decision, not the inventory: "Jobs
live in PostgreSQL; the orchestrator takes queued jobs from the database", not a table list.

**A pattern, not a departure.** Everything in the code was written by someone, so whether a thing
was chosen cannot be read from the code. Read it from consistency and from documents instead. What
the system does the same way everywhere ("calls between services inside the cluster are not
authenticated; trust ends at the ingress"), or what a document states, is a design decision: write
it. Where one place departs from what the rest of the system does (one inbound path without the
credential every other inbound path requires), the departure is not a decision: leave it out of the
binding and raise it as a question. A statement that only says something is missing ("carries no
credential") is usually a departure.

## Rationale (optional)

Only where a source states why: a decision record, a design document, a commit or pull request
message that gives the reason. One file per decision, named `<date>-<slug>.md` with the decision's
date; when one source explains several related decisions, one record may touch them all:

```
# 2026-09-01 · A mismatch never displaces a verified result

| | |
|---|---|
| Touches | R-… |
| Sources | docs/adr/014.md §3; commit 3f2a91c |
| Grade | evidenced |
| Recorded | reconstructed <today> |

Two to five sentences: what was decided and why, in the source's terms.
```

Grade is `evidenced` (the source states the reason) or `inferred` (the reason is your reading of
several sources; say so). Never invent a reason. Sources may name files and commits: a rationale
record is history, not a layer, and a code comment that states a reason is a valid source. `Touches`
lists exactly the statements the record explains; lint and lock read it.

## README template

```
# <System>: the skopository

Intent documentation for <system>: what must be true about it, written above the code and the
products that realize it. It follows the Skopo Specification 0.1.0.

<One paragraph: a companion of which repositories; recovered on <date> from <sources>; nobody has
confirmed it yet.>

## How to read it

<Where to start (the main charter). The tree with one line per file or folder.>

<The kinds, the force of bold keywords, `refines`, the three layers and their tests, references
pointing up. Five to eight sentences.>

## What is not here

<Status and plans: the tracker. Coding conventions: the code repository. Guides, runbooks, the
full API reference: where they live. Each in one line, with the place.>
```

## Common lint failures

| Check | Usually means | Fix |
|---|---|---|
| L1 placeholder | `assign-ids.mjs` not run after the last edit | run it |
| L1 F/D outside its binding | a decision written in the wrong layer | move it; keep the label |
| L1 anchor must end its element | text after the anchor, or two anchors in one paragraph | split, or move the links into parentheses |
| L1 table stem | no paragraph ending with ":" or "：" right above a table of statements | add the stem |
| L2 cited but not defined | a typo in a label, or a citation of a statement you dropped | fix or remove the citation |
| L3 may leak form | one of the words lint treats as form, in the spec: screen, page, button, click, checkbox, dropdown, popup, tooltip, form field, endpoint, api, database, cron, server, url, json, login, email, e-mail, slack, sms, push notification, app, mobile, web, ui, dashboard, phone, message | move it to a binding, rewrite in world words (an email reminder is "a reminder that reaches the member"), or declare **Where**; a warning, so a word that is truly the world's may stay with a note |
| L5 cites a lower layer | the spec cites an F or D, or a product binding cites a D | turn the link around: the lower layer cites the higher |
| L5 names code | a path or `file:symbol` in a binding | state the decision instead |
| L8 | a bold keyword in text with no anchor, a heading included | anchor it as a statement, or unbold it |
| L9 not a rule but carries | a keyword in a term, act, example or assumption | rephrase without force, or make it a rule |
| L9 plain keyword | "must" or "may" not bold in a rule | bold it if normative, or rephrase |
| L9 states force | a rule with no keyword says cannot, never, only, is refused… | add **must**, **must not** or **may**; or rewrite it as a definition |
| L9 table stem | a plain "must" or "may" in the sentence above a table of statements | bold it if it binds every row, or reword the stem |
| L11 language | a translation file without `language:` in its front matter | add the front matter |
| RUN | an ID in `questions.md` or `notes.md` that the skopo does not define, or a placeholder left there | run `assign-ids.mjs` with `--also`, or correct the ID |
