# prd-report Specification

## Purpose
定义 `excavator-prd-report`：按功能写出项目全部的 As-Is PRD 章节与每个功能的产品、技术问题（findings），入口与功能清单由脚本守恒、各功能并发写作并可断点续跑、每章单独核对，产物是只写在 `--out` 下的一个目录与拼装出的一份 `PRD.md`。单篇 PRD 见 `prd-generation`。

## Requirements

### Requirement: 完整流程清单覆盖全流程

`excavator-prd-report` SHALL 在写作前把 scope 内的入口候选与功能清单写进 `<out>/index.json`，MUST NOT 为篇幅精选或静默丢弃任何候选。入口候选 SHALL 由确定性脚本按框架模式目录从源码列出；模式目录没有覆盖的框架 SHALL 记入 `candidates.uncovered`，模型为其补的入口 SHALL 标 `inferred` 并带 `file:line`。模型 SHALL 把候选分组成功能，每个功能带范围声明（入口、种子文件、涉及的层）；每个候选 SHALL 落且只落一个功能或 `unassigned`，脚本 SHALL 检查这一守恒与每个候选的文件存在、行号在界内，不成立则运行失败并打印差集；读产物目录的每个子命令 SHALL 由调用方给出项目根，并拒绝 `projectRoot` 与之不一致的索引。每个用户流程 SHALL 缝合为跨层的端到端功能；定时与后台行为 SHALL 作为 `automated` 功能进入同一清单。多个流程共用的模型（角色与权限、令牌或会话模型、共用的状态字典）SHALL 作为 `reference` 功能写成独立章节，其入口可以为空，章节顺序 SHALL 在全部 `flow` 与 `automated` 功能之前，脚本检查这一顺序。`--scope` 指向子目录时，模型 SHALL 在范围外搜寻范围内入口的调用方（发出请求的页面与客户端、调用它的其他服务），把含调用方的文件加入该功能的种子文件，调用方自己的流程不进入清单。

#### Scenario: 覆盖自检
- **WHEN** 汇总完成
- **THEN** `index.json` 的 `conservation.holds` 为真，覆盖表列出每个候选所属的功能与该功能的状态，`unassigned` 的候选可见

#### Scenario: 跨网络边界的流程
- **WHEN** 一个用户流程由前端经 HTTP/gRPC 调用后端，两端之间没有源码 import 连接
- **THEN** 该功能的范围声明同时含前端入口与后端路由，泳道把两端写成一条端到端描述，而非两个功能

#### Scenario: 页面真实挂载路径
- **WHEN** 某页面组件位于某功能目录，但其路由注册在共享的 router/outlet/layout 文件中
- **THEN** skill 顺路由注册确定该页面的真实 URL 与导航语境（所属 hub/tab、默认落地路由），不从目录路径臆测路由；组件在范围内而挂载点在范围外的页面仍属范围内

#### Scenario: 没有模式的框架
- **WHEN** 事实图头部列出的某个框架在模式目录里没有条目
- **THEN** 该框架出现在 `candidates.uncovered` 与最后的回复里；模型补的该框架入口每条带 `file:line`，脚本核对文件与行号存在

#### Scenario: 候选归属丢失
- **WHEN** 某候选既不在任何功能的 `entrypoints` 里也不在 `unassigned` 里
- **THEN** `check-index` 退出非零并打印该候选 id，运行不进入泳道

#### Scenario: 权限模型
- **WHEN** 范围内有角色、策略与守卫定义
- **THEN** 清单里有一个 `reference` 功能写角色与权限，章节号小于所有流程功能；`reference` 章节排在流程章节之后时 `check-index` 退出非零

#### Scenario: 范围外的调用方
- **WHEN** 以 `--scope <后端子目录>` 运行，范围外的前端页面向范围内的路由发请求
- **THEN** 该页面所在的文件进入对应功能的种子文件，章节的前端部分描述它；附录的覆盖小节给出范围外读过的种子文件按第一级目录的计数

### Requirement: 补齐调用图看不见的行为

