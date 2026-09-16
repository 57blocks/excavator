## Context

见 [proposal.md](./proposal.md)。`retrieve.mjs` 已提供确定性的 BM25、候选合并、one-hop、bounded BFS 和 shortest path，并把问题类型判断留给 Chat。当前默认 `maxSeeds=20`，Chat 文档也允许最多 20 个 seed，因此局部问题一旦误选 BFS 就可能直接触及 80 节点上限。

现有 fact traversal 为有预算的无向可达性计算，返回边仍保留 source/target/type；Conduit 的前端 HTTP 调用与后端 route 之间没有事实边，且当前 fixture 没有 Domain 流程清单。因此本 change 不能把端到端流程建模成一条连续有向图路径，也不能把第三条真实问题验收成完整流程目录。

本 change 遵循 AI-first 边界：宿主 AI 已能根据自然语言、上下文与源码判断的事项写入 Skill/prompt；代码只实现可机械验证的检索、事实边限制和预算保险丝。

## Goals / Non-Goals

**Goals:**

- 让 Skill 在检索前引导宿主 AI 判断查询操作、范围和最小充分原语。
- 把 top-20 召回覆盖与最多 top-5 图扩展成本分成两个阶段。
- 保留确定性的 seed/node/edge 保险丝，并让所有截断、缺失和未覆盖范围可见。
- 让局部、端点、流程和全仓清单请求走不同的最小充分路径。

**Non-Goals:**

- 不新增自然语言分类器、query-plan schema/validator/executor 或结果声明 scorer。
- 不用中英文正则替代宿主 AI 的语义判断。
- 不删除或提高 5/80/160 保险丝，也不改变约 12,000 token 的 Skill 上下文边界。
- 不新增有向遍历算法，不改变现有 contains/imports/exports/calls 可达性语义，也不合成 HTTP/API/队列/数据库跨协议事实边。
- 不在本 change 生成完整 Domain 流程目录，不允许 semantic/domain 边成为事实路径。

## Decisions

### D1. 语义路由只存在于 Skill 与本轮推理

Skill 使用 request-local 的 intent、检索词、primitive、hop 和预算概念帮助宿主 AI 组织工作，但不为它们新增持久化 schema 或运行时 validator。宿主 AI 在同一次推理中完成问题理解、英文检索表达、原语选择和相关 seed 选择；所有状态只存在于本轮工作记忆。

把同一判断再写成代码只会制造脆弱的词面规则或一套需要与 prompt 双重维护的策略 API。确定性代码只接收 AI 选出的 terms/ids 并执行已有检索原语。

### D2. Skill 使用固定冲突消解优先级

intent 优先级为：仓库级穷举 → 局部条件/字段/校验 → 明确 A→B → 直接调用者 → 端到端流转/影响 → source-first。高优先级描述用户要求的操作范围，可覆盖问题中较低价值的主题词；因此“发布流程有哪些必填字段”仍走 local/source-first。

对应原语为：inventory、source-first/one-hop、bounded-shortest-path、one-hop、bounded-bfs、source-first。该矩阵是 Skill 决策指南，不是新的代码 enum 或拒绝 API。真实会话验收判断宿主是否遵守，而不是用固定中文问句做正则分类。

### D3. Top-20 召回与 Top-5 扩展分离

多源候选仍保留最多 20 个，用于 gold recall 与回源核实。进入 one-hop/BFS/shortest-path 前，宿主按 intent、精确 symbol/path、source hit 与当前源码相关性，从本轮候选可映射出的当前 fact node id 中选择最多 5 个去重 seed；明确最短路还选择 target。source-first 与 inventory 不执行图遍历。

代码只把 `DEFAULT_TRAVERSAL_BUDGETS.maxSeeds` 从 20 收紧到 5，作为 prompt 失误时的最后保险丝；不新增 selection validator。直接把召回数降到 5 会损失证据覆盖，保留 20 个扩图又放大噪声，所以召回数量和遍历 seed 数必须分开。

