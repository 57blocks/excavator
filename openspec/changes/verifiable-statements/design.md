## Context

只读盘点（2026-09-10）确认的现状，文件名按第 ① 步改名后写：
- `packages/core/src/types.ts`：`GraphNode{id,type,name,filePath?,lineRange?,summary,tags,complexity,…}`、`GraphEdge{source,target,type,direction,description?,weight}`、`KnowledgeGraph{version,kind?,project,nodes,edges,layers,tour}`、`ProjectMeta{name,languages,frameworks,description,analyzedAt,gitCommitHash}`。`StructuralAnalysis.functions[]` 已有 `owner?: string|null`（types.ts:185-206）但从未进 id；`CallGraphEntry{caller,callee,lineNumber}` 只有裸名无解析目标。
- `schema.ts`：`GraphNodeSchema` 有 `.passthrough()`（:440），**`GraphEdgeSchema`（:442-449）与 `KnowledgeGraphSchema`（:475-483）没有**——`validateGraph` 会剥掉边上任何新字段；重建路径（:717-724）丢 `kind`。
- 确定性脚本：`scan-project.mjs` 输出 `{files[{path,language,sizeLines,fileCategory}],failures[{path,stage}],filteredByIgnore,contentDigest,…}`，无按原因分桶，无二进制/超大检测，未知语言以 `language:"unknown"` 保留；git 可选（无 git 走递归遍历）。`extract-import-map.mjs` 输出 `importMap[path]=[resolved…]`，未解析的静默省略。`extract-structure.mjs` 输出 `results[]` 每文件 `{path,language,functions?,classes?,imports?,exports?,callGraph?,…}`，失败文件从 `results` 消失只留计数。`compute-batches.mjs` Louvain 分批 + `neighborMap`。
- 模型层：`excavator-file-analyzer` 撰写全部节点/边与 id（prefix 表），calls 边「infer from imports + function names when confident」，权重按种类常数；`merge-batch-graphs.py` 按 id 去重保后者、边按 (source,target,type,direction) 去重取高权重、悬挂边丢弃计数、无 schema 校验。graph-reviewer 与 assemble-reviewer 都不触源码。domain-analyzer 只读知识图，step 节点无 `nodeIds`，`lineRange` 常为整个处理函数跨度。
- 增量：`FileFingerprint{filePath,contentHash,functions,classes,imports,exports,totalLines,hasStructuralAnalysis}`；`classifyUpdate` → SKIP / PARTIAL_UPDATE / ARCHITECTURE_UPDATE / FULL_UPDATE；`finalize-incremental.mjs:408-421,481-482` 在普通 SKIP 上把 `project.gitCommitHash` 与 `meta.json.gitCommitHash` 推到 HEAD；`staleness.ts` 四态 fresh/dirty/stale/unknown 基于 git。
- `symbol-coverage.ts` 只被 `validate-incremental-symbols.mjs` 用，不进发布图；`COVERAGE_LANGUAGES` 排除 PHP/Java/Kotlin/C#/Swift/Scala/Dart。
- wcp 真实图：7,611 节点 / 24,460 边；calls 739 条全是 function→function；`weight` 每种类唯一值；dashboard 用 `weight` 给 `flow_step` 排序、给 NodeInfo 排序，读 summary/filePath/lineRange/tags/complexity/description/direction。

## Goals / Non-Goals

**Goals:**
- 结构事实零模型：节点、结构边、锚点、覆盖表全部由脚本产出且可复现（digest 相等）。
- 每条边可归因：`provenance` + `evidence`；每个 summary 可核验：`verification`。
- 每个输入可见：扫描到的每个文件落 parsed / zero-symbol / skipped(reason) 之一，未解析的 import/call 落 gap。
- 验证器先证明自己看得见（注入假样本必红），再用来验图。

**Non-Goals:**
- 不做框架规则抽取（endpoint/table/guard）——③；不做 MCP——④；不做 dashboard 证据视图——§6。
- 不做旧 `.ua` 图迁移；wcp 在 v2 上重新全量一次。

## Decisions

