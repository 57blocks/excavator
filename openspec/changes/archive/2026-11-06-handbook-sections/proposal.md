## Why

系统手册还有几个部分要加：数据、问题与对策、专题与架构、全景与附录。现在每加一部分，`SKILL.md` 就多一个阶段，它已经 603 行。全放在一个提示词里有两个问题：
- 提示词越长，新规则越会挤掉旧规则；
- 各部分的依赖不同，却只能一起跑。概览要地图与应用根目录，功能条目要地图与领域。接下来的数据部分主要是脚本抽取，连地图都不需要。

把手册拆成几个**部分**，每个部分自成一个流程，可以单独选、单独续跑。

## What Changes

- 新选项 `--sections <list>`：选哪些部分，取值 `overview`、`features`，默认全选。以后的部分（先是数据）加进这个清单。
- 每个部分的阶段文字移到 skill 目录下自己的文件，只在选中时读：
  - `stages/map.md`：第 3 阶段（地图）与第 3c 阶段（业务领域）；
  - `sections/overview.md`：第 3b 阶段（系统概览）；
  - `sections/features.md`：第 4 阶段（条目）。
- 移走的文字逐字不变，阶段名也不变，原有的交叉引用照旧成立。
- 新命令 `handbook.mjs sections`：校验 `--sections`，按依赖打印这次要读的文件与顺序。选了概览或功能，就先读地图文件；以后的数据部分不需要地图。依赖由脚本决定，不让模型推。
- `SKILL.md` 留下公共骨架：规则、分工、选项、来源，第 0、1、2 阶段，读部分文件的一步，第 5、6 阶段（核对与追查，概览与功能共用），第 7 阶段（拼装）。
- 拼装不看 `--sections`：已有的都拼进去，没写的部分照旧写一行可见的说明，例如概览未写时写明停在哪一步。

**不做**：
- 拆成多个 skill：公共骨架、固定文字与核对协议只要一份；
- 改任何阶段的文字或行为；
- 数据部分：下一个变更做。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `product-handbook`：新增「手册的部分」要求。

## Impact

- `skills/excavator-product-handbook/SKILL.md`，以及新文件 `stages/map.md`、`sections/overview.md`、`sections/features.md`；
- `skills/excavator-product-handbook/handbook.mjs`，加 `sections` 命令；
- 合约测试与新命令的测试。
