执行约束：
- 源码与 skill 散文用英文，零中文字符；测试里的中文输入写 `\u` 转义。
- 本变更的文档、提交信息与 PR 正文都不出现测试语料的名字与私有名字。
- 验收 oracle 见 design.md，动手前已写死。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose doc-map-search-records`
2. `feat(doc-map): record each search as a pattern and the paths searched`：任务 1.1。产物的 `searched` 改了形状，报告与 chat 的显示查询必须同一个 commit 改，否则这个 commit 的契约测试是红的，所以 D4 放在这里。
3. `fix(skill): keep conclusions out of the search records`：任务 1.2。
4. `docs(openspec): record doc-map-search-records acceptance and archive`：任务 2.1–2.3。

## 1. 实现

- [x] 1.1 `doc-map.py link` 按 design D2 核对每条搜索，更新模块文档字符串；`tests/skill/test_doc_map.test.mjs` 改用新形状，覆盖 D2 的每一条与 O1 的脚本变异。报告的 `not-found` 查询与 `skills/excavator-chat/SKILL.md` 的 `not-found` 查询按 D4 显示；`tests/skill/test_doc_map_skill_contract.test.mjs` 的夹具与查询输出改用新形状，并比对两处显示表达式。验证：相关测试 + O1 脚本部分。
- [ ] 1.2 `skills/excavator-doc-map/SKILL.md`：子代理提示词第 5 条与输出形状（D3）、Step 4 第 4 项的改错说明；`tests/skill/test_doc_map_skill_contract.test.mjs` 钉住这些措辞，覆盖 O1 的提示词变异。验证：相关测试 + O1 提示词部分。

## 2. 验收与记录

- [ ] 2.1 O1：逐个做变异并记录哪个测试变红，做完还原。
- [ ] 2.2 O2：19 条 `not-found` 功能的真实运行，逐条读搜索记录并记录。
- [ ] 2.3 O3、O4，验收记录写进 design.md，同步主规格并归档。
