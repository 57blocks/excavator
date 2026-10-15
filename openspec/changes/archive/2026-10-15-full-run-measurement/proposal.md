## Why

大仓库上的 Full 运行要能估算、能续跑、能分模块，前提是知道 Full 的花费和时间花在哪里。现有的 `scripts/benchmark-large-repo.mjs` 只测确定性步骤，不调用模型，没有 Full 的数据。

上一个变更的真实运行已经给出第一个数据点，也说明不能按文件数线性外推：
- 70 个文件的夹具，Sonnet 跑一次 Full（不含核验）花 $6.3–8.5、20–26 分钟；
- 主会话（编排者）占了约七成的缓存读入 token（1340 万 / 1911 万），分析文件的子代理反而是小头；
- 主会话被后台子代理的完成通知反复唤醒，每次都带着越来越长的上下文。

这些数字是验收代理每次临时解析运行记录得出的，口径不固定，也没法和下一次比。

## What Changes

- 新增 `scripts/benchmark-full-run.mjs`，与确定性基准并列：
  - `report <run.jsonl>`：读一次无头 Full 运行的 stream-json 记录，输出 JSON 与简短 Markdown。
    - 总量：自报的花费、各模型 token、墙钟时间、轮数。
    - 按角色拆：编排者与各类子代理的次数、token、耗时与输入侧缓存读写，以及编排者每次调用的上下文长度。
    - 按阶段拆：F1–F5 的起止时间。
    - 样本规模：文件数、节点数与批数。
    - 缺的数据单独列出，不默认成零。
  - `run`：在隔离目录里跑一次无头 Full 再出报告。
    - 必须给 `--model` 与 `--max-budget-usd`；
    - 样本复制到只含它的新目录，目录名不暗示测试；
    - 插件从本仓库检出加载。
- 测量：
  - 用 `report` 重读上一个变更的两次夹具运行（不花钱），核对口径；
  - 再用 Sonnet 对一个完整的开源 Java EE 应用跑一次默认 Full，作为第二个规模点。

不改 skill、`packages/` 与 MCP：这一步只测量，不优化。

## Capabilities

### New Capabilities

- `full-run-measurement`：从一次无头 Full 运行的记录中，按固定口径报告花费、token、时间、角色与阶段的分布；以及受约束的测量运行方式。

### Modified Capabilities

（无）

## Impact

- 新增 `scripts/benchmark-full-run.mjs`、它的纯函数库与测试。
- 真实运行花钱：第二个规模点预计 $20–35（按夹具的每文件花费估，上限另设），只跑 Sonnet，不与其他重任务并行。
- 测量结果写在仓库外；仓库里只记汇总数字。
