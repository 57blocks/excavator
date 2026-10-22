## 1. 实现

- [x] 1.1 `tests/ci/privacy-scan.test.mjs` 新增一例：同一行哈希写进 `pnpm-lock.yaml` 与 `src/` 下的文件，只计 `corpus added lines` 1（design D3）。验证：新测试在当前代码上通过，O1 变异 A 下变红。
- [x] 1.2 `scripts/ci/privacy-scan.mjs`：开头说明的两份名单都写上 lockfile，加一段理由；路径范围前加一行注释（D2）。不改逻辑。验证：`git diff` 只动注释，测试仍绿。

## 2. 验收与记录

- [x] 2.1 O1：做变异 A、B 并记录哪些测试变红，做完还原。
- [x] 2.2 O2、O3：跑检查并记录结果。
- [x] 2.3 验收记录写进 design.md，同步主规格并归档。
