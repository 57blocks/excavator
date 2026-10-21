## Purpose

把一个项目 `.excavator/` 下的产物与对应源码打包成一个自包含的静态 HTML 页面，只用浏览器就能打开浏览：不联网、不装任何东西、不起服务。页面只陈述产物里的事实，每条记录都能跳到它所指的源码行；缺失、读不了、版本不同都看得见。

## ADDED Requirements

### Requirement: 打包成一个自包含的 HTML

打包 SHALL 读取项目 `.excavator/` 下的产物与源码快照里的源码，写出一个 HTML 文件，默认路径 `<project>/.excavator/view.html`，可以用参数改写到别的路径。

写出的文件 SHALL 自包含：
- 页面的全部样式、脚本与数据都内联在这一个文件里；
- 打开时 MUST NOT 请求任何网络或本地文件资源（包括字体、图标、脚本、样式与数据）；
- 文件 SHALL 带内容安全策略：禁止一切连接，脚本与样式只允许内联，图片只允许 `data:`。

查看页的前端代码 SHALL 是零依赖的：没有 npm 依赖、没有构建步骤，源文件就是浏览器执行的代码；它 MUST NOT 引用仓库里查看页目录之外的任何代码。

打包 SHALL 是确定的：同一组产物、同一个源码版本、同一组参数，写出的文件逐字节相同。文件里 MUST NOT 写入打包时间。

打包 SHALL 先写临时文件再改名；失败时 MUST NOT 留下半个文件，也 MUST NOT 改动已有的同名文件。

#### Scenario: 断网打开
- **WHEN** 在没有网络的机器上用 Chrome 以 `file://` 打开写出的文件
- **THEN** 页面完整显示，没有网络请求、没有控制台错误，也没有内容安全策略违规

#### Scenario: 重复打包
- **WHEN** 产物、源码与参数都没变，连续打包两次
- **THEN** 两次写出的文件逐字节相同

#### Scenario: 打包失败
- **WHEN** 打包中途出错，而目标路径上已有一个旧的查看页
- **THEN** 命令以非零状态退出并说明原因，旧文件原样保留

### Requirement: 每个产物落进看得见的状态

打包 SHALL 对下列每个产物给出且只给出一种状态，查看页的 Overview SHALL 逐一列出：
- 知识图谱（`knowledge-graph.jsonl` 及其 `source-manifest.json`）
- unused-code（`unused-code.json`）
- doc-map（`doc-map.json` 与 `doc-map/checks.json`）
- hotspots（`hotspots.json`）
- 报告（`hotspots-report.md`、`doc-map-report.md`）

状态只有四种：
- **included**：读到并内联；
- **not run**：文件不存在。页面写出生成它的命令；
- **unreadable**：文件存在但读不了或格式不对（不是 JSON、`format` 不是查看页认识的版本、缺必需字段）。页面写出原因，MUST NOT 部分显示；
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

### Requirement: Overview 页

Overview SHALL 显示：
- 项目名、源码快照版本、各产物的生成版本；
- 知识图谱头部给出的语言、框架、节点数、边数（按类型）、缺口数与覆盖计数；
- 每个产物的状态（见「每个产物落进看得见的状态」）。

页面上的每个数字 SHALL 直接取自产物字段或对产物条目的计数，MUST NOT 是估计值。

#### Scenario: 图谱计数
- **WHEN** 知识图谱已内联
- **THEN** Overview 的节点数与边数等于 `knowledge-graph.jsonl` 里 node 与 edge 记录的条数，按类型的分布也一致

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

页面 SHALL 只有浅色主题，配色取自 57blocks 官网的设计 token（背景、正文、弱化文字、分隔线与强调色），不跟随系统的深色模式。页面 MUST NOT 加载外部字体；字体按名字声明并回退到系统字体。

页面 SHALL 在 1280 像素宽和 768 像素宽下都能用：不出现整页横向滚动，表格在自己的容器里滚动。

#### Scenario: 系统是深色模式
- **WHEN** 操作系统设为深色模式后打开页面
- **THEN** 页面仍是浅色主题

### Requirement: /excavator-view skill

`/excavator-view [project-path] [--no-source] [--out <path>]` SHALL：
1. 运行打包，写出查看页；
2. 用系统默认浏览器打开写出的文件（macOS `open`、Linux `xdg-open`、Windows `start`）；没有可用的打开命令时，只给出文件路径，不算失败；
3. 最后回复固定的几行：文件路径、文件大小、每个产物的状态，以及「文件内嵌了源码」或「文件没有内嵌源码」。

skill MUST NOT 启动 HTTP 服务，MUST NOT 运行任何分析，MUST NOT 改动 `.excavator/` 下除写出的查看页以外的任何文件。没有任何产物时，它仍写出页面，并在回复里说明全部产物都是 not run。

#### Scenario: 只有 hotspots
- **WHEN** 项目只跑过 `/excavator-hotspots`
- **THEN** skill 写出并打开查看页，回复列出 hotspots 为 included，其余为 not run
