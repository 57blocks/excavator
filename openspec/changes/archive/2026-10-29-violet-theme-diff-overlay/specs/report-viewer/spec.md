## MODIFIED Requirements

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

## ADDED Requirements

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
