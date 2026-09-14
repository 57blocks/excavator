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

## Navigation / routing (edge patterns)

MAUI apps navigate one of two ways. Capture routes and navigation as `inferred`
edges (never a line-anchored fact — resolving a route to its view soundly needs
a resolver over the C# symbols):

- **Prism navigation** — `containerRegistry.RegisterForNavigation<TView>()` (also
  `RegisterForNavigation<TView, TViewModel>()`, or with an explicit key
  `RegisterForNavigation<TView>("name")`) registers a navigation route. The route
  key is the explicit name when given, otherwise the `TView` type name. For each
  registration create an `inferred` route→view edge (view = `TView`). Navigation
  happens via `INavigationService.NavigateAsync(target, ...)`.
- **Shell navigation** — `Routing.RegisterRoute("route", typeof(TPage))` registers
  a route; `ShellContent` / `FlyoutItem` / `TabBar` in `AppShell.xaml` declare
  shell routes. Navigation happens via `Shell.Current.GoToAsync("route")`.
- **Navigation edges** — when a `NavigateAsync(...)` / `GoToAsync(...)` call passes
  a string/URI **literal**, create an `inferred` navigation edge to that route's
  view. When the target is a **computed value** (a variable, or a URI built at
  runtime), do **not** guess the destination — leave it unresolved. Registrations
  and literal navigations are the reliable signal; runtime-built targets are a
  gap, not a guess.

## Discipline

These are conventions, not evidence. Any relationship asserted only because
MAUI/Prism usually wires it that way is `provenance:"inferred"` with no
`evidence`. A `{Binding Path=X}` links to a ViewModel member only when that
member is confirmed in the ViewModel's C#; otherwise leave it unresolved — never
invent the member.
