## Purpose

定义 Chat 如何按用户真正要求的查询操作和范围选择最小充分检索原语，使局部问题避免无效图扩展，大范围问题仍保持可验证且诚实的完整性声明。

## ADDED Requirements

### Requirement: 按查询操作符而非主题词选择检索原语

Chat SHALL 先识别用户要求的操作与范围，再选择检索原语；问题中出现“流程”等主题词本身 MUST NOT 触发 BFS。查询计划的 intent SHALL 为 `inventory`、`local-condition`、`explicit-path`、`direct-neighbor`、`flow` 或 `source-locate`，primitive SHALL 为 `inventory`、`source-first`、`one-hop`、`bounded-bfs` 或 `bounded-shortest-path`。系统 MUST 强制以下兼容关系：`inventory → inventory`；`local-condition → source-first|one-hop`；`explicit-path → bounded-shortest-path`；`direct-neighbor → one-hop`；`flow → bounded-bfs`；`source-locate → source-first`。不兼容的计划 MUST 在检索执行前被拒绝。

#### Scenario: 发布字段问题不触发 BFS
- **WHEN** 用户问“发布文章需要填写和校验哪些字段”
- **THEN** 查询被识别为局部字段枚举，使用源码/事实核实且不执行有界 BFS

#### Scenario: 文章提交链路使用流程遍历
- **WHEN** 用户问“文章从编辑器提交到数据库如何流转”
- **THEN** 查询被识别为端到端流转，使用当前源码 literal 衔接 HTTP/API 等事实图断点，并只在事实连接段内有界遍历和核实前端 service、后端 route/controller 与持久化步骤，不声称存在一条连续或有向的全链路图路径

#### Scenario: 明确端点使用最短路
- **WHEN** 用户明确询问组件 A 如何到达组件 B
- **THEN** 查询使用最多 6-hop 的有界最短路而不是全局 BFS

#### Scenario: intent 与 primitive 不兼容
- **WHEN** 一个 `local-condition` 计划选择 `bounded-bfs`，或任一 intent 选择兼容矩阵之外的 primitive
- **THEN** 系统在读取图边和执行扩展前拒绝该计划并报告不兼容原因

### Requirement: 召回池与图遍历种子分离

候选召回 SHALL 保留最多 20 个排序候选用于召回门和回源核实。召回后，系统 SHALL 冻结精确 `seedNodeIds` 与 `targetNodeIds`：二者 MUST 去重、属于当前事实图且来自本轮召回候选可映射出的 node id；任何图遍历最多使用 5 个与查询操作匹配的 seed。`bounded-shortest-path` MUST 同时具有非空 seed 与 target；`source-first` 和 `inventory` MUST NOT 携带遍历 seed 或 target。扩展节点 80、扩展边 160、上下文 12,000 tokens SHALL 保留为最终保险丝；达到任一保险丝 SHALL 停止扩展。任何实际遍历的边界报告 SHALL 至少包含 reason、truncated、实际 budgets、recall count、seed/target ids、covered node ids、uncovered candidate ids 与 gaps，MUST NOT 把触发上限表述为完整检索成功。

#### Scenario: 高召回不导致二十路遍历
- **WHEN** 召回池包含 20 个候选但只有 4 个与查询操作匹配
- **THEN** 冻结的 `seedNodeIds` 只包含这 4 个候选映射出的当前 node id，其余候选只保留作核实候选

#### Scenario: seed 或 target 不属于本轮召回
- **WHEN** execution selection 包含重复 id、未知 node id、召回池之外的 id，或 shortest-path 缺失 seed/target
- **THEN** 系统在遍历前拒绝 selection 并逐项报告无效身份或缺失原因

#### Scenario: 保险丝触发时诚实降级
- **WHEN** 遍历触及 80 节点、160 边或 12,000 tokens 中任一上限
- **THEN** 遍历立即停止并报告已覆盖范围与未覆盖部分，不宣称答案完整

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
