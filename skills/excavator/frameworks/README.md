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

## Where framework knowledge lives

Framework knowledge has three homes. Each piece goes to the lowest one that can
carry it correctly, so that every language and framework is handled the same
way.

1. **Detection and layer hints: a `FrameworkConfig`.** This is
   `packages/core/src/languages/frameworks/<id>.ts`. It holds detection
   keywords, manifest files, entry-point file names and directory-to-layer
   hints. It is data only. A framework never gets its own detection or dispatch
   code.
2. **Conventions the analysing model applies: an addendum here.** Anything a
   model can settle by reading one file and querying the graph goes here:
   - dependency injection by type (`@Inject FooService`, an Angular constructor
     parameter, FastAPI `Depends`). The `imports` and `calls` edges already
     link the two classes;
   - component roles and layers;
   - route registration (Express `app.use`, Gin `r.Group`, Spring or JAX-RS
     annotations);
   - interface to implementation. The graph's `implements` edges answer "how
     many implementations".

   Edges drawn from these conventions are `inferred`.
3. **Deterministic facts in the fact graph.** Use this home only for a
   relationship that one file plus the graph cannot settle, where a guess would
   be a fabrication. The typical case is a string name in one file that a
   declaration in another file binds: EL `#{orders}`, Spring `ref="svc"`,
   `@EJB(beanName = "…")`. Even then the framework knowledge stays data. It is
   a declarative catalog (`../catalogs/name-bindings.json`) read by a
   framework-neutral engine. That engine scopes names to the deployment unit,
   turns an ambiguity into a visible gap and counts every input. Product code
   never branches on a framework.

Language-level facts belong to no framework and are deterministic for every
language. They are:
- imports, including tsconfig path aliases and go.mod module paths;
- calls, inheritance, `implements` and `overrides`;
- literal class names and paths written in non-code files.

A framework's own file type (XAML) gets a parser like any other language.

**Moving a relationship up to the third home.** First ask: can a model reading
this file, with `traverse` and `read_evidence`, decide it? If yes, it stays in
the addendum. A structural fact may still need determinism, for two reasons:
- an absence claim needs the complete set (dead-code roots);
- a model would otherwise have to copy it out at volume (a route table).

In that case, propose a catalog for the whole family as its own OpenSpec
change, for example every annotation-based route framework together. Never do
it for one framework alone.

What is where today:

| Knowledge | Home |
|---|---|
| Detection and layer hints for every framework listed below | `FrameworkConfig` |
| DI by type, component roles, HTTP routes (Spring, Angular, Express, Gin, FastAPI, …) | addenda |
| Endpoints from schema files (GraphQL, protobuf) | deterministic parsers |
| EL names to bean classes (JSF, JSP, Seam, the Spring EL bridge) | deterministic, `catalogs/name-bindings.json` |
| XML injection names to the classes they wire (Spring `ref=`, `p:`/`c:` refs, `lookup-method`) | deterministic, `catalogs/name-bindings.json` |
| Literal class names and paths in descriptors and pages | deterministic, framework-neutral `mentions` |
| MAUI markup (`.xaml`, `.csproj`, `.feature`) | deterministic parsers |

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
