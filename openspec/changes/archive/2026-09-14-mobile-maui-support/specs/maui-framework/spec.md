## Purpose

从 `.csproj` 确定性检测出 MAUI 框架并提供目录分层提示，同时把构建 / 覆盖 / 二进制产物移出扫描分母，使移动端 coverage 诚实。

## ADDED Requirements

### Requirement: 从 .csproj 检测 maui 框架

系统 SHALL 提供 `maui` 的 `FrameworkConfig`，当 `.csproj` 含 `UseMaui`、`Microsoft.Maui.Controls` 或 `Prism.Maui` 等标记时检测为 `maui`，并提供 `layerHints`（至少覆盖 `Views→ui`、`ViewModels→service`、`Services→service`、`Models→data`）与 `entryPoints`（含 `MauiProgram.cs`、`App.xaml.cs`）。

#### Scenario: MAUI 项目被检测
- **WHEN** 项目 `.csproj` 含 `UseMaui` 或 `Microsoft.Maui.Controls`
- **THEN** 框架检测报告 `maui`，并给出上述 layerHints 与 entryPoints

#### Scenario: 非 MAUI 项目不误报
- **WHEN** 项目不含任何 MAUI 标记
- **THEN** 不报告 `maui`

### Requirement: 框架约定附录只作 guidance

若提供 `skills/excavator/frameworks/maui.md`，它 SHALL 只作 prompt 附录：不产行号，据其推出的关系一律 `provenance:"inferred"` 无 evidence，annotate / validate MUST NOT 把约定当事实。

#### Scenario: 约定不产可引用锚点
- **WHEN** 某关系仅由 maui.md 约定推出
- **THEN** 该关系 `inferred` 且无 evidence，不进入确定性事实

### Requirement: 构建与覆盖产物移出扫描分母

扫描默认忽略 SHALL 排除 `**/bin/`、`**/obj/`、`**/.unit-test/`、`*.dll`、`*.pdb`、`*.nupkg`；该排除 MUST 只移除构建 / 覆盖 / 二进制产物，MUST NOT 移除任何源码（`.cs`/`.xaml`/`.csproj`/`.feature`）。

#### Scenario: 去污只降噪不误伤
- **WHEN** 对同一 MAUI 项目分别以「含 / 不含」新忽略规则扫描
- **THEN** 被移出的文件全部属于构建 / 覆盖 / 二进制产物，无一条源码
