## Context

- 事实入口点来自知识图的 `entryPoints` 记录流（`route-entry-points`）。`extract-domain-context.py` 读 `kind: "entry"` 的记录，丢掉测试文件上的，写成 `source: "script"` 的入口点：`file` 是处理者所在文件（处理者解析为 `node`/`module` 时），否则是注册文件；带 `method`、`path` 或 `pathText`、`registeredAt`。记录本身没有 id。
- 区输出今天的流程 id、`domainMeta.entryPoint`、`entryType` 全部由模型写；合并只在跨区撞 id 时加 `--<区>` 后缀。
- 流程的起始模块是第一个可定位步骤所在的模块（`homeModuleOf`），挂接、选域检查共用它。
- 模块四桶的判定顺序是 covered → declared-skip → silent-zero → no-candidates，所以没有候选的模块只要被模型写进 `skippedModules` 就成了 `declared-skip`。

## Goals / Non-Goals

**Goals**
- 两次运行只要都为同一处理者写了流程，流程 id 相同。
- 每个事实入口点落一个可见桶，桶跨运行的差异只来自模型「写不写流程」的判断，并且这个判断逐条可见。
- 没有候选的模块的分桶不受模型的跳过声明影响。

**Non-Goals**
- 不让脚本决定哪些入口点算业务流程、流程叫什么、有哪些步骤（模型仍写）。
- 不改步骤 id、步骤内容、域规划、选域检查。
- 没有事实入口点的流程（定时任务、命令行、事件、模型补充的入口点、手工流程）身份仍由模型起名，只单独计数。

## Decisions

### D1 入口点 id 由抽取脚本在事实集合上算，可读

候选：(a) 按顺序编号；(b) 内容哈希；(c) 由方法与路径组成的可读串，撞名再消歧。编号会因任何一个入口点增减整体移位；哈希稳定但模型抄写长十六进制串容易错，检查行也读不懂。选 (c)：

- 基串：`http` 入口点为 `<方法> <路径>`，界面入口点为 `<路径>`；路径不可解时用 `pathText`。转小写，非 `[a-z0-9]` 的连续字符换成一个 `-`，去掉首尾 `-`，最长 80 个字符；`http` 的路径部分为空（`/`）时写 `<方法>-root`，界面为 `root`。id 为 `ep:<http|ui>.<基串>`。
- 在全部事实入口点上（排序键：注册文件、注册行、方法、路径），基串相同的每个入口点加 `.<注册文件所在模块的同样转换>`；仍相同的，按排序第二个起加 `.2`、`.3`……
- 消歧只依赖事实集合，不依赖哪些入口点被引用、哪个区先合并。

代价：多仓库里同一路径（如 `/health`）出现在几个服务时 id 带模块后缀，较长。

### D2 处理者组

同一处理者注册在几个方法或几个前缀下（`GET|POST /oauth/authorize`）是一个业务流程，两次运行可能一次写成一个流程、一次写成两个。组把这件事定下来：处理者键为 `node:<节点 id>`（`fate: node`）、`module:<文件>`（`fate: module`）、`inline:<注册文件>:<处理者行>`（`fate: inline`），其余处理者（外部、不可解、歧义、无）没有键，自成一组。同键的入口点组成一组，`group` 是组内排序第一的 id。同一处理者的入口点 `file` 相同，所以一个组总在一个文件、一个区里。

### D3 引用规则与核对：放在接受里

区输出的流程在 `domainMeta.entryPointIds` 写 id。接受时核对（与选域检查同一处，同一个 `check` 命令）：

- `malformed`：字段存在但不是字符串数组；
- `unknown`：id 不是本区上下文里的事实入口点（别的区的、编造的都算）；
- `mixed-groups`：一个流程的 id 属于不止一个组；
- `shared-group`：一个组已被本区排在前面的流程引用（按输出里的节点顺序）。

任一条成立，该区为 `rejected-entry-point`（有选域问题时状态仍为 `rejected-choice`，两类行都打印），走与 `rejected-choice` 相同的「分析器自查 → 重派一次 → `--accept-unchosen`」路径。拒绝而不是计数，因为被丢的引用会让流程退回模型 id，正是要消除的漂移；而补写引用的代价只是一次自查。

`--accept-unchosen` 兜底时引用按固定规则清洗并计入 `citationsDropped`：去掉 `malformed`、`unknown`；剩下的属于多个组时只留排序第一个 id 所在的组；组已被前面的流程占用时整条引用去掉（该流程成为无锚流程）。

`check` 另外为本区每个既没被引用（自己或同组）、也没被跳过（自己或所在模块）的事实入口点打印 `uncovered-entry-point <区> <id> <方法 路径>`，退出码不变：静默是允许的、可见的状态，提示分析器补上，不逼它为了过检查写流程。

### D4 流程 id 与入口字段由脚本写

有合法引用的流程（接受后没被清洗掉的）：

