提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入；每个切片独立可测、可交付；一 coder 一 acceptor，验收 oracle 见 design.md）：

0. `docs(openspec): propose artifact-view`：proposal、design、规格增量、tasks。
1. `build(view): scaffold packages/view single-file template`：任务 1.1–1.3。
2. `feat(view): columnar bundle codec`：任务 2.1–2.3。
3. `feat(skill): streaming view bake with inventory, freshness, budget and self-checks`：任务 3.1–3.6。
4. `feat(view): overview, inventory, freshness and coverage sections`：任务 4.1–4.4。
5. `docs(openspec): record artifact-view slice A acceptance`：任务 4.5。
5a. `fix(view): slice A acceptance fixes`：任务 4A.1–4A.6（验收发现，design D13）。
6. `feat(view): structure treemap and search`：任务 5.1–5.3。
7. `feat(view): graph explorer and node detail`：任务 6.1–6.4。
8. `feat(view): evidence text and source excerpts`：任务 7.1–7.2。
9. `docs(openspec): record artifact-view slice B acceptance`：任务 7.3。
10. `feat(view): semantic layers when present`：任务 8.1–8.3。
11. `feat(view): drag-and-drop data directory`：任务 9.1–9.2。
12. `feat(view): motion pass, reduced motion and CSP`：任务 10.1–10.3。
13. `feat(skill): excavator-view skill, opener, gates and docs`：任务 11.1–11.5。
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

- [ ] 4A.1 index 字面量（source-index 的 comments / strings）从全局字符串表移到独立的 `indexLiterals` 段，纳入 `--source-budget`，裁剪顺序 `excerpts` → `indexLiterals` → `evidenceText`；页面在词项区显示「literals trimmed」状态；FORMAT.md 更新。验证：`--source-budget 0` 三段都裁且 wcp 输出小于 `--no-source` 基线加图组；预算测试覆盖新顺序；往返测试覆盖新段。
- [ ] 4A.2 posting 段不再嵌入：页面 Worker 从 chunk 的标识符列重建倒排表；烘焙不再读 source-index 的 posting 记录。验证：标识符搜索的单测结果与重建前相同；hadoop `--no-source` 重测并记录体积（目标 ≤ 20 MB，达不到写明构成）。
- [ ] 4A.3 文案：成员卡片改「files in manifest」并并列 selection 的 selected 数；环图中心改「candidate files」。验证：页面模型单测断言两个标签与两个数字来源。
- [ ] 4A.4 冒烟脚本退出：先 CDP `Browser.close`，超时再 SIGKILL；跑后 `$TMPDIR` 不新增 Chrome 目录。验证：单测或脚本自检对比跑前跑后的临时目录数。
- [ ] 4A.5 O3 补测：缺 manifest 时已有旧 `view.html` 逐字节不变。验证：测试先对「失败后仍写出」的变体红。
- [ ] 4A.6 烘焙内存：在 hadoop 上剖析峰值来源（interning、index 对象、evidenceText 字符串、materialize），压低最大的一项，前后数字记入 design D5；外推 1 GB JSONL 不超过 Node 默认堆。验证：hadoop `--no-source` 重测 RSS 记录；单测不变。

## 5. 结构与搜索（切片 B）

- [ ] 5.1 Structure：d3-hierarchy squarify 目录 treemap，按 `totalLines` 定大小（缺 fingerprints 时按文件数并标注）、按语言着色、带标签；点击下钻与返回有缩放过渡；文件格子显示符号列表并可跳到节点。验证：夹具页面下钻两层并返回；`totalLines` 缺失夹具显示标注。
- [ ] 5.2 Search：名字 / 路径 / id 的子序列匹配（Worker 内建索引）；存在 `index` 段时支持词项精确匹配（posting → chunk → 节点）；结果列表跳转并写 hash。验证：夹具搜一个只在 identifiers 里出现的词命中节点；无 `index` 段时该搜索显示「标识符搜索不可用」。
- [ ] 5.3 深链接：`#/node/<id>` 打开定位并展开详情；`#/dir/<path>` 定位 treemap。验证：冒烟脚本带片段打开夹具页，DOM 里详情面板出现该 id。

## 6. 图谱探索与详情（切片 B）

- [ ] 6.1 Worker 建 CSR 邻接表（出边、入边，按边类型分段）；目录级与成员级聚合（节点数、边数按类型）。验证：单测对夹具的邻域查询与手算一致。
- [ ] 6.2 Graph 视图三级：聚合级 d3-force（≤ 400 节点，Canvas 2D）、展开目录后的文件级、选中节点的 1–2 跳邻域；聚合边带计数、按类型开关、方向粒子；展开 / 收起有过渡。验证：夹具页面展开一个目录出现其文件；hadoop 烘焙页首屏只画聚合节点（O7，验收时记录）。
- [ ] 6.3 节点详情面板：事实字段、按类型分组的出入边与证据 file:line、chunk 的 identifiers / comments / strings、跳转到对端；缺 `index` 段时词项区标「不可用」。验证：夹具页面选一个类节点列出全部存在的边类型。
- [ ] 6.4 边类型图例与遍历边集合与 `retrieve.mjs` 的确定性边类型一致（contains、imports、exports、calls、inherits、implements、mentions、references、injects）。验证：单测从 `retrieve.mjs` 读边类型集合对照页面常量。

## 7. 证据与源码（切片 B）

