# semantic-cache Specification

## Purpose

定义按需语义补充与其缓存 `semantic-cache.json`：chat 在需要理解职责/局部行为时读源生成节点局部 summary，仅在可靠时缓存、按 hash 判新鲜、并发安全，且**绝不修改事实层**。这是「只为需要的节点付 LLM、越问越懂」的落点。

## Requirements

### Requirement: 按需节点局部语义补充

当问题需要职责/业务含义/局部行为时，调用方 AI SHALL 读取该节点必要的局部源码并生成**节点自身**的 summary/tags。Lazy、Full 与 MCP 入口仅当同时满足以下三条才 SHALL 将调用方生成的内容写入 `semantic-cache.json`：已读取该节点所需完整局部源码范围；能可靠概括该节点自身职责；写入内容不依赖未验证的跨文件推断。可缓存字段 SHALL 限于：节点/文件自身 summary、局部 tags、`semanticSourceHash`、模型与时间 provenance。跨文件业务结论、领域流程与回答文本 MUST NOT 写入缓存。Excavator 的确定性 runtime 和 MCP server MUST NOT 自行调用模型生成这些字段。

#### Scenario: 可靠局部语义被缓存并复用
- **WHEN** 调用方 AI 生成一个可靠的节点局部 summary，并由 Lazy、Full 或 MCP 任一入口成功提交
- **THEN** 它写入同一个 semantic-cache.json，后续任一入口需要同一 fresh 节点时复用而不重算

#### Scenario: 跨文件结论不入缓存
- **WHEN** 回答需要跨文件业务结论
- **THEN** 该结论可在当次回答里基于证据生成，但不写回 semantic-cache

#### Scenario: MCP 不代替调用方生成语义
- **WHEN** MCP 计划发现节点缺少可复用语义
- **THEN** MCP 返回生成输入与约束，由调用方 AI 生成内容，server 不调用模型补全

### Requirement: 按 hash 判新鲜度

字段有效性 SHALL 由 hash 直接判定：`semanticSourceHash` 等于 source manifest 当前 content hash → 可复用；缺失 → 未生成；不相等 → 过期，SHALL 立即忽略、不进可信检索。

#### Scenario: 文件变化使其语义失效
- **WHEN** 某文件 content hash 变化
- **THEN** 该文件对应缓存语义立即视为过期、不被复用

### Requirement: 并发写入安全，事实层只读

所有 Lazy、Full 与 MCP 语义缓存写入 SHALL 经过同一个受控提交门并使用共享 `.excavator/semantic.lock`（只在提交时短暂持有）：提交前重读最新 source manifest + fact graph + semantic cache，对目标节点当前 source hash 做 compare-and-swap，hash 不同 SHALL 放弃写入；写临时文件并原子 rename；陈旧锁按 TTL 夺锁。任何入口 MUST NOT 直接改写缓存、建立入口专用缓存或绕过该提交门。语义写入 MUST NOT 修改 `knowledge-graph.json`（其 SHA-256 保持不变）。缓存写失败 MUST NOT 阻塞调用方继续回答。

#### Scenario: 并发写不丢更新、拒绝陈旧
- **WHEN** Lazy、Full 或 MCP 中两个并发调用都要写同一节点的语义
- **THEN** 写入由同一提交门串行化并按 hash CAS，旧 hash 的写入被拒绝，无丢更新

#### Scenario: 语义写入不改事实层
- **WHEN** Lazy、Full 或 MCP 写入语义缓存
- **THEN** `knowledge-graph.json` 的 SHA-256 不变

#### Scenario: 缓存写失败不阻塞回答
- **WHEN** 语义缓存提交失败（锁/CAS/IO）
- **THEN** 失败以可见状态返回，调用方仍可基于当前证据回答，只是这次不落缓存