`excavator-prd-report` SHALL 在流程发现中显式从源码搜寻不以调用边形式存在的产品行为：对外通知/消息、定时/后台任务、权限/鉴权、外部服务集成。对每一项 SHALL 记录其触发时机、作用对象与内容/效果。

#### Scenario: 通知细节
- **WHEN** 某流程成功后向外发出通知
- **THEN** PRD 写清触发时机、接收方与消息内容，而非只说「会发送通知」

#### Scenario: 缺图回退
- **WHEN** 项目没有知识图
- **THEN** skill 进入 source-only 模式，直接从源码发现流程并继续产出，而非中止

### Requirement: 面向读者、可读、正文无代码

`excavator-prd-report` SHALL 用 `--role`（默认产品经理）的产品语言写作，`--language` 决定输出语言，没有指定时用英文。正文 MUST NOT 出现代码、签名、SQL 或配置字面量；数字枚举/状态码/字段值 SHALL 翻译为人类含义，码表只进字段字典表。证据（`file:line`）SHALL 放入可折叠区而非正文，并 SHALL 使用表格/列表/mermaid 提升可读性。

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

`excavator-prd-report` 在写作时对否定性结论、可达性与顺序、触发机制、绝对化与不变性说法 SHALL 先做全仓搜索取证；无法取证时 SHALL 写成「待确认」并注明已搜索的范围。每个写好的功能 SHALL 单独按 `excavator-verify` 的流程以 `--fix` 与 `--no-summary` 核对，核对由编排者执行而非写作该功能的子代理；核对摘要 MUST NOT 写进章节，其计数 SHALL 原样记入 `index.json` 并由脚本求和后报告。findings SHALL 由脚本检查锚点与引文，`verdict` 固定为 `anchor-checked`，MUST NOT 被称为已核对。

#### Scenario: 否定性结论先取证
- **WHEN** 研究中得出「某操作不产生会计分录」
- **THEN** 该结论附带全仓搜索范围作为证据；未搜索全仓则写成「待确认」并列出已搜范围

#### Scenario: 保存前核对
- **WHEN** 一个功能的章节通过了泳道检查
- **THEN** 编排者对该章节执行 `excavator-verify --fix --no-summary`，把报告写到 `verification/<id>.md`，计数记入该功能的 `counts.verification`，章节里没有核对摘要；计数解析不出时该功能标 `failed`

### Requirement: 文档信息给出范围代码量

`excavator-prd-report` 的文档信息 SHALL 写明范围内的文件数与行数，且这两个数 SHALL 由命令统计后原样写入（Git 项目按 `git ls-files`，非 Git 项目按目录遍历），MUST NOT 由模型估计。

#### Scenario: 限定范围的 PRD
- **WHEN** 以 `--scope <目录>` 生成 PRD
- **THEN** 文档信息给出该目录下的文件数与行数，与对同一目录执行统计命令的结果一致

### Requirement: 写给用户的话与最后的回复

`excavator-prd-report` 运行中写给用户的每一句话（命令之间的进度说明、打印的功能清单，以及关于查了什么、下一步做什么、依据哪条规则的说明在内）、PRD、findings 的陈述、定级的理由与最后的回复 SHALL 用 `--language` 指定的语言，没有指定时用英文。只有 `--language` 改变它：项目文件（如 `CLAUDE.md`、`AGENTS.md` 里的回复语言要求）、记忆、系统区域设置与代码库的语言 MUST NOT 改变它；skill MUST NOT 说明用了哪种语言及原因。

最后的回复 SHALL 只有这几行，依次为：
- 拼装出的 `PRD.md` 所在的路径；
- 报告页 `report.html` 所在的路径；
- 写成与失败的功能数、图数、findings 按类别与按级别（P0、P1、P2、未定级）的计数、核对合计；
- 可重试的失败功能（`attempts` 未满两次），说明再跑同一命令会重试它们（没有时没有这一行）；
- 没有模式的框架（为空时没有这一行）；
- 保存进项目的提议。PRD 已在用户给出的路径上时，没有这一行。

