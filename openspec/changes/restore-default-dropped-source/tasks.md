提交序列（每步一个 commit，PR 用 `--merge` 合入）：
1. `docs(openspec)`：本变更的 proposal、design、spec、tasks。
2. `docs(skill)`：SKILL.md 第 0 阶段 6.4 的改动。
3. `test(skill)`：契约测试。
4. `docs(openspec)`：验收记录（勾选任务、写入 O1–O4 结果）。

## 1. Skill 散文

- [x] 1.1 在 `skills/excavator/SKILL.md` 6.4 第 3 步加找回候选：在基线扫描的 `selection.entries` 里看被默认规则排除、原因是默认规则（`filtered-by-defaults`、`default-pattern`）的条目，读文件开头的包声明，按 D2 的依据提议只取反源码包目录的规则。写明名字、扩展名、手写的样子都不算依据。验证：O1。
- [x] 1.2 在第 5 步加审查找回路径：逐条审查改后新被选中的路径；找回的文件不全属于提议的源码包时，放弃该规则；不改变选择结果的取反规则也放弃。验证：O1。
- [x] 1.3 在第 8 步的报告要求里加上找回的路径与包声明证据。验证：O1。

## 2. 测试

- [x] 2.1 新增 `tests/skill/excavator/test_restore_default_dropped_source.test.mjs`：按段落断言 1.1–1.3 的文字。把 SKILL.md 恢复成旧文本后，测试全部变红（记录在验收里）。验证：测试通过，变异变红。

## 3. 验收

- [x] 3.1 O2：TomEE examples 副本上，两条取反规则正好找回 3 个文件，不丢任何文件；对照组不变（提案前已测，验收时复跑一次）。
- [x] 3.2 O3：真实模型两次运行（Sonnet，`--max-budget-usd 3`，顺序进行）：TomEE examples 副本找回正好 3 个文件并通过复核；koel 副本不提议任何取反规则。记录花费。
- [x] 3.3 O4：`node scripts/check-refs.mjs`、`pnpm exec vitest run --maxWorkers=4` 通过；`openspec validate --all --strict` 通过。
- [x] 3.4 PR 前用仓库外的名单查 diff、commit 信息与 PR 正文，不出现私有语料名。

## 验收记录（2026-10-16）

| Oracle | 结果 | 依据 |
|---|---|---|
| O1 契约测试 | 通过 | 4 条测试按第 3、5、8 步段落断言；SKILL.md 恢复成旧文本后 4 条全红，恢复后全绿 |
| O2 机制 | 通过 | TomEE examples 副本：两条取反规则找回 `webservice-holder/src/{main,test}/java/org/superbiz/ws/out/` 下 3 个 Java 文件，没有丢文件；取反一个不存在的目录，选择结果不变 |
| O3 真实模型 | 通过（方式有偏离，见下） | TomEE examples 副本：只提议上述两条取反规则，正好找回 3 个文件；写入根文件后复核结果与比较结果相同。koel 副本：不提议任何取反规则 |
| O4 不回归 | 通过 | `check-refs` 通过；vitest 139 个文件，3604 通过、4 跳过；`openspec validate --all --strict` 43 项通过 |

O3 的偏离：
- 原定用插件跑 headless `claude -p`（Sonnet，`--max-budget-usd 3`）。第一次运行在开始时就因 OAuth 会话过期失败，结果事件记花费 0，没有做任何事。
- 改由会话内的 Sonnet 子代理扮演宿主，只执行 6.4 的第 1–8 步。提示里给出路径与参数，不提预期结果。两次运行顺序进行。
- 子代理不报美元花费，只报 token：TomEE 104,772，koel 109,878。按单价换算的数字不写。

两次运行的结果都由主会话独立复核：读子代理留下的 `before.json`、`after.json`、`verified.json`，比较选中集合，并读写入的根规则文件。
- TomEE examples：
  - 选中集合 2071 → 2074，新增正是那 3 个文件；
  - 根文件只有两条取反规则，带包声明证据的注释。
- koel：
  - 根文件里没有取反规则；
  - 子代理按预检原有的方向提议了两条排除规则（Vitest 快照目录、构建产出的 `public/sw.js`），共少选 74 个文件，复核一致。这部分与本变更无关。
- 语料目录本身没有改动。

已知限制：
- 找回只在预检运行时发生：没有根规则文件、有旧版规则文件、或用户要求复查。
- 插件路径的 headless 运行没有做成，模型在完整编排上下文里的表现没有验证。
