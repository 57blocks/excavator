## Context

参见 `proposal.md`。当前 `lazy-analyze.mjs` 只构建确定性事实；`retrieve.mjs` 已导出纯检索/遍历函数；`semantic-cache-reuse.mjs` 已导出唯一节点分桶规划器；`semantic-cache.mjs` 已提供唯一的缓存写入、英文内容审计、短锁和 source-hash CAS。Full 的 `apply-semantic-patches.mjs` 最终也调用这一 writer。当前 Skill/CLI 是主要入口，仓库的 Claude 插件清单只声明 skills/hooks，Codex 的 `install.sh` 只链接 skills，并无 MCP server。

现有真实数据属于具体源码快照，不能从一个 checkout 默认为另一个 checkout 的证据。MCP 不能凭客户端传入的路径绕开当前 source manifest、事实图或根目录边界。

## Goals / Non-Goals

**Goals:**

- 同一个确定性应用服务供现有 CLI/Skill 与 MCP 适配器使用；协议层只校验输入、调用服务并封装输出。
- 一次 server 进程绑定一个明确的项目根目录，所有工具使用相同的快照和路径权限边界。
- 节点局部语义通过“计划 → 调用方 AI 生成 → 受控提交 → 跨入口复用”闭环，不引入第二种持久化机制。
- 在真实 Claude 插件和 Codex 本地 MCP 客户端中能发现、调用和验证工具；原有 Skill 仍可使用。

**Non-Goals:**

- 不让 Excavator 选择模型或调用 provider；不在代码里实现问题类型判断、关键词扩展、跨语言翻译、业务摘要或答案生成。
- 不做跨会话生成中的互斥/预约；两个同时开始、都看到 `missing` 的 AI 调用可能重复生成，但写入仍须安全。只保证后续 fresh 条目零重复生成、零重复写入。
- 不在第一版 MCP 增加架构语义图、领域知识图的生成或写入工具；第一版语义写回仅覆盖现有节点局部 cache。
- 不提供 HTTP/远端服务、全局多项目 server、任意 shell、无界 graph dump 或全自动“回答问题”工具。

## Decisions

### D1. 单进程本地 stdio MCP，根目录在启动时固定

用官方 TypeScript MCP server SDK 的当前稳定线构建本地 stdio server。通过启动参数或受信配置指定一个项目根目录并解析 realpath；工具输入不接受另一个 project root。这样与现有本地数据路径一致，无需引入 HTTP、认证、端口和远端状态。替代方案“每次工具调用传 root”会放大跨项目误读与路径穿越面；“一个全局 server 自动猜当前会话目录”在多工作树下无法可靠判定权威快照，均不采用。

server 的 stdout 专用于 MCP 协议，诊断信息走 stderr；启动失败时明确报告根目录、构建依赖或 manifest 的问题。源码读取使用规范相对路径、realpath containment 与当前 source manifest 的范围约束，symlink 不可逃逸；写入前还须拒绝指向根目录外的 `.excavator/` symlink，所有写入限于解析后的项目 `.excavator/` 数据目录。读取到的源码内容是证据数据，不是可执行指令。

### D2. 协议适配层复用既有确定性服务

按职责将当前 CLI 的可复用核心抽成薄应用服务，既有 CLI 继续调同一服务，MCP 只注册输入/输出 schema 并调用服务：

| MCP 工具 | 服务职责 | 返回重点 |
| --- | --- | --- |
| `project_status` | 当前 source snapshot 与产物 freshness | snapshot、模式、可用/缺失/过期产物、gaps |
| `sync_facts` | 现有 Lazy 确定性事实构建/增量同步 | 前后 snapshot、覆盖/失败桶、变更摘要 |
| `recall` | 现有 exact/BM25/source/fresh semantic 候选合并 | 排序候选、命中来源、预算/截断 |
| `traverse` | 现有 one-hop/BFS/shortest-path 的确定性边遍历 | seeds、节点/边、boundary、预算 |
| `read_evidence` | 当前 snapshot 中明确的文件/节点范围 | 路径、行号、源码片段/事实、截断 |
| `semantic_plan` | 现有 reuse planner 对明确 node ids 分桶 | reuse/generate/unavailable、当前 hash、必要证据 |
| `semantic_commit` | 唯一 cache writer 提交一个节点局部条目 | committed/rejected/stale 等可见状态 |

不重新实现检索评分、遍历或 freshness 算法，也不把整个 CLI 流程作为每个 MCP 调用的黑盒子进程。`sync_facts` 可以复用现有确定性构建编排，但不触发 Full 的模型步骤；耗时操作使用 MCP progress 与清晰的客户端超时配置，第一版不引入后台任务队列。所有读取均在调用时重查 source snapshot/产物状态；不把一次会话的旧判定当作新鲜度来源。

