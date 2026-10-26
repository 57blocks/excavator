## 1. 章节声明与索引检查（提交 2）

- [ ] 1.1 `lane-check`：`actors`、`permissionRoles`、`flows`、`openItems` 与单一 `##` 标题的检查（design D3）；锚点与引文拒绝跳过目录（D8）
- [ ] 1.2 `check-lane` 失败时的 `Next:` 行（D6）
- [ ] 1.3 `index-check`：`kind: "reference"`、`reference` 章节在前、空入口、格式 `/2` 与旧格式提示、种子文件拒绝跳过目录（D2、D8、D9）
- [ ] 1.4 夹具改为新字段；单测：O2
- [ ] 1.5 跑 O1

## 2. 拼装骨架（提交 3）

- [ ] 2.1 章节拆分函数（正文、`openItems` 小节），`assemble`、`aggregate` 与 `page-data` 共用
- [ ] 2.2 `aggregate`：`tables/terminology.md`、新的 `tables/roles.md`、`tables/open-items.md`、覆盖小节的范围外计数（D4、D7）
- [ ] 2.3 `assemble`：D4 的顺序、总览检查、流程索引与锚点
- [ ] 2.4 `summarize` 的 `retryable` 与 `reply` 的 `Retry:` 行（D6）
- [ ] 2.5 `page-data` 的新字段（D10）
- [ ] 2.6 单测：O3；跑 O1

## 3. 核对不追加摘要（提交 4）

- [ ] 3.1 `excavator-verify/SKILL.md`：`--no-summary`（D5）与契约测试
- [ ] 3.2 跑 O1

## 4. 报告页（提交 5）

- [ ] 4.1 类型、总览的 Terminology、Flow index、Roles、Open items，功能页的两行角色（D10）
- [ ] 4.2 单测；跑 O1

## 5. skill 接线（提交 6）

- [ ] 5.1 `SKILL.md`：Phase 0 的旧格式处理、Phase 1c 的共享模型与范围外调用方、泳道提示词的新字段与锚点规则、第 3 步照 `Next:` 行、总览的写法、核对带 `--no-summary`、回复
- [ ] 5.1a Phase 2 第 1 步重派前的删除命令补上 `verification/<id>.txt` 与 `verification/<id>.md`，契约测试钉住（D6）
- [ ] 5.2 契约测试与 `README.md`
- [ ] 5.3 跑 O1

## 5b. 参与者的规范名（D12，提交 6a、6b）

- [ ] 5b.1 design D12 与规格、任务（提交 6a）
- [ ] 5b.2 `index-check` 的 `actors` 检查、`lane-check` 的名单外参与者、`roles.md` 的列按索引顺序；单测（先红后绿）
- [ ] 5b.3 SKILL.md：Phase 1c 写 `actors`、`plan.json` 与建索引的 `jq` 带上它、泳道提示词给名单并只许取名单里的名字、`flows` 只列流程、章节不写发现；契约测试；夹具
- [ ] 5b.4 跑 O1

## 6. 验收与归档

- [ ] 6.1 跑 O4–O6，结果写进 design.md 的验收记录（提交 7）
- [ ] 6.2 归档变更（提交 8）
