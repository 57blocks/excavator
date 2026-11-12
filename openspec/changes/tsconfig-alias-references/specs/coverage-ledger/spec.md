## MODIFIED Requirements

### Requirement: 覆盖表与缺口表进发布图

The published graph SHALL contain `coverage.byLanguage[lang] = {files, parsed, zeroSymbol, skipped{reason: count}, kinds{function, class, import, export, call}}` and `coverage.ignored`. A language with `files > 0` and `parsed = 0` SHALL produce gap `no-extractor`. Unresolved imports SHALL produce gap `imports-unresolved` per language. Import specifiers that the import map records as ambiguous SHALL produce gap `imports-ambiguous` per language, counted once per file and specifier, with samples written as `path → specifier (candidate | candidate)`; they SHALL NOT also be counted under `imports-unresolved`. Call resolution outcomes SHALL produce `calls-unresolved` and `calls-ambiguous` per language.

#### Scenario: 无抽取器语言可见
- **GIVEN** a project with 622 `.html` files and no HTML extractor
- **WHEN** the graph is built
- **THEN** `coverage.byLanguage.html.files` is 622, `parsed` is 0, and `gaps` contains `{kind: "no-extractor", scope: "html", count: 622}`

#### Scenario: 歧义别名单独成缺口
- **GIVEN** a TypeScript file that imports `@/foo`, which two referenced tsconfigs map to `app/foo.ts` and `web/foo.ts`, and imports the external package `react`
- **WHEN** the graph is built
- **THEN** `gaps` contains `{kind: "imports-ambiguous", scope: "typescript", count: 1}` with the sample `main.ts → @/foo (app/foo.ts | web/foo.ts)`, and `imports-unresolved` for `typescript` counts 1 (only `react`)
