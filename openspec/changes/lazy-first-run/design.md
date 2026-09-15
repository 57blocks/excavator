## Context

见 proposal.md「Why」。当前 `/excavator`（`skills/excavator/SKILL.md`）是 7 阶段编排：Phase 1 SCAN、Phase 1.2 STRUCTURE-ALL（已确定性产出每文件 status/声明/imports/exports/calls，写 `structure-all.json`）、Phase 1.5 BATCH、Phase 2 ANALYZE（file-analyzer，5 并发，>1h 主因）、2.3 ANNOTATE、2.5 VERIFY、3 ASSEMBLE、4 ARCHITECTURE、6 REVIEW、7 SAVE。`prepare-incremental.mjs` 已含 git 与非 git 内容哈希两条 diff 路径与原子写。`excavator-chat` 目前是对 `knowledge-graph.json` 的 grep（name/summary/tags）+ 1-hop。`verifiable-statements` 变更已给 `project` 加入 `sourceDigest`/`factsDigest`/`pipelineVersion` 与边/节点的 evidence/provenance/coverage/gaps 字段。

约束：Core 侧脚本零模型、build-free；缺失必须落可见桶；`.excavator/` 无遗留兼容。

## Goals / Non-Goals

**Goals:**
- 首次运行可只产确定性事实、零 LLM subagent，且 <60s（go-clean-arch）。
- 一处实现、两侧共用的确定性 node-id 函数，满足 node-identity spec 五条不变量。
- Fact Builder 复用既有结构抽取，不新增第二套解析。
- chat 能用事实层回答结构问题、对语义问题诚实降级。

**Non-Goals（设计层边界）:**
- 不引入 SourceSnapshot 抽象与三种 adapter 的**运行时集成**（切片 B）。本切片沿用现有 `gitCommitHash`/`sourceDigest`/`factsDigest`。node-id 的多仓路径前缀**规则**在本切片实现并以合成路径单测，但真正经 `MultiRepoSnapshot` 驱动它留给 B。
- 不建 BM25 `source-index`、查询扩展、多跳遍历、按需语义缓存与并发锁（切片 C）。
- 不改 Full 语义产物的物理隔离与 Domain（切片 D）。

## Decisions

### D1. Fact Builder 是投影，不是新抽取器
新增 `skills/excavator/build-fact-graph.mjs`：读 `scan-result.json` + `structure-all.json` + import-map，规范化为事实节点/边、`coverage`/`gaps`/`factsDigest`。**不重新解析源码、不调用模型**。
- 备选：另写独立抽取器 → 否决：与 structure-all 重复、必然身份漂移。
- 唯一真正新增的确定性工作是"把 call site 唯一解析到目标节点"（见 D3）。

### D2. node-id：单一共享模块 + 固定兜底链
新增一个共享模块（如 `skills/excavator/node-identity.mjs`），Fact Builder 与 chat 缓存查找都 `import` 它。ID 派生：`path + kind + owner + normalized signature` → 缺签名用 `name` → 仍不可区分用 **owner 内同 kind 声明的出现序号**（记入 provenance）。path 分量先经规范化（去掉 adapter 差异；多仓成员前缀固定为 `<memberId>/<member-relative-path>`）。
- 备选：节点体内容哈希 → 否决：任何编辑都变，破坏缓存复用；行号派生 → 否决：前面插入代码即漂移。
- 序号是脆弱兜底：前插同类声明会改序号（该节点缓存失效重算，可接受）；前插注释/空行/非同类不改。必须与既有 `annotate-graph`/`structure-all` 锚点对齐，避免层间漂移。身份冲突（两个可区分声明同 ID）报 `identity-collision`，不静默合并。

### D3. calls 仅做确定性唯一解析，其余入 gap
用 import-map（已解析项目内部导入）+ 同文件本地绑定，把 call site 解析到唯一目标节点；目标不唯一或不可解 → 写 gap，不猜。
- 备选：让模型解析 calls（旧 Phase 2 做法）→ 否决：那正是要推迟的 LLM。
- 代价：Lazy 下 calls 覆盖可能偏低；这是诚实的 gap，深解析留后续。需在 go-clean-arch/wcp 上量 gap 率作为观测。

### D4. Lazy 流水线复用既有阶段、在 Phase 0 按 mode 分支
在 SKILL.md Phase 0 决策表按 `analysisMode`/`--mode` 分支：Lazy 走 Phase 1 → 1.2 → **build-fact-graph（新）** → 确定性 validate（复用 6b 的触源码校验，去掉 LLM review）→ Phase 7 SAVE（复用既有原子保存门）；**跳过 1.5/2/2.5/3/4/6**。Full 保持现有全链路。
- 备选：另写一个 lazy 专用 skill → 否决：会复制 scan/structure/save 逻辑，两处易漂。

### D5. factsDigest 复用既有字段，不新造
对齐 `verifiable-statements` 已引入的 `project.factsDigest`（而非新造 `factDigest`）。其归一化只覆盖规范化后的事实节点/边/coverage/gaps，排除 sourceRevision/时间戳/模型名。
- 若既有 `factsDigest` 的计算口径与本 spec 不一致，以本 spec 的"仅事实、排除运行元数据"为准并调整该计算，保持单一实现。

### D6. chat 结构/语义分流
chat 是模型技能：在 `excavator-chat/SKILL.md` 增加分流说明——结构类问题（文件/符号/方法清单、import/calls、1-hop）直接用事实层（grep 现有节点/边）回答；当命中节点 summary 为空且问题需要职责/业务含义时，输出固定降级提示（建议 `--mode=full`），**禁止编造**。不引入新检索引擎（留 C）。

## Risks / Trade-offs

- **node-id 序号兜底脆弱** → last-resort + 记 provenance + 五个夹具钉住"前插非声明不变、前插同类只失效不错配"。
- **calls 唯一解析覆盖低，结构问答变弱** → 接受为可见 gap；在真实语料量 gap 率；深解析进 roadmap，不在 A 扩。
- **模型误把语义问题当结构答（拿空 summary 编造）** → chat 指令硬性禁编造 + 降级场景测试；零编造是硬指标。
- **factsDigest 口径不一致** → 以本 spec 为准统一到一处实现，避免两套 digest。
- **多仓身份规则在 A 无真实 adapter 驱动** → A 只单测路径规范化规则；真实 MultiRepoSnapshot 驱动与 factsDigest 跨 adapter 一致的端到端验收在 B 补齐（本切片 spec 的跨 adapter 场景用合成路径满足）。
- **沿用 gitCommitHash/sourceDigest（未上 SourceSnapshot）** → A 的新鲜度仍是现状；不回归，B 再统一。

## Migration Plan

- 默认 `analysisMode=lazy`：存量已有完整图谱**不清空、不降级**；只有显式 `--mode=full` 才补语义。
- 首次从 pre-lazy 布局升级若缺 `factsDigest`：由 build-fact-graph 一次性补齐（确定性，不触模型）。
- 回滚：`/excavator --mode=full`（或 `--full`）即恢复既有全链路行为；本切片不删除任何现有阶段脚本。
