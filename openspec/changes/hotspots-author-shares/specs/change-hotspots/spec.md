## ADDED Requirements

### Requirement: 作者份额

每个目录行 SHALL 有 `concentration`，只按窗口内人的提交计算，同一次提交在一个目录里只算一次：
- `commitsByPeople`：这个目录的提交里，作者不是 bot 的次数；
- `topAuthorShare`：改得最多的那位作者的提交数除以 `commitsByPeople`，四舍五入到两位小数；
- `authorsFor80Percent`：按提交数从多到少取作者，提交数之和至少达到 `commitsByPeople` 的八成时取到的作者数；
- `commitsByPeople` 为 0 时，`topAuthorShare` 与 `authorsFor80Percent` 为 `null`；没有历史的目录，`concentration` 为 `null`。

作者沿用 `authors` 的区分方式：mailmap 之后的邮箱，不分大小写。作者邮箱 @ 前以 `[bot]` 结尾的提交算 bot 的提交。头部 `bots` SHALL 给出这条规则（`emailMarker`）与计入的提交里 bot 的提交数（`commits`），没有历史时 `commits` 为 `null`。全项目 `.` 行的 `commits` SHALL 等于它的 `commitsByPeople` 加 `bots.commits`。

产物 MUST NOT 含作者的名字或邮箱。

#### Scenario: 份额与占到八成的作者数
- **WHEN** 目录 `d` 窗口内有 10 次人的提交，作者甲 6 次、乙 3 次、丙 1 次
- **THEN** `d` 的 `concentration` 为 `{"commitsByPeople": 10, "topAuthorShare": 0.6, "authorsFor80Percent": 2}`

#### Scenario: 正好八成
- **WHEN** 目录 `d` 有 10 次人的提交，作者甲 4 次、乙 4 次、丙 2 次
- **THEN** `authorsFor80Percent` 为 2

#### Scenario: 一次提交在一个目录里只算一次
- **WHEN** 作者甲的一次提交同时改了目录 `d` 下的两个文件，作者乙另有一次提交改了其中一个
- **THEN** `d` 的 `commitsByPeople` 为 2，`topAuthorShare` 为 0.5

#### Scenario: 四舍五入
- **WHEN** 目录 `d` 有 3 次人的提交，作者甲 2 次、乙 1 次
- **THEN** `topAuthorShare` 为 0.67

#### Scenario: bot 的提交不计入份额
- **WHEN** 目录 `d` 有 5 次提交，其中 2 次的作者邮箱是 `49699333+dependabot[bot]@users.noreply.github.com`，其余 3 次都是作者甲的
- **THEN** `d` 的 `commits` 为 5，`concentration` 为 `{"commitsByPeople": 3, "topAuthorShare": 1, "authorsFor80Percent": 1}`，头部 `bots.commits` 为 2

#### Scenario: 只有 bot 的提交
- **WHEN** 目录 `d` 的提交全部来自 bot
- **THEN** `commitsByPeople` 为 0，`topAuthorShare` 与 `authorsFor80Percent` 为 `null`

#### Scenario: 全项目守恒
- **WHEN** 对有历史的项目运行
- **THEN** `.` 行的 `commits` 等于它的 `commitsByPeople` 加头部的 `bots.commits`

#### Scenario: 没有历史
- **WHEN** 对一个没有历史的目录运行
- **THEN** 每个目录行的 `concentration` 为 `null`，头部 `bots.commits` 为 `null`

#### Scenario: 产物里没有名字
- **WHEN** 对有历史的项目运行
- **THEN** 产物里找不到任何作者的名字或邮箱

## MODIFIED Requirements

### Requirement: 产物、新鲜度与查询

脚本 SHALL 写 `.excavator/hotspots.json`。

