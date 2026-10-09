## MODIFIED Requirements

### Requirement: 并发写入安全，事实层只读

所有 Lazy、Full 与 MCP 语义缓存写入 SHALL 经过同一个受控提交门并使用共享 `.excavator/semantic.lock`（只在提交时短暂持有）：提交前重读最新 source manifest + fact graph + semantic cache，对目标节点当前 source hash 做 compare-and-swap，hash 不同 SHALL 放弃写入；写临时文件并原子 rename；陈旧锁按 TTL 夺锁。任何入口 MUST NOT 直接改写缓存、建立入口专用缓存或绕过该提交门。语义写入 MUST NOT 修改 `knowledge-graph.jsonl`（其 SHA-256 保持不变）。缓存写失败 MUST NOT 阻塞调用方继续回答。

#### Scenario: 并发写不丢更新、拒绝陈旧
- **WHEN** Lazy、Full 或 MCP 中两个并发调用都要写同一节点的语义
- **THEN** 写入由同一提交门串行化并按 hash CAS，旧 hash 的写入被拒绝，无丢更新

#### Scenario: 语义写入不改事实层
- **WHEN** Lazy、Full 或 MCP 写入语义缓存
- **THEN** `knowledge-graph.jsonl` 的 SHA-256 不变

#### Scenario: 缓存写失败不阻塞回答
- **WHEN** 语义缓存提交失败（锁/CAS/IO）
- **THEN** 失败以可见状态返回，调用方仍可基于当前证据回答，只是这次不落缓存
