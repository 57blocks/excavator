## Why

`domain-plan`（PR #159）让一个规划代理把每个模块（目录）整体归到一个域，合并再把每条流程挂到它起始模块的域。域清单因此跨运行稳定，但「目录即模块」把混合目录里的业务流程整批送进了支撑域。一个约 290 个模块的真实项目（Sonnet）：

- 规划给出 12 个业务域 + 3 个支撑域，两次运行的域完全相同——这一点要保留；
- 约四分之一的流程落在支撑域：一个遗留服务的 `routes` 与 `services` 目录装着多数业务逻辑（休假、工时、用户等），规划因为它们横跨多个领域把它们归到「Shared Libraries」，分别带走 32–33 与 5–7 条流程；
- 于是业务域「Worklog」只有 5–6 条流程，遗留的工时流程都在 Shared Libraries 里；
- 一个装定时业务任务的 `cmd` 目录把 18 条流程送进了「Infrastructure」。

#159 的设计已写明这条局限（「目录即模块：一个目录装多个领域只能整体归一个域」）。用户的要求不变：跨运行一致；结果不手改；修在流程里。

## What Changes

- **规划标出混合模块**：规划输出新增 `mixed`：横跨两个以上业务领域的模块（例如每个领域一个文件的遗留 `routes/`、`services/`、定时任务目录）。规划代理的说明改为：支撑域只放没有业务行为的模块；装业务路由、业务服务或业务定时任务的目录只服务一个领域就归那个业务域，服务多个领域就标为 `mixed`。`accept` 校验 `mixed` 只含本次要规划的模块、不重复；扩展模式不能改已有标记。存储格式升为 `excavator-domain-plan/2`，旧格式的规划按「格式不对」重新规划一次（零兼容）。
- **挂接改为两档**：流程的起始模块（首个可定位步骤所在模块，否则声明模块，规则不变）若是单一业务域的模块，流程照旧挂到该域（`module`）；若起始模块被标为 `mixed` 或归在支撑域（统称「需选域」模块），流程挂到分析器在 `domainMeta.domain` 里从规划域清单选定的域（`choice`），选择与理由（`domainMeta.domainReason`）记进覆盖报告；没选或选了清单外的 id，回落到模块的域（`fallback`），逐条计数并打印。
- **支撑域里的流程必须可解释**：覆盖报告新增 `flows.support`：支撑域里的流程总数、其中分析器明确选了支撑域并写了理由（判定为非业务）的数、其余（回落或选择没写理由）的数；后者逐条打印 `support-unchosen`。
- **规划先于区分析**：分析器要从固定的域清单里选，所以规划（未复用时）要先被接受，`plan-domains.mjs` 再把域清单（id、kind、名字、摘要）与本区每个模块的域和是否需选域写进每个区上下文的 `domainPlan`，然后才派区分析器。复用规划的运行在 `prepare` 时就写好，顺序与今天相同。
- **分析器**：Option C 对起始于「需选域」模块的每条流程，从 `domainPlan.domains` 选一个 id 写进 `domainMeta.domain`，并写一句理由；健康检查、日志轮转、数据库维护这类非业务流程选支撑域。其他流程不写。
- 域清单、模块归属、规划复用、四个桶、0 静默为零、守恒都不变。

提交序列（每组一个 commit，合并用 `--merge`，不 squash）：
1. `docs(openspec): archive domain-plan`
2. `test(excavator-domain): add a fixture with mixed business directories`
3. `docs(openspec): propose domain-flow-homing`
4. `feat(excavator-domain): mark mixed modules in the plan and hand it to the areas`
5. `feat(excavator-domain): home flows of mixed and support modules on the analyzer's choice`
6. `feat(excavator-domain): plan before the areas and let analyzers choose a planned domain`
7. `docs(openspec): record the measured homing of domain-flow-homing`

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `domain-area-coverage`：「域规划」加混合模块标记；「规划复用」带上标记；「流程挂接与守恒」加需选域模块的选择、回落与支撑域计数；「每区一个分析器」改为规划先于区分析、区上下文携带规划。

## Impact

- `skills/excavator-domain/plan-domains.mjs`：`mixed` 校验与存储、格式 /2、把规划写进区上下文。
- `skills/excavator-domain/merge-domain-areas.mjs`：两档挂接、`flows.choices`、`flows.support`、新的打印行。
- `skills/excavator-domain/SKILL.md`：Phase 4 顺序（规划 → 接受 → 区分析）。
- `agents/excavator-domain-planner.md`、`agents/excavator-domain-analyzer.md`。
- `tests/domain/`：规划、合并、skill 契约测试；新夹具 `tests/fixtures/domain-areas/mixed-legacy.mjs`。
- 成本：模型调用次数不变；冷启动与扩展运行的墙钟时间多一次规划调用的时长（规划不再与区分析并行）；复用规划的运行不变。已存的 /1 规划会重新规划一次。
