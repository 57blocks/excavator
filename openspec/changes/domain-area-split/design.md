## Context

`/excavator-domain` 的输入有两条：没有知识图（或 `--full`）时由 `extract-domain-context.py` 扫出入口点与签名；有知识图时由编排者自己从 `knowledge-graph.jsonl` 里挑记录。两条路都把整个项目交给一个 domain-analyzer。分析结果随后经 `annotate-domain.mjs` 锚定步骤、`validate-graph.mjs` 计数未锚定步骤、`publish-annotations.mjs` 发布补充字段。后三步本变更不动。

## Goals / Non-Goals

**Goals**
- 每个模块都确定地交给某一个分析器；没有流程的模块、没有被任何步骤引用的入口点文件，出现在报告里。
- 每个分析器的上下文有界，和项目大小无关（区上下文里没有全项目索引）。
- 拷贝旧文件冒充本次输出的情况被脚本拒收。

**Non-Goals**
- 不让脚本决定业务流程或域名（图由模型写）。
- 不提高流程数或步骤数的「目标值」；覆盖下限是「可见」，不是「必须有流程」。
- 不改入口点识别的正则（框架覆盖另议）；不改 `skills/excavator/`。

## Decisions

### D1 候选材料：两条路径都先跑抽取脚本

有没有知识图，都先跑 `extract-domain-context.py`。它给出文件树、入口点、每个文件的签名与项目元数据。有知识图且没有 `--full` 时，分区脚本再从图里取这些文件的节点附到各区。这样两条路径用同一份候选清单、同一套覆盖口径。

抽取脚本的静默上限改为可见：
- 去掉「每目录最多 50 个文件」；总文件上限保留，命中时写 `truncated.fileTree`。
- 入口点上限提高到 5,000，命中时写 `truncated.entryPoints`。
- 每个源文件都给签名（预览截短），不再只取关键词排名前 40。
- 不再在整体超 512 KB 时砍入口点和签名：分区之后，任何一个模型都不会读整份文件。

**为什么不是 skill 散文**：上限在脚本里，散文改不了；被砍掉的输入模型根本看不到。

### D2 模块与区

- **模块** = 源文件所在目录（POSIX 路径，根目录下的文件为 `.`）。测试文件（与抽取脚本跳过入口点时同一规则，每种形状锚定到路径段，`latest_routes.py` 不算测试文件）不进模块，计入 `testFilesExcluded`。图路径上，图里有、抽取脚本没列出的文件（它不扫的语言如 `.vue`，或它跳过的目录）照样按所在目录进模块，计入 `graphOnlyFiles`，这样它们的模块也会派给分析器、出现在报告里。
- **区**：模块按路径排序，依次装进当前区；装入后超过字节预算（`--budget-bytes`，默认 150,000，按区材料的 JSON 字节数算）或入口点预算（`--max-entry-points`，默认 40）就另开一区。按路径排序让兄弟目录尽量落在同一区。只有字节预算不够：一个区可以装下两百多个入口点，又回到一个分析器顾不过来的局面。
- **超预算模块**（任一预算）按文件（排序后）拆成连续的几段，每段一个区；段号写进模块的 `part: {index, of}`。单个文件本身超预算时自成一段，区上标 `overBudget: true`，不砍内容。
- 区材料：本区文件清单、本区入口点（含片段）、本区文件签名、（图路径）本区文件的图节点 `{id, type, name, summary, filePath, lineRange}`、项目元数据。不给其它区的模块清单：它随模块数增长，会让区上下文失去上界；边界由本区 `modules` 给出。
- 图节点的 `filePath` 解析后不在项目根内的，不附到任何区，计入 `graphNodesOutsideRoot`；落在测试文件上的计入 `graphNodesOnTestFiles`；没有 `filePath` 的计入 `graphNodesWithoutFile`。这些计数写进清单，并由合并原样带进覆盖报告的 `split` 字段（清单会被 Phase 5 清掉，报告不会）。

区数没有上限（上限就是绕过口）；预算可调，区数写进清单，由编排者报告。

### D3 新鲜度令牌

`split-domain-areas.mjs` 每次运行：
1. 删除 `intermediate/domain-areas/` 整个目录与 `intermediate/domain-analysis.json`；
2. 生成随机令牌（`crypto.randomBytes`），写进清单与每个区的上下文；
3. 指定每区的输出路径 `intermediate/domain-areas/<区id>.analysis.json`。

分析器 MUST 在输出顶层写 `areaRun: {areaId, token}`。合并脚本对令牌不符、缺 `areaRun`、`areaId` 不符的输出记为 `rejected-stale`，JSON 解析失败记为 `rejected-parse`，文件不存在记为 `missing`。旧的 `domain-graph.json`、上一次运行的区输出都没有本次令牌，拷过来就被拒。

**为什么用令牌不用 mtime**：拷贝会刷新 mtime；令牌只能从本次上下文里读到。

### D4 合并规则

