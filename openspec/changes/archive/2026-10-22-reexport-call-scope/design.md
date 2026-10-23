## Context

非 Java 调用按名字解析。`build-fact-graph.mjs` 对每个非 Java 文件取 `scope = [row.path, ...importMap[row.path]]`，用 `lookupCandidates` 在作用域内各文件的声明里找与 `callee` 同名的声明：恰好一个就成边，零个记 `calls-unresolved`，多个记 `calls-ambiguous`。`annotate-graph.mjs` 的 `resolveUniqueCallSites` 用同样的作用域算期望的调用记录，结果是 unique、ambiguous、unresolved 三组。

这条规则本来就粗：文件从 X 导入任何东西，X 的全部顶层名字都进作用域。但在 32e165fa 之前，进作用域的文件至少都由 import 语句或 `require()` 带进来。32e165fa 把 `export … from` 也记成 import 条目，import map 不区分两者，于是只被转发的模块也进了作用域。

import map 的每个目标只有一个来源：`extract-import-map.mjs` 的主循环。主循环逐条处理抽取器的 import 条目，再处理补充抽取的来源（TS/JS 的 `require()`、Kotlin 的 import、Rust 的 `mod x;`）。只有它同时看得到一个目标是经哪条路径到达的。结构结果里的 import 条目不含 `require()`，`resolvedSources` 也不含补充抽取的来源。

## Goals / Non-Goals

**Goals:**
- 只经 `export … from` 到达的文件不进非 Java 调用的作用域，事实图与审计都是如此；
- 同一目标还经 import 语句、`require()` 或其它抽取路径到达时，照旧留在作用域里；
- `importMap`、`imports` 边以及其它读 import map 的地方不变。

**Non-Goals:**
- 副作用导入 `import './x'` 也不引入名字，但它在 32e165fa 之前就进作用域。这是既有行为，本变更不动；
- 不把作用域细化到逐个绑定，例如只放进 `import { a }` 的 `a`。这同样是既有的粗规则；
- 不改 Java 的调用解析，它按接收者类型解析，不用这个作用域。

## Decisions

### D1 在 import map 的产生处标出只经转发到达的目标

`extract-import-map.mjs` 在主循环里为每个文件记两组已解析目标：
- 转发条目（带 `reexports` 的条目）到达的目标；
- 其它条目与补充抽取到达的目标。

只在第一组、不在第二组的目标写进 `reexportOnly[path]`，排序与 `unresolved` 相同。没有这种目标的文件不写这个键。

为什么不在使用处推导：使用处只有结构结果的 import 条目与 `resolvedSources`，两者都看不到 `require()`。例如 `const { log } = require('./logger')` 加 `export { createLogger } from './logger'`，使用处会把 `logger` 误判为只经转发到达，进而漏掉一条真边。

### D2 转发条目总带 `reexports`

抽取器原先在转发名单为空时省略 `reexports`，于是 `export {} from './x'` 与 `import './x'` 都是 `specifiers: []`、没有 `bindings`、没有 `reexports`，无法区分。现在 `export … from` 条目总带 `reexports`，空时为 `[]`。读 `reexports` 的地方都按 `imp.reexports ?? []` 或 `Array.isArray` 读，空数组与缺省的效果相同；结构指纹只看 `source` 与 `specifiers`，也不受影响。

### D3 一个函数定义调用作用域

`fact-graph-resolve.mjs` 新增 `callScopePaths(importMap, path)`，返回本文件，加 `importMap[path]` 中不在 `reexportOnly[path]` 里的目标。`build-fact-graph.mjs` 与 `annotate-graph.mjs` 都调用它。`annotate-graph.mjs` 本来就只引入纯模块，引入这个纯函数不会把 `@excavator/core` 带进 `build-fact-graph` 的测试面。

### D4 Pipeline 版本

调用边与 calls-* 缺口会因此变化。`PIPELINE_VERSION` 从 `lazy-fact-graph/13` 升到 `/14`，已持久化的图在下次同步时按新作用域重建。`annotate-graph` 的版本不动：它每次完整运行都会重算，没有按版本跳过的缓存。

### D5 缺字段时的行为

