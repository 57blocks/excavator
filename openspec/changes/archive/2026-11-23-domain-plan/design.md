## Context

#158 之后的流水线：抽取 → 分区 → 每区一个分析器（各自写域、流程、步骤）→ 合并（同 id 的域合并，可选别名表）→ 锚定、校验、保存。域由各区各自命名，所以域数随区数增长、划分随采样漂移；编排者手写别名表来补，别名表本身又是一次不可复现的判断。

## Goals / Non-Goals

**Goals**
- 顶层域是业务领域；功能级的分组落在域下面（模块、流程），数据模型与基础设施用规则标成支撑域。
- 同一输入重复运行得到相同的顶层划分（模块 → 域），id 与名字也相同；做到这点的机制是结构性的（复用、脚本校验），不是提示词里的期望。
- 保持 #158 的收益：每个模块有记录的结果、0 静默为零；流程与步骤在合并中守恒，并由脚本检查。

**Non-Goals**
- 不让流程级的内容（流程数、步骤文字）跨运行一致。区分析结果的复用是后续项。
- 不让脚本写域的内容（名字、摘要、归属判断）。
- 不改分区、抽取、锚定。

## Decisions

### D1 为什么划分要由一次规划决定，而不是纯目录结构或事后合并

- **纯目录结构**（脚本按目录层级定域，模型只起名）能保证划分一致，但给不出业务粒度：`invoices`、`payments`、`refunds` 在目录里是平级兄弟，没有任何结构事实说它们同属「计费」。取上一层又只剩一个 `modules` 域。业务归组是判断题，必须由模型做。
- **事后合并**（区分析完再让一个模型合并 103 个域）：输入是区分析器的输出，本身每次不同；合并模型面对的是已经切碎的域名，判断更难。
- **事前规划**：输入完全由脚本从源码事实生成（同一项目字节相同），一个模型调用看全项目的模块清单，一次决定归属。判断只发生一次，而且 D3 让它在模块集合不变时不再发生。

### D2 规划输入与输出（形状由脚本固定）

`plan-domains.mjs prepare <root>` 读 `intermediate/domain-areas/manifest.json` 与 `intermediate/domain-context.json`，写 `intermediate/domain-areas/plan.input.json`：

```json
{
  "format": "excavator-domain-plan-input/1",
  "planRun": { "token": "<本次分区令牌>" },
  "mode": "new | extend",
  "output": "<plan.output.json 的绝对路径>",
  "limits": { "maxBusinessDomains": 10, "maxSupportDomains": 3 },
  "modules": [
    { "path": "services/core/src/modules/orders", "files": 4, "fileNames": ["controller.js", "..."], "fileNamesOmitted": 0,
      "entryPoints": 5, "entrySamples": ["router.post('/orders/:id/approve'"], "entrySamplesOmitted": 0,
      "exports": ["search", "approve"], "exportsOmitted": 0, "assigned": null }
  ],
  "domains": []
}
```

- 每个模块都列出，不截模块；模块内的样本有上界（文件名 20、入口点样本 8、导出名 12），省略数写明。输入大小随模块数线性。
- 扩展模式下，已归属的模块 `assigned` 是它的域 id，`domains` 是已有域；只有 `assigned: null` 的模块要规划。
- `limits.maxBusinessDomains = max(3, ⌈√模块数⌉)`（模块数含支撑模块，不能靠把模块标成支撑来抬高上界）。扩展模式下两个上界都取「公式值」与「已存规划中该类域数」的较大者：项目缩小后，修剪过的规划可能已超出新公式，已有域在扩展模式里不能改，否则每份输出都会被拒；超限的拒收理由写明用 `--replan` 重新决定全部域。理由：域是业务领域，平均一个域应持有不少于 √N 个模块；103 个域对 290 个模块（上界 17）会被拒，#158 之前单分析器给出的 7 个在界内。上界只约束域数，不约束流程数（流程来自区分析，不受影响），所以不会重演 #158 修掉的「2–6 个域、每域 2–5 条流程」导致的漏覆盖。

规划代理写 `plan.output.json`：

```json
{
  "planRun": { "token": "<复制>" },
  "domains": [
    { "id": "domain:billing", "kind": "business", "name": "Billing", "summary": "...", "tags": ["..."],
      "entities": ["Invoice"], "businessRules": ["..."] }
  ],
  "assignments": { "services/core/src/modules/invoices": "domain:billing" },
  "crossDomain": [ { "source": "domain:ordering", "target": "domain:billing", "description": "..." } ]
}
```

