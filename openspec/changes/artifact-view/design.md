## Context

- 产物与形状（2026-10-13，`lazy-fact-graph/8`）：
  - `knowledge-graph.jsonl`：第一行 header（`keys`、`fields.project`、`counts`），其后每行一条 `node` / `edge` / `coverage` / `gap`（Full 另有 `layer`，`tour` 恒空）。节点字段 `id`、`type`、`name`、`filePath`、`lineRange`、`owner`、`anchorSource`、`summary`（Lazy 为空）、`tags`、`complexity`；边字段 `source`、`target`、`type`、`direction`、`weight`、`evidence[]{file,line,endLine?,source,token?,context?,resolution?}`、`provenance`。
  - `source-manifest.json`：`sourceRevision`（多仓库为 `multi-repo:<hash>`）、`selectionDigest`、`pipelineVersion`、`selection{policyVersion,candidates,selected,filteredByDefaults,filteredByIgnore,sensitive,entries[]}`、`entries[]{path,contentHash}`。没有成员仓库列表。
  - `fingerprints.json`：每文件 `totalLines`、`contentHash`、声明名字列表。
  - `source-index.jsonl`：header（BM25 参数、`N`、`termCount`）、`file-indexed`、`chunk`（每节点的 `identifiers` / `comments` / `strings`，不含源码正文）、`posting`。
  - 可选：`semantic-cache.json`（`entries[nodeId]{summary,tags,semanticSourceHash,model,generatedAt,verification}`）、`semantic-graph.json`（`factDigest`、`layers[]{id,name,description,nodeIds}`、`relations[]`、`gaps`、`contentLanguage`）、`domain-graph.json`（KnowledgeGraph 形状，节点类型 domain / flow / step，带 `domainMeta`、`sourceRevision`、`factDigest`）。
  - `intermediate/` 不作为输入：团队可能只提交最终产物。
- `knowledge-graph-store.mjs` 的 `readKnowledgeGraph` 把整图实例化成对象；它校验 header 与记录数，失败具名、不返回部分图。本变更的流式读取器沿用同一契约。
- `file://` 实测（headless Chrome，`--virtual-time-budget`）：内联 module 脚本、`DecompressionStream('gzip')`、blob Worker、`webkitdirectory` 与 `showDirectoryPicker`、同目录传统 `<script src>` 可用；`fetch` 同目录文件被拦；外链 module 脚本与 `@font-face` 相对路径受 CORS 拦截。内置浏览器面板对本地文件只渲染静态快照，验收只能用 headless Chrome。
- 规模实测（流式列式转换，Int32 列 + 字符串表 + JSON 尾）：

  | 图 | JSONL | 节点 / 边 / 证据 | 字符串表 | 列 | gzip | base64 | 转换 | Node 峰值 |
  |---|---|---|---|---|---|---|---|---|
  | wcp | 16 MB | 10,483 / 35,593 / 35,342 | 1.2 MB | 1.1 MB | 0.3 MB | 0.4 MB | 0.1 s | 105 MB |
  | hadoop | 555 MB | 154,531 / 774,350 / 687,475 | 31.2 MB | 22.4 MB | 6.1 MB | 8.1 MB | 2.9 s | 485 MB |

  wcp 被选中源码 17.2 MB、37.3 万行，符号跨度合计 24.6 万行（66%）；hadoop 约 300 万行 Java，源码片段按同比例约 80 MB 原文。
- 既有门禁：`tests/skill/excavator/test_service_only_contract.test.mjs` 禁止 `packages/dashboard`、`packages/viewer`、`skills/excavator-dashboard` 与若干文件里的 `dashboard` 字样；`tests/install/install.test.mjs` 钉死 10 个 skill；`tests/skill/excavator/test_skill_graph_freshness.test.mjs` 要求读图 skill 的 `SKILL.md` 含共享新鲜度助手的固定句式；`scripts/check-refs.mjs` 要求 skill 目录名等于 frontmatter `name`、引用的脚本路径都存在；`tests/refs/legacy-literals` 扫旧名。
- 语言约定：代码、`SKILL.md`、页面文案英文；OpenSpec 中文。
- 构建布局：`pnpm -r build` 构建 `packages/*` 里带 `build` 脚本的包；根 `tsconfig.json` 只含 `src`；`dist` 在根 `.gitignore`。
- 上游已知缺陷（独立任务，不在本变更）：多仓库 / git 快照的项目名取自临时目录，header 里是 `excavator-snapshot-multi-…`。页面按 header 原样显示，不猜。

