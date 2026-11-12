## Context

report-viewer（已归档，2026-10-21）交付了打包脚本与一个纯 JS 查看页。打包这一层可靠，在 go-multirepo 上验收通过：
- 五个产物的四种状态；
- 源码分类；
- 确定性与原子写；
- CSP；
- base64(gzip) 载荷；
- `data-xv-ready` / `data-xv-count-*` 就绪约定，以及冒烟装置。

不够的是前端。用户要求交互与样式接近 Understand Anything，并澄清「零依赖」的意思是：打开的人只用浏览器，不是不许用库。

素材是 a26a5379 之前的 `packages/dashboard`（下文称旧 dashboard）。它是 Understand Anything dashboard 的 fork，约 1.3 万行 TS，依赖 React 19、`@xyflow/react`、elkjs、d3-force、graphology、zustand、Tailwind 4、prism-react-renderer、react-markdown。它和本变更目标的差距只有三处：
1. 数据走带 token 的 HTTP，由 vite dev server 的中间件提供；
2. 构建产物分块；
3. 读的是旧的单文件 `knowledge-graph.json`。现在的图谱是 `knowledge-graph.jsonl`（`header`、`node`、`edge`、`gap`、`coverage` 记录）。

go-multirepo 上的数据形状（2026-10-22 跑完 Full 模式之后）：
- 图谱有 10,483 个节点、36,478 条边。Full 模式下 `knowledge-graph.jsonl` 不放模型写的内容：节点的 `summary` 都是空串、`tags` 都是空数组，也没有 `layer` 记录。
- 摘要与标签在 `semantic-cache.json`：`.entries` 以节点 id 为键，10,483 条，每条有 `summary`、`tags`、`semanticSourceHash`、`languageAudit`，大多数有 `verification`。结论分布：verified 6,949、unverified 1,330、contradicted 98，另有 2,106 个文件节点没有结论（没有行范围可核）。文件 12.6 MB，其中大半是 `languageAudit`。
- 层在 `semantic-graph.json`：9 个层，`nodeIds` 覆盖全部 2,106 个文件节点；带 `factDigest`，与图谱的 `factsDigest` 相同。
- 领域图 `domain-graph.json`：9 个 domain、36 个 flow、150 个 step；边是 36 条 `contains_flow`、150 条 `flow_step`、14 条 `cross_domain`。150 个 step 都有可解析的 `nodeIds`，`unresolvedNodeIds` 为空。
- unused 的 5,019 个 `id` 全部是图谱节点 id。
- hotspots 的 2,121 个路径里，2,106 个对得上 `file:<path>` 节点；另外 15 个不在图谱里，如二进制与跳过的文件。hotspots 有 36 个功能组，一组对应一个 flow。
- 没有 doc-map 产物。

## Goals / Non-Goals

**Goals：**
- 以旧 dashboard 为起点，做出交互与版式接近 Understand Anything 的查看页：结构图、领域视图、详情侧栏、代码抽屉、搜索过滤、聚焦与路径、快捷键与返回、叠加层。
- 摘要、标签与层取自 Full 模式的语义文件，并标出核验结论。
- 构建成一个 HTML 模板，打包脚本只往里插数据；打开的人只用浏览器。
- 保留 report-viewer 的全部数据层约定与现有各页的内容要求。
- 57blocks 浅色配色与官网的动效语汇，尊重「减少动效」。

**Non-Goals：**
- 知识类图（article/entity）：go-multirepo 没有这类产物，验收不了，留到有产物时再做；
- 语义图的 `relations`：go-multirepo 上为空，查看页不画；
- Tour、Persona、diff 叠加、导出、过期轮询、token 门、首次引导、Figma、移动端布局、多语言界面、主题切换；
- 打开后拖入 `.excavator` 文件夹；
- 把模板提交进仓库。

## Decisions

### D1 前端是工作区包 `packages/report-view`，安装时构建

- 包放在 `packages/report-view`，纳入 pnpm 工作区，`pnpm -r build` 时构建。
- `dist` 不进仓库：仓库里所有 skill 脚本本来就跑 `pnpm build` 的产物，查看页模板走同一条路。
- 打包脚本只读 `packages/report-view/dist/view.html`。文件不存在时，打包失败并提示先运行 `pnpm build`。

