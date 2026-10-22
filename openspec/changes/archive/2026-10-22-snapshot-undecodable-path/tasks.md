## 1. 实现

- [x] 1.1 `tests/snapshot/git-commit-snapshot-batch-parity.test.mjs`：新增 describe，三个用例（Latin-1 路径、有损解码相同的路径与字面的 `%`、合法 UTF-8 路径不变），夹具经 `update-index -z --index-info` 写入原始字节路径。在未修复的代码上跑，记录 O1。
- [x] 1.2 `skills/excavator/source-snapshot/git-utils.mjs`：`listTrackedEntries` 按字节读，合法 UTF-8 照旧解码，其余做百分号编码并带 `pathNotUtf8: true`（design D1、D2）。
- [x] 1.3 `skills/excavator/source-snapshot/git-commit-snapshot.mjs`：`pathNotUtf8` 条目不进文件头批次，选中时记 `read-failed`（D3、D4）。验证：parity 测试。
- [x] 1.4 评审第一轮后加：`listTrackedEntries` 在这类路径与合法路径同名时抛出指名两者的错误；用例 2 去掉含 U+FFFD 的合法路径，新增拒绝同名的用例（D5）。验证：parity 测试。

## 2. 验收与记录

- [x] 2.1 O2：新增与原有用例通过。
- [x] 2.2 O3：逐个做变异 M1–M6，记录哪个用例变红，做完还原。
- [x] 2.3 O4 全量门，验收记录写进 design.md，同步主规格并归档。
- [x] 2.4 评审第一轮：在任务 1.4 的提交上重跑 M1–M8 与 O4，更正提案与任务里和代码不符的说法，同步主规格。
- [x] 2.5 评审第二轮：规格与 Goals 收窄到当前树，Non-Goals 补上改名的残余，同步主规格。
