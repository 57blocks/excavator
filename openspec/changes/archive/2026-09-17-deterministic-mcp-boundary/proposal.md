## Why

Excavator 的事实构建已经不依赖模型调用，但 Skill 目前仍通过 shell 组合确定性能力，语义生成入口也分别隐含在 Lazy 与 Full 的编排中。需要把同一套确定性数据面暴露为本地 MCP，让用户自己的宿主 AI 负责探索、生成语义和回答，同时继续由 Excavator 负责事实、快照、证据边界与安全提交。这样可以避免服务端模型依赖、第二套语义缓存，以及不同入口重复生成相同语义带来的 token 浪费。

## What Changes

- 新增本地、model-agnostic 的 MCP server，提供 `project_status`、`sync_facts`、`recall`、`traverse`、`read_evidence`、`semantic_plan`、`semantic_commit` 七个有界工具。
- MCP server 不集成模型 provider、API key、查询分类器、翻译器或答案生成器；问题理解、检索策略、语义生成、回答和输出语言仍由调用方 AI 决定。
- MCP 的语义计划与提交复用现有 `semantic-cache-reuse` 规划器和 `commitSemanticCacheEntry` writer；Lazy、Full、MCP 共用 `.excavator/semantic-cache.json`、锁、CAS、源码哈希、英文持久化校验和 freshness 规则。
- 所有 MCP 响应返回结构化、受预算约束且绑定源码快照的结果，并显式报告命中边界、截断、不可用状态与 gaps；不通过 MCP 暴露任意 shell 或无界原始图谱。
- MCP 对项目根目录和源码路径执行规范化与 containment 校验，只允许在项目的 `.excavator/` 数据目录内写入。
- 增加跨入口复用与一致性验收，证明 Lazy、Full、MCP 不会建立平行缓存，fresh 条目不会重复生成或重复写入。

## Capabilities

### New Capabilities

- `mcp-tool-surface`: 定义本地 MCP 工具边界、结构化结果、路径安全、快照约束，以及调用方 AI 与确定性 Excavator runtime 的职责分离。

### Modified Capabilities

- `semantic-cache`: 将受控语义写入契约扩展到 MCP 入口，并明确所有入口必须使用同一缓存、同一 writer 和同一并发/新鲜度防线。
- `semantic-cache-reuse`: 将现有的 fresh/stale/missing 规划与零重复生成保证扩展为 Lazy、Full、MCP 跨入口复用契约。

## Impact

- 新增 MCP server 入口、插件声明和协议适配层，并把现有 CLI 脚本背后的确定性逻辑整理为可被 CLI 与 MCP 共用的应用服务。
- 现有 Lazy/Full Skill 的模型职责不变；它们与 MCP 客户端将通过同一语义数据面互操作。
- `.excavator/semantic-cache.json` 的 schema 与已有数据无需迁移，也不会新增 MCP 专用缓存或 freshness 系统。
- server 自身不产生模型调用成本；token 节省来自按需探索、有界证据包、仅对 stale/missing 节点生成，以及不同入口之间复用 fresh 语义。
- 主要风险集中在协议适配与路径边界，而非新分析算法；验收需要覆盖 CLI/MCP 行为等价、恶意路径拒绝、并发 CAS 和跨入口复用。
