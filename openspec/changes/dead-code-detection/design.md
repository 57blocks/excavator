## Context

- 事实图（`build-fact-graph.mjs`）对 Java 调用点按接收者静态类型解析（java-member-call-resolution 已归档）：每个调用点落入成边或五个桶之一（`calls-external`、`calls-generated`、`calls-ambiguous`、`calls-unresolved`、`calls-caller-unresolved`），守恒 fail-closed。`resolveFileCalls(row, { report: true })` 对成边的调用点给出 `outsideHierarchy`；对不成边的调用点只给桶名。
- 类型层次边（`hierarchyEdges()`，读码核实）：类到类的 `inherits` / `implements`；方法级只为「类型自己声明的具体方法 → 祖先的抽象方法」连 `implements`，且 `erasedSignature` 为 null（类型变量、嵌套或无法解析的类型、按需导入的外部类型）时直接 `break`，静默不连边。接口被整体跳过（`default` 方法不参与）。继承来的实现（`class C extends Base implements I {}`）没有边。具体方法之间的覆写没有边。
- Java 函数条目字段：`name`、`owner`、`lineRange`、`params`、`paramTypes`、`declaredReturnType`、`abstract`、`typeParameters`。没有可见性、修饰符、方法注解。类条目有 `kind`（`class` / `interface` / `enum` / `record`，封闭集合）、`qualifiedName`、`supertypes`（`{relation, type, line}`）、`fieldTypes`、`annotations`。顶层 `annotation_type_declaration` 完全不抽取：注解类型与其元素今天不是节点。
- 抽取器不记录方法引用 `::`、不记录类字面量 `X.class` 的位置；静态初始化块与嵌套类型、匿名类、局部类内的调用点落 `calls-caller-unresolved`。
- 遍历（`retrieve.mjs`）不分方向，沿 `contains` / `imports` / `exports` / `calls` / `inherits` / `implements`。
- 项目根目录已有人工维护、skill 经确认后写入的声明文件先例：`.excavatorignore`（data-directory 规格）。MCP 的写入限于 `.excavator/`。
- 验收语料：wcp 是 Go，cebreo/unmc 是 C#，cebreo/uneeg-managementportal 是 Kotlin + TypeScript（含 8 个 Java 文件；380 个 Kotlin 行里 235 个带调用点，共 16,001 个）。只有 Fineract 与 hadoop 是 Java。
- 用户约束：build-free。不编译目标项目、不安装 JDK 之类的运行环境、不做副本删除再编译；能力要适配多种语言。本机也没有 Fineract 要求的 JDK 25 与 Gradle 缓存，这一约束同时也是事实。
- 基线（Fineract，当前 main 的图谱，只读探针，脚本在本地 scratchpad，不进仓库）：非测试 Java 方法 23,692；有 `calls` / `implements` / `inherits` 入边 15,038；有出向方法级 `implements` 边 3,044；构造器或 `main` 1,167；名字与某个非成边、非外部调用点相同 2,533；完全没有调用证据 1,910。这 1,910 个里：所属类型层次含仓库外或无法解析的父类型 699；`get` / `is` / `set` 约定式访问器 461；所属类型带类注解 1,465；覆写仓库内祖先的具体方法 18；抽象方法 77；五项都不触发 117。对这 117 个随机抽 40 个做全仓整词 `git grep`，22 个在声明之外另有出现。全部 8,654 个无入边方法里，覆写仓库内具体祖先方法的有 126 个；`COBBusinessStep<T>.execute(T)` 有 15 个实现，一条方法级边都没有。

## Goals / Non-Goals

**Goals:**
- `dead` 只在代码可能被引用的每一种方式都被看见且均无引用时发出；`suspect` 只在仓库没有任何引用证据、仅差一条人的立场声明时发出；每个判定可审计（`live` 有逐跳证据路径，`undetermined` 有原因与位置，`suspect` 有了结声明，`dead` 有已执行的检查）。
- 每个函数节点恰好一个判定，五桶守恒 fail-closed；未覆盖语言的节点全部可见地落 `undetermined`。
- 引擎语言无关：每种语言只提供 build-free 的抽取事实、覆盖声明与规则数据；Java 是第一个。
- 根、注解语义、公开 API 立场、测试范围全部是声明式数据；未声明即 `suspect` 或 `undetermined`，普查让未声明项的代价可见，人可以逐项收窄。
- 抽取缺口（方法引用、修饰符与注解、类字面量、层次边补齐）先补齐，再发任何 `dead` / `suspect`。
- 全程 build-free：判定、抽取、验收都不依赖目标语言的编译器、运行时、工具链或依赖下载。
- 验收装置能抓到假阳性，且全部 build-free：夹具绊线与变异测试、夹具项目全链路变异、真实语料绊线、独立代理按引用形态逐条猎错、独立 `git grep -nw` 交叉核对。

