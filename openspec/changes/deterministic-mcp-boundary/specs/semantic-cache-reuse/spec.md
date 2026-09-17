## MODIFIED Requirements

### Requirement: 每个需要节点进入唯一复用终态

Lazy、Full 与 MCP SHALL 在生成任何节点局部语义之前，通过同一确定性规划契约，对当前问题实际需要解释的去重 node id 建立 reuse plan。每个 node id MUST 恰好进入以下一个终态：`reuse`（条目规范且 source hash fresh）、`generate`（`missing`、`stale` 或 `noncanonical-language`）或 `unavailable`（node id 不属于当前事实图，或其文件不属于当前 source manifest）。计划 SHALL 保存 node id、当前 file path 与终态原因，并满足 `requested = reuse + generate + unavailable`。入口身份 MUST NOT 改变同一快照、同一节点集合的分桶结果。

#### Scenario: 混合状态完整分桶
- **WHEN** 任一入口的需要集合同时包含 fresh、missing、stale、noncanonical、unknown-node 与 path-not-in-manifest 节点，并含重复 node id
- **THEN** 系统先按 node id 去重，再让每个唯一节点恰好进入一个终态，计数守恒且没有隐形第四态

#### Scenario: 计划本身只读
- **WHEN** Lazy、Full 或 MCP 建立 reuse plan
- **THEN** 它不修改 semantic cache、source manifest、事实图或项目源码

#### Scenario: 跨入口计划一致
- **WHEN** Lazy 与 MCP 针对同一源码快照和同一去重 node id 集合建立计划
- **THEN** 两者返回相同的终态、原因与当前 file path

### Requirement: fresh 条目零生成零写复用

进入 `reuse` 的条目 SHALL 提供其现有 summary/tags 作为定位与理解输入。Lazy、Full、MCP 及其调用方 AI MUST NOT 为该节点重新生成 summary/tags、调用 semantic cache writer 或更新 provenance；当计划全部为 `reuse` 时，`semantic-cache.json` MUST 保持逐字不变。

#### Scenario: 重复问题全部复用
- **WHEN** 后续问题需要的所有节点在问题开始前已有 canonical、审计绑定且 hash-fresh 的条目，无论条目由 Lazy、Full 或 MCP 写入
- **THEN** 回答流程对这些节点执行零语义生成、零 cache writer 调用，且 semantic cache 的 SHA-256 与条目 provenance 前后不变

#### Scenario: 覆盖问题只补差集
- **WHEN** 后续问题覆盖先前问题的节点集合并额外需要新节点，且两次问题可通过不同入口处理
- **THEN** 交集节点进入 `reuse` 且逐字不变，只有差集中的 `generate` 节点允许生成并提交语义

#### Scenario: 入口切换不重复付费
- **WHEN** 一个入口已经为节点留下 fresh 条目，随后另一个入口需要同一节点
- **THEN** 后一个入口不得因入口不同而重新生成、重写 provenance 或创建缓存副本

### Requirement: 失效范围跟随当前源码

所有入口的 reuse plan SHALL 使用同一个当前 source manifest 与当前事实图判定条目，而不使用会话开始前保存的旧判定或入口私有 freshness 状态。文件 content hash 变化 SHALL 只把该文件对应条目置为 `generate: stale`；未变化文件的 canonical fresh 条目 SHALL 继续进入 `reuse`。缺失或非规范条目 SHALL 分别以 `missing` 或 `noncanonical-language` 进入 `generate`，不得被静默当作 fresh。

#### Scenario: 单文件修改选择性重算
- **WHEN** 一个覆盖问题需要两个已有缓存节点，其中仅一个节点所在文件的 content hash 已变化
- **THEN** 变化文件的节点进入 `generate: stale`，未变化文件的节点进入 `reuse`，事实图与未变化缓存条目不因该判定被改写

#### Scenario: 计划后源码漂移由提交门拒绝
- **WHEN** 节点进入 `generate` 后、语义提交前其 source hash 再次变化
- **THEN** 共享 CAS 提交门拒绝旧 hash 写入，调用方仍可继续回答但该条目不伪装成 fresh

#### Scenario: 入口私有 freshness 被禁止
- **WHEN** 任一入口的会话记忆或本地状态与当前 source manifest 冲突
- **THEN** 当前 source manifest 胜出，所有入口得到相同 stale 判定
