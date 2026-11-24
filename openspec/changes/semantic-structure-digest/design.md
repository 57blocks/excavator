## 决定

### D1 摘要覆盖的范围：节点与边，不多不少

`structureDigest = computeFactsDigest({ nodes, edges })`，规范化与逐条哈希与 `factsDigest` 相同，只是键只有 `edges` 和 `nodes`。

为什么只要这两样：F3 的输入（`skills/excavator/SKILL.md` Phase F3 第 1–3 步）是
- 每个事实节点的 `{id, type, name, filePath, owner}`；
- `imports` 与 `references` 边；
- 语义缓存里新鲜的 `tags`/`summary`。

语义缓存按 source hash 逐条判新鲜，不经过任何事实摘要。覆盖全部边而不只覆盖这两类边，是更保守的一边：多失效，不少失效。

不选「文件列表」作为第三部分：每个被扫描的文件都是一个 `file` 节点，已经在节点里。

代价：`structureDigest` 多一遍对节点与边的序列化与哈希。它的记录是 `factsDigest` 记录的子集，最长记录已由 `factsDigest` 报给 headroom recorder，所以这一遍传 `recorder: null`，不再记一条重复的条目。

### D2 选方案 (a)，而不是只做重绑 (b)

(a) 让语义图本来就只绑它的输入。以后再加任何附加记录流，都不会再出这个问题，也不需要再写迁移。

(b) 每次 Lazy 都去「证明输入没变再重绑」，要么保留旧事实，要么每加一条流就加一条剥离规则，长期是一个越积越多的兼容分支。

(a) 仍然 fail-closed：任何节点或边的变化（含 id、文件路径、行号、证据）都改变 `structureDigest`，语义图失效，与今天相同。

### D3 语义图的字段：写 `structureDigest`，不再写 `factDigest`；`version` 不升

两个摘要并存，读者会不知道该比哪个，所以只留一个。不升 `version`（仍为 `2.0.0`）：升版本会让 F3 的 `check` 把所有旧文件判为 `noncanonical-language` 并重建，正是要避免的重新抽签。旧文件靠「没有 `structureDigest` 键」识别。各读者对它的处理：
- view：unreadable，原因写明它没有 `structureDigest`、跑一次 `/excavator` 会在事实未变时重绑；
- F3 `check`：`rebuild`，status `missing`；
- 增量起步分层：不用它；
- 四个 skill：规则 2 不成立，并照实说；
- 部署运行器：算作 full 产物（见 D6）但不新鲜。

### D4 旧语义图的核对重绑（一次性迁移，只在 Lazy 发布之后）

位置：`runLazyAnalysis` 在知识图发布成功（`metaAdvanced: true`）之后调用 `rebindSemanticGraph({ dataDir, projection })`。只在这之后做，是因为这时磁盘上的图就是内存里的投影。Full 的 F1 与 MCP `sync_facts` 都经过 `runLazyAnalysis`，不另开入口。

候选摘要，按顺序算，命中即停：
1. `projection.factsDigest`：语义图是在当前算法下、对当前事实写出的；
2. `computeFactsDigest({ nodes, edges, coverage, gaps })`，其中：
   - `coverage` 先经 `coverageForDigest`（与构建时同一个函数），再去掉 `entryPoints` 键；
   - `gaps` 去掉 `ENTRY_POINT_GAP_REASONS` 的种类；
   - 没有 `entryPoints` 键。
   这就是 `lazy-fact-graph/17` 之前的算法。

剥离规则写成一张表 `ADDITIVE_FACT_STREAMS`（记录流键、coverage 键、缺口种类集合），不散在代码里。表只为本变更之前写出的语义图存在；新写的语义图都带 `structureDigest`，以后加的流不进这张表。

为什么这是核对而不是盖章：两个候选都把当前的节点与边原样哈希进去。sha256 相等就证明：语义图当初绑定的节点与边，与现在的逐字节相同。不相等就一字不写。

结果桶，每次 Lazy 恰好落一个，写进 `runLazyAnalysis` 的返回值 `semanticGraph: { status, reason }`，并打一行 stderr：
- `absent`：没有 `semantic-graph.json`；
- `bound`：已有 `structureDigest` 且等于当前，不写；
- `stale`：已有 `structureDigest` 但不等于当前，不写（要 Full 重建）；
- `rebound`：旧文件，核对通过，写入；
- `unbound`：旧文件核对不通过，或文件读不了、不是当前 schema、语言审计不通过、没有任何摘要。不写，原因写明。

写入用已有的 `writeSemanticGraph`（原子写，并复检 version、contentLanguage 与语言审计）。新文档是原文档把 `factDigest` 换成 `structureDigest`，键的位置不变，其余字段（`layers`、`relations`、`gaps`、`model`、`generatedAt`、`languageAudit`）原样。重绑失败（如写盘出错）只进 `unbound` 并报原因，不让 Lazy 失败。

### D5 `PIPELINE_VERSION` 升到 `lazy-fact-graph/18`

投影的输出多了文件头字段。不升版本，`sync-fact-graph.mjs` 会把 `/17` 清单判为新鲜而不重投影，留下没有 `structureDigest` 的图。`factsDigest` 不含版本号，所以下游绑 `factsDigest` 的产物不失效；F2 语义缓存不看版本号（`/16 → /17` 时已实测）。

