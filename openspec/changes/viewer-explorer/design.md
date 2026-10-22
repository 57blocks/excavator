## Context

UA 仪表盘（来源：Understand Anything 仓库提交 `b8c807c6`，`understand-anything-plugin/packages/explorer`）由 Vite 开发服务器送出。`vite.config.ts` 里的中间件做五件事：
- 送页面；
- 用一次性令牌保护数据（`TokenGate`）；
- 送 `knowledge-graph.json`、`domain-graph.json`、`meta.json`、`diff-overlay.json`、`config.json`、`staleness.json`；
- 送源码给 `CodeViewer`；
- 用 `getGraphFreshnessBatch` 算陈旧度。

浏览器侧有：
- 六处 `fetch` 与 `TokenGate` 的一处，都在 `App.tsx` 与 `TokenGate.tsx`；
- `CodeViewer.tsx` 的一处；
- `KnowledgeGraphView.tsx` 用 `new Worker(new URL(...))` 起布局 Worker；
- `ThemeContext` 与引导层用 `localStorage`。

本仓库的 `packages/report-view` 已经解决过同样的离线问题：
- 单文件插件把脚本与样式折进一个 HTML；
- 字体内联；
- Worker 以 blob 内联；
- `pack.mjs` 把数据与源码写进页面。

此前实测，从磁盘打开的页面里 blob Worker 可用，同目录的 `fetch` 被浏览器拦下，所以数据必须内联、不能读旁边的文件。

go-multirepo 的产物与 UA 的格式几乎一致：
- 知识图谱头记录的键是 `version, project, nodes, edges, layers, tour`，另加 `coverage, gaps`；
- 节点类型（file、function、class、config、pipeline、service）都在 UA 的 `NodeType` 里；
- 边类型除 `mentions`（24 条）外都在 UA 的 `EdgeType` 里；
- 领域图的 domain、flow、step 与三种边同 UA；
- 导览步骤有 UA `TourStep` 的全部字段（order、title、description、nodeIds）。

## Goals / Non-Goals

**Goals:**
- 用户能双击 `explorer.html` 看到与 UA 仪表盘一样的界面，数据是本项目的；
- 副本相对来源的每一处改动都能在 git diff 里逐行看到。

**Non-Goals:**
- 不在这次加 Excavator 自己的页面、叠加层或 57blocks 配色，那些是之后对副本的修改；
- 不改动或删除现有的 `report-view` 包与 `view.html`；
- 不改 UA 的布局、聚合、文案等任何行为，哪怕我们觉得可以更好。

## Decisions

### D1 原样复制、单独一个 commit

`packages/explorer/src`（含 `__tests__`）、`index.html` 与它引用的 `packages/core/src` 模块（`types`、`schema`、`search`，以及它们再引用的模块）原样复制进 `packages/explorer`。core 的模块放在 `packages/explorer/src/core/`，导入路径 `@understand-anything/core/*` 用 Vite 与 TypeScript 的别名指过去，不改源文件里的 import。复制进来的文件开头不加东西，仓库根的 `LICENSE` 原样放进包内（`packages/explorer/LICENSE.upstream`），另附一个 `UPSTREAM.md` 写来源仓库、提交号与复制了哪些路径。

第一个 commit 只有复制与让它能构建的包配置（`package.json`、`tsconfig`、`vite.config.ts`），这个 commit 里不改任何复制来的文件；构建能过、测试能跑，只是数据仍去 `fetch`。之后的离线改动是第二个 commit，`git diff` 就是我们对 UA 的全部改动。

- 为什么不只复制图：用户明确要整个 HTML 部分；只复制图仍要自己补侧栏、Learn、搜索、路径查找等，又回到仿写。
- 代价：副本里有我们暂时用不到的部分（diff 叠加、设计与知识类节点的视图、移动端布局）。它们在没有对应数据时落进 UA 自己的空状态，不删。

### D2 离线只改这几处

