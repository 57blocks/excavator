## Why

在一个真实 Java 项目的部署测试里，domain 的源码校验报了 `stepUnanchored`=57，而锚定步骤的报告是 57 个已锚定、23 个未锚定，两组数字对不上。核实后发现校验器把结果算反了：

- 步骤的 `nodeIds` 指向知识图谱的代码节点，而校验器只拿 domain 图本身来解析这些 id。domain 图里只有领域、流程、步骤三种节点，所以每个真正锚定了代码的步骤都被算成「未锚定」；标了 `provenance: "inferred"` 的未锚定步骤反而被跳过。
- 同一份报告里 `nodesChecked`、`edgesChecked` 都是 0：domain 图没有代码节点，边也不带证据，这两项检查对它不适用。skill 却让模型报告 `anchorMismatch` 和 `edgeContradicted`，「0 个错配」读起来像全部通过。

这不只在只有 Lazy 图谱时出现，任何 domain 图都会这样。原有测试没抓到，是因为夹具让 domain 图自带一份被锚定的代码节点，而真实产物里没有。

## What Changes

- `validate-graph.mjs` 新增 `--reference <graph>`：步骤的 `nodeIds` 按被校验的图加参照图的节点一起解析。参照图给了却读不出时，运行失败，不写报告。
- 每个步骤只落进一类：已锚定、标为推断、未锚定。报告给出这三项和步骤总数，三项之和等于总数。
- domain skill 运行校验时，以知识图谱为参照图。汇报改为：步骤总数和三项计数；`nodesChecked`、`edgesChecked` 为 0 时说明这两项检查不适用于 domain 图，不当作通过来报。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `graph-validation`：领域步骤锚定的要求加上参照图、三类计数与守恒，以及参照图读不出时失败。

## Impact

- `skills/excavator/validate-graph.mjs`、`skills/excavator-domain/SKILL.md`
- `tests/skill/excavator/test_annotate_domain.test.mjs` 或 `test_validate_graph.test.mjs`
- Full 模式对知识图谱本身的校验不变：知识图谱里没有步骤，不传参照图。