`plan-domains.mjs accept <root>` 校验，任何一条不过就整份拒收（退出码 3），原因逐条写进 `intermediate/domain-areas/plan.rejection.json` 并打印：
- `planRun.token` 等于本次令牌（防拷贝旧文件）；
- `assignments` 的键恰好是要规划的模块集合（新建模式是全部，扩展模式是 `assigned: null` 的那些），值是 `domains` 里的 id（扩展模式下也可以是已有域）；
- 域 id 为 `domain:<kebab-case>`、不重复；扩展模式下新域 id 不与已有域冲突；`kind` 是 `business` 或 `support`；名字与摘要非空；
- 每个新域至少持有一个模块；
- 合并后的业务域数 ≤ `maxBusinessDomains`，支撑域数 ≤ `maxSupportDomains`；
- 跨域关系两端都是规划里的域、不是自环；不合格的条目丢弃并计数（不拒收整份）。

接受后写 `<数据目录>/domain-plan.json`：`{format, moduleSetDigest, modules: {路径: 域id}, domains, crossDomain, history}`，`history` 记每次 new/extend/reused 的时间与模块数。

### D3 按模块集合摘要复用

`moduleSetDigest = sha256(排好序的模块路径以 \n 连接)`。`prepare` 读已有的 `domain-plan.json`：
- 不存在、格式不对、或传了 `--replan` → `mode: new`；
- 摘要相同 → `reused`：不写规划输入、不派规划代理，打印 `plan=reused`；
- 摘要不同：先剪掉已不存在的模块，去掉因此变空的域（计数）；没有新模块 → 直接写回剪过的规划，`reused`；有新模块 → `mode: extend`，只规划新模块。

模块按目录定义，所以文件内容的改动、模块内文件的增删都不改变摘要；划分只在目录集合变化时才可能变，而且只变新目录。这是「同一输入两次运行划分相同」的结构保证：第二次运行根本不做判断。

`domain-plan.json` 是流水线产物，不是手写配置；要重新判断只能 `--replan`。

### D4 区分析器不写域

Option C 的分析器只写流程、步骤、`flow_step` 边、`skippedModules`，每条流程写 `domainMeta.module`（本区的一个模块路径，流程开始的地方）。分析器输出里出现的域节点、`contains_flow`、`cross_domain` 边一律忽略，计入 `merge.analyzerDomainsIgnored`、`merge.analyzerEdgesIgnored`。分析器拿不到也用不到规划，所以规划与区分析可以同时派发。

### D5 合并：域来自规划，流程按规则挂接，守恒由脚本检查

- 读 `<数据目录>/domain-plan.json`；它的模块集合必须等于本次清单的模块集合，否则报错退出 1（说明先跑 `plan-domains.mjs`）。
- 域节点：规划里的每个域一个节点，`domainMeta` 为 `{kind, modules(排序), entities, businessRules, crossDomainInteractions}`；`complexity` 按持有模块数定（≤2 simple、≤6 moderate、其余 complex）——这是结构计数，不是内容。
- 流程、步骤：同 #158，跨区冲突 id 改名 `<id>--<区id>`（该 id 也已被占用时依次加 `-2`、`-3`…），本区的边跟随。守恒按次数计：两个区交来同一个 id、合并后只剩一个，算丢失。
- **挂接**：每条流程按 `flow_step` 权重（再按边序）找第一个能定位到模块的步骤（定位规则同覆盖报告），挂到该模块在规划里的域（`homedBy: step`）；没有可定位步骤时，若 `domainMeta.module` 是本区持有的模块则挂到它的域（`homedBy: declared`）；否则 `unplaced`：流程与步骤照留，不生成 `contains_flow`，计数并逐条打印。不编造归属。
- `contains_flow` 边由脚本生成（weight 1.0）；`cross_domain` 边来自规划。
- **守恒**：对每个已接受的区，输入的流程 id、步骤 id、`flow_step` 边（按改名表映射后）必须在合并结果里各出现恰好一次；`checkConservation` 返回 `{flowsIn, flowsOut, stepsIn, stepsOut, flowStepEdgesIn, flowStepEdgesOut, missing, extra, ok}`。区内重复 id、无 id 节点在进入计数前就被丢弃并另计（#158 已有），不算违反。`ok: false` 时退出码 4，不写 `domain-analysis.json`。

