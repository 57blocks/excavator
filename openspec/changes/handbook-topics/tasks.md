## 1. 主题通道与检查（脚本）与阶段文字

提交：`feat(product-handbook): the topics section gathers verified items into approval, time, handoff, access and repeated-problem tables`

- [x] 1.1 测试先红：`topic-facts`、`topic-lanes`、`check-topics`、`topic-verdicts`（design O1）
- [x] 1.2 `topic-facts`、`topic-lanes`、`check-topics`、`topic-judge`、`topic-verdicts`；`state.json` 的 `topics` 键；评判 agent；部署检查的 agent 清单（design D2–D5）
- [x] 1.3 `lib/sections.mjs` 加 `topics` 与 `AFTER_TRACE` 行；`sections/topics.md`；`SKILL.md` 第 6d 阶段；合约测试更新摘要（design D1、D5）

## 2. 呈现

提交：`feat(product-handbook): the handbook and the page show the cross-cutting topics`

- [x] 2.1 「横切主题」一章、handoffs 的图、空主题的说明、覆盖；页面数据 `/13`、横切主题页（design D6）
- [x] 2.2 渲染与页面测试（design O2）

## 3. 验收

提交：`docs(openspec): record handbook-topics acceptance`

- [ ] 3.1 变异检查，结果写进 `acceptance.md`
- [ ] 3.2 O3 真实运行与独立抽查，没过的线照实写
- [ ] 3.3 受影响测试、`check-refs`、`openspec validate --all --strict` 本地过；全量门在分离检出里跑（O4）