**D1 Evidence 与 provenance 字段**
```ts
type EvidenceSource = 'tree-sitter' | 'import-map' | 'rule' | 'model';
interface Evidence { file: string; line: number; endLine?: number; source: EvidenceSource; text?: string }
interface GraphEdge { source; target; type; direction; description?; weight; evidence: Evidence[]; provenance: 'extracted' | 'inferred' }
interface GraphNode { …; owner?: string; anchorSource?: 'tree-sitter' | 'rule' | 'census'; summary: string /* 可为空 */; verification?: 'verified' | 'unverified' | 'contradicted' | 'dirty' }
interface KnowledgeGraph { …; coverage: Coverage; gaps: Gap[] }
interface ProjectMeta { …; gitCommitHash: string | null; sourceDigest: string; factsDigest: string; pipelineVersion: string; model: string }
interface Gap { kind: string; scope: string; reason: string; count: number; samples?: string[] }
```
约束：`provenance:'inferred'` 的边不得携带 `source ≠ 'model'` 的 evidence；`provenance:'extracted'` 的边必须至少一条 evidence 且 `source ≠ 'model'`。`weight` 保留并在 types.ts 注释「种类常量，用于排序，不是置信度」，因为 dashboard 用它排 `flow_step`。schema：边与顶层加 `.passthrough()`，并为 `evidence/provenance/coverage/gaps` 写显式 zod 字段；function/class 节点 `filePath`、`lineRange` 用 `superRefine` 按 type 必填，file 节点 `filePath` 必填。`validateGraph` 的重建路径保留 `kind`、`coverage`、`gaps`。替代方案：只靠 passthrough 不写字段——否决，字段不校验等于没有契约。

**D2 身份**：id = `<kind>:<path>:<qualified>`，`qualified = owner ? owner + '.' + name : name`；同一文件内 `qualified` 重复（重载、多接收者同名已由 owner 区分，剩下的重复是真重载或重复声明）时**该组全部**追加 `@<startLine>`。owner 取自抽取器：Go 接收者类型（去 `*`）、C#/Kotlin/Java/PHP 外层类/trait/enum/object、TS/JS 类名或对象字面量绑定名、匿名类用 `anon@<line>`。理由：plan §3.3 写的是一律带 `@startLine`，但那会让每次行号漂移都换 id，summary 与 verification 全部失效；只在冲突时加行号，99% 的 id 跨增量稳定，冲突组仍然唯一。守恒检查：抽取器声明总数 = function+class 节点数（wcp 用 `collapse.out.txt` 的 3,497 对照）。夹具：两个内容相同路径不同的文件；同名不同接收者的方法；同一类里两个重载；匿名类；TS `const api = { list() {}, get: () => {} }`；PHP trait/enum。

**D3 事实图构建器** `skills/excavator/build-facts-graph.mjs`：输入 `scan-result.json`、`import-map.json`、对全部文件的 `extract-structure` 结果（新增一次全量结构抽取到 `intermediate/structure-all.json`，koel 实测 9 秒级）。产出 `intermediate/facts-graph.json`：
- 节点：每个扫描文件一个 `file:`（或按 fileCategory 的 `config:`/`document:`）节点，`anchorSource:'census'`；每个函数/方法 `function:` 节点、每个类/接口/trait/enum `class:` 节点，`lineRange` 来自抽取器，`anchorSource:'tree-sitter'`，`summary:''`。
- 边：`contains`（file→function/class，class→method；evidence = 目标声明行，source tree-sitter）；`imports`（file→file，来自 import-map，evidence = `StructuralAnalysis.imports[].lineNumber`，source import-map）；`exports`（file→符号节点，evidence = `exports[].lineNumber`）；`calls`（function→function：callee 名先在同文件解析，再在该文件 imports 到的文件的 exports/functions 里解析；**恰好一个候选**才成边，evidence = `callGraph[].lineNumber`；0 个候选 → gap `calls-unresolved`，>1 → gap `calls-ambiguous`，各按语言计数并留样本）。不猜边。
- `coverage` 与 `gaps` 见 D6；`project.factsDigest` = 规范化 JSON（键排序、数组按 id/边键排序）的 sha256；`sourceDigest` = scan 的 `contentDigest`。
- 确定性：同一输入两次运行 `facts-graph.json` 逐字节相同（测试）。
替代方案：让 file-analyzer 继续转写但强制引用行号——否决，模型转写 24k 条边本身就是成本与编造源。

