## Context

非 Java 调用点的 `callee` 是源码里被调用表达式的原文（`log`、`util.helper`、`this.save`）。事实图对每个非 Java 文件取 `callScopePaths(importMap, path)`：本文件，加 `importMap[path]` 中不在 `reexportOnly[path]` 里的目标；再用 `lookupCandidates` 在这些文件的全部声明里找与 `callee` 原文同名的声明：恰好一个成边，零个记 `calls-unresolved`，多个记 `calls-ambiguous`。审计的 `resolveUniqueCallSites` 用同一个作用域，按「有同名声明的文件数」把调用点分成唯一、歧义、无法解析三组。

这条规则按文件放进作用域：文件从模块 X 导入任何东西，X 的全部顶层名字都可以被调用。TS/JS 的结构结果里其实有更细的信息：
- 每个 import 条目带 `bindings`：本地名到导入名，导入名是导出名、`default` 或 `*`；
- import map 的 `resolvedSources` 给出每个说明符解析到的仓库文件，`unresolved` 列出解析不到的说明符（包或坏路径）；
- 导出条目带 `local`（导出名与本地声明名不同时），`export … from` 条目带 `reexports`。

JSX 元素引用（`jsx-element-resolution.mjs`）已经按这些信息解析标签：根名字先找 import 绑定，沿 `resolvedSources` 到模块，再在模块的导出里找导入名；没有绑定才找本文件的顶层函数或类。TS/JS 抽取器还为 JSX 元素收集外层函数绑定的名字，被参数或局部变量遮蔽的标签标 `local`。

## Goals / Non-Goals

**Goals:**
- TS/JS 调用点只解析到本文件真正绑定的东西：本文件的顶层函数或类，或 import 绑定经模块导出指向的声明；
- 被外层函数的参数或局部变量遮蔽的名字不解析到模块级的声明；
- 不能绑定的形式落进可见的 `calls-unresolved`，不静默丢掉；
- 事实图与审计用同一套解析。

**Non-Goals:**
- 不读 CommonJS：`require()` 绑定的名字、`module.exports` 与 `exports.x` 都不读，这类调用落进 `calls-unresolved`。读它们要在抽取器里新增结构字段，并且 CommonJS 的导出没有 ES 导出那样的声明式形式，另立变更；
- 不解析对值的成员调用（`this.f()`、`obj.f()`、`Class.staticMethod()`），与改动前相同；
- 不改 Java 与其它语言的调用解析，它们仍用 `callScopePaths`；
- 不改审计的 `findRecord`：它只按调用方文件与被调者原文匹配模型的边，是另一个既有问题。

## Decisions

### D1 TS/JS 调用按绑定解析，与 JSX 元素同一套规则

语言为 `typescript` 或 `javascript` 的文件，每个调用点按以下顺序解析：
1. 调用点标了 `local`（见 D3）：`calls-unresolved`；
2. `callee` 不是用 `.` 连接的标识符（`a()()`、`a?.b`、`a[b]`、`(0, a)`、跨行的成员链）：`calls-unresolved`；
3. 根名字是本文件 import 的绑定：说明符没有解析到仓库文件时 `calls-unresolved`；解析到文件时，在该文件的导出里找导入名：先跟显式转发，再找本地导出（按本地声明名在该文件的作用域里继续），最后跟 `export *`。`default` 只匹配默认导出，`*` 得到命名空间；
4. 否则找本文件的顶层函数或类（不含有 `owner` 的声明）；
5. 都没有：`calls-unresolved`。

成员段只在命名空间上继续解析；落在函数、类或值之后还有段，或整个被调者只是命名空间（`ns()`），都是 `calls-unresolved`。最后得到一个声明时成边（调用方的解析不变，仍可能落进 `calls-caller-unresolved`）；得到多个声明，或多个 `export *` 给出不同目标时，`calls-ambiguous`；其余都是 `calls-unresolved`。

