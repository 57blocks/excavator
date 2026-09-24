## Context

动机见 proposal.md。现状里与方案直接相关的约束：

- Lazy 首跑的发布（`lazy-analyze.mjs` 的 `publish`）按顺序直接写最终位置：`knowledge-graph.json`（core `saveGraph`，`JSON.stringify(…, null, 2)`）→ `fingerprints.json`（子进程输出原样写入）→ `source-index.json`（带缩进整体 stringify）→ `meta.json` → `source-manifest.json`（含 `snapshot.entries()` 的逐文件哈希）。只有 `saveGraph` 包在 try 里，其余任一步抛错都会冒泡成无名异常，并留下已写的前几个产物。
- 读取也受同一上限约束：`readFileSync(path, 'utf-8')` 读出的字符串超过 536,870,888 字符同样失败。所以**只把写入改成流式、读取仍整文件解析，只是把悬崖挪到读取侧**。
- source index 的读取方：MCP `project-service.mjs`（`readJsonProduct`）、`sync-fact-graph.mjs`（读上一版做增量）、`build-source-index.mjs` CLI（`--previous`）、`excavator-chat` skill 里的内联 `JSON.parse(readFileSync(...))`、若干测试。检索只通过 `bm25Search(index, terms)` 使用内存结构：`postings[term]` 为 `{chunkId, tf}` 数组、`docLengths[chunkId]`、`avgDocLength`、`N`、`k1`、`b`、`chunks`。
- 内存结构的两个细节决定了「严格相等」能否成立（原型实测踩到）：`postings` 经 `sortObjectKeys` 成为按键排序的**普通对象**；`docLengths` 是**无原型对象**（`Object.create(null)`）。分词只产出 `[a-z0-9]+`，普通对象不会遇到 `__proto__` 之类的键。
- `factsDigest` 只对规范化后的 `{nodes, edges, coverage, gaps}` 求哈希，不含 `pipelineVersion` 与项目元数据——升级版本号不改变它，可以作为「事实没变」的验收依据。
- 语义缓存模块不读 `pipelineVersion`，按节点与源码哈希判定新鲜度。

Hadoop 实测的各产物余量（占 536,870,888 字符上限）：

| 产物 | 规模 | 占上限 |
|---|---|---|
| source index，现写法（带缩进） | 1,360,390,833 字符 | 253% |
| source index，去掉缩进 | 1,128,601,754 字符 | 210% |
| `knowledge-graph.json`（带缩进） | 323,546,499 字节 | ≈60% |
| `intermediate/fact-graph.json`（带缩进） | 323,544,868 字节 | ≈60% |
| 事实摘要输入（紧凑，进程内） | 约 266,273,876 字符 | ≈49.6% |
| `intermediate/structure-all.json`（子脚本写） | 232,051,489 字节 | ≈43% |

## Goals / Non-Goals

**Goals:**
- Hadoop 固定提交上的 Lazy 首跑完成且校验通过；事实层与改动前逐位相同。
- source index 的读写彻底不受单字符串上限约束，而不是把上限推远。
- 发布对「写失败」全有或全无，恢复与现行 spec 的一致。
- 其余仍是整文档的产物：上限可见（报告余量），超限时具名、带数字、在改动任何最终产物之前失败。
- Lazy 自报快照阶段耗时，外部不必再靠采样推算。

**Non-Goals:**
- 不改 `knowledge-graph.json` 的格式（读取方包括 Python 脚本与 skill 提示词，另起 change）。
- 不改子脚本（结构抽取、import 映射、指纹）的写法，只报告它们的字节数。
- 不优化索引载入的内存或速度（例如按查询词懒加载倒排表）——载入后的内存结构保持与现在相同。
- 不处理快照层逐文件起子进程的性能、项目名取自临时目录、Java 重载身份冲突。

## Decisions

### D1 source index 改为按行的 JSON Lines：`source-index.jsonl`

一行一条记录，顺序固定：

```
{"record":"header","format":"excavator-source-index-lines/1","sourceRevision":"…","k1":…,"b":…,"N":…,"avgDocLength":…,"chunkCount":…,"termCount":…,"filesIndexedCount":…,"filesContentUnavailableCount":…}
{"record":"file-indexed","path":"…"}                     ← filesIndexed 原顺序
{"record":"file-content-unavailable","path":"…"}         ← filesContentUnavailable 原顺序
{"record":"chunk","docLength":37,"chunk":{…原 chunk 对象…}}  ← chunks 原顺序，序号即行内位置
{"record":"posting","term":"block","chunks":[12,40,…],"tf":[3,1,…]}  ← 词项升序
```

- 倒排表用 chunk 序号加平行的 `tf` 数组，不再为每条 posting 重复块 ID。chunks 按 id 排序、posting 按 chunkId 排序，所以同一词项的序号严格递增——读取时据此校验。
- chunk 对象原样嵌在 `chunk` 字段里，`docLength` 放在外层，避免与 chunk 字段冲突。
- 原型在 Hadoop 真实索引上实测：274,232,832 字节、234,855 行、最长一行 1,172,616 字符（占上限 0.22%），写 2.7 秒、读 1.7 秒，读回与构建产物 `isDeepStrictEqual` 为真；比较器先用改动一个字段的样本证明看得见差异。
- 最长的行是最常见词项的倒排表，长度与该词项出现的 chunk 数成正比。按 Hadoop 的比例线性外推，单行要到约 450 倍 Hadoop 的规模才会接近上限，所以这里不再设防。

