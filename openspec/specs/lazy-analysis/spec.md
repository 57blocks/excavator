# lazy-analysis Specification

## Purpose

定义 `analysisMode` 与 Lazy 首次运行的可观察行为：先确定性产出事实、不预先烧掉整仓 LLM 预算，并让 `/excavator-chat` 用事实层回答结构类问题、对语义类问题明确降级而非编造。

## Requirements

### Requirement: analysisMode 配置与 --mode 旗标

`.excavator/config.json` SHALL 支持 `analysisMode ∈ {lazy, full}`，默认值为 `lazy`。`/excavator --mode=lazy|full` SHALL 只覆盖本次运行、不改写配置。`/excavator --full` SHALL 等价于 `--mode=full` 并强制重建事实，且不持久化配置。默认值翻转为 `lazy` MUST NOT 清空或降级已存在的完整图谱与语义产物。

#### Scenario: 默认 lazy
- **WHEN** 项目无 analysisMode 配置且运行 `/excavator`
- **THEN** 按 lazy 模式运行

#### Scenario: --mode 只覆盖单次
- **WHEN** 配置为 lazy 时运行 `/excavator --mode=full`
- **THEN** 本次按 full 运行，且 `.excavator/config.json` 的 analysisMode 保持 lazy

#### Scenario: 存量图谱不被默认切 lazy 破坏
- **WHEN** 项目已有含非空 summary/layers 的完整图谱，且默认已是 lazy
- **THEN** 事实层照常同步，已有语义按新鲜度规则复用或失效，但不被清空或降级

### Requirement: Lazy 首次运行不调用 LLM

Lazy 首次运行 SHALL 只执行 `Resolve → Scan → Structure-All → Build Fact Graph → Deterministic Validate → Save`。file-analyzer、summary-verifier、assemble-reviewer、architecture-analyzer、graph-reviewer 的调用数 SHALL 为 0；MUST NOT 生成 LLM batch、HTML 或 Tour。保存失败时 MUST NOT 推进 sourceRevision、manifest、fingerprints 或 meta。

#### Scenario: 零 LLM subagent 调用
- **WHEN** 在一个项目上首次以 lazy 运行 `/excavator`
- **THEN** analyzer/verifier/assemble/architecture/graph-review subagent 调用数为 0，且不产 LLM batch、HTML 或 Tour

#### Scenario: 保存失败不推进元数据
- **WHEN** Lazy 首次运行的原子保存失败
- **THEN** sourceRevision、manifest、fingerprints、meta 均保持上一个成功状态，不前进

### Requirement: 结构类问题由事实层回答

`/excavator-chat` 对结构类问题（有哪些文件/符号、某类有哪些方法、谁 import 或调用谁、1-hop 邻居等）SHALL 直接使用事实层回答，MUST NOT 触发语义补充或整仓 LLM 分析。

#### Scenario: 结构问题走事实层
- **WHEN** 用户问"某类有哪些方法"或"谁调用了某函数"
- **THEN** chat 用事实节点/边直接回答，不进行按需语义补充

### Requirement: 语义问题在 Lazy 下明确降级

当问题需要职责/业务含义、而 Lazy 事实层对应节点的 summary 为空时，`/excavator-chat` SHALL 明确告知该语义信息尚未生成并建议 `/excavator --mode=full`，MUST NOT 编造 summary 或业务结论。

#### Scenario: 语义问题给出降级提示而非编造
- **WHEN** 用户在 lazy 图谱上问某模块的业务职责，而其 summary 为空
- **THEN** chat 说明该信息未生成并建议运行 full 模式，而不是编造一段职责描述

### Requirement: Lazy 不静默触发 Full

Lazy SHALL NOT 因为配置为 lazy、也不因为问题类型而静默触发 Full 分析（不自动跑整仓 LLM）。需要全量语义时须由用户显式运行 full。

#### Scenario: Lazy 运行不自动升级为 Full
- **WHEN** 在 lazy 模式下运行分析或问答
- **THEN** 不会自动启动整仓 LLM 分析

### Requirement: 首次 Lazy 运行的性能观测

Lazy 首次运行 SHALL 分阶段记录耗时（snapshot、scan、import-map、parse、graph-build、validate、save 与总耗时）。在固定 fixture `go-clean-arch` 上，总耗时观测目标为 < 60s（观测目标，非正确性门槛）。

#### Scenario: 分阶段耗时被记录
- **WHEN** 在 go-clean-arch 上完成一次 Lazy 首跑
- **THEN** 各阶段与总耗时被记录下来，供性能观测（目标总耗时 <60s）