不选的方案：
- **把模板提交进仓库**：省掉安装时的构建，但每次前端改动都会产出几 MB 的不可读 diff，还要额外防止源码与模板脱节。
- **独立于工作区的项目**：会多一套 lockfile 和 install 步骤，安装与 CI 都要另外照顾。

包名不用 `dashboard`、`viewer`。service-only 的契约测试仍断言这两个包不存在，因为它们代表「由进程提供的 HTML 应用」，这一点不变。

### D2 单文件构建

- vite 构建：`build.rollupOptions.output.inlineDynamicImports = true`，`assetsInlineLimit` 设为无穷。
- 一个自写的小插件在 `generateBundle` 阶段做两件事：
  - 把唯一的 JS 块写进 `<script type="module">`（`file://` 下内联模块脚本可以执行），CSS 写进 `<style>`；
  - 删掉其余产出文件。
- 不引第三方「singlefile」插件：逻辑不到 50 行，而且插件要校验构建结果正好一个文件。
- 力导向布局的 Worker 用 vite 的 `?worker&inline`，运行时生成 blob URL。CSP 因此加 `worker-src blob:`；`script-src` 仍只有 `'unsafe-inline'`，不加 `'unsafe-eval'`。
- 构建后由一个检查脚本断言：
  - 输出目录只有 `view.html`；
  - 文件里有且只有一个 `<!-- xv:csp -->` 和一个 `<!-- xv:data -->`；
  - 没有 `<link`、没有带 `src=` 的 `<script`；
  - 没有 `//fonts.`、`@import url(`。
- 构建要可重复：同一 lockfile 下两次构建逐字节相同，属于 O1。

模板里的内联脚本含有任意第三方代码。打包往模板里插的数据仍按 report-viewer 的规则转义，模板本身不再做 `</script>` 扫描；单文件插件会检查 JS 块里没有 `</script`，有就把 `<` 写成 `\x3c`，然后重新检查一遍。

### D3 数据层

`src/data/` 用 TS 实现 report-viewer 前端的数据约定：
- 读 `<script type="application/json" id="xv-manifest">`；
- 用 `DecompressionStream('gzip')` 解开载荷；
- 产物状态与源码分类原样来自 manifest。

图谱载荷解析成 `{ nodes, edges, layers, header, gaps, coverage }`。之后建索引：
- `nodesById`、按文件路径的节点表；
- 入边表与出边表；
- 节点到所属文件节点的映射：对 `contains` 边取反；没有 `contains` 边的节点用 `filePath` 去找 `file:<filePath>`。

旧 dashboard 的 `validateGraph` 与 `SearchEngine` 不再从 `@excavator/core` 引入：
- 前者在打包侧已经由产物状态判过；
- 后者换成包内的模糊搜索。核心逻辑是按 name 与 filePath 的子序列打分，约 100 行，有单测。

这样 report-view 不依赖 core，构建不受 core 的 dist 影响。

产物到图谱的映射，叠加层与「在图中定位」共用：

| 产物 | 映射 |
|---|---|
| unused | `unused[].id` 直接是节点 id |
| hotspots 文件 | `file:` + `path` |
| hotspots 目录 | 目录容器的路径 |
| doc-map | `coverage.files[].path` 映射到 `file:` 节点 |

映射不到的记录不会被丢掉，页面写明「图谱里没有它」。

### D4 结构图

结构图沿用旧 dashboard 的 `GraphView` 分级方式与 ELK 布局。

**顶层**
- 有层时，每层一个 `LayerClusterNode`。
- 没有层时，按「成员仓 / 顶层目录」分组，用的是旧 dashboard 的 `deriveContainers`，但改成纯目录分组。分组过于集中时，旧 dashboard 会退到 Louvain 社区；这里先拆到更深一级目录，仍然以目录为依据，不用社区算法。理由是：社区算法会造出图谱里没有的「分组」，与「只陈述事实」相冲突，而目录是事实。所以不引 graphology-communities-louvain。

**下钻**
- 容器内是子目录容器与文件节点。文件节点可以展开出 `contains` 指向的函数与类。
- 每一级最多同时画 400 个节点；超过时按目录再折叠一层，并写明「折叠了 N 个」。上限只控制一次画多少，不丢数据：折叠的容器仍可点进去。

**边**
- 同一级里，两个容器之间的边按类型聚合成一条，标签写条数，用旧 dashboard 的 `aggregateLayerEdges` 与 `edgeAggregation`。
- 默认显示的边类型：`imports`、`calls`、`exports`；`contains` 用嵌套表示，不画成线。

