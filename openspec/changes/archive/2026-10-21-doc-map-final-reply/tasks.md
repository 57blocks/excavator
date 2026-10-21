执行约束：
- 源码与 skill 散文用英文，零中文字符。
- 本变更的文档、提交信息与 PR 正文都不出现测试语料的名字与私有名字。
- 验收 oracle 见 design.md，动手前已写死。O2 基线要在改 skill 之前，用 main 上的 skill 跑。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose doc-map-final-reply`
2. `fix(skill): start the final reply with the report's path`：任务 1.1。
3. `fix(skill): print the final reply's lines with one command`：任务 1.2，第一轮验收后加（design D3）。
4. `docs(openspec): record doc-map-final-reply acceptance and archive`：任务 2.1–2.4。

## 1. 实现

- [x] 1.1 `skills/excavator-doc-map/SKILL.md` 第 7 步最后一段按 design D1 改写；`tests/skill/test_doc_map_skill_contract.test.mjs` 钉住两句与位置（D2）。验证：契约测试 + O1。

- [x] 1.2 第 7 步最后回复改为先用一条命令打印回复的几行（design D3）；契约测试比对命令里的查询与报告的查询，并在夹具产物上跑出期望的几行。验证：契约测试 + 第二轮变异。

## 2. 验收与记录

- [x] 2.1 建夹具，跑 O2 基线（改 skill 之前，main 上的 skill）。
- [x] 2.2 O1：逐个做变异并记录哪个测试变红，做完还原。
- [x] 2.3 O3 三次缩短运行与 O4 一次完整运行，按判据逐条记录。
- [x] 2.4 O5、O6，验收记录写进 design.md，同步主规格并归档。
