## ADDED Requirements

### Requirement: 在计划之上写出完整的 skopository

`skopo-create` SHALL 在状态为 `planned` 的产物目录上，从写 spec 开始；状态为 `none` 或 `started` 时 SHALL 先按 `skopo-plan` 的流程得到计划。开始写之前 SHALL 删除 `$OUT/skopo`。它 SHALL 依次写 spec（逐域：先字词与原则，再主题文件）、每个产品的产品绑定与技术绑定、README、有来源说明理由的 rationale，每写完一域或一类绑定就分配 ID 并 lint。它 MUST NOT 写 lock，MUST NOT 改动目标仓库里的任何文件。

#### Scenario: 计划要求范围
- **WHEN** 计划写明系统太大、需要 `--scope`，而本次没有给
- **THEN** skill 不写 skopository，告诉用户带 `--scope` 重跑

#### Scenario: 已经写完
- **WHEN** 状态为 `created`
- **THEN** skill 不重写，提示用 `--fresh`

### Requirement: lint 到干净并整理问题

`skopo-create` SHALL 反复分配 ID 并经运行记录脚本 lint，直到没有错误；五轮之后仍有错误时 SHALL 停止修改并把剩余错误记进 notes。问题清单 SHALL 是一张表：编号、类别（security、money、regulation、promise、behaviour、documentation 之一）、中立的问题、互相矛盾的来源、相关 statement；另有一节没有记录理由的决定。问题与 notes 里引用的每个 ID SHALL 在 skopository 里存在。收尾时 SHALL 写出 `metrics.json` 并在 `run.json` 记下结束时间。

#### Scenario: 引用了不存在的 ID
- **WHEN** `questions.md` 引用了一个 skopository 没有的 ID
- **THEN** lint 报告这一行，skill 在收尾前改正

### Requirement: 产物可由脚本判定

`skopo.mjs verdict --stage create` SHALL 在以下全部成立时退出 0，否则退出 1 并逐条打印原因：`run.json` 为本格式且源码修订等于当前、计划已记录且没有 `stopped`、`skopo/skopo.json` 存在、对 `skopo/` 重跑 lint 没有错误、运行数据里的 ID 引用都存在、`questions.md` 存在、`run.json` 有结束时间。它 MUST NOT 读模型的自述。

#### Scenario: 锚点坏了
- **WHEN** skopository 里一条 statement 的锚点不是合法 ID
- **THEN** `verdict` 退出 1，并打印 lint 的错误行
