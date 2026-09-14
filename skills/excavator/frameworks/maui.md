# .NET MAUI Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when .NET MAUI is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## .NET MAUI Project Structure

When analyzing a .NET MAUI project, apply these additional conventions on top of the base analysis rules. MAUI apps follow MVVM; navigation is either Prism (`Prism.Maui`) or the built-in Shell.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `MauiProgram.cs` | App bootstrap — `MauiApp.CreateBuilder()`, DI registration, fonts/handlers | `entry-point`, `config` |
| `App.xaml`, `App.xaml.cs` | Application root — global resources, startup page, Prism `RegisterTypes` | `entry-point`, `config` |
| `AppShell.xaml`, `AppShell.xaml.cs` | Shell navigation host — `ShellContent`/`FlyoutItem`/`TabBar`, route registration | `config`, `routing` |
| `Views/*.xaml`, `Pages/*.xaml` | Views — declarative UI; `x:Class` names the code-behind, `x:DataType` the ViewModel | `ui`, `routing` |
| `*.xaml.cs` | View code-behind — the class named by `x:Class` | `ui` |
| `ViewModels/*.cs`, `*ViewModel.cs` | ViewModels — bindable state and `ICommand`s the View binds to | `service`, `state` |
| `Services/*.cs` | Injectable services — HTTP, BLE, storage, domain operations | `service` |
| `Models/*.cs`, `Entities/*.cs`, `Dtos/*.cs` | Data models / DTOs / entities | `data-model` |
| `*Validator.cs` | Validation logic | `validation`, `service` |
| `Converters/*.cs`, `Behaviors/*.cs` | Value converters, XAML behaviors/triggers | `utility` |
| `Helpers/*.cs`, `Extensions/*.cs` | Shared utility / extension methods | `utility` |
| `Platforms/**` | Per-platform (Android/iOS/…) entry points and configuration | `config` |
| `*.csproj` | Project file — target frameworks, `UseMaui`, PackageReferences | `config` |
| `*.UnitTests/**`, `*.UITests/**`, `*.feature` | Unit / UI (SpecFlow) tests | `test` |

### Edge Patterns to Look For

**View ↔ code-behind** — A view's `x:Class="Ns.FooPage"` names its `.xaml.cs` code-behind class; create a `contains` edge between the `.xaml` view and that class.

**Binding → ViewModel member** — `{Binding Path=X}` / `Command="{Binding XCommand}"` binds to a member of the ViewModel named by the view's `x:DataType` (or set as `BindingContext`). Create a `depends_on` edge to that member **only when the member is confirmed in the ViewModel's C#**; otherwise leave it unresolved — never invent the member. A binding with no resolvable target type is a gap, not a guess.

**Prism navigation / routing** — `containerRegistry.RegisterForNavigation<TView>()` (also `<TView, TViewModel>()`, or with an explicit key `RegisterForNavigation<TView>("name")`) registers a route; the route key is the explicit name when given, otherwise the `TView` type name. Create an `inferred` route→view edge per registration. `INavigationService.NavigateAsync(...)` performs navigation.

**Shell navigation / routing** — `Routing.RegisterRoute("route", typeof(TPage))` and `ShellContent`/`FlyoutItem`/`TabBar` in `AppShell.xaml` declare routes; `Shell.Current.GoToAsync("route")` navigates. Create `inferred` route→view edges. When a `NavigateAsync`/`GoToAsync` target is a string/URI literal, add an `inferred` navigation edge; when it is a computed value, leave it unresolved.

**Dependency injection** — `builder.Services.AddSingleton<IX, X>()` (MAUI host) or `containerRegistry.Register<IX, X>()` (Prism) binds an interface to an implementation; create `configures` edges from the registration site to each registered type. This is how an injected `IX` resolves to `X` at runtime.

### Architectural Layers for .NET MAUI

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:ui` | UI Layer | `Views/`, `Pages/`, `.xaml` + code-behind, custom controls |
| `layer:service` | Service Layer | `ViewModels/`, `Services/`, domain/business logic, validators |
| `layer:data` | Data Layer | `Models/`, `Entities/`, `Dtos/` |
| `layer:config` | Config Layer | `MauiProgram.cs`, `App.xaml[.cs]`, `AppShell`, `Platforms/`, `*.csproj`, DI registration |
| `layer:utility` | Utility Layer | `Converters/`, `Behaviors/`, `Helpers/`, `Extensions/` |
| `layer:test` | Test Layer | `*.UnitTests/`, `*.UITests/`, `*.feature` |

### Notable Patterns to Capture in languageLesson

- **MVVM**: View (`.xaml`) ⇄ ViewModel (bindable properties + `ICommand`) ⇄ Model/Service; data binding is the wiring, not a direct call from the view to a service.
- **Compiled bindings via `x:DataType`**: a view that declares `x:DataType` states its ViewModel type — that is the reliable signal for resolving bindings to members; without it, bindings are dynamic and should stay unresolved.
- **Navigation is registration-driven**: routes are registered types (Prism `RegisterForNavigation` / Shell `RegisterRoute`) and navigation happens by route key — the View↔ViewModel pairing is established at registration, not at the call site.
- **Device-facing services via plugins**: platform capabilities (Bluetooth, local notifications, permissions, sensors, camera, etc.) are typically injected services that wrap platform APIs — treat such a service as the service layer's boundary to the device.
- **State machines**: when a fluent state-machine library is used, lifecycle transitions live in the configuration inside a method body — capture the owning type, but individual transitions are not line-anchored facts without a resolver.
- **Conventions are not evidence**: any relationship asserted only because MAUI/Prism usually wires it that way is `provenance:"inferred"` with no `evidence`; the deterministic phases never treat a convention as a fact.
