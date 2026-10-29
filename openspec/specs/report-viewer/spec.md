# report-viewer Specification

## Purpose
把一个项目 `.excavator/` 下的产物与对应源码打包成一个自包含的静态 HTML 页面，只用浏览器就能打开浏览：不联网、不装任何东西、不起服务。页面只陈述产物里的事实，每条记录都能跳到它所指的源码行；缺失、读不了、版本不同都看得见。

## Requirements

### Requirement: 打包成一个自包含的 HTML

打包 SHALL 读取项目 `.excavator/` 下的产物与源码快照里的源码，写出一个 HTML 文件 `explorer.html`，默认路径 `<project>/.excavator/explorer.html`。给了 `--out <path>` 时写到那个路径，文件名不限。打包 MUST NOT 再写出 `view.html`，也 MUST NOT 删除或改动项目里已有的 `view.html`。

页面的前端 SHALL 来自 `packages/explorer` 构建出的单个 HTML 模板：
- 构建把全部 JS、CSS 与 Worker 内联进这一个文件，没有分块，也没有外部文件；
- 打包只往模板里插入内容安全策略与数据，不改动模板的其余字节；
- 模板或副本的校验器不存在时，打包 MUST 以非零状态退出并写明要先运行 `pnpm build`。

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
- **WHEN** 打包中途出错，而目标路径上已有一个旧的页面
- **THEN** 命令以非零状态退出并说明原因，旧文件原样保留

#### Scenario: 没有构建模板
- **WHEN** `packages/explorer` 还没有构建
- **THEN** 打包以非零状态退出，说明要先运行 `pnpm build`，不写出任何文件

#### Scenario: 指定输出路径
- **WHEN** 打包时给了 `--out <dir>/page.html`
- **THEN** 页面写到 `<dir>/page.html`；`<dir>` 与项目的 `.excavator/` 里都不多出别的文件

### Requirement: 每个产物落进看得见的状态

打包 SHALL 对下列每个产物给出且只给出一种状态，写进页面的 manifest 与打包的结果：
- 知识图谱（`knowledge-graph.jsonl` 及其 `source-manifest.json`）
- 语义（`semantic-cache.json` 与 `semantic-graph.json`：Full 模式写出的摘要、标签与层）
- 领域图（`domain-graph.json`）
- unused-code（`unused-code.json`）
- doc-map（`doc-map.json` 与 `doc-map/checks.json`）
- hotspots（`hotspots.json`）
- 导览（`tour.json`）

产物文件本身的状态只有下面四种；语义与导览另有一种 **not shown**，见下文：
- **included**：读到并放进页面；
- **not run**：文件不存在。给出生成它的命令；
- **unreadable**：文件存在但读不了或格式不对（不是 JSON、`format` 或版本不是打包认识的版本、缺必需字段）。写出原因，页面 MUST NOT 部分显示它。以下也属于这一类：
  - 领域图的 `version` 不是 `2.0.0`，或 `contentLanguage` 不是 `en`；
  - 语义缓存的 `contentLanguage` 不是 `en`，或语义图的 `factDigest` 与知识图谱的 `factsDigest` 不同；
  - 导览的 `format` 不是 `excavator-tour/1`；
- **different revision**：读到并放进页面，但产物记录的源码版本与打包时源码快照的版本不同。内容照常显示，并写出两个版本。导览例外：它的 `factDigest` 与知识图谱的 `factsDigest` 不同时为 different revision，图里不放它的步骤（步骤里的节点 id 可能已对不上）。

产物没有记录源码版本时，SHALL 为 included 并注明「没有记录版本」，MUST NOT 当作版本相同。

每个产物的状态 SHALL 只判定一次，回复、打包结果与页面用的是同一个判定，所以状态就是页面实际放进去的情况：
- 知识图谱 SHALL 在判定时读全文。正文被拒（例如有不认识的记录类型）时它为 unreadable 并写出原因，与文件头被拒一样：页面不放图，其他产物也不拿它比较（领域图因此为 unreadable，原因是没有可读的知识图谱来比较 `factDigest`）；
- 语义与导览先做完它们自己文件的检查（语义含 `semantic-cache.json` 与 `semantic-graph.json` 的版本、语言与必需字段）。自己的检查不通过时 SHALL 为 unreadable 并写出它自己的原因；
- 自己的检查都通过、但没有可读的知识图谱（不存在、文件头或正文被拒）时，它们没有地方放，SHALL 写为 **not shown**，原因是没有知识图谱可放。

