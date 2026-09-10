## Purpose

被分析项目的数据目录、忽略文件与默认排除规则的单一契约；确定性脚本、模型侧 skill 与 dashboard 都以它为准，不存在第二个目录名。

## ADDED Requirements

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

The per-project ignore file SHALL be `.excavatorignore` at the project root; the starter file generator SHALL write that name; no code SHALL read `.understandignore`.

#### Scenario: 生成器写新名
- **WHEN** the ignore starter generator runs on an empty project
- **THEN** `.excavatorignore` is created and its header names `.excavatorignore`

### Requirement: 默认排除 agent 目录与数据目录

`DEFAULT_IGNORE_PATTERNS` SHALL include `.claude/`, `.agents/`, `.codex/` and `.excavator/`. The scanner's self-exclusion list SHALL be a subset of `DEFAULT_IGNORE_PATTERNS`. Files excluded by these patterns SHALL be counted under reason `ignored` in the scan ledger, not silently dropped.

#### Scenario: 插件文件不进清单
- **GIVEN** a fixture project with files under `.claude/skills/x/SKILL.md`, `.agents/skills/y/SKILL.md`, `.codex/z.md` and `.excavator/config.json`
- **WHEN** scan-project runs
- **THEN** none of those files appear in the scan manifest, and the ledger counts four files under reason `ignored`

#### Scenario: 两处列表一致
- **WHEN** the unit test comparing the scanner's self-exclusion list with `DEFAULT_IGNORE_PATTERNS` runs
- **THEN** every scanner entry is present in `DEFAULT_IGNORE_PATTERNS`
