## 1. 事实表与检查

- [ ] 1.1 测试先红：`check-architecture` 与 `try-architecture` 的接受、D3 的每种拒绝、内容问题只记数、3 次后失败；`sections` 列出 `architecture` 与它的阶段文件；状态 `state.architecture`
- [ ] 1.2 `architecture.json` 的形状与检查（引文核对复用功能事实表的那一套，正文复用 `check-chapter`）；命令 `check-architecture`、`try-architecture`；各节列表与读文件计划；状态记录
- commit：`feat(excavator-product-handbook): architecture chapter and fact sheet with their checks`

## 2. 拼装与页面

- [ ] 2.1 测试先红：写成时技术视图有正文、未核对标记与 mermaid 分层图，产品视图没有；没写成时三种固定文字之一加原图；页面技术架构页的分层图与层序；画图确定性
- [ ] 2.2 拼装、页面数据与页面组件；新的固定文字键
- commit：`feat(excavator-product-handbook): technical view draws the architecture chapter and its layered diagram`

## 3. 提示词

- [ ] 3.1 合约测试先红（O3）
- [ ] 3.2 `sections/architecture.md`（阶段 4f）；`SKILL.md` 的产出表、各节列表与 `--sections` 说明
- commit：`docs(excavator-product-handbook): an architecture writer reads manifests, config and code`

## 4. 验收

- [ ] 4.1 O2 变异
- [ ] 4.2 O5 测试与检查
- [ ] 4.3 O4 真实运行与独立审读，写 `acceptance.md`

> 归档说明（2026-11-12）：实现见提交 62873bb0（之后 8601c4b0 修过精度）；本文件的任务未逐项勾选，也未逐项核对。整个写法被 handbook-skill-first 取代。

> 归档说明（2026-11-12）：本变更的规格增量与前面几个变更的增量冲突，未同步进主规格，以 `--skip-specs` 归档；其中仍然成立的要求由 handbook-skill-first 的规格重新写入。
