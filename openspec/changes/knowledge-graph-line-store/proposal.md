## Why

`knowledge-graph.json` 是一个整文档 JSON。写入时整图先 stringify 成一个字符串，读取时整个文件读成一个字符串再 `JSON.parse`。V8 单个字符串最长约 5.37 亿字符（`buffer.constants.MAX_STRING_LENGTH`），所以能分析的仓库大小有一个硬上限。`product-serialization` 让超限变成了具名失败，但上限本身还在。

本地实测 apache/hadoop（2014707f8c31，约 300 万行，main 19391644）：

| 产物 | 占单字符串上限 |
|---|---|
| `knowledge-graph.json` | 80.19%（430,541,060 字符） |
| 计算事实摘要时拼出的整份文本 | 66.32% |
| `structure-all.json` | 45.41%（磁盘字节） |

产物大小随代码量增长。比 hadoop 大约四分之一的仓库，现在就会以 `ProductTooLargeError` 失败。接下来的 Java 成员调用解析（`java-member-call-resolution`）会给 hadoop 增加十几万条调用边：

- 每条约 700 字符，只要再加约 14 万条，图谱就超限；
- 每个调用点要带上接收者描述，`structure-all.json` 会推到 80% 以上。

缩进、删字段只能把悬崖推远。删字段还违反「每条边带 provenance 与 evidence」的证据规格。需要让上限不再与仓库大小相关。

## What Changes

- **图谱改为按行存储：** `.excavator/knowledge-graph.json` 改为 `.excavator/knowledge-graph.jsonl`。
  - 第一行是文件头，带全部根级标量字段与各类记录的计数；
  - 其后每行一条记录：节点、边、分层、导览、coverage、缺口。
  - 读回的内存图与写入前严格深度相等，节点与边的字段一律不变。
  - 读取时校验文件头、记录数与记录类型；不符即以具名错误失败，绝不返回部分图。
- **新增共享模块：** 唯一的读写模块 `skills/excavator/knowledge-graph-store.mjs`；按行分块读取从 `source-index-store.mjs` 抽出为共享模块，source index 的输出逐字节不变。
- **事实摘要改为逐条累加哈希：** 输入与原来整份拼接的文本逐字节相同，所以 `factsDigest` 的值不变，固定摘要不需要重冻。
- **结构抽取结果同样改为按行：** `intermediate/structure-all.json` 改为 `intermediate/structure-all.jsonl`。中间产物 `intermediate/fact-graph.json` 也改走图谱模块写出。
- **只认新格式：**
  - 读取方不读旧的 `knowledge-graph.json`，旧文件在的情况报告为缺失产物；
  - 新产物发布成功后删除旧文件；
  - Lazy 的 `pipelineVersion` 升为 `lazy-fact-graph/3`。
- **序列化余量改按单条记录报告：**
  - 按行产物报告最长单条记录占上限的比例；只有单条记录超限才具名失败。
  - `source-index.jsonl` 也进入余量表。
  - 整份事实摘要文本不再存在，余量表里不再有这一项。
- **迁移所有读写方：** 所有读写图谱或结构抽取结果的代码、测试与散文（skill 说明、agent 说明、hooks 提示、docs）改用新文件与新模块。删除 core 中只有一个调用方的 `loadGraph` 和没有调用方的 `saveGraph`。Python 合并脚本保留自己的按行读写，并用跨实现测试守住。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fact-graph`：新增「图谱持久化不受单字符串上限约束且往返无损」；「canonical 事实不可被模型回写」改用新文件名。
- `product-serialization`：余量与超限改为按单条记录计；事实摘要不再拼整份文本。
- `facts-audit`、`full-semantic-isolation`、`lazy-analysis`、`revision-sync`、`semantic-cache`、`canonical-semantic-language`：要求与场景中的文件名改为新文件。

## Impact

- **代码：**
  - 约 24 个读写图谱的文件，包括 `lazy-analyze.mjs`、`project-service.mjs`、增量与 Full 的发布脚本、领域图与 Figma 合并、`deploy/`、`hooks/`；
  - 5 个读写 `structure-all` 的文件；
  - core `persistence`。
- **测试：** 约 32 个直接读写图谱文件的测试改用新模块。
- **散文：** skill、agent、hooks 提示与 docs 中提到旧文件名的地方，包括 jq 示例与内联读取代码。
- **产物：**
  - 已有项目的 `.excavator/` 需要重跑一次 Lazy（零模型）；
  - 旧图谱里由老 Full 流程写入的 summary/tags 不会带入新文件，需要重跑 Full；
  - `semantic-cache.json`、`semantic-graph.json`、`domain-graph.json` 不受影响。
- **不在范围内：**
  - 进程堆内存上限，见 design「Risks」；
  - MCP 每次调用重读整图的性能；
  - 在新格式内部用序号引用节点以缩小磁盘占用。
