## Context

**方向（用户 2026-09-11，两次收敛）**：UA 的流水线逻辑已经过验证，**先不改它已有行为的语义**；excavator 只作补充——能注册为插件的走 UA 的插件口，其余作为合并之后的附加阶段；往 UA 文件里**加**内容可以（新提示词小节、新输出字段、新分支、新注册行），**改**已有输出的样子不行（id 格式、合并去重、增量分类、已有边的产生方式）。图的作者仍是模型（file-analyzer），脚本负责给事实、记账、审计与验证。判据：UA 今天的产物经过任一新增阶段后仍原样通过；新增阶段只加字段、加节点/边（标来源）、加计数，不删不改模型写的内容。

盘点事实（只读，文件名按第 ① 步改名后）：
- `packages/core/src/types.ts`：`GraphNode{id,type,name,filePath?,lineRange?,summary,tags,complexity,…}`、`GraphEdge{source,target,type,direction,description?,weight}`；`StructuralAnalysis.functions[]` 已有 `owner?`；`CallGraphEntry{caller,callee,lineNumber}`；`AnalyzerPlugin{name,languages[],analyzeFile,resolveImports?,extractCallGraph?,analyzeFileFull?}`（:219-236），`PluginRegistry` 一语言一插件、后注册者生效。
- `schema.ts`：node schema 有 `.passthrough()`，edge/root 原本没有（②a commit 1 已补；commit `c70d66bb` 把强制锚点/证据校验降级为导出的 `auditGraphShape`）。
- 脚本：`scan-project.mjs` 无按原因分桶、无二进制/超大检测（②a commit 2 已加 `skipped[{path,reason}]`、`coverage.limits`）；`extract-import-map.mjs` 用 `registry.analyzeFile` 取原始 imports，解析走脚本自带的各语言解析器，**不经** `resolveImports`，未解析静默省略（commit 2 已加 `unresolved`）；`extract-structure.mjs` 失败文件从 `results` 消失（commit 2 已加每文件 `status`）；`registry.register(tsPlugin); registerAllParsers(registry)` 是唯一注册点。
- 模型层：file-analyzer 撰写全部节点/边与 id，calls「infer from imports + function names when confident」，权重按种类常数；`merge-batch-graphs.py` 按 id 去重保后者、边按 (source,target,type,direction) 去重取高权重、悬挂边丢弃计数。graph-reviewer 与 assemble-reviewer 都不触源码；domain-analyzer 只读知识图，step 无 `nodeIds`。
- 增量：`finalize-incremental.mjs:408-421,481-482` 在 cosmetic SKIP 上推进 commit 标记；`prepare-incremental.mjs` 在非 git 根上 `fatal`（wcp 父目录复现）；`staleness.ts` 四态。
- wcp 真实图：7,611 节点 / 24,460 边（imports 13,474、contains 5,627、exports 4,335、calls 739 全为 function→function）；Go 声明 3,497 → 节点 2,825（同文件同名不同接收者合并）。dashboard 用 `weight` 排 `flow_step`。

## Goals / Non-Goals

**Goals:** 每条边有 `provenance` 与可核证据；每个 summary 有核验状态；每个输入落可见桶；审计与验证器先用注入样本证明看得见；UA 产物原样通过。
**Non-Goals:** 改 UA 的 id 格式、合并规则、增量分类、抽取器行为（存分支 `v2/deferred-ua-extractor-fixes`）；框架规则（③）；MCP（④）；dashboard 证据视图。

## Decisions

**D1 Schema（已落地，`e273080a` + `c70d66bb`）**：边 `evidence?: Evidence[]`、`provenance?: 'extracted'|'inferred'`、`verification?`、`addedBy?`；节点 `owner?`、`owners?`、`anchorSource?`、`verification?: 'verified'|'unverified'|'contradicted'|'dirty'`；根 `coverage?`、`gaps?`；`project` 增 `sourceDigest?`、`factsDigest?`、`pipelineVersion?`、`model?`、`verification?`，`gitCommitHash: string|null`。全部可选，边与根 `.passthrough()`。强制锚点/证据规则由 `auditGraphShape(graph)` 报告（codes：`missing-file-anchor`、`missing-line-anchor`、`edge-without-provenance`、`extracted-edge-without-evidence`、`extracted-edge-without-nonmodel-evidence`、`inferred-edge-with-nonmodel-evidence`），`validateGraph` 不拒绝。`weight` 保留为种类常量。

**D2 账本（已落地，`58f8c7f9`）**：`scan-project.mjs` 增 `skipped[{path,reason}]`（symlink / read-failed / unknown-language / binary / too-large / ignored）与 `coverage.limits`；`extract-structure` 每文件 `status: parsed|zero-symbol|no-extractor|parse-failed`；`extract-import-map` 增 `unresolved`；`coverage-ledger.mjs` 纯折叠 + `conservationViolations()`。都是加字段。

