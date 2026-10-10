## Context

- **写入：**
  - 图谱在 `lazy-analyze.mjs` 发布时整份 `serializeJsonProduct('knowledge-graph.json', …, {indent: 2})`；
  - 增量与 Full 的发布脚本（`finalize-incremental.mjs`、`publish-annotations.mjs`、`apply-verification.mjs`、`mark-dirty.mjs`）、领域图与 Figma 合并、Python 的 `merge-subdomain-graphs.py` 也各自整份写回。
- **读取：** `project-service.mjs`（MCP）、语义缓存相关脚本、增量准备、新鲜度检查、hooks、`deploy/` 都是整文件读成字符串再 `JSON.parse`。core 的 `loadGraph` 只有 `lazy-analyze.mjs` 一个调用方，`saveGraph` 没有调用方。
- **事实摘要：** `build-fact-graph.mjs` 把 `canonicalizeForDigest({nodes, edges, coverage, gaps})` 整份 stringify 后求 sha256。`canonicalizeForDigest` 只做递归键排序，数组顺序不变。
- **结构抽取结果：** `structure-all.mjs` 整份 `JSON.stringify(output, null, 2)` 写出；`lazy-analyze.mjs`、`annotate-graph.mjs`、`build-source-index.mjs`、`build-fact-graph.mjs` 整份读入。
- **先例：** `source-index.jsonl`（`source-index-store.mjs`）已按行存储，包括：
  - 分块同步读取，用 `StringDecoder` 处理跨块的多字节字符；
  - 文件头与记录数校验，失败关闭；
  - 往返严格深度相等的测试。
- **动机数据：** 见 proposal.md。

## Goals / Non-Goals

**Goals:**
- 图谱、事实摘要、结构抽取结果的读写都不再需要与仓库大小成正比的单个字符串。
- 内存中的图对象、节点与边的字段不变；`factsDigest` 的值不变；source index 的文件逐字节不变。
- 读写只有一份 JS 实现；Python 保留一份按字面复制契约的实现。

**Non-Goals:**
- 不解决进程堆内存上限（见 Risks 1）。
- 不给 MCP 加解析结果缓存。
- 不在格式内部用序号引用节点来缩小磁盘占用。
- 不兼容旧文件。

## Decisions

**D1：记录布局。** 紧凑 JSON，一行一条：

```
{"record":"header","format":"excavator-knowledge-graph-lines/1","keys":[<根级字段名，原顺序>],"fields":{<非记录流的根级字段>},"counts":{"nodes":N,"edges":M,…}}
{"record":"node","node":{…}}          × N，原数组顺序
{"record":"edge","edge":{…}}          × M
{"record":"layer","layer":{…}}        × L
{"record":"tour","step":{…}}          × T
{"record":"coverage","coverage":{…}}  图有 coverage 时一条
{"record":"gap","gap":{…}}            × G
```

- **记录流的顺序：** 按 `keys` 的顺序写出，流内按原数组顺序。
- **文件头三部分：**
  - `keys` 记下根级字段的原始顺序。读回的图字段顺序不变，读后再写与原文件逐字节相同，「语义写入后图谱 SHA-256 不变」这类约束继续成立。
  - `fields` 带全部非记录流的根级字段（`version`、`project`、`kind`、`contentLanguage`、`languageAudit` 及任何其它字段）。只关心新鲜度的读取方（领域图新鲜度、runner 的 `planFullRun`）只读第一行。
  - `counts` 只列图里存在的记录流。缺 `coverage`/`gaps` 的旧形状因此能往返严格相等。
- **读取校验：**
  - 第一行必须是格式匹配的文件头；
  - `keys` 中每个非流字段在 `fields` 里有值；
  - 各流记录数等于 `counts`，coverage 记录恰好与 `keys` 一致；
  - 记录类型未知、记录属于未列出的流、或出现重复文件头即失败。
- **具名错误** `KnowledgeGraphFormatError`；`project-service` 把它映射为无效产物缺口。
- **根级字段一律用 `defineProperty` 还原**，名为 `__proto__` 的字段成为普通自有属性。

备选：
- 只去缩进、删可推导字段。只是把悬崖推远，删 evidence/provenance 还违反证据规格，所以不选。
- 分片成多个整文档。每片仍有上限，而且读取方要处理分片集合，所以不选。
- 流式 JSON 解析器。要新增依赖或自写分词器，而读取方都是同步调用链，所以不选。
- SQLite。新依赖，grep、jq、Python 和 skill 散文全部失效，所以不选。

