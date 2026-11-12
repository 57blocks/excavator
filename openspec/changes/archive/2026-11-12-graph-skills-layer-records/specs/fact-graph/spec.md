## ADDED Requirements

### Requirement: 读图谱的 skill 从最后写出分层的地方取分层

`finalize-incremental.mjs` 写出分层行（`PARTIAL_UPDATE` 与 `ARCHITECTURE_UPDATE`）时，SHALL 在图谱文件头的 `project` 里写 `layersFrom: "incremental"`，标明分层行是最后写出的分层；`lazy-analyze.mjs` 组装的 `project` MUST NOT 带这个字段。不重跑 Phase 4 时，`finalize-incremental.mjs` SHALL 按下面同一个顺序选起步分层（规则 4 时从空分层起步），MUST NOT 在有可用分层时从空分层起步。

读 `knowledge-graph.jsonl` 的 skill 取分层时，SHALL 按顺序用第一个适用的来源：
1. 图谱文件头的 `fields.project.layersFrom` 是 `incremental`：图谱里的 `{"record":"layer",…}` 行；
2. 否则，`semantic-graph.json`（`full-semantic-isolation` 规定 Full 的分层写在这里）存在，且它的 `factDigest` 等于图谱文件头的 `fields.project.factsDigest`：它的 `layers`；
3. 否则，图谱里的分层行；
4. 否则没有可用的分层：skill SHALL 让模型照实说，MUST NOT 让模型按目录或文件名自行分组当作分层。

`semantic-graph.json` 存在而规则 1 或 3 适用时，skill MUST NOT 用它的分层，SHALL 让模型说明它们比分层行旧或来自别的事实，并建议运行 `/excavator --full`。

查一个节点的分层 SHALL 按精确字符串匹配节点 ID；分层只列文件级节点，所以函数或类 SHALL 用同一 `filePath` 的文件级节点 ID。skill MUST NOT 让模型 grep `"layers"`：图谱里只有文件头带这个键，它的值是分层行的个数，不是分层。

#### Scenario: Full 运行之后
- **WHEN** Full 运行写出 `semantic-graph.json`，它的 `factDigest` 等于当前图谱的 `factsDigest`，文件头没有 `layersFrom`
- **THEN** `excavator-onboard` 的 Architecture Layers 一节写语义图里的分层

#### Scenario: Full 之后又做增量更新
- **WHEN** Full 运行之后，增量更新加了 `src/c.ts` 并写出分层行；`factsDigest` 沿用上一次，仍等于语义图的 `factDigest`，文件头的 `layersFrom` 是 `incremental`
- **THEN** `excavator-explain src/c.ts` 说出分层行里列出 `file:src/c.ts` 的分层，并说明语义图的分层比分层行旧

#### Scenario: Full 之后第一次增量更新的起步分层
- **WHEN** Full 运行把 `src/a.ts` 放进 Service 分层，之后的 `PARTIAL_UPDATE` 加了 `src/c.ts`
- **THEN** 写出的分层行里 `file:src/a.ts` 仍在 Service 分层，`file:src/c.ts` 按目录归入，不是所有文件都落进 `layer:other`

#### Scenario: 增量更新之后又跑 Full
- **WHEN** 增量更新之后再跑 Full：F1 重建文件头，没有 `layersFrom`，分层行原样带过来；F3 写出 `factDigest` 等于新 `factsDigest` 的语义图
- **THEN** skill 用语义图的分层，不用带过来的分层行

#### Scenario: 函数所在的分层
- **WHEN** `excavator-explain` 解释 `src/auth/login.ts:verifyToken`，`file:src/auth/login.ts` 在 Service 分层里
- **THEN** 它按 `file:src/auth/login.ts` 查分层，说出 Service 分层与它的描述

#### Scenario: 语义图来自别的事实
- **WHEN** 文件头没有 `layersFrom`，`semantic-graph.json` 的 `factDigest` 与当前图谱的 `factsDigest` 不同，图谱有分层行
- **THEN** skill 用分层行，并说明语义图的分层来自别的事实，建议运行 `/excavator --full`

#### Scenario: 没有分层
- **WHEN** 一个只跑过 Lazy 的项目没有 `semantic-graph.json`，图谱也没有分层行
- **THEN** `excavator-onboard` 的 Architecture Layers 一节写明没有分层，不出现自行分出的分层

#### Scenario: skill 回到 grep `"layers"`
- **WHEN** 某个读图谱的 skill 取分层的一步改回 grep `"layers"`
- **THEN** 契约测试变红，指出这个 skill