按区 id 顺序处理已接受的区输出：
- **域**：id 完全相同即合并。名字、摘要取第一个出现的；`tags` 与 `domainMeta` 里的数组取并集（保留首次出现顺序）；`complexity` 取较高者。合并记入 `domainsMerged`。
- **别名**（可选，`--aliases <file>`，内容 `{"domain:a": "domain:b"}`）：由编排者读完合并后的域清单后写，表示两个 id 是同一业务域。脚本只校验：源与目标都存在、目标不是另一条别名的源、源不等于目标；不合格的条目不执行，列入 `aliasesRejected`。执行时按上面的域合并规则把源并进目标，并改写边。
- **流程、步骤 id 冲突**：后出现的区里与已合并 id 相同的 flow/step（domain 除外）改名为 `<id>--<区id>`，本区的边同步改写，记入 `idsRenamed`。不做跨区流程合并：两条同名流程可能是前后端两段，合并会打乱步骤顺序。
- **边**：端点不在合并结果里的边丢弃并计入 `edgesDangling`；别名后成为自环的 `cross_domain` 丢弃并计入 `edgesSelfLoop`；`type|source|target` 相同的边只留一条。
- **project**：取第一个已接受区的，`languages`、`frameworks` 取并集。
- 输出去掉 `areaRun` 与 `skippedModules`，`layers`、`tour` 为空数组，写到 `intermediate/domain-analysis.json`，Phase 4.5 原样接手。

### D5 覆盖报告

写 `<数据目录>/reports/domain-coverage.json`（不放 `intermediate/`，Phase 5 的清理不会带走它）。

**步骤定位**：步骤的 `filePath`（去掉开头的 `./`）是模块里的文件，则定位到该模块；否则用 `nodeIds` 经各区上下文里的图节点找到文件；仍找不到记为 `unlocated`。`filePath` 为绝对路径或含 `..` 越出根的，计入 `steps.fileOutsideRoot`，不定位，也不再经 `nodeIds` 定位。指向不属于任何模块的文件，计入 `steps.fileOutsideModules`。

**模块状态**（四个桶，和等于模块总数）：
- `covered`：至少一条流程有步骤定位在该模块；
- `declared-skip`：没有流程，但它所在区的输出把它列进 `skippedModules` 且理由非空；
- `silent-zero`：没有流程、没声明，且模块里有入口点——这是本变更要暴露的遗漏；
- `no-candidates`：没有流程、没声明，模块里也没有入口点。

**拆段模块**：任一段有流程即 `covered`。另外每区列出 `silentZeroParts`：本区持有的段里有入口点文件、没有任何步骤定位到该段文件、模块也没被声明跳过的段；报告顶层 `silentZeroParts` 是其总数。这样拆段模块里某个区什么都没交，也看得见。

`skippedModules` 里不属于本区的模块名计入 `skippedModulesUnknown`，不改变任何模块的状态。被拒或缺失的区，其模块按上面规则照算（自然落进 `silent-zero` 或 `no-candidates`），并在区一级标出状态。

**逐文件**：`candidateFiles` 给出有入口点的文件总数 `total`、有步骤定位到的数目 `cited`，以及未被引用的文件清单 `uncited`。

**逐区**：状态、域/流程/步骤数、模块清单、入口点数、`silent-zero` 模块清单、`silentZeroParts`。

退出码：所有区都被接受为 0；有 `missing` 或 `rejected-*` 为 3（合并结果与报告照写）；用法错误为 1。

### D6 分析器提示词

新增 Option C（区上下文）。在 Option C 下：
- 只分析本区模块；可以读本区文件的源码补全；
- 去掉「2–6 个域、每域 2–5 条流程」：本区每个有入口点的模块要么至少有一条流程的步骤落在它的文件里，要么列进 `skippedModules: [{module, reason}]`；
- 输出写到上下文给出的路径，顶层带 `areaRun`；不读、不拷贝 `.excavator/domain-graph.json`、`intermediate/` 下的其它文件或别的区的输出。
- 步骤 `filePath` 必须是项目相对路径；图路径下 `nodeIds` 只抄区上下文里的 id。

Option A/B 保留给不按区的调用者，但本 skill 只用 Option C。

### D7 报告目录

本 skill 调 `publish-annotations.mjs` 时显式传 `--reports-dir "$DATA_DIR/reports"`。脚本默认值 `<数据目录>/excavator` 由 `/excavator` 共用，留作后续。

## Risks / Trade-offs

- **成本随区数增加**：一个 2,000 文件的项目约十几个区。换来的是每区上下文有界、遗漏可见；预算可调。
- **跨区域名分裂**：不同区可能给同一业务起不同的域名。按 id 合并只能合并完全相同的；别名由编排者判断，脚本校验。不做名字相似度合并（那是判断题）。
- **前端等无入口点的模块**：仍可能没有流程，但它们落进 `no-candidates` 桶、可见；入口点识别的覆盖是另一件事。
- **令牌随机**：清单字节不确定；合并输出与覆盖报告对同一组区输出是确定的。

## Oracles（动手前写死）

- O1 抽取：一个目录 60 个源文件 → 文件树 60 个；入口点 300 个、总量超 512 KB → 入口点 300 个、签名覆盖所有文件。
- O2 分区：每个模块的每个文件恰好在一个区；除 `overBudget` 区外每区材料与入口点数都不超预算；超预算模块拆成 ≥2 段；同一输入两次分区的区划分相同、令牌不同；旧区输出与旧 `domain-analysis.json` 被删除。
- O3 合并：令牌不符的区 `rejected-stale` 且退出码 3；跨区同 id 域合并为一个；冲突的 flow/step 改名且边跟随；不合格别名被拒。
- O4 覆盖：四个桶之和等于模块数；多模块夹具上「单分析器只覆盖 16/24 个 handler 模块」的录制输出，报告列出那 8 个 `silent-zero`。
- O5 实测：在合成多模块夹具上，用同一模型分别跑「单分析器（旧提示词、旧整份上下文）」与「按区」，用同一覆盖脚本计数，前后数字写进 PR。不设通过阈值，如实记录。
