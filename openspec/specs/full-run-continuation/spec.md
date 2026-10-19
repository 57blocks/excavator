# full-run-continuation Specification

## Purpose
让 Full 在大仓库上可用：中断后重跑同一条命令即从已提交的语义续跑；可以按目录分块运行，最后一次不带范围的 Full 合成为一张图；开跑前按实测费率给出带出处的花费与墙钟预估。

## Requirements

### Requirement: 中断后重跑同一条命令即续跑

Full 的检查点 SHALL 是已提交的语义：`semantic-cache.json` 里的条目与条目上的判定。不另设状态文件。
- F2 与 F4 SHALL 在每一批返回时就提交该批，不等同一阶段的其他批。
- Phase F 开始时，上一次运行留下的逐批文件（F2 的补丁与补丁报告、F4 的核验批与判定）SHALL 移出 intermediate，不得被当成本次运行的输出。
- 中断后用同一条命令重跑时：
  - F2 SHALL 只为还没有新鲜条目的节点生成语义；
  - F4 SHALL 只核验还没有判定的 summary；
  - 已提交的批 SHALL NOT 重新分析。

#### Scenario: F2 中途超时后续跑
- **WHEN** 一次 Full 在 F2 中途被停止，已有若干批提交，然后用同一条命令重跑
- **THEN** 重跑的 F2 只派发包含未提交节点的文件，先前提交的节点一个都不在派发列表里；重跑一直走到 F5

#### Scenario: 上一次的判定文件不被沿用
- **WHEN** intermediate 里留着上一次运行的 `summary-verdicts-<i>.json`，这次运行重新生成了其中某个节点的 summary
- **THEN** 那份旧判定不会写到新 summary 上

### Requirement: 按目录分块运行并合成一张图

`/excavator --full --scope <dir>` SHALL 只为 `<dir>` 下文件的节点生成和核验语义，并跳过 F3。
- `<dir>` SHALL 是规范的项目相对路径，不能是绝对路径，也不能含 `..`。
- F1 SHALL 仍对整个项目建事实图。
- 分块运行的语义 SHALL 进入同一个 `semantic-cache.json`。之后不带 `--scope` 的一次 Full 只需补齐剩余语义并跑 F3，结果是一张图。

#### Scenario: 两个模块分开跑再合成
- **WHEN** 先后用 `--scope a` 与 `--scope b` 跑 Full，再不带 scope 跑一次
- **THEN** 前两次只生成各自目录下节点的语义且不跑 F3；第三次不为 `a`、`b` 下已有新鲜条目的节点生成语义，F3 跑一次，覆盖整个事实图

#### Scenario: 不规范的 scope
- **WHEN** `--scope` 是绝对路径或含 `..`
- **THEN** 选择脚本报错退出，不派发任何子代理

### Requirement: 运行前预估

`/excavator --full --estimate` 可带 `--scope`。它 SHALL：
- 只跑 F1 与 F2 的选择和分批，不派发任何子代理；
- 报告各阶段的输入计数：要生成语义的节点数、F2 批数、要核验的 summary 数、F4 批数、事实节点数，以及 F3 是否会跑；
- 按附录 `full-run-estimate.md` 的实测费率给出花费与墙钟的估计，注明费率的来源模型与标定样本；
- 单次运行的批数超过附录给的建议上限，或估计墙钟超过 runner 的超时时，提示按目录分块或依赖续跑。

费率 SHALL 是附录里的数据，计算由编排者按附录公式完成，不新增脚本。

#### Scenario: 预估不花子代理的钱
- **WHEN** 用 `--full --estimate` 运行
- **THEN** 记录里没有任何子代理派发；输出列出计数、估计的花费与墙钟，以及费率出处

### Requirement: 事实构建在前台运行

`/excavator` skill 跑自己的脚本时 SHALL 在前台运行，等脚本结束再继续。
- `lazy-analyze.mjs` 在大仓库上要几分钟，skill SHALL 把它的 shell 工具超时设为上限：Claude Code 的 Bash 工具是 600000 毫秒。
- skill MUST NOT 把这些脚本放到后台。headless 运行（`claude -p`，部署镜像的 full 模式）在编排者这一轮结束时退出，后台进程随之被杀，运行留下没有事实图的 `.excavator/`。
- 这条规则 SHALL 写在 skill 的总规则里，也写在跑 `lazy-analyze.mjs` 的两处：Lazy 模式与 Phase F1。

#### Scenario: 大仓库上的 headless 预估
- **WHEN** 在一个 Lazy 要约 3 分钟的仓库上，headless 运行 `/excavator --full --estimate`
- **THEN** 记录里 `lazy-analyze.mjs` 的调用在前台、超时为 600000 毫秒，没有放到后台的命令，运行走到预估报告

#### Scenario: 规则在动手的地方
- **WHEN** 读 SKILL.md 里 Lazy 模式与 Phase F1 运行 `lazy-analyze.mjs` 的段落
- **THEN** 每处都写明在前台运行、超时 600000 毫秒、不放到后台
