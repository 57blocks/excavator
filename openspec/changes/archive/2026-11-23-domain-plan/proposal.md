## Why

`domain-area-split`（PR #158）之后，每个区的分析器各自命名本区的域，合并只把 id 完全相同的域并成一个。一个约 290 个模块的真实项目（Sonnet）：

- 34 个区、34 个分析器，合并后 103 个域、447 条流程、1,411 个步骤；
- 很多「域」其实是一个域的功能：三个计费域、三个促销域、两个节假日域、两个用户管理域；放数据模型的目录成了「… Schema」域；
- 编排者按 SKILL 第 4 步手写了一份 `aliases.json`，合并了 18 个 id——这正是无法复现的判断：换一次运行，别名表就不同；
- #158 之前一个分析器给出 7 个域、29 条流程，但很多模块没有覆盖。

#158 自己在大夹具上的实测也一样：9 个区得到 31 个域，而夹具只有 30 个后端实体模块。

根因是结构性的：**域的数量随区数增长，域的划分随每次采样漂移**。用户的要求是：每次运行都得到一致的数据；结果不能手改；修在流程里，不在跑完后改输出文件。

## What Changes

- **域规划（domain plan）只做一次、全项目一次**：新脚本 `plan-domains.mjs prepare` 从分区清单与抽取上下文写出固定形状的规划输入（每个模块：路径、文件名、入口点样本、导出名，均带省略计数）。新代理 `excavator-domain-planner` 读它，输出固定形状的规划：业务域与支撑域清单（`kind: business|support`）、每个模块恰好归一个域、跨域关系。`plan-domains.mjs accept` 校验：令牌、每个模块恰好一次、目标域存在、每个域至少一个模块、业务域数不超过 `max(3, ⌈√模块数⌉)`、支撑域至多 3 个；不合格就拒收并写明原因。
- **规划按模块集合摘要复用**：接受的规划写到 `<数据目录>/domain-plan.json`，带模块集合摘要（排好序的模块路径的 sha256）。下次运行模块集合相同 → 原样复用，不派规划代理；只有模块增删 → 已有模块的归属与已有域原样保留，只为新模块派规划代理（扩展模式，脚本拒收任何对已有归属的改动），删掉的模块剪掉、变空的域去掉。`--replan` 才重新规划全部。
- **区分析器不再写域**：分析器只写流程、步骤、`flow_step` 边与 `skippedModules`，每条流程在 `domainMeta.module` 写它起始的模块。分析器输出里的域节点、`contains_flow` 与 `cross_domain` 边被忽略并计数。规划与区分析互不依赖，可以同时跑。
- **合并按规则挂流程**：`merge-domain-areas.mjs` 读接受的规划（模块集合必须与本次清单一致），域节点只来自规划（`domainMeta.kind`、`domainMeta.modules`），每条流程挂到「第一个能定位的步骤所在模块」的域，没有可定位步骤时用它声明的 `domainMeta.module`，两者都没有记为 `unplaced`（可见、不编造归属）。`contains_flow` 边由脚本生成，跨域边来自规划。删去 `--aliases` 与 SKILL 中手写别名的一步。
- **守恒由脚本检查**：合并逐区核对流程、步骤与 `flow_step` 边进出相等（改名的按改名表对上），结果写进覆盖报告 `conservation`；不守恒退出码 4，不写合并结果。
- **覆盖报告**增加 `plan`（状态 new/extend/reused、摘要、业务域与支撑域数）、每个模块的 `domain`、流程的挂接方式计数（按步骤、按声明、`unplaced`）。#158 的四个桶、0 静默为零保持不变。

提交序列（每组一个 commit，合并用 `--merge`，不 squash）：
1. `docs(openspec): archive domain-area-split`
2. `docs(openspec): propose domain-plan`
3. `feat(excavator-domain): plan domains once per module set`
4. `feat(excavator-domain): home flows on the plan and check conservation`
5. `feat(excavator-domain): dispatch one planner and analyzers that write no domains`
6. `docs(openspec): record the measured agreement of domain-plan`

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `domain-area-coverage`：新增「域规划」「规划复用」「流程挂接与守恒」三条要求；「合并区输出」去掉别名、域改由规划提供；「每区一个分析器」的分析器不再写域。

## Impact

- `skills/excavator-domain/`：新增 `plan-domains.mjs`；改 `merge-domain-areas.mjs`、`SKILL.md`。`split-domain-areas.mjs`、`annotate-domain.mjs`、`extract-domain-context.py` 不改。
- `agents/`：新增 `excavator-domain-planner.md`；改 `excavator-domain-analyzer.md`（Option C 不写域）。
- 新的持久产物 `<数据目录>/domain-plan.json`（不在 `intermediate/`，Phase 5 不清）。
- `tests/domain/`：规划、复用、挂接、守恒的测试。
- 成本：冷启动多一次规划调用（输入随模块数线性、每模块有固定上界）；模块集合不变时规划调用为 0。区分析器调用次数不变。
