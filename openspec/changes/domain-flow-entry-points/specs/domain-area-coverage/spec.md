## ADDED Requirements

### Requirement: 流程引用事实入口点

`extract-domain-context.py` SHALL 给每个 `source: "script"` 的入口点写 `id` 与 `group`：`id` 由入口点种类、方法与路径确定性地组成，撞名时依次按注册文件所在模块、按事实排序中的序号消歧，消歧 MUST 只依赖事实集合；`group` 是同一处理者（同一节点、同一模块文件或同一内联处理者）的入口点中排序第一者的 `id`，没有处理者键的入口点自成一组。分析器（Option C）起始于事实入口点的流程 SHALL 在 `domainMeta.entryPointIds` 写所引用的 id。`merge-domain-areas.mjs` 接受区输出时 SHALL 核对：字段不是字符串数组（`malformed`）、id 不是本区事实入口点（`unknown`）、一个流程引用多于一个组（`mixed-groups`）、一个组被本区多于一个流程引用（`shared-group`），任一成立该区记为 `rejected-entry-point`（同时有选域问题时记为 `rejected-choice`），内容 MUST NOT 进入合并结果，并逐条打印 `rejected-entry-point <区> <流程> problem=<…> ids=<…>`。有合法引用的流程，合并 SHALL 把流程 id 改为 `flow:` 加组首 id 去掉 `ep:` 的部分，把 `domainMeta.entryPointIds` 改为按事实顺序的引用、`entryPoint` 改为事实里的方法与路径、`entryType` 改为 `http`（界面路由为 `manual`），起始模块 SHALL 取组所在文件的模块；守恒检查 MUST 经同一张改名表核对。`--accept-unchosen` SHALL 按固定规则清洗无效引用并计入 `citationsDropped`。区上下文的 `check` SHALL 另为本区每个既没被引用也没被跳过的事实入口点打印 `uncovered-entry-point` 行，且不因此拒绝。

#### Scenario: 两次运行名字不同、引用同一组
- **WHEN** 两次运行的区输出分别写了 `flow:create-order` 与 `flow:order-submission`，都引用 `ep:http.post-orders`
- **THEN** 两次合并结果里该流程的 id 都是 `flow:http.post-orders`，`entryPoint` 都是 `POST /orders`

#### Scenario: 引用顺序与组内成员不影响 id
- **WHEN** 同一处理者注册为 `GET /a` 与 `POST /a`，一次运行引用 `[POST, GET]`，另一次只引用 `POST`
- **THEN** 两次的流程 id 都由组首 `GET /a` 派生，`entryPointIds` 都按事实顺序写出所引用的 id

#### Scenario: 编造或越区的 id
- **WHEN** 一个流程引用了本区上下文里没有的 id
- **THEN** 该区为 `rejected-entry-point`，打印的行带 `problem=unknown` 与该 id，合并结果没有该区的流程

#### Scenario: 一个组拆成两个流程
- **WHEN** 同区两个流程引用了同一组的入口点
- **THEN** 该区为 `rejected-entry-point`，第二个流程的问题为 `shared-group`

#### Scenario: 撞名的入口点
- **WHEN** 两个服务目录各注册了 `GET /health`
- **THEN** 两个入口点的 id 分别带各自注册文件所在模块的后缀，且与哪些入口点被引用无关

### Requirement: 每个事实入口点一个覆盖桶

覆盖报告 SHALL 带 `entryPointCoverage`，每个事实入口点恰好落一个桶：`area-not-accepted`（所在区未被接受）、`in-flow`（自己或同组被合并后的流程引用）、`declared-skip`（自己在 `skippedEntryPoints` 里带非空理由，或所在模块被声明跳过）、`silent`（以上都不是）、`outside-areas`（不在任何模块里）。`silent` 的入口点 SHALL 逐条列出并打印 `silent-entry-point` 行。各桶之和 MUST 等于事实入口点总数，该总数 MUST 等于分区脚本给出的期望数（各模块的脚本入口点数加不在任何模块里的 id 数），不等时合并 SHALL 以退出码 4 结束且不写合并结果。流程计数 SHALL 区分有锚（`anchored`）与无锚（`unanchored`）流程。

#### Scenario: 同组覆盖
- **WHEN** 一组含 `GET /a`、`POST /a`，流程只引用了 `GET /a`
- **THEN** 两个入口点都是 `in-flow`，`inFlowBy.cited` 为 1、`inFlowBy.group` 为 1

#### Scenario: 静默可见
- **WHEN** 一个事实入口点既没被引用，也没有跳过声明
- **THEN** 它落 `silent`，列在 `silent` 里，输出有一行 `silent-entry-point`，桶之和仍等于总数

#### Scenario: 没有事实入口点的流程
- **WHEN** 一个定时任务流程没有 `entryPointIds`
- **THEN** 它保留模型的 id，计入 `unanchored`

## MODIFIED Requirements

### Requirement: 覆盖报告

合并 SHALL 写 `<数据目录>/reports/domain-coverage.json`，逐区、逐模块给出状态，并列出没有步骤引用的有入口点文件，带上分区脚本的计数。每个模块 SHALL 恰好落进 `covered`、`declared-skip`、`silent-zero`、`no-candidates` 之一，四桶之和 SHALL 等于模块总数。有步骤落在模块里，或模块有入口点在 `entryPointCoverage` 里为 `in-flow`（`coveredBy: "entry-points"`），模块为 `covered`。`declared-skip` 只给有候选（脚本、正则或通过核对的模型入口点，或未识别文件）的模块：模块被写进 `skippedModules` 带理由，或模块的候选只有脚本入口点且每一个在 `entryPointCoverage` 里都是 `declared-skip`（行上记 `skippedBy: "entry-points"`，个数计入 `modulesSkippedByEntryPoints`）；没有候选的模块被声明跳过时 SHALL 落 `no-candidates`，该声明计入 `skippedModulesWithoutCandidates`。步骤按 `filePath`、再按 `nodeIds` 经区上下文里的图节点定位到文件；`filePath` 越出项目根的步骤 MUST NOT 被定位（也不经 `nodeIds`），SHALL 计入 `steps.fileOutsideRoot`。拆段模块的每一段，若有入口点文件却没有步骤定位到它、模块也没被声明跳过，SHALL 列入持有该段的区的 `silentZeroParts`。

#### Scenario: 单分析器漏模块
- **WHEN** 多模块夹具有 24 个 handler 模块，一份分析只为其中 16 个写了流程
- **THEN** 报告的 `silent-zero` 恰好是另外 8 个，`candidateFiles.uncited` 含它们的文件

#### Scenario: 声明跳过
- **WHEN** 区输出把一个有入口点、没有流程的模块列进 `skippedModules` 并给出理由
- **THEN** 该模块为 `declared-skip`，不是 `silent-zero`

#### Scenario: 没有候选的模块被声明跳过
- **WHEN** 一个没有入口点也没有未识别文件的模块被分析器写进 `skippedModules`
- **THEN** 它落 `no-candidates`，`skippedModulesWithoutCandidates` 为 1

#### Scenario: 逐个入口点声明跳过的模块
- **WHEN** 一个没有流程、没有写进 `skippedModules` 的模块，候选只有脚本入口点，每一个都在 `skippedEntryPoints` 里带理由
- **THEN** 它落 `declared-skip`，`skippedBy` 为 `entry-points`；其中一个理由为空时它落 `silent-zero`
