# coverage-ledger Specification

## Purpose
扫描到的每个输入必落一个可见桶：解析成功、零符号、或带原因的跳过；不能解析的 import 与调用、没有抽取器的语言、某语言某种类为零，都以缺口记录；覆盖率的分母包含被跳过的文件。

## Requirements

### Requirement: 跳过按原因分桶

Every enumerated candidate SHALL land in exactly one visible selection or processing bucket. Pre-extraction outcomes SHALL distinguish `filtered-by-defaults`, `filtered-by-ignore`, and `sensitive`; selected files SHALL then end as `parsed`, `zero-symbol`, `no-extractor`, `parse-failed`, or one scanner skip reason in {`symlink`, `read-failed`, `unknown-language`, `binary`, `too-large`, `ignored`}. The import resolver SHALL record unresolved specifiers per file. A protected file MUST NOT disappear merely because its content cannot be reported.

#### Scenario: 每个输入落一桶
- **GIVEN** a fixture with a default-filtered file, a project-ignored file, a private key, a symlink, an unreadable file, a `.xyz` file, a `.dll` file, a file above the size limit, an `.html` file, a syntax-error file, and two parsable files
- **WHEN** selection, scan, and extraction run
- **THEN** every candidate appears in exactly one named bucket and none is absent or double-counted

#### Scenario: 敏感桶不泄露内容
- **GIVEN** a private-key fixture containing a unique canary string
- **WHEN** all persisted analysis artifacts and terminal output are searched for that canary
- **THEN** the canary is absent while the ledger reports one `sensitive` candidate using safe metadata only

#### Scenario: 守恒
- **WHEN** coverage is computed for any run
- **THEN** enumerated candidates equal selected candidates plus every pre-extraction exclusion bucket, and selected candidates equal extraction outcomes plus scanner skip outcomes

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
