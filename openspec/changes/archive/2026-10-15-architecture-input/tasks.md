执行约束：
- 实现由我做，改动只在提示词与附录；真实模型冒烟交给一个 acceptor（Opus 调度，Sonnet 跑 Full）。
- 验收 oracle 见 design.md「验收 Oracle」，动手前已写死。
- 语言：提示词、附录与测试用英文，OpenSpec 用中文。
- 不改 `packages/` 与 `skills/excavator/*.mjs`。
- 公开仓库：不出现客户、产品或私有语料的名字。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

0. `docs(openspec): archive default-file-patterns`（已完成）。
1. `docs(openspec): propose component-layers`（已提交，被下一步取代）。
2. `docs(openspec): replace component-layers with architecture-input`：本变更的 proposal、design、规格增量与 tasks。
3. `feat(skill): give the architecture analyzer node semantics and page references`：任务 1.1。
4. `docs(skill): infer page-to-method edges from EL chains`：任务 1.2。
5. `fix(skill): ask for addendum role tags and an unabridged architecture dispatch`：任务 1.3。
6. `fix(skill): tell the semantic file analyzer where the skill lives`：任务 1.4。
7. `docs(openspec): record architecture-input acceptance`：任务 2.1–2.2。

## 1. 提示词与附录

- [x] 1.1 `skills/excavator/SKILL.md` Phase F3，按 full-semantic-isolation 规格补输入与说明。验证：O1 的提示词契约测试通过。
  - 完成记录：
    - 新鲜语义复用 F2 已有的 `select-stale-semantics.mjs`，在 F2 提交后重跑，写到单独的文件，取 `plan.reuse[]`，不加新脚本；
    - 节点与边用两条 `jq` 示例拼出，已在夹具副本的真实事实图上跑过；
    - 提示词明说不从 `knowledge-graph.jsonl` 节点取 `summary`/`tags`：Full 下它们是空的；
    - 契约测试在旧 SKILL.md 上红、新的上绿。
- [x] 1.2 `skills/excavator/frameworks/jsf.md` 增加 EL 到方法的规则，并在「Edge Patterns」里与导航、复合组件并列。验证：O1 的附录契约测试与 `check-refs` 通过。
  - 完成记录：
    - 规则放在复合组件之后、按 id 连转换器之前；
    - jsf.md 的推断规则从 3 条变成 4 条，「Exactly one / Zero or several」计数测试随之改为 4；
    - 契约测试在旧 jsf.md 上红、新的上绿，`check-refs` 通过。

- [x] 1.3 按 O2 首次真实运行的归因修提示词（design D4）：F2 派发要求附录角色标签；F3 派发全文注入附录、不附加编排者内容，角色优先于名字、目录与模块。验证：契约测试在旧 SKILL.md 上红、新的上绿。
  - 完成记录：只改 `SKILL.md` 与契约测试；附录与代理定义未改。
- [x] 1.4 F2 派发给出 skill 目录（design D4 第二段）。验证：契约测试在旧 SKILL.md 上红、新的上绿；真实验证并入 P0 第 5 步的测量运行。

## 2. 验收与记录

- [x] 2.1 acceptor 按 O2 在夹具副本上用真实模型跑 Full 到 F3，报告放在 `excavator-test-runs/architecture-input/`，不进仓库。验证：O2 的断言逐条有结论。
- [x] 2.2 在本文件末尾写「验收摘要」：O1–O3 的结果、O2 的花费与输入长度、与需求原文的差异（导航由附录推断）。

## 验收摘要

**O1 提示词契约**：通过。
- F3 输入、三句说明、F2 角色标签与 skill 目录、F3 派发保真、jsf.md 的 EL 规则，各有契约测试；每条都先在旧文件上确认红、新文件上绿。
- 每个代码提交都在分离检出里跑过全量门：core build、core 测试 1417、typecheck、全仓 vitest、`check-refs`、`openspec validate --all --strict`（41 项）。全仓 vitest 依次为 3530 / 3531 / 3533 / 3534 通过、4 跳过。

**O2 真实模型冒烟**（Sonnet，`--full --no-verify`，夹具副本；预注册在第 1 次运行前写定，之后未改）：

| 运行 | 被验收提交 | 花费 | 墙钟 | 结论 |
|---|---|---|---|---|
| 1 | 0c653cfd | $0 | — | 本机 CLI 未登录，首个 API 调用前鉴权失败 |
| 2 | 0c653cfd | $6.32 | 约 20 分 | A1 14/15；编排者读到了同目录的预注册，负向结论作废 |
| 3 | c306f176 | $8.47 | 约 26 分 | A1–A5 全部通过，污染检查干净 |

- 第 2 次的归因与修正见 design D4：四项输入已交给模型，分层不符来自 F2 未要求附录角色标签、编排者带入 Phase 4 的附加上下文并删节附录。
- 第 3 次换到不含预注册与报告、目录名中性的语料目录：
  - **A1**：15 个角色文件全部落在期望层，没有 `layer:test`。
  - **A2 / A3**：页面到方法恰好两条，`list.xhtml` 到 `OrderBean` 的 `getList()` 与 `detail()`，候选集各恰好一个；dataTable 的 `var`、未绑定的标签文件与其他页面都没有出边。
  - **A4**：节点与边与 SKILL.md 的命令逐行相同；244 个节点都带 `tags`，70 个文件节点带 `summary`，72 个带 `owner`；`references` 边带 `chain` 与 `line`；两个附录全文注入。
  - 附录全文注入后，导航推断边 `list.xhtml` 到 `detail.xhtml` 也出现了。
- F3 输入长度：第 2 次约 9.7 万字符，第 3 次约 13.6 万字符，增量主要是全文附录。
- 第 3 次暴露 F2 派发不给 skill 目录（F2 角色标签 7/14），已由任务 1.4 修正；它的真实验证并入 P0 第 5 步的测量运行。
- 70 个文件的夹具上，一次 Full（Sonnet，`--no-verify`）的实测花费 $6.3–8.5、墙钟 20–26 分钟，作为第 5 步测量的第一个数据点。

**O3 事实不变**：通过。第 2、3 次的 Full 产物与零模型 Lazy 的 `factsDigest` 相同，节点、边与缺口逐条相同；语义只写进 `semantic-cache.json`。

**与需求原文的差异**：需求原文期望事实图里有页面到页面的导航边。本变更不新增确定性阶段，导航由 JSF 附录推断，出现在 `semantic-graph.json` 的关系里，不在事实图里。

**已知限制**：
- 夹具里的 EL 链候选集都恰好一个，「零个或多个不连」这一支只间接验证（没有多连）。
- 关系的 `provenance` 由写入器记为 `model`，与附录的 `inferred` 用词不同，含义相同（非事实、无证据）。
- 第 3 次运行的编排者以预算为由跳过了 assemble-reviewer，这次对结果无影响。
- 分析器按文件分层，类节点继承文件的层；一个文件里有多种角色时只能整文件归一层。

