## Context

动机见 proposal.md。与方案直接相关的现状：

- `GitCommitSnapshot` 构造时先用 `git ls-tree -r -z` 列出全部条目，里面已经有每个 blob 的 oid。然后对几乎每个 blob（敏感文件与分析数据、压缩包除外，连会被默认规则过滤的 `.png` 也要读）调用 `showFilePrefixAt`：每次起一个 Node 辅助进程，再由它起 `git show` 读前 4096 字节（`PRIVATE_KEY_PREFIX_BYTES`），用于私钥头检测。
- `readFile()` 每次调用 `spawnSync git show`，还要先用 `_trackedPaths.includes()` 做 O(n) 的成员检查。`materialize()`、`entries()`、`search()` 都是对每个选中路径调用一次 `readFile()`。
- 所有调用方都是同步使用快照：MCP 的 `project-service`（每次工具调用解析两遍，`recall` 还会调 `search()`）、`lazy-analyze`、`sync-fact-graph`、`semantic-language-audit`。
- 现有代码注释里写明了两条隔离保证：
  - 读文件头时，辅助进程读满前缀就停止，调用方从不持有 blob 的其余部分；
  - 被拒绝的路径从不向 git 请求。
- `MultiRepoSnapshot` 由成员的 `GitCommitSnapshot` 组成；`DirectorySnapshot` 直接读文件系统，不涉及子进程。它在同样 16,413 个文件的 Hadoop 目录上实测：解析 2.7 秒（首次）/ 1.5 秒（再次），复制 2.6 秒，检索 3 个词 1.2 秒（命中数与 git 快照相同，都是 10,058 条），峰值常驻内存 294 MiB。所以非 git 项目没有这个问题，不在本次范围内。

原型实测（Hadoop `2014707f8c31`，与上次运行持久化的 manifest 逐项对照，全部一致）：

| 操作 | 规模 | 现在 | 批量读取 | 对照结果 |
|---|---|---|---|---|
| 解析（`ls-tree` + 读文件头 + 判定） | 16,575 个条目 / 16,564 个文件头 | 629 秒 | 1.1 秒 | selectionDigest、选择台账一致 |
| `entries()` 内容哈希 | 16,413 个文件 | 175 秒 | 0.73 秒 | 16,413 个哈希一致 |
| `materialize()` | 16,413 个文件 | 188 秒 | 2.4 秒 | 复制出的每个文件哈希一致 |
| `search()`（3 个检索词） | 16,413 个文件 | 187 秒 | 1.1 秒 | 10,058 条命中逐条相同 |
| `search()`（conduit，3 个检索词） | 143 个文件 | 1.5 秒 | 0.05 秒 | 358 条命中逐条相同 |

## Goals / Non-Goals

**Goals:**
- git 快照的四类读取都改为分批流式读取，子进程数与文件数无关。
- 快照的身份、内容与检索结果逐字节不变；两条隔离保证不变。
- 所有调用方继续使用同步接口，不做任何改动。

**Non-Goals:**
- 按版本缓存快照或判定结果。批量读取后每次 MCP 调用仍解析两遍快照，Hadoop 上约 2 秒；常驻服务的缓存留给服务器部署的变更去设计。
- `readFile()` 的单文件读取路径（只用于读取证据，调用量小），只修掉它的 O(n) 成员检查。
- 目录快照；多仓库快照的父目录部分。

## Decisions

### D1 一个辅助进程，一条 `git cat-file --batch` 流

新增 `blob-batch-worker.mjs` 辅助进程：
- 从 stdin 读入作业 `{cwd, mode, items: [{oid, path}], ...}`（不写临时文件）；
- 启动一个 `git cat-file --batch`，按输入顺序写入全部 oid；
- 逐个对象解析输出流（`<oid> <type> <size>\n` + 内容 + `\n`），一次只处理一个对象。

四种模式：
- `prefix`：每个对象只保留前 N 字节，其余边读边丢；
- `hash`：流式算 sha256，只输出哈希；
- `write`：直接写到目标目录下对应的路径；
- `search`：先整对象检查 NUL，再按 `\n` 切行、逐词匹配，与现有语义完全相同。

父进程接口 `blob-batch.mjs` 用 `spawnSync` 调用辅助进程，因此对外仍是同步接口。缺失对象按现有语义处理：读文件头缺失时记为 `read-failed` 处理跳过；复制、哈希、检索中缺失则抛具名错误。

