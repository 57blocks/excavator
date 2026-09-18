# data-directory Specification

## Purpose
被分析项目的数据目录、忽略文件与默认排除规则的单一契约；确定性脚本、模型侧 skill 与问答服务都以它为准，不存在第二个目录名。

## Requirements

### Requirement: 数据目录唯一为 .excavator

All artifacts of an analysed project SHALL be written under `<project>/.excavator/`. The directory name SHALL be defined by exactly one constant in `packages/core/src/persistence` and imported by TypeScript consumers; shell, Python and Markdown consumers SHALL hardcode the same literal. No code path SHALL probe for, read, or migrate `.ua/` or `.understand-anything/`.

#### Scenario: 无回退探测
- **GIVEN** a project containing a `.ua/` directory and no `.excavator/`
- **WHEN** scan or persistence runs
- **THEN** the project is treated as never analysed and artifacts are written to `.excavator/`

#### Scenario: 源码无回退字面量
- **WHEN** `grep -rnE '\.understand-anything|\.ua\b' packages skills agents hooks src scripts tests` runs
- **THEN** it matches nothing

### Requirement: 忽略文件为 .excavatorignore

The authoritative per-project ignore file SHALL be `.excavatorignore` at the project root. The host skill SHALL create or update only that path after inspecting the project, and source adapters SHALL consume the same content. No code SHALL read an ignore file from inside `.excavator/` or from any pre-rename data directory. A GitCommitSnapshot SHALL use the root `.excavatorignore` from HEAD; directory-based snapshots SHALL use the root file on disk.

#### Scenario: 生成器写新名
- **WHEN** the root file is absent and the host skill is invoked in Lazy or Full mode
- **THEN** a lightweight preflight reviews scanner evidence, creates `<project>/.excavatorignore` without a dedicated generator, and applies approved rules to the current run

#### Scenario: Git 分析只使用 HEAD 中的规则
- **WHEN** committed `.excavatorignore` content differs from an unstaged working-tree edit
- **THEN** GitCommitSnapshot selects files using the committed content

#### Scenario: 数据目录里的同名文件无效
- **WHEN** only `<project>/.excavator/.excavatorignore` exists
- **THEN** it is not treated as a project selection rule

### Requirement: 默认排除 agent 目录与数据目录

`DEFAULT_IGNORE_PATTERNS` SHALL include `.claude/`, `.agents/`, `.codex/` and `.excavator/`. The scanner's self-exclusion list SHALL be a subset of `DEFAULT_IGNORE_PATTERNS`. Files excluded by these patterns SHALL be counted in a dedicated default-filter ledger field (`filteredByDefaults`) and SHALL NOT be silently dropped — this keeps the default-pattern exclusion visible and distinct from user-authored `.excavatorignore` exclusions (`filteredByIgnore`), so no input lands in an unaccounted-for bucket.

#### Scenario: 插件文件不进清单
- **GIVEN** a fixture project with files under `.claude/skills/x/SKILL.md`, `.agents/skills/y/SKILL.md`, `.codex/z.md` and `.excavator/config.json`
- **WHEN** scan-project runs
- **THEN** none of those files appear in the scan manifest, and `filteredByDefaults` counts at least four files

#### Scenario: 两处列表一致
- **WHEN** the unit test comparing the scanner's self-exclusion list with `DEFAULT_IGNORE_PATTERNS` runs
- **THEN** every scanner entry is present in `DEFAULT_IGNORE_PATTERNS`

### Requirement: 安全排除不可被项目规则覆盖

Default rules, root `.excavatorignore`, and CLI rules SHALL be combined in deterministic documented order, but project and CLI negations MUST NOT re-include `.excavator/`, its variant/backup directories, archive defaults, or files classified as sensitive. Ordinary defaults MAY still be negated where the safety boundary does not forbid it.

#### Scenario: 普通默认项可按契约恢复
- **WHEN** a project explicitly negates an ordinary default such as `!LICENSE`
- **THEN** `LICENSE` is selected

#### Scenario: 安全项不可恢复
- **WHEN** a project or CLI rule negates `.excavator/`, `*.zip`, or a sensitive key path
- **THEN** the safety item remains excluded and the effective selection reports the rejected override

### Requirement: 选择规则进入 selectionDigest

The source manifest `selectionDigest` SHALL deterministically cover the versioned built-in selection policy, the authoritative root `.excavatorignore` content, CLI selection rules, and sensitive-detection policy. Changing any of them SHALL change `selectionDigest` and trigger the existing rebuild behavior even when source revision is unchanged.

#### Scenario: 安全策略升级触发重建
- **WHEN** the built-in sensitive extension set or language filename-pattern semantics change
- **THEN** `selectionDigest` changes and stale deterministic artifacts are rebuilt

### Requirement: 跨平台确定性噪声使用保守全局默认

The built-in ordinary defaults SHALL exclude operating-system metadata and unambiguous tool caches consistently across POSIX and Windows path spellings. They SHALL include `.DS_Store`, AppleDouble `._*`, `__MACOSX/`, `Thumbs.db`, `ehthumbs.db`, `ehthumbs_vista.db`, `Desktop.ini`, `$RECYCLE.BIN/`, `System Volume Information/`, `.vs/`, and `.gradle/`. Matching SHALL normalize Windows separators and retain the existing case-insensitive semantics. Broad names that can contain source, including `bin/`, MUST remain outside the global defaults.

#### Scenario: Windows 元数据跨路径格式一致排除
- **WHEN** candidates use `src\\Thumbs.db`, `DESKTOP.INI`, `.VS\\cache.bin`, or `$RECYCLE.BIN\\item`
- **THEN** each candidate is `filtered-by-defaults` after normalization

#### Scenario: Windows 风格 bin 源码不被全局排除
- **WHEN** a candidate path is `bin\\rails` and no project rule excludes `bin/`
- **THEN** it remains selected