没有 `reexportOnly` 的 import map，即本变更之前生成的，`callScopePaths` 照旧把全部目标放进作用域。Lazy 驱动与完整流程都在同一次运行里生成 `import-map.json` 再读它，不会出现新代码读旧 import map 的组合，因此不为缺字段另设缺口桶。

## 读 import map 的地方（逐个核对）

| 位置 | 读什么 | 用途 | 是否改 |
|---|---|---|---|
| `build-fact-graph.mjs` imports 边 | `importMap` | 文件到文件的 `imports` 边 | 否：转发也是依赖 |
| `build-fact-graph.mjs` 非 Java 调用 | `importMap` | 调用作用域 | **是** |
| `annotate-graph.mjs` `buildExpectedRecords` | `importMap` | 期望的 `imports` 记录 | 否 |
| `annotate-graph.mjs` `resolveUniqueCallSites` | `importMap` | 期望调用记录的作用域 | **是** |
| `annotate-graph.mjs` 输入摘要 | 整个 import map | 审计输入的摘要 | 否：新字段随输入变化 |
| `jsx-element-resolution.mjs` | `resolvedSources`、`unresolved` | 沿绑定与显式转发找 JSX 标签的目标 | 否：按绑定解析，不用作用域 |
| `coverage-ledger.mjs` | `unresolved` | `imports-unresolved` 缺口 | 否 |
| `compute-batches.mjs` | `scan.importMap` | 聚类与 `batchImportData` | 否 |
| `merge-batch-graphs.py` | `scan.importMap` | 恢复漏掉的 `imports` 边 | 否 |
| `prepare-incremental.mjs` | 增量提取的 `importMap` | 合并进 `scan-result.json` | 否 |
| `finalize-incremental.mjs` | `scan.importMap` | 刷新 `imports` 边 | 否 |
| `extract-structure-result.mjs` | `batchImportData` | `importCount` 指标 | 否 |
| `lazy-analyze.mjs` | 整个 import map | 交给 `buildFactGraph` | 否（只升版本） |
| `scripts/lib/large-repo-benchmark.mjs` | `importMap` | 形状校验、摘要、计数 | 否 |
| `agents/excavator-file-analyzer.md`、`agents/excavator-assemble-reviewer.md`、`agents/excavator-project-scanner.md`、`skills/excavator/SKILL.md` | `importMap` / `batchImportData` | 模型写或核对 `imports` 边 | 否 |
| `packages/core` `graph-builder.ts`、`fingerprint.ts` | 抽取器的 import 条目 | `imports` 边、结构指纹 | 否：不按名字解析调用 |

## 验收 oracle（动手前写死）

- **O1 复现（在 origin/main 的代码上失败）**：新测试 `tests/lazy/reexport-call-scope.test.mjs` 用真实 Lazy 驱动跑一个小夹具，然后用同一份结构结果与 import map 调用审计的 `resolveUniqueCallSites`。
  - a. 文件只经 `export { createLogger } from './logger'` 到达 `logger.ts`，`run(log) { log() }` 里的 `log()` 没有 `calls` 边，落进 `calls-unresolved`；
  - b. 文件从 `./util` 导入 `log` 又转发 `./logger`，两个文件都声明 `log`：`log()` 得到指向 `util.ts` 的 `log` 的边，不是 `calls-ambiguous`；
  - c. 审计对 a 给 unresolved，对 b 给 unique，目标是 `util.ts`。

  在改动前的代码上跑一次，记录失败的断言。
- **O2 不误删**：
  - 文件既转发又 `require()` `./logger` 时，`log()` 仍得到指向 `logger.ts` 的边；
  - 转发文件到 `logger.ts` 的 `imports` 边与 `importMap` 条目都还在。
- **O3 `export {} from`**：
  - 抽取器输出 `reexports: []`；
  - import map 把目标列进 `reexportOnly`；
  - 该文件对目标里同名函数的调用不成边。
- **O4 装置看得见**：逐个做变异，确认对应测试变红，然后还原。
  - i. `build-fact-graph.mjs` 改回旧作用域 → a、b 红；
  - ii. `annotate-graph.mjs` 改回旧作用域 → c 红；
  - iii. `extract-import-map.mjs` 不看 `require()`，把所有转发目标都算进 `reexportOnly` → O2 红；
  - iv. 抽取器改回空名单时省略 `reexports` → O3 红。
