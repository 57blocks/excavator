## ADDED Requirements

### Requirement: 名称按所选语言显示

给了 `--language <lang>` 且语言不是英文（规则见下）时，页面上的节点显示名与领域图里领域、流程、步骤的名称 SHALL 按该语言显示，译文取自页面旁边的翻译表 `view-translations/<lang>.json`。

- 语言名 SHALL 去掉首尾空白、转成小写后使用：`en`、`english` 与以 `en-` 或 `en_` 开头的名称算英文；其余名称只能含字母（任何文字）、数字、`-` 与 `_`，含其他字符时报错退出、不写页面；翻译表的文件名就是这个小写语言名。
- 翻译表 SHALL 按英文原文的 SHA-256 索引，每条存下英文原文与译文；打包只取哈希与原文都对得上的条目，对不上的不取用并计数。
- 待译名称 SHALL 由确定性脚本列出：页面要显示的名称（`contradicted` 与不新鲜条目的名称不在其中），减去翻译表已有的（含拒绝记录的），同一段英文只列一次。
- 翻译 SHALL 由一个只做翻译的子代理按批完成；它只读批文件、只写结果文件，不读源码与其他产物。批文件与结果文件放在翻译表旁边的临时目录里，合并结束后删除。
- 每条译文 SHALL 经确定性核对：非空、单行、最多 60 个字符且不超过原文字符数的 2 倍加 10、原文里的代码记号（含 `_` 或 `.` 的标识符、含数字或连续大写字母的词、HTTP 动词、反引号里的内容）逐字保留、键与批文件一一对应（结果里有批文件没有的键时整批失败）。不过的条目的译文 MUST NOT 进翻译表；重派一次仍不过时，页面上该名称用英文，并计数；该名称以拒绝记录写进翻译表，英文不变时之后的导出不再重派；`no-result`（子代理没有写出结果）不记为拒绝，下次导出重派。
- 页面 SHALL 标明译文：节点详情写出英文原文，领域图名称在悬停与详情里给英文原文，概览写明名称经机器翻译以及译出与保留英文的条数；搜索同时匹配译文与英文。
- 打包 MUST NOT 调用模型；翻译只在 skill 编排的打包前步骤里发生。没有待译名称时 MUST NOT 派子代理。
- 不给 `--language` 或给英文时，页面内联的数据与 manifest SHALL 与不支持翻译时相同，两者写出的页面逐字节相同，且 MUST NOT 读写翻译表。

#### Scenario: 中文导出
- **WHEN** 对一个做过完整分析、有领域图的项目运行 `/excavator-view --language zh`
- **THEN** 节点卡片主标题是中文译名、副标题是代码名，节点详情写出英文原文；领域、流程、步骤显示中文译名；回复第六行写出译出与保留英文的条数，两者之和等于名称总数

#### Scenario: 第二次导出复用译文
- **WHEN** 对同一项目、同一语言再运行一次，期间名称没有变化
- **THEN** 不派翻译子代理，页面上的译名与上次相同

#### Scenario: 译文丢了代码记号
- **WHEN** 子代理把 `Validate OAuth2 token` 译成不含 `OAuth2` 的文字，重派一次仍然如此
- **THEN** 该条不进翻译表，页面上它显示英文原名，回复计入保留英文的条数

#### Scenario: 英文导出不变
- **WHEN** 运行 `/excavator-view` 不给 `--language`，或给 `--language english`
- **THEN** 两次写出的页面逐字节相同，页面数据里没有译名，不出现 `view-translations/` 目录

## MODIFIED Requirements

### Requirement: /excavator-view skill

