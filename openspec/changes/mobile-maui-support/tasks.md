每片按仓库规则：先写失败验收 → 实现 → 验证 → 单独 commit。合成夹具用 purpose-built MAUI 小项目；真实语料 `unmc` 验证 opt-in、源码 / 产物不提交。每个 parser 先验装置先红再绿（比内容不比计数）。

## 1. csproj parser（SOUP，最小、先落）

- [x] 1.1 写验收并确认先红：夹具含多个 `<PackageReference Include=".." Version="..">`、`<TargetFramework(s)>`、`<UseMaui>` → 期望每个依赖一条 `definitions{kind:"dependency", name, fields:["version=.."], lineRange}`；行号落在该 `<PackageReference>` 行；同输入两次运行逐字节相同。反例夹具（无 PackageReference）→ 零依赖记录、不报错。验证：`packages/core/src/plugins/parsers/__tests__/csproj-parser.test.ts` 先红。
- [x] 1.2 新增 `languages/configs/csproj.ts`（id `csproj`，扩展 `.csproj`）并接入语言注册，使 `getForFile` 对 `.csproj` 返回 id `csproj`。验证：注册单测断言 `.csproj` → `csproj`。
- [x] 1.3 实现 `plugins/parsers/csproj-parser.ts`（`languages=["csproj"]`），在 `registerAllParsers` 注册。产 `definitions`（依赖 / 目标框架），其余字段空数组。验证：1.1 全绿。
- [x] 1.4 真实 opt-in：对 `unmc/src/UNMC/UNMC/UNMC/UNMC.csproj` 跑一次，核对 `PackageReference` 全部成 `definitions` 且行号命中。实测：主 csproj 32 依赖 + 1 target + 1 property，行号命中（如 Microsoft.Maui.Controls 8.0.100 @ L262）。

## 2. Gherkin parser（.feature，行为章）

- [x] 2.1 写验收并确认先红：夹具含 `Feature` / `Scenario` / `Scenario Outline` / `Given|When|Then|And|But` → 期望 `Feature`/`Scenario` 落 `sections{name, level, lineRange}`、每个步骤落 `steps{name, lineRange}`；步骤原文保真；注释 / 空行不产记录；同输入两次逐字节相同。验证：`feature-parser.test.ts` 先红。
- [x] 2.2 新增 `languages/configs/feature.ts`（id `feature`，扩展 `.feature`）并接入注册。验证：`.feature` → `feature`。
- [x] 2.3 实现 `plugins/parsers/feature-parser.ts`（`languages=["feature"]`）并注册。验证：2.1 全绿。
- [x] 2.4 真实 opt-in：对 `unmc` 的 24 个 `.feature` 跑一次，核对每个文件产 ≥1 section 且步骤数 > 0，无 no-extractor 残留。实测：24/24 files parsed，0 zero-section / 0 zero-step，共 68 sections / 2234 steps。

## 3. XAML parser（View / 导航 / 绑定，大头）

**范围（诚实边界）**：单文件 parser 只抽 XAML 文本可见事实（带行号）。`{Binding}` → ViewModel **成员**的连边需另一份 `.cs` 的符号，**不在本切片做**，记为下面的「resolver 后续」。产物一律落 `analyzeFile` 的 `StructuralAnalysis`（`extractReferences` 当前不被流水线消费）。

- [x] 3.1 写验收并确认先红：夹具含 `x:Class`、`x:Name`、`{Binding Path=..}`、`Command="{Binding ..}"`，以及一份带唯一 `x:DataType` 与一份不带 → 期望根元素落一条 `sections`（name 取 `x:Class` 短名）；`x:Class` 落 `definitions{kind:"code-behind", name:FQN, lineRange}`；`x:Name`/`{Binding}`/`Command`/`x:DataType` 落 `definitions{kind:"element"|"binding"|"command"|"datatype", lineRange}`；每条绑定 fields 带 `context=<type>`（唯一 x:DataType）或 `context=none`（缺失/多义），**绝不产成员连边**。同输入两次逐字节相同。验证：`xaml-parser.test.ts` 先红（含「无 x:DataType → context=none」这条唱反调绊线）。
- [x] 3.2 新增 `languages/configs/xaml.ts`（id `xaml`，扩展 `.xaml`；与既有 `xml.ts` 扩展不冲突）并接入注册。验证：`.xaml` → `xaml`（而非 `xml`）。
- [x] 3.3 实现 `plugins/parsers/xaml-parser.ts`（`languages=["xaml"]`，仅 `analyzeFile`），参考旧 excavator XAML reader；注册。验证：3.1 全绿。
- [x] 3.4 真实 opt-in：对 `unmc` 128 个 `.xaml` 跑一次，记录 parsed 数、`x:Class`/`x:Name`/binding/command 计数、有/无 DataType 上下文的绑定数（缺口可见即可，不设门）。实测：128/128 有 view section；x:Class 125、x:DataType 19、x:Name 433、binding 393、command 113；context-known 69、context=none 437（未声明唯一 x:DataType 的绑定诚实标 none，不猜成员）。