## Goals / Non-Goals

**Goals:**
- 一个文件、只要浏览器；hadoop 规模单文件 ≤ 25 MB，1 GB 的 JSONL 仍是单文件。
- 有什么产物亮什么，缺失与裁剪都可见；语义逐项标新鲜度。
- 演示级动效，但 `prefers-reduced-motion` 时全部降级为无动画。
- 插件不新增任何运行时：没有服务、没有端口、没有常驻进程。
- 页面不出网：内容安全策略关网，分享时可以明说。

**Non-Goals:**
- dead-code 产物（正在进行的变更，合入后按同一清点机制加一块）。
- PRD 文档、figma 与 knowledge 两种图：页面不区分 `kind`，用同一套视图渲染任何 KnowledgeGraph 形状的图（最终验收用 `kind="knowledge"` 的图实测可渲染），但只以代码库图为验收对象；非代码库图在 `docs/view.md` 列为未验证的已知局限。
- 页面内实时新鲜度（`file://` 做不到；烘焙时判定并印入页面）。
- 文件夹分片模式（见 D1，作为扩展路径记录，不实现）。
- 编辑、注释、协作；多语言界面（界面英文，与持久化语义一致）。
- 把 `view.html` 提交进被分析项目的 git（由项目自行决定，与其它 `.excavator/` 产物相同）。

## Decisions

**D0：为什么落代码，而不是交给 skill / prompt。** 页面是一个要被反复打开、对任何项目行为一致的确定性产物，模型每次现写一个交互页面既不稳定也不可校验；烘焙是数据变换（流式读、驻留、编码、注入），必须机器核对计数与外部引用。skill 散文只承担判断：解释新鲜度、决定旗标、报告清单。

**D1：交付形态是单个自包含 HTML。** 备选：(a) 文件夹 + `index.html` + 若干传统 `<script src>` 数据分片——实测可行，可按需加载，但多文件在分享时易散、相对路径与浏览器差异多；(b) 本地 HTTP viewer——被 service-only 禁止，且要求收件人有 Node。选 (a) 单文件；文件夹分片只在数据超过硬上限时才有意义，作为扩展路径写在 Risks。

**D2：技术栈 React + Vite + `vite-plugin-singlefile`；Canvas 2D 画图谱与 treemap；d3-force、d3-hierarchy 只做布局；framer-motion 做 DOM 动效。** 备选手写全部（零库）：收件人体验相同，但力导向、treemap、动效全部手写，实现与维护成本高、动效质量没有保障。备选 WebGL / three.js / cytoscape：体积与复杂度不值，聚合渲染后可见节点最多几百个，Canvas 2D 足够。运行时约 100 KB gzip，相对数据可忽略。Vite 配置：`base: './'`、`inlineDynamicImports`、`cssCodeSplit: false`、`assetsInlineLimit` 调到不切分、singlefile 内联；不用 `BrowserRouter`，状态走 `location.hash`；字体用系统栈。

**D3：数据包格式 `excavator-view-bundle/1`。** 多段结构，每段独立 gzip + base64，放在模板的 `<script type="text/plain" id="excavator-view-data">` 里，段之间用一行段头（名字、原始字节数、压缩字节数、是否压缩）分隔：
- `meta`：JSON——格式版本、烘焙时间、header 的 `fields` 与 `counts`、清点结果（每个产物：存在 / 缺失 / 裁剪，及生成命令）、新鲜度（事实层状态、revision 对照）、选择漏斗与非 `selected` 的 `selection.entries`、成员仓库（`multi-repo:` 时按第一段路径）。
- `strings`：JSON 字符串数组，全局驻留表。
- `nodes`：Int32 列（id、type、name、path、line0、line1、owner、complexity、anchorSource），按图中顺序。
- `edges`：Int32 列（src、dst、type、direction、evCount、evOffset）；`evidence`：Int32 列（file、line、endLine、source、token、context、resolution），按边顺序连续排列，`evOffset` 指向起点。
- `coverage`、`gaps`：JSON。
- `files`：Int32 列（path、totalLines、contentHash）来自 fingerprints 与 manifest；缺 fingerprints 时 totalLines 为 -1 且清点明示。
- `index`：source-index 的 chunk（nodeId、identifiers、comments、strings 的驻留 id 列）与 posting（term → chunk id 列表）；缺失时清点明示、标识符搜索降级为名字搜索。
- `semantic`、`layers`、`domain`：存在才有，原 JSON 经驻留后嵌入，每条带新鲜度判定结果。
- `evidenceText`：每条证据的行原文（驻留 id 列）；`excerpts`：每个带 `lineRange` 节点的源码片段（节点序 → 字符串 id）。这两段是唯一随源码规模增长的段，可被预算裁掉。
- `--raw` 时各段不压缩，段头标明。编码与解码放在同一个零依赖的 ESM 文件 `skills/excavator-view/bundle-codec.mjs`（JSDoc 类型）：编码只在 Node 里用（`node:zlib` 动态引入），解码路径不引任何 `node:` 模块，只用 `DecompressionStream`、`TextDecoder` 与 TypedArray，这些在 Node ≥ 18 与目标浏览器里都是全局对象。页面经相对路径引入同一文件由 Vite 打包；烘焙脚本直接引入它做写出前自检。只有一份实现，往返测试在 Node 里跑。备选「页面侧 TS 解码器 + 脚本侧等价实现」被否决：两份实现会漂移，而脚本在 Node 22 下不能直接加载 TS。