**Non-Goals:**
- 构造器的 `dead` / `suspect`：反射实例化没有类级引用索引可依（见 D4）。
- 类 / 文件 / 模块级的 dead 汇总，字段的活性：需要类型引用索引（`new X`、类型用法、泛型实参），本变更只做方法级。
- 非 Java 语言的覆盖声明与规则数据；每种语言各自一个变更，经同一条 build-free 抽取路径接入，不改引擎。
- 自动删除、重构建议、IDE 集成。
- 增量判定：每次全量重算（在 hadoop 上也只是 Lazy 的零头）。
- 为嵌套类型、匿名类、局部类、注解类型建节点；不改抽取器对它们的处理。
- 以实参类型选重载；lambda 参数类型推断。
- 任何形式的置信度或概率。

## Decisions

**D1：定义——从根出发的可达性，不是入边计数；方法级粒度；构造器不判 dead。** 用户的例子（A 只被 B 引用、B 无人引用）在入边计数下只有 B 是 dead，要删掉 B 再跑一次才能发现 A；孤岛环（A↔B）在入边计数下永远不是 dead。可达性一次得出：A、B 都 dead，并作为一个簇报告，簇内标出「直接无引用」的入口（B），这样用户知道先删谁。粒度是函数节点（方法、接口方法、抽象方法；构造器只参与活性传播）：引用证据只在这一级完整；类、文件的 dead 要求「没有任何类型引用」，而类型引用（`new X`、字段与参数类型、`instanceof`、`X.class`、泛型实参）今天没有索引，强行汇总会违反「不在索引内即未知」。
- 备选「入边为零」：实现简单、不需要根；但答不了用户的 A/B 例子，且要迭代删。不选。
- 代价：需要根集合。D3 用「未声明即 `suspect` / `undetermined`」让没有任何声明时的结果仍然可靠。

**D2：五桶与判定顺序；`live` 只由解析边证明；可能引用只阻止 `dead` / `suspect`；`suspect` 只由立场类原因产生。** 按固定顺序，先到者得：
1. `live`：从生产根沿解析边可达。解析边 = `calls`（唯一目标）；覆写分派（被覆写 / 被实现的方法活 ⇒ 覆写它的方法活，沿 `implements` / `overrides` 反向走）；声明依赖（覆写方法活 ⇒ 被覆写方法活，沿 `implements` / `overrides` 正向走——删掉它要同时改动实现的 `@Override`）。分派只从「被调用而活」（根、`calls` 的目标、分派到达）的方法出发，不从「仅因声明依赖而活」的方法出发：否则 `C1.m()` 被调用会让 `I.m()` 活，再让从未被分派到的 `C2.m()` 活。每一跳有证据，记录保存根与前驱，路径可重建。
2. `test-only`：不是 `live`，但从测试根沿解析边可达。
3. `undetermined`：不是前两者，且（a）至少一条**证据类**原因成立（D4），或（b）从生产根、测试根、所有 (a) 节点、所有 `live` / `test-only` 节点出发，沿解析边与可能引用（D5）可达。记录原因（规则名或到达它的边种类）与前驱。
4. `suspect`：不是前三者，且（a）至少一条**立场类**原因成立（当前只有 `public-api-undeclared`），或（b）从 `suspect` 节点出发沿解析边与可能引用可达。记录了结声明（所有到达它的 `suspect` 来源的了结声明之并，沿前驱继承）。证据类的传播在立场类之前完成，所以任何从 `undetermined` 可达的节点先被 3(b) 拿走——证据压过立场。
5. `dead`：其余。记录已执行的检查、簇标识、是否直接无引用；保证表述为「在产物头部所列残余假设下 dead」。

为什么可能引用不给 `live`：按名字匹配的「可能引用」没有逐跳证据，把它标成「在使用」就是编造使用者；用户要的是「不误报 dead」，不是「多报 live」。为什么 `suspect` 单列：用户要区分「确定 dead」与「疑似 dead」；疑似的唯一诚实定义是「仓库里一条证据都没有，差的只是人的立场」。它必须机器可核：桶按原因种类划分，不打分。`bean-accessor` 留在证据类而不是立场类：序列化按属性名反射调用访问器是仓库里可观察的具体机制（`getSumOutwardCash` 是活的），把它叫「疑似 dead」多半是错的；`beanAccessors: plain` 声明只是把这条证据关掉，不是立场。同理 `annotation-unclassified`（注解就在那里）、`language-not-covered`、所有可能引用都是证据类。
- 备选：两值或三值。不选：无法区分「有证据活着」「不敢说」「只差一句话」，普查就没有收窄的抓手。