**画布**
- 背景用 `@xyflow/react` 的 `Background`（点状）、`MiniMap`、`Controls`。
- 下钻与定位用 `fitView({ duration })` 做镜头过渡。

**力导向布局**
- 只在「聚焦」视图里用 d3-force（在内联 Worker 里跑）。层级视图都用 ELK。
- ELK 用 `elkjs/lib/elk.bundled.js`，在主线程运行。go-multirepo 每一级最多 400 个节点，主线程 ELK 的耗时由 O4 记录；超过 1 s 就改成放进 Worker，并记进验收记录。

### D5 详情侧栏、代码抽屉与 Code 页

- 侧栏照旧 dashboard 的 `NodeInfo`：字段、按类型分组的入边与出边、跳到对端。在它下面加「产物事实」一节。
- 代码抽屉照旧 dashboard 的 `CodeViewer`：底部 40vh，可放大到整页，用 prism-react-renderer 高亮。
- 源码只来自 manifest 内嵌的 `source`，分类与越界规则与 Code 页共用一个函数。
- Code 页保留 report-viewer 的文件树、路径过滤、分类计数与高亮。
- 测量用的 DOM 约定不变：`.xv-code[aria-label="Source of <path>"]`、`data-xv-highlight`、`.xv-line-hl`。抽屉也遵守，冒烟与验收脚本可以直接复用。

### D6 表格页

Overview、Unused、Doc map、Hotspots、Reports 用 React 重写，内容要求与 report-viewer 主规范一致：列、筛选、排序、分页、缺字段显示「产物未提供」、null 显示「—」、建议性词组禁令。

- 组件是一个通用的 `DataTable`：排序、分页、每页 200 行、按列名指定初始排序。它从 report-viewer 的 `components.js` 移植，测试一起移植。
- 每行加「在图中定位」按钮。
- Reports 用 react-markdown + remark-gfm，不开 `rehype-raw`，HTML 当文字。链接只放行 `#/` 开头的，其余渲染成文字。

### D7 路由与返回

hash 路由，在 report-viewer 的 `#/<page>?k=v` 上扩展：
- `#/graph?path=<容器路径>&node=<id>&focus=1&overlay=hotspots,unused`；
- 原有的 `#/code?path=&lines=`、`#/unused` 等不变。

下钻、选中、聚焦都写进 hash（`pushState`），浏览器后退与前进自然成立；刷新后从 hash 恢复。`Esc` 的逐级关闭顺序见规范。快捷键照旧 dashboard 的 `useKeyboardShortcuts`，只保留规范里的那些。

### D8 样式与动效

**版式**照旧 dashboard 的 `App.tsx`：
- 顶栏 56px：项目名、快照版本、搜索框、叠加层开关、过滤、路径、`?`；
- 左侧导航 200px；
- 主区；
- 右侧侧栏 360px；
- 底部抽屉。

**配色**：沿用 report-viewer D6 的 57blocks 浅色 token，写成 Tailwind 4 的 `@theme`。旧 dashboard 的深色与金色 token 全部删除。

**浮层**：
- `background: rgb(255 255 255 / .78)`、`backdrop-filter: blur(14px)`；
- 边框 `--line`；
- 阴影 `0 8px 30px rgb(12 12 18 / .08)`；
- 卡片圆角 14px，按钮与输入框圆角 10px。

**节点配色**：节点类型用 8 色分类色板。基色是 57blocks 的 violet 与 cyan，其余在浅色背景上按 OKLCH 等亮度取色，对白底对比度 ≥ 3:1，由单测检查。图例列出全部节点类型。

**动效**用 `motion`（motion.dev，MIT）：
- 缓动 `cubic-bezier(.16,1,.3,1)`，取自 57blocks 官网的 `--ease`；
- 时长：
  - 视图切换 0.35 s：淡入并上移 12px；
  - 侧栏与抽屉 0.3 s：滑入，配合 `AnimatePresence` 退出；
  - 弹窗 0.25 s：缩放 0.98→1 加淡入；
- 卡片与统计格首屏按 30 ms 依次进场，最多 12 个；统计数字 0.6 s 滚动到终值；
- 选中节点有一次 `chipPulse` 式的外扩光圈；hover 时节点上浮 1px，阴影加深；
- 图的镜头过渡 0.4 s。

