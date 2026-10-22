## Why

提交 32e165fa 让 TS/JS 抽取器把 `export … from 'S'` 也记为来源 `S` 的 import 条目，import map 因此为桶文件解析出目标，桶文件获得 `imports` 边。

事实图为非 Java 文件解析调用时，被调者的作用域是「本文件 + import map 列出的全部目标」，按名字在这些文件的声明里找（`build-fact-graph.mjs`）。审计算期望的调用记录用的是同一个作用域（`annotate-graph.mjs` 的 `resolveUniqueCallSites`）。转发不在本文件引入任何本地名字，被转发模块的声明却因此进了调用作用域。评审给的例子：

- 文件写着 `export { createLogger } from './logger'` 与 `function run(log) { log() }`。32e165fa 之前，对参数 `log` 的调用是 `calls-unresolved`；之后它成了一条指向 `logger.ts` 里 `log` 的 extracted `calls` 边。这条边是编造的。
- 文件从 `./util` 导入 `log`，又转发 `./logger`，两个文件都声明了 `log`。原本唯一的边变成 `calls-ambiguous`。这是遗漏。

审计用同一个作用域，于是把第一例算成唯一解析的期望记录：模型图没有画这条编造的边时，审计报 `edge-missing`。第二例则从唯一记录变成歧义，审计不再检查它。

## What Changes

- TS/JS 抽取器：`export … from` 条目总带 `reexports`，`export {} from './x'` 记为空数组。这样转发条目与副作用导入 `import './x'` 在结构上可以区分。
- `extract-import-map.mjs` 输出新字段 `reexportOnly`：每个文件里只经转发到达的已解析目标，即没有任何 import 语句、`require()` 或其它抽取路径到达的目标。`importMap` 本身不变。
- 事实图与审计的非 Java 调用作用域改为：本文件，加 `importMap` 的目标，减去 `reexportOnly`。两处共用 `fact-graph-resolve.mjs` 里的同一个函数。
- `PIPELINE_VERSION` 升到 `lazy-fact-graph/14`，已持久化的 Lazy 图按新作用域重建。
- 新增测试：
  - 用真实 Lazy 驱动在小夹具上复现，在 origin/main 上失败；
  - import map 与核心抽取器各加用例。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `fact-graph`：新增「非 Java 调用的作用域不含只经转发到达的文件」。
- `facts-audit`：新增「审计的期望调用记录用同一个作用域」。

## Impact

- 改动：
  - `packages/core/src/plugins/extractors/typescript-extractor.ts`、`packages/core/src/types.ts` 的注释，以及核心测试；
  - `skills/excavator/extract-import-map.mjs`、`skills/excavator/fact-graph-resolve.mjs`、`skills/excavator/build-fact-graph.mjs`、`skills/excavator/annotate-graph.mjs`、`skills/excavator/lazy-analyze.mjs`；
  - 测试：新建 `tests/lazy/reexport-call-scope.test.mjs`；`tests/skill/excavator/test_extract_import_map.test.mjs` 加用例；七个钉着 `lazy-fact-graph/13` 的 Lazy 测试改成 `/14`。
- 不改：`imports` 边、`importMap` 本身、批次构建、合并时的 `imports` 边恢复、增量刷新、JSX 解析、覆盖账本。它们要的是模块依赖，转发也是依赖。
- 在本变更之前生成、没有 `reexportOnly` 的 import map：作用域照旧，含转发目标。Lazy 与完整流程都在同一次运行里生成 import map 再读它，不会混用新旧版本。
