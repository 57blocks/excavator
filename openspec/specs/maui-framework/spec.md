# maui-framework Specification

## Purpose
从 `.csproj` 确定性检测出 MAUI 框架并提供目录分层提示，同时把构建 / 覆盖 / 二进制产物移出扫描分母，使移动端 coverage 诚实。

## Requirements

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

For a MAUI repository, the host skill SHALL inspect scan evidence and express project-specific generated trees such as `bin/`, `.unit-test/`, `TestResults/`, `.scratch/`, and local package caches in the authoritative root `.excavatorignore`. The global defaults SHALL continue to exclude universally generated outputs such as `obj/`, `coverage/`, `.vs/`, `.gradle/`, binary extensions, archives, and operating-system metadata, but MUST NOT globally exclude `bin/` or `.unit-test/`. Before writing the project recipe, the skill SHALL compare two existing scanner outputs and prove from their dropped-file manifests that the additional rules remove no `.cs`, `.xaml`, `.csproj`, or `.feature` source. The product SHALL NOT add a MAUI- or cebreo-specific ignore registry, generator, or validator for this judgment.

#### Scenario: 去污只降噪不误伤
- **WHEN** the host skill runs the existing scanner with and without a proposed MAUI project recipe
- **THEN** it writes the recipe only after every removed file is evidenced as generated output and zero `.cs`, `.xaml`, `.csproj`, or `.feature` files are removed

#### Scenario: 其他生态的 bin 源码仍被保留
- **WHEN** a non-MAUI fixture contains a selectable source file such as `bin/rails` and has no project rule excluding `bin/`
- **THEN** the source file remains selected

#### Scenario: 项目规则变化可审计
- **WHEN** the root `.excavatorignore` recipe changes
- **THEN** `selectionDigest` changes and the ledger reports the new project-ignore count separately from global defaults