全局包一层 `<MotionConfig reducedMotion="user">`，CSS 里 `@media (prefers-reduced-motion: reduce)` 关掉所有 transition 与 animation。

动效不挡数据：
- 计数滚动只改显示文字，`data-xv-count-*` 在数据就绪时一次写入终值；
- `data-xv-ready="1"` 在首屏内容挂载后的下一帧给出，不等任何动画。

**字体**：`"Geist", system-ui, …`，等宽 `"JetBrains Mono", ui-monospace, …`，不嵌字体，CSP `font-src 'none'` 不变。

### D9 打包侧的改动

`page-assembly.mjs` 的输入从 `viewer/` 换成 `packages/report-view/dist/view.html`：
- 插 CSP（多 `worker-src blob:`）、manifest 与载荷，其余照旧；
- 确定性与原子写的测试保留，模板路径改成测试夹具里的一个小模板；
- 真模板另有一条测试：构建后打一次夹具包，两次逐字节相同。

`viewer/` 与它的静态门测试删除。静态门里仍有意义的几条，改为对构建产物检查（见 D2）：
- 没有外部资源；
- 没有中文字符；
- 没有建议性词组。

### D10 契约测试

`test_service_only_contract.test.mjs`：
- 保留 `packages/dashboard`、`packages/viewer` 不存在等断言；
- 去掉「查看页无 npm 依赖」；
- 新增：
  - `packages/report-view/package.json` 没有 `dev`、`preview`、`serve`、`start` 脚本；
  - 包里没有 `vite.config` 的 `server`、`preview` 配置；
  - 包源码里没有 `createServer`、`listen(`、`fetch(`、`XMLHttpRequest`、`WebSocket`、`EventSource`；
  - 其他包没有 `index.html`。

### D11 语义：摘要、标签与层

新鲜度在打包时判，前端不判：
- `products.mjs` 新增「语义」产物，读 `semantic-cache.json` 与 `semantic-graph.json`。
- 缓存的身份与新鲜度用 `skills/excavator/semantic-cache.mjs` 的 `isCanonicalSemanticCache` 与 `isFresh`：拿每条条目对比 `source-manifest.json` 里该文件当前的 `contentHash`。打包脚本不另写一套判断。
- 载荷里每条只留 `id`、`summary`、`tags`、`verification`。`semanticSourceHash` 与 `languageAudit` 不进页面。
- 不新鲜的条目不进载荷，只计数，写进 manifest 的语义一栏。
- 结论是 `contradicted` 的条目，`summary` 在打包时就置空并保留结论。这样页面里根本没有这段文字，搜索也搜不到。
- 语义图的 `factDigest` 与图谱 `factsDigest` 相同时，才内联它的 `layers`；不同时语义状态为 unreadable，原因写两个摘要值。

前端在建索引时把语义条目并到节点上（D3）。结构图的层优先用语义图的层（D4 顶层「有层时」）。

不选的方案：
- **前端判新鲜度**：要把 `source-manifest.json` 的全部哈希也送进页面，而判断逻辑已经在 core 侧有一份；两份判断迟早不一致。
- **只读图谱节点的 `summary`**：Full 模式下全是空串，结构图会没有任何摘要。

### D12 领域视图

照旧 dashboard 的 `DomainGraphView`，也就是 Understand Anything 的领域视图：
- **顶层**：domain 用 `DomainClusterNode`，显示摘要与 flow 数；`cross_domain` 边画成带标签的线，标签是边的 `description`。
- **下钻**：点进 domain 画它的 flow（`contains_flow`）；点进 flow，按 `flow_step` 边的 `weight` 升序把 step 排成一列，相邻 step 之间画顺序箭头。这些箭头是 `flow_step` 的权重顺序，不是新造的边。
- **布局**：ELK `layered`，与结构图共用布局函数。
- **侧栏**：名称、摘要、`domainMeta`、`evidence`（文件与行）、`provenance`。step 的 `nodeIds` 逐项列出，能在知识图谱里找到的可点，点了切到结构图、下钻并选中；找不到的与 `unresolvedNodeIds` 一起列出，写「图谱里没有它」。
- 路由：`#/domain?d=<domainId>&f=<flowId>&node=<id>`，同样进浏览器历史。
- 页面顶部固定一行说明：领域图由模型从代码推导。

新鲜度：
- 打包时检查 `version`、`contentLanguage`、`sourceRevision`；
- 另外比对 `factDigest` 与图谱的 `factsDigest`，不同时状态为 different revision，两个值都写出。

