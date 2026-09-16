## Context

见 proposal.md「Why」。切片 A/B 已落：确定性事实图（空 summary）、`node-identity`（id 权威）、SourceSnapshot + `source-manifest.json` + `sync-fact-graph`（单文件增量的检测与重投影）、`excavator-chat` 已有结构/语义分流（语义问题当前只降级）。本切片在其上加检索与按需语义，且事实层只读。

约束：确定性脚本零模型；缺失可见；`.excavator/` 由 selection 排除；事实层 `knowledge-graph.json` 不被 chat 写。

## Goals / Non-Goals

**Goals:** 空 summary 图上也能定位英文代码并解释；只为需要的节点付 LLM 并缓存复用；开销有界、结论回源可核；事实层不可写。

**Non-Goals（设计层边界）:** 不做 Full 语义物理隔离 / Domain 新鲜度 / 消费端迁移（D）；不动 worktree 重定向（E）；不改事实层与 A/B 的 revision/manifest 语义。

## Decisions

### D1. 召回赌注先做原型/决策闸（**请重点评审**）
无 embedding、BM25 + 查询扩展能否把中文问题桥到英文代码（§12.3.1）是成败点。第 1 组任务是一个**原型 + 决策闸**：在一小组 wcp 中文业务问题 + 人工标注 gold（opt-in、真 provider、不提交）上测 top-20 召回。
- 达标 → 按 D2 建全量词法索引。
- 不达标 → 在本切片内**改用向量召回**（例如对 chunk 做 embedding + 近邻），spec 的召回门不变、只换实现。
不先过闸不建全量索引，避免把大工程压在一个未验证假设上。原型脚手架可留在 `eval/` 下、不进产品路径。

### D2. source-index 是确定性构建，chunk 复用 structure-all
新增 `skills/excavator/build-source-index.mjs`：从 `structure-all` 的声明/行范围切 chunk（path/owner/symbol/lineRange），叠加标识符子词拆分、注释、字符串；建 BM25 倒排。按 `sourceRevision` 持久化 `source-index.json`；接入切片 B 的 `sync-fact-graph`，单文件变化只重建该文件 chunks。零模型、可复现。

### D3. 检索机制确定性、扩展与判断在 chat（模型侧）
把可测的**机制**做成确定性辅助：BM25 查询、候选合并/打分、遍历原语（1-hop / 有界 BFS / 有界最短路，含预算与边界报告）都在 `.mjs` 里，纯函数、可单测。**查询扩展**（问题→检索词）与**问题类型判定**（结构 vs 语义、选哪种遍历）留在 `excavator-chat/SKILL.md` 的同一次推理里（模型侧），不另起 subagent。chat 调这些确定性原语，拿回候选与子图，再回源核实后作答。

### D4. 有预算遍历只走确定性边
遍历在事实边（contains/imports/exports/calls）上做 BFS/最短路，预算硬顶（seed≤20 / 节点≤80 / 边≤160 / 上下文≤12k tokens），达顶即停并报告边界。语义边/domain 只影响排序，不作为路径证据。**注意**：共享大包一连就横跨半个后端——BFS 深度是可调旋钮但不是功能边界，别指望遍历深度对齐人工策展的范围（范围问题留给 domain/D）。

### D5. semantic-cache 机制确定性、内容由模型；事实层只读
`semantic-cache.json` 的读写/锁/CAS/hash 判定做成确定性模块（可注入假 summary 单测）：可缓存三条件校验、字段白名单、`semanticSourceHash` 新鲜度、`.excavator/semantic.lock`（提交时短持有）+ 重读 + 按节点 source hash 的 compare-and-swap + 原子 rename + 陈旧锁 TTL 夺锁。**summary 的生成**是模型侧（chat 读源写摘要）。写入按 `node-identity` 的 node id 去重（切片 A 的身份契约是这里不重复、不悬挂的支点）。chat 的任何写入 MUST NOT 碰 `knowledge-graph.json`。

### D6. 诚实验收：机制单测 ≠ 模型可用（**请重点评审**）
确定性机制（chunk/BM25/预算/边界/缓存 CAS/hash/锁/陈旧）用合成夹具单测；但**检索召回质量与按需 summary 的内容质量**必须用真 provider 在 wcp 上 opt-in 验收（§12.3.1 gold、summary 是否只讲该节点自身职责且不编造）。fake-backed 全绿只证接线，不证模型可用——这条写进 tasks 的验收，不用单测顶替真跑。

## Risks / Trade-offs

- **BM25 桥不动中文→英文**（最大风险）→ D1 原型闸先证伪；不达标切向量，spec 召回门不变。
- **遍历在共享大包上外溢**（reachability 邻域 ≠ 功能边界）→ 预算硬顶 + 报告边界；范围对齐留 domain/D，不在本切片调深度硬凑。
- **按需 summary 越界**（把跨文件推断当节点自身职责、或编造）→ 可缓存三条件 + 字段白名单 + 回源核实；零编造是硬指标，靠真语料语义核验，不靠正则。
- **并发/陈旧锁**→ 提交时短持锁 + CAS + TTL 夺锁；锁只协调写不协调生成（接受偶发重复计算，见 lazy-mode-plan §8）。
- **事实层被误写**→ 断言 `knowledge-graph.json` SHA-256 在语义写入前后不变（§12.4.2）。
- **倒排表用普通对象当 map**（group 6 真语料发现并已修）→ 源码里 `constructor`/`toString`/`hasOwnProperty` 是真实标识符，`postings["constructor"]` 在普通 `{}` 上是继承来的函数而非数组，`.push` 直接抛（wcp 的 TS/Vue 触发，Go/合成夹具不触发）。已改为 null-proto map（写端）+ `hasOwn` 守卫（读端，索引 JSON 回读后仍是普通对象），并加回归夹具（先红验证）。
- **索引被工具自身产物/生成目录污染**（group 6 真语料发现，留作 selection 硬化 follow-up）→ 索引若扫进 `.excavator*` 变体、`.trash-*`、旧 run 的生成 `.js/.json`，这些数据块的 token 会淹没真实代码，召回从 6/6 掉到 2/6。正常被分析过的仓库 `.trash-*` 在被排除的 `.excavator/` 之内、风险低；但为稳健，**scan/SourceSnapshot 的 selection 应把工具产物按 glob（`.excavator*` / `.trash-*`）排除**（属切片 B 的 selection / core ignore，记为 follow-up，不在本切片扩范围）。clean 语料上召回门 6/6 成立。

## Migration Plan

- chat 从「语义问题降级」演进为「按需补充 + 缓存」；结构路径与降级仍是后备（无 provider / 写失败时）。
- 首次在已有 `source-manifest` 的项目上运行：按 revision 建 `source-index.json`；`semantic-cache.json` 初始为空，随问答增长。
- 回滚：本切片是加法（新文件 + chat 扩展）；关掉按需语义即回到 A/B 的结构-only chat。

## Open Questions

- ~~向量召回是否需要（由 D1 原型闸决定）~~ **已决（决策闸通过）**：无 embedding 的「查询扩展 + 标识符子词 BM25」在一组中文业务问题上 top-20 全部命中 gold（file-level 粗原型即达标，真 symbol-aware chunk 索引 + 精确/路径加权只会更好），故**按词法方案建索引，不引入 embedding**。真 §12.3.1 召回门仍在 group 6.2 用真 chat 扩展在真语料复核；若那里回落再考虑向量。原型与其 readings 为 opt-in、不提交。
