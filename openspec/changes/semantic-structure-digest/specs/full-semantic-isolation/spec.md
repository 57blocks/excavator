## RENAMED Requirements

- FROM: `### Requirement: 只处理缺失/过期语义，factDigest 为架构新鲜度键`
- TO: `### Requirement: 只处理缺失/过期语义，structureDigest 为架构新鲜度键`

## MODIFIED Requirements

### Requirement: 只处理缺失/过期语义，structureDigest 为架构新鲜度键

Full SHALL 只为语义缺失或过期（按 source hash）的文件生成节点语义。`semantic-graph.json` SHALL 以 `structureDigest` 为新鲜度键：写出时记录知识图文件头当时的 `project.structureDigest`（只覆盖事实节点与事实边，见 `fact-graph`），MUST NOT 再写 `factDigest`。当知识图的 `structureDigest` 与语义图记录的相同时，Architecture SHALL NOT 重跑、已有 `semantic-graph.json` 可复用；不同或语义图没有 `structureDigest` 时 SHALL 重建。coverage、gaps 或附加记录流（如 `entryPoints`）的变化 MUST NOT 让语义图失效，因为 Architecture 不读它们。

#### Scenario: factDigest 未变则跳过 Architecture
- **WHEN** 节点与边未变化（语义图记录的 `structureDigest` 与知识图的相同；本场景名沿用旧键名）再次运行 Full
- **THEN** 已有 semantic-graph.json 被复用，Architecture 不重跑；只补齐仍缺失/过期的节点语义

#### Scenario: 只多了附加记录流
- **WHEN** 事实构建升级后多了一条附加记录流，节点与边逐字节不变，`factsDigest` 变了
- **THEN** `structureDigest` 不变，F3 的 `check` 输出 `reuse`，分层不重新生成

#### Scenario: 节点或边变化
- **WHEN** 一个节点或一条边变了
- **THEN** F3 的 `check` 输出 `rebuild`，原因写出两个 `structureDigest`

## ADDED Requirements

### Requirement: 旧语义图核对后重绑

`semantic-structure-digest` 之前写出的 `semantic-graph.json` 只有 `factDigest`（当时等于知识图的 `factsDigest`）。Lazy 在知识图发布成功之后 SHALL 对这样的语义图做一次核对，用内存里的当前投影按顺序算候选摘要：
1. 当前的 `factsDigest`；
2. 去掉附加记录流之后的摘要：不含 `entryPoints` 键，`coverage` 去掉 `entryPoints`，`gaps` 去掉入口点缺口种类，其余与构建时的摘要算法相同。

任一候选等于语义图的 `factDigest` 时，Lazy SHALL 把 `factDigest` 换成当前的 `structureDigest` 并原子写回，`layers`、`relations`、`gaps`、`model`、`generatedAt`、`languageAudit` 逐字节不变。没有候选相等时 Lazy MUST NOT 改动语义图。MUST NOT 有任何不经这一核对就写入 `structureDigest` 的路径。

每次 Lazy 的结果 SHALL 恰好落进一个可见的桶，写进运行结果并打印：
- `absent`：没有语义图；
- `bound`：已有 `structureDigest` 且等于当前；
- `stale`：已有 `structureDigest` 但不等于当前；
- `rebound`：核对通过并已写回；
- `unbound`：核对不通过、文件读不了、不是当前 schema 或语言审计、或写回失败，并带原因。

重绑的结果 MUST NOT 让 Lazy 运行失败。

#### Scenario: 升级入口点之后恢复
- **WHEN** 语义图在 `lazy-fact-graph/17` 之前写出，之后 Lazy 加了 `entryPoints` 流，节点与边不变
- **THEN** 下一次 Lazy 的结果是 `rebound`；语义图的分层逐字节不变，`/excavator-view` 的语义为 included

#### Scenario: 节点变了不重绑
- **WHEN** 旧语义图写出之后有一个节点变了
- **THEN** 结果是 `unbound`，语义图逐字节不变

#### Scenario: 已经绑定或过期
- **WHEN** 语义图已有 `structureDigest`
- **THEN** 结果是 `bound` 或 `stale`，语义图逐字节不变
