## MODIFIED Requirements

### Requirement: 写后核对

`excavator-prd` 在写作时对否定性结论、可达性与顺序、触发机制、绝对化与不变性说法 SHALL 先做全仓搜索取证；无法取证时 SHALL 写成「待确认」并注明已搜索的范围。保存前 SHALL 按 `excavator-verify` 的流程以 `--fix` 核对已写成的 PRD，并在自检结果中报告其各判定桶计数。

#### Scenario: 否定性结论先取证
- **WHEN** 研究中得出「某操作不产生会计分录」
- **THEN** 该结论附带全仓搜索范围作为证据；未搜索全仓则写成「待确认」并列出已搜范围

#### Scenario: 保存前核对
- **WHEN** PRD 写作完成
- **THEN** 先执行 `excavator-verify --fix`，改正后再保存，并报告核对计数（含 contradicted、misattributed、resolved、still-open）

### Requirement: 写给用户的话与最后的回复

`excavator-prd` 运行中写给用户的每一句话（命令之间的进度说明、打印的流程清单与大纲，以及关于查了什么、下一步做什么、依据哪条规则的说明在内）、PRD 与最后的回复 SHALL 用 `--language` 指定的语言，没有指定时用英文。只有 `--language` 改变它：项目文件（如 `CLAUDE.md`、`AGENTS.md` 里的回复语言要求）、记忆、系统区域设置与代码库的语言 MUST NOT 改变它；skill MUST NOT 说明用了哪种语言及原因。

最后的回复 SHALL 只有这几行，依次为：
- PRD 所在的路径；
- 覆盖、图、术语与核对四项自检的计数；
- 保存进项目的提议。PRD 已在用户给出的路径上时，没有这一行。

回复 MUST NOT 有这几行之外的文字，包括摘要、结论与对核对结果的挑选。项目文件里关于怎样回复的要求（先说什么、摘要、验证结果）MUST NOT 改变它。换了语言时，这几行的文字译成那种语言，路径与数字保持原样。

保存进项目 SHALL 仍是提议：用户同意之前，skill MUST NOT 把 PRD 写进项目。

#### Scenario: 项目文件要求用中文回复、先说结论
- **WHEN** 项目的 `AGENTS.md` 写着用中文回复、先说结论与验证结果，调用时没有 `--language`
- **THEN** 打印的流程清单、大纲、进度说明、PRD 与最后的回复都是英文，也不说明为什么用英文；最后的回复只有路径、四项计数与保存的提议

#### Scenario: 指定了语言
- **WHEN** 调用时给了 `--language` 指定另一种语言
- **THEN** PRD 用那种语言，最后回复的几行文字也译成那种语言，路径与数字保持原样

#### Scenario: 用户没有给出保存路径
- **WHEN** 调用没有给出 PRD 的保存路径
- **THEN** PRD 留在第 5 步写下的位置，回复的最后一行提议保存进项目的默认路径，skill 不自行写进项目

## REMOVED Requirements

### Requirement: 完整流程清单覆盖全流程

**Reason**: 入口目录、`index.json` 与守恒检查随流水线移到 `excavator-prd-report`；单篇版的要求以「单篇 PRD 的流程清单覆盖全流程」新增恢复（同名的删加不被允许）。
**Migration**: 需要入口目录与守恒检查时改用 `/excavator-prd-report`。

### Requirement: 按功能并发产出与断点续跑

**Reason**: 按功能并发的流水线移到 `excavator-prd-report`。
**Migration**: 需要按功能拆分、findings 与产物目录时改用 `/excavator-prd-report`。

### Requirement: 功能级发现

**Reason**: 功能级 findings 移到 `excavator-prd-report`。
**Migration**: 需要按功能拆分、findings 与产物目录时改用 `/excavator-prd-report`。

### Requirement: 只写输出目录，不改目标的既有产物

**Reason**: 输出目录约定随流水线移到 `excavator-prd-report`；`excavator-prd` 恢复为单篇写作。
**Migration**: 需要按功能拆分、findings 与产物目录时改用 `/excavator-prd-report`。

### Requirement: 产物目录与单文件拼装

**Reason**: 产物目录与拼装移到 `excavator-prd-report`。
**Migration**: 需要按功能拆分、findings 与产物目录时改用 `/excavator-prd-report`。
## ADDED Requirements

### Requirement: 单篇 PRD 的流程清单覆盖全流程

`excavator-prd` SHALL 在写作前建立一份覆盖 scope 内全部流程的清单，MUST NOT 为篇幅精选或静默丢弃任何流程。清单 SHALL 同时来自知识图的调用/结构流，以及对源码的补充发现；每个流程 SHALL 缝合为跨层的端到端条目（前端触发 ↔ 后端处理 ↔ 下游副作用）。

#### Scenario: 覆盖自检
- **WHEN** 生成完成
- **THEN** skill 产出「清单项 → PRD 章节」映射并报告 `N/N`，未覆盖项要么补上要么显式标注超范围，无静默丢弃

#### Scenario: 跨网络边界的流程
- **WHEN** 一个用户流程由前端经 HTTP/gRPC 调用后端，两端之间没有源码 import 连接
- **THEN** skill 通过匹配前端请求与后端路由把两端缝合为一条端到端流程，而非割裂成两条

#### Scenario: 页面真实挂载路径
- **WHEN** 某页面组件位于某功能目录，但其路由注册在共享的 router/outlet/layout 文件中
- **THEN** skill 顺路由注册确定该页面的真实 URL 与导航语境（所属 hub/tab、默认落地路由），不从目录路径臆测路由；组件在范围内而挂载点在范围外的页面仍属范围内
