执行约束：
- 源码、skill 散文与测试用英文，零中文字符；提交前扫分支改动。
- 本变更的文档、提交信息与 PR 正文不出现测试语料的名字与私有名字。
- 验收 oracle 见 design.md，动手前已写死。O1 的改前基线已测（proposal）。
- 风险档为 medium：合并前按 `REVIEW.md` 跑 reviewer agent。
- 回复的形式不变，按要求不做真实运行。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose reply-file-and-contract-checks`
2. `test(skill): make each known-bad copy assert the problem its check reports`：任务 1.1。
3. `fix(skill): print explain's and diff's reply from this run's own file`：任务 1.2–1.3。
4. `fix(skill): refuse a reply file too long to reach the user whole`：任务 1.4。
5. `fix(skill): name the PR number in diff's argument hint`：任务 1.5。
6. `docs(openspec): record reply-file-and-contract-checks acceptance`：任务 2.1–2.3。
7. 审查各轮的修复（如有）。
8. `docs(openspec): archive reply-file-and-contract-checks`：任务 3.1。

## 1. 实现

- [x] 1.1 8 个语言规则契约测试的坏副本各自断言它针对的问题；doc-map 补 `beforeCheck`（D4）。验证：契约测试与 O1。
- [x] 1.2 explain 第 8、9 步与 diff 第 7、8 步：打印本次路径的命令、写到这个路径、回复命令只打印它并改名为固定名，失败时怎么做（D1）。
- [x] 1.3 explain、diff 的契约测试跟着改：在临时项目里运行两条命令，覆盖本次的文件在、不在、两次运行各自、同一时刻两次路径不同（D5）。验证：契约测试。
- [x] 1.4 25,000 字节上限：第 8 步（diff 第 7 步）那句、回复命令的长度检查与对应测试（D2、D5）。验证：契约测试。
- [x] 1.5 diff 的 `argument-hint` 与它的测试（D3）。验证：契约测试。

## 2. 验收

- [x] 2.1 O1、O2：逐个做变异并记录哪个测试变红，做完还原。
- [x] 2.2 O3 全量门、O4 隐私，验收记录写进 design.md。
- [ ] 2.3 开 PR；按 `REVIEW.md` 跑 reviewer agent 并处理各轮。

## 3. 归档

- [ ] 3.1 同步主规格并归档；CI 通过后用 `gh pr merge --merge` 合入。
