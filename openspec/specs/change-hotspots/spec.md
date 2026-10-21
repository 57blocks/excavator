# change-hotspots Specification

## Purpose

按 Git 历史统计一个项目里每个文件、每级目录的改动次数、作者与增删行数，再结合体量算出改动热点。确定性脚本做普查，宿主 skill 与 chat 只读产物汇报、回答。没有历史或历史不完整时，要让人看得见。

## Requirements

### Requirement: 历史的来源与归属

脚本 SHALL 只读当前源码快照 HEAD 可达的提交：
- 多仓父目录读每个成员仓各自的 HEAD；
- 暂存、未暂存与未跟踪的改动 MUST NOT 计入；
- 结果 SHALL 只由 HEAD 决定：mailmap 与属性文件只用 HEAD 里的版本，工作区里的同名文件以及用户级、系统级 git 配置 MUST NOT 影响结果。

合并提交 MUST NOT 计入。

浅克隆边界上的提交，父提交不可见，改动无从得知，MUST NOT 计入，也不进入改动总数。git 会把它显示成新增了当时的全部文件，照算会让每个文件凭空多一次提交。

可以给一个起始日期 `YYYY-MM-DD` 作窗口：只计提交时间不早于该日 UTC 零点的提交，窗口外的提交整个跳过。不给即读全部历史。其它格式或不存在的日期（如 `2024-02-30`）SHALL 被拒绝，非零退出且不写产物。

改名 SHALL 沿谱系归到当前路径：
- 用 git 的改名检测，不设文件数上限，旧路径上的历史归给改名后的路径；一次改名算一次改动，归给改名后的路径；
- 一个路径的谱系从它出现的那次提交开始：被新增，或作为改名的目标。此前同名文件的历史 MUST NOT 归给它；
- 改名的目标没有谱系（不是选中文件的谱系）时，旧路径的谱系也到此为止，更早的改动落在选择之外。宁可少算，MUST NOT 把另一段历史算进来；
- 同一次提交里的改动同时生效：每条改动按这次提交之后的谱系归属，再一起往前推；
- 提交按 git log 的默认顺序从新到旧处理，同一个 HEAD 结果相同。

作者 SHALL 按 mailmap 归一后的作者邮箱去重，不分大小写。

#### Scenario: 改名后的文件
- **WHEN** 文件 `a` 有 3 次提交后改名为 `b`，改名之后 `b` 又有 2 次提交
- **THEN** `b` 的提交数是 6（改名那次也算一次），`a` 不出现在文件行里

#### Scenario: 删除后重建
- **WHEN** 路径 `p` 上的文件有 4 次提交后被删除，之后在同一路径新建文件，新建这次之后又有 1 次提交
- **THEN** `p` 的提交数是 2，删除前的 4 次与删除那次落在选择之外

#### Scenario: 改名到空出来的路径上
- **WHEN** 路径 `p` 上的文件有 2 次提交后被删除；文件 `q` 有 3 次提交后改名为 `p`，改名之后 `p` 又有 1 次提交
- **THEN** `p` 的提交数是 5，删除前 `p` 上的 2 次与删除那次落在选择之外

#### Scenario: 工作区里有未跟踪的 mailmap
- **WHEN** 在同一 HEAD 下往工作区放一个未跟踪的 `.mailmap`，把两个作者邮箱合并成一个
- **THEN** 产物里的作者数与放之前相同

#### Scenario: 窗口按 UTC 零点
- **WHEN** 窗口是 `2026-10-16`，一次提交的提交时间是 `2026-10-15T23:30:00-02:00`（即 UTC 16 日 01:30），另一次是 `2026-10-16T08:00:00+09:00`（即 UTC 15 日 23:00）
- **THEN** 前一次计入，后一次不计入，与运行的时刻和时区无关

#### Scenario: 一次提交改名的文件超过 git 的默认上限
- **WHEN** 一次提交改名的文件数超过 git 默认的改名检测上限
- **THEN** 这些改名仍被识别，改名前的历史归给新路径

