## 1. Schema（②a commit 1）

- [x] 1.1 `packages/core/src/types.ts`：加 `Evidence`、`EvidenceSource`、`Gap`、`Coverage`；`GraphEdge.evidence/provenance`；`GraphNode.owner?/anchorSource?/verification?`、`summary` 允许空串；`ProjectMeta.gitCommitHash: string|null` + `sourceDigest/factsDigest/pipelineVersion/model`；`KnowledgeGraph.coverage/gaps`；`weight` 注释为种类常量；验证 `pnpm typecheck` 绿
- [x] 1.2 `packages/core/src/schema.ts`：显式 zod 字段 + 边与顶层 `.passthrough()`；`superRefine` 使 function/class 节点 `filePath`/`lineRange` 必填、file 节点 `filePath` 必填；重建路径保留 `kind/coverage/gaps`；验证新测试：含 `evidence` 的边经 `validateGraph` 后字段仍在；缺 lineRange 的 function 节点被报错
- [x] 1.3 兼容测试：dashboard `public/knowledge-graph.json` 样例与 `wcp-quality/clean-room` 形状的旧图（合成缩样）经 `validateGraph` 通过并得到 `coverage`/`gaps` 默认空值；验证 core 测试绿

## 2. 账本（②a commit 2）

- [x] 2.1 `skills/excavator/scan-project.mjs`：输出 `skipped:[{path,reason}]`（symlink / read-failed / unknown-language / binary / too-large / ignored）与 `coverage.limits`；binary 判定 = 已知扩展名或前 8KB 含 NUL；too-large 阈值为脚本顶部常量；验证夹具含符号链接、不可读文件、`.xyz` 未知扩展名、一个 `.dll`、一个超阈值文件、`.claude/` 文件，各落对应桶
- [x] 2.2 `skills/excavator/extract-structure*.mjs`：每文件 `status: parsed|zero-symbol|no-extractor|parse-failed`，失败文件保留在 `results`；验证夹具含语法错误文件与 `.html` 文件
- [x] 2.3 `skills/excavator/extract-import-map.mjs`：输出 `unresolved:{path:[specifier]}`；验证夹具含一个外部包 import 与一个错误相对路径 import
- [x] 2.4 守恒测试：对夹具 `files = parsed + zeroSymbol + Σskipped`；验证测试绿

## 3. 抽取器与身份（②a commit 3）

- [x] 3.1 `typescript-extractor.ts` `extractVariableDeclarations`：递归对象字面量，方法与箭头属性成函数，`owner` = 绑定名；类方法 `owner` = 类名；验证夹具 `const api = { list() {}, get: () => {} }` 产 2 函数 owner `api`
- [x] 3.2 `php-extractor.ts` `walkStatements`：加 `trait_declaration`、`enum_declaration`、匿名类（`object_creation_expression` 内 class body）case，方法 `owner` = trait/enum 名或 `anon@<line>`；验证夹具三种各产方法
- [x] 3.3 Go/C#/Kotlin/Java 抽取器 `owner` 填充复核（Go 接收者去 `*`、C#/Kotlin/Java 外层类/object）；验证夹具：同文件 `func (a *A) Save()` 与 `func (b *B) Save()` 两个函数 owner 不同
- [x] 3.4 身份夹具集 `tests/fixtures/identity/`：同内容不同路径两个文件、同名不同 owner、同类两个重载、匿名类；验证为后续构建器测试可用

## 4. 事实图构建器（②a commit 4）

- [ ] 4.1 `skills/excavator/build-facts-graph.mjs`：节点（file/config/document 按 fileCategory；function/class 按抽取器）、id 规则（`<kind>:<path>:<owner>.<name>`，同文件冲突组追加 `@<startLine>`）、`anchorSource`；验证身份夹具：4 个场景节点数与 id 形态符合 design D2
- [ ] 4.2 边：contains / imports / exports 带行号 evidence；calls 唯一匹配成边，0 候选 → `calls-unresolved`，多候选 → `calls-ambiguous`；验证夹具：一次唯一调用成边、一次多义进 gap、一次未解析进 gap
- [ ] 4.3 `coverage`（按语言：files/parsed/zeroSymbol/skipped{reason}/kinds）、`gaps`（`no-extractor`、`imports-unresolved`、calls 两类）、`project.sourceDigest/factsDigest/pipelineVersion`；验证守恒断言与 `no-extractor` 在含 `.html` 夹具上出现
- [ ] 4.4 确定性测试：同输入两次运行输出逐字节相同；验证测试绿
- [ ] 4.5 守恒测试：夹具抽取器声明总数 = function+class 节点数；验证测试绿

## 5. 验证器（②a commit 5）

- [ ] 5.1 `skills/excavator/validate-graph.mjs`：锚点核对（±1 行含 name）、extracted 边证据行记号核对（calls/imports/exports/contains 各自规则）、模型边证据行核对、inferred 纪律、引用完整性（迁移旧 inline validator 全部检查）、step `nodeIds` 检查；输出 `validation.json` 并合并 gaps；验证对干净夹具图 0 finding
- [ ] 5.2 **先验装置测试**：夹具图注入指向错误行的 calls 边与 lineRange 错位 5 行的节点 → `edge-contradicted`=1、`anchor-mismatch`=1，且输出点名边与节点；验证测试绿（此项不绿不得合入）
- [ ] 5.3 SKILL.md 阶段 6 改为调用 `validate-graph.mjs`（inline validator 代码块删除）；验证 check-refs 绿

