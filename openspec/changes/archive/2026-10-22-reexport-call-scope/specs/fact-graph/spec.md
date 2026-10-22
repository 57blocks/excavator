## ADDED Requirements

### Requirement: 非 Java 调用的作用域不含只经转发到达的文件

TS/JS 抽取器 SHALL 让每个 `export … from 'S'` 条目都带 `reexports`；转发名单为空时（`export {} from 'S'`）为空数组。这样转发条目与副作用导入 `import 'S'` 可以区分。

import map SHALL 为每个文件输出 `reexportOnly`：只经转发条目到达、没有经 import 语句、`require()` 或其它抽取路径到达的已解析目标，按路径排序；没有这种目标的文件不写这个键。`importMap` SHALL 照旧列出这些目标，`imports` 边照旧生成。

Fact Builder 为非 Java 文件解析调用时，被调者的作用域 SHALL 是本文件，加 `importMap` 中不在该文件 `reexportOnly` 里的目标。转发不在本文件引入名字，只经转发到达的文件里的声明 MUST NOT 成为本文件调用的候选。import map 没有 `reexportOnly` 时，作用域为本文件加全部 `importMap` 目标。

#### Scenario: 对参数的调用不连到被转发的模块
- **WHEN** 文件写着 `export { createLogger } from './logger'` 与 `function run(log) { log() }`，`logger.ts` 声明了 `log`，文件没有别的路径到达 `logger.ts`
- **THEN** `log()` 不生成 `calls` 边，记入 `calls-unresolved`；文件到 `logger.ts` 的 `imports` 边照旧生成

#### Scenario: 转发不制造歧义
- **WHEN** 文件从 `./util` 导入 `log` 并调用它，同时转发 `./logger`，`util.ts` 与 `logger.ts` 都声明了 `log`
- **THEN** 调用生成指向 `util.ts` 的 `log` 的 `calls` 边，不记入 `calls-ambiguous`

#### Scenario: 同一模块还经 require 到达
- **WHEN** 文件既转发 `./logger`，又写着 `const { log } = require('./logger')` 并调用 `log()`
- **THEN** `logger.ts` 不在 `reexportOnly` 里，调用生成指向 `logger.ts` 的 `log` 的 `calls` 边

#### Scenario: 空转发
- **WHEN** 文件写着 `export {} from './logger'`
- **THEN** 该条目带 `reexports: []`，`logger.ts` 列在该文件的 `reexportOnly` 里，不进调用作用域
