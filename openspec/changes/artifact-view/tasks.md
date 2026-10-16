提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入；每个切片独立可测、可交付；一 coder 一 acceptor，验收 oracle 见 design.md）：

0. `docs(openspec): propose artifact-view`：proposal、design、规格增量、tasks。
1. `build(view): scaffold packages/view single-file template`：任务 1.1–1.3。
2. `feat(view): columnar bundle codec`：任务 2.1–2.3。
3. `feat(skill): streaming view bake with inventory, freshness, budget and self-checks`：任务 3.1–3.6。
4. `feat(view): overview, inventory, freshness and coverage sections`：任务 4.1–4.4。
5. `docs(openspec): record artifact-view slice A acceptance`：任务 4.5。
5a. `fix(view): slice A acceptance fixes`：任务 4A.1–4A.6（验收发现，design D13）。
5b. `docs(openspec): record artifact-view 4A results`：D5 / D13 按实测更新，4A 复选框。
5c. `fix(view): make the smoke exit check hermetic`：4A.4 的用例在并行负载下非封闭，改为按 SingletonSocket 定位本次启动的目录。
6. `feat(view): structure treemap and search`：任务 5.1–5.3。
7. `feat(view): CSR adjacency and directory aggregation`：任务 6.1。
7a. `feat(view): graph explorer and node detail`：任务 6.2–6.4、7.2 与 5.1 跟进（图谱过渡依赖 reduced-motion 开关，所以 7.2 随 7a）。
8. `feat(view): evidence text and source excerpts`：任务 7.1。
9. `docs(openspec): record artifact-view slice B acceptance`：任务 7.3。
9a. `fix(view): slice B acceptance fixes`：任务 7A.1–7A.5。
10. `feat(view): semantic layers when present`：任务 8.1–8.3。
11. `feat(view): drag-and-drop data directory`：任务 9.1–9.2。
12. `feat(view): motion pass, reduced motion and CSP`：任务 10.1–10.3。
13. `feat(skill): excavator-view skill, opener, gates and docs`：任务 11.1–11.5。
13a. `fix(view): final acceptance follow-ups`：12.2 的四项非阻塞修正（面包屑「›」、拖入模式「Loaded at」、tooltip 不盖标签、docs/view.md 数字与产物清单）。
14. `docs(openspec): record artifact-view acceptance and archive`：任务 12.1–12.3。

切片 A = 提交 1–5（能烘焙、能打开、总览与覆盖可看）；切片 B = 提交 6–9（可探索）；切片 C = 提交 10–14（语义层、拖入、动效、skill 与文档）。

## 1. 模板工程（切片 A）

