## Why

独立复核（`deploy/run-excavator.mjs` 的 fabrication 检查，阈值 `EXCAVATOR_MAX_CONTRADICTED` 默认 0）把 `validate-graph.mjs` 的发现数当作「编造」。在一次真实的 `full` 冒烟（一个 74 文件的 Java 子项目）里，验证器对一张确定性事实图报了 919 条 contradicted，整次运行因此以 5（fabrication）收尾。逐条对照源码后，这 919 条全部是误报，没有一条与模型写了什么有关。

其中 869 条来自同一个原因：**声明的范围从它的第一个注解开始**，名字在注解之后。tree-sitter 给被注解的类、方法的 `lineRange` 从 `@Override`、`@InterfaceAudience.Private` 之类开始（TS / Python 装饰器、C# 属性、Rust 属性同理），验证器只在起点 ±1 行里找名字，注解占两行以上或带多行参数就找不到：

| 类 | 条数 |
|---|---:|
| 锚点 | 47 |
| `contains` 边 | 530 |
| `exports` 边 | 242 |
| `implements` 边 | 40 |
| `overrides` 边 | 10 |

后四类边的证据行都是成员范围的第一行，也就是那个注解。名字距离证据行最远 22 行（一个含嵌套注解的注解块），所以不能靠放宽固定窗口。

另外 50 条 `calls`（表达式写成多行）与 4 个折行声明头（`public void` 与方法名分在两行）及其 16 条边，原因不同、规则不同，由变更 `validator-multiline-calls` 处理。

## What Changes

- **锚点**：`function` / `class` 节点的名字，除了在 `lineRange[0]` ±1 行内，也可以在**跳过前导行之后的第一行**。前导行是空行、注释，以及注解 / 装饰器 / 属性（含参数跨多行的）。跳过只向前，只越过这些行；一行语句、一行别的声明都不越过。
- **边**：`contains`、`exports`、`implements`、`overrides` 这类引用声明起点的边，不再靠「这一行读起来像什么」，改读图：抽取器写的、不带自己 `token` 的证据，当被引用的行恰是某个端点节点自己 `lineRange[0]`、该节点的名字是期望的记号、并且它自己的锚点已被**精确**确认时，边被确认。
- **「精确」的含义**：锚点靠 ±1 容差才通过的，不替边担保。节点自己的锚点检查保持原样（仍允许 ±1）。
- **模型引用的证据不变**，仍只核对被引用的那一行。
- **可见的第三种结果**：前导行超过扫描上限（常量，默认 400 行）时，该节点标 `unverified` 并计入新的缺口 `construct-too-long`，既不算确认也不算矛盾；CLI 汇总行与 `validation.json` 同样带这个计数。

**不做**：
- 不改抽取器（`lineRange` 与证据行不变，事实摘要、快照与所有消费者契约不动）。
- 不改 `calls` 的核对（仍只看被引用的那一行）、不处理折行声明头：两者归 `validator-multiline-calls`。
- 不改 `EXCAVATOR_MAX_CONTRADICTED` 默认值与 `deploy/` 的任何逻辑；运行器检查模型名与层的位置与产物布局不一致的问题另议。

## Capabilities

### Modified Capabilities

- `graph-validation`：「锚点与证据触源码核对」——声明锚点允许越过前导注解与注释，引用声明起点的边按图确认，前导行过长的可见结果。

## Impact

- `skills/excavator/validate-graph.mjs`；`skills/excavator/SKILL.md` 里 Phase 6b 的检查说明（一处散文）。
- 测试：新增 `tests/skill/excavator/test_validate_graph_leading_lines.test.mjs`；`tests/lazy/name-references-pipeline.test.mjs` 里一条用例原先把「带注解的类的 `contains` 与 `exports` 被判矛盾」当成期望，按新规格改写。
- 对 `deploy/` 与 `docs/deploy.md`：无改动。合并后，真实图上的矛盾预计从 919 降到约 70（`calls` 与折行声明头那一部分），要等 `validator-multiline-calls` 才归零，数字以验收实测为准。