这些数字与功能 id SHALL 来自 `aggregate` 记录的字段，MUST NOT 由模型相加或挑选。回复 MUST NOT 有这几行之外的文字，包括摘要、结论与对核对结果的挑选。项目文件里关于怎样回复的要求（先说什么、摘要、验证结果）MUST NOT 改变它。换了语言时，这几行的文字译成那种语言，路径与数字保持原样。

保存进项目 SHALL 仍是提议：用户同意之前，skill MUST NOT 把 PRD 写进 `--out` 之外的项目路径。

#### Scenario: 项目文件要求用中文回复、先说结论
- **WHEN** 项目的 `AGENTS.md` 写着用中文回复、先说结论与验证结果，调用时没有 `--language`
- **THEN** 打印的功能清单、进度说明、PRD、findings 与最后的回复都是英文，也不说明为什么用英文；最后的回复只有 PRD 路径、报告页路径、计数行、缺模式框架行与保存的提议

#### Scenario: 指定了语言
- **WHEN** 调用时给了 `--language` 指定另一种语言
- **THEN** PRD 与 findings 的陈述用那种语言，最后回复的几行文字也译成那种语言，路径与数字保持原样

#### Scenario: 用户没有给出保存路径
- **WHEN** 调用没有给出 PRD 的保存路径
- **THEN** PRD 留在 `--out` 下，回复的最后一行提议保存进项目的默认路径，skill 不自行写进项目

#### Scenario: 有可重试的失败功能
- **WHEN** 运行结束时某功能 `failed` 且 `attempts` 为 1
- **THEN** 回复在计数行之后有一行列出它的 id，说明再跑同一命令会重试它

### Requirement: 按功能并发产出与断点续跑

`excavator-prd-report` SHALL 为 `index.json` 里的每个功能派一个子代理，子代理只读该功能范围声明里的文件（五类高危陈述的全仓取证除外），直接写 `features/<id>.md` 与 `findings/<id>.json`。一条消息里最多派 `--concurrency` 个（默认 3），前台等待，返回后才派下一批；MUST NOT 用后台子代理。每个功能 SHALL 落且只落一个状态：`planned`、`written`、`checked`、`verified`、`failed`；脚本 SHALL 检查状态桶之和等于功能数。泳道检查失败时，脚本 SHALL 在最后一行打印下一步：未满两次时重派一次，满两次时保持失败。重跑 SHALL 只处理未到 `verified` 的功能，`--fresh` 才清空；`index.json` 的 `sourceRevision` 与当前快照不同、或 `format` 不是当前格式 `excavator-prd-report/2` 时 MUST NOT 续跑。

#### Scenario: 泳道返回但文件缺失
- **WHEN** 一个子代理返回而它该写的两个文件缺任一
- **THEN** 该功能重派一次；第二次仍缺则标 `failed`，原因 `lane-wrote-nothing`，`attempts` 为 2

#### Scenario: 中断后再次运行
- **WHEN** 上一次运行在部分功能 `verified` 后中止，同一命令再次运行
- **THEN** `verified` 的功能不重写，`written`/`checked` 的只补核对，`planned` 与 `attempts < 2` 的 `failed` 重派泳道

#### Scenario: 源码变了
- **WHEN** `index.json` 的 `sourceRevision` 与当前快照的不同
- **THEN** skill 不续跑，提示用 `--fresh`

#### Scenario: 第一次检查失败
- **WHEN** 一个 `attempts` 为 1 的泳道没过 `check-lane`
- **THEN** `check-lane` 的最后一行是 `Next:` 开头的重派指示，编排者照做；第二次仍失败时最后一行说明它保持失败

#### Scenario: 旧格式的产物目录
- **WHEN** `--out` 里的 `index.json` 的 `format` 是 `excavator-prd-report/1`
- **THEN** 读索引的命令退出非零并提示用 `--fresh`，skill 不续跑、不修索引

### Requirement: 功能级发现

