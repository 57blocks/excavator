## MODIFIED Requirements

### Requirement: 语义物理隔离，事实图不可被 LLM 改

Full 生成的语义 SHALL 写入独立产物：节点局部 summary/tags 进 `semantic-cache.json`，架构/layers 进 `semantic-graph.json`。LLM 输出 MUST NOT 修改 `knowledge-graph.jsonl` 的节点身份、源码范围、确定性结构边、coverage 或 gaps——这些事实字段的内容在 Full 语义生成前后 SHALL 保持不变。

#### Scenario: Full 语义写入不改事实字段
- **WHEN** Full 生成并写入语义
- **THEN** `knowledge-graph.jsonl` 的事实字段（节点身份/源码范围/结构边/coverage/gaps）逐字不变；summary/layers 出现在独立的 `semantic-cache.json` / `semantic-graph.json`
