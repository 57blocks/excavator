## Context

`listTrackedEntries(dir, sha)` 跑 `git ls-tree -r -z <sha>`，整段 stdout 按 UTF-8 解码后按 NUL 切开，每条用正则取 mode、type、oid、path。调用方：
- GitCommitSnapshot 构造时按路径排序条目，建 `path → oid` 映射；需要文件头的条目交给 `readBlobPrefixes`（按 oid）；之后 `entries()`、`materialize()`、`search()` 也按 oid 读；`readFile()` 用 `git show <sha>:<path>` 按路径读。
- `hotspots.mjs` 为选中路径查 oid。
- parity 测试的逐文件参照实现，用 `showFileAt` 按路径读文件头与内容。

另有读 git 输出里路径的模块，不经 `listTrackedEntries`：`hotspots/history.mjs` 读 `git log`，`sync-fact-graph.mjs` 读 `git diff --name-status -z`，都按 UTF-8 有损解码（评审第一轮指出，读码确认）。

修复前在未修改的代码上跑新增用例（任务 1.1）：
- Latin-1 路径：`listFiles()` 除 `src/app.ts` 外还列出 `src/caf` + U+FFFD + `.ts`，而逐文件参照把它记为 `read-failed`；
- 有损解码相同的三个路径：构造时 `buildSourceSelectionLedger: duplicate candidate path` 抛错；
- 合法 UTF-8 路径：通过（这一条是修复的回归护栏）。

## Goals / Non-Goals

**Goals:**
- 不是合法 UTF-8 的树路径落进一个可见的桶：被选中时是 `read-failed` 处理跳过，与逐文件读取一致；
- 这类路径彼此不撞名；与当前树里的合法路径同名时显式失败，不让快照及其下游把一个文件的内容或历史算到另一个头上；只在历史里共用名字的情形见 Non-Goals；
- 合法 UTF-8 路径的条目、选择台账、跳过记录、清单、哈希、复制与检索逐字节不变。