**D3：根是声明式数据；内建根只收语言契约；未声明一律 `suspect` / `undetermined`；skill 提议、人确认、Core 消费。**
- 内建根来自语言规则数据（D7）。Java：`public static void main(String[])`；覆写 `java.lang.Object` 的 `equals(1)` / `hashCode()` / `toString()` / `finalize()` / `clone()`；标注 `@Override` 且仓库内父类型没有对应方法的声明（它覆写的只能是仓库外的方法，外部代码经该契约调用）；序列化约定方法（`readObject`、`writeObject`、`readResolve`、`writeReplace`、`readObjectNoData`、`readExternal`、`writeExternal`）。
- 声明式根与分类来自两个数据源：
  - 随插件发布的语言规则数据 `skills/excavator/liveness-catalog/java.json`：每条注解给出名字、作用位置（方法 / 类）、分类（`root` / `inert` / `reflective`）与出处。首版只收语义确定的条目：Lombok（`Slf4j`、`Getter`、`Setter`、`Data`、`Value`、`Builder`、`RequiredArgsConstructor`、`NoArgsConstructor`、`AllArgsConstructor` 等：类级 `inert`，它们只生成成员，不调用声明的方法）；Spring 构造型（`Component`、`Service`、`Repository`、`Controller`、`RestController`、`Configuration`：类级 `inert`——这里的 `inert` 只断言框架不会按约定调用这个类型声明的方法，方法调用由方法级注解表达；它不涉及实例化，实例化是反射的构造器调用，而构造器已按 D4 整体不判 dead）；Spring / Jakarta / JAX-RS / JUnit 的方法级 `root`（`Bean`、`PostConstruct`、`PreDestroy`、`Autowired`、`Inject`、`Scheduled`、`EventListener`、`TransactionalEventListener`、`JmsListener`、`KafkaListener`、`RabbitListener`、`GET` / `POST` / `PUT` / `DELETE` / `PATCH` / `HEAD` / `OPTIONS`、`RequestMapping` 及其 `*Mapping` 变体、`Test` / `ParameterizedTest` / `RepeatedTest` / `BeforeEach` / `AfterEach` / `BeforeAll` / `AfterAll`、`PrePersist` 等 JPA 回调）；`Mapper`（MapStruct）与 `Entity` 类级 `reflective`。
  - 项目根目录的 `.excavator-liveness.json`：`publicApi`（按路径 glob 顺序首匹配，`internal` / `external`）、`testScope`（路径 glob；范围内的所有函数节点是测试根，范围内带 `root` 注解的方法——如 `@Test`——也只是测试根，测试范围优先于注解根，否则声明了测试范围反而把测试方法变成生产根）、`annotations.method` / `annotations.class`（覆盖或补充目录）、`beanAccessors`（`reflective` 默认 / `plain`）、`roots`（节点 id 或 `Owner#name` 模式）。严格校验，未知键即失败。
- 为什么是文件而不是 MCP 参数：根集合是判定的前提假设，必须和产物一起被记录（摘要进头部）并可被人审阅；按调用传入会让每次结果依赖看不见的参数。先例是 `.excavatorignore`：skill 检查项目后提出规则，人确认后 skill 写入根目录；MCP 不写。
- 为什么未声明即 `suspect` 而不是「默认公开方法是根」或「默认不是根」：前者让 `dead` 退化成只有私有方法；后者会把库的公开 API 报成 dead。两者都是判断题，不该由 Core 替项目拍板；`suspect` 加按路径分组的了结声明普查，让人用最少的声明换最多的判定。Fineract 的例子：`fineract-client-feign` 是客户端库，其公开方法是外部契约；其余模块是应用。只有人知道这一点。
- 代价：没有声明时 `dead` 只会出现在私有与包私有方法上，公开方法最多到 `suspect`。基线数据说明这正是可靠的起点。

