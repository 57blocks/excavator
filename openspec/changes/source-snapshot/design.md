## Context

见 proposal.md「Why」。切片 A 已落地：`lazy-analyze.mjs` 顺序跑 `scan-project.mjs → structure-all.mjs → extract-import-map.mjs → build-fact-graph.mjs → validate → save`，用 `git rev-parse HEAD` + `scan.contentDigest` 拼新鲜度，并用 `--exclude-analysis-data` 兜住 `.excavator/` 自污染。`node-identity.mjs::normalizePath` 已实现多仓成员前缀规则。`prepare-incremental.mjs` 已有 git-diff / 非 git content-hash diff / 删除检测 / 原子写。这些现有脚本都**直接读文件系统**。

约束：Core 侧脚本零模型、build-free；缺失可见；`.excavator/` 始终排除。

## Goals / Non-Goals

**Goals:**
- 一个 SourceSnapshot 抽象 + 三 adapter，让「分析哪份源码」由稳定 revision 决定。
- 非 Git 目录可靠增量、多仓由成员 HEAD 决定、Git 只反映 HEAD。
- 跨 adapter（git vs directory）同内容 → 同事实投影与同 factsDigest。
- 增量同步复用 `prepare-incremental.mjs`，原子保存先于推进 manifest。

**Non-Goals（设计层边界）:**
- 不动 BM25/检索/按需语义/并发锁/语义新鲜度（切片 C）；不动 Full/Domain/消费端迁移（切片 D）；不删 SKILL.md worktree 重定向（切片 E）。
- 不追求「最小增量」——见 D4：确定性层重投影很便宜，本切片的增量保证是**结果正确**而非**最小重算**。

## Decisions

### D1. SourceSnapshot 为 .mjs 模块 + 工厂
新增 `skills/excavator/source-snapshot.mjs`，导出 `resolveSourceSnapshot(root)` 工厂与三种 adapter 实现；契约 `{ revision, listFiles(), readFile(path), search(terms), diff(previousManifest) }`。逼近单文件行数上限时按 adapter 拆分到 `source-snapshot/` 子模块。

### D2. adapter 探测顺序
`resolveSourceSnapshot(root)`：root 自身是 Git 仓库 → **GitCommitSnapshot**；否则 root 下存在一个或多个 Git 成员仓 → **MultiRepoSnapshot**；否则 → **DirectorySnapshot**。探测结果记入 manifest，adapter 类型变化触发完整重建（revision-sync spec）。

### D3. revision 格式（plan §3.1–3.3，固定口径）
`git:<full-head-sha>` / `multi-repo:<sha256(排序后 成员相对路径 + 成员 HEAD)>` / `directory:<sha256(排序后 {path,contentHash})>`。`selectionDigest` 覆盖生效的 ignore/exclude 规则；`pipelineVersion` 覆盖抽取器版本。三者进 `source-manifest.json`。

### D4. 增量同步 = 对新快照做完整确定性重投影（**关键取舍，请重点评审**）
本切片的「增量同步」实现为：用 `prepare-incremental.mjs` 的 diff **判断是否有变化**（无变化则跳过、不推进 manifest），有变化则**对新快照重跑确定性投影**（scan→structure-all→import-map→build-fact-graph），原子保存后推进 manifest。
- 为什么不做「只重抽取改动文件再局部合并」：确定性层是纯函数且很便宜（go-clean-arch 全量 ~2s、structure-all ~0.7s），真正贵的是 LLM，而 LLM 在 Lazy 下已被推迟。完整重投影**天然正确**（未改文件确定性地产出相同事实 → 不受影响；删除文件自然消失；无残留旧行号），复杂度和出错面都远小于局部合并（后者要手工删节点、重连边、防悬挂）。
- `prepare-incremental` 的文件级 diff 仍然保留价值：本切片用于「是否变化 / 变了哪些文件」的判定；到切片 C 它成为**语义缓存失效**的承重件（那里重算才是贵的）。
- 备选：真最小增量 → 推迟为优化项，进 roadmap；spec 的正确性场景（改动文件更新、未改不受影响、删除移除、保存失败不推进）由重投影全部满足。

