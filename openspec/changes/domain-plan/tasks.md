提交序列见 proposal。每个脚本任务先写红测试，看它失败，再实现。

## 1. 规划与复用

- [ ] 1.1 红测试（`tests/domain/plan-domains.test.mjs`）：O1、O2、O3 全部。
- [ ] 1.2 实现 `skills/excavator-domain/plan-domains.mjs`（导出 `buildPlanInput`、`acceptPlan`、`reconcilePlan`、`moduleSetDigest` 供测试；CLI `prepare` / `accept`）。
  - **验证：** 1.1 绿。

## 2. 挂接与守恒

- [ ] 2.1 红测试（改 `tests/domain/merge-domain-areas.test.mjs`）：O4、O5；去掉别名测试；端到端夹具测试改为先接受一份规划再合并；装置先验：丢一个步骤、一条 `flow_step` 边各被点名。
- [ ] 2.2 改 `merge-domain-areas.mjs`：读规划、域来自规划、挂接、`checkConservation`、退出码 4、报告增量；删去 `--aliases`。
  - **验证：** 2.1 绿。

## 3. skill 与代理

- [ ] 3.1 红测试（改 `tests/domain/domain-skill-contract.test.mjs`）：SKILL 调用 `plan-domains.mjs prepare` 与 `accept`、派一个规划代理、两次拒收即停、不含 `--aliases` 与 `aliases.json`；规划代理提示词有 `planRun`、`assignments`、`kind`、支撑域规则；分析器 Option C 不写域、写 `domainMeta.module`。
- [ ] 3.2 新增 `agents/excavator-domain-planner.md`，改 `SKILL.md` 与 `agents/excavator-domain-analyzer.md`。
  - **验证：** 3.1 绿；`node scripts/check-refs.mjs`；读这些文件的既有测试绿。

## 4. 实测与收尾

- [ ] 4.1 O6：大夹具上前（main）后（本分支）各两次独立冷运行，后一边加一次热运行；同一度量脚本算 ARI、域配对、桶、守恒、花费。
- [ ] 4.2 `openspec validate --all --strict`；受影响测试；PR 写明跑了什么与实测数字。