`/excavator-view [project-path] [--source] [--no-source] [--out <path>] [--language <lang>]` SHALL（`--source` 要求内嵌源码，默认与 `--no-source` 不内嵌，见「内嵌源码与它的可见分类」；`--language` 见「名称按所选语言显示」）：
1. 给了非英文的 `--language` 时，先列出待译名称，按批派翻译子代理，核对并合并译文；
2. 运行打包，写出 `explorer.html`；
3. 用系统默认浏览器打开写出的文件（macOS `open`、Linux `xdg-open`、Windows `start`）；没有可用的打开命令时，只给出文件路径，不算失败；
4. 最后用一条命令打印固定的五行作为回复，依次是：
   - `Explorer: <绝对路径>`
   - `Size: <MB，一位小数> MB`
   - `Issues: <N>`：副本自己的校验器在图里找到的问题条数；没有知识图谱时写 `Issues: not counted; knowledge graph <状态>`
   - `Products: knowledge graph <状态>; semantics <状态>; domain graph <状态>; unused code <状态>; doc map <状态>; hotspots <状态>; tour <状态>`
   - `Source: embedded (<N> files)` 或 `Source: not embedded`

   给了非英文的 `--language` 时再加第六行 `Translation: <语言> <译出>/<总数> names (<保留英文> in English)`。

`Explorer:` 是写出的路径，`Size:` 是写出文件的大小；其余各行 SHALL 取自页面里打包写下的 manifest，所以回复说的就是页面里有的东西。回复各行用英文，不因 `--language` 改变。

skill MUST NOT 启动 HTTP 服务，MUST NOT 运行任何分析，MUST NOT 改动 `.excavator/` 下除写出的页面与它旁边的翻译表以外的任何文件；给了 `--out` 时翻译表写在页面旁边，`.excavator/` 下不写任何文件。除翻译子代理外，skill MUST NOT 调用模型。没有任何产物时，它仍写出页面，并在回复里写明全部产物都是 not run。

#### Scenario: 只有 hotspots
- **WHEN** 项目只跑过 `/excavator-hotspots`
- **THEN** skill 写出并打开 `explorer.html`；回复的 Products 一行里 hotspots 为 included，其余为 not run；Issues 一行写明没有知识图谱、没有计数

#### Scenario: 指定输出路径
- **WHEN** 运行 `/excavator-view --out <dir>/page.html`
- **THEN** 回复第一行是 `Explorer: <dir>/page.html` 的绝对路径，打开的也是它

#### Scenario: 指定输出路径时翻译表跟着页面
- **WHEN** 运行 `/excavator-view --out <dir>/page.html --language zh`
- **THEN** 翻译表写在 `<dir>/view-translations/zh.json`，项目的 `.excavator/` 下没有新文件或改动

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
  - 节点有显示名（`displayName`）时，节点卡片以它为主标题、代码名为副标题，搜索也匹配它；没有时照副本只显示代码名；
  - 产物视图与顶栏的改动（见「离线仪表盘的产物视图」）。
  - 打开页面时默认的视角是 Overview；有领域图时默认的模式是 Domain，没有领域图时照副本是 Structural；
  - 主题：增加两个按颜色命名的预设 Light Violet 与 Dark Violet，以及每组强调色里的 Violet，默认是 Light Violet 配 Violet（样式表里 JavaScript 应用主题之前的回退值也是 Light Violet）；主题由顶栏 Theme 按钮打开的下拉菜单切换；原有预设与强调色保留；用户在主题选择里选过的主题仍优先于默认，但选择存在页面自己的键下，副本原来那个键里存的选择（Light Violet 成为默认之前存下的，或别的副本页面存下的）不再读；仪表盘自己写死的金色强调（边、分组边框、搜索命中标记、选中边的标签）改为跟随当前强调色，导出的独立 SVG 例外；主题名与界面 MUST NOT 出现公司名；
  - 差异覆盖层的说明文字、层卡片上的计数与分组高亮（见「差异覆盖层」）；
  - 给了非英文的 `--language` 时，名称显示译名并写出英文原文，概览写明名称经机器翻译（见「名称按所选语言显示」）。
- 页面 SHALL 是一个自包含的 HTML 文件，从磁盘直接打开即可使用，不需要 Node、网络或本地服务，打开后不发出任何网络请求。

