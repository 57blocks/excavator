提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

0. `docs(openspec): propose knowledge-graph-line-store`：proposal、design、规格增量、tasks。
1. `refactor(store): extract shared jsonl line reader`：任务 1.1。
2. `feat(graph): line-oriented knowledge-graph store with strict round trip`：任务 2.1–2.2。
3. `feat(facts): incremental facts digest with byte-identical input`：任务 3.1–3.2。
4. `feat(lazy): publish knowledge-graph.jsonl through staged publish`：任务 4.1–4.3。
5. `feat(readers): move every graph reader and writer to the store`：任务 5.1–5.4。
6. `feat(structure-all): line-oriented structure-all.jsonl`：任务 6.1。
7. `docs: point prose, examples and docs at knowledge-graph.jsonl`：任务 7.1–7.2。
8. `docs(openspec): record knowledge-graph-line-store acceptance and archive`：任务 8.x、9.1。

## 1. 共享按行读取

- [x] 1.1 从 `source-index-store.mjs` 抽出分块按行读取到 `skills/excavator/jsonl-lines.mjs`，`source-index-store.mjs` 改用它。验证：source index 现有测试全绿；同一索引改前改后写出的文件逐字节相同。

## 2. 图谱存储模块

- [ ] 2.1 新增 `skills/excavator/knowledge-graph-store.mjs`，按 design D1、D2 实现写、读、只读文件头，以及 `KnowledgeGraphFormatError`。验证：单测覆盖往返严格相等（旧形状、Full 形状）、比较器先验、写两次逐字节相同、几字节分块下的中文与 emoji、缺文件头、计数不符、未知记录类型、重复文件头。
- [ ] 2.2 写出时返回最长单条记录长度；单条记录超过上限时以 `ProductTooLargeError` 具名失败。验证：注入小上限的单测。

## 3. 增量事实摘要

- [ ] 3.1 `build-fact-graph.mjs` 按 design D3 逐段计算 `factsDigest`，不再拼整份文本。验证：单测以原整份算法为 oracle，在多个夹具上摘要逐字相同；所有固定摘要测试不变。
- [ ] 3.2 `product-serialization.mjs` 增加按行产物的最长记录余量；余量表去掉整份摘要文本这一项，加入 `source-index.jsonl`。验证：余量单测。

## 4. Lazy 发布

- [ ] 4.1 `lazy-analyze.mjs` 的暂存发布改写 `knowledge-graph.jsonl`（新的写入接缝），发布成功后删除旧 `knowledge-graph.json`；`intermediate/fact-graph.json` 改为 `intermediate/fact-graph.jsonl`；`PIPELINE_VERSION` 升为 `lazy-fact-graph/3`；读取上一份图改用存储模块，不再调用 core `loadGraph`。验证：Lazy 测试与暂存发布的故障注入测试覆盖新接缝。
- [ ] 4.2 删除 core `persistence` 的 `loadGraph`/`saveGraph` 及其测试，其余持久化函数不动。验证：core 测试与 typecheck 通过。
- [ ] 4.3 上限绊线：注入小上限时，整图超限但最长记录不超限的夹具发布成功；单条记录超限的夹具具名失败且最终产物不变。验证：对应测试。

## 5. 所有读写方

- [ ] 5.1 MCP 与服务：`project-service.mjs` 改用存储模块；格式错误报告为无效产物；只剩旧文件时报告 `missing-product` 并带 `legacyProductPresent`。验证：MCP 测试；wcp-auth 上改前改后 7 个工具逐项相同。
- [ ] 5.2 语义、增量与 Full 发布脚本：`semantic-cache.mjs`、`semantic-cache-reuse.mjs`、`select-stale-semantics.mjs`、`apply-semantic-patches.mjs`、`semantic-graph.mjs`、`prepare-incremental.mjs`、`finalize-incremental.mjs`、`publish-annotations.mjs`、`apply-verification.mjs`、`mark-dirty.mjs`、`consumer-freshness.mjs`、`project-paths.mjs` 改用存储模块。验证：`tests/full/*`、`tests/lazy/lazy-to-full-e2e.test.mjs`、语义缓存与增量测试全绿。
- [ ] 5.3 领域图、Figma、Python、hooks、deploy：
  - `annotate-domain.mjs`、`domain-freshness.mjs`（只读文件头）、`figma-merge.mjs` 改用存储模块；
  - `merge-subdomain-graphs.py` 改为按行读写；
  - `hooks/*.mjs`、`deploy/run-excavator.mjs`（只读文件头）、`deploy/mcp-smoke.mjs`、`deploy/selftest.sh` 改用新文件。

  验证：各自测试；Python 跨实现往返测试。
- [ ] 5.4 测试：直接读写旧文件名的测试改用存储模块。验证：全量测试全绿，且没有任何固定摘要变化。

## 6. 结构抽取结果

- [ ] 6.1 新增 `structure-all-store.mjs`；`structure-all.mjs` 写出 `intermediate/structure-all.jsonl` 并删除旧文件；`lazy-analyze.mjs`、`annotate-graph.mjs`、`build-source-index.mjs`、`build-fact-graph.mjs` 经该模块读入。验证：往返单测；相关测试全绿；factsDigest 不变。

## 7. 散文

- [ ] 7.1 skill、agent、hooks 提示、README 与 docs 中的旧文件名、内联整文件读取代码与 jq 示例改为新文件与新模块。验证：`node scripts/check-refs.mjs` 通过；design D8 的 grep 门通过。
- [ ] 7.2 `openspec/specs` 中受影响的要求按本变更的规格增量同步（归档时完成）。验证：`openspec validate --all --strict`。

## 8. 验收

- [ ] 8.1 全量门：`pnpm install --frozen-lockfile && pnpm -r build && pnpm test`、`pnpm typecheck`、`pnpm lint`、`node scripts/check-refs.mjs`。
- [ ] 8.2 摘要不变：design「验收」2 列出的 6 个语料的 factsDigest 与改前相同。
- [ ] 8.3 hadoop 真实运行：按 design「验收」6，包括默认堆下的最大常驻内存，以及与改前 3,638,018,048 字节的对比。
- [ ] 8.4 MCP：wcp-auth 改前改后 7 个工具逐项相同；hadoop 上 `deploy/mcp-smoke.mjs` 通过；记录各工具前后耗时。
- [ ] 8.5 零兼容：只含旧文件的数据目录被报告为缺失产物；一次发布后旧文件消失。

## 9. 归档

- [ ] 9.1 规格增量同步到 `openspec/specs/`，变更移入 `openspec/changes/archive/`，`openspec validate --all --strict` 通过。
