## Context

动机见 proposal.md，行为见规格。相关现状：

- **F1** 是确定性的整仓事实构建，每次 Full 都跑，不调模型。
- **F2** 用 `select-stale-semantics.mjs` 的复用计划，只为没有新鲜条目的节点生成语义。新鲜按条目的 `semanticSourceHash` 与当前源码 hash 判断，`--full` 也不覆盖。逐批补丁经 hydrate 后由 `apply-semantic-patches.mjs` 提交；条目整条替换，不带旧判定。
- **F3** 在 `--full` 时无条件重建，否则按 `factDigest` 复用。
- **F4** `prepare-semantic` 选所有带 summary、有行号锚点的条目，每 30 个一批。判定文件在最后由 `apply-semantic` 一次读入，没回判定的选中条目记为 `unverified`。
- Phase 0 与 Phase 7 已有 `.trash-<时间戳>/` 的做法：把临时目录移走而不是直接删，7 天后再清理。

上一个变更在 cargotracker 上的实测（Sonnet，默认 Full）：

| 阶段 | 批数 | 花费 | 墙钟 |
|---|---|---|---|
| F2 | 19 | $11.45 | 23.5 分钟 |
| F4 | 28 | $10.71 | 43.0 分钟 |
| F3（含 reviewer） | — | $2.37 | 16.1 分钟 |
| 编排（含记录外的调用） | — | $5.90 | — |
| setup + F1 + F5 | — | — | 2.6 分钟 |

角色花费按输入侧 token 的相对价格比例（缓存读 0.1、缓存写 1.25、未缓存输入 1）拆分自报总花费。输出 token 无法按角色拆，按同一比例分摊。

## Goals / Non-Goals

**Goals：** 中断后重跑同一条命令即可续跑；按目录分块再合成；开跑前给出带出处的预估。

**Non-Goals：**
- 不改 F3 的范围：架构始终看整个事实图，不按模块分层。
- 不做多模型费率：v1 只有 Sonnet 的实测，别的模型照 Sonnet 估，并在输出里写明。
- 不改 Lazy、MCP 与 `packages/`。

## Decisions

### D1 检查点就是已提交的语义，不另设状态文件

续跑靠两样已有的东西：
- `semantic-cache.json` 的条目，按节点、按源码 hash 判断新鲜；
- 条目上的判定。

所以续跑就是重跑同一条命令。备选方案是另写一份检查点文件，记录哪些批完成了。没采用，因为它与缓存是两份真相：缓存条目会因源码变化失效，检查点文件不会，两者一旦不一致，就可能把过期的批当成已完成。

### D2 逐批提交写进 SKILL，不写代码

F2 的 hydrate 与提交本来就是按批调用的脚本，只是 SKILL 没说什么时候调。改成「该批的分析器一返回，就 hydrate 并提交这一批，再处理下一个返回的」。这是编排顺序，AI 能照做，不需要代码。F4 同理，用新的 `apply-semantic --batch <i>`。

### D3 F4 只核验还没有判定的条目，判定按批限定 id

- **选择**：`prepare-semantic` 只选 `verification` 缺失或为 `dirty` 的条目。summary 重新生成时条目整条替换、不带判定，所以新 summary 一定会被选中。
- **逐批提交**：`apply-semantic --batch <i>` 读第 i 批的核验文件与判定文件，只写该批列出的 id。没有回判定的 id 留空不写，以便续跑时再选。
- **收尾**：`apply-semantic` 只读本次清单里各批号的判定文件，只认清单里选中的 id；没回判定的选中 id 照旧记为 `unverified`。

- **随之而来的三处**（实现时补上）：缓存用临时文件加改名写入，中途被杀不会写坏检查点；`contradicted`、`unverified` 缺口按缓存里的标记计数，不只算本次的判定；矛盾归档保留前一次的记录，前提是条目仍是 `contradicted` 且 summary 没变。

代价：被判 `unverified` 的 summary 之后不会自动重核，直到它重新生成。现在每次 Full 都会重核一遍，这一点行为因此改变。

### D4 旧的逐批文件移进 trash，不删

