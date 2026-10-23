## Context

`explorer.html` 是 Understand Anything 仪表盘的副本（变更 viewer-explorer），数据来自打包时内联的 `window.__EXCAVATOR_EXPLORER_DATA__`。三个产物页现在只在 `view.html`（`packages/report-view`）里，它们的取数、筛选、排序与分布计算是一组不依赖界面的模块（`packages/report-view/src/lib/` 的 `unused.ts`、`unused-related.ts`、`hotspots.ts`、`hotspots-charts.ts`、`docmap.ts`、`docmap-charts.ts`、`table.ts`、`format.ts`），各有单测。

## Goals / Non-Goals

**Goals:** 浏览页里看三个产物，与图互相跳转；顶栏去掉文件与类切换、节点类型过滤；去掉引导弹窗。

**Non-Goals:** `view.html` 退役；Reports、Products 页；节点详情里的产物事实；新界面文字的多语言翻译。

## Decisions

### D1 数据：原文加状态

打包在 `explorer.html` 的数据里加：
- `unused-code.json`、`hotspots.json`、`doc-map.json`、`doc-map-checks.json`：产物文件的原文，状态为 included 或 different-revision 时才有；
- `products.json`：`{ products: [{ name, status, reason, revision, revisionNote, command }] }`，三个产物各一条，取自 `products.mjs` 已有的判定（与 `view.html` 用同一份）。

浏览页只从这两类键读，不重新判定状态。理由：状态规则只有一份，两页不会说法不同。

### D2 顶栏与模式

- 去掉 Files | Classes、函数开关与节点类型过滤（桌面顶栏与移动端抽屉）。`detailLevel` 固定为 `file`，`nodeTypeFilters` 保持全开。副本里这些状态与动作不删，只是没有入口，以免牵动副本的其它代码。
- 三个按钮与 Domain | Structural 同一种分段样式，放在原来文件与类切换的位置；结构图与领域图下都显示。
- store 加 `productView: 'unused' | 'hotspots' | 'doc-map' | null` 与 `productRow`。点亮着的按钮或 Domain / Structural 时 `productView` 置空。
- 产物视图盖在图的区域上（绝对定位、不透明背景），图不卸载。理由：卸载 React Flow 会丢视口与 ELK 布局，回来要重排。

### D3 视图与样式

- 内容逐项照 `view.html` 的三个页面（主规范「Unused code 页」「Doc map 页」「Hotspots 页」）：页头（衬线标题、一句说明、版本）、统计格、分布条、可筛选可排序可分页的表、折叠的全部计数、判定与残余假设。
- 样式只用浏览页的主题 token（`bg-surface`、`bg-elevated`、`border-border-subtle`、`text-accent`、`font-heading` 等），不搬 `report-view` 的 CSS，随主题切换。分布用水平条与小柱图，手写 SVG 或 div，不加图表库。
- 取数逻辑：把上面列的 `report-view` 纯模块连同单测复制到 `packages/explorer/src/excavator/products/`，只改 import 路径。理由：`report-view` 之后要退役，浏览页不能依赖它的源码；复制而非共享包，退役时直接删旧目录即可。
- 新界面文字直接写英文，不进副本的 locale 表。理由：内容是产物的英文字段与列名，七种语言的翻译超出本变更；副本切到别的语言时这几个视图仍是英文。

### D4 行详情与跳转

- 桌面：点行后右侧栏显示行详情（取代节点详情与项目概览），关掉或换到图后恢复原侧栏。窄屏：行详情显示在视图内、表格上方。
- 「在图中显示」按 `view.html` 的映射（`report-view/src/lib/locate.ts`）：unused 的 `id` 是节点 id；hotspots 与 doc-map 的文件路径对应 `file:<path>` 节点。只处理文件与节点；目录行不给这个按钮，写明「No single node of the graph stands for this directory.」。找到节点时关闭视图、切到结构图、调用副本自己的选中与聚焦动作；找不到时写明「Not in the graph.」。
- 「打开代码」调用副本的代码查看器（`openCodeViewer`），带行号；源码没有内联（`--no-source` 或文件不在源码表里）时写明。

### D5 引导弹窗

不渲染 `OnboardingOverlay`。`localStorage` 里记下的关闭标记不再读。

## Oracles

- **O1 单测**：打包的五个键与状态（included、not-run、unreadable、different-revision 各一）；复制来的取数模块单测原样通过；store 的视图切换保留选中。各先红后绿。
- **O2 全量门**：同 viewer-explorer（install、build、typecheck、check-refs、openspec、plugin validate、两个冒烟、`pnpm test`）。
- **O3 冒烟**（`scripts/explorer-smoke.mjs`）：夹具带三个产物（doc-map 带一个 not-found 单元）与一个没跑的情形：
  - 顶栏没有 Files、Classes 和过滤标签，没有引导弹窗；
  - 三个视图的统计数等于产物计数；Unused 只选 high 的行数等于 `counts.byConfidence.high`；
  - 点行出详情，「在图中显示」后结构图选中该节点；再点按钮回到图，原选中仍在；
  - not run 的视图写出命令；
  - 网络请求 0、控制台无错；768 与 375 宽无横向溢出。
