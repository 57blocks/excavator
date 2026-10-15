执行约束：
- 编码由我做。真实验收用 `scripts/benchmark-full-run.mjs run`，由我对照记录与产物核对。
- 验收 oracle 见 design.md「验收 Oracle」，动手前已写死。
- 语言：代码、注释、测试与 skill 散文用英文，OpenSpec 用中文。
- 不改 `packages/` 与 MCP。
- 公开仓库：不出现具体公司、产品或私有语料的名字。测量输出写在仓库外。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

0. `docs(openspec): archive full-run-measurement`（已完成）。
1. `docs(openspec): propose resumable-scoped-full`：本变更的 proposal、design、规格与 tasks。
2. `fix(skill): verify only summaries without a verdict and commit verdicts per batch`：任务 1.1。
3. `feat(skill): select semantics and verification candidates within a directory scope`：任务 1.2。
4. `feat(skill): resume, scope and estimate a Full run`：任务 1.3。
5. `feat(scripts): continue, time out and pass skill arguments in measured runs`：任务 1.4。
6. `docs(openspec): record resumable-scoped-full acceptance`：任务 2.1–2.3。

## 1. 实现

- [ ] 1.1 `apply-verification.mjs`：`prepare-semantic` 只选没有判定或为 `dirty` 的条目；`apply-semantic --batch <i>`；收尾只认清单选中的 id 与清单批号。验证：O1 对应单测；全量门。
- [ ] 1.2 `select-stale-semantics.mjs` 与 `prepare-semantic` 的 `--scope`。验证：O1 对应单测；全量门。
- [ ] 1.3 SKILL.md：Phase F 开始移走旧逐批文件、F2 与 F4 逐批提交、`--scope`、`--estimate`；新附录 `full-run-estimate.md`。验证：O1 的 SKILL 契约与附录单测；全量门。
- [ ] 1.4 `scripts/benchmark-full-run.mjs run`：`--continue`、`--timeout-minutes`、`--skill-args`、产物拷贝。验证：O1 对应单测；全量门。

## 2. 真实验收与记录

- [ ] 2.1 O2 续跑（conduit）。
- [ ] 2.2 O3 预估（jpetstore）。
- [ ] 2.3 在本文件末尾写「验收摘要」：O1–O3 的结果、续跑与预估的数字，以及需求原文第 3 项的完成情况。
