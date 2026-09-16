# semantic-cache-reuse Specification

## Purpose

定义 Chat 如何在生成节点局部语义之前确定性复用已有的规范英文缓存，使重复或覆盖问题只支付新增节点的模型成本，同时维持源码新鲜度与证据边界。

## Requirements

### Requirement: 每个需要节点进入唯一复用终态

Chat SHALL 在生成任何节点局部语义之前，对当前问题实际需要解释的去重 node id 建立 reuse plan。每个 node id MUST 恰好进入以下一个终态：`reuse`（条目规范且 source hash fresh）、`generate`（`missing`、`stale` 或 `noncanonical-language`）或 `unavailable`（node id 不属于当前事实图，或其文件不属于当前 source manifest）。计划 SHALL 保存 node id、当前 file path 与终态原因，并满足 `requested = reuse + generate + unavailable`。

#### Scenario: 混合状态完整分桶
- **WHEN** 当前需要集合同时包含 fresh、missing、stale、noncanonical、unknown-node 与 path-not-in-manifest 节点，并含重复 node id
- **THEN** 系统先按 node id 去重，再让每个唯一节点恰好进入一个终态，计数守恒且没有隐形第四态

#### Scenario: 计划本身只读
- **WHEN** 系统建立 reuse plan
- **THEN** 它不修改 semantic cache、source manifest、事实图或项目源码

### Requirement: fresh 条目零生成零写复用

进入 `reuse` 的条目 SHALL 提供其现有 summary/tags 作为定位与理解输入。Chat MUST NOT 为该节点重新生成 summary/tags、调用 semantic cache writer 或更新 provenance；当计划全部为 `reuse` 时，`semantic-cache.json` MUST 保持逐字不变。

#### Scenario: 重复问题全部复用
- **WHEN** 后续问题需要的所有节点在问题开始前已有 canonical、审计绑定且 hash-fresh 的条目
- **THEN** 回答流程对这些节点执行零语义生成、零 cache writer 调用，且 semantic cache 的 SHA-256 与条目 provenance 前后不变

#### Scenario: 覆盖问题只补差集
- **WHEN** 后续问题覆盖先前问题的节点集合并额外需要新节点
- **THEN** 交集节点进入 `reuse` 且逐字不变，只有差集中的 `generate` 节点允许生成并提交语义

### Requirement: 失效范围跟随当前源码

reuse plan SHALL 使用当前 source manifest 与当前事实图判定条目，而不使用会话开始前保存的旧判定。文件 content hash 变化 SHALL 只把该文件对应条目置为 `generate: stale`；未变化文件的 canonical fresh 条目 SHALL 继续进入 `reuse`。缺失或非规范条目 SHALL 分别以 `missing` 或 `noncanonical-language` 进入 `generate`，不得被静默当作 fresh。

#### Scenario: 单文件修改选择性重算
- **WHEN** 一个覆盖问题需要两个已有缓存节点，其中仅一个节点所在文件的 content hash 已变化
- **THEN** 变化文件的节点进入 `generate: stale`，未变化文件的节点进入 `reuse`，事实图与未变化缓存条目不因该判定被改写

#### Scenario: 计划后源码漂移由提交门拒绝
- **WHEN** 节点进入 `generate` 后、语义提交前其 source hash 再次变化
- **THEN** 现有 CAS 提交门拒绝旧 hash 写入，回答继续但该条目不伪装成 fresh

### Requirement: 缓存复用不替代证据核实

复用的 summary/tags SHALL 只用于选择要检查的节点、文件与关系，MUST NOT 单独作为最终回答中代码或业务陈述的证据。Chat SHALL 在组织最终答案前，用当前事实节点/边或当前源码核实相关陈述，并按当前请求选择回答语言；回源核实 MUST NOT 触发 fresh 条目的重新语义生成。

#### Scenario: fresh 摘要只作检索种子
- **WHEN** fresh cache 命中与问题相关的节点
- **THEN** Chat 可用其缩小检查范围，但只有当前事实或源码支持的结论进入答案，且该核实过程不重写 fresh 条目

#### Scenario: 缓存内容与当前证据不一致
- **WHEN** fresh 候选的文字不能被当前事实或源码支持
- **THEN** Chat 丢弃或限定该结论而不是引用缓存作证，也不得为了让结论成立而修改事实图
