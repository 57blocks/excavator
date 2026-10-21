执行约束：
- 源码与 skill 散文用英文，零中文字符。
- 本变更的文档、提交信息与 PR 正文都不出现测试语料的名字与私有名字。
- 验收 oracle 见 design.md，动手前已写死。O2 基线已在提案前用 main 上的 skill 跑过。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose hotspots-report-language`
2. `fix(skill): write hotspots in English unless --language names another`：任务 1.1、1.2。
3. `fix(skill): print the hotspots reply's lines with one command`：任务 1.3。
4. `docs(openspec): record hotspots-report-language acceptance and archive`：任务 2.1–2.3。

## 1. 实现

- [x] 1.1 `skills/excavator-hotspots/SKILL.md`：选项、变量、Language 段、各步的指回行、报告用 `$LANGUAGE` 与译出固定措辞（design D1、D2）。
- [x] 1.2 `tests/skill/test_hotspots_skill_contract.test.mjs`：Language 段的位置与坏副本、选项、报告语言、无汉字（D5）。验证：契约测试。
- [ ] 1.3 第 4 步结尾：第 12 条收尾句、Language 段后的回复命令与三句（D3、D4）；契约测试钉住三句并在夹具上运行命令（D5）。验证：契约测试。

## 2. 验收与记录

- [ ] 2.1 O1：逐个做变异并记录哪个测试变红，做完还原。
- [ ] 2.2 O3 三次运行与 O4 一次运行，按判据逐条记录。
- [ ] 2.3 O5、O6，验收记录写进 design.md，同步主规格并归档。
