## Why

一次真实的 Full 运行（Sonnet，一个旧的 Node.js 服务目录，23 个文件，其中几个超过 2,000 行）里，Phase F2 的一个分析批拿到 300 个节点：

- 第一遍写出 275 条按名字套模板的 summary，形如「X as part of the Y service; implemented in f.js lines a-b」。
- 删掉这些条目重跑，分析代理自己的回复说它又是「从函数名、签名和文件上下文」写的，没读源码。结果 275 条里 23 条被判 contradicted（8.4%），其余目录约 1.6%。
- Phase F4 的核验代理把大部分模板 summary 判成 verified。有的核验回复说只拿函数名对了一下切片，或者某个节点根本没读。

现在没有任何确定性的东西挡住这一点：

1. **批的大小不看源码量。** F2 用 `compute-batches.mjs` 按文件分批（社区最多 35 个文件），再由编排者用 jq 列出本批的节点。批里有多少行要读，没有上限。
2. **提交只查身份与格式。** `apply-semantic-patches.mjs` 只查 `nodeId` 是否是事实节点、`displayName` 是否合格；summary 是读源码写的还是按名字编的，它看不出来。
3. **判定不带依据。** `apply-verification.mjs apply-semantic` 收下任何合法的判定值；一个没读切片的 verified 与读过的一样落进缓存。

散文已经写了「读源码再写」「只读引用的切片」，两次运行都没守住。要的是一层确定性的地板，不是更多散文。

## What Changes

- **F2 按要读的源码行分批。** 新脚本 `plan-semantic-batches.mjs` 取代 F2 里的 `compute-batches.mjs`：从 `stale-semantics.json` 的 `plan.generate` 出发，给每个节点算出要读的行（`readRange`：有 `lineRange` 用它；没有的用文件前 300 行），按路径顺序装批，每批不超过 40 个节点、要读的行（同一文件内取并集）不超过 1,500 行；单个节点超过上限时独占一批并标出。脚本为每批写一个输入文件，节点清单由脚本给出，不再由编排者拼。
- **补丁带读过的行。** 每个补丁 SHALL 带 `evidence: {line, quote}`：`line` 在节点的 `readRange` 里，多行节点不能是第一行（声明行，凭名字就猜得到），`quote` 是该行上原样的一段文字。提交脚本读源码核对，不合格的补丁不提交，记为 semantic gap。
- **summary 不写自己的锚点。** summary 或 `displayName` 里出现行号引用（`line 12`、`lines 12-31`、`a.ts:12`）或节点自己带目录的路径时，不提交，记为 semantic gap。
- **判定带读过的行。** 核验代理的 `verified` 与 `contradicted` 判定 SHALL 带同样形状的 `evidence`，按同一规则对节点的 `lineRange` 核对；不合格的判定不写入缓存，计入可见的计数与 gap：逐批提交时该 id 保持未判、重跑再选，收尾时记为 `unverified`。`unverified` 不需要依据。
- 文件分析代理与核验代理的定义、SKILL.md 的 F2/F4、预估附录与基准报告脚本跟着改。

## Capabilities

### Modified Capabilities

- `full-semantic-isolation`：增加 F2 按源码行分批、补丁依据、锚点引用、核验判定依据四条要求。

## Impact

- 代码：新增 `skills/excavator/plan-semantic-batches.mjs`、`skills/excavator/read-evidence.mjs`；改 `apply-semantic-patches.mjs`、`apply-verification.mjs`（只改 semantic 动作）、`scripts/lib/full-run-report.mjs`。
- 散文：`skills/excavator/SKILL.md` 的 Phase F2、F4，`skills/excavator/full-run-estimate.md`，`agents/excavator-file-analyzer.md`，`agents/excavator-summary-verifier.md`。
- 花费：批变小、批数变多。原来一批 300 个节点的目录会拆成十几批。这是真正读源码的花费；旧的单批价格是没读的价格。预估附录的每批费率是在旧分批上测的，本变更不重测，附录里写明。
- 不改：Lazy 与 MCP 的 `semantic_commit`、Phase 2.5 的 `apply` 动作、F4 的分批。
