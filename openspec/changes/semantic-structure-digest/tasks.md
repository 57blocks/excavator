提交序列见 proposal。每个脚本任务先写红测试，看它失败，再实现。oracle O1–O5 见 design。

## 1. 事实构建

- [x] 1.1 红测试（O1）：`structureDigest` 与入口点流、coverage、gaps 无关，随节点、边变化；`lazy-analyze` 写出的文件头带 `structureDigest`。
- [x] 1.2 `build-fact-graph.mjs`：抽出并导出 `coverageForDigest`，算 `structureDigest`（`recorder: null`），放进投影；`lazy-analyze.mjs` 文件头加字段、`PIPELINE_VERSION` 升到 `/18` 并写注释；`packages/core/src/{schema,types}.ts` 的 `ProjectMeta` 加可选 `structureDigest`。
  - **验证：** 1.1 绿；钉 `/17` 的测试改为 `/18`；`pnpm --filter @excavator/core test`、`pnpm run typecheck`、`pnpm -r build`。

## 2. 语义图改绑

- [x] 2.1 红测试：`semantic-graph.mjs` 写出 `structureDigest`、不写 `factDigest`，`check` 按它判定，旧文件为 `rebuild`；view 的 O2；`finalize-incremental` 起步分层；部署运行器的跳过与产物检查（D6）；四个 skill 的 Reading Layers 契约。
- [x] 2.2 改 `semantic-graph.mjs`、`excavator-view/semantics.mjs`、`finalize-incremental.mjs`、`deploy/run-excavator.mjs`、`tests/fixtures/deploy/fake-claude.mjs`、`skills/excavator/SKILL.md` Phase F、`skills/excavator-{chat,diff,explain,onboard}/SKILL.md`。
  - **验证：** 2.1 绿；受影响的既有测试绿；`node scripts/check-refs.mjs`。

## 3. 旧语义图核对重绑

- [x] 3.1 红测试（O3、O4）。
- [x] 3.2 `semantic-graph.mjs` 加 `ADDITIVE_FACT_STREAMS` 与 `rebindSemanticGraph`；`lazy-analyze.mjs` 发布成功后调用，结果进返回值并打印（D4）。
  - **验证：** 3.1 绿；`tests/lazy/` 受影响的测试绿。

## 4. 收尾

- [x] 4.1 `openspec validate --all --strict`；`tests/refs/legacy-literals` 等门禁。
- [x] 4.2 O5：`go-multirepo` 副本上实测，记录在下面。

### 4.2 实测记录（`go-multirepo` 副本，2026-11-23，花费 $0，没有模型运行）

副本在 `~/Documents` 下，原件不动；拷贝时不含 `.excavator/.trash-*`。拷贝时的状态就是问题所在的状态：
- 文件头 `lazy-fact-graph/17`，`factsDigest` 为 `43d09a95…`；
- `semantic-graph.json` 的 `factDigest` 为 `64e4b00b…`，是 `/16` 时的值；
- main 的代码打包页面时，语义为 unreadable，原因是「made from other facts」，名称表 `zh 0/2309`（2309 只是领域名，没有显示名）。

动手前先核对候选 2 的算法：
- 从 `/16` 基线副本的图按构建时的方式重算，得到 `64e4b00b…`，等于它自己记录的值；
- 从当前 `/17` 的图去掉 `entryPoints` 流、`coverage.entryPoints` 与两个入口点缺口重算，也得到 `64e4b00b…`；
- 两份图的节点与边逐字节相同，coverage 除 `entryPoints` 外相同，gaps 只多 2 条入口点缺口。

本分支（重建过的 core dist）跑一次 Lazy，不加 `--full`，用时 17 秒：
- `semantic-graph=rebound`（命中「去掉附加流之后的摘要」）；
- 节点 10483、边 40183，`factsDigest` 仍为 `43d09a95…`，文件头新增 `structureDigest` `48f15086…` 与 `lazy-fact-graph/18`；
- 重绑前后 `semantic-graph.json` 只有 `factDigest` 换成 `structureDigest`（键位置相同），其余 8 个字段逐字段相同；`layers` 一段的原文 155435 字节逐字节相同；
- `semantic-cache.json` 的 sha256 前后相同；
- F3 `check` 输出 `reuse`。

`/excavator-view --language zh`（打包到副本自己的 `.excavator/`，翻译表在页面旁边）：
- 语义 included：10483 条，0 条过期，10 个分层，核对结论 verified 7412 / unverified 960 / contradicted 5 / unchecked 2106；
- 名称表 `zh 11421/11421`，全部已有译文。
- 交接时预计的「约 10752 个名称」与 11421 不同。多出的 9112 个（11421 − 2309，按名称去重后）来自恢复的显示名；领域名 2309 来自升级后重跑的领域图。预计值的来历没有核对，这里照记实测值。
- 对照：同一份已重绑的副本，用 main 的代码打包，语义仍为 unreadable、名称 2309。说明恢复靠的是本分支的读法，不是副本被改成了旧格式。
