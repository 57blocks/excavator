## 1. Schema（②a commit 1，已落地 `e273080a` + 软化 `c70d66bb`）

- [x] 1.1 `types.ts`：`Evidence`、`Gap`、`Coverage`；边 `evidence?/provenance?/verification?/addedBy?`；节点 `owner?/owners?/anchorSource?/verification?`；`ProjectMeta` 增 digest/version/model，`gitCommitHash: string|null`；根 `coverage?/gaps?`；验证 `pnpm typecheck` 绿
- [x] 1.2 `schema.ts`：显式 zod 字段 + 边与根 `.passthrough()`；强制锚点/证据规则改为导出的 `auditGraphShape`，`validateGraph` 不拒绝 UA 产物（修订：按用户 2026-09-11 方向）；验证 UA 形状旧图通过、新字段不被剥、`auditGraphShape` 报六类 issue
- [x] 1.3 兼容测试：dashboard 样例与 UA 形状缩样经 `validateGraph` 通过；验证 core 测试绿

## 2. 账本（②a commit 2，已落地 `58f8c7f9`）

- [x] 2.1 `scan-project.mjs` `skipped[{path,reason}]`（symlink / read-failed / unknown-language / binary / too-large / ignored）与 `coverage.limits`；验证夹具各落对应桶
- [x] 2.2 `extract-structure*.mjs` 每文件 `status`，失败文件保留；验证夹具含语法错误与 `.html`
- [x] 2.3 `extract-import-map.mjs` `unresolved`；验证夹具含外部包与错误相对路径
- [x] 2.4 `coverage-ledger.mjs` 守恒 `files = parsed + zeroSymbol + Σskipped`；验证测试绿

## 3. 抽取器修复（已实现后 revert `a93a3f1c`，存分支 `v2/deferred-ua-extractor-fixes` 等单独批准）

- [ ] 3.1 （暂不做）TS 对象字面量方法与 owner
- [ ] 3.2 （暂不做）PHP trait/enum/匿名类
- [ ] 3.3 （暂不做）Go/C#/Kotlin/Java owner 复核
- [ ] 3.4 （暂不做）身份夹具集

## 4. 结构全量抽取（②a commit 4）

- [x] 4.1 `skills/excavator/structure-all.mjs`：对 scan 标为 code 的全部文件调用既有 `extract-structure.mjs`（不改它），合并为 `intermediate/structure-all.json`（含每文件 `status`、`imports[].line`、`callGraph`）；验证合成项目产物覆盖全部 code 文件且两次运行相同
- [x] 4.2 SKILL.md 新增阶段 1.2 STRUCTURE-ALL（只加，不改既有阶段）；验证 check-refs 绿

## 5. annotate-graph（②a commit 5）

- [x] 5.1 `skills/excavator/annotate-graph.mjs` 边标注：匹配抽取事实 → `extracted` + evidence；否则 `inferred` + `edge-auto-inferred` 计数；模型自报 evidence 核对（`verified:true` / `evidence-corrected`）；验证合成 UA 风格图夹具：四类边各一条匹配、一条不匹配
- [x] 5.2 审计计数：`edge-missing`、`node-missing`、`node-unsupported`、`identity-collision`（节点加 `owners`，不改 id）、`shape-issue`；验证夹具每类各计一
- [x] 5.3 节点补 `owner`/`anchorSource`；`coverage`（折叠账本）、`gaps`、`project.sourceDigest/factsDigest/pipelineVersion`；验证字段存在且守恒断言绿
- [x] 5.4 可选补边（默认开，`--no-supplement` 关）：`edge-missing` 的 imports/exports/contains 追加为边 `addedBy:'excavator-annotate'`；calls 不补；验证开/关两例
- [x] 5.5 不删不改模型内容：对夹具 UA 图 annotate 前后模型写的字段逐条相同；验证测试绿
- [x] 5.6 确定性：同输入两次运行 `annotated-graph.json` 与 `audit.json` 相同；验证测试绿
- [x] 5.7 SKILL.md 新增阶段 2.3 ANNOTATE（merge 之后、assemble-review 之前）；验证 check-refs 绿
- [x] 5.8 owner 透传（extract-structure-result.mjs 一行加字段）

## 6. validate-graph（②a commit 6）

