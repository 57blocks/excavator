# prd-report Specification

## Purpose
定义 `excavator-prd-report`：按功能写出项目全部的 As-Is PRD 章节与每个功能的产品、技术问题（findings），入口与功能清单由脚本守恒、各功能并发写作并可断点续跑、每章单独核对，产物是只写在 `--out` 下的一个目录与拼装出的一份 `PRD.md`。单篇 PRD 见 `prd-generation`。

## Requirements

### Requirement: 完整流程清单覆盖全流程

`excavator-prd-report` SHALL 在写作前把 scope 内的入口候选与功能清单写进 `<out>/index.json`，MUST NOT 为篇幅精选或静默丢弃任何候选。入口候选 SHALL 由确定性脚本按框架模式目录从源码列出；模式目录没有覆盖的框架 SHALL 记入 `candidates.uncovered`，模型为其补的入口 SHALL 标 `inferred` 并带 `file:line`。模型 SHALL 把候选分组成功能，每个功能带范围声明（入口、种子文件、涉及的层）；每个候选 SHALL 落且只落一个功能或 `unassigned`，脚本 SHALL 检查这一守恒与每个候选的文件存在、行号在界内，不成立则运行失败并打印差集；读产物目录的每个子命令 SHALL 由调用方给出项目根，并拒绝 `projectRoot` 与之不一致的索引。每个用户流程 SHALL 缝合为跨层的端到端功能；定时与后台行为 SHALL 作为 `automated` 功能进入同一清单。

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

`excavator-prd-report` 在写作时对否定性结论、可达性与顺序、触发机制、绝对化与不变性说法 SHALL 先做全仓搜索取证；无法取证时 SHALL 写成「待确认」并注明已搜索的范围。每个写好的功能 SHALL 单独按 `excavator-verify` 的流程以 `--fix` 核对，核对由编排者执行而非写作该功能的子代理；其计数 SHALL 原样记入 `index.json` 并由脚本求和后报告。findings SHALL 由脚本检查锚点与引文，`verdict` 固定为 `anchor-checked`，MUST NOT 被称为已核对。

#### Scenario: 否定性结论先取证
- **WHEN** 研究中得出「某操作不产生会计分录」
- **THEN** 该结论附带全仓搜索范围作为证据；未搜索全仓则写成「待确认」并列出已搜范围

#### Scenario: 保存前核对
- **WHEN** 一个功能的章节通过了泳道检查
- **THEN** 编排者对该章节执行 `excavator-verify --fix`，把报告写到 `verification/<id>.md`，计数记入该功能的 `counts.verification`；计数解析不出时该功能标 `failed`

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
- 没有模式的框架（为空时没有这一行）；
- 保存进项目的提议。PRD 已在用户给出的路径上时，没有这一行。

这些数字 SHALL 来自 `aggregate` 打印的字段，MUST NOT 由模型相加。回复 MUST NOT 有这几行之外的文字，包括摘要、结论与对核对结果的挑选。项目文件里关于怎样回复的要求（先说什么、摘要、验证结果）MUST NOT 改变它。换了语言时，这几行的文字译成那种语言，路径与数字保持原样。

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

### Requirement: 按功能并发产出与断点续跑

`excavator-prd-report` SHALL 为 `index.json` 里的每个功能派一个子代理，子代理只读该功能范围声明里的文件（五类高危陈述的全仓取证除外），直接写 `features/<id>.md` 与 `findings/<id>.json`。一条消息里最多派 `--concurrency` 个（默认 3），前台等待，返回后才派下一批；MUST NOT 用后台子代理。每个功能 SHALL 落且只落一个状态：`planned`、`written`、`checked`、`verified`、`failed`；脚本 SHALL 检查状态桶之和等于功能数。重跑 SHALL 只处理未到 `verified` 的功能，`--fresh` 才清空；`index.json` 的 `sourceRevision` 与当前快照不同时 MUST NOT 续跑。

#### Scenario: 泳道返回但文件缺失
- **WHEN** 一个子代理返回而它该写的两个文件缺任一
- **THEN** 该功能重派一次；第二次仍缺则标 `failed`，原因 `lane-wrote-nothing`，`attempts` 为 2

#### Scenario: 中断后再次运行
- **WHEN** 上一次运行在部分功能 `verified` 后中止，同一命令再次运行
- **THEN** `verified` 的功能不重写，`written`/`checked` 的只补核对，`planned` 与 `attempts < 2` 的 `failed` 重派泳道

#### Scenario: 源码变了
- **WHEN** `index.json` 的 `sourceRevision` 与当前快照的不同
- **THEN** skill 不续跑，提示用 `--fresh`

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

`excavator-prd-report` 的产物 SHALL 是一个目录：`index.json`、`overview.md`、`features/`、`findings/`、`verification/`、`tables/`、`findings.json`、拼装出的 `PRD.md` 与报告页 `report.html`。`PRD.md` SHALL 由脚本按 `chapter` 顺序拼装总览、脚本生成的表、各功能章节与附录（覆盖表、核对表、失败的功能及原因），同一输入 SHALL 得到字节相同的输出；表格 MUST NOT 由模型转写。脚本生成的表、附录标题与其中的固定词 SHALL 为英文，与 `--language` 无关；模型写的总览、章节与 findings 陈述跟随 `--language`。

#### Scenario: 重复拼装
- **WHEN** 对同一产物目录执行两次 `assemble`
- **THEN** 两次 `PRD.md` 字节相同

#### Scenario: 有失败的功能
- **WHEN** 某功能的状态是 `failed`
- **THEN** `PRD.md` 的附录列出它的 id、名称与失败原因，正文没有它的章节

### Requirement: 报告页

`excavator-prd-report` SHALL 在拼装 `PRD.md` 之后由脚本把产物目录打成一个独立的 `<out>/report.html`。页面 SHALL 只用浏览器打开即可使用：所有脚本、样式、字体与数据内联，Content-Security-Policy 禁止任何网络连接，MUST NOT 引用外部 URL。同一产物目录 SHALL 得到字节相同的页面；页面 MUST NOT 含打包时间或本机绝对路径，项目只以目录名出现。

页面 SHALL 有总览、每个功能一页、全部 findings 一页与覆盖页，用 URL 的 `#` 片段导航，在 `file://` 下可用。`index.json` 里的每个功能 SHALL 在总览与导航里出现且只出现一次，显示其状态；`failed` 的功能 SHALL 显示失败原因；没有章节文件的功能 SHALL 显示为没有章节，MUST NOT 被省略。`findings.json` 里的每条 finding SHALL 在 findings 页与它所属功能的页里各出现一次，带类别、级别（未定级时标明未定级）、定级理由、陈述与每条证据的 `文件:行` 与引文；页面 SHALL 把 findings 称为 anchor-checked，MUST NOT 称为已核对。findings 页与功能页 SHALL 按 `findings.json` 的顺序（即按级别）列出 findings；findings 页 SHALL 可按类别、级别、功能与文字筛选，筛选条件放在 URL 片段里；总览 SHALL 显示各级别的条数。

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
- **WHEN** 一个在本变更之前跑完、没有任何定级的产物目录，用同一命令再跑一次
- **THEN** 不派泳道、不重写章节，只派排序子代理并重新汇总、拼装与生成报告页

#### Scenario: 排序与守恒
- **WHEN** `aggregate` 汇总一个各级别都有 findings 的产物目录
- **THEN** `findings.json` 先列全部 P0，再 P1、P2、未定级，同一级别内按功能顺序与序号；各级别计数之和等于 findings 条数
