## 1. 脚本算作者份额（commit：`feat(hotspots): share of commits by author per directory`）

- [x] 1.1 `history.mjs`：为每个提交号记下作者编号
- [x] 1.2 `aggregate.mjs`：目录行加 `concentration`，只算人的提交；没有历史为 `null`；bot 按邮箱 @ 前的 `[bot]` 认
- [x] 1.3 `hotspots.mjs`：头部加 `bots`，残余假设加一条，更新文件头注释
- [x] 1.4 单测：份额与八成人数、正好八成、一次提交只算一次、四舍五入、bot 不计入、只有 bot、全项目守恒、没有历史、产物里没有邮箱

## 2. skill 与 chat 读作者份额（commit：`feat(skill): report the share of commits by author`）

- [x] 2.1 `skills/excavator-hotspots/SKILL.md`：头部查询加 `bots`；第 3 步加查询（全项目份额、人的提交不少于 20 次的目录按份额排，各深度都算，单子目录链只显示最深一层）；字段说明加 `concentration` 与 `bots`；第 4 步汇报加一项与规则；自检 grep 加用词
- [x] 2.2 `skills/excavator-chat/SKILL.md`：头部查询加 `bots`；改动历史一节加目录份额查询与规则（只算人的提交，文件没有份额，没有名字也不查名字）
- [x] 2.3 契约测试：新查询在产物上跑得出结果，第一行先打印阈值与目录数；字段名都在产物里；自检能抓新用词，残余假设与语料路径能通过

## 3. 验收与归档（commit：`docs(openspec): record hotspots-author-shares acceptance and archive`）

- [x] 3.1 独立 oracle 比对 dataverse、sakai、openmrs-workspace，先验装置；核对产物里没有作者名字与邮箱
- [x] 3.2 sakai 耗时与产物大小
- [x] 3.3 真实模型运行
- [x] 3.4 验收记录写进 design.md，同步主规格并归档
