## Why

切片 A 的 Lazy 驱动直接读工作目录 / git（`lazy-analyze.mjs` 调 `scan-project.mjs`，并用 `git rev-parse HEAD` + `scan.contentDigest` 拼新鲜度），且已经暴露出问题：re-run 会把工具自己的 `.excavator/` 扫进覆盖账本（切片 A 用 `--exclude-analysis-data` 临时兜住）。plan §3 要求分析、检索、源码取证统一依赖一个 **SourceSnapshot**，不各自直接读 git / 工作区；否则新鲜度判据分散（`gitCommitHash` 与 `sourceDigest` 各管一半）、多仓被误当普通目录、非 Git 目录无法可靠增量。本切片建立这层抽象与三种 adapter、统一 `source-manifest.json`、快照一致性 guard，以及基于 revision 的增量同步（复用既有 `prepare-incremental.mjs`），为切片 C（检索/按需语义的新鲜度）与切片 D（Full 复用同一事实构建）打基座。

## What Changes

- 新增 **SourceSnapshot 契约**：`{ revision, listFiles(), readFile(path), search(terms), diff(previousManifest) }`。分析流水线（切片 A 的 `lazy-analyze.mjs` 与扫描）改为**经它取源**，不再直接读工作区或 `git rev-parse HEAD`。
- 新增三种 adapter：
  - **GitCommitSnapshot**：revision = `git:<full-head-sha>`；文件清单 `git ls-tree`，读取 `git show HEAD:<path>`，搜索 `git grep … HEAD`，`.excavatorignore` 从 HEAD 读；**忽略 staged / unstaged / untracked**；终端提示 `Analyzing git:<short-sha>; uncommitted changes ignored`。
  - **MultiRepoSnapshot**：revision = `multi-repo:<sha256(排序后的 成员路径+成员 HEAD)>`；每个成员仓按 GitCommitSnapshot 读；父目录中不属于任何成员的源码按 DirectorySnapshot 读并计入 digest；父目录生效的 ignore 规则进 `selectionDigest`。
  - **DirectorySnapshot**：revision = `directory:<manifest-digest>`（对排序后的 `{path, contentHash}` 清单算 SHA-256）；`.excavator/` **始终排除**；不执行 `git init`。
- 新增 **`source-manifest.json`**：记录 `sourceRevision` + `selectionDigest`（生效的 ignore/exclude 规则）+ `pipelineVersion`；三者任一变化都必须重建受影响的确定性产物。
- 新增 **快照一致性 guard**（§3.4，DirectorySnapshot）：建 manifest → 每次 readFile 校验预期 content hash → 产物先写临时文件 → 发布前重算 digest → 不一致丢弃并重试一次 → 第二次仍变化则保留旧图与旧 revision 并**显式失败**。
- 新增 **revision 增量同步入口**（§6）：当 `sourceRevision / selectionDigest / pipelineVersion` 与已持久化 manifest 不一致时触发；**复用既有 `prepare-incremental.mjs`**（已具备 git-diff、非 git content-hash diff、删除检测、原子写）；Git 走 commit diff，Directory 走前后 manifest → 新增/修改/删除；修改文件整文件重抽取（不复用旧行号）；删除对应节点/边；重命名按删除+新增；重解析受影响 imports/exports/唯一可解 calls；重算 coverage/gaps/fingerprints/factsDigest；**原子保存全部确定性产物后才推进 manifest**；adapter 类型变化（普通目录后被 `git init`）触发完整确定性重建。
- **跨 adapter 身份**（§12.4.1）：相同源码内容经 GitCommitSnapshot 与 DirectorySnapshot 分析，得到**相同事实投影与相同 `factsDigest`**（路径规范化已在切片 A 的 `node-identity.mjs::normalizePath` 内实现，含多仓成员前缀规则；本切片由真实 adapter 驱动它）。
- 切片 A 的临时兜底可回收：`.excavator/` 排除由 SourceSnapshot 的 selection 规则统一保证，不再依赖散落的 `--exclude-analysis-data` 传参（保留该 flag 不删，避免破坏其他调用方）。

**非目标（本切片明确不做）**：BM25 `source-index`、查询扩展、多跳遍历、按需语义缓存 / 并发锁 / 语义新鲜度（切片 C）；Full 语义物理隔离、Domain 新鲜度、其余消费 skill 迁移（切片 D）；删除 SKILL.md worktree 重定向（切片 E 收尾）。

## Capabilities

### New Capabilities
- `source-snapshot`: SourceSnapshot 契约、三种 adapter（Git / Multi-repo / Directory）、`source-manifest.json`（sourceRevision / selectionDigest / pipelineVersion）、DirectorySnapshot 一致性 guard，以及跨 adapter 的事实投影与 factsDigest 一致性。
- `revision-sync`: 基于 revision 的增量同步——复用 `prepare-incremental.mjs`，新增/修改/删除/重命名的增量事实重建，adapter 类型变化触发完整重建，原子保存先于推进 manifest。

### Modified Capabilities
（无：本切片新增均为新 capability；不改动已接受 spec 的 requirement。切片 A 的 `fact-graph` / `lazy-analysis` 语义未变——事实投影的确定性与 factsDigest「仅事实、排除运行元数据」仍成立，本切片只是把喂给它的源改为经 SourceSnapshot。）

## Impact

- 目标分支：`feat/lazy-mode`（经 `lazy/slice-b` PR 合入；最终 feat → main）。
- 受影响：新增 `skills/excavator/source-snapshot.mjs`（契约 + 三 adapter + manifest）与 `sync-fact-graph.mjs`（增量入口）；改 `lazy-analyze.mjs` 经 SourceSnapshot 取源并写 `source-manifest.json`；复用 `prepare-incremental.mjs`、`scan-project.mjs`、`extract-import-map.mjs`、`build-fact-graph.mjs`、`node-identity.mjs`；`@excavator/core` 的 `resolveDataDir`/`saveGraph`/`loadGraph`/`saveMeta`/ignore-filter。
- 数据产物：新增 `source-manifest.json`；`knowledge-graph.json`/`meta.json`/`fingerprints.json` 的写入改由增量或全量路径统一驱动。
- 测试：合成夹具覆盖三 adapter 的首建与增量（git 提交增删改重命名、非 git 目录增删改、多仓成员变化）、一致性 guard 的重试/失败、跨 adapter factsDigest 一致（§12.2 / §12.4.1）；真实语料 opt-in 用 wcp（多仓）与其单仓成员（如 wcp-auth）验证，产物不提交。
- 契约地基：SourceSnapshot 的 revision 与 selectionDigest 是切片 C（语义新鲜度）与切片 D（Full 复用事实构建）的前置依赖。
