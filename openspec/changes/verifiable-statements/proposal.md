## Why

UA 发布图里 98.8% 的边是确定性种类（imports/contains/exports/calls），全部由模型转写且**没有证据字段**；判断类边抽样 6/10 无源码依据；节点 id 无 owner（wcp 19% 声明坍缩）；验证器只查引用完整性从不触源码；跳过的文件不进覆盖率分母；cosmetic 变更后 commit 标记照样前进。结果是「AI 能否完整了解一个流程」这条首要判据无法被核验。用户方向（2026-09-11）：UA 的逻辑已经过验证，**先不改它已有行为的语义**，图的作者仍是模型；excavator 作为补充——往 UA 文件里加内容可以，改已有输出的样子不行。本步据此把「每条边有来源与可核证据、每个 summary 有核验状态、每个输入落可见桶」做成合并之后的附加阶段与只加不改的提示词小节。

## What Changes

- **Schema（已落地）**：边 `evidence?`/`provenance?`/`verification?`/`addedBy?`；节点 `owner?`/`owners?`/`anchorSource?`/`verification?`；根 `coverage?`/`gaps?`；`project` 增 `sourceDigest`/`factsDigest`/`pipelineVersion`/`model`/`verification`，`gitCommitHash` 可空。全部可选；边与根 `.passthrough()`（原先 `validateGraph` 会剥掉边上的新字段）；强制锚点/证据规则由 `auditGraphShape` 报告而不是拒绝。`weight` 保留为种类常量。
- **账本（已落地）**：scan 跳过按原因分桶（symlink / read-failed / unknown-language / binary / too-large / ignored）；extract 每文件 `status`；import-map `unresolved`；`coverage-ledger` 守恒折叠。
- **结构全量抽取**（新阶段 1.2）：对全部 code 文件跑既有 `extract-structure`，产 `structure-all.json` 供审计与 ③。
- **annotate-graph**（新阶段 2.3，合并后）：给模型边标 `provenance` 与 evidence（匹配抽取事实）、核对模型自报证据、审计（`edge-missing` / `node-missing` / `node-unsupported` / `identity-collision` / `shape-issue`）、补 `owner`/`anchorSource`、写 `coverage`/`gaps`/digest；可选补充模型漏掉的 imports/exports/contains 边（标 `addedBy`）；**不删不改模型内容**。
- **validate-graph**（新阶段 6b，UA 的 inline validator 保留）：触源码核对锚点与证据行，标 `contradicted` 并计数；先验装置——注入假边与错锚点必被报出。
- **提示词只加不改**（②b）：file-analyzer 末尾加「证据字段」与「框架指引」两节；domain-analyzer 加一句 step `nodeIds`。
- **summary 核验**（②b，新阶段 2.5，可关）：`excavator-summary-verifier` 带源码逐条核对，写回 `verification`，不清空正文。
- **新鲜度可见**（②b）：cosmetic dirty 文件与节点标注；`prepare-incremental` 新增 git 不可用回退分支；UA 的 commit 标记逻辑不动。
- **领域步骤**（②b）：`annotate-domain` 推导 step `nodeIds` 与 evidence。
- **不做、存分支**：抽取器修复（`v2/deferred-ua-extractor-fixes`）；owner 进 id；overlay 契约与合并拒绝逻辑；cosmetic SKIP 修复；脚本建图。

## Capabilities

### New Capabilities
- `evidence-model`: 图的证据/来源/核验/覆盖/摘要字段契约与形状审计
- `facts-audit`: 结构事实交给模型、事后审计模型图（多出/漏掉/行号不符/身份冲突可见）、可选补边、确定性审计报告
- `graph-validation`: 触源码的验证器、summary 核验状态、先验装置、领域步骤锚定
- `coverage-ledger`: 每个输入落一个可见桶；语言 × 种类覆盖表与 gaps；分母诚实
- `freshness`: cosmetic 变更可见、非 git 目标可增量并以 sourceDigest 为版本

### Modified Capabilities
（无：新增 agent `excavator-summary-verifier` 不改 `plugin-identity` 的 requirement；`data-directory`、`reference-integrity` 沿用）

## Impact

- 只加文件与阶段：`skills/excavator/{structure-all,annotate-graph,validate-graph,apply-verification}.mjs`、`skills/excavator-domain/annotate-domain.mjs`、`agents/excavator-summary-verifier.md`、SKILL.md 四个新增阶段、两份 agent 提示词末尾各一节、`prepare-incremental.mjs` 一个回退分支、benchmark 分母。UA 既有阶段、提示词段落、抽取器、合并语义、id 格式不动。
- 成本与 UA 基线同量级；新增结构全量抽取与审计（秒级）、summary 核验（模型，可关）；实测进 ②b 报告。
- 两个 PR、一个 change：②a 确定性半（commits 1–7），②b 模型半（8–12 + 真实全量）。
- Non-goals：框架规则与新语言插件（③）；MCP（④）；dashboard 证据视图。
