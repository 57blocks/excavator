每组：先写失败验收 → 实现 → 验证 → 单独 commit。合成夹具用 purpose-built 项目；真语料（wcp/go-clean-arch）与真实运行验收 opt-in、产物/路径/读数不提交。CODE 与测试用英文，本 openspec 用中文。

## 1. Worktree per-worktree 隔离（删重定向）

- [x] 1.1 写验收（先红）：在 git worktree 中运行时 `.excavator/` 落在该 worktree 内、主 checkout 不被写入；两个不同 HEAD 的 worktree 各自图对应各自 revision、不互相覆盖。验证：`src/__tests__/worktree-redirect.test.mjs` 重写为断言不重定向（`not.toBe(mainRepo)`），红-于-旧片段/绿-于-新片段已复核。
- [x] 1.2 删 `skills/excavator/SKILL.md` Phase 0 的 worktree 重定向段与 `EXCAVATOR_NO_WORKTREE_REDIRECT` 开关；skill 散文明说 per-worktree 语义 + 「删 worktree 即丢缓存」取舍（§10）；`excavator-domain` SKILL.md 同步。验证：`tests/refs` 绿；全量门无回归（commit 35118288）。

## 2. Selection 硬化（排除游离目录、不误伤 `.excavatorignore`）

- [x] 2.1 写验收（先红）：`tests/skill/excavator/test_selection_hardening.test.mjs` 夹具含 `.excavator.bak/`、`.excavator-old/`、`.trash-1234/` 游离目录**和**一个正常 `.excavatorignore` 文件；断言游离目录既不进 scan 事实层也不进 source-index（git 枚举 + walker 回退两路），`.excavatorignore` 仍被读取生效；红-于-未硬化（游离路径泄漏）已复核。
- [x] 2.2 实现：core `DEFAULT_IGNORE_PATTERNS`（`ignore-filter.ts`）加 `.excavator.*/`、`.excavator-*/`、`.trash-*/`（目录模式，不误伤 `.excavatorignore` 文件）；`scan-project.mjs` 加 `isHardSkipDir` 前缀识别（subset 不变量测试重写为「walker 跳过的都被 core 真实 filter 排除」）；`staleness.ts` 的 `PROJECT_PATHSPEC` 同步（`*` 默认跨 `/` 已独立验证）；source-index 从 scan 派生、无第二真相源。验证：全量门无回归（commit c34986fc）。

## 3. 端到端 + 文档（确定性部分）

- [x] 3.1 合成端到端（确定性断言）：`tests/lazy/lazy-to-full-e2e.test.mjs` 一个合成项目串起 Lazy 首跑（无 batch/HTML/semantic 产物、tour=[]）→ 结构检索（命中事实节点、无语义副作用）→ 按需语义（写 `semantic-cache.json`、事实 SHA-256 不变、`isFresh` 证复用）→ Full（layers 进 `semantic-graph.json` 以 factDigest 为键、事实 SHA-256 仍不变、factDigest 未变 `resolveArchitectureAction`→reuse）→ Domain 新鲜度（一致=usable、mismatch=stale 不用）。深层行为委托各阶段自有套件（注释标明）；核心不变量「事实 SHA-256 从首跑到 Full 后逐字不变」附红-于-破坏证据。验证：端到端套件绿。
- [x] 3.2 Lazy 模式用户文档 `docs/lazy-mode.md`：默认 lazy、`--mode=lazy|full`/`--full` + 优先级、按需语义 vs Full、worktree per-worktree + 删即丢缓存、新鲜度（sourceRevision，git HEAD-only vs directory content-hash）。只写用户可见语义。同步修正 `README.md` 过时的 token 提示（默认首跑快/零 LLM）+ 链到文档。验证：`tests/refs` 绿。（注：README 里链接的 `READMEs/*.md` 本地化变体在本仓不存在，属既有断链，未在本切片范围内处理。）

## 4. 真实运行 opt-in + 门禁

- [x] 4.1 opt-in 真实运行（不提交，按既定分工由用户统一测试执行）：对固定 `go-clean-arch@e06c6d0cb37069b0ef56e3df67f80ca130a1ab82` 记录 snapshot/scan/import-map/parse/graph-build/source-index/validate/save 与总耗时（§12.1 目标 <60s，且首跑零 LLM 调用）；对 Git / 多仓 / directory fixture 分别验证首建 + 增量同步（§12.2）。验证：真跑证据（fake 全绿不顶替）——记录数字与样例、不提交。**已完成；真实源码、产物、路径与读数未提交。**
- [x] 4.2 门禁：`openspec validate --strict lazy-mode-completion` 通过；`pnpm -r build`、typecheck、`pnpm test` 全绿（2026-09-15 我方全量门：BUILD/TYPECHECK/VITEST/OSVALIDATE 均 exit 0；61 文件 1126 passed / 4 skipped）；未删除/弱化既有测试；A/B/C/D 套件无回归。
