## Purpose

让 `.xaml` 从 `no-extractor` 变成带锚点事实：产 View 记录、`x:Class` → code-behind 引用、绑定 / 命令记录，作为移动端文档「Description of the UI / 导航」章节的证据源；不可唯一解析的绑定入 gap，绝不猜。

## ADDED Requirements

### Requirement: .xaml 被识别并分发到 XAML parser

系统 SHALL 为 `.xaml` 注册语言 id `xaml`，使其分发到专用 XAML parser 而非 `no-extractor`，且优先级高于通用 `xml`（`.xaml` MUST NOT 落成 `xml`）。

#### Scenario: .xaml 映射到 xaml 语言与 parser
- **WHEN** 对一个 `.xaml` 文件取语言与 plugin
- **THEN** 语言 id 为 `xaml`（非 `xml`）且存在处理它的 parser（非 null）

### Requirement: View 与 x:Class 引用带锚点

parser SHALL 把根元素 / 页面抽成 `sections`（带 `lineRange`），把 `x:Class` 抽成一条 `references`（`referenceType:"code-behind"`，`target` 为类 FQN，带 `line`）。

#### Scenario: x:Class 成为到 code-behind 的引用
- **WHEN** `.xaml` 根元素声明 `x:Class="App.Views.FooPage"`
- **THEN** 产一条 reference，target 为 `App.Views.FooPage`，line 命中

### Requirement: 绑定解析的诚实边界（零编造）

parser SHALL 把 `{Binding}`、`Command`、`x:Name` 抽成带 `lineRange` 的 `definitions`。绑定到 ViewModel 成员的连边**仅在** `x:DataType` 或显式类型能唯一定位目标类型时才建立；否则 MUST 记 `gap`（`binding-unresolved`，带 file:line 与原文样本），MUST NOT 猜测成员。每条绑定要么 `resolved` 要么 `binding-unresolved`，无第三种静默态。

#### Scenario: 有 x:DataType 时绑定可解析
- **WHEN** 页面声明 `x:DataType` 且绑定 `Path` 命中该类型成员
- **THEN** 绑定连到该成员，不入 gap

#### Scenario: 无 x:DataType 时绑定入 gap 而非臆造
- **WHEN** 绑定所在页面没有可唯一定位的目标类型
- **THEN** 该绑定记 `binding-unresolved` gap（带 file:line），且不产任何猜测的成员连边

### Requirement: 确定性

对同一 `.xaml` 内容重复运行，`sections`/`definitions`/`references` 与 gap SHALL 逐字节相同。

#### Scenario: 重复运行稳定
- **WHEN** 对同一内容运行两次
- **THEN** 两次输出逐字节相同