**D4 模型层 overlay 契约**：批次输入 = 该批文件的事实子图（节点 id、name、lineRange、owner、contains/imports/exports/calls 边摘要）+ `neighborMap` + 源码路径。`excavator-file-analyzer` 输出 `intermediate/overlay-<batch>.json`：
```json
{ "summaries": [{ "id": "<facts node id>", "summary": "...", "tags": [...], "complexity": "simple", "languageNotes?": "..." }],
  "edges": [{ "source": "<id>", "target": "<id>", "type": "related|depends_on|validates|reads_from|writes_to|configures|tested_by|documents|…", "evidence": [{ "file": "...", "line": 12, "source": "model", "text?": "..." }], "provenance": "extracted|inferred", "description?": "..." }],
  "skipped": [{ "id": "<id>", "reason": "trivial|unreadable|not-in-batch" }] }
```
规则写进提示词：不得创造 id；不得输出 imports/contains/exports/calls 四类边（事实图已有）；判断类边要么给真实 `file:line` 证据（`source:'model'` 表示是模型指认的行，验证器会去核对该行确有相关记号），要么标 `inferred`；summary 只描述该节点 `lineRange` 内的代码。摘要范围沿用 UA 的显著性门槛（10 行以上、导出、2 方法以上的类），其余节点保持 `summary:''` 并在 `skipped` 里给 `trivial`——「未写」可见，不是「没有」。
`merge-overlays.py`（重写自 `merge-batch-graphs.py`）：以 `facts-graph.json` 为底；summaries 按 id 附着，id 不存在 → 拒绝计数 `overlay-unknown-id`；edges：若 (source,target,type) 与事实边重复 → 丢弃计数 `overlay-duplicate-fact`；`provenance:'extracted'` 且 evidence 为空或 source 全为 model 以外 → 拒绝计数 `overlay-missing-evidence`；`provenance:'inferred'` 带非 model evidence → 拒绝；端点不存在 → 拒绝 `overlay-dangling`。所有计数进 `gaps[]`（kind=`overlay-rejected`, reason 细分）。输出 `intermediate/assembled-graph.json`。

**D5 验证器** `skills/excavator/validate-graph.mjs`（零模型）：输入 assembled graph + 源码根（多仓时为各子仓根）。
1. 锚点：每个 function/class 节点，读 `filePath` 第 `lineRange[0]` 行（容差 ±1），文本必须含 `name`（匿名类除外，检查 `class` 关键字）；失败 → `gaps` `anchor-mismatch` + 节点 `verification:'contradicted'`。
2. extracted 边：读 evidence 行，`calls` 须含 callee name，`imports` 须含目标文件名/模块段或 specifier，`exports` 须含符号名，`contains` 须为目标声明行；失败 → 边降为 `provenance:'contradicted'`? 不引入第三种 provenance——改为边保留、加 `verification:'contradicted'`（边级字段），并计数 `edge-contradicted`；contradicted 边不进 MCP 的正向回答（④）。
3. 模型边：`provenance:'extracted'` 且 evidence.source='model' 的判断类边，证据行必须同时含 source 与 target 任一节点的 name 或其文件名——否则 `contradicted`。
4. inferred 边：已标记即通过；无 evidence 且非 inferred → 拒绝（merge 应已拦，此处双保险计数）。
5. 引用完整性：沿用旧 inline validator 的全部检查（节点必填、悬挂边、layer/tour 引用、重复 id）。
6. 领域步骤：`step` 节点必须有 `nodeIds` ⊆ 图且非空，`evidence` = 这些节点的锚点；缺 → `step-unanchored` gap。
输出 `intermediate/validation.json`（每类计数 + 样本）并把 gaps 合并进图。**先验装置**：测试用夹具图注入一条指向不存在行号记号的 calls 边与一个 lineRange 错位 5 行的节点，验证器必须分别报 `edge-contradicted` 与 `anchor-mismatch`，各恰好 1；再对未注入的夹具图跑一次必须 0。这是 PR 合入门槛。
替代方案：用 tree-sitter 重新解析核对声明——更强但慢且需 grammar；先用文本匹配（容差 ±1 行），tree-sitter 复核留给 ③ 的规则层。

