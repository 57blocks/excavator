## 1. 检查、合并与计数（提交 2）

- [x] 1.1 `lib/priorities.mjs`：定级文件的纯检查函数（design D4）与分批
- [x] 1.2 `prd.mjs check-priorities`：每个功能一行、分批行、末行合计，退出码
- [x] 1.3 `computeAggregate`/`findingsOf`：合并 `priority` 与 `priorityReason`、三重键排序、每个功能与合计的级别计数及守恒自查（design D5）；`index-check` schema 允许缺省
- [x] 1.4 `page-data` 带上新字段；比对照旧走 `computeAggregate`
- [x] 1.5 单测：O2、O3、O4
- [x] 1.6 跑 O1

## 2. 报告页（提交 3）

- [x] 2.1 类型、finding 卡片的级别标记与理由、findings 页的级别筛选与路由、总览计数（design D8）
- [x] 2.2 单测：路由解析与筛选（含 `priority=`）
- [x] 2.3 跑 O1

## 3. skill 接线（提交 4）

- [x] 3.1 `SKILL.md`：Phase 3 的排序步骤、排序子代理提示词（含 D3 判据原文）、续跑说明、进度行（design D6）
- [x] 3.2 `reply.mjs` 的 findings 行（design D7）
- [x] 3.3 契约测试：判据原文、步骤位置（核对之后、`overview.md` 之前）、主模型不得写定级文件、回复行；`README.md`
- [x] 3.4 跑 O1

## 4. 验收与归档

- [x] 4.1 跑 O2–O7，结果写进 design.md 的验收记录（提交 5）
- [x] 4.2 归档变更（提交 6）
