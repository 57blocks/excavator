## MODIFIED Requirements

### Requirement: Lazy 首次运行不调用 LLM

Lazy 首次运行 SHALL 只执行 `Resolve → Scan → Structure-All → Build Fact Graph → Deterministic Validate → Save`。file-analyzer、summary-verifier、assemble-reviewer、architecture-analyzer、graph-reviewer 的调用数 SHALL 为 0；MUST NOT 生成 LLM batch、HTML 或 Tour。保存失败时 MUST NOT 推进 sourceRevision、manifest、fingerprints 或 meta，也 MUST NOT 改动 `knowledge-graph.jsonl` 与 source index。

#### Scenario: 零 LLM subagent 调用
- **WHEN** 在一个项目上首次以 lazy 运行 `/excavator`
- **THEN** analyzer/verifier/assemble/architecture/graph-review subagent 调用数为 0，且不产 LLM batch、HTML 或 Tour

#### Scenario: 保存失败不推进元数据
- **WHEN** Lazy 首次运行的原子保存失败
- **THEN** sourceRevision、manifest、fingerprints、meta、`knowledge-graph.jsonl` 与 source index 均保持上一个成功状态，不前进