#### Scenario: 工作区有未提交改动
- **WHEN** 在同一 HEAD 下修改、暂存或新增文件后再运行
- **THEN** 产物里的计数与修改前相同

#### Scenario: 合并提交
- **WHEN** 历史里有一次合并提交
- **THEN** 它不计入任何文件或目录的提交数

#### Scenario: 窗口格式不对
- **WHEN** 窗口给的是 `2 years ago`
- **THEN** 脚本以非零状态退出，不写产物

### Requirement: 计数与打分

文件集合 SHALL 是当前快照选中的文件，选择规则与事实层相同。

每个文件 SHALL 有：
- `commits`：窗口内的提交数；
- `authors`：窗口内的作者数；
- `added`、`removed`：窗口内增删的行数；
- `lastChanged`：窗口内最近一次提交的提交时间；窗口内没有提交时为 `null`；
- `lines`：HEAD 内容的行数，即换行符的个数，末行没有换行符且内容非空时再加一；
- `score`：`commits × lines`。

每级目录（包括项目根）SHALL 有：
- `files`：目录下的文件数；
- `commits`、`authors`：目录下文件的提交与作者去重后的个数；提交按（仓, 提交号）去重；
- `added`、`removed`、`score`、`lines`：目录下文件之和，`null` 不计入；全部为 `null` 时为 `null`；
- `lastChanged`：目录下文件中最近的一个。

目录下没有一个文件有历史时，目录的历史字段为 `null`。

文件 SHALL 按 `score` 降序排列，相同时按 `commits` 降序，再按路径升序。`score` 为 `null` 的排在最后，按路径升序。

统计行数时 SHALL 分批读取 HEAD 的 blob，子进程数只随批次数增长。

#### Scenario: 排名
- **WHEN** 文件 `x`（100 行）有 2 次提交，`y`（10 行）有 10 次提交，`z`（100 行）有 1 次提交
- **THEN** 文件顺序是 `x`（200）、`y`（100）、`z`（100），`y` 与 `z` 同分时提交多的在前

#### Scenario: 目录按提交去重
- **WHEN** 一次提交同时改了同一目录下的两个文件
- **THEN** 两个文件的提交数各加 1，目录的提交数只加 1

### Requirement: 没有历史要看得见

没有历史或历史不完整时，计数 MUST NOT 报成 0，而 SHALL 进入看得见的分类：
- **没有历史的项目**：头部写明没有历史及其原因（见下）；每个文件的 `commits`、`authors`、`added`、`removed`、`lastChanged`、`score` 为 `null`，`lines` 照常统计。
- **浅克隆**：头部对该仓写明是浅克隆、边界提交数（`.git/shallow` 列出的提交，它们一律不计入），以及最早可见提交的时间（不受窗口限制）。该仓文件的计数照常给出，值是下限。skill 与 chat SHALL 说明该仓的计数只是下限。
- **多仓父目录**：每个成员仓单独读。不属于任何成员仓的文件，历史字段为 `null`。
- **二进制文件**（HEAD 内容的前 8000 字节含 NUL）：`lines` 与 `score` 为 `null`，提交数与作者数照常统计。
- 历史中任何一次改动被 git 判为二进制时（包括 HEAD 的属性文件标成不做文本比较的），该文件的 `added` 与 `removed` 为 `null`。

没有历史的原因 SHALL 是下面两种之一：
- `not-a-repository`：项目根不在任何 Git 工作区里，也没有哪个直接子目录是带提交的 Git 仓库；
- `inside-repository`：项目根在一个 Git 工作区里，但不是它的根。头部 SHALL 同时给出工作区根相对项目根的路径，以及项目根在工作区里的路径。

有 `.git` 却读不到历史时，脚本 SHALL 以非零状态退出、不写产物，并在消息里指出是哪个 `.git`、为什么读不到：
- 运行不了 `git`，而项目根、它的任一上级目录或任一直接子目录里有 `.git`；
- `git` 能运行，但不认项目根或某个直接子目录里的 `.git`。