**D4：流式烘焙与自检。** `readline` 逐行读 `knowledge-graph.jsonl`，字符串驻留，列以可增长的 Int32 缓冲累积；结束时按 header 校验各流计数，不符即具名失败。源码原文经 SourceSnapshot（与 manifest 同一 `sourceRevision`）读取，只读 manifest 里的文件、只取需要的行；manifest 的 `contentHash` 与快照不一致的文件不嵌、计数明示。写出前：用解码器解一遍得到的计数等于 header；扫描输出不含外部引用、含 CSP。写临时文件后 `rename` 替换。任何失败不触碰目标路径。

**D5：预算与裁剪顺序。** `--source-budget` 默认 64 MB，按随源码规模增长的三段原文字节合计：`excerpts`（符号源码片段）、index 字面量（source-index 里的注释与字符串字面量，切片 A 验收后独立成段）、`evidenceText`（证据行原文）；超出按固定顺序整段裁剪：`excerpts` → index 字面量 → `evidenceText`（整段去而不是部分去：部分裁剪会造成「有的边有原文、有的没有」的第四态）。硬上限：全部段 base64 后合计 256 MB，超出具名失败（`view.html` 需要 X 字节，上限 Y）。`--raw` 体积约放大 4.7 倍（wcp 5.1 MB → 24.2 MB），大图会撞硬上限，文档要写明。

切片 A 实测（2026-10-13，HEAD 9c276c06）：

| 语料 | 默认 | `--no-source` | 烘焙耗时 | Node 峰值 RSS | Chrome 解码 / 可交互 |
|---|---|---|---|---|---|
| wcp | 5.12 MB（图组 1.35、index 1.31、excerpts 2.05、evidenceText 0.22、模板 0.19） | 1.83 MB | 3.3 s / 1.1 s | 297 MB / 177 MB | 0.19 s / 0.28 s |
| hadoop | 56.5 MB（excerpts 150 MB 原文按预算裁掉） | 32.6 MB | 18.8 s / 8.4 s | 1.6 GB / 0.9 GB | 0.85 s / 1.12 s；0.42 s / 0.63 s |

提案阶段的估算漏了 index 段（hadoop 上它是体积大头）与 interning 期间的对象开销。任务 4A 落地后（5aee1f46）复测：

| 语料 / 模式 | 4A 前 | 4A 后 | 剩余构成（存储字节） |
|---|---|---|---|
| wcp 默认 | 5.12 MB / 3.7 s / 277 MB | 4.38 MB / 3.9 s / 266 MB | — |
| wcp `--no-source` | 1.83 MB / 1.3 s / 175 MB | 1.13 MB / 1.3 s / 157 MB（最终模板下 1.47 MB） | — |
| hadoop 默认 | 59.3 MB / 18.5 s / 1.68 GB | 40.6 MB / 17.8 s / 1.37 GB（最终 40.95 MB / 16.8 s / 1.53 GB） | 默认模式 RSS 由源码收集主导：全量 materialize，收集了 150 MB 片段再被预算裁掉 |
| hadoop `--no-source` | 34.2 MB / 8.3–9.1 s / 785–862 MB | 16.5 MB / 7.5–8.0 s / 703–757 MB（最终 16.88 MB / 8.2 s / 819 MB） | 图表 6.71、全局字符串 2.54、index chunk 与 token 2.89、files 0.11、模板 0.53（切片 C 后模板从 0.19 MB 涨到 0.53 MB） |

