## Why

`semantic-cache.json` 已能保存并判定节点局部语义的新鲜度，但 Chat 仍没有一个明确、可测试的“先复用、后生成”决策：即使覆盖问题命中 fresh 条目，执行者仍可能再次读取同一局部源码、重写相同摘要并产生重复模型开销。规范英文身份已经落地，现在可以把顺序会话之间的复用收敛为确定性契约。

## What Changes

- 为当前问题实际需要解释的节点建立确定性 reuse plan；每个去重后的 node id 恰好落入 `reuse`、`generate` 或 `unavailable` 之一，并带可见原因。
- canonical 且 source-hash fresh 的条目 SHALL 直接复用，不重新生成、不调用 cache writer，也不改变 `semantic-cache.json`；缺失、过期或非规范条目只为对应节点重新生成。
- 重叠问题只补充新覆盖的节点；已覆盖交集保持逐字不变。源码变化只失效受影响文件的条目，未变化文件继续复用。
- fresh summary/tags 只用于定位和组织理解；最终回答中的代码/业务结论仍须回查当前事实或源码，缓存本身不升级为证据。
- 保留现有提交期短锁与 CAS；本 change 不做跨会话 in-flight 生成去重，两个真正并发且都在首个提交前启动的会话仍可能重复生成。
- 不保存查询探索轨迹，不设计宽问题分片/全项目流程穷举，也不改变 80 节点/160 边的遍历预算；这些分别进入后续 change。

## Capabilities

### New Capabilities

- `semantic-cache-reuse`: 定义节点语义的确定性复用计划、重叠问题零重算、选择性失效、零写复用及回答前回源核实。

### Modified Capabilities

（无）

## Impact

- 受影响范围：`skills/excavator-chat/SKILL.md` 的语义生成顺序、semantic-cache 读侧规划辅助、对应语言/缓存/Chat 测试。
- 依赖：`canonical-semantic-language` 提供 `contentLanguage=en` 与内容绑定审计；`hybrid-retrieval` 提供 node id、source manifest、freshness 与原子 writer。
- 数据兼容：不新增持久化产物或语言副本，不改变事实图；现有 canonical cache 可直接复用。
- 验收语料：固定 Conduit 提交 `5e127d8569b300e0a21dc2c20ea680da4967b1aa`，先复用已生成的收藏流程条目，再问覆盖问题；源码与 `.excavator` 产物不提交。
