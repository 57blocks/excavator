提交序列见 proposal。每个脚本任务先写红测试，看它失败，再实现。

## 1. 单元与分区

- [ ] 1.1 红测试（`tests/relations/plan-units.test.mjs`、`tests/relations/split-relation-areas.test.mjs`）：每种清单的 `kind` 规则、嵌套清单归最深、`unmanifested`、路由入口点作入口证据、摘要复用与 `--reunit`；信号命中、包装客户端的引入方、行数上限与 `overBudget`、区不跨单元、密钥行不进上下文、旧区目录被删。
- [ ] 1.2 实现 `plan-units.mjs`、`relations-signals.mjs`、`split-relation-areas.mjs`。
  - **验证：** 1.1 绿；源码里零中文字符、零语料名。

## 2. 核对、配对、分桶

- [ ] 2.1 红测试（`tests/relations/relations-address.test.mjs`、`tests/relations/merge-relations.test.mjs`）：D6 的规范化与配对（参数段、通配、字面胜、方法、`ANY`、同单元、`targetUnit`、广播）；D5 每个拒收原因一个植入（O1），真端点全部通过；节点 id 替换；每个端点桶与文件桶至少一个样例；守恒失败退出 4；区缺失退出 3；一致性在输入相同时计算、不同时为 `null`；升级候选。
- [ ] 2.2 实现 `relations-address.mjs`、`merge-relations.mjs`、`relations-freshness.mjs`。
  - **验证：** 2.1 绿。

## 3. skill 与代理

- [ ] 3.1 红测试（`tests/relations/relations-skill-contract.test.mjs`）：SKILL 的阶段顺序、派代理只给三个路径、重派一次、报告的固定行；代理定义写明单边不猜、地址带证据、`skippedFiles`、后续种类；两者都不写模型名。
- [ ] 3.2 写 `skills/excavator-relations/SKILL.md`、`agents/excavator-relations-analyzer.md`；`tests/install/install.test.mjs` 的 skill 数加一；`README.md` 加用法。
  - **验证：** 3.1 绿；`node scripts/check-refs.mjs`；受影响的既有测试绿。

## 4. 验收

- [ ] 4.1 按 design 的 O2–O6 在四个语料上跑，记花费；分层抽查并记精度；把结果写进本文件。
- [ ] 4.2 `openspec validate --all --strict`；开 PR，写明跑了哪些测试与实测数字。
