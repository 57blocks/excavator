## Why

需求原文要求 Full 在大仓库上可用：超时或预算停下后能接着跑，能按模块分块跑再合成一张图，开跑前能估出花费和时间。

上一个变更的测量说明，大仓库一次跑完不现实：
- cargotracker（209 个文件）跑一次默认 Full 花 $30.42、85 分钟，其中 F4 占一半墙钟；
- 编排者的上下文随派发次数一路增长，50 次派发从 8.5 万涨到 26 万 token。派发再多一个数量级，单个会话就装不下。

现状离这三点各差一步：
- **续跑**：F2 已按节点复用新鲜语义，重跑 `--full` 不会重新生成已提交的节点。但 SKILL 没要求每批一返回就提交，中断时已写出、未提交的批会丢。F4 每次都核验所有带 summary 的条目，不管它是否已有判定，而且判定在最后一次性写回，中断就全丢。
- **判定串号**：`apply-semantic` 读 intermediate 里所有判定文件，只要 id 在缓存里就写，不核对是否本次选中。上一次运行留下的判定文件，可能把判定盖到这次重新生成的 summary 上。
- **分块与预估**：都没有。

## What Changes

- **续跑就是重跑同一条命令**：
  - Phase F 开始时，把上一次留下的逐批文件移进 `.trash-<时间戳>/`，它们不会再被当成本次的输出；
  - F2、F4 每批一返回就提交，中断只丢正在跑的批；
  - `apply-verification.mjs prepare-semantic` 只选还没有判定的 summary（没有 `verification`，或为 `dirty`）；
  - 新增 `apply-semantic --batch <i>`：只提交第 i 批的判定，只认该批列出的 id；
  - 收尾的 `apply-semantic` 只认本次选中的 id，只读本次批号的判定文件。
- **按目录分块**：新增 `--scope <dir>`，只与 `--full` 同用。
  - `select-stale-semantics.mjs` 与 `prepare-semantic` 加 `--scope`，只选该目录下文件的节点；
  - 带 scope 的运行跳过 F3，架构留给不带 scope 的那次；
  - 各次运行的语义都进同一个 `semantic-cache.json`，所以合成就是最后跑一次不带 scope 的 Full：F2、F4 无事可做，只跑 F3。
- **预估**：新增 `--estimate`，与 `--full` 同用，可带 `--scope`。
  - 跑 F1 和 F2 的选择、分批，然后停止，不派发任何子代理；
  - 按新附录 `full-run-estimate.md` 里的实测费率，由编排者算出花费与墙钟；
  - 批数超过单次运行的建议上限、或墙钟超过 runner 超时时，给出按目录分块或靠续跑的提示。
- **测量运行器 `run`**：
  - `--continue <工作目录>` 复用上一次的隔离副本；
  - `--timeout-minutes` 模拟 runner 超时；
  - `--skill-args` 把额外参数透传给 `/excavator`；
  - 运行后把选择、批与缓存产物拷进输出目录，供核对。

## Capabilities

### New Capabilities

- `full-run-continuation`：Full 运行的续跑、按目录分块与运行前预估。

### Modified Capabilities

- `full-semantic-isolation`：Summary-Verifier 只核验还没有判定的 summary，判定逐批提交，且只认本批或本次选中的 id。
- `full-run-measurement`：测量运行器可续用上一次的副本、模拟超时、透传参数。

## Impact

- 改动：`skills/excavator/SKILL.md`、`apply-verification.mjs`、`select-stale-semantics.mjs`、新附录 `skills/excavator/full-run-estimate.md`，以及 `scripts/benchmark-full-run.mjs` 和它的库，各自带测试。
- 不改 `packages/` 与 MCP。
- 行为变化：第二次 Full 不再重核已有判定的 summary。被判 `unverified` 的 summary 不会自动重核，直到它重新生成。
- 真实运行：
  - 续跑验收：conduit，超时中断一次再续跑；
  - 预估验收：jpetstore，先预估，再完整跑一次比对。

  合计上限 $83，预计 $35–45，只用 Sonnet，不与其他重任务并行。