## 6. Benchmark 与文档（②a commit 6）

- [ ] 6.1 `scripts/lib/large-repo-benchmark.mjs` `structureCoverage` 分母 = parsed + zeroSymbol + skipped；验证既有 benchmark 测试更新后绿
- [ ] 6.2 `docs/v2-plan.md` §3 增补：id 规则（冲突才加行号）、两个 PR、验收表；验证 `pnpm typecheck` 绿
- [ ] 6.3 ②a 冒烟（不提交）：wcp 与 cebreo 各跑 scan → structure-all → facts → validate 两次；贴 a2/a3/a4/a5 数字进 PR

## 7. Overlay 契约与合并（②b commit 7）

- [ ] 7.1 `agents/excavator-file-analyzer.md` 重写为 overlay 契约（design D4）：输入事实子图，输出 summaries/edges/skipped，禁止创造 id 与四类结构边；验证提示词含「不得输出 imports/contains/exports/calls」与证据规则
- [ ] 7.2 `skills/excavator/merge-overlays.py`（替换 `merge-batch-graphs.py`）：事实图为底；unknown-id / duplicate-fact / missing-evidence / inferred-with-non-model-evidence / dangling 五类拒绝各计数进 `gaps`；验证单元测试每类一例 + 合法叠加一例
- [ ] 7.3 SKILL.md 阶段 1.2/1.3/2/2.2 改写（结构全量 → 事实图 → 分批 overlay → merge）；验证 check-refs 绿、`tests/skill/*` 更新后绿

## 8. Summary 核验（②b commit 8）

- [ ] 8.1 `agents/excavator-summary-verifier.md`：输入批次 `{id,filePath,lineRange,summary}` + 源码，输出 `verified|unverified|contradicted` + 理由；验证提示词只允许三态
- [ ] 8.2 `skills/excavator/apply-verification.mjs`：写回 `verification`，contradicted 置空 summary、存 `contradicted-summaries.json`、gap `summary-contradicted`；`project.verification = full|sample:n`；验证单元测试三态写回与置空
- [ ] 8.3 SKILL.md 阶段 2.5 VERIFY（干净上下文，按批派发，`--verify-sample <n>` 可选）；验证 check-refs 绿

## 9. 新鲜度（②b commit 9）

- [ ] 9.1 `finalize-incremental.mjs` SKIP 路径：内容变化则不推进 `project.gitCommitHash`/`meta.json.gitCommitHash`，写 `meta.json.baseline{commit,dirtyFiles}`，受影响 file 节点及 contains 子节点 `verification:'dirty'`；验证测试：改 `if` 阈值 → dirty 且标记不动
- [ ] 9.2 PARTIAL/ARCHITECTURE/FULL 后推进标记；非 git 目标 `gitCommitHash=null`、`staleness` → `unknown/no-git`；验证测试：改签名 → PARTIAL 且前进；非 git 夹具 → unknown
- [ ] 9.3 `prepare-incremental.mjs`：git 不可用（非 git 根或多仓父目录）时以 fingerprints 的 contentHash 对比求变更集，不再 fatal；验证非 git 夹具改一个文件 → 变更集恰为该文件；对 wcp 父目录实跑不报 `not a git repository`

## 10. 领域步骤（②b commit 10）

- [ ] 10.1 `agents/excavator-domain-analyzer.md` 要求 step `nodeIds`（≥1 真实 id）或 `provenance:'inferred'`；`extract-domain-context.py` 输出候选 id；验证提示词与脚本输出含 id
- [ ] 10.2 `skills/excavator-domain/` 后处理脚本：`lineRange` 由 `nodeIds` 锚点并集推出、`evidence` 生成；验证单元测试
- [ ] 10.3 `validate-graph.mjs` 对 domain graph 的 `step-unanchored` 检查；验证夹具

## 11. 编排、dashboard、清理（②b commit 11）

- [ ] 11.1 删除 `agents/excavator-assemble-reviewer.md` 与 SKILL.md 阶段 3；check-refs 期望更新；验证 check-refs 绿
- [ ] 11.2 `project.model` 取宿主模型名（取不到 `unknown`）；`pipelineVersion` 常量；验证 SAVE 阶段写入
- [ ] 11.3 dashboard：空 summary 显示节点名 + 「未摘要」；`validateGraph` 含新字段的图加载不报错；验证 dashboard 测试绿
- [ ] 11.4 `docs/v2-plan.md` §3 收尾，并新增「follow-ups」小节记录：`excavator-knowledge`/`excavator-figma` 仍用 `<SKILL_DIR>` 占位（第 ① 步接受的偏离）、cebreo 默认忽略是否补 `bin/`（③ 普查时定）；验证三件套绿

## 12. ②b 真实验收（不提交；结果贴 PR）

- [ ] 12.1 wcp 在 v2 上全量一次（旧 `.excavator/` 先移作对照）；记录墙钟、批次数、summary 核验耗时；验证 b1/b2/b7/b8
- [ ] 12.2 Opus 分层审计 10 条 summary + 30 条边（b3）；注入测试（b4）；负向探针「撤销申请」（b5）；新鲜度实操（b6）