**D3 结构全量抽取（新增确定性子阶段 1.2）**：对 scan 标为 code 的全部文件调用既有 `extract-structure.mjs`（不改它）产 `intermediate/structure-all.json`，供审计与 ③ 使用；koel 实测秒级。

**D4 annotate-graph（合并后附加阶段 2.3）** `skills/excavator/annotate-graph.mjs`，输入 UA 的 `assembled-graph.json` + `structure-all.json` + scan/import-map + `coverage-ledger`：
- 边标注：模型边能在抽取事实里找到对应记录（imports ↔ import-map 与 `imports[].line`；exports ↔ `exports[].lineNumber`；contains ↔ 目标声明 `lineRange[0]`；calls ↔ caller 文件 `callGraph[]` 中同名 callee 的调用点）→ `provenance:'extracted'` + `evidence[{file,line,source:'tree-sitter'|'import-map'}]`；找不到 → `provenance:'inferred'`、evidence 空，计 `edge-auto-inferred`（按类型）。模型自报的 evidence（②b 提示词加节后出现）逐条核对：一致 → 保留并 `verified:true`；不一致 → 以抽取事实为准写入并计 `evidence-corrected`。**模型边一条不删。**
- 审计计数进 `gaps`：`edge-missing`（抽取事实有、图无；imports/exports/contains 全量比对，calls 只比对同文件唯一解析的调用点）、`node-missing`、`node-unsupported`、`identity-collision`（同文件同名不同 owner 被合成一个节点：节点加 `owners:[…]`，计数，**不改 id**）、`shape-issue`（`auditGraphShape` 的 issues）。
- 节点补字段：`owner`、`anchorSource`（function/class → `tree-sitter`；file/config/document → `census`）。
- `coverage`（折叠账本）、`gaps`、`project.sourceDigest`（scan `contentDigest`）、`project.factsDigest`（`structure-all.json` + import-map 规范化 sha256）、`project.pipelineVersion`。
- 可选补边（默认开，`--no-supplement` 关）：`edge-missing` 里 imports/exports/contains 三类**追加**为边，`provenance:'extracted'`、`addedBy:'excavator-annotate'`；calls 不补，留缺口。
- 输出 `intermediate/annotated-graph.json` + `intermediate/audit.json`；同输入两次运行相同。
替代方案「脚本建图替代模型」已被用户否决（召回优先）。

**D5 validate-graph（附加阶段 6b，UA 的 inline validator 与阶段 6 保留）** `skills/excavator/validate-graph.mjs`：读源码。锚点：function/class 节点 `lineRange[0]` ±1 行含 `name`，否则 `anchor-mismatch` + 节点 `verification:'contradicted'`；`extracted` 边证据行含期望记号（calls 的 callee、imports 的目标模块段或 specifier、exports 的符号名、contains 的声明），否则边 `verification:'contradicted'` + `edge-contradicted`；模型自报 `source:'model'` 的判断边证据行须含两端任一 name 或文件名；inferred 已标记即通过；沿用 inline validator 的全部引用完整性检查；`step` 节点须有 `nodeIds` ⊆ 图或 `provenance:'inferred'`，否则 `step-unanchored`。输出 `intermediate/validation.json` 并把计数并入 gaps。**先验装置**：夹具图注入一条证据行不含 callee 的 calls 边与一个 lineRange 偏移 5 行的节点 → `edge-contradicted`=1、`anchor-mismatch`=1；干净夹具 0/0。合入门槛。

**D6 提示词加节（②b，只加不改）**：`agents/excavator-file-analyzer.md` 末尾新增「证据字段」（每条边附 `evidence:[{file,line,source:'model'}]`，行号抄自结构 JSON；抄不到标 `provenance:'inferred'`）与「框架指引」（scan 报告的 frameworks 含 spring/angular/maui 时先读 `skills/excavator/frameworks/<x>.md`；文件由 ③ 提供）；`agents/excavator-domain-analyzer.md` 新增一句「每个 step 给 `nodeIds`（图中真实 id）；给不出则省略」。既有段落一字不改。

**D7 summary 核验（②b，附加阶段 2.5，可 `--no-verify`）**：新 agent `agents/excavator-summary-verifier.md`：输入批次 `{id,filePath,lineRange,summary}` + 只读源码，输出 `verified|unverified|contradicted` + 一句理由；`skills/excavator/apply-verification.mjs` 写回 `verification`，**不清空** summary（留给 ④ 消费端按 `verification` 决定），contradicted 存 `intermediate/contradicted-summaries.json` 并计 `summary-contradicted`；`project.verification = full|sample:n|skipped`。

