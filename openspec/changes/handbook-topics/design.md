## Context

第 4d 片之后，手册在追查之后依次运行定级（第 6b 阶段）与对策（第 6c 阶段），二者都只读脚本列出的已核实内容，由两名评判者判断文字是否有出处。功能条目（`entries/<id>.json`）在核对与追查后只留下已核实的项：`who`、`where`、`screens`、`operations[].sentences[]`、`states`、`notifications`、`automatic`、`unknowns`。领域文件（`domains.json`）把功能分进领域。

横切主题与对策是同一种工作：从已核实的内容汇总，不读代码。

## Goals / Non-Goals

**Goals：**
- 五个主题各一张表，每行引用已核实的条目项或发现组；
- 行里的每个事实都能在引用里找到。

**Non-Goals：**
- 补条目没写的事实：条目没写的审批路线，主题里也没有；
- 判断主题是否齐全：覆盖一节写出依据的条目数与删掉的行。

## Decisions

### D1 部分与阶段

- `lib/sections.mjs` 加 `topics`：文件 `sections/topics.md`，没有共享阶段文件，默认运行包括它，排在 `remedies` 之后，`afterTrace`。
- `handbook.mjs sections` 为它打印 `AFTER_TRACE=sections/topics.md`，在 `remedies` 那一行之后。第 6d 阶段在第 6c 之后、第 7 阶段之前。
- 没有已核实的条目也没有已核实的发现组时，什么也不派发，打印一行说明。

### D2 可引用的内容

`handbook.mjs topic-facts <out> --lane <id>`，一行一项，制表符分隔，id 是第一个字段：
- 领域通道（`--lane <领域 id>`）：这一领域每个已核实条目的项，`<功能 id>#<项路径>`、功能名、种类（`who`、`sentence`、`state`、`automatic`、`notification`）、文字（`who` 写角色与说明；`sentence` 写句子与所属操作名；`state` 写标签与含义；`automatic` 写时机与效果；`notification` 写时机、渠道与收件人）。
- 问题通道（`--lane repeated`）：已核实的发现组，与 `remedy-facts` 的组行相同，另加每组所在的应用目录。
- `handbook.mjs topic-lanes <out>` 列出有内容的通道：每个至少有一个已核实条目的领域，以及有已核实发现组时的 `repeated`。

### D3 主题与行

- 主题与列由脚本固定：
  - `approval`：`business`、`route`、`skips`、`conditions`、`actors`；
  - `time`：`rule`、`calendar`、`scope`；
  - `handoffs`：`from`（领域 id）、`to`（领域 id）、`content`；
  - `access`：`feature`（功能 id）、`who`、`pageCheck`、`serverCheck`；
  - `repeated`：`mechanism`、`places`。
- 领域通道写 `topics/part-<领域 id>.json`，只能写前四个主题；问题通道写 `topics/part-repeated.json`，只能写 `repeated`。每行 `{ "topic", "fields": {…}, "cites": ["<id>"] }`；一列可以是空串（条目没说的不写），`cites` 至少一项。
- `handoffs` 的 `to` 必须是本通道的领域；`from` 必须是另一个已有的领域 id。
- `access` 的 `feature` 必须是本领域的功能，且行引用它的至少一项。

### D4 检查

`check-topics <out> --lane <id>`：
- 主题与列都在表里，通道只写它能写的主题；
- 所有 id 都在这一通道当前 `topic-facts` 的输出里；
- 文字通过读者文字检查（无代码词、无文件名、语言一致、无建议词）；
- 文字里的每个数字都出现在它引用的项的文字里。

失败重派一次，再失败记为失败。全部通道通过后，`check-topics <out>` 合并成 `entries/topics.json`（按主题、通道、行的顺序），状态记在 `state.json` 的可选键 `topics`：每个通道的事实摘要与状态。通道的事实变了，这个通道从头开始。

### D5 子代理与评判

- `sections/topics.md`：一个通道一个子代理，输入只是 `topic-facts` 的输出与主题表的说明，不读代码。每行只写引用的项说到的事；一项说不清的列留空，不推测。领域之间的数据只在使用方的项写明「来自」或「用到」另一个领域的东西时写。
- 新 agent `excavator-handbook-topic-judge`：判定文件列出每行的各列与它引用的全部文字。对每行给 `follows` 或 `doesNotFollow` 与一行原因：行里每列的每个事实是否都在引用里；`handoffs` 的提供方是否由引用撑得住。
- `topic-judge` 写判定文件；`topic-verdicts` 记录：两名都 `follows` 的行才保留，其余删除并记录原因。

### D6 呈现

- 新的一章「横切主题」，放在「发现」与「建议」之后、「覆盖情况」之前；每个主题一节，一张表，每行最后一列是依据（功能名与项的文字摘要；技术视图另写文件与行号）。
- `handoffs` 另画一张 mermaid 图，节点是领域名，边上写内容，由脚本从保留的行生成。
- 一个主题没有保留的行时写「依据的 N 个已核实条目里没有写出这类内容」，不写系统没有。
- 覆盖一节写出每个通道的状态、删掉的行与原因。
- 页面：格式 `/13`；`topics: { approval: [...], time: [...], handoffs: [...], access: [...], repeated: [...] }`；新的横切主题页。

## Risks / Trade-offs

- **主题只和条目一样全。** 条目没写审批人解析，主题就没有；覆盖一节写出依据的条目数。
- **领域之间的数据只从使用方看。** 提供方条目里写的「被谁用」不进表；行引用的是使用方的项。
- **权限一列的页面与服务端检查**只在条目分开写了二者时才会都有；只有一边时另一列留空。

## Oracles

- **O1 脚本**，测试先红：
  - `topic-facts`：领域通道只列这一领域已核实的项、种类与文字；问题通道列组与应用；
  - `topic-lanes`：没有已核实条目的领域不列；
  - `check-topics`：不认识的主题或列、领域通道写 `repeated`、不在本通道的 id、`handoffs` 的 `to` 不是本领域、数字不在引用里、文字有代码词或建议词，各退出 1；
  - `topic-verdicts`：两名都 `follows` 才保留。

  变异，各至少一条测试变红：一名 `follows` 就保留；数字检查关掉；跨通道引用放行。
- **O2 呈现**：主题表的依据列、空主题的说明、handoffs 的图、删掉的行列在覆盖、页面 `/13` 与横切主题页。变异：行不写依据，至少一条变红。
- **O3 真实运行**（go-multirepo，Sonnet 是测量条件）：在第 4d 片真实运行的输出副本上以 `--sections topics` 续跑。
  - 记录花费、各主题行数、评判删掉的数目；
  - 条目、发现、定级与对策逐字节不变；
  - **验收者独立抽查**每一行（不看实现）：行里每个事实是否都在引用里。线：零编造。
- **O4**：受影响测试、`check-refs`、`openspec validate --all --strict` 本地过；全量门在分离检出里跑；源码零非 ASCII 字符；名字扫描无命中。