`/excavator-view` 的回复 SHALL 写出每个产物的状态（见「/excavator-view skill」）。页面里，unused-code、hotspots、doc-map 的状态由它们各自的视图写出（见「离线仪表盘的产物视图」）；知识图谱与领域图的版本由页面顶部的版本提示写出（见「离线仪表盘」）；其余产物不在或读不了时，页面照副本自己的空状态显示。

打包 MUST NOT 读取 `hotspots-report.md` 与 `doc-map-report.md`：它们不进页面，读不了也不影响打包。

#### Scenario: 没跑过 hotspots
- **WHEN** `.excavator/` 里没有 `hotspots.json`
- **THEN** 回复把 hotspots 写为 not run；Hotspots 视图写明 not run 并给出 `/excavator-hotspots`，不显示空表

#### Scenario: 没有知识图谱时的语义与导览
- **WHEN** `.excavator/` 里有格式正确的 `semantic-cache.json` 与 `tour.json`，但没有 `knowledge-graph.jsonl`，或它的文件头、正文被拒
- **THEN** 回复把语义与导览写为 not shown，原因是没有知识图谱可放；其中自己的检查不通过的那个（例如 `semantic-graph.json` 缺 `layers`）仍写为 unreadable 并给出它自己的原因，有没有知识图谱都一样

#### Scenario: 产物损坏
- **WHEN** `unused-code.json` 不是合法 JSON
- **THEN** unused-code 的状态是 unreadable 并带原因，页面不显示它的任何条目

#### Scenario: 源码已经前进
- **WHEN** `hotspots.json` 的 `sourceRevision` 与当前源码快照的版本不同
- **THEN** 回复把 hotspots 写为 different revision；Hotspots 视图顶部写出两个版本，表格照常显示

#### Scenario: 领域图语言不对
- **WHEN** `domain-graph.json` 的 `contentLanguage` 不是 `en`
- **THEN** 领域图的状态是 unreadable，原因写明语言，页面没有领域视图

#### Scenario: Lazy 图谱没有语义文件
- **WHEN** `.excavator/` 里没有 `semantic-cache.json`，图谱节点自带摘要
- **THEN** 语义的状态是 not run，给出 `/excavator --full`；节点摘要照常取自图谱

#### Scenario: 没跑过导览
- **WHEN** `.excavator/` 里没有 `tour.json`
- **THEN** 回复把导览写为 not run；图保留知识图谱自己的 `tour`

#### Scenario: 报告文件读不了
- **WHEN** `.excavator/hotspots-report.md` 存在但读不了
- **THEN** 打包照常完成，回复里没有关于它的内容

### Requirement: 内嵌源码与它的可见分类

默认 SHALL 内嵌知识图谱的文件节点，以及已放进页面的 unused-code、doc-map、hotspots 与领域图引用到的每个源文件的文本。文本取自当前源码快照（Git 仓与多仓取 HEAD，不读工作区）。

每个被引用到的文件 SHALL 落进且只落进下面一类，打包的结果 SHALL 给出各类计数：
- **embedded**：已内嵌文本；
- **binary**：不是文本，不内嵌；
- **too large**：超过单文件上限，不内嵌。结果给出上限（`limitBytes`）与这一类的计数，不记单个文件的大小；
- **not in snapshot**：当前快照里没有这个路径（例如产物版本较旧、文件已删除）；
- **not embedded on request**：打包时指定了不嵌源码。

页面的代码查看器 SHALL 能打开每个已内嵌的文件。产物视图里带文件路径的行，文件已内嵌时 SHALL 能打开代码并定位到行；文件没有内嵌时，SHALL 写明这个文件的源码不在页面里。产物指向的行超出内嵌文本的行数时，代码查看器 MUST NOT 标出别的行。

#### Scenario: 从 unused-code 跳到源码
- **WHEN** 在 Unused 视图里点一行，再点详情里的「打开代码」
- **THEN** 代码查看器打开该文件，并标出它的 `lineRange`

#### Scenario: 不嵌源码
- **WHEN** 打包时指定了不嵌源码
- **THEN** 文件里没有任何源码文本；每个被引用文件都归在 not embedded on request；产物视图的行详情写明源码不在页面里

#### Scenario: 行号越界
- **WHEN** 产物记录的行号大于当前快照里该文件的行数，打开这一行的代码
- **THEN** 代码查看器打开该文件，不标出任何一行

### Requirement: 产物内容只当文字

