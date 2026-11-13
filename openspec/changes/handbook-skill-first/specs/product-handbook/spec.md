## ADDED Requirements

### Requirement: 章节由散文提示词写成

模型写的每一部分 SHALL 是一章 Markdown，由 `excavator-handbook-writer` 子代理按 skill 里的散文提示词写成：
- 系统章节；
- 每个功能一章；
- 跨功能的各章：领域、角色、通知与定时任务、横切主题、缺陷、对策。

提示词 SHALL 写明这一章要覆盖的内容、出处写法与读者文字的要求，SHALL NOT 要求写任何 JSON 事实表、发现文件或其他结构化文件。每章 SHALL 由一个子代理在一次读取里写完。

结构化事实（入口候选、应用根、数据、状态字典、代码健康）SHALL 只由脚本写出，模型 SHALL NOT 转写或补写。

#### Scenario: 功能写作只产出一章

- **WHEN** 编排者为一个功能派发写作
- **THEN** 子代理只写 `chapters/<id>.md` 这一个文件，输出目录里没有这个功能的 JSON 文件

#### Scenario: 数据一章不由模型写

- **WHEN** 运行选了 `data`
- **THEN** `data.json` 与 `dictionaries.json` 由脚本写出，没有子代理被派发去写数据

### Requirement: 章节的 Markdown 约定