### D4. 现有遍历边界继续作为机械安全层

`retrieve.mjs` 继续强制 maxSeeds=5、maxNodes=80、maxEdges=160 与 hop 限制，并返回现有 `reason`、`truncated`、实际 budgets、节点和边。Skill 另外记录本轮 recall、实际 seed/target、未覆盖候选和 gaps，并在约 12,000 token 上下文边界内组织证据。保险丝触发是降级，不是正常完成信号。

### D5. 全仓问题由 Skill 走 inventory→batch

宿主先读取可用 Domain/流程清单的稳定流程标识、coverage 和 gaps，再分批展开详情。清单缺失时返回 `inventory-unavailable`、前置动作和已由当前源码证明的有限示例；不允许退回单次全仓 BFS 并声称“所有”。固定 Conduit 没有 Domain 清单，因此真实验收预期走这个降级分支。无需新增 inventory executor。

### D6. 端到端流程由 Skill 按事实连接段核实

flow 仍使用现有 `bounded-bfs`，但只探索事实连接的局部段。HTTP/API、消息队列或数据库映射等没有 fact edge 的边界由宿主通过当前 SourceSnapshot/source-text literal 定位下一段 anchor，再分别执行有界探索和源码核实。输出显式区分 fact-connected segment 与 source-verified bridge；不得把多个段拼写成一条图路径，也不得称现有无向可达性为 directed traversal。

### D7. 导航命中之后再次核实

semantic cache、Domain 和未来 retrieval memory 只提供导航候选。回答前由宿主从当前事实图或 SourceSnapshot 源码核实字段、方向和强制约束；验证失败的候选进入 gap。前端提示与后端强制要求分开陈述。无需新增声明 validator；零编造通过证据门和真实回答审阅验收。

### D8. 验收使用真实宿主行为加确定性保险丝测试

三条冻结问题分别验证：发布字段→local/no BFS；编辑器到数据库→source bridge + bounded fact segments；所有主要用户流程→`inventory-unavailable` + coverage/gaps/no BFS。确定性单测只覆盖 BM25 top-20 保留、maxSeeds=5 和现有 traversal boundary；intent、inventory 与跨协议叙述通过固定 Conduit 真会话审阅，不编写假 query-plan/executor 测试。

## Risks / Trade-offs

- [Risk] 宿主误判 intent → Skill 固定优先级与代表性问题，并用三类真实会话验收；5/80/160 保险丝限制误判的扩展成本。
- [Risk] prompt 约束弱于代码 validator → 语义策略保持单一权威，真实输出审阅直接捕获误路由；机械安全仍由确定性遍历保证。
- [Risk] top-5 漏掉正确起点 → top-20 仍保留给回源核实，seed 根据当前问题相关性选择，gold recall 与遍历成本分开评分。
- [Risk] inventory 当前不能证明完整 → 明示 coverage/gaps，不扩大声明；完整清单另开 change。
- [Risk] 跨协议 flow 被错误呈现为一条图路径 → Skill 要求分段边界和 source-verified bridge，并在真实回答中审阅不支持声明。
- [Risk] 有界遍历仍可能触发保险丝 → 现有 boundary 保证安全停止，Skill 报告覆盖而不把上限触发视为完整成功。

## Migration Plan

1. 修订冻结 oracle，删除对 query-plan/executor API 的依赖，只保留可观察的 AI 路由、边界、证据和不支持声明评分。
2. 删除已引入的 query-plan validator/executor 与假执行器红测；保留并加强现有确定性 retrieval tests。
3. 收紧 `retrieve.mjs` 的 `maxSeeds` 到 5，并完成 Chat Skill 的 intent、top-20/top-5、inventory、分段 flow 与证据协议。
4. 跑定向测试、三件套和固定 Conduit 真 provider 验收。

回滚时分别 revert Skill 协议和 maxSeeds 保险丝；事实图、语义缓存和数据 schema 无需迁移。
