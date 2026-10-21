## Commit 序列

0. `docs(openspec): propose viewer-app`：本变更的五个文件。
1. `build(view): report-view package builds one self-contained HTML template`（1.1–1.4）。
2. `feat(view): port the viewer pages to report-view and pack from its template`（2.1–2.5）。
3. `feat(view): summaries, tags and layers from the Full-mode semantic files`（S.1–S.2）。
4. `feat(view): structure graph with drill-down`（3.1–3.2）。
5. `feat(view): node details, code drawer, search, filters, focus and path`（4.1–4.3）。
6. `feat(view): product overlays and locate in graph`（5.1–5.2）。
7. `feat(view): domain view`（D.1–D.2）。
8. `docs(openspec): record viewer-app acceptance and archive`（6.1–6.5）。

每个 commit 自带测试，单独通过 O2。从 2 起，每个 commit 的夹具包都要过 O3 冒烟。

## 1. 包与单文件构建

- [ ] 1.1 `packages/report-view`：`package.json`（只有 `build`、`test`、`typecheck` 脚本）、tsconfig、vite 配置（`inlineDynamicImports`、内联资源，没有 `server`/`preview` 配置）、Tailwind 4。从旧 dashboard（`git show a26a5379^:packages/dashboard/...`）只取后续要用的文件。验证：`pnpm -r build` 产出 `dist/view.html`。
- [ ] 1.2 单文件插件与构建检查（design D2）：只有一个输出文件；`<!-- xv:csp -->` 与 `<!-- xv:data -->` 各一个；没有 `<link`，没有带 `src=` 的 `<script`；JS 里没有 `</script`。验证：单测对多文件、多 `<link>`、缺占位、含 `</script` 各自报红；同一 lockfile 两次构建逐字节相同。
- [ ] 1.3 数据层 `src/data/`（design D3）：manifest、gzip 解码、jsonl 解析、索引、产物到节点的映射。验证：单测覆盖入边表与出边表、节点到文件的映射、unused id 与 hotspots 路径的映射，以及「图谱里没有它」。
- [ ] 1.4 契约测试（design D10）与 `service-only` 规范同步。验证：`pnpm test`、`check-refs` 通过；删掉一条规则（比如给包加一个 `dev` 脚本）时测试会红。

## 2. 移植现有各页，打包改用模板

- [ ] 2.1 外壳（design D7、D8）：顶栏、左侧导航、主区、侧栏与抽屉的布局；57blocks token；浮层样式；`MotionConfig` 与减少动效；hash 路由；就绪与计数约定。验证：单测覆盖路由往返与色板对比度；夹具冒烟里 `data-xv-ready=1`，没有错误。
- [ ] 2.2 `DataTable` 与各页（design D6）：Overview、Unused、Doc map、Hotspots、Code、Reports，内容与 report-viewer 主规范一致。移植 `tests/skill/excavator-view` 下对应的纯函数测试。验证：只选 high 时条数等于 `counts.byConfidence.high`；缺 `commitsByYear` 时显示「产物未提供」；Markdown 里的 `<script>` 与 `<img onerror>` 是文字；扫构建产物里没有建议性词组。
- [ ] 2.3 `page-assembly.mjs` 改用 `packages/report-view/dist/view.html`（design D9）：CSP 加 `worker-src blob:`；缺模板时失败并提示先运行 `pnpm build`。验证：打包单测（缺模板、CSP、确定性、原子写、恶意字符串）全部通过；真模板打两次夹具包，逐字节相同。
- [ ] 2.4 删除 `viewer/` 与它的静态门测试，把仍有意义的检查改为对构建产物检查；更新 `README.md` 与 `SKILL.md` 里提到 `viewer/` 的地方。验证：`check-refs` 通过；仓库里不再有 `viewer/` 的引用。
- [ ] 2.5 冒烟（O3）：先确认装置会红，再让夹具包每页报绿。验证：记录每页的计数。

## S. 语义（design D11）