直接子目录是还没有提交的 Git 仓库时，它照旧不算成员仓，不触发拒绝。

头部 SHALL 记有历史的文件数（属于一个读得到历史的仓，含浅克隆）、没有历史的文件数与二进制文件数。

#### Scenario: 非 Git 目录
- **WHEN** 对一个不在任何 Git 工作区里、也不含成员仓的目录运行
- **THEN** 产物头部写明没有历史，原因是 `not-a-repository`；所有文件的 `commits` 与 `score` 为 `null`，`lines` 有值

#### Scenario: Git 仓库的子目录
- **WHEN** 对一个 Git 仓库里的子目录 `apps/web` 运行
- **THEN** 产物头部写明没有历史，原因是 `inside-repository`，工作区根是 `../..`，项目根在工作区里的路径是 `apps/web`；所有文件的 `commits` 为 `null`，`lines` 有值

#### Scenario: 运行不了 git
- **WHEN** 环境里找不到 `git`，分别对一个 Git 仓库的根、它的子目录、以及含成员仓的父目录运行
- **THEN** 三次都以非零状态退出，不写产物，消息指出找到的 `.git` 与运行不了 `git`

#### Scenario: git 不认的 .git
- **WHEN** 项目根的 `.git` 是一个指向不存在目录的文件
- **THEN** 脚本以非零状态退出，不写产物，消息指出这个 `.git` 与 git 的报错

#### Scenario: 没有提交的子仓
- **WHEN** 一个普通目录下唯一的子仓还没有提交
- **THEN** 产物照常写出，没有历史，原因是 `not-a-repository`

#### Scenario: 浅克隆
- **WHEN** 对一个有 3 次提交的仓库做 `--depth 2` 克隆后运行，最新一次提交只改了文件 `f`
- **THEN** 头部标出浅克隆、1 个未计入的边界提交与最早可见提交的时间；`f` 的提交数是 1，其它文件是 0；skill 的汇报说明计数只是下限

#### Scenario: 多仓父目录里的非成员文件
- **WHEN** 父目录下有两个成员仓和一个不属于任何成员仓的文件
- **THEN** 两个成员仓的文件各按自己的历史计数，路径带成员目录前缀；非成员文件的历史字段为 `null`

#### Scenario: 二进制文件
- **WHEN** 一个 PNG 文件有 3 次提交
- **THEN** 它的 `commits` 是 3，`lines` 与 `score` 为 `null`，它不排在任何有分的文件之前

### Requirement: 谱系冲突要看得见

按顺序沿单一路径映射归属，在分支历史与子树导入里不精确。扫描遇到下面三种迹象时 SHALL 记一次冲突，计在受影响的当前文件上：
- **两条谱系争同一路径**：改名的旧路径已经属于另一个当前文件；两个文件各记一次；
- **改名切断谱系**：改名的目标没有谱系，而旧路径属于一个当前文件；
- **切断之后仍有更早的改动**：一条谱系在路径 `p` 上开始之后，更早的提交里 `p` 上还有不是删除的改动；在线性历史里，谱系开始之前的那次改动只能是删除。

每个文件 SHALL 有 `lineageConflicts`，即记在它上面的冲突次数，没有冲突时为 0。头部 SHALL 记有冲突的文件数。

skill 的汇报与 chat 的回答列到 `lineageConflicts` 大于 0 的文件时，SHALL 说明它的计数可能漏掉部分历史，也可能含有另一段同名历史。

#### Scenario: 并行分支上各自新建同一路径
- **WHEN** 两条分支从同一个提交分出，各自新建 `p` 并各提交一次，之后合并
- **THEN** `p` 的 `lineageConflicts` 大于 0，较早那次新建落在选择之外

#### Scenario: 同一个改名出现在两条并行分支上
- **WHEN** 文件 `a` 有 2 次提交，之后两条并行分支都把 `a` 改名为 `b`，再合并
- **THEN** `b` 的提交数不含 `a` 的那 2 次，`b` 的 `lineageConflicts` 大于 0

