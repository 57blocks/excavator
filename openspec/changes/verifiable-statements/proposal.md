## Why

UA 发布图里 98.8% 的边（imports/contains/exports/calls）是确定性事实，却由模型逐批转写；判断类边 6/10 无源码依据；边没有证据字段、节点 id 没有 owner（wcp 19% 声明坍缩）；验证器只查引用完整性从不触源码；跳过的文件不进覆盖率分母；cosmetic 变更后 commit 标记照样前进。结果是「AI 能否完整了解一个流程」这条首要判据无法被核验。第 ② 步把「事实由脚本写、散文由模型写、每条陈述要么带证据要么标 inferred、每个输入必落一个可见桶」落成 schema、构建器、验证器与账本；后续 cebreo（③）与 MCP/PRD（④）都建在这上面。

## What Changes

- **BREAKING schema**：`GraphEdge` 增 `evidence: Evidence[]` 与 `provenance: 'extracted'|'inferred'`；`GraphNode` 增 `owner?`、`anchorSource?`、`verification?`、`summary` 可为空；顶层增 `coverage`、`gaps[]`；`project` 增 `factsDigest`、`sourceDigest`、`pipelineVersion`、`model`。边 schema 与顶层 schema 加 `.passthrough()`（当前 `validateGraph` 会静默剥掉边上的新字段）。`weight` 保留，文档明说是种类常量。
- **确定性图构建器** `build-facts-graph.mjs`：对全部文件跑结构抽取与 import-map，产出 file/function/class（及 config/document）节点与 contains/imports/exports/calls 边，每条边带行号证据；calls 只在被调用名**唯一**解析到目标时成边，多义与未解析进 `gaps`。两次运行产物逐字节相同，`factsDigest` 相等。
- **身份**：节点 id = `<kind>:<path>:<owner>.<name>`，同文件同 owner 同名冲突时全部追加 `@<startLine>`；owner = Go 接收者 / C# 类 / Kotlin 类或对象 / TS 类或对象字面量 / PHP 类、trait、enum。修 TS 对象字面量方法零函数与 PHP trait/enum/匿名类整块跳过两处抽取器缺陷。
- **模型层改契约**：file-analyzer 不再撰写结构节点与边、不再撰写 id；只对给定 id 产 summary/tags/complexity 与判断类边，判断类边必须给 `evidence:[{file,line}]` 或标 `inferred`。`merge-batch-graphs.py` 改为 `merge-overlays.py`：事实图为底，模型层叠加；与事实重复的边丢弃并计数，缺证据又未标 inferred 的边拒绝并计数，引用不存在 id 的记录拒绝并计数。
- **触源码的验证器** `validate-graph.mjs`：节点锚点行确有该声明；extracted 边的证据行含被调用/被导入的记号，否则降为 `contradicted` 并计数；inferred 边必须已标记；先验装置——注入一条假边与一个错锚点必被报出。
- **summary 核验**：新 agent `excavator-summary-verifier` 带源码片段逐条核对 summary，写回 `verification: verified|unverified|contradicted`；contradicted 的 summary 置空并记 gap。
- **覆盖账本**：scan 的跳过按原因分桶（symlink / read-failed / unknown-language / no-extractor / parse-failed / ignored），extract 的每文件结果带 `status`，import-map 输出 `unresolved`；`coverage` 按语言 × 种类给文件数、解析数、零符号数、跳过数；某语言存在但某种类为零 → `gaps[]` 一条；benchmark 的分母含跳过文件。
- **领域步骤可核验**：domain step 节点必须带 `nodeIds`（⊆ 图）与由其推出的 `evidence`；验证器检查。
- **新鲜度**：内容变了而签名没变（cosmetic）的 SKIP 不再推进 commit 标记；受影响文件节点的 summary 标 `dirty`；四态 fresh|dirty|stale|unknown 保留；非 git 目标 `gitCommitHash` 为空、以 `sourceDigest` 为「对应提交」。

## Capabilities

### New Capabilities
- `evidence-model`: 图的证据/来源/核验/覆盖/摘要字段契约与校验行为
- `facts-graph`: 确定性事实图——普查、身份、带证据的结构边、确定性与 digest
- `graph-validation`: 触源码的验证器、summary 核验、拒绝与降级的账目、先验装置
- `coverage-ledger`: 每个输入落一个可见桶；语言 × 种类覆盖表与 gaps；分母诚实
- `freshness`: 变更分类、commit 标记只随重推导前进、dirty 标记

### Modified Capabilities
（无：新增 agent `excavator-summary-verifier` 与删除 `excavator-assemble-reviewer` 不改变 `plugin-identity` 的任何 requirement；`data-directory`、`reference-integrity` 沿用）

## Impact

- 改 `packages/core/src/{types,schema,fingerprint,change-classifier}.ts`、两处抽取器、`scan-project.mjs`、`extract-import-map.mjs`、`extract-structure*.mjs`、`finalize-incremental.mjs`、`merge-batch-graphs.py`（→ `merge-overlays.py`）、`skills/excavator/SKILL.md` 各阶段、`agents/excavator-file-analyzer.md`、新 agent、`scripts/lib/large-repo-benchmark.mjs`、dashboard 对空 summary 的显示。
- 节点数上升：事实图普查全部声明，不再按「10 行以上」筛选；wcp 预计 function 节点从 4,261 升至接近声明总数 3,497（Go）+ TS 全量；模型只为有 summary 的节点写散文。
- 模型输出量下降约 98%（不再转写结构），新增一遍 summary 核验；wcp 全量成本与时间对基线（65+60 分钟）的实测进验收报告。
- 两个 PR、一个 change：②a 确定性半（schema、账本、抽取器、构建器、验证器），②b 模型半（overlay 契约、merge、核验 agent、新鲜度、领域步骤、真实全量）。
- Non-goals：不加语言与框架规则抽取（③）；不建 MCP（④）；dashboard 只保证不破、显示空 summary 的节点名，不做证据视图（§6）。
