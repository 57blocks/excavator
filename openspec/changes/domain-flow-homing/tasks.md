提交序列见 proposal。每个脚本任务先写红测试，看它失败，再实现。

## 0. 前置

- [x] 0.1 归档 `domain-plan`；新增夹具 `tests/fixtures/domain-areas/mixed-legacy.mjs` 与它的确定性测试（三个混合目录各含多个领域的入口点、真值导出）。

## 1. 规划：混合标记与区上下文

- [x] 1.1 红测试（`tests/domain/plan-domains.test.mjs`）：O1、O2。
- [x] 1.2 改 `plan-domains.mjs`：`mixed` 校验、存储、剪枝、格式 /2；导出 `writeAreaPlans`，`prepare`（reused）与 `accept`（接受）调用它。
  - **验证：** 1.1 绿；既有规划测试绿。

## 2. 挂接

- [x] 2.1 红测试（`tests/domain/merge-domain-areas.test.mjs`）：O3、O4，先在旧代码上红。
- [x] 2.2 改 `merge-domain-areas.mjs`：两档挂接、`flows.choices`、`flows.support`、打印行。
  - **验证：** 2.1 绿；既有合并测试绿。

## 3. skill 与代理

- [ ] 3.1 红测试（`tests/domain/domain-skill-contract.test.mjs`）：SKILL 在派区分析器之前接受规划、报告 `support-unchosen`；规划代理说明 `mixed` 与「支撑域只放没有业务行为的模块」；分析器 Option C 读 `domainPlan`、为需选域模块的流程写 `domainMeta.domain` 与 `domainReason`。
- [ ] 3.2 改 `SKILL.md`、`agents/excavator-domain-planner.md`、`agents/excavator-domain-analyzer.md`。
  - **验证：** 3.1 绿；`node scripts/check-refs.mjs`；读这些文件的既有测试绿。

## 4. 实测与收尾

- [ ] 4.1 O5：前（main 65bff693）后（本分支）各两次冷运行，后一边加一次热运行；同一测量脚本。
- [ ] 4.2 `openspec validate --all --strict`；受影响测试；PR 写明跑了什么与实测数字。
