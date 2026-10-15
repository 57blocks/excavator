执行约束：
- 编码由我做。真实验收用 `scripts/benchmark-full-run.mjs run`，由我对照记录与产物核对。
- 验收 oracle 见 design.md「验收 Oracle」，动手前已写死。
- 语言：代码、注释、测试与 skill 散文用英文，OpenSpec 用中文。
- 不改 `packages/` 与 MCP。
- 公开仓库：不出现具体公司、产品或私有语料的名字。测量输出写在仓库外。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

0. `docs(openspec): archive full-run-measurement`（已完成）。
1. `docs(openspec): propose resumable-scoped-full`：本变更的 proposal、design、规格与 tasks。
2. `fix(skill): verify only summaries without a verdict and commit verdicts per batch`：任务 1.1。
3. `feat(skill): select semantics and verification candidates within a directory scope`：任务 1.2。
3a. `fix(skill): keep the semantic cache's language identity when writing verdicts`：做 1.3 时发现，见 1.2 的完成记录。
4. `feat(skill): resume, scope and estimate a Full run`：任务 1.3。
4a. `fix(skill): commit each Full batch where it is dispatched`：O2 第一次尝试发现编排者没有逐批提交，见 2.1。
5. `feat(scripts): continue, time out and pass skill arguments in measured runs`：任务 1.4。
5a. `docs(skill): record the estimate's checks in its addendum`：O3、O4 之后补的检验点，见 2.3。
6. `docs(openspec): record resumable-scoped-full acceptance`：任务 2.1–2.4。

## 1. 实现

- [x] 1.1 `apply-verification.mjs`：`prepare-semantic` 只选没有判定或为 `dirty` 的条目；`apply-semantic --batch <i>`；收尾只认清单选中的 id 与清单批号。验证：O1 对应单测；全量门。
  - 完成记录：
    - 选择：已有 `verified`/`unverified`/`contradicted` 的条目计入新计数 `alreadyChecked`，不选；`dirty` 与没有判定的照选。
    - `--batch <i>`：只读第 i 批的核验文件与判定文件，只认该批列出的 id；没回判定的 id 不写，留给续跑。逐批提交不写 `semantic-verification.json`，那是收尾的报告。
    - 收尾：有清单时只读清单批号的判定文件、只认 `selectedIds`；清单外的判定计入 `verdictNotSelected` 并出缺口 `semantic-summary-verdict-not-selected`。没有清单时照旧放行。
    - 实现中补的三处，都是续跑才暴露的：
      - 缓存改为临时文件加改名写入。逐批提交让写缓存的次数从 1 次变成每批 1 次，中途被杀会把检查点写坏。
      - `contradicted`、`unverified` 的缺口改按缓存里的标记计数。续跑时前一次已提交的批不会再出现在本次判定里，按本次判定计数会少算。
      - 矛盾归档带上前一次的记录：条目仍是 `contradicted` 且 summary 没变时保留，否则丢弃。否则续跑会丢掉中断那次的矛盾理由。
    - 测试：单测 7 条、CLI 流水线加逐批提交与遗留判定文件。8 个注入变异都能变红；其中「归档不核对 summary」第一次没变红，因为夹具里重新生成的条目没有标记，补成「重新生成后又被判矛盾」后变红。
- [x] 1.2 `select-stale-semantics.mjs` 与 `prepare-semantic` 的 `--scope`。验证：O1 对应单测；全量门。
  - 完成记录：
    - 范围判定只有一份：`project-paths.mjs` 的 `scopePredicate`，用 `canonicalSourcePath` 校验，去掉末尾的 `/`，匹配目录本身或其下的路径。两个脚本都用它。
    - 范围匹配不到任何事实节点时报错退出。多半是拼错了目录，静默选空会被当成「这个模块已经做完」。
    - `stale-semantics.json` 与核验清单都记下 `scope`，供预估与报告读。`--scope` 只用于 `prepare-semantic`，用在别的动作上报错。
    - 测试：单测 6 条，CLI 1 条（选择、不规范、选不到、用错动作）。7 个注入变异都能变红。
    - 1.1 的全量门：core 1417、仓库 3565 通过，引用、OpenSpec 校验通过。
    - 1.2 的全量门：仓库 3571 通过，其余同上。
    - 做 1.3 时发现的既有缺陷，单独提交（3a）：`apply-semantic` 把缓存重写成 `{version, entries}`，丢了顶层的 `contentLanguage: "en"`。此后每个条目都被判为 `noncanonical-language`，下一次 Full 会重新生成全部语义。在上一个变更 cargotracker 跑完的副本上重跑选择，1038 个节点全部落进 `generate`。这会让续跑在 F4 提交过任何一批之后失效，也让 O2 的「每个节点都有新鲜条目」不可能通过。修法：保留缓存的全部顶层字段。单测与 CLI 流水线（核验之后再选择，节点在 `reuse` 里）在旧写法下都变红。