- **O5 门**：三件套、`pnpm --filter @excavator/core test`、`pnpm run typecheck`、`openspec validate --all --strict`。
- **O6 真实语料（确定性，零模型）**：在 go-multirepo 的前端成员与 mixed-suite 上，用 origin/main 与本分支各跑一次 Lazy 事实构建，比较两次的图。判据：
  - 每条消失的 `calls` 边，目标文件都在调用方文件的 `reexportOnly` 里；
  - 每条新增的 `calls` 边，调用方文件都有 `reexportOnly` 条目；
  - `calls` 以外的边集合不变；
  - `calls-*` 以外的缺口计数不变；
  - `importMap` 不变。

  变化按「编造的边减少」与「歧义解开」分开计数。记录只写计数与摘要，不写路径。

## 验收记录

- **O1 复现：** 在 origin/main 加提案（`eb025b34`）的树上跑新测试，9 个里 7 个失败：
  - 事实图画出 `run → logger.ts#log` 与 `flush → logger.ts#log` 两条编造的边；
  - `report` 对 `util.ts#log` 的调用落进 `calls-ambiguous`，没有边；
  - 审计把对参数 `log` 的调用算成唯一记录；
  - 版本、`reexportOnly`、空转发的 `reexports: []` 三项也不成立。

  修复后 9 个全过。改前就通过的两个是改前改后都应成立的（O2）。
- **O2：** 转发目标仍在 `importMap` 里，并有 `imports` 边；同时 `require()` 的文件仍有指向 `logger.ts#log` 的边。改前改后都成立。
- **O3：** 核心用例与流水线用例都通过。
- **O4：** 每个变异都让对应测试变红，还原后全绿。
  - i 事实图回到旧作用域 → 流水线 3 个用例红（参数调用、歧义、空转发）；
  - ii 审计回到旧作用域 → 审计用例红；
  - iii `require()` 不算绑定 → 流水线 3 个用例红。import map 的单元用例起初没有红：夹具 `require()` 了 `./c`，却没有转发它。补上转发（`b8deb1b2`）后，这个用例对 iii 与「import 语句不算绑定」两个变异都变红；
  - iv 抽取器在名单为空时省略 `reexports` → 核心用例红，重建 dist 后流水线 4 个用例红。
- **O5：** 核心测试 1438 个、typecheck、`openspec validate --all --strict` 都通过。`pnpm test` 在 head 上空载重跑全过（155 个文件、4146 个测试、4 个跳过）。
  - 第一次与四次语料构建同时跑，3 个慢测试超时；
  - 中间提交 `b44df1cb` 上，同样 3 个在机器负载高时超时（其它会话，load average 约 100）；
  - 这 3 个测试在两个提交上单独跑都通过。
- **O6：** 两套语料的判据全部满足，变化为零。
  - 规模：go-multirepo 的前端成员有 9 个文件、189 个只经转发到达的目标；mixed-suite 的 kotlin-portal 成员有 17 个文件、103 个；
  - 两边的节点、`calls` 边（1330、1671）、其它边、缺口计数、`importMap` 全部相同；
  - 原因：有这种目标的文件里一共只有 2 个调用点，结果都不依赖转发目标。这两套语料里没有这个缺陷的实例，修复的效果只在夹具上看得到；
  - 比较脚本先在复现夹具上验过：报出已知的 2 条消失与 1 条新增；输入对调时判据失败。
- **评审（第 1 轮，`b8deb1b2`）：** 0 Important、0 Nit、2 Pre-existing，都答复为不改（intentional），理由见 PR。
  - 按文件放进作用域的规则：导入了某模块，该模块的全部顶层名字都进作用域，所以对参数的调用仍可能连到被导入模块里的同名函数。本变更与它的交互：同时 `export *` 一个声明了 `log` 的模块、又从另一个也声明了 `log` 的模块导入时，main 上是 `calls-ambiguous`，本分支画出指向被导入模块的边。这与 32e165fa 之前的结果相同；
  - 审计的 `findRecord` 只按调用方文件与被调者名字匹配模型的 `calls` 边，不看作用域，所以模型画的这类边仍被标为 extracted。

  两项都早于本变更，作为后续工作提出。不需要第 2 轮：没有 Important，之后只有 `openspec/` 下的文档提交。
