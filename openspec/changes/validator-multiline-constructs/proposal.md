## Why

独立复核（`deploy/run-excavator.mjs` 的 fabrication 检查，阈值 `EXCAVATOR_MAX_CONTRADICTED` 默认 0）把 `validate-graph.mjs` 的发现数当作「编造」。在一次真实的 `full` 冒烟（一个 74 文件的 Java 子项目）里，验证器报了 919 条 contradicted（47 个锚点、872 条边），整次运行因此以 5（fabrication）收尾。逐条对照源码后，这 919 条全部是同一类误报，与模型写了什么无关：被检的图是确定性事实图，没有任何模型写的内容。

误报只有两种形态，都是「源码写成了多行」：

1. **声明前有注解 / 装饰器 / 属性。** tree-sitter 给声明的 `lineRange` 从注解开始（Java 的 `@Override`、`@InterfaceAudience.Private`，TS/Python 装饰器，C# 属性），名字在注解之后。验证器只在起点 ±1 行找名字，注解占两行以上（或带多行参数）就找不到。落在这一形态的有：47 个锚点，以及 `contains`、`exports`、`implements`、`overrides` 的 822 条边（它们的证据行都是成员范围的起点）。名字距证据行最远 22 行（一个多行注解块），所以不能靠放宽固定窗口。
2. **一个调用表达式写成多行。** `calls` 边的证据行是表达式的起点，被调用者的名字在后面几行（链式调用 `.foo()` 换行、长参数列表、builder 链）。50 条，距离 1 到 11 行。

只要目标仓库的 Java / TS / C# 代码用了多行注解或链式调用，验证器就会把大量真事实标成 contradicted，`full` 运行无法通过 fabrication 检查，而这个检查正是防编造的硬门。误报同时稀释了真正的编造信号。

## What Changes

- **锚点**：`function` / `class` 节点的名字，除了在 `lineRange[0]` ±1 行内，也可以在**跳过前导行之后的第一行**。前导行是空行、注释，以及注解 / 装饰器 / 属性（含参数跨多行的）；跳过只向前，只越过这些行。
- **证据（`calls` 以外的类型）**：抽取器写的证据行同样先试原行，再试跳过前导行之后的那一行。覆盖 `contains`、`exports`、`implements`、`overrides`，不按类型枚举。
- **证据（`calls`）**：抽取器写的证据行，被调用者的名字可以出现在**从该行起的整条表达式**里；表达式按括号配平与续行（行尾的 `.`、运算符，或下一行以 `.` 开头）界定，到顶层 `;` 结束。与 `imports` 现有的整条语句核对同一思路。
- **模型引用的证据不变**：`source: "model"` 的证据仍然只核对被引用的那一行。新宽容只给抽取器写的证据。
- **可见的第三种结果**：前导或语句超过扫描上限（常量，默认 400 行）时，该节点或边标 `unverified` 并计入新的缺口 `construct-too-long`，既不算确认也不算矛盾，与现有 `path-out-of-scope` 同类。
- 注入的假样本（锚点错位五行进入方法体、证据行指向无关语句）仍必须被报出，并新增越界与同名不同声明的反例。

**不做**：
- 不改抽取器（`lineRange` 与证据行不变，事实摘要、快照与所有消费者契约不动）。
- 不改 `EXCAVATOR_MAX_CONTRADICTED` 默认值与 `deploy/` 的任何逻辑。
- 不处理这次冒烟里暴露的另外两件事：预算不足导致语义阶段被跳过、`project.model` 因而为空。那是预算与流程问题，另议。
- 不引入语言解析器；前导行与语句边界用文本规则，规则覆盖的语法写进设计并配夹具。

## Capabilities

### Modified Capabilities

- `graph-validation`：「锚点与证据触源码核对」——声明锚点与抽取器证据行允许越过前导注解 / 注释，`calls` 证据按整条表达式核对，过长结构的可见结果。

## Impact

- `skills/excavator/validate-graph.mjs`；`skills/excavator/SKILL.md` 里 Phase 6b 的检查说明（一处散文）。
- 测试：`tests/skill/excavator/test_validate_graph.test.mjs`（新增夹具与已知假样本；原先「其余类型只看证据行」的一条用例按新规格改写）。
- 对 `deploy/` 与 `docs/deploy.md`：无改动，但独立复核对 Java / TS / C# 仓库不再被这两类误报拖到退出码 5。