Phase F 开始时，把 intermediate 里的这些文件移进 `.trash-<时间戳>/`，沿用 Phase 0 的延迟清理：
- `semantic-patch-batch-*.json`、`semantic-patch-report-*.json`；
- `semantic-verify-batch-*.json`、`summary-verdicts-*.json`。

否则一个这次没写出结果的批，会被同批号的旧文件顶替。F2 的 hydrate 按当前源码 hash 盖章，旧补丁会因此被当成新鲜的提交。D3 的 id 限定是第二道防线。

### D5 `--scope` 是选择脚本的选项

- `select-stale-semantics.mjs --scope <dir>`：只对路径在 `<dir>` 下的节点做复用计划，计数与 `stale-files.json` 都只含这部分。
- `prepare-semantic --scope <dir>`：只选这部分的条目。
- 判定规则：`filePath === dir` 或以 `dir + '/'` 开头。`dir` 用现有的 `canonicalSourcePath` 校验，末尾的 `/` 去掉。
- 带 scope 的运行跳过 F3。F2 的补丁缺口照常写进 `semantic-gaps.json`，并在报告里列出。

选择本来就是确定性脚本在做，范围过滤放在一起。让编排者对几千条路径做过滤，属于模型转写大批量结构化事实。

### D6 预估：费率是附录里的数据，由编排者计算

新附录 `skills/excavator/full-run-estimate.md` 写四样东西：
- 计数怎么取：jq 命令；
- 公式；
- 费率表与它们的出处；
- 建议上限。

编排者用 shell 算出结果并报告。不写估算脚本：这是对五六个数做乘加，AI 能做。费率要随实测更新，作为数据放在附录里最容易改。

计数（都在 F1 与 F2 第 1、2 步之后可得）：
- `G`：`stale-semantics.json` 里 `plan.generate` 的条目数；
- `Gf`：其中的文件节点数（id 以 `file:` 开头），文件节点没有行号锚点，不进核验；
- `B2`：`batches.json` 的批数；
- `R`：范围内已有新鲜条目、有 summary、不是文件节点、还没有判定的条目数；
- `V = G − Gf + R`，`B4 = ceil(V / 30)`；
- `F3`：带 `--scope` 时为 0，否则为 1；
- `D = B2 + B4 + 2·F3`，是子代理派发数（F3 含 architecture-analyzer 与 assemble-reviewer）。

v1 费率（Sonnet，标定样本 cargotracker；第 3 次夹具运行作检验）：

| 项 | 花费 | 墙钟 |
|---|---|---|
| 固定（编排、setup、F1、F5） | $4.00 + $0.04 × D | 2.6 分钟 |
| F2 每批 | $0.60 | 1.24 分钟，至少 6 分钟 |
| F4 每批 | $0.38 | 1.54 分钟 |
| F3 | $2.40 | 12 分钟 |

回代检验：
- cargotracker 估 $30.4，实际 $30.42。这是标定点本身，不算验证。
- 第 3 次夹具运行估 $9.6，实际 $8.47，偏 +14%；墙钟估 20.8 分钟，实际 26.2 分钟，偏 −21%。
- 第 2 次夹具运行估 $9.6，实际 $6.32，偏 +53%。它用的是修正前的 prompt，记为已知离群点。

建议上限与提示：
- 单次运行 `B2 + B4` 不超过 100。依据是编排者上下文每次派发约增加 3.6k token（8.5 万到 26 万，50 次派发），100 次时约 45 万；而编排者每次调用都要读入整个上下文，花费随派发数近似平方增长。超过上限时，建议按目录分块，并给出按顶层目录的节点数分布。
- 估计墙钟超过 runner 默认超时（180 分钟）时，提示分块或依赖续跑。

### D7 预估的容差

花费 ±30%，墙钟 ±50%。
- 花费：两点标定，编排开销随唤醒次数变化，第 3 次夹具运行已偏 +14%。±30% 能区分「估对了量级与结构」和「估错了」。
- 墙钟：受 API 延迟、并发度与编排者等待方式影响，夹具上同样的批数测到过 6 分钟与 14 分钟，所以放宽到 ±50%。

这是我定的容差，写进验收；用户可以推翻。

