执行约束：
- skill 散文、测试与 PR 正文用英文，零中文字符；本变更的文档用中文。
- 每个 skill 只改取分层的一步（onboard 另改 Architecture Layers 一行），其余措辞不动。
- 验收 oracle 见 design.md，动手前已写死。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose graph-skills-layer-records`
2. `fix(skill): read the layer records in the graph skills' layer step`：任务 1.1。
3. `test(skill): pin the graph skills' layer step to the layer records`：任务 1.2。
4. 审查各轮的修复（如有）。
5. `docs(openspec): archive graph-skills-layer-records`：任务 2.2、3.1。

## 1. 实现

- [ ] 1.1 四个 SKILL.md 按 D1 改取分层的一步；onboard 第 7 步的 Architecture Layers 一行。
- [ ] 1.2 `tests/skill/test_graph_skill_layer_step.test.mjs`：按 D2。

## 2. 验收

- [ ] 2.1 O1：先在改 skill 之前的检出上跑新测试，记下红的条目；改完后跑绿。O2、O3、O4。
- [ ] 2.2 验收记录写进 design.md；开 PR，按 `REVIEW.md` 审查。

## 3. 归档

- [ ] 3.1 同步主规格并归档。