**D4：「不在索引内」的引用形态逐一降级；证据类与立场类分开。** 规则见规格「`dead` 的发出条件与残余假设」。设计上的取舍：
- 构造器出范围（`constructor-out-of-scope`，证据类）：DI、JPA、序列化、`ServiceLoader`、`Class.forName`、XML 都反射实例化，它们引用的是*类*，而类级引用索引不在本变更内。用类名做文本否决只是碰巧让构造器永远被否决（`class Foo` 这一行既不是「本声明」也不是同名方法声明），规则靠巧合成立就不是规则。所以构造器只可能 `live`（有 `new X()` 边）、`test-only` 或 `undetermined`，并在活性传播中正常充当来源。
- `may-override-external`：类层次含仓库外或无法解析的父类型时，任何非 `private`、非 `static` 的实例方法都可能覆写外部方法并被外部代码调用；Java 不强制 `@Override`，所以没有注解不能排除；有 `@Override` 且仓库内父类型也声明了同名方法，同样不能排除它还覆写了外部接口的同名方法（`class C extends RepoBase implements ExternalIface` 的 `run()`），所以 `@Override` 不解除规则——唯一的例外是 `@Override` 而仓库内父类型没有对应方法，那它必然覆写外部方法，是根。规则还要看**子类型**：`class C extends Base implements ExternalIface {}` 让 `Base.m()` 经 `ExternalIface` 可被外部调用，所以 M 所属类型或任一继承了 M 的仓库内子类型触及仓库外，都触发。「无法解析」明确包括仓库内类型的成员类型（`implements Outer.Inner`）与仓库内 Kotlin / Scala 声明的类型。`java.lang.Object` / `Enum` / `Record` 单独处理（它们的方法是封闭集合），否则所有类都会被这条规则覆盖。`static` 不参与分派，`private` 不能覆写，所以都不触发。
- 注解：未分类即 `undetermined`，而不是「未分类即 `inert`」。类注解未分类时影响该类型所有非 `private` 方法（`private` 方法只看方法注解：框架按约定找的几乎都是非私有成员；`@PostConstruct private void init()` 这类由方法注解覆盖）。
- 注解实参里的类字面量（`annotation-class-literal`）：`@Mapper(uses = Helper.class)` 让生成代码按类型调用 `Helper` 的方法，`Helper` 没有注解、方法名也不出现，没有别的规则能覆盖它；`@Import`、`@ExtendWith`、`@ContextConfiguration(classes=)`、`@JsonSerialize(using=)`、`@Convert(converter=)`、`@EntityListeners` 同一机制。规则：被任一注解实参以 `X.class` 引用的仓库类型，其非 `private` 方法 `undetermined`；`X` 按 Java 的类型解析规则解析，简单名解析不了就按同名的全部仓库类型算。代码里（非注解实参）的类字面量不触发：`getLogger(Foo.class)` 几乎每个类都有，一触发就把整个仓库变成 `undetermined`；交给仓库外方法后发生的反射调用是写明的残余假设，数量进普查。
- 注解类型的元素（`annotation-element`）：`@interface` 的元素由反射读取，`value` 还会被隐式赋值。它们今天不是节点（抽取器不读 `annotation_type_declaration`），所以不会被误判；规则仍然写进引擎：结构结果里一旦出现 `kind: 'annotation'` 的类型，其元素一律 `annotation-element`；引擎遇到不认识的类型种类 fail-closed。
- `bean-accessor`：基线里的 `getSumOutwardCash()` 在全仓文本只出现在声明处，却由 JSON 序列化反射调用；`ScorecardValue.setQuestionId(1)` 同样零出现、由反序列化调用。文本否决抓不到按约定（属性名 ≠ 方法名）的反射，所以必须有独立规则。默认 `reflective`，项目可声明为 `plain`，代价写在声明里。
- `public-api-undeclared` 是唯一的立场类原因：仓库里没有证据，差的只是「这条路径是不是对外的 API」这一句话。声明 `internal` 后按其余条件重判；声明 `external` 后变成证据类的 `public-api-external`（声明了的外部契约）。
- 残余假设写进产物头部：按计算名字做的反射（`"get" + field`）、不出现名字的构建期代码生成（注解处理器按签名挑方法——MapStruct 已用 `reflective` 与类字面量覆盖，未知处理器靠其注解未分类兜底）、代码里的类字面量交给仓库外方法后的反射调用、被选中源码集合之外的文件（选择账本可见）。

**D5：可能引用图的构造、可能覆写与可见性收窄。** 可能引用在遍历时按名字懒构造，不物化全部配对（hadoop 有 11 万 `calls-unresolved`、5 万 `calls-ambiguous`、8 万 `calls-caller-unresolved` 调用点）：以 (名字, 参数个数) 为键缓存候选列表。
- `calls-unresolved`：名字相同、参数个数适用（含可变参数，`argCount: null` 适用任意）的仓库内方法。
- `calls-ambiguous`：解析器报告模式给出的候选列表；没有候选列表时退回名字规则。
- `calls-generated`：接收者静态类型的仓库内子类型里名字相同、参数个数适用的声明——Lombok 生成的 `getStatus()` 可能被子类显式覆写，经父类型的调用会分派到它。解析器报告模式要给出接收者类型。
- `calls-external`：目标类型在仓库外，经它分派到仓库内方法的情形已由 `may-override-external` 覆盖（那些方法本来就是 `undetermined`），不再加可能引用。
- `calls-caller-unresolved`：调用方未知（匿名类、嵌套类型、枚举常量体、静态初始化块），其目标视为被未归属来源引用：进入 `undetermined` 的出发集合。解析器报告模式要给出已解析目标（有则用，没有则按名字）。
- 可能覆写配对（`override-uncertain`，D8）：同名、同参数个数、擦除签名不能确定的祖先 / 后代方法对，含继承来的实现。不是事实边（事实图不猜），在引擎里是双向的可能引用：祖先被任何东西到达 ⇒ 后代不能 dead（可能分派）；后代被到达 ⇒ 祖先不能 dead（声明依赖）。`COBBusinessStep<T>.execute(T)` 的 15 个实现因此至少是 `undetermined`，而不是 dead。
- 可见性收窄是精度的免费午餐：`private` 方法只能被同一编译单元引用（含其嵌套类与 lambda，都在同一文件），包私有方法只能被同一包引用（按 `qualifiedName` 的包名，不按目录——拆分包在仓库内是同一个包）。反射的例外由文本否决覆盖（全仓）。`protected` 不收窄。
- 备选：把 `calls-caller-unresolved` 归属到最外层方法（抽取器可以记录）。更精确，但要改抽取器与解析器两处，且基线里这类调用点在 Fineract 有 1.4 万个；先按来源处理，普查里报这类目标的数量，作为后续精度改进的依据。

