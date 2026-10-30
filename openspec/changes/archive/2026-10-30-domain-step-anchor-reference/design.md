## Decisions

### D1 参照图只用来解析步骤的 nodeIds

校验器仍然只校验 `--graph` 给的那张图：锚点、证据行、引用完整性、层，全都只看这张图。参照图只提供一组节点 id，供步骤的 `nodeIds` 解析。不把参照图的节点并进被校验的图，否则悬空边、孤儿节点等检查会被参照图掩盖，输出的图也会变大。

不在 domain 图里复制被锚定的代码节点：domain 图的消费方不需要，而且那等于把测试夹具的错误假设写进产品。

### D2 三类计数加总数，守恒

每个 `step` 节点按顺序判定：有一个 `nodeIds` 能解析即为已锚定；否则标了 `provenance: "inferred"` 即为推断；否则为未锚定。报告给出 `stepsTotal`、`stepsAnchored`、`stepsInferred` 和 `stepUnanchored`，未锚定沿用原来的计数名，`step-unanchored` 缺口也不变。没有第四种状态。

### D3 参照图读不出就失败

`--reference` 给了但文件不存在或不是图时，运行以非零退出并指出路径，不写报告。否则所有锚定的步骤都会重新变成「未锚定」，正是这次要修的错误。不传 `--reference` 是合法的，行为与现在相同。

### D4 不适用的检查由 skill 照实说明

domain 图没有代码节点、边不带证据，`nodesChecked` 和 `edgesChecked` 本来就是 0。不在校验器里加「不适用」状态：计数本身已经如实为 0，问题出在 skill 让模型把对应的「0 个错配」当结果汇报。skill 改为汇报步骤的三类计数，并说明另外两项检查不适用于 domain 图。

## Oracle

- 单元测试：domain 图的步骤 `nodeIds` 指向只在参照图里的节点。传参照图时算已锚定；不传时算未锚定，原因写明 id 不在图里。三类之和等于步骤数。参照图路径不存在时非零退出且不写报告。修复前，前一个测试失败。
- 真实数据（部署测试留下的 domain 中间产物和知识图谱）：修复前 `stepUnanchored`=57；修复后传参照图，`stepsAnchored`=57、`stepsInferred`=23、`stepUnanchored`=0，与锚定报告的 57/23 一致。