每条功能泳道 SHALL 产出该功能的 findings：`class` 为 `product`（用户可见的行为缺陷：不一致、缺失、不对称）或 `technical`（代码层面的问题）；每条 SHALL 有陈述、所属功能 id 与至少一条证据 `{file, passage}`。脚本 SHALL 检查每段 `passage` 在其文件里按归一化规则恰好出现一次并写回行号，检查陈述不含建议性措辞；任一不过，该功能标 `failed` 并记原因。泳道写的 findings MUST NOT 含修法、严重度或置信度；级别只由排序步骤给出（见「发现的优先级」）。汇总后的 `findings.json` 每条 SHALL 带 `feature` 与 `verdict: anchor-checked`。

#### Scenario: 引文出现两次
- **WHEN** 某条 finding 的 `passage` 在文件里出现两次
- **THEN** `check-lane` 退出非零并打印该 finding 的 id 与文件，功能标 `failed`

#### Scenario: 陈述写成建议
- **WHEN** 某条 finding 的陈述含 "should" 之类的建议性措辞
- **THEN** `check-lane` 退出非零并打印该 finding 的 id，功能标 `failed`

#### Scenario: 没有发现
- **WHEN** 泳道在范围内没有找到问题
- **THEN** `findings/<id>.json` 是空数组，功能照常进入核对

### Requirement: 只写输出目录，不改目标的既有产物

`excavator-prd-report` SHALL 只向 `--out`（默认 `<projectRoot>/.excavator/prd-report/`）写文件；读 `.excavator/` 只为事实与新鲜度。新鲜度为 `stale` 或 `missing` 时 SHALL 只提示，MUST NOT 运行 `/excavator`、`sync_facts` 或任何重建事实的命令。

#### Scenario: 事实过期
- **WHEN** `consumer-freshness` 报 `stale`
- **THEN** skill 提示 PRD 可能漏掉最近的改动并继续，`.excavator/` 里 `--out` 之外的文件在运行前后清单与修改时间相同

### Requirement: 产物目录与单文件拼装

`excavator-prd-report` 的产物 SHALL 是一个目录：`index.json`、`overview.md`、`features/`、`findings/`、`verification/`、`tables/`、`open-items/`、`findings.json`、拼装出的 `PRD.md` 与报告页 `report.html`。`PRD.md` SHALL 由脚本依次拼装：总览（文档信息、目的与能力地图、自动行为）、术语表、流程索引、角色（参与者按功能、权限角色按功能）、`reference` 章节、其余章节（按 `chapter` 顺序，去掉各自的待确认项小节）、汇集的待确认项与附录（覆盖表、核对表、失败的功能及原因）。术语表、流程索引、角色两张表与待确认项 SHALL 由脚本从 `index.json` 与章节声明生成，MUST NOT 由模型转写；总览 MUST NOT 含词表、角色、流程清单与待确认项，脚本检查总览有标题与能力图。汇集的待确认项 SHALL 是一张表：脚本从各章的待确认项小节抽出事项并编号，一个合并子代理只给出哪些事项问的是同一个问题、每组保留哪一条，不写文字；另一个核对子代理只读事项清单与分组，逐条判断回答了保留那条是否也就回答了这一条，判否的事项各自回到自己的一行；脚本核对每条事项至多在一组、事项清单与合并时相同，每组一行（保留那条的原文）并列出提过它的功能，不在组里的事项各一行；合并或核对缺失、不过检查时每条事项各一行，覆盖小节写明没有合并。流程索引的每一行 SHALL 链接到 `PRD.md` 里该流程的标题。同一输入 SHALL 得到字节相同的输出。脚本生成的表、附录标题与其中的固定词 SHALL 为英文，与 `--language` 无关；模型写的总览、章节与 findings 陈述跟随 `--language`。

#### Scenario: 重复拼装
- **WHEN** 对同一产物目录执行两次 `assemble`
- **THEN** 两次 `PRD.md` 字节相同

#### Scenario: 有失败的功能
- **WHEN** 某功能的状态是 `failed`
- **THEN** `PRD.md` 的附录列出它的 id、名称与失败原因，正文没有它的章节

#### Scenario: 文档骨架
- **WHEN** 一次运行写成了一个 `reference` 功能与若干流程功能，其中一章有待确认项小节
- **THEN** `PRD.md` 的小节顺序为总览、Terminology、Flow index、Roles、`reference` 章节、流程章节、Open items、Appendix；该小节的事项只出现在 Open items 下，章节里没有核对摘要

