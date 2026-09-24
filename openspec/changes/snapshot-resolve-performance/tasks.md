执行约束：一 coder（Sonnet）一 acceptor（Opus）；验收 oracle 见 design.md「验收 Oracle」，动手前已写死。代码、测试与文档用英文，OpenSpec 用中文。一组一个 commit，按下列顺序提交；PR 以 merge commit 合入，保留每个 commit。真实语料在副本上跑，不动用户语料现有的 `.excavator/`，真实语料的源码、路径与输出不提交。验证按 AGENTS.md「验证：按改动内容选检查」执行。

commit 序列：
0. `docs(openspec): propose snapshot-resolve-performance`
1. `feat(snapshot): add a batched blob reader over git cat-file --batch`
2. `feat(snapshot): read git snapshots through the batched blob reader`
3. `docs(mcp): update snapshot performance measurements`
4. `docs(openspec): record snapshot-resolve-performance acceptance`

## 1. 批量读取器

- [x] 1.1 新增 `skills/excavator/source-snapshot/blob-batch-worker.mjs`（辅助进程，按 design D1 流式解析 `git cat-file --batch`，支持 `prefix`、`hash`、`write`、`search` 四种模式）与 `skills/excavator/source-snapshot/blob-batch.mjs`（同步父进程接口：`readBlobPrefixes`、`hashBlobs`、`writeBlobs`、`searchBlobs`；每批最多 4,096 个对象；失败时抛具名 `BlobBatchError`）。验证：在夹具 git 仓库上，四种模式的结果与逐个 `git show` 的结果逐字节相同，夹具覆盖：
  - 空文件、含 NUL 的二进制、中文与 emoji、跨读取块边界的大文件；
  - 重复 oid（同内容不同路径）、缺失对象（前缀模式返回缺失标记，其余模式抛具名错误）。
- [x] 1.2 隔离与分批。验证：
  - 新测试：一个大文件在 4096 字节之后含假私钥，前缀模式返回的字节数不超过前缀长度，且不含该私钥；
  - 超过 4,096 个对象时，按批次拆成多次辅助进程调用（通过可注入的进程启动接缝计数），结果与一次读取相同。

## 2. 快照改走批量读取

- [x] 2.1 `git-commit-snapshot.mjs` 按 design D3 改写：构造时一次批量取回需要的文件头，判定顺序与分支保持不变；`entries()`、`materialize()`、`search()` 改走批量读取，批次只含选中路径；`readFile()` 用 `Set` 做成员检查。同时从 `git-utils.mjs` 删除 `showFilePrefixAt`。验证：现有测试一个不改、全部通过，包括：
  - `tests/snapshot/*`；
  - `tests/selection-safety/selection-safety.oracle.test.mjs`；
  - `tests/revision-sync/cross-adapter-identity.test.mjs` 与 `e2e-three-adapters.test.mjs`；
  - `tests/mcp/*`。
- [x] 2.2 新旧对照测试：夹具仓库覆盖符号链接、非 blob 条目、按扩展名与按文件头判定的敏感文件、被默认规则过滤的文件和普通文件。以测试内保留的逐文件读取实现为对照，逐字节比较选择台账、处理跳过记录、选中路径、`entries()`、复制出的文件和检索结果。另外断言复制、哈希、检索的批次里不含未选中路径（O3）。验证：新测试通过。

## 3. 文档

- [x] 3.1 `docs/mcp.md`「Performance and host timeouts」一节改写：删掉「每次调用 O(文件数) 的子进程读取」和「wcp 上 75–115 秒」这类已不成立的描述，写入验收实测的解析耗时与每次调用耗时，并按新数字重新给出超时建议。验证：文中数字与 4.3 的实测一致。

## 4. 验收（acceptor 亲自执行，不采信 coder 自报）

- [x] 4.1 门禁（O5）：三件套与 `openspec validate --all --strict` 通过。
- [x] 4.2 conduit（`5e127d85`）、wcp、cebreo 副本（O1、O2）：
  - `main` 与本分支分别跑 lazy 首跑，`factsDigest`、`source-manifest.json` 的 `selection` 与 `entries` 完全相同；
  - conduit 上通过 stdio 调 MCP `recall`（固定检索词），结果与 `main` 逐项相同。
- [x] 4.3 Hadoop `2014707f8c31`（O1、O4）：
  - 一次快照解析不超过 10 秒；
  - lazy 首跑的 `factsDigest` 等于 `88c3219d31de0315e87fb4303fed5fa0bced8faae9ebb940dcc0233c13c5eae7`，manifest 的 `selection` 与 `entries` 与现有持久化版本相同；
  - `snapshotResolve`、`snapshotMaterialize`、`manifestEntries` 各在 10 秒内；
  - 通过 stdio 调一次 MCP `project_status` 和 `recall`，记录耗时；
  - 结果以脱敏摘要写进 PR 描述。
- [ ] 4.4 PR 以 merge commit 合入 `main`，保留 commit 序列。
