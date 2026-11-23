## Context

`domain-flow-homing` 之后：规划先于区分析，区上下文带 `domainPlan`（每个模块的 `choose`）；分析器为需选域模块的流程写 `domainMeta.domain` 与 `domainReason`；合并按起始模块挂接，需选域流程没选或选了清单外的值就回落到模块的域并计数。区的接受（`acceptOutput`）只看令牌与 JSON。

## Goals / Non-Goals

**Goals**
- 需选域模块的流程没有合法选择与理由时，在分析器还能补的阶段被拒、被退回，而不是在合并时静默按回落定域。
- 检查与挂接对「起始模块」的判断完全一致：检查放过的区，合并不会再回落。
- 回落仍作为兜底存在、仍被计数和打印，但只能经一条显式的路径到达。

**Non-Goals**
- 不改规划、挂接规则、守恒、四个桶。
- 不让脚本判断流程属于哪个领域（选择仍由分析器做）。
- 不让流程内容跨运行一致（沿用之前的非目标）。

## Decisions

### D1 检查放在接受里，而不是另起一个校验步骤

候选：(a) 合并前单独一个校验脚本；(b) `acceptOutput` 里加检查，新状态 `rejected-choice`。采用 (b)：skill 已有「被拒的区重派一次」的流程，`rejected-choice` 直接复用它；被拒区的内容不进合并结果，因此回落在默认路径上不可达。检查用存储的规划（与合并同源），不读区上下文里的 `domainPlan` 副本。

检查要求三件事：起始于需选域模块（`mixed` 或归在支撑域）；`domainMeta.domain` 是规划域 id；`domainMeta.domainReason` 去空白后非空。没写理由的选择也拒：没有理由的选择无法与随手填的 id 区分，支撑域里的这类流程今天本就算 `support-unchosen`。起始模块为空（`unplaced`）或模块不需选域的流程不查。

起始模块的求法从挂接里抽成一个函数 `homeModuleOf`，检查与挂接都调用它（第一个可定位步骤所在模块，否则本区持有的 `domainMeta.module`）。所以「检查通过」严格蕴含「合并不回落」，测试直接断言：通过检查的区合并后 `fallbackMissing`、`fallbackInvalid`、`choicesWithoutReason`、`support.unchosen` 均为 0。

### D2 分析器自查：区上下文里的 `check` 命令

只在合并时拒，代价是整区重派（重新分析全部流程，流程内容也随之变）。让分析器在自己的回合里先跑同一个检查、就地补选，代价是几次毫秒级的脚本调用。命令由分区脚本写进区上下文（`check` 字段，绝对路径、单引号转义），因为分析器只拿到上下文路径；skill 不必把插件路径交给它。`--check` 只读：不写合并结果、不写覆盖报告。

### D3 兜底：`--accept-unchosen`，只在一次重派之后

重派后仍被拒时有两条路：丢掉整个区（今天对 `rejected-stale` 的做法），或接受并让回落计数。丢区会让该区所有流程消失，覆盖损失远大于几条流程挂到模块的域，所以选后者，但要显式：合并加 `--accept-unchosen`，这些区照常接受，区结果带 `unchosen`（每条未选流程及其问题），区行打印 `unchosen=<n>`，挂接规则原样生效：没写或清单外的选择回落到模块的域并计入回落，没写理由的选择保留所选域并计入 `choicesWithoutReason`，落在支撑域的都计入 `support-unchosen`。skill 只在那一次重派之后用它。`missing`、`rejected-stale`、`rejected-parse` 不受此开关影响。

## Risks / Trade-offs

- **分析器无视自查**：合并仍会拒、skill 重派一次；最坏情况走 `--accept-unchosen`，回落可见、按区计数。
- **重派改变该区流程**：被拒区的流程由新分析器重写。流程内容本就每次重写，不新增漂移来源；分析器自查让这条路很少走到。
- **检查更严**：没写理由的选择从「计数」变成「被拒」。理由是一句话，代价很小。

## Oracles（动手前写死）

- O1 单元：需选域模块（`mixed`）里一条没选的流程 → `rejected-choice`，原因与打印行点名流程与全部允许的域 id；同一流程补上合法 id 与理由 → `accepted`。清单外 id → `invalid`（带所写值），理由为空白 → `no-reason`，无步骤靠 `domainMeta.module` 定位的 → `missing`。单一业务模块与无起始模块的流程不查。起始模块按第一个可定位步骤（与挂接相同）。令牌与解析检查先于选域检查。
- O2 兜底可达性：通过检查的区合并后四个回落计数为 0；同一失败输出默认被拒，只有 `allowUnchosen` / `--accept-unchosen` 下被接受，回落计数为 1。
- O3 夹具端到端（`mixed-legacy.mjs`，一区）：区上下文的 `check` 命令经 shell 运行——没选时退出 3 并打印该流程与允许 id，合并退出 3、区为 `rejected-choice`、合并结果无流程、回落 0；补选后 `check` 打印 `area-001 accepted` 退出 0，合并退出 0、流程挂到所选域；`--accept-unchosen` 下合并退出 0、区带 `unchosen`、回落 1、区行 `unchosen=1`。
- O4 装置先验：O1–O3 的新测试在旧脚本上红、在新脚本上绿。
- O5 skill 契约：分析器说明运行 `check`、按 `rejected-choice` 补选；SKILL 先重派（带 `rejected-choice` 行）再 `--accept-unchosen`。
