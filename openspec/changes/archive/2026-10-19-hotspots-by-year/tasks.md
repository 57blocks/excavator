## 1. 脚本按年计数（commit：`feat(hotspots): count directory commits by year`）

- [x] 1.1 `history.mjs`：为每个提交号记下提交者日期上的年份
- [x] 1.2 `aggregate.mjs`：目录行加 `commitsByYear`，年份范围取整个产物，每年都有一项；没有历史为 `null`
- [x] 1.3 `hotspots.mjs`：接入年份，残余假设加一条，更新文件头注释
- [x] 1.4 单测：一次提交在目录里只算一次、跨年时区、范围覆盖整个产物、各年之和等于 `commits`、多仓、没有历史、窗口内没有提交

## 2. skill 与 chat 读按年计数（commit：`feat(skill): report changes by year and least recently changed`）

- [x] 2.1 `skills/excavator-hotspots/SKILL.md`：第 3 步加查询（全项目每年、某一深度最近两年最多的目录、按最后改动年份的文件数、某一深度最后改动最早的目录）；字段说明加 `commitsByYear`；第 4 步汇报加两项与规则；自检 grep 加冷代码用词
- [x] 2.2 `skills/excavator-chat/SKILL.md`：改动历史一节加查询与规则（目录读 `commitsByYear`，文件没有按年计数，很久没改不说成没在用）
- [x] 2.3 契约测试：新查询在产物上跑得出结果；字段名都在产物里；自检能抓冷代码用词，残余假设能通过
- [x] 2.4 第一次真实运行暴露的问题（commit：`fix(skill): order last changes by recorded time and keep years unscaled`）：按记录的时间排序最后改动，加文件级查询和带产物截止日期的目录按年查询；不推算整年、不给没有提交的文件找原因、不说文件是什么样的
- [x] 2.5 第二次真实运行暴露的问题（commit：`fix(skill): label last-change counts and fix the words after cold lists`）：按最后改动年份的文件数第一行写明口径；冷代码清单缩到 10 行并要求全部展示；chat 在列表后用固定的话收尾，在目录按年和读历史状态处写明不描述走势、不说计数可靠
- [x] 2.6 第三次真实运行暴露的问题（commit：`fix(skill): say files with no counted commit in fixed words`）：「窗口内没有提交」在没有窗口时被读成矛盾，改成「计入 0 次提交」，并用固定的话给出个数
- [x] 2.7 同一次运行的终端摘要把 0 次提交的文件和最早改动的文件混为一谈（commit：`fix(skill): reply with the report path instead of a summary`）：终端回复只给报告路径与自检结果

## 3. 验收与归档（commit：`docs(openspec): record hotspots-by-year acceptance and archive`）

- [x] 3.1 独立 oracle 比对 dataverse、sakai、openmrs-workspace，先验装置
- [x] 3.2 sakai 耗时与产物大小
- [x] 3.3 真实模型运行
- [x] 3.4 验收记录写进 design.md，同步主规格并归档
