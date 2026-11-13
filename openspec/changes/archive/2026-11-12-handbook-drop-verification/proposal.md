## Why

轻量方案（`handbook-light-scheme`）之后，模型写的每一部分只写一次、由脚本检查，`checked` 是终态；技能文字不再派发核对员、追查员和评判员。但这一整套的代码还在：十条命令（`verdicts`、`slices`、`trace`、`trace-verdicts`、`priority-judge`、`priority-verdicts`、`remedy-judge`、`remedy-verdicts`、`topic-judge`、`topic-verdicts`）、它们的库模块、五个子代理定义和对应测试。技能的说明（frontmatter 的 description）也还写着「两个核对员、两个追查员」，与实际做法不符。没人调用的代码要维护、要跑测试，还会让读的人以为这些步骤仍在发生。

## What Changes

- 删除上面十条命令，以及删除后不再被任何保留代码引用的库模块。
- 删除子代理 `excavator-handbook-verifier`、`excavator-handbook-tracer`、`excavator-handbook-priority-judge`、`excavator-handbook-remedy-judge`、`excavator-handbook-topic-judge`，以及列出它们的部署夹具里的条目。
- 删除只测这些命令与模块的测试；混合测试只删相应用例。
- 技能说明改成与轻量方案一致：写一次、脚本检查、标明未核对。
- 状态里的 `confirmed`、`verified` 照旧当作已完成读取：以前的输出目录，以及轻量方案里「没有问题」的问题单元，都用到它们。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `product-handbook`：不再提供核对、追查与评判的命令和子代理。

## Impact

- 代码：`skills/excavator-product-handbook` 的命令表与库、`agents/`、测试与部署夹具。
- 已有输出目录：照旧能组装与出页面。
- 不改：轻量方案的流程、状态的键、输出文件、页面。
