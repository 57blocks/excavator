## ADDED Requirements

### Requirement: 读取器放不下的行进缺口

读取器报告的 `unplaced` 段（`reason` 与行范围）SHALL 带进该文件的结构结果行，写作 `reason`、`startLine`、`endLine`。`unplaced` MUST NOT 计入符号数：只有 `unplaced` 的文件状态仍为 `zero-symbol`。

覆盖账本 SHALL 按语言把这些段汇总成一条缺口 `unplaced-lines`：
- `count` 为各段行数之和；
- 样本写作 `路径:起-止 原因`，按结构结果的顺序取。

结构结果里没有 `unplaced` 段的语言，不产这条缺口。

#### Scenario: `.feature` 放不下的行可见
- **GIVEN** 一个项目含一个合法的 `.feature`，和一个只有三行散文的 `.feature`
- **WHEN** 抽取结构并建账本
- **THEN** 散文文件的状态为 `zero-symbol`
- **AND** `gaps` 含 `{kind: "unplaced-lines", scope: "feature", count: 3}`，它的样本指向散文文件的第 1–3 行
- **AND** 合法文件的状态为 `parsed`，它不出现在样本里
