## MODIFIED Requirements

### Requirement: 每个产物落进看得见的状态

打包 SHALL 对下列每个产物给出且只给出一种状态，查看页的 Overview SHALL 逐一列出：
- 知识图谱（`knowledge-graph.jsonl` 及其 `source-manifest.json`）
- 语义（`semantic-cache.json` 与 `semantic-graph.json`：Full 模式写出的摘要、标签与层）
- 领域图（`domain-graph.json`）
- unused-code（`unused-code.json`）
- doc-map（`doc-map.json` 与 `doc-map/checks.json`）
- hotspots（`hotspots.json`）
- 报告（`hotspots-report.md`、`doc-map-report.md`）

状态只有四种：
- **included**：读到并内联；
- **not run**：文件不存在。页面写出生成它的命令；
- **unreadable**：文件存在但读不了或格式不对（不是 JSON、`format` 或版本不是查看页认识的版本、缺必需字段）。页面写出原因，MUST NOT 部分显示。以下也属于这一类：
  - 领域图的 `version` 不是 `2.0.0`，或 `contentLanguage` 不是 `en`；
  - 语义缓存的 `contentLanguage` 不是 `en`，或语义图的 `factDigest` 与知识图谱的 `factsDigest` 不同；
- **different revision**：读到并内联，但产物记录的源码版本与打包时源码快照的版本不同。页面在 Overview 和该产物页的顶部写出两个版本，内容照常显示。

产物没有记录源码版本时（例如报告 Markdown），SHALL 显示为 included，并注明「没有记录版本」，MUST NOT 当作版本相同。

#### Scenario: 没跑过 hotspots
- **WHEN** `.excavator/` 里没有 `hotspots.json`
- **THEN** Overview 把 hotspots 列为 not run 并给出 `/excavator-hotspots`；Hotspots 页显示同样的说明，不显示空表

#### Scenario: 产物损坏
- **WHEN** `unused-code.json` 不是合法 JSON
- **THEN** unused-code 的状态是 unreadable 并带原因，页面不显示它的任何条目

#### Scenario: 源码已经前进
- **WHEN** `hotspots.json` 的 `sourceRevision` 与当前源码快照的版本不同
- **THEN** Overview 与 Hotspots 页顶部都写出两个版本，表格照常显示

#### Scenario: 领域图语言不对
- **WHEN** `domain-graph.json` 的 `contentLanguage` 不是 `en`
- **THEN** 领域图的状态是 unreadable，原因写明语言，领域视图不显示任何节点

#### Scenario: Lazy 图谱没有语义文件
- **WHEN** `.excavator/` 里没有 `semantic-cache.json`，图谱节点自带摘要
- **THEN** 语义的状态是 not run，并给出 `/excavator --full`；节点摘要照常取自图谱

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
- 文件 SHALL 带内容安全策略：禁止一切连接；脚本与样式只允许内联；图片只允许 `data:`；Worker 只允许 `blob:`。

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

### Requirement: 界面与主题

界面文字 SHALL 是英文；产物与源码里的文字原样显示。

版式 SHALL 照 Understand Anything 的 dashboard 组织：
- 顶栏放项目名、搜索、叠加层与过滤入口；
- 左侧是视图导航；
- 中间是图或表格页；
- 右侧是可收起的详情侧栏，底部是可收起、可放大的代码抽屉；
- 浮层（侧栏、抽屉、弹窗、菜单）有半透明背景与模糊，卡片有圆角与柔和阴影。

页面 SHALL 只有浅色主题：
- 配色取自 57blocks 官网的设计 token（背景、正文、弱化文字、分隔线与强调色），不跟随系统的深色模式；
- 节点类型的颜色在浅色背景上可区分，并且在图例里列出；
- 页面 MUST NOT 加载外部字体；字体按名字声明，回退到系统字体。

页面 SHALL 有动效：
- 视图切换、侧栏与抽屉的进出、弹窗、列表首屏与统计数字都有过渡；
- 图的下钻、聚焦与定位有镜头过渡；
- 缓动与时长取 57blocks 官网的语汇。

动效 MUST NOT 推迟数据的显示：就绪信号在内容画出时给出，不等动画结束。系统设置了「减少动效」时，页面 SHALL 不播放任何过渡与循环动画。

页面 SHALL 在 1280 像素宽和 768 像素宽下都能用：不出现整页横向滚动，表格在自己的容器里滚动；768 宽时侧栏改为覆盖在图上。

#### Scenario: 系统是深色模式
- **WHEN** 操作系统设为深色模式后打开页面
- **THEN** 页面仍是浅色主题

#### Scenario: 减少动效
- **WHEN** 系统设置了「减少动效」，用户切换视图并打开侧栏
- **THEN** 内容直接出现，页面上没有正在运行的动画

## ADDED Requirements

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