填入的数据：
- SHALL 只改形状、不改内容：
  - 知识图谱的逐行记录拼回一个图；
  - 完整分析的语义产物按下列规则并进图：
    - 语义缓存的条目只取打包时仍然新鲜的：条目的 `semanticSourceHash` 等于 `source-manifest.json` 里该文件当前的 `contentHash`；不新鲜的条目不进页面，只在打包结果里计数；
    - 节点的摘要先取语义条目的（非空时），再取节点自己的；标签先取语义条目的（有标签时），再取节点自己的；
    - 节点的显示名先取语义条目的（非空时），再取节点自己的；
    - 核验结论为 `contradicted` 的摘要与显示名都为空，结论来自语义条目或节点自己都一样；它们的原文 MUST NOT 出现在页面里；
    - 层取语义图的 `layers`（与知识图同一 facts digest 且至少有一层时），否则用知识图自己的；
  - 节点带上语义条目的核验结论（`verification`），条目没有结论（例如文件节点）时不写；
  - 知识图记下的项目名是分析时临时快照目录的名字（`excavator-snapshot-<种类>-<6 位>`）时，页面用项目根目录的名字，别的名字原样；
  - 领域图、`meta.json` 原样；
  - 导览步骤放进图的 `tour`；
  - 不在 git 里的项目，两张图的 `project.gitCommitHash` 是 `null`，写成副本表示「没有提交号」的空字符串；
  - 源码按「内嵌源码与它的可见分类」内联，`--no-source` 时不内联；
  - 有知识图时写 `staleness.json`：每张打包进去的图记录的源码版本与打包时源码快照的版本相同时为 fresh，不同或图没有记录版本时为「版本不同」，页面顶部写出两个版本（没有记录时写明没有记录），并写明页面里的代码是随页面打包的源码、行号可能与图对不上。它只比较打包时读到的东西，MUST NOT 声称工作区在打包之后的状态。
- 给了非英文的 `--language` 时，页面数据多一个译名表：页面要显示的每个英文名称对应它的译文（没有通过核对的译文时不列），以及语言与计数（见「名称按所选语言显示」）。图与领域图里的名称仍是英文原文，不因译名表改变；页面显示名称时查这张表。
- 缺少的产物 SHALL 落进副本自己的空状态（例如没有领域图时领域切换不可用），不得用编出的数据补齐；
- 副本的校验报告的问题 SHALL 照副本自己的方式显示，打包回复写出问题条数；我们的图里合法的数据（`mentions` 边、为空的摘要）不算问题。

#### Scenario: 不起服务就能看
- **WHEN** 打包一个有知识图谱、领域图与导览的项目，然后在浏览器里直接打开 `explorer.html`
- **THEN** 结构图、层内视图、聚焦、领域图、代码查看器与 Learn 面板都能用，且页面没有发出网络请求

#### Scenario: 数据只改形状
- **WHEN** 打包一个项目
- **THEN** 页面里的节点、边、层、领域节点与导览步骤的条数和内容与产物里的相同

#### Scenario: 译名不改图的数据
- **WHEN** 用 `--language zh` 打包一个有译文的项目
- **THEN** 页面数据里的知识图与领域图和不给 `--language` 时相同，名称仍是英文；译名只在译名表里，每条以英文原文为键

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

#### Scenario: 打开时的默认
- **WHEN** 在没有存过主题选择的浏览器里打开一个有知识图谱与领域图的项目的 `explorer.html`
- **THEN** 主题是 Light Violet 配 Violet，视角选中 Overview，模式选中 Domain，中间显示领域图

#### Scenario: 旧键里的主题选择不再读
- **WHEN** 浏览器在副本原来的主题键里存着 Dark Violet，在页面自己的键里没有存过，打开 `explorer.html`
- **THEN** 主题是 Light Violet；在 Theme 下拉里选 Dark Violet 后再打开，主题是 Dark Violet

#### Scenario: 节点显示名称
- **WHEN** 打包一个做过完整分析的项目，节点 `rejectRequest` 的新鲜语义条目带 `displayName: "Reject request and restore quota"`，另一个节点没有语义条目
- **THEN** 前者的卡片主标题是 `Reject request and restore quota`、副标题是 `rejectRequest`，搜索 `restore quota` 能找到它；后者照副本只显示代码名
