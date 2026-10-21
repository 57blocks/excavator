执行约束：
- 源码与 skill 散文用英文，零中文字符；测试里要写汉字范围时用脚本写成 `\u` 转义，提交前扫分支改动。
- 本变更的文档、提交信息与 PR 正文都不出现测试语料的名字与私有名字。
- 验收 oracle 见 design.md，动手前已写死。O2 基线已在提案前用 main 上的 skill 跑过。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose unused-code-report-language`
2. `fix(skill): write unused-code in English unless --language names another`：任务 1.1、1.2。
3. `fix(skill): report unused-code in its own order whatever a project file says about replies`：任务 1.3。
4. `fix(skill): open the unused-code report with fixed words`：任务 1.4。
5. `revert(skill): drop the unused-code opening words that stayed English under --language`：任务 1.5。
6. `docs(openspec): record unused-code-report-language acceptance and archive`：任务 2.1–2.3。

## 1. 实现

- [x] 1.1 `skills/excavator-unused-code/SKILL.md`：选项、变量、两份 Language 段、第 2–6 步的指回行、第 4 步理由用 `$LANGUAGE`（design D1、D2）。
- [x] 1.2 `tests/skill/test_unused_code_skill_contract.test.mjs`：Language 段的位置与坏副本、选项、理由语言、无汉字（D4）。验证：契约测试。
- [x] 1.3 第 6 步：D3 的三句、第 8 项、删掉指向 chat 的旧规则；契约测试钉住（D3、D4）。验证：契约测试。
- [x] 1.4 第一轮验收后加：汇报以固定的词 "Counts:" 开头，不写说明做了什么的话（D5）；契约测试钉住。验证：契约测试。
- [x] 1.5 第二轮验收后撤回 D5：skill 与契约测试恢复到第 3 个 commit 之后的内容（见 D5）。验证：契约测试；与第 3 个 commit 比对无差异。

## 2. 验收与记录

- [ ] 2.1 O1：逐个做变异并记录哪个测试变红，做完还原。
- [ ] 2.2 O3 三次缩短运行、O4 一次完整运行、O5 一次指定语言的缩短运行，按判据逐条记录。
- [ ] 2.3 O6、O7，验收记录写进 design.md，同步主规格并归档。
