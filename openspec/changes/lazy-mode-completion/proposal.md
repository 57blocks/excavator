## Why

切片 A–D 已落：确定性事实层 + Lazy 首跑、SourceSnapshot/`sourceRevision` 增量、检索/按需语义缓存、Full 物理隔离 + Domain 新鲜度 + 消费端统一 revision。本切片（Lazy 计划 §11 切片 E）收口，让 Lazy 模式满足 §13「完成定义」。当前仍有三处未收：

1. **Worktree 重定向与计划 §10 相矛盾**：`skills/excavator/SKILL.md` Phase 0 现在检测到 git worktree 时把 `.excavator/` 输出**重定向到主 checkout**（注释引 issue #133：Claude Code 的 worktree 临时、随 session 销毁丢图）。计划 §10 要求相反——**per-worktree**：图只对应该 worktree 解析出的 SourceSnapshot revision，不重定向、不共享可写缓存、worktree 删除即容忍缓存一起丢。两处默默矛盾。
2. **Selection 未硬化**：scan / source-index 只精确排除 `.excavator/`，不排除其变体备份目录（如 `.excavator.slicec-bak`、`.excavator-*`）与 `.trash-*` 回收目录。切片 C 曾因这些游离目录进入索引导致召回污染（recall 2/6→需人工清理才 6/6）。缺失的排除项在真语料上会静默污染索引与事实层。
3. **§13 完成定义未成套验收**：缺对固定 `go-clean-arch` commit 的首跑/二次 Chat/提交后 Chat/缓存命中的分段耗时记录，与 Git/多仓/directory fixture 的首建+增量成套验证，以及面向用户的 Lazy 模式文档。

本切片做三件收口：**翻转 worktree 为 per-worktree**（删重定向 + 明示「删 worktree 即丢缓存」）；**硬化 selection**（排除 `.excavator*` 备份与 `.trash-*`）；**成套端到端 + 性能记录 + 文档**（真实运行 opt-in、证据不提交）。

## What Changes

- **Worktree per-worktree 隔离**（§10）：删掉 SKILL.md Phase 0 的 worktree 重定向逻辑与 `EXCAVATOR_NO_WORKTREE_REDIRECT` 开关。检测到 worktree 时**不再**改写 `PROJECT_ROOT`，`.excavator/` 就写在该 worktree 内；图只对应该 worktree 的 SourceSnapshot revision，不共享可写缓存。明示「worktree 删除时缓存一起丢」（§10 已声明容忍）。此改动**重新打开 issue #133 的丢数据风险**，是为快照正确性（避免跨分支互相覆盖同一图）做的主动取舍，须在 skill 散文里对用户明说，不得让两处默默矛盾。
- **Selection 硬化**：core 的 `DEFAULT_IGNORE_PATTERNS`（`ignore-filter.ts`）新增排除 `.excavator` 的变体备份目录（`.excavator.*/`、`.excavator-*/`）与 `.trash-*/`，但**不误伤** `.excavatorignore`（文件，仍读）。同步 scan walker 的 hard-skip 子集（`scan-project.mjs` 的 `HARD_SKIP_DIRS` 精确集改为能识别这些前缀）与 `staleness.ts` 的 exclude 列表。source-index 复用同一 selection，不另立第二真相源。配一条唱反调绊线：夹具含 `.excavator.bak/`、`.trash-1234/` 等游离目录，断言它们既不进 scan 事实层也不进 source-index。
- **端到端 + 性能 + 文档**（§13）：合成端到端串起 Lazy 首跑 → Chat 结构 → 按需语义 → Full → Domain 新鲜度 的确定性断言（可单测部分）。**真实运行 opt-in、不提交**：对固定 `go-clean-arch@e06c6d0` 记录首跑 / 二次 Chat / 提交后 Chat / 缓存命中的分段耗时（§12.1 目标总耗时 <60s）；对 Git / 多仓 / directory fixture 分别验证首建 + 增量同步（§12.2）。补面向用户的 Lazy 模式文档（默认 lazy、`--mode`、按需语义、worktree 语义变化、新鲜度）。

**诚实边界**：worktree 翻转、selection 排除、端到端确定性断言都可单测；但 §13 的**真实语料计时与首建/增量成套验证**须真实运行（opt-in、产物/路径/读数不提交），fake 全绿不顶替——按既定分工由用户在统一测试中执行，本切片把它们写成 opt-in 验收项而非我方门禁。

**非目标（本切片明确不做，另立后续 change）**：**遗留增量-Full 路径统一到 Phase F**——切片 D 已把「Full 全量」/`FULL_UPDATE`/无图首建改走 Phase F，但决策表里 `PARTIAL_UPDATE`/`ARCHITECTURE_UPDATE`（已有图 + 改动文件、非 `--full`）仍走旧 Phase 1–7、由 file-analyzer 直接产结构节点。把这条也改走 Phase F 需重做 `prepare-incremental`/`validate-incremental-symbols`/`finalize-incremental`/`mark-dirty` 并触动被锁的 incremental-contract 契约测试，实质更大、回归风险最高，**远超本收尾切片的体量**，故拆为独立 change（`incremental-full-unification`）跟踪。影响：主 Full 路径与全部 Lazy 的「LLM 不改事实图」不变量已成立，仅 `--mode=full` 的增量子情形仍走遗留路径。另外 `excavator-figma`/`excavator-knowledge`（不同域）仍不在范围。

## Capabilities

### New Capabilities
- `worktree-isolation`: worktree 内的 Excavator 使用该 worktree 自身的 `.excavator/`，不重定向到主 checkout；图只对应该 worktree 的 SourceSnapshot revision；不共享可写缓存；worktree 删除即容忍缓存丢失。
- `selection-hardening`: scan 事实层与 source-index 统一排除 `.excavator` 的变体备份目录（`.excavator.*/`、`.excavator-*/`）与 `.trash-*/`，且不误伤 `.excavatorignore`；两条链路复用同一 selection、不设第二真相源。

### Modified Capabilities
（无：新增均为新 capability。切片 A 的 `lazy-analysis`、B 的 `source-snapshot`、C 的 `source-index` 语义不变；本切片是对 worktree 落盘位置与 selection 排除集的新增约束，用新 capability 承载。端到端/性能/文档属验收与散文，不新增 requirement。）

## Impact

- 目标分支：`feat/lazy-mode`（经 `lazy/slice-e` PR 合入）。合入后本切片是 feat → main 之前的最后一个 Lazy 收尾切片；`incremental-full-unification` 作为独立后续 change 单独排期。
- 受影响：`skills/excavator/SKILL.md` Phase 0（删 worktree 重定向段与 `EXCAVATOR_NO_WORKTREE_REDIRECT`）；`packages/core/src/ignore-filter.ts`（`DEFAULT_IGNORE_PATTERNS` 加游离目录排除）、`packages/core/src/staleness.ts`（exclude 列表）、`skills/excavator/scan-project.mjs`（`HARD_SKIP_DIRS` 前缀识别）；`docs/`（新增/更新 Lazy 模式用户文档）。复用 A/B/C/D 的既有机制，不重造。
- 数据产物：无新增产物；改变的是「哪些目录不进 scan/source-index」与「worktree 下 `.excavator/` 落在哪」。
- 测试：worktree 非重定向（检测到 worktree 时 `.excavator/` 落在 worktree 内、不写主 checkout）、selection 排除（游离目录不进 scan 事实层与 source-index、`.excavatorignore` 不被误伤，含唱反调绊线）、合成端到端确定性断言——确定性单测；§13 真实语料计时与首建/增量成套验证走 opt-in 真实运行（不提交）。
