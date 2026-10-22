## MODIFIED Requirements

### Requirement: 审计的期望调用记录用事实图的调用作用域

审计 SHALL 用与 Fact Builder 相同的规则判定调用点能否唯一解析。TS/JS 文件的调用点按「TS/JS 调用按本文件的绑定解析被调者」解析，顶层声明取自审计读到的声明：解析出恰好一个声明时是唯一解析的期望记录，目标是该声明所在的文件；歧义时归入歧义的一组；其余归入无法解析的一组。其它非 Java 语言用本文件，加 `importMap` 中不在该文件 `reexportOnly` 里的目标。被导入模块里没有经绑定指向的同名声明、以及只经 `export … from` 到达的文件里的声明，MUST NOT 让一个调用点成为唯一或有歧义的期望记录。

#### Scenario: 转发目标里的同名声明不算期望记录
- **WHEN** 文件只经 `export { createLogger } from './logger'` 到达 `logger.ts`，并在 `run(log)` 里调用参数 `log()`，`logger.ts` 声明了 `log`
- **THEN** 该调用点归入无法解析的一组，不是唯一解析的期望记录；模型图里没有这条调用边时，不计入 `edge-missing`

#### Scenario: 转发不让唯一的记录变成歧义
- **WHEN** 文件从 `./util` 导入 `log` 并调用它，同时转发 `./logger`，两个文件都声明了 `log`
- **THEN** 该调用点是唯一解析的期望记录，目标是 `util.ts`

#### Scenario: 被导入模块里没有导入的同名声明
- **WHEN** 文件写着 `import { createLogger } from './logger'`，在 `run(log)` 里调用参数 `log()`，`logger.ts` 声明了 `log`
- **THEN** 该调用点归入无法解析的一组；同一函数里对 `createLogger()` 的调用是唯一解析的期望记录，目标是 `logger.ts`

#### Scenario: 经绑定的唯一记录
- **WHEN** 文件经改名导入、默认导入、命名空间成员或桶文件转发调用另一个文件的函数
- **THEN** 每个调用点都是唯一解析的期望记录，目标是声明该函数的文件