| 位置 | 改法 |
|---|---|
| `App.tsx` 的 `dataUrl` 与各 `fetch` | 改为从 `window.__EXCAVATOR_EXPLORER_DATA__`（打包时写入的对象，键是原来的文件名）取；某个键不存在时按原来请求失败的分支走，使副本落进它自己的空状态 |
| `TokenGate` | 不再渲染，令牌视为已通过 |
| `CodeViewer` 的源码 `fetch` | 从内联的源码表取；没有内联源码（`--no-source`）时走原来的失败分支 |
| `KnowledgeGraphView` 的 Worker | 构建成内联的 blob Worker，做法同 `report-view` |
| 陈旧度 | 打包时按 `meta.json` 与项目当前 git 状态算出 `staleness.json` 的内容写入；算不出时不写，副本照原样不显示陈旧提示 |
| `localStorage` | 读写包一层 try/catch，失败时当作没有存储 |
| 界面上的产品名 | 页面标题、`appName`（没有项目名时的回退）、引导层的标题与正文、`WarningBanner` 的报问题链接，改为 Excavator 与本仓库的 issues 地址；各语言的 locale 文件同改这几个键；界面提示用户运行的上游命令（陈旧提示、没有知识图或领域图时的空状态）改为对应的 `/excavator`、`/excavator-domain`、`/excavator-knowledge` |

`import.meta.env.DEV` 的分支在生产构建里本来就是 false，不改。`VITE_DEMO_MODE` 不设。

数据对象只在打包时写入一次，所以改动集中在读的地方，组件的状态流不变。

### D2a 我们的命名不带 UA

用户：「我们的名称可以不出现 ua 吗」。凡是我们起的名字都不带 UA：
- 包是 `packages/explorer`（`@excavator/explorer`），产出 `.excavator/explorer.html`；
- 回复行 `Explorer:`，内联数据 `window.__EXCAVATOR_EXPLORER_DATA__`，打包模块 `explorer-data.mjs`；
- 上游许可文件放成 `LICENSE.upstream`；本变更名 `viewer-explorer`。

不叫 dashboard 或 viewer：服务化时删掉了旧的 `packages/dashboard`（UA 仪表盘的 fork，由服务送出），`tests/skill/excavator/test_service_only_contract.test.mjs` 至今断言 `packages/dashboard`、`packages/viewer` 不存在、插件清单里没有 dashboard 一词。新副本不起服务，但沿用这两个名字会让这条约定失效，所以取 explorer。

保留上游名字的只有两处：
- MIT 要求保留的版权与许可声明，以及写明来源的 `UPSTREAM.md`；
- 复制来的代码里上游自己的内部标识（例如导入路径 `@understand-anything/core/*`、它的数据目录名），用户看不到。

旧名检查（`tests/refs/legacy-literals.test.mjs`）对这两处按「与上游逐行相同」放行：放行表是 `packages/explorer/upstream-lines.json`，每项是 `<相对路径>\n<整行>` 的 sha256。复制来的行与我们必须写的几行（`tsconfig.json` 的别名、`vite.config.ts` 的别名、`UPSTREAM.md` 的来源行）逐条入表；表外任何一行带旧名都失败，所以我们以后改动复制文件时写进去的旧名仍会被拦下。用户同意了这样放行（「可以，按你推荐的进行」）。

### D3 构建成一个 HTML

`packages/explorer/vite.config.ts` 照 `report-view` 的配置：
- 单文件插件、内联全部资源、`inlineDynamicImports`；
- 只构建、不送服务；
- 模板开头列出打包的第三方包与许可（复用 `report-view/scripts/licenses.mjs`），UA 本身的 MIT 声明写在最前；
- 模板里留一个数据占位，由打包脚本替换。

UA 的 Tailwind 4 与主题 CSS 原样带上；它若引用外部字体，换成内联，不改字体本身。

### D4 打包只改形状

`skills/excavator-view/` 新增 `explorer-data.mjs`，产出 `window.__EXCAVATOR_EXPLORER_DATA__`：
- `knowledge-graph.json`：头记录的 `fields` 加上全部 node 与 edge 记录拼回一个对象，`coverage` 与 `gaps` 一并保留（UA 不读，但不丢）；
- `domain-graph.json`：原样；
- `meta.json`：原样，另加 UA 读的字段时只从已有字段换名，不造值；
- 语义产物：`/excavator-view` 已有的 `semantics` 产物（`semantics.mjs`：只留新鲜条目、矛盾摘要置空、语义图与知识图同一 facts digest 才带层）按 `view.html` 的合并规则（`report-view/src/data/semantics.ts`）并进图：
  - 节点摘要先取条目的非空摘要；条目判为矛盾时为空，不回退到节点自己的；否则用节点自己的；
  - 标签先取条目的非空标签，否则用节点自己的；
  - 语义产物带至少一个层时，用它的层替换图里的 `layers`，否则保留图里的；
  - 图里没有的条目不进页面，个数写进打包结果的这一行。
  go-multirepo 的知识图本身 0 层、节点摘要为空，层（9 个，覆盖全部 2,106 个文件、每个文件只在一层）与摘要都在语义产物里；不并进来副本的结构图就是空的。
