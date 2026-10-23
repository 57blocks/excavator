# report-viewer Specification

## Purpose
把一个项目 `.excavator/` 下的产物与对应源码打包成一个自包含的静态 HTML 页面，只用浏览器就能打开浏览：不联网、不装任何东西、不起服务。页面只陈述产物里的事实，每条记录都能跳到它所指的源码行；缺失、读不了、版本不同都看得见。

## Requirements

### Requirement: 打包成一个自包含的 HTML

打包 SHALL 读取项目 `.excavator/` 下的产物与源码快照里的源码，写出一个 HTML 文件，默认路径 `<project>/.excavator/view.html`，可以用参数改写到别的路径。

页面的前端 SHALL 来自 `packages/report-view` 构建出的单个 HTML 模板：
- 构建把全部 JS、CSS 与 Worker 内联进这一个文件，没有分块，也没有外部文件；
- 打包只往模板里插入内容安全策略与数据，不改动模板的其余字节；
- 模板不存在时，打包 MUST 以非零状态退出并写明要先运行 `pnpm build`。

写出的文件 SHALL 自包含：
- 页面的全部样式、脚本与数据都内联在这一个文件里；
- 打开时 MUST NOT 请求任何网络或本地文件资源（包括字体、图标、脚本、样式与数据）；
- 打开的人除浏览器外 MUST NOT 需要任何东西：不需要 Node、不需要联网、不需要起服务；
- 文件 SHALL 带内容安全策略：禁止一切连接；脚本与样式只允许内联；图片与字体只允许 `data:`；Worker 只允许 `blob:`。

打包 SHALL 是确定的：同一个模板、同一组产物、同一个源码版本、同一组参数，写出的文件逐字节相同。文件里 MUST NOT 写入打包时间。

打包 SHALL 先写临时文件再改名；失败时 MUST NOT 留下半个文件，也 MUST NOT 改动已有的同名文件。

#### Scenario: 断网打开
- **WHEN** 在没有网络、没有装 Node 的机器上用 Chrome 以 `file://` 打开写出的文件
- **THEN** 页面完整显示，图能布局；没有网络请求、没有控制台错误，也没有内容安全策略违规

#### Scenario: 重复打包
- **WHEN** 模板、产物、源码与参数都没变，连续打包两次
- **THEN** 两次写出的文件逐字节相同

#### Scenario: 打包失败
- **WHEN** 打包中途出错，而目标路径上已有一个旧的查看页
- **THEN** 命令以非零状态退出并说明原因，旧文件原样保留

#### Scenario: 没有构建模板
- **WHEN** `packages/report-view` 还没有构建
- **THEN** 打包以非零状态退出，说明要先运行 `pnpm build`，不写出任何文件

### Requirement: 每个产物落进看得见的状态

打包 SHALL 对下列每个产物给出且只给出一种状态，查看页的 Products 页 SHALL 逐一列出：
- 知识图谱（`knowledge-graph.jsonl` 及其 `source-manifest.json`）
- 语义（`semantic-cache.json` 与 `semantic-graph.json`：Full 模式写出的摘要、标签与层）
- 领域图（`domain-graph.json`）
- unused-code（`unused-code.json`）
- doc-map（`doc-map.json` 与 `doc-map/checks.json`）
- hotspots（`hotspots.json`）
- 导览（`tour.json`）
- 报告（`hotspots-report.md`、`doc-map-report.md`）

状态只有四种：
- **included**：读到并内联；
- **not run**：文件不存在。页面写出生成它的命令；
- **unreadable**：文件存在但读不了或格式不对（不是 JSON、`format` 或版本不是查看页认识的版本、缺必需字段）。页面写出原因，MUST NOT 部分显示。以下也属于这一类：
  - 领域图的 `version` 不是 `2.0.0`，或 `contentLanguage` 不是 `en`；
  - 语义缓存的 `contentLanguage` 不是 `en`，或语义图的 `factDigest` 与知识图谱的 `factsDigest` 不同；
  - 导览的 `format` 不是 `excavator-tour/1`；
- **different revision**：读到并内联，但产物记录的源码版本与打包时源码快照的版本不同。页面在 Products 页和该产物页的顶部写出两个版本，内容照常显示。导览例外：它的 `factDigest` 与知识图谱的 `factsDigest` 不同时为 different revision，步骤 MUST NOT 显示（步骤里的节点 id 可能已对不上）。

产物没有记录源码版本时（例如报告 Markdown），SHALL 显示为 included，并注明「没有记录版本」，MUST NOT 当作版本相同。

