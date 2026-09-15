## Context

见 proposal.md「Why」。切片 A–D 已落确定性事实层、快照/增量、检索/按需语义、Full 物理隔离 + Domain 新鲜度 + 消费端统一 revision。本切片收口计划 §11 切片 E 列出的三项（worktree 翻转、selection 硬化、§13 端到端 + 性能 + 文档），使 Lazy 模式满足 §13 完成定义。切片 D design 已知边界里的「遗留增量-Full 路径」明确拆出，不在本切片。

约束：确定性脚本零模型；缺失可见；事实层 `knowledge-graph.json` 只由确定性投影写；测试用合成夹具，真语料/真运行 opt-in 且证据不提交。

## Goals / Non-Goals

**Goals:** worktree 翻转为 per-worktree（删重定向、图对应该 worktree revision、明示丢缓存容忍）；scan 与 source-index 统一硬化 selection（排除 `.excavator` 变体备份与 `.trash-*`、不误伤 `.excavatorignore`）；成套端到端确定性断言 + §13 真实计时/首建增量 opt-in 验收 + Lazy 用户文档。

**Non-Goals（设计层边界）:** 不做遗留增量-Full（`PARTIAL_UPDATE`/`ARCHITECTURE_UPDATE`）到 Phase F 的统一（另立 `incremental-full-unification`）；不动 figma/knowledge；不重造 A/B/C/D。

## Decisions

### D1. Worktree 翻转为 per-worktree，删重定向（**请重点评审**）
删掉 `skills/excavator/SKILL.md` Phase 0 的 worktree 重定向段：检测到 `git rev-parse --git-dir` 与 `--git-common-dir` 不一致（即 worktree）时，**不再**把 `PROJECT_ROOT` 改写到主 checkout，`.excavator/` 就落在该 worktree 内。同时删掉 `EXCAVATOR_NO_WORKTREE_REDIRECT` 开关（其存在本身预设「默认重定向」，翻转后无意义）。skill 散文须**明说**：worktree 图只对应该 worktree 的 SourceSnapshot revision，避免跨分支互相覆盖同一图；代价是「worktree 删除时缓存一起丢」（§10 已声明容忍），即重新打开 issue #133 的丢数据风险——这是为快照正确性做的主动取舍，不得默默矛盾。
- 备选：保留重定向、另加 revision 命名空间隔离 → 否决：主 checkout 图被多个 worktree 的不同 revision 交替覆盖，正是 §10 要消除的问题；且与「图只对应一个 SourceSnapshot revision」的事实层不变量冲突。

### D2. Selection 硬化：单一真相源在 core，walker 子集与 staleness 同步（**请重点评审**）
真相源是 core 的 `DEFAULT_IGNORE_PATTERNS`（`ignore-filter.ts`）——source-index 与 scan 事实层都经它，硬化在此一处即两条链路同时生效。新增排除：`.excavator.*/`、`.excavator-*/`（`.excavator` 的变体备份目录，如 `.excavator.slicec-bak`）与 `.trash-*/`（回收目录）。**必须不误伤** `.excavatorignore`——它是文件、无末尾 `/`，用「目录模式（末尾 `/`）+ 变体前缀」表达以避免匹配到该文件。`scan-project.mjs` 的 `HARD_SKIP_DIRS` 是「walker-only 性能子集」（精确名集合），改为对这些前缀做识别（不是精确名），并保持其注释契约「每个 hard-skip 都能被 DEFAULT_IGNORE_PATTERNS 覆盖」的单测。`staleness.ts` 的 `:(exclude)` 列表同步加对应 pathspec。source-index 复用同一 selection，**不另立第二真相源**。
- 备选：只在 source-index 侧过滤 → 否决：事实层 scan 仍会摄入游离目录（切片 C 的污染既伤索引也伤事实），且违反「单一真相源」。

### D3. 唱反调绊线优先（**装置先验**）
按记忆「先验装置再用装置」「解析器不许有第四态」：selection 测试的夹具必须含真实的游离目录（`.excavator.bak/`、`.excavator-old/`、`.trash-1234/`）**和**一个正常的 `.excavatorignore` 文件；断言前者既不进 scan 输出也不进 source-index、后者不被误伤（仍作为 ignore 源读取）。先制造「未硬化时会污染」的已知差异确认测试看得见红，再实现硬化令其转绿——不是只断言计数。

### D4. §13 验收分两层：确定性可单测 vs 真实运行 opt-in（**诚实验收**）
端到端里可确定性断言的部分（Lazy 首跑零 analyzer/verifier/architecture 调用、Lazy 不出 batch/HTML/Tour、结构问答不触发语义补充、按需语义写入独立产物且第二次复用、Full 后事实字段 SHA-256 不变、Domain 过期不进回答）走合成端到端单测。**真实运行部分**（§12.1 对 `go-clean-arch@e06c6d0` 的分段耗时与 <60s 目标、§12.2 Git/多仓/directory fixture 的首建+增量成套验证）须真实跑、证据不提交——按既定分工由用户在统一测试中执行，本切片写成 opt-in 验收项（记录到 tasks，fake 全绿不顶替），不作我方门禁。

## Risks / Trade-offs

- **worktree 翻转重开 #133 丢数据风险**（最大风险）→ 这是 §10 的显式取舍（快照正确性 > 缓存复用）；缓解是 skill 散文对用户明说「worktree 删除即丢缓存」，并让图严格对应该 worktree revision。
- **selection 模式误伤 `.excavatorignore`** → 用目录模式（末尾 `/`）+ 变体前缀表达，配唱反调绊线断言 `.excavatorignore` 仍被读；walker 子集用前缀识别而非精确名，避免与 core 真相源漂移（保留「hard-skip ⊆ DEFAULT_IGNORE_PATTERNS」单测）。
- **真实计时不进 CI**（§13 完成定义靠真实运行闭合）→ 与切片 D 5.2 同构：opt-in、不提交、由用户统一测试闭合；本切片交付确定性部分 + 把真实项写成可执行的 opt-in 验收清单。
- **文档漂移** → Lazy 用户文档只写用户可见语义（默认 lazy、`--mode`、按需语义、worktree 语义变化、新鲜度），不复制 spec/plan，避免第二真相源。

## Migration Plan

- Worktree：已有「重定向到主 checkout」布局的用户，翻转后新分析落在 worktree 内；主 checkout 里此前由 worktree 重定向写入的旧图不动（不迁移、不删除），用户按需重跑。skill 散文提示行为变化。
- Selection：硬化仅影响「哪些目录被排除」；已有索引/事实层在下次重建时自然剔除游离目录，无需数据迁移。
- 回滚：worktree 翻转与 selection 排除都是小改，出问题可回退本切片 commit，worktree 退回重定向行为（但 §10 的跨分支覆盖问题随之回来）。

## Open Questions

- 无阻断性未决项。§13 真实计时与首建/增量成套验证的执行归属，按既定分工归用户统一测试；遗留增量-Full 统一明确拆出为独立 change。
