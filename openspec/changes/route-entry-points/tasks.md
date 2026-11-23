提交序列见 proposal。每个脚本任务先写红测试，看它失败，再实现。oracle O1–O7 见 design。

## 1. Core：规则与通用抽取器

- [ ] 1.1 红测试：`packages/core/src/plugins/__tests__/route-facts.test.ts`（O1 三组夹具）；`FrameworkConfigSchema` 拒收未知键与缺字段的 `routes`；抽取代码里没有框架名（扫 `route-facts.ts` 的字符串字面量与三份配置的 id）。
- [ ] 1.2 `languages/types.ts` 加 `routes` schema；`frameworks/{gin,express,react}.ts` 加规则（D2）。
- [ ] 1.3 `plugins/route-facts.ts`（D3、D4）；`tree-sitter-plugin.ts` 的 `analyzeFile` 与 `analyzeFileFull` 调用它；`types.ts` 的 `StructuralAnalysis` 加可选 `routes`。
  - **验证：** 1.1 绿；`pnpm --filter @excavator/core test`；`pnpm run typecheck`。

## 2. 事实构建：解析、记录流、覆盖、版本

- [ ] 2.1 红测试：`extract-structure-result` 校验并写出 `routes`（坏形状拒收）；import map 的 `require()`/`import()` 进 `resolvedSources`、`import()` 不加边、Go 的 `resolvedPackages`；`tests/lazy/entry-point-resolution.test.mjs`（O2）；知识图存储往返 `entryPoints` 流；`factsDigest` 随记录流变化；O3。
- [ ] 2.2 `extract-structure-result.mjs`、`extract-import-map.mjs`（D6）。
- [ ] 2.3 `entry-point-resolution.mjs`（D5、D7）；`build-fact-graph.mjs` 接入、缺口原因、守恒；`knowledge-graph-store.mjs` 加流；`validate-graph.mjs` 认这个键；`lazy-analyze.mjs` 的 `PIPELINE_VERSION` 与注释（D8）。
  - **验证：** 2.1 绿；受影响的既有测试（`git grep` 出读这些模块的测试）绿；`pnpm -r build` 后 core dist 是新的。

## 3. `/excavator-domain`

- [ ] 3.1 红测试：抽取脚本从知识图读入口点、不再用 HTTP 正则产生入口点、`unrecognisedFiles`、`unavailable`；分区清单与区上下文带未识别文件；合并核对模型入口点（O6）；SKILL 与分析器说明的契约测试。
- [ ] 3.2 改 `extract-domain-context.py`、`split-domain-areas.mjs`、`merge-domain-areas.mjs`、`SKILL.md`、`agents/excavator-domain-analyzer.md`（D9、D10）。
  - **验证：** 3.1 绿；`node scripts/check-refs.mjs`；`tests/domain/` 绿。

## 4. `/excavator-unused-code`

- [ ] 4.1 红测试（O7）。
- [ ] 4.2 改 `unused-code.mjs` 与 `skills/excavator-unused-code/SKILL.md`（D11）。
  - **验证：** 4.1 绿；既有 unused-code 测试绿。

## 5. 实测与收尾

- [ ] 5.1 O3、O4、O5：在 `go-multirepo` 的副本（`~/Documents` 下，原件不动）上用重建过的 core dist 跑 Lazy；记录语义计划、节点对比、入口点按框架/桶/模块的前后计数、分层抽查结果与花费。
- [ ] 5.2 把实测写进本 tasks 的 5.1，`openspec validate --all --strict`。