#### Scenario: 没跑过 hotspots
- **WHEN** `.excavator/` 里没有 `hotspots.json`
- **THEN** Products 页把 hotspots 列为 not run 并给出 `/excavator-hotspots`；Hotspots 页显示同样的说明，不显示空表

#### Scenario: 产物损坏
- **WHEN** `unused-code.json` 不是合法 JSON
- **THEN** unused-code 的状态是 unreadable 并带原因，页面不显示它的任何条目

#### Scenario: 源码已经前进
- **WHEN** `hotspots.json` 的 `sourceRevision` 与当前源码快照的版本不同
- **THEN** Products 页与 Hotspots 页顶部都写出两个版本，表格照常显示

#### Scenario: 领域图语言不对
- **WHEN** `domain-graph.json` 的 `contentLanguage` 不是 `en`
- **THEN** 领域图的状态是 unreadable，原因写明语言，领域视图不显示任何节点

#### Scenario: Lazy 图谱没有语义文件
- **WHEN** `.excavator/` 里没有 `semantic-cache.json`，图谱节点自带摘要
- **THEN** 语义的状态是 not run，并给出 `/excavator --full`；节点摘要照常取自图谱

#### Scenario: 没跑过导览
- **WHEN** `.excavator/` 里没有 `tour.json`
- **THEN** Products 页把导览列为 not run 并给出 `/excavator-tour`

### Requirement: 内嵌源码与它的可见分类

默认 SHALL 内嵌已内联的 unused-code、doc-map 与 hotspots 产物引用到的每个源文件的文本，文本取自当前源码快照（Git 仓与多仓取 HEAD，不读工作区）。查看页里每一条带文件路径的记录 SHALL 能打开该文件；带行号或行范围的记录 SHALL 定位并高亮这些行。

每个被引用到的文件 SHALL 落进且只落进下面一类，Code 页 SHALL 显示各类计数，打开某个文件时 SHALL 显示它所在的类：
- **embedded**：已内嵌文本；
- **binary**：不是文本，不内嵌；
- **too large**：超过单文件上限，不内嵌，页面写出文件大小与上限；
- **not in snapshot**：当前快照里没有这个路径（例如产物版本较旧、文件已删除）；
- **not embedded on request**：打包时指定了不嵌源码。

产物指向的行超出内嵌文本的行数时，页面 SHALL 写明「该行不在当前版本的文件里」，MUST NOT 高亮别的行。

#### Scenario: 从 unused-code 跳到源码
- **WHEN** 点击 unused-code 页里某条记录的位置
- **THEN** Code 页打开该文件并高亮它的 `lineRange`

#### Scenario: 不嵌源码
- **WHEN** 打包时指定了不嵌源码
- **THEN** 文件里没有任何源码文本；每个被引用文件都归在 not embedded on request，点击位置时页面说明这一点

#### Scenario: 行号越界
- **WHEN** 产物记录的行号大于当前快照里该文件的行数
- **THEN** 页面打开该文件并写明该行不在当前版本的文件里，不高亮任何行

### Requirement: Unused code 页

页面 SHALL 显示：
- `counts` 与 `conservation`（候选数、被判定移除数、仅测试使用数、未使用数，以及守恒是否成立）；
- `decisions`：每条判定的种类、理由与命中数；
- `unused` 明细：名称、语言、位置、owner、可见性、原因（unreferenced 或 only-reachable-from-unused）、置信度、分组与 signals；可按置信度、原因、语言筛选，按任一列排序；
- `testOnly` 列表；
- 产物的 `residualAssumptions` 原文。

页面 MUST NOT 出现建议性措辞（例如「可以删除」「应当移除」「safe to delete」）。

#### Scenario: 按置信度筛选
- **WHEN** 只选 high
- **THEN** 列出的条数等于 `counts.byConfidence.high`

### Requirement: Doc map 页

页面 SHALL 显示：
- 每个文档的路径、格式、读取状态与原因、单元数；
- 每个单元的标题、引文、所在行或页、代码查找状态（found、not-found、not-checked）、证据位置，以及 `doc-map/checks.json` 里对应的核验结论（does、not、none）与理由；没有核验记录的单元 SHALL 显示为「未核验」；
- `coverage`：按目录与按文件的有证据、无证据计数，以及不在事实里的文件；
- 读不了的文件与原因；
- 产物的 `residualAssumptions` 原文。

引文与核验理由 SHALL 原样显示，不翻译、不改写。

#### Scenario: 未找到代码的单元
- **WHEN** 某单元的代码查找状态是 not-found
- **THEN** 页面显示它的引文与 `searched` 记录，不显示任何代码位置

### Requirement: Hotspots 页