## Oracles

验收只用 go-multirepo。

- **O1 单测（vitest，在 `packages/report-view` 与 `tests/skill/excavator-view`）。** 以下每条先用注入变异证明会红，再证明会绿：
  - jsonl 解析与索引：入边与出边表、节点到文件的映射；
  - 目录分组：不出现图谱外的分组，下钻计数等于路径前缀计数，折叠上限只折叠不丢；
  - 边聚合计数；
  - 产物到节点的映射与「图谱里没有它」；
  - 最短路径（无路径时）；
  - 模糊搜索排序；
  - hash 路由往返；
  - `DataTable` 的排序、分页与初始排序；
  - 节点色板对比度；
  - Markdown 只放行 `#/` 链接；
  - 打包：缺模板时失败、CSP 含 `worker-src blob:`、确定性；
  - 语义：不新鲜的条目不进载荷且被计数；`contradicted` 的摘要在载荷里是空串；`factDigest` 不同时语义为 unreadable；没有语义文件时摘要取图谱节点自带的；
  - 领域：step 按 `flow_step` 权重排序；`nodeIds` 里图谱没有的项列为「图谱里没有它」；`factDigest` 不同时为 different revision；
  - 单文件检查（D2）：多一个文件、多一个 `<link>`、少一个占位都会红。
- **O2 全量门。** `pnpm install --frozen-lockfile && pnpm -r build && pnpm test`、`node scripts/check-refs.mjs`、typecheck、`openspec validate --all --strict`。
- **O3 冒烟。** 沿用 `scripts/view-smoke.mjs`，先对三个故意坏的页面确认装置会红，再对夹具包报绿。夹具包要过的检查：
  - 每页无控制台错误、无 CSP 违规、无主文档以外的请求；
  - Worker 在 `file://` 下能起来：聚焦视图的力导向布局完成并写出 `data-xv-count-focus-nodes`；
  - 夹具上的下钻、搜索定位、路径与后退各有一条 `--eval` 断言。
- **O4 go-multirepo。** 打包当前产物（doc-map 仍是 not run），然后检查：
  - **总数**：
    - 各页 `data-xv-count-*` 与独立 jq 计数相等；
    - 顶层是 9 个层簇，各簇文件数之和等于 2,106；任选 3 个容器，下钻后的文件节点数等于路径前缀计数；
    - 带摘要的节点数按结论分组，与 jq 按 `isFresh` 口径独立算出的数相等；98 条 contradicted 的摘要文字一条都不出现在页面里（抽 5 条原文全文搜索）；
    - 领域视图顶层 9 个 domain，flow 合计 36，step 合计 150。
  - **跳转 20 条**，分层抽样：
    - unused 两个置信度 × 两种原因，各 2 条，经「在图中定位」后选中的节点 id 等于记录 id，再从侧栏打开代码抽屉，高亮范围等于 `lineRange`；
    - hotspots 前 3 个文件，经定位后选中 `file:<path>`；
    - 搜索 3 个函数名，选中后侧栏名称一致；
    - 1 条在图谱里没有的 hotspots 路径，页面写「图谱里没有它」；
    - 2 条 1 跳聚焦，邻居数等于入边与出边的端点去重数；
    - 3 个 step（分属不同 domain），每个点一项 `nodeIds`，结构图选中的 id 相等；其中 1 个 flow 的 step 顺序等于 `flow_step` 权重顺序。
  - **耗时**：就绪 ≤ 3 s；最大容器下钻 ≤ 2 s；主线程 ELK 单次耗时记录在案（D4）。
  - **大小**：记录模板与成品的大小。
  - **动效**：切换视图后 100 ms 内 `document.getAnimations().length > 0`；在 `prefers-reduced-motion: reduce` 模拟下同样操作为 0。
  - **截图**：1280 宽的图、侧栏与抽屉；1280 宽的领域视图顶层与一个 flow；1280 宽的 Unused；768 宽的图；深色模式模拟（必须仍是浅色）。由我人工看布局，逐项对照 D8 的版式清单（顶栏、导航、侧栏、抽屉、浮层、圆角与阴影）。旧 dashboard 要靠 dev server 和旧格式数据才能跑，不拿它做截图对照。
- **O5 skill 真实运行。** 同 report-viewer O5：`claude -p --model sonnet` 跑 `/excavator-view`，检查回复四行、只新增或改动 `view.html`、调用了打开命令。

