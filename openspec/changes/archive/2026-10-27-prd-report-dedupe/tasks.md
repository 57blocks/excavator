## 1. 流程章节只有流程（提交 2）

- [x] 1.1 `lane-check`：流程与自动类章节的 `###` 只能是流程或待确认项标题（design D2）；待确认项小节是一张三列表（D3）；两条只在 `check-lane` 时检查（D4）
- [x] 1.2 泳道提示词：权限深度要求、章节结构与引言、待确认项三列表（D2、D3）
- [x] 1.3 夹具改为合格的形状；单测与契约测试：O2
- [x] 1.4 跑 O1

## 2. 合并待确认项（提交 3）

- [x] 2.1 `lib/open-items.mjs`：事项抽取、清单与 `digest`、`merged.json` 校验（D5）
- [x] 2.2 `prd.mjs check-open-items`
- [x] 2.3 `aggregate`：`tables/open-items.md` 与覆盖行（D5）
- [x] 2.4 单测：O3；跑 O1

## 3. skill 接线（提交 4）

- [x] 3.1 `SKILL.md`：Phase 3 的合并步骤与合并提示词（D6）；文件表加 `open-items/`
- [x] 3.2 契约测试；根目录 `README.md`
- [x] 3.3 跑 O1

## 3a. 合并错了也不丢问题（提交 4a–4c，design D8）

- [x] 3a.1 `mergedRows` 与 `openItemsTable`：合并行列出组内其余各条的事项；单测
- [x] 3a.2 合并提示词：只共享缺失证据的不算同一个问题，拿不准不分组；契约测试
- [x] 3a.3 跑 O1；在真实事项上重做合并演练，独立审读（Sonnet）

## 3b. 合并之后逐条核对（提交 4d–4f，design D9）

- [x] 3b.1 `checked.json` 的校验、`mergedRows` 退回判否的成员、覆盖行、`check-open-items` 的退出码；单测
- [x] 3b.2 Phase 3 第 5 步：核对子代理与提示词、按问题行选派哪个子代理、文件表；契约测试
- [x] 3b.3 跑 O1；O7 在核对之后重做

## 4. 验收

- [x] 4.1 O5 真实冒烟
- [x] 4.2 O6 独立审读
- [x] 4.3 O7 合并演练
- [x] 4.4 记录验收（提交 5）
