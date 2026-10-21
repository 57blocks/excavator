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

go-multirepo 上的数据形状：
- Lazy 图谱有 10,483 个节点、36,478 条边、0 个层，摘要都为空。
- unused 的 5,019 个 `id` 全部是图谱节点 id。
- hotspots 的 2,121 个路径里，2,106 个对得上 `file:<path>` 节点；另外 15 个不在图谱里，如二进制与跳过的文件。

## Goals / Non-Goals

**Goals：**
- 以旧 dashboard 为起点，做出交互与版式接近 Understand Anything 的查看页：结构图、详情侧栏、代码抽屉、搜索过滤、聚焦与路径、快捷键与返回、叠加层。
- 构建成一个 HTML 模板，打包脚本只往里插数据；打开的人只用浏览器。
- 保留 report-viewer 的全部数据层约定与现有各页的内容要求。
- 57blocks 浅色配色与官网的动效语汇，尊重「减少动效」。

**Non-Goals：**
- 领域图视图（domain → flow → step）、知识类图（article/entity）：go-multirepo 没有这些产物，验收不了，留到有产物时再做；
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
  - 单文件检查（D2）：多一个文件、多一个 `<link>`、少一个占位都会红。
- **O2 全量门。** `pnpm install --frozen-lockfile && pnpm -r build && pnpm test`、`node scripts/check-refs.mjs`、typecheck、`openspec validate --all --strict`。
- **O3 冒烟。** 沿用 `scripts/view-smoke.mjs`，先对三个故意坏的页面确认装置会红，再对夹具包报绿。夹具包要过的检查：
  - 每页无控制台错误、无 CSP 违规、无主文档以外的请求；
  - Worker 在 `file://` 下能起来：聚焦视图的力导向布局完成并写出 `data-xv-count-focus-nodes`；
  - 夹具上的下钻、搜索定位、路径与后退各有一条 `--eval` 断言。
- **O4 go-multirepo。** 打包当前产物（doc-map 仍是 not run），然后检查：
  - **总数**：各页 `data-xv-count-*` 与独立 jq 计数相等；顶层容器的文件节点数之和等于图谱文件节点数；任选 3 个容器，下钻后的文件节点数等于路径前缀计数。
  - **跳转 20 条**，分层抽样：
    - unused 两个置信度 × 两种原因，各 2 条，经「在图中定位」后选中的节点 id 等于记录 id，再从侧栏打开代码抽屉，高亮范围等于 `lineRange`；
    - hotspots 前 3 个文件，经定位后选中 `file:<path>`；
    - 搜索 3 个函数名，选中后侧栏名称一致；
    - 1 条在图谱里没有的 hotspots 路径，页面写「图谱里没有它」；
    - 2 条 1 跳聚焦，邻居数等于入边与出边的端点去重数。
  - **耗时**：就绪 ≤ 3 s；最大容器下钻 ≤ 2 s；主线程 ELK 单次耗时记录在案（D4）。
  - **大小**：记录模板与成品的大小。
  - **动效**：切换视图后 100 ms 内 `document.getAnimations().length > 0`；在 `prefers-reduced-motion: reduce` 模拟下同样操作为 0。
  - **截图**：1280 宽的图、侧栏与抽屉；1280 宽的 Unused；768 宽的图；深色模式模拟（必须仍是浅色）。由我人工看布局，逐项对照 D8 的版式清单（顶栏、导航、侧栏、抽屉、浮层、圆角与阴影）。旧 dashboard 要靠 dev server 和旧格式数据才能跑，不拿它做截图对照。
- **O5 skill 真实运行。** 同 report-viewer O5：`claude -p --model sonnet` 跑 `/excavator-view`，检查回复四行、只新增或改动 `view.html`、调用了打开命令。

## Risks / Trade-offs

- **[安装变重]** 工作区多出 React、xyflow、ELK 等开发依赖，`pnpm install` 变慢，lockfile 变大。→ 依赖只在 report-view 一个包里，根包与 core 不变。不选「提交模板」的理由见 D1。
- **[页面变大]** 模板约 2–3 MB，加在数据之上；go-multirepo 估计 7–8 MB。→ O4 记录实测；`--no-source` 仍可用。
- **[主线程 ELK 卡顿]** → 每级 400 节点的上限加实测（D4）；超过 1 s 改 Worker。
- **[第三方代码里的 `</script`]** → 单文件插件转义并复查（D2）。
- **[动效拖慢就绪或干扰测量]** → 就绪与计数不等动画（D8）；冒烟在默认设置下跑，另有一项在减少动效下跑。
- **[旧 dashboard 的代码不再有上游可跟]** → 这是 fork 后的独立代码，只取需要的组件，删除不用的（Tour、Persona、i18n 等），不保留死代码。
- **[样式「接近」难以客观判定]** → 版式按 D8 写死尺寸与组件清单，O4 截图由我对照 D8 的版式清单人工判断；颜色与动效语汇有明确 token，可以检查。
