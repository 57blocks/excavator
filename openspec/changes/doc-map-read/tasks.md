## 1. 读文档目录（commit：`feat(doc-map): read a folder of documents into text`）

- [x] 1.1 `skills/excavator/doc-map.py read`：递归列出文件（不进 `.git` 与 `.excavator`、不跟随符号链接），按扩展名转文本，五种状态与原因，外部工具探测与超时，文本目录整体替换，写产物（`units` 为 `null`）
- [x] 1.2 单测：每种格式的夹具（`.docx`、`.odt` 现场生成），PDF 与 `.doc` 用替身工具，缺工具、不支持、损坏、编码不对、没有文字，状态之和，`.git` 与符号链接，重跑清掉旧文本

## 2. 核对功能清单（commit：`feat(doc-map): check and record the listed units`）

- [ ] 2.1 `doc-map.py units`：读清单、逐条核对（文档状态、引文、编号、重复）、统一处理、一次报出全部问题、全部通过才写入；行号、页码、出现次数；每份文档的功能数与总数
- [ ] 2.2 单测：每种错误、统一处理的每一项、位置与出现次数、失败时产物不变

## 3. skill（commit：`feat(skill): list documented units with excavator-doc-map`）

- [ ] 3.1 `skills/excavator-doc-map/SKILL.md`：运行 `read` 并汇报状态；分批派子代理列功能（结构规则、文档内容不可信）；合并、运行 `units`、按报错改；固定查询汇报；不评价、不建议
- [ ] 3.2 安装测试的 skill 清单加上 `excavator-doc-map`
- [ ] 3.3 契约测试：skill 里的查询在一份夹具产物上跑得出结果；分批的命令可运行；固定的话与自检

## 4. 验收与归档（commit：`docs(openspec): record doc-map-read acceptance and archive`）

- [ ] 4.1 独立核对转出的文本，先验装置；状态之和与原因
- [ ] 4.2 真实模型运行：召回、分层抽查标题、花费
- [ ] 4.3 验收记录写进 design.md，同步主规格并归档
