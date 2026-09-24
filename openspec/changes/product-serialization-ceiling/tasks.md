执行约束：一 coder（Sonnet）一 acceptor（Opus）；验收 oracle 见 design.md「验收 Oracle」，动手前已写死。代码、测试与 skill 散文用英文，OpenSpec 用中文。一组一个 commit，按下列顺序提交；PR 以 merge commit 合入，保留每个 commit。真实语料的源码、路径与输出不提交；wcp、cebreo、conduit 在副本上跑，不动用户语料现有的 `.excavator/`。

commit 序列：
0. `docs(openspec): propose product-serialization-ceiling`
1. `feat(serialization): add product serialization helper with headroom and named over-limit error`
2. `feat(source-index): add line-oriented store with lossless round trip`
3. `feat(source-index): persist as source-index.jsonl across writers and readers`
4. `feat(lazy): stage every product and replace in order with rollback`
5. `feat(lazy): self-report snapshot and manifest timings with wall-clock total`
6. `docs(skill): read source-index.jsonl through the store`

## 1. 序列化辅助

- [x] 1.1 新增 `skills/excavator/product-serialization.mjs`：`serializeJsonProduct(name, value, { indent, limit })` 返回字符串并记录 `{product, chars, limitChars, percentOfLimit}`；结果长度超过上限，或 `JSON.stringify` 抛 `RangeError` 时，用不建串的递归长度累加算出所需字符数，抛具名 `ProductTooLargeError`（`product` / `requiredChars` / `limitChars`）；默认上限取 `buffer.constants.MAX_STRING_LENGTH`。验证：新测试覆盖成功记录、注入小上限触发具名错误、用 spy 让第一次 `JSON.stringify` 抛 `RangeError` 模拟真实超限，以及长度累加在含引号、转义、Unicode、`undefined`、`NaN`、空容器、嵌套缩进的样本上与 `JSON.stringify(v)`、`JSON.stringify(v, null, 2)` 的长度逐一相等。
- [x] 1.2 余量记录器：汇总多次序列化的条目，并接受子脚本产物的 `stat` 字节数条目（标 `measuredAs: 'bytes'`），按占上限百分比降序输出。验证：单测。

## 2. source index 按行存储

- [ ] 2.1 新增 `skills/excavator/source-index-store.mjs`：导出 `SOURCE_INDEX_FILE = 'source-index.jsonl'`；`writeSourceIndex(path, index)` 按 design D1 的记录顺序缓冲写入，返回 `{bytes, lines, maxLineChars}`；`readSourceIndex(path, { blockSize })` 按 D2 同步分块读取、做全部校验，失败抛具名 `SourceIndexFormatError`，重建出与构建产物形状一致的对象（`postings` 普通对象、`docLengths` 无原型）。验证：新测试——夹具索引往返 `isDeepStrictEqual` 为真，且比较器先对单字段改动判为不等；同一索引写两次逐字节相同；`blockSize` 设为几字节时，含中文和 emoji 的 chunk 仍往返相等；缺文件头、计数不符、序号越界、序号非递增、`chunks` 与 `tf` 不等长、未知记录各自抛具名错误。
- [ ] 2.2 检索等价：同一组检索词下，`bm25Search` 在构建出的内存索引与写出再读回的索引上结果逐项相同。验证：新测试。

## 3. 读写方切换与版本号

- [ ] 3.1 `lazy-analyze.mjs` 发布改写 `source-index.jsonl`（本组先直接写，第 4 组再接入暂存）；`PIPELINE_VERSION` 升为 `lazy-fact-graph/2`。验证：`tests/lazy/source-index-pipeline.test.mjs` 改为经读取器断言并通过。
- [ ] 3.2 `project-service.mjs` 用读取器读索引，缺失、只剩旧文件、无效三种情况按 design D3 映射为可见缺口。验证：`tests/mcp/project-service.test.mjs` 更新，并新增「只有旧 `source-index.json`」与「损坏的 `.jsonl`」两个用例；`tests/mcp/fixture.mjs` 改用写入器并导入 `PIPELINE_VERSION`。
- [ ] 3.3 `sync-fact-graph.mjs` 读上一版索引改用读取器，读取失败仍退回全量重建。验证：增量同步的现有测试仍证明只重建变化文件的 chunks。
- [ ] 3.4 `build-source-index.mjs` CLI：`--previous` 读取与输出改用读写器，默认输出 `source-index.jsonl`。验证：`tests/retrieval/build-source-index.test.mjs` 中相应用例通过。
- [ ] 3.5 `tests/lazy/lazy-to-full-e2e.test.mjs` 改用读取器；`tests/semantic-cache/semantic-cache.test.mjs` 的版本号字面量改为导入常量。验证：两个测试通过。

