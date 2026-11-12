## Why

`excavator-prd-report` 从代码写出「代码现在做什么」（As-Is PRD 与功能级发现）。Skopo 从代码与文档恢复「系统必须满足什么」：分层的意图文档（skopository：spec、产品绑定、技术绑定），以及来源之间互相矛盾的地方，作为留给人回答的问题。两者读同一份源码，但回答不同的问题：前者面向产品与实现现状，后者面向约束与分歧。

Skopo 目前是另一个仓库里的 Claude Code 插件（`/skopo:init`），在 Excavator 之外运行：
- 它自带一个不调模型的仓库普查，研究代理用 `rg` 去搜 Excavator 的图谱文件。Excavator 已经有确定性的事实层（含 Java EE 与 JSF 的注入、EL 引用、路由与描述符提及）与有界的 MCP 查询，Skopo 用不上。
- 它没有续跑：每次运行新建一个运行目录，计划之后中断就只能从头来。
- 它不能在 runner 镜像里跑：镜像只有 `lazy` 与 `full` 两种模式。
- 它没有面向读者的报告：产物是 skopository 本身与运行目录里的问题清单。

把 Skopo 的恢复流程作为 Excavator 的扩展，与 `excavator-prd-report` 并列，可以复用事实层、MCP、`--out` 与续跑的做法、runner 镜像与它的确定性判定。

## What Changes

- **新 skill `skopo-plan`**：普查、按镜头派发研究代理、写出恢复计划（产品与消费方、目录树、语言、规模、范围之外的部分）。不写 skopository。整个系统超过约 30 万行代码而没有给 `--scope` 时，计划给出按域或按模块的切分与各块规模，建议下一步的范围。
- **新 skill `skopo-create`**：在 `skopo-plan` 的产物上（没有就先按 `skopo-plan` 的流程做）写 spec、产品与技术绑定、README、有出处的 rationale，逐域分配 ID 并 lint，整理问题清单，产出完整的 skopository。不写 lock：lock 记录的是人接受过的文本。
- **新 skill `skopo-report`**：从一个 skopository 与它的运行数据写出项目总结与问题报告（`report.md` 与可从磁盘打开的 `report.html`）。总结由模型写，每段引用 statement ID；问题、没有记录理由的决定、范围与覆盖、lint 结果由脚本生成并守恒。
- **新 agent `skopo-researcher`**：一个镜头的只读研究，事实层新鲜时先用 MCP（`recall`、`traverse`、`read_evidence`）或图谱文件找路，再读源码；只引用源码。
- **Java EE 的意图来源**：`skopo-create/jakarta-ee.md`，写 Excavator 事实层没有变成边、但意图集中的地方（EL 里的 `rendered`/`disabled` 条件、`@RolesAllowed` 与 `web.xml` 安全约束、`@Schedule`、`@TransactionAttribute`、Bean Validation、消息资源、存储过程、WSDL）。项目是 Java EE 时随派发传给研究代理。
- **vendored 的 Skopo 检查器**：Skopo 仓库 `tools/cli` 的解析器、lint、ID 分配、普查与运行记录脚本，以及写作指南与示例，逐字节复制到 `skills/skopo-create/checker/`，`SOURCE.json` 记录来源 commit 与每个文件的哈希，测试拒绝本地改动。Skopo 仓库仍是它们的源头。
- **确定性脚本 `skopo.mjs`**：运行目录的创建与状态（续跑判定）、报告的检查与拼装、报告页、给 runner 的产物判定。
- **runner 镜像的 skopo 模式**：`EXCAVATOR_MODE` 增加 `skopo-plan`、`skopo-create`、`skopo-report`，新参数 `EXCAVATOR_SCOPE`。事实层缺失或过期时先跑零模型的 lazy；产物由 `skopo.mjs verdict` 判定。

**不做**：
- `skopo-lock` 与语义层（S1、S2）：lock 要人先审阅，与无人值守的恢复无关；Skopo 仓库的 `/skopo:lock` 照旧可用。
- 多次分块恢复合并成一个 skopository：本变更每次恢复从头写一个范围。
- 报告的逐条源码复核（`excavator-verify` 那样的核对）。
- 改动 `excavator-prd-report` 或事实层。

## Capabilities

### New Capabilities

- `skopo-checker`：vendored 检查器的来源、完整性与许可。
- `skopo-plan`：普查、研究与计划；产物目录与续跑。
- `skopo-create`：写出完整 skopository 并检查到干净。
- `skopo-report`：总结与问题报告，脚本守恒的部分与模型写的部分。

### Modified Capabilities

- `runner-image`：运行模式与参数增加 skopo 模式；skopo 模式的加载、运行与产物判定。

## Impact

- 新增：`skills/skopo-plan/`、`skills/skopo-create/`（含 `skopo.mjs`、`lib/`、`checker/`、`jakarta-ee.md`）、`skills/skopo-report/`、`agents/skopo-researcher.md`。
- `deploy/run-excavator.mjs` 与新文件 `deploy/skopo-mode.mjs`，`docs/deploy.md` 的参数表与退出码说明。
- `NOTICE`：vendored 文件的 Apache-2.0 许可。
- 测试：`tests/skill/skopo/`、`tests/deploy/`。