**D6：文本出现否决——逐行计数、只排除三类位置、独立于解析器的判断。** 对所有未证明活的候选名字（构造器除外），一次扫描被选中源码集合（`source-manifest.json` 列出的文件，排除 `.excavator/`，按 NUL 字节跳过二进制并计数），整词、区分大小写，标识符按 `[A-Za-z_$][A-Za-z0-9_$]*` 切分，**逐行计数**。每行允许的次数 = 该行上以该名字声明的方法条目数 + 该行上被候选所在语言的适配器记账为「指向该候选」（解析边或可能引用）的调用点数；多余即否决，证据为第一处多余出现。三条刻意的严格：
- 按行计数而不是按行排除：`a.foo(); reflect("foo")` 在一行里，排除整行会把字面量藏掉。
- 只认指向该候选的调用点：解析到其它同名方法、`calls-external`、`calls-generated` 的调用点都不计入允许次数。它们的「不是这个方法」依赖解析器对仓库外的判断——两天前 Kotlin 类型被判成外部正是这个桶出的错。文本否决是独立的最后一道闸，不能建立在被它守护的判断上。代价是泛名字与 JDK 同名的方法几乎都被否决，它们本来大多已是 `undetermined`；普查报告「仅因解析器已另行解释的行而被否决」的候选数，让这笔代价可见。
- 只认候选所在语言的适配器记账的调用点：uneeg-managementportal 的 Kotlin 行带 16,001 个调用点，若把它们当成「已解释」，Kotlin 调 Java 的引用会从否决里漏掉、又从来没算成可能引用，正好得出假 dead。
注释与 Javadoc 里的出现也否决是有意的保守：代价是少量召回，收益是不需要为每种文件类型写解析器。

**D7：语言插件模型——引擎通用，每种语言三件套，build-free。** 引擎 `dead-code.mjs` 只认一种引用事实模型，不含任何语言分支：
- 节点事实：`{ id, language, kind: 'method' | 'constructor', abstract, visibility, dispatchable, scope: { file, package }, annotations, ownerAnnotations, ownerKind, outsideHierarchy（自身或任一继承了该方法的子类型触及仓库外）, builtinRoot, conventions: ['bean-accessor', ...] }`；
- 调用点事实：`{ kind: 'unresolved' | 'ambiguous' | 'generated' | 'unattributed', callerId | null, name, arity | null, candidates?, subtypeOf?, file, package, line }`；
- 可能覆写配对：`{ lower, upper, reason }`；
- 类字面量目标：`{ typeIds, context, file, line }`；
- 文本否决的记账：每个调用点事实带它指向的候选集合，供 D6 计算允许次数。
每种语言只提供：(a) 一个 build-free 的适配器 `skills/excavator/liveness/<lang>.mjs`，把结构结果与事实图（tree-sitter 级别的事实）投影成上面的模型；(b) 覆盖声明 `complete` / `none`；(c) 规则数据 `skills/excavator/liveness-catalog/<lang>.json`（内建根、注解与约定目录、哪些结构蕴含哪些可能引用、标识符模式）。语言表 `skills/excavator/liveness/index.mjs` 登记三件套；没有登记或覆盖为 `none` 的语言，其节点一律 `language-not-covered`。Java 适配器把 `java-call-resolution.mjs` 的报告模式（D13）翻译成调用点事实与可能覆写配对，把类条目与函数条目翻译成节点事实。新增一种语言 = 新增适配器 + 目录 + 覆盖声明 + 夹具，引擎与产物格式不动；规格里的「新增语言不改引擎」场景用一个只含合成事实的第二语言夹具验证。所有这些都不需要目标语言的编译器或运行时：事实只来自 tree-sitter 抽取与源码文本。

**D8：四个抽取前置先于任何判定。**
- 修饰符与注解进函数条目（`visibility`、`modifiers`、`annotations`）：没有它们分不出 `private`，D3 的「未声明即 `suspect`」会覆盖所有方法，一条 `dead` 也发不出；没有 `@Override` 做不了外部契约根。字段不进节点身份，Java 节点 ID 不变。
- 类字面量进文件条目（`classLiterals`，带 `annotation` / `code` 上下文）：D4 的类字面量规则与普查都靠它。
- 方法引用作为调用点：基线里 `PlatformCache::isEhcacheEnabled` 是确认的假阳性来源。`argCount: null`，解析按名字、任意参数个数，多个候选记 `calls-ambiguous`——歧义只降低精度，不破坏可靠性。数组构造引用 `int[]::new` 记 `calls-external`，否则「名为 `new`、接收者未知」会给所有构造器加可能引用。
- 层次边补齐：(1) `overrides` 边（具体 → 具体，含接口 `default` 方法在两侧）：基线 126 个无入边方法是具体覆写，它们经父类型的静态调用被分派到；(2) 继承来的实现：对每个具体类型 C，祖先的每个抽象方法 A 若 C 没有自己声明，取 C 父类链里最近的同名同参数个数具体声明 M（类优先于接口 `default`），签名确定即 `M → A` 的 `implements` 边，证据为 C 的父类型声明行；(3) 接口不再整体跳过，`default` 方法实现父接口抽象方法也连边；继承来的覆写（类优先：`class C extends B implements J {}` 里 `B.m()` 覆盖 `J` 的 `default m()`）同 (2) 的走法生成 `M → A` 的 `overrides` 边，否则经 `J` 的调用分派不到 `B.m()`；(4) 擦除签名不能确定（类型变量、嵌套或无法解析的类型、按需导入的外部类型）的同名同参数个数配对不再 `break` 丢弃，记可见缺口 `override-uncertain`，并由解析器报告模式交给引擎作可能覆写。事实图不猜边，但也不许静默丢。
- 判定模块读结构结果里的这些字段，不把它们投影到节点上：图谱只增加方法引用调用点产生的边、`overrides` 边、继承实现的 `implements` 边与 `override-uncertain` 缺口。

