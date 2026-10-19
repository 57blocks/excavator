## 1. 脚本数文件对（commit：`feat(hotspots): count files changed together`）

- [x] 1.1 新增 `skills/excavator/hotspots/co-change.mjs`：从文件的提交号集合数文件对，产出 `coChange` 与 `pairs`
- [x] 1.2 `hotspots.mjs`：接入，头部加 `coChange`，顶层加 `pairs`，残余假设加一条
- [x] 1.3 单测：次数与比例、不足 3 次、30 与 31 个文件的边界、改名、多仓同 sha、没有历史、窗口、半位舍入

## 2. skill 与 chat 读文件对（commit：`feat(skill): report files changed together`）

- [ ] 2.1 `skills/excavator-hotspots/SKILL.md`：头部查询排除 `pairs`；第 3 步加文件对查询（全部、不像测试的、某个文件的）；第 4 步汇报加文件对，规则加不说因果，自检 grep 加因果用词
- [ ] 2.2 `skills/excavator-chat/SKILL.md`：改动历史一节加「改 X 时还要改什么」的查询与规则
- [ ] 2.3 契约测试：夹具有文件对；新查询在产物上跑得出结果；字段名都在产物里；自检能抓因果用词，残余假设能通过

## 3. 验收与归档（commit：`docs(openspec): record hotspots-co-change acceptance and archive`）

- [ ] 3.1 独立 oracle 比对 dataverse、sakai、openmrs-workspace，先验装置
- [ ] 3.2 sakai 耗时与产物大小
- [ ] 3.3 两次真实模型运行
- [ ] 3.4 验收记录写进 design.md，同步主规格并归档