页面 SHALL 显示：
- 窗口（起始日期或全部历史）、源码类型、是否有历史；没有历史或浅克隆时，在页面顶部写出产物给出的原因；
- 文件表：提交数、作者数、增删行数、行数、分数、最后修改时间，可按任一列排序，默认按分数；
- 目录表：同样的计数，以及产物给出的按年提交数与集中度（产物缺这些字段时显示为「产物未提供」，MUST NOT 显示为 0）；
- 同改文件对：两个文件、共同提交数与各自占比；
- 功能分组（有分组时）：每组的计数与没有匹配到文件的路径；
- 产物的 `residualAssumptions` 原文。

#### Scenario: 旧产物缺字段
- **WHEN** `hotspots.json` 的目录行没有 `commitsByYear`
- **THEN** 目录表的该列显示「产物未提供」

### Requirement: Code 页与 Reports 页

Code 页 SHALL 提供被引用文件的文件树与源码面板，显示行号，支持按路径过滤。

Reports 页 SHALL 渲染已内联的报告 Markdown（标题、段落、列表、表格、代码块、行内代码与强调）。报告里的 HTML 标签 SHALL 当作文字显示，MUST NOT 执行或插入页面。

#### Scenario: 报告里有 HTML
- **WHEN** 报告 Markdown 里含有 `<script>` 或 `<img onerror=...>`
- **THEN** 页面以文字显示这些内容，不执行任何脚本

### Requirement: 产物内容只当文字

来自产物与源码的任何字符串（名称、路径、摘要、引文、理由、源码）SHALL 只以文字插入页面，MUST NOT 作为 HTML 解析或执行。内联数据 MUST NOT 能提前结束它所在的 `<script>` 元素。

#### Scenario: 名称里有标签
- **WHEN** 某个函数名或引文含有 `</script><script>alert(1)</script>`
- **THEN** 页面原样显示这串文字，没有脚本执行，后面的数据照常读取

### Requirement: 界面与主题

界面文字 SHALL 是英文；产物与源码里的文字原样显示。

版式 SHALL 照 Understand Anything 的 dashboard 组织：
- 顶栏放项目名、模式切换、搜索、叠加层与过滤入口；
- 左侧是视图导航；
- 中间是图或表格页；
- 右侧是可收起的详情侧栏，底部是可收起、可放大的代码抽屉；
- 浮层（侧栏、抽屉、弹窗、菜单）有半透明背景与模糊，卡片有圆角与柔和阴影。

页面 SHALL 只有浅色主题：
- 配色取自 57blocks 官网的设计 token（背景、正文、弱化文字、分隔线与强调色），不跟随系统的深色模式；
- 节点类型的颜色在浅色背景上可区分，并且在图例里列出；
- 字体 SHALL 内联在模板里：标题与节点名用 DM Serif Display，正文用 Inter，代码用 JetBrains Mono，只取拉丁子集；页面 MUST NOT 加载外部字体；字体的许可声明写在模板开头。

页面 SHALL 有动效：
- 视图切换、侧栏与抽屉的进出、弹窗、列表首屏与统计数字都有过渡；
- 图的下钻、聚焦与定位有镜头过渡；
- 缓动与时长取 57blocks 官网的语汇。

动效 MUST NOT 推迟数据的显示：就绪信号在内容画出时给出，不等动画结束。系统设置了「减少动效」时，页面 SHALL 不播放任何过渡与循环动画。

页面 SHALL 在 1280 像素宽和 768 像素宽下都能用：不出现整页横向滚动，表格在自己的容器里滚动；768 宽时侧栏改为覆盖在图上。表格页的内容列 SHALL 在可用宽度里水平居中，宽于内容列时左右留白相等。

#### Scenario: 系统是深色模式
- **WHEN** 操作系统设为深色模式后打开页面
- **THEN** 页面仍是浅色主题

#### Scenario: 减少动效
- **WHEN** 系统设置了「减少动效」，用户切换视图并打开侧栏
- **THEN** 内容直接出现，页面上没有正在运行的动画

#### Scenario: 离线字体
- **WHEN** 断网时打开页面
- **THEN** 标题的计算字体是 DM Serif Display，页面没有任何字体请求

### Requirement: /excavator-view skill

`/excavator-view [project-path] [--no-source] [--out <path>]` SHALL：
1. 运行打包，写出查看页；
2. 用系统默认浏览器打开写出的文件（macOS `open`、Linux `xdg-open`、Windows `start`）；没有可用的打开命令时，只给出文件路径，不算失败；
3. 最后回复固定的几行：文件路径、文件大小、每个产物的状态，以及「文件内嵌了源码」或「文件没有内嵌源码」。

