## 1. 对策单元与检查（脚本）与阶段文字

提交：`feat(product-handbook): the remedies section writes causes, measures and recommendations that cite only verified findings and computed facts`

- [ ] 1.1 测试先红：`remedy-facts`、`check-remedies`、`remedy-verdicts`（design O1）
- [ ] 1.2 `remedy-facts`、`check-remedies`、`remedy-judge`、`remedy-verdicts`；`state.json` 的 `remedies` 键；评判 agent（design D2、D3、D5）
- [ ] 1.3 `lib/sections.mjs` 加 `remedies` 与 `AFTER_TRACE` 行；`sections/remedies.md`；`SKILL.md` 第 6c 阶段；合约测试更新摘要（design D1、D4）

## 2. 呈现

提交：`feat(product-handbook): the handbook and the page show the causes, measures and recommendations`

- [ ] 2.1 「发现」一章的原因与对策、「建议」一章、覆盖；页面数据 `/12`、建议页（design D6）
- [ ] 2.2 渲染与页面测试（design O2）

## 3. 验收

提交：`docs(openspec): record handbook-remedies acceptance`

- [ ] 3.1 变异检查，结果写进 `acceptance.md`
- [ ] 3.2 O3 真实运行与独立抽查，没过的线照实写
- [ ] 3.3 受影响测试、`check-refs`、`openspec validate --all --strict` 本地过；全量门在分离检出里跑（O4）