### D5. 用「物化到临时目录」承接现有脚本（**关键取舍，请重点评审**）
现有 scan/structure/import-map 脚本都直接读 FS。与其重写它们去消费 SourceSnapshot API，本切片让 SourceSnapshot **把快照内容物化到一个临时目录**，现有脚本对该临时目录运行：
- GitCommitSnapshot：`git archive HEAD` 展开到 temp（plan §3.1 明确允许），保证只含 HEAD、无 staged/untracked。
- DirectorySnapshot：按 manifest 拷贝当前内容到 temp（排除 `.excavator/`），并在读时校验 content hash（一致性 guard 的读取校验）。
- MultiRepoSnapshot：把每个成员 `git archive HEAD` 展开到 `temp/<memberId>/`，父目录非成员源码按 DirectorySnapshot 拷入，成员前缀天然进入路径。
revision / selectionDigest 从**源**计算（不是 temp）；分析后清理 temp。好处：现有脚本零改动即获得 HEAD-only 与一致性；坏处：一次全量物化的 I/O——对确定性快、可接受，且天然满足 D4 的重投影模型。备选（重写脚本消费 snapshot API）风险更高、收益在本切片不明显。

### D6. 跨 adapter 身份
git-archive temp 与 directory 对同一内容给出相同相对路径 → 经 `node-identity.normalizePath` 得同 id → 同 factsDigest（factsDigest 已排除运行元数据）。多仓在 temp 里以 `<memberId>/…` 前缀物化，与 `normalizePath({memberId})` 规则一致。

### D7. 一致性 guard（DirectorySnapshot）
建 manifest → 物化/读取时校验每个文件 content hash → 产物先写临时文件 → 发布前重算 manifest digest → 不一致丢弃重试一次 → 仍变化保留旧图旧 revision 并显式失败（退出非零、不发布）。

## Risks / Trade-offs

- **临时物化的磁盘/IO 成本**（D5）→ 确定性快；用系统 temp + 用后清理；大仓可评估 `git archive` 流式，但不在本切片。
- **完整重投影不是最小增量**（D4）→ 明确为取舍；正确性优先，最小增量作为优化项 roadmap；C 阶段文件级失效才承重。
- **多仓探测误判**（把嵌套 git 目录当成员或漏认）→ 探测规则写死并配夹具（父非 git + N 个成员 git；父是 git 则走 GitCommitSnapshot 不进多仓）。
- **git archive 与工作区差异**（.gitattributes export-ignore、CRLF filter）→ 以 archive 内容为准即「HEAD 的规范内容」，与 revision 语义一致；夹具覆盖含/不含 export-ignore。
- **与切片 A 的 `--exclude-analysis-data` 重叠**→ 保留该 flag 不删；SourceSnapshot 的 selection 统一排除 `.excavator/`，两者一致不冲突。

## Migration Plan

- `lazy-analyze.mjs` 改为：`resolveSourceSnapshot(root)` → 物化 → 跑既有脚本 → build-fact-graph → 写 `source-manifest.json`（sourceRevision/selectionDigest/pipelineVersion）+ 图/meta/fingerprints。
- 已有 `meta.json` 的 `gitCommitHash`/`sourceDigest` 继续写作审计信息，但新鲜度以 `source-manifest.json` 为准。
- 存量 `.excavator/`（切片 A 产出，无 source-manifest）：首次运行按 adapter 全量重建以补齐 manifest，不清空已有语义（沿用切片 A 的非破坏合并）。
- 回滚：保留切片 A 的直接路径不可行（已切换），但 adapter/物化是加法；出问题可 `--mode=full` 或回退本切片 commit。

## Open Questions

- 无阻断性未决项。`git archive` 流式化、真最小增量均为明确推迟的优化，不改本切片的 spec、方案或任务拆分。