来自产物与源码的任何字符串（名称、路径、摘要、引文、理由、源码）SHALL 只以文字插入页面，MUST NOT 作为 HTML 解析或执行。内联数据 MUST NOT 能提前结束它所在的 `<script>` 元素。

#### Scenario: 名称里有标签
- **WHEN** 某个函数名或引文含有 `</script><script>alert(1)</script>`
- **THEN** 页面原样显示这串文字，没有脚本执行，后面的数据照常读取

### Requirement: /excavator-view skill

`/excavator-view [project-path] [--no-source] [--out <path>]` SHALL：
1. 运行打包，写出 `explorer.html`；
2. 用系统默认浏览器打开写出的文件（macOS `open`、Linux `xdg-open`、Windows `start`）；没有可用的打开命令时，只给出文件路径，不算失败；
3. 最后用一条命令打印固定的五行作为回复，依次是：
   - `Explorer: <绝对路径>`
   - `Size: <MB，一位小数> MB`
   - `Issues: <N>`：副本自己的校验器在图里找到的问题条数；没有知识图谱时写 `Issues: not counted; knowledge graph <状态>`
   - `Products: knowledge graph <状态>; semantics <状态>; domain graph <状态>; unused code <状态>; doc map <状态>; hotspots <状态>; tour <状态>`
   - `Source: embedded (<N> files)` 或 `Source: not embedded`

`Explorer:` 是写出的路径，`Size:` 是写出文件的大小；`Issues:`、`Products:`、`Source:` 三行 SHALL 取自页面里打包写下的 manifest，所以回复说的就是页面里有的东西。

skill MUST NOT 启动 HTTP 服务，MUST NOT 运行任何分析，MUST NOT 改动 `.excavator/` 下除写出的页面以外的任何文件。没有任何产物时，它仍写出页面，并在回复里写明全部产物都是 not run。

#### Scenario: 只有 hotspots
- **WHEN** 项目只跑过 `/excavator-hotspots`
- **THEN** skill 写出并打开 `explorer.html`；回复的 Products 一行里 hotspots 为 included，其余为 not run；Issues 一行写明没有知识图谱、没有计数

#### Scenario: 指定输出路径
- **WHEN** 运行 `/excavator-view --out <dir>/page.html`
- **THEN** 回复第一行是 `Explorer: <dir>/page.html` 的绝对路径，打开的也是它

### Requirement: 离线仪表盘

`/excavator-view` 写出的页面 SHALL 是 Understand Anything 仪表盘的副本，用本项目的产物填数据。

副本的来源与改动：
- 源码取自 Understand Anything 的 `packages/explorer` 与它引用的 `packages/core` 模块，保留 MIT 许可声明与来源提交号；
- 只为离线、产品名、缺层兜底、产物视图、主题与差异覆盖层改动以下几处，此外的界面、交互、主题与文案 MUST NOT 改：
  - 数据文件改为读页面内联的数据；
  - 源码改为读内联的源码；
  - 去掉令牌门；
  - 布局 Worker 内联；
  - 陈旧度在打包时算好，副本多认一种「版本不同」的结果，横幅写出图的版本与打包时源码快照的版本；
  - 界面上显示的产品名与报问题链接改为 Excavator；
  - 图里没有层时，结构图顶层按副本自己的目录分组（目录过于集中时按副本自己的连接聚类）显示，界面上称「分组」而不称「层」；
  - 显示我们图里有而副本原本不显示或显示错的数据：节点摘要的核验结论、`mentions` 边、边的证据（文件与行号）、覆盖记录与缺口记录；
  - 产物视图与顶栏的改动（见「离线仪表盘的产物视图」）。
  - 主题：增加两个按颜色命名的预设 Dark Violet 与 Light Violet，以及每组强调色里的 Violet，默认是 Dark Violet 配 Violet；原有预设与强调色保留；用户在主题选择里选过的主题仍优先于默认；仪表盘自己写死的金色强调（边、分组边框、搜索命中标记、选中边的标签）改为跟随当前强调色，导出的独立 SVG 例外；主题名与界面 MUST NOT 出现公司名；
  - 差异覆盖层的说明文字、层卡片上的计数与分组高亮（见「差异覆盖层」）。
- 页面 SHALL 是一个自包含的 HTML 文件，从磁盘直接打开即可使用，不需要 Node、网络或本地服务，打开后不发出任何网络请求。