skill MUST NOT 启动 HTTP 服务，MUST NOT 运行任何分析，MUST NOT 改动 `.excavator/` 下除写出的查看页以外的任何文件。没有任何产物时，它仍写出页面，并在回复里说明全部产物都是 not run。

#### Scenario: 只有 hotspots
- **WHEN** 项目只跑过 `/excavator-hotspots`
- **THEN** skill 写出并打开查看页，回复列出 hotspots 为 included，其余为 not run

### Requirement: 结构图

知识图谱已内联时，页面 SHALL 以结构图为默认视图。图分级显示：
- **顶层**：
  - 图谱有层（`layers`）时，每层一个簇，显示文件数与节点数；
  - 没有层时，按顶层目录分组成容器（多仓项目的顶层目录就是成员仓），页面写明是按目录分组；
- 一级里的节点超过上限时，多出的部分折叠成容器，写明折叠了多少个；折叠的容器仍可点进去；
- **下钻**：点击簇或容器，进入下一级目录容器；容器内的文件节点可以再展开成函数与类；
- **层间与容器间的边**：按类型聚合成一条，标出条数。

图 SHALL 提供面包屑返回上一级、MiniMap、缩放与适配视图控件。每一级画出的节点与边，SHALL 只来自图谱里的节点与边记录，MUST NOT 推断或补出图谱里没有的关系。

#### Scenario: 没有层的图谱
- **WHEN** 图谱的 `layers` 为空
- **THEN** 顶层按顶层目录分组，页面写明分组依据是目录

#### Scenario: 下钻计数
- **WHEN** 进入某个容器
- **THEN** 画出的文件节点数，加上该级折叠容器里写明的文件节点数，等于图谱里路径在该容器下的文件节点数

### Requirement: 摘要、标签与层的来源

节点的摘要与标签 SHALL 按下列顺序取：
1. 语义缓存里该节点的条目，且只取打包时仍然新鲜的条目：条目的 `semanticSourceHash` 等于 `source-manifest.json` 里该文件当前的 `contentHash`；
2. 否则取图谱节点自带的 `summary` 与 `tags`；
3. 都没有时，页面写明没有摘要。

打包 SHALL 把不新鲜的条目计数，并在 Overview 的语义一栏写出这个数；这些条目 MUST NOT 显示成节点摘要。

每条摘要 SHALL 带上它的核验结论：
- `verified`、`unverified` 原样标出；
- 没有结论时标为 unchecked；
- 结论是 `contradicted` 的摘要 MUST NOT 作为节点摘要显示。侧栏写明「这条摘要与源码不符，未显示」。

图的层 SHALL 取自语义图的 `layers`；语义图不可用时，取图谱里的 `layer` 记录；都没有时，按目录分组（见「结构图」）。

#### Scenario: 被核验否定的摘要
- **WHEN** 选中一个摘要结论为 `contradicted` 的函数节点
- **THEN** 侧栏不显示那条摘要，写明它与源码不符，并照常显示其余字段

#### Scenario: Full 模式的层
- **WHEN** 图谱没有 `layer` 记录，而语义图有 9 个层、覆盖全部文件节点
- **THEN** 结构图顶层是这 9 个层的簇，各簇的文件数之和等于图谱的文件节点数

### Requirement: 节点详情与代码抽屉

选中一个节点时，右侧详情侧栏 SHALL 显示：
- 名称、类型、语言、摘要及其核验结论（来源见「摘要、标签与层的来源」）、标签、所在层、文件路径与行范围；
- 入边与出边，按边类型分组，每条可点击跳到对端节点；
- 该节点在已内联产物里的事实：
  - 文件的 hotspots 计数与分数；
  - 函数的 unused 状态、原因与置信度；
  - 文件的 doc-map 证据数。
  产物没跑时写明 not run，MUST NOT 显示成 0 或「没有」。

带文件路径的节点 SHALL 能在底部代码抽屉里打开源码：抽屉高亮节点的行范围，可以放大为整页，也可以跳到 Code 页。源码的分类与越界规则同 Code 页。

#### Scenario: 未运行的产物
- **WHEN** 选中一个文件节点，而 hotspots 没有跑过
- **THEN** 侧栏的 hotspots 一栏写 not run 与生成命令

### Requirement: 搜索、过滤、聚焦与路径

页面 SHALL 提供：
- **搜索**：按名称与路径模糊匹配，结果列表显示类型与路径；选中结果后，图下钻到该节点所在的位置并选中它；
- **过滤**：按节点类型、边类型、层显示或隐藏。被过滤掉的数目写在过滤入口上；
- **聚焦**：只显示选中节点和它的 1 跳邻居，可以退出；
- **路径**：给出两个节点，沿图谱的边求一条最短路径并高亮。没有路径时，写明两点之间没有路径。