#### Scenario: 流程索引
- **WHEN** 各章共声明了 N 个流程、有 R 个 `reference` 功能
- **THEN** 流程索引有 N + R 行，每行的链接指向 `PRD.md` 里存在的标题，同名标题也指向各自那一个

#### Scenario: 三章问了同一个问题
- **WHEN** 三章各有一条问同一个问题的待确认项，合并子代理把它们分成一组并保留其中一条
- **THEN** `## Open items` 里这个问题只有一行，文字是保留那条的原文，另两条的事项原文以 `Also asked in <功能 id>:` 列在同一格里，Features 列有这三个功能

#### Scenario: 核对否决了一条
- **WHEN** 合并子代理把两个不同的问题分进一组，核对子代理对其中一条判否
- **THEN** 这条事项在 `## Open items` 里有自己的一行，含它自己的已知与搜过；覆盖小节写明核对退回了几条

#### Scenario: 合并之后章节变了
- **WHEN** 合并之后某章重新核对，待确认项的文字变了
- **THEN** `check-open-items` 报告合并文件对应的是别的事项并退出非零；`aggregate` 让每条事项各占一行，覆盖小节写明没有合并

### Requirement: 报告页

`excavator-prd-report` SHALL 在拼装 `PRD.md` 之后由脚本把产物目录打成一个独立的 `<out>/report.html`。页面 SHALL 只用浏览器打开即可使用：所有脚本、样式、字体与数据内联，Content-Security-Policy 禁止任何网络连接，MUST NOT 引用外部 URL。同一产物目录 SHALL 得到字节相同的页面；页面 MUST NOT 含打包时间或本机绝对路径，项目只以目录名出现。

页面 SHALL 有总览、每个功能一页、全部 findings 一页与覆盖页，用 URL 的 `#` 片段导航，在 `file://` 下可用。总览 SHALL 在 `overview.md` 之后依次显示术语表、流程索引（每行链接到所属功能的页）、角色两张表与汇集的待确认项，内容与 `PRD.md` 的对应小节相同；功能页 SHALL 显示该功能的参与者与权限角色，正文不含已汇集的待确认项小节。`index.json` 里的每个功能 SHALL 在总览与导航里出现且只出现一次，显示其状态；`failed` 的功能 SHALL 显示失败原因；没有章节文件的功能 SHALL 显示为没有章节，MUST NOT 被省略。`findings.json` 里的每条 finding SHALL 在 findings 页与它所属功能的页里各出现一次，带类别、级别（未定级时标明未定级）、定级理由、陈述与每条证据的 `文件:行` 与引文；页面 SHALL 把 findings 称为 anchor-checked，MUST NOT 称为已核对。findings 页与功能页 SHALL 按 `findings.json` 的顺序（即按级别）列出 findings；findings 页 SHALL 可按类别、级别、功能与文字筛选，筛选条件放在 URL 片段里；总览 SHALL 显示各级别的条数。

章节与总览的 Markdown SHALL 渲染为 HTML：表格、`<details>`/`<summary>` 证据块与 mermaid 图。原始 HTML SHALL 经白名单净化，只保留 Markdown 能产生的元素与 `<details>`/`<summary>`。mermaid 图渲染失败时 SHALL 显示图的源文本并标明渲染失败，MUST NOT 静默留空。页面界面文字固定英文；总览、章节、findings 与定级理由的正文按产物原样显示。

`index.json`、`findings.json` 与各功能的文件不一致（`page` 按 `aggregate` 的规则重算的结果与磁盘上的汇总产物不同，或 `findings.json` 缺失）时，`page` SHALL 退出非零并提示先运行 `aggregate`，MUST NOT 写出页面。

#### Scenario: 双击打开
- **WHEN** 用户在没有网络的机器上双击 `report.html`
- **THEN** 总览、功能页、findings 页与覆盖页都能打开，mermaid 图显示为图，浏览器控制台没有 CSP 违例与错误

