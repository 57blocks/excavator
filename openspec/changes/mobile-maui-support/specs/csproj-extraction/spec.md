## Purpose

让 `.csproj` 从 `no-extractor` 变成带锚点的确定性事实：把 `<PackageReference>` 依赖与目标框架抽成 `definitions`，作为移动端文档 SOUP / References 章节的证据源。

## ADDED Requirements

### Requirement: .csproj 被识别并分发到 csproj parser

系统 SHALL 为 `.csproj` 注册语言 id `csproj`，使 `PluginRegistry.getPluginForFile` 对 `.csproj` 文件返回专用的 csproj parser，而非落入 `no-extractor`。

#### Scenario: .csproj 映射到 csproj 语言与 parser
- **WHEN** 对一个 `.csproj` 文件取语言与 plugin
- **THEN** 语言 id 为 `csproj` 且存在处理它的 parser（非 null）

### Requirement: PackageReference 抽成带锚点依赖

parser SHALL 把每条 `<PackageReference Include="X" Version="Y">` 抽成一个 `definitions` 项（`kind:"dependency"`，`name:"X"`，`fields` 含版本，`lineRange` 落在该引用行）。版本以属性或子元素形式给出时 MUST 都能取到；取不到版本时 name 仍产出、version 缺失记为空而非猜测。

#### Scenario: 依赖逐条成带行号的 definition
- **WHEN** `.csproj` 含多条 PackageReference
- **THEN** 每条得到一个 `kind:"dependency"` 的 definition，name 正确、版本进 fields、lineRange 命中该行

#### Scenario: 无依赖文件不误报
- **WHEN** `.csproj` 不含任何 PackageReference
- **THEN** 产零条 dependency definition 且不报错

### Requirement: 确定性

对同一 `.csproj` 内容重复运行，parser 输出 SHALL 逐字节相同。

#### Scenario: 重复运行稳定
- **WHEN** 对同一内容运行两次
- **THEN** 两次 `definitions` 逐字节相同
