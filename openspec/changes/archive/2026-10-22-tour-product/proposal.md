## Why

用户要查看页有 Understand Anything 的 Learn 模式：一条 5–15 步的导览，每步一段讲解、引用几个节点，图跟着移到这些节点。Understand Anything 在 `/understand` 里用 tour-builder 代理写出 `tour[]`；Excavator 没有对应的生产者，`/excavator` 固定写出 `tour: []`。用户要求「缺数据就先构建数据」，所以先有导览这份产物，再做查看页的 Learn。

导览是模型写的散文，最容易出现编造：讲解里说了引用节点没做的事，或者引用了图里没有的节点。用户的硬要求是零编造，覆盖缺口可以看得见地留着。

## What Changes

- 新增 skill `/excavator-tour`，在项目的 `.excavator/` 写出 `tour.json`。分工：
  - **脚本**（确定性）：从图谱、Full 模式语义文件、语义图的层与领域图算出候选集——入口候选、扇入与扇出排名、从入口出发的阅读顺序、每层的代表文件、每个 flow 的锚定节点、非代码文件——每个候选带上它当时新鲜且未被否定的摘要；
  - **模型**：只从候选集里挑节点，写 5–15 步的标题、讲解与可选的语言要点；
  - **脚本**：校验结构（步数、序号、`nodeIds` 必须在候选集里），截取每步引用节点的源码片段；
  - **核验子代理**（干净上下文，只看一步的文字与它引用节点的源码片段）：逐句给 verified / unverified / contradicted；
  - **脚本**：记录结论。有 contradicted 句子的步退回给模型改写一次再核验；仍被否定的句子从讲解里删掉，删空的步整步去掉，两者都写进产物的 `gaps`。
- 产物带 `sourceRevision` 与图谱的 `factDigest`，查看页据此判新鲜。报告与回复默认英文，`--language` 才换。
- 不改 `/excavator`：图谱里的 `tour` 仍是空数组，模型产物不进图谱。

## Capabilities

### New Capabilities
- `learning-tour`：导览产物的候选集、结构校验、逐句核验、产物格式与 skill 的最后回复。

### Modified Capabilities
<!-- 无。查看页读取导览放在下一个变更 viewer-learn。 -->

## Impact

- **新增代码：**
  - `skills/excavator-tour/SKILL.md`；
  - `skills/excavator/tour.mjs`（`candidates`、`check`、`slices`、`verdicts`、`report` 子命令）；
  - `agents/excavator-tour-verifier.md`；
  - 测试 `tests/skill/excavator-tour/*`。
- **插件清单与 `check-refs`：** 新 skill 与新代理要登记。
- **花费：** 一次运行是一个主模型回合，加上每步一个核验子代理。在 go-multirepo 上实测后写进验收记录。
- **不变：** 其它产物的格式、`/excavator` 的行为，以及只读源码、不联网。
