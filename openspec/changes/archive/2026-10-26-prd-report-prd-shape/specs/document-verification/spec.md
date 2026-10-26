## MODIFIED Requirements

### Requirement: 可单独调用并可就地改正

`excavator-verify` SHALL 可对任意既有文档单独调用，默认只产出核对报告；带 `--fix` 时 SHALL 就地改正文档：替换错误陈述、把可定论的未决项改写为定论、统一冲突表述、把证据补入相应 `<details>`，并在文末追加核对摘要（计数与源码基线）。同时带 `--no-summary` 时 MUST NOT 在文档里追加核对摘要，计数只写在报告里；没有 `--fix` 时 `--no-summary` 不起作用。`--fix` MUST NOT 新增流程或内容、MUST NOT 加入评价或建议。

#### Scenario: 对既有 PRD 单独核对
- **WHEN** 用户以既有 PRD 路径与项目根调用 `excavator-verify`
- **THEN** 产出核对报告，文档本身不变

#### Scenario: 改正不扩写
- **WHEN** 以 `--fix` 调用且发现一条 contradicted 陈述
- **THEN** 仅替换该陈述为有证据支撑的正确说法，文档的流程清单与章节结构不变

#### Scenario: 不追加摘要
- **WHEN** 以 `--fix --no-summary` 调用
- **THEN** 文档按核对结果改正，但末尾没有新增的核对摘要；报告照常含计数表