**备选：**
- 只去缩进：实测仍是上限的 210%，否决。
- 序号引用但仍是单个 JSON 文档：按原型实测的各部分大小估算约为上限的一半，只是把悬崖推到约 2 倍 Hadoop 的规模；调大上限不等于消除上限，否决。
- 拆成多个 JSON 分片：同样有界，但多文件、增量更新与读取方都要处理分片，复杂度更高，否决。
- 引入流式 JSON 解析依赖：新增运行时依赖，且读取方要全部改成异步，否决。

### D2 读取器是同步的，按块读并切行

调用方（MCP `project-service`、sync 路由、CLI、skill 内联代码）都是同步使用索引。读取器用固定大小的块（如 4 MB）`readSync`，经 `StringDecoder('utf8')` 处理跨块的多字节字符，按 `\n` 切行、逐行 `JSON.parse`。它与流式异步读取一样不需要大字符串，但不必把 MCP 服务的调用链改成异步。

读取时校验：第一行必须是 `format` 匹配的文件头；chunk、词项、两类文件记录的实际数量必须等于文件头声明；每条 posting 的 `chunks` 与 `tf` 等长、序号在 `[0, chunkCount)` 内且严格递增；出现未知 `record` 即失败。任何一项不通过都抛具名的格式错误，调用方映射成可见缺口，绝不返回部分索引。重建的对象形状与构建产物完全一致（`postings` 普通对象、`docLengths` 无原型、posting 条目为 `{chunkId, tf}`）。

### D3 读取方与缺口映射

| 读取方 | 改动 | 缺失 / 无效时 |
|---|---|---|
| MCP `project-service` | 用新读取器替换 `readJsonProduct('source-index.json', 'chunks')` | `missing-product`（product 为 `source-index.jsonl`；只找到旧文件时附带说明）/ `invalid-product` + reason |
| `sync-fact-graph` 读上一版 | 用新读取器 | 与现在一致：视为没有上一版，退回全量重建 |
| `build-source-index` CLI | 读 `--previous`、写输出都用新的读写器 | 报错退出 |
| `excavator-chat` skill | 内联代码改为导入新读取器；降级判断改为检查 `source-index.jsonl` | 按现有的诚实降级处理 |

旧 `source-index.json` 一律不读（零兼容）；发布成功后删除。

### D4 发布改为「全部暂存 → 按序替换 → 失败回滚」

1. **暂存**：在 `.excavator/` 内建 `.publish-staging-<pid>-<随机>/`，按原顺序把五个最终产物完整写进去（图谱经 core 导出的净化函数处理后走 D5 序列化；fingerprints 原样；索引走 D1 写入器；meta、manifest 走 D5）。任一步失败：删暂存目录，记录具名的 `saveError`，最终位置不动，`metaAdvanced` 为 false。
2. **替换**：按 graph → fingerprints → source-index → meta → manifest 的顺序，对每个产物先给现有最终文件建一个硬链接备份到暂存目录的 `previous/` 下（硬链接不可用时退回复制），再用 `rename` 把新文件原子地覆盖到最终位置。这样最终路径上任何时刻都有一个完整文件，与发布并行运行的读取方（例如 MCP server）不会读到「产物缺失」。任一步失败：倒序撤销已完成的步骤（把 `previous/` 里的备份 rename 回最终位置；本来就不存在的产物则删除新文件），然后按第 1 步的失败处理。
3. **收尾**：删除残留的旧 `source-index.json`，删除暂存目录。

暂存目录与最终位置在同一目录树下，rename 是同文件系统的原子操作。manifest 最后替换，它就是提交点：消费方按 manifest 判断新鲜度。进程在替换阶段被强杀属于残留风险（见下文）。下一次发布开始时，清理同前缀、且对应进程已不存在的暂存目录。

core 的改动只有一处：导出 `saveGraph` 内部已有的路径净化步骤，供暂存发布复用；`saveGraph` 本身的行为不变（它在 skill 中唯一的调用方就是 `lazy-analyze`）。

**备选：** 逐个文件「写临时文件再 rename」但不回滚——中途失败会留下混合版本，否决；整目录替换——`.excavator/` 里还有语义缓存、配置、domain 图谱与中间产物，否决。

### D5 统一的整文档序列化辅助

新增 `product-serialization.mjs`，提供 `serializeJsonProduct(name, value, { indent })`：
- 成功：返回字符串，并记录 `{product, chars, limit, percentOfLimit}`。
- `JSON.stringify` 抛 `RangeError`：用递归累加长度的方式（不建串）算出所需字符数，抛具名的 `ProductTooLargeError`，带 `product`、`requiredChars`、`limitChars`。
- 上限取自 `buffer.constants.MAX_STRING_LENGTH`（Node 22.16 上为 536,870,888）；测试可以注入更小的上限来触发失败路径。

