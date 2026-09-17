## Purpose

定义 Excavator 的本地 MCP 协议边界，使调用方 AI 能通过受控、可审计且绑定源码快照的工具读取事实、探索证据并复用同一语义缓存，而 MCP server 自身不承担模型推理。

## ADDED Requirements

### Requirement: MCP server 保持 model-agnostic

MCP server SHALL 只执行确定性分析、检索、证据读取、复用规划和受控语义提交。server MUST NOT 调用模型 provider、读取模型 API key、生成 summary/tags、解释用户问题、翻译内容或生成最终答案；这些判断与生成职责 SHALL 保留给调用方 AI。

#### Scenario: 无模型凭据运行
- **WHEN** 项目环境未配置任何模型 provider 或 API key
- **THEN** 所有 MCP 确定性工具仍可启动并完成其声明的操作

#### Scenario: 语义计划需要生成
- **WHEN** `semantic_plan` 返回一个或多个 `generate` 节点
- **THEN** server 只返回生成所需的节点、源码证据、当前 hash 与约束，不自行生成 summary/tags

### Requirement: 工具面按职责分离且有界

MCP surface SHALL 提供且仅提供以下项目级能力：`project_status` 报告当前数据与新鲜度；`sync_facts` 构建或刷新确定性事实；`recall` 返回有界候选；`traverse` 从明确 seeds 做有界图遍历；`read_evidence` 读取明确范围的当前源码或事实证据；`semantic_plan` 对明确 node id 集合建立复用计划；`semantic_commit` 提交调用方生成的节点局部语义。MCP surface MUST NOT 提供任意 shell、任意文件写入、无界图谱导出或 `answer_question` 类模型代理工具。

#### Scenario: 大范围问题分阶段探索
- **WHEN** 调用方要调查“当前项目的所有流程”等大范围问题
- **THEN** 调用方可多次组合 recall、traverse 与 read_evidence，并从每次响应的边界继续探索，而不是请求一次无界全图输出

#### Scenario: 未声明的执行能力被拒绝
- **WHEN** 客户端请求执行任意命令、写任意文件或让 server 直接回答问题
- **THEN** server 以结构化错误拒绝请求且不产生项目副作用

### Requirement: 每次结果绑定当前源码快照

每个会读取或改变项目数据的工具结果 SHALL 携带可比较的当前源码快照身份和数据新鲜度状态。检索与遍历工具 SHALL 接受明确预算并返回已用预算、是否截断、可继续边界和 gaps；任何失败、不可用或未覆盖输入 MUST 进入可见终态，不得被静默省略。

#### Scenario: 遍历达到预算
- **WHEN** `traverse` 在仍有可访问边界时达到调用方预算
- **THEN** 结果返回已访问集合、已用预算、`truncated: true`、未展开边界与当前快照身份，而不把截断表示为完整结果

#### Scenario: 工具调用期间源码变化
- **WHEN** 一次读取或提交所依据的源码快照不再是当前快照
- **THEN** 工具拒绝把旧结果表示为当前，并返回可重试的 stale 状态与最新快照身份

### Requirement: 项目根目录与证据路径受 containment 约束

server SHALL 对项目根目录、请求路径、符号链接解析结果和返回路径执行规范化与 containment 校验。读取 SHALL 限于已授权项目根目录内；写入 SHALL 限于该项目唯一的 `.excavator/` 数据目录。源码路径在协议中 SHALL 使用相对项目根目录的规范形式。

#### Scenario: 路径穿越被拒绝
- **WHEN** 请求路径通过 `..`、绝对路径或符号链接解析到项目根目录之外
- **THEN** server 返回结构化 containment 错误且不读取或写入目标

#### Scenario: 受控事实同步
- **WHEN** `sync_facts` 成功刷新项目数据
- **THEN** 它只修改项目 `.excavator/` 内声明的事实产物，不修改项目源码或根目录外文件

### Requirement: MCP 与既有入口共享同一语义数据面

`semantic_plan` 与 `semantic_commit` SHALL 遵守 `semantic-cache` 和 `semantic-cache-reuse` 的同一 schema、规范英文、source hash、freshness、锁、CAS 与原子写入契约。Lazy、Full 与 MCP MUST 共用 `.excavator/semantic-cache.json`；server MUST NOT 建立 MCP 专用缓存、平行 freshness 状态或绕过受控提交门直接改写缓存。

#### Scenario: Lazy 生成后 MCP 复用
- **WHEN** Lazy 已为节点提交 canonical 且 hash-fresh 的语义，随后 MCP 为同一节点建立计划
- **THEN** MCP 将该节点归入 `reuse`，不要求调用方再次生成且不写缓存

#### Scenario: MCP 提交后其他入口复用
- **WHEN** 调用方根据 MCP 计划生成节点局部英文语义并成功提交，随后 Lazy 或 Full 需要同一 fresh 节点
- **THEN** 后续入口逐字复用同一缓存条目，不建立或读取入口专用副本

#### Scenario: 并发入口提交同一节点
- **WHEN** Lazy、Full 或 MCP 并发提交同一节点且其中一个提交基于过期 source hash
- **THEN** 所有入口经过同一并发与 CAS 防线，fresh 提交保留，过期提交被拒绝且事实层不变
