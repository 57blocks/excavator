## Why

用户要求能检查 dead code，并且三条硬要求：定义要明确（例如 A 只被 B 引用、B 无人引用时，A 与 B 是否都算 dead）；检测必须严谨——绝不能把还在使用的代码报成 dead；整个能力必须 build-free——适配多种语言，不安装 Java 之类的运行环境，不做副本删除再编译这样的操作。「dead」是一个关于*不存在*的断言，只有在代码可能被引用的每一种方式都被看见时才允许发出；现有事实图做不到这一点。在 Apache Fineract（f9c2fcd，当前 main 的图谱）上只读实测与读码核对：

- 非测试 Java 方法 23,692 个，其中 8,654 个没有任何入边。这 8,654 个里有 126 个覆写了仓库内祖先类的**具体**方法（如 `*Handler.fallback(2)`、`AcmeLoanRepaymentScheduleTransactionProcessor.getCode()`），经父类型静态调用会分派到它们；图里没有这种覆写边，按入边判断会把它们全部误报为 dead。
- 方法级 `implements` 边在擦除签名不能确定时**静默不连**（类型变量、嵌套类型、按需导入的外部类型）：`COBBusinessStep<T>.execute(T)` 的 15 个实现 `execute(Loan)` 一条边都没有，而它们全部经接口被调用。继承来的实现也没有边：`class C extends Base implements I {}` 里 `Base.m()` 满足 `I.m()`，图里看不到。
- Java 抽取器完全不记录方法引用（`X::m`）：主代码约 821 行用到 `::`，例如 `PlatformCache::isEhcacheEnabled` 的目标在图里没有任何入边。
- 函数条目没有修饰符与注解：分不出 `private` / `public`，看不见 `@GET`、`@Bean`、`@Scheduled`、`@Override`、`@Test`，而这些正是框架入口与外部契约所在。注解实参里的类字面量（`@Mapper(uses = Helper.class)`）也没有记录，而生成代码会按类型调用 `Helper` 的方法。
- 约定式反射看不见：`CashierTransactionsWithSummaryData.getSumOutwardCash()` 在全仓文本里只出现在声明处，但它是 `TellerApiResource` 返回的数据对象的 getter，由 JSON 序列化反射调用。按「全仓没有别的出现」判它 dead 是错的。
- 遍历不分方向，没有「谁引用了它」的原语，也没有从根出发的可达性。

因此 dead code 不能靠 skill 或 prompt 在现有工具上「问出来」：它需要全仓范围的确定性可达性、全仓文本扫描、每个声明落一个可见桶的守恒，以及可审计的证据——这些只能落代码（AI-first scope gate：模型无法在可接受成本内稳定且无误地完成，且结果必须可机器校验）。而且这一切只能建立在 tree-sitter 级别的抽取之上：不编译、不类型检查、不依赖目标语言的工具链。

## What Changes

- Java 抽取器补出方法声明事实（可见性、`static` / `final` / `native` / `default`、方法注解名），记录类字面量（`X.class`，区分注解实参与代码），并把方法引用（`X::m`、`this::m`、`super::m`、`X::new`）记录为调用点（参数个数未知）；结构结果透传并校验这些字段。
- 事实图的类型层次边补齐：具体方法之间的 `overrides` 边；继承来的实现（`class C extends Base implements I {}` 的 `Base.m()` → `I.m()`）成 `implements` 边；接口 `default` 方法参与两侧；擦除签名不能确定的同名同参数个数配对**不再静默丢弃**，记为可见缺口 `override-uncertain`。遍历沿 `overrides` 走。
- 新增确定性、零模型、**语言无关**的 Core 原语 `dead-code`：引擎只消费一种通用的「引用事实」模型（函数节点的可见性 / 可分派性 / 注解 / 约定标记、未解析调用点、可能覆写配对、类字面量目标）与声明式的根；每种语言通过一个 build-free 的适配器（结构结果 → 引用事实）、一份覆盖声明与一份规则数据（内建根、注解与约定目录）接入，引擎不含任何语言分支。Java 是第一个声明覆盖的语言。
- 引擎为每个函数节点给出恰好一个判定：`live`（有解析边构成的证据路径）、`test-only`（只从测试根可达）、`undetermined`（仓库里有引用证据，带原因与位置）、`suspect`（疑似 dead：仓库里没有任何引用证据，唯一差的是人的一条立场声明——当前只有「公开 API 未声明」——记录写明了结它的声明）、`dead`（在所列残余假设下 dead，带已执行的检查）。不带置信度，桶只按原因种类划分。`dead` 只在以下全部成立时发出：没有任何解析边、名字兼容的可能引用或签名不确定的可能覆写；不属于任何「不在索引内」的引用形态（外部覆写、未分类注解、注解实参里的类字面量、约定式访问器、未声明的公开 API）；且该名字在被选中源码集合里，逐行计数后除本声明、同名声明与解析到它自身的调用点之外没有任何多余出现。只被 `suspect` 引用的节点也是 `suspect`，只被 `dead` 引用的节点也是 `dead`（用户的 A/B 例子）。构造器不在本变更的 dead 范围内（只可能 `live` / `test-only` / `undetermined`，原因可见）。
- 新增项目根目录的活性声明文件 `.excavator-liveness.json`（根、注解分类、公开 API 立场、测试范围）与随插件发布的 Java 注解目录（数据文件）；未分类的注解落 `undetermined`，未声明立场的公开 API 落 `suspect`，都不会把判定推向 `dead`。
- 新增产物 `.excavator/dead-code.jsonl`（按行存储，头部带守恒计数、事实摘要、声明摘要、残余假设与普查）与 CLI。
- MCP 新增只读工具 `dead_code`（普查 / 分页列表 / 指定节点的判定与证据），有界、带新鲜度；工具数 7 → 8。
- 新增 skill `excavator-dead-code`：从普查与构建文件提出活性声明，经人确认后写入，再运行原语并汇报；skill 不改判定。
- 未声明覆盖的语言：所有函数节点落 `undetermined`（`language-not-covered`），守恒照常成立；非 Java 的事实投影逐字节不变。