#### Scenario: 重复生成
- **WHEN** 对同一产物目录执行两次 `page`
- **THEN** 两次的 `report.html` 字节相同

#### Scenario: 有失败的功能
- **WHEN** 某功能的状态是 `failed`
- **THEN** 它出现在总览的功能列表与导航里，显示 `failed` 与失败原因；它的功能页说明没有章节

#### Scenario: 按类别筛选 findings
- **WHEN** 用户在 findings 页只选 `product`
- **THEN** 页面只显示 `class` 为 `product` 的 findings，显示的条数等于 `findings.json` 里该类别的条数

#### Scenario: 按级别筛选 findings
- **WHEN** 用户在 findings 页只选 `P0`
- **THEN** 页面只显示级别为 `P0` 的 findings，显示的条数等于 `findings.json` 里该级别的条数；URL 片段带上这个筛选，刷新后不丢

#### Scenario: 汇总过期
- **WHEN** 一个功能的文件在上次 `aggregate` 之后被改动，使重算的状态与 `index.json` 不同
- **THEN** `page` 退出非零，提示先运行 `aggregate`，不写 `report.html`

#### Scenario: 图写错了
- **WHEN** 某章节的 mermaid 代码无法解析
- **THEN** 该处显示图的源文本与「渲染失败」标记，页面其余部分照常

#### Scenario: 从流程索引打开功能
- **WHEN** 用户在总览的流程索引里点一个流程
- **THEN** 页面打开该流程所属功能的页，片段路由不被章节标题锚点打断

### Requirement: 发现的优先级

全部章节核对之后，`excavator-prd-report` SHALL 由排序子代理按写死的判据给每条 finding 定 `P0`、`P1` 或 `P2`，并写一句理由，说明证据满足了哪条判据、影响到谁；证据不足以表明较高一级的判据时 SHALL 取较低一级，并在理由里说明什么不明显。判据 SHALL 原样写在 skill 里：`P0` 为能让人做不被允许的事（通过本应拦住他的认证或权限检查、读写他人数据、看到机密）、丢失或损坏已存数据、算错金额，或使功能的主流程对所有用户失败；`P1` 为在用户使用的流程里给出错误、不一致或缺失的结果，向用户或运维隐藏失败，或在普通输入下出错；`P2` 为其余缺陷。理由 MUST NOT 写修法，适用与 findings 陈述相同的建议性措辞检查。

定级 SHALL 写在每个功能的 `priorities/<id>.json`，只能由排序子代理写，主模型 MUST NOT 写或改它。脚本 SHALL 检查每个已写成功能的定级与其 findings 一一对应（每条恰好一次、没有多余 id）、级别只取三个值、理由非空且不超过 300 字符；需要排序的功能由脚本按章节顺序分批，每批 findings 合计不超过 120 条。不过检查的功能 SHALL 重派一次排序；仍不过时其 findings 记为未定级，MUST NOT 阻断 `PRD.md` 与报告页。续跑时已有合格定级的功能 SHALL NOT 重新排序。

`aggregate` SHALL 把合格的定级并进 `findings.json`（每条带 `priority` 与 `priorityReason`，未定级为 `null`），按级别（P0、P1、P2、未定级）、功能顺序、finding 序号排序，并记录每个功能与全体的各级别条数；各级别条数之和 SHALL 等于 findings 条数，不等时 `aggregate` 退出非零。

#### Scenario: 漏定一条
- **WHEN** 某功能的定级文件缺了它的一条 finding
- **THEN** `check-priorities` 退出非零并打印该功能与缺失的 finding id，该功能重派一次排序

#### Scenario: 理由写成建议
- **WHEN** 某条定级的理由含 "should" 之类的建议性措辞
- **THEN** `check-priorities` 退出非零并打印该 finding id

#### Scenario: 两次排序都不过
- **WHEN** 某功能的第二次排序仍不过检查
- **THEN** 它的定级文件被删除，它的 findings 在 `findings.json` 里级别为 `null`，计入未定级；`PRD.md` 与报告页照常写出