`recall` 输入是调用方 AI 探索后给出的明确 terms、exact identities、可选路径线索和上限，而非原始自然语言问题的服务器端解释。`traverse` 输入是明确 node ids、现有遍历模式和上限；server 不替 AI 选择“问题属于流程还是依赖”，也不额外发明一套方向算法。大范围问题由调用方根据 gaps 与 boundary 分轮探索，不自动把上限增大为整图。

### D3. 统一响应 envelope 与有界证据

工具输出采用固定结构：`status`、`snapshot`（可比较身份与 freshness）、`data`、`coverage`/`gaps`、`budget`/`boundary`（适用时）与 `error`（适用时）。输入 schema 限制 node ids 数量、候选数、hop/node/edge 上限、源文件范围和总字符数；即使客户端指定超大值也明确拒绝或夹到上限并在返回中说明。读取中如发现快照漂移，返回 `stale-snapshot`，不把旧证据标为当前。

对于命中遍历上限的结果，boundary 包括未展开的节点/边界及停止原因；若需要下一轮，调用方用可见边界重新请求。缺失索引、未知节点、未覆盖语言/文件和损坏产物都有可见结果桶，不混入“零命中”。引用用相对路径 + 行号 + snapshot，以便调用方重新核实。

### D4. MCP 语义写回是同一 writer 的另一入口

`semantic_plan(nodeIds)` 对当前图与 manifest 调用现有 reuse planner，仅对 `generate` 节点提供有界当前源码证据、file path 和 content hash；如局部源码超预算，返回需经 `read_evidence` 补读的可见范围，不宣称已读完整。对 `reuse` 节点原样返回可信 summary/tags，绝不调用 writer。调用方 AI 阅读足够的局部源码后产出英文节点 summary/tags，`semantic_commit` 接收 node id、file path、预期 source hash、允许的字段与 provenance，然后调用同一个 `commitSemanticCacheEntry`。协议适配器不得写 JSON。

提交时在同一个 writer 的短锁内核实 node id 与当前事实图中的 file path 关系、当前 manifest 和启动时绑定的项目根目录，防止客户端伪造“合法路径 + 另一个节点 id”，也防止锁外验证到写入之间的漂移；仍以当前 hash CAS、英文审计、字段白名单和原子 rename 为最终门禁。若提交时条目已变 fresh，计划外写入必须拒绝或明确返回 `already-fresh`，保持现有条目字节与 provenance 不变；这层检查须在同一锁保护下，与并发的另一提交无竞争窗口。若现有 writer 的表面不足以实现该保证，扩展**同一个** writer 的条件提交选项，不另建 MCP writer。旧 hash 提交返回 `stale-hash`，不自动重试模型生成。

此设计只消除“已持久化 fresh 内容”的跨会话/跨入口重复成本，不声称杜绝同时生成中的竞态；如未来确需生成预约机制，另立 change。

### D5. 发行与渐进迁移

Claude 插件在根目录声明 `.mcp.json` 的本地 stdio server（利用宿主提供的插件路径/项目目录变量）；Codex 提供明确的项目级 MCP 配置或 `codex mcp add` 示例，指向同一个可执行入口。既有 `install.sh` 只链接 Skills，不能据此声称 MCP 已注册；文档和验收必须分别检查真实宿主工具发现。CLI/Skill 不删除，逐步把能走 MCP 的确定性调用切到 MCP，不能用 MCP 时仍调用同一应用服务的 CLI 适配器。两者对 `.excavator/` schema 无迁移，也不双写。

首个实现 PR 只针对这个 change 的 MCP 工具面与复用闭环；如拆成多个代码 PR，每个 PR 从 umbrella feat 切出、合入 feat，最终才合 feat 到 main。回滚为移除 MCP 注册/适配器并保留已有 CLI 与缓存；由于不迁移 schema，已有 semantic-cache 条目仍可读取。

## Risks / Trade-offs

- [同步构建在大仓库超过 MCP 默认工具超时] → 提供 progress、取消/失败可见状态和有界的宿主超时配置；不暗中启动不可追踪后台任务。
- [现有 writer 只按 manifest hash CAS，可能在另一个入口已写 fresh 时再次覆盖同 hash 内容] → 在同一 writer 锁内增加可选 `only-if-not-fresh` 条件，并先用已知假样本证明重复提交被测试捕获。
- [路径/符号链接/工作树使证据越界或错配] → server 单根绑定；root 和 source path 做 realpath containment；校验 node id、file path 与当前 snapshot 的关系，并在负例夹具中覆盖同内容异路径/同名异 owner。
- [检索或大范围遍历返回过多 token，或截断被误读为完整答案] → 输入/输出双预算、显式 boundary/gaps、调用方按问题范围分轮探索；AI 最终回源核实。
- [CLI 与 MCP 包装不同造成行为分叉] → 共用服务，测试同一固定语料/快照的等价结果与 cross-channel cache SHA/provenance；禁止 MCP 私有缓存。
- [插件声明被宿主静默忽略] → 先用已知错误配置证明验证器/探针会变红，再在 Claude 与 Codex 分别做真实工具发现和一次调用；失败定位在加载、依赖、启动或协议层。