#### Scenario: 搜索定位
- **WHEN** 搜索一个函数名并选中结果
- **THEN** 图下钻到该函数所在的文件容器，选中该节点，侧栏显示它

### Requirement: 产物叠加层

页面 SHALL 提供三个可分别开关的叠加层，只在对应产物已内联时可用：
- **hotspots**：文件与目录节点按分数着色，图例给出分数区间；
- **unused**：被列为未使用的函数及其所在文件做标记，按置信度区分；
- **doc-map**：有文档证据与没有证据的文件分别着色。

叠加层只陈述产物里的事实，图例与提示 MUST NOT 出现建议性措辞。Unused、Doc map、Hotspots 页里每条带节点或文件的记录 SHALL 能「在图中定位」：切到结构图，下钻并选中对应节点；图谱里没有对应节点时，写明图谱里没有它。

#### Scenario: 从 unused 页定位
- **WHEN** 在 Unused 页点击某条记录的「在图中定位」
- **THEN** 结构图下钻到该函数所在的文件，选中它，unused 叠加层打开

### Requirement: 快捷键与返回

页面 SHALL 支持：
- `/` 聚焦搜索，`?` 显示快捷键列表；
- `Esc` 由内向外逐级关闭：弹窗、代码抽屉、聚焦、选中、下钻的一级；
- 浏览器的后退与前进在视图、下钻层级与选中节点之间往返，刷新后回到同一位置。

#### Scenario: 后退
- **WHEN** 下钻两级并选中一个节点后按浏览器后退
- **THEN** 选中被取消，图仍在同一级；再后退一次回到上一级

### Requirement: 领域图

领域图已内联时，页面 SHALL 提供领域视图，交互照 Understand Anything 的领域视图：
- **顶层**：每个 domain 一个簇，显示摘要与它包含的 flow 数；domain 之间的 `cross_domain` 边带上它的描述；
- **下钻**：点进一个 domain，显示它的 flow；点进一个 flow，按 `flow_step` 边的权重顺序显示 step；
- **详情**：选中 domain、flow 或 step 时，侧栏显示名称、摘要、`domainMeta` 与证据；
- **跳转**：step 的 `nodeIds` 每一项都能跳到结构图里对应的节点；`unresolvedNodeIds` 原样列出并写明没有解析到节点；step 带文件路径与行范围时，可以在代码抽屉里打开。

页面 SHALL 写明：领域图由模型从代码推导，是对代码的描述，不是代码本身的事实。领域视图里画出的节点与边 SHALL 只来自 `domain-graph.json`，MUST NOT 推断或补出。领域图没跑时，领域视图显示 not run 与 `/excavator-domain`。

#### Scenario: 从 step 跳到代码节点
- **WHEN** 选中一个带 `nodeIds` 的 step，点击其中一项
- **THEN** 切到结构图，下钻并选中该节点

#### Scenario: 解析不到的节点
- **WHEN** 某个 step 的 `nodeIds` 里有一项在知识图谱中不存在
- **THEN** 侧栏把它列为「图谱里没有它」，不提供跳转

### Requirement: 离线仪表盘

`/excavator-view` SHALL 在 `.excavator/view.html` 之外再写出 `.excavator/explorer.html`：Understand Anything 仪表盘的副本，用本项目的产物填数据。给了 `--out` 时，`explorer.html` 写在它旁边；`--out` 本身就是那个 `explorer.html`（不分大小写）时，打包 SHALL 报错且不写任何文件。

副本的来源与改动：
- 源码取自 Understand Anything 的 `packages/explorer` 与它引用的 `packages/core` 模块，保留 MIT 许可声明与来源提交号；
- 只为离线、产品名与缺层兜底改动以下几处，此外的界面、交互、主题与文案 MUST NOT 改：
  - 数据文件改为读页面内联的数据；
  - 源码改为读内联的源码；
  - 去掉令牌门；
  - 布局 Worker 内联；
  - 陈旧度在打包时算好，副本多认一种「版本不同」的结果，横幅写出图的版本与打包时源码快照的版本；
  - 界面上显示的产品名与报问题链接改为 Excavator；
  - 图里没有层时，结构图顶层按副本自己的目录分组（目录过于集中时按副本自己的连接聚类）显示，界面上称「分组」而不称「层」；
  - 显示我们图里有而副本原本不显示或显示错的数据：节点摘要的核验结论、`mentions` 边、边的证据（文件与行号）、覆盖记录与缺口记录。
