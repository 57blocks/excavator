# full-semantic-isolation Specification

## Purpose

让 Full 模式与 Lazy 共用同一确定性事实构建，语义只写独立产物、绝不改 canonical 事实图，并只为语义缺失或过期的文件付 LLM。这样 Full 与 Lazy 事实投影一致、模型永不篡改身份/结构，且重复 Full 在事实未变时不重做架构分析。

## Requirements

### Requirement: Full 复用确定性事实构建

`/excavator --mode=full` SHALL 先执行与 Lazy 完全相同的 `scan → structure-all → build-fact-graph` 得到确定性事实图，MUST NOT 让 LLM 重新创造结构图。对同一源码，Full 与 Lazy SHALL 得到一致的事实投影与相同 `factDigest`。

#### Scenario: Full 与 Lazy 事实投影一致
- **WHEN** 对同一源码分别以 lazy 与 full 运行
- **THEN** 两者的确定性事实节点/边与 `factDigest` 一致（差异只在语义产物是否生成）

### Requirement: 语义物理隔离，事实图不可被 LLM 改

Full 生成的语义 SHALL 写入独立产物：节点局部 summary/tags 进 `semantic-cache.json`，架构/layers 进 `semantic-graph.json`。LLM 输出 MUST NOT 修改 `knowledge-graph.json` 的节点身份、源码范围、确定性结构边、coverage 或 gaps——这些事实字段的内容在 Full 语义生成前后 SHALL 保持不变。

#### Scenario: Full 语义写入不改事实字段
- **WHEN** Full 生成并写入语义
- **THEN** `knowledge-graph.json` 的事实字段（节点身份/源码范围/结构边/coverage/gaps）逐字不变；summary/layers 出现在独立的 `semantic-cache.json` / `semantic-graph.json`

### Requirement: 只处理缺失/过期语义，factDigest 为架构新鲜度键

Full SHALL 只为语义缺失或过期（按 source hash）的文件生成节点语义。`semantic-graph.json` SHALL 以 `factDigest` 为新鲜度键：当 `factDigest` 未变化时，Architecture SHALL NOT 重跑、已有 `semantic-graph.json` 可复用。

#### Scenario: factDigest 未变则跳过 Architecture
- **WHEN** 事实未变化（factDigest 相同）再次运行 Full
- **THEN** 已有 semantic-graph.json 被复用，Architecture 不重跑；只补齐仍缺失/过期的节点语义

### Requirement: 无法映射的模型输出记为 semantic gap

无法映射到任何事实节点的模型输出 SHALL 记录为 semantic gap，MUST NOT 创建假锚点或塞进事实图。

#### Scenario: 悬空语义记 gap
- **WHEN** 模型产出的某语义无法对应到任何 fact 节点
- **THEN** 记为一条 semantic gap，而不是新建事实锚点

### Requirement: Summary-Verifier 留在 Full

Summary-Verifier SHALL 在 Full 流程中核验语义产物（semantic-cache/semantic-graph），MUST NOT 进入 Lazy 关键路径。

#### Scenario: Full 核验语义、Lazy 不核验
- **WHEN** 运行 Full
- **THEN** Summary-Verifier 核验生成的语义并写回核验状态；Lazy 首跑不触发它