- [x] 1.3 SKILL.md：Phase F 开始移走旧逐批文件、F2 与 F4 逐批提交、`--scope`、`--estimate`；新附录 `full-run-estimate.md`。验证：O1 的 SKILL 契约与附录单测；全量门。
  - 完成记录：
    - SKILL.md：选项里加 `--scope`、`--estimate`，不带 `--full` 时报错停止；Phase 0 认项目路径时跳过 `--exclude`、`--scope` 的值；Phase F 开头写明续跑就是重跑同一条命令，并在 F1 之前把四类逐批文件移进 `.trash-<时间戳>/`；F2 第 4 步与 F4 改成每批一返回就提交；`--estimate` 在 F2 第 2 步后停止；`--scope` 时跳过 F3，F5 列出 F2 的缺口并提示怎么合成。
    - 附录 `full-run-estimate.md`：计数的 jq、公式、费率表与出处、两条上限与报告格式。计算 `V` 的 jq 在上一个变更 cargotracker 跑完的产物上得 829，与当时核验清单的 `candidates` 相同；用公式回代得 $30.4、墙钟 81 分钟（实际 85.2）。
    - 契约测试 13 条；4 个注入变异（少移判定文件、预估停在派发之后、F4 不逐批提交、不跳过 F3）都能变红。
    - 3a 的全量门：仓库 3572 通过，其余同上。
- [x] 1.4 `scripts/benchmark-full-run.mjs run`：`--continue`、`--timeout-minutes`、`--skill-args`、产物拷贝。验证：O1 对应单测；全量门。
  - 完成记录：
    - `--continue <工作目录>` 与样本目录二选一；目录必须正好含一份样本副本与空的 `cwd/`，`--out` 不能落在它里面。报告记 `continued`，Markdown 写明续用的副本。
    - `--timeout-minutes`：等待子进程抽成 `runChild`，到时 SIGTERM，10 秒后仍在就 SIGKILL；报告记 `timedOut`、`signal`，退出码为空，命令以 1 退出但照出报告。
    - `--skill-args` 的值可以本身以 `--` 开头（如 `--estimate`），原样接在 `--full` 之后。
    - 产物拷到 `<out>/products/`：`stale-semantics.json`、`batches.json`、`semantic-verify-manifest.json`、`semantic-cache.json`，缺的记为 `products:<路径>`。
    - 顺手把库头部的契约路径改成归档后的 `openspec/specs/full-run-measurement/spec.md`。
    - 测试：新增 7 条，其中一条用 PATH 上的替身 `claude` 跑完整个 `runMeasured`（续用副本、透传参数、超时停止、产物拷贝），不花钱。7 个注入变异都能变红。
    - 1.3 的全量门：仓库 3585 通过，其余同上。

## 2. 真实验收与记录