- 页面 SHALL 是一个自包含的 HTML 文件，从磁盘直接打开即可使用，不需要 Node、网络或本地服务，打开后不发出任何网络请求。

填入的数据：
- SHALL 只改形状、不改内容：
  - 知识图谱的逐行记录拼回一个图；
  - 完整分析的语义产物（`semantic-graph.json` 的层、`semantic-cache.json` 的摘要与标签）按 `view.html` 同一套新鲜度与合并规则并进图：层取语义图的（与知识图同一 facts digest 时），节点的摘要与标签先取语义条目、再取节点自己的，被核验判为矛盾的摘要为空；
  - 节点带上语义条目的核验结论（`verification`），条目没有结论（例如文件节点）时不写；
  - 知识图记下的项目名是分析时临时快照目录的名字（`excavator-snapshot-<种类>-<6 位>`）时，页面用项目根目录的名字，别的名字原样；
  - 领域图、`meta.json` 原样；
  - 导览步骤放进图的 `tour`；
  - 不在 git 里的项目，两张图的 `project.gitCommitHash` 是 `null`，写成副本表示「没有提交号」的空字符串；
  - 源码按 `/excavator-view` 现有的内联规则，`--no-source` 时不内联；
  - 有知识图时写 `staleness.json`：每张打包进去的图记录的源码版本与打包时源码快照的版本相同时为 fresh，不同或图没有记录版本时为「版本不同」，页面顶部写出两个版本（没有记录时写明没有记录），并写明页面里的代码是随页面打包的源码、行号可能与图对不上。它只比较打包时读到的东西，MUST NOT 声称工作区在打包之后的状态。
- 缺少的产物 SHALL 落进副本自己的空状态（例如没有领域图时领域切换不可用），不得用编出的数据补齐；
- 副本的校验报告的问题 SHALL 照副本自己的方式显示，打包回复写出问题条数；我们的图里合法的数据（`mentions` 边、为空的摘要）不算问题。

#### Scenario: 不起服务就能看
- **WHEN** 打包一个有知识图谱、领域图与导览的项目，然后在浏览器里直接打开 `explorer.html`
- **THEN** 结构图、层内视图、聚焦、领域图、代码查看器与 Learn 面板都能用，且页面没有发出网络请求

#### Scenario: 数据只改形状
- **WHEN** 打包一个项目
- **THEN** 页面里的节点、边、层、领域节点与导览步骤的条数和内容与产物里的相同

#### Scenario: 没有领域图
- **WHEN** 打包一个没有 `domain-graph.json` 的项目
- **THEN** 副本照它自己没有领域图时的样子显示，打包回复写明领域图 not run

#### Scenario: 层来自完整分析的语义产物
- **WHEN** 打包一个做过完整分析的项目，它的层只在 `semantic-graph.json` 里，且与知识图同一 facts digest
- **THEN** 结构图顶层显示这些层，节点显示语义缓存里的新鲜摘要，判为矛盾的摘要不出现在页面里

#### Scenario: 图里没有层
- **WHEN** 打包一个只做过零模型分析、没有任何层的项目
- **THEN** 结构图顶层按目录显示分组，每个顶层节点恰在一个分组里，项目概览与图例称其为分组；页面数据里的层仍为空

#### Scenario: 图与打包的源码版本不同
- **WHEN** 知识图记录的源码版本与打包时源码快照的版本不同，打开 `explorer.html`
- **THEN** 页面顶部的提示写出两个版本，结构图照常显示；版本相同时不显示这条提示

#### Scenario: 不在 git 里的项目
- **WHEN** 打包一个不在 git 仓库里的项目
- **THEN** 结构图与领域图都能显示，不因提交号为空而被副本判为致命错误

#### Scenario: 我们的核验与证据看得见
- **WHEN** 打包一个做过完整分析的项目，打开 `explorer.html`，选中一个摘要被判矛盾的节点和一个有边的节点
- **THEN** 前者的摘要为空，并写明摘要因与源码矛盾被去掉；其余节点显示核验结论；连接列表每条边显示证据的文件与行号；`mentions` 边在页面里，不计入问题条数

#### Scenario: 覆盖与缺口看得见
- **WHEN** 打包一个知识图有覆盖记录与缺口记录的项目，打开项目概览
- **THEN** 概览按语言列出文件数、解析数与跳过原因，并逐条列出缺口的种类、范围、条数、原因与样例

#### Scenario: 项目名是项目自己的
- **WHEN** 打包一个知识图记下的项目名是临时快照目录名的项目
- **THEN** 页面显示的项目名是项目根目录的名字；重新分析后知识图记下的也是它（根目录有 `package.json` 的 `name` 时用那个）

