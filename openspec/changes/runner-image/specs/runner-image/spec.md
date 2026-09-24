## Purpose

定义 Excavator 的可部署运行镜像与单次运行契约：镜像里装什么、钉什么版本，一次运行接收哪些参数、如何隔离被分析的仓库，以及运行结束后由确定性代码而不是模型来判定这次运行是否可信，并用固定的退出码和摘要把结果交给运维。

## ADDED Requirements

### Requirement: 镜像内容钉死且不含凭证与产物

运行镜像 SHALL 包含一个已构建完成的 Excavator 检出（依赖与 `packages/core` 的构建产物齐全），且只对应一个记录在案的 commit；SHALL 包含一个记录在案的固定版本的 Claude Code，并关闭其一切更新途径；SHALL 提供 Node ≥ 22、git，以及同时可用 `python` 与 `python3` 两个命令调用的 Python 3。镜像 SHALL 以固定 uid 的非 root 用户运行，并把 Excavator 检出暴露在该用户的 `$HOME/.excavator-plugin`；挂载进来的仓库属主与该用户不同时，git 操作 SHALL 仍然可用。镜像 SHALL 以标签记录 Excavator 的 commit 与 Claude Code 的版本。镜像 MUST NOT 包含任何云凭证、模型凭证、git 凭证、目标仓库源码或 `.excavator/` 产物；模型 ID、区域与预算 MUST NOT 写死在镜像里。

#### Scenario: 版本与标签一致
- **WHEN** 在镜像里查询 Claude Code 版本与 Excavator 检出的 commit
- **THEN** 两者分别等于镜像标签记录的值，且 Claude Code 报告更新已被关闭

#### Scenario: 镜像里没有凭证与产物
- **WHEN** 检查镜像文件系统
- **THEN** 不存在 `.excavator/` 目录、云凭证文件或 Claude Code 登录凭证，默认用户不是 root

### Requirement: 运行参数不全时先失败

一次运行 SHALL 要求运行模式（`lazy` 或 `full`）与固定挂载路径上的目标仓库；`full` 模式还 SHALL 要求区域、模型 ID 与花费上限。任一必需参数缺失或取值非法时，运行 SHALL 在写入任何文件、启动任何进程之前以配置错误的退出码结束，并指出缺少或非法的参数名。

#### Scenario: full 模式缺少模型 ID
- **WHEN** 以 `full` 模式启动运行但未提供模型 ID
- **THEN** 运行以配置错误的退出码结束，输出指出缺少模型 ID，目标仓库与输出目录都没有新文件

### Requirement: lazy 模式不调用模型

`lazy` 模式 SHALL 只执行零模型的 Lazy 流程，MUST NOT 启动 Claude Code，也 MUST NOT 需要任何模型凭证。同一 commit 的同一仓库在镜像内外分别运行 Lazy，得到的事实摘要 SHALL 相同。

#### Scenario: 无凭证的 lazy 运行
- **WHEN** 在没有任何云凭证的环境里以 `lazy` 模式运行
- **THEN** 运行成功结束，没有启动 Claude Code，产物写入目标仓库的 `.excavator/`

#### Scenario: 镜像内外事实一致
- **WHEN** 对同一 commit 的同一仓库，分别在镜像内与镜像外运行 Lazy
- **THEN** 两次的事实摘要相同

### Requirement: full 模式在源码未变时跳过

`full` 模式下，当目标仓库现有产物是 full 流程产出的、其记录的 commit 等于当前 HEAD，且未要求强制重跑时，运行 SHALL 以成功退出码结束并在摘要中标为跳过，MUST NOT 启动 Claude Code，MUST NOT 改动任何产物。现有产物只是 Lazy 产出时，即使 commit 相同也 MUST NOT 跳过。

#### Scenario: HEAD 未变
- **WHEN** 目标仓库现有的 full 产物记录的 commit 与 HEAD 相同，且未要求强制重跑
- **THEN** 运行以成功退出码结束，摘要标为跳过，没有模型调用，产物逐字节不变

#### Scenario: 只有 Lazy 产物
- **WHEN** 目标仓库现有产物由 Lazy 产出，记录的 commit 与 HEAD 相同，以 `full` 模式启动
- **THEN** 运行不跳过，正常启动 full 流程

### Requirement: 被分析仓库的配置不被执行或加载

`full` 模式启动 Claude Code 时，目标仓库自带的 Claude Code 配置 MUST NOT 生效：仓库里 `.claude/settings.json` 声明的 hooks 与环境变量 MUST NOT 执行或生效，`.mcp.json` 声明的 server MUST NOT 连接，仓库里的 skills、agents、commands 与 `CLAUDE.md` MUST NOT 被加载。Excavator 插件 SHALL 只从镜像内的检出加载。每次运行 SHALL 带有由运行参数给出的花费上限，SHALL 拒绝一切需要人工确认的权限请求而不是等待，且 MUST NOT 在容器里持久保存会话记录。

#### Scenario: 诱饵仓库
- **WHEN** 目标仓库包含一个会写标记文件的 `.claude/settings.json` hook、一个 `.mcp.json` server 和一个与 Excavator 同名的 `.claude/skills` skill，并以 `full` 模式启动
- **THEN** 标记文件没有出现，会话初始化信息里没有该 server 与该 skill，已加载的 Excavator 插件路径是镜像内的检出

#### Scenario: 诱饵 CLAUDE.md
- **WHEN** 目标仓库的 `CLAUDE.md` 指示写出一个标记文件，并以 `full` 模式完成一次真实模型运行
- **THEN** 标记文件没有出现

### Requirement: 运行后校验插件确实完整加载