**D9：产物与计算位置——CLI 构建、按行存储、守恒 fail-closed；MCP 只读；不做增量。** `skills/excavator/dead-code.mjs` 是纯函数引擎加 CLI：输入图谱、结构结果、源码清单、声明与目录，经语言表选适配器，输出 `.excavator/dead-code.jsonl`（头部 + 每函数节点一条记录；读写都校验五桶守恒）。头部记录 `factsDigest`、声明摘要、目录摘要、快照身份、各语言覆盖声明、计数、按原因计数、普查、残余假设。复杂度：解析边可达性 O(V+E)；可能引用按名字懒构造；文本扫描对被选中源码集合单遍（Fineract 8,341 文件、96 MB），候选名字集合为所有未证明活的节点名。hadoop 要在默认堆下完成，用时单独报告，不计入 Lazy 的 30% 上限。
- 为什么不由 `sync_facts` 顺带算：判定依赖声明文件，而事实不该依赖声明；两者的新鲜度分开记（产物绑定 `factsDigest`，事实变了产物就过期）。
- 为什么 MCP 不算：文本扫描在 hadoop 上要几十秒；判定的前提（声明）是人确认的，构建应当在 skill 回路里发生。只用 MCP 的客户端需要先跑 CLI，这是明示的代价。

**D10：Surface——一个只读工具 `dead_code`，三种模式；不加有向 `traverse`，不加「按调用传根集合的可达性」。** `mode: 'census'`（头部与普查）、`'list'`（按判定过滤的分页列表）、`'verdict'`（≤20 个 node id 的记录；`live` 的路径按前驱重建返回）。`'verdict'` 本身就是有向的「谁引用了它」：记录里带解析入边与可能引用的来源。有向 `traverse` 是独立的检索改进，不是本能力的前提，放后续；按调用传根集合的可达性被 D3 否决（假设不可见）。输出有界：列表每页上限与 `truncated` / `nextOffset`，与 `recall` 相同形状。

**D11：skill 层只做判断题的提议与解释，不碰判定。** `skills/excavator-dead-code/SKILL.md`（英文散文）：(1) 确认事实新鲜（必要时 `sync_facts` / Lazy）；(2) 用 `dead_code census` 读 `suspect` 按路径的了结声明、未分类注解、外部父类型的计数，结合构建文件与依赖坐标（只读文本，不执行构建）提出 `.excavator-liveness.json`，每条带理由与证据；(3) 向人展示并确认后写入项目根目录（与 `.excavatorignore` 同样的流程）；(4) 运行 CLI；(5) 汇报：`dead` 簇按模块分组、`suspect` 按了结声明分组、`undetermined` 普查里收益最大的未声明项、残余假设。skill MUST NOT 改写任何判定，不把 `undetermined` 或 `suspect` 说成 dead。

**D12：先验装置，全部 build-free。**
- 夹具绊线 `tests/fixtures/liveness-java/`：每种引用形态一个只经该形态引用的已知活方法（方法引用、构造器引用、反射字面量、`@MethodSource`、注解根、无 `@Override` 的外部接口实现、带 `@Override` 的外部覆写、具体覆写经父类型调用、继承来的实现经接口调用、继承来的方法满足子类的外部接口、实现另一个类的嵌套接口、类型变量参数的实现、嵌套类型参数的覆写、按需导入类型参数的实现、匿名类内调用、lambda 内调用、静态初始化块内调用、Kotlin 文件调用、XML / properties / YAML 引用、注解实参里的类字面量、同一行里解析调用加字面量、解析到另一个同名方法的调用、数据类访问器、`main`、`readResolve`、`toString`、静态导入调用、同参数个数重载、泛名字 `run`、Lombok getter 被子类覆写）；外加已知 dead：A/B 对、孤岛环、从未调用的接口方法与其实现、名字只在声明处出现的私有方法；已知 `suspect`：零证据的公开方法及其私有被调用者。断言：活方法都不是 `dead` / `suspect`，dead 方法都是 `dead`，suspect 方法都是 `suspect` 且了结声明正确（装置能发出每个桶，不是只会绿）。
- 变异测试：去掉方法引用调用点并关闭文本否决后，方法引用绊线必须变 `dead`；去掉 `overrides` 边后具体覆写绊线必须变 `dead`；去掉 `override-uncertain` 配对后类型变量绊线必须变 `dead`；守恒测试制造一个漏桶变体必须变红。
- 夹具项目全链路变异（比纯引擎单测强：走真实的选择、抽取、解析与扫描路径）：测试在临时目录里生成 `tests/fixtures/liveness-java/` 的变体，只改源码文本、不构建——对每种引用形态各加一行引用某个已知 `dead` 方法（`::` 引用、反射字符串、`@MethodSource`、注解实参类字面量、一个 Kotlin 文件里的调用、一条 XML 条目），跑 Lazy 与 CLI，该方法必须离开 `dead`；反向，删掉某个已知 `live` 方法的唯一引用行，它必须变成 `dead` / `suspect` / `undetermined`。不复制、不改动任何真实语料：用户否决了「副本删除」类操作，真实语料只读。