- [x] 2.1 O2 续跑（conduit）。
  - 第一次尝试（插件 d8eacf0c，Sonnet，上限 $15，超时 13 分钟）：不作数，花 $5.78。
    - 编排者没有逐批提交：第 1 批返回时它写「等其余 6 批完成再提交」，7 批全回来后才一次性提交。规则只写在第 4 步，而它照着第 3 步的派发说明在等。
    - 超时也没落在 F2：F2 只用了 7.3 分钟，13 分钟时已在 F3。
    - 处理：把「每批一返回就提交」挪进 F2 第 3 步与 F4 的派发段落，要求报告 `Batch <i>/<N> committed.`，契约测试跟着断言派发段落里的这句（4a）。第二次尝试改成看记录停：记录里出现第 2 次单独的提交命令时，向无头进程发 SIGTERM，等同于在那一刻超时；`--timeout-minutes` 只作兜底。
  - 第二次尝试（插件 adb2d1b4，Sonnet）：通过。
    - 第 1 次 `run`（上限 $10）：F2 共 7 批。第 1、5 批各自一返回就单独提交；第 2 次提交的结果出现在记录里时发 SIGTERM，进程以 143 退出，`timedOut` 为 false，运行 7.4 分钟。这时第 3 批已返回但没提交，第 2、4 批还在跑，第 6、7 批没派发。被杀的运行没有 `result` 事件，所以没有花费记录。
    - 第 2 次 `run --continue`（上限 $25）：退出码 0，花 $7.93，墙钟 23.7 分钟，setup 到 F5 各阶段都有，没有报错。缺失项只有 `roles:model-calls-not-in-record`。
    - Phase F 开始的 trash 移动把第 1 次留下的 `semantic-patch-batch-1/3/4/5` 与 `semantic-patch-report-1/5` 移进 `.trash-<时间戳>/`。其中第 3、4 批是写出了却没提交的补丁，没有被当成新鲜的提交。
    - F2 每批一返回就单独提交，5 次提交命令各在不同时间点；F4 的 4 批各自 `apply-semantic --batch <i>` 后，再跑收尾 `apply-semantic`。
  - 通过条件逐条：
    - 第 1 次停止后缓存里有 45 个条目。
    - 第 2 次的复用计划：259 个节点，复用 45、生成 214；`plan.generate` 与第 1 次停止后缓存条目的交集为 0。
    - F2 批数：第 1 次 7，第 2 次 5。
    - 第 2 次走到 F5，`anyError` 为 false。
    - 第 2 次之后对副本重算复用计划：复用 259、生成 0。缓存身份仍是 `version` 2.0.0、`contentLanguage` "en"。
    - 判定：verified 100、unverified 14、contradicted 3；142 个文件节点没有行号锚点，不核验。
- [x] 2.2 O3 预估（jpetstore）：通过。
  - 预估运行（`--skill-args --estimate`，上限 $3）：花 $0.78。记录里没有子代理派发，也没有子代理消息。输出含范围、节点数、两阶段的计数、派发数、花费、墙钟与出处行，两条上限提示都没触发。
    - 输出的数与动手前用同一组脚本手算的一致：节点 561，`G` 561，`B2` 15，`V` 448，`B4` 15，`D` 32；估 $22.38、56.3 分钟。
  - 续跑默认 Full（`run --continue`，上限 $35）：退出码 0，花 $18.98，墙钟 39.8 分钟，各阶段齐全，缺失项为空，没有报错。
    - 实际 `B2` 15、`B4` 15，与预估一致；核验清单选中 448，与 `V` 一致。
    - 花费 −15.2%，在 ±30% 内；墙钟 −29.3%，在 ±50% 内。
    - 各阶段：setup 2.0、F1 0.2、F2 14.5、F3 10.2、F4 11.4、F5 1.1 分钟。墙钟估高主要在 F4：估 23.1 分钟，实际 11.4 分钟；记录里核验器同时跑 5 个。
    - 逐批提交：F2 的 15 批分 13 次提交，其中两次各提交了两个同时返回的批；F4 的 15 批各自 `apply-semantic --batch <i>`，再收尾。
    - 之后对副本重算复用计划：复用 561、生成 0。缓存身份不变；判定：verified 412、unverified 31、contradicted 5；113 个文件节点没有行号锚点。
  - 不重标定费率：两项都在容差内，单点偏差不足以改附录的数。
