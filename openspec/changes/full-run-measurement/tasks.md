执行约束：
- 编码由我做。真实测量用 `run` 跑，由我对照记录抽查。
- 验收 oracle 见 design.md「验收 Oracle」，动手前已写死。
- 语言：代码、注释、测试与帮助文本用英文，OpenSpec 用中文。
- 不改 skill、`packages/` 与 MCP。
- 公开仓库：不出现客户、产品或私有语料的名字。测量输出写在仓库外。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

0. `docs(openspec): archive architecture-input`（已完成）。
1. `docs(openspec): propose full-run-measurement`：本变更的 proposal、design、规格与 tasks。
2. `feat(scripts): report token, cost and phase breakdown of a headless Full run`：任务 1.1。
3. `feat(scripts): run a measured Full on an isolated copy of a sample`：任务 1.2。
4. `docs(openspec): record full-run-measurement acceptance`：任务 2.1–2.3。

## 1. 脚本

- [ ] 1.1 `scripts/benchmark-full-run.mjs report` 与纯函数库：总量、角色、阶段、样本规模、缺失项；JSON 与 Markdown 输出。验证：O1 中解析部分的单测通过；全量门通过。
- [ ] 1.2 `scripts/benchmark-full-run.mjs run`：参数校验、预检、隔离复制、无头运行、出报告。验证：O1 中 `run` 部分的单测通过；全量门通过。

## 2. 测量与记录

- [ ] 2.1 O2：对上一个变更的两次夹具运行出报告，与当时的独立数字比对；截断记录的缺失项。
- [ ] 2.2 O3：cargotracker 默认 Full（Sonnet，上限 $40），报告与 jq 抽查逐项比对。
- [ ] 2.3 在本文件末尾写「验收摘要」：O1–O3 的结果、两个规模点的对比，以及要不要第三个规模点的判断。
