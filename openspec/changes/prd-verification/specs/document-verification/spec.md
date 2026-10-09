## ADDED Requirements

### Requirement: 只核高风险陈述类别

`excavator-verify` SHALL 从文档中按语义选出五类高风险陈述作为核对候选：否定性结论、可达性与先后顺序、触发机制、绝对化与不变性说法、未决项（如「待确认」）。标记词 SHALL 只作检索起点，候选由语义判定；核对报告 SHALL 声明这一核对范围，MUST NOT 暗示已核对全部陈述。

#### Scenario: 候选选择
- **WHEN** 文档中出现「X 不会发送事件」「规则 Y 实际不可达」「Z 由事件触发」「无论配置如何一律为 W」或「待确认」
- **THEN** 每条都进入候选清单并标注所属类别与行号

#### Scenario: 范围声明
- **WHEN** 产出核对报告
- **THEN** 报告写明只核对了上述五类陈述与跨章节一致性

### Requirement: 否定性结论须全仓取证

对否定性结论，`excavator-verify` SHALL 在整个项目中搜索反例（全部模块、监听器与事件注册、调度与批处理注册、SQL 与迁移脚本、配置文件）后才可判为属实，并 SHALL 在证据中记录搜索范围。

#### Scenario: 局部未见不等于不存在
- **WHEN** 文档称「某操作不会触发某重算」而被引用的服务类中确无调用
- **THEN** 核对仍须搜索全仓的事件监听与调度注册；找到触发路径则判为 contradicted 并给出 `file:line`

### Requirement: 判定无第四态

每个候选 SHALL 落入且仅落入一个可见判定桶：说法类为 verified / contradicted / misattributed / unverifiable，未决项为 resolved-right / resolved-wrong / still-open（resolved-wrong 表示代码已定论且文档的暂定说法错误，计入错误）；子代理未返回的候选 SHALL 计为 not-checked。报告 SHALL 给出各桶计数且计数之和等于候选总数；contradicted / misattributed 条目 SHALL 附原文引用与源码 `file:line`。

#### Scenario: 子代理漏项
- **WHEN** 某章节的核对子代理未返回其中一条候选
- **THEN** 该候选计入 not-checked 并出现在报告中，而非从计数里消失

#### Scenario: 计数由逐条结果统计
- **WHEN** 子代理返回的汇总计数与其逐条结果不一致
- **THEN** 报告的「类别 × 判定」表按逐条结果逐格统计，各行合计等于每类候选数、总计等于候选总数，不采用子代理的汇总计数

### Requirement: 按章节并行核对

`excavator-verify` SHALL 按文档顶层章节（或合并后的章节组）并行派出核对子代理，每个子代理只拿到其章节的行号范围、候选清单与核对规则，并返回逐条判定、证据与（若有错）改正句。

#### Scenario: 大文档
- **WHEN** 文档有十余个顶层章节、近万行
- **THEN** 核对按章节组并行执行，而非由单一代理串行处理全文

### Requirement: 跨章节一致性

`excavator-verify` SHALL 对候选涉及的主题在全文中查找其它表述；同一事实在不同章节说法冲突时 SHALL 以源码定论并报告该冲突。

#### Scenario: 未决项与正文冲突
- **WHEN** 某处「待确认」的暂定说法与另一章节的明确说法相反
- **THEN** 报告列出这组冲突与源码定论；`--fix` 时两处统一为定论

### Requirement: 可单独调用并可就地改正

`excavator-verify` SHALL 可对任意既有文档单独调用，默认只产出核对报告；带 `--fix` 时 SHALL 就地改正文档：替换错误陈述、把可定论的未决项改写为定论、统一冲突表述、把证据补入相应 `<details>`，并在文末追加核对摘要（计数与源码基线）。`--fix` MUST NOT 新增流程或内容、MUST NOT 加入评价或建议。

#### Scenario: 对既有 PRD 单独核对
- **WHEN** 用户以既有 PRD 路径与项目根调用 `excavator-verify`
- **THEN** 产出核对报告，文档本身不变

#### Scenario: 改正不扩写
- **WHEN** 以 `--fix` 调用且发现一条 contradicted 陈述
- **THEN** 仅替换该陈述为有证据支撑的正确说法，文档的流程清单与章节结构不变