**D13：解析器报告模式扩展。** `resolveFileCalls(row, { report: true })` 对每个调用点补充：`receiverType`（解析到的接收者静态类型，若有）、`candidates`（歧义时的候选 id）、`target`（`calls-caller-unresolved` 时已解析的目标 id，若有）；`hierarchyEdges()` 另返回 `uncertainPairs`（`override-uncertain` 的配对，含继承实现的配对）。非报告模式与现有调用方逐字节不变。

**D14：build-free 的落实。** 判定与验收里没有任何一步编译目标项目、调用目标语言的编译器或类型检查器、安装运行时或下载依赖。精度的门（见「验收」）全部是读源码、读文本、在夹具上改文本重跑这三类操作；真实语料只读。曾考虑的「副本删除再编译」oracle 被用户否决，且它本来也只能抓静态引用、抓不到反射；替代它的是夹具项目全链路变异（证明装置在真实抽取路径上看见每种形态）与独立代理按引用形态猎错（证明每条 `dead` 经得起人读）。Go 等后续语言同样走 tree-sitter 抽取路径，不摄取需要工具链的外部工具的输出。

## Risks / Trade-offs

- **[泛名字吞掉召回。]** `run`、`get`、`apply`、`now` 这类名字在文本否决与可能引用里几乎必然命中，这些方法永远是 `undetermined`。D6 不认解析到别处的调用点，让这一类更多。接受：它们也是反射与分派最常见的目标。缓解：普查报告按名字的可能引用扇出、文本否决命中的前 50 个名字，以及仅因解析器已另行解释的行而被否决的候选数。
- **[注解目录分类错误 ⇒ 假阳性。]** 把一个会引起方法调用的注解标成 `inert` 会让方法被误判。缓解：目录只收语义确定且带出处的条目；`inert` 只给「只生成成员」与「只引起实例化」两类（构造器本就不判 dead）；验收由独立代理逐条审阅目录；项目声明可以覆盖目录。
- **[构建期代码生成不出现名字。]** 注解处理器按签名选方法（MapStruct）、按接口生成实现（Dagger 等）。缓解：已知的标 `reflective`，`uses = X.class` 由类字面量规则覆盖；未知处理器的注解必然未分类 ⇒ `undetermined`；完全无注解的约定式生成是写明的残余假设。
- **[代码里的类字面量交给外部方法。]** `objectMapper.readValue(json, Foo.class)` 之类会反射调用 `Foo` 的访问器（已由 `bean-accessor` 覆盖）或 `@JsonCreator` 构造器（构造器不判 dead）；其它反射调用是写明的残余假设，数量进普查。
- **[按计算名字的反射。]** `getMethod("get" + name)` 不出现完整名字。写明的残余假设；D4 的访问器规则覆盖最常见的一类。
- **[测试范围声明错误。]** 把生产目录声明成测试会让其中方法都成为测试根（召回损失，不是假阳性）；漏声明测试目录时 `@Test` 方法按目录是生产根，于是只被测试使用的代码变成 `live`。两个方向都不产生假 `dead`。
- **[声明依赖让抽象方法「活着」。]** 实现活则接口方法活（D2），用户可能认为从未被调用的接口方法是 dead。代价是召回；记录里原因为声明依赖，可筛选。
- **[`argCount: null` 增加歧义。]** 方法引用对重载方法记 `calls-ambiguous`，候选全部成为可能引用。只降低召回。
- **[`may-override-external` 看子类型后覆盖面更大。]** 继承树上任何一个叶子触及仓库外，整条链上的方法都 `undetermined`（Fineract 的 `AbstractPersistableCustom` 即如此）。这是正确的：它们正是经 `Persistable` 等外部接口被调用的方法。
- **[hadoop 规模。]** 可能引用懒构造；文本扫描流式；候选名字集合可能上万。目标：默认堆下完成；用时报告。失败时按「上限就是绕过口」处理：改算法而不是调堆。
- **[嵌套类型的方法没有判定。]** 它们不是节点。普查头部报告 `calls-caller-unresolved` 的数量作为这部分的可见性；为嵌套类型建节点是独立的抽取变更。
- **[没有编译器做后盾。]** build-free 意味着没有任何一步能机械地证明「删掉后仍能编译」。替代是 D12 的三层装置与独立审读；残余假设明示在产物头部，`dead` 的保证只在这些假设下成立。
- **[固定摘要变红。]** Java 夹具因新增调用点、`overrides` 边、继承实现边与新缺口而变化，用生成器整块重冻；非 Java 夹具不应变化，变了即缺陷。
- **[Lazy 变慢。]** 方法引用调用点、类字面量与层次边补齐增加结构抽取与事实图的工作量。以 hadoop 同条件 A/B 计，用时增幅不超过 30%。