为什么在导出里找，而不是在绑定的模块里按名字找声明：后者仍是同名搜索。`export { other as log }` 加一个未导出的 `function log` 会被解析到错的声明；桶文件只转发、不声明，名字找不到。导出是 import 实际绑定的东西，JSX 元素已经按它解析，`calls` 边对同一个组件不应有两套规则。

### D2 共享的绑定解析模块

把 `jsx-element-resolution.mjs` 里的绑定与导出解析（`bindingsOf`、`moduleOf`、`resolveImported`、`resolveExport`、`lookupExport` 与根名字加成员段的解析）原样移到新模块 `module-binding-resolution.mjs`，导出一个工厂 `createModuleBindingResolver({ rows, importMap, topLevelDecls })`，返回 `resolveName(path, name)`。JSX 元素在调用它之前照旧处理 `local` 与 `syntaxError`；事实图与审计的调用点在调用它之前处理 D1 的 1、2 两步。三处结果的种类相同：`decls`、`external`、`unresolved`、`ambiguous`、`unbound`。

模块是纯函数，不读盘、不引入 `@excavator/core`：`annotate-graph.mjs` 只引入纯模块，`build-fact-graph` 的测试面也不需要构建。

`fact-graph-resolve.mjs` 新增 `resolveBoundCallSite(resolver, path, site)`，把 D1 的 1、2 两步与结果种类到 `edge` / `calls-ambiguous` / `calls-unresolved` 的映射放在一处，事实图与审计都调用它。

### D3 抽取器标出被外层函数绑定的调用点

TS/JS 抽取器在 `extractCallGraph` 里为每个调用点取被调表达式的根标识符（标识符本身，或成员表达式最左端的标识符），沿外层函数作用域查它是否被绑定：参数、解构出的名字、局部变量、局部函数或类、`catch` 参数、`for…in/of` 变量。被绑定时该调用点带 `local: true`。名字的收集复用 `typescript-jsx.ts` 的 `boundNames`：按函数作用域收集，块级名字算整个函数，偏向多标。多标只会把调用点推进 `calls-unresolved`，漏标会生成错边。

`extract-structure-result.mjs` 的 `mapCallGraph` 逐个列出调用点保留的字段，`local` 要加进去，否则在写进 `structure-all` 之前就被丢掉；`isValidCallGraph` 校验它只能是 `true`。

### D4 CommonJS 落进可见缺口

`const { log } = require('./logger')` 不在结构结果的 `bindings` 里，`log` 在本文件既不是 import 绑定也不是顶层声明，按 D1 落进 `calls-unresolved`。改动前它经 `importMap` 进作用域，常常得到正确的边。保留旧行为只对 `require()` 的目标做同名搜索，等于给一类文件留下本变更要去掉的编造来源（对参数 `next()`、`callback()` 的调用会连到被 `require()` 的模块里的同名函数）。按「编造零容忍、覆盖缺口可见即可」，CommonJS 的调用作为可见缺口留下，`calls-unresolved` 的原因文本写明 `require()` 绑定的名字不读。读 CommonJS 绑定与导出另立变更。

### D5 审计用同一套解析

`resolveUniqueCallSites` 对 TS/JS 行用同一个工厂与 `resolveBoundCallSite`，顶层声明取自 `expected.declarations` 里没有 `owner` 的函数与类，与审计别的部分用同一份声明。结果是边时，记录的 `targets` 是目标声明所在的文件；歧义与无法解析时为空（`resolveBoundCallSite` 只为边给出声明）。

唯一记录另带它到达的声明（文件与名字）。原因是被调者原文不一定是声明的名字：改名导入（`write` 对 `log`）、默认导入、命名空间成员（`util.helper` 对 `helper`）、改名导出都不同。所以 `edge-missing` 对 TS/JS 记录不按原文找，而是看模型有没有从调用方文件指向这个声明（文件与名字）的 `calls` 边。改动前唯一记录总是按原文同名找到的，两者相同；其它语言照旧按原文。审计 `calls-unresolved` 的原因文本同时写出 TS/JS 与其它语言的去向。（评审第 1 轮的两条意见。）其它语言照旧用 `callScopePaths`，按文件计数。

