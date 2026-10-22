执行约束：
- 脚本、测试、`README.md`、`cases.json` 与 `REVIEW.md` 用英文，零中文字符；本变更的文档用中文。
- 用例的描述只写机制，不写语料、项目或人名；文档、提交信息与 PR 正文不出现语料名、私有名字与金丝雀的字面。
- 评测运行的结果写在 scratchpad，不进仓库。
- 验收 oracle 见 design.md，动手前已写死。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose review-eval`
2. `feat(review-eval): score reviewer findings against past defects`：任务 1.1、1.2。
3. `feat(review-eval): add the case set and how to run it`：任务 1.3、1.4。
4. `docs(review): score changes to the review rules against the eval`：任务 1.5。
5. `docs(openspec): record the review-eval baseline`：基线跑完后的设计补充（D3 的命令核对、D4 的正文确认、D5 的两条）与验收记录，任务 2.1、2.3。
6. 审查各轮的修复（如有）。
7. `docs(openspec): archive review-eval`：任务 3.1。

## 1. 实现

- [x] 1.1 `scripts/review-eval/score.mjs`：按 D4。
- [x] 1.2 `tests/review-eval/score.test.mjs`：O1 的各条，再做变异。
- [x] 1.3 `scripts/review-eval/cases.json`：D1 的 3 个缺陷用例与 D2 的 5 个干净用例。
- [x] 1.4 `scripts/review-eval/README.md`：按 D3 跑一个用例的调用方提示词、打分、扩充（D6）。
- [x] 1.5 `REVIEW.md`：按 D5 加一条。

## 2. 验收

- [x] 2.1 O2 基线：先跑一个用例实测花费，再串行跑完；打分；抽读命中的解释；判干净用例上的 Important。
- [ ] 2.2 O3、O4；开 PR（叠在上一步的分支上，上一步合入后改为以 `main` 为基）；按 `REVIEW.md` 审查。
- [x] 2.3 验收记录写进 design.md。

## 3. 归档

- [ ] 3.1 同步主规格并归档。
