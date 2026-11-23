## MODIFIED Requirements

### Requirement: 域规划

`/excavator-domain` SHALL 对全项目做一次域规划：`plan-domains.mjs prepare` 从分区清单与抽取上下文写出固定形状的规划输入，列出每个模块（路径、文件名、入口点样本、导出名，样本有上界并写明省略数）；一个规划代理输出域清单（`kind` 为 `business` 或 `support`）、模块到域的归属、混合模块清单 `mixed`（横跨两个以上业务领域的模块）与跨域关系；`plan-domains.mjs accept` SHALL 校验后才接受：令牌等于本次令牌、要规划的每个模块恰好归属一次且不含未知模块、归属目标是规划里的域、每个新域至少持有一个模块、业务域数不超过 `max(3, ⌈√模块数⌉)`、支撑域数不超过 3、`mixed` 只含本次要规划的模块且不重复。任一条不过 SHALL 整份拒收、退出码 3、写明原因。接受的规划 SHALL 写到 `<数据目录>/domain-plan.json`（格式 `excavator-domain-plan/2`），带模块集合摘要与排好序的 `mixed`；其他格式的已存规划 SHALL 按全新规划处理。

#### Scenario: 漏归属一个模块
- **WHEN** 规划输出的 `assignments` 少了一个模块
- **THEN** `accept` 退出 3，原因里点名该模块，不写 `domain-plan.json`

#### Scenario: 业务域过多
- **WHEN** 88 个模块的项目，规划输出 11 个业务域
- **THEN** `accept` 退出 3，原因写明上界 10

#### Scenario: 混合模块标记了未知模块
- **WHEN** 规划输出的 `mixed` 含一个不在规划输入里的路径
- **THEN** `accept` 退出 3，原因里点名该路径

#### Scenario: 旧格式的规划
- **WHEN** 已存的 `domain-plan.json` 是 `excavator-domain-plan/1`
- **THEN** `prepare` 判为 `new` 并写明原因

### Requirement: 规划复用

`plan-domains.mjs prepare` SHALL 按模块集合摘要（排好序的模块路径的 sha256）复用已有的 `domain-plan.json`：摘要相同 SHALL 判为 `reused`，不写规划输入、不派规划代理；模块集合不同时 SHALL 剪掉已不存在的模块（连同它们的 `mixed` 标记）并去掉因此变空的域，没有新模块则判为 `reused`，有新模块则判为 `extend`，只把新模块列为待规划，已有归属、已有域与已有模块的 `mixed` 标记 MUST NOT 被规划代理改动（`accept` 拒收任何改动）。只有 `--replan` SHALL 重新规划全部模块。

#### Scenario: 模块集合不变
- **WHEN** 同一项目第二次运行，模块集合与上次相同
- **THEN** `prepare` 打印 `plan=reused`，合并得到的域 id、名字、模块归属与混合标记与上次完全相同

#### Scenario: 新增一个目录
- **WHEN** 项目新增一个源码目录
- **THEN** `prepare` 判为 `extend`，规划输入里只有该目录 `assigned` 为空，其余模块保持原域与原标记

#### Scenario: 扩展时改已有标记
- **WHEN** 扩展模式的规划输出把一个已有模块列进 `mixed`
- **THEN** `accept` 退出 3，原因写明已有模块的标记不能改

### Requirement: 流程挂接与守恒

合并 SHALL 先求每条流程的起始模块：按 `flow_step` 权重找第一个能定位到模块的步骤所在模块；没有可定位步骤时，若流程的 `domainMeta.module` 是本区持有的模块则取它；否则记为 `unplaced`，流程与步骤保留、不生成 `contains_flow`，并在报告中计数。起始模块是单一业务域模块（不在 `mixed` 里、归在业务域）时，流程 SHALL 挂到该模块的域，流程写的 `domainMeta.domain` SHALL 被忽略并计入 `choicesIgnored`，合并后的流程节点 MUST NOT 保留未被采用的 `domainMeta.domain` 或 `domainMeta.domainReason`。起始模块在 `mixed` 里或归在支撑域时，流程 SHALL 挂到它的 `domainMeta.domain`（必须是规划里的域 id），并在覆盖报告 `flows.choices` 里记下选择与 `domainMeta.domainReason`；没写理由的选择 SHALL 计入 `choicesWithoutReason`；没写或写了清单外的值时 SHALL 回落到起始模块的域，按 `missing`/`invalid` 计数并逐条打印，清单外的值只记在报告里、从合并后的流程节点上删掉。覆盖报告 SHALL 给出 `flows.support`：挂在支撑域的流程数、其中经分析器选择且写了理由的数、其余（回落或选择没写理由）的数与这些流程的 id，后者逐条打印 `support-unchosen`。合并 SHALL 检查守恒：每个已接受区的流程 id、步骤 id 与 `flow_step` 边（按改名映射后）在合并结果中各出现恰好一次；不守恒时退出码 SHALL 为 4，且 MUST NOT 写出合并结果。