每章 SHALL 遵守同一套约定，脚本按它检查、拼装与渲染：
- 用 `#` 到 `####` 的标题。
- 陈述事实的句子、列表项与表格行，SHALL 以引文组结尾：圆括号里一条或多条引文，每条用反引号写成「项目根下的路径:起-止」或「路径:行」，多条之间用「; 」分隔。反引号只用于引文。
- 用全角标点的语言（中文、日文）里，引文组的括号与句末句号 SHALL 用该语言的全角符号；`check` 拒绝中文或日文文字后面的半角括号引文组。
- 功能章节与系统章节 SHALL 各有「待确认」与「问题」两节，标题文字取固定文字表里对应的项。没有内容时，写一行固定文字。
- mermaid 图写在 ```` ```mermaid ```` 围栏里；不限制它的语法子集。

界面标签、按钮文字与状态名 SHALL 用引号照源码原文写，不翻译。

#### Scenario: 一条引文

- **WHEN** 一句写「申请保存为草稿（`src/requests/save.ts:40-52`）」
- **THEN** 这句的引文是该文件的第 40 到 52 行

#### Scenario: 中文句子用了半角括号

- **WHEN** 中文章节里一句写成「申请保存为草稿 (`src/requests/save.ts:40-52`).」
- **THEN** `check` 不通过，原因指出这一行要用全角括号与句号

#### Scenario: 中文手册的问题一节

- **WHEN** 以 `--language Chinese` 运行
- **THEN** 功能章节里「问题」一节的标题是固定文字表里那一项的中文译文，脚本按这个标题找到这一节

### Requirement: 章节的版式

每章 SHALL 写成便于扫读的版式，不写成大段文字：
- 每段 SHALL 不超过 4 句（数句子时不计引文组）；
- 每章 SHALL 用二级、三级标题分节，功能章节按提示词给出的节序写：概述、页面、操作、规则、状态、通知与自动发生的事、交接、待确认、问题，没有内容的节省略（待确认与问题两节除外）；
- 三项以上的并列内容 SHALL 写成列表；
- 字段、列、筛选、状态、角色与通知这类有多个属性的条目 SHALL 写成表格，每行以引文组结尾；
- 三步以上的操作 SHALL 画 mermaid 流程图（`flowchart`），有三个以上状态的记录 SHALL 画状态图（`stateDiagram-v2`），图后照常用带引文的列表逐步说明。

`check` SHALL 核对其中能确定判定的部分：段落的句数、功能章节至少有一个列表或表格、每个 mermaid 围栏的第一行是一种已知的图类型。

#### Scenario: 一段写了六句

- **WHEN** 一个功能章节有一段六句话的文字
- **THEN** `check` 把这一章记为不通过，原因行写出这一段的起始行号与句数

#### Scenario: 功能章节没有列表与表格

- **WHEN** 一个功能章节全部是段落
- **THEN** `check` 把这一章记为不通过

#### Scenario: mermaid 第一行不是图类型

- **WHEN** 一个 mermaid 围栏的第一行是 `A --> B`
- **THEN** `check` 把这一章记为不通过，原因行写出这一行

### Requirement: 指定功能

`--features` SHALL 只为列出的功能写章，值是逗号分隔的功能编号或功能名（名字忽略大小写、整名匹配）。地图仍覆盖全部候选。没写的功能在手册里列为未写。名字匹配不到任何功能时，运行 SHALL 停止并打印这个名字与可用的功能名。

只写了部分功能时，跨功能各章 SHALL NOT 开始：`check --before cross` 列出缺的功能，运行在拼装前停下，告诉用户缺几章；拼装照常用已有的章节。

#### Scenario: 只写一个功能

- **WHEN** 以 `--features F3 --sections features` 运行，输出目录里已有地图
- **THEN** 只派发 F3 的写作，其他功能的章节文件不变

#### Scenario: 未知的功能名

- **WHEN** 以 `--features "no such page"` 运行
- **THEN** 运行停止，打印这个名字与可用的功能名

### Requirement: 系统章节

一个写作子代理 SHALL 读地图、脚本列出的应用根、各应用的构建清单、配置、启动代码与外部系统的搜索结果，写 `chapters/system.md`。这一章 SHALL 包括：
- 系统是什么、谁在用；
- 有哪些应用与它们的技术栈；
- 前端怎样到达各后端；
- 数据库、外部与云服务；
- 构建与部署；
- 登录与权限；
- 不属于任何单个功能的共享部分里的问题，放在「问题」一节。

#### Scenario: 系统章节缺一节

- **WHEN** `chapters/system.md` 没有「问题」一节
- **THEN** `check` 把它记为不通过，并打印缺的那一节

### Requirement: 功能章节

每个功能 SHALL 由一个写作子代理写一章 `chapters/<id>.md`。

**从哪里读：** 子代理从地图给的种子文件出发，顺着导入、调用、常量、事件与监听读出去，读的文件数不设上限。

**要覆盖的内容（以代码能说明的为限）：**
- 用途与使用者；菜单位置与路由；
- 每个页面的字段、筛选、列、按钮与提示文字；
- 每个操作在前后端逐步发生什么；
- 每条规则与它的确切条件，每个例外单独成句；
- 每个计算的输入、比率、取整与上限；
- 记录的状态与推动它的动作；
- 每个通知的触发、接收人、渠道与内容；
- 自动发生的事；
- 交给哪个别的功能。

**断言先搜全项目：** 写「从不」「总是」「所有」「只有」这类断言之前，子代理 SHALL 在全项目里搜过；判不准的写进「待确认」，并写明搜了什么。

**问题一节：** 写这个功能的代码今天表现出的、读者能复现的缺陷，每条带引文；SHALL NOT 写建议。

#### Scenario: 判不准的断言

- **WHEN** 子代理找不到证据说明某个通知是否发给所有审批人
- **THEN** 这一点写在「待确认」里，带搜过的范围，正文里不写「所有审批人」

### Requirement: 跨功能章节读章节

功能章节写完后，跨功能各章 SHALL 由写作子代理读功能章节与系统章节写成，SHALL NOT 读项目代码：
- **领域：** 业务领域、每个领域的功能与它们之间的交接与主流程；
- **角色：** 角色与每个角色能做什么；
- **通知与定时任务：** 每个通知与每个定时任务；
- **横切主题：** 审批路线、日历与时区、领域之间的数据、访问控制、多处出现的同一问题；
- **缺陷（`defects`）：** 汇总各章「问题」一节，合并同一处缺陷，并给每条一个级别 P0、P1 或 P2，带一句理由；
- **对策：** 每类缺陷的共同原因与措施，以及 1 到 10 条按顺序的建议。

跨功能章节里每句陈述 SHALL 照抄它所依据那一行的引文组，SHALL NOT 编新的引文。

#### Scenario: 主题章照抄引文

- **WHEN** 横切主题一章写「两个功能各自判断学期是否开放」
- **THEN** 这句带的引文是两个功能章节里那两行的引文，`check` 照样核对这些引文

#### Scenario: 跨功能章节不读代码

- **WHEN** 检查跨功能各章的提示词
- **THEN** 每份都只让子代理读输出目录里的章节文件，不读项目代码

### Requirement: 只有对策一章给建议

除对策一章以外，每章 SHALL 只陈述代码今天的样子：
- 问题与发现陈述缺陷本身与它发生的情形，SHALL NOT 写应该怎样改；
- 对策一章可以写该做什么，但它对现状的每句陈述 SHALL 来自它照抄的引文。

#### Scenario: 功能章节里出现建议词

- **WHEN** 一个功能章节的「问题」一节写「应当在保存前校验」
- **THEN** `check` 把这一章记为不通过，并打印这个词与它所在的行

### Requirement: 收尾检查

一条确定性命令 `check` SHALL 检查输出目录里的每一章，并打印每章的通过与否和逐条原因。检查项：
- 每条引文的文件在项目根下、不在 `.excavator`、`.git`、`node_modules`、`vendor`、`dist`、`build` 里，行号在文件范围内，跨度不超过 80 行；
- 陈述事实的行带引文组（标题、以冒号结尾的引导行、表头分隔行、围栏内的行与固定文字行除外）；
- 读者文字（引号内的原文、引文与 mermaid 围栏以外）里没有代码形状的词：带下划线的标识符、驼峰词、以 `/` 开头的路径、带源码扩展名的文件名、名字后跟 `(`；
- 对策以外的章没有建议词；
- 功能章节与系统章节有「待确认」与「问题」两节；
- 「章节的版式」里能确定判定的三项。

`check` SHALL 把每章的结果与尝试次数记进 `state.json`，SHALL NOT 改动任何章节文件。

#### Scenario: 行号超出文件

- **WHEN** 一条引文写 `a.ts:26`，而 `a.ts` 只有 25 行
- **THEN** 这一章不通过，原因行写出这条引文与文件的行数

#### Scenario: 没带引文的事实行

- **WHEN** 一章有一行陈述事实的句子没有引文组
- **THEN** 这一章不通过，原因行写出这一行的行号

#### Scenario: 检查不改文件

- **WHEN** 对一个输出目录运行 `check`
- **THEN** `chapters/` 下每个文件运行前后逐字节相同

### Requirement: 重写一次，不通过就照原样标明

一章第一次不通过 `check` 时，编排者 SHALL 删掉它，并把 `check` 打印的原因附在原提示词后，重派一次。第二次仍不通过时：
- 这一章 SHALL 保留原文进手册，章首写一句固定文字说明它没有通过检查；
- 覆盖一节 SHALL 列出它和不通过的原因数。

SHALL NOT 有第三次。编排者 SHALL NOT 自己改章节文件。

#### Scenario: 两次都不通过

- **WHEN** 一个功能章节两次都因为引文超出范围而不通过
- **THEN** 手册里有这一章，章首写明没有通过检查，覆盖一节列出这个功能

### Requirement: 每个功能都写，写完再往下

编排者 SHALL 为地图里每个选中的功能派发写作，不论本次运行已经花了多少；SHALL NOT 为了预算或时间只写一部分。

在任何跨功能章节开始之前，`check --before cross` SHALL 确认：每个选中的功能都有一章通过检查，或者已经两次不通过。不满足时退出 1，列出缺的功能，并打印一行 `Next:` 让编排者回去写。

#### Scenario: 还有功能没写

- **WHEN** 地图有 68 个功能，只有 27 章存在，编排者要开始写领域一章
- **THEN** `check --before cross` 退出 1，列出另外 41 个功能

### Requirement: 续跑以文件为准

不带 `--fresh` 的运行 SHALL 续跑：
- 一章文件存在且 `state.json` 记它通过，就不再写；
- 文件存在但没有记录的，先跑 `check`；
- 已经两次不通过的，不再派发。

运行的回复 SHALL 以一行固定文字结尾：所有章都写完（通过，或两次不通过）且所选视图的手册都在时为 `Run: complete`，否则为 `Run: incomplete`，附未写与只失败一次的章数。这一行不翻译。宿主自己的退出状态不作为完成的依据。

`state.json` SHALL 用格式串 `excavator-product-handbook-state/2`。一个输出目录里的 `state.json` 是旧格式串时，运行 SHALL 停止，告诉用户用 `--fresh`。`--fresh` SHALL 按两种格式串都能识别本 skill 的输出目录。

#### Scenario: 运行中断后再跑

- **WHEN** 上次运行写完 30 章后停止，同一 `--out` 再跑
- **THEN** 这 30 章不再派发，剩下的功能照常写

#### Scenario: 写到一半被打断

- **WHEN** 运行在一个子代理写 `chapters/F7.md` 时被打断，文件只有一半，`state.json` 里没有它的记录
- **THEN** 再跑时先对它跑 `check`；不通过就算第一次尝试，按「重写一次」重派

#### Scenario: 无终端运行停在中途

- **WHEN** 无终端运行（例如 `claude -p`）因用量上限停下，宿主仍报成功
- **THEN** 回复里没有 `Run: complete` 这一行，据此判断运行没完成；再跑同一命令续跑

#### Scenario: 旧输出目录

- **WHEN** `--out` 里的 `state.json` 格式串是 `excavator-product-handbook-state/1`，运行没带 `--fresh`
- **THEN** 运行停止并告诉用户用 `--fresh`，不改动目录

### Requirement: 目录

编排者 SHALL 在所有章节写完后写 `outline.json`：手册分哪几部分、每部分有哪几章、按什么顺序、用什么名字，按这个项目的读者习惯来定。每一章 SHALL 在目录里恰好出现一次；脚本算出的数据、状态字典、代码健康与覆盖各章也在其中。

脚本 SHALL 检查这一守恒：
- 不成立时打印缺的与重复的章；
- 手册用默认顺序与固定名字，覆盖一节写明原因。

#### Scenario: 目录漏了一章

- **WHEN** `outline.json` 没有列出 `chapters/F12.md`
- **THEN** 拼装用默认目录，覆盖一节写明目录缺了这一章

### Requirement: 拼装与两种视图

`assemble` SHALL 按目录把各章拼成手册：
- **产品视图** `handbook.md`：去掉每个引文组，不显示文件路径；表格里因去掉引文而整列为空的列 SHALL 一并去掉，原本就空的列不动；
- **技术视图** `handbook-technical.md`：只在 `--views` 含 `technical` 时写出，把引文组保留为文件与行。

模型写的每章开头 SHALL 有一句固定文字，说明它由模型从代码写成、没有逐句核对。数据、状态字典与代码健康各章 SHALL 由脚本从各自的 JSON 写出，只出现在技术视图里。

最后一节是覆盖，SHALL 写出：
- 候选数与守恒结果；
- 未归属的候选及原因；
- 通过链接到达的功能；
- 没有章节的功能；
- 两次没通过检查的章及原因数；
- 用的是哪份目录。

#### Scenario: 产品视图不显示路径

- **WHEN** 以默认视图拼装
- **THEN** `handbook.md` 里没有任何「路径:行」形式的引文

#### Scenario: 引文单独一列

- **WHEN** 一张表格的最后一列只放引文组
- **THEN** `handbook.md` 里这张表没有这一列，`handbook-technical.md` 里有

#### Scenario: 技术视图保留引文

- **WHEN** 以 `--views product,technical` 拼装
- **THEN** `handbook-technical.md` 里每个引文组都在，`handbook.md` 里没有

### Requirement: 页面从 Markdown 渲染

`page` SHALL 写出一个双击就能从磁盘打开的 `handbook.html`，不需要网络或服务。页面的内容 SHALL 来自与 `assemble` 相同的章节 Markdown 和脚本算出的 JSON：
- 侧栏按目录分组；
- 每章一页，带上一章与下一章的链接；
- Markdown 表格与列表照常显示，mermaid 围栏画成图，画不出时显示原文；
- `--views` 两种视图都有时，顶栏有切换，切换后停在同一章。产品视图隐藏引文，技术视图把引文显示成文件与行。

页面 SHALL NOT 需要模型写任何 HTML。改页面的样式只改模板，不重新写章节。

#### Scenario: 重新生成页面不花模型的钱

- **WHEN** 只改了页面模板，对同一输出目录再跑 `page`
- **THEN** 页面按新模板写出，没有派发任何子代理

#### Scenario: 画不出的图

- **WHEN** 一章的 mermaid 围栏有语法错误
- **THEN** 这张图的位置显示围栏原文，页面其余部分照常显示

### Requirement: 选择要写的部分

`--sections` SHALL 决定这次运行写哪些部分：`system`、`features`、`domains`、`roles`、`notifications`、`topics`、`defects`、`remedies`、`data`、`history`、`outline`，可以用逗号连写多个，默认全部。各部分的阶段写在自己的文件里，只在选中时读。这个选项不记录：换一组部分再跑，已经通过的章不会重写；拼装时用输出目录里现有的一切。值不在清单里时，运行 SHALL 停止，并列出合法的值。

#### Scenario: 只写数据

- **WHEN** 以 `--sections data` 运行，输出目录里没有地图
- **THEN** 只写出 `data.json` 与 `dictionaries.json`，运行结束，不拼装

#### Scenario: 非法的部分名

- **WHEN** 以 `--sections features,trace` 运行
- **THEN** 运行停止，打印 `trace` 与合法的部分名

## MODIFIED Requirements

### Requirement: 子代理的工具

手册派发的每个子代理 SHALL 使用插件里的写作代理 `excavator-handbook-writer`，SHALL NOT 使用 general-purpose 或其他不限工具的类型。它的定义 SHALL 写明 `tools`，只列出读文件、搜索、命令、写与改自己的产物文件。手册代理 SHALL NOT 拿到派发子代理的工具。代理定义 SHALL NOT 指定模型。

#### Scenario: 运行环境装了很多 MCP 工具

- **WHEN** 运行环境里有几十个 MCP 工具，手册派发一个写作代理
- **THEN** 这个写作代理只拿到定义里列出的读文件、搜索、命令与写文件工具，启动上下文里没有其他工具的说明

#### Scenario: 写条目

- **WHEN** 编排者为一个功能派发写作
- **THEN** 它派发的是 `excavator-handbook-writer` 类型

#### Scenario: 派发文字

- **WHEN** 检查 skill 的各阶段文字
- **THEN** 每一处派发子代理的文字都点名 `excavator-handbook-writer`，没有一处写 general-purpose 或别的代理类型

## REMOVED Requirements

### Requirement: 手册的部分
**Reason**: 部分的名单改变。
**Migration**: 由「选择要写的部分」取代。

### Requirement: 功能条目的结构与出处
**Reason**: 功能不再写 JSON 事实表，只写一章 Markdown。
**Migration**: 由「功能章节」与「章节的 Markdown 约定」取代；引文由 `check` 核对。

### Requirement: 引文核对
**Reason**: 不再有逐字引用的原文段落，引文改为「路径:行」。
**Migration**: 由「收尾检查」核对文件、行号范围与跨度。

### Requirement: 值核对
**Reason**: 没有结构化的标签与数字字段可核对。
**Migration**: 无；对照试验里散文章节的准确度不低于原来，记在 design 里。

### Requirement: 逐项核对
**Reason**: 核对者已在轻量方案里删除，现在连条目结构也一并删去。
**Migration**: 每章开头的固定文字说明没有逐句核对。

### Requirement: 读者可见文字不含代码
**Reason**: 并入收尾检查。
**Migration**: 由「收尾检查」的代码形状词一项取代。

### Requirement: 条目写作、状态与续跑
**Reason**: 状态与续跑改为以章节文件为准。
**Migration**: 由「续跑以文件为准」与「重写一次，不通过就照原样标明」取代。

### Requirement: 拼装手册
**Reason**: 拼装改为按目录拼接 Markdown 章节。
**Migration**: 由「拼装与两种视图」取代。

### Requirement: HTML 导出
**Reason**: 页面改为渲染 Markdown。
**Migration**: 由「页面从 Markdown 渲染」取代。

### Requirement: 追查值的来源
**Reason**: 追查已删除。
**Migration**: 功能章节的提示词要求子代理顺着代码读到决定值的那一行。

### Requirement: 通知总表与定时任务总表
**Reason**: 不再由事实表算出。
**Migration**: 由「跨功能章节读章节」里的通知与定时任务一章取代。

### Requirement: 条目子代理从种子文件出发、有界地读出去
**Reason**: 写法改为散文提示词，读取不设文件数上限。
**Migration**: 由「功能章节」取代。

### Requirement: 追查者按原话读主张
**Reason**: 追查已删除。
**Migration**: 无。

### Requirement: 系统概览
**Reason**: 概览不再写 JSON。
**Migration**: 由「系统章节」取代。

### Requirement: 应用与脚本算出的系统事实
**Reason**: 系统层面的计数改由系统章节的写作者从脚本输出照写，或由代码健康一章给出。
**Migration**: 应用根仍由 `applications` 列出；代码健康见「代码健康」。

### Requirement: 视角
**Reason**: 视图改为同一批 Markdown 的两种拼法。
**Migration**: 由「拼装与两种视图」取代。

### Requirement: 实体与关系
**Reason**: 实体页与矩阵由 JSON 算出，JSON 已删除。
**Migration**: 由跨功能的领域与角色两章取代。

### Requirement: 业务领域
**Reason**: 领域不再写 `domains.json`。
**Migration**: 由「跨功能章节读章节」里的领域一章取代。

### Requirement: 系统的名字
**Reason**: 外部系统的名字表由 JSON 维护，已删除。
**Migration**: 系统章节写外部与云服务。

### Requirement: 功能的发现
**Reason**: 发现不再写 JSON 文件。
**Migration**: 由功能章节的「问题」一节与跨功能的缺陷一章取代。

### Requirement: 系统的发现
**Reason**: 同上。
**Migration**: 由系统章节的「问题」一节取代。

### Requirement: 同一处缺陷
**Reason**: 合并改由发现一章的写作者做。
**Migration**: 由「跨功能章节读章节」里的缺陷一章取代。

### Requirement: 发现的级别
**Reason**: 级别不再由脚本从固定的后果清单换算。
**Migration**: 缺陷一章给每条 P0、P1 或 P2 与一句理由。

### Requirement: 对策与建议
**Reason**: 对策不再写 JSON。
**Migration**: 由跨功能的对策一章与「只有对策一章给建议」取代。

### Requirement: 横切主题
**Reason**: 主题不再按通道写 JSON。
**Migration**: 由跨功能的横切主题一章取代。

### Requirement: 附录
**Reason**: 附录由事实表算出，事实表已删除。
**Migration**: 待确认的内容在各章的「待确认」一节；覆盖见「拼装与两种视图」。

### Requirement: 页面的版式
**Reason**: 页面组件改为渲染 Markdown。
**Migration**: 由「页面从 Markdown 渲染」取代。

### Requirement: 操作的流程图
**Reason**: 不再限制 mermaid 子集，也不逐箭头带引文。
**Migration**: 章节可以画任意 mermaid 图，见「章节的 Markdown 约定」。

### Requirement: 页面导航分组
**Reason**: 导航改为按目录分组。
**Migration**: 由「页面从 Markdown 渲染」取代。

### Requirement: 领域之间的关系
**Reason**: 由 JSON 算出，已删除。
**Migration**: 由跨功能的领域一章取代。

### Requirement: 领域页
**Reason**: 同上。
**Migration**: 由跨功能的领域一章取代。

### Requirement: 业务全景图与技术架构图
**Reason**: 两张图由 JSON 算出，已删除。
**Migration**: 领域一章与系统章节可以画 mermaid 图。

### Requirement: 按项目写的目录
**Reason**: 目录改为列章节文件。
**Migration**: 由新的「目录」取代。

### Requirement: 领域页列出功能明细
**Reason**: 领域页已删除。
**Migration**: 功能章节按目录放在所属部分下。
