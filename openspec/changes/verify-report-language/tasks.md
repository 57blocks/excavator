执行约束：
- 源码与 skill 散文用英文，零中文字符；测试里要写汉字范围时用脚本拼出 `\u` 转义，提交前扫分支改动。
- 本变更的文档、提交信息与 PR 正文都不出现测试语料的名字与私有名字。
- 验收 oracle 见 design.md，动手前已写死。O2 基线已在提案前用 main 上的 skill 跑过。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose verify-report-language`
2. `fix(skill): write verify's report and every line to the user in English unless --language names another`：任务 1.1–1.3。
3. `fix(skill): end verify with a reply its last command prints, and keep the errors in the report`：任务 1.4、1.5。
4. `docs(openspec): record verify-report-language acceptance and archive`：任务 2.1–2.3。

## 1. 实现

- [x] 1.1 `skills/excavator-verify/SKILL.md`：argument-hint、选项、Phase 0 开头的 Language 段、Phase 0 第 1、2 步、Phase 1–5 的指回行、子代理提示的 `<DOC_LANGUAGE>`、Phase 2、3、5 的语言说明（design D1）。
- [x] 1.2 `skills/excavator-prd/SKILL.md` 第 5 步把 `$LANGUAGE` 作为 `--language` 传给 verify（D4）。
- [x] 1.3 新建 `tests/skill/test_verify_skill_contract.test.mjs`：Phase 顺序、无汉字、选项与 `--language` 出现的位置、`DOC_LANGUAGE` 各处、Language 段与 hotspots 相同、prd 传 `--language`（D5 前几条）。验证：契约测试。
- [ ] 1.4 删掉 Phase 3 结尾的回复要求；Phase 5 以 Fix 一节的说明结尾（D3）；新增 Phase 6：指回行、跳过说明、第二份 Language 段、回复命令与说明（D2、D4）。
- [ ] 1.5 契约测试：Language 段的位置与坏副本、Phase 6 的命令与说明原文、旧说法已不在、命令换上样例值后打印 5 行（D5 其余各条）。验证：契约测试。

## 2. 验收与记录

- [ ] 2.1 O1：逐个做变异并记录哪个测试变红，做完还原。
- [ ] 2.2 O3 三次缩短运行、O4 与 O5 各一次完整运行、O6 一次指定语言的缩短运行，按判据逐条记录。
- [ ] 2.3 O7、O8，验收记录写进 design.md，同步主规格并归档。