#### Scenario: 旧查看器不变
- **WHEN** 打包任何项目
- **THEN** `.excavator/view.html` 与本变更之前打出的完全相同

### Requirement: 离线仪表盘的产物视图

`explorer.html` SHALL 显示 unused-code、hotspots、doc-map 三个产物：

- 顶栏：
  - MUST NOT 显示文件与类的切换（以及类视图里的函数开关）和节点类型过滤标签；结构图按文件级显示全部节点类型；
  - 在原来的位置 SHALL 显示 Unused、Hotspots、Doc map 三个按钮，样式与 Domain | Structural 切换相同，当前打开的那个高亮。
- 视图：
  - 点一个按钮，中间区域 SHALL 换成该产物的视图；再点同一个按钮，或点当前所在的 Domain / Structural，SHALL 回到图，图的位置、层级与选中的节点不变；点另一个模式时与没有视图时一样切换模式；
  - 视图的内容 SHALL 满足「Unused code 页」「Doc map 页」「Hotspots 页」三条要求，「产物内容只当文字」同样适用，MUST NOT 出现建议性措辞；
  - 版式 SHALL 用浏览页自己的主题颜色、字体与卡片样式，随浏览页的主题切换。
- 行详情：
  - 点表中一行，右侧栏 SHALL 显示这一行的详情：unused 的字段、信号、分组成员与引用者；hotspots 文件行的字段、逐年提交与同改文件；doc-map 单元的引文、证据位置与核验结论；「仅被测试使用」的行不是 unused，MUST NOT 打开 unused 函数的详情；
  - 行指向的节点在图里时，详情 SHALL 有「在图中显示」：回到结构图并选中该节点，展开它所在的分组并让它出现在视口内；结构图不画该节点（文件级下的函数）时，选中画出的、包含它的最近节点，并写明选中的是哪个；都不在图里时写明不在图里；
  - 行有源码位置且源码已内联时，详情 SHALL 有「打开代码」，用浏览页的代码查看器打开该文件并定位到行；源码没有内联时写明。
- 产物状态：
  - 产物 not run 或 unreadable 时，视图 SHALL 写出状态与原因，not run 时给出产生它的命令；MUST NOT 用编出的数据补齐；
  - 产物与打包时源码快照的版本不同时，视图顶部 SHALL 写出两个版本，内容照常显示。
- 页面 MUST NOT 显示首次打开的引导弹窗。

打包 SHALL 把这三个产物的文件（doc-map 连同 `doc-map/checks.json`）原样放进页面数据，并为每个写出状态（included、not-run、unreadable、different-revision）、原因与版本；状态不是 included 或 different-revision 的，不放内容。

#### Scenario: 顶栏换成三个产物入口
- **WHEN** 打开一个有知识图谱的项目的 `explorer.html`
- **THEN** 顶栏没有 Files、Classes 按钮和 Code、Config 等过滤标签，有 Unused、Hotspots、Doc map 三个按钮；不出现引导弹窗

#### Scenario: 打开 Unused 再回到图
- **WHEN** 在结构图里选中一个节点后点 Unused，按置信度只选 high，再点 Unused
- **THEN** 中间显示 Unused 视图，列出的条数等于 `counts.byConfidence.high`；回到图后同一个节点仍被选中

#### Scenario: 从行详情回到图
- **WHEN** 在 Hotspots 视图点一个文件行，再点详情里的「在图中显示」
- **THEN** 中间回到结构图，该文件的节点被选中，右侧栏显示它的节点详情

#### Scenario: 产物没跑
- **WHEN** 项目没有 `doc-map.json`，点 Doc map
- **THEN** 视图写明 Doc map 是 not run，并给出 `/excavator-doc-map`；不显示任何单元或计数

### Requirement: Products 页

Products 页 SHALL 显示：
- 项目名、源码快照版本、各产物的生成版本；
- 每个产物一张卡片：状态（见「每个产物落进看得见的状态」）、产物的关键计数，以及到该产物页的跳转；
- 知识图谱头部给出的语言、框架、节点数、边数（按类型）、缺口数与覆盖计数。

页面上的每个数字 SHALL 直接取自产物字段或对产物条目的计数，MUST NOT 是估计值。旧路由 `#/overview` SHALL 重定向到 `#/products`。

#### Scenario: 图谱计数
- **WHEN** 知识图谱已内联
- **THEN** Products 页的节点数与边数等于 `knowledge-graph.jsonl` 里 node 与 edge 记录的条数，按类型的分布也一致

#### Scenario: 旧书签
- **WHEN** 打开 `#/overview`
- **THEN** 页面显示 Products 页，地址变为 `#/products`

