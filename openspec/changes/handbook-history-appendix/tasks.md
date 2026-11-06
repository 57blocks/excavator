## 1. 代码健康（脚本）

提交：`feat(product-handbook): the history section counts commits, hotspots, co-changes and tests from git without a model`

- [x] 1.1 测试先红：`history` 的多仓库夹具（design O1）
- [x] 1.2 `handbook.mjs history`、`lib/history-*.mjs`；`lib/sections.mjs` 加 `history`；`sections/history.md`；`SKILL.md`；合约测试更新摘要（design D1、D2）

## 2. 附录（脚本）

提交：`feat(product-handbook): the appendix lists open questions, a glossary and the handbook's own counts from verified content`

- [x] 2.1 测试先红：待确认事项、术语表、资料来源（design O1）
- [x] 2.2 `lib/appendix.mjs`（design D3）

## 3. 呈现

提交：`feat(product-handbook): the handbook and the page show the code health and appendix chapters`

- [x] 3.1 「代码健康」与「附录」两章；页面数据 `/14`、新页面（design D4）
- [x] 3.2 渲染与页面测试（design O2）

## 4. 验收

提交：`docs(openspec): record handbook-history-appendix acceptance`

- [ ] 4.1 变异检查，结果写进 `acceptance.md`
- [ ] 4.2 O3 真实运行与抽查，没过的线照实写
- [ ] 4.3 受影响测试、`check-refs`、`openspec validate --all --strict` 本地过；全量门在分离检出里跑（O4）
