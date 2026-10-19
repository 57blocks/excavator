## Why

热点给的是整个窗口的总数，看不出改动落在哪些年份。一个目录总提交数很高，可能是早年改得多、现在很少动，也可能是这两年才变得活跃。了解项目时，常要问「现在主要在改哪里」「哪些部分很久没动过」，总数回答不了。

在 dataverse 上用只读 git 粗测：
- 2014 到 2025 年，全项目每年 1,362 到 2,856 次提交（不含合并提交），2016 年最少，2025 年最多；
- 当前的 2,992 个文件里，最后一次改动在 2020 年或更早的有 850 个，在 2026 年的有 634 个。

按年的计数要沿改名归到当前路径，并按目录给提交去重，所以只能由脚本来做。「很久没动的部分」从现有的 `lastChanged` 就能查出来，不用改脚本。

## What Changes

- 热点产物的每个目录行新增 `commitsByYear`：
  - 每年改到这个目录的提交数，同一次提交只算一次；
  - 年份是提交者日期上的年份，与 `lastChanged` 显示的年份一致；
  - 从产物里最早到最晚的年份，每年都有一项，没有提交的年份记为 0；
  - 没有历史时为 `null`。
- 残余假设加一条：提交按提交者日期归年。变基或 cherry-pick 过的提交，算在重新提交的那一年。
- `/excavator-hotspots` 的汇报新增两项：
  - 每年的提交数，以及最近两年里提交最多的目录；
  - 按最后一次改动的年份统计文件数，并列出最后一次改动最早的目录。
- 汇报只给有年份的数字，不解释升降的原因。很久没改只说明最后一次改动在哪年，不说成没在用、可以删除或已废弃。自检 grep 加入这些用词。
- `excavator-chat` 能回答「某个目录这几年改得多不多」「哪些部分很久没改」。文件没有按年计数，问到文件时给出它的 `commits` 和 `lastChanged`。
- 不做：
  - 文件级的按年计数；
  - 按月或按季度分桶；
  - 按作者看趋势。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `change-hotspots`：
  - 新增「按年的改动」；
  - 「产物、新鲜度与查询」的残余假设，以及 skill 与 chat 的读法，加上按年计数与最后改动年份的查询。

## Impact

- 脚本：`skills/excavator/hotspots.mjs`、`skills/excavator/hotspots/history.mjs`、`skills/excavator/hotspots/aggregate.mjs`。
- skill：`skills/excavator-hotspots/SKILL.md`、`skills/excavator-chat/SKILL.md`。
- 测试：`tests/skill/excavator/test_hotspots.test.mjs`、`tests/skill/test_hotspots_skill_contract.test.mjs`。
- 产物格式仍是 `excavator-hotspots/1`，只加字段。sakai 的产物估计增加约 1.7 MB（6,525 个目录 × 22 年）。
