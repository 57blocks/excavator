## MODIFIED Requirements

### Requirement: 运行参数不全时先失败

一次运行 SHALL 要求运行模式（`lazy`、`full`、`skopo-plan`、`skopo-create` 或 `skopo-report`）与固定挂载路径上的目标仓库；`full` 与三个 skopo 模式还 SHALL 要求区域、模型 ID 与花费上限。范围参数 SHALL 只用于 `skopo-plan` 与 `skopo-create`，取值 SHALL 是不含 `..` 与空白的相对路径；在其他模式下给出范围，或取值非法，都是配置错误。强制参数在 `skopo-report` 里为真也是配置错误。任一必需参数缺失或取值非法时，运行 SHALL 在写入任何文件、启动任何进程之前以配置错误的退出码结束，并指出缺少或非法的参数名。

#### Scenario: full 模式缺少模型 ID
- **WHEN** 以 `full` 模式启动运行但未提供模型 ID
- **THEN** 运行以配置错误的退出码结束，输出指出缺少模型 ID，目标仓库与输出目录都没有新文件

#### Scenario: 范围越出仓库
- **WHEN** 以 `skopo-create` 模式启动，范围为 `../other`
- **THEN** 运行以配置错误的退出码结束，输出指出范围参数

## ADDED Requirements

### Requirement: skopo 模式由确定性检查判定

skopo 模式 SHALL 在事实层对当前源码不新鲜时先运行 lazy 分析（不调用模型），它失败时运行以运行失败的退出码结束。随后 SHALL 用与 `full` 相同的隔离参数启动 Claude Code，执行对应的 skopo 命令，产物目录为输出目录下的 `skopo/`。加载检查与运行检查 SHALL 与 `full` 相同；产物检查 SHALL 是 `skopo.mjs verdict` 对应阶段的结果，不合格时运行以加载或产物检查失败的退出码结束，摘要列出它打印的原因。三个阶段可在共用同一输出目录的连续运行中依次执行，后一阶段在前一阶段的产物上续跑。强制参数为真时，`skopo-plan` 与 `skopo-create` SHALL 让 skill 删除输出目录下的 `skopo/` 后从头开始。

#### Scenario: 写出的 skopository 有 lint 错误
- **WHEN** `skopo-create` 运行结束，`verdict` 报告 lint 错误
- **THEN** 运行以加载或产物检查失败的退出码结束，摘要列出这些错误，产物保留

#### Scenario: 计划之后写出
- **WHEN** 先以 `skopo-plan` 运行，再以 `skopo-create` 运行，两次共用同一输出目录且源码未变
- **THEN** 第二次运行不重做研究，从写 spec 开始
