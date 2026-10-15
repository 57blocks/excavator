## ADDED Requirements

### Requirement: 按固定口径报告一次 Full 运行

`scripts/benchmark-full-run.mjs report <run.jsonl>` SHALL 读一次无头 Full 运行的 stream-json 记录，输出 JSON 报告与 Markdown 摘要，包括：
- **总量**：最后一个 result 事件自报的累计花费、各模型的 token 用量、所有 result 事件的轮数之和、是否有 result 报错，以及从第一条到最后一条带时间戳事件的墙钟时间。
- **按角色**：
  - 编排者（主会话）与每类子代理的派发次数；
  - 子代理完成通知里自报的 token、工具调用次数与耗时；
  - 按消息 id 去重后的输入侧 token（未缓存输入、缓存写、缓存读）；
  - 编排者每次模型调用的上下文长度（调用次数、首次、最大、最后一次）。
- **按阶段**：F1–F5 各自的起止时间与时长。阶段边界取编排者调用的 skill 脚本与派发的子代理类型；无法归入任何阶段的区间单列。
- **样本规模**：从运行产物读文件数、节点数与 F2 批数。

花费 SHALL 只取运行记录自报的值，不按单价从 token 推算。按文件数或节点数折算的比值 SHALL 标为派生值。

报告里缺的输入 SHALL 单列为缺失，不当作零：没有 result 事件、没有某个阶段的标记、找不到运行产物，各自是可见的一项。

#### Scenario: 同一条消息的多个内容块只计一次
- **WHEN** 记录里同一个消息 id 出现在三个 assistant 事件里，每个都带同样的 usage
- **THEN** 该消息的输入侧 token 只计一次

#### Scenario: 被后台通知多次唤醒的运行
- **WHEN** 记录里有多个 result 事件，花费是累计值，轮数各自独立
- **THEN** 报告的花费取最后一个 result 事件的值，轮数取全部 result 事件之和

#### Scenario: 没有结束的运行
- **WHEN** 记录在 F2 中途截断，没有 result 事件
- **THEN** 报告把总花费、轮数和 F3–F5 标为缺失，仍给出已经出现的角色与阶段数据

### Requirement: 受约束的测量运行

`scripts/benchmark-full-run.mjs run` SHALL 在以下约束下运行一次无头 Full，然后对它的记录出报告：
- `--model` 与 `--max-budget-usd` 必填，缺任一则不启动；
- 样本复制到一个新建的、只含样本与空工作目录的临时目录，样本目录名不含 `test`、`fixture` 一类字样；
- 插件从本仓库检出加载，工作目录是那个空目录，不在样本里；
- 运行记录与报告写到调用者给的输出目录，不写进样本所在的目录树。

#### Scenario: 缺预算不启动
- **WHEN** 调用 `run` 时给了 `--model` 但没给 `--max-budget-usd`
- **THEN** 命令以用法错误退出，不调用模型

#### Scenario: 样本与验收文件隔离
- **WHEN** 样本源目录的同级目录里有预注册或报告文件
- **THEN** 无头运行看到的项目根所在目录树里只有样本副本与空工作目录