头部 SHALL 包括：
- 源码快照的 revision；
- 每个仓的路径、HEAD、是否浅克隆、未计入的边界提交数与最早可见提交的时间；
- 没有历史时的原因，有历史时为空；原因是 `inside-repository` 时，还有工作区根相对项目根的路径与项目根在工作区里的路径；
- 窗口；
- 各分类的计数；
- 文件对的规则与计数（`coChange`）；
- 认定 bot 的规则与计入的提交里 bot 的提交数（`bots`）；
- 残余假设：
  - 合并提交不计；
  - 改名靠 git 的相似度判断，改动很大的改名会被当成一次删除加一次新建；
  - 复制不追；
  - 历史按 git log 的默认顺序沿单一路径映射归属；在分支历史与子树导入里可能漏掉部分改动，`lineageConflicts` 大于 0 的文件就是遇到这种情况的；
  - 作者按邮箱区分，同一个人用了多个邮箱又没有 mailmap 时，算作多人；
  - 行数包括空行与注释；
  - 历史被改写过（压缩、变基、从别的系统导入）时，此前的改动看不见；
  - 仓库本地的 `.git/config` 与 `.git/info/attributes` 仍会影响改名检测与二进制判定；
  - 改到超过 30 个选中文件的提交不计入文件对，只在这类提交里一起改过的文件不会成对列出；
  - 提交按提交者日期上的年份归年，用的是提交者所在的时区；变基或 cherry-pick 过的提交算在重新提交的那一年，不是最初写成的那一年；
  - 只有作者邮箱 @ 前以 `[bot]` 结尾的才算 bot（GitHub 应用账号的写法），其它自动化账号按人算。

`/excavator-hotspots` skill 的汇报 SHALL：
- 列出排名靠前的文件与目录、头部计数，并逐条列出残余假设；
- 列出一起改得最多的文件对，再完整列出两边路径都不像测试的文件对，不描述两份清单的差别，并给出 `coChange` 的计数；计入的提交与超过上限的提交互不包含，MUST NOT 说成其中一个是另一个的一部分；
- 没有历史或是浅克隆时，在开头就说明；
- 没有历史时按原因说明。原因是 `inside-repository` 时，说明历史只在仓库根上读，在仓库根上运行后可以按目录查到这个子目录的数字，MUST NOT 说项目不是 Git 仓库；
- 只陈述产物里的数字，MUST NOT 给出重构、删除、拆分之类的建议；
- 文件对只说一起改了几次、各占多少，MUST NOT 说成一个文件依赖、调用或导致另一个；
- 给出全项目每年的提交数，以及最近两年里提交最多的目录，并写明是哪两年；第一年和最后一年通常不完整，MUST NOT 不加说明地拿它们和完整年份比；
- 按最后一次改动的年份给出文件数，有历史但计入 0 次提交的文件用固定的话给个数，并列出最后一次改动最早的目录；
- 按年的数字只陈述哪一年多少次，MUST NOT 解释增减的原因，MUST NOT 把不完整的年份推算成整年；很久没改只说最后一次改动在哪一年，MUST NOT 说成没在用、可以删除或已废弃；
- 给出全项目的作者份额，并列出人的提交不少于 20 次的目录（各深度都算，文件全在同一个子目录里的目录按那个子目录显示），按改得最多的作者所占份额从高到低展示查询输出的每一行；说明份额只算人的提交，并给出 bot 的提交数；
- 份额只陈述提交次数的比例，MUST NOT 说谁负责、谁懂或谁拥有这块代码，MUST NOT 说有风险、依赖某个人或是单点，MUST NOT 写出或查找作者的名字与邮箱；
- 汇报写进报告文件，终端回复只给报告路径与自检结果，MUST NOT 复述报告内容。