## Capabilities

### New Capabilities

- `dead-code`：五桶活性判定（`live` / `test-only` / `undetermined` / `suspect` / `dead`）的定义、可能引用图、`dead` 与 `suspect` 的发出条件与残余假设、活性声明、语言插件模型与覆盖门、build-free 约束、产物守恒与有界查询。

### Modified Capabilities

- `fact-graph`：事实边加入 `overrides`；「Java 类型层次边」改为覆盖继承来的实现、`default` 方法与 `override-uncertain` 缺口；新增「Java 方法引用作为调用点」「Java 方法声明的修饰符、注解与类字面量」「Java 具体方法覆写边」三项要求。
- `mcp-tool-surface`：工具面加入只读的 `dead_code`。

## Impact

- 代码：
  - `packages/core/src/plugins/extractors/java-extractor.ts`、`packages/core/src/types.ts`；
  - `skills/excavator/extract-structure-result.mjs`、`skills/excavator/build-fact-graph.mjs`、`skills/excavator/java-call-resolution.mjs`（层次边补齐、报告模式补充接收者类型、候选与不确定配对）、`skills/excavator/retrieve.mjs`（可遍历的边类型）；
  - 新增 `skills/excavator/dead-code.mjs`（通用引擎）、`skills/excavator/liveness-declaration.mjs`、`skills/excavator/liveness/java.mjs`（Java 适配器）、数据文件 `skills/excavator/liveness-catalog/java.json`；
  - `skills/excavator/mcp-server.mjs`、`skills/excavator/project-service.mjs`、`deploy/mcp-smoke.mjs`；
  - 新增 `skills/excavator-dead-code/SKILL.md`。
- 产物：Java 项目的事实图变大（方法引用调用点、`overrides` 边、继承实现的 `implements` 边、`override-uncertain` 缺口），Java 夹具的固定摘要整块重冻；新增 `.excavator/dead-code.jsonl`；非 Java 项目的事实图不变。
- 验收全部 build-free：不编译目标项目、不安装 JDK / Gradle / Go 等工具链、不下载依赖。精度 oracle 为独立代理审读、真实语料绊线、夹具项目全链路变异、夹具变异测试与独立 `git grep -nw` 交叉核对（见 design「验收」）。`dead` 的验收在 Fineract 与 hadoop（规模）上做；wcp 与 cebreo 验的是「未覆盖语言全部 `undetermined` 且守恒」以及 uneeg-managementportal 里 Kotlin 调用 Java 的跨语言否决。
- 不在范围内：
  - 构造器的 `dead`：反射实例化（DI、JPA、序列化、`ServiceLoader`、`Class.forName`、XML）没有类级引用索引可依，构造器一律不判 dead；
  - 类 / 文件 / 模块级的 dead 汇总（需要类型引用索引，不只是方法引用）；字段；
  - 非 Java 语言的覆盖声明与规则数据（每种语言各自一个变更，经同一条 build-free 抽取路径接入，不改引擎）；
  - 自动删除或重构；
  - 嵌套类型、匿名类、局部类的方法与注解类型（`@interface`）的元素仍不是节点，不获得判定；嵌套类型内部的调用点作为「未归属的引用来源」参与判定。
