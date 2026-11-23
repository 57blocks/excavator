提交序列见 proposal。每个脚本任务先写红测试，看它失败，再实现。oracle O1–O5 见 design。

## 1. 事实构建

- [ ] 1.1 红测试（O1）：`structureDigest` 与入口点流、coverage、gaps 无关，随节点、边变化；`lazy-analyze` 写出的文件头带 `structureDigest`。
- [ ] 1.2 `build-fact-graph.mjs`：抽出并导出 `coverageForDigest`，算 `structureDigest`（`recorder: null`），放进投影；`lazy-analyze.mjs` 文件头加字段、`PIPELINE_VERSION` 升到 `/18` 并写注释；`packages/core/src/{schema,types}.ts` 的 `ProjectMeta` 加可选 `structureDigest`。
  - **验证：** 1.1 绿；钉 `/17` 的测试改为 `/18`；`pnpm --filter @excavator/core test`、`pnpm run typecheck`、`pnpm -r build`。

## 2. 语义图改绑

- [ ] 2.1 红测试：`semantic-graph.mjs` 写出 `structureDigest`、不写 `factDigest`，`check` 按它判定，旧文件为 `rebuild`；view 的 O2；`finalize-incremental` 起步分层；部署运行器的跳过与产物检查（D6）；四个 skill 的 Reading Layers 契约。
- [ ] 2.2 改 `semantic-graph.mjs`、`excavator-view/semantics.mjs`、`finalize-incremental.mjs`、`deploy/run-excavator.mjs`、`tests/fixtures/deploy/fake-claude.mjs`、`skills/excavator/SKILL.md` Phase F、`skills/excavator-{chat,diff,explain,onboard}/SKILL.md`。
  - **验证：** 2.1 绿；受影响的既有测试绿；`node scripts/check-refs.mjs`。

## 3. 旧语义图核对重绑

- [ ] 3.1 红测试（O3、O4）。
- [ ] 3.2 `semantic-graph.mjs` 加 `ADDITIVE_FACT_STREAMS` 与 `rebindSemanticGraph`；`lazy-analyze.mjs` 发布成功后调用，结果进返回值并打印（D4）。
  - **验证：** 3.1 绿；`tests/lazy/` 受影响的测试绿。

## 4. 收尾

- [ ] 4.1 `openspec validate --all --strict`；`tests/refs/legacy-literals` 等门禁。
- [ ] 4.2 O5：`go-multirepo` 副本上实测，记录在下面。