## Risks / Trade-offs

- **[安装变重]** 工作区多出 React、xyflow、ELK 等开发依赖，`pnpm install` 变慢，lockfile 变大。→ 依赖只在 report-view 一个包里，根包与 core 不变。不选「提交模板」的理由见 D1。
- **[页面变大]** 模板约 2–3 MB，加在数据之上；go-multirepo 估计 7–8 MB。→ O4 记录实测；`--no-source` 仍可用。
- **[主线程 ELK 卡顿]** → 每级 400 节点的上限加实测（D4）；超过 1 s 改 Worker。
- **[第三方代码里的 `</script`]** → 单文件插件转义并复查（D2）。
- **[动效拖慢就绪或干扰测量]** → 就绪与计数不等动画（D8）；冒烟在默认设置下跑，另有一项在减少动效下跑。
- **[旧 dashboard 的代码不再有上游可跟]** → 这是 fork 后的独立代码，只取需要的组件，删除不用的（Tour、Persona、i18n 等），不保留死代码。
- **[样式「接近」难以客观判定]** → 版式按 D8 写死尺寸与组件清单，O4 截图由我对照 D8 的版式清单人工判断；颜色与动效语汇有明确 token，可以检查。

## 验收记录（2026-10-22）

验收对象：`feat/report-viewer` 的 `2308986f`。语料：go-multirepo（图谱 10,483 节点、36,478 边，factsDigest `7031e30c…`；语义缓存 10,483 条；语义图 9 层；领域图 9/36/150；unused 5,019；hotspots 2,121 文件；doc-map 未跑）。打包与 O5 都在语料的 APFS 克隆上做，语料本身只读。

**O1 注入变异。** 每个 commit 的编码代理都先注入变异、看到对应测试变红、恢复后变绿：
- 1（模板）：多一个文件、多一个 `<link>`、缺占位、含 `</script` 各自红；`dist/` 里多一个文件时 `check-template` 退出 1；同一 lockfile 两次构建 sha256 相同。
- 2（各页）：DataTable 的空过滤规则、分组过滤、页边界、空值排序、初始排序、「产物未提供」与 0 的区分、Markdown 链接规则；路由不编码页名时往返测试红；节点色板改成 1.9:1 时对比度测试红。
- 3（语义）：不新鲜条目进载荷、contradicted 摘要保留、`factDigest` 不比对、没有语义文件时不取图谱摘要，各自红；打包保留 contradicted 摘要时冒烟的 `secretInAnyPayload` 为真。
- 4（结构图）：12 个分组与聚合变异全部变红；其中两个起初没红，暴露了测试太弱（未分层的桶、跨组的 `contains`），已补测试。
- 5（详情、搜索、聚焦、路径）：37 个单元变异与 6 个冒烟变异（Esc 顺序等）全部红。
- 6（叠加层与定位）：过滤不进 hash、叠加层丢失、`levelHash` 漏参数、分档边界、doc-map 覆盖外、产物没跑仍可用、建议性句子等单元变异，及 8 个冒烟变异（旧的固定留白、图例变高不重新适配、定位不开叠加层、定位缺失节点、打包漏图文件等）全部红。
- 7（领域视图）与其后的修复：25 个单元变异（打包、排序、锚点、叠加规则、镜头、列布局、标签、路由）全部红；冒烟在顺序、镜头、叠加层、节点跳转、说明文字五个变异上红；`domain-fit` 在旧代码上缩放为 0.63 与 0.59。
- 修复 commit：`history` 冒烟的偶发失败查明是检查读在侧栏 0.3 s 退场动画中途（11/40 次），应用状态每次都正确，改为等待地址与侧栏都到位后 40/40；顶栏与边标签的新冒烟在修复前红（边标签 4/7、顶栏 7/18）；真实指针悬停的新冒烟在 `967d7a4c` 上红（结构与领域图的边收不到指针、聚焦视图静止时 6 个重叠标签、占位文字截断、3 个 step 在 MiniMap 下）。

**O2 全量门**（在分离检出里跑，每个 commit 各一次）：commit 1–7 与 `fcf62e0e`、`967d7a4c` 均通过。最终 `2308986f`：构建通过，模板 sha256 `dd098d8f…a60a`；`pnpm test` 202 个文件、5,007 通过、4 跳过；typecheck 通过；`check-refs` 通过；`openspec validate --all --strict` 46 项通过。