`full` 模式 SHALL 根据会话初始化信息判定加载是否完整：Excavator 插件从镜像内检出的路径加载且没有插件加载错误；Excavator 的 MCP server 处于已连接状态；镜像内检出 `agents/` 目录定义的每一个 agent 都可用，期望集合 SHALL 从检出中读出而不是写死；派发子 agent 的工具可用。任一项不满足时，运行 SHALL 以加载或产物检查失败的退出码结束，并在摘要中列出缺失项；已有产物 SHALL 保留。

#### Scenario: 缺少子 agent 与 MCP 的会话
- **WHEN** 会话初始化信息里列出了 Excavator 的 skill，但没有任何 Excavator agent，也没有 Excavator 的 MCP server
- **THEN** 运行以加载或产物检查失败的退出码结束，摘要列出缺失的 agent 与 MCP server

### Requirement: 运行与产物由确定性检查判定

`full` 模式在模型运行结束后 SHALL 分两类检查：
- **运行本身**：运行结果没有报告错误，没有被拒绝的权限请求，没有失败的子 agent，没有超时，没有触及花费上限，且这些字段在运行结果中确实存在。任一项不满足时，运行 SHALL 以运行失败的退出码结束。
- **产物**：产物记录的 commit 等于运行前的 HEAD；产物记录的模型等于本次请求的模型 ID，而不是 `unknown`。任一项不满足时，运行 SHALL 以加载或产物检查失败的退出码结束。

两类情况下，摘要都 SHALL 写明原因，已有产物 SHALL 保留。

#### Scenario: 子 agent 失败
- **WHEN** 运行结果报告至少一个子 agent 失败
- **THEN** 运行以运行失败的退出码结束，摘要写明失败的子 agent 数

#### Scenario: 模型记录为 unknown
- **WHEN** 产物记录的模型为 `unknown`
- **THEN** 运行以加载或产物检查失败的退出码结束

### Requirement: 独立复核编造与结构完整性

`full` 模式 SHALL 在模型运行结束后，独立地对最终知识图谱重跑确定性的源码校验，校验输出只写到运行输出目录，MUST NOT 改动 `.excavator/` 中的产物。结构完整性问题数大于 0 时，运行 SHALL 以加载或产物检查失败的退出码结束。被判定为 contradicted 的节点与边的总数超过编造阈值（由运行参数给出，默认 0）时，运行 SHALL 以编造超阈值的退出码结束。产物标记为未做摘要核验时，运行 SHALL 同样以编造超阈值的退出码结束，MUST NOT 视为零编造通过。所有情况下产物 SHALL 保留。

#### Scenario: 存在被推翻的摘要
- **WHEN** 最终图谱里有一个节点的摘要被判定为 contradicted，且编造阈值为默认值
- **THEN** 运行以编造超阈值的退出码结束，摘要给出 contradicted 数，`.excavator/` 里的产物保持模型运行后的状态

#### Scenario: 核验被跳过
- **WHEN** 产物标记为未做摘要核验
- **THEN** 运行以编造超阈值的退出码结束，而不是报告零编造

### Requirement: 每次运行恰好落入一个可见结果

除配置错误外（配置错误只输出到标准错误，见「运行参数不全时先失败」），每次运行 SHALL 在输出目录写出运行摘要，至少包含：镜像记录的 Excavator commit 与 Claude Code 版本、目标仓库 HEAD、运行模式、模型 ID、每一项检查的结论与原因、按类别（输入、缓存写入、缓存读取、输出）的 token 数、估算花费，以及编造数与未核验数。缓存读取 token 为 0 时摘要 SHALL 带警告。退出码 SHALL 固定为：0 成功或跳过，2 配置错误，3 运行失败，4 加载或产物检查失败，5 编造超阈值；每次运行 SHALL 恰好对应其中一个。多项同时失败时，SHALL 按阶段顺序取第一个失败阶段的退出码：配置 → 加载 → 运行 → 产物与结构 → 编造。

#### Scenario: 成功运行的摘要
- **WHEN** 一次 `full` 运行全部检查通过
- **THEN** 退出码为 0，摘要列出版本、HEAD、模型、各项检查结论、四类 token 数与估算花费

#### Scenario: 缓存未命中
- **WHEN** 一次 `full` 运行的缓存读取 token 为 0
- **THEN** 摘要带有缓存警告，退出码不因此改变

### Requirement: 镜像可自检且按固定规则发布

镜像 SHALL 提供不调用模型、不需要凭证的自检：版本与标签一致、插件清单校验通过、`python` 命令可用、在临时生成的小仓库上 Lazy 能产出知识图谱、挂载的仓库属主与容器用户不同时 git 仍可用。发布流程 SHALL 运行仓库测试门、确认构建来自干净的检出、构建 `linux/amd64` 镜像并运行自检；只有在发布触发（打 tag 或手动触发）下且全部通过后，才以不可覆盖的标签 `<插件版本>-<短 commit>` 推送到镜像仓库。改到部署相关文件的 PR SHALL 运行同一套流程，但不推送。不推送时——不是发布触发，或镜像仓库参数未配置——流程 SHALL 明确报告跳过了推送及原因。

#### Scenario: 未配置镜像仓库
- **WHEN** 在没有配置镜像仓库参数的情况下触发发布流程
- **THEN** 镜像完成构建与自检，流程报告推送被跳过并说明缺少的参数，而不是失败或静默成功

#### Scenario: PR 运行
- **WHEN** 一个改到部署相关文件的 PR 触发流程
- **THEN** 测试门、镜像构建与自检都运行，流程报告因不是发布触发而跳过推送

#### Scenario: 自检失败不推送
- **WHEN** 自检失败
- **THEN** 不推送任何镜像