## 4. 暂存发布与回滚

- [ ] 4.1 core 导出 `saveGraph` 内部已有的路径净化步骤，`saveGraph` 行为不变。验证：core 测试通过，新增断言证明 `saveGraph` 的输出与改动前逐字节相同。
- [ ] 4.2 `lazy-analyze.mjs` 按 design D4 实现「暂存 → 按序替换 → 失败回滚 → 收尾」：收尾时删除旧 `source-index.json`、清理暂存目录，以及同前缀且对应进程已不存在的旧暂存目录；五个最终产物中的整文档 JSON 全部经过第 1 组的辅助；故障注入通过可注入的文件操作接缝完成，不修改生产路径的行为。验证：新故障注入测试在暂存阶段的每个产物、替换阶段的每一步分别注入失败，`.excavator/` 下全部最终产物的哈希与运行前一致、暂存目录不存在、`metaAdvanced` 为 false、`saveError` 为具名信息（O4）；注入小上限时具名失败且产物不变（O5）。
- [ ] 4.3 `lazy-analyze.mjs` 自己写的中间产物、`build-fact-graph.mjs` 的事实摘要输入也经过辅助（摘要值不变）；子脚本输出（`structure-all.json`、`import-map.json`、`fingerprints.json`）记录 `stat` 字节数。验证：测试断言运行结果含这些余量条目，且夹具上的 `factsDigest` 与改动前相同。

## 5. 计时自报与输出

- [ ] 5.1 按 design D7 新增 `snapshotResolve`、`snapshotMaterialize`、`manifestEntries`，`timings.total` 改为墙钟时间；CLI 在现有汇总行之外打印各阶段耗时与按百分比排序的余量表。验证：新测试断言三项存在且 `total` 不小于各阶段之和；在夹具 git 仓库上跑 CLI，两段输出可见。

## 6. Skill 与文档

- [ ] 6.1 `skills/excavator-chat/SKILL.md` 的内联代码改为导入 `source-index-store.mjs` 的读取器，降级判断改为检查 `source-index.jsonl`；`skills/excavator/SKILL.md` 与 `docs/lazy-mode-plan.md` 更新文件名。验证：`node scripts/check-refs.mjs` 通过；在 `skills/` 与 `docs/` 下搜索 `source-index.json`，只剩说明旧文件已废弃的语句。

## 7. 验收（acceptor 亲自执行，不采信 coder 自报）

- [ ] 7.1 全量门（O7）：在干净检出上跑 `pnpm install --frozen-lockfile && pnpm -r build && pnpm test`、`node scripts/check-refs.mjs`、`openspec validate product-serialization-ceiling --strict`，全部通过。
- [ ] 7.2 conduit（固定提交 `5e127d85`）副本（O1、O2）：`main` 与本分支分别跑 lazy；本分支的索引往返严格相等；对一组固定检索词通过 stdio 调用 MCP `recall`，去掉快照与耗时字段后两边逐项相同；再用 stdio 调用 `project_status`、`sync_facts`、`traverse`、`read_evidence`、`semantic_plan`，核对索引可用性与缺口字段。
- [ ] 7.3 wcp、cebreo 副本（O3）：`main` 与本分支的 lazy `factsDigest` 相同，census 与缺口分布一致。
- [ ] 7.4 Hadoop `2014707f8c31`（O1、O3、O6）：重跑 lazy 首跑，要求完成且确定性校验通过、五个最终产物齐全、`factsDigest` 等于 `88c3219d31de0315e87fb4303fed5fa0bced8faae9ebb940dcc0233c13c5eae7`、索引往返严格相等、余量报告与三项新计时出现、`total` 与外部墙钟相差不超过 2 秒；把各阶段耗时、峰值内存与余量以脱敏摘要写进 PR 描述。
- [ ] 7.5 PR 以 merge commit 合入 `main`，保留 commit 序列 0–6。