**resolver 后续（不在本切片）**：结合 C# ViewModel 符号 + node-identity，把带 `context=<type>` 的绑定解析到成员（命中→连边、未命中→ `binding-unresolved` gap、`context=none`→无法尝试）。

## 4. maui FrameworkConfig + 扫描去污

- [x] 4.1 写验收并确认先红：`maui.ts` 从含 `UseMaui` / `Microsoft.Maui.Controls` / `Prism.Maui` 的 `.csproj` 检测出 `maui`；`layerHints` 覆盖 `Views`/`ViewModels`/`Services`/`Models`；`entryPoints` 含 `MauiProgram.cs`/`App.xaml.cs`。验证：framework 检测单测先红（count 10→11、maui 检测、layerHints 三条红）。
- [x] 4.2 实现 `languages/frameworks/maui.ts` 并在 `frameworks/index.ts` 注册；`.csproj` 名不固定，故给 `FrameworkRegistry.detectFrameworks` 加 `*.ext` glob manifest 匹配（`manifestFiles:["*.csproj"]`）；写 `skills/excavator/frameworks/maui.md`（英文，仅 guidance，不产行号）并列入 README「Present today」。验证：4.1 绿；README addendum-list 测试绿。
- [x] 4.3 扫描去污（**修正为项目级 ignore，不动全局默认**）：`obj/`/`coverage/`/`build/`/`target/` 已在全局默认；`.dll`/`.exe`/`.pdb`/`.nupkg` 已按二进制扩展落可见 skip 桶；`bin/` 不进全局（Rails `bin/rails`、venv `bin/`、npm CLI bin 是真源码，全局忽略会在别的语料反向误伤——见「over-ignoring inverts」）。真实噪声 `.unit-test/`（覆盖报告）是项目自定义名，属项目级 `.excavatorignore`（layer 2）。「含 / 不含」证伪装置（`--exclude bin/,.unit-test/,TestResults/` vs 默认）实测：filesScanned 1772→1231，dropped 541，**源码丢失 0**；dropped 分布 `.unit-test` 526 / `bin` 14 / `TestResults` 1；byLanguage 掉 html 502 / xml 22 / json 9 等，csharp/xaml/csproj/feature 一条未掉。结论：MAUI 项目去污用项目 `.excavatorignore`（`bin/ .unit-test/ TestResults/`），不改全局默认。

## 5. 端到端、真实语料与门禁

- [x] 5.1 合成端到端（committed vitest `tests/skill/excavator/test_maui_readers_e2e.test.mjs`）：用真实 `PluginRegistry`（`registerAllParsers`）经 `analyzeFileWithOutcomes` 跑三个新 reader 的 purpose-built 夹具（`.csproj`/`.feature`/`.xaml`）→ 全部 `structureOutcome: succeeded` 且 `deriveStatus = parsed`；未知扩展 → `skipped`/`no-extractor`（无假 parse）。`.cs` 为既有 csharp 抽取器（unmc 962 文件已验证），不在本 e2e 重复。验证：4/4 绿。
- [x] 5.2 真实 opt-in（`unmc`，仅计数、不提交路径）——「移动端文档章节 → 数据来源」对照：
  - **2.3 SOUP / 6 References** ← `.csproj` PackageReference：5 个 csproj 共 **47 个 distinct 依赖**（Microsoft.Maui.Controls、Prism.Maui、Plugin.BLE、Serilog、Stateless、ScottPlot、Newtonsoft.Json 等）。
  - **3 UI 描述 / 行为流程** ← `.feature`：**24 文件、68 features/scenarios、2234 steps**（ErrorHandling / Recordings / PatientEvents / TabNavigation…）。
  - **3 View / 导航** ← `.xaml`：**128 views、x:Class 125、x:Name 433、binding 393、command 113**；绑定 DataType 上下文 **ctx-known 69 / ctx-none 437**（none 为可见 gap 候选，成员级 resolved 属 resolver 后续，不在本切片）。
  - **2.4 Solution Overview / 3.6 MVVM** ← `maui` 框架检测（Prism.Maui）+ xaml/csharp 分层。
  - **4 错误处理 / 状态模型** ← 既有 C# 抽取（unmc 962 文件）+ `ErrorHandling.feature` + `Stateless` 状态机（见 SOUP）。
- [x] 5.3 门禁：`openspec validate --strict mobile-maui-support` 通过；`pnpm -r build` 先行 + 受影响 `pnpm test` / typecheck / check-refs 全绿且用例只增；无删除 / 跳过 / 弱化既有测试；`docs/v2-plan.md` 删除后无**活跃**悬挂引用（指令 / 配置文件 AGENTS.md / CLAUDE.md / `openspec/config.yaml` / frameworks README 均已改指 `openspec/changes/`；grep `v2-plan` 仅剩其它变更里描述历史工作的已完成任务记录与 `archive/**`，不改写他人变更的历史记录）。实测全绿：build / typecheck / check-refs（44 script + 2 hook + 5 manifest 引用全解析）/ core 1039 / root 928+4skip / `openspec validate --strict` valid；活跃 `v2-plan` 引用为零（仅本变更 proposal/tasks 在描述该删除，及 verifiable-statements 的历史任务记录）。
