每组：先写失败验收 → 实现 → 验证 → 单独 commit。合成夹具用 purpose-built 项目；真语料（wcp/go-clean-arch）与真实运行验收 opt-in、产物/路径/读数不提交。CODE 与测试用英文，本 openspec 用中文。

## 1. Worktree per-worktree 隔离（删重定向）

- [ ] 1.1 写验收（先红）：在 git worktree 中运行时 `.excavator/` 落在该 worktree 内、主 checkout 不被写入；两个不同 HEAD 的 worktree 各自图对应各自 revision、不互相覆盖。验证：`tests/` 新增 worktree 隔离用例先红（含「检测到 worktree 但未重定向」的正向断言）。
- [ ] 1.2 删 `skills/excavator/SKILL.md` Phase 0 的 worktree 重定向段与 `EXCAVATOR_NO_WORKTREE_REDIRECT` 开关；skill 散文明说 per-worktree 语义 + 「删 worktree 即丢缓存」取舍（§10），不与其它文档矛盾。验证：1.1 全绿；`tests/refs`（skill 引用完整性）绿；`tests/skill` 无回归。

## 2. Selection 硬化（排除游离目录、不误伤 `.excavatorignore`）

- [ ] 2.1 写验收（先红）：夹具含 `.excavator.bak/`、`.excavator-old/`、`.trash-1234/` 游离目录**和**一个正常 `.excavatorignore` 文件；断言游离目录既不进 scan 事实层也不进 source-index，`.excavatorignore` 仍被读取生效（唱反调绊线：未硬化时先证其会污染、能看见红）。验证：`tests/` selection 用例先红。
- [ ] 2.2 实现：core `DEFAULT_IGNORE_PATTERNS`（`ignore-filter.ts`）加 `.excavator.*/`、`.excavator-*/`、`.trash-*/`，不误伤 `.excavatorignore`；`scan-project.mjs` 的 `HARD_SKIP_DIRS` 改为识别这些前缀（保留「hard-skip ⊆ DEFAULT_IGNORE_PATTERNS」单测契约）；`staleness.ts` 的 `:(exclude)` 列表同步；source-index 复用同一 selection、不设第二真相源。验证：2.1 全绿；`tests/facts`、`tests/retrieval` 无回归。

## 3. 端到端 + 文档（确定性部分）

- [ ] 3.1 合成端到端（确定性断言）：一个小项目串起 Lazy 首跑（零 analyzer/verifier/architecture 调用、无 batch/HTML/Tour）→ Chat 结构问答（不触发语义补充）→ 按需语义（写独立产物、第二次复用）→ Full（事实字段 SHA-256 不变、语义在独立产物、factDigest 门）→ Domain 新鲜度（过期不进回答）。验证：端到端套件绿。
- [ ] 3.2 Lazy 模式用户文档（`docs/`）：默认 lazy、`--mode=lazy|full`/`--full`、按需语义、worktree 语义变化（per-worktree + 删即丢缓存）、新鲜度（sourceRevision）。只写用户可见语义，不复制 spec/plan。验证：文档链接/引用检查绿。

## 4. 真实运行 opt-in + 门禁

- [ ] 4.1 opt-in 真实运行（不提交，按既定分工由用户统一测试执行）：对固定 `go-clean-arch@e06c6d0cb37069b0ef56e3df67f80ca130a1ab82` 记录 snapshot/scan/import-map/parse/graph-build/source-index/validate/save 与总耗时（§12.1 目标 <60s，且首跑零 LLM 调用）；对 Git / 多仓 / directory fixture 分别验证首建 + 增量同步（§12.2）。验证：真跑证据（fake 全绿不顶替）——记录数字与样例、不提交。
- [ ] 4.2 门禁：`openspec validate --strict lazy-mode-completion` 通过；`pnpm -r build`、typecheck、`pnpm test` 全绿；不删除/弱化既有测试；A/B/C/D 套件无回归。