### D6 部署运行器

- `planFullRun`：「有 full 产物」是 `semantic-graph.json` 带非空 `structureDigest`，或带本变更之前的非空 `factDigest`。后者是为了让旧产物走 `--mode=full`（其 F1 会重绑、F3 随之复用），而不是 `--full` 强制重建 F3。「新鲜」只认 `structureDigest` 等于图的 `project.structureDigest`。
- `checkProduct`：比较语义图与图的 `structureDigest`，任一边缺失或不是非空字符串都不通过，原因写明两个文件和两个值。

### D7 消费者核对（全部读 `factDigest`/`factsDigest` 的地方）

| 消费者 | 绑定 | 理由 |
|---|---|---|
| `semantic-graph.mjs` `check`/`write`/`merge-gaps` | 改为 `structureDigest` | F3 的输入只有节点、边与语义缓存 |
| `excavator-view/semantics.mjs` | 改为 `structureDigest` | 判的是语义图的分层 |
| `finalize-incremental.mjs` 起步分层 | 改为 `structureDigest` | 同上，按 skill 的 Reading Layers 规则选 |
| `tour-candidates.mjs` 的分层 | 随 view 的 `readSemantics` | 不单独判 |
| chat/diff/explain/onboard 的 Reading Layers | 改为 `structureDigest` | 同上 |
| `deploy/run-excavator.mjs` 跳过与产物检查 | 改为 `structureDigest` | 判的是 full 产物，即语义图 |
| `validate-graph.mjs` 读语义图分层 | 不判摘要（不变） | 只做引用完整性，节点不在就报 |
| 领域图（`annotate-domain`、`domain-freshness`、view `domain.mjs`） | 仍为 `factsDigest` | 领域抽取读 `entryPoints` |
| 关系图（`merge-relations`、`relations-freshness`） | 仍为 `factsDigest` | `relations-signals` 读 `entryPoints` |
| unused-code | 仍为 `factsDigest` | 根取自 `entryPoints` |
| 导览（`tour-*`、view `tour.mjs`） | 仍为 `factsDigest` | 候选读领域图，领域图随 `entryPoints` 变 |
| doc-map | 仍为中间 `fact-graph.jsonl` 的 `factsDigest` | 计数来自 coverage |
| MCP `project_status`/`sync_facts` | 只报告 `factsDigest`，不判语义 | 不读语义图 |
| `annotate-graph.mjs`/`publish-annotations.mjs`（旧 Phase 1–7） | 不变 | 它的 `factsDigest` 是另一种定义，从不与 Full 语义图匹配；增量更新经 `finalize-incremental` 的展开沿用上一次的 `structureDigest`，且带 `layersFrom: incremental`，规则 1 先适用 |

## Oracle（动手前写死）

- **O1 单元。** 给 `buildFactGraph` 两份输入：只差路由（一份有入口点记录与入口点缺口，一份没有），节点与边相同。`factsDigest` 不同，`structureDigest` 相同。再改一个节点的行号、或删一条边：`structureDigest` 不同。
- **O2 view。** 图文件头 `structureDigest` 等于语义图的、`factsDigest` 不同、带 `entryPoints` 流：语义为 included，分层个数与语义图相同。改一个节点或一条边、重算图的 `structureDigest`：语义为 unreadable，原因同时写出两个 `structureDigest`。
- **O3 重绑。** 每个桶各一个测试：
  - `rebound` 两条：命中候选 1、命中候选 2。`layers` 序列化逐字节不变；`factDigest` 键不再存在。
  - `unbound`：节点改过，文件逐字节不变。
  - `bound`、`stale`、`absent`：文件逐字节不变。
  - 读不了的 JSON：`unbound`，文件逐字节不变。
- **O4 管线端到端。** 在一个小夹具项目上跑 `runLazyAnalysis`，写一份 `factDigest` 为「`/17` 之前算法」摘要的旧语义图，再跑一次 Lazy：
  - 结果为 `rebound`，view 放进分层；
  - 改夹具的一个源文件让节点变化，再跑 Lazy：view 判语义 unreadable（`structureDigest` 不同）。
- **O5 实测（`go-multirepo` 副本，`~/Documents` 下，原件不动，不跑模型）。** 用本分支、重建过的 core dist 跑一次 Lazy：
  - 重绑结果为 `rebound`；
  - `/excavator-view` 的语义为 included，名称约 10752 个；
  - 新 `semantic-graph.json` 的 `layers` 与重绑前逐字节相同；
  - 节点、边与语义缓存逐字节不变；`factsDigest` 不变。

## Risks

- 候选 2 只认得「`/17` 之前」这一代算法。更早（`/16` 之前）写出、且之后节点与边又变过的语义图，本来就该失效。节点与边没变、但只差别的非节点字段的更早语义图，会落进 `unbound`，要 Full 重建。这是可见的，不是静默的。
- 旧 Phase 1–7 补充路径写出的图没有 `structureDigest`，任何语义图都不与它匹配。今天也一样（它的 `factsDigest` 定义不同），没有变坏。
