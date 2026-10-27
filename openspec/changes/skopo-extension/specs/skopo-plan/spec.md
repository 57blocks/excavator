## ADDED Requirements

### Requirement: 产物目录归本 skill 所有并可判定状态

`skopo-plan`、`skopo-create` 与 `skopo-report` SHALL 共用一个产物目录 `$OUT`（默认 `<project>/.excavator/skopo`）：运行数据在 `$OUT/run`，skopository 在 `$OUT/skopo`，报告在 `$OUT/report`。`$OUT/run/run.json` SHALL 记录格式 `excavator-skopo/1`、项目根、当前源码修订与范围。脚本 SHALL 把 `$OUT` 判定为恰好一种状态：`none`、`foreign`、`stale`、`other-scope`、`started`、`planned`、`created`。脚本 MUST NOT 在 `foreign` 的目录里写入或删除任何文件；`--fresh` 只删除空目录或本格式的目录。

#### Scenario: 别人的目录
- **WHEN** `$OUT` 非空，却没有本格式的 `run/run.json`
- **THEN** 状态为 `foreign`，`start` 与 `fresh` 都拒绝且不改动目录，skill 告诉用户并结束

#### Scenario: 源码变了
- **WHEN** `run.json` 记录的源码修订与当前不同
- **THEN** 状态为 `stale`，skill 提示用 `--fresh` 重跑并结束

### Requirement: 计划无人值守地产出

`skopo-plan` SHALL 普查范围内的仓库，按规模派发只读研究代理，并把每份研究报告原样存进 `$OUT/run/research/`，然后写出 `$OUT/run/plan.md`：产品与消费方、skopository 的目录树、范围之外的部分、语言与预计规模、没有读的来源。它 MUST NOT 向用户提问；阻断问题 SHALL 记为 `stopped=<原因>` 并结束。阻断问题包括：仓库处在一个不是默认分支的具名分支上。分离 HEAD 或看不出默认分支时 SHALL 记入 notes 并继续。

#### Scenario: 分离 HEAD
- **WHEN** 仓库 checkout 的是一个 commit 而不是分支
- **THEN** 计划照常写出，notes 记下没有确认默认分支

#### Scenario: 在功能分支上
- **WHEN** 仓库处在名为 `feature/x` 的分支上，默认分支是 `main`
- **THEN** `run.json` 记录 `stopped`，没有 `plan.md`，skill 告诉用户切回默认分支

#### Scenario: 续跑时不重派已完成的研究
- **WHEN** 状态为 `started`，`research/` 里已有 `world.md`
- **THEN** 不再派发 `world` 镜头，其余镜头照常派发

### Requirement: 大系统的计划给出切分

没有 `--scope` 且普查超过约 30 万行代码或 150 万字文档时，`skopo-plan` SHALL 只做模块级的研究，计划 SHALL 给出按域或按模块的切分、每块的规模与建议的第一块范围，并写明 `skopo-create` 需要 `--scope`。

#### Scenario: 两百五十万行
- **WHEN** 普查给出 250 万行代码且没有 `--scope`
- **THEN** 计划列出各块与它们的行数，建议一块作为第一个范围；`skopo-create` 在这个计划上停下并提示带 `--scope` 重跑

### Requirement: 研究先用事实层找路，只引用源码

事实层对当前源码新鲜时，研究代理 SHALL 先用 MCP（连接时）或图谱文件定位，再读源码；`--no-graph` 时 MUST NOT 使用事实层。研究报告里的证据 SHALL 只指项目里的源文件；图谱与技术栈指引 MUST NOT 作为证据。事实层过期或缺失时 skill SHALL 告诉用户，MUST NOT 重建事实层。

#### Scenario: Java EE 项目
- **WHEN** 项目有 `faces-config.xml` 与 `ejb-jar.xml`
- **THEN** 每个研究派发都带上 Java EE 的意图来源指引