**备选：**
- 直接用 `spawnSync git cat-file --batch`：会把所有 blob 的完整内容缓冲进父进程，违反文件头只取前缀的隔离保证；仓库里有大体积二进制时内存不可控。否决。
- 把接口改成异步流：MCP 服务、sync 路由和测试都同步使用快照，改动面大。否决。
- 检索改用 `git grep`：二进制判定不同（`-I` 只看前 8 KB，还受 `.gitattributes` 影响，而现有实现检查整个文件有没有 NUL），结果会变。否决。
- 复制改用 `git checkout-index` 或 `git archive`：会套用换行与 smudge 过滤。上一个变更的验收里已经实测过，Hadoop 的 `.cmd` 和 `.vcxproj` 文件在工作区是 CRLF，而 blob 里是 LF，结果会和逐 blob 读取不同。否决。

### D2 分批，内存有上界

每批最多 4,096 个对象（常量，可调）。文件头模式一批的输出上限约为 4,096 × 4 KB = 16 MB，Hadoop 规模只需要 5 批，也就是 5 个辅助进程。`write` 和 `search` 模式一次只在辅助进程里持有一个 blob，与现在 `git show` 缓冲整个文件的内存特征相同，没有退化。

### D3 构造、`entries()`、`materialize()`、`search()` 改走批量读取

构造函数保持现有的逐条判定顺序与分支不变，只是先把需要读文件头的条目收集起来，一次批量取回前缀，再按原顺序判定。另外两处改动：
- 用 `Set` 保存选中路径，供 `readFile()` 做成员检查；
- 按 `path → oid` 映射为另外三种操作构造批次，而且只包含选中路径。

删除 `showFilePrefixAt`，它只有这一个调用方。

### D4 身份不变的证明方式

以现有实现为对照组，在夹具与真实语料上逐字节比较 revision、selectionDigest、选择台账、处理跳过记录、`entries()`、复制出的文件和检索结果。原型已经在 Hadoop 上通过了除处理跳过记录以外的全部项目，处理跳过记录会在夹具测试里覆盖（符号链接和读取失败）。

## Risks / Trade-offs

- [辅助进程协议解析出错会造成内容错位] → 帧格式严格：先有头行，再按大小读取，最后必须是换行；对象计数必须与输入一致，否则非零退出。夹具覆盖：空文件、含 NUL 的二进制、CJK 与 emoji、正好跨越读取块边界的大文件、重复 oid（不同路径同内容）、缺失对象。
- [`git` 版本差异] → `cat-file --batch` 是 git 长期稳定的接口；本机 git 2.55。
- [每次 MCP 调用仍要解析两遍] → 从约 21 分钟降到约 2 秒；进一步的缓存不在本次范围（见 Non-Goals）。

## Migration Plan

没有数据迁移：身份与内容不变，已有项目不需要重建。回滚时直接 revert。

## 验收 Oracle（动手前写死）

- **O1 身份一致：**
  - 在夹具上，新旧实现的 revision、selectionDigest、选择台账、处理跳过记录、`entries()` 完全相同；
  - 在 conduit、wcp、cebreo 的副本上，`main` 与本分支 lazy 首跑的 `factsDigest`、`source-manifest.json` 的 `selection` 与 `entries` 完全相同；
  - 在 Hadoop 上，与现有持久化的 manifest 一致，`factsDigest` 仍为 `88c3219d31de0315e87fb4303fed5fa0bced8faae9ebb940dcc0233c13c5eae7`。
- **O2 复制与检索一致：** 复制出的每个文件字节与逐 blob 读取相同；conduit 上通过 stdio 调 MCP `recall`，结果与 `main` 逐项相同（其中包含源码检索的候选）。
- **O3 隔离：**
  - 选择安全的固定测试全部不改、原样通过；
  - 新增夹具：私钥内容位于 4096 字节之后的大文件，断言读文件头时父进程拿到的字节数不超过前缀长度；
  - 断言复制、哈希、检索三种批次里不含任何未选中路径。
- **O4 规模：**
  - Hadoop 上一次快照解析不超过 10 秒；
  - Lazy 首跑的 `snapshotResolve`、`snapshotMaterialize`、`manifestEntries` 各在 10 秒内；
  - 通过 stdio 调 MCP `project_status` 与 `recall` 各一次，报告耗时。
- **O5 门禁：** 改的是 `skills/**/*.mjs`，按 AGENTS.md 跑三件套并跑 `openspec validate --all --strict`；core 不改，不跑 core 测试。
