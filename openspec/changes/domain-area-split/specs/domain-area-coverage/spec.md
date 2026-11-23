## ADDED Requirements

### Requirement: 抽取不静默截断

`extract-domain-context.py` MUST NOT 按目录限制收入的文件数。总文件数与入口点数命中上限时，产物 SHALL 在 `truncated` 里写明被截掉的数量。每个收入的源文件 SHALL 有一条签名。产物整体超过大小预算时，MUST NOT 删减入口点或签名的条数。

#### Scenario: 大目录
- **WHEN** 一个目录里有 60 个源文件
- **THEN** 文件树含全部 60 个，`truncated.fileTree` 为 0

#### Scenario: 入口点很多
- **WHEN** 项目有 300 个入口点，产物超过 512 KB
- **THEN** 产物里仍有 300 个入口点，每个源文件都有签名

### Requirement: 按模块分区

`split-domain-areas.mjs <项目根>` SHALL 把抽取产物里的非测试源文件按所在目录归成模块，按路径排序后装进字节预算与入口点预算都不超的区；单个模块超任一预算时 SHALL 按文件拆成连续的几段。每个文件 SHALL 恰好属于一个区。有知识图且调用者传了 `--graph` 时，每个区 SHALL 附上本区文件的图节点；`filePath` 解析后不在项目根内的图节点 MUST NOT 附上，SHALL 计数。

脚本 SHALL 先删除上一次的区目录与 `intermediate/domain-analysis.json`，再写清单与每区上下文，并生成本次运行的令牌。

#### Scenario: 守恒
- **WHEN** 对任意抽取产物分区
- **THEN** 所有区的文件清单之并等于非测试源文件全集，且两两不交

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

合并 SHALL 按区 id 顺序处理已接受的输出：id 相同的域合并为一个（数组字段取并集）；与已合并 id 冲突的流程与步骤改名为 `<id>--<区id>` 并同步改写本区的边；端点缺失的边丢弃并计数。传入别名文件时，脚本 SHALL 只执行源与目标都存在、目标不是别的别名的源、源不等于目标的条目，其余列入 `aliasesRejected`。合并结果 SHALL 写到 `intermediate/domain-analysis.json`，不含 `areaRun` 与 `skippedModules`。

#### Scenario: 两区同名域
- **WHEN** 两个区都输出 `domain:billing`
- **THEN** 合并结果只有一个 `domain:billing`，两区的流程都通过 `contains_flow` 挂在它下面

#### Scenario: 流程 id 冲突
- **WHEN** 两个区都输出 `flow:create-order`
- **THEN** 第二个区的那条改名为 `flow:create-order--<区id>`，它的步骤边指向改名后的 id

### Requirement: 覆盖报告

合并 SHALL 写 `<数据目录>/reports/domain-coverage.json`，逐区、逐模块、逐个有入口点的文件给出状态。每个模块 SHALL 恰好落进 `covered`、`declared-skip`、`silent-zero`、`no-candidates` 之一，四桶之和 SHALL 等于模块总数。步骤按 `filePath`、再按 `nodeIds` 经区上下文里的图节点定位到文件；`filePath` 越出项目根的步骤 MUST NOT 被定位，SHALL 计数。

#### Scenario: 单分析器漏模块
- **WHEN** 多模块夹具有 24 个 handler 模块，一份分析只为其中 16 个写了流程
- **THEN** 报告的 `silent-zero` 恰好是另外 8 个，`uncitedCandidateFiles` 含它们的文件

#### Scenario: 声明跳过
- **WHEN** 区输出把一个没有流程的模块列进 `skippedModules` 并给出理由
- **THEN** 该模块为 `declared-skip`，不是 `silent-zero`

### Requirement: 每区一个分析器

`/excavator-domain` SHALL 先跑抽取与分区，再为每个区派一个 domain-analyzer，只给它该区的上下文与输出路径，然后跑合并；合并退出码为 3 时 SHALL 对被拒或缺失的区重派一次并重跑合并，仍不为 0 时继续并向用户报告这些区。Phase 4.5 的锚定与校验 SHALL 在合并结果上原样运行。分析器提示词 MUST NOT 规定全项目的域或流程数量上限。

#### Scenario: 发布不落进重复目录
- **WHEN** skill 发布步骤锚定
- **THEN** 报告复制到 `<数据目录>/reports/`，不出现 `<数据目录>/excavator/`