**D6 覆盖账本**：`scan-project.mjs` 输出增 `skipped: [{path, reason}]`，reason ∈ {symlink, read-failed, unknown-language, binary, too-large, ignored}（ignored 来自 ignore-filter 命中，含步 ① 新增的 agent/数据目录；binary = 已知二进制扩展名或前 8KB 含 NUL 字节——第 ① 步冒烟在 cebreo/unmc 看到 `.dll` 被当文件扫入，1,266 个跳过里大半是二进制与标记文件；too-large = 超过 `MAX_FILE_LINES`（默认 20,000）或 `MAX_FILE_BYTES`（默认 2 MB），阈值写在脚本顶部常量并进 `coverage.limits`）；`extract-structure` 每文件结果增 `status: 'parsed'|'zero-symbol'|'no-extractor'|'parse-failed'`，失败文件不再从 `results` 消失；`extract-import-map` 输出增 `unresolved: {path: [specifier…]}`。`build-facts-graph` 汇总为
```ts
interface Coverage { files: number; byLanguage: Record<lang, { files; parsed; zeroSymbol; skipped: Record<reason, number>; kinds: Record<'function'|'class'|'import'|'export'|'call', number> }>; ignored: number }
```
gaps 规则：某语言 `files>0` 且 `parsed=0` → `no-extractor`（如 .html/.xaml/.vue）；`unresolved` 按语言计数 → `imports-unresolved`；calls 见 D3。`scripts/lib/large-repo-benchmark.mjs` 的 `structureCoverage` 分母改为 `parsed + zeroSymbol + skipped`。没有第四态：`files = parsed + zeroSymbol + Σskipped` 用测试断言守恒。

**D7 summary 核验**：新 agent `agents/excavator-summary-verifier.md`：输入 = 一批 `{id, filePath, lineRange, summary}` + 只读源码；对每条输出 `verified`（summary 的每个可核事实在 lineRange 内有对应代码）| `unverified`（无法判定/超出片段）| `contradicted`（与代码相反或描述不存在的行为）+ 一句理由。SKILL.md 新阶段 2.5「VERIFY」在 merge 之后、architecture 之前，按批派发（干净上下文，与 file-analyzer 分离）；脚本 `apply-verification.mjs` 写回 `verification`，contradicted 的 summary 置空、原文与理由存 `intermediate/contradicted-summaries.json`、gap `summary-contradicted` 计数。默认全量核验（零编造是硬指标）；`--verify-sample <n>` 可选抽样，运行时记录在 `project.verification = 'full'|'sample:n'`。成本进验收报告。
替代方案：让 file-analyzer 自己标 verified——否决，同一上下文自证无效（text-gates-cannot-catch-misattribution）。

**D8 新鲜度**：`finalize-incremental.mjs` SKIP 路径：若任一文件 `contentHash` 变化（cosmetic），不推进 `project.gitCommitHash` 与 `meta.json.gitCommitHash`，改写 `meta.json.baseline = { commit: <旧>, dirtyFiles: [...] }`，并把这些文件的 file 节点及其 contains 子节点 `verification:'dirty'`；只有 PARTIAL/ARCHITECTURE/FULL 重推导后才推进标记。`staleness.ts` 四态保留；非 git 目标 → `unknown` 且 reason `no-git`，`project.gitCommitHash=null`，`sourceDigest` 承担「对应提交」。**`prepare-incremental.mjs` 在非 git 根上目前直接 `fatal: not a git repository`（第 ① 步冒烟在 wcp 父目录复现）**：改为 git 不可用时走 contentHash 对比（fingerprints 里已有每文件 contentHash），变更集 = hash 不同的文件 ∪ 新增 ∪ 删除；多仓父目录（wcp）与非 git 目录（cebreo）都必须能增量。测试：改一处 `if` 阈值（签名不变）→ 受影响节点 dirty 且标记不动；改一个函数签名 → PARTIAL 且标记前进；非 git 夹具改一个文件 → 变更集恰为该文件。

