## ADDED Requirements

### Requirement: 一起改的文件

对窗口内计入的每次提交，SHALL 取它改到的选中文件：按改名归属到当前路径，同一文件只算一次。
- 改到 2 至 30 个选中文件的提交，为其中每对文件计一次「一起改」；
- 改到超过 30 个选中文件的提交，不计入任何文件对，各文件的 `commits` 照常计；
- 一个仓的提交只与同一个仓的文件配对。

至少一起改了 3 次的文件对 SHALL 列在 `pairs` 里。每行有：
- `a`、`b`：两个文件的路径，`a` 按字典序在前；
- `together`：一起改的提交数；
- `shareOfA`、`shareOfB`：`together` 除以该文件的 `commits`，四舍五入保留两位小数。

`pairs` SHALL 按 `together` 降序排列，相同时按 `a` 升序，再按 `b` 升序。

头部 `coChange` SHALL 记：
- `maxFilesPerCommit`：30；
- `minTogether`：3；
- `commitsCounted`：改到 2 至 30 个选中文件的提交数；
- `commitsOverLimit`：改到超过 30 个选中文件的提交数；
- `pairsListed`：列出的文件对数；
- `pairsBelowMinimum`：一起改过、但不足 3 次的文件对数。

没有历史时，四个计数为 `null`，`pairs` 为空。

#### Scenario: 一起改的次数与比例
- **WHEN** 文件 `x` 有 4 次提交，`y` 有 3 次，其中 3 次提交同时改了两者
- **THEN** `pairs` 有一行：`a` 为 `x`，`b` 为 `y`，`together` 为 3，`shareOfA` 为 0.75，`shareOfB` 为 1

#### Scenario: 不足 3 次
- **WHEN** 两个文件只一起改了 2 次
- **THEN** 这对文件不列出，`pairsBelowMinimum` 计 1

#### Scenario: 超过上限的提交
- **WHEN** 一次提交改了 31 个选中文件
- **THEN** 不为它们计任何一起改，`commitsOverLimit` 计 1，这 31 个文件的 `commits` 各加 1

#### Scenario: 改名后的文件对
- **WHEN** `old` 和 `y` 一起改了 3 次，之后 `old` 改名为 `new`
- **THEN** 列出的是 `new` 和 `y`，`together` 为 3

#### Scenario: 多仓
- **WHEN** 两个成员仓有相同的提交历史，各有一个同名文件
- **THEN** 不同仓的文件不配对

#### Scenario: 没有历史
- **WHEN** 对一个没有历史的目录运行
- **THEN** `coChange` 的四个计数为 `null`，`pairs` 为空

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
- 残余假设：
  - 合并提交不计；
  - 改名靠 git 的相似度判断，改动很大的改名会被当成一次删除加一次新建；
  - 复制不追；
  - 历史按 git log 的默认顺序沿单一路径映射归属；在分支历史与子树导入里可能漏掉部分改动，`lineageConflicts` 大于 0 的文件就是遇到这种情况的；
  - 作者按邮箱区分，同一个人用了多个邮箱又没有 mailmap 时，算作多人；
  - 行数包括空行与注释；
  - 历史被改写过（压缩、变基、从别的系统导入）时，此前的改动看不见；
  - 仓库本地的 `.git/config` 与 `.git/info/attributes` 仍会影响改名检测与二进制判定；
  - 改到超过 30 个选中文件的提交不计入文件对，只在这类提交里一起改过的文件不会成对列出。

`/excavator-hotspots` skill 的汇报 SHALL：
- 列出排名靠前的文件与目录、头部计数，并逐条列出残余假设；
- 列出一起改得最多的文件对，再完整列出两边路径都不像测试的文件对，不描述两份清单的差别，并给出 `coChange` 的计数；计入的提交与超过上限的提交互不包含，MUST NOT 说成其中一个是另一个的一部分；
- 没有历史或是浅克隆时，在开头就说明；
- 没有历史时按原因说明。原因是 `inside-repository` 时，说明历史只在仓库根上读，在仓库根上运行后可以按目录查到这个子目录的数字，MUST NOT 说项目不是 Git 仓库；
- 只陈述产物里的数字，MUST NOT 给出重构、删除、拆分之类的建议；
- 文件对只说一起改了几次、各占多少，MUST NOT 说成一个文件依赖、调用或导致另一个。

`excavator-chat` 回答改动历史类问题时 SHALL 只读这个产物：
- 先用共享的新鲜度助手取当前 revision，与产物里的比对；不一致时说明产物已过期；
- 产物缺失时，建议先运行 `/excavator-hotspots`；
- 浅克隆的仓，说明计数只是下限；
- 没有历史时按原因说明，与 skill 的说法一致；
- 回答「改 X 的时候还要改什么」只读 `pairs`。列出的行少于含 X 的文件对总数时，说明列出了几对、共几对。X 不在任何列出的文件对里时，说明它没有和别的文件一起改够 3 次（只在超过上限的提交里一起改的不算），MUST NOT 说它从不和别的文件一起改；
- 文件对 MUST NOT 说成依赖、调用或因果；
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