#### Scenario: 线性历史
- **WHEN** 历史里没有合并，只有新增、修改、改名与删除
- **THEN** 每个文件的 `lineageConflicts` 都是 0

### Requirement: 改动守恒

窗口内的每一次「提交 × 路径」改动 SHALL 恰好落入一类：
- 归到一个选中的文件；
- 落在选择之外：已删除的、被忽略的或没被选中的路径。

头部 SHALL 记两类的数量。两者之和不等于读到的改动总数时，脚本 SHALL 以非零状态退出，不写产物。

#### Scenario: 被忽略路径上的改动
- **WHEN** `.excavatorignore` 排除了一个目录，窗口内该目录有 5 次改动
- **THEN** 这 5 次计入选择之外，选中文件的计数不含它们，两类之和等于总数

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

### Requirement: 按年的改动

每个目录行 SHALL 有 `commitsByYear`：按年列出窗口内改到这个目录下选中文件的提交数。同一次提交在一个目录里只算一次。
- 年份 SHALL 取提交者日期上的年份，即 `lastChanged` 显示的年份；
- 年份范围 SHALL 从产物里计入的最早提交所在的年份，到最晚提交所在的年份，每年都有一项，没有提交的年份记为 0；
- 各年之和 SHALL 等于这个目录的 `commits`；
- 窗口内没有任何提交时为空对象；没有历史的目录为 `null`。

#### Scenario: 一次提交在一个目录里只算一次
- **WHEN** 目录 `d` 下有两个文件，2021 年的一次提交同时改了两者，2023 年的一次提交只改了其中一个
- **THEN** `d` 的 `commitsByYear` 为 `{"2021": 1, "2022": 0, "2023": 1}`

#### Scenario: 按提交者日期上的年份
- **WHEN** 一次提交的提交者日期是 `2023-12-31T23:30:00-05:00`
- **THEN** 它计入 2023 年，与它的 `lastChanged` 显示的年份相同，虽然按 UTC 已是 2024 年

#### Scenario: 年份范围覆盖整个产物
- **WHEN** 产物里最早的提交在 2020 年、最晚的在 2023 年，而某个目录只在 2023 年有提交
- **THEN** 这个目录的 `commitsByYear` 有 2020 到 2023 四项，前三项为 0

#### Scenario: 多仓
- **WHEN** 两个成员仓有相同的提交历史
- **THEN** 父目录在那一年为每个仓各计一次

#### Scenario: 没有历史
- **WHEN** 对一个没有历史的目录运行
- **THEN** 每个目录行的 `commitsByYear` 为 `null`

#### Scenario: 窗口内没有提交
- **WHEN** 窗口的起点晚于最后一次提交
- **THEN** 有历史的目录 `commitsByYear` 为空对象，`commits` 为 0

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

### Requirement: 按功能分组的改动

传入分组文件时，脚本 SHALL 为每个组算一行，计数方式与目录行相同：组里的文件是分组文件列出的选中文件，提交与作者在组内去重。

分组文件是 `{ "groups": [ { "name": <非空字符串>, "paths": [<字符串>…] } ] }`：
- 组名 MUST 互不相同；
- 一个路径是一个选中文件的路径，或以 `/` 结尾的目录，指它下面的全部选中文件；
- 一个文件在同一个组里被列了多次（如文件本身和它所在的目录），只算一次；
- 没对上任何选中文件的路径（已删除、改名、写错），MUST 列进这一组的 `unmatchedPaths` 并计入头部，MUST NOT 悄悄丢掉；
- 文件格式不对时 SHALL 报错，不写产物。

每行有：`name`、`paths`（原样）、`unmatchedPaths`，以及 `files`、`lines`、`commits`、`authors`、`added`、`removed`、`lastChanged`、`score`、`commitsByYear`、`concentration`，含义与目录行相同。行按分组文件里的顺序排列。一个组没有对上任何文件，或它的文件都没有历史时，历史字段为 `null`。

