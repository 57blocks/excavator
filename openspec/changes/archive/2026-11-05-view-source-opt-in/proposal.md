## Why

`/excavator-view` 不加参数时，会把产物引用到的每个源文件（含知识图谱的全部文件节点）的原文内嵌进页面，`--no-source` 才不嵌。配置文件（`*.properties`、`*.yml`、`settings.xml`、`docker-compose.yaml`）同样会被内嵌，而数据库连接串、账号密码一般就写在这类文件里。

页面经常是要从分析环境拉回、或转给别人看的那一个文件。在源码不允许带离的环境里，只要有一次漏加 `--no-source`，源码就随页面带出去了。危险的做法不应该是默认值。

## What Changes

- `pack.mjs` 与 `/excavator-view` 默认不内嵌源码：每个被引用文件归入 not embedded on request，页面里没有源码文本。
- 新增 `--source`：显式要求内嵌，规则与原来的默认相同（HEAD 快照、单文件 1 MiB 上限、二进制不嵌）。
- `--no-source` 保留，与默认相同，已有的命令与脚本照常可用；两者同时给出时以后出现的为准。
- 回复的 `Source:` 行不变。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `report-viewer`：内嵌源码从默认改为显式选择。

## Impact

- `skills/excavator-view/pack.mjs` 的命令行解析与用法说明；`skills/excavator-view/SKILL.md` 的参数说明；`README.md` 一行。
- 测试：`tests/skill/excavator-view/pack-sources.test.mjs` 的命令行用例与 `skill-contract.test.mjs` 的参数提示。
- `packProject()` 的程序接口不变（调用方显式传 `noSource`），只改命令行默认值。
