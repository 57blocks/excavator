## Why

Chat 会把 top-20 召回候选直接作为多跳种子，并可能因问题出现“流程”等主题词而选择 BFS；局部字段或条件问题因此会触及 80 节点上限。需要先识别用户要求的操作范围，再选择最小充分的确定性检索原语，同时避免把宿主 AI 已能可靠完成的语义判断重复实现成代码。

## What Changes

- `excavator-chat` Skill 按固定优先级引导宿主 AI 区分仓库清单、局部条件、明确端点、直接邻接、端到端流转和源码定位；不新增关键词分类器、query-plan validator 或 executor。
- top-20 只作为召回池；宿主 AI 从当前召回与事实图中选择最多 5 个相关 seed，确定性遍历把 `maxSeeds=5` 作为最后保险丝。
- 保留 80 节点、160 边和约 12,000 token 的边界；触发时必须报告覆盖与未覆盖范围，不能宣称完整。
- “项目的所有流程”由 Skill 路由到 inventory/Domain 清单后分批展开；没有足够清单时诚实缩小完整性声明，不执行一次全仓 BFS。
- 端到端流程由宿主 AI 按事实连接段分别有界探索，并用当前源码 literal 跨越 HTTP/API 等事实图断点；不伪造一条连续或有向的全链路图路径。
- semantic cache、Domain 和遍历结果只作导航；业务条件、流程步骤和强制校验结论必须回到当前事实图或源码核实。
- 在固定提交的 Conduit RealWorld 上分别验证发布字段、文章提交链路和全部主要用户流程三类真实问题。

## Capabilities

### New Capabilities

- `query-scope-routing`: 定义由 Skill/AI 执行的问题范围分类、检索原语选择、召回/种子分离、预算保险丝、清单路由和回源核实。

### Modified Capabilities

（无）

## Impact

- 受影响范围：`skills/excavator-chat/SKILL.md`、`skills/excavator/retrieve.mjs` 的 seed 保险丝及相关确定性测试；删除本 change 已引入但不再需要的 query-plan validator/executor 与假执行器红测。
- 验收语料：`test-repo/conduit-realworld-example-app` 固定提交；核心问题为“发布文章需要填写和校验哪些字段”“文章从编辑器提交到数据库如何流转”“这个项目有哪些主要用户流程，请逐个说明前后端细节”。该 fixture 没有 Domain 清单，因此第三问应验证 `inventory-unavailable`、coverage/gaps 与零全仓 BFS。
- 非目标：不在本 change 中构建完整 Domain 流程目录，不新增有向遍历算法或跨 HTTP/API 的事实边，不新增自然语言路由代码，也不通过提高或移除保险丝掩盖误路由。
