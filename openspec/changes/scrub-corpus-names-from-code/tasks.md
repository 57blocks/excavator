执行约束：
- 改写按 design D1、D2 做，只改名字，不改逻辑与断言。
- 本变更的文档、提交信息与 PR 正文都不出现测试语料的名字。
- 验收 oracle 见 design.md，动手前已写死。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose scrub-corpus-names-from-code`
2. `docs: describe the mechanism, not the corpus, in code comments`：任务 1.1。
3. `test: use neutral names in tests and fixtures`：任务 1.2。
4. `docs(openspec): record scrub-corpus-names-from-code acceptance and archive`：任务 2.1。

## 1. 替换

- [ ] 1.1 `skills/excavator/` 下 7 个脚本的注释、`deploy/selftest.sh`、`.claude/agents/coder.md`。验证：O2。
- [ ] 1.2 `packages/core` 的 1 个测试、`tests/` 下 6 个测试，以及选择安全夹具的文件名。验证：O2。

## 2. 验收与记录

- [ ] 2.1 O1–O3 逐条记录，然后归档。