### D6 其它语言、`callScopePaths` 与 `reexportOnly`

其它非 Java 语言的调用照旧用 `callScopePaths`。`reexportOnly` 只有 TS/JS 的转发会产生；TS/JS 不再读它以后，`callScopePaths` 里减去它的那一步对现有语言是空操作。两者都保留：`reexportOnly` 是 import map 已经规定的输出，删掉要改已接受的规格，却不改变任何结果；减去它的那一步对任何语言都成立。

### D7 TS/JS 的缺口原因

`calls-unresolved` 与 `calls-ambiguous` 的原因文本按缺口的范围（语言）选择，Java 已经这样做。TS/JS 的原因列出 D1 与 D4 的各种去向，读者能从缺口看出哪些调用没有读。外层函数的作用域按整个函数收集名字，原因文本写明：在任一块里声明的名字对整个函数都算。

### D8 Pipeline 版本

TS/JS 的 `calls` 边与 `calls-*` 缺口会变，TS/JS 结构行的调用点会多出 `local`。`PIPELINE_VERSION` 从 `lazy-fact-graph/14` 升到 `/15`，已持久化的图在下次同步时重建。`annotate-graph` 的版本不动：它每次完整运行都重算，没有按版本跳过的缓存。

## 读调用作用域的地方（逐个核对）

| 位置 | 改动前 | 改动后 |
|---|---|---|
| `build-fact-graph.mjs` 非 Java 调用 | `callScopePaths` + `lookupCandidates` | TS/JS：`resolveBoundCallSite`；其它：不变 |
| `annotate-graph.mjs` `resolveUniqueCallSites` | `callScopePaths`，按文件计数 | TS/JS：`resolveBoundCallSite`；其它：不变 |
| `jsx-element-resolution.mjs` | 自带的绑定解析 | 共享模块，行为不变 |
| `build-fact-graph.mjs` `exports` 边、Java 调用、JSX | 不读调用作用域 | 不变 |

## 验收 oracle（动手前写死）

基线是 reexport-call-scope 合入后的 `origin/main`（`95986ed4`）。本分支从 reexport-call-scope 的分支头 `2b1b329c` 开出，它合入 `main` 后本分支与 `main` 同步过一次。

- **O1 复现（在基线上失败）**：新测试 `tests/lazy/import-binding-call-scope.test.mjs` 用真实 Lazy 驱动跑一个小夹具，再用同一份结构结果与 import map 调用审计的 `resolveUniqueCallSites`。夹具与断言：
  - a. `import { createLogger } from './logger'`，`run(log)` 调用 `log()` 与 `createLogger()`：`log()` 落进 `calls-unresolved`，`run` 只有指向 `createLogger` 的边；
  - b. `export * from './a'` 与 `import { helper } from './b'`，`a.ts`、`b.ts` 都声明 `log`：`log()` 落进 `calls-unresolved`，`helper()` 指向 `b.ts#helper`；
  - c. `import { format } from 'date-fns'` 与 `import { stamp } from './fmt'`，`fmt.ts` 也声明 `format`：`format()` 落进 `calls-unresolved`；
  - d. 导入 `log` 的文件里，`wrap(log)` 调用参数 `log()` 落进 `calls-unresolved`；同文件 `direct()` 调用 `log()` 指向 `logger.ts#log`；
  - e. `import { log as write }`：`write()` 指向 `logger.ts#log`；
  - f. `import make from './factory'`，`factory.ts` 写着 `export default function createThing`：`make()` 指向 `createThing`；
  - g. `import * as util from './b'`：`util.helper()` 指向 `b.ts#helper`；`util()` 与 `util.missing()` 落进 `calls-unresolved`；
  - h. 从只写着 `export { log } from './logger'` 的桶文件导入 `log`：`log()` 指向 `logger.ts#log`；
  - i. 从写着 `export * from './a'` 与 `export * from './b'` 的文件导入 `log`：`log()` 落进 `calls-ambiguous`；
  - j. `.js` 文件写着 `const { log } = require('./logger')`：`log()` 落进 `calls-unresolved`；
  - k. 调用本文件的顶层函数：成边（改前改后都成立）；
  - l. 审计：a–j 的每个调用点与事实图同组（唯一 / 歧义 / 无法解析），唯一记录的目标文件与边的目标一致；用 `annotate()` 审计夹具自己的事实图时没有 `calls` 的 `edge-missing`，去掉改名导入那条边后恰好报出它一条（评审第 1 轮后补）；
  - m. `shadow.ts` 的结构行里，`wrap` 的调用点带 `local: true`，`direct` 的没有；
  - n. `PIPELINE_VERSION` 与图头都是 `lazy-fact-graph/15`。

  在基线上跑一次，记录失败的断言。核心测试另加抽取器用例：参数、解构、局部 `const`、`catch` 参数、`for…of` 变量、局部函数，以及成员调用的根是参数时都标 `local`；模块级的 import 与顶层声明不标。