- id = `flow:` + 组首 id 去掉 `ep:`（例如 `flow:http.get-v2-orders`）。`.` 不会出现在模型按规则写的短横线 id 里，所以派生 id 与无锚流程的 id 不相撞；真撞上时沿用既有的 `--<区>` 改名并计数。派生的改名记进 `flowIdsDerived`；所有改名（派生与撞名后缀）记进 `renames`，`idsRenamed` 仍只记撞名后缀。区里的 `flow_step` 边随之改写，守恒检查经 `renames` 核对。
- `domainMeta.entryPointIds` 改写为引用的 id 按事实顺序排列；`entryPoint` 改写为这些入口点的「方法 路径」（界面入口点只有路径）以 `, ` 连接；`entryType` 为 `http`，界面路由为 `manual`（Core 的枚举没有界面，用户在界面上进入一个页面就是手动触发）。
- 起始模块 = 组所在文件的模块（`homedByEntryPoint`），先于「第一个可定位步骤」。选域检查经同一个 `homeModuleOf`，两者一致。

步骤 id 仍带模型起的流程名；本变更不动步骤身份。

### D5 每个事实入口点一个桶

覆盖报告加 `entryPointCoverage`：

```json
{
  "total": 843,
  "buckets": { "in-flow": 0, "declared-skip": 0, "silent": 0, "area-not-accepted": 0, "outside-areas": 0 },
  "inFlowBy": { "cited": 0, "group": 0 },
  "declaredBy": { "entry-point": 0, "module": 0 },
  "skippedEntryPointsUnknown": 0,
  "skippedEntryPointsWithoutReason": 0,
  "silent": ["ep:…"],
  "rows": [{ "id": "ep:…", "method": "GET", "path": "/x", "file": "…", "module": "…", "areaId": "area-001", "group": "ep:…", "bucket": "in-flow", "flow": "flow:…" }]
}
```

判定顺序：所在区没被接受 → `area-not-accepted`；自己或同组被合并后的流程引用 → `in-flow`；自己在 `skippedEntryPoints` 里带非空理由，或所在模块被声明跳过 → `declared-skip`；否则 `silent`。不在任何模块里的事实入口点（分区时已计 `entryPointsOutsideModules`）→ `outside-areas`。桶之和不等于总数、或总数不等于分区脚本给出的期望数（各模块的脚本入口点数加 `entryPointsOutsideModules`，记为 `expected`）时，合并按守恒失败处理（退出 4，不写合并结果）。期望数独立于各桶，所以缺了区上下文、或入口点没有 id 而哪个桶都没进，也看得见。打印 `entry-point coverage total=… in-flow=… declared-skip=… silent=… area-not-accepted=… outside-areas=…`、每个 `silent-entry-point <id> <方法 路径> area=…`，以及 `flows anchored=… unanchored=… citations-dropped=…`。

### D6 没有候选的模块

判定顺序改为 covered → （有候选时）declared-skip / silent-zero → no-candidates。没有候选的模块被写进 `skippedModules`，落 `no-candidates`，声明计入 `skippedModulesWithoutCandidates`。这消掉了实测的 60 次来回；模块被流程步骤覆盖与否（covered ↔ no-candidates）仍随流程内容变，不在本变更内。

没有步骤落在模块里、但它有入口点在 `entryPointCoverage` 里是 `in-flow`（有流程从这里开始）时，模块落 `covered`（`coveredBy: "entry-points"`，计入 `modulesCoveredByEntryPoints`），评审第一轮指出。模块的候选只有脚本入口点、且每一个在 `entryPointCoverage` 里都是 `declared-skip` 时，模块也落 `declared-skip`（`skippedBy: "entry-points"`，计入 `modulesSkippedByEntryPoints`）。验收第一轮发现：分析器按规则 10 逐个跳过入口点、没再写 `skippedModules`，模块桶却报 `silent-zero`，两本账对不上，运行报告据此误说覆盖不完整（两次运行 5 个 `silent-zero` 里 4 个是这种）。带正则、模型入口点或未识别文件的模块不走这条，因为这些候选没有逐条的跳过记录。

## Risks / Trade-offs

- **模型偏向全部跳过**：跳过只要一句理由，比写流程便宜。缓解：跳过与写流程同样逐条可见；提示词要求跳过仅用于没有业务行为的入口点（健康检查、静态资源、调试）。验收测 `declared-skip` 的跨运行一致性。
- **一处理者一流程限制了模型**：一个处理者按参数分派几种业务（如 webhook）只能写成一个流程。这类流程在步骤里分支；身份稳定优先。
- **界面路由多**：前端路由与后端路由都计入总数，分析器要逐条处理，输出变长、花费略增。
- **入口字段改写**：`entryPoint` 现在是事实文本，路径里若有非英文字符会被语言审计判为非英文（路径是源码原文）。当前语料没有这种路径；出现时另起变更把 `entryPoint` 归为源码原文。
