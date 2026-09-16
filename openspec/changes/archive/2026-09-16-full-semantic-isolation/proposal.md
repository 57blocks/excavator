## Why

切片 A–C 之后：Lazy 首跑只出确定性事实、chat 按需补语义并缓存到独立的 `semantic-cache.json`，事实层 `knowledge-graph.json` 只读不改。但 **Full 模式（`/excavator --mode=full`）仍是旧的「让 LLM 重新创造整张图」流水线**——它把结构与语义混写进同一张 graph，与 Lazy 的确定性事实层不共用、也会让模型改动 canonical 身份/结构边。而 Domain 产物与各消费 skill（diff/explain/onboard/domain + 自动更新 hook）仍各自用临时的 gitCommitHash/sourceDigest 判新鲜度，未统一到切片 B 的 `sourceRevision`。本切片（Lazy 计划的切片 D）做三件收口：让 Full **复用同一确定性事实构建**、把语义产物**物理隔离**；给 Domain 加**新鲜度键**；把所有消费端**统一到 sourceRevision**。这样 Full 与 Lazy 得到一致的事实投影、模型永不改 canonical graph、消费端对同一 revision 有一致视图。

## What Changes

- **Full 复用事实构建 + 物理隔离**（§9/§4.4）：`--mode=full` 先跑与 Lazy **完全相同**的 `scan → structure-all → build-fact-graph`（不再让 LLM 重造结构图），再生成语义写入**独立产物**：节点局部 summary/tags 进 `semantic-cache.json`（复用切片 C），架构/layers 进新增 `semantic-graph.json`。LLM MUST NOT 修改 `knowledge-graph.json` 的 canonical 节点身份、源码范围、确定性结构边、coverage、gaps（这些事实字段 SHA-256 不因 Full 语义写入而变）。Full 只处理**语义缺失或过期**的文件（按 source hash）；`semantic-graph.json` 以 `factDigest` 为新鲜度键——factDigest 未变则**不重跑 Architecture**。Summary-Verifier 保留在 Full（核验语义产物），不进 Lazy 关键路径。无法映射到事实节点的模型输出记为 **semantic gap**，不建假锚点。Full 不以逐字保留旧图 module/concept 节点数为目标，但必须保住核心 file/function/class 的 summary/tags/layers 能力。
- **Domain 新鲜度**（§7.5）：`domain-graph.json`（由显式 Domain 分析产出）记录 `sourceRevision` + `factDigest`；Chat/消费端只读与当前事实层一致的 Domain；revision/factDigest 不一致的**过期 Domain 不进回答**。domain/flow/step 仍是语义提示，回答业务流程时用 fact graph + 源码核对。
- **消费端统一 sourceRevision**（§12.6）：chat / diff / explain / onboard / domain skill 与自动更新 hook 全部用 `source-manifest.json` 的 `sourceRevision` 判新鲜度，不再各用临时 gitCommitHash/sourceDigest。Git 消费端经 GitCommitSnapshot 读源（不泄漏工作区改动）；Directory 消费端经 DirectorySnapshot + content-hash guard。

**诚实边界**：物理隔离 / factDigest 新鲜度 / 消费端 revision 判定都是确定性、可单测；但 Full 生成的**语义内容质量**（summary/layers 是否可靠、零编造）需真 provider 在真语料（wcp）上 opt-in 验收，fake 全绿不顶替。

**非目标（本切片明确不做）**：`excavator-figma` / `excavator-knowledge`（Figma API / LLM-wiki，不同域，非事实图消费端）；source-index/scan 的 selection 硬化（`.excavator*`/`.trash-*` glob）、worktree 重定向删除、最终端到端与文档（切片 E）。不重造事实层（A/B）与检索/缓存（C），一律复用。

## Capabilities

### New Capabilities
- `full-semantic-isolation`: Full 复用确定性事实构建；语义写入独立 `semantic-graph.json`（layers/架构）与 `semantic-cache.json`（summary）；LLM 不改 canonical graph；只处理缺失/过期文件；`semantic-graph.json` 以 factDigest 为新鲜度键；无法映射的模型输出记 semantic gap；Summary-Verifier 留在 Full。
- `domain-freshness`: `domain-graph.json` 记 sourceRevision + factDigest；只读与当前事实层一致的 Domain；过期 Domain 不进回答。
- `consumer-freshness`: chat/diff/explain/onboard/domain + 自动更新 hook 统一用 sourceRevision 判新鲜度；Git 走 GitCommitSnapshot（无工作区泄漏），Directory 走 DirectorySnapshot + content-hash guard。

### Modified Capabilities
（无：新增均为新 capability。切片 A 的 `lazy-analysis`（analysisMode/`--mode`）语义不变——full 分支从「旧整链路重造图」改为「复用事实构建 + 物理隔离」是对 full 路径的**新增行为约束**，用新 capability 承载，不改既有 requirement；`fact-graph`/`source-snapshot`/`semantic-cache` 不动。）

## Impact

- 目标分支：`feat/lazy-mode`（经 `lazy/slice-d` PR 合入）。
- 受影响：`skills/excavator/SKILL.md` full 分支（Phase 2/2.3/2.5/3/4/6/7 改为复用事实构建 + 写独立语义产物）；`annotate-graph.mjs`/`publish-annotations.mjs`/`apply-verification.mjs`（语义合并改为只写 `semantic-graph.json`/`semantic-cache.json`，不碰 fact 字段）；`excavator-architecture-analyzer`/`-assemble-reviewer`/`-summary-verifier`/`-file-analyzer` agent 的产出去向；`excavator-domain` + `annotate-domain` + `domain-graph.json`；消费 skill `excavator-diff`/`-explain`/`-onboard`/`-domain` SKILL.md + `hooks/` 自动更新 hook。复用 A/B/C 的 `build-fact-graph`/`source-snapshot`/`source-manifest`/`semantic-cache`/`node-identity`。
- 数据产物：新增 `semantic-graph.json`（factDigest 键）；`domain-graph.json` 加 sourceRevision+factDigest；`knowledge-graph.json` 事实字段不被语义写入触碰。
- 测试：物理隔离（Full 后 fact 字段 SHA-256 不变、语义在独立文件）、factDigest 跳过 Architecture、Domain 过期不用、消费端 sourceRevision 判定、git 无工作区泄漏、directory content-hash guard——确定性单测；Full 语义内容质量走真 provider + wcp opt-in。
