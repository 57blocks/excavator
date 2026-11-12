## Why

一次真实运行里，子代理的花费占九成以上。每个子代理一启动就有约 3.7–3.9 万 token 的上下文，而它自己的说明只有两三千 token：手册的代理定义没有写 `tools`，于是继承了运行环境里的全部工具（内置工具、各个 MCP 服务器的工具）以及随之而来的说明。核对代理平均只跑约 3 轮，几乎全部花费都花在这次启动上，而且每个子代理都要重新写一遍这段缓存。

实测：同一个核对代理只给 Read、Write 时，启动上下文从 36,802 降到 5,591；追查代理只给 Read、Grep、Glob、Bash、Write 时，从 38,885 降到 9,215。

## What Changes

- **手册的每个代理定义写明 `tools`**：核对代理、三个评判代理只给读和写自己的判定文件所需的工具；追查代理再加搜索与只读命令。
- **新代理 `excavator-handbook-writer`**：写东西的子代理（概览、功能条目、发现、系统的发现、排序、对策、横切主题、改引用、固定文字的翻译）都用它，只给读源码、搜索、写自己文件所需的工具。它的说明只写「收到的提示就是全部任务、不再派子代理」，任务内容仍由各阶段的提示给出。
- **各阶段的派发文字**点名代理类型，不再派 general-purpose 子代理。

判定规则、提示、检查脚本、状态与产物都不变。

**不做：**
- 其他 skill 的代理（另立变更）；
- 减少核对与追查的次数；
- 改写条目的引用方式（删除率高的另一个原因，另立变更）；
- 指定或选择模型。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `product-handbook`：子代理的工具范围。

## Impact

- `agents/excavator-handbook-*.md`：加 `tools`；新文件 `agents/excavator-handbook-writer.md`。
- `skills/excavator-product-handbook/SKILL.md`、`stages/*.md`、`sections/*.md`：派发文字点名代理类型。
- 测试：代理定义与派发文字的合约测试。
