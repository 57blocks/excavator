## Context

`listTrackedEntries(dir, sha)` 跑 `git ls-tree -r -z <sha>`，整段 stdout 按 UTF-8 解码后按 NUL 切开，每条用正则取 mode、type、oid、path。调用方：
- GitCommitSnapshot 构造时按路径排序条目，建 `path → oid` 映射；需要文件头的条目交给 `readBlobPrefixes`（按 oid）；之后 `entries()`、`materialize()`、`search()` 也按 oid 读；`readFile()` 用 `git show <sha>:<path>` 按路径读。
- `hotspots.mjs` 为选中路径查 oid。
- parity 测试的逐文件参照实现，用 `showFileAt` 按路径读文件头与内容。

修复前在未修改的代码上跑新增用例（任务 1.1）：
- Latin-1 路径：`listFiles()` 除 `src/app.ts` 外还列出 `src/caf` + U+FFFD + `.ts`，而逐文件参照把它记为 `read-failed`；
- 有损解码相同的三个路径：构造时 `buildSourceSelectionLedger: duplicate candidate path` 抛错；
- 合法 UTF-8 路径：通过（这一条是修复的回归护栏）。

## Goals / Non-Goals

**Goals:**
- 不是合法 UTF-8 的树路径落进一个可见的桶：被选中时是 `read-failed` 处理跳过，与逐文件读取一致；
- 这类路径彼此不撞名，也不顶掉一个有损解码相同的合法路径的 oid；
- 合法 UTF-8 路径的条目、选择台账、跳过记录、清单、哈希、复制与检索逐字节不变。

**Non-Goals:**
- 不让这类文件可读、可分析；
- 不新增跳过原因；
- 不改 DirectorySnapshot。它用 `readdirSync` 的默认 UTF-8 解码，在允许任意字节文件名的文件系统上有同样的有损问题；本机的 APFS 要求文件名是合法 UTF-8，测不出来，这里只照记；
- 不处理含 `\` 的合法路径。选择策略把 `\` 规范化为 `/`，台账里是 `src/a/b.ts` 而清单里是 `src/a\b.ts`，`mergeSnapshotSelection` 抛出 `not snapshot-selected`。实现时探针确认 main 上就是这样，与本缺陷无关，另起。

## Decisions

### D1 按字节读，合法 UTF-8 照旧解码

`spawnSync` 不设 encoding，stdout 是 Buffer。按 NUL 字节切记录，每条在第一个 TAB 处切开：前面是 ASCII 的 mode、type、oid，后面是路径字节。`isUtf8`（`node:buffer`）为真的路径用 `Buffer#toString('utf-8')` 解码。

逐段解码与整段解码对合法段完全相同：NUL 与 TAB 都是 ASCII，UTF-8 自同步。`Buffer#toString` 与之前一样保留开头的 BOM；`TextDecoder` 默认会去掉它，所以不用。

`git ls-tree` 失败时的报错：stderr 现在是 Buffer，空 Buffer 不是假值，先转成字符串再回退到退出码。

### D2 非 UTF-8 路径按字节做百分号编码

`%` 与 0x80 及以上的每个字节写成 `%` 加两位大写十六进制，其余字节照写。例：`src/caf` 后接字节 0xE9 再接 `.ts` 的路径写成 `src/caf%E9.ts`。条目加 `pathNotUtf8: true`；合法路径的条目没有这个键，形状不变。

目录分隔符与扩展名原样保留，目录规则与语言识别照常起作用。`%` 本身也编码，所以不同的字节序列得到不同的字符串。

**备选：**
- git 的显示形式去掉两端引号（`git ls-files` 默认显示 `"src/caf\351.ts"`）：提案时选的是它，实现时由新增用例否定。core 的选择策略把 `\` 规范化为 `/`，台账里成了 `src/caf/351.ts`，凭空多一层目录，也与跳过记录的路径对不上；`mergeSnapshotSelection` 要求每条处理结果对应一条选中的台账路径，会抛错。保留两端引号则目录规则与扩展名都失配。
- U+FFFD 有损解码（批量读取前的写法）：撞名时选择台账抛错，整次快照失败。
- 每个坏字节映射到一个孤立代理项（Python 的 surrogateescape）：与所有合法路径不相交，但写进 UTF-8 文件、终端或按 UTF-8 哈希时变回 U+FFFD，撞名换个地方出现。

**代价：**
- 一个字面上就含 `%E9` 这类序列的合法路径仍可能与某个非 UTF-8 路径撞名。那时选择台账抛出 `duplicate candidate path`，是显式失败，不会读错内容；
- git 的输出写 `\351`，报告写 `%E9`，用户要自己对应。

### D3 跳过原因用 `read-failed`，不新增

批量读取之前就是 `read-failed`，逐文件读取给出的也是它。跳过原因是 core 的契约：`packages/core/src/schema.ts`、`types.ts`、`coverage-ledger.mjs`、`mention-resolution.mjs` 的 `TARGET_SKIP_REASONS` 与 coverage-ledger 规格都列着这组值，为一个罕见情形改它们的面太大。

**代价：** 原因不说明是路径字节导致的，读者要从路径里的 `%XX` 看出来。

### D4 不读内容，选择规则只看路径

GitCommitSnapshot 不把这类条目交给 `readBlobPrefixes`，文件头视为读不到，与逐文件读取读头失败时一样：选择规则按路径的初判就是最终判定，初判为选中则记 `read-failed`。它们从不进清单，oid 映射里的项也就从不被查到；编码后的路径若与某个合法路径相同，构造时台账已先抛错。

**备选：** 按 oid 读文件头。敏感头检测会把这类文件判成 `sensitive`，与逐文件读取不同；选中之后，`readFile`、复制与证据引用只能用一个仓库里不存在的名字。

## Oracles

动手前写死：

- **O1 复现：** 新增用例的前两个在未修复的代码上失败，第三个通过（Context 已记录）。
- **O2 修复：** 新增三个用例通过；parity 文件原有 6 个用例与 `tests/snapshot/` 其余用例不改一行照样通过。
- **O3 变异：** 每个变异各自应让指定用例变红，做完还原：
  - M1 `listTrackedEntries` 恢复整段 UTF-8 解码 → 用例 1、2；
  - M2 GitCommitSnapshot 忽略 `pathNotUtf8`，照常按 oid 读文件头（这类文件进清单）→ 用例 1、2；
  - M3 `pathNotUtf8` 条目也交给 `readBlobPrefixes`，读到的前缀丢弃（仍记跳过）→ 用例 1（批次收到了它）；
  - M4 合法路径改用默认的 `TextDecoder` 解码 → 用例 3（开头的 BOM 被去掉）；
  - M5 不编码 `%` 本身 → 用例 2（两个路径撞名，台账抛错）；
  - M6 编码改回 git 的 `\351` 形式 → 用例 1（台账路径被规范化，跳过记录对不上选中的台账路径）。
- **O4 门：** `pnpm install --frozen-lockfile && pnpm -r build && pnpm test`、`pnpm run typecheck`、`openspec validate --all --strict` 全过；新文件先 `git add -N`。
