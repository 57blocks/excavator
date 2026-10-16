提交序列（每步一个 commit，PR 用 `--merge` 合入）：
1. `docs(openspec)`：本变更的 proposal、design、spec、tasks。
2. `docs(skill)`：SKILL.md 第 0 阶段 6.4 的改动。
3. `test(skill)`：契约测试。
4. `docs(openspec)`：验收记录（勾选任务、写入 O1–O4 结果）。

## 1. Skill 散文

- [ ] 1.1 在 `skills/excavator/SKILL.md` 6.4 第 3 步加找回候选：在基线扫描的 `selection.entries` 里看被默认规则排除、原因是默认规则（`filtered-by-defaults`、`default-pattern`）的条目，读文件开头的包声明，按 D2 的依据提议只取反源码包目录的规则。写明名字、扩展名、手写的样子都不算依据。验证：O1。
- [ ] 1.2 在第 5 步加审查找回路径：逐条审查改后新被选中的路径；找回的文件不全属于提议的源码包时，放弃该规则；不改变选择结果的取反规则也放弃。验证：O1。
- [ ] 1.3 在第 8 步的报告要求里加上找回的路径与包声明证据。验证：O1。

## 2. 测试

- [ ] 2.1 新增 `tests/skill/excavator/test_restore_default_dropped_source.test.mjs`：按段落断言 1.1–1.3 的文字。把 SKILL.md 恢复成旧文本后，测试全部变红（记录在验收里）。验证：测试通过，变异变红。

## 3. 验收

- [ ] 3.1 O2：TomEE examples 副本上，两条取反规则正好找回 3 个文件，不丢任何文件；对照组不变（提案前已测，验收时复跑一次）。
- [ ] 3.2 O3：真实模型两次运行（Sonnet，`--max-budget-usd 3`，顺序进行）：TomEE examples 副本找回正好 3 个文件并通过复核；koel 副本不提议任何取反规则。记录花费。
- [ ] 3.3 O4：`node scripts/check-refs.mjs`、`pnpm exec vitest run --maxWorkers=4` 通过；`openspec validate --all --strict` 通过。
- [ ] 3.4 PR 前用仓库外的名单查 diff、commit 信息与 PR 正文，不出现私有语料名。
