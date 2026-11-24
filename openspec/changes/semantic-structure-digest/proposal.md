## Why

`route-entry-points`（`lazy-fact-graph/17`）给知识图加了一条新记录流 `entryPoints`。它不加节点、不加边，F2 语义缓存因此全部保住。但 F3 的语义图没有保住：

- `semantic-graph.json` 用 `factDigest` 绑定事实，而这个值就是知识图的 `project.factsDigest`。`factsDigest` 覆盖节点、边、coverage、gaps，现在还覆盖 `entryPoints`。
- 在 `go-multirepo` 上，升级后跑一次 Lazy：
  - 节点（10483）与边（40183）逐字节不变，10483 条语义缓存也逐字节不变；
  - `factsDigest` 变了，语义图的 `factDigest` 还是旧值。
- 结果，`/excavator-view` 判定语义「来自别的事实」，整块不放进页面：摘要、显示名和分层全没了。
- 今天唯一的恢复办法是 `/excavator --mode=full`。它会重跑由模型决定的 F3，分层被重新抽签，破坏用户要的「每次运行数据一致」。`route-entry-points` 承诺过：升级后只需重跑 F1 和下游 skill。

问题的根源：语义图绑定的是全部事实，而不是它真正由之构建的那部分。F3 的输入只有事实节点、事实边，以及语义缓存里新鲜的摘要与标签（语义缓存按 source hash 逐条判新鲜，与本摘要无关）。coverage、gaps 和附加记录流都不是 F3 的输入。

用户的要求不变：产物不手改，修在管线里；不允许不经核对就盖摘要的工具。

## What Changes

- **新摘要 `structureDigest`。** 事实构建在 `factsDigest` 之外再算一个摘要，只覆盖规范化后的事实节点与事实边，写进知识图文件头的 `project.structureDigest`。规范化与逐条哈希的方式与 `factsDigest` 相同。`factsDigest` 本身不变。
- **语义图改绑 `structureDigest`。** F3 写 `semantic-graph.json` 时记录 `structureDigest`，不再写 `factDigest`。新鲜度判定（F3 的 `check`、`merge-gaps` 之后的复用）一律比较两边的 `structureDigest`。附加记录流、coverage、gaps 的变化不再让分层失效；任何一个节点或一条边的变化仍让它失效。
- **读语义图的地方一起改，结论一致：**
  - `/excavator-view` 的语义产物；
  - `finalize-incremental.mjs` 选起步分层；
  - 部署运行器的跳过规则与产物检查；
  - 四个读图谱的 skill（chat、diff、explain、onboard）的「Reading Layers」一节；
  - `/excavator` 的 Phase F 说明。
- **旧语义图核对后重绑，只在 Lazy 里做。** 本变更之前写出的语义图只有 `factDigest`。Lazy 发布新知识图之后，对这样的语义图从内存里的当前投影重算候选摘要，逐个比较：
  - 当前的 `factsDigest`；
  - 去掉 `entryPoints` 记录流、`coverage.entryPoints` 与入口点缺口种类之后的摘要（也就是 `lazy-fact-graph/17` 之前的算法）。
  任一候选等于语义图记录的 `factDigest`，即证明它由之构建的节点与边与当前逐字节相同（两个候选都把节点与边原样放进哈希）。这时 Lazy 写入当前 `structureDigest`、去掉 `factDigest`，分层与其余字段原样保留。都不等时语义图一字不动，Lazy 报告它未绑定及原因。每种结果落一个可见桶，Lazy 的运行不会因此失败。
- **`PIPELINE_VERSION` 升到 `lazy-fact-graph/18`。** 文件头多了一个字段；MCP `sync_facts` 遇到 `/17` 清单时据此重新投影，否则会把没有 `structureDigest` 的图当成新鲜的。`factsDigest` 不含版本号，不变，所以领域图、关系图、unused-code、导览、doc-map 都不失效。
- **其它产物仍绑 `factsDigest`，理由逐个写在 design。** 领域图、关系图、unused-code 都读 `entryPoints`；导览读领域图；doc-map 读 coverage。它们随入口点变化而失效是对的。

不做的：
- 不加命令、不加 skill、不跑模型；
- 不升 `semantic-graph.json` 的 `version`；
- 不改 `factsDigest` 的定义；
- 不动旧的 Phase 1–7 补充路径（`annotate-graph.mjs` 的 `factsDigest` 定义不同，它写出的图从来不与 Full 语义图匹配，本变更也不给它加 `structureDigest`）。

## Capabilities

### Modified Capabilities
- `fact-graph`：文件头新增 `structureDigest`；读图谱的 skill 取分层按 `structureDigest` 比较。
- `full-semantic-isolation`：语义图的新鲜度键改为 `structureDigest`；新增旧语义图的核对重绑。
- `report-viewer`：语义产物的 unreadable 条件改为 `structureDigest` 不同或缺失。
- `runner-image`：full 产物的判定与产物检查按 `structureDigest`。

## Impact

- 代码：`skills/excavator/build-fact-graph.mjs`、`semantic-graph.mjs`、`lazy-analyze.mjs`、`finalize-incremental.mjs`，`skills/excavator-view/semantics.mjs`，`deploy/run-excavator.mjs`，`packages/core/src/{schema,types}.ts`（`ProjectMeta` 加可选字段，模式本来就是 passthrough）。
- 文档：`skills/excavator/SKILL.md` Phase F；`skills/excavator-{chat,diff,explain,onboard}/SKILL.md` 的 Reading Layers。
- 产物：已有项目的下一次 Lazy 会在文件头写 `structureDigest`。语义图如能证明事实未变，就被重绑；否则保持原样并报告。

## 提交序列

1. OpenSpec 变更（本目录）。
2. 事实构建：`structureDigest`、文件头字段、版本 `/18`、core 类型。
3. 语义图改绑：写、`check`、view、增量起步分层、部署运行器、SKILL 文档。
4. Lazy 里的旧语义图核对重绑。
5. 实测记录（tasks 5.x）。
