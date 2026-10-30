## Why

非 Java 调用按名字解析。事实图（`build-fact-graph.mjs`）为调用点取作用域 `callScopePaths`：本文件，加 import map 解析到的全部目标（减去只经转发到达的 `reexportOnly`），然后在这些文件的全部声明里找与被调者同名的声明。审计（`annotate-graph.mjs` 的 `resolveUniqueCallSites`）用同一个作用域算期望的调用记录。

对 TS/JS，这条规则让被导入模块声明的每个名字都能从导入方调用，包括导入方没有导入的名字。reexport-call-scope 的评审把它记为既有缺陷：

- 文件写着 `import { createLogger } from './logger'` 与 `function run(log) { log() }`，事实图画出 `run → logger.ts#log`。`log` 是参数，这条边是编造的；
- 文件写着 `export * from './a'` 与 `import { helper } from './b'`，`a.ts` 与 `b.ts` 都声明了 `log`，对 `log` 的调用解析到 `b.ts#log`。文件没有导入 `log`；
- 同理还有两种：从包导入的名字（`import { format } from 'date-fns'`）与某个被导入的仓库文件里的声明同名；参数或局部变量遮蔽了本文件导入或声明的名字。

审计用同一个作用域，于是把这些调用点算成唯一解析的期望记录：模型图没有画这些编造的边时，审计报 `edge-missing`。

## What Changes

- TS/JS 调用点按本文件绑定的名字解析被调者，与 JSX 元素同一套规则：
  - 根名字是本文件 import 的绑定（具名、默认、命名空间）时，沿 import map 的 `resolvedSources` 找到模块，在模块的导出里找导入名：显式转发、本地导出、`export *`；
  - 否则找本文件的顶层函数或类；
  - 都没有，落进 `calls-unresolved`。
  - 成员调用 `ns.f()` 只在命名空间上继续解析。其它成员调用（`this.f()`、`obj.f()`）照旧落进 `calls-unresolved`。
- TS/JS 抽取器给根名字被外层函数绑定的调用点标 `local: true`，复用 JSX 元素已有的作用域收集。这样的调用点落进 `calls-unresolved`。
- JSX 元素的绑定解析抽成共享模块，JSX 元素、事实图的调用、审计三处共用。JSX 的行为不变。
- 审计对 TS/JS 调用点用同一套解析。
- `require()` 绑定的名字不在结构结果的 `bindings` 里，对它们的调用落进 `calls-unresolved`。这是可见的覆盖缺口，作为后续工作提出。
- TS/JS 的 `calls-unresolved` 与 `calls-ambiguous` 用专门的原因文本，写明这些去向。
- Java 与其它语言不变，仍按 `callScopePaths` 解析。
- `PIPELINE_VERSION` 升到 `lazy-fact-graph/15`。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `fact-graph`：新增「TS/JS 调用按本文件的绑定解析被调者」；「非 Java 调用的作用域不含只经转发到达的文件」限定为 TS/JS 以外的非 Java 语言，其中 `require()` 场景改为只断言 `reexportOnly`。
- `facts-audit`：「审计的期望调用记录用事实图的调用作用域」改为 TS/JS 用同一套绑定解析。

## Impact

- 改动：
  - `packages/core/src/plugins/extractors/typescript-extractor.ts`、`typescript-jsx.ts`、`packages/core/src/types.ts`，以及核心测试；
  - `skills/excavator/module-binding-resolution.mjs`（新建）、`jsx-element-resolution.mjs`、`fact-graph-resolve.mjs`、`build-fact-graph.mjs`、`annotate-graph.mjs`、`extract-structure-result.mjs`、`lazy-analyze.mjs`；
  - 测试：新建 `tests/lazy/import-binding-call-scope.test.mjs`；`tests/lazy/reexport-call-scope.test.mjs` 的 `require()` 用例改为断言缺口；八个钉着 `lazy-fact-graph/14` 的 Lazy 测试改成 `/15`。
- 行为变化（TS/JS 的 `calls` 边与 `calls-*` 缺口）：
  - 只靠同名搜索得到的边消失，调用点落进 `calls-unresolved`；
  - 经改名导入、默认导入、命名空间成员、桶文件转发解析到的调用点获得新边；
  - 原来因多个被导入文件同名而歧义的调用点，按绑定可能成边或落进 `calls-unresolved`；
  - CommonJS 文件跨文件的调用落进 `calls-unresolved`。
- 不变：`imports` 边、`importMap`、`reexportOnly`、JSX 元素的结果、Java 与其它语言的调用解析。
