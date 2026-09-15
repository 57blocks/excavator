## Why

切片 A/B 之后，Lazy 图谱只有确定性事实、`summary` 为空；chat 目前只能答结构类问题，语义类问题诚实降级到 `--mode=full`。要让「问一个中文业务问题、命中一段英文代码并解释它」在**不预烧整仓 LLM**的前提下成立，需要三件事：一个 symbol-aware 的词法检索索引、把用户问题扩展成代码检索词并有预算地多跳遍历的混合检索、以及**按需**在问答里补齐并缓存节点局部语义。本切片（Lazy 计划的切片 C）交付这三件，把「越问越懂、只为需要的节点付 LLM」变成现实，同时严守：事实层（`knowledge-graph.json`）只读不改，语义只落独立的 `semantic-cache.json`。

**风险前置**：无 embedding、仅靠 BM25 + 查询扩展能否把中文问题桥接到英文代码（§12.3.1）是本切片的成败赌注。故第 1 组任务是一个**原型/决策闸**：先在一小组 wcp 真值上验证召回，走不通就在本切片内改用向量召回，再建全量索引。

## What Changes

- 新增 **`source-index.json`**（§4.4/§7.1）：symbol-aware 的**词法（BM25）**索引。每个 source chunk 至少记录 path、owner、symbol、行范围、拆分后的 identifier、注释与字符串字面量。按 sourceRevision 持久化；单文件变化只重建该文件的 chunks（复用切片 B 的 sync）。默认不用 embedding（见风险赌注）。
- 新增 **混合检索**（§7.1）：
  - **查询扩展**——用**同一次** chat 推理把问题展开成少量代码检索词（英文术语、代码同义词、可能的 identifier）；不调度独立的 query-expansion subagent。
  - **候选合并排序**——精确 symbol / nodeId / path 命中 + `source-index` 的 BM25 + SourceSnapshot 源码搜索 + 有效 `semantic-cache` 文本，合并排序。
  - **有预算的多跳遍历**（§7.2）：定位/直接调用者=1-hop；流程/影响=有界 BFS（默认 ≤4-hop）；明确 A 到 B=有界最短路（≤6-hop）；预算 seed≤20 / 扩展节点≤80 / 边≤160 / 交给回答的上下文 ≤12,000 tokens；达预算即停并报告只覆盖到的边界。遍历优先用确定性边；语义边/domain 只辅助排序，不替代源码证据。
  - **seed 仅作种子**——`semantic-cache`/domain 命中只提供 seed，最终回答必须回到 fact graph 或当前源码**再核实**后才能进入答案。
  - **结构问题不触发语义**——结构类问题仍直接用事实层回答。
- 新增 **按需语义缓存**（§7.3/§7.4/§8）：需要理解职责/局部行为时，chat 读取必要源码、生成**节点局部** summary/tags，仅当同时满足「已读完该节点完整局部源码范围 / 能可靠概括其自身职责 / 不依赖未验证的跨文件推断」时才写 `semantic-cache.json`。可缓存字段限于：节点或文件自身 summary、局部 tags、`semanticSourceHash`、模型/时间 provenance。跨文件业务结论、领域流程、回答文本**不缓存**。
  - **新鲜度按 hash**（§7.4）：`semanticSourceHash == 当前 content hash` → 可复用；缺失 → 未生成；不等 → 过期立即忽略。
  - **并发**（§8）：共享 `.excavator/semantic.lock` 只在提交语义时短暂持有；提交前重读最新 manifest + fact graph + cache，对节点 source hash 做 compare-and-swap（拒绝 stale-hash 写入），原子 rename，陈旧锁按 TTL 夺锁。缓存写失败不得阻塞回答。
  - **事实层不可写**：chat 的语义写入 MUST NOT 修改 `knowledge-graph.json`（其 SHA-256 不变）。

**诚实边界**：fake-backed 的缓存机制单测全绿**不**证明检索质量——§12.3.1 的中文→英文召回与按需 summary 的内容质量必须用**真 provider 在真语料（wcp）**上验收（opt-in，产物不提交）。

**非目标（本切片明确不做）**：Full 语义物理隔离（`semantic-graph.json`）、Domain overlay 新鲜度、所有消费 skill 迁移（切片 D）；worktree 隔离 / 删除 SKILL.md worktree 重定向（切片 E）。不改事实层（A/B）——chat 只读它、只写独立的 `semantic-cache.json`。

## Capabilities

### New Capabilities
- `source-index`: symbol-aware 词法（BM25）索引 `source-index.json`——chunk 结构、按 sourceRevision 持久化、单文件增量重建。
- `hybrid-retrieval`: 查询扩展（同一次推理）+ 候选合并排序 + 有预算多跳遍历 + seed 需回源核实 + 结构问题不触发语义。
- `semantic-cache`: 按需节点局部语义补充 + 可缓存条件与字段限制 + hash 新鲜度 + 并发锁/CAS/陈旧处理 + 事实层只读不变。

### Modified Capabilities
（无：本切片新增均为新 capability。切片 A 的 `lazy-analysis`（chat 结构/语义分流）语义不变——语义问题从「降级提示」演进为「按需补充」是**新增**能力，不改既有 requirement；`fact-graph`/`source-snapshot` 不动。）

## Impact

- 目标分支：`feat/lazy-mode`（经 `lazy/slice-c` PR 合入）。
- 受影响：新增 `skills/excavator/build-source-index.mjs`（索引构建，接入 B 的 sync 做单文件增量）、检索与缓存的确定性辅助（chunking、BM25 打分、遍历预算、cache 读写+锁）；改 `skills/excavator-chat/SKILL.md`（查询扩展、混合检索、多跳、按需语义、回源核实）；复用 `source-snapshot`/`sync-fact-graph`/`node-identity`/`build-fact-graph`。
- 数据产物：新增 `source-index.json` 与 `semantic-cache.json`（均独立于 `knowledge-graph.json`；后者不被 chat 写入）。
- 测试：确定性部分（chunking、BM25、遍历预算与边界报告、cache 可缓存条件、hash 失效、并发 CAS/锁/陈旧）单测可覆盖；检索质量与 summary 质量走真 provider + wcp 真值 opt-in 验收。
- 契约地基：`semantic-cache` 的节点身份键与新鲜度是切片 D（Full 复用同一事实构建、Domain 新鲜度）的前置。