**D2：模块。**
- 新增 `skills/excavator/jsonl-lines.mjs`：从 `source-index-store.mjs` 抽出分块按行读取，两个存储共用；source index 行为与输出逐字节不变。
- 新增 `skills/excavator/knowledge-graph-store.mjs`，提供：
  - 文件名常量：`KNOWLEDGE_GRAPH_FILE='knowledge-graph.jsonl'`、`LEGACY_KNOWLEDGE_GRAPH_FILE='knowledge-graph.json'`；
  - `writeKnowledgeGraph(path, graph) → {bytes, lines, maxLineChars}`、`readKnowledgeGraph(path)`、`readKnowledgeGraphHeader(path)`；
  - 具名错误 `KnowledgeGraphFormatError`。
- 新增 `skills/excavator/structure-all-store.mjs`：文件头为 `results` 以外的全部顶层键加 `resultCount`，其后每个结果一行。
- 实现放在 skills 而不是 core：同步、不依赖 core 构建产物的读取方都在 skills 侧。core 的 `loadGraph`/`saveGraph` 连同其测试删除，其余持久化函数不动。

**D3：增量事实摘要。** 按 `canonicalizeForDigest` 的键序，把 `{"coverage":…,"edges":[…],"gaps":[…],"nodes":[…]}` 逐段送入 `hash.update`：
- 每条节点、边、缺口记录各自规范化后再序列化；
- 输入字节与原来整份拼接的文本逐字节相同，所以摘要值不变。

原来的整份算法留在测试里作 oracle。单条记录超过上限时以 `ProductTooLargeError` 具名失败。

**D4：结构抽取结果按行。** 子脚本 `structure-all.mjs` 经 `structure-all-store.mjs` 写出 `intermediate/structure-all.jsonl`，四个读取方经同一模块读入。它是中间产物，旧的 `structure-all.json` 在写出新文件时删除。

**D5：发布与零兼容。**
- `lazy-analyze.mjs` 的暂存发布增加 `writeKnowledgeGraph` 接缝，图谱产物名改为 `knowledge-graph.jsonl`，发布成功后删除旧 `knowledge-graph.json`。
- `PIPELINE_VERSION` 升为 `lazy-fact-graph/3`。
- `intermediate/fact-graph.json` 改为经图谱模块写出 `intermediate/fact-graph.jsonl`。
- 只剩旧文件时，`project_status` 报告 `missing-product` 并标明旧产物存在（`legacyProductPresent`）。

**D6：余量报告。**
- 按行产物报告最长单条记录（`recordMaxRecord`）；`source-index.jsonl` 也进余量表。
- 整份摘要文本不复存在，余量表里不再有这一项。

**D7：Python。** `merge-subdomain-graphs.py` 保留约 20 行的按行读写，契约与 D1 相同。加一个跨实现测试：JS 写出 → Python 合并 → JS 读回，与预期严格相等。

**D8：散文与 grep 门。** skill、agent、hooks 提示与 docs 里的旧文件名、内联整文件读取代码和 jq 示例全部改写。验收用 grep 门：`skills/ agents/ hooks/ docs/ deploy/` 中 `knowledge-graph.json`（非 `.jsonl`）只允许出现在「旧文件已废弃、不读」的陈述里。

## Risks / Trade-offs

1. **[下一道上限是进程堆内存，不是字符串。]**
   - 默认堆上限：本机 Node 默认 4,144 MB；`deploy/Dockerfile` 设了 `--max-old-space-size-percentage=75`，本地 CLI 与 MCP 没有设。
   - 实测：把 hadoop 图谱解析成对象后常驻堆约 1,280 MB（强制 GC 前后 `heapUsed` 之差）。
   - 改前 hadoop 在默认堆下能跑完：141 秒，最大常驻内存 3,638,018,048 字节（约 3.6 GB），macOS 峰值内存占用 5,141,252,032 字节，已接近 4,144 MB 的默认堆上限。Java 成员调用变更会再增加结构抽取结果与边，很可能在默认堆下内存不足而崩溃；那是具名错误契约之外的无名崩溃。
   - 处理：本变更不处理堆内存，验收在默认堆下跑 hadoop 并报告最大常驻内存。Java 成员调用变更的验收同样要求 hadoop 在默认堆下成功；做不到时，先另开变更处理堆内存（例如 Lazy 用完即释放大对象、CLI 与 MCP 的入口设置堆上限），合入后 Java 变更才合入。
2. **[MCP 每次调用重新读整图。]** 逐行解析可能比一次 `JSON.parse` 慢。验收记录 MCP 各工具的前后耗时；按 manifest 身份缓存解析结果作为后续项。
3. **[迁移面大。]** 漏改的代码会报文件不存在或缺失产物，失败是响亮的；漏改的散文只在模型行为里暴露，所以用 D8 的 grep 门守住。
4. **[零兼容的代价。]**
   - 旧图谱里由老 Full 流程写进节点的 summary/tags 不会带入新文件，需要重跑 Full；
   - `semantic-cache.json`、`semantic-graph.json`、`domain-graph.json` 不受影响；
   - 已有项目重跑一次 Lazy 即可，零模型。
