## Context

见 [proposal.md](./proposal.md)。`retrieve.mjs` 当前把问题类型判断留给 Chat，并提供确定性的 BM25、候选合并、one-hop、bounded BFS 和 shortest path。默认 `maxSeeds=20`、`maxNodes=80`、`maxEdges=160`；Chat 文档允许最多 20 个 seed，因此一个局部条件问题也可能从全部召回候选扩展。

现有 fact traversal 为有预算的无向可达性计算，返回边仍保留 source/target/type；Conduit 的前端 HTTP 调用与后端 route 之间没有事实边，且当前 fixture 没有 Domain 流程清单。因此本 change 不能把端到端流程建模成一条连续有向图路径，也不能把第三条真实问题验收成完整流程目录。

本 change 不改变事实边权威：图路径仍只可使用 contains/imports/exports/calls。语言规范和探索记忆由其他 change 处理。

## Goals / Non-Goals

**Goals:**

- 在执行检索前显式记录查询 intent、原语和预算。
- 把召回覆盖与图扩展成本分成两个独立阶段。
- 在召回后冻结可验证的 seed/target exact identities，并拒绝 intent/primitive 或身份不合法的执行选择。
- 让局部、端点、流程和全仓清单请求走不同的最小充分路径。
- 让所有截断、缺失和未覆盖范围可见。

**Non-Goals:**

- 不用中英文正则替代宿主 agent 的语义判断。
- 不删除或提高 80/160/12,000 保险丝。
- 不新增有向遍历算法，不改变现有 contains/imports/exports/calls 可达性语义，也不合成 HTTP/API/队列/数据库跨协议事实边。
- 不在本 change 生成完整 Domain 流程目录。
- 不允许 semantic/domain 边成为事实路径。

## Decisions

### D1. Chat 形成小型结构化查询计划

检索前的 query plan 字段为 `intent`、`terms`、`recallLimit`、`primitive`、`hopLimit`、`maxNodes`、`maxEdges` 和 `maxContextTokens`。召回后的 execution selection 另含 `seedNodeIds` 与 `targetNodeIds`；validator 同时接收本轮召回候选可映射出的 node ids，以验证 exact identity、去重、成员关系和数量。

宿主 agent 做语义判断与相关 seed 选择；确定性 validator 只验证封闭 enum、intent/primitive 兼容、selection 身份和预算，不假装用关键词规则重新理解问题。query plan 与 execution selection 都是本轮瞬时数据，不持久化。

把自然语言 intent 写成固定正则会对同义表达和多语言产生虚假的确定性，因此只固定输出 schema、优先级和预算，不固定词面分类器。

### D2. 使用冲突消解优先级

intent 优先级为：仓库级穷举 → 局部条件/字段/校验 → 明确 A→B → 直接调用者 → 端到端流转/影响 → source-first。高优先级描述用户要求的操作范围，可覆盖问题中较低价值的主题词；因此“发布流程有哪些必填字段”仍是 `local-condition`。

validator 使用封闭兼容矩阵：

| intent | allowed primitive |
|---|---|
| `inventory` | `inventory` |
| `local-condition` | `source-first`, `one-hop` |
| `explicit-path` | `bounded-shortest-path` |
| `direct-neighbor` | `one-hop` |
| `flow` | `bounded-bfs` |
| `source-locate` | `source-first` |

矩阵在任何图读取前执行，因此预算合法但语义不兼容的 `local-condition + bounded-bfs` 也会失败。

### D3. Top-20 召回与 Top-5 扩展分离

多源候选仍保留最多 20 个，用于 gold recall 与回源核实。进入 one-hop/BFS/shortest-path 前，宿主按 intent、精确 symbol/path、source hit 与当前源码相关性选择 exact `seedNodeIds`/`targetNodeIds`。validator 要求二者来自本轮候选映射出的当前 fact node ids；seed 去重后最多 5 个。`bounded-shortest-path` 必须有非空 seed 和 target；`source-first`/`inventory` 必须没有 traversal ids。local-condition 默认不扩图，必要 owner/caller 核实最多 1-hop。

直接把召回数降到 5 会损失候选；保留 20 个扩图又放大噪声，所以采用二阶段上限。

### D4. 保险丝只负责安全停止

执行器继续强制 maxNodes=80、maxEdges=160、context≈12,000 tokens，并保留 hop 限制。实际遍历的结构化报告合并 query plan、execution selection 与 traversal boundary，至少输出 reason/truncated、实际 budgets、recall count、seed/target ids、covered node ids、uncovered candidate ids 和 gaps。保险丝触发是降级，不是正常完成信号。

### D5. 全仓问题走 inventory→batch

inventory 先读取可用 Domain/流程清单的稳定流程标识、coverage 和 gaps，再以固定批次展开详情。清单缺失时返回 `inventory-unavailable`、前置动作和已由当前源码证明的有限示例；不允许退回单次全仓 BFS 并声称“所有”。固定 Conduit 没有 Domain 清单，因此真实验收预期走这个降级分支。完整目录生成仍留给后续 change。

### D6. 端到端流程按事实连接段核实

`flow` 的 primary primitive 仍是现有 `bounded-bfs`，但它只探索事实连接的局部段。HTTP/API、消息队列或数据库映射等没有 fact edge 的边界通过当前 SourceSnapshot/source-text literal 定位下一段 anchor，再分别执行有界探索和源码核实。输出必须显式区分 fact-connected segment 与 source-verified bridge；不得把多个段拼写成一条图路径，也不得称现有无向可达性为 directed traversal。

这比新增方向策略或协议边更小：方向声明从返回 edge/source 与源码核实，事实图和 traversal 算法保持不变。

### D7. 导航命中之后再次核实

semantic cache、Domain 和未来 retrieval memory 只提供 seed。回答前从当前事实图或 SourceSnapshot 源码核实字段、方向和强制约束；验证失败的候选进入 gap。前端提示与后端强制要求必须分开陈述。

### D8. 固定三类 Conduit oracle

使用三条冻结问题：发布字段→local-condition/no BFS；编辑器到数据库→source bridge + bounded fact segments；所有主要用户流程→`inventory-unavailable` + coverage/gaps/no BFS。fake executor 先证明旧策略允许错误 intent/primitive、seed>5、非法 seed/target 或单次 inventory flood，再进行真 provider 验收，分别记录 intent、primitive、recall、seed/target、node/edge 和 boundary。

## Risks / Trade-offs

- [Risk] agent 误判 intent → 固定优先级、计划 validator 和三类真实问题联合验收，并在回答中暴露实际计划。
- [Risk] top-5 漏掉正确起点 → top-20 仍保留给回源核实，seed 根据 intent 重排，gold recall 与遍历成本分开评分。
- [Risk] inventory 当前不能证明完整 → 明示 coverage/gaps，不扩大声明；完整清单另开 change。
- [Risk] 跨协议 flow 被错误呈现为一条图路径 → 输出分段边界和 source-verified bridge；禁止连续/有向全链路声明。
- [Risk] 有界遍历仍可能触发保险丝 → 结构化 boundary 保证安全和诚实，不把上限触发视为 bug 消失的唯一标准。

## Migration Plan

1. 先提交查询计划 validator 和三条冻结问题的红色 oracle。
2. 接入 query plan、intent/primitive 矩阵、召回后 seed/target selection 和 top-20/top-5 分阶段执行。
3. 接入分段 flow、inventory 降级、boundary 与回源核实协议。
4. 跑定向测试、三件套和 Conduit 真 provider 验收。

回滚时按 oracle、执行器、Chat 协议三个逻辑 commit 逆序 revert；事实图和已有语义产物无需迁移。