内存剖析（hadoop `--no-source`）：最大瞬态是整份 `JSON.parse` 79 MB 的 `fingerprints.json`（单独 457 MB），改为只取 `totalLines` 的流式扫描后 90 MB；其次是末尾自检一次性解码（+170 MB），改为经 codec 的 `decodeSegments` 逐段流式；共享的新鲜度助手自身占 253 MB / 1.6 s，是广泛引用的模块，不在本变更动。RSS 只降 10–15%，因为 V8 堆之外的原生内存不归还；更准的指标是完成烘焙所需的最小 `--max-old-space-size`：256 MB → 192 MB。1 GB JSONL 线性外推约 340 MB 堆加 150 MB ArrayBuffer，默认堆上限 4 GB。Chrome 侧 hadoop 页解码 / 可交互：默认 0.67 / 0.89 s，`--no-source` 0.26 / 0.40 s。

**D6：清点与新鲜度规则。**

| 产物 | 必需 | 区块 | 新鲜度键 | 缺失文案 |
|---|---|---|---|---|
| `knowledge-graph.jsonl` | 是 | 总览、图谱、覆盖与缺口、搜索 | 事实层：共享助手的 fresh / stale / missing | （烘焙失败） |
| `source-manifest.json` | 是 | 选择漏斗、成员、revision | 同上 | （烘焙失败） |
| `fingerprints.json` | 否 | 结构 treemap 的大小 | — | 行数不可用，treemap 按文件数 |
| `source-index.jsonl` | 否 | 标识符搜索、节点词项 | — | 标识符搜索不可用 |
| `semantic-cache.json` | 否 | 节点摘要与标签 | 每条 `semanticSourceHash` vs `contentHash` | 未生成：`/excavator --mode=full` 或在 `/excavator-chat` 里按需生成 |
| `semantic-graph.json` | 否 | layers 与 relations | `factDigest` vs header `factsDigest` | 未生成：`/excavator --mode=full` |
| `domain-graph.json` | 否 | 领域 → 流程 → 步骤 | `sourceRevision` vs manifest，`factDigest` vs header | 未生成：`/excavator-domain` |

**D7：页面架构。** 六块：Overview、Structure、Graph、Coverage & Gaps、Search、Semantics（后者按清点显示）。解码在 blob Worker 里完成，主线程只收 TypedArray（transfer）；Worker 同时建 CSR 邻接表（按边类型分段）供邻域查询。Graph 视图三级：成员 / 目录级聚合（d3-force，节点 ≤ 400）、展开目录后的文件级、选中节点的 1–2 跳邻域（符号级）；聚合边带计数、按类型可开关、沿边有方向粒子。Structure 用 d3-hierarchy 的 squarify 画目录 treemap，按 `totalLines` 定大小、按语言着色，点击动画缩放下钻。Search 用名字 / 路径 / id 的子序列匹配加 posting 的词项精确匹配，结果跳转并写 hash。详情面板：事实字段、按类型分组的出入边（证据 file:line + 原文）、chunk 的 identifiers / comments / strings、源码片段、语义摘要与新鲜度徽章。动效清单作为自检项（见 O9），`prefers-reduced-motion` 下全部关闭。深色主题，CSS 自定义属性。

**D8：多仓库与项目名。** `sourceRevision` 以 `multi-repo:` 开头时，成员 = 被选中文件路径的第一段；Overview 按成员分卡片，Graph 的顶层聚合按成员。项目名按 header 原样显示；名字像快照临时目录是上游缺陷，页面不改写。

**D9：构建集成。** `packages/view/package.json` 提供 `build`（vite build）与 `typecheck`；根 `typecheck` 脚本追加 `tsc --noEmit -p packages/view/tsconfig.json`；`pnpm -r build` 自动包含。skill 预检：`packages/view/dist/index.html` 缺失则 `pnpm --filter @excavator/view build`，与 `core/dist` 的做法相同；`docs/mcp.md` 已要求 `pnpm install && pnpm -r build`，`docs/view.md` 重申。开发时 `vite dev` 从 `packages/view/fixtures/` 读一份小数据包（由烘焙脚本对测试夹具生成，提交进仓库，不含真实项目内容）。

