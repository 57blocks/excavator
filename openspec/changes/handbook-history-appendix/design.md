## Context

数据部分（`data`）是不派发子代理的脚本部分：`handbook.mjs` 读项目、写 `data.json`，拼装时渲染。系统事实（`lib/system-facts.mjs`）已经为每个应用读 git 得到首末提交与提交数、作者数。热点 skill 的 `buildHotspots(root)`（`skills/excavator/hotspots.mjs`）只用只读的 git 命令，在内存里算出每个文件与目录的提交数、作者、行数、分数与一起改动的文件对，多仓库父目录下每个成员仓库各读各的。

手册只陈述现状、不给建议（对策一章除外）。

## Goals / Non-Goals

**Goals：**
- 历史、热点、一起改动、测试计数全由脚本算出；
- 待确认事项与术语表只从已核实的内容原样汇出；
- 手册写出自己核对了什么、删掉了多少。

**Non-Goals：**
- 解释数字（「这些文件最需要拆分」）；
- 把术语翻译成别的叫法：术语表写源码里的原文与条目里已核实的含义。

## Decisions

### D1 部分

- `lib/sections.mjs` 加 `history`：文件 `sections/history.md`，没有共享阶段文件，不依赖地图，默认运行包括它，排在 `data` 之后。阶段文字只有一条命令与它的输出一行。
- 附录不是部分：拼装时总会汇出，只读输出目录。

### D2 历史

`handbook.mjs history <out> --project <root>` 写 `entries/history.json`（`excavator-product-handbook-history/1`）：
- `years`：`[{ year, commits, byApp: { <目录>: n } }]`，按提交的作者时间（UTC）分年；
- `apps`：`[{ dir, first, last, commits, authors, authors80 }]`；`authors80` 是按提交数从多到少累加到不少于 80% 时的作者数；没有版本历史的应用各项为 `null` 并写原因；
- `hotspots`：分数前 15 的文件 `{ path, app, commits, authors, lines, last, features: [<功能 id>] }`，`features` 是已核实条目里有引用落在这个文件的功能；
- `coChange`：两个文件在不同应用里的文件对，按共同提交数前 10 `{ a, b, commits }`；
- `tests`：每个应用 `{ dir, sourceFiles, testFiles }`，测试文件按固定的命名约定认（`*_test.go`、`*.test.*`、`*.spec.*`、`test_*.py`、`*_test.py`、`*Test.java`、`*Tests.java`、`__tests__/` 下的文件），约定写在页面的说明里。
- 不在项目里写任何文件；`buildHotspots` 在内存里调用。项目不在 git 里时，`history.json` 写 `noHistory` 与原因，测试计数照写。

### D3 附录

拼装时由 `lib/appendix.mjs` 从输出目录算出：
- **待确认事项**：每个已核实条目与概览的 `unknowns`，`{ feature, domain, item, searched }`，按领域与功能顺序；
- **术语表**：已核实条目的 `where[].label`、`screens[].name`、`states[].label`（与 `meaning`）、`who[].role`（与说明），以原文去重，按 Unicode 码位排序；每个术语写出现在哪些功能、有含义的写含义（多个含义都写，标出各自的功能）；
- **资料来源与口径**：每个部分每个单元写了多少项、核对删掉多少、追查删掉多少、改写多少（来自 `state.json` 与删除记录）；发现、级别、对策、横切主题各保留与删掉的数；固定的几句话说明手册读的是源码与 git 历史，没有读部署配置、生产数据与运行状态，以及每项事实经过了哪些检查。

### D4 呈现

- 「代码健康」一章在「横切主题」之后：每年提交数（表，另有 mermaid 的 xychart 柱图）、应用表、热点文件表、跨应用一起改动表、测试计数表。没有历史的写原因。
- 「附录」一章在「覆盖情况」之后：待确认事项、术语表、资料来源与口径三节。
- 技术视图与产品视图都写；产品视图的热点表不写路径，只写文件名与所属应用、功能。
- 页面：格式 `/14`；`history`、`appendix: { open, glossary, sources }`；新增代码健康页与附录的三个页面。

## Risks / Trade-offs

- **测试文件靠命名认。** 不按约定命名的测试数不进来；说明里写出约定。
- **改名后历史可能断开。** 热点脚本已有的世系冲突计数原样写出。
- **术语表只收原文。** 同一个概念的不同叫法不合并。

## Oracles

- **O1 脚本**，测试先红：
  - `history`：夹具是一个临时的多仓库父目录（两个 git 仓库，固定的作者与时间）：年份计数、`authors80`、热点前几位、跨应用文件对、测试计数；不是 git 的目录写 `noHistory`；项目目录在运行前后逐字节不变；
  - 附录：待确认事项只来自已核实条目；术语去重与排序；资料来源的计数与 `state.json`、删除记录一致。

  变异，各至少一条测试变红：`authors80` 改成 50%；跨应用文件对放进同应用的对；术语表收入被删掉的项。
- **O2 呈现**：两章的表、没有历史的说明、页面 `/14` 与新页面。变异：资料来源不写追查删掉的数，至少一条变红。
- **O3 真实运行**（go-multirepo）：在第 5 片真实运行的输出副本上以 `--sections history` 续跑，再拼装。
  - 记录耗时；条目与其它部分逐字节不变，项目目录不变（`git status` 与 `.excavator` 不被触及）；
  - **抽查**：年份与应用的提交数用 `git log` 独立复算；热点前 5 用 `git log --follow` 复算提交数；待确认事项条数与条目里的 `unknowns` 总数相等；术语抽 10 个回查条目原文。
- **O4**：受影响测试、`check-refs`、`openspec validate --all --strict` 本地过；全量门在分离检出里跑；源码零非 ASCII 字符；名字扫描无命中。
