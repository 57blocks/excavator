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

- [x] 3.1 红测试（`tests/domain/domain-skill-contract.test.mjs`）：SKILL 在派区分析器之前接受规划、报告 `support-unchosen`；规划代理说明 `mixed` 与「支撑域只放没有业务行为的模块」；分析器 Option C 读 `domainPlan`、为需选域模块的流程写 `domainMeta.domain` 与 `domainReason`。
- [x] 3.2 改 `SKILL.md`、`agents/excavator-domain-planner.md`、`agents/excavator-domain-analyzer.md`。
  - **验证：** 3.1 绿；`node scripts/check-refs.mjs`；读这些文件的既有测试绿。

## 4. 实测与收尾

- [x] 4.1 O5：前（main 65bff693）后（本分支）各两次冷运行，后一边加一次热运行；同一测量脚本。
  - 条件：夹具 `mixed-legacy.mjs`（32 个模块、55 个入口点、2 个区），无知识图，`claude -p --model sonnet`，插件分别取 main 65bff693 与本分支 2a480829（之后只改了 openspec 文档），每次冷运行用全新的夹具副本。每次约 80–95 秒、0.68–0.93 美元；五次共约 4.1 美元。
  - 前（main）：两次各 6 个业务域 + 3 个支撑域；流程 48 / 54；**支撑域流程占比 56.3% / 55.6%**（27 / 30 条）。规划把 `routes` 归到支撑域两次、`cmd` 两次、`services` 一次。混合目录里 27 条业务流程挂对 1 / 0 条（3.7% / 0%），其中 24 / 27 条在支撑域。静默为零 0、守恒 `ok`。两次规划划分 ARI 0.699。
  - 后（本分支）冷运行两次：各 6 + 3 个域；两次都把三个混合目录标为 `mixed`（并归到业务域）；流程 43 / 48；**支撑域流程占比 9.3% / 6.3%**（4 / 3 条，都是非业务文件起始、分析器选了支撑域并给了理由；阈值 ≤ 15%，达标）。混合目录业务流程 27 / 27 挂对（100%，阈值 ≥ 80%，达标）：`routes` 18、`services` 3、`cmd` 6。回落 0、`support-unchosen` 0，与测量脚本独立数出的「支撑域里没有支撑域选择的流程数」0 相等（达标）。静默为零 0、守恒 `ok`。规划划分 ARI 0.951（阈值 ≥ 0.8，达标）；业务域数差 0（阈值 ≤ 2，达标）；9 个域里 id 相同 7 个、名字相同 7 个；`mixed` 集合相同。两份规划唯一的差别是 `routes` 的回落域（Customer Accounts / Ordering），它只在分析器没选时生效。
  - 后（本分支）热运行（在第一次冷运行的副本上再跑）：`plan=reused`、规划历史只有一条 `new`（规划调用 0 次）；规划划分、9 个域的 id 与名字、`mixed` 与冷运行完全相同（ARI 1，达标）；流程 55，支撑域占比 7.3%，混合目录业务流程 27 / 27 挂对，回落 0，守恒 `ok`。
  - 局限：每边 n=2，合成代码，每个混合文件只服务一个领域、文件名就是领域名，比真实遗留代码容易；`support-unchosen` 的等式只在 0 上被实测验证过，非零情形由单元测试覆盖。流程与步骤每次都会变（区分析不复用）。没有知识图时运行收尾报告域图「新鲜度检查不可用」，前后两边都出现，与本变更无关。
- [x] 4.2 `openspec validate --all --strict`；受影响测试；PR 写明跑了什么与实测数字。