`excavator-chat` 回答改动历史类问题时 SHALL 只读这个产物：
- 先用共享的新鲜度助手取当前 revision，与产物里的比对；不一致时说明产物已过期；
- 产物缺失时，建议先运行 `/excavator-hotspots`；
- 浅克隆的仓，说明计数只是下限；
- 没有历史时按原因说明，与 skill 的说法一致；
- 回答「改 X 的时候还要改什么」只读 `pairs`。列出的行少于含 X 的文件对总数时，说明列出了几对、共几对。X 不在任何列出的文件对里时，说明它没有和别的文件一起改够 3 次（只在超过上限的提交里一起改的不算），MUST NOT 说它从不和别的文件一起改；
- 文件对 MUST NOT 说成依赖、调用或因果；
- 回答目录这些年的改动时读它的 `commitsByYear`，最后一年只到产物里最后计入的提交，MUST NOT 推算成整年，MUST NOT 描述各年计数的走势（升、降、活跃、变冷），也 MUST NOT 解释某一年多或少的原因。文件没有按年计数，问到文件时给出它的 `commits` 与 `lastChanged`，MUST NOT 推算文件每年改了几次；
- 很久没改的文件或目录：展示查询输出的每一行，不合并、不概括；MUST NOT 说成没在用、可以删除或已废弃，MUST NOT 说它们是什么样的文件（早期、一次性、遗留）或为什么没改；有历史但计入 0 次提交的文件只给个数，MUST NOT 给原因；
- 历史完整（不是浅克隆、没有窗口）时，残余假设依然成立，MUST NOT 把计数说成完整或可靠；
- 回答一块代码是不是主要由少数人在改时读目录的 `concentration`，说明份额只算人的提交。文件没有份额，问到文件时给出它的 `authors` 与 `commits`；
- 份额 MUST NOT 说成谁负责、谁懂、谁拥有，MUST NOT 说成风险或依赖某个人；问是谁时说明产物里没有名字，MUST NOT 运行 git 命令或读别的文件去查名字；
- MUST NOT 从事实图推断改动历史。

本能力只运行只读的 git 命令，MUST NOT 修改项目代码或 Git 状态。

#### Scenario: HEAD 变了
- **WHEN** 产物写出后有了新的提交
- **THEN** chat 回答时说明产物已过期，需要重新运行

#### Scenario: 产物缺失
- **WHEN** 用户问哪些文件改得最多，而项目没有 `.excavator/hotspots.json`
- **THEN** chat 建议先运行 `/excavator-hotspots`，不从事实图回答

#### Scenario: 在仓库子目录上汇报
- **WHEN** 在一个 Git 仓库的子目录上运行 `/excavator-hotspots`
- **THEN** 汇报开头说明项目根是仓库的子目录、历史要在仓库根上读，并给出这个子目录在仓库里的路径；不说项目不是 Git 仓库

#### Scenario: 改一个文件时还要改什么
- **WHEN** 用户问改某个文件时通常还要改什么
- **THEN** chat 列出含这个文件的文件对，给出一起改的次数和两边各占的比例，没列全时说明共有几对，不说它依赖对方

#### Scenario: 问一个目录这几年的改动
- **WHEN** 用户问某个目录这几年改得多不多
- **THEN** chat 按年给出这个目录的提交数，说明最后一年只到产物里最后计入的提交那天，不推算整年，不描述走势，不解释增减的原因

#### Scenario: 问哪些部分很久没改
- **WHEN** 用户问哪些代码很久没人改
- **THEN** chat 按最后一次改动的年份和时间回答，展示查询输出的每一行，不说这些代码没在用或可以删除，也不说它们是什么样的代码

#### Scenario: 问一个目录是不是主要一个人在改
- **WHEN** 用户问某个目录是不是主要一个人在改
- **THEN** chat 给出这个目录人的提交数、改得最多的作者所占份额与占到八成的作者数，说明 bot 的提交不计入，不说这块代码依赖这个人或有风险

#### Scenario: 问是谁在改
- **WHEN** 用户问某个目录主要是谁在改
- **THEN** chat 说明产物里只有比例和人数、没有名字，不运行 git 命令去查名字
