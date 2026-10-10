## Why

Java 的调用图几乎是空的。在 Apache Fineract（固定提交 f9c2fcd，当前 main）上实测：

- 416,822 个 Java 调用点里只有 36,138 个（8.7%）解析成了 `calls` 边；贷款范围（606 个文件）只有 5.6%。
- 贷款范围的 157 个 API 入口方法一条出边都没有，顺着调用边只能到达 13 / 444 个文件。

原因有三个，都是确定性的：

1. 调用按调用文字原样匹配、不拆接收者（为了绝不猜边），所以 `var.m()`、`this.f.m()`、`Type.m()`、链式调用、`new X()` 一律成了缺口。这些形态占全部调用点的约八成，贷款范围超过九成。
2. 接口里没有方法体的方法和抽象方法不建节点，经接口的调用即使解析也无处可连。
3. 没有类型层次（extends / implements）事实，从接口方法走不到实现。

后果：PRD 生成与核对只能靠 grep 重新追调用链，核对的花费与生成相当。Java 在源码里写明了接收者的声明类型（字段、参数、局部变量），可以不靠猜测、确定性地解析。

## What Changes

- Java 抽取器补出类型事实：类型种类、全限定名、父类型、字段类型、类注解；接口方法与抽象方法作为函数条目输出（标明抽象）；每个调用点带上结构化的接收者、参数个数与所在类型。
- 结构抽取结果透传这些字段。
- 事实图对 Java 调用点按接收者的静态类型解析：局部变量、参数、字段、`this`/`super`、类名（静态调用）、`new` 表达式、强制转换、链式调用中前一调用的声明返回类型。在该类型及其仓库内父类型里按方法名和参数个数查找，恰好一个声明时生成 `calls` 边，目标是静态类型选中的声明，可以是接口或抽象方法。
- 不能成边的调用点恰好落入一个可见桶：
  - 新增 `calls-external`：目标在仓库外；
  - 新增 `calls-generated`：目标是源码里没有声明的生成方法；
  - 已有的 `calls-ambiguous`、`calls-unresolved`、`calls-caller-unresolved`。
- 新增类型层次边：类到类的 `inherits` / `implements`，以及具体方法到它所实现的抽象方法的 `implements`；遍历沿这两种边走，于是经接口的调用能走到实现。
- 非 Java 语言的事实投影逐字节不变。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fact-graph`：事实边加入类型层次边；新增「Java 成员调用按接收者的声明类型解析」与「Java 类型层次边」两项要求。

## Impact

- 代码：
  - `packages/core/src/plugins/extractors/java-extractor.ts`、`packages/core/src/types.ts`；
  - `skills/excavator/extract-structure-result.mjs`、`skills/excavator/build-fact-graph.mjs`；
  - 新增 `skills/excavator/java-call-resolution.mjs`；
  - `skills/excavator/retrieve.mjs`（可遍历的边类型）。
- 产物：Java 项目的事实图变大（接口方法节点、类型层次边、调用边），Java 夹具的固定摘要需要整块重冻；非 Java 项目不变。
- 不在范围内：
  - Full 流程 `annotate-graph` 的调用匹配；
  - 嵌套类型、匿名类、局部类仍不抽取，与它们相关的调用落入可见桶；
  - 不推断 lambda 参数类型，不实例化泛型；
  - 具体方法之间的覆写不连边。