**D10：命名与门禁更新。** skill 与包一律用 `view`，不用 `dashboard`（契约测试禁用该词）。`test_service_only_contract.test.mjs` 保留对 `packages/dashboard`、`packages/viewer`、`skills/excavator-dashboard`、tour 与 thumbnail 的断言，新增断言：`packages/view` 不含任何服务器启动代码（无 `listen(`、无 `http.createServer`）、`skills/excavator-view/SKILL.md` 不含 `--with-dashboard` 与端口；`install.test.mjs` 改 11；`test_skill_graph_freshness.test.mjs` 的列表加 `excavator-view`。

**D11：先验装置。** `scripts/view-smoke.mjs`：用 headless Chrome 以 `file://` 打开烘焙页，读页面自报的信息——页面把解码后的计数、`window.onerror` 与 CSP 违规计数、解码耗时与总览可交互耗时都写进固定 `data-*` 属性。实现（切片 A 修正）：不用 `--virtual-time-budget` 加 `--dump-dom`，因为虚拟时间不等 Worker 线程，解码在 Worker 里的页面在 dump 时还停在 loading；改为 `--remote-debugging-pipe` 走 DevTools 协议（零依赖），真实时间轮询 `#root` 直到 ready / error，再读 DOM，退出码按 ready、错误数为零、CSP 违规为零、解码计数等于 header 判定。装置先用一个故意截断数据段的页面证明它会红，再用于 wcp 烘焙页。找不到 Chrome 时测试以可见的 skipped 结束，不假绿。headless `--dump-dom` 不能往文件选择器里放目录，所以拖入模式的核对分两层：解析函数与烘焙共用并在 Node 里单测；界面入口在验收时人工拖入 wcp 的 `.excavator/` 核对清点与计数（O9）。

**D12：skill 行为。** `SKILL.md` 英文；步骤：解析 `PROJECT_ROOT` / `PLUGIN_ROOT`（与其它 skill 相同的三候选）；确认图谱存在；运行 `consumer-freshness.mjs`（固定句式，满足新鲜度测试）；确认模板；运行 `build-view.mjs`，传旗标；读脚本打印的 JSON 报告（路径、字节数、清点、裁剪、新鲜度）转述给用户；按宿主选打开器（`open` / `xdg-open` / `start`），`--no-open` 跳过；提醒默认嵌入源码原文、外发用 `--no-source`。

**D14：切片 B 实现中的偏差（已接受）。** (1) 结构 treemap 用绝对定位的 DOM 而不是 Canvas 2D：格子是真实链接、可键盘聚焦、冒烟能读到标记，且一次只画当前目录两层，节点数有界；Canvas 仍用于图谱视图。(2) 搜索的词项索引在首次搜索（任意类型）时于 Worker 内惰性构建并显示进度：wcp 131 ms，hadoop `--no-source` 83–93 ms，hadoop 默认（含字面量）2.6–4.2 s；不进 ready 路径。(3) 冒烟脚本增加 `--then '#/…'`（同页内切换片段并逐步报告）与 `data-busy` 等待；页面各视图经 `data-*` 自报当前路径、搜索结果数、倒排表状态。(4) 行数缺失的规则：只有当没有任何文件有行数时才按文件数定大小；部分缺失时这些文件不占面积、在目录表里列出并计数（wcp 15 / 2,121，hadoop 193 / 16,413），否则 wcp 整图会退化成按文件数。(5) 图谱四层而非三层：成员 `#/graph` → 目录 `#/graph/<dir>` → 文件的符号层 `#/graph/file/<path>` → 符号邻域 `#/node/<id>[?hops=2]`，按用户 2026-10-13 的要求加了点击下钻、面包屑、拖拽平移、滚轮缩放、双击适配与节点拖动（规格「图谱逐层下钻与直接操作」）。有界规则：一层最多 400 项（最重的 399 项加一个可见的 `more` 桶），成员 / 目录 / 文件层最多画 600 条链接、邻域层最多 2,000 条（同一对节点的多类型边合并为一条路径后实际路径更少）并报告总数，超过上限的边进账本的 `cut` 桶，离开 / 进入当前范围的边、未解析边、无路径节点各记一个可见桶；没有文件的子目录链收拢到链尾。力导向：链接距离 36 + r 源 + r 目标、强度 0.35，斥力 −50 − 6r，碰撞 r + 4，向心 0.06，300 tick 同步算完；粒子每链接 min(3, 1 + log10 计数) 个、45 px/s。CSR 在首次图谱路由时于 Worker 惰性构建，hadoop 70 ms。已知可读性问题留给 10.x：hadoop namenode 这类 151 节点 / 861 链接的目录层仍是毛球，中心标签重叠，2 跳节点在深色下偏淡；图例计数只算画出的链接。