没传分组文件时，头部 `featureGroups` 为 `null`，`groups` 为空数组。

#### Scenario: 组内的提交只算一次
- **WHEN** 组 `g` 列出 `a.js` 与 `b.js`，一次提交同时改了两个文件，另一次只改了 `a.js`
- **THEN** `g` 的 `commits` 为 2

#### Scenario: 目录路径
- **WHEN** 组 `g` 的路径是 `src/`，`src` 下有 3 个选中文件
- **THEN** `g` 的 `files` 为 3；路径写成不带 `/` 的 `src` 时，它只匹配名为 `src` 的文件

#### Scenario: 同一个文件列了两次
- **WHEN** 组 `g` 同时列出 `src/` 与 `src/a.js`
- **THEN** `src/a.js` 在 `g` 里只算一个文件，它的提交也只算一次

#### Scenario: 一个文件属于两个组
- **WHEN** `a.js` 同时列在组 `g` 与组 `h` 里
- **THEN** `a.js` 的提交在 `g` 与 `h` 里各算一次，头部属于多个组的文件数为 1

#### Scenario: 没对上的路径
- **WHEN** 组 `g` 列出一个已经删除的文件 `old.js`
- **THEN** `old.js` 出现在 `g` 的 `unmatchedPaths` 里，头部没对上的路径数为 1

#### Scenario: 分组文件格式不对
- **WHEN** 分组文件不是 JSON，或缺 `groups`，或组名为空、重复，或 `paths` 不是字符串数组
- **THEN** 脚本报错退出，不写产物

#### Scenario: 没有历史
- **WHEN** 项目不是 Git 仓库，传入了分组文件
- **THEN** 每组照样给出 `files` 与 `lines`，历史字段为 `null`

#### Scenario: 跨仓的组
- **WHEN** 多仓的父目录下，组 `g` 的文件分属两个成员仓
- **THEN** 两个仓的提交都计入 `g`，不同仓的提交不会合并

#### Scenario: 没传分组文件
- **WHEN** 运行脚本时没有 `--groups`
- **THEN** 头部 `featureGroups` 为 `null`，`groups` 为空数组

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
- 分组的计数（`featureGroups`）：组数、属于至少一个组的文件数、属于多个组的文件数、没对上任何选中文件的路径数；没传分组文件时为空；
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
  - 只有作者邮箱 @ 前以 `[bot]` 结尾的才算 bot（GitHub 应用账号的写法），其它自动化账号按人算；
  - 一个组只算分组文件列出的文件，一个文件属于多个组时在每个组里都算；这些文件是不是构成一个功能，脚本不检查。

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
- 份额只陈述提交次数的比例，MUST NOT 说份额高低、集中或分散，MUST NOT 说谁负责、谁懂或谁拥有这块代码，MUST NOT 说有风险、依赖某个人或是单点，MUST NOT 写出或查找作者的名字与邮箱；
- 运行脚本前找分组：有人写的 `.excavator/feature-groups.json` 就用它；没有时，`.excavator/domain-graph.json` 通过它的新鲜度检查，就从业务流程导出分组，每个流程一组，路径是各步骤的 `filePath`；两样都没有就不分组，并说明怎样得到分组。MUST NOT 自己提出分组；
- 有分组时，按提交数列出各组，给出没对上的路径数，并用固定的话说明分组的来源、一个组只算列出的文件、一个文件可以在多个组里各算一次；MUST NOT 把一个组的数字说成整个功能的改动，MUST NOT 解释一个功能为什么改得多；
- 汇报写进报告文件，报告末尾说明关于单个文件或目录的问题可以问 `/excavator-chat`，它读同一个产物；
- 运行中写给用户的每一句话（命令之间的进度说明，以及关于查了什么、下一步做什么、依据哪条规则的说明在内）、报告与最后的回复 SHALL 用 `--language` 指定的语言，没有指定时用英文。只有 `--language` 改变它：项目文件（如 `CLAUDE.md`、`AGENTS.md` 里的回复语言要求）、记忆与系统区域设置 MUST NOT 改变它；skill MUST NOT 说明用了哪种语言及原因。报告里 skill 给定的固定措辞，换了语言时译成那种语言；路径、命令与产物里的值保持原样；
- 最后的回复只有两行：报告路径单独作为第一行、不加标签，`advice check: 0 lines` 是最后一行，之前、之间、之后都不写别的，MUST NOT 复述报告内容，也不说自检、报告或做了什么；项目文件里关于怎样回复的要求（先说什么、摘要、验证结果）MUST NOT 改变它。

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
- 回答一块代码是不是主要由少数人在改时读目录的 `concentration`，用固定的话给出份额与占到八成的作者数，说明份额只算人的提交。问是不是主要一个人在改时，只按 `topAuthorShare` 回答：大于 0.5 是超过一半，小于 0.5 是不到一半，等于 0.5 是约一半（份额经过四舍五入）。文件没有份额，问到文件时给出它的 `authors` 与 `commits`；
- 份额 MUST NOT 说成集中或分散，MUST NOT 说成某个人或一群人在负责、维护、懂或拥有这块代码，MUST NOT 说成风险或依赖某个人；问是谁时说明产物里没有名字，MUST NOT 运行 git 命令或读别的文件去查名字；
- 回答哪些功能改得多、某个功能改了多少时读 `groups`，说明一个组只算分组文件列出的文件，MUST NOT 说成整个功能的改动；组的按年计数与作者份额按目录的规则回答。没有分组时说明怎样得到分组，MUST NOT 把目录当成功能来回答；
- MUST NOT 从事实图推断改动历史。

