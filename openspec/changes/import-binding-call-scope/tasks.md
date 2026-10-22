执行约束：
- 代码、注释与测试用英文，没有中文字符；测试与注释不出现任何语料的名字。
- 本变更的文档、提交信息与 PR 正文只用语料代号。
- 验收 oracle 见 design.md，动手前已写死。
- 本分支从 reexport-call-scope 的分支头开出；它合入 `main` 之前不合并本 PR，合入之后先与 `main` 同步再合并。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose import-binding-call-scope`
2. `refactor(skill): move the JSX binding resolution into a shared module`：任务 1.1。
3. `feat(core): mark TS/JS call sites whose callee an enclosing function binds`：任务 1.2。
4. `fix(skill): resolve TS/JS callees through the file's own bindings`：任务 1.3–1.6。
5. `docs(openspec): record import-binding-call-scope acceptance and archive`：任务 2.1–2.3。

## 1. 实现

- [ ] 1.1 新建 `module-binding-resolution.mjs`，把 JSX 的绑定与导出解析原样移进去；`jsx-element-resolution.mjs` 改用它（design D2）。验证：JSX 的全部测试。
- [ ] 1.2 `typescript-jsx.ts` 导出作用域收集；`typescript-extractor.ts` 的 `extractCallGraph` 写 `local`；`types.ts` 注释；`extract-structure-result.mjs` 的 `mapCallGraph` 与 `isValidCallGraph` 保留并校验 `local`；核心测试加用例（D3）。验证：`pnpm --filter @excavator/core test`、`pnpm run typecheck`。
- [ ] 1.3 先写 `tests/lazy/import-binding-call-scope.test.mjs`（O1），在基线上跑，记录失败。
- [ ] 1.4 `fact-graph-resolve.mjs` 新增 `resolveBoundCallSite`；`build-fact-graph.mjs` 的 TS/JS 行改用它；`annotate-graph.mjs` 的 `resolveUniqueCallSites` 同样（D1、D5）。
- [ ] 1.5 TS/JS 的 `calls-unresolved` 与 `calls-ambiguous` 原因文本（D7）。
- [ ] 1.6 `PIPELINE_VERSION` 升到 `lazy-fact-graph/15`，版本注释加一段；八个 Lazy 测试的版本断言随之改；`reexport-call-scope` 的 `require()` 用例改期望（D8、O2）。验证：三件套。

## 2. 验收与记录

- [ ] 2.1 O3：逐个变异，记录变红的测试，然后还原。
- [ ] 2.2 O4 全部门；O5 在三个语料成员上比较，按判据逐类记录。
- [ ] 2.3 评审（中风险档：reviewer 代理）、回复每条意见；验收记录写进 design.md，同步主规格并归档。
