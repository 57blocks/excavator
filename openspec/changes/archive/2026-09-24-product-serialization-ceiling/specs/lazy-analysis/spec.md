## MODIFIED Requirements

### Requirement: Lazy 首次运行不调用 LLM

Lazy 首次运行 SHALL 只执行 `Resolve → Scan → Structure-All → Build Fact Graph → Deterministic Validate → Save`。file-analyzer、summary-verifier、assemble-reviewer、architecture-analyzer、graph-reviewer 的调用数 SHALL 为 0；MUST NOT 生成 LLM batch、HTML 或 Tour。保存失败时 MUST NOT 推进 sourceRevision、manifest、fingerprints 或 meta，也 MUST NOT 改动 `knowledge-graph.json` 与 source index。

#### Scenario: 零 LLM subagent 调用
- **WHEN** 在一个项目上首次以 lazy 运行 `/excavator`
- **THEN** analyzer/verifier/assemble/architecture/graph-review subagent 调用数为 0，且不产 LLM batch、HTML 或 Tour

#### Scenario: 保存失败不推进元数据
- **WHEN** Lazy 首次运行的原子保存失败
- **THEN** sourceRevision、manifest、fingerprints、meta、`knowledge-graph.json` 与 source index 均保持上一个成功状态，不前进

### Requirement: 首次 Lazy 运行的性能观测

Lazy 首次运行 SHALL 分阶段记录耗时（snapshot、scan、import-map、parse、graph-build、validate、save 与总耗时）。snapshot 阶段 SHALL 至少分别记录快照解析与快照复制；save 阶段 SHALL 单独记录 manifest 的逐文件内容哈希；总耗时 SHALL 为整次运行的墙钟时间，MUST NOT 只是各阶段之和。运行结果 SHALL 同时报告每个整文档产物的序列化余量（见 `product-serialization`）。在固定 fixture `go-clean-arch` 上，总耗时观测目标为 < 60s（观测目标，非正确性门槛）。

#### Scenario: 分阶段耗时被记录
- **WHEN** 在 go-clean-arch 上完成一次 Lazy 首跑
- **THEN** 各阶段与总耗时被记录下来，供性能观测（目标总耗时 <60s）

#### Scenario: 快照时间计入总耗时
- **WHEN** 在一个 git 仓库上完成一次 Lazy 首跑
- **THEN** 结果中有快照解析、快照复制与 manifest 哈希三项耗时，总耗时是墙钟时间且不小于各阶段耗时之和
