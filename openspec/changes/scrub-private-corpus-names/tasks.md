执行约束：
- 替换只用仓库外的脚本按 design D2 的顺序做，不手改。
- 本变更的文档、提交信息与 PR 正文都不出现四个真名。
- 验收 oracle 见 design.md，动手前已写死。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose scrub-private-corpus-names`
2. `test: use neutral names in fixtures and test data`：任务 1.1。
3. `docs: use neutral corpus names in comments, docs and agent guides`：任务 1.2。
4. `docs(openspec): use neutral corpus names in specs and the active change`：任务 1.3。
5. `docs(openspec): use neutral corpus names in archived changes`：任务 1.4。
6. `docs(openspec): record scrub-private-corpus-names acceptance`：任务 2.1。
7. `docs(openspec): archive scrub-private-corpus-names`

## 1. 替换

- [ ] 1.1 `packages/core` 与 `tests/` 的测试数据，以及选择安全夹具的文件名。验证：O3 全量门。
- [ ] 1.2 `skills/excavator/` 的注释、`docs/mcp.md`、`deploy/selftest.sh`、`AGENTS.md`、`openspec/config.yaml`、`.claude/agents/coder.md`。验证：O3 全量门。
- [ ] 1.3 `openspec/specs/` 的三个规格与活跃变更 `dead-code-detection`。验证：`openspec validate --all --strict`。
- [ ] 1.4 已归档的变更，含两个目录改名。验证：`openspec validate --all --strict`、check-refs。

## 2. 验收与记录

- [ ] 2.1 O1–O4 逐条记录。
