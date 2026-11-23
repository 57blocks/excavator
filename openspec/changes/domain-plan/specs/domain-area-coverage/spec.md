## ADDED Requirements

### Requirement: 域规划

`/excavator-domain` SHALL 对全项目做一次域规划：`plan-domains.mjs prepare` 从分区清单与抽取上下文写出固定形状的规划输入，列出每个模块（路径、文件名、入口点样本、导出名，样本有上界并写明省略数）；一个规划代理输出域清单（`kind` 为 `business` 或 `support`）、模块到域的归属与跨域关系；`plan-domains.mjs accept` SHALL 校验后才接受：令牌等于本次令牌、要规划的每个模块恰好归属一次且不含未知模块、归属目标是规划里的域、每个新域至少持有一个模块、业务域数不超过 `max(3, ⌈√模块数⌉)`、支撑域数不超过 3。任一条不过 SHALL 整份拒收、退出码 3、写明原因。接受的规划 SHALL 写到 `<数据目录>/domain-plan.json`，带模块集合摘要。

#### Scenario: 漏归属一个模块
- **WHEN** 规划输出的 `assignments` 少了一个模块
- **THEN** `accept` 退出 3，原因里点名该模块，不写 `domain-plan.json`

#### Scenario: 业务域过多
- **WHEN** 88 个模块的项目，规划输出 11 个业务域
- **THEN** `accept` 退出 3，原因写明上界 10

### Requirement: 规划复用

`plan-domains.mjs prepare` SHALL 按模块集合摘要（排好序的模块路径的 sha256）复用已有的 `domain-plan.json`：摘要相同 SHALL 判为 `reused`，不写规划输入、不派规划代理；模块集合不同时 SHALL 剪掉已不存在的模块并去掉因此变空的域，没有新模块则判为 `reused`，有新模块则判为 `extend`，只把新模块列为待规划，已有归属与已有域 MUST NOT 被规划代理改动（`accept` 拒收任何改动）。只有 `--replan` SHALL 重新规划全部模块。

#### Scenario: 模块集合不变
- **WHEN** 同一项目第二次运行，模块集合与上次相同
- **THEN** `prepare` 打印 `plan=reused`，合并得到的域 id、名字与模块归属与上次完全相同

#### Scenario: 新增一个目录
- **WHEN** 项目新增一个源码目录
- **THEN** `prepare` 判为 `extend`，规划输入里只有该目录 `assigned` 为空，其余模块保持原域

### Requirement: 流程挂接与守恒

合并 SHALL 按规则把每条流程挂到域：按 `flow_step` 权重找第一个能定位到模块的步骤，挂到该模块在规划里的域；没有可定位步骤时，若流程的 `domainMeta.module` 是本区持有的模块则挂到它的域；否则记为 `unplaced`，流程与步骤保留、不生成 `contains_flow`，并在报告中计数。合并 SHALL 检查守恒：每个已接受区的流程 id、步骤 id 与 `flow_step` 边（按改名映射后）在合并结果中各出现恰好一次；不守恒时退出码 SHALL 为 4，且 MUST NOT 写出合并结果。

#### Scenario: 首个步骤决定域
- **WHEN** 一条流程的第一个步骤在 `modules/orders`、第二个在 `modules/payments`，规划把两者分到不同的域
- **THEN** 该流程挂在 `modules/orders` 的域下

#### Scenario: 合并丢了一个步骤
- **WHEN** 合并结果比输入少一个步骤
- **THEN** `checkConservation` 报 `ok: false` 并点名该步骤

## MODIFIED Requirements

### Requirement: 合并区输出

合并 SHALL 按区 id 顺序处理已接受的输出：与已合并 id 冲突的流程与步骤改名为 `<id>--<区id>` 并同步改写本区的边；端点缺失的边丢弃并计数。域节点 SHALL 只来自接受的规划（`domainMeta.kind`、`domainMeta.modules`），规划的模块集合 MUST 等于本次分区清单的模块集合，否则合并报错退出。区输出里的域节点、`contains_flow` 与 `cross_domain` 边 SHALL 被忽略并计数；`contains_flow` 边由合并按挂接规则生成，`cross_domain` 边来自规划。合并 MUST NOT 接受别名文件。合并结果 SHALL 写到 `intermediate/domain-analysis.json`，不含 `areaRun` 与 `skippedModules`。

#### Scenario: 两区同名域
- **WHEN** 两个区分别为 `modules/invoices` 与 `modules/payments` 写了流程，规划把这两个模块归到 `domain:billing`
- **THEN** 合并结果只有一个 `domain:billing`，两区的流程都通过 `contains_flow` 挂在它下面

#### Scenario: 分析器自己写了域
- **WHEN** 一个区的输出含域节点 `domain:invoice-schema` 与指向它的 `contains_flow` 边
- **THEN** 合并结果没有 `domain:invoice-schema`，忽略计数加一，流程按挂接规则挂到规划的域

#### Scenario: 流程 id 冲突
- **WHEN** 两个区都输出 `flow:create-order`
- **THEN** 第二个区的那条改名为 `flow:create-order--<区id>`，它的步骤边指向改名后的 id

### Requirement: 每区一个分析器

`/excavator-domain` SHALL 先跑抽取与分区，再做域规划（规划未被复用时派一个规划代理），并为每个区派一个 domain-analyzer，只给它该区的上下文与输出路径；规划代理与区分析器可以同时运行。规划被拒时 SHALL 重派规划代理一次，仍被拒 SHALL 停止且不保存域图。然后跑合并；合并退出码为 3 时 SHALL 对被拒或缺失的区重派一次并重跑合并，仍不为 0 时继续并向用户报告这些区。编排者 MUST NOT 自己写或改规划、区输出或别名文件。Phase 4.5 的锚定与校验 SHALL 在合并结果上原样运行。分析器提示词 MUST NOT 规定全项目的域或流程数量上限，Option C 的分析器 MUST NOT 写域节点。

#### Scenario: 发布不落进重复目录
- **WHEN** skill 发布步骤锚定
- **THEN** 报告复制到 `<数据目录>/reports/`，不出现 `<数据目录>/excavator/`

#### Scenario: 规划两次被拒
- **WHEN** 规划代理的输出两次都被 `accept` 拒收
- **THEN** skill 停止，不写 `domain-graph.json`，并报告拒收原因
