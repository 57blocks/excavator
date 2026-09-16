## Purpose

让 scan 事实层与 source-index 统一排除 Excavator 自身产生的游离目录（`.excavator` 的变体备份、`.trash-*` 回收目录），消除切片 C 观察到的索引/事实层污染，且不误伤仍需读取的 `.excavatorignore`。

## ADDED Requirements

### Requirement: 排除 `.excavator` 变体备份目录

selection SHALL 排除 `.excavator` 的变体备份目录（如 `.excavator.slicec-bak`、`.excavator-old` 等匹配 `.excavator.*/`、`.excavator-*/` 的目录），使其既不进 scan 事实层也不进 source-index。真相源为 core 的 `DEFAULT_IGNORE_PATTERNS`；scan walker 的 hard-skip 子集与 `staleness.ts` 的 exclude 列表 SHALL 与之保持一致，MUST NOT 另立第二真相源。

#### Scenario: 变体备份目录不进任一链路

- **WHEN** 项目根存在 `.excavator.bak/` 与 `.excavator-old/` 目录并运行分析
- **THEN** 这两个目录中的文件既不出现在 scan 事实层输出中，也不出现在 source-index 中

### Requirement: 排除 `.trash-*` 回收目录

selection SHALL 排除匹配 `.trash-*/` 的回收目录，使其不进 scan 事实层与 source-index。

#### Scenario: trash 目录不进任一链路

- **WHEN** 项目根存在 `.trash-1234/` 目录并运行分析
- **THEN** 该目录中的文件既不进 scan 事实层也不进 source-index

### Requirement: 不误伤 `.excavatorignore`

selection 的新增排除模式 MUST NOT 排除 `.excavatorignore` 文件；`.excavatorignore` SHALL 仍作为 ignore 规则源被读取。

#### Scenario: `.excavatorignore` 仍被读取

- **WHEN** 项目根同时存在 `.excavatorignore` 文件与 `.excavator.bak/` 目录
- **THEN** `.excavatorignore` 仍被当作 ignore 规则源读取并生效，只有 `.excavator.bak/` 被排除
