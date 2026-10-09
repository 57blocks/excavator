## ADDED Requirements

### Requirement: 写后核对

`excavator-prd` 在写作时对否定性结论、可达性与顺序、触发机制、绝对化与不变性说法 SHALL 先做全仓搜索取证；无法取证时 SHALL 写成「待确认」并注明已搜索的范围。保存前 SHALL 按 `excavator-verify` 的流程以 `--fix` 核对已写成的 PRD，并在自检结果中报告其各判定桶计数。

#### Scenario: 否定性结论先取证
- **WHEN** 研究中得出「某操作不产生会计分录」
- **THEN** 该结论附带全仓搜索范围作为证据；未搜索全仓则写成「待确认」并列出已搜范围

#### Scenario: 保存前核对
- **WHEN** PRD 写作完成
- **THEN** 先执行 `excavator-verify --fix`，改正后再保存，并报告核对计数（含 contradicted、misattributed、resolved、still-open）

### Requirement: 文档信息给出范围代码量

`excavator-prd` 的文档信息 SHALL 写明范围内的文件数与行数，且这两个数 SHALL 由命令统计后原样写入（Git 项目按 `git ls-files`，非 Git 项目按目录遍历），MUST NOT 由模型估计。

#### Scenario: 限定范围的 PRD
- **WHEN** 以 `--scope <目录>` 生成 PRD
- **THEN** 文档信息给出该目录下的文件数与行数，与对同一目录执行统计命令的结果一致

