## Context

见 [proposal.md](./proposal.md)。当前 `excavator-chat` 已把 hash-fresh canonical cache 纳入候选合并，但“为答案需要的节点生成 summary”仍是一段宿主指令，没有一个在生成前执行的唯一决策面。`semantic-cache.mjs` 已提供英文身份、内容绑定语言审计、`freshnessOf`/`isFresh` 与提交期 CAS；本 change 应复用这些权威，而不是再造 freshness 规则。

## Goals / Non-Goals

**Goals:**

- 让需要节点在任何模型生成前完成守恒分桶，并让宿主只处理 `generate` 差集。
- 让 all-fresh 路径按构造不触碰 writer，使缓存文件与 provenance 可证明逐字不变。
- 保持 reuse 只是检索/理解提示，当前事实与源码仍是答案证据。
- 用合成夹具证明机制，用固定 Conduit 真会话证明宿主确实遵守零重算协议。

**Non-Goals:**

- 不在模型生成期间持锁，也不增加跨进程 lease、任务表或“正在生成”状态；真正并发的首次 miss 仍可重复计算。
- 不保存 query、检索词、探索路径、答案或跨文件流程；缓存继续只拥有 node-local summary/tags。
- 不解决宽问题的分片、分页、覆盖证明或遍历预算命中；reuse plan 只接收本轮预算内已确定的需要节点。
- 不改变 cache schema/version、规范语言、source manifest、node identity 或事实图。

## Decisions

### D1. 一个只读 planner 是唯一复用决策面

新增确定性 planner，同时提供纯函数与薄 CLI。纯函数接收 `requestedNodeIds`、当前 fact nodes、manifest entries 与完整 semantic cache；CLI 只负责从项目 `.excavator` 读取这些输入并输出 JSON。它不导入 writer，也不写文件。

planner 先按首次出现顺序去重 node id，再建立 node/path/hash 映射，并输出：

- `reuse[]`: node、file path、`fresh` 原因与现有 summary/tags；
- `generate[]`: node、file path、当前 hash 与 `missing|stale|noncanonical-language`；
- `unavailable[]`: `unknown-node|path-not-in-manifest`；
- `counts`: unique requested 与三桶计数，用守恒断言拒绝遗漏/重复。

freshness 判定调用 canonical change 已有的 read-side gate；不复制“版本 + `contentLanguage=en` + 内容审计 + source hash”的规则。选择一个显式 planner 而不是继续给 SKILL.md 拼内联脚本，是为了让参数、终态与失败理由可单测，也减少不同宿主自行解释协议的偏差。

### D2. 先定 need set，再 plan，再生成差集

Chat 的顺序固定为：结构/BM25/source/cache 候选合并 → 有界遍历 → 选出答案实际需要解释的 node ids → 调 planner → 回查当前事实/源码 → 仅对 `generate[]` 生成英文 node-local summary 并经现有 writer 提交。`reuse[]` 可帮助选择回查位置和组织解释，但不进入生成循环。

在候选阶段读取 fresh cache 与在 need set 后决定是否生成是两个不同职责：前者提高召回，后者控制成本。把计划放在检索前会不知道真正需要哪些节点；放在生成后又无法阻止浪费。

### D3. all-fresh 路径没有“刷新时间”写入

reuse 不更新 `generatedAt`、model、audit 或 cache 顶层字段，也不为了记录 hit count 新增持久化遥测。零写通过两层验证：合成执行夹具中的 generator/writer spy 都为 0；真实项目在问题前后比较整个 `semantic-cache.json` 的 SHA-256 与已有 entry bytes。

不增加 lastUsedAt/hitCount，因为任何命中写都会破坏零写、引入锁竞争，并让“是否真的复用”难以从字节证据判断。若以后需要观测命中率，应使用非权威的进程内/日志指标另立 change。

### D4. 选择性失效沿用 file content hash 与提交期 CAS

同文件内节点继续共享 manifest `contentHash`，因此文件改变会让该文件的需要节点进入 `generate: stale`，其他文件保持 `reuse`。planner 之后若源码再次漂移，已有 writer CAS 仍是最后提交门；本 change 不扩展锁的持有范围。

接受 file-level 失效会多算同文件未改变节点，但它与当前 freshness 权威一致。引入 symbol-level hash 会改变 manifest/identity 契约并显著扩大范围，因此不采用。

### D5. 顺序复用与并发重复计算分开

只要首个会话已经提交，任何后续会话都从磁盘读取并复用；不依赖同一对话内存。两个会话若都在首个提交前完成 plan，可能都进入 `generate`，之后仍由现有短锁/CAS 保证不丢其他节点更新和不写陈旧内容。

用户已接受不为这一偶发浪费引入跨会话生成协调。本 change 的验收不得把“并发只生成一次”写成通过条件。

### D6. 验收 oracle 先冻结机制与真会话证据

编码前由 acceptor 固定两组 oracle：

1. 合成矩阵包含 duplicate、fresh、missing、stale、noncanonical、unknown-node、path-not-in-manifest，断言唯一终态、原因、计数守恒、planner 零写；all-fresh 执行夹具断言 generator/writer spy 为 0。
2. 固定 Conduit 提交上从干净 canonical cache 开始：中文收藏问题建立基线；新会话重复同题时 cache SHA 与 entry provenance 不变；英文覆盖问题只允许新增差集 entry，交集逐字不变。两次回答分别使用中文/英文并保留代码标识符，所有结论回查源码。

真会话能证明宿主遵循 SKILL.md，但不能替代合成边界矩阵；合成矩阵能证明 planner，却不能证明模型没有越过 `generate[]`。两者必须同时通过。

## Risks / Trade-offs

- [Risk] 模型选择的 need set 在两次相似问题间变化，使“完全相同问题”偶尔发现新节点 → 对任意交集强制零重算；all-fresh 零调用由固定 need-set 合成夹具证明，真会话另记录新增差集而不把它误算重复。
- [Risk] SKILL.md 执行者绕过 planner 直接生成 → 提供单一 CLI 示例、删掉无条件生成措辞，并用真实前后 SHA/entry diff 验收。
- [Risk] fresh summary 本身语义不准确 → 它仍不是证据；答案前回查事实/源码，不支持的结论丢弃或限定。
- [Trade-off] file-level hash 可能让同文件多个节点一起失效 → 保持与现有 freshness/CAS 权威一致，避免引入第二套 symbol hash。
- [Trade-off] 不做并发 in-flight 去重 → 保持无长期锁、无崩溃恢复状态；接受首个提交前的偶发重复模型成本。

## Migration Plan

1. 先提交 planner/零写的失败 oracle，确认旧的无条件生成指令无法满足。
2. 实现只读 planner 与 CLI，再把 Chat 生成循环限制到 `generate[]`。
3. 跑 focused tests、独立 acceptor 审阅与固定 Conduit 顺序会话验收。
4. 三件套与 strict OpenSpec 门通过后，按逻辑 commits 经 PR 合入 `feat/lazy-retrieval-hardening`。

回滚只需撤回 planner 调用与 Chat 协议；cache schema 和已有数据未变化，不需要数据迁移。
