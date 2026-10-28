## MODIFIED Requirements

### Requirement: 运行与产物由确定性检查判定

`full` 模式在模型运行结束后 SHALL 分两类检查：
- **运行本身**：运行结果没有报告错误，没有被拒绝的权限请求，没有失败的子 agent，没有超时，没有触及花费上限，且这些字段在运行结果中确实存在。任一项不满足时，运行 SHALL 以运行失败的退出码结束。
- **产物**：产物记录的 commit 等于运行前的 HEAD；产物记录的模型等于本次请求的模型 ID，而不是 `unknown`。模型记录在 `semantic-graph.json` 的 `model` 字段（Full 语义隔离的布局里，事实图 `knowledge-graph.jsonl` 不由模型写入，不记模型）。`semantic-graph.json` 不存在、读不出或没有 `model` 时，同样视为不满足，原因写明读的是哪个文件。此外，`semantic-graph.json` 的 `factDigest` SHALL 等于本次运行刚写出的事实图的 `project.factsDigest`；任一边缺失或不是非空字符串，同样不满足，原因写明两个文件和两个值。任一项不满足时，运行 SHALL 以加载或产物检查失败的退出码结束。

模型 ID 的记录 SHALL 来自运行时的环境：语义图写入时取 `EXCAVATOR_MODEL`，未设置则取 `ANTHROPIC_MODEL`（运行器只设置后者），两者都没有才记 `unknown`。

两类情况下，摘要都 SHALL 写明原因，已有产物 SHALL 保留。

#### Scenario: 子 agent 失败
- **WHEN** 运行结果报告至少一个子 agent 失败
- **THEN** 运行以运行失败的退出码结束，摘要写明失败的子 agent 数

#### Scenario: 模型记录为 unknown
- **WHEN** 产物记录的模型为 `unknown`
- **THEN** 运行以加载或产物检查失败的退出码结束

#### Scenario: 模型调用被拒
- **WHEN** 运行结果以模型调用错误结束（例如 Bedrock 返回 403，因账号未开通该模型）
- **THEN** 运行以运行失败的退出码结束，摘要的原因里给出模型服务返回的 HTTP 状态与原始错误信息，而不只是 Claude Code 的通用提示

#### Scenario: 模型记录在语义图里
- **GIVEN** a finished Full run whose `knowledge-graph.jsonl` has no `project.model` and whose `semantic-graph.json` records `model` equal to the requested model ID
- **WHEN** the runner checks the product
- **THEN** the product check passes on the model; the same run with `model` `unknown`, absent, or a different ID fails it, and a missing `semantic-graph.json` fails it naming that file

#### Scenario: 只设了 ANTHROPIC_MODEL
- **GIVEN** a Full run started by the runner, which sets `ANTHROPIC_MODEL` and not `EXCAVATOR_MODEL`
- **WHEN** the skill writes `semantic-graph.json`
- **THEN** its `model` is the value of `ANTHROPIC_MODEL`; when `EXCAVATOR_MODEL` is also set that value wins, and with neither set it is `unknown`

#### Scenario: 语义图是上一次运行留下的
- **GIVEN** a Full run after which `meta.json` is at HEAD and `semantic-graph.json` from the same model is still the previous run's, so its `factDigest` differs from the fact graph's `factsDigest` (F3 never ran or its write failed)
- **WHEN** the runner checks the product
- **THEN** the product check fails, naming `semantic-graph.json` and `knowledge-graph.jsonl` and both digest values; a missing or non-string digest on either side fails it too, and equal digests with a matching model pass

### Requirement: full 模式在源码未变时跳过

`full` 模式下，当目标仓库现有产物是 full 流程产出的、其记录的 commit 等于当前 HEAD，、其记录的模型等于本次请求的模型，且未要求强制重跑时，运行 SHALL 以成功退出码结束并在摘要中标为跳过，MUST NOT 启动 Claude Code，MUST NOT 改动任何产物。现有产物只是 Lazy 产出时，即使 commit 相同也 MUST NOT 跳过。

「full 流程产出」按 `semantic-graph.json` 判断：该文件存在且带非空的 `factDigest`。「未变」要求这个 `factDigest` 等于事实图 `project.factsDigest`，语义图记录的 `model` 等于本次请求的模型，且 `meta.json` 记录的 commit 等于 HEAD。有 full 产物但记录的模型不同（含 `unknown`、缺失）时，运行 SHALL 以强制全量重建启动（增量会沿用另一个模型建的架构，其产物又会在产物检查里因模型不符而失败），原因写明记录的与请求的模型。模型相同而事实图或 HEAD 变了时，运行 SHALL 走增量；没有 full 产物时才全量重建。事实图的 `project.pipelineVersion` 不是判据：新布局的 Full 不改写事实图。

#### Scenario: HEAD 未变
- **WHEN** 目标仓库现有的 full 产物记录的 commit 与 HEAD 相同，其语义图的 `factDigest` 等于事实图的 `factsDigest`，且未要求强制重跑
- **THEN** 运行以成功退出码结束，摘要标为跳过，没有模型调用，产物逐字节不变

#### Scenario: 只有 Lazy 产物
- **WHEN** 目标仓库现有产物由 Lazy 产出（没有 `semantic-graph.json`），记录的 commit 与 HEAD 相同，以 `full` 模式启动
- **THEN** 运行不跳过，正常启动 full 流程

#### Scenario: 有语义图但事实图变了
- **WHEN** 目标仓库有 `semantic-graph.json`，但它的 `factDigest` 不等于事实图当前的 `factsDigest`，或 commit 不等于 HEAD
- **THEN** 运行不跳过，以增量方式启动 full 流程，而不是强制全量重建

#### Scenario: 模型不同的 full 产物
- **GIVEN** a full product whose `factDigest` equals the fact graph's `factsDigest` and whose commit is HEAD, but whose `model` is `unknown`, absent, or a model other than the requested one
- **WHEN** the runner starts in `full` mode without force
- **THEN** it does not skip and starts a forced full rebuild, the reason naming the recorded and the requested model; once that run records the requested model, the next run with nothing changed skips

#### Scenario: 语义图读不出
- **WHEN** `semantic-graph.json` 不是合法 JSON 或没有 `factDigest`
- **THEN** 它不算 full 产物，运行不跳过