**D15：图谱节点的视觉语言（用户 2026-10-13 反馈「节点样式太简单」，任务 10.0）。** 现状是单色圆加标签，信息量只有大小。定稿规则，每一条都编码真实数据、不加装饰性噪音：
- **形状按节点种类**：成员与目录是圆盘，文件是圆角方块，函数是圆，类 / 接口是六边形，config 等非代码节点是菱形；图例同形状。
- **填充按内容**：文件与符号按语言色（与 Overview、treemap 同一映射）做径向渐变；目录与成员的圆盘外圈是按行数的语言环（迷你环图），一眼看出目录的语言构成；layer 着色开启时填充换成层色、语言环保留。
- **大小与徽章**：半径仍按行数 / 符号数；目录与成员节点内写文件数或符号数的计数徽章；节点有入度时外圈刻度表示入边数量级（log）。
- **边**：二次曲线、箭头按计数定大小、线宽按 log 计数、颜色按边类型；悬停或选中时相关边提亮、其余边与节点降到 25% 不透明度（聚焦模式）；粒子保留。
- **标签**：按缩放做细节层次——缩小时只给最大的节点标签，放大后全部显示；标签带半透明底衬与类型字形（ƒ、C、▢）；过长省略。
- **状态**：悬停有柔光与放大 1.1 倍，选中节点有脉冲环，被拖动的节点有阴影；进入一层时节点从被点节点位置弹出，交错 20 ms。
- 画布底有极淡的网格与晕影，深浅主题各一套令牌；所有效果在 `prefers-reduced-motion` 下保留形状与颜色、去掉动画。
- 拖入模式（切片 C1）的三条决定：拖入页保留 `indexLiterals`（这些文本来自 `source-index.jsonl` 自身，不是读源码），`evidenceText` 与 `excerpts` 记为 `drop-mode` 裁剪；事实层新鲜度记 `not-checked` 并写明原因（页面里没有源码快照可比）；语义产物的新鲜度只按 hash / digest 判，不做 `resolveArchitectureAction` 那样的规范身份与语言审计检查（与烘焙一致，是已知局限：非规范的语义图会显示为 fresh 或 stale）。烘焙与拖入共用 `skills/excavator-view/shared/` 下不引 `node:` 的解析模块，只有文件读取器不同（Node fs 对 Blob 流），同函数两读取器的测试证明清点与各段相同。新鲜度判定函数从 `semantic-cache.mjs` 与 `domain-freshness.mjs` 抽到独立模块并原地再导出，调用方不变。
- 切片 B 验收的可读性建议并入：标签只给最大的约 20 个节点并做碰撞剔除；同一对节点的多类型边默认合并为一条带类型分段的边；2 跳节点在深色下提高对比度；目录层可选按子目录分簇。有界规则的修正见任务 7A：文件层与邻域层同样是 399 + `more`，被收拢的边进可见桶，图例写 `drawn / total`，邻域按跳数分配配额。
验收口径：wcp `wcp-auth/internal` 目录层与一个符号邻域、hadoop namenode 目录层三张截图对照本条逐项勾；同一数据在聚合层、目录层、符号层的形状与颜色规则一致。

**D13：切片 A 验收后的修正（任务 4A）。** (1) index 字面量独立成段并进预算（D5）；(2) posting 段不嵌入，页面从 chunk 的标识符列加 index 字面量重建倒排表（source-index 的 posting 同时索引标识符、注释与字符串字面量，只凭标识符列重建不出来）：字面量已嵌入时重建结果与原 posting 逐项相同（wcp 9,134 / 9,134、hadoop 68,023 / 68,023 个词项核对相同），字面量被裁或 `--no-source` 时倒排表只含标识符并在页面标明「identifiers only」；重建在 hadoop 上需 2.9 s 与 351 MB 堆，切片 B 接入 Worker 时必须在首次搜索时惰性构建，不进 ready 路径；(3) 成员卡片的数字是 manifest 条目数，标签改为「files in manifest」并并列 selection 的 selected 数（wcp 两者差 1，是被选中却没有 manifest 条目的符号链接，上游行为，页面不猜）；环图中心是候选数，标签改为「candidate files」；(4) 冒烟脚本先发 CDP `Browser.close` 再超时 SIGKILL，不留 Chrome 临时目录；(5) O3 补「缺 manifest 时已有旧文件逐字节不变」的断言；(6) 烘焙内存在 hadoop 上剖析并压低。「Available in a later slice」占位文案在 12.2 必须全部消失，列为检查项。

