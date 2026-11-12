## ADDED Requirements

### Requirement: TS/JS 调用按本文件的绑定解析被调者

TS/JS 抽取器 SHALL 为根名字被外层函数绑定的调用点标 `local: true`。根名字是被调表达式本身的标识符，或成员表达式最左端的标识符；绑定包括参数、解构出的名字、局部变量、局部函数或类、`catch` 参数与 `for…in/of` 变量，按函数作用域收集，块级名字算整个函数（偏向多标）。结构结果 SHALL 保留这个标记。

Fact Builder 为语言是 `typescript` 或 `javascript` 的文件解析调用时，SHALL 只把被调者解析到本文件绑定的东西，按以下顺序：
1. 标了 `local` 的调用点，以及被调者不是用 `.` 连接的标识符的调用点，落进 `calls-unresolved`；
2. 根名字是本文件 import 的绑定（具名、默认、命名空间）时：说明符没有解析到仓库文件，落进 `calls-unresolved`；解析到文件时，按 JSX 元素引用的规则在该文件的导出里找导入名（显式转发、本地导出、`export *`）；
3. 否则找本文件的顶层函数或类；
4. 都没有，落进 `calls-unresolved`。

成员段 SHALL 只在命名空间上继续解析；落在函数、类或值之后还有段，或被调者只是命名空间时，落进 `calls-unresolved`。解析出恰好一个声明时，调用方按原规则确定后生成 `calls` 边；解析出多个声明、或多个 `export *` 给出不同目标时，落进 `calls-ambiguous`。被导入模块里与被调者同名、但没有经绑定指向的声明 MUST NOT 成为候选。`require()` 绑定的名字不在 `bindings` 里，对它们的调用落进 `calls-unresolved`。

TS/JS 的 `calls-unresolved` 与 `calls-ambiguous` 缺口 SHALL 用写明上述去向的原因文本。Java 与其它语言的调用解析不受本要求影响。

#### Scenario: 对参数的调用不连到被导入模块的同名声明
- **WHEN** 文件写着 `import { createLogger } from './logger'` 与 `function run(log) { log(); createLogger() }`，`logger.ts` 声明并导出了 `log` 与 `createLogger`
- **THEN** `log()` 不生成 `calls` 边，记入 `calls-unresolved`；`createLogger()` 生成指向 `logger.ts` 的 `createLogger` 的边

#### Scenario: 没有导入的名字不经别的导入解析
- **WHEN** 文件写着 `export * from './a'` 与 `import { helper } from './b'`，`a.ts` 与 `b.ts` 都声明了 `log`，文件调用 `log()`
- **THEN** `log()` 记入 `calls-unresolved`，不生成指向 `b.ts` 的 `log` 的边

#### Scenario: 从包导入的名字
- **WHEN** 文件从 `date-fns` 导入 `format`，又从 `./fmt` 导入别的名字，`fmt.ts` 也声明了 `format`
- **THEN** `format()` 记入 `calls-unresolved`

#### Scenario: 被参数遮蔽的导入名
- **WHEN** 文件导入了 `log`，函数 `wrap(log)` 调用 `log()`，函数 `direct()` 也调用 `log()`
- **THEN** `wrap` 里的调用点带 `local: true`，记入 `calls-unresolved`；`direct` 里的调用生成指向被导入的 `log` 的边

#### Scenario: 改名导入、默认导入与命名空间
- **WHEN** 文件写着 `import { log as write } from './logger'`、`import make from './factory'`（`factory.ts` 写着 `export default function createThing`）与 `import * as util from './b'`，并调用 `write()`、`make()`、`util.helper()`、`util()`、`util.missing()`
- **THEN** 前三个分别生成指向 `logger.ts` 的 `log`、`createThing`、`b.ts` 的 `helper` 的边；`util()` 与 `util.missing()` 记入 `calls-unresolved`

#### Scenario: 经转发与歧义
- **WHEN** 文件从只写着 `export { log } from './logger'` 的桶文件导入 `log` 并调用它，另一个文件从写着 `export * from './a'` 与 `export * from './b'` 的文件导入 `log` 并调用它
- **THEN** 前者生成指向 `logger.ts` 的 `log` 的边；后者记入 `calls-ambiguous`

#### Scenario: CommonJS
- **WHEN** `.js` 文件写着 `const { log } = require('./logger')` 并调用 `log()`
- **THEN** 该调用记入 `calls-unresolved`，不生成边

## MODIFIED Requirements

### Requirement: 非 Java 调用的作用域不含只经转发到达的文件

TS/JS 抽取器 SHALL 让每个 `export … from 'S'` 条目都带 `reexports`；转发名单为空时（`export {} from 'S'`）为空数组。这样转发条目与副作用导入 `import 'S'` 可以区分。

import map SHALL 为每个文件输出 `reexportOnly`：只经转发条目到达、没有经 import 语句、`require()` 或其它抽取路径到达的已解析目标，按路径排序；没有这种目标的文件不写这个键。`importMap` SHALL 照旧列出这些目标，`imports` 边照旧生成。

Fact Builder 为 Java 与 TS/JS 以外的文件解析调用时，被调者的作用域 SHALL 是本文件，加 `importMap` 中不在该文件 `reexportOnly` 里的目标。转发不在本文件引入名字，只经转发到达的文件里的声明 MUST NOT 成为本文件调用的候选。import map 没有 `reexportOnly` 时，作用域为本文件加全部 `importMap` 目标。TS/JS 文件的调用按「TS/JS 调用按本文件的绑定解析被调者」解析，转发同样不引入候选。

#### Scenario: 对参数的调用不连到被转发的模块
- **WHEN** 文件写着 `export { createLogger } from './logger'` 与 `function run(log) { log() }`，`logger.ts` 声明了 `log`，文件没有别的路径到达 `logger.ts`
- **THEN** `log()` 不生成 `calls` 边，记入 `calls-unresolved`；文件到 `logger.ts` 的 `imports` 边照旧生成

#### Scenario: 转发不制造歧义
- **WHEN** 文件从 `./util` 导入 `log` 并调用它，同时转发 `./logger`，`util.ts` 与 `logger.ts` 都声明了 `log`
- **THEN** 调用生成指向 `util.ts` 的 `log` 的 `calls` 边，不记入 `calls-ambiguous`

#### Scenario: 同一模块还经 require 到达
- **WHEN** 文件既转发 `./logger`，又写着 `const { log } = require('./logger')`
- **THEN** `logger.ts` 不在 `reexportOnly` 里

#### Scenario: 空转发
- **WHEN** 文件写着 `export {} from './logger'`
- **THEN** 该条目带 `reexports: []`，`logger.ts` 列在该文件的 `reexportOnly` 里，不进调用作用域