- **O2 不回归**：JSX 元素的全部测试照旧通过；`tests/lazy/reexport-call-scope.test.mjs` 只改 `require()` 用例的期望（`log()` 落进 `calls-unresolved`，`logger.ts` 仍不在 `reexportOnly` 里）与版本号。
- **O3 装置看得见**：逐个做变异，确认对应测试变红，然后还原。
  - i. 事实图的 TS/JS 行改回 `callScopePaths` → a–j 中改前失败的断言变红；
  - ii. 审计的 TS/JS 行改回 `callScopePaths` → l 变红；
  - iii. `resolveBoundCallSite` 不看 `local` → d、l 变红；
  - iv. 抽取器不写 `local` → 核心用例变红；重建 dist 后 d、m 变红；
  - v. `mapCallGraph` 丢掉 `local` → d、m 变红；
  - vi. 共享模块的成员段不在命名空间上继续 → g 与 JSX 的命名空间用例变红。
- **O4 门**：三件套、`pnpm --filter @excavator/core test`、`pnpm run typecheck`、`openspec validate --all --strict`。
- **O5 真实语料（确定性，零模型）**：在 go-multirepo 的前端成员、go-multirepo 的 Node 服务成员与 mixed-suite 的 kotlin-portal 成员上，各用基线与本分支在语料的临时副本里跑一次 Lazy 事实构建，比较两张图与中间结果。判据：
  - 节点、`calls` 以外的边、`calls-*` 以外的缺口（种类、计数、样本）、`importMap`、`resolvedSources`、`reexportOnly`、`coverage.jsxElements` 都不变；
  - TS/JS 以外的调用点去向不变；
  - TS/JS 每个去向变了的调用点，由比较脚本独立判定（不调用产品里的解析函数），恰好归入一类：
    - 失去的边：R1 根名字在本文件没有模块级绑定（其中被 `require()` 解构的另计）；R2 根名字绑定到外部或解析不到的说明符；R3 根名字绑定到别的模块或别的名字；R4 调用点带 `local`；
    - 新增的边：A1 改名导入；A2 默认导入；A3 命名空间成员；A4 经转发链；A5 原来歧义；脚本另外核对目标声明经绑定的模块按导出名可达；
    - 其它去向变化（边换目标、歧义与无法解析之间的移动）逐类计数并说明；
    - 「其它」类必须为零，否则逐条说明。

  比较脚本先在 O1 的夹具上验过：报出已知的失去与新增的边；输入对调时判据失败。记录只写计数与类别，不写路径。

## 验收记录

基线 `origin/main` `95986ed4`；本分支代码头 `e47f3a08`（其后只有文档提交）。