## 验收 Oracle（动手前写死）

- O1 构建：`pnpm -r build` 产出 `packages/view/dist/index.html`；文件里没有 `src=` / `href=` / `url(` 指向 `http(s):`、`//` 或相对路径；恰好一个数据占位；含 CSP 元标签。
- O2 编解码往返：夹具数据包 encode → decode 得到的节点、边、证据、缺口计数与内容和输入相等；`--raw` 与压缩两种形态结果相同。
- O3 烘焙失败路径：截断的 `knowledge-graph.jsonl`、缺 manifest、超硬上限三种输入都以具名错误失败，目标路径不变（已有旧文件时逐字节不变）。
- O4 源码开关：`--no-source` 后输出不含夹具里的标记串；默认烘焙含该标记串；manifest hash 不一致的文件不嵌并计数。
- O5 预算：`--source-budget 0` 下清点报告列出 `excerpts` 与 `evidenceText` 被裁，图计数完整。
- O6 `file://` 冒烟（wcp 真实烘焙）：页面自报计数 = header 计数；控制台错误 0；六块按清点出现；深链接定位。装置先用坏页面证明会红。
- O7 规模（hadoop 真实烘焙）：烘焙 ≤ 60 s；Chrome 打开到总览可交互 ≤ 10 s；图谱首屏只画聚合节点；体积以切片 A 实测为基线（默认 56.5 MB、`--no-source` 32.6 MB），任务 4A 的 posting 重建与字面量进预算落地后重测，`--no-source` 目标 ≤ 20 MB，达不到则在设计里写明原因与剩余构成；烘焙峰值 RSS 剖析后重测并记录。数字记入验收记录。（原目标「≤ 25 MB」是未实测的估计，已作废。）
- O8 门禁：三件套、`pnpm --filter @excavator/core test`、`pnpm run typecheck`、`node scripts/check-refs.mjs`、`openspec validate --all --strict` 全绿；安装测试 11 个 skill；service-only 契约测试更新后通过。
- O9 视觉与动效（人工，截图进验收记录，不进仓库）：wcp 页面六块各一张截图；动效清单逐项勾：计数器、滚动显现、treemap 缩放、图谱展开过渡、边上粒子、面板切换；`prefers-reduced-motion` 下全部静止；拖入 wcp 的 `.excavator/` 与烘焙页清点一致。
- O10 分享路径：把 wcp 的 `view.html` 单独拷到无网络的临时目录打开，功能同 O6。

## Risks / Trade-offs

- [仓库重新引入前端依赖，`pnpm install` 变重] → 依赖只在 `packages/view`；skill 零依赖；锁文件冻结。
- [模板必须先构建，marketplace 安装没有 dist] → skill 预检按需构建，与 `core/dist` 一致；文档写明。
- [Safari 对 `file://` 的限制与 Chrome 不同] → 验收在 Safari 手动打开一次；`--raw` 作兜底；CSP 与内联策略对两者相同。
- [hadoop 规模解码后内存约 200 MB] → TypedArray + 字符串表，不建对象图；聚合渲染；O7 记录实测。
- [开发服务器下一切正常、`file://` 下才坏] → O6 的 `file://` 冒烟进门禁，开发模式不作为验收依据。
- [数据超过硬上限] → 具名失败；扩展路径是文件夹分片（传统 `<script src>` 已验证可行），不在本变更实现。
- [默认嵌入源码原文，外发泄露] → `--no-source`；skill 报告里明示嵌入了哪些；CSP 保证文件自身不出网。
- [d3 / framer-motion 的许可与 NOTICE] → 全是 MIT / ISC，依赖经 `package.json` 声明；NOTICE 只记上游，不需改。

## Migration Plan

- 合入即生效；没有数据迁移。`view.html` 只在运行 `/excavator-view` 后出现。
- 回滚：revert PR；已生成的 `view.html` 成为无人读取的文件，`.excavator/` 本就在默认排除之内，不影响分析。
