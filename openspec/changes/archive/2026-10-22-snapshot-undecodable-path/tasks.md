## 1. 实现

- [x] 1.1 `tests/snapshot/git-commit-snapshot-batch-parity.test.mjs`：新增 describe，三个用例（Latin-1 路径、有损解码相同的三个路径、合法 UTF-8 路径不变），夹具经 `update-index -z --index-info` 写入原始字节路径。在未修复的代码上跑，记录 O1。
- [x] 1.2 `skills/excavator/source-snapshot/git-utils.mjs`：`listTrackedEntries` 按字节读，合法 UTF-8 照旧解码，其余写成 git 的显示形式并带 `pathNotUtf8: true`（design D1、D2）。
- [x] 1.3 `skills/excavator/source-snapshot/git-commit-snapshot.mjs`：`pathNotUtf8` 条目不进文件头批次与 oid 映射，选中时记 `read-failed`（D3、D4）。验证：parity 测试。

## 2. 验收与记录

- [x] 2.1 O2：新增与原有用例通过。
- [x] 2.2 O3：逐个做变异 M1–M4，记录哪个用例变红，做完还原。
- [x] 2.3 O4 全量门，验收记录写进 design.md，同步主规格并归档。