### Requirement: 三种模式

图页（结构图与领域图）SHALL 有三种模式，顶栏用分段按钮切换，模式写进 hash 参数 `mode`（`overview`、`learn`、`deep`），默认 `learn`：
- **Overview**：结构图不画 `function` 与 `class` 节点，文件节点不能再展开出它们；图上写明「函数与类已隐去」；空闲侧栏是项目总览；
- **Learn**：画出全部节点；空闲侧栏是导览的状态：not run 时给出 `/excavator-tour`，unreadable 时写出原因，different revision 时写出两个版本、不显示步骤，included 时列出步数与各步标题；
- **Deep dive**：画出全部节点；空闲侧栏是项目总览。

模式 MUST NOT 改变任何计数：簇与容器上的文件数、节点数，折叠计数与下钻计数在三种模式下相同。搜索 SHALL 仍能找到被隐去的节点：在 Overview 模式下选中一个函数或类的结果时，页面切到 Deep dive 再定位，并在侧栏写明切换了模式。

#### Scenario: Overview 模式
- **WHEN** 在 Overview 模式下进入一个层
- **THEN** 图上没有函数与类节点，簇与容器上的文件数与 Deep dive 模式相同

#### Scenario: 搜索命中被隐去的节点
- **WHEN** 在 Overview 模式下搜索一个函数名并选中结果
- **THEN** 模式切到 Deep dive，图定位并选中该函数，侧栏写明模式已切换

### Requirement: 领域与结构切换

领域图可读时，图页 SHALL 在图的上方显示 Domain | Structural 分段按钮，在领域视图与结构图之间切换，切换走 hash，两边各自保留自己的下钻位置与选中。领域图不可读时不显示这组按钮。左侧导航的 Graph 与 Domain 两项保留，指向同样的视图。

#### Scenario: 来回切换
- **WHEN** 在结构图里进入一个层，切到 Domain 再切回 Structural
- **THEN** 结构图仍在那一层

### Requirement: 项目总览

没有选中任何节点时，Overview 与 Deep dive 模式的侧栏 SHALL 显示项目总览：
- 项目名；领域图可读且有 `project.description` 时显示这段描述，否则不显示这一行；
- 节点数、边数、层数、文件数；
- 图谱头部的语言与框架；
- 节点类型分布与复杂度分布（各类计数）；
- 入边加出边最多的 5 个节点，点击选中；
- 层列表与各层文件数，点击进入该层；
- 已内联产物的要点：未使用函数总数与按置信度的计数、分数最高的 3 个文件，每项能跳到对应详情页；产物没跑时写 not run；
- 导览为 included 时有「开始导览」，切到 Learn 模式。

总览里的每个数字 SHALL 直接取自产物字段或对产物条目的计数。

#### Scenario: 总览计数
- **WHEN** 图谱与 unused-code 都已内联
- **THEN** 总览的文件数等于图谱的文件节点数，未使用函数总数等于 unused-code 的 `unused` 条数

### Requirement: 详情页的行面板与跳转

Unused、Hotspots 与 Doc map 页 SHALL：
- 在表格上方显示产物的统计格与分布图（Unused：按置信度与按语言；Hotspots：逐年提交、分数分布与分数最高的 10 个文件；Doc map：按查找状态与按核验结论），图中每个数取自产物字段或对产物条目的计数；
- 点击一行时在右侧打开行详情面板：该行的全部字段、源码预览（高亮行范围）、在图中定位与打开代码；Unused 的面板另有所在组的其它成员与引用者，Hotspots 文件行的面板另有逐年提交（产物有 `commitsByYear` 时）与一起改最多的文件；
- 接受 hash 参数 `row`（Unused 为节点 id，Hotspots 为文件路径，同时给 `view=files`，Doc map 为单元在产物里的序号，从 1 起：单元的 id 可以为空或在文档之间重复）：进入时切到这一行所在的分页、滚到它、短暂高亮并打开行面板；找不到这一行时写明，不打开面板；
- 接受 hash 参数 `prefix`：只列路径在这个前缀下的行，并在页面上方写明过滤条件与行数，可以清除。

表格首屏的行 SHALL 依次进场；系统设置了「减少动效」时直接出现。

#### Scenario: 从链接打开一行
- **WHEN** 打开 `#/unused?row=<某个未使用函数的节点 id>`
- **THEN** 表格显示该行所在的分页，该行被高亮，行面板打开并显示该函数的字段与源码

#### Scenario: 按前缀过滤
- **WHEN** 打开 `#/unused?prefix=<某个目录>`
- **THEN** 列出的行数等于 `unused` 里路径在该目录下的条数
