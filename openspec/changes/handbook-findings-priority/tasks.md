## 1. 定级单元与检查（脚本）

提交：`feat(product-handbook): each group of findings gets a consequence that a fixed table turns into a priority`

- [x] 1.1 测试先红：组键、`check-priority`、级别表、`priority-verdicts`（design O1）
- [x] 1.2 `priority-items`、`check-priority`、`priority-judge`、`priority-verdicts`；`state.json` 的 `priority` 键；评判 agent（design D2、D3、D5）

## 2. 阶段文字

提交：`feat(product-handbook): the priority section ranks the verified findings and two judges check each rank`

- [x] 2.1 `lib/sections.mjs` 加 `priority`；`sections/priority.md` 的子代理提示（design D1、D4）
- [x] 2.2 `SKILL.md`：第 6b 阶段、选项与部分规则；合约测试更新摘要

## 3. 呈现

提交：`feat(product-handbook): the handbook and the page show each finding's priority and reason`

- [x] 3.1 「发现」一章、覆盖、拼装前重算组键；页面数据 `/11`、级别筛选（design D6）
- [x] 3.2 渲染与页面测试（design O2）

## 4. 验收

提交：`docs(openspec): record handbook-findings-priority acceptance`

- [ ] 4.1 变异检查，结果写进 `acceptance.md`
- [ ] 4.2 O3 真实运行与独立抽查，没过的线照实写
- [ ] 4.3 受影响测试、`check-refs`、`openspec validate --all --strict` 本地过；全量门在分离检出里跑（O4）
