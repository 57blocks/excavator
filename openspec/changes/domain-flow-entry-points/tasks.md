提交序列见 proposal。先写红测试，看它失败，再实现。

## 1. 入口点 id 与组

- [x] 1.1 红测试（`tests/domain/extract-domain-context.test.mjs`）：id 形状；同方法同路径在两个模块时带模块后缀；同模块再撞时带序号；同一处理者节点的两个入口点同组、组首为排序第一者；没有处理者键的自成一组；两次抽取逐字节相同。
- [x] 1.2 改 `extract-domain-context.py`；`split-domain-areas.mjs` 清单加 `entryPointsOutsideModules`。
  - **验证：** 1.1 绿；`tests/domain/split-domain-areas.test.mjs` 绿。

## 2. 引用核对与派生 id

- [x] 2.1 红测试（`tests/domain/entry-point-anchoring.test.mjs`）：四种 `problem`；名字不同引用同组得同一 id；引用顺序不影响；起始模块取组的文件；守恒经改名表成立；`--accept-unchosen` 的清洗与计数；`check` 的 `uncovered-entry-point` 行不改退出码。
- [x] 2.2 改 `merge-domain-areas.mjs`。
  - **验证：** 2.1 绿；`tests/domain/merge-domain-areas.test.mjs`、`choice-check.test.mjs` 绿。

## 3. 入口点覆盖桶与模块分桶

- [x] 3.1 红测试：五个桶各一例、桶之和等于总数、同组覆盖、模块声明跳过（有/无候选）。
- [x] 3.2 改 `computeCoverage` 与输出行。
  - **验证：** 3.1 绿；端到端夹具测试（`large-fixture`、`mixed-fixture`）绿。

## 4. 分析器与 skill

- [x] 4.1 红测试（`tests/domain/domain-skill-contract.test.mjs`；语言审计不审 `entryPointIds`）。
- [x] 4.2 改 `agents/excavator-domain-analyzer.md`、`skills/excavator-domain/SKILL.md`、`skills/excavator/semantic-language-audit.mjs`。
  - **验证：** 4.1 绿；`node scripts/check-refs.mjs`；读这些文件的既有测试绿。

## 5. 真实语料验收

在真实多仓库语料（mixed-suite）的副本上，用本分支提交的分离检出作插件，复用已有规划与知识图，`claude -p --model sonnet` 跑两次 `/excavator-domain`，每次上限 $25。

验收 oracle（运行前写定，不事后挪）：
- **O1** 有锚流程的 id Jaccard（两次运行有锚流程 id 集合）≥ 0.80。
- **O2** 每个事实入口点在两次运行中落同一个桶的比例 ≥ 0.90。
- **O3** 每次运行 `silent` ≤ 事实入口点总数的 2%，逐条列出。
- **O4** 两次都守恒通过、入口点桶之和等于总数；`--accept-unchosen` 次数与 `citationsDropped` 照实报告。
- 只报告、不设阈值：全部流程的 id Jaccard（基线 0.31）、每域流程数的最大相对差（基线 54%）、模块换桶数（基线 81/293，其中 60 在 `no-candidates` 与 `declared-skip` 之间）、花费。

- [ ] 5.1 两次运行与度量；结果（只用代号）写在这里。

## 6. 收尾

- [ ] 6.1 `openspec validate --all --strict`；`tests/domain/` 与读 skill/agent 文件的测试；PR 写明跑了什么。
