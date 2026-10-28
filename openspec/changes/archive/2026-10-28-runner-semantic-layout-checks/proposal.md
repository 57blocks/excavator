## Why

`full` 在 EC2 上用 `full-semantic-isolation` 的布局跑完了一个 74 文件的切片：641 条摘要、6 层、校验器 0 条矛盾，但运行以退出码 4（加载或产物检查失败）结束。原因不在模型，而在验收按旧布局读：

1. **产物检查读不到模型名。** runner 的 `checkProduct` 从 `knowledge-graph.jsonl` 的 `project.model` 读模型，而新布局里 Full 不写事实图，模型名在 `semantic-graph.json` 的 `model` 里。结果恒为 `null`，报 `graph project.model is null`。
2. **`semantic-graph.json` 里的 `model` 也恒为 `unknown`。** SKILL.md 的 F3 写 `semantic-graph.mjs write` 时取 `--model "${EXCAVATOR_MODEL:-unknown}"`，runner 只设了 `ANTHROPIC_MODEL`，没设 `EXCAVATOR_MODEL`，所以即使改成读新位置，读到的仍是 `unknown`。
3. **结构完整性报 74 个问题，全是「文件节点不在任何层」。** 校验器的层检查只看图本身的 `layers`，新布局里层在 `semantic-graph.json`，事实图里没有层。74 恰好是切片的文件节点数。

4. **「现有产物是不是 full 产出的」也按旧布局判断。** runner 的跳过规则（`planFullRun`）看事实图的 `project.pipelineVersion` 是不是 `excavator-annotate/1`，那是旧流程的 annotate 步骤盖的章。新布局的 Full 不写事实图，事实图里一直是 Lazy 的 `lazy-fact-graph/14`，所以 runner 永远认为「没有 full 产物」：HEAD 没变时 `full` 不会被跳过，而且每次都带 `--full` 强制重建，白白花模型调用。冒烟那次没有暴露它，因为是第一次跑；这是我对照代码读出来的，还没在 EC2 上重跑验证。

前三处合起来让每次 `full` 都以退出码 4 结束，调用方无法用退出码判断成败；第四处让重复运行既不跳过也不续跑。

## What Changes

- **产物检查的模型名**：runner 从 `semantic-graph.json` 的 `model` 读，要求等于本次请求的模型 ID，不是 `unknown`。事实图的 `project.model`（旧布局）不再是判据。`semantic-graph.json` 不存在或没有 `model` 时仍是产物检查失败，原因写明读了哪个文件。
- **full 产物的判定**：`semantic-graph.json` 存在且有 `factDigest`，才算有 full 产物；`factDigest` 等于事实图的 `project.factsDigest` 且 `meta.json` 的 commit 等于 HEAD，才跳过。有 full 产物但不新鲜时走增量（`--mode=full`），没有时才是 `--full`；只有 Lazy 产物仍不跳过。
- **模型名真的写进去**：F3 写 `semantic-graph.json` 时，`--model` 取 `EXCAVATOR_MODEL`，未设则取 `ANTHROPIC_MODEL`，都没有才是 `unknown`。
- **层的完整性检查**：校验器在图本身没有任何层时，读与图文件同目录的 `semantic-graph.json` 的 `layers` 做同样的检查（层引用的节点存在、一个节点只在一层、每个文件节点在某一层）。图自带层时行为不变。读不到、读不懂或没有层时，文件节点仍然被报「不在任何层」，不会悄悄通过。

**不做**：
- 不改编造闸：摘要校验里被判 `contradicted` 的摘要是否计入阈值，另议（现有规格已要求计入，运行器尚未做到，这是另一个变更）。
- 不加 runner 自己的范围保护，不验证 effort 是否生效。
- 不改 `deploy/` 其余部分与 `docs/deploy.md` 以外的文档。

## Capabilities

### Modified Capabilities

- `runner-image`：「运行与产物由确定性检查判定」——产物记录的模型从 `semantic-graph.json` 读，且只设了 `ANTHROPIC_MODEL` 时也记下真实模型；「full 模式在源码未变时跳过」——按 `semantic-graph.json` 判断 full 产物与新鲜度。
- `graph-validation`：「引用完整性与领域步骤锚定」——图没有层时，层检查读同目录的 `semantic-graph.json`。

## Impact

- `deploy/run-excavator.mjs`（`checkProduct`、`planFullRun` 与它们的调用处）；`skills/excavator/validate-graph.mjs`（层检查）；`skills/excavator/SKILL.md`（F3 的 `--model` 一行）。
- 测试：`tests/deploy` 里 `checkProduct` 与 `planFullRun` 的用例，`tests/skill/excavator/test_validate_graph.test.mjs` 里层检查的用例，以及一条 SKILL.md 契约用例。
- 验收：EC2 上同一个 74 文件切片的 `full` 冒烟，`product` 与 `integrity` 两项通过，紧接着在 HEAD 不变时再跑一次 `full`，被跳过且没有模型调用；编造闸仍不数摘要矛盾，这一点写进验收记录。