- **O1**：新 Lazy 测试 8 条在基线上全部失败，核心抽取器用例 2 条在基线上全部失败；本分支全部通过。
- **O2**：JSX 元素的全部测试（`jsx-element-resolution`、`jsx-elements-pipeline`、核心 `typescript-jsx`）照旧通过；`reexport-call-scope` 只改了 `require()` 用例的期望与版本号。全量门另外找出两个单元测试：它们的合成 TS 行调用导入的名字，却没有 import 的 `bindings` 与 import map 的 `resolvedSources`，而真实的抽取器与 `extract-import-map` 都会写这两项。`e47f3a08` 按真实形状补上。
- **O3**：六个变异各自让对应测试变红，还原后全绿：
  - i：O1 中 a–j 的断言所在的 5 条，以及 `reexport-call-scope` 的 `require()` 用例变红；
  - ii：O1 与 `reexport-call-scope` 的审计用例变红；
  - iii：O1 的遮蔽、缺口与审计 3 条变红；
  - iv：核心用例 2 条变红；重建 dist 后，O1 的遮蔽、缺口、结构行与审计 4 条，以及结构行测试的 `local` 用例变红；
  - v：同 iv 的 5 条变红；另外去掉 `isValidCallGraph` 对 `local` 的校验时，结构结果测试的 `local` 用例变红；
  - vi：O1 的 3 条、JSX 解析测试 3 条与 JSX Lazy 测试 4 条变红。
- **O4**：在只跑门的分离检出里（`e47f3a08`），三件套、`pnpm --filter @excavator/core test`、`pnpm run typecheck`、`openspec validate --all --strict` 全部通过。全量是 207 个测试文件，5082 条通过、4 条跳过；核心是 1452 条通过。
- **O5 比较脚本先验装置**：
  - 在 O1 夹具上报出 5 条失去与 4 条新增的边，分类与夹具一致；
  - 输入对调时，模型核对、分类与边的解释三类判据都失败；
  - 给本分支一侧多加一个文件时，节点、import map、结构行等判据失败；
  - 多加一个解析不到的 import 时，`calls-*` 以外的缺口判据失败。
- **O5 三个语料成员上不变的部分**：
  - 节点、`calls` 以外的边、TS/JS 以外语言的 `calls` 边、TS/JS `calls-*` 以外的缺口都不变；
  - import map（含 `resolvedSources` 与 `reexportOnly`）、coverage（含 `jsxElements`）、去掉 `local` 后的结构行都不变；
  - TS/JS 以外的调用点去向不变；
  - TS/JS 的 `calls-unresolved` 与 `calls-ambiguous` 计数与审计一致；
  - 基线与本分支各自的每个 TS/JS 调用点去向，都与脚本的独立模型一致。

  去向变了的调用点：

  | 成员 | TS/JS 调用点 | 带 `local` | 变化 | 失去 | 新增 | 边 −/+ |
  |---|---|---|---|---|---|---|
  | go-multirepo 前端 | 24275 | 9212 | 55 | R4 1 | A1 1、A3 44、A4 1、A5 8 | −1 / +44 |
  | go-multirepo Node 服务 | 2688 | 1000 | 47 | R1（`require()`）47 | — | −26 / +0 |
  | mixed-suite kotlin-portal | 3531 | 552 | 2 | — | A3 2 | 0 / +2 |

  R2、R3、其它去向变化与「其它」类都为零。边的增减少于调用点的增减，原因有二：同一调用方到同一目标只有一条边；新增的调用点里有 5 个调用方无法解析（`calls-caller-unresolved` 85 → 90）。

  抽查与说明：
  - 前端唯一失去的边是编造：组件里的局部函数被连到被导入的服务模块里的同名函数。
  - 新增的边按绑定可达，改名、转发与原歧义各抽一条，都正确。
  - Node 服务成员失去的 47 个调用点都在 CommonJS 文件里，被调者是用 `require()` 解构出的名字。其中 45 个能按相同的相对路径对上解构语句，另外 2 个的 `require()` 用了另一种路径写法，指向同一模块。这些原来的边是对的，是 D4 的代价；读 CommonJS 另立变更。
