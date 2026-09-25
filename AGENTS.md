# Excavator v2 — agent guide

Excavator v2 是在 Understand Anything（上游提交 5feed1f2，MIT，详见 NOTICE 里的原始仓库地址）基础上重建的 AI-first 可辩护代码调查插件。事实由确定性脚本写，散文由宿主 agent 写；每条陈述要么带证据，要么标 inferred。计划以 `openspec/changes/` 下的活跃变更为准；每个开发步是一个 OpenSpec change 加一个 PR。

## 执行纪律
- 无人守：判断题自己拍板并写下理由；不问用户。
- AI-first scope gate：凡能由 skill / prompt 在运行时可靠完成的判断、编排、说明或项目级适配，就不写进产品代码；只有需要确定性复用、机器校验、安全或权限边界、持久化契约，或无法由 agent 在可接受成本内稳定完成的能力才落代码。动手前必须先说明为什么 skill / prompt 不足；没有充分理由则优先改 skill / prompt。
- 一 coder 一 acceptor；编码/机械活 Sonnet，判断/审计/验收 Opus；验收 oracle 在动手前写死。
- 分阶段 commit：一个逻辑步一个 commit；PR 用 merge commit 合并，保留每个 commit 以便按步 revert。
- 先验装置再用装置：任何验证器/评分器先用已知假样本证明它看得见。
- 没有第四态：每个输入落一个可见桶；某语言/种类零记录必须出现在 coverage/gaps 里。
- 身份夹具：同内容不同路径、同名不同 owner。
- 零编造是硬指标，覆盖是软指标；汇报时「编造 vs 遗漏」分开算。
- 零兼容：不保留 UA 旧目录/旧名的兼容分支；不沿用旧 excavator 的契约。数据目录唯一：`.excavator/`。
- 钉死上游 5feed1f2；不同步上游、不提上游 PR；NOTICE 常在。
- 默认真实验收语料为 wcp 与 cebreo；四个 Lazy 检索强化 change 例外使用 `test-repo/conduit-realworld-example-app` 的固定提交 `5e127d8569b300e0a21dc2c20ea680da4967b1aa`。真实项目的源码、路径、输出不提交。

## 工具链
Node ≥ 22，pnpm（版本按 `package.json` 的 `packageManager`），vitest。三件套：`pnpm install --frozen-lockfile && pnpm -r build && pnpm test`。

## 验证：按改动内容选检查
验证的是内容，不是动作。测过的内容没变就不重跑，提交、开 PR、合并、归档本身都不触发重跑；内容变了，只跑与改动相关的检查。

| 改动范围 | 要跑的检查 |
|---|---|
| 只动 `openspec/`（提案、spec 同步、归档） | `openspec validate --all --strict`。没有测试读 `openspec/`，不跑代码测试 |
| `docs/` 下的散文 | 不跑。例外：`docs/benchmarks/` 的 schema 被测试读取，改它跑 `pnpm test` |
| 根目录 Markdown（`AGENTS.md`、`README.md`、`CLAUDE.md`） | `pnpm vitest run tests/refs/legacy-literals.test.mjs`（旧名字门禁扫描 `docs/`、`openspec/` 以外的所有跟踪文件） |
| `skills/**/SKILL.md`、`agents/`、`hooks/`、插件清单 | `node scripts/check-refs.mjs` + `pnpm test`（多个测试读这些文件） |
| `skills/**/*.mjs`、`src/`、`tests/` | 三件套 |
| `packages/core/` | 三件套 + `pnpm --filter @excavator/core test` + `pnpm run typecheck`。根目录的 `pnpm test` 不含 core 测试 |

内容没改也要重跑的三种情况：
- 提交生成了没测过的内容：拆分 commit 时重建的中间版本，要逐个在临时检出里跑对应检查。原样提交已测过的工作区则不重跑。
- 合并前 `main` 已前进：合并结果是新内容，先合入最新 `main` 再跑。`main` 没动就直接合并。
- 有未跟踪的新文件：`tests/refs/legacy-literals` 等门禁按 `git ls-files` 取文件，未跟踪文件会被跳过、造成假绿。先 `git add -N <文件>` 再跑门（跑完 `git reset -- <文件>` 还原），或提交后再跑。
