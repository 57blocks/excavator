## Why

`skills/excavator/source-snapshot/git-utils.mjs` 的 `listTrackedEntries` 以 `encoding: 'utf-8'` 读 `git ls-tree -r -z` 的输出。树里的路径是任意字节；不是合法 UTF-8 的路径（例如 Latin-1 文件名：`src/caf` 后接表示 e-acute 的字节 0xE9 再接 `.ts`）解码后带 U+FFFD，成了树里不存在的路径。

批量读取（snapshot-resolve-performance）之前，GitCommitSnapshot 按路径读文件头，读不到，这个路径就落进 `processingSkips` 的 `read-failed`，不在 `listFiles()` 里。批量读取改为按 oid 读文件头、哈希、复制与检索之后：
- 这个路径作为选中文件列在 `listFiles()` 里，`readFile()` 仍按路径读，抛出 `not found`；
- `read-failed` 跳过消失，输入不在任何可见的桶里，违反「没有第四态」；
- 快照的文件清单与内容哈希和逐文件读取不同。

解码还是有损的。只在非 UTF-8 字节上不同的两个路径（如末字节 0xE9 与 0xFF），以及一个本身含 U+FFFD 的合法路径，都解码成同一个字符串。选择台账见到重复路径就抛出 `duplicate candidate path`，整次快照失败；批量读取之前也是这样。

## What Changes

- `listTrackedEntries` 按字节读 ls-tree 的输出。合法 UTF-8 的路径照旧解码，条目与之前逐字节相同。
- 不是合法 UTF-8 的路径按字节做百分号编码：`%` 与 0x80 及以上的字节写成 `%` 加两位大写十六进制，其余照写，例如 `src/caf%E9.ts`。条目带 `pathNotUtf8: true`。
- GitCommitSnapshot 不读这类条目的内容（不按路径，也不按 oid），选择规则照常按路径判定。被选中时记为 `read-failed` 处理跳过，不进 `listFiles()`，也不进 oid 映射。结果与逐文件读取一致。
- parity 测试加三个用例：Latin-1 路径；有损解码相同的路径与字面的 `%`；合法 UTF-8 路径不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `source-snapshot`：新增「不是合法 UTF-8 的树路径可见地跳过」。

## Impact

- 改动：`skills/excavator/source-snapshot/git-utils.mjs`、`skills/excavator/source-snapshot/git-commit-snapshot.mjs`、`tests/snapshot/git-commit-snapshot-batch-parity.test.mjs`、`openspec/specs/source-snapshot/spec.md`。
- 合法 UTF-8 路径的结果不变。`hotspots.mjs` 也用 `listTrackedEntries`，只按选中路径查 oid，不受影响。
- 不改跳过原因的枚举，不改 DirectorySnapshot，不改批量读取模块。

执行约束：
- 源码、注释、测试与提交信息用英文，零中文字符。
- 本变更的文档、提交信息与 PR 正文不出现私有语料的名字。
- 验收 oracle 见 design.md，动手前已写死。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose snapshot-undecodable-path`
2. `fix(snapshot): keep tree paths that are not valid UTF-8 a visible read-failed skip`：任务 1.1–1.3。
3. `docs(openspec): record snapshot-undecodable-path acceptance and archive`：任务 2.1–2.3。
