执行约束：
- skill 散文、测试与 PR 正文用英文，零中文字符；本变更的文档用中文。
- 每个 skill 只改 O5 所列的几处，其余措辞不动。
- 验收 oracle 见 design.md，动手前已写死。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose graph-skills-layer-records`
2. `fix(skill): read the layer records in the graph skills' layer step`：任务 1.1（第一版）。
3. `test(skill): pin the graph skills' layer step to the layer records`：任务 1.2（第一版）。
4. `docs(openspec): record the graph-skills-layer-records acceptance`：第一版的验收。
5. 审查第 1 轮的修复：
   - `docs(openspec): read layers from the semantic graph first`：proposal、design、spec 改为 D1–D4。
   - `fix(skill): read a Full run's layers from semantic-graph.json first`：任务 1.3、1.4。测试与 skill 放在同一个提交：第一版的测试在新 skill 上是红的，分开会留下一个红的中间提交。
   - `docs(openspec): record the acceptance after review round 1`：任务 2.1。
6. `docs(openspec): archive graph-skills-layer-records`：任务 2.2、3.1。

## 1. 实现

- [x] 1.1 第一版：四个 SKILL.md 改取分层的一步，grep `"record":"layer"`；onboard 第 7 步的 Architecture Layers 一行。
- [x] 1.2 第一版：`tests/skill/test_graph_skill_layer_step.test.mjs`。
- [x] 1.3 四个 SKILL.md 按 D1–D3 加 Reading Layers 一节，改分层行的说明、取分层的一步与 onboard 的 Architecture Layers 一行。
- [x] 1.4 测试按 D4。

## 2. 验收

- [ ] 2.1 O1：先在改 skill 之前的检出上跑新测试，记下红的条目；改完后跑绿。O2–O5。
- [ ] 2.2 验收记录写进 design.md；开 PR，按 `REVIEW.md` 审查。

## 3. 归档

- [ ] 3.1 同步主规格并归档。
