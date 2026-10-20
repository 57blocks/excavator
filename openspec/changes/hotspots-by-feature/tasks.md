## 1. 脚本按分组计数（commit：`feat(hotspots): count changes per feature group`）

- [x] 1.1 `hotspots/groups.mjs`：读分组文件并校验格式，把每组的路径对到选中文件（文件或末尾带 `/` 的目录），记下没对上的路径
- [x] 1.2 `aggregate.mjs`：组行复用目录行的计数，按分组文件的顺序输出；头部四个数
- [x] 1.3 `hotspots.mjs`：命令行加 `--groups <file>`，产物加 `featureGroups` 与 `groups`，残余假设加一条，更新文件头注释
- [x] 1.4 单测：组内去重、目录路径、不带 `/` 不当目录、重复列出、跨组、没对上、空 `paths`、格式错误不写产物、没有历史、跨仓、没传分组文件

## 2. skill 与 chat 读分组（commit：`feat(skill): report changes by feature group`）

- [ ] 2.1 `skills/excavator-hotspots/SKILL.md`：第 1 步找分组（人写的、领域图导出、都没有），领域图先过新鲜度检查，用 jq 导出；字段说明；第 3 步加查询；第 4 步汇报加一节与规则
- [ ] 2.2 `skills/excavator-chat/SKILL.md`：头部查询加 `featureGroups`；改动历史一节加分组的查询与规则；没有分组时怎么答
- [ ] 2.3 契约测试：导出的 jq 在一份领域图夹具上得到预期的分组；新查询在带分组的产物上跑得出结果，第一行先打印组数与没对上的路径数；字段名都在产物里；固定的话能通过自检

## 3. 验收与归档（commit：`docs(openspec): record hotspots-by-feature acceptance and archive`）

- [ ] 3.1 独立 oracle 比对 dataverse、sakai、openmrs-workspace，先验装置；带与不带分组的产物只差新字段
- [ ] 3.2 sakai 耗时
- [ ] 3.3 真实模型运行
- [ ] 3.4 验收记录写进 design.md，同步主规格并归档