填入的数据：
- SHALL 只改形状、不改内容：
  - 知识图谱的逐行记录拼回一个图；
  - 完整分析的语义产物按下列规则并进图：
    - 语义缓存的条目只取打包时仍然新鲜的：条目的 `semanticSourceHash` 等于 `source-manifest.json` 里该文件当前的 `contentHash`；不新鲜的条目不进页面，只在打包结果里计数；
    - 节点的摘要先取语义条目的（非空时），再取节点自己的；标签先取语义条目的（有标签时），再取节点自己的；
    - 核验结论为 `contradicted` 的摘要为空，结论来自语义条目或节点自己都一样；这条摘要的原文 MUST NOT 出现在页面里；
    - 层取语义图的 `layers`（与知识图同一 facts digest 且至少有一层时），否则用知识图自己的；
  - 节点带上语义条目的核验结论（`verification`），条目没有结论（例如文件节点）时不写；
  - 知识图记下的项目名是分析时临时快照目录的名字（`excavator-snapshot-<种类>-<6 位>`）时，页面用项目根目录的名字，别的名字原样；
  - 领域图、`meta.json` 原样；
  - 导览步骤放进图的 `tour`；
  - 不在 git 里的项目，两张图的 `project.gitCommitHash` 是 `null`，写成副本表示「没有提交号」的空字符串；
  - 源码按「内嵌源码与它的可见分类」内联，`--no-source` 时不内联；
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
- **WHEN** 项目的 `.excavator/` 里有一个从前打出的 `view.html`，再打包一次
- **THEN** 写出 `explorer.html`，`view.html` 原样保留，既不更新也不删除

### Requirement: 离线仪表盘的产物视图

`explorer.html` SHALL 显示 unused-code、hotspots、doc-map 三个产物：

- 顶栏：
  - MUST NOT 显示文件与类的切换（以及类视图里的函数开关）和节点类型过滤标签；结构图按文件级显示全部节点类型；
  - 在原来的位置 SHALL 显示 Unused、Hotspots、Doc map 三个按钮，样式与 Domain | Structural 切换相同，当前打开的那个高亮。
- 视图：
  - 点一个按钮，中间区域 SHALL 换成该产物的视图；再点同一个按钮，或点当前所在的 Domain / Structural，SHALL 回到图，图的位置、层级与选中的节点不变；点另一个模式时与没有视图时一样切换模式；
  - 版式 SHALL 用浏览页自己的主题颜色、字体与卡片样式，随浏览页的主题切换；
  - 「产物内容只当文字」同样适用；视图 MUST NOT 出现建议性措辞（例如「可以删除」「应当移除」「safe to delete」）。
- Unused 视图 SHALL 显示：
  - `counts` 与 `conservation`（候选数、被判定移除数、仅测试使用数、未使用数，以及守恒是否成立）；
  - `decisions`：每条判定的种类、理由与命中数；
  - `unused` 明细：名称、语言、位置、owner、可见性、原因（unreferenced 或 only-reachable-from-unused）、置信度、分组与 signals；可按置信度、原因、语言筛选，按任一列排序；
  - `testOnly` 列表；
  - 产物的 `residualAssumptions` 原文。
- Doc map 视图 SHALL 显示：
  - 每个文档的路径、格式、读取状态与原因、单元数；
  - 每个单元的标题、引文、所在行或页、代码查找状态（found、not-found、not-checked）、证据位置，以及 `doc-map/checks.json` 里对应的核验结论（does、not、none）与理由；没有核验记录的单元 SHALL 显示为「未核验」；代码查找状态是 not-found 的单元显示它的 `searched` 记录，不显示任何代码位置；
  - `coverage`：按目录与按文件的有证据、无证据计数，以及不在事实里的文件；
  - 读不了的文件与原因；
  - 产物的 `residualAssumptions` 原文。
  引文与核验理由 SHALL 原样显示，不翻译、不改写。
- Hotspots 视图 SHALL 显示：
  - 窗口（起始日期或全部历史）、源码类型、是否有历史；没有历史或浅克隆时，在视图顶部写出产物给出的原因；
  - 文件表：提交数、作者数、增删行数、行数、分数、最后修改时间，可按任一列排序，默认按分数；
  - 目录表：同样的计数，以及产物给出的按年提交数与集中度（产物缺这些字段时显示为「产物未提供」，MUST NOT 显示为 0）；
  - 同改文件对：两个文件、共同提交数与各自占比；
  - 功能分组（有分组时）：每组的计数与没有匹配到文件的路径；
  - 产物的 `residualAssumptions` 原文。