### D8 测量运行器的扩展

- `--continue <dir>`：`<dir>` 必须正好含一个样本目录与空的 `cwd/`，即上一次 `run` 建的形状，否则用法错误。不复制，直接用它。报告记下这是续跑。
- `--timeout-minutes <n>`：到时先发 SIGTERM，10 秒后仍在就发 SIGKILL。报告记下是超时停止的。
- `--skill-args <string>`：原样追加到 `/excavator <项目> --full` 之后，例如 `--estimate` 或 `--scope src/a`。
- 运行后，把 `.excavator/intermediate/` 下的 `stale-semantics.json`、`batches.json`、`semantic-verify-manifest.json`，以及 `.excavator/semantic-cache.json`，拷进 `<out>/products/`。存在的才拷，缺的进报告的缺失项。

## Risks / Trade-offs

- [编排者不照「逐批提交」做] → 续跑验收看记录里提交命令的时间点，以及中断后缓存里的条目数；没逐批提交时，验收会看到中断后缓存为空。
- [`unverified` 不再重核] → 见 D3。如果要重核，需要让 summary 重新生成；这次不加强制重核的开关。
- [预估只有 Sonnet 的两点标定] → 输出注明出处；预估验收用一个不参与标定的仓库；不过的话如实记录，用三点重标定，不宣称通过。
- [续跑或分块后，前几次运行的补丁期缺口不再进 `semantic-graph.json`] → 那些缺口（模型写了不存在的 id、提交失败）描述的是那次的模型输出。节点本身没有新鲜语义这件事，会在下一次 F2 的选择里重新出现并重新生成，所以现状不会被掩盖，丢的只是那次输出的记录。
- [F3 在续跑时重跑] → 一次架构分析约 $2.4。为了避免这笔，需要判断上一次 F3 用的语义是否已经完整，那需要另一份状态，与 D1 冲突。所以保留重跑。

## 验收 Oracle（动手前写死）

- **O1 单测**：
  - `select-stale-semantics` 与 `prepare-semantic` 的 scope 选择，以及不规范 scope 的报错；
  - `prepare-semantic` 跳过 `verified`、`unverified`、`contradicted`，选缺失与 `dirty`；
  - `apply-semantic --batch` 只写本批 id，不把没回判定的记为 `unverified`；
  - 收尾 `apply-semantic` 只认清单选中的 id、忽略清单外批号的判定文件；
  - 旧判定不会写到重新生成的 summary 上；
  - SKILL 契约：Phase F 开始的 trash 移动、F2 与 F4 逐批提交、`--scope` 跳过 F3、`--estimate` 在 F2 第 2 步后停止且不派发；
  - 预估附录含公式、费率表与出处；
  - 运行器 `--continue`、`--timeout-minutes`、`--skill-args` 的参数与目录校验。

  每类断言都用注入变异确认能变红。每个代码提交跑全量门。
- **O2 续跑**（conduit 5e127d8，开源 JS 应用，Sonnet）：
  - 第 1 次 `run`：`--timeout-minutes` 取在 F2 中途，上限 $15；
  - 第 2 次 `run --continue`：上限 $30。
  - 通过条件：
    - 第 1 次停止后，缓存里已有条目；
    - 第 2 次的 `plan.generate` 与第 1 次停止后缓存里的条目没有交集；
    - 第 2 次的 F2 批数少于第 1 次的；
    - 第 2 次走到 F5，没有报错；
    - 第 2 次之后，每个可生成的节点都有新鲜条目。
- **O3 预估**（jpetstore 344ef63，开源 Java Web 应用，Sonnet）：
  - 先 `run --skill-args --estimate`，上限 $3；记录里没有子代理派发，输出含计数、花费、墙钟与出处；
  - 再 `run --continue`，跑默认 Full，上限 $35。
  - 通过条件：花费在估计的 ±30% 内，墙钟在 ±50% 内；第 2 次实际的 `B2`、`B4` 与预估时的计数比对。
  - 不过就如实记录、重标定，不宣称通过。
- 两次真实验收合计上限 $83，预计 $35–45。只用 Sonnet，不并行。
