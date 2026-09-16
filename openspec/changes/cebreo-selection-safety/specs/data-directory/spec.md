## MODIFIED Requirements

### Requirement: 忽略文件为 .excavatorignore

The authoritative per-project ignore file SHALL be `.excavatorignore` at the project root. The starter generator SHALL write that path, and source adapters SHALL consume the same content. No code SHALL read an ignore file from inside `.excavator/` or from any pre-rename data directory. A GitCommitSnapshot SHALL use the root `.excavatorignore` from HEAD; directory-based snapshots SHALL use the root file on disk.

#### Scenario: 生成器写新名
- **WHEN** the ignore starter generator runs on an empty non-Git project
- **THEN** `<project>/.excavatorignore` is created and the next scan consumes its rules

#### Scenario: Git 分析只使用 HEAD 中的规则
- **WHEN** committed `.excavatorignore` content differs from an unstaged working-tree edit
- **THEN** GitCommitSnapshot selects files using the committed content

#### Scenario: 数据目录里的同名文件无效
- **WHEN** only `<project>/.excavator/.excavatorignore` exists
- **THEN** it is not treated as a project selection rule

## ADDED Requirements

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