- 提交号：不在 git 里的项目两张图的 `project.gitCommitHash` 都是 `null`，副本的 `validateGraph` 要求字符串，否则整张图判为致命（领域图会被静默丢掉）。副本自己用空字符串表示没有提交号，所以 `null` 写成 `""`，别的字段不动。
- 导览：`tour.json` 与图同一修订时，其 `steps` 按 UA 的 `TourStep` 取 `order, title, description, nodeIds` 放进图的 `tour`，覆盖图里原有的；不同修订或没有导览时用图里原有的 `tour`；
- 源码：按 `sources.mjs` 现有规则内联。

同一份页面组装（`page-assembly.mjs`）把占位换成数据，写到 `.excavator/explorer.html`。回复多一行：`Explorer: <路径>; <N> issues`，N 是用副本同一个 `validateGraph` 在打包时数出的问题条数（例如 `mentions` 边）。

### D4a 没有层时按目录分组

UA 的结构图顶层只画层（`GraphView` 在 `layers` 为空时什么都不画），而 UA 自己的分析总会产出层，所以副本没有退路。我们的零模型分析不产出层，语义产物不新鲜时也不带层，这两种都是正常路径，页面不能因此空白。

改法在副本载入图的地方（`store.ts` 的 `setGraph`）：图的 `layers` 为空且有节点时，取顶层节点（不是任何 `contains` 边的目标的节点），用副本已有的 `deriveContainers`（按公共前缀之后的第一段目录分组；分组少于 2 个或某组超过七成时改用 Louvain 连接聚类）分组，每组变成一个层交给后面的导航、导览、筛选与图例；被它拆出的单节点组与根目录下的节点并进根分组 `~`，保证每个顶层节点恰在一组。另记 `layerSource`（`graph`、`folder`、`community`），项目概览的计数与图例在不是 `graph` 时称「分组」（各语言的 locale 加两个键）。

- 为什么不在打包时写进数据：层是模型的判断，打包只改形状；把目录写成层会让页面数据声称有层。分组只在页面里派生，页面数据里的 `layers` 仍为空。
- 为什么不再跑一次架构分析：完整分析已经把层写进了语义产物，D4 把它并进来；剩下没有层的情况本来就是没做完整分析，不该为看页面去补一次模型运行。

### D5 验收在真实浏览器里从磁盘打开

用 headless Chrome 打开 `file://…/explorer.html`，在 go-multirepo 上逐项操作：
- 结构图顶层 → 进一层 → 聚焦一个文件；
- 领域图 → 打开一个 flow；
- 代码查看器；
- Learn 面板走两步；
- 搜索；
- 路径查找；
- 切换主题。

每一项截图，并核对网络请求数为 0、控制台无错误。对照组是 UA 自己的开发服务器读同一份数据（把 D4 的数据写成文件放进它的数据目录）：两边同一视图的卡片数、边数与容器名相同。

## Risks / Trade-offs

- **UA 的校验不认我们的数据** → 打包时用同一个 `validateGraph` 先数出问题，写进回复；验收时核对副本显示的问题与打包时数出的一致。不改数据去迎合它。
- **模板体积** → UA 带 react-markdown、dagre、d3-force 等，模板会比 `report-view` 大。验收记录体积；超过 16 MB 才算问题。
- **两份查看器并存** → 用户可能分不清该看哪个。回复里两行各写清楚，旧的写 `Viewer:`、新的写 `Explorer:`。并存只到 Excavator 的页面搬进副本为止。
- **上游更新** → 原样复制、单独 commit、`UPSTREAM.md` 记提交号，以后同步上游可以对比两个提交号之间的 diff 再重放我们的改动。

## Oracles

- O1 单测：
  - D4 的形状转换（条数与内容不变、导览覆盖规则、缺产物时缺键）；
  - D2 的读数据函数（键缺失走失败分支）。
  各项先红后绿。
- O2 全量门：`pnpm install --frozen-lockfile && pnpm -r build && pnpm test && pnpm typecheck && node scripts/check-refs.mjs && openspec validate --all --strict`、`claude plugin validate .`、`node scripts/view-smoke-graph.mjs`，加上副本自带的测试。
- O3 离线冒烟：headless Chrome 以 `file://` 打开夹具包的 `explorer.html`，网络请求为 0、无控制台错误、结构图有卡片。
- O4 go-multirepo 上按 D5 逐项截图、与 UA 开发服务器对照。
- O5 `/excavator-view` 真实运行一次，回复两行都在，两个文件都能打开。
