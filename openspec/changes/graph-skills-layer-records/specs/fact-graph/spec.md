## ADDED Requirements

### Requirement: 读图谱的 skill 按记录类型取分层

读 `knowledge-graph.jsonl` 的 skill，取分层的步骤 SHALL 读分层记录：grep `"record":"layer"` 取每个分层一行；查一个节点的分层时，在这些行里找带引号的节点 ID；分层只列文件级节点，所以函数或类节点 SHALL 用同一 `filePath` 的文件级节点 ID。skill MUST NOT 让模型 grep `"layers"`：文件里只有文件头带这个键，它的值是分层个数，不是分层。

没有分层行命中时，skill SHALL 让模型照实说图谱没有给出分层，MUST NOT 让模型按目录或文件名自行分组当作分层。

#### Scenario: 取全部分层
- **WHEN** `excavator-onboard` 读一张有三个分层的图谱
- **THEN** 它 grep `"record":"layer"`，得到三行分层记录，Architecture Layers 一节写这三个分层的名称与描述

#### Scenario: 函数所在的分层
- **WHEN** `excavator-explain` 解释 `src/auth/login.ts:verifyToken`，`file:src/auth/login.ts` 在 Service 分层里
- **THEN** 它在分层行里找 `"file:src/auth/login.ts"`，说出 Service 分层与它的描述

#### Scenario: 图谱没有分层
- **WHEN** 一张 Lazy 图谱没有分层记录，用户运行 `excavator-onboard`
- **THEN** Architecture Layers 一节写明图谱没有给出分层，不出现自行分出的分层

#### Scenario: skill 回到 grep `"layers"`
- **WHEN** 某个读图谱的 skill 取分层的一步改回 grep `"layers"`
- **THEN** 契约测试变红，指出这个 skill
