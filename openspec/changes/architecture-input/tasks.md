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
5. `docs(openspec): record architecture-input acceptance`：任务 2.1–2.2。

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

## 2. 验收与记录

- [ ] 2.1 acceptor 按 O2 在夹具副本上用真实模型跑 Full 到 F3，报告放在 `excavator-test-runs/architecture-input/`，不进仓库。验证：O2 的断言逐条有结论。
- [ ] 2.2 在本文件末尾写「验收摘要」：O1–O3 的结果、O2 的花费与输入长度、与客户原文的差异（导航由附录推断）。
