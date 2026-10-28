## Context

`full-semantic-isolation` 把模型的产出从事实图里分出去：摘要和标签进 `semantic-cache.json`，层和跨节点关系进 `semantic-graph.json`，`knowledge-graph.jsonl` 只放确定性事实。runner 的验收（`deploy/run-excavator.mjs` 的 `checkProduct`，以及它调用的 `validate-graph.mjs` 的完整性检查）是在这之前写的，仍按「模型名与层在事实图里」读。EC2 上的冒烟是证据：641 条摘要、6 层都在，验收却以退出码 4 结束，两项失败原因各是一处读错位置，外加一处模型名从未被写下。

## Decisions

**D1：产物检查读 `semantic-graph.json` 的 `model`。** `checkProduct` 的入参从 `graph` 改成语义图（读不到传 `null`）。判据不变：等于本次请求的模型 ID，不是 `unknown`。读不到文件、不是合法 JSON、没有 `model` 都是失败，原因里写文件名。代价：旧布局的产物（模型写在事实图 `project.model`）不再通过。这是有意的：旧布局已被 `full-semantic-isolation` 取代，运行器在跑的是新布局；若保留回退到 `project.model`，一个读不到语义图的新布局产物会靠旧字段通过，正是不让它悄悄过的情况。

**D2：模型名在源头写对。** F3 的 `semantic-graph.mjs write` 现在用 `--model "${EXCAVATOR_MODEL:-unknown}"`，runner 只设 `ANTHROPIC_MODEL`。改成 `${EXCAVATOR_MODEL:-${ANTHROPIC_MODEL:-unknown}}`。不让 runner 再设一个 `EXCAVATOR_MODEL`：运行器已经把请求的模型放进 `ANTHROPIC_MODEL`，技能在没有运行器时（本地交互）也会有 `ANTHROPIC_MODEL` 或没有，两种情况回退链都成立；多一个同义的环境变量要在两处保持一致。`annotate-graph.mjs` 已经有同样的候选名列表（`EXCAVATOR_MODEL`、`CLAUDE_MODEL`、`ANTHROPIC_MODEL`、`CLAUDE_CODE_MODEL`），F3 这一行只取前后两个，是对运行器实际设置的值的最小改动。

**D3：校验器的层检查，图没有层时读同目录的 `semantic-graph.json`。** 只在 CLI 层做：`main` 读完图后，若 `graph.layers` 为空，且 `dirname(graphPath)/semantic-graph.json` 能读出带 `layers` 数组的 JSON，就把这些层交给 `validateAgainstSource`。`validateAgainstSource` 本身仍是纯函数，只多一个可选入参 `layers`（缺省用图自带的）。选同目录是因为 runner 与技能都把两个文件放在同一个数据目录；不扫描别的位置，也不接受用参数指定路径，少一个会被误用的入口。图自带层时不读语义图：一个图有两份层，以谁为准没有无争议的答案，保持原行为。

**D4：读不到就是没有层，不是通过。** 语义图缺失、不是 JSON、没有 `layers`，层保持空，每个文件节点照旧被报「不在任何层」。这是既有的可见失败，不新增状态。

**D5：full 产物按语义图判断。** `planFullRun` 的入参加上语义图（读不到传 `null`）：`hasFullProduct` 是语义图存在且 `factDigest` 为非空字符串；跳过要求 `factDigest === project.factsDigest` 且 commit 等于 HEAD；有 full 产物但不新鲜走 `--mode=full`；没有才是 `--full`；`--force` 仍然是 `--full`。不再看 `project.pipelineVersion`：它只在旧的 annotate 流程里被改写。`PIPELINE_VERSION` 导出保留，别处仍在用。代价：旧布局产物（只有事实图里的 `excavator-annotate/1`）不再被认作 full 产物，重跑会走 `--full`；这与 D1 同理，是有意的。

**D6：只改布局，不动编造闸。** 现有规格（`runner-image`「独立复核编造与结构完整性」）已经要求摘要被判 `contradicted` 计入编造阈值，运行器尚未做到：`validated-graph.jsonl` 里只有事实图的节点与边，摘要的判定在 `semantic-cache.json`。这是另一个问题，不是读错位置，要决定「计哪些判定」，不放进这个变更。验收记录里写明：编造闸这次仍然数 0。

## Risks

- 若 `semantic-graph.json` 的层引用了事实图里不存在的节点，会出现新的完整性问题（`Layer ... refs missing node`）。这是真问题，不是回归；F3 写入时本来就会把不存在的 id 丢掉并记为缺口。
- 旧布局产物在 `product` 检查下会失败，见 D1。
- 校验器多读一个文件：每次一次，大小为几百 KB。