- **O4 真实语料**：go-multirepo 打包（只读语料、`--out` 在语料外），截图逐项判断三个视图与行详情；语料没有 doc-map，Doc map 判 not run 那一面，有数据的那一面由 O3 覆盖。

## Risks / Trade-offs

- 三个产物原文让 `explorer.html` 变大（与 `view.html` 内嵌的同量）→ 打包回复里已有每个键的字节数，验收记下增量。
- 复制的取数模块与 `report-view` 并存到退役为止，期间改一处要记得另一处 → 退役变更删旧目录；本变更不改这些模块的行为。
- 去掉类视图后，想看类与函数只能在层内下钻或聚焦里看 → 用户的明确要求。

## 验收记录（2026-10-23）

**O1 单测**：打包 `explorer-pack.test.mjs` 47 条，含五个新键、四种状态与 `products.json.snapshotRevision`；先红后绿（`snapshotRevision` 最初取自 `staleness.json`，改为取打包的源码快照版本）。复制来的取数模块单测 103 条原样通过；`productView.test.ts`、`productStates.test.ts`、`productRows.test.ts` 覆盖切换保留选中、状态读取与行字段。

**O2 全量门**（分离检出，最终 HEAD 见 PR）：install、build、typecheck、check-refs、`openspec validate --all --strict`（52 项）、`claude plugin validate`、`pnpm test`（267 个文件，5,802 条通过，4 条跳过）全绿。
- `explorer-smoke --self-check`：第一次门在 planted `no-products` 页超时（页面脚本 15 秒内没有结果）：没有产物数据时每个视图、行与代码面板的等待各等满 3 秒。修为第一次视图、行或状态没出现后，其后的等待只试一次（单独一个 commit）；之后 exit 0，`no-products` 红在 products，正常页探针 7.9 秒。
- `view-smoke-graph`：`layers/domain` 一条（领域页的节点跳到结构图并选中）在本分支与 main（b0f0de5a）上都偶发失败，同一检出连跑有过有不过；本分支没有改 `view.html` 与 `report-view`。CI 不跑这个冒烟。记为既有的偶发失败，不在本变更里修。

**O3 冒烟**：顶栏（无 Files、Classes、类型过滤、引导弹窗，三个按钮）、三个视图的统计与产物计数相等、high 筛选、行详情、在图中显示、打开代码定位到行、Escape 顺序（代码 → 行 → 视图）、not run 写出命令、768 与 375 宽无横向溢出、网络 0 请求、控制台无错。植入故障 `legacy-chrome`、`no-products`、`wrong-counts`、`node-missing`、`no-sources` 各自在对应检查上红。

**O4 真实语料**（go-multirepo，只读语料的镜像打包，`--out` 在语料外）：
- Unused：5,019 / 3,314 / 1,705 / 207，按置信度 high 0、medium 109、low 4,910，与 `unused-code.json` 的计数相同。
- Hotspots：2,121 / 0 / 4 / 67，与 `hotspots.json` 相同。
- Doc map：语料没有 doc-map，视图写 not run 与 `/excavator-doc-map`。
- 在图中显示选中节点并在侧栏显示其 AI 摘要；控制台无错；网络只有页面文件与 `data:` URI；明暗主题都跟随 token。
- 体积：`explorer.html` 41,587,814 字节，比此前约 34.8 MB 多约 6.8 MB（`unused-code.json` 5,278,634、`hotspots.json` 1,442,910、`products.json` 626）。
- 一次观察到 Unused 视图打开后自行关闭，重新加载后未复现（保持打开 15 秒），冒烟也未出现；记录在此，不作结论。

**与计划的出入**：tasks.md 的 commit 4–6（三个视图各一个）合为一个 commit `feat(explorer): Unused, Hotspots and Doc map views`：三者共用视图外框、行详情与跳转，分开提交会让前两个 commit 带着只为后面准备的共用件。另加一个冒烟修复 commit。

**评审第 1 轮修复**（PR 评审，三条 Important，各一个 commit，主规范「离线仪表盘的产物视图」随之改写）：
- 视图打开时点当前所在的 Domain / Structural 会走模式切换并清空选中，与「选中的节点不变」不符。改为当前模式只关视图，换模式时照旧清空。
- 「在图中显示」对 unused 的函数行选中了结构图不画的节点：文件级下层只列文件，真实语料的层都只列文件。改为选中画出的、包含它的最近节点（通常是文件），并在详情写明。真实语料上同时发现被选中的文件在折叠的分组里、或在大层里落在视口外，副本原有的选中对准在布局完成前就执行。改为从图外选中的节点（在图中显示、搜索、文件列表）展开所在分组，并在布局放好后对准。真实语料复验：跨层四次跳转，节点都画出且在视口内。
- 「仅被测试使用」的行可点，打开的面板标题是 Unused function。改为与 `view.html` 一样不可点。
- 冒烟补检查：Structural 关视图后选中仍在、测试专用行不可点、跳转后节点已画出。各检查在修复前的代码上为红。
