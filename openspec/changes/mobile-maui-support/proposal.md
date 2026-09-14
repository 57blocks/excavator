## Why

移动端（`unmc`，.NET MAUI，`net8.0-android;net8.0-ios`）需要出一份与前端同规格的 SW Architecture 文档，但当前确定性抽取对 MAUI 的承重层是盲的。对 `unmc` 实跑 structure-all 的实测：C# 962 文件被完整抽取（类/方法/属性/行号 + 调用图），但

- `.xaml`（128）—— MAUI 的 View / 导航 / `{Binding}` / `Command` 全在这里 —— 状态 `no-extractor`；
- `.csproj`（5，含 48 个 `PackageReference`）—— SOUP / 依赖 —— 状态 `no-extractor`；
- `.feature`（24，SpecFlow 行为规格）—— 状态 `no-extractor`。

这三类文件正好是文档「Description of the UI / 导航」「SOUP」「行为流程」三章的证据来源。它们是 `no-extractor` 不是能力上限，而是**没有为这三个 language id 注册 plugin**：`PluginRegistry` 已有 12 个手写 parser（dockerfile / graphql / terraform / sql / yaml …），Dockerfile 就是端到端跑通的活样板。本变更只在这条已验证的缝里补三个手写 parser + 一个 `FrameworkConfig`，把三类文件从 `no-extractor` 翻成带锚点的事实，全部落进既有 `StructuralAnalysis` 字段，下游 annotate / validate / 图谱零改动。**不改 core、不改 schema。**

同时删除已被 lazy 计划取代的 `docs/v2-plan.md`，并清理 AGENTS.md / CLAUDE.md / frameworks README 对它的悬挂引用（本变更不再依赖它的「step ③」排序）。

## What Changes

- 新增 `.xaml` 语言配置 + **XAML parser**（手写、非 tree-sitter，参考旧 excavator ~300 行 reader）：产 View / 页面记录、`x:Class` → code-behind 的 `reference`、`x:Name` / `{Binding}` / `Command` 记录，全部带行号。绑定 → ViewModel 成员**只在 `x:DataType` 或显式类型可唯一解析时**连边，否则写入 gap（`binding-unresolved`），绝不猜。
- 新增 `.csproj` 语言配置 + **csproj parser**：`<PackageReference Include Version>` → 依赖 `definitions`（`kind:"dependency"`，name/version 入 `fields`，带行号）；`<TargetFramework(s)>` / `UseMaui` 等作 `definitions`。SOUP 表由此确定性生成。
- 新增 `.feature` 语言配置 + **Gherkin parser**：`Feature` → `sections`，`Scenario`/`Scenario Outline` → `sections`，`Given/When/Then/And/But` → `steps`，带行号。24 个行为规格成为「UI 描述 / 流程」章节的可引用事实。
- 新增 `packages/core/src/languages/frameworks/maui.ts`（`FrameworkConfig`：从 `.csproj` 的 `UseMaui` / `Microsoft.Maui.Controls` / `Prism.Maui` 检测；`layerHints` `Views→ui` / `ViewModels→service` / `Services→service` / `Models→data`；`entryPoints` `MauiProgram.cs` / `App.xaml.cs`）。可选 `skills/excavator/frameworks/maui.md` 约定附录（仅 guidance，产 `inferred`、不产行号）。
- 扫描去污（**项目级 ignore，不动全局默认**）：`obj/`/`coverage/` 已在全局默认、二进制扩展已落可见 skip 桶；`bin/` 不进全局（别的语料里是真源码）。真实噪声 `.unit-test/` 覆盖报告（`unmc` 实测 502 个 html）属项目 `.excavatorignore`（layer 2）。为 MAUI 项目给出 `.excavatorignore` 配方并以「含/不含」对照证伪（只删噪声不删源码）。

**非目标（本切片不做）**：ast-grep 规则包（本变更用手写 parser，不引入 `@ast-grep/napi`）；绑定 → 成员的完整跨文件解析（只做 `x:DataType` 可唯一解析一档，其余入 gap）；Angular / aspnet 规则；C# 抽取器 `owner`/`using` 归属打磨（单列 follow-up，不阻塞）；模型语义叙述质量（属 full 模式模型半场）。

## Capabilities

### New Capabilities

- `csproj-extraction`：`.csproj` → 依赖 / 目标框架 `definitions`（带锚点），SOUP 事实源。
- `gherkin-extraction`：`.feature` → `sections` + `steps`（带锚点），行为规格事实源。
- `xaml-extraction`：`.xaml` → View / `x:Class` 引用 / 绑定记录（带锚点）；不可解析绑定入 gap。
- `maui-framework`：`maui` `FrameworkConfig` 检测 + `layerHints`；构建 / 覆盖产物默认忽略。

### Modified Capabilities

（无：四项均为新 capability，走既有 `PluginRegistry` 注册与既有 `StructuralAnalysis` schema；不改 `data-directory` / `reference-integrity` 等已接受 spec 的任何 requirement。）

## Impact

- 目标分支：`main`（worktree `mobile/maui-support`）。
- 新增文件：`packages/core/src/languages/configs/{xaml,csproj,feature}.ts`、`packages/core/src/plugins/parsers/{xaml-parser,csproj-parser,feature-parser}.ts`（各含 `__tests__`）、`packages/core/src/languages/frameworks/maui.ts`（+ 可选 `skills/excavator/frameworks/maui.md`）。
- 改动文件：`packages/core/src/plugins/parsers/index.ts`（注册三个 parser）、语言注册入口（`languages/configs/index.ts` 或 language-registry 的扩展→id 映射）、`languages/frameworks/index.ts`、`framework-registry.ts`（`*.ext` glob manifest 匹配）。扫描去污走项目 `.excavatorignore`，不改全局默认 ignore 表。
- 数据产物：`.xaml`/`.csproj`/`.feature` 由 `no-extractor` → parsed，结构落 `definitions`/`sections`/`steps`/`references`；coverage 分母去污后诚实。
- 语料：`unmc`（真实，opt-in，源码 / 产物不提交）+ purpose-built 合成 MAUI 夹具。
- 运行时依赖：无新增（parser 全手写）。
- roadmap：随本变更删除 `docs/v2-plan.md` 并清理三处悬挂引用（AGENTS.md / CLAUDE.md / frameworks README）。
- 后续（不在本切片）：绑定 → 成员完整解析、C# `owner`/`using` 打磨、Angular 规则、maui.md 约定扩充。
