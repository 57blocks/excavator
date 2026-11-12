执行约束：
- 代码、注释与测试用英文，零中文字符；非英语的 Gherkin 关键字只以 `\u` 转义出现。本变更的文档用中文。
- 代码、注释、测试与提交信息里不出现语料名。夹具只写通用的产品措辞。
- 真实语料只读，输出放 scratchpad，不进仓库。
- 验收 oracle 见 design.md，动手前已写死。
- 风险分级为 medium：合并前跑 reviewer agent。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose gherkin-grammar-placement`
2. `fix(core): place Gherkin lines by the reference grammar`：任务 1.1–1.3。
3. `feat(excavator): count unplaced reader lines as a coverage gap`：任务 1.4、1.5。
4. `docs(openspec): record gherkin-grammar-placement acceptance`：任务 2.1–2.3。
5. 审查各轮的修复（如有）。
6. `docs(openspec): archive gherkin-grammar-placement`：任务 3.1。

## 1. 实现

- [x] 1.1 `packages/core/src/types.ts`：新增 `StructuralAnalysis.unplaced`（D2）。验证：`pnpm run typecheck` 通过。
- [x] 1.2 `feature-parser.ts`：按 D1 的分类与接受表、D3、D5 重写 `extract`。验证：1.3 的测试全绿。
- [x] 1.3 `feature-parser.test.ts`：写 O1 的十项；按 design 重算现有测试的期望；把 main 的解析器临时放回，逐条确认新测试失败。
- [x] 1.4 `extract-structure-result.mjs`：校验 `unplaced` 并带进结果行，不计入符号数。`coverage-ledger.mjs`：汇总成缺口 `unplaced-lines`（D2）。验证：1.5 的测试全绿。
- [x] 1.5 `test_coverage_ledger.test.mjs`：加 O2 的端到端用例。另加 `unplaced` 形状校验的单元用例。两者都确认在 main 上失败。

## 2. 验收

- [x] 2.1 O3 全量门：新文件先 `git add -N`。
- [x] 2.2 O4：在公开语料上比对新旧解析器，把每处差异归到规则，人工读过每一段 `unplaced`。
- [x] 2.3 验收记录写进 design.md；开 PR；按 `REVIEW.md` 跑 reviewer agent 并处理各轮。

## 3. 归档

- [x] 3.1 同步主规格（`gherkin-extraction`、`coverage-ledger`）并归档；CI 通过后用 `gh pr merge --merge` 合入。