**Non-Goals:**
- 不让这类文件可读、可分析；
- 不新增跳过原因；
- 不改 DirectorySnapshot。它用 `readdirSync` 的默认 UTF-8 解码，在允许任意字节文件名的文件系统上有同样的有损问题；本机的 APFS 要求文件名是合法 UTF-8，测不出来，这里只照记；
- 不处理含 `\` 的合法路径。选择策略把 `\` 规范化为 `/`，台账里是 `src/a/b.ts` 而清单里是 `src/a\b.ts`，`mergeSnapshotSelection` 抛出 `not snapshot-selected`。实现时探针确认 main 上就是这样，与本缺陷无关，另起；
- 不改读 `git log`、`git diff` 的模块，它们仍有损解码路径。残余有两种，都不经过当前树的快照，main 上就是这样，另起（D5 备选）：
  - 当前树里没有同名的一对、但历史上两者并存过，后来删掉了非 UTF-8 的那个时，hotspots 仍把那段历史算到合法文件上；
  - 两个有损解码相同的非 UTF-8 文件，其中一个后来改名（例如改成 `src/b.ts`）。hotspots 的 lineage 按 `git log` 给的名字接续，改名前只动了另一个文件的提交也算到 `src/b.ts` 上，不记 lineage 冲突。评审第二轮指出，按 `skills/excavator/hotspots/lineage.mjs` 的代码核对过，没有实跑。

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
- 一个字面上就含 `%E9` 这类序列的合法路径仍可能与某个非 UTF-8 路径撞名。那时 `listTrackedEntries` 抛出指名两者的错误（D5），是显式失败，不会读错内容；
- git 的输出写 `\351`，报告写 `%E9`，用户要自己对应。

### D3 跳过原因用 `read-failed`，不新增

批量读取之前就是 `read-failed`，逐文件读取给出的也是它。跳过原因是 core 的契约：`packages/core/src/schema.ts`、`types.ts`、`coverage-ledger.mjs`、`mention-resolution.mjs` 的 `TARGET_SKIP_REASONS` 与 coverage-ledger 规格都列着这组值，为一个罕见情形改它们的面太大。

**代价：** 原因不说明是路径字节导致的，读者要从路径里的 `%XX` 看出来。

### D4 不读内容，选择规则只看路径

GitCommitSnapshot 不把这类条目交给 `readBlobPrefixes`，文件头视为读不到，与逐文件读取读头失败时一样：选择规则按路径的初判就是最终判定，初判为选中则记 `read-failed`。它们从不进清单，oid 映射里的项也就从不被查到；编码后的路径若与某个合法路径相同，`listTrackedEntries` 已先抛错（D5）。

**备选：** 按 oid 读文件头。敏感头检测会把这类文件判成 `sensitive`，与逐文件读取不同；选中之后，`readFile`、复制与证据引用只能用一个仓库里不存在的名字。

### D5 与合法路径同名时拒绝（评审第一轮后加）

评审指出的情形：一个含 U+FFFD 的合法路径，旁边一个非 UTF-8 路径按 UTF-8 有损解码后等于它。以前选择台账对这对抛错；本变更的前一版让它通过快照。而 `git log` 与 `git diff` 的读取方仍有损解码，两者同名：
- hotspots 会把非 UTF-8 文件的提交、作者与改动行算到合法文件上；
- 删掉非 UTF-8 文件时，sync 会把合法路径当作删除，从源码索引里去掉。

`listTrackedEntries` 对两种同名抛出指名两者的错误：
- 非 UTF-8 路径带 U+FFFD 的解码等于一个合法路径；
- 它的百分号编码等于一个合法路径（D2 的代价，原先由台账抛出泛泛的 `duplicate candidate path`）。

hotspots 与 sync 都先解析当前 HEAD 的快照，所以这对同名在当前树里时它们不会运行。

**备选：** 让 `git log`、`git diff` 的读取方也按字节读、用同一种编码。这是根治，也能去掉第一种拒绝，但要改三个模块的解析，不在本缺陷的范围，另起。

**代价：**
- 树里有第一种一对时整次快照失败，与批量读取之前及 main 上一样；
- 第二种在批量读取之前能分析，现在失败；这要求一个字面含 `%XX` 的合法文件名恰好与非 UTF-8 文件名对上。

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

评审第一轮后加，在任务 1.4 动手前写死。用例 2 去掉含 U+FFFD 的合法路径，新增用例 4「与合法路径同名时拒绝」，M1–M6 照旧重跑，另加：
- M7 去掉 U+FFFD 解码同名的检查 → 用例 4（快照不抛错）；
- M8 去掉百分号编码同名的检查 → 用例 4（报错变成台账泛泛的 `duplicate candidate path`，与指名的错误不符）。

## 验收记录

- **O1 复现：** 在未修复的代码（`git-utils.mjs` 与 `git-commit-snapshot.mjs` 取 main 的版本）上跑 parity 文件：9 个用例 2 个失败。用例 1：`listFiles()` 多出 `src/caf` + U+FFFD + `.ts`；用例 2：`buildSourceSelectionLedger: duplicate candidate path`；用例 3 通过。达标。
- **O2 修复：** 修复后 `tests/snapshot/` 5 个文件 55 个用例全过；parity 文件原有 6 个用例与其夹具未改一行。达标。
- **O3 变异：** 逐个应用、跑 parity 文件、`git checkout` 还原，每个都按预期变红：
  - M1 → 用例 1（`listFiles()` 多出 U+FFFD 路径）、用例 2（台账重复路径）；
  - M2 → 用例 1（`listFiles()` 多出 `src/caf%E9.ts`）、用例 2（跳过记录为空）；
  - M3 → 只有用例 1（批次收到了 `src/caf%E9.ts` 与 `node_modules/caf%E9.js`）；
  - M4 → 只有用例 3（`toStrictEqual` 不等，开头的 BOM 被去掉）；
  - M5 → 只有用例 2（`duplicate candidate path lib/x%E9%FF.ts`）；
  - M6（同时把用例 1 的期望路径改成 `\351` 形式，只留台账一致性可失败）→ 用例 1 `expected undefined to be 'selected'`：台账路径被规范化成 `src/caf/351.ts`；用例 2 因期望路径未改也变红。
- **O4 门：** 在提交 `acac9469` 上 `pnpm install --frozen-lockfile && pnpm -r build && pnpm test`：154 个文件，4139 通过、4 跳过；`pnpm run typecheck` 通过；`openspec validate --all --strict` 46 项全过。达标。
- **另记：** 探针确认含 `\` 的合法树路径（如 `src/a\b.ts`）在 main 上同样让 `mergeSnapshotSelection` 抛出 `not snapshot-selected`，见 Non-Goals，另起。

### 评审第一轮

评审（PR 上一条 COMMENT 评审）提出 1 条 Important、2 条 Nit：
- Important：含 U+FFFD 的合法路径与有损解码等于它的非 UTF-8 路径能通过快照，`git log`、`git diff` 的读取方会把一个文件的历史与删除算到另一个头上。采纳，见 D5 与任务 1.4。
- Nit：注释与 PR 正文说「不同的字节序列不会得到同一个字符串」，对字面含 `%E9` 的合法路径不成立，也没有测试。采纳：注释改为只说非 UTF-8 路径彼此不撞名，与合法路径同名时由 D5 指名拒绝，用例 4 钉住。
- Nit：任务 1.2 写的是 git 的显示形式，任务 1.3 与提案说这类条目不进 oid 映射，任务 2.2 只列 M1–M4，都与代码或 design 不符。采纳，已更正。

在提交 `6a91bd44` 上：
- **O2：** `tests/snapshot/` 5 个文件 56 个用例全过；parity 文件原有 6 个用例未改一行。达标。
- **O3：** M1–M8 逐个应用、跑 parity 文件、还原，每个都按预期变红：
  - M1 → 用例 1、2、4（用例 4 的报错变成台账泛泛的重复路径）；
  - M2 → 用例 1、2；
  - M3 → 只有用例 1；
  - M4 → 只有用例 3（合法 UTF-8 路径）；
  - M5 → 只有用例 2；
  - M6（用例 1 的期望路径同时改成 `\351` 形式）→ 用例 1 `expected undefined to be 'selected'`，用例 2、4 因期望路径未改也变红；
  - M7 → 只有用例 4（快照不抛错）；
  - M8 → 只有用例 4（报错是台账的 `duplicate candidate path`）。
- **O4：** 在分离检出中 `pnpm install --frozen-lockfile && pnpm -r build && pnpm test`：154 个文件，4140 通过、4 跳过；`pnpm run typecheck` 通过；`openspec validate --all --strict` 45 项全过。达标。

第一次跑变异时，脚本用 `git checkout` 还原，把尚未提交的任务 1.4 改动一并冲掉了，那一次 M2–M6 的结果作废。改动重做、先提交后，上面的结果是重跑的。

### 评审第二轮

评审（PR 上第二条 COMMENT 评审，针对 `544b6d34`）确认第一轮三条都已解决，另提 1 条 Nit：
- Nit：规格写「系统 MUST NOT 把一个文件的内容或历史算到另一个文件上」，承诺比实现宽。Non-Goals 已记了一种 hotspots 仍这样做的输入，评审又指出一种（有损名字相同、其中一个后来改名）。两种 main 上都一样，不是回归，问题在已接受契约的措辞。采纳：规格收窄为快照不把一个文件的内容算到另一个上，只在历史里共用名字的情形写明不在要求内；Goals 同步收窄，Non-Goals 补上改名的残余。
- 评审在总结里另提：PR 正文有一条子项仍说「两个字节序列不会得到同一个字符串」。采纳，改为只说非 UTF-8 路径彼此不撞名。

只改文档，代码与测试未动；`openspec validate --all --strict` 通过。合入前把最新的 main 合进分支，在合并提交上重跑 O4，结果记在 PR 正文。
