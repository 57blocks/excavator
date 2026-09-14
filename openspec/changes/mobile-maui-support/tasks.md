每片按仓库规则：先写失败验收 → 实现 → 验证 → 单独 commit。合成夹具用 purpose-built MAUI 小项目；真实语料 `unmc` 验证 opt-in、源码 / 产物不提交。每个 parser 先验装置先红再绿（比内容不比计数）。

## 1. csproj parser（SOUP，最小、先落）

- [ ] 1.1 写验收并确认先红：夹具含多个 `<PackageReference Include=".." Version="..">`、`<TargetFramework(s)>`、`<UseMaui>` → 期望每个依赖一条 `definitions{kind:"dependency", name, fields:["version=.."], lineRange}`；行号落在该 `<PackageReference>` 行；同输入两次运行逐字节相同。反例夹具（无 PackageReference）→ 零依赖记录、不报错。验证：`packages/core/src/plugins/parsers/__tests__/csproj-parser.test.ts` 先红。
- [ ] 1.2 新增 `languages/configs/csproj.ts`（id `csproj`，扩展 `.csproj`）并接入语言注册，使 `getForFile` 对 `.csproj` 返回 id `csproj`。验证：注册单测断言 `.csproj` → `csproj`。
- [ ] 1.3 实现 `plugins/parsers/csproj-parser.ts`（`languages=["csproj"]`），在 `registerAllParsers` 注册。产 `definitions`（依赖 / 目标框架），其余字段空数组。验证：1.1 全绿。
- [ ] 1.4 真实 opt-in：对 `unmc/src/UNMC/UNMC/UNMC/UNMC.csproj` 跑一次，核对 48 个 `PackageReference` 全部成 `definitions` 且行号命中（人工抽查 5 条）。验证：产出计数与抽查记录写入变更记录（产物不提交）。

## 2. Gherkin parser（.feature，行为章）

- [ ] 2.1 写验收并确认先红：夹具含 `Feature` / `Scenario` / `Scenario Outline` / `Given|When|Then|And|But` → 期望 `Feature`/`Scenario` 落 `sections{name, level, lineRange}`、每个步骤落 `steps{name, lineRange}`；步骤原文保真；注释 / 空行不产记录；同输入两次逐字节相同。验证：`feature-parser.test.ts` 先红。
- [ ] 2.2 新增 `languages/configs/feature.ts`（id `feature`，扩展 `.feature`）并接入注册。验证：`.feature` → `feature`。
- [ ] 2.3 实现 `plugins/parsers/feature-parser.ts`（`languages=["feature"]`）并注册。验证：2.1 全绿。
- [ ] 2.4 真实 opt-in：对 `unmc` 的 24 个 `.feature` 跑一次，核对每个文件产 ≥1 section 且步骤数 > 0，无 no-extractor 残留。验证：24/24 parsed 记录写入变更记录。

## 3. XAML parser（View / 导航 / 绑定，大头）

- [ ] 3.1 写验收并确认先红：夹具含 `x:Class`、`x:Name`、`{Binding Path=..}`、`Command="{Binding ..}"`，以及一份带 `x:DataType` 与一份不带 → 期望根元素落 `sections`；`x:Class` 落 `references{referenceType:"code-behind", target:类FQN, line}`；`{Binding}`/`Command`/`x:Name` 落 `definitions{kind:"binding"|"command"|"element", fields, lineRange}`；**带 `x:DataType` 时**绑定可连成员、**不带时**记 `gap: binding-unresolved`（带 file:line 样本）绝不猜。同输入两次逐字节相同。验证：`xaml-parser.test.ts` 先红（含「不带 x:DataType 必须落 gap」这条唱反调绊线）。
- [ ] 3.2 新增 `languages/configs/xaml.ts`（id `xaml`，扩展 `.xaml`；与既有 `xml.ts` 的扩展优先级不冲突）并接入注册。验证：`.xaml` → `xaml`（而非 `xml`）。
- [ ] 3.3 实现 `plugins/parsers/xaml-parser.ts`（`languages=["xaml"]`，`analyzeFile` + `extractReferences`），参考旧 excavator XAML reader；注册。绑定 → 成员解析只做 `x:DataType`/显式类型可唯一定位一档，其余入 gap。验证：3.1 全绿（含 gap 分支）。
- [ ] 3.4 真实 opt-in：对 `unmc` 128 个 `.xaml` 跑一次，记录 parsed 数、`x:Class` 引用命中数、绑定 resolved vs `binding-unresolved` 数（缺口可见即可，不设门）。验证：分类计数写入变更记录。

## 4. maui FrameworkConfig + 扫描去污

- [ ] 4.1 写验收并确认先红：`maui.ts` 从含 `UseMaui` / `Microsoft.Maui.Controls` / `Prism.Maui` 的 `.csproj` 检测出 `maui`；`layerHints` 覆盖 `Views`/`ViewModels`/`Services`/`Models`；`entryPoints` 含 `MauiProgram.cs`/`App.xaml.cs`。验证：framework 检测单测先红。
- [ ] 4.2 实现 `languages/frameworks/maui.ts` 并在 `frameworks/index.ts` 注册；（可选）写 `skills/excavator/frameworks/maui.md`（英文，仅 guidance，不产行号）。验证：4.1 绿；README「present today」与实际文件一致。
- [ ] 4.3 扫描默认 ignore 增 `**/bin/`、`**/obj/`、`**/.unit-test/`、`*.dll`、`*.pdb`、`*.nupkg`；写「含 / 不含」对照证伪装置：对 `unmc` 两次扫描，断言被移出的文件全部是构建 / 覆盖 / 二进制产物，无一条源码（`.cs`/`.xaml`/`.csproj`/`.feature`）。验证：对照装置绿。

## 5. 端到端、真实语料与门禁

- [ ] 5.1 合成端到端：一个 purpose-built MAUI 小项目（含 `.csproj`/`.xaml`/`.feature`/`.cs`）跑 structure-all → 四类文件全 parsed、事实落对应字段、coverage 无 `no-extractor` 残留（除故意留的未知类型）。验证：端到端套件绿。
- [ ] 5.2 真实 opt-in 复跑：对 `unmc` 全量 structure-all，出「移动端文档章节 → 数据来源」对照（SOUP / 行为 / View-导航 / 状态机 / 错误处理各引用到具体 file:line），记录 XAML 绑定 resolved 率与 gap 清单。产物 / 源码不提交，仅把计数与结论写入变更记录。
- [ ] 5.3 门禁：`openspec validate --strict mobile-maui-support` 通过；`pnpm -r build` 先行 + 受影响 `pnpm test` / typecheck / check-refs 全绿且用例只增；无删除 / 跳过 / 弱化既有测试；`docs/v2-plan.md` 删除后无**活跃**悬挂引用（指令 / 配置文件 AGENTS.md / CLAUDE.md / `openspec/config.yaml` / frameworks README 均已改指 `openspec/changes/`；grep `v2-plan` 仅剩其它变更里描述历史工作的已完成任务记录与 `archive/**`，不改写他人变更的历史记录）。验证：命令通过、活跃引用为零。
