每组：先写失败验收 → 实现 → 验证 → 单独 commit。合成夹具用 purpose-built 项目；真语料（wcp）与真 provider 验收 opt-in、产物/gold/路径不提交。CODE 与测试用英文，本 openspec 用中文。**第 1 组是决策闸——不过闸不建全量索引。**

## 1. 召回原型 / 决策闸（先做）

- [x] 1.1 在 `eval/` 下搭一个 opt-in 原型：一小组 wcp 中文业务问题 + 人工标注 gold（文件/符号），本地不提交。用「标识符子词拆分 + BM25 + 一次 LLM 查询扩展」跑，测 top-20 是否含 gold（§12.3.1）。验证：产出召回率数字与命中/未命中清单。
- [x] 1.2 决策并记录：达标 → 词法方案（第 2 组）；不达标 → 本切片改用向量召回（chunk embedding + 近邻），spec 召回门不变、只换实现。把结论写入变更记录（design Open Question 收口）。验证：一条明确的 go/pivot 决策 + 依据数字。

## 2. source-index（词法索引）

- [x] 2.1 写验收（先红）：chunk 带 path/owner/symbol/lineRange + 标识符子词 + 注释 + 字符串；BM25 对检索词返回按分排序候选；按 sourceRevision 持久化；单文件变化只重建该文件 chunks（零模型）。验证：`tests/retrieval/` 先红。
- [x] 2.2 实现 `skills/excavator/build-source-index.mjs`：从 `structure-all` 切 chunk + 子词/注释/字符串；建 BM25 倒排；写 `source-index.json`；接入 `sync-fact-graph` 做单文件增量。验证：2.1 全绿。

## 3. 混合检索机制（确定性原语）

- [x] 3.1 写验收（先红）：候选合并排序（精确 id/symbol/path + BM25 + 源码搜索 + 有效语义缓存文本）；有预算遍历原语（1-hop / 有界 BFS ≤4 / 有界最短路 ≤6；预算 seed≤20/节点≤80/边≤160/≤12k tokens；达顶停并报告边界）；只走确定性边。验证：先红。
- [x] 3.2 实现检索/遍历确定性辅助（合并打分、BFS/最短路+预算+边界报告）。验证：Controller→Service→Handler→EventBus 夹具在预算内返回完整确定性路径（§12.3.2）；达预算停止并报告（§12.3.3）全绿。

## 4. 按需语义缓存机制（确定性部分）

- [x] 4.1 写验收（先红）：可缓存三条件校验 + 字段白名单（只 summary/tags/semanticSourceHash/provenance）；hash 新鲜度（等→复用、缺→未生成、不等→忽略）；并发 `semantic.lock`（提交时短持有）+ 重读 + 按 node source hash 的 CAS（拒绝 stale）+ 原子 rename + 陈旧锁 TTL；写入按 node id 去重；事实层 `knowledge-graph.json` SHA-256 不变；写失败不阻塞。验证：`tests/semantic-cache/` 先红（含 verify-the-instrument：注入并发 stale 写确认被拒）。
- [x] 4.2 实现语义缓存确定性模块（读写/锁/CAS/hash/白名单/去重），summary 内容由调用方（chat）注入。验证：4.1 全绿——含「可靠局部语义缓存后第二次复用」（§12.4.3）、「文件 hash 变化失效」（§12.4.4）、「并发无丢更新、拒绝陈旧」（§12.4.5）、「语义写入不改事实层」（§12.4.2）。

## 5. chat 集成

- [x] 5.1 改 `skills/excavator-chat/SKILL.md`：同一次推理做查询扩展 + 调混合检索原语 + 选遍历策略 + 按需读源生成节点局部 summary 并经缓存模块写入；`semantic-cache`/domain 命中只作 seed，进答案前回 fact graph/源码核实；结构问题仍不触发语义。验证：结构问题不触发语义（§12.3.5）用例绿；seed 回源核实（§12.3.4）用例绿。

## 6. 端到端 + 真语料 + 门禁

- [x] 6.1 合成端到端：小项目建索引 → 中文查询扩展命中 → 多跳取子图 → 按需 summary 缓存 → 第二次复用；确定性机制全绿。验证：端到端套件绿。
- [x] 6.2 opt-in 真语料 + 真 provider 验收（不提交）：wcp 上 §12.3.1 中文→英文 top-20 召回达门；抽查按需 summary 只讲该节点自身职责、零编造。记录数字与样例。验证：真跑证据（fake 全绿不顶替）。
- [x] 6.3 门禁：`openspec validate --strict hybrid-retrieval` 通过；`pnpm test` 与 typecheck 全绿；不删除/弱化既有测试；A/B 套件无回归；确认 chat 语义写入前后 `knowledge-graph.json` SHA-256 不变。
