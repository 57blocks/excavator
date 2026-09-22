本变更零产品代码：新增 `skills/excavator-prd/SKILL.md` 散文编排，复用现有 MCP 图工具与 `skills/excavator/consumer-freshness.mjs`。校验以 `check-refs` 门、install 测试与 `openspec validate --strict` 为准。

## 1. Skill 编排与边界

- [x] 1.1 新增 `skills/excavator-prd/SKILL.md`：As-Is 纪律、完整流程清单（graph + off-graph + 端到端缝合）、按角色大纲、无代码正文 + 枚举翻译、证据折叠、表格/mermaid、Phase 4 三项自检；缺图回退 source-only。
- [x] 1.2 确认 `name: excavator-prd` 与目录名一致、引用的 `.mjs`（consumer-freshness）可解析，满足 `check-refs`。

## 2. 文档与测试对齐

- [x] 2.1 README 增加 `/excavator-prd` 用法示例。
- [x] 2.2 `tests/install/install.test.mjs` 增加 `toContain('excavator-prd')` 断言。

## 3. 门禁与合入

- [x] 3.1 `node scripts/check-refs.mjs` 通过。
- [x] 3.2 `pnpm -r build && pnpm test` 全绿。
- [x] 3.3 `openspec validate excavator-prd-skill --strict` 通过；分阶段提交（plan 一提交、实现一提交），PR 以 merge commit 合入 main，保留每个 commit。
