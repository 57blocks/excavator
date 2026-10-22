执行约束：
- 代码、注释与测试用英文，没有中文字符；测试与注释不出现任何语料的名字。
- 本变更的文档、提交信息与 PR 正文只用语料代号。
- 验收 oracle 见 design.md，动手前已写死。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose reexport-call-scope`
2. `feat(core): record reexports on every export-from entry, empty included`：任务 1.1。
3. `feat(skill): list the import-map targets only a re-export reaches`：任务 1.2。
4. `fix(skill): keep re-export-only targets out of the call scope`：任务 1.3–1.5。
5. `test(skill): re-export the required module in the reexportOnly case`：任务 2.1 的变异发现的夹具缺口。
6. `docs(openspec): record reexport-call-scope acceptance and archive`：任务 2.1–2.3。

## 1. 实现

- [x] 1.1 `typescript-extractor.ts` 的 `extractReexport` 总写 `reexports`；`types.ts` 注释说明转发条目总带它；核心测试加 `export {} from` 用例（design D2）。验证：`pnpm --filter @excavator/core test`、`pnpm run typecheck`。
- [x] 1.2 `extract-import-map.mjs` 输出 `reexportOnly`，文件头说明它；`test_extract_import_map` 加用例：只转发、转发加 `require()`、转发加 import、`export {} from`（D1）。验证：该测试文件。
- [x] 1.3 先写 `tests/lazy/reexport-call-scope.test.mjs`（O1–O3），在改动前的代码上跑，记录失败（O1）。
- [x] 1.4 `fact-graph-resolve.mjs` 新增 `callScopePaths`；`build-fact-graph.mjs` 与 `annotate-graph.mjs` 改用它，并更新两处注释（D3）。
- [x] 1.5 `PIPELINE_VERSION` 升到 `lazy-fact-graph/14`，版本注释加一段；七个 Lazy 测试的版本断言随之改（D4）。验证：三件套。

## 2. 验收与记录

- [x] 2.1 O4：逐个变异，记录变红的测试，然后还原。
- [x] 2.2 O5 全部门；O6 在两套语料上比较，按判据逐条记录。
- [x] 2.3 评审（中风险档：reviewer 代理）、回复每条意见；验收记录写进 design.md，同步主规格并归档。