5. **[Python 第二份实现会漂移。]** 由 D7 的跨实现测试守住。
6. **[单条记录仍有理论上限。]** 实测 hadoop：图谱最长记录 14,282 字符（0.0027%）；源码索引最长的一条倒排记录占 0.22%，长度与该词出现的代码块数成正比，约需再大 450 倍才触顶；结构抽取结果一行是一个文件（最长 0.10%，Fineract 的一个大文件为 0.72%），受单文件大小上限约束，与仓库大小无关。仍按「没有第四态」报告每个按行产物的最长记录，超限时具名失败。
7. **[Full 与增量发布脚本少在真实语料上运行。]** 由 `tests/full/*` 与 `tests/lazy/lazy-to-full-e2e.test.mjs` 守住，验收时全量门必须全绿。

## Migration Plan

合入后，已有项目下一次 Lazy 发布写出 `knowledge-graph.jsonl` 并删除旧文件；在此之前，读取方把图谱报告为缺失，提示重跑。回滚即 revert 本 PR；回滚后旧格式代码会重建 `knowledge-graph.json`，残留的 `.jsonl` 无人读取。

## 验收

1. **往返：** 夹具（含无 coverage/gaps 的旧形状，含分层、导览、summary 的 Full 形状）与 hadoop 图谱副本，读回与原图严格深度相等。
   - 先验证比较器：改动单个字段时判为不等。
   - 同一图写两次逐字节相同。
   - 分块大小设为几字节时，含中文与 emoji 的记录仍相等。
2. **摘要不变，零重冻：** 以下 factsDigest 与改前相同（来源：本地 `excavator-test-runs/java-call-baseline/before/*.factsDigest`）；所有夹具的固定摘要不变，任何摘要变化即缺陷。

   | 语料 | 改前 factsDigest |
   |---|---|
   | hadoop | `0cef418fc6fa1caad32c02085b3e3dfe47467d31cdfba238bec730f9581455e7` |
   | Fineract | `dc5b25674919f8241bc210744712acbce8fa90002cb90f0080dc32b513023d8f` |
   | wcp-auth | `cb6ea0b51a87972e290b69f1550973143817427cd2b05c5a31e5b3b2555429a7` |
   | wcp-service-v2 | `e1833975bf5dafcf5c98eb7bbee45b3b0e164c723575524cf565ac5712f6f868` |
   | cebreo/unmc | `b6f10267c77d59188eff92edcfe90ec2ced3ce770bfafefed38ee5d3444881c8` |
   | cebreo/uneeg-managementportal | `f22350702217746c135d5daab325105795de84c54c2e9e49f228975a0c112d26` |
3. **MCP 等价：** 在 wcp-auth 上，改前与改后经 stdio 调用全部 7 个工具，去掉耗时与快照字段后逐项相同；hadoop 上 `deploy/mcp-smoke.mjs` 通过；记录各工具前后耗时。
4. **上限绊线（先验装置）：** 注入一个很小的上限（如 2,000 字符）。
   - 整图超限但最长记录不超限的夹具：发布成功，余量表按最长记录列出 `knowledge-graph.jsonl`。
   - 单条记录超限的夹具：以 `ProductTooLargeError` 具名失败，最终产物逐字节不变。
5. **原子发布：** 暂存发布的故障注入覆盖新的写入接缝，最终产物哈希不变、无暂存残留。
6. **hadoop 真实运行：**
   - 完成且确定性校验通过；
   - 余量表中没有任何按字符计的条目达到 50%；按行产物逐一报告最长记录。图谱的最长记录低于 0.01%；源码索引与结构抽取结果的最长记录分别受词频与单文件大小约束（见 Risks 6）。原稿写的是「三个按行产物都低于 0.01%」，实测前定得过严，偏差记录在 tasks 8.3；
   - 总耗时不超过改前（138 秒）的 1.2 倍；
   - 在默认堆（不设 `--max-old-space-size`）下再跑一次：必须成功，报告最大常驻内存，与改前的 3,638,018,048 字节对比。
7. **零兼容：** 只含旧 `knowledge-graph.json` 的数据目录，`project_status` 不可用，并带 `missing-product` 与 `legacyProductPresent`；一次发布后旧文件消失。
8. **Python：** JS 写出的基图与子域图经 `merge-subdomain-graphs.py` 合并后，JS 读回与预期严格相等。
9. **全量门：**
   - `pnpm install --frozen-lockfile && pnpm -r build && pnpm test`、core 测试、`pnpm typecheck`、Python 单测、`node scripts/check-refs.mjs`、`openspec validate --all --strict` 全绿（`pnpm lint` 在 main 上即因缺少 ESLint 配置无法运行，不列入）；
   - D8 的 grep 门通过。
