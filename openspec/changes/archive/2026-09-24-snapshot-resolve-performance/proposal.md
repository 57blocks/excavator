## Why

git 仓库的源码快照现在逐个文件起子进程读取，读取成本随文件数线性增长。

在 apache/hadoop（固定提交 `2014707f8c31`，16,575 个跟踪文件）上，Lazy 首跑 1,121 秒，快照层占了约 992 秒（89%）：

| 步骤 | 耗时 | 做法 |
|---|---|---|
| 解析快照（选择源文件） | 629 秒 | 每个文件起一个 Node 进程，再起 `git show` 读前 4096 字节 |
| 复制快照 | 188 秒 | 每个文件一次 `git show` |
| manifest 逐文件哈希 | 175 秒 | 每个文件一次 `git show` |

MCP 的每次调用都要解析两遍快照，所以在 Hadoop 上调一次工具约 21 分钟；`recall` 的源码检索还会再逐个文件读一遍。连 conduit 这样的小仓库，调一次 `project_status` 也要 11.6 秒。

要在大仓库上用 MCP、做服务器部署或做 UI，这一层必须先修好。`docs/mcp.md` 已经把它记为后续变更 `snapshot-resolve-performance`。

## What Changes

- 新增批量 blob 读取：一次 `git cat-file --batch` 按顺序流式处理一批 blob，分四种用法：只取文件头前缀、算内容哈希、直接写成文件、按现有语义做全文检索。调用方式仍然是同步的，所有调用方的接口不变。
- `GitCommitSnapshot` 的解析、`entries()`、`materialize()`、`search()` 全部改走批量读取；路径成员判断从数组查找改为集合查找；删除不再使用的逐文件读头函数。多仓库快照由成员 git 快照组成，自动受益；目录快照不变。
- 快照身份与内容逐字节不变，包括 revision、selectionDigest、选择台账、处理跳过记录、内容哈希、复制出的文件和检索结果。
- 原型在 Hadoop 上实测，结果与持久化的 manifest 逐项一致：
  - 解析：629 秒 → 约 1.1 秒（`ls-tree` 0.1 秒 + 读 16,564 个文件头 0.96 秒）。
  - 内容哈希：175 秒 → 0.73 秒（16,413 个文件）。
  - 复制快照：188 秒 → 2.4 秒。
- 敏感内容的隔离保证保持不变：读文件头时只保留前 4096 字节，文件其余部分在读取过程中直接丢弃；未被选中的路径，其内容从不向 git 请求。
- 更新 `docs/mcp.md` 的性能一节，写入新的实测数字。

**不在本次范围**：
- 按版本缓存快照或选择结果（进程内或落盘）。批量读取之后，每次 MCP 调用仍然解析两遍快照，Hadoop 上约 2 秒；常驻服务的缓存设计留给后续的服务器部署变更。
- 目录快照。
- `readFile()` 的单文件读取。它只在读取证据时按需调用，保持逐文件方式。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `source-snapshot`: 新增「git 快照批量读取」要求，规定读取成本不随文件数按子进程线性增长、结果与逐文件读取逐字节一致，并保持文件头读取与未选中路径的隔离保证。

## Impact

- **代码**：
  - 新增：`skills/excavator/source-snapshot/blob-batch.mjs`（批量读取的父进程接口）、`skills/excavator/source-snapshot/blob-batch-worker.mjs`（流式处理 `git cat-file --batch` 的辅助进程）。
  - 修改：`skills/excavator/source-snapshot/git-commit-snapshot.mjs`、`skills/excavator/source-snapshot/git-utils.mjs`（删除 `showFilePrefixAt`）。
- **文档**：`docs/mcp.md` 的性能一节。
- **测试**：新增批量读取与逐文件读取的对照测试；现有快照、选择安全、跨适配器身份测试保持不变并作为回归依据。
- **不影响**：
  - 数据格式和 `PIPELINE_VERSION` 都不变，已有项目不需要重建。
  - 不新增运行时依赖。
  - 不改 core。
- **AI-first 范围判定**：这是确定性读取层的性能与安全边界问题，skill / prompt 无法在运行时绕开，所以必须改代码。
