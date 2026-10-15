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
5. `feat(scripts): continue, time out and pass skill arguments in measured runs`：任务 1.4。
6. `docs(openspec): record resumable-scoped-full acceptance`：任务 2.1–2.3。

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

- [ ] 2.1 O2 续跑（conduit）。
- [ ] 2.2 O3 预估（jpetstore）。
- [ ] 2.3 在本文件末尾写「验收摘要」：O1–O3 的结果、续跑与预估的数字，以及需求原文第 3 项的完成情况。
