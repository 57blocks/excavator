# .NET MAUI

Applies when a `.csproj` sets `<UseMaui>` or references `Microsoft.Maui.Controls`
(often with Prism via `Prism.Maui`). MAUI apps follow MVVM.

## Where to look

- **Views**: `.xaml` pages/controls with `.xaml.cs` code-behind. `x:Class` names
  the code-behind class; the xaml reader already emits the view, `x:Class`,
  `x:DataType`, and binding/command facts with line anchors.
- **ViewModels**: C# classes (usually under `ViewModels/`) exposing bindable
  properties and `ICommand`s. A view's `x:DataType` names its ViewModel type.
- **Services / Models**: injectable C# services (HTTP, BLE, storage) under
  `Services/`; DTOs/entities under `Models/`.
- **Entry points**: `MauiProgram.cs` (DI + app config), `App.xaml`/`App.xaml.cs`,
  and Prism `RegisterTypes` for navigation routes.

## Discipline

These are conventions, not evidence. Any relationship asserted only because
MAUI/Prism usually wires it that way is `provenance:"inferred"` with no
`evidence`. A `{Binding Path=X}` links to a ViewModel member only when that
member is confirmed in the ViewModel's C#; otherwise leave it unresolved — never
invent the member.
