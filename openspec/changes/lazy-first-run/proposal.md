## Why

当前 `/excavator` 在结构抽取（scan → structure-all → import-map）完成后，会立刻进入逐文件的 LLM 批处理（`file-analyzer` 等 5 类 subagent，对应 SKILL.md Phase 2/2.5/3/4/6），首次分析在真实项目上要等 1 小时以上，用户拿到任何可用产物之前必须先烧掉整仓的模型预算。事实上"文件、符号、导入、唯一可解调用、覆盖缺口"这些结构事实完全可以确定性地、零模型地先产出。本变更（Lazy 计划的切片 A）把首次运行拆成"先出确定性事实、语义按需再补"，立刻消除 >1h 的首跑等待，并为后续切片（快照抽象、检索引擎、Full 迁移）打好去重与身份地基。

## What Changes

- 新增 `analysisMode` 配置（`.excavator/config.json`，默认 `lazy`）与 `/excavator --mode=lazy|full` 单次覆盖旗标；`--full` 保留为一次性别名。
- 新增 **Lazy 首次运行流水线**：`Resolve → Scan → Structure-All → Build Fact Graph → Deterministic Validate → Save`，**不调用任何 LLM subagent**（analyzer/verifier/assemble/architecture/graph-review 调用数为 0），不产 LLM batch、不产 HTML/Tour。
- 新增确定性 **Fact Builder**：它是对既有 `structure-all.mjs` + import-map 的**投影**，不重新解析源码。产出事实节点（file / function / class 等）、事实边（`contains`/`exports`/`imports`/唯一可解的 `calls`）、`coverage`/`gaps` 与 `factDigest`；`summary`/`tags`/`layers` 留空或确定性值；`complexity` 按非空代码行数确定性生成。不能唯一解析的引用写入 gap，绝不猜。
- 新增 **节点身份契约**：一处实现、Fact Builder 与 Chat 查缓存两侧共用的确定性 node-id 函数，满足确定性 / 跨 adapter 稳定 / 可区分维度不坍缩 / 匿名构造稳定兜底 / 与既有锚点对齐五条不变量（见 design）。它是后续按需语义缓存去重的唯一支点。
- 修改 `/excavator-chat`：新增**结构类问答路径**，对"有哪些文件/符号、某类有哪些方法、谁 import/调用谁、1-hop 邻居"直接用事实层回答；对需要职责/业务含义的**语义类问题**明确提示需 `/excavator --mode=full`（切片 C 之前 Lazy 不做按需语义）。
- 新增性能观测目标：固定 fixture `go-clean-arch` 首次 Lazy 运行总耗时目标 < 60s（观测目标，非正确性门槛）。

**非目标（本切片明确不做，留给后续切片）**：SourceSnapshot 抽象与三种 adapter、revision 增量同步（切片 B，本切片沿用现有 `gitCommitHash`/`sourceDigest`）；`source-index.json`（BM25）、查询扩展、有预算多跳遍历、按需语义缓存与并发锁（切片 C）；Full 语义物理隔离、Domain 新鲜度、其余消费 skill 迁移（切片 D）。

## Capabilities

### New Capabilities
- `node-identity`: 确定性节点身份契约——单一 node-id 函数、五条不变量、五个失败夹具；去重的唯一支点。
- `fact-graph`: 确定性事实层——对 structure-all + import-map 的投影；事实节点/边、`coverage`/`gaps`/`factDigest`；Lazy schema（空 summary/tags/layers、确定性 complexity）；LLM 不得回写 canonical 事实。
- `lazy-analysis`: `analysisMode` 配置与 `--mode` 旗标；Lazy 首次运行流水线（零 LLM subagent、零 batch）；`/excavator-chat` 结构类问答路径与语义问题降级提示。

### Modified Capabilities
（无：本切片新增的能力均为新 capability；不改动 `data-directory` / `plugin-identity` / `reference-integrity` 已接受 spec 的 requirement。`config.json` 新增 `analysisMode` 键为附加，不改既有键语义。）

## Impact

- 目标分支：`main`（main 现已是 v2 主线；`openspec/config.yaml` 中"PR 对 `excavator-v2`"的措辞已过时，后续单独修正）。
- 受影响脚本/技能：`skills/excavator/SKILL.md`（Phase 0 决策与 Lazy 分支）、新增 `skills/excavator/build-fact-graph.mjs`、`skills/excavator-chat/SKILL.md`（结构路径）；复用 `structure-all.mjs`、`extract-import-map.mjs`、`scan-project.mjs`。
- 数据产物：`knowledge-graph.json` 的确定性事实投影 + `factDigest`；`.excavator/config.json` 增 `analysisMode`。
- 测试：新增合成夹具（身份五夹具 + Lazy 首跑零-LLM 断言 + 结构问答）；固定性能 fixture go-clean-arch（opt-in，产物不提交）。
- 契约地基：node-id 函数与 `factDigest` 规范化是切片 B/C/D 的前置依赖。
