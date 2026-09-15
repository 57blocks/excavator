## Purpose

扫描到的每个输入必落一个可见桶：解析成功、零符号、或带原因的跳过；不能解析的 import 与调用、没有抽取器的语言、某语言某种类为零，都以缺口记录；覆盖率的分母包含被跳过的文件。

## ADDED Requirements

### Requirement: 跳过按原因分桶

The scanner SHALL record every file it does not hand to extraction under exactly one reason ∈ {`symlink`, `read-failed`, `unknown-language`, `binary`, `too-large`, `ignored`}, and SHALL publish the size limits it applied under `coverage.limits`. The structural extractor SHALL record per file a `status` ∈ {`parsed`, `zero-symbol`, `no-extractor`, `parse-failed`} and SHALL NOT drop failed files from its results. The import resolver SHALL record unresolved specifiers per file.

#### Scenario: 每个输入落一桶
- **GIVEN** a fixture with a symlink, an unreadable file, a `.xyz` file, a `.dll` file, a file above the size limit, a file under `.claude/`, an `.html` file, a file with a syntax error, and two parsable files
- **WHEN** scan and extraction run
- **THEN** every file appears in exactly one of: parsed, zero-symbol, no-extractor, parse-failed, or a skip reason, and none is absent

#### Scenario: 守恒
- **WHEN** coverage is computed for any language
- **THEN** `files = parsed + zeroSymbol + Σ skipped[reason]`

### Requirement: 覆盖表与缺口表进发布图

The published graph SHALL contain `coverage.byLanguage[lang] = {files, parsed, zeroSymbol, skipped{reason: count}, kinds{function, class, import, export, call}}` and `coverage.ignored`. A language with `files > 0` and `parsed = 0` SHALL produce gap `no-extractor`. Unresolved imports SHALL produce gap `imports-unresolved` per language. Call resolution outcomes SHALL produce `calls-unresolved` and `calls-ambiguous` per language.

#### Scenario: 无抽取器语言可见
- **GIVEN** a project with 622 `.html` files and no HTML extractor
- **WHEN** the graph is built
- **THEN** `coverage.byLanguage.html.files` is 622, `parsed` is 0, and `gaps` contains `{kind: "no-extractor", scope: "html", count: 622}`

### Requirement: 分母诚实

Any coverage ratio reported by the pipeline or the benchmark SHALL use `parsed + zeroSymbol + skipped` as the denominator.

#### Scenario: 跳过文件进分母
- **GIVEN** 10 files of which 8 parsed, 0 zero-symbol, 2 skipped
- **WHEN** the benchmark computes structure coverage
- **THEN** it reports 0.8, not 1.0
