## Context

动机见 proposal.md，行为见规格。现状：
- 无头运行用 `claude -p ... --output-format stream-json --verbose` 留下记录。
- assistant 与 user 事件带 `timestamp` 与 `parent_tool_use_id`，后者为空表示主会话，否则指向派发子代理的那次工具调用。
- 同一条消息按内容块拆成多个 assistant 事件，usage 重复出现；其中输出 token 是流开始时的值，不是最终值。
- 子代理完成时有 `task_notification` 事件，带自报的 `total_tokens`、`tool_uses`、`duration_ms`。
- 主会话被后台通知唤醒几次，就有几个 result 事件；`total_cost_usd` 与 `modelUsage` 是累计值，`num_turns` 各算各的。

## Goals / Non-Goals

**Goals：** 固定口径，让不同规模、不同提交的两次运行能直接相比；给第 6 步的预估提供数据。

**Non-Goals：**
- 不优化 Full，不改 skill。
- 不按单价推算花费，不做预估模型（第 6 步）。
- 不测 Lazy（已有确定性基准）。

## Decisions

### D1 解析交给脚本，运行器只做约束

记录是几兆的结构化事件流，统计口径要每次相同，交给确定性脚本。验收代理以往每次临时写 jq，数字对得上，但口径（去重、累计值、阶段边界）每次重新决定。

运行器很薄，只把踩过的坑做成必填项和固定步骤，不负责判断：
- 没钉模型时，一次运行花掉 $71；
- 语料与预注册同目录，编排者读到了期望；
- CLI 未登录，运行在第一次调用前失败。

备选方案是只写一份运行说明，由人或代理照做。没采用：上面三条都是"照说明做时漏掉"造成的。

### D2 阶段边界

按主会话调用的脚本与派发的子代理类型，取每个阶段第一次出现的时间：

| 阶段 | 起点标记 |
|---|---|
| F1 | `lazy-analyze.mjs` |
| F2 | `select-stale-semantics.mjs`（第一次） |
| F3 | `semantic-graph.mjs`（第一次） |
| F4 | `apply-verification.mjs` 的 `prepare-semantic` 或 `skip-semantic` |
| F5 | F4 最后一条 `apply-semantic` 或 `skip-semantic` 的结果返回之后 |

- 每个阶段到下一个阶段的起点为止，最后一个阶段到记录结束为止。
- F1 之前的部分记为 `setup`。
- 某阶段没有标记就记为缺失，它的时长并入前一段，并在报告里注明。

### D3 角色与 token

- 子代理按派发时的 `subagent_type` 归类。次数取派发的工具调用；token、工具调用与耗时取完成通知的自报值。
- 输入侧 token 按消息 id 去重后求和。输出 token 只报 `modelUsage` 的总量，不按角色拆，因为流事件里的输出值不是最终值。
- 编排者的上下文长度取每次调用的「未缓存输入 + 缓存写 + 缓存读」。

### D4 样本规模

从运行产物读：
- F2 文件数：`intermediate/stale-files.json` 的条目数；
- 批数：`intermediate/batches.json` 的批数；
- 节点数：`knowledge-graph.jsonl` 头部的计数。

`report` 用 `--project <dir>` 指向产物所在的项目；不给或读不到，就把样本规模记为缺失。

### D5 运行器的隔离与预检

- **样本**：是 git 仓库时用 `git archive HEAD` 导出，并记下提交；否则整目录复制。
- **目录**：放到新建的临时目录，旁边只有一个空的工作目录。样本目录用源目录名；名字含 `test` 或 `fixture` 时改为 `app`。
- **预检**：`claude auth status` 已登录、`claude plugin validate <仓库根>` 通过、core 的 dist 存在。任一不满足就不启动。
- **命令**：与上一个变更的冒烟运行相同：
  - 加载方式：`--plugin-dir <仓库根>`、`--setting-sources user`、关闭 hooks；
  - 钉模型与预算：`--model`、`--max-budget-usd`；
  - 其他：`--permission-mode auto`、stream-json 输出、`--full`；
  - `--no-verify` 可选透传。
- **清理**：临时目录不删，路径写进报告。

## Risks / Trade-offs

- [stream-json 的事件形状随 CLI 版本变化] → 报告记下 CLI 版本；缺字段进缺失项而不是报零；单测钉住当前形状。
- [阶段标记依赖编排者照 SKILL.md 调用脚本] → 编排者绕开脚本时，对应阶段显示为缺失，时间不会被算进错误的阶段。
- [一个规模点不足以定增长曲线] → 先跑一个点，看编排者占比与每文件花费的变化，再决定要不要第三个点，并在花钱前说明预算。

## 验收 Oracle（动手前写死）

- **O1 单测**（构造的小记录）：
  - 同一消息 id 只计一次；
  - 花费取最后一个 result 事件，轮数求和；
  - 截断的记录给出缺失项；
  - 阶段边界与 `setup`、缺失阶段的处理；
  - 子代理按类型归类；
  - `run` 的参数校验：缺 `--model` 或 `--max-budget-usd` 就以用法错误退出，且不调用模型；
  - 隔离目录的构成与改名规则。
- **O2 装置核对**（不花钱）：对上一个变更的第 2、3 次运行出报告，与当时验收代理独立算出的数字比对：
  - 花费 6.3165 与 8.4746；
  - 子代理 7 个与 6 个，已知差异是第 2 次有 assemble-reviewer、第 3 次没有；
  - 主会话轮数 63 与 91；
  - modelUsage 各项一致；
  - 墙钟约 20 分 28 秒与 26 分 27 秒，误差在几秒内。
  
  另把第 3 次的记录截在 F2 中途，报告必须给出缺失项。
- **O3 真实测量**：对 cargotracker（开源 Java EE 与 JSF 应用，209 个文件、19 批）用 Sonnet 跑一次默认 Full（含 F4），预算上限 $40。
  - 用 jq 直接从记录里抽总花费、result 数与子代理派发数，与报告逐项比对；
  - 记录总量、角色与阶段分布，以及与夹具相比每文件花费和编排者占比的变化；
  - 这是测量，不设通过线。
