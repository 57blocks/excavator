执行约束：
- 编码由我做。真实测量用 `run` 跑，由我对照记录抽查。
- 验收 oracle 见 design.md「验收 Oracle」，动手前已写死。
- 语言：代码、注释、测试与帮助文本用英文，OpenSpec 用中文。
- 不改 skill、`packages/` 与 MCP。
- 公开仓库：不出现客户、产品或私有语料的名字。测量输出写在仓库外。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

0. `docs(openspec): archive architecture-input`（已完成）。
1. `docs(openspec): propose full-run-measurement`：本变更的 proposal、design、规格与 tasks。
2. `feat(scripts): report token, cost and phase breakdown of a headless Full run`：任务 1.1。
3. `feat(scripts): run a measured Full on an isolated copy of a sample`：任务 1.2。
4. `docs(openspec): record full-run-measurement acceptance`：任务 2.1–2.3。

## 1. 脚本

- [x] 1.1 `scripts/benchmark-full-run.mjs report` 与纯函数库：总量、角色、阶段、样本规模、缺失项；JSON 与 Markdown 输出。验证：O1 中解析部分的单测通过；全量门通过。
  - 完成记录：`scripts/lib/full-run-report.mjs` 与 `report` 子命令；15 个单测覆盖去重、累计花费与轮数、截断、阶段边界与缺失阶段、嵌套派发、样本规模。注入变异（不去重、取第一个 result、不设 F5、后出现的标记覆盖、截断不报缺失）各自让对应测试变红。
  - 对第 3 次运行试跑：花费、轮数、modelUsage 与当时一致；result 事件自报的 usage 之和等于主会话去重后的输入侧 token，说明它只含编排者。墙钟按记录内第一条到最后一条带时间戳事件算，比当时按进程起止算的少约 17 秒（CLI 启动与最后一个 result 无时间戳），留到 2.1 核对。
- [x] 1.2 `scripts/benchmark-full-run.mjs run`：参数校验、预检、隔离复制、无头运行、出报告。验证：O1 中 `run` 部分的单测通过；全量门通过。
  - 完成记录：`run` 子命令与 7 个单测（必填参数、缺预算以用法错误退出且不写任何文件、输出目录不得在样本内、改名规则、非 git 样本整目录复制、git 样本按 HEAD 导出、固定的 claude 参数）。注入变异（预算可省、不改名、git 样本整目录复制、允许输出在样本内、去掉 `--setting-sources`）各自让对应测试变红。
  - 接线冒烟：一个文件的样本、预算 $0.10，真实跑一次，花 $0.2446（第一轮已超上限，result 为 `error_max_budget_usd`）。预检、隔离目录、记录与报告都正常。
  - 冒烟发现并已修：预算超限的 result 事件自报 usage 全为 0，与 modelUsage 不符。原先报告里另列的「编排者自报 usage」会因此显示假零，已删去，编排者 token 只取按消息 id 去重的值（对第 3 次运行，两者本来相等）；子代理一次完成通知都没有时，自报值记为空而不是 0。
  - 记录同时给出进程墙钟：冒烟中进程 23 秒，记录内首末时间戳只隔 3 秒，差值是 CLI 启动与插件加载。

## 2. 测量与记录

- [ ] 2.1 O2：对上一个变更的两次夹具运行出报告，与当时的独立数字比对；截断记录的缺失项。
- [ ] 2.2 O3：cargotracker 默认 Full（Sonnet，上限 $40），报告与 jq 抽查逐项比对。
- [ ] 2.3 在本文件末尾写「验收摘要」：O1–O3 的结果、两个规模点的对比，以及要不要第三个规模点的判断。
