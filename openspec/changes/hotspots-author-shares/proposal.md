## Why

热点产物里只有作者人数，看不出一块代码的提交是分散在很多人手里，还是集中在少数几个人手里。两个目录可能作者一样多：一个改得最多的人占了七成提交，另一个最多的人只占两成多。了解项目时，这正是「这块是不是主要靠一两个人在改」要的答案。

在 dataverse 上用只读 git 粗测近两年：
- `search`：190 次提交、14 位作者，改得最多的一位占 71%，3 位作者就占了 80%；
- `api`：659 次提交、27 位作者，改得最多的一位只占 27%，要 5 位作者才到 80%。

bot 的提交也要分开算。openmrs-core 的 12,123 次提交（不含合并提交）里，有 921 次来自 dependabot。不分开的话，依赖文件所在的目录会显示「一个作者占了大半」，而这个作者其实是 bot。

计算份额需要知道每次提交的作者，还要沿改名归到当前路径、按目录给提交去重。这只能在脚本扫历史时做；产物里也没有每次提交的作者，模型从产物推不出来。

## What Changes

- 热点产物的每个目录行新增 `concentration`，只算人的提交，不算 bot 的：
  - `commitsByPeople`：窗口内这个目录的提交里，作者不是 bot 的次数；
  - `topAuthorShare`：改得最多的那位作者的提交，占 `commitsByPeople` 的比例，保留两位小数；
  - `authorsFor80Percent`：提交加起来至少占 `commitsByPeople` 八成的最少作者数；
  - 没有历史时整个为 `null`；只有 bot 的提交时，两个比例为 `null`。
- 产物头部新增 `bots`：
  - `emailMarker`：认定 bot 的规则，作者邮箱的 @ 前以 `[bot]` 结尾，即 GitHub 应用账号的写法；
  - `commits`：计入的提交里 bot 的提交数。
  - 全项目 `.` 行的 `commits` 等于 `commitsByPeople` 加 `bots.commits`。
- 残余假设加一条：只按邮箱里的 `[bot]` 认 bot，其它自动化账号按人算。
- 产物里不出现作者的名字或邮箱，只有比例和人数。
- `/excavator-hotspots` 的汇报新增一项：
  - 全项目的份额；
  - 某一深度上、人的提交不少于 20 次的目录，按改得最多的作者所占份额从高到低列出；
  - bot 的提交数。
- 份额只是提交次数的比例。汇报和 chat 不说谁负责、谁懂这块代码，不说有风险或依赖某个人，也不点名、不去查名字。自检 grep 加入这些用词。
- `excavator-chat` 能回答「这个目录是不是主要一个人在改」。文件没有份额，问到文件时给出 `authors` 与 `commits`。问是谁时，说明产物里没有名字。
- 不做：
  - 文件级的份额；
  - 按人列出提交数或排名；
  - 按行数或按时间加权的份额。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `change-hotspots`：
  - 新增「作者份额」；
  - 「产物、新鲜度与查询」的头部字段、残余假设，以及 skill 与 chat 的读法，加上作者份额与 bot 的说明。

## Impact

- 脚本：`skills/excavator/hotspots.mjs`、`skills/excavator/hotspots/history.mjs`、`skills/excavator/hotspots/aggregate.mjs`。
- skill：`skills/excavator-hotspots/SKILL.md`、`skills/excavator-chat/SKILL.md`。
- 测试：`tests/skill/excavator/test_hotspots.test.mjs`、`tests/skill/test_hotspots_skill_contract.test.mjs`。
- 产物格式仍是 `excavator-hotspots/1`，只加字段。每个目录行多一个小对象，sakai 估计增加几百 KB。
