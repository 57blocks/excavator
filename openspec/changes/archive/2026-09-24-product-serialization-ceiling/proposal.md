## Why

在 apache/hadoop（固定提交 `2014707f8c31`，16,575 个跟踪文件、2,985,706 行 Java）上，零模型的 Lazy 首跑跑了 949 秒后在发布步骤崩溃：`source-index.json` 被 `JSON.stringify(…, null, 2)` 一次性序列化成单个字符串，超过 V8 单字符串上限（536,870,888 字符），抛 `RangeError: Invalid string length`。输入不变则每次都在同一处失败，这个规模的项目永远拿不到事实层产物。崩溃前 `knowledge-graph.json` 与 `fingerprints.json` 已经写入最终位置——现有实现本身违反了 `lazy-analysis` 与 `revision-sync` 已有的「保存失败不推进 fingerprints / meta」要求。

实测（从这次运行的中间产物重建索引、递归累加 JSON 长度，不真的建串）：索引带缩进是上限的 253%，去掉缩进仍是 210%，其中倒排表占 78%——每条 posting 都重复存了完整的块 ID 字符串；同一次写成功的 `knowledge-graph.json`（323.5 MB）已到上限的 60%。用户要验证 excavator 能分析约 300 万行、17 年以上的 Java 项目，这是第一个硬阻塞。

## What Changes

- **BREAKING** source-index 改为按行流式持久化：`.excavator/source-index.jsonl`，一行一条记录（头 / 文件 / 块 / 词项），倒排表用块序号引用而不是重复块 ID；读取端逐行解析，载入后的内存索引与构建产物**严格相等**，检索代码（`bm25Search`）不改。原型在 Hadoop 真实索引上实测：274 MB、234,855 行、最长一行占上限 0.22%，写 2.7 秒、读 1.7 秒，往返严格相等。零兼容：不读旧 `source-index.json`；`PIPELINE_VERSION` 升到 `lazy-fact-graph/2` 触发一次零模型重建（语义缓存按节点与源码哈希判定，不受影响）；发布时删除残留的旧文件。
- 发布改为「先全部暂存、后按序替换」：全部产物先写进 `.excavator/` 内的暂存目录，全部成功后按 graph → fingerprints → source-index → meta → manifest 的顺序 rename 到位，manifest 最后作为提交点；任一产物序列化失败时，最终位置的文件一个都不动。
- 整文档 JSON 产物（`knowledge-graph.json`、meta、manifest 与 Lazy 自己写的中间产物）统一经过一个序列化辅助：成功时记录字符数与占运行时上限（`buffer.constants.MAX_STRING_LENGTH`）的百分比；超限时抛具名错误，给出「需要 N 字符、上限 M」。Lazy 运行结果与 CLI 输出报告每个产物的余量。
- 补 snapshot 阶段耗时自报：快照解析、快照复制、manifest 逐文件哈希分别计时；`timings.total` 改为墙钟时间（现在是各阶段之和，漏掉了 Hadoop 上占 87% 的快照时间，违反 `lazy-analysis` 已有的分阶段计时要求）。
- 更新所有读取方：MCP `project-service`、`sync-fact-graph` 的增量路径、`build-source-index` CLI、`excavator-chat` skill 里的内联读取代码、测试夹具。

**不在本次范围**（各自另起 change）：`knowledge-graph.json` 保持整文档 JSON——它的读取方很多（含 Python 脚本与 skill 提示词），本次只让它的上限可见、超限具名失败；按 Hadoop 密度线性外推约 500 万行会撞上。快照层逐文件起子进程的性能；子脚本（结构抽取、import 映射）各自写出的中间 JSON 只报告字节数、不改写法；这次还发现的项目名取自临时目录、Java 重载身份冲突两个问题。

## Capabilities

### New Capabilities

- `product-serialization`: 整文档产物序列化的余量报告与超限具名失败——每个产物报告占运行时单字符串上限的比例，超限时在写入任何最终文件之前以具名错误失败，并给出需求与上限两个确定性数字。

### Modified Capabilities

- `source-index`: 持久化从单个 `source-index.json` 改为按行的 `source-index.jsonl`，增加「持久化不受单字符串上限约束、往返无损」的要求。
- `revision-sync`: 「原子保存」明确为暂存后按序替换，失败时覆盖到全部最终产物（图谱、索引、fingerprints、meta、manifest），而不仅是元数据。
- `lazy-analysis`: 保存失败不前进的产物清单补上图谱与索引；性能观测要求总耗时为墙钟、快照阶段必须计入，并报告产物序列化余量。

## Impact

- **代码**：新增 `skills/excavator/source-index-store.mjs`（按行读写）与 `skills/excavator/product-serialization.mjs`（序列化辅助）；改 `lazy-analyze.mjs`（暂存发布、计时、余量报告、版本号）、`build-source-index.mjs`（CLI 读写）、`sync-fact-graph.mjs`（读上一版索引）、`project-service.mjs`（MCP 读索引）、`packages/core/src/persistence/index.ts`（导出图谱保存前的净化步骤，供暂存发布复用）。
- **Skill 与文档**：`skills/excavator-chat/SKILL.md` 的内联读取代码与降级判断改用新读取器与新文件名；`skills/excavator/SKILL.md`、`docs/lazy-mode-plan.md` 中的文件名。
- **测试**：`tests/mcp/fixture.mjs`、`tests/mcp/project-service.test.mjs`、`tests/lazy/source-index-pipeline.test.mjs`、`tests/lazy/lazy-to-full-e2e.test.mjs`、`tests/retrieval/build-source-index.test.mjs`，以及新增往返、原子发布、具名失败的测试。
- **数据**：所有已有项目在下次运行时做一次零模型的事实层重建；不新增运行时依赖。
- **AI-first 范围判定**：这是持久化契约与运行时上限问题，skill / prompt 无法在运行时可靠绕过——产物由确定性脚本写入，崩溃发生在任何模型参与之前，所以必须落在代码里。
