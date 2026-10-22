## Why

审计（`annotate-graph.mjs`）把模型画的 `calls` 边对到抽取器的调用记录上，用的是 `findRecord`：键是「调用方节点所在文件 + 目标节点的名字」。目标节点在哪个文件、是哪一个声明，它不看。

同一个审计已经知道每个调用点解析到哪里：`resolveUniqueCallSites` 在调用方文件及其 import 目标里按名字找声明，恰好一个的算唯一解析。可 `findRecord` 不用这个结果。于是：

- `app.ts` 从 `./util` 导入并调用 `log()`，`logger.ts` 也声明了 `log`，但 `app.ts` 没有导入它；
- 模型画了 `run → logger.ts#log`；
- 审计按「`app.ts` + `log`」找到记录，把这条边标成 `extracted`，附上调用行作证据，并认为这个调用点已经有边，不计入 `edge-missing`。

一条指错目标的边就这样以「有抽取证据」的身份通过了审计。审计是抓编造的仪器，它在目标错误时变绿，是仪器本身的缺陷。PR 57blocks/excavator#66 的评审把它列为既有问题，留给本变更。

## What Changes

- 调用点唯一解析时，抽取记录只支撑指向那个声明的边：目标节点的文件不是解析出的文件，就不算匹配。
- 这样的边不删、不改模型写的字段，加标记并计数：
  - `verification: "contradicted"`；
  - 不附证据行；模型写了 `extracted` 就保留，否则记 `inferred`；
  - 新缺口 `edge-target-mismatch`（scope `calls`），带样本，样本写出边、调用点的行，以及调用点解析到的文件。
- 被指错的调用点不算有边：没有别的边指向解析出的声明时，它照旧计入 `edge-missing|calls`。
- 有歧义或无法解析的调用点照旧只按名字匹配。
- stderr 汇总行加 `edge-target-mismatch=` 一项，与图里的缺口计数相同。
- `SKILL.md` 第 2.3 阶段补一句：这类边标 `contradicted`。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `facts-audit`：新增「调用边的目标要是调用点唯一解析到的声明」。

## Impact

- 改动：`skills/excavator/annotate-graph.mjs`、`skills/excavator/SKILL.md`；`tests/skill/excavator/test_annotate_graph.test.mjs` 加用例。
- 不改：
  - `resolveUniqueCallSites` 及其作用域。本变更只读它的结果，作用域以后怎么改（例如 PR 57blocks/excavator#66 的 `callScopePaths`），这条规则都跟着用；
  - 事实图、Lazy 驱动及其 `PIPELINE_VERSION`。它们不调用 `findRecord`。
- `annotate-graph` 的 `PIPELINE_VERSION` 不动：审计每次完整重算，没有按版本跳过的缓存。
- `audit.json` 的 `counts` 多一个键 `edgeTargetMismatch`；没有目标不符的边时，缺口列表与标注后的图逐字节不变。
