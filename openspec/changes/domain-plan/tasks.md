提交序列见 proposal。每个脚本任务先写红测试，看它失败，再实现。

## 1. 规划与复用

- [x] 1.1 红测试（`tests/domain/plan-domains.test.mjs`）：O1、O2、O3 全部。
- [x] 1.2 实现 `skills/excavator-domain/plan-domains.mjs`（导出 `buildPlanInput`、`acceptPlan`、`reconcilePlan`、`moduleSetDigest` 供测试；CLI `prepare` / `accept`）。
  - **验证：** 1.1 绿。

## 2. 挂接与守恒

- [x] 2.1 红测试（改 `tests/domain/merge-domain-areas.test.mjs`）：O4、O5；去掉别名测试；端到端夹具测试改为先接受一份规划再合并；装置先验：丢一个步骤、一条 `flow_step` 边各被点名。
- [x] 2.2 改 `merge-domain-areas.mjs`：读规划、域来自规划、挂接、`checkConservation`、退出码 4、报告增量；删去 `--aliases`。
  - **验证：** 2.1 绿。

## 3. skill 与代理

- [x] 3.1 红测试（改 `tests/domain/domain-skill-contract.test.mjs`）：SKILL 调用 `plan-domains.mjs prepare` 与 `accept`、派一个规划代理、两次拒收即停、不含 `--aliases` 与 `aliases.json`；规划代理提示词有 `planRun`、`assignments`、`kind`、支撑域规则；分析器 Option C 不写域、写 `domainMeta.module`。
- [x] 3.2 新增 `agents/excavator-domain-planner.md`，改 `SKILL.md` 与 `agents/excavator-domain-analyzer.md`。
  - **验证：** 3.1 绿；`node scripts/check-refs.mjs`；读这些文件的既有测试绿。

## 4. 实测与收尾

- [x] 4.1 O6：大夹具上前（main）后（本分支）各两次独立冷运行，后一边加一次热运行；同一度量脚本算 ARI、域配对、桶、守恒、花费。
  - 条件：大夹具（88 个模块、46 个有入口点），无知识图，`claude -p --model sonnet`，插件分别取 main（b8272e93）与本分支（8ae3f31e，之后只改了测试文件），每次冷运行用全新的夹具副本。9 个区，每次约 75–100 秒、约 2 美元；五次共约 10.2 美元。
  - 前（main）：两次各 32 个域，流程 141 / 140、步骤 382 / 446；46 / 45 个模块覆盖、静默为零 0；第二次的编排者手写别名合并了 2 个域。按流程导出的划分在共同覆盖的 45 个模块上 ARI 0.613；配对出的 29 个域里 id 相同 5 个、名字相同 22 个。
  - 后（本分支）冷运行两次：各 13 个域（10 个业务域 + 3 个支撑域），流程 146 / 146、步骤 343 / 578；48 / 47 个模块覆盖、静默为零 0；守恒 `ok`、146 条流程全部按步骤挂接、`unplaced` 0。规划划分（88 个模块）ARI 0.82（阈值 ≥ 0.8，达标）；业务域数差 0（阈值 ≤ 2，达标）；13 个域里 id 相同 9 个、名字相同 12 个。按流程导出的划分 ARI 0.765。两份规划有 8 个模块归属不同，都是边界模块：payouts 与 payout-review 页面（计费 / 供应商）、notifications、settings、wishlists，以及 3 个共享工具目录（共享库 / 基础设施 / 数据模型）。
  - 后（本分支）热运行（在第一次冷运行的副本上再跑）：`plan=reused`、没有派规划代理；规划划分、13 个域的 id 与名字与冷运行完全相同（ARI 1）；守恒 `ok`。达到结构保证。
  - 局限：每边 n=2，合成代码。两次冷运行都正好用满业务域上界 10，所以「域数一致」部分来自上界本身；冷启动 ARI 只比阈值高 0.02。流程与步骤每次都会变（区分析不复用）。
- [x] 4.2 `openspec validate --all --strict`；受影响测试；PR 写明跑了什么与实测数字。
