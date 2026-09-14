# 设计说明

## 背景约束

- 目标是让移动端（.NET MAUI）的确定性抽取达到与前端 Angular 同等的「带锚点、可辩护」水平，覆盖是软指标、编造是硬指标。
- 只走既有插件缝，不改 core / schema：任何新增产物必须落进现有 `StructuralAnalysis` 字段，使 annotate / validate / knowledge-graph 零改动。

## D1 为什么用手写 parser，而不是 tree-sitter / ast-grep

`AnalyzerPlugin` 接口只要求 `analyzeFile(path, content) → StructuralAnalysis`，不绑定 tree-sitter。`packages/core/src/plugins/parsers/` 下已有 12 个手写 parser（dockerfile / graphql / protobuf / terraform / sql / yaml / makefile / shell / toml / json / env / markdown），`DockerfileParser` 纯正则即产出 `services`/`steps` 且端到端跑通。

- `.csproj` / `.feature` 是行 / XML 结构，正则 + 轻量解析足够，零新依赖。
- `.xaml` 是 XML；手写 XML 遍历（或复用现成轻量 XML 扫描）避免为一门标记语言引入 tree-sitter grammar 的供给风险。
- ast-grep 规则包（`@ast-grep/napi` + YAML）留待需要「跨语言路由 / handler 模式」时再引入；本切片不需要。

## D2 落进既有 schema 字段（不加新字段）

映射表（`StructuralAnalysis` 已有字段）：

| 来源 | 抽取物 | 落入字段 | 关键内容 |
|---|---|---|---|
| `.csproj` | `<PackageReference Include Version>` | `definitions[]` | `kind:"dependency"`，`name`，`fields:["version=..."]`，`lineRange` |
| `.csproj` | `<TargetFramework(s)>` / `UseMaui` | `definitions[]` | `kind:"target"` / `kind:"property"`，`lineRange` |
| `.feature` | `Feature` / `Scenario` | `sections[]` | `name`，`level`，`lineRange` |
| `.feature` | `Given/When/Then/And/But` | `steps[]` | `name`（步骤原文），`lineRange` |
| `.xaml` | 根元素 / 页面 | `sections[]` | View 名，`lineRange` |
| `.xaml` | `x:Class` | `references[]`（`extractReferences`） | `referenceType:"code-behind"`，`source:xaml`，`target:类 FQN`，`line` |
| `.xaml` | `{Binding}` / `Command` / `x:Name` | `definitions[]` | `kind:"binding"`/`"command"`/`"element"`，`fields`，`lineRange` |

绑定 → ViewModel 成员的连边不在 parser 内做（parser 只产单文件事实）；若要连边，走既有 `resolveImports`/`extractReferences` + import-map 那套解析阶段，见 D3。

## D3 绑定 → 成员解析的诚实边界（零编造）

- `x:Class` 是显式的、单义的 → 产强 `reference`（xaml ↔ code-behind C# 类）。稳、必连。
- `{Binding Path=Foo}` 的目标类型来自 `BindingContext`，常在 code-behind 或 `x:DataType` 里确定。判据：**仅当 `x:DataType` 或页面显式类型能唯一定位 ViewModel 类型时**，才把绑定连到该类型的成员；否则记 `gap: binding-unresolved`（带 file:line 与绑定原文样本），绝不猜成员。
- 这符合「没有第四态」：每条绑定要么落 `resolved`（连边）要么落 `binding-unresolved`（可见 gap），无静默丢弃、无臆造。

## D4 no-extractor → parsed 的可见性与先验装置

- 加了 parser 后，`.xaml`/`.csproj`/`.feature` 必须落 `parsed` 或带 reason 的 `gap`，不得静默空结果。
- 先验装置（合入门槛）：对每个 parser，先喂一份含已知 `PackageReference` / `Scenario` / `{Binding}` 的夹具并断言 parser **先看得见**（红 → 实现 → 绿）；再喂一份不含目标构造的夹具断言零误报。比内容不比计数（`verify-the-instrument-first`）。

## D5 framework addendum 只作 guidance

`skills/excavator/frameworks/maui.md`（若写）沿用 `frameworks/README.md` 契约：约定只指路、不产行号，据此得到的边一律 `provenance:"inferred"` 无 evidence，annotate / validate 永不当事实。它是对 `maui.ts`（确定性检测 + 分层）的补充，不是抽取手段。

## D6 扫描去污：项目级 ignore，不动全局默认

- 盘点：全局默认已含 `obj/`/`coverage/`/`build/`/`target/`；`.dll`/`.exe`/`.pdb`/`.nupkg` 已按二进制扩展落可见 skip 桶。
- **不把 `bin/`、`.unit-test/` 加进全局默认**：`bin/` 在 Rails（`bin/rails`）、venv、npm CLI bin 里是真源码，全局忽略会在别的语料反向误伤（over-ignoring inverts on new corpus）；`.unit-test/` 是 `unmc` 自定义覆盖目录名，不具普适性。二者属项目级 `.excavatorignore`（layer 2）。
- 证伪装置（`excluded-manifest-zeroes-a-capability` 的反向）：用「含 / 不含项目 ignore」两次扫 `unmc` 对照（`--exclude bin/,.unit-test/,TestResults/` vs 默认），断言被移出的文件**全部**属于构建 / 覆盖 / 二进制产物，无一条 `.cs`/`.xaml`/`.csproj`/`.feature` 源码。实测：1772→1231，dropped 541，源码丢失 0。

## 切片顺序理由

先 `csproj` + `feature`（各一个小 parser、schema 映射直接、立刻分别产出 SOUP 表与行为章）→ 再 `xaml`（大头，含绑定解析的诚实边界）→ 最后 `maui.ts` + ignore 调整 + 端到端 + 真实 `unmc` opt-in。每片独立可测、可交付、可单独 revert。
