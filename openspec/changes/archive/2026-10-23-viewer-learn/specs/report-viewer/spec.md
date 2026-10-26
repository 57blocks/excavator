## ADDED Requirements

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

## MODIFIED Requirements

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

## RENAMED Requirements

- FROM: `### Requirement: Overview 页`
- TO: `### Requirement: Products 页`