**D9 领域步骤**：`excavator-domain-analyzer` 提示词要求每个 step 给 `nodeIds`（图中真实 id，≥1）；`extract-domain-context.py` 输出中附带候选 id；`lineRange` 改为由 `nodeIds` 的锚点并集推出（脚本算，不让模型写）；无法定位的 step 允许 `nodeIds:[]` 但必须 `provenance:'inferred'`，验证器计 `step-unanchored`。

**D10 阶段编排**（`skills/excavator/SKILL.md`）：0 preflight → 0.5 ignore → 1 SCAN（脚本，不再经 project-scanner agent 转述）→ 1.2 STRUCTURE-ALL（`extract-structure` 全量）→ 1.3 FACTS（`build-facts-graph`）→ 1.5 BATCH → 2 ANALYZE（file-analyzer ×N 产 overlay）→ 2.2 MERGE（`merge-overlays.py`）→ 2.5 VERIFY（summary-verifier ×N + `apply-verification`）→ 4 ARCHITECTURE → 5 TOUR → 6 VALIDATE（`validate-graph.mjs`，替换 inline validator；`--review` 仍可加 graph-reviewer）→ 7 SAVE（图 + fingerprints + meta，`project.model` 取宿主报告的模型名，取不到写 `unknown`）。assemble-reviewer 的职责（找回丢失 id、补跨批 imports）在事实图为底后不再需要，agent 删除，名字从 check-refs 的期望里去掉。

**D11 dashboard**：空 summary 显示节点名与「未摘要」标签；`verification` 与 `provenance` 不渲染（§6）；`validateGraph` 通过含新字段的图（测试）。

**D12 两个 PR、一个 change**：②a = commit 1–6（schema、账本、抽取器与身份、构建器、验证器、benchmark）——无模型可全测；②b = commit 7–11（overlay 契约与 merge、summary-verifier 与写回、新鲜度、领域步骤、编排与 dashboard）——验收含 wcp 真实全量。理由：确定性半独立可交付且是模型半的测试基座；真实全量成本高，只在 ②b 末尾跑一次。

## Commit plan（分支 `v2/step2a-facts` 与 `v2/step2b-overlay`，每个 commit 单独绿）

②a：
1. `feat(schema): evidence/provenance/verification/coverage/gaps/digests; edge+root passthrough; per-type required anchors`——D1 + 测试（旧图样例经 `validateGraph` 仍通过；新字段不被剥）。
2. `feat(ledger): scan skipped-by-reason, extract per-file status, import-map unresolved`——D6 前半 + 守恒测试。
3. `fix(extractors): TS object-literal methods, PHP trait/enum/anonymous class, owner for Go/C#/Kotlin/TS/PHP`——D2 抽取侧 + 夹具。
4. `feat(facts): build-facts-graph — census nodes, qualified ids, evidenced structural edges, unique-match calls, coverage, gaps, factsDigest`——D3 + 确定性测试 + 守恒测试（声明数 = 节点数）。
5. `feat(validate): validate-graph — anchors, evidence lines, inferred discipline, referential integrity; instrument test`——D5 + 先验装置测试。
6. `fix(bench): coverage denominator includes skipped; docs/v2-plan §3 amendments (id rule, two PRs)`.
②b：
7. `feat(overlay): file-analyzer overlay contract; merge-overlays.py with rejection accounting`——D4 + merge 测试（unknown-id / duplicate-fact / missing-evidence / dangling 各一）。
8. `feat(verify): excavator-summary-verifier agent; apply-verification.mjs write-back; contradicted handling`——D7 + 写回测试。
9. `fix(freshness): cosmetic SKIP keeps commit marker, marks dirty; non-git sourceDigest`——D8 + 测试。
10. `feat(domain): steps carry nodeIds + derived evidence; validator step-unanchored`——D9。
11. `refactor(pipeline): SKILL.md phases 1.2/1.3/2.2/2.5/6; remove assemble-reviewer; dashboard empty-summary; project.model`——D10 + D11 + check-refs 期望更新。

## Acceptance oracle（动手前写死；Opus acceptor 逐条复测）

