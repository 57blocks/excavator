提交序列见 proposal。每个脚本任务先写红测试，看它失败，再实现。

实际顺序的偏差：1–2 的测试写在实现之后。为确认测试能红，在合并脚本上植入四个变异（关掉地址核对、关掉同侧排除、关掉引文核对、关掉区外核对），每个都让测试变红，还原后全绿。

## 1. 单元与分区

- [x] 1.1 红测试（`tests/relations/plan-units.test.mjs`、`tests/relations/split-relation-areas.test.mjs`）：每种清单的 `kind` 规则、嵌套清单归最深、`unmanifested`、路由入口点作入口证据、摘要复用与 `--reunit`；信号命中、包装客户端的引入方、行数上限与 `overBudget`、区不跨单元、密钥行不进上下文、旧区目录被删。
- [x] 1.2 实现 `plan-units.mjs`、`relations-signals.mjs`、`split-relation-areas.mjs`。
  - **验证：** 1.1 绿；源码里零中文字符、零语料名。

## 2. 核对、配对、分桶

- [x] 2.1 红测试（`tests/relations/relations-address.test.mjs`、`tests/relations/merge-relations.test.mjs`）：D6 的规范化与配对（参数段、通配、字面胜、方法、`ANY`、同单元、`targetUnit`、广播）；D5 每个拒收原因一个植入（O1），真端点全部通过；节点 id 替换；每个端点桶与文件桶至少一个样例；守恒失败退出 4；区缺失退出 3；一致性在输入相同时计算、不同时为 `null`；升级候选。
- [x] 2.2 实现 `relations-address.mjs`、`merge-relations.mjs`、`relations-freshness.mjs`。
  - **验证：** 2.1 绿。

## 3. skill 与代理

- [x] 3.1 红测试（`tests/relations/relations-skill-contract.test.mjs`）：SKILL 的阶段顺序、派代理只给三个路径、重派一次、报告的固定行；代理定义写明单边不猜、地址带证据、`skippedFiles`、后续种类；两者都不写模型名。
- [x] 3.2 写 `skills/excavator-relations/SKILL.md`、`agents/excavator-relations-analyzer.md`；`tests/install/install.test.mjs` 的 skill 数加一；`README.md` 加用法。
  - **验证：** 3.1 绿；`node scripts/check-refs.mjs`；受影响的既有测试绿。

## 4. 验收

- [x] 4.1 按 design 的 O2–O6 在四个语料上跑，记花费；分层抽查并记精度；把结果写进本文件。

  冻结版（提示词与代码 4e2262e4）连跑：kotlin-portal 两次、realtime-suite 两次、go-multirepo 两次、contracts-monorepo（留出）一次，花费 $1.49 + $1.36、$6.29 + $6.22、$4.19 + $4.06、$5.88，共 $29.49（冻结前的试跑与修复期运行另计 $18.36，再加一次被中途停掉、未记花费的运行，估计不到 $1.5）。之后只改了合并（目标单元回退，见下），所以下表是用最终代码对这七次运行的区输出只重放合并得到的；重放装置先验过：用冻结代码重放 realtime-suite 第二次的快照，摘要与那次运行的报告逐行相同。

  | 语料 | 端点 | 调用端 linked / ambiguous / caller-only / 未解析 | 接收端 linked / receiver-only | 拒收 | silent-zero | http 一致性 | 其它种类一致性 |
  |---|---|---|---|---|---|---|---|
  | kotlin-portal | 197 | 72 / 1 / 34 / 1 | 67 / 22 | 0 | 0 | 1.0（69/69） | external 0/4，不足 |
  | realtime-suite | 1079 | 628 / 0 / 8 / 4 | 338 / 101 | 0 | 0 | 0.986（481/488） | realtime 0.868、external 0.893 |
  | go-multirepo | 1067 | 461 / 1 / 21 / 8 | 422 / 154 | 0 | 0 | 0.988（424/429） | external 0.583 → 抽取器候选 |
  | contracts-monorepo | 855 | 397 / 0 / 8 / 5 | 374 / 71 | 0 | 0 | 单次，无 | — |

  - **O2 守恒**：七次都成立（端点、候选文件、单元）；`ends-rejected` 全为 0。
  - **O3 精度**（每语料 24 条，覆盖每个非空桶，对照源码）：`linked` 合计 71/72（98.6%）：http 43/43、realtime 6/6、external 22/23（错的一条把客户端类名当外部系统名，地址其实是配置里为空的 URL）。编造（源码里不存在的端点或配对）0。非 `linked` 桶错 6 条：realtime-suite 2 条 `caller-only` 是分析器把整个前端的 `targetUnit` 写成了另一个后端（目标单元回退后两条都正确 `linked`）；go-multirepo 1 条、contracts-monorepo 1 条 `receiver-only` 其实有调用端，是分析器在大文件里漏记；contracts-monorepo 2 条 `caller-only` 的前缀在运行时二选一，分析器写成了变量段并丢了 `/api`，按规则配不上，接收端其实存在。另有 go-multirepo 4 条 Slack 关系属实，但主机证据引的是无关的配置行。
  - **召回（独立推导，按行 ±3）**：kotlin-portal 前端调用 100/100、后端映射 86/86；go-multirepo 前端调用 446/480（92.9%），漏记集中在两三个大 service 文件，那些行也不匹配 path-call 信号，合并看不见；contracts-monorepo 调用 394/399、路由 448/452；realtime-suite emit/on 行 86/129，(文件,事件) 73/73，同一文件里重复的 emit 只记一处。
  - **O4 一致性**：http 三个语料都 ≥ 0.98；realtime 0.868、external 0.893（realtime-suite）达标；go-multirepo 的 external 0.583 低于 0.80，照记为抽取器候选（同一服务时而按名字、时而按主机成键，kotlin-portal 的 external 也同样不稳，只是不足 5 条）。没有挪阈值，也没有为它建抽取器。
  - **O5 单元复用**：七次运行的单元文件与各自第一次逐字节相同；`units=reused` 由脚本打印，但 skill 的最终回复没有转述这一行，只能从文件对比确认。
  - **O6 留出**：contracts-monorepo 只跑一次，用冻结提示词；它的抽查结果没有引起任何提示词或代码修改。它的最终回复里有 7 个分析器自述没有逐行读完每个文件（用了 grep），与上面「大文件里漏记」的召回缺口一致，只记录，不据此改提示词。
  - **冻结后唯一的修改**：目标单元回退（合并，6f5ecb73），来源是 realtime-suite 的抽查，不是留出语料。
- [x] 4.2 `openspec validate --all --strict`；开 PR，写明跑了哪些测试与实测数字。本变更 `openspec validate runtime-relations --strict` 通过；`--all` 的 5 个失败是 main 上既有 spec 的 Purpose 占位警告，与本变更无关。
