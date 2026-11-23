## Why

`domain-flow-homing`（PR #160）让分析器为「需选域」模块（规划标为 `mixed`，或归在支撑域）里起始的流程从规划的域清单里选域。真实语料上支撑域流程从约 25% 降到 4–6%。但没选的流程今天只是被容忍并计数：合并把它回落到模块的域，记 `fallbackMissing` / `support-unchosen`。一次真实运行里，归在支撑域的前端 API 客户端模块起始的 8 条业务流程就这样落进了一个共享库支撑域；同一输入的另一次冷运行回落为 0。结果因运行而异，而用户的首要要求是产物跨运行一致、产物不手改、修在流程里。

回落发生在合并时，分析器已经结束，没有人能补选。要让「没选」在分析器还能补的时候被发现并退回去。

## What Changes

- **区输出的接受加选域检查**：`merge-domain-areas.mjs` 接受区输出时，在令牌检查之后，对每条起始于需选域模块的流程（起始模块的求法与挂接完全相同）要求 `domainMeta.domain` 是规划里的域 id、`domainMeta.domainReason` 非空。任一条不满足，该区记为 `rejected-choice`（与 `rejected-stale`、`rejected-parse` 并列，内容不进合并结果，退出码 3），并逐条打印 `rejected-choice <区> <流程> module=<模块> problem=<missing|invalid|no-reason> allowed=<规划全部域 id>`。
- **分析器自查**：分区脚本在每个区上下文里写 `check`（运行该区接受检查的命令，`merge-domain-areas.mjs <根> --check <区>`，只读、不写任何文件，接受退出 0、否则退出 3 并打印同样的行）。分析器写完输出后运行它，按 `rejected-choice` 行补选并重跑，最多三次。
- **skill 的重试与兜底**：合并后仍有 `rejected-choice` 的区，照旧重派一次全新分析器（把该区的 `rejected-choice` 行加进提示词）；仍被拒时，用 `--accept-unchosen` 再合并一次：这些区被接受、区行打印 `unchosen=<n>`、覆盖报告的区行带 `unchosen` 列表，没写或写了清单外 id 的流程由原有回落挂到模块的域并计入 `fallback`，写了合法 id 但没写理由的流程保留所选域并计入 `choicesWithoutReason`（落在支撑域的同时计入 `support-unchosen`）。`--accept-unchosen` 只在那一次重派之后使用。
- **回落保留为兜底**：合并的回落与 `fallbackMissing`、`fallbackInvalid`、`choicesWithoutReason`、`support-unchosen` 计数不变；它们现在只会在区经 `--accept-unchosen` 被接受（未通过检查）时出现。

提交序列（每组一个 commit，合并用 `--merge`，不 squash）：
1. `docs(openspec): propose domain-choice-check`
2. `feat(excavator-domain): reject area outputs whose choose-module flows have no reasoned domain choice`
3. `feat(excavator-domain): have analyzers check their output and retry choice rejections once`

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `domain-area-coverage`：新增「区输出的选域检查」。

## Impact

- `skills/excavator-domain/merge-domain-areas.mjs`：`checkChoices`、`acceptOutput` 的选域检查、`rejected-choice` 行、`--check`、`--accept-unchosen`；挂接与检查共用一个求起始模块的函数。
- `skills/excavator-domain/split-domain-areas.mjs`：区上下文加 `check`。
- `skills/excavator-domain/SKILL.md`、`agents/excavator-domain-analyzer.md`。
- `tests/domain/`：新 `choice-check.test.mjs`；合并与 skill 契约测试。
- 成本：分析器多跑一到三次只读检查命令（毫秒级）；被拒的区多一次重派（只在分析器自查后仍未补选时）。