成功路径没有额外开销：只有失败时才做那次长度累加。覆盖范围是 Lazy 路径里所有进程内的整文档 stringify：`knowledge-graph.json`、`meta.json`、`source-manifest.json`、`lazy-analyze` 自己写的中间产物，以及 `build-fact-graph` 计算事实摘要时拼的那一份（余量条目随投影返回）。子脚本输出（`structure-all.json`、`import-map.json`、`fingerprints.json`）由 `lazy-analyze` 在子进程结束后 `stat` 取字节数（字节数 ≥ 字符数，是保守上界）。

`knowledge-graph.json` 继续带缩进：改成紧凑格式会让它变成一整行 200 MB 以上，破坏 skill 与人工用的逐行查看（`grep`/`head`）；我们选择保留格式、让余量可见。

### D6 版本号与旧数据

`PIPELINE_VERSION` 从 `lazy-fact-graph/1` 升到 `lazy-fact-graph/2`，已有项目下次运行时 manifest 不匹配，触发一次零模型重建，写出 `.jsonl` 并删除旧文件。测试夹具改为导入常量，不再写字面量。

### D7 计时自报

新增 `snapshotResolve`（`resolveSourceSnapshot`）、`snapshotMaterialize`（从进入 `runGuarded` 到 `produce` 开始）、`manifestEntries`（`entries()` 的逐文件哈希，属于 save）。`timings.total` 改为 `runLazyAnalysis` 的墙钟时间。已有阶段名不变（现有测试没有断言 `timings`）。CLI 在现有汇总行之外，再打印各阶段耗时和按百分比排序的序列化余量。

## Risks / Trade-offs

- [索引载入的内存与现在相同（posting 对象数量不变）] → 在 300 万行规模可接受（失败那次主进程峰值 2.8 GiB，原型读回加比较的峰值 2.7 GiB）；按词项懒加载列为后续优化。
- [替换阶段进程被强杀，留下混合版本] → 窗口只有 5 次 rename；manifest 最后替换，若它没换，消费方会按旧 revision 判断新鲜度并触发重建；残留暂存目录由下一次发布清理。
- [`knowledge-graph.json` 约 60%、事实摘要输入约 50%，按 Hadoop 密度线性外推约在 500 万～600 万行撞上] → 本次让它们可见并具名失败；边和节点重复存长 ID，与倒排表同一模式，紧凑图谱格式另起 change。
- [子脚本输出（`structure-all.json` 约 43%）超限时仍是子进程无名退出] → 只报告字节数，不在本次改。
- [重跑 Hadoop 会变慢] → 发布阶段第一次真正执行 `entries()`，按探针 11.1 ms/文件推算约 3 分钟，整次运行预计约 19 分钟；快照批量读由另一个 change 处理。
- [按块切行对多字节字符的处理] → 用 `StringDecoder`；测试用很小的块，覆盖中文和 emoji 恰好跨块的情况。
- [输出必须确定] → 同一索引写两次必须逐字节相同，列为测试。

## Migration Plan

- 合入后每个项目下次运行（CLI 或 MCP `sync_facts`）都会做一次零模型的事实层重建；语义缓存不受影响。
- 回滚：revert 本 PR 后版本号回到 `/1`，已按 `/2` 写的 manifest 变为不匹配，再触发一次重建并写回旧格式——两个方向都不需要手工迁移。

## 验收 Oracle（动手前写死）

- **O1 往返**：夹具索引、conduit（固定提交 `5e127d85`）与 Hadoop 的索引持久化后读回，`isDeepStrictEqual` 为真；比较器必须先证明能看见单字段差异。
- **O2 检索等价**：在 conduit 上用一组固定检索词，分别用 `main`（旧实现）与新实现调用 MCP `recall`，去掉快照与耗时字段后逐项相同。
- **O3 事实不变**：Hadoop 新跑的 `factsDigest` 等于失败那次已写出的 `88c3219d31de0315e87fb4303fed5fa0bced8faae9ebb940dcc0233c13c5eae7`；wcp、cebreo 的副本上新旧实现的 `factsDigest` 相同（不动用户语料现有的 `.excavator/`）。
- **O4 原子发布**：故障注入覆盖暂存阶段的每个产物与替换阶段的每一步，`.excavator/` 最终产物逐字节不变，且无暂存残留。
- **O5 具名失败**：注入更小的上限触发失败，错误含产物名、所需字符数与上限，最终产物不变。
- **O6 规模**：Hadoop Lazy 首跑完成、确定性校验通过，五个最终产物齐全，`source-index.jsonl` 可读回；输出含余量报告与 `snapshotResolve`/`snapshotMaterialize`/`manifestEntries`，`total` 与外部量得的墙钟相差不超过 2 秒。
- **O7 全量门**：`pnpm install --frozen-lockfile && pnpm -r build && pnpm test` 全绿，`openspec validate --strict` 通过。