②a（无模型）：
| # | 判据 | 方法 |
|---|---|---|
| a1 | 先验装置 | 注入假边 + 错锚点的夹具：验证器报 `edge-contradicted`=1、`anchor-mismatch`=1；干净夹具 0/0 |
| a2 | 确定性 | wcp 与 cebreo 各跑两次 `build-facts-graph`，`facts-graph.json` sha256 相等、`factsDigest` 相等 |
| a3 | 守恒 | wcp：Go 声明数（抽取器 functions+classes 计数）= Go function+class 节点数；对照 `collapse.out.txt` 3,497（坍缩 0）；每语言 `files = parsed + zeroSymbol + Σskipped` |
| a4 | 边证据 | 事实图 100% 边 `provenance:'extracted'` 且 evidence ≥1；验证器对 wcp 事实边 `edge-contradicted` = 0（若 >0 逐条列出并归因） |
| a5 | 账本 | cebreo `coverage.byLanguage` 含 html(622)/xaml(128) 为 `no-extractor`；`gaps` 含 `calls-unresolved`/`calls-ambiguous`/`imports-unresolved` 各语言计数 |
| a6 | 三件套 | `pnpm install --frozen-lockfile && pnpm -r build && pnpm test && pnpm typecheck` 0 fail；用例数只增不减 |
| a7 | 旧图兼容 | 旧格式图样例（dashboard `public/knowledge-graph.json`）经 `validateGraph` 仍通过；新字段图经 dashboard 加载不报错 |

②b（含真实运行，wcp）：
| # | 判据 | 方法 |
|---|---|---|
| b1 | 边 100% 有归属 | 最终图每条边 `provenance ∈ {extracted, inferred}`；extracted 边 evidence ≥1；inferred 边 evidence 全为 model 或空 |
| b2 | 拒绝可见 | `gaps` 含 `overlay-*` 各计数；无静默丢弃（merge 日志计数 = gaps 计数） |
| b3 | Opus 分层审计 | 抽 10 条 summary（含 5 条 verified）+ 30 条边（全部 depends_on + 随机 related + 10 条 calls）；verified/extracted 类 0 条错；错的必须已被标 contradicted/unverified/inferred |
| b4 | 注入被抓 | 在 overlay 里手工加一条无证据边与一条错 id summary，merge 拒绝计数各 +1 |
| b5 | 负向探针 | 「撤销申请」：普查 + 验证器给出「代码无撤销入口（scope 已覆盖）」或「有，在 file:line」 |
| b6 | 新鲜度 | 改一处 `if` 阈值 → 受影响节点 dirty、`gitCommitHash` 不动；改签名 → PARTIAL 且前进 |
| b7 | 领域步骤 | wcp 请假域 4 流程全部 step 有 `nodeIds` ⊆ 图；`step-unanchored` 计数报告 |
| b8 | 成本与时间 | wcp 全量墙钟、批次 token（若宿主可得）对基线 65+60 分钟；summary 核验的额外成本单列 |
| b9 | 三件套 + check-refs | 0 fail；assemble-reviewer 删除后 check-refs 绿 |

## Risks / Trade-offs

- [calls 唯一匹配太严，召回下降] → 召回是软指标；`calls-ambiguous` 样本进报告，③ 用规则/类型信息再提升。
- [全量 summary 核验成本] → 先量后决；`--verify-sample` 兜底且运行方式写进 `project.verification`。
- [id 不带行号在冲突组之外仍可能与增量改名冲突] → `qualified` 变化即新节点、旧节点删除，符合「身份变了就是新东西」。
- [文本匹配锚点误报（同名多次出现）] → 只查声明行 ±1 且要求含 name 记号；误报进 `anchor-mismatch` 样本，acceptor 抽查。
- [dashboard 假设 summary 非空] → D11 + 测试。
- [真实全量需要宿主派 subagent] → 由 Opus acceptor 按 SKILL.md 充当宿主跑一次；若 `claude --plugin-dir` 可用则优先用真实宿主（Open Question）。

## Migration Plan

无外部用户。wcp 在 ②b 后重新全量；旧 `.excavator/`（改名自 `.ua`）在跑前移走保留为对照。回滚 = revert 对应 commit / PR。

## Open Questions

- 真实全量的运行方式：`claude -p --plugin-dir` 是否可用于无人值守运行插件（不改 spec，只改验收操作）。
- `project.model` 的来源：宿主是否暴露模型名（取不到写 `unknown`，已在 spec）。