## Migration Plan

合入即生效。已有项目下一次 Lazy 或增量同步时，Java 文件的事实随结构变化重建；判定产物在首次运行 CLI 时产生，没有迁移步骤。没有 `.excavator-liveness.json` 的项目按「全部未声明」计算。回滚即 revert 本 PR；`.excavator/dead-code.jsonl` 成为无人读取的产物，下一次 Lazy 的产物清理照常处理。

## 后续（不在本变更内）

- 下一种语言的三件套（适配器、覆盖声明、规则数据），经同一条 build-free 抽取路径接入；不摄取需要工具链的外部工具输出。
- `calls-caller-unresolved` 归属到最外层方法。
- 类 / 文件级汇总，需要类型引用索引；之后构造器才可能进入 dead 范围。
- 有向 `traverse`。

## 验收

验收 oracle 在动手前写死，全部 build-free：不编译目标项目、不安装 JDK / Gradle / Go 等工具链、不下载依赖。改前指 main ca2eba01。「门」为必须通过的项，其余为报告项。

1. **装置先验（门）。** D12 的夹具绊线与夹具项目全链路变异全部通过；变异测试证明方法引用抽取、`overrides` 边、`override-uncertain` 配对、文本否决、守恒各自承重（关掉即红）；合成第二语言夹具证明引擎不改即可接入新语言。
2. **Fineract（f9c2fcd，用改后代码重跑 Lazy）。**
   - 无声明运行：五桶计数与守恒；`undetermined` 按原因的普查；`suspect` 按了结声明（路径）的普查；`dead` 列表（预期为几十个，集中在私有与包私有方法）。
   - 带声明运行：验收代理以人的身份写 `.excavator-liveness.json`（`fineract-client-feign/**` 为 `external`，其余 `internal`；`**/src/test/**`、`**/src/integrationTest/**` 为测试范围；目录之外需要补的注解分类逐条写理由），记录每条的依据；报告前后五桶计数，以及 `suspect` 中有多少变成 `dead`、多少变成 `undetermined`。
   - **独立审读（门）。** 独立代理（Opus，干净上下文，不接触本变更的推理）读源码：`dead` 判定 ≤100 条时全查，否则按可见性 × 所属类型种类 × 簇成员 × 模块分层抽 ≥60 条；对每条按清单猎错——方法引用、反射或字符串字面量、框架约定、注解实参类字面量、生成代码的输入、经子类型与继承实现的分派、其它语言——要求 0 条假阳性。另抽 30 条 `suspect` 核对「确无任何证据、了结声明正确」，30 条 `undetermined` 核对原因与证据位置，30 条 `live` 核对路径每一跳的证据行确有该调用。
   - **真实语料绊线（门）。** 以下已知活方法不得为 `dead` / `suspect`，报告各自的判定与原因：`PlatformCache.isEhcacheEnabled`（方法引用）；`CashierTransactionsWithSummaryData.getSumOutwardCash`（序列化访问器）；`BusinessDateUpdateHandler.fallback`、`AcmeLoanRepaymentScheduleTransactionProcessor.getCode`（具体覆写）；`COBBusinessStep` 的任一实现的 `execute(Loan)`（类型变量签名）；任一 `*ApiResource` 的 `@GET` 方法（注解根）；任一 `@MethodSource` 引用的测试数据方法（文本否决）；用确定性查询找出 Fineract 里 `class C extends Base implements I {}` 形态的继承实现（报告数量），若存在则任取一个核对。
   - **文本交叉核对（门）。** 对每个 `dead` 与 `suspect` 方法独立运行 `git grep -nw`，每一行的出现次数必须不超过该行允许的次数（声明 + 指向它的调用点）。
3. **cebreo/uneeg-managementportal（跨语言，门）。** 8 个 Java 文件里被 Kotlin 调用的方法不得为 `dead` / `suspect`（应为 `undetermined`，原因 `name-occurs-elsewhere`，证据指向 `.kt` 文件）；Kotlin 行的 16,001 个调用点不得计入任何 Java 候选的允许次数。
4. **wcp-auth、wcp-service-v2、cebreo/unmc（语言门，门）。** 所有函数节点 `undetermined`（`language-not-covered`），`dead` 与 `suspect` 为 0，守恒成立；三者的 factsDigest 与改前相同。
5. **hadoop（规模）。** Lazy 与 dead-code CLI 都在默认堆下完成；Lazy 用时同条件 A/B 增幅 ≤30%；dead-code CLI 用时、最大常驻内存、产物大小单独报告。
6. **MCP（门）。** `deploy/mcp-smoke.mjs` 扩到 8 个工具，对改后的 Fineract 全部通过；`dead_code` 的 `missing-product` 与 `stale-product` 终态各有一个用例。
7. **build-free（门）。** 验收记录证明整个过程没有调用 `javac` / `gradle` / `go` 等工具链、没有安装运行时、没有依赖下载；CLI 在没有 JDK 的环境里对 Fineract 产出与有 JDK 环境逐字节相同的产物。
8. **全量门。** 三件套、core 测试、typecheck、`check-refs`、`openspec validate --all --strict`、Python 测试。
