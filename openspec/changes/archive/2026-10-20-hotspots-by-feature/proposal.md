## Why

热点产物能按文件和目录回答「哪里改得多」，但回答不了「哪个功能改得多」。一个功能常常跨好几个目录：前后端分开的项目里，「发表文章」既有后端的路由和模型，也有前端的页面和组件。按目录汇总只能分别看到前端和后端。

功能的数字也不能由模型把文件行加起来得到。一次提交改了同一个功能里的 10 个文件，相加就会算成 10 次。sakai 的 samigo 目录就是这样：按提交去重后是 5,181 次，1,606 个文件的提交数直接相加是 26,272，是去重后的 5 倍。产物里只有每个文件的计数，没有提交号，模型拿到产物也没法去重。

哪些文件属于一个功能是判断题。`/excavator-domain` 已经由模型做了这件事：它产出的业务流程图里，每个流程的每一步都标了实现它的文件。剩下的只是计数，而计数要完整的提交记录，只有脚本拿得到。

## What Changes

- 热点脚本新增 `--groups <file>`，读一份分组文件：
  - 格式是 `{ "groups": [ { "name": "...", "paths": ["..."] } ] }`；
  - 一个路径是一个选中文件，或以 `/` 结尾的目录（指它下面的全部选中文件）；
  - 文件格式不对时报错，不写产物。
- 产物新增：
  - 头部 `featureGroups`：组数、属于至少一个组的文件数、属于多个组的文件数、没对上任何选中文件的路径数；没有传分组文件时为 `null`；
  - `groups`：每组一行，按分组文件里的顺序。每行有组名、给出的路径、没对上的路径，以及和目录行相同的计数：文件数、行数、提交数、作者数、增删行、最后改动、分数、按年的提交、作者份额。提交与作者在组内去重。没有传分组文件时是空数组。
- 残余假设加一条：一个组只算分组文件列出的文件；一个文件属于多个组时，在每个组里都算；脚本不检查这些文件是不是构成一个功能。
- `/excavator-hotspots` skill 在运行脚本前找分组：
  1. 有 `.excavator/feature-groups.json`（人写的）就用它；
  2. 否则，`.excavator/domain-graph.json` 能通过它的新鲜度检查时，用 jq 从里面导出：每个业务流程一组，组名是「领域 / 流程」，路径是各步骤的 `filePath`；写到 `.excavator/feature-groups-from-domain.json`，再传给脚本；
  3. 两样都没有就不分组，汇报里说明怎样得到分组。
- 汇报新增「按功能的改动」一节：
  - 用固定的话说明分组从哪里来、一个组只算列出的文件、一个文件可以在多个组里各算一次；
  - 按提交数列出各组；
  - 给出没对上的路径数。
- `excavator-chat` 能回答「哪些功能改得最多」「某个功能改了多少」，读 `groups`。没有分组时说明怎样得到。
- 不做：
  - skill 自己凭空提出分组；只用人写的分组或 `/excavator-domain` 的流程；
  - 按领域汇总（只按流程，领域级要的话可以手写分组）；
  - 路径通配符；
  - JSF 页面导航当分组来源。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `change-hotspots`：
  - 新增「按功能分组的改动」；
  - 「产物、新鲜度与查询」的头部字段、残余假设，以及 skill 与 chat 的读法，加上分组的说明。

## Impact

- 脚本：`skills/excavator/hotspots.mjs`、`skills/excavator/hotspots/aggregate.mjs`，新增 `skills/excavator/hotspots/groups.mjs`。
- skill：`skills/excavator-hotspots/SKILL.md`、`skills/excavator-chat/SKILL.md`。
- 测试：`tests/skill/excavator/test_hotspots.test.mjs`、`tests/skill/test_hotspots_skill_contract.test.mjs`。
- 产物格式仍是 `excavator-hotspots/1`，只加字段。不传分组文件时，产物只多一个 `null` 和一个空数组。
