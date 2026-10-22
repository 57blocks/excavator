## ADDED Requirements

### Requirement: 读图谱的 skill 从分层实际所在处取分层

读 `knowledge-graph.jsonl` 的 skill 取分层时，SHALL 按顺序用第一个适用的来源：
1. `semantic-graph.json`（`full-semantic-isolation` 规定 Full 的分层写在这里）存在，且它的 `factDigest` 等于图谱文件头的 `fields.project.factsDigest`：用它的 `layers`；
2. 否则，图谱里的 `{"record":"layer",…}` 行（增量更新写出）；
3. 否则没有可用的分层：skill SHALL 让模型照实说，MUST NOT 让模型按目录或文件名自行分组当作分层。

`semantic-graph.json` 存在但 `factDigest` 不同时，skill MUST NOT 用它的分层，SHALL 让模型说明它们来自别的事实。

查一个节点的分层 SHALL 按精确字符串匹配节点 ID；分层只列文件级节点，所以函数或类 SHALL 用同一 `filePath` 的文件级节点 ID。skill MUST NOT 让模型 grep `"layers"`：图谱里只有文件头带这个键，它的值是分层行的个数，不是分层。

#### Scenario: Full 运行之后
- **WHEN** Full 运行写出 `semantic-graph.json`，它的 `factDigest` 等于当前图谱的 `factsDigest`，图谱没有分层行
- **THEN** `excavator-onboard` 的 Architecture Layers 一节写语义图里的分层

#### Scenario: 函数所在的分层
- **WHEN** `excavator-explain` 解释 `src/auth/login.ts:verifyToken`，`file:src/auth/login.ts` 在 Service 分层里
- **THEN** 它按 `file:src/auth/login.ts` 查分层，说出 Service 分层与它的描述

#### Scenario: 语义图来自别的事实
- **WHEN** `semantic-graph.json` 的 `factDigest` 与当前图谱的 `factsDigest` 不同，图谱有增量更新写出的分层行
- **THEN** skill 用分层行，并说明语义图的分层来自别的事实

#### Scenario: 没有分层
- **WHEN** 一个只跑过 Lazy 的项目没有 `semantic-graph.json`，图谱也没有分层行
- **THEN** `excavator-onboard` 的 Architecture Layers 一节写明没有分层，不出现自行分出的分层

#### Scenario: skill 回到 grep `"layers"`
- **WHEN** 某个读图谱的 skill 取分层的一步改回 grep `"layers"`
- **THEN** 契约测试变红，指出这个 skill
