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

- [x] 1.1 `skills/excavator/` 下 7 个脚本的注释、`deploy/selftest.sh`、`.claude/agents/coder.md`。验证：O2。
  - 完成记录：9 个文件，14 行改 14 行。数字与机制原样保留。
- [x] 1.2 `packages/core` 的 1 个测试、`tests/` 下 6 个测试，以及选择安全夹具的文件名。验证：O2。
  - 完成记录：7 个测试文件，11 行改 11 行；1 个夹具改名。直接受影响的 5 个测试文件先单独跑过：220 个测试通过。

## 2. 验收与记录

- [x] 2.1 O1–O3 逐条记录，然后归档。
  - O1 无残留：通过。改后名单检查的内容与路径都返回 0；改前同一命令返回 22 行与 1 个路径。
  - O2 行为不变：通过。build、typecheck、check-refs 通过；`openspec validate --all --strict` 45 项通过；core 1437 个测试通过，与改前 `origin/main` 相同；仓库 151 个文件、4068 个通过、4 个跳过，与改前相同。第一次跑测试全部通过，但末尾报了一次 vitest `onTaskUpdate` RPC 超时，当时机器负载在 25–35；原样重跑一次，退出码 0、没有超时，负载约 24。这个超时之前在高负载下出现过，与本变更只改名字无关。
  - O3 文档、提交与 PR：通过。本变更文档与提交信息的名单检查为 0；三条隐私检查在改动行上为 0（diff 上下文里有一行未改动的生成代码文件路径会命中，它不是改动）。PR 正文开 PR 前用同一套检查。
