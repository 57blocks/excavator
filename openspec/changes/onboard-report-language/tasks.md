执行约束：
- 源码与 skill 散文用英文，零中文字符；测试里要写汉字范围时用脚本拼出 `\u` 转义，提交前扫分支改动。
- 本变更的文档、提交信息与 PR 正文都不出现测试语料的名字与私有名字。
- 验收 oracle 见 design.md，动手前已写死。O2 基线已在提案前用 main 上的 skill 跑过。
- 风险分级为 medium：合并前跑 reviewer agent。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose onboard-report-language`
2. `fix(skill): write onboard's guide and every line to the user in English unless --language names another, and end with a reply its last command prints`：任务 1.1–1.4。第二份 Language 段紧挨回复命令，语言与回复拆成两个提交时中间那个版本没有意义，所以合成一个。
3. `docs(openspec): record onboard-report-language acceptance`：任务 2.1–2.3。
4. 审查各轮的修复（如有）。
5. `docs(openspec): archive onboard-report-language`：任务 3.1。

## 1. 实现

- [ ] 1.1 `skills/excavator-onboard/SKILL.md`：`argument-hint`、`## Options`、`## Instructions` 开头的 Language 段、第 2 步的 `LANGUAGE`（D1）。
- [ ] 1.2 第 7 步写到 `.excavator/onboarding-guide.md`；第 8 步、第二份 Language 段、回复命令与说明；删掉原第 8–10 步；第 2 步的过期提醒写进指南（D2–D4）。
- [ ] 1.3 新建 `tests/skill/test_onboard_skill_contract.test.mjs`：D5 里与语言有关的各条。验证：契约测试。
- [ ] 1.4 契约测试：D5 里与回复、保存与过期提醒有关的各条。验证：契约测试。

## 2. 验收

- [ ] 2.1 O1：逐个做变异并记录哪个测试变红，做完还原。
- [ ] 2.2 O3 三次、O4 一次完整运行，按判据逐条记录。
- [ ] 2.3 O5、O6，验收记录写进 design.md；开 PR；按 `REVIEW.md` 跑 reviewer agent 并处理各轮。

## 3. 归档

- [ ] 3.1 同步主规格并归档；CI 通过后用 `gh pr merge --merge` 合入。