- [x] 6.1 `skills/excavator/validate-graph.mjs`：锚点 ±1 含 name、`extracted` 边证据行记号、模型判断边证据行、inferred 纪律、引用完整性、step `nodeIds`；输出 `validation.json` 并入 gaps；验证干净夹具 0 finding
- [x] 6.2 **先验装置测试**：注入错证据行 calls 边 + 偏移 5 行节点 → `edge-contradicted`=1、`anchor-mismatch`=1 且点名；验证绿（不绿不得合入）
- [x] 6.3 SKILL.md 新增阶段 6b VALIDATE（UA 阶段 6 inline validator 保留）；验证 check-refs 绿
- [x] 6.4 imports 证据检查覆盖整条 import 语句（多行 ES import）
- [x] 6.5 源码读取收敛到项目根内（越界 → path-out-of-scope 计数，不读）

## 7. Benchmark 与文档（②a commit 7）

- [x] 7.1 `scripts/lib/large-repo-benchmark.mjs` `structureCoverage` 分母 = parsed + zeroSymbol + skipped；验证既有 benchmark 测试更新后绿
- [x] 7.2 `docs/v2-plan.md` §3 按补充层架构重写（UA 原样、插件口 + 后阶段口、存分支清单）；验证三件套绿
- [x] 7.3 ②a 冒烟（不提交）：wcp 与 cebreo 两目标各两次 structure-all + annotate + validate；对 wcp 现有 UA 图跑 validateGraph 与 annotate 0 删；数字贴 PR（a2–a5、a7）

## 8. 提示词加节（②b commit 8，只加不改）

- [x] 8.1 `agents/excavator-file-analyzer.md` 末尾加「证据字段」节（行号抄自结构 JSON；抄不到标 inferred；`status: no-extractor|parse-failed` 的文件只建 file 节点不臆造成员；有 `owner` 则保留）；验证既有段落 diff 为零、新节存在
- [x] 8.2 同文件加「框架指引」节（frameworks 含 spring/angular/maui → 读 `skills/excavator/frameworks/<x>.md`；目录先建 README 说明文件由 ③ 提供）；验证 check-refs 绿
- [x] 8.3 `agents/excavator-domain-analyzer.md` 加一句 step `nodeIds`；验证既有段落 diff 为零

## 9. Summary 核验（②b commit 9）

- [ ] 9.1 `agents/excavator-summary-verifier.md`：三态 + 理由；验证提示词只允许三态
- [ ] 9.2 `skills/excavator/apply-verification.mjs`：写回 `verification`，不清空 summary，contradicted 存档并计 `summary-contradicted`，`project.verification`；验证单元测试三态写回
- [ ] 9.3 SKILL.md 新增阶段 2.5 VERIFY（`--no-verify`、`--verify-sample <n>`）；验证 check-refs 绿

## 10. 新鲜度（②b commit 10）

- [ ] 10.1 annotate 从 fingerprints 算 cosmetic dirty 文件 → `meta.json.excavator.dirtyFiles` 与节点 `verification:'dirty'`；UA 的 commit 标记逻辑不动；验证测试：改 `if` 阈值 → dirty 可见，UA 标记行为与之前一致
- [ ] 10.2 `prepare-incremental.mjs` 新增 git 不可用回退（contentHash 变更集），git 可用时行为不变；验证非 git 夹具改一文件 → 变更集恰为该文件；wcp 父目录实跑不 fatal
- [ ] 10.3 非 git 目标 `project.gitCommitHash=null`、`sourceDigest` 存在；验证测试

## 11. 领域步骤（②b commit 11）

- [ ] 11.1 `skills/excavator-domain/annotate-domain.mjs`：为 step 推导 `nodeIds` 与 `evidence`（模型给了就核对，没给就推导）；验证夹具
- [ ] 11.2 validate 的 `step-unanchored` 对领域图生效；验证夹具

## 12. dashboard 回退与文档（②b commit 12）

- [ ] 12.1 dashboard 对新字段/`verification` 的存在不报错，空 summary 显示节点名；验证 dashboard 测试绿
- [ ] 12.2 `project.model` 取宿主模型名（取不到 `unknown`）；`pipelineVersion` 常量；验证 SAVE 阶段写入
- [ ] 12.3 `docs/v2-plan.md` §3 收尾 + follow-ups（抽取器修复分支、owner 进 id、cosmetic SKIP 修复、C# 解析器本体）；验证三件套绿

## 13. ②b 真实验收（不提交产物；结果贴 PR）

- [ ] 13.1 wcp 在 v2 上全量一次（design「②b 执行注」的 headless 配方；旧 `.excavator/` 先移作 `.excavator-ua-baseline/`）：b1 自报证据核对比例、b6 墙钟与 `total_cost_usd`、与 UA 基线的节点/边/gaps 计数对比
- [ ] 13.2 Opus 分层审计（b2）、注入测试（b3）、负向探针「撤销申请」（b4）、新鲜度实操（b5）