#### Scenario: 旧产物补定级
- **WHEN** 一个早先跑过的当前格式产物目录，章节都已核对但没有任何定级（例如运行在排序之前中止），用同一命令再跑一次
- **THEN** 不派泳道、不重写章节，只派排序子代理并重新汇总、拼装与生成报告页

#### Scenario: 排序与守恒
- **WHEN** `aggregate` 汇总一个各级别都有 findings 的产物目录
- **THEN** `findings.json` 先列全部 P0，再 P1、P2、未定级，同一级别内按功能顺序与序号；各级别计数之和等于 findings 条数

### Requirement: 章节的结构声明

编排者 SHALL 在索引的 `actors` 里把项目的每个参与者（用户类别、外部系统、其他服务、运维）列一次。每个泳道 SHALL 在章节 front-matter 里声明：`actors`（发起或参与流程的参与者，只取索引 `actors` 里的名字，逐字相同）、`permissionRoles`（权限模型里的具名角色，原样拼写）、`flows`（本章每个流程的 `###` 标题，与正文逐字相同）与可选的 `openItems`（集中列出待确认项的 `###` 标题，必须是本章最后一个 `###`）。`actors` 与 `permissionRoles` MUST NOT 相交；`flow` 与 `automated` 功能 SHALL 至少声明一个流程，`reference` 功能 MUST NOT 声明流程；正文 SHALL 恰好有一个 `##` 标题且它是第一个标题。`flow` 与 `automated` 章节的每个 `###` 标题 SHALL 是 `flows` 里的一项或 `openItems`：角色 × 能力矩阵、字典表与多个流程共用的设置写在 `reference` 章节，流程章节按名字引用它，第一个 `###` 之前的引言写功能的流程图、概述与衔接。待确认项小节 SHALL 只有一张三列表（事项、已知什么、搜过哪里）。脚本 SHALL 检查这些声明与正文一致，不一致时该泳道不过检查；`aggregate` 对已核对的章节 SHALL 重做同样的检查（流程章节只有流程与待确认项三列表两条除外），核对改坏结构时该功能为 `failed` 并记原因。

#### Scenario: 流程标题对不上
- **WHEN** 某章 `flows` 里的一项与正文的任何 `###` 标题都不逐字相同
- **THEN** `check-lane` 退出非零并打印该标题，功能按失败处理

#### Scenario: 参与者与权限角色混写
- **WHEN** 同一个名字既在 `actors` 又在 `permissionRoles`
- **THEN** `check-lane` 退出非零并打印这个名字

#### Scenario: 参与者不在名单里
- **WHEN** 某章 `actors` 里有一个索引 `actors` 没有的名字
- **THEN** `check-lane` 退出非零并打印这个名字；`Actors by feature` 的列只取索引名单里的名字

#### Scenario: 核对在章节里加了标题
- **WHEN** 一章核对之后正文出现第二个 `##` 标题
- **THEN** `aggregate` 把该功能记为 `failed` 并打印原因，`PRD.md` 正文没有它的章节

#### Scenario: 流程章节里的权限小节
- **WHEN** 一个 `flow` 章节有一个 `### Permissions` 小节，它不在 `flows` 里，也不是 `openItems`
- **THEN** `check-lane` 退出非零并打印这个标题；同样的章节在 `aggregate` 的重检里不判失败

#### Scenario: 待确认项不是三列表
- **WHEN** 某章的待确认项小节是列表，或是一张四列表
- **THEN** `check-lane` 退出非零并说明待确认项小节要是一张三列表

### Requirement: 证据只指项目代码

泳道 SHALL 只引用项目根内的文件作为证据；项目外的代码（依赖缓存、标准库、安装的包）MUST NOT 作为锚点或引文，依赖的行为按项目自己的代码与配置描述或写成待确认。脚本 SHALL 拒绝路径含入口扫描跳过的目录（依赖与构建产物目录）的锚点、引文与种子文件。

#### Scenario: 锚点在依赖目录
- **WHEN** 某章的锚点路径在 `node_modules` 或 `vendor` 下
- **THEN** `check-lane` 退出非零并打印该锚点与目录
