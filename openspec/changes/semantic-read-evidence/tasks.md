执行约束：
- 源码、skill 散文与测试用英文，零中文字符；提交前扫分支改动。
- 本变更的文档、提交信息与 PR 正文不出现语料与客户的名字。
- 验收 oracle 见 design.md，动手前已写死。每个新检查先写测试、跑红，再实现。
- 风险档为 medium：合并前按 `REVIEW.md` 跑 reviewer agent。
- 不做真实运行（design 风险节）。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose semantic-read-evidence`
2. `feat(excavator): plan Phase F2 batches by the source lines to read`：任务 1.1–1.3。
3. `feat(excavator): commit a semantic patch only with a line quoted from its slice`：任务 1.4–1.5。
4. `feat(excavator): refuse a summary that cites its own anchor`：任务 1.6。
5. `feat(excavator): write a verdict only with a line quoted from its slice`：任务 1.7–1.8。
6. `docs(openspec): record semantic-read-evidence acceptance`：任务 2.1–2.3。

## 1. 实现

- [ ] 1.1 `plan-semantic-batches.mjs` 与测试：`readRange`、两个上限、并集计行、oversized、`unreadable` 桶、每批输入文件（D1）。验证：先红后绿。
- [ ] 1.2 SKILL.md F2 第 2、3 步与 F1 前的清理、预估附录 `B2`（D5）；契约测试跟着改。
- [ ] 1.3 `scripts/lib/full-run-report.mjs` 的 F2 批数与产物清单改读 `semantic-batches.json`，测试跟着改。
- [ ] 1.4 `read-evidence.mjs` 的 `checkReadEvidence` 与 `apply-semantic-patches.mjs` 的接入，每个状态一个测试（D2）。验证：先红后绿。
- [ ] 1.5 文件分析代理的 Semantic Patch Mode 与 SKILL.md F2 派发模板写明 `evidence`；已有调用 `applySemanticPatches` 的测试补上依据。
- [ ] 1.6 `citesAnchor` 与接入，三种形式各一个测试，外加根目录文件名不误拒（D3）。验证：先红后绿。
- [ ] 1.7 `applySemanticVerification` 的 `checkEvidence`、CLI 的构造、`verdictNoEvidence` 计数与 gap（D4）。验证：先红后绿。
- [ ] 1.8 核验代理 Output 与 SKILL.md F4 写明 `evidence`；已有测试补上依据。

## 2. 验收

- [ ] 2.1 O1：每个检查的红与绿记进 design.md。
- [ ] 2.2 O2：逐个变异并记录哪个测试变红，做完还原。
- [ ] 2.3 O3、O4，验收记录写进 design.md。
