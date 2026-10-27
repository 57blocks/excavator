## Why

变更 `validator-leading-lines`（#89）让验证器在声明前有注解时读对了锚点与边，真实冒烟（一个 74 文件的 Java 子项目）上的矛盾从 919 降到 70。剩下的 70 条仍全部是误报，没有一条与模型写了什么有关，原因只有两种，都是「源码写成了多行」：

1. **调用表达式写成多行：50 条 `calls` 边。** 证据行是表达式的起点，被调用者的名字在后面几行：链式调用 `.foo()` 换行、builder 链、长参数列表。名字距证据行 1 到 11 行。验证器对 `calls` 只看被引用的那一行，找不到。
2. **声明头折行：6 个方法，4 个锚点与 16 条边。** `public void` 或 `private void` 单独一行，方法名在下一行。4 个带注解的方法，跳过注解之后落在 `public void` 这一行，名字在再下一行，锚点矛盾，连带它们的 12 条边；另外 2 个不带注解的方法，锚点靠起点 ±1 行通过、但不是精确的，所以不再替它们的 4 条边担保。

真实图验收里这 70 条已逐条分类（用与验证器规则无关的纯文本判断）：50 条 `calls`，20 条折行声明头，其他为 0。

这两件事此前曾和 #89 的内容合在一个变更里评审（#88，已关闭），三轮评审的重要问题前两轮都出在这两部分的文字启发式里：把一行语句当成折行声明头（`import os`、`return x`），把行尾的 `*`、`++`、`--`、可空类型的 `?` 当成续行。所以单独成变更，用评审中学到的东西设计：依赖语言的假设一开始就按文件扩展名限定，续行的判据偏向「少认」，每一类都先写成按语言的表再实现。

## What Changes

- **`calls` 的表达式核对**：抽取器写的、不带自己 `token` 的 `calls` 证据，被调用者的名字可以出现在**从被引用行起的整条表达式**里。表达式按括号配平与续行界定，到顶层 `;` 结束，顶层 `{`（函数体、分支）不并入表达式。只对有大括号加语句语法的语言生效（Java、Kotlin、Scala、Groovy、Swift、Dart、TypeScript、JavaScript、C#、Rust、PHP、Go、C、C++，按扩展名）；Python 与 Ruby 的 `calls` 仍只看被引用的那一行。
- **续行的判据**：行尾的 `.`、`\`、`=`、`&&`、`||`、`->`、`=>`、单个 `+`，或下一行以 `.`、`?.`、`&&`、`||`、`+`、`?`、`->`、`=>`、`|` 开头，才算续行。行尾的 `,`、`++`、`--`、`*`、可空类型的 `?`、块注释的结尾都不算。
- **折行的声明头**：跳过前导行之后的第一行若以声明修饰符开头（`public`、`private`、`protected`、`internal`、`final`、`abstract`、`sealed`、`open`、`override`、`virtual`、`synchronized`、`native`、`readonly`、`partial`）且只含单词与类型（没有括号、花括号、分号、`=`），名字可以在其后只含单词的行里，直到出现第一行带这些符号的行。`export`、`const`、`static`、`async` 也会开始语句，不收。只对有这些修饰符的语言生效（Java、C#、Kotlin、Scala、Groovy、Swift、Dart、TypeScript、PHP）。靠这条找到的名字是精确的，所以能替引用它范围起点的边担保。
- **模型引用的证据不变**，仍只核对被引用的那一行。
- **可见的第三种结果**：声明头或表达式超过扫描上限（`CONSTRUCT_SCAN_LINES`，已由 #89 引入）时，节点或边标 `unverified` 并计入缺口 `construct-too-long`，既不算确认也不算矛盾。

**不做**：
- 不改抽取器、`deploy/` 与 `EXCAVATOR_MAX_CONTRADICTED`。
- 不引入语言解析器；不处理 Python、Ruby 的 `calls` 表达式。
- 运行器按旧布局检查模型名与层、fabrication 门只数事实图的问题，另议。

## Capabilities

### Modified Capabilities

- `graph-validation`：「锚点与证据触源码核对」——折行声明头的锚点，`calls` 的整条表达式，过长表达式与声明头的可见结果。

## Impact

- `skills/excavator/validate-graph.mjs`；`skills/excavator/SKILL.md` 里 Phase 6b 的检查说明（一处散文）。
- 测试：新增 `tests/skill/excavator/test_validate_graph_multiline_calls.test.mjs`。
- 对 `deploy/` 与 `docs/deploy.md`：无改动。合并之后，真实图上的矛盾预计从 70 降到 0，数字以验收实测为准；这才是 `full` 运行不再被验证器的误报拖到退出码 5 的前提之一（另一个是运行器的检查对齐产物布局）。