- [x] 2.3 O4 分块与合成（conduit）：通过。O4 在 O2、O3 之后补进 design.md，条件在运行前写定。
  - 第 1 次 `run --skill-args "--scope backend"`（新副本，上限 $9）：退出码 0，花 $3.73，墙钟 13.4 分钟，阶段为 setup、F1、F2、F4、F5。
    - 派发只有 file-analyzer 2 次、summary-verifier 2 次，没有 architecture-analyzer 与 assemble-reviewer。
    - 选择产物 `scope` 为 `backend`：35 个文件、84 个节点，`plan.generate` 全在 `backend/` 下。缓存 84 个条目，全在 `backend/` 下。
    - 核验清单 `scope` 为 `backend`，选中 49，全在 `backend/` 下；写下 49 个判定。
    - F5 报告写明范围、F2 缺口为 0，并提示之后跑不带 `--scope` 的 Full 来合成架构。
  - 第 2 次 `run --continue`（不带 scope，上限 $14）：退出码 0，花 $7.95，墙钟 23.5 分钟，各阶段齐全，缺失项为空，没有报错。
    - 复用计划：259 个节点，复用 84、生成 175；`plan.generate` 与第 1 次之后的缓存条目交集为 0。
    - F3 跑了：architecture-analyzer 与 assemble-reviewer 各派发 1 次。`semantic-graph.json` 有 8 层，259 个节点全部分到层里，其中 `backend/` 下 84 个。
    - 核验清单 `alreadyChecked` 49，等于第 1 次写下的判定数；选中 68。
  - 第 2 次之后：复用计划复用 259、生成 0；缓存身份不变。判定共 117 个，是第 1 次的 49 个加第 2 次的 68 个。
  - 预估的偏差：第 1 次按公式手算为 $6.12、11.7 分钟，实际 $3.73（−39%）、13.4 分钟（+15%）。花费超出 ±30%：小运行里固定项占大头，估高了。不改费率，把这次与 O3 一起写进附录的出处，契约测试断言这几句（5a）。5a 的全量门：core 1417、仓库 3594 通过，openspec 42 项通过。
- [x] 2.4 在本文件末尾写「验收摘要」：O1–O4 的结果、续跑、分块与预估的数字，以及需求原文第 3 项的完成情况。

## 验收摘要

| Oracle | 结果 | 关键数字 |
|---|---|---|
| O1 单测 | 通过 | 每个代码提交跑全量门，最后一次 core 1417、仓库 3594；每类新断言都用注入变异确认能变红 |
| O2 续跑（conduit） | 第二次尝试通过 | 停在 F2 第 2 次提交后，缓存 45 条；续跑生成 214、与已有条目交集 0，F2 批数 7 → 5，$7.93、23.7 分钟走到 F5；之后生成 0 |
| O3 预估（jpetstore） | 通过 | 预估 $0.78、零派发，`B2` 15、`B4` 15、$22.38、56.3 分钟；实际 `B2` 15、`B4` 15、$18.98（−15%）、39.8 分钟（−29%） |
| O4 分块与合成（conduit） | 通过 | `--scope backend` 只动 84 个 backend 节点、不跑 F3，$3.73；合成运行生成其余 175 个、跑 F3、跳过已有的 49 个判定，$7.95；最终 259 个节点全部分层 |

- **真实运行花费**：有记录的合计 $45.15（O2 第一次尝试 $5.78，O2 续跑 $7.93，O3 两次 $19.76，O4 两次 $11.68）。O2 第二次尝试的第 1 次被 SIGTERM 停下，没有花费记录，上限 $10。总额在 $83 上限内。
- **需求原文第 3 项的完成情况**：
  - 超时或预算停下后，重跑同一条命令即可续跑，已提交的批不再分析（O2）。
  - 可以按目录分块跑，最后跑一次不带 `--scope` 的 Full，合成为一张图（O4）。
  - 开跑前用 `--estimate` 给出带出处的花费与墙钟，jpetstore 上两项都在容差内（O3）。
  - Full 的测量基准在上一个变更里完成，本变更给运行器加了续跑、超时与透传参数。
  - 验收标准的两条都满足：中断的 Full 续跑时不重新分析已完成的批；预估与实际的偏差在约定容差内（花费 ±30%、墙钟 ±50%）。
- **留下的限制**：
  - 小运行的花费会被估高。35 个文件的分块运行偏 −39%，原因是固定项占大头。已写进附录的出处，没有改费率。
  - 费率只有 Sonnet 的实测。
  - 被判 `unverified` 的 summary 在重新生成之前不会重核。
  - 续跑时 F3 会重跑，约 $2.4。
  - 前几次运行在补丁阶段的缺口，不会带进 `semantic-graph.json`。
  - 本变更的真实运行最大到 113 个文件、15 + 15 批。`B2 + B4` 超过 100 时的分块建议只有契约测试，没有在那个规模上真实跑过。
