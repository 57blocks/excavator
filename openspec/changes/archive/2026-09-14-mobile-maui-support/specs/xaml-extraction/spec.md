## Purpose

让 `.xaml` 从 `no-extractor` 变成带锚点事实：产 View 记录、`x:Class` code-behind 关联、`x:DataType`、绑定 / 命令 / `x:Name`，作为移动端文档「Description of the UI / 导航」章节的证据源。

**诚实边界**：这是**单文件** parser，只抽取 XAML 里文本可见的事实（带行号）。`{Binding Path=Foo}` 到 ViewModel **成员**的连边需要另一份 `.cs` 里的符号，单文件 parser 无法确认，故**不在 parser 内做**；parser 只记录每条绑定的**文件级 DataType 上下文**（唯一的 `x:DataType`，或缺失/多义时记 `none`）。成员级解析与 `binding-unresolved` gap 由后续 resolver 阶段（另一切片，结合 C# 符号与 node-identity）产出。

产物一律落 `analyzeFile` 返回的 `StructuralAnalysis`（`sections` / `definitions`），因为流水线只消费该结构；`extractReferences` 当前不被消费，故不依赖它。

## ADDED Requirements

### Requirement: .xaml 被识别并分发到 XAML parser

系统 SHALL 为 `.xaml` 注册语言 id `xaml`，使其分发到专用 XAML parser 而非 `no-extractor`，且优先级高于通用 `xml`（`.xaml` MUST NOT 落成 `xml`）。

#### Scenario: .xaml 映射到 xaml 语言与 parser
- **WHEN** 对一个 `.xaml` 文件取语言与 plugin
- **THEN** 语言 id 为 `xaml`（非 `xml`）且存在处理它的 parser（非 null）

### Requirement: View 与 x:Class 带锚点

parser SHALL 把根元素 / 页面抽成一条 `sections`（`name` 取 `x:Class` 短名或根元素名，带 `lineRange`），把 `x:Class` 抽成一条 `definitions`（`kind:"code-behind"`，`name` 为类 FQN，带 `lineRange`）。

#### Scenario: x:Class 成为 code-behind 定义
- **WHEN** `.xaml` 根元素声明 `x:Class="App.Views.FooPage"`
- **THEN** 产一条 `sections`（name `FooPage`）与一条 `definitions{kind:"code-behind", name:"App.Views.FooPage"}`，行号命中

### Requirement: 绑定 / 命令 / x:Name 带锚点与 DataType 上下文（零编造）

parser SHALL 把 `x:Name`、`{Binding}`、`Command="{Binding …}"`、`x:DataType` 抽成带 `lineRange` 的 `definitions`（`kind` 分别为 `element` / `binding` / `command` / `datatype`）。每条绑定 / 命令 MUST 记录其**文件级 DataType 上下文**：当文件恰有一个 `x:DataType` 时记 `context=<type>`，否则记 `context=none`。parser MUST NOT 断言某 ViewModel 成员存在，也 MUST NOT 产任何猜测的成员连边。

#### Scenario: 有唯一 x:DataType 时绑定带该上下文
- **WHEN** 文件恰有一个 `x:DataType="vm:FooViewModel"` 且某处 `Text="{Binding Bar}"`
- **THEN** 产 `definitions{kind:"binding", name:"Bar", fields:["context=vm:FooViewModel"]}`，且不产任何成员连边

#### Scenario: 无 x:DataType 时绑定上下文为 none 而非臆造
- **WHEN** 绑定所在文件没有 `x:DataType`
- **THEN** 该绑定记 `context=none`（带 file:line），且不产任何猜测的成员连边

### Requirement: 确定性

对同一 `.xaml` 内容重复运行，`sections` 与 `definitions` SHALL 逐字节相同。

#### Scenario: 重复运行稳定
- **WHEN** 对同一内容运行两次
- **THEN** 两次输出逐字节相同
