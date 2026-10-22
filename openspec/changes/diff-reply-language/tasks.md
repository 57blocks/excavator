执行约束：
- 源码与 skill 散文用英文，零中文字符；测试里要写汉字范围时用脚本拼出 `\u` 转义，提交前扫分支改动。
- 本变更的文档、提交信息与 PR 正文都不出现测试语料的名字与私有名字。
- 验收 oracle 见 design.md，动手前已写死。O2 基线已在提案前用 main 上的 skill 跑过。
- 风险分级为 medium：合并前跑 reviewer agent。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose diff-reply-language`
2. `fix(skill): write diff's analysis and every line to the user in English unless --language names another, under five fixed headings`：任务 1.1–1.3。第二份 Language 段紧挨第 7 步，语言与回复形式拆成两个提交时中间那个版本没有意义，所以合成一个。
3. `fix(skill): print diff's analysis with the last command, so a progress line cannot open the reply`：任务 1.4–1.5，proposal、spec 与 design 同步改。第一版 O3 一次失败后加的（design D2）。
4. `docs(openspec): record diff-reply-language acceptance`：任务 2.1–2.3，含第一版的运行。
5. 审查各轮的修复（如有）。
6. `docs(openspec): archive diff-reply-language`：任务 3.1。

## 1. 实现

- [x] 1.1 `skills/excavator-diff/SKILL.md`：`argument-hint`、`## Options`、`## Instructions` 开头的 Language 段、第 3 步的 `LANGUAGE`（D1）。
- [x] 1.2 第二份 Language 段与第 7 步；第 3 步的提醒写在第一个标题下（D2、D3）。
- [x] 1.3 新建 `tests/skill/test_diff_skill_contract.test.mjs`：D4 各条。验证：契约测试。

- [x] 1.4 第 7 步把分析写进 `.excavator/diff-analysis.md`，第 8 步由最后一条命令打印，回复就是它打印的内容（D2 第二版）。
- [x] 1.5 契约测试跟着改：第 8 步的命令与说明，并在临时项目里实际运行命令核对输出。验证：契约测试。

## 2. 验收

- [ ] 2.1 O1：逐个做变异并记录哪个测试变红，做完还原。
- [ ] 2.2 O3 三次、O4 一次完整运行，按判据逐条记录。
- [ ] 2.3 O5、O6，验收记录写进 design.md；开 PR；按 `REVIEW.md` 跑 reviewer agent 并处理各轮。

## 3. 归档

- [ ] 3.1 同步主规格并归档；CI 通过后用 `gh pr merge --merge` 合入。