- [x] 1.1 新建 `packages/view`（`package.json` 名 `@excavator/view`，脚本 `build` / `typecheck` / `dev`；依赖 react、react-dom、d3-force、d3-hierarchy、framer-motion，开发依赖 vite、@vitejs/plugin-react、vite-plugin-singlefile、typescript、@types/*）；`vite.config.ts` 按 design D2（`base: './'`、`inlineDynamicImports`、`cssCodeSplit: false`、不切分资源、singlefile）；`index.html` 含数据占位 `<script type="text/plain" id="excavator-view-data"></script>` 与 CSP 元标签。验证：`pnpm install --frozen-lockfile` 成功，锁文件更新进 commit；`pnpm -r build` 产出 `packages/view/dist/index.html`。
- [x] 1.2 新增 `tests/view/template-build.test.mjs`：`beforeAll` 里构建一次（单独放宽超时到 120 s）后断言输出没有外部引用（`src=` / `href=` / `url(` / `import(` 指向 `http(s):`、`//` 或相对路径）、恰好一个占位、含 CSP、不含 `type="module" src`。验证：测试通过；手工在模板里加一个 `<link href="https://…">` 后测试变红（装置先验，不提交）。
- [x] 1.3 根 `package.json` 的 `typecheck` 追加 `tsc --noEmit -p packages/view/tsconfig.json`；`packages/view/tsconfig.json` 严格模式。验证：`pnpm run typecheck` 通过。

## 2. 数据包编解码（切片 A）

- [x] 2.1 新增 `skills/excavator-view/bundle-codec.mjs`（零依赖 ESM，JSDoc 类型）的编码侧：按 design D3 的多段格式编码——驻留表、Int32 列、JSON 段、段头；支持每段 gzip（`node:zlib` 动态引入）或 `raw`；导出可增长 Int32 缓冲与驻留器。验证：单测覆盖空图、单节点、含全部边类型与证据字段的夹具；输出段头的原始字节数等于实际。
- [x] 2.2 同一文件的解码侧：读段头、`DecompressionStream` 或 raw、TypedArray 还原、驻留表解析；返回与编码输入同构的列式对象；解码路径不引任何 `node:` 模块（静态检查：文件顶层没有 `node:` 导入）。`packages/view` 经相对路径引入该文件。验证：`tests/view/bundle-roundtrip.test.mjs` 在 Node 里 encode → decode 逐段深度相等，压缩与 raw 两种形态相同；`vite build` 能打包它。
- [x] 2.3 格式文档 `skills/excavator-view/FORMAT.md`（英文）：段名、列定义、段头格式、版本规则（不兼容改版本号，解码器对未知版本具名失败）。验证：解码器对版本不符的输入抛具名错误的单测。

## 3. 流式烘焙（切片 A）

- [x] 3.1 新增 `skills/excavator-view/build-view.mjs`：解析 `<projectRoot>` 与旗标 `--out` / `--no-source` / `--raw` / `--source-budget <MB>` / `--template <path>`；清点 `.excavator/` 产物（必需与可选，design D6）；缺必需产物以具名错误失败。验证：单测覆盖缺图、缺 manifest、全可选缺失三种清点结果。
- [x] 3.2 流式读 `knowledge-graph.jsonl`（`readline`，不经 `readKnowledgeGraph`）：header 校验、逐条驻留与列累积、结束时各流计数对 header 校验，不符具名失败；读 `source-manifest.json`、`fingerprints.json`（可选）、`source-index.jsonl`（可选，流式）、三份语义产物（可选）并计算逐项新鲜度（D6）；成员仓库按 `multi-repo:` 规则。验证：单测用夹具与截断夹具（记录数少于 header）覆盖成功与失败；`--raw` 与压缩输出解码后相同。
- [x] 3.3 源码原文：经 SourceSnapshot 按 manifest 的 `sourceRevision` 读取，只取证据行与节点 `lineRange`；`contentHash` 不一致的文件不嵌并计数；`--no-source` 跳过整个阶段。验证：单测——默认烘焙含夹具标记串、`--no-source` 不含；篡改一个文件后该文件的原文不嵌且清点计数为 1。
- [x] 3.4 预算与硬上限：`--source-budget` 默认 64 MB，整段裁剪顺序 `excerpts` → `evidenceText`，裁剪进清点；base64 合计超过 256 MB 具名失败（产物名、所需、上限）。验证：单测 `--source-budget 0` 两段都裁且图计数完整；把硬上限临时改小（测试参数化）触发失败且目标文件不变。
- [x] 3.5 自检与原子写出：写出前用 `bundle-codec.mjs` 的解码侧解一遍核对计数；扫描输出无外部引用、含 CSP；写临时文件后 `rename`；成功时在 stdout 打印一行 JSON 报告（路径、字节数、清点、裁剪、新鲜度、计数）。验证：单测核对报告字段；失败路径不留临时文件。
- [x] 3.6 新鲜度：调用 `skills/excavator/consumer-freshness.mjs` 的导出（或子进程）得到 fresh / stale / missing，写入 `meta` 段与报告。验证：单测对 git 夹具改 HEAD 后报告 `stale` 且仍写出文件。

## 4. 总览、清点与覆盖（切片 A）

- [x] 4.1 页面骨架：解码放在 blob Worker（含 `Worker` 不可用时主线程兜底），主线程收 TypedArray；顶部导航六块；`location.hash` 路由（`#/overview`、`#/node/<id>` 等）；解码后的计数、`window.onerror` 与 CSP 违规计数、解码耗时与总览可交互耗时写进根元素固定的 `data-*` 属性供冒烟读取。验证：`vite dev` 用 `packages/view/fixtures/` 的夹具数据包渲染；夹具由 3.x 对测试夹具生成并提交（不含真实项目内容）。
- [x] 4.2 Overview：项目名、revision、烘焙时间、pipeline 版本、header 计数与解码计数并列、事实层新鲜度横幅、语言环图、成员卡片（多仓库）、语义层徽章（存在 / 未生成 / 过期）；清点区块列出每个产物的状态、裁剪项与未嵌入源码的文件数。验证：夹具页面核对每项文案；Lazy-only 夹具三处显示「未生成」及命令。
- [x] 4.3 Coverage & Gaps：选择漏斗（candidates → selected / filteredByDefaults / filteredByIgnore / sensitive）、按语言堆叠条（parsed / zeroSymbol / 各 skipped 原因）、守恒等式显示；缺口表按 kind 分组，可按 scope 筛选，展示 reason 与 samples；非 `selected` 的 selection entries 表。验证：夹具页面数字与 coverage 记录一致；守恒不成立的夹具显示红色不等式（装置先验）。
- [x] 4.4 冒烟装置 `scripts/view-smoke.mjs`（design D11）：headless Chrome `file://` 打开、经 DevTools 管道轮询 `#root` 到 ready 后读自报计数与错误计数（`--virtual-time-budget` 不等 Worker 线程，已改）；找不到 Chrome 时以可见 skipped 结束；`tests/view/file-smoke.test.mjs` 先对一个故意截断数据段的页面断言装置报红，再对夹具烘焙页断言绿。验证：两条断言都通过；本机 Chrome 存在时不 skip。
- [x] 4.5 切片 A 验收（acceptor）：对 wcp 真实目录烘焙（默认与 `--no-source`），记录大小、耗时、清点；冒烟 O6；分享路径 O10；门禁 O8 中不含 skill 文档的部分。记录写入 tasks.md 本节末尾，截图与报告放仓库外。

切片 A 验收记录（9c276c06，独立 Opus 验收代理，全程只读，报告与截图在仓库外的会话 scratchpad）：通过，无阻塞项。规格符合性审读无编造、无过度实现；O1 dist 无外部引用、恰好一个占位、含 CSP、production 构建；O2–O5 的测试都先用坏输入证明装置会红，`tests/view` 81 个测试通过，并手工复核截断图、缺 manifest、硬上限三种失败都让旧 `view.html` 逐字节不变；wcp 默认烘焙 5,120,131 B / 3.3 s / 峰值 297 MB，`--no-source` 1,827,066 B / 1.1 s，两次默认烘焙只差 `bakedAt`，烘焙前后 `.excavator/` 其余 12 个文件 sha256 不变；O6 六条路由（含深链接、未知 id、reduced-motion、`--no-source` 页）全部 ready、0 错误、0 CSP 违规、计数等于 header，解码 94–187 ms、可交互 171–283 ms；零编造抽查：32 种语言的覆盖数字、38 条缺口按 kind 的计数、漏斗四个数、成员卡片五个数全部回溯到 JSONL 与 manifest；源码开关：代码行、字符串字面量、注释三种标记在默认页解码后都在、`--no-source` 页全部不在；O10 单文件拷到空目录、模拟断网下冒烟通过；无残留监听端口与进程。全量门由派发方跑：根测试 125 文件 2,507 通过 4 skip、core 1,121 通过、typecheck、check-refs、openspec 校验通过。派发方另对 hadoop 实测：默认 56.5 MB / 18.8 s / RSS 1.6 GB，`--no-source` 32.6 MB / 8.4 s / 0.9 GB，两页在 Chrome 里 0.6–1.1 s 可交互、计数等于 header（design D5、O7 已按实测改写）。非阻塞发现六项进任务 4A。

## 4A. 切片 A 验收发现的修复（切片 A）

- [x] 4A.1 index 字面量（source-index 的 comments / strings）从全局字符串表移到独立的 `indexLiterals` 段，纳入 `--source-budget`，裁剪顺序 `excerpts` → `indexLiterals` → `evidenceText`；页面在词项区显示「literals trimmed」状态；FORMAT.md 更新。验证：`--source-budget 0` 三段都裁且 wcp 输出小于 `--no-source` 基线加图组；预算测试覆盖新顺序；往返测试覆盖新段。
- [x] 4A.2 posting 段不再嵌入：页面 Worker 从 chunk 的标识符列重建倒排表；烘焙不再读 source-index 的 posting 记录。验证：标识符搜索的单测结果与重建前相同；hadoop `--no-source` 重测并记录体积（目标 ≤ 20 MB，达不到写明构成）。
- [x] 4A.3 文案：成员卡片改「files in manifest」并并列 selection 的 selected 数；环图中心改「candidate files」。验证：页面模型单测断言两个标签与两个数字来源。
- [x] 4A.4 冒烟脚本退出：先 CDP `Browser.close`，超时再 SIGKILL；跑后 `$TMPDIR` 不新增 Chrome 目录。验证：单测或脚本自检对比跑前跑后的临时目录数。
- [x] 4A.5 O3 补测：缺 manifest 时已有旧 `view.html` 逐字节不变。验证：测试先对「失败后仍写出」的变体红。
- [x] 4A.6 烘焙内存：在 hadoop 上剖析峰值来源（interning、index 对象、evidenceText 字符串、materialize），压低最大的一项，前后数字记入 design D5；外推 1 GB JSONL 不超过 Node 默认堆。验证：hadoop `--no-source` 重测 RSS 记录；单测不变。

## 5. 结构与搜索（切片 B）

- [x] 5.1 Structure：d3-hierarchy squarify 目录 treemap，按 `totalLines` 定大小（缺 fingerprints 时按文件数并标注）、按语言着色、带标签；点击下钻与返回有缩放过渡；文件格子显示符号列表并可跳到节点。验证：夹具页面下钻两层并返回；`totalLines` 缺失夹具显示标注。
- [x] 5.2 Search：名字 / 路径 / id 的子序列匹配（Worker 内建索引）；存在 `index` 段时支持词项精确匹配（posting → chunk → 节点）；结果列表跳转并写 hash。验证：夹具搜一个只在 identifiers 里出现的词命中节点；无 `index` 段时该搜索显示「标识符搜索不可用」。
- [x] 5.3 深链接：`#/node/<id>` 打开定位并展开详情；`#/dir/<path>` 定位 treemap。验证：冒烟脚本带片段打开夹具页，DOM 里详情面板出现该 id。

## 6. 图谱探索与详情（切片 B）

- [x] 6.1 Worker 建 CSR 邻接表（出边、入边，按边类型分段）；目录级与成员级聚合（节点数、边数按类型）。验证：单测对夹具的邻域查询与手算一致。
- [x] 6.2 Graph 视图逐层下钻的节点图：聚合级 d3-force（≤ 400 节点，Canvas 2D）→ 点击目录进入子目录与文件 → 点击文件进入符号层 → 点击符号显示 1–2 跳邻域并开详情；面包屑逐级返回且上一层节点位置不变，层级写入 hash；画布拖拽平移、滚轮与双指缩放、双击背景适配、节点可拖动且松手后保持位置；聚合边带计数、按类型开关、方向粒子；层级切换有过渡，`prefers-reduced-motion` 下直接切换、粒子停止。验证：夹具页面点击目录出现其文件、点击文件出现其符号、面包屑回退；冒烟用 CDP 模拟拖拽、滚轮与点击下钻后读 `data-graph-*` 断言变换与层级（去掉下钻的点击处理后必须红）；hadoop 烘焙页首屏只画聚合节点（O7，验收时记录）。
- [x] 6.3 节点详情面板：事实字段、按类型分组的出入边与证据 file:line、chunk 的 identifiers / comments / strings、跳转到对端；缺 `index` 段时词项区标「不可用」。验证：夹具页面选一个类节点列出全部存在的边类型。
- [x] 6.4 边类型图例与遍历边集合与 `retrieve.mjs` 的确定性边类型一致（contains、imports、exports、calls、inherits、implements、mentions、references、injects）。验证：单测从 `retrieve.mjs` 读边类型集合对照页面常量。

## 7. 证据与源码（切片 B）

- [x] 7.1 证据行原文与节点源码片段渲染（等宽、行号、证据行高亮）；两段任一缺失时对应位置显示「未嵌入源码」并指向清点里的原因（`--no-source` / 预算裁剪 / hash 不一致）。验证：默认烘焙夹具显示原文；`--no-source` 夹具显示占位与原因。
- [x] 7.2 `prefers-reduced-motion` 的基础落地：所有过渡读同一个开关。验证：冒烟脚本以 `--force-prefers-reduced-motion` 打开，DOM 标记为静止模式。
- [x] 7.3 切片 B 验收（acceptor）：wcp 烘焙页的结构、搜索、图谱、详情、证据逐项核对（抽 20 个节点对照源码与 JSONL：边对端、证据行、原文 0 错）；hadoop 烘焙 O7 数字；记录进本节末尾。

切片 B 验收记录（74047706，独立 Opus 验收代理在分离检出里只读核查，报告与截图在仓库外）：有条件通过，一个阻塞项，编造为 0。规格符合性：四层下钻、面包屑、URL 片段、返回后位置不变、拖拽平移、滚轮缩放、双击适配、节点拖动钉住、过渡与 reduced-motion、详情、证据原文、`--no-source` 原因全部符合；双指缩放只审了代码未实测。阻塞项：文件层与邻域层用「前 400 / 最近 400」而不是 D14 的 399 + `more` 桶，连到未索引符号的边既不画也不计数（hadoop `FSNamesystem.java` 460 个符号、同文件内 1,442 条边，页面画 1,140 条、302 条无处可见）。非阻塞：图例每类计数只算画出的链接且未标明（namenode 层 inherits 显示 3、真值 26，某类全被裁时显示 0 并禁用）；邻域层只报未画节点数、不报连到它们的边数；两个变异未被测试抓到（目录层 outsideIn 置 0、文件层 outsideOut 不计数）；冒烟未覆盖双击适配与钉住后保持位置（验收实测补上）。wcp 冒烟 9 条路由全部 ready、0 错误、0 CSP 违规，交互：拖拽 +120/+60、滚轮 k ×1.568、双击回适配、点击 handlers 下钻、hash 返回后 transform 与钉住位置（990）恢复。零编造抽查：20 个节点 142 条证据、603 行片段与源码逐字一致，聚合边 wcp-auth/internal 13 条、v2/internal 53 条、hadoop namenode 861 条与 JSONL 一致，`refreshToken` 名字 8 / 标识符 33 与复算一致，核对器先用 3 处篡改证明能抓。hadoop O7：`--no-source` 16.76 MB / 8.9 s / RSS 735 MB，各路由 ready 339–435 ms，CSR 72–82 ms，首屏 31 / 151 / 400 节点，倒排表在 ready 之后 89 ms。无残留：全部 `chrome.exit=closed`，但 Chrome 另在用户临时目录留下 22 个空的 `com.google.Chrome.chrome_chrome_url_fetcher_.*`，4A.4 覆盖不到。范围外：JS/TS 有 256 条 `imports` 边 `evidence` 为空却标 `extracted`，是事实层缺陷，已另开任务。

## 7A. 切片 B 验收发现的修复（切片 B）

- [x] 7A.1 文件层与邻域层改为与目录层相同的有界规则：最重的 399 项加一个可见的 `more` 桶；连到被收拢符号的边计入可见桶，守恒 `drawn + collapsed + outside = total` 在页面与自报里给出。验证：460 个符号的合成夹具单测断言各桶相加等于总边数（先对「静默 continue」的变体红）；hadoop `FSNamesystem.java` 复跑，1,442 条边全部有去向。
- [x] 7A.2 图例每类显示 `drawn / total`，总数按当前范围内的全部边计，某类有边时开关不禁用。验证：单测与 namenode 层复跑（inherits 显示 3 / 26）。
- [x] 7A.3 邻域层按跳数分配配额（1 跳与 2 跳各有保底，高扇入节点不能占满 400），并报告连到未画节点的边数。验证：合成夹具里一个 500 入度节点的 `?hops=2` 仍能看到 2 跳节点；自报项断言。
- [x] 7A.4 补两条正向断言：目录层 `outsideIn`、文件层 `outsideOut` 的计数来自夹具的已知值。验证：对应变异必须红。
- [x] 7A.5 冒烟脚本启动 Chrome 时设 `TMPDIR=<profile>/tmp` 并随 profile 一起清理；4A.4 的检查扩展到 `chrome_url_fetcher` 目录。验证：跑前跑后用户临时目录里以 `com.google.Chrome.` 开头的目录数不增加（本机其它会话也在跑 Chrome，断言只针对本次 profile 下的 tmp 目录为空且被删除）。

7A 复跑记录（19c40f97）：每层按类型的边账本（drawn / cut / collapsed / inside / fileNode / outside）与独立统计的总数相等并在页面显示等式；hadoop `FSNamesystem.java` 文件层 1,442 条同文件边 = 1,356 画出 + 86 折入 `more`，整层账本 5,232 条全部有去向并与原始 JSONL 的 oracle 一致；namenode 目录层 28,935 条、`Configuration#set` 两跳 24,843 条账本均平衡；图例按范围内全部边计总数（namenode 的 inherits 显示 3 / 47：3 画出 + 23 超链接上限 + 7 在同一项内 + 14 进出范围；验收举例的 26 只算了项间的边，派发方决定用 47，因为它与原始数据可直接对账）；高扇入节点两跳保底 1/4 配额（`Configuration#set` 1 跳 299 / 3,406、2 跳 99 / 16,497）；macOS 下 Chrome 的单例目录与 url_fetcher 目录都不跟随 `TMPDIR`，脚本改为报告 `userTmpLeft`，验收见到的 22 个目录未能复现、来源未明。

## 8. 语义层（切片 C）

- [x] 8.1 Semantics：缓存摘要与标签进节点详情并带新鲜 / 过期徽章；有摘要节点数 / 总数进清点。验证：夹具含两条缓存（一新一旧）各自徽章正确。
- [x] 8.2 layers 与 relations（`semantic-graph.json`）：图谱按层着色与图例，relations 列表；`factDigest` 不符整块标过期。验证：夹具 digest 不符时整块标注且仍可浏览。
- [x] 8.3 领域流（`domain-graph.json`）：领域 → 流程 → 步骤列表，步骤按序播放动画并跳转锚定节点；`sourceRevision` / `factDigest` 不符标过期。验证：夹具含一个两步流程，播放后定位到第二步的节点。

## 9. 拖入目录（切片 C）

- [x] 9.1 页面接受拖入 / 选择 `.excavator/` 目录：在 Worker 里用与烘焙相同的清点规则与流式解析（JSONL 逐行、可选产物）生成同一数据包结构；源码原文一律「未嵌入」。验证：对测试夹具目录，拖入结果的清点与计数等于烘焙结果（单测在 Node 里跑同一解析函数）。
- [x] 9.2 拖入模式的 UI 入口与说明（文件不离开浏览器；拖入与选择两种入口）。验证：headless `--dump-dom` 放不进目录，入口在验收时人工拖入 wcp 的 `.excavator/`，核对清点与计数等于烘焙页（O9）；入口存在性由冒烟脚本断言 DOM 里有 `webkitdirectory` 输入。
- [x] 9.3 拖入目录替换嵌入数据时终止旧的数据 Worker，不泄漏；自报 `data-workers`。验证：替换后断言只有一个活 Worker（C1 遗留，随 7A 一起做）。
- [x] 9.4 拖入目录替换数据时重置图谱状态（CSR 单例与各层级的位置记忆），进度条正常出现，旧位置不会套到新数据上。验证：冒烟替换数据后 `data-csr` 回到未构建并重新构建。

## 10. 动效与隐私（切片 C）

- [x] 10.0 图谱节点视觉语言（design D15）：形状按节点种类、填充按语言色径向渐变、目录与成员节点带语言环与计数徽章、入度刻度；边改二次曲线、箭头与线宽按计数、聚焦模式降噪；标签按缩放分细节层次并带底衬与类型字形；悬停柔光、选中脉冲环、拖动阴影、进入一层时从被点节点交错弹出；画布网格与晕影；深浅主题令牌；`prefers-reduced-motion` 下保留形状颜色、去掉动画；图例同形状。验收建议并入：标签只给最大的约 20 个节点并做碰撞剔除、其余悬停显示；同一对节点的多类型边默认合并为一条带类型分段的边；边透明度按 log 计数；2 跳节点在深色下提高对比度；目录层可选按子目录分簇着色。验证：wcp `wcp-auth/internal` 目录层、一个符号邻域、hadoop namenode 目录层三张截图逐项对照 D15；冒烟读 `data-graph-*` 确认聚焦模式与标签层次切换；页面模型单测断言形状与颜色映射。
- [x] 10.1 动效清单落地：计数器、滚动显现、treemap 缩放、图谱展开过渡、边上粒子、面板切换；每项有一个 `data-motion` 标记，`prefers-reduced-motion` 下全部静止。验证：冒烟脚本两种模式各打开一次，统计 `data-motion` 元素数与静止标记。
- [x] 10.2 CSP 元标签最终形态（`default-src 'none'`；内联脚本与样式；`img-src data:`；`worker-src blob:`）与无网络自检；深色主题与系统字体栈定稿。验证：1.2 的测试断言 CSP 字面；冒烟脚本断言控制台无 CSP 违规。
- [x] 10.3 性能护栏：hadoop 烘焙页打开到总览可交互 ≤ 10 s、图谱首屏 ≤ 400 节点；解码与 CSR 在 Worker。验证：O7 记录。

10.x 落实记录（80f88224）：D15 逐条做到，两处例外——按子目录分簇（D15 里是可选项）未做；邻域层画边上限为 2,000 条而非目录层的 600 条（合并路径后 hadoop 两跳 1,578 条路径每帧 2.1 ms，账本的 cut 桶照常可见，设计 D14 已改为分层上限）。浅色令牌只经 `prefers-color-scheme` 生效，`[data-theme=light]` 只设 `color-scheme`，页面没有主题开关，记为已知。实测（第二次运行）：wcp 目录层每帧 1.3 ms、文件层 0.6 ms、两跳邻域 0.6 ms；hadoop namenode 151 节点 / 600 链接 / 360 粒子每帧 1.35 ms，reduced-motion 下 rAF 空闲、粒子 0；总览可交互 hadoop 455 ms。动效清单六种（counter、graph、graph-particles、panel、reveal、treemap-zoom）在 reduced-motion 下全部静止。

## 11. skill、门禁与文档（切片 C）

- [x] 11.1 新增 `skills/excavator-view/SKILL.md`（英文，frontmatter `name: excavator-view`）：步骤按 design D12，含共享新鲜度助手的固定句式与 `Run \`/excavator\`` 提示；打开器按宿主选择；`--no-open`；外发提醒 `--no-source`。验证：`node scripts/check-refs.mjs` 通过；`tests/skill/excavator/test_skill_graph_freshness.test.mjs` 列表加入 `excavator-view` 后通过。
- [x] 11.2 更新 `tests/skill/excavator/test_service_only_contract.test.mjs`：保留既有禁止项；新增 `packages/view` 与 `skills/excavator-view` 无服务器启动代码与端口的断言；更新 `tests/install/install.test.mjs` 为 11 个 skill。验证：两个测试通过；在 `packages/view` 里临时加 `createServer(` 后契约测试变红（装置先验，不提交）。
- [x] 11.3 skill 预检：模板缺失时 `pnpm --filter @excavator/view build`；`pnpm` 缺失时的提示与 `/excavator` 一致。验证：删除 `dist` 后按 SKILL.md 步骤执行能重建并烘焙。
- [x] 11.4 文档：README 去掉「不发布 HTML 界面」，加 `/excavator-view` 用法；新增 `docs/view.md`（分享方式、浏览器要求、`--no-source`、`--raw`、体积预期、拖入模式）；`docs/mcp.md` 的构建说明提及 view。验证：`pnpm vitest run tests/refs/legacy-literals.test.mjs` 通过；README 与 SKILL.md 的 slash 引用经 check-refs。
- [x] 11.5 `.claude-plugin/plugin.json` 与根 `package.json` 版本号按仓库惯例递增。验证：check-refs 的 manifest 形状检查通过。

11.x 记录（5880a3d2）：skill 全流程按 design D12，新鲜度句式满足读图 skill 契约；service-only 契约测试加「view 包与 skill 下无服务器代码、SKILL.md 无端口 / localhost / dashboard 字样」；安全片段测试覆盖 view 的 SKILL.md；README、docs/view.md、docs/mcp.md 更新，文档不出现客户项目名。11.5 的版本号派发方决定不升：仓库自上游导入后从未升版，`mcp-server.mjs` 与部署夹具硬编码 2.9.6，升版属于维护者的发布决定，不在本变更内。

## 12. 验收与归档

- [x] 12.1 全量门：`pnpm install --frozen-lockfile && pnpm -r build && pnpm test`、`pnpm --filter @excavator/core test`、`pnpm run typecheck`、`node scripts/check-refs.mjs`、`openspec validate --all --strict`。验证：全绿，记录在本节。 记录（5880a3d2，临时检出）：`pnpm install --frozen-lockfile && pnpm -r build && pnpm test` 根测试 134 文件 2,648 通过 4 skip（Windows 专用用例）；`pnpm --filter @excavator/core test` 53 文件 1,121 通过；`pnpm run typecheck`、`node scripts/check-refs.mjs`、`openspec validate --all --strict`（39 / 39）通过。切片内每个中间 commit 都在临时检出里单独验证过（4f285d32、facbdc3e、574c6550、aea4476a、e57607f7、c94014fb 聚焦套件；9c276c06、5aee1f46、daa963d3、74047706、b09cbb5a、19c40f97、80f88224、5880a3d2 全量门）。
- [x] 12.2 验收（acceptor）：O1–O10 逐条；wcp 与 hadoop 的大小、耗时、打开时间；Safari 手动打开一次；截图与报告放仓库外，数字与结论写进本节。

12.2 记录（5880a3d2，独立 Opus 验收代理在分离检出里只读核查，报告与截图在仓库外）：通过，无阻塞项，可开 PR。spec 十条要求逐条符合，service-only 与 consumer-freshness 的修订符合；占位文案在源码、dist 与烘焙页里为零。O1 模板 534,646 B、恰好一个占位、CSP `default-src 'none'`、production React。O2–O5 `tests/view` 16 文件 219 测试通过，每条 oracle 有装置先验，截断图与缺 manifest 两种失败后旧文件 sha 不变。O6 wcp 同一页 13 条路由计数等于 header、0 错误、0 CSP 违规，解码 129 ms / 可交互 229 ms；reduced-motion、`--raw`（22.9 MB）、`--no-source`、深链接、未知 id 通过。O7 hadoop 默认 40.95 MB / 16.8 s / RSS 1.53 GB，`--no-source` 16.88 MB / 8.2 s / 819 MB；`--no-source` 页解码 211 ms / 可交互 333 ms，默认页 584 / 764 ms；namenode 层 151 节点、画 600 / 共 861 链接、每帧 1.26–1.41 ms、CSR 66–68 ms；倒排表在 ready 之后首次搜索时建（83 ms / 2,640 ms）；`FSNamesystem.java` 5,232 条边全部有去向。O9 带三种语义产物的合成项目标注全部正确，hadoop 自带的真实语义缓存显示 1 / 154,531 新鲜；wcp `.excavator/` 经 CDP 放入未烘焙模板后清点、计数、目录层账本与烘焙页一致。O10 单文件拷到空目录、模拟断网下 7 条路由通过，文件内 13 处 `http(s)://` 全是 React 的常量字符串。SKILL.md 手工走查：删 dist 后自动重建；烘焙 4.72 MB fresh；缺图在第 2 步停止、烘焙以 `MissingArtifactError` 失败不写文件；stale 照常烘焙并标 Stale；烘焙前后 wcp `.excavator/` 13 个文件 sha 不变。零编造：分层抽 11 个节点，94 条边、94 条证据原文、81 行源码片段逐字一致，编造 0（空行显示为一个空格属呈现）；两个目录层账本与原始 JSONL 复算一致。无残留：23 次 `chrome.exit=closed`，无进程与端口；Chrome 在用户临时目录留下 13 个空目录属已知行为。未测：Safari / Firefox / Edge、真实鼠标拖放与双指缩放、Codex 宿主与 Linux / Windows 打开器、浅色主题截图、真实语料的硬上限路径、1 GB 级 JSONL。六项非阻塞建议：四项由 13a 修正，非代码库图的提示从设计删去并记为已知局限，版本号不升另开维护任务。
- [ ] 12.3 合并后归档：`openspec archive artifact-view`，同步主 spec（`artifact-view` 新建，`service-only`、`consumer-freshness` 更新），归档 commit。验证：`openspec validate --all --strict` 通过。