本能力只运行只读的 git 命令，MUST NOT 修改项目代码或 Git 状态。

#### Scenario: 项目文件要求用中文回复、先说结论
- **WHEN** 项目的 `AGENTS.md` 写着用中文回复、先说结论与验证结果，调用时没有 `--language`
- **THEN** 运行中每段写给用户的话、报告与最后的回复都是英文，也不说明为什么用英文；最后的回复第一行只是报告路径，第二行是 `advice check: 0 lines`，前后都没有别的话

#### Scenario: 指定了语言
- **WHEN** 调用时给了 `--language` 指定另一种语言
- **THEN** 运行中写给用户的话与报告用那种语言，skill 给定的固定措辞译成那种语言，路径与产物里的值保持原样；最后的回复仍只有报告路径与 `advice check: 0 lines` 两行

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
- **THEN** chat 给出这个目录人的提交数、改得最多的作者所占份额与占到八成的作者数，说明 bot 的提交不计入
- **AND** 按 `topAuthorShare` 是否大于 0.5 回答是否超过一半，不说份额集中或分散，不说谁在维护，不说这块代码依赖这个人或有风险

#### Scenario: 问是谁在改
- **WHEN** 用户问某个目录主要是谁在改
- **THEN** chat 说明产物里只有比例和人数、没有名字，不运行 git 命令去查名字

#### Scenario: 问哪些功能改得最多
- **WHEN** 产物里有分组，用户问哪些功能改得最多
- **THEN** chat 按提交数列出各组，说明一个组只算分组文件列出的文件、一个文件可以在多个组里各算一次，不说这就是整个功能的改动

#### Scenario: 没有分组时问功能
- **WHEN** 产物的 `featureGroups` 为空，用户问哪个功能改得最多
- **THEN** chat 说明没有按功能计数，给出得到分组的办法（运行 `/excavator-domain` 后再运行 `/excavator-hotspots`，或手写 `.excavator/feature-groups.json`），不拿目录代替功能

#### Scenario: 领域图不能用
- **WHEN** 没有 `.excavator/feature-groups.json`，`.excavator/domain-graph.json` 存在但没通过它的新鲜度检查
- **THEN** skill 不从它导出分组，汇报里说明原因与重新运行 `/excavator-domain` 的办法，其余各节照常
