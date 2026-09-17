## ADDED Requirements

### Requirement: 仅活动 XAML 标记可成为事实

parser SHALL 从活动 XAML 标记抽取 View、`x:Class`、`x:DataType`、`x:Name`、绑定和命令；XML 注释中的同形文本 MUST NOT 产生任何 section 或 definition，也 MUST NOT 影响活动标记的上下文。所有产出的行号 SHALL 对应原始文件行号。

#### Scenario: 多行与行内注释不产事实
- **WHEN** 一个 XAML 文件的行内或多行 XML 注释包含页面标签、`x:Class`、`x:DataType`、`x:Name`、绑定和命令的文本
- **THEN** 注释内容不产 View section 或任何 definition，注释前后的活动事实仍保留原始 file:line 锚点

#### Scenario: 注释的类型声明不改变活动绑定
- **WHEN** 活动页面有 `x:DataType="vm:Page"`，注释中有 `x:DataType="vm:Ghost"`
- **THEN** 活动页面绑定的上下文仍为 `context=vm:Page`，且不产 `vm:Ghost` 的 datatype definition

## MODIFIED Requirements

### Requirement: 绑定 / 命令 / x:Name 带锚点与 DataType 上下文（零编造）

parser SHALL 把活动标记中的 `x:Name`、`{Binding}`、`Command="{Binding …}"`、`x:DataType` 抽成带 `lineRange` 的 `definitions`（`kind` 分别为 `element` / `binding` / `command` / `datatype`）。每条绑定 / 命令 MUST 记录其所在元素可见的最近词法作用域 `x:DataType`：本元素声明优先，否则继承最近祖先；没有可见类型或该类型显式置空时记 `context=none`。子元素类型 MUST NOT 回写到祖先或旁支。绑定显式使用 `Source` 或 `RelativeSource` 时 MUST 记 `context=none`，而非沿用元素的 DataType。parser MUST NOT 断言某 ViewModel 成员存在，也 MUST NOT 产任何猜测的成员连边。

#### Scenario: 页面与模板各有自己的类型
- **WHEN** 页面声明 `x:DataType="vm:Page"`，内层 DataTemplate 声明 `x:DataType="vm:Row"`，页面、模板和模板之后的页面区域各有一条绑定
- **THEN** 三条绑定的 `fields` 分别含 `context=vm:Page`、`context=vm:Row`、`context=vm:Page`，且不产任何成员连边

#### Scenario: 仅模板声明类型时外层仍未知
- **WHEN** 页面没有 `x:DataType`，只有内层 DataTemplate 声明 `x:DataType="vm:Row"`，页面与模板各有一条绑定
- **THEN** 页面绑定记 `context=none`，模板绑定记 `context=vm:Row`

#### Scenario: 有唯一 x:DataType 时绑定带该上下文
- **WHEN** 页面声明 `x:DataType="vm:FooViewModel"` 且子元素有 `Text="{Binding Bar}"`
- **THEN** 产 `definitions{kind:"binding", name:"Bar", fields:["context=vm:FooViewModel"]}`，且不产任何成员连边

#### Scenario: 无 x:DataType 时绑定上下文为 none 而非臆造
- **WHEN** 绑定所在元素及其祖先都没有活动的 `x:DataType`
- **THEN** 该绑定记 `context=none`（带 file:line），且不产任何猜测的成员连边

#### Scenario: 显式来源覆盖元素上下文
- **WHEN** 一个带 `x:DataType="vm:Row"` 的模板内绑定写有 `Source={x:Reference RootPage}` 或 `RelativeSource=...`
- **THEN** 该绑定记 `context=none`，仍保留绑定路径与 file:line，且不宣称路径属于 `vm:Row`
