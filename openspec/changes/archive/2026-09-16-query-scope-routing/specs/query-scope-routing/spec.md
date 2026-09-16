## Purpose

定义 Chat 如何由宿主 AI 按用户真正要求的查询操作和范围选择最小充分检索原语，使局部问题避免无效图扩展，大范围问题仍保持可验证且诚实的完整性声明。

## ADDED Requirements

### Requirement: 按查询操作符而非主题词选择检索原语

Chat SHALL 在同一次推理中先识别用户要求的操作与范围，再选择检索原语；问题中出现“流程”等主题词本身 MUST NOT 触发 BFS。Skill SHALL 使用以下优先级和对应关系指导宿主 AI：仓库级穷举使用 inventory；局部字段、条件或校验优先 source-first，必要时 one-hop；明确 A→B 使用最多 6-hop 的 bounded-shortest-path；直接调用者或相邻依赖使用 one-hop；端到端流转或影响分析使用 bounded-bfs；其他源码定位使用 source-first。该语义决策 SHALL 留在 Skill/宿主 AI，不实现为关键词分类器或 query-plan validator。

#### Scenario: 发布字段问题不触发 BFS
- **WHEN** 用户问“发布文章需要填写和校验哪些字段”
- **THEN** Chat 将其作为局部字段枚举，使用源码/事实核实且不执行有界 BFS

#### Scenario: 文章提交链路使用流程遍历
- **WHEN** 用户问“文章从编辑器提交到数据库如何流转”
- **THEN** Chat 将其作为端到端流转，使用当前源码 literal 衔接 HTTP/API 等事实图断点，并只在事实连接段内有界遍历和核实前端 service、后端 route/controller 与持久化步骤，不声称存在一条连续或有向的全链路图路径

#### Scenario: 明确端点使用最短路
- **WHEN** 用户明确询问组件 A 如何到达组件 B
- **THEN** Chat 使用最多 6-hop 的有界最短路而不是全局 BFS

#### Scenario: 主题词与操作范围冲突
- **WHEN** 问题包含“流程”一词但实际要求一个局部字段、条件或校验结论
- **THEN** Chat 按局部操作范围选择 source-first 或 one-hop，不因主题词扩大为 bounded-bfs

### Requirement: 召回池与图遍历种子分离

候选召回 SHALL 保留最多 20 个排序候选用于召回门和回源核实。召回后，Chat SHALL 从本轮候选可映射出的当前事实图 node id 中选择最多 5 个与查询操作相关且去重的 seed；明确最短路还 SHALL 选择非空 target。source-first 和 inventory SHALL 不执行图遍历。确定性遍历 SHALL 把 5 seeds、80 nodes 和 160 edges 作为硬保险丝；Chat SHALL 把约 12,000 tokens 作为上下文边界。达到任一实际边界时 SHALL 停止扩展并报告原因、已覆盖范围与未覆盖部分，MUST NOT 把触发上限表述为完整检索成功。

#### Scenario: 高召回不导致二十路遍历
- **WHEN** 召回池包含 20 个候选但只有 4 个与查询操作匹配
- **THEN** Chat 只用这 4 个当前事实节点作为图 seed，其余候选继续保留作证据定位和回源核实

#### Scenario: 候选不能映射为当前事实节点
- **WHEN** 一个导航候选已失效、不能映射到当前事实图，或不属于本轮召回范围
- **THEN** Chat 不把它用于遍历，将其记录为可见 gap，并在剩余召回候选中重新选择

#### Scenario: seed 保险丝触发
- **WHEN** 调用方仍向确定性遍历传入超过 5 个 seed
- **THEN** 遍历最多使用 5 个 seed，返回可见的 seed-budget 截断边界，而不是静默扩展全部 seed

#### Scenario: 节点或边保险丝触发
- **WHEN** 遍历触及 80 节点或 160 边上限
- **THEN** 遍历立即停止，Chat 报告已覆盖范围与未覆盖部分且不宣称答案完整

### Requirement: 全仓流程问题走清单后分批展开

当用户要求项目所有流程或等价的仓库级穷举时，Chat SHALL 路由到流程清单/Domain 工作流：先给出可证明的流程目录、coverage 与 gaps，再按稳定流程标识分批展开详情。此类请求 MUST NOT 用一次全仓 BFS 代替清单；若当前没有足以证明“所有”的清单产物，Chat SHALL 明确说明前置产物缺失并缩小完整性声明。

#### Scenario: 所有流程不走单次 BFS
- **WHEN** 用户问“这个项目有哪些主要用户流程，请逐个说明前后端细节”且存在可用的流程 inventory
- **THEN** Chat 选择 inventory/Domain 路由并分批展开，且不启动单次全仓 BFS

#### Scenario: 清单缺失时不声称完整
- **WHEN** 仓库级流程请求到达但当前流程清单不可用或存在 coverage gaps
- **THEN** Chat 返回可见的 `inventory-unavailable` 或 coverage gaps，不启动全仓 BFS，并只对已由当前源码证明的示例流程作有限范围回答

### Requirement: 缓存与图命中只作导航

semantic cache、Domain、检索记忆与图遍历结果 SHALL 只用于定位和组织候选。最终答案中的业务条件、流程步骤和强制校验结论 SHALL 回到当前事实图或 SourceSnapshot 源码核实；任何导航命中 MUST NOT 降低证据要求。

#### Scenario: 前后端约束分别核实
- **WHEN** 候选同时涉及前端表单校验和后端提交校验
- **THEN** Chat 分别核实当前源码证据并区分界面提示与服务端强制，不从导航摘要直接下结论

#### Scenario: 导航线索已失效
- **WHEN** 缓存或记忆指向的源码锚点无法通过当前 SourceSnapshot 核实
- **THEN** Chat 丢弃该结论候选、报告可见 gap，并继续在剩余预算内定位而不引用陈旧线索