- [ ] S.1 打包侧：`products.mjs` 新增语义产物，用 `semantic-cache.mjs` 的 `isCanonicalSemanticCache` 与 `isFresh` 对 `source-manifest.json` 判新鲜；载荷每条只留 `id`、`summary`、`tags`、`verification`；不新鲜的计数；`contradicted` 的摘要置空；语义图 `factDigest` 与图谱 `factsDigest` 不同时为 unreadable。验证：打包单测覆盖这四条与「没有语义文件时 not run」，各自先红后绿。
- [ ] S.2 前端：建索引时把语义条目并到节点；层取语义图，没有时取图谱 `layer` 记录；Overview 列出语义状态与不新鲜计数；侧栏显示核验结论，`contradicted` 写「这条摘要与源码不符，未显示」。验证：单测覆盖并入顺序（语义优先，其次图谱自带）与层来源；夹具冒烟里一个 contradicted 节点的侧栏文字符合规范。

## 3. 结构图

- [ ] 3.1 目录分组与边聚合（design D4）：有层时按层；没有层时按「成员仓 / 顶层目录」，过于集中时拆到更深一级目录；每级最多 400 个节点，超出时折叠；按类型聚合边。验证：单测覆盖不出现图谱外的分组、下钻计数等于路径前缀计数、折叠只折叠不丢、聚合计数。
- [ ] 3.2 `GraphView`：ELK 布局、簇与容器节点、文件展开出函数与类、面包屑、MiniMap、Controls、点状背景、镜头过渡、下钻状态写进 hash。验证：夹具冒烟里下钻两级，计数正确，后退回到上一级。

## 4. 详情、抽屉、搜索、过滤、聚焦与路径

- [ ] 4.1 详情侧栏与代码抽屉（design D5）：字段、按类型分组的入边与出边、产物事实（没跑时写 not run），抽屉高亮、放大、跳到 Code 页，沿用 `.xv-code` 的 DOM 约定。验证：单测覆盖没跑的产物显示 not run 而不是 0；冒烟里打开抽屉，`data-xv-highlight` 等于行范围。
- [ ] 4.2 搜索（包内模糊匹配）、过滤（节点类型、边类型、层，入口上显示被过滤掉的数目）、1 跳聚焦（d3-force 在内联 Worker 里跑）、两点最短路径（无路径时写明）。验证：单测覆盖搜索排序、最短路径、聚焦的邻居集合；冒烟里 Worker 在 `file://` 下完成布局。
- [ ] 4.3 快捷键与 `Esc` 逐级关闭、`?` 快捷键列表，浏览器后退与前进。验证：冒烟里下钻、选中，再后退两次，状态符合规范的场景。

## 5. 叠加层与「在图中定位」

- [ ] 5.1 hotspots、unused、doc-map 三个叠加层，含图例，只在产物已内联时可用；图例与提示里没有建议性措辞。验证：单测覆盖着色分档与产物没跑时不可用。
- [ ] 5.2 Unused、Doc map、Hotspots 每行的「在图中定位」：切到图、下钻、选中、打开对应叠加层；图谱里没有对应节点时写明。验证：冒烟里从 Unused 页定位一条，选中的 id 等于记录 id。

## D. 领域视图（design D12）

- [ ] D.1 打包侧：领域图状态（`version`、`contentLanguage`、`sourceRevision`、`factDigest` 对图谱）；前端数据层：domain、flow、step 索引，step 按 `flow_step` 权重排序，`nodeIds` 对图谱解析。验证：单测覆盖排序、解析不到的项、`factDigest` 不同时为 different revision。
- [ ] D.2 `DomainGraphView`：顶层 domain 簇与 `cross_domain` 标签边，下钻到 flow 与 step，侧栏，step 跳结构图，`#/domain` 路由进历史，顶部说明「由模型从代码推导」。验证：夹具冒烟里下钻到一个 flow，step 顺序正确，点一项 `nodeIds` 后结构图选中的 id 相等。

## 6. 验收

- [ ] 6.1 O2 全量门。
- [ ] 6.2 O1 注入变异逐一先红后绿，记录结果。
- [ ] 6.3 O4：在 go-multirepo 上打包并冒烟；完成总数比对（含层、语义结论与领域计数）、23 条分层跳转、耗时、大小、动效与减少动效、六张截图，逐项对照 design D8 的版式清单。
- [ ] 6.4 O5：`claude -p --model sonnet` 跑 `/excavator-view`。
- [ ] 6.5 在 design.md 末尾写验收记录，同步主规范，归档本变更。
