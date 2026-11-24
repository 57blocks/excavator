## Why

`domain-plan`、`domain-flow-homing`、`domain-choice-check` 之后，同一输入复用规划的两次运行，域规划逐字节相同、回落为 0。剩下的不稳定是流程集合本身。一个真实语料（多仓库：Go 后端、Express、React 前端）上，同一输入、复用规划的两次运行：

- 流程 id 的 Jaccard 0.31（id 由模型起名）；
- 首步文件的 Jaccard 0.56；
- `domainMeta.entryPoint` 是描述性字符串，Jaccard 0.46；
- 每个域的流程数最多相差 54%；
- 293 个模块里 81 个换了覆盖桶，其中 60 个在 `no-candidates` 与 `declared-skip` 之间来回：都是没有候选的模块，一次被模型写进 `skippedModules`，一次没写。

而 `route-entry-points`（PR #161）之后，事实图里已有 843 个解析出的入口点（方法、路径、处理者、文件、行），流程却不引用它们。用户的首要要求是每次运行的数据一致，产物不手改、修在流程里。已定的分工是：模型决定流程，脚本负责身份与覆盖账目。

## What Changes

- **入口点 id 与处理者组**：`extract-domain-context.py` 给每个事实入口点（`source: "script"`）写确定性的 `id`（`ep:<http|ui>.<方法与规范化路径的短横线串>`，撞名时按注册文件所在模块、再按序号消歧，全部在事实集合上算）与 `group`（同一处理者的入口点共用组首的 id）。分区照原样把它们带进区上下文；不在任何模块里的事实入口点记进清单。
- **分析器引用入口点**：起始于事实入口点的流程在 `domainMeta.entryPointIds` 里写所引用入口点的 id，一个流程只引用一个组，一个组只给一个流程；不写流程的入口点写进 `skippedEntryPoints: [{id, reason}]`（或所在模块写进 `skippedModules`）。定时任务、命令行、事件、模型补充的入口点等没有事实入口点的流程不写，照旧。
- **合并核对引用**：接受区输出时核对每个引用：id 不是本区的事实入口点（`unknown`）、一个流程引用了两个组（`mixed-groups`）、一个组被两个流程引用（`shared-group`）或字段不是字符串数组（`malformed`），该区记为 `rejected-entry-point`，逐条打印 `rejected-entry-point <区> <流程> problem=… ids=…`；分析器的 `check` 也打印这些行，以及本区既没被引用也没被跳过的入口点（`uncovered-entry-point`，不拒，提示补上）。`--accept-unchosen` 兜底时按固定规则丢掉无效引用并计数。
- **流程 id 由脚本派生**：有合法引用的流程，合并把 id 换成 `flow:` 加组首入口点 id 去掉 `ep:` 的部分，`domainMeta.entryPointIds` 按事实顺序写全，`entryPoint` 写成事实里的「方法 路径」，`entryType` 按入口点种类写（`http`；界面路由写 `manual`）。两次运行引用同一组，流程 id 相同，与模型起的名字无关。流程的起始模块取组所在文件的模块。
- **每个入口点一个可见桶**：覆盖报告加 `entryPointCoverage`：每个事实入口点恰好落一个桶，`in-flow`（自己或同组被流程引用）、`declared-skip`（自己或所在模块被声明跳过，带理由）、`silent`（逐条列出）、`area-not-accepted`、`outside-areas`；各桶之和等于事实入口点总数，不等即不写合并结果。打印计数行与每个 `silent-entry-point`。流程计数分 `anchored` 与 `unanchored`。
- **没有候选的模块不再进 `declared-skip`**：模块没有入口点、没有未识别文件时，即使被写进 `skippedModules` 也落 `no-candidates`，该声明计入 `skippedModulesWithoutCandidates`。

提交序列（每组一个 commit，合并用 `--merge`，不 squash）：
1. `docs(openspec): propose domain-flow-entry-points`
2. `feat(excavator-domain): give every fact entry point a stable id and handler group`
3. `feat(excavator-domain): check entry-point citations and derive flow ids from them`
4. `feat(excavator-domain): put every fact entry point in a coverage bucket`
5. `feat(excavator-domain): have analyzers cite fact entry points`
6. `docs(openspec): record the domain-flow-entry-points acceptance runs`

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `domain-area-coverage`：新增「流程引用事实入口点」与「每个事实入口点一个覆盖桶」；修改「覆盖报告」里没有候选的模块的分桶。

## Impact

- `skills/excavator-domain/extract-domain-context.py`：入口点 `id`、`group`。
- `skills/excavator-domain/split-domain-areas.mjs`：清单加 `entryPointsOutsideModules`。
- `skills/excavator-domain/merge-domain-areas.mjs`：引用核对、`rejected-entry-point`、派生流程 id、按入口点挂接、`entryPointCoverage`、模块分桶。
- `skills/excavator/semantic-language-audit.mjs`：`entryPointIds` 是 id，不当散文审。
- `agents/excavator-domain-analyzer.md`、`skills/excavator-domain/SKILL.md`。
- `tests/domain/`：新 `entry-point-anchoring.test.mjs`；抽取、合并、skill 契约测试。
- 成本：分析器要为每个事实入口点写引用或跳过理由，输出略长；`check` 多打印几行。
