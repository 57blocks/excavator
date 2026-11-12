## Why

读图谱的四个 skill 取分层时让模型 grep `"layers"`：
- `excavator-onboard` 第 4 步，第 7 步的 Architecture Layers 一节依赖它；
- `excavator-chat` 第 7 步；
- `excavator-diff` 第 6 步；
- `excavator-explain` 第 6 步。

`knowledge-graph.jsonl` 里带 `"layers"` 键的只有第一行文件头，它的 `counts.layers` 是一个数。这样 grep 拿不到任何分层，模型要么报不出分层，要么自己按目录分组，把没有出处的分层写进产物。

分层实际在两处：
- Full 运行把分层写进 `semantic-graph.json`（`full-semantic-isolation`：语义写进独立产物，Full 不改 `knowledge-graph.jsonl`）。它的 `factDigest` 等于图谱的 `factsDigest` 时才与当前事实对应，查看器也只在这时用它。
- 增量更新（`finalize-incremental.mjs`）把分层写成 `knowledge-graph.jsonl` 里的 `{"record":"layer",…}` 行；Lazy 重建时保留已有的分层行。

两个摘要分不出哪一处是后写的：增量更新沿用上一次的 `project`，`factsDigest` 不变，也不写 `semantic-graph.json`。Full 之后再做增量更新，两个摘要仍然相等，语义图的分层却漏了新文件、还列着删掉的文件。反过来，Lazy（含 Full 的 F1）把旧的分层行原样带过下一次 Full，那时语义图才是新的。

四个 skill 的 Graph Structure Reference 只写了分层行，没有写 `semantic-graph.json`。

## What Changes

- `finalize-incremental.mjs` 写分层行时在文件头的 `project` 里写 `layersFrom: "incremental"`，标明分层行是最后写出的分层。Lazy 重建 `project` 时不带这个字段，所以 Full 的 F1 会去掉它。
- 四个 skill 各加一节逐字相同的 **Reading Layers**：
  - 文件头的 `layersFrom` 是 `incremental`：用图谱里的 `"record":"layer"` 行；
  - 否则 `semantic-graph.json` 的 `factDigest` 等于图谱文件头的 `factsDigest`：用它的分层；
  - 否则用图谱里的分层行；
  - 两处都没有可用的分层：照实说没有分层，不自行分组；
  - 有 `semantic-graph.json` 而没有用它：照实说它的分层比分层行旧或来自别的事实，建议运行 `/excavator --full`；
  - 查一个节点的分层按精确字符串匹配（`jq` 的 `index`、`grep -F` 加引号）；分层只列文件级节点，函数或类用同一 `filePath` 的文件级节点 ID。
- 四个 skill 取分层的一步改为按这一节取；Graph Structure Reference 的分层行注明 Full 的分层在 `semantic-graph.json`；onboard 的 Architecture Layers 一行改为取自这一节，没有分层时在这一节写明。其余措辞不变。
- 新增契约测试：
  - 四个 skill 的 Reading Layers 一节逐字相同，取分层的一步指向它，整份 skill 不出现 `"layers"`；
  - 用存储模块与 `semantic-graph.mjs` 写出真实产物，逐条跑这一节的命令：当前的语义图、过期的语义图加分层行、两处都没有，三种情形各得到规则所说的输入；
  - 真实跑一遍 Full、增量更新、再一次 Full（`lazy-analyze.mjs`、`semantic-graph.mjs write`、`prepare-incremental.mjs`、`finalize-incremental.mjs`），每一步之后按规则选出的来源都是最后写出分层的那一处；
  - 改回 `"layers"`、删掉没有分层时的规则、删掉 `semantic-graph.json`、把 `layersFrom` 一条挪到摘要比较之后，检查都报出问题。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `fact-graph`：新增一条：读图谱的 skill 从最后写出分层的地方取分层；增量更新在文件头标明分层行是最后写出的。

## Impact

- **散文：** 四个 SKILL.md 各加 Reading Layers 一节，改分层行的说明与取分层的一步；onboard 另改 Architecture Layers 一行。
- **测试：** 新增 `tests/skill/test_graph_skill_layer_step.test.mjs`。
- **代码与产物：** `finalize-incremental.mjs` 在增量更新写出的文件头 `project` 里多写一个字段 `layersFrom: "incremental"`。`ProjectMetaSchema` 是 passthrough，读图谱的代码不受影响；存储格式、`semantic-graph.json` 与查看器不变。
- **不在范围内：**
  - `agents/excavator-knowledge-graph-guide.md` 把两种图谱写成同一个整文档形状，它的分层查询示例只读 `.record == "layer"` 行，没有提 `semantic-graph.json`；本变更不改它。
  - 第 3 步取 `"project"` 的写法：文件头带 `fields.project`，grep 能命中，本变更不改。
