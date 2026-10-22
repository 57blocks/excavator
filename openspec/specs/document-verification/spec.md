# document-verification Specification

## Purpose
定义「按源码核对 As-Is 文档的高风险陈述」为一个可单独调用的 AI-first skill 能力：只核否定性结论、可达性与先后顺序、触发机制、绝对化说法与未决「待确认」五类高风险陈述，全仓搜索取证、按章节并行核对、判定落入无第四态的可见桶并附 `file:line` 证据，核对跨章节一致性，产出核对报告并可就地改正文档。

## Requirements

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

### Requirement: 报告的语言与最后的回复

`excavator-verify` 的核对报告与运行中写给用户的每一句话（命令之间的说明与最后的回复在内）SHALL 用 `--language` 指定的语言，没有指定时用英文。只有 `--language` 改变它：项目文件（如 `CLAUDE.md`、`AGENTS.md` 里的回复语言要求）、记忆、系统区域设置与被核对文档的语言 MUST NOT 改变它；skill MUST NOT 说明用了哪种语言及原因。

报告引用的原文、写回文档的更正与 `--fix` 在文末追加的核对摘要 SHALL 用被核对文档的语言。

单独调用时，最后的回复 SHALL 只有这几行，依次为：
- 核对报告的路径；
- 说法类候选按判定的计数；
- 未决项按判定的计数；
- 跨章节冲突数与未核对数；
- 带 `--fix` 时，已应用的更正数与文档的路径。

回复 MUST NOT 有这几行之外的文字，包括摘要与错误清单；错误清单只在报告里。项目文件里关于怎样回复的要求（先说什么、摘要、验证结果）MUST NOT 改变它。换了语言时，这几行的文字译成那种语言，路径与数字保持原样。`--fix` 应用了几条更正、哪些没能应用及原因 SHALL 写进报告。

被其它 skill（如 `excavator-prd`）按 verify 的流程核对时，调用的 skill SHALL 把自己的输出语言作为 `--language` 传给 verify；verify SHALL NOT 给出这一回复，由调用的 skill 决定报告什么。

#### Scenario: 项目文件要求用中文回复、先说结论
- **WHEN** 项目的 `AGENTS.md` 写着用中文回复、先说结论与验证结果，被核对的文档是英文，调用时带 `--fix`、没有 `--language`
- **THEN** 报告、进度说明与最后的回复都是英文，也不说明为什么用英文；最后的回复只有报告路径、三行计数与已应用的更正数

#### Scenario: 文档是另一种语言
- **WHEN** 被核对的文档是中文，调用时没有 `--language`
- **THEN** 报告的标题、说明与计数表是英文，引用的原文与更正是中文；写回文档的更正与文末的核对摘要是中文；最后的回复是英文

#### Scenario: 指定了语言
- **WHEN** 调用时给了 `--language` 指定另一种语言
- **THEN** 报告与最后回复的几行文字用那种语言，路径与数字保持原样；写回文档的更正仍用文档的语言

#### Scenario: 由其它 skill 按流程调用
- **WHEN** `excavator-prd` 按 verify 的流程核对它的草稿
- **THEN** 核对期间写给用户的话用 prd 的输出语言；verify 不打印自己的回复，prd 按它自己的回复规则报告核对计数