### D6 覆盖报告增量

`domain-coverage.json` 增加：`plan: {status, moduleSetDigest, businessDomains, supportDomains}`、`flows: {total, homedByStep, homedByDeclared, unplaced}`、`conservation`、模块行的 `domain`。四个桶与 `silentZeroParts` 不变。

### D7 SKILL 编排

Phase 3 分区之后：`plan-domains.mjs prepare`。若不是 `reused`，派**一个**规划代理（与区分析器同时）。所有代理返回后 `plan-domains.mjs accept`；退出 3 时重派规划代理一次（把拒收原因给它），再拒收就 **STOP**，不保存域图——划分不一致的数据比没有数据更糟。然后合并。SKILL 删去手写别名一步，并写明编排者不得写或改任何规划、区输出文件。

## Risks / Trade-offs

- **冷启动仍是一次模型判断**：两份没有共享 `domain-plan.json` 的独立运行，划分可能不同。机制保证的是「同一项目再跑不漂移」；冷启动的一致程度是测量值，阈值见 O6。
- **业务域上界可能逼合并**：一个真正很宽的项目可能需要多于 ⌈√N⌉ 个业务域。上界随规模增长；被拒时原因可见。
- **目录即模块**：模块在多个业务领域之间共享的项目（一个目录装多个领域）只能整体归一个域；流程仍按首个步骤挂接，跨域内容不丢。
- **规划输入随模块数线性**：约 290 个模块约 120 KB；几千个模块时一个规划上下文吃紧，规划代理要分段读文件。记为局限。

## Oracles（动手前写死）

- O1 规划输入：每个模块恰好一行；样本省略数等于实际省略数；同一输入两次 `prepare` 输出除令牌外字节相同。
- O2 接受校验：漏一个模块、多一个未知模块、指向不存在的域、空域、业务域超上界、支撑域超上界、令牌不符、扩展模式改动已有归属——每种各自被拒，原因可读；合格的被接受并写出 `domain-plan.json`。
- O3 复用：模块集合相同 → `reused` 且不写规划输入；新增一个目录 → `extend`，只列那一个模块为待规划，已有归属原样；删掉一个目录 → `reused`，规划被剪、变空的域去掉；`--replan` → `new`。
- O4 挂接：首个可定位步骤决定域；无可定位步骤时用声明模块；都没有时 `unplaced` 且无 `contains_flow`；分析器写的域与边被忽略并计数；域节点只来自规划。
- O5 守恒：正常合并 `ok: true`；装置先验——人为让合并丢一个步骤或一条 `flow_step` 边时 `checkConservation` 报 `ok: false` 并点名，CLI 退出 4。
- O6 实测（大夹具 `large-multi-module.mjs`，无知识图，Sonnet；前 = main，后 = 本分支）：
  - 每边至少两次独立冷启动运行（各自全新的夹具副本，不共享 `.excavator/`），后一边再在第一份副本上补一次热运行（复用规划）。
  - 记录：域数（后一边分业务/支撑）、四个桶、静默为零、流程/步骤数、守恒、花费。
  - **一致性度量**：模块 → 域。前一边按「模块里定位到的流程所属域的众数」导出（平局取 id 字典序最小；没有流程的模块不参与，计数写明）；后一边同时报规划划分（全部模块）与同样的导出划分。两次运行之间算调整兰德指数（ARI）与完全相同与否；域按模块重叠贪心配对后报 id 相同率与名字相同率。
  - **阈值（运行前写死）**：热运行与其冷运行之间，规划划分、域 id、域名完全相同（ARI = 1），规划调用 0 次——这是结构保证，不达就是缺陷。两次独立冷运行之间，规划划分 ARI ≥ 0.8，且业务域数相差 ≤ 2。理由：夹具 88 个模块里约一半是明显的共享库目录，业务实体模块有若干天然的边界摇摆（地址、评价、通知、报表这类），0.8 容许几次边界摇摆但不容许整体重组。id 与名字的冷启动一致率只报不设阈值。未达阈值就如实记为未达，不事后挪阈值。
  - 后一边每次运行：业务域数 ≤ 10，静默为零 = 0，守恒 `ok`。
