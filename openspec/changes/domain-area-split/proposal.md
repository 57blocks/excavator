## Why

`/excavator-domain` 今天对整个项目只派一个 domain-analyzer。在一个约 1 万个图节点、2,100 个文件、5 个子项目的真实项目上（Sonnet）：

- **图路径**：模型自己从 18 MB 的 `knowledge-graph.jsonl` 里挑记录，只产出 6 个域、16 条流程、59 个步骤；同一项目更早的一次运行有 29 条流程、157 个步骤。整块模块没有步骤。
- **`--full` 路径**：脚本列出 124 个入口点，产出 29 条流程、81 个步骤，但主后端约 25 个 handler 模块里仍有约 8 个没有流程，前端整体缺席；分析器自己说有几条流程没有读完。
- 一次 `--full` 运行里，第一个分析器拷贝了旧的输出文件，而不是做分析；编排者拒收后重派。
- 域标注报告写到了 `.excavator/excavator/` 下（目录重复）。

遗漏是静默的：没有任何产物说「哪些模块没有流程」。原因在代码里都能找到：

1. 一个分析器面对整个项目，上下文装不下，只能挑着读；
2. 分析器提示词写死「2–6 个域、每域 2–5 条流程」，整个项目最多约 30 条流程，与观察到的 29 条一致；
3. `extract-domain-context.py` 有几道静默上限：每个目录最多收 50 个文件，入口点最多 200 个、超 512 KB 时再砍到 100 个，文件签名只取全项目关键词排名前 40 个——一个大 handler 目录的后半截文件、和排名靠后的模块，在分析器看到之前就没了；
4. 分析器写到固定路径 `intermediate/domain-analysis.json`，上一次中断留下的同名文件、或 `.excavator/domain-graph.json`，都能被原样拷过去冒充本次结果，没有任何检查；
5. `publish-annotations.mjs` 的报告目录默认是 `<数据目录>/excavator`，即 `.excavator/excavator/`。

目标是给覆盖率一个确定性的下限，而不是加更多散文。按 AGENTS.md 的范围门：分片、合并、计数、新鲜度令牌都需要机器校验、可复用，落脚本；判断哪些代码构成业务流程、域该叫什么，仍由模型做。

## What Changes

- **抽取不再静默截断**：`extract-domain-context.py` 去掉「每目录 50 个文件」的上限；入口点上限提高并在产物里写明截断计数；每个文件都给签名（不再只取前 40）；整体超 512 KB 时不再砍入口点（分片后不需要整体塞给一个模型）。两条路径都先跑它。
- **新脚本 `split-domain-areas.mjs`**：把源文件按所在目录归成模块，模块按路径排序后贪心装进有字节预算的「区」；单个模块超预算时按文件拆成几段。有知识图且未加 `--full` 时，每个区附上该区文件的图节点（id、类型、名字、摘要、行范围），分析器从这里抄 `nodeIds`，不再自己读 18 MB 的图。写 `intermediate/domain-areas/manifest.json` 与每区一个上下文文件，并生成本次运行的令牌；开始前清掉上一次的区目录与旧的 `domain-analysis.json`。
- **每区派一个分析器**：分析器只看本区上下文，输出写到本区指定路径，并带回本次令牌。提示词去掉全局的域/流程数量上限，改为「本区每个有入口点的模块要么有流程，要么写进 `skippedModules` 并给理由」。
- **新脚本 `merge-domain-areas.mjs`**：令牌不符或缺失的区输出拒收（防止拷贝旧文件）；按 id 合并跨区同名的域（可选的别名文件由编排者给，脚本只校验并执行）；跨区重复的流程 id 加区后缀并记录；写出 `intermediate/domain-analysis.json` 供原有 4.5 锚定与校验使用，并写 `<数据目录>/reports/domain-coverage.json`：逐区、逐模块、逐个有入口点的文件给出状态，零流程的模块分成「声明跳过」「静默为零」「无入口点」三个可见桶，各桶之和等于模块总数。有区被拒或缺失时退出码为 3。
- **步骤锚定与校验不变**：Phase 4.5 的 `annotate-domain.mjs` 与 `validate-graph.mjs` 原样运行在合并结果上。
- **报告目录**：本 skill 调 `publish-annotations.mjs` 时显式传 `--reports-dir "$DATA_DIR/reports"`，不再落进 `.excavator/excavator/`。`publish-annotations.mjs` 的默认值属于 `/excavator`，本变更不动它（另一会话正在改 `skills/excavator/`），作为后续项。
- **SKILL.md 修正**：脚本路径一律用 `$PLUGIN_ROOT/skills/excavator-domain/…`（原文 `python ./extract-domain-context.py` 在项目根下找脚本，`<SKILL_DIR>` 未定义）。

提交序列（每组一个 commit，合并用 `--merge`，不 squash）：
1. `docs(openspec): propose domain-area-split`
2. `fix(excavator-domain): make the context extractor's caps visible`
3. `feat(excavator-domain): split candidate material into bounded areas`
4. `feat(excavator-domain): merge per-area analyses with a coverage report`
5. `feat(excavator-domain): dispatch one analyzer per area`

## Capabilities

### New Capabilities
- `domain-area-coverage`：按区派发领域分析、合并、逐区逐模块的覆盖报告与区输出的新鲜度令牌。

### Modified Capabilities
（无）

## Impact

- `skills/excavator-domain/`：`extract-domain-context.py`、新增 `split-domain-areas.mjs`、`merge-domain-areas.mjs`、`SKILL.md`。
- `agents/excavator-domain-analyzer.md`：新增区上下文输入（Option C）、令牌、`skippedModules`，去掉全局数量上限。
- `tests/domain/`：新增分片、合并、覆盖、抽取上限的测试与多模块夹具生成器。
- 不动 `skills/excavator/`、`packages/core/`。成本：分析器调用次数从 1 变为区数（默认预算下一个 2,000 文件的项目约十几个区），每个区的上下文有界。