#### Scenario: 首个步骤决定域
- **WHEN** 一条流程的第一个步骤在 `modules/orders`、第二个在 `modules/payments`，规划把两者分到不同的业务域，两者都不是混合模块
- **THEN** 该流程挂在 `modules/orders` 的域下，即使它写了另一个 `domainMeta.domain`

#### Scenario: 混合目录里的业务流程
- **WHEN** 一条流程起始于规划标为 `mixed` 的 `legacy/routes`，分析器选了 `domain:invoices` 并写了理由
- **THEN** 该流程挂在 `domain:invoices` 下，`flows.choices` 里有这一行与理由

#### Scenario: 支撑目录里没有选择
- **WHEN** 一条流程起始于归在支撑域的 `jobs/cmd`，没有写 `domainMeta.domain`
- **THEN** 该流程挂在 `jobs/cmd` 的支撑域下，回落计数 `missing` 加一，`flows.support.unchosen` 加一并列出该流程

#### Scenario: 选了支撑域却没写理由
- **WHEN** 一条流程起始于归在支撑域的 `jobs/cmd`，选了该支撑域但没写 `domainMeta.domainReason`
- **THEN** 该流程挂在该支撑域下，`choicesWithoutReason` 加一，`flows.support.unchosen` 加一并打印 `support-unchosen <flow> module=jobs/cmd reason=no-reason`

#### Scenario: 选了清单外的域
- **WHEN** 一条需选域流程写了 `domain:nowhere`
- **THEN** 该流程回落到起始模块的域，`flows.choices` 记下 `chosen: domain:nowhere`，合并后的流程节点上没有 `domainMeta.domain`

#### Scenario: 合并丢了一个步骤
- **WHEN** 合并结果比输入少一个步骤
- **THEN** `checkConservation` 报 `ok: false` 并点名该步骤

### Requirement: 每区一个分析器

`/excavator-domain` SHALL 先跑抽取与分区，再做域规划：规划未被复用时派一个规划代理并接受它，规划被拒时 SHALL 重派规划代理一次，仍被拒 SHALL 停止且不保存域图。规划确定后（复用或接受），`plan-domains.mjs` SHALL 把域清单（id、kind、名字、摘要）与本区每个模块的域及是否需选域写进每个区上下文的 `domainPlan`；之后才为每个区派一个 domain-analyzer，只给它该区的上下文与输出路径。然后跑合并；合并退出码为 3 时 SHALL 对被拒或缺失的区重派一次并重跑合并，仍不为 0 时继续并向用户报告这些区。编排者 MUST NOT 自己写或改规划、区上下文、区输出或别名文件。Phase 4.5 的锚定与校验 SHALL 在合并结果上原样运行。分析器提示词 MUST NOT 规定全项目的域或流程数量上限，Option C 的分析器 MUST NOT 写域节点，并 SHALL 为起始于需选域模块的每条流程从 `domainPlan.domains` 选一个域 id 写进 `domainMeta.domain`、附一句理由。

#### Scenario: 发布不落进重复目录
- **WHEN** skill 发布步骤锚定
- **THEN** 报告复制到 `<数据目录>/reports/`，不出现 `<数据目录>/excavator/`

#### Scenario: 规划两次被拒
- **WHEN** 规划代理的输出两次都被 `accept` 拒收
- **THEN** skill 停止，不写 `domain-graph.json`，并报告拒收原因

#### Scenario: 区上下文携带规划
- **WHEN** 规划被接受
- **THEN** 每个区上下文的 `domainPlan.modules` 恰好是本区的模块，混合模块与支撑域模块的 `choose` 为真，其余为假
