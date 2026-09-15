## Context

见 proposal.md「Why」。切片 A–C 已落：确定性事实构建（`build-fact-graph`/`lazy-analyze`）、SourceSnapshot + `source-manifest`（`sourceRevision`/`factDigest`）、`semantic-cache.json`（按需节点语义）、`source-index`/检索。Full 目前仍是旧的 7 阶段「LLM 造图」流水线（Phase 2 file-analyzer 写节点、Phase 4 architecture 写 layers、`annotate-graph`/`publish-annotations` 合并进 `knowledge-graph.json`）。各消费 skill 与 hook 各自用 gitCommitHash/sourceDigest 判新鲜度。

约束：确定性脚本零模型；缺失可见；事实层 `knowledge-graph.json` 的事实字段只由确定性投影写。

## Goals / Non-Goals

**Goals:** Full 与 Lazy 共用事实构建、事实一致；语义物理隔离、LLM 永不改 canonical graph；Full 增量（只补缺失/过期，factDigest 未变不重跑架构）；Domain 带新鲜度键；消费端统一 sourceRevision。

**Non-Goals（设计层边界）:** 不动 figma/knowledge skill；不做 selection 硬化 / worktree 重定向删除 / 最终端到端与文档（切片 E）；不重造 A/B/C。

## Decisions

### D1. Full = 复用事实构建 + 独立语义生成阶段（**核心重构，请重点评审**）
`--mode=full`：先跑与 Lazy 完全相同的 `scan → structure-all → build-fact-graph` 写出确定性 `knowledge-graph.json`（事实字段权威、只此一处写）；再进「语义生成」阶段，只写 `semantic-cache.json`（节点 summary/tags）与新增 `semantic-graph.json`（layers/架构）。**删掉「LLM 造结构图」**：file-analyzer 不再产结构节点，改为对事实节点产局部语义补丁；architecture/assemble 只产 layers/架构进 `semantic-graph.json`。`annotate-graph`/`publish-annotations`/`apply-verification` 的写入目标从「合并进 knowledge-graph.json」改为「写独立语义产物」，绝不碰事实字段。
- 备选：保留旧 Full 造图、事后 diff 对齐 → 否决：模型改身份/结构的老问题回来，且与 Lazy 事实层不共用。

### D2. `semantic-graph.json` 新产物，以 factDigest 为新鲜度键
`semantic-graph.json` 存架构 layers（每 layer 引用一组事实 node id，经 `node-identity` 保证与事实图一致）与跨节点语义关系（标 provenance/证据，回源可核）。顶层记 `factDigest`：事实未变（factDigest 相同）→ 复用、不重跑 Architecture。它是 overlay，MUST NOT 复制或改写事实节点/边。

### D3. Full 只补缺失/过期语义，节点级失效复用切片 C 的 hash 机制
按 `semantic-cache` 的 `semanticSourceHash` 判每个节点语义是否缺失/过期；`compute-batches` 只为这些文件出批。architecture 的粒度是整图 → 用 factDigest 门。Summary-Verifier 核验 semantic-cache + semantic-graph，写回核验状态，不进 Lazy。

### D4. Domain 新鲜度（§7.5）
`annotate-domain` 在 `domain-graph.json` 顶层写 `sourceRevision` + `factDigest`。消费端读 Domain 前比对当前事实层；不一致则不用（按需提示重跑）。domain/flow/step 仍是提示，回源核对。

### D5. 消费端统一新鲜度助手（**请重点评审**）
新增一个共享的确定性新鲜度助手（`.mjs`）：给定 projectRoot → `resolveSourceSnapshot` 得当前 `sourceRevision`，读 `source-manifest.json` 的持久化 `sourceRevision`，返回 `fresh | stale | missing` + 差异摘要。chat/diff/explain/onboard/domain 的 SKILL.md 与自动更新 hook 全部改用它，删掉各自的 gitCommitHash/sourceDigest 判定。读源统一经 SourceSnapshot（git→GitCommitSnapshot 无工作区泄漏；directory→DirectorySnapshot + content-hash guard）。助手是确定性、可单测；skill 侧是散文改造。

### D6. 诚实验收：机制可测 ≠ Full 语义可用
物理隔离（Full 后事实字段 SHA-256 不变、语义在独立文件）、factDigest 跳过架构、Domain 过期不用、消费端 revision 判定、git 无泄漏、directory guard——都用合成夹具 + 注入假 provider 单测。但 **Full 生成的 summary/layers 内容质量**（可靠、零编造、layers 合理）要真 provider 在 wcp 上 opt-in 验收，写进 tasks，不用 fake 全绿顶替。

## Risks / Trade-offs

- **Full 流水线大改，可能回归**（最大风险）→ 复用已证明的 Lazy 事实构建；语义写入重定向到独立产物；用「Full 后事实字段逐字不变」+「Full 与 Lazy factDigest 一致」作硬断言；分组小步、每步全量门。
- **semantic-graph 的 layer 引用悬空**（node id 对不上事实图）→ layers 的 nodeIds 经 `node-identity` 生成/校验；悬空引用记 semantic gap，不静默。
- **Full 仍慢**（逐文件 LLM）→ 这是 Full 的显式重路径，本切片的收益是复用 + 增量（只补缺失/过期、factDigest 门），不是让 Full 变快。
- **消费 skill 是散文，迁移易漂**→ 收敛到一个共享新鲜度助手 + 统一 SourceSnapshot 读源，减少各 skill 各写一套。
- **存量旧 Full 图**（结构+语义混写）→ 迁移时按 D1 全量重建事实层、把可复用语义搬进独立产物；见 Migration。

## Migration Plan

- 首次以新 Full 运行旧布局项目：删「LLM 造图」路径，跑确定性事实构建覆盖 `knowledge-graph.json` 事实字段；已有 summary/tags 若能按 node id 对上则搬进 `semantic-cache.json`，对不上的记 semantic gap；layers 搬进 `semantic-graph.json`（带 factDigest）。
- 消费端迁移后仍兼容「只有事实层、无语义产物」的 Lazy 项目（语义缺失就诚实降级，切片 C 行为）。
- 回滚：本切片以新增产物 + 重定向写入为主；出问题可回退本切片 commit，Full 退回旧行为（但旧行为的「模型改图」问题随之回来）。

## Open Questions

- 无阻断性未决项。Full 语义内容质量以真语料 opt-in 验收为准；figma/knowledge 迁移与 selection 硬化明确留切片 E，不外溢。