- 行详情：
  - 点表中一行，右侧栏 SHALL 显示这一行的详情：unused 的字段、信号、分组成员与引用者；hotspots 文件行的字段、逐年提交与同改文件；doc-map 单元的引文、证据位置与核验结论；「仅被测试使用」的行不是 unused，MUST NOT 打开 unused 函数的详情；
  - 行指向的节点在图里时，详情 SHALL 有「在图中显示」：回到结构图并选中该节点，展开它所在的分组并让它出现在视口内；结构图不画该节点（文件级下的函数）时，选中画出的、包含它的最近节点，并写明选中的是哪个；都不在图里时写明不在图里；
  - 行有源码位置时，按「内嵌源码与它的可见分类」打开代码或写明源码不在页面里。
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

#### Scenario: 旧产物缺字段
- **WHEN** `hotspots.json` 的目录行没有 `commitsByYear`
- **THEN** Hotspots 视图目录表的该列显示「产物未提供」

### Requirement: 差异覆盖层

打包 SHALL 把 `.excavator/diff-overlay.json`（可选输入）放进页面数据的 `diff-overlay.json` 键，供结构图的 Diff 开关使用。目前没有 skill 写这个文件，由用户或脚本写出；它的格式：

- 一个 JSON 对象；`changedNodeIds` 与 `affectedNodeIds` 是字符串数组（改动了的节点、与它们直接相连的节点）；
- 可选的 `label`（一行说明差异的范围）与 `description`（较长的说明），都是字符串；
- 可选的 `provenance.sourceRevision`：写出它时依据的源码版本；
- 其余字段打包不读。

打包规则：
- 文件不存在时，打包结果的这一行为 not-run，页面没有这个键，Diff 开关不可用；
- 文件读不了、不是 JSON 对象、两个数组缺失或含非字符串时为 unreadable，原因写明哪里不对，页面没有这个键；
- 没有知识图时为 unused，页面没有这个键；
- 页面只放 `changedNodeIds`、`affectedNodeIds`、`label`、`description` 四个键；不在知识图里的 id 不放进页面，两个数组里同时出现的 id 只算 changed，这两种的条数 SHALL 写进这一行的原因，MUST NOT 静默丢弃；去掉之后 changed 为空时同样不放这个键，状态为 unused 并写明原因；
- `provenance.sourceRevision` 存在且与打包时源码快照的版本不同时为 different-revision，内容照放，原因写出两个版本；否则为 included。

页面：
- 有差异覆盖层时 Diff 开关可用且默认打开；顶栏显示 changed 与 affected 的节点数，以及 `label`（有时）；开关的提示文字是 `description`，没有时是 `label`；
- 打开时，结构图顶层的每张层卡片 SHALL 显示该层的 changed 与 affected 数（为零的不显示），两者都为零的层变暗。一个节点在层的 `nodeIds` 里就算这一层；它不在任何层里时，按 `filePath` 算进含同一 `filePath` 节点的层；一个节点在一层里只算一次；
- 层内视图里含有 changed 或 affected 节点的分组 SHALL 高亮，按同样的归属规则，首次显示时就生效；节点本身照副本原有的方式标出。

#### Scenario: 有差异覆盖层
- **WHEN** `.excavator/diff-overlay.json` 有 3 个 changed、2 个 affected 节点，都在知识图里，打包后打开 `explorer.html`
- **THEN** 打包结果这一行为 included；Diff 开关为打开，顶栏写 Changed (3)、Affected (2) 与 `label`；含这些节点的层卡片显示计数，其余层变暗

#### Scenario: 没有差异覆盖层
- **WHEN** 打包一个 `.excavator/` 里没有 `diff-overlay.json` 的项目
- **THEN** 这一行为 not-run，页面数据没有 `diff-overlay.json` 键，Diff 开关不可用

#### Scenario: id 不在图里
- **WHEN** `diff-overlay.json` 的 changed 里有 1 个知识图里没有的 id，affected 里有 1 个同时在 changed 里的 id
- **THEN** 前者不在页面数据里，后者只在 `changedNodeIds` 里；这一行的原因写出 1 个不在图里、1 个两边都有

#### Scenario: 格式错
- **WHEN** `diff-overlay.json` 的 `affectedNodeIds` 是一个字符串
- **THEN** 这一行为 unreadable，原因写明 `affectedNodeIds` 不是字符串数组；页面数据没有这个键；打包照常完成

#### Scenario: 版本不同
- **WHEN** `diff-overlay.json` 的 `provenance.sourceRevision` 与打包时源码快照的版本不同
- **THEN** 这一行为 different-revision，原因写出两个版本，页面照常显示差异覆盖层