**O3 冒烟。** `view-smoke-graph.mjs` 在 `2308986f` 上连跑两次，221/221；`view-smoke.mjs` 夹具包 768 与 1280 宽 ok。装置先对三个坏页面确认会红。悬停一律用 CDP 真实指针事件：此前合成的 `mouseover` 让一个真实指针触发不到的缺陷通过了冒烟，这是改用真实指针的原因。

**O4 go-multirepo。** 独立验收代理在 `fcf62e0e` 上全部检查通过（期望值都由它自己用 jq/python 从产物算出，不读页面自报）：
- 打包两次 sha256 相同；模板 2,505,819 字节，成品 8,153,506 字节（`2308986f` 的成品 8,155,656 字节）。
- 总数：节点、边、缺口 10,483 / 36,478 / 42；语义条目 10,483、不新鲜 0、层 9；结论 verified 6,949、unverified 1,330、contradicted 98、未核验 2,106，显示摘要 10,385；领域 9/36/150、跨领域 14；unused 5,019；hotspots 2,121 / 315 / 5,643 / 36；源码 2,116 个文件。
- 顶层 9 个层簇，文件数合计 2,106、节点数合计 10,483；三个下钻容器的文件数 547、307、238 等于路径前缀计数。
- 98 条 contradicted 摘要抽 5 条原文，页面 DOM 与 7 个解码后的载荷里都不存在（对照：5 条 verified 摘要都能找到）。
- 23 条跳转全部正确：unused 8 条（语料没有 high 可信度，用 medium 代替；medium/low × 两种原因各 2 条，选中 id 与抽屉高亮都相等）、hotspots 前 3 个文件、搜索 3 个函数名、1 条图谱外的 hotspots 路径写「Not in the graph.」、2 个聚焦（邻居 5 与 35，等于自算的端点去重数）、3 个分属不同 domain 的 step、1 个 flow 的 7 步顺序等于权重顺序。
- 耗时：各页就绪 192–488 ms；最大容器（746 个文件）下钻 27 ms，最慢 107 ms；`data-xv-elk-ms` 最大 67.5 ms，主线程 ELK 远低于 1 s，不改 Worker。
- 动效：视图切换后 3–15 ms 出现动画；减少动效模拟下 600 ms 内为 0。深色模式模拟下背景仍为浅色。768 宽无横向滚动，侧栏浮在图上。
- 全程无主文档以外的请求、无 CSP 违规、无控制台错误；可见文字里没有建议性措辞。
- 截图对照 D8 版式清单：顶栏、左侧导航、侧栏、抽屉、玻璃浮层、圆角与阴影各项通过。

验收代理另报四处偏差，处理如下：
1. 768 宽顶栏不可用（搜索框被挤到 26 px、按钮相互覆盖、文字换行）：规范要求 768 可用，判为缺陷，`967d7a4c` 修复（窄屏把叠加层收进一个菜单）。
2. 选中节点时聚合边的标签互相重叠并压在卡片上：判为缺陷，`967d7a4c` 改为只给指针下的边加标签；复验发现真实指针根本触发不到边，`2308986f` 修复，并把同一规则用到领域图与聚焦视图。
3. 14 条跨领域边画成 13 条：唯一的一对双向边画成一条，标签合并两段描述，侧栏两个方向都列出。保留，不是缺陷。
4. 领域 step 的侧栏写「Lines: not recorded」：step 本身没有行范围，证据链接照常显示。保留。

修复后由第二个独立验收代理在 `967d7a4c` 的真实成品上复验：顶栏三种宽度全部通过；边标签的真实指针缺陷即由它发现。`2308986f` 的修复由编码代理用真实指针截图复核（三个视图各悬停一条边，只出现一个不透明标签）。

**O5 skill 真实运行**（`2308986f`，`claude -p --model sonnet --plugin-dir <检出>`，在语料克隆根目录）：花费 $0.15，4 轮，54 秒；3 次 Bash（打包、`open`、回复命令）；最后回复四行与 D7 一致（`View: …/view.html`、`Size: 7.8 MB`、产物行、`Source: embedded (2116 files)`）；`.excavator/` 前后对比只多了 `view.html`；写出的文件与另一次打包逐字节相同。

**结论：** 通过。后续由 viewer-learn 变更接手用户提出的模式、导览与图的视觉。
