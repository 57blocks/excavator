## 1. 先验装置（先红）

- [x] 1.1 按 design 的 Oracle 第 1 到 8 条写新用例，在旧代码上跑，确认为红，记进 `acceptance.md`
- [x] 1.2 提交：`test(view): pin name translation oracles (red)`

## 2. 列名称与核对

- [x] 2.1 `skills/excavator-view/translations.mjs`：语言名规范化；`plan` 列出待译名称并分批；`check` 按 design 第 4 条核对、合并进翻译表（临时文件加改名）
- [x] 2.2 提交：`feat(view): list and check name translations`

## 3. 翻译子代理与 skill

- [x] 3.1 `agents/excavator-view-translator.md`：只有 Read、Write；输入一个批文件，输出一个结果文件；写法规则照 design 第 3 条
- [x] 3.2 `skills/excavator-view/SKILL.md`：`--language`；给了非英文语言时，打包前跑 `plan`、按批派子代理（前台）、跑 `check`、失败条目重派一次
- [x] 3.3 `check-refs` 与 plugin manifest 认得新 agent
- [x] 3.4 提交：`feat(view): translate names with a dedicated subagent`

## 4. 打包、页面与回复

- [x] 4.1 `pack.mjs`：`--language` 读翻译表，按哈希与原文取用，manifest 记计数；不给或英文时字节不变
- [x] 4.2 `packages/explorer`：卡片、详情、领域图、概览、搜索按 design 第 5 条；重新构建模板
- [x] 4.3 `reply.mjs`：第六行
- [x] 4.4 提交：`feat(view): show translated names with their English originals`

## 5. 验收

- [x] 5.1 变异：核对去掉代码记号检查、哈希不比原文、`plan` 不去重、打包忽略翻译表、英文时仍写表，逐个确认至少一个用例变红
- [x] 5.2 真实运行：按 design 判据 1 到 4，记录花费
- [x] 5.3 记进 `acceptance.md`（只写机制与规模，不写语料名）

## 6. 门与合并

- [x] 6.1 本地只跑受影响范围 + explorer 包测试 + `typecheck` + `check-refs` + `openspec validate --all --strict`；全量交 CI gate
- [ ] 6.2 版本号升一位次版本；PR 用 `--merge` 指向 `main`，评审按 `REVIEW.md`
