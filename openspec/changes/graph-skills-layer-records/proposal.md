## Why

图谱改为按行存储（`knowledge-graph.jsonl`）之后，每个分层是单独的一行 `{"record":"layer","layer":{id,name,description,nodeIds[]}}`。文件里带 `"layers"` 键的只有第一行文件头：它的 `counts.layers` 是一个数。

读图谱的四个 skill 在取分层的那一步仍然让模型 grep `"layers"`：
- `excavator-onboard` 第 4 步「Grep for `"layers"` to get the full layers array」，第 7 步的 Architecture Layers 一节依赖它；
- `excavator-chat` 第 7 步；
- `excavator-diff` 第 6 步「in the `"layers"` section」；
- `excavator-explain` 第 6 步，同样的写法。

这样 grep 只命中文件头，拿不到任何分层。模型要么报不出分层，要么自己按目录分组，把没有出处的分层写进指南或解释。四个 skill 各自的 Graph Structure Reference 已经写明分层行的形状，取分层的步骤和它自相矛盾。按行存储的变更迁移散文时漏了这四处。

## What Changes

- 四个 skill 取分层的步骤改为读分层记录：
  - grep `"record":"layer"` 取全部分层行；
  - 查某个节点的分层时，在分层行里找带引号的节点 ID；分层只列文件级节点，函数或类用同一 `filePath` 的文件级节点 ID；
  - 没有分层行命中时，照实说图谱没有给出分层，不自行分组。
- `excavator-onboard` 第 7 步的 Architecture Layers 一节改为取自分层行；图谱没有分层时在这一节写明。
- 每个 skill 的其余措辞不变。
- 新增契约测试：
  - 凡在 Graph Structure Reference 里写了分层行的 skill，Instructions 里取分层的那一步必须写 `"record":"layer"`，整份 skill 不得出现 `"layers"`；
  - 用存储模块写出一张小图，核对 `"record":"layer"` 恰好命中全部分层行，`"layers"` 只命中文件头。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `fact-graph`：新增一条：读图谱的 skill 按记录类型取分层。

## Impact

- **散文：** `skills/excavator-onboard/SKILL.md`、`skills/excavator-chat/SKILL.md`、`skills/excavator-diff/SKILL.md`、`skills/excavator-explain/SKILL.md` 各改取分层的一步，onboard 另改 Architecture Layers 一行。
- **测试：** 新增 `tests/skill/test_graph_skill_layer_step.test.mjs`。
- **代码与产物：** 不变。存储格式、图谱内容与 MCP 工具都不动。
- **不在范围内：**
  - `agents/excavator-knowledge-graph-guide.md` 的 Graph Structure 一节把两种图谱写成同一个整文档形状；它给的查询示例已经按 `.record == "layer"` 取分层，不是 grep `"layers"`，本变更不改它。
  - 第 3 步取 `"project"` 的写法：文件头带 `fields.project`，grep 能命中，本变更不改。
