# Framework Addenda

Each `<framework-id>.md` file in this directory is a **prompt addendum**: a
block of conventions that is appended to an analysis prompt when that framework
is detected in the project being analysed. They are not standalone prompts and
they are not read at all for a project where the framework is absent.

## Who reads them

| Reader | When | How |
|---|---|---|
| `excavator-architecture-analyzer` | Phase 4 (ARCHITECTURE) | The `excavator` skill injects the full file content into the dispatch prompt for every framework Phase 1 detected (SKILL.md Phase 4, step 3). |
| `excavator-file-analyzer` | Phase 2 (ANALYZE) | The agent itself checks for `<SKILL_DIR>/frameworks/<framework-id-lowercase>.md` and reads it before writing summaries and edges ("Framework Guidance" section of the agent). |

## Naming

The file name is the **lower-cased framework id as the project scanner reports
it**, plus `.md`. `Spring Boot` detected as `spring` reads `spring.md`;
`Next.js` detected as `nextjs` reads `nextjs.md`. Nothing normalises the id
beyond lower-casing, so a new addendum has to match the scanner's spelling
exactly or it will never be found.

## A missing file is silence, not a licence

If a framework is detected and no matching file exists here, **both readers
skip it and continue**. That is the whole fallback: a missing addendum means
nobody has written that framework's conventions down yet. It does not authorise
reconstructing them from the framework's name, its documentation, or general
knowledge of how such frameworks are usually wired.

## An addendum is guidance, not evidence

An addendum says where to look and what to call things. It is **not** a source
of line numbers, and a relationship asserted only because a framework
convention implies it carries no citable record. Such an edge is
`"provenance": "inferred"` with no `evidence` — the same as any other judgement
edge (see the file-analyzer's "Evidence Fields" section). The deterministic
ANNOTATE and VALIDATE phases never treat a convention as a fact.

## Present today

`angular.md`, `django.md`, `express.md`, `fastapi.md`, `flask.md`, `gin.md`,
`maui.md`, `nextjs.md`, `rails.md`, `react.md`, `spring.md`, `vue.md`.

Deterministic readers for framework-specific file types — parser plugins that
emit anchored structure rather than prose conventions — are tracked as OpenSpec
changes under `openspec/changes/`, not authored in this directory. `maui` is the
target that needs them: its markup (`.xaml`/`.csproj`/`.feature`) is read by the
`mobile-maui-support` change. `angular` deliberately gets **no** such reader — its
separate `.html` templates are handled by the addendum above plus the analyzing
AI, the same way other split-template front-end frameworks (`react`, `vue`) are;
the `web-angular-support` change adds the addendum, not a parser.
