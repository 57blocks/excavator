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

- [x] 1.1 `packages/core` 与 `tests/` 的测试数据，以及选择安全夹具的文件名。验证：O3 全量门。
  - 完成记录：8 个文件改内容，1 个夹具改名。全量门：core 1417 通过；仓库 3594 通过、4 跳过；typecheck、check-refs、`openspec validate --all --strict` 通过，与改前相同。
- [x] 1.2 `skills/excavator/` 的注释、`docs/mcp.md`、`deploy/selftest.sh`、`AGENTS.md`、`openspec/config.yaml`、`.claude/agents/coder.md`。验证：O3 全量门。
  - 完成记录：7 个文件。`AGENTS.md` 与 `openspec/config.yaml` 在代号后补了「真名与位置不进仓库」的说明。全量门结果同 1.1。
- [x] 1.3 `openspec/specs/` 的三个规格与活跃变更 `dead-code-detection`。验证：`openspec validate --all --strict`。
  - 完成记录：6 个文件；validate 43 项通过。
- [x] 1.4 已归档的变更，含两个目录改名。验证：`openspec validate --all --strict`、check-refs。
  - 完成记录：58 个文件改内容，两个目录共 14 个文件随目录改名；validate 43 项通过，check-refs 通过。

## 2. 验收与记录

- [x] 2.1 O1–O4 逐条记录。
  - O1 无残留：通过。内容搜索只剩 `pnpm-lock.yaml`，那一处在第 1077 行的 integrity hash 里；路径搜索为空。改前同一套命令列出 80 个文件、15 个路径，装置看得见。
  - O2 替换一致：通过。脚本的内容替换次数与改后各代号的出现次数（不算本变更自己的文档）逐个相等：`go-multirepo` 131、`mixed-suite` 106、`maui-app` 39、`kotlin-portal` 21、`SampleApp` 16、`MIXED_SUITE` 1。另有路径改名 15 处：夹具 1 个、归档目录下 14 个文件。
  - O3 行为不变：通过，数字见 1.1。
  - O4 提交与 PR：通过。本分支的提交信息搜索结果为 0；PR 正文在开 PR 前用同一名单检查。
  - 范围外、留给另行决定的：`origin/main` 的 447 个提交里，35 个的提交信息、76 个的 diff 含真名；26 个 PR 里有 5 个的标题或正文含真名。改提交历史要强推 `main`；改 PR 正文是改公开内容，都需要明确决定。
