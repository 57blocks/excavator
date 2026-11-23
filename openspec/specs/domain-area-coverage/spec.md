# domain-area-coverage Specification

## Purpose
`/excavator-domain` 按区派发领域分析、合并区输出，并给出逐区、逐模块的覆盖报告，使没有流程的模块可见。

## Requirements

### Requirement: 抽取不静默截断

`extract-domain-context.py` MUST NOT 按目录限制收入的文件数。总文件数与入口点数命中上限时，产物 SHALL 在 `truncated` 里写明被截掉的数量。每个收入的源文件 SHALL 有一条签名。产物整体超过大小预算时，MUST NOT 删减入口点或签名的条数。

#### Scenario: 大目录
- **WHEN** 一个目录里有 60 个源文件
- **THEN** 文件树含全部 60 个，`truncated.fileTree` 为 0

#### Scenario: 入口点很多
- **WHEN** 项目有 300 个入口点，产物超过 512 KB
- **THEN** 产物里仍有 300 个入口点，每个源文件都有签名

### Requirement: 按模块分区

`split-domain-areas.mjs <项目根>` SHALL 把抽取产物里的非测试源文件按所在目录归成模块，按路径排序后装进字节预算与入口点预算都不超的区；单个模块超任一预算时 SHALL 按文件拆成连续的几段。每个文件 SHALL 恰好属于一个区。有知识图且调用者传了 `--graph` 时，每个区 SHALL 附上本区文件的图节点；`filePath` 解析后不在项目根内的图节点 MUST NOT 附上，SHALL 计数；图节点所在的非测试文件不在抽取产物里时，该文件 SHALL 照样按所在目录进模块并计数。区上下文 MUST NOT 含随项目增长的全项目索引。

脚本 SHALL 先删除上一次的区目录与 `intermediate/domain-analysis.json`，再写清单与每区上下文，并生成本次运行的令牌。

#### Scenario: 守恒
- **WHEN** 对任意抽取产物分区
- **THEN** 所有区的文件清单之并等于非测试源文件全集，且两两不交

#### Scenario: 抽取脚本不扫的文件
- **WHEN** 知识图里有 `web/src/App.vue` 的节点，抽取产物里没有这个文件
- **THEN** 模块 `web/src` 出现在清单里，该节点附在持有它的区上

#### Scenario: 超预算模块
- **WHEN** 一个模块的材料超过预算
- **THEN** 它被拆成至少两个区，每段标出段号

#### Scenario: 清掉旧输出
- **WHEN** 区目录里有上一次运行留下的区输出，`intermediate/domain-analysis.json` 也存在
- **THEN** 分区后两者都不存在

### Requirement: 区输出的新鲜度

每个区的分析器输出 MUST 在顶层带 `areaRun: {areaId, token}`，且与清单一致。`merge-domain-areas.mjs` SHALL 把令牌或区 id 不符、缺 `areaRun` 的输出记为 `rejected-stale`，解析失败记为 `rejected-parse`，不存在记为 `missing`；这些区的内容 MUST NOT 进入合并结果。有任一区不被接受时，退出码 SHALL 为 3，合并结果与覆盖报告照写。

#### Scenario: 拷贝旧文件
- **WHEN** 一个区的输出是上一次运行的 `domain-graph.json` 原样拷贝
- **THEN** 该区为 `rejected-stale`，退出码为 3

### Requirement: 合并区输出

合并 SHALL 按区 id 顺序处理已接受的输出：与已合并 id 冲突的流程与步骤改名为 `<id>--<区id>`（该 id 也已被占用时依次加 `-2`、`-3`…，直到无冲突）并同步改写本区的边；端点缺失的边丢弃并计数。域节点 SHALL 只来自接受的规划（`domainMeta.kind`、`domainMeta.modules`），规划的模块集合 MUST 等于本次分区清单的模块集合，否则合并报错退出。区输出里的域节点、`contains_flow` 与 `cross_domain` 边 SHALL 被忽略并计数；`contains_flow` 边由合并按挂接规则生成，`cross_domain` 边来自规划。合并 MUST NOT 接受别名文件。合并结果 SHALL 写到 `intermediate/domain-analysis.json`，不含 `areaRun` 与 `skippedModules`。

#### Scenario: 两区同名域
- **WHEN** 两个区分别为 `modules/invoices` 与 `modules/payments` 写了流程，规划把这两个模块归到 `domain:billing`
- **THEN** 合并结果只有一个 `domain:billing`，两区的流程都通过 `contains_flow` 挂在它下面

#### Scenario: 分析器自己写了域
- **WHEN** 一个区的输出含域节点 `domain:invoice-schema` 与指向它的 `contains_flow` 边
- **THEN** 合并结果没有 `domain:invoice-schema`，忽略计数加一，流程按挂接规则挂到规划的域

#### Scenario: 流程 id 冲突
- **WHEN** 两个区都输出 `flow:create-order`
- **THEN** 第二个区的那条改名为 `flow:create-order--<区id>`，它的步骤边指向改名后的 id

### Requirement: 覆盖报告

合并 SHALL 写 `<数据目录>/reports/domain-coverage.json`，逐区、逐模块给出状态，并列出没有步骤引用的有入口点文件，带上分区脚本的计数。每个模块 SHALL 恰好落进 `covered`、`declared-skip`、`silent-zero`、`no-candidates` 之一，四桶之和 SHALL 等于模块总数。步骤按 `filePath`、再按 `nodeIds` 经区上下文里的图节点定位到文件；`filePath` 越出项目根的步骤 MUST NOT 被定位（也不经 `nodeIds`），SHALL 计入 `steps.fileOutsideRoot`。拆段模块的每一段，若有入口点文件却没有步骤定位到它、模块也没被声明跳过，SHALL 列入持有该段的区的 `silentZeroParts`。

#### Scenario: 单分析器漏模块
- **WHEN** 多模块夹具有 24 个 handler 模块，一份分析只为其中 16 个写了流程
- **THEN** 报告的 `silent-zero` 恰好是另外 8 个，`candidateFiles.uncited` 含它们的文件

#### Scenario: 声明跳过
- **WHEN** 区输出把一个没有流程的模块列进 `skippedModules` 并给出理由
- **THEN** 该模块为 `declared-skip`，不是 `silent-zero`

### Requirement: 每区一个分析器

`/excavator-domain` SHALL 先跑抽取与分区，再做域规划（规划未被复用时派一个规划代理），并为每个区派一个 domain-analyzer，只给它该区的上下文与输出路径；规划代理与区分析器可以同时运行。规划被拒时 SHALL 重派规划代理一次，仍被拒 SHALL 停止且不保存域图。然后跑合并；合并退出码为 3 时 SHALL 对被拒或缺失的区重派一次并重跑合并，仍不为 0 时继续并向用户报告这些区。编排者 MUST NOT 自己写或改规划、区输出或别名文件。Phase 4.5 的锚定与校验 SHALL 在合并结果上原样运行。分析器提示词 MUST NOT 规定全项目的域或流程数量上限，Option C 的分析器 MUST NOT 写域节点。

#### Scenario: 发布不落进重复目录
- **WHEN** skill 发布步骤锚定
- **THEN** 报告复制到 `<数据目录>/reports/`，不出现 `<数据目录>/excavator/`

#### Scenario: 规划两次被拒
- **WHEN** 规划代理的输出两次都被 `accept` 拒收
- **THEN** skill 停止，不写 `domain-graph.json`，并报告拒收原因

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