- [ ] 7.1 证据行原文与节点源码片段渲染（等宽、行号、证据行高亮）；两段任一缺失时对应位置显示「未嵌入源码」并指向清点里的原因（`--no-source` / 预算裁剪 / hash 不一致）。验证：默认烘焙夹具显示原文；`--no-source` 夹具显示占位与原因。
- [ ] 7.2 `prefers-reduced-motion` 的基础落地：所有过渡读同一个开关。验证：冒烟脚本以 `--force-prefers-reduced-motion` 打开，DOM 标记为静止模式。
- [ ] 7.3 切片 B 验收（acceptor）：wcp 烘焙页的结构、搜索、图谱、详情、证据逐项核对（抽 20 个节点对照源码与 JSONL：边对端、证据行、原文 0 错）；hadoop 烘焙 O7 数字；记录进本节末尾。

## 8. 语义层（切片 C）

- [ ] 8.1 Semantics：缓存摘要与标签进节点详情并带新鲜 / 过期徽章；有摘要节点数 / 总数进清点。验证：夹具含两条缓存（一新一旧）各自徽章正确。
- [ ] 8.2 layers 与 relations（`semantic-graph.json`）：图谱按层着色与图例，relations 列表；`factDigest` 不符整块标过期。验证：夹具 digest 不符时整块标注且仍可浏览。
- [ ] 8.3 领域流（`domain-graph.json`）：领域 → 流程 → 步骤列表，步骤按序播放动画并跳转锚定节点；`sourceRevision` / `factDigest` 不符标过期。验证：夹具含一个两步流程，播放后定位到第二步的节点。

## 9. 拖入目录（切片 C）

- [ ] 9.1 页面接受拖入 / 选择 `.excavator/` 目录：在 Worker 里用与烘焙相同的清点规则与流式解析（JSONL 逐行、可选产物）生成同一数据包结构；源码原文一律「未嵌入」。验证：对测试夹具目录，拖入结果的清点与计数等于烘焙结果（单测在 Node 里跑同一解析函数）。
- [ ] 9.2 拖入模式的 UI 入口与说明（文件不离开浏览器；拖入与选择两种入口）。验证：headless `--dump-dom` 放不进目录，入口在验收时人工拖入 wcp 的 `.excavator/`，核对清点与计数等于烘焙页（O9）；入口存在性由冒烟脚本断言 DOM 里有 `webkitdirectory` 输入。

## 10. 动效与隐私（切片 C）

- [ ] 10.1 动效清单落地：计数器、滚动显现、treemap 缩放、图谱展开过渡、边上粒子、面板切换；每项有一个 `data-motion` 标记，`prefers-reduced-motion` 下全部静止。验证：冒烟脚本两种模式各打开一次，统计 `data-motion` 元素数与静止标记。
- [ ] 10.2 CSP 元标签最终形态（`default-src 'none'`；内联脚本与样式；`img-src data:`；`worker-src blob:`）与无网络自检；深色主题与系统字体栈定稿。验证：1.2 的测试断言 CSP 字面；冒烟脚本断言控制台无 CSP 违规。
- [ ] 10.3 性能护栏：hadoop 烘焙页打开到总览可交互 ≤ 10 s、图谱首屏 ≤ 400 节点；解码与 CSR 在 Worker。验证：O7 记录。

## 11. skill、门禁与文档（切片 C）

- [ ] 11.1 新增 `skills/excavator-view/SKILL.md`（英文，frontmatter `name: excavator-view`）：步骤按 design D12，含共享新鲜度助手的固定句式与 `Run \`/excavator\`` 提示；打开器按宿主选择；`--no-open`；外发提醒 `--no-source`。验证：`node scripts/check-refs.mjs` 通过；`tests/skill/excavator/test_skill_graph_freshness.test.mjs` 列表加入 `excavator-view` 后通过。
- [ ] 11.2 更新 `tests/skill/excavator/test_service_only_contract.test.mjs`：保留既有禁止项；新增 `packages/view` 与 `skills/excavator-view` 无服务器启动代码与端口的断言；更新 `tests/install/install.test.mjs` 为 11 个 skill。验证：两个测试通过；在 `packages/view` 里临时加 `createServer(` 后契约测试变红（装置先验，不提交）。
- [ ] 11.3 skill 预检：模板缺失时 `pnpm --filter @excavator/view build`；`pnpm` 缺失时的提示与 `/excavator` 一致。验证：删除 `dist` 后按 SKILL.md 步骤执行能重建并烘焙。
- [ ] 11.4 文档：README 去掉「不发布 HTML 界面」，加 `/excavator-view` 用法；新增 `docs/view.md`（分享方式、浏览器要求、`--no-source`、`--raw`、体积预期、拖入模式）；`docs/mcp.md` 的构建说明提及 view。验证：`pnpm vitest run tests/refs/legacy-literals.test.mjs` 通过；README 与 SKILL.md 的 slash 引用经 check-refs。
- [ ] 11.5 `.claude-plugin/plugin.json` 与根 `package.json` 版本号按仓库惯例递增。验证：check-refs 的 manifest 形状检查通过。

## 12. 验收与归档

- [ ] 12.1 全量门：`pnpm install --frozen-lockfile && pnpm -r build && pnpm test`、`pnpm --filter @excavator/core test`、`pnpm run typecheck`、`node scripts/check-refs.mjs`、`openspec validate --all --strict`。验证：全绿，记录在本节。
- [ ] 12.2 验收（acceptor）：O1–O10 逐条；wcp 与 hadoop 的大小、耗时、打开时间；Safari 手动打开一次；截图与报告放仓库外，数字与结论写进本节。
- [ ] 12.3 合并后归档：`openspec archive artifact-view`，同步主 spec（`artifact-view` 新建，`service-only`、`consumer-freshness` 更新），归档 commit。验证：`openspec validate --all --strict` 通过。