**D8 新鲜度（②b）**：不改 UA 的 commit 标记逻辑。annotate 从 fingerprints 算 cosmetic dirty 文件写进 `meta.json.excavator.dirtyFiles` 与受影响节点 `verification:'dirty'`。`prepare-incremental.mjs` **新增** git 不可用时的回退分支（fingerprints contentHash 求变更集，不再 fatal；git 可用时行为不变）。非 git 目标 `project.gitCommitHash=null`，`sourceDigest` 承担版本。

**D9 领域步骤（②b）**：`skills/excavator-domain/annotate-domain.mjs` 为 step 节点推导 `nodeIds`（filePath + lineRange 交集匹配图节点）与 `evidence`；D6 的提示词加句是首选来源、推导是兜底。

**D10 编排与两 PR**：SKILL.md 只**新增**阶段 1.2 STRUCTURE-ALL、2.3 ANNOTATE、2.5 VERIFY、6b VALIDATE，既有阶段不动。②a = commits 1–7（schema、账本、[抽取器修复已存分支]、结构全量、annotate、validate、bench+docs）；②b = commits 8–12。

## Commit plan（分支 `v2/step2a-facts`，每个 commit 单独绿；已落地：1 `e273080a`、2 `58f8c7f9`、3 `4d2350e2` 已 revert `a93a3f1c` 并存分支、3' `c70d66bb` 软化）

4. `feat(structure-all): deterministic full-project structural extraction as phase 1.2 (calls existing extract-structure)`
5. `feat(annotate): annotate-graph — provenance/evidence from extractor facts, audit counts, owner/collision report, coverage/gaps/digests, optional supplement edges`
6. `feat(validate): validate-graph — source-touching checks as added phase 6b; instrument test`
7. `fix(bench+docs): coverage denominator; SKILL.md additive phases; docs/v2-plan §3 rewrite`
②b（分支 `v2/step2b-verify`）：8 提示词加节；9 summary-verifier + apply-verification；10 新鲜度可见性 + 非 git 回退；11 annotate-domain；12 dashboard 回退 + docs。

## Acceptance oracle（②a）

| # | 判据 | 方法 |
|---|---|---|
| a1 | 先验装置 | 注入假边 + 错锚点夹具：`edge-contradicted`=1、`anchor-mismatch`=1；干净夹具 0/0 |
| a2 | 确定性 | wcp 与 cebreo 两目标各跑两次 structure-all + annotate：`annotated-graph.json` 与 `audit.json` sha256 相等 |
| a3 | 身份可见 | wcp：`identity-collision` 计数与样本进报告（量级对照 3,497 − 2,825） |
| a4 | 归属 | 图中 100% 边有 `provenance`；`extracted` 边 100% 有 evidence；`edge-auto-inferred`、补边数、`edge-missing` 按类型进报告 |
| a5 | 账本 | cebreo `coverage.byLanguage` 含 html/xaml 为 `no-extractor`；`gaps` 含 `imports-unresolved` 等计数 |
| a6 | 三件套 | `pnpm -r build` 先于其他门；`pnpm test`、core、typecheck、check-refs 0 fail；用例只增 |
| a7 | **UA 产物原样通过** | 对 wcp 现有 `.excavator/knowledge-graph.json`（UA 产）跑 `validateGraph` 与 annotate：0 节点/0 边被删；annotate 前后模型写的字段逐条相同 |

②b：b1 提示词加节后模型自报 evidence 的 `verified:true` 比例与 `evidence-corrected` 计数；b2 Opus 分层审计 10 条 summary + 30 条边中 verified/extracted 类 0 条错；b3 注入测试（往批次输出加一条无证据边 → annotate 标 inferred 并计数）；b4 负向探针「撤销申请」；b5 cosmetic 变更 → dirty 可见且 UA 标记行为不变；非 git 目标增量不 fatal；b6 wcp 全量墙钟与批次 token 对基线 65+60 分钟；b7 三件套 + check-refs。

## Risks / Trade-offs

- [模型边归属靠事后匹配，间接调用大量 inferred] → 设计意图（召回优先、可见性其次）；`edge-auto-inferred` 分布进报告，③ 用规则补框架约定。
- [补边与模型边重复] → 只补 `edge-missing`，去重键与 UA 合并一致。
- [文本匹配锚点误报] → 只查声明行 ±1 且要求含 name；样本进报告。
- [revert 中间 commit 单独不绿] → `a93a3f1c` 单独看构建红、`c70d66bb` 修复；写进 PR 说明，不重写历史。
- [验证器成本] → 秒级；summary 核验默认全量，`--no-verify`/抽样可选，成本进 b6。

## Migration Plan

无外部用户。UA 产物与流程不变；新增阶段可单独关闭。回滚按 commit / PR。抽取器修复留 `v2/deferred-ua-extractor-fixes` 等单独批准。
