# prd-generation Specification

## Purpose
定义「从代码反向产出面向指定读者的 As-Is PRD」为一个 AI-first skill 能力：以知识图加速流程发现、从源码补齐调用图看不见的行为、覆盖全流程不精选，并产出可读、正文无代码、证据可追溯的文档。

## Requirements

### Requirement: 完整流程清单覆盖全流程

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

### Requirement: 补齐调用图看不见的行为

`excavator-prd` SHALL 在流程发现中显式从源码搜寻不以调用边形式存在的产品行为：对外通知/消息、定时/后台任务、权限/鉴权、外部服务集成。对每一项 SHALL 记录其触发时机、作用对象与内容/效果。

#### Scenario: 通知细节
- **WHEN** 某流程成功后向外发出通知
- **THEN** PRD 写清触发时机、接收方与消息内容，而非只说「会发送通知」

#### Scenario: 缺图回退
- **WHEN** 项目没有知识图
- **THEN** skill 进入 source-only 模式，直接从源码发现流程并继续产出，而非中止

### Requirement: 面向读者、可读、正文无代码

`excavator-prd` SHALL 用 `--role`（默认产品经理）的产品语言写作，`--language` 决定输出语言，没有指定时用英文。正文 MUST NOT 出现代码、签名、SQL 或配置字面量；数字枚举/状态码/字段值 SHALL 翻译为人类含义，码表只进字段字典表。证据（`file:line`）SHALL 放入可折叠区而非正文，并 SHALL 使用表格/列表/mermaid 提升可读性。

#### Scenario: 枚举翻译
- **WHEN** 某状态在源码中是数字码（如 `status=2`）
- **THEN** PRD 正文以其含义呈现（如「已完成」），裸码不出现在叙述中

#### Scenario: 图与证据
- **WHEN** 描述一条跨层流程
- **THEN** PRD 提供对应的 mermaid 图，并把该流程的 `file:line` 证据折叠在 `<details>` 中

### Requirement: 保留源专名，只翻译通用叙述

当 `--language` 与源语言不同，PRD SHALL 保留产品/功能名、模块名与 UI 可见标签（菜单、页签、按钮、字段、状态名）的源语言原形，只翻译其外围的通用叙述；MUST NOT 为已命名实体另造译名，即使它作为普通名词出现。为使其自一致，PRD SHALL 在顶部声明术语表（源术语 | 含义），并在全文（正文、标题、表格、图标签）复用这些源术语。

#### Scenario: 已命名实体在行文中被引用
- **WHEN** 描述性行文需要指代一个源语言命名的功能/实体
- **THEN** 使用其源术语原形，而非目标语言译名或同义词

#### Scenario: 术语自审
- **WHEN** 生成收尾
- **THEN** skill 枚举全文用于指代该实体的词，任一译名变体替换回源术语，报告 0 translated-variant leaks

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
