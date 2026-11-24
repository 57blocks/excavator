## MODIFIED Requirements

### Requirement: 覆盖账本与 factDigest

事实层 SHALL 产出 `coverage` 与 `gaps`：每个被扫描输入落入恰好一个可见桶，解析失败的文件 SHALL 进入 coverage/gaps，MUST NOT 伪装成"无符号"或"已删除"。事实层 SHALL 产出 `factDigest`，且 `factDigest` SHALL 只覆盖规范化后的事实节点、事实边、coverage 与 gaps，排除 sourceRevision、时间戳、模型名及其他运行元数据。知识图的附加记录流（如 `entryPoints`）也进 `factsDigest`。

事实层 SHALL 另外产出 `structureDigest`，写在知识图文件头的 `project.structureDigest`：它只覆盖规范化后的事实节点与事实边，规范化与逐条哈希的方式与 `factDigest` 相同。coverage、gaps 与附加记录流的变化 MUST NOT 改变它；任何一个节点或一条边的变化 SHALL 改变它。读语义分层的地方以它判定分层是否由当前事实构建（见 `full-semantic-isolation`）。

#### Scenario: 解析失败产生可见 gap
- **WHEN** 某文件解析失败
- **THEN** 它出现在 coverage/gaps 中且带原因，而不是被静默丢弃或伪装成无符号

#### Scenario: factDigest 不含运行元数据
- **WHEN** 同一源码内容以不同时间戳/运行元数据构建两次
- **THEN** 两次得到相同的 factDigest

#### Scenario: 仅有名字的类方法记为可见 gap
- **WHEN** 抽取器只给出类方法的名字而无行号（如 TS/JS 的 `classes[].methods`），无法投影为节点
- **THEN** 这些方法记为可见 gap（`methods-name-only`），而不是从图中静默消失；已由 `functions[]` 带 owner 投影为节点的方法（Go/Rust/C++）不重复计入

#### Scenario: 附加记录流不改变 structureDigest
- **WHEN** 同一份节点与边，一次带入口点记录流与入口点缺口，一次不带
- **THEN** 两次的 `factsDigest` 不同，`structureDigest` 相同

#### Scenario: 节点或边变化改变 structureDigest
- **WHEN** 一个节点的行号变了，或少了一条边
- **THEN** `structureDigest` 变了

### Requirement: 读图谱的 skill 从最后写出分层的地方取分层

`finalize-incremental.mjs` 写出分层行（`PARTIAL_UPDATE` 与 `ARCHITECTURE_UPDATE`）时，SHALL 在图谱文件头的 `project` 里写 `layersFrom: "incremental"`，标明分层行是最后写出的分层；`lazy-analyze.mjs` 组装的 `project` MUST NOT 带这个字段。不重跑 Phase 4 时，`finalize-incremental.mjs` SHALL 按下面同一个顺序选起步分层（规则 4 时从空分层起步），MUST NOT 在有可用分层时从空分层起步。

读 `knowledge-graph.jsonl` 的 skill 取分层时，SHALL 按顺序用第一个适用的来源：
1. 图谱文件头的 `fields.project.layersFrom` 是 `incremental`：图谱里的 `{"record":"layer",…}` 行；
2. 否则，`semantic-graph.json`（`full-semantic-isolation` 规定 Full 的分层写在这里）存在，且它的 `structureDigest` 等于图谱文件头的 `fields.project.structureDigest`：它的 `layers`；
3. 否则，图谱里的分层行；
4. 否则没有可用的分层：skill SHALL 让模型照实说，MUST NOT 让模型按目录或文件名自行分组当作分层。

`semantic-graph.json` 存在而规则 1 或 3 适用时，skill MUST NOT 用它的分层，SHALL 让模型说明它们比分层行旧或来自别的事实，并建议运行 `/excavator --full`。语义图没有 `structureDigest`（`semantic-structure-digest` 之前写出）时，规则 2 不成立；skill SHALL 让模型说明这一点，并建议先运行 `/excavator`：节点与边未变时它会把语义图重绑。

查一个节点的分层 SHALL 按精确字符串匹配节点 ID；分层只列文件级节点，所以函数或类 SHALL 用同一 `filePath` 的文件级节点 ID。skill MUST NOT 让模型 grep `"layers"`：图谱里只有文件头带这个键，它的值是分层行的个数，不是分层。

#### Scenario: Full 运行之后
- **WHEN** Full 运行写出 `semantic-graph.json`，它的 `structureDigest` 等于当前图谱的 `structureDigest`，文件头没有 `layersFrom`
- **THEN** `excavator-onboard` 的 Architecture Layers 一节写语义图里的分层

#### Scenario: Full 之后又做增量更新
- **WHEN** Full 运行之后，增量更新加了 `src/c.ts` 并写出分层行；`structureDigest` 沿用上一次，仍等于语义图的 `structureDigest`，文件头的 `layersFrom` 是 `incremental`
- **THEN** `excavator-explain src/c.ts` 说出分层行里列出 `file:src/c.ts` 的分层，并说明语义图的分层比分层行旧

#### Scenario: Full 之后第一次增量更新的起步分层
- **WHEN** Full 运行把 `src/a.ts` 放进 Service 分层，之后的 `PARTIAL_UPDATE` 加了 `src/c.ts`
- **THEN** 写出的分层行里 `file:src/a.ts` 仍在 Service 分层，`file:src/c.ts` 按目录归入，不是所有文件都落进 `layer:other`

#### Scenario: 增量更新之后又跑 Full
- **WHEN** 增量更新之后再跑 Full：F1 重建文件头，没有 `layersFrom`，分层行原样带过来；F3 写出 `structureDigest` 等于新 `structureDigest` 的语义图
- **THEN** skill 用语义图的分层，不用带过来的分层行

#### Scenario: 函数所在的分层
- **WHEN** `excavator-explain` 解释 `src/auth/login.ts:verifyToken`，`file:src/auth/login.ts` 在 Service 分层里
- **THEN** 它按 `file:src/auth/login.ts` 查分层，说出 Service 分层与它的描述

#### Scenario: 语义图来自别的事实
- **WHEN** 文件头没有 `layersFrom`，`semantic-graph.json` 的 `structureDigest` 与当前图谱的 `structureDigest` 不同，图谱有分层行
- **THEN** skill 用分层行，并说明语义图的分层来自别的事实，建议运行 `/excavator --full`

#### Scenario: 没有分层
- **WHEN** 一个只跑过 Lazy 的项目没有 `semantic-graph.json`，图谱也没有分层行
- **THEN** `excavator-onboard` 的 Architecture Layers 一节写明没有分层，不出现自行分出的分层

#### Scenario: skill 回到 grep `"layers"`
- **WHEN** 某个读图谱的 skill 取分层的一步改回 grep `"layers"`
- **THEN** 契约测试变红，指出这个 skill
