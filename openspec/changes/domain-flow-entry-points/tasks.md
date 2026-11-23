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

- [x] 5.1 两次运行与度量；结果（只用代号）写在这里。

  运行（插件为 6da3f05d 的分离检出，mixed-suite 两份副本，复用规划，45 个区，843 个事实入口点、803 组）：
  - 第一次启动两次都撞上订阅用量上限退出（run 1 花 $3.11、写出 10/45 区；run 2 花 $0），作废，花费计入总数。重跑：run 1 $11.37（53 回合、46 次派发、6 分钟），run 2 $11.13（78 回合、70 次派发、6 分钟）。合计 $25.61。
  - 两次都 45/45 区第一次合并即接受，未用 `--accept-unchosen`，`citationsDropped` 都是 0。

  | oracle | 阈值 | run 1 / run 2 | 结论 |
  |---|---|---|---|
  | O1 有锚流程 id Jaccard | ≥ 0.80 | 0.986（701 / 699，共同 695） | 达标 |
  | O2 入口点同桶比例 | ≥ 0.90 | 0.985（830/843；6 个 in-flow→declared-skip，7 个反向） | 达标 |
  | O3 silent | ≤ 16 | 0 / 0 | 达标 |
  | O4 守恒、桶之和 | 通过、= 843 | 都通过；in-flow 738/739，declared-skip 105/104 | 达标 |

  只报告（基线 → 本次）：全部流程 id Jaccard 0.31 → 0.877（798 / 794 条）；首步文件 Jaccard 0.56 → 0.796；`entryPoint` 字符串 Jaccard 0.46 → 0.81；每域流程数最大相对差 54% → 29%（7 对 5 条的支撑域；≥10 条的域里最大 27%，8 对 11）；模块换桶 81/293 → 40/293，其中 `no-candidates` ↔ `declared-skip` 60 → 0，36 个是两次都没有候选、只随步骤落点在 `covered` 与 `no-candidates` 间变的模块（run 1 多 133 个步骤）。

  发现并修复（c080969f）：两次共 5 个 `silent-zero` 模块里 4 个的脚本入口点已被逐个声明跳过，模块桶却报 `silent-zero`，运行报告据此说覆盖不完整。修复后这类模块落 `declared-skip`。修复只改模块桶，O1–O4 不受影响，没有为它重跑；按修复后的规则对两次的覆盖报告逐行重算，这 4 个都变为 `declared-skip`，剩下 1 个真实缺口（run 1：一个模块有一个通过核对的模型入口点和一个未识别文件，没有流程也没被跳过）。

  局限：两次运行只是一对样本；`declared-skip` 理由逐条可见，但哪些入口点该跳过没有独立核对；多个分析器自述只读了节点名与签名、没打开源码，步骤摘要的质量不在本次 oracle 内。

## 6. 收尾

- [ ] 6.1 `openspec validate --all --strict`；`tests/domain/` 与读 skill/agent 文件的测试；PR 写明跑了什么。
