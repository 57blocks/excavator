## Context

- Java 抽取器（`java-extractor.ts`）现状：
  - 只处理顶层类型。
  - 接口方法只记方法名，不进 `functions`。
  - 方法返回类型已抽取，但结构结果在透传时丢掉了。
  - 调用点只有 `{caller, callee, lineNumber}`，`callee` 是原样的调用文字。
- 事实图（`build-fact-graph.mjs`）：
  - 按调用文字原样，在调用方文件及其已解析的导入文件里按名字找声明，成员调用一律记缺口。
  - 规格要求它只投影 structure-all 与 import-map，不重新解析源码。
- 遍历（`retrieve.mjs`）只沿 `contains`、`imports`、`exports`、`calls` 四种边走，且不分方向。
- 基线：
  - Fineract 的数据见 proposal.md；
  - 统计脚本与验证样例在本地 `excavator-test-runs/java-call-baseline/`，不进仓库；
  - hadoop、wcp、cebreo 的改前产物同样存在那里。

## Goals / Non-Goals

**Goals:**
- Java 调用点按接收者的静态类型确定性解析，成边的每一条都能用源码里的声明证明。
- 每个 Java 调用点恰好落入一个去向（成边或五个桶之一）。
- 经接口或抽象方法的调用能通过遍历走到仓库内的实现。
- 非 Java 语言逐字节不变。

**Non-Goals:**
- 不抽取嵌套类型、匿名类、局部类；不推断 lambda 参数类型；不实例化泛型（`List<Loan>.get()` 的返回类型视为未知）。
- 不改 Full 流程 `annotate-graph.mjs` 的调用匹配。
- 不为具体方法之间的覆写连边，只连「具体方法 → 它实现的抽象方法」。
- 不按实参类型选重载，只按参数个数。

## Decisions

**D1：分工——抽取器绑定局部名字，事实图做跨文件的类型解析。** 作用域只有 AST 知道，所以局部变量、参数、for-each 变量、catch 参数、try-with-resources 变量、`instanceof` 模式变量的类型由抽取器在遍历方法体时按作用域栈绑定。字段、父类型、其它文件里的类型只有事实图能看全，所以跨文件解析放在事实图里一个新的纯函数模块 `java-call-resolution.mjs` 中。这样事实图仍然只读既有的抽取产物（structure-all、import-map 等），不重新解析源码。
- 备选：全部在抽取器里做。抽取器一次只看一个文件，拿不到其它文件的字段与父类型，所以不选。

**D2：接收者描述。** 每个 Java 调用点新增可选字段：
- `receiver`，取值为以下之一：
  - `{kind:'none'}`：裸调用 `m()`；
  - `{kind:'this'}`、`{kind:'super'}`；
  - `{kind:'local', type}`：局部绑定，`type` 为声明类型文本；`var` 声明且初始化为 `new X(...)` 时取 `X`，否则 `type: null`；
  - `{kind:'name', name}`：未被局部绑定的标识符，留给事实图判定是字段还是类名；
  - `{kind:'field', object, name}`：`a.b`、`this.b`，`object` 是同样形状的接收者描述；
  - `{kind:'call', site}`：链式调用中的前一个调用，`site` 是它在本文件调用列表里的下标。前一个调用本身也是调用点，用下标引用而不是把整条链嵌套展开，记录大小随链长线性增长；
  - `{kind:'new', type}`：`new X(...).m()`；
  - `{kind:'type', type}`：强制转换、字符串字面量为 `String`、类字面量为 `Class`；
  - `{kind:'construct', type}`：只用于对象创建调用点本身，`type` 是被构造的类型；
  - `{kind:'unknown'}`：数组元素、lambda 返回值、`X.super.m()` 等。
- `argCount`：本次调用的实参个数，不计注释。
- `enclosingType`：调用所在的顶层类型名；位于匿名类、局部类、枚举常量体或嵌套类型内时为 `null`。

类型文字指向局部类时，抽取器把它当作未知（`type: null` 或 `unknown`），因为事实图看不到局部类，按名字查只会查到同名的其它类型。模式变量（`instanceof`、`switch` 的类型模式与记录模式）只在声明它的那条语句内带类型；语句结束后仍绑定但类型为 `null`，这样后面同名的字段不会被误读成模式变量的类型。代价是「先判否后提前返回」写法里的模式变量解析不了，记入可见桶。

接收者描述的种类和字段是封闭集合，结构结果对它做校验；形状不对的调用列表整体判为失败，不会把需要猜测的输入交给事实图。

原有的 `callee` 文字不变，其它使用者不受影响。方法的返回类型以 `declaredReturnType` 进入结构结果，而不是 `returnType`：节点 ID 与源码索引读的是 `returnType`，带上它会改掉每个 Java 节点的 ID。

**D3：类型名解析顺序遵循 Java 规则。**
1. 单类型导入；
2. 同包类型；
3. 按需导入（`*`）；
4. `java.lang`。

全限定名在仓库类型表中即为仓库内；经导入或 `java.lang` 解析到仓库外则为外部；都找不到则为未知。同一个简单名在仓库内命中多个全限定名时视为有歧义。`java.lang` 用固定的公开类型名单。

仓库声明了、但本解析器不读的类型一律为未知，不得判为外部：
- 仓库内类型的成员类型；
- 仓库内 Kotlin、Scala 源码声明的类型。Java 可以直接使用它们，按目录定位：源码目录路径以包路径结尾，且该目录下的文件声明了这个类名（含 Kotlin 顶层声明编译成的 `文件名Kt` 类）。这样的包也算仓库内的包。

经单个或按需静态导入引入这些类型的成员时同样为未知。这一条是在 uneeg-managementportal 验收中发现的：它的 Java 文件调用 Kotlin 写的仓库类型（如 `UserRepository`），原先落进 `calls-external`，而规格要求该桶只收可证明在仓库外的目标。

**D4：方法查找与静态目标。** 在静态类型 T 及其仓库内父类型（先父类、后接口，逐层向上）中收集名字相同、参数个数适用（含可变参数）的声明。签名相同的只保留离 T 最近的那个（覆写）。最终恰好一个签名时，`calls` 边指向该声明，可以是接口方法或抽象方法；多于一个记 `calls-ambiguous`。

**D5：运行期分派用 `implements` 边表达，不猜 `calls` 边。** 规格要求 `calls` 只连唯一目标。为每个实现都连一条 `calls` 边（类层次分析）会违背这一点，并成倍放大边数，所以不选。改为：
- `calls` 连到静态目标；
- 具体方法用 `implements` 边连到它实现的抽象方法；
- 遍历不分方向，所以「调用方 → 接口方法 ← 实现方法」可以走通。

**D6：找不到声明时的分类顺序**（不生成边，只决定落哪个桶）：
1. 方法名与参数个数是 `Object` 的方法（`equals`、`hashCode`、`toString`、`getClass` 等）→ `calls-external`；
2. 方法是生成的 → `calls-generated`，包括：
   - 层次中某个仓库内类型声明了对应字段的 `get` / `is` / `set` 访问器（含 Lombok 对 `isX` 布尔字段生成的 `isX` / `setX`）；
   - 记录的分量访问器；
   - 类带 `@Builder` / `@SuperBuilder` 时的 `builder` / `toBuilder`；
   - 枚举的 `values` / `valueOf`；
3. 层次中有解析不了的父类型 → `calls-unresolved`：方法可能由它声明，不能断言在仓库外；
4. 层次中显式继承或实现了仓库外的类型，或类型是枚举（隐式继承 `java.lang.Enum`）→ `calls-external`；
5. 其余 → `calls-unresolved`。

生成方法的判断排在外部之前：Lombok 实体类常继承仓库外的基类，否则它的 getter 会被误标为外部。分类只影响缺口的归属，不产生边。

**D7：Java 的裸调用与 `this` 调用改用所在类型的层次解析，再查静态导入。** Java 的裸调用只可能指向所在类型、其父类型或静态导入，所以不再沿用「在导入文件里按名字匹配」的通用规则；该规则可能连到导入文件里同名但无关的方法。
- 所在类型的层次里声明了同名方法（任意参数个数）时只在层次中查找，静态导入被遮蔽；
- 否则先查单个静态导入，再查按需静态导入；
- 层次中有仓库外或解析不了的父类型时，它可能声明同名方法而遮蔽静态导入，所以静态导入的候选记 `calls-ambiguous`，不成边；按需静态导入里有仓库外的类型时同理，因为它的同名重载可能更具体。

未被局部绑定的名字按 Java 的规则依次当作字段、类型、包：字段在所在类型的层次中查找，再查静态导入的字段；层次中有仓库外或解析不了的父类型、而仓库内找不到这个名字时，它可能是继承来的字段、类型可能是泛型变量，记 `calls-unresolved` 而不是 `calls-external`。

`enclosingType` 为 `null`（匿名类、局部类、枚举常量体、嵌套类型）时，调用所在的方法不是抽取出来的声明，按 D8 记 `calls-caller-unresolved`，不连到外层类型的方法。

**D8：调用方归属。** 调用方必须是本文件中 `owner` 等于 `enclosingType`、名字相符、行范围包含调用行的那个函数，否则记 `calls-caller-unresolved`。这样可以避免嵌套类型里的方法因与外层方法同名而被错误归属。

**D9：`new X(...)`。**
- 按参数个数匹配 X 的构造器，恰好一个即成边，多于一个记 `calls-ambiguous`；
- 没有匹配的声明时，以下情况记 `calls-generated`：X 没有声明构造器且参数为 0 个（隐式默认构造器）；X 是记录（规范构造器）；X 带 Lombok 的构造器注解（`@NoArgsConstructor`、`@AllArgsConstructor`、`@RequiredArgsConstructor`、`@Data`、`@Value`、`@Builder`、`@SuperBuilder`）；其余记 `calls-unresolved`；
- X 在仓库外记 `calls-external`；
- 匿名类的创建 `new X(...) { ... }` 调用的是 X 的构造器，按同样规则处理。

**D10：类型层次边。**
- 类到类：父类型能解析到仓库内类型时才成边。类继承类、接口继承接口为 `inherits`，类实现接口为 `implements`。证据为类型声明行。
- 方法到方法：具体方法 M（属于类 C）同名、且擦除后参数类型相同地对应 C 的某个仓库内祖先类型中的抽象方法 A 时，生成 `M → A` 的 `implements`。比较参数类型时，按 D3 把类型名规范化为简单名并去掉泛型参数。

**D11：只对 Java 切换解析。** 新解析只作用于 `language === 'java'` 的行，抽取器改动只在 Java 抽取器里；其它语言走原有代码路径，投影逐字节不变。

**D12：遍历沿类型层次边走。** `retrieve.mjs` 的确定性边类型加入 `inherits`、`implements`。它们是从声明确定的事实边，符合 hybrid-retrieval「遍历优先用确定性边」的要求，规格不需要改。

## Risks / Trade-offs

- **[类型绑定错误产生错边。]** 例如作用域遮蔽，或嵌套类型与仓库内顶层类型同名。
  - 缓解：抽取器用作用域栈绑定；简单名有歧义时记缺口；嵌套类型内的调用不连外层。
  - 验收：独立代理抽查 50 条新边，读源码核实，要求 0 错。
- **[图谱变大、Lazy 变慢。]** 以 hadoop 为准实测，用时增幅不超过 30%。
- **[hadoop 撞上进程堆上限。]** 单字符串序列化上限已由 knowledge-graph-line-store（已合入）消除：图谱按行存储、事实摘要逐条计算。改后 hadoop 余量最高的一项是 `fingerprints.json` 的 14.53%（按字节），图谱最长一行只占 0.0027%，新增的边不再逼近这个上限。剩下的上限是 Node 默认堆（本机 4.05 GB）：line-store 合入后 hadoop 的 Lazy 最大常驻内存 3.22 GB，图谱解析后约占 1.28 GB 堆，而本变更会新增调用边、接口方法节点与类型层次边。处理：实现后在默认堆下（不设 `NODE_OPTIONS`）实测 hadoop；若堆溢出，不靠调大 `--max-old-space-size` 过关，而是先另开变更降低 Lazy 的峰值堆占用，该变更合入后本变更才合入。
- **[跨仓库边界的同参数个数重载。]** 仓库内类型声明 `m(A)`，它的仓库外父类型另有 `m(B)`，两者参数个数相同。我们看不到仓库外的声明，按 D4 只找到 `m(A)` 并成边；若实参使 `m(B)` 更具体，这条边就连错了。不按「层次含仓库外父类型就不成边」处理：Fineract 的实体与服务几乎都实现或继承了仓库外的类型（如 Spring 的 `Persistable`），那样会丢掉大部分可证明的边。
  - 缓解：只影响目标层次含仓库外父类型的边。验收报告这类边的数量，独立抽查时从中至少抽 20 条。
- **[仓库外父类型的成员遮蔽仓库内同名类型。]** 仓库外父类型继承来的成员类型或字段与仓库内某个类型同名时，Java 取继承来的成员，我们取仓库内的类型。只在名字恰好相同时发生，由抽查覆盖。
- **[身份冲突的节点不作端点。]** 两个声明映射到同一个节点 ID 时，连到这个 ID 的边可能连到另一个声明，所以调用方或目标是这类节点时不成边，分别记 `calls-caller-unresolved` 与 `calls-ambiguous`。
- **[缺口桶之间分错。]** 例如生成方法与外部方法分错。只影响缺口归属、不产生边，已在 D6 写明顺序。
- **[按目录找不到的其它 JVM 语言类型仍会判为外部。]** D3 靠「目录路径以包路径结尾」认出 Kotlin、Scala 类型。两种情况认不出：一是纯 Kotlin 模块省略公共根包的目录写法；二是 Groovy，它不按代码扫描。这两种情况下，Java 对这些类型的调用仍会落进 `calls-external`。混合 Java 的模块按 Kotlin 约定与 Java 同目录结构，所以覆盖了 Java 实际会调到的情形。要彻底解决，需要 Kotlin 抽取器输出包名，那会改动 Kotlin 投影，不在本变更范围内。
- **[接口方法成为节点后，节点数和 `methods-name-only` 缺口随之变化。]** 预期内，在验收里报告变化量。
- **[依赖旧结构的固定摘要变红。]** Java 夹具的固定摘要用生成器整块重冻；非 Java 夹具不应变化，变了即为缺陷。

## Migration Plan

合入即生效。已有项目下一次 Lazy 或增量同步时，Java 文件的事实随结构变化重建，不需要迁移步骤。回滚即 revert 本 PR。

## 验收

在本地对以下语料用改前与改后的代码各跑一次 Lazy，并报告。改前指 main c16d67b2（knowledge-graph-line-store 合入后）。line-store 保持了全部 6 个语料的 factsDigest 不变，所以在 main 19391644 上留存的改前产物仍可作为图谱内容的基线。性能基线取 line-store 合入后的实测：hadoop 118.6 秒、最大常驻 3.22 GB；Fineract 54.5 秒。

1. **Fineract（f9c2fcd）与 hadoop（2014707f8c31）：**
   - Java 调用点按去向分布（成边与五个桶），总和等于调用点总数；
   - 解析率的前后对比；
   - 贷款范围 157 个 API 入口出发可到达的文件数（改前 13 / 444）。
2. **旧调用边的去向：** 改前的每条 Java `calls` 边，改后要么仍在，要么被逐条解释（例如改为指向静态目标）。
3. **正确性：** 独立代理从 Fineract 的新边中随机抽 50 条，其中至少 20 条的目标层次含仓库外父类型（见 Risks），读源码核实目标就是接收者静态类型选中的声明；要求 0 错。同时报告目标层次含仓库外父类型的边数。
4. **非 Java 不变：** wcp-auth、wcp-service-v2、cebreo/unmc 的 factsDigest 前后相同；cebreo/uneeg-managementportal（含 8 个 Java 文件）的变化逐项解释。
5. **性能与上限：** hadoop 的 Lazy 必须在默认堆下成功；报告用时、最大常驻内存、图谱大小与各产物的序列化余量的前后对比。
6. **MCP：** 对改后的 Fineract 运行 `deploy/mcp-smoke.mjs`，7 个工具全部通过。

## 验收结果

2026-10-10 在本地实测。改后为本分支 c3b49985，改前为 main c16d67b2，两者都在默认堆下运行。以下各项分别对应上面「验收」的编号。

### 1. 调用点去向与可达性

| | Fineract 改前 | Fineract 改后 | hadoop 改前 | hadoop 改后 |
|---|---|---|---|---|
| Java 调用点 | 416,822 | 416,822 | 1,003,609 | 1,003,609 |
| 成边的调用点 | 36,041（8.65%） | 142,833（34.27%） | 70,448（7.02%） | 437,330（43.58%） |
| `calls-external` | — | 140,032 | — | 316,336 |
| `calls-generated` | — | 26,135 | — | 2,900 |
| `calls-ambiguous` | 16,750 | 13,970 | 25,011 | 53,365 |
| `calls-unresolved` | 363,287 | 79,895 | 905,613 | 112,560 |
| `calls-caller-unresolved` | 744 | 13,957 | 2,537 | 81,118 |
| `calls` 边（去重） | 23,229 | 98,836 | 52,509 | 316,542 |
| `methods-name-only` | 3,225 | 0 | 4,163 | 0 |
| 节点 / 边 | 66,993 / 174,249 | 70,218 / 262,918 | 150,368 / 474,437 | 154,531 / 767,818 |
| `inherits` / 类型 `implements` / 方法 `implements` | — | 1,579 / 1,307 / 3,726 | — | 4,448 / 1,710 / 14,864 |

- **守恒：** 四列的成边数与各桶之和都等于调用点总数。
- **一致性：** 用解析模块对改后的结构结果重新解析，得到的 `calls` 边与图谱逐条一致（缺 0、多 0），各桶计数也与图谱的缺口一致。
- **`calls-caller-unresolved` 上升的原因：** 旧规则只凭唯一名字归调用方，不看行号。现在按 D8 要求所在类型与行范围都对上。位于匿名类、局部类、枚举常量体和嵌套类型中的调用，都归入这个桶。
- **贷款范围可达性（Fineract，157 个 `*ApiResource` 入口）：** 接口方法成为节点后，范围内有函数的文件从 444 个增至 533 个。可达文件数：
  - 改前：13 个；
  - 改后只走 `calls`：83 个；
  - 改后走 `calls` 与 `implements`：397 个（可达函数 11,532 个）。

### 2. 旧调用边的去向

**Fineract 的 23,229 条旧边：** 23,091 条保留，138 条变化。
- **99 条 → `calls-generated`：** Lombok 生成的访问器，例如 `@Getter AbstractPersistableCustom` 的 `getId`。旧边按名字连到别的声明，例如把 0 参调用连到 1 参重载。旧边错。
- **17 条 → 指向另一个声明：** 例如 5 参调用现在指向父类的 5 参方法。旧边是连到本类 4 参方法的错误自环。
- **13 条 → `calls-ambiguous`：** 所在类实现仓库外接口（Spring Batch），调用经单个静态导入。按 D7，仓库外父类型可能声明同名方法遮蔽静态导入。旧边多半是对的，这是保守规则的召回代价。
- **6 条 → 指向新节点：** `LoanTransactionEnumData` 的裸调用 `isChargeAdjustment()` 等，现在连到它实现的仓库内接口方法。旧边连到一个无关的枚举。
- **2 条 → `calls-generated` 与 `calls-unresolved`：** 都是 `getId` 调用点。
- **1 条 → `calls-external`：** 调用的是 JUnit 静态导入的 `fail`，旧边连到 `FeignCalls#fail`。旧边错。

**hadoop 的 52,509 条旧边：** 50,079 条保留，2,430 条变化。
- **1,240 条 → 指向另一个声明：** 几乎都是裸调用。旧规则按名字匹配到导入文件里的同名方法，常常连参数个数都不对，例如 0 参 `getFileSystem()` 连到 `Path#getFileSystem(Configuration)`。新边指向所在类层次中的声明，例如 `AbstractFSContractTestBase#getFileSystem()`。旧边错。
- **824 条 → `calls-ambiguous`：** 全是裸调用，共 1,022 个调用点。其中 929 个经静态导入，而所在类的层次含仓库外或无法解析的父类型（D7）；93 个是仓库内层次中参数个数相同的重载（D4）。旧边多半是对的，这是不猜测的召回代价，全部在 `calls-ambiguous` 中可见。
- **162 条 → 没有对应的调用点：** 逐条核对 162 条，旧边的调用点全部在旧调用方的行范围之外。旧规则按唯一名字，把匿名类、枚举常量体中的调用归给了外层方法。旧边错。
- **154 条 → `calls-external`：** 例如 `FSInputStream` 中的 3 参 `read` 实为继承自仓库外的 `InputStream#read`，旧边是错误自环；再如 JUnit 静态导入的 `fail`、`Object#getClass`。旧边错。
- **14 条 → `calls-caller-unresolved`：** 调用位于匿名类内，例如 `PrivilegedExceptionAction`（D8）。
- **11 条 → 指向新的接口方法或抽象方法节点。**
- **10 条 → `calls-unresolved`：** 例如 `CACHE.closeAll()` 的接收者类型是嵌套类型 `FileSystem.Cache`，旧边是错误自环。
- **15 条 → 混合：** 同一条边的多个调用点分别落入上述类别。

### 3. 正确性

由独立代理（Opus）读 Fineract 源码，逐条核对目标是否就是接收者静态类型选中的声明，调用方是否正确。
- **随机样本：** 50 条新边，种子 20261010，其中 28 条的查找类型层次含仓库外父类型。结果 50/50 正确。
- **分层补抽：** 第一次抽查的代理指出随机样本偏易，于是补抽 36 条，与前 50 条不重叠。六类各 6 条：继承来的裸调用、经静态导入的裸调用、`super` 调用、链式接收者、目标为接口或抽象方法、构造器。结果 36/36 正确。
- **遮蔽规则的确定性核对：** Fineract 中 `FeignIntegrationTest` 自己声明了 `ok(...)`，它的子类里 46 处裸调用 `ok(...)` 全部连到继承来的 `FeignIntegrationTest#ok`。静态导入 `FeignCalls.ok` 的 154 个文件都不继承该类，其中 1,337 处调用连到 `FeignCalls#ok`。
- **样本的局限：** 两次抽查中，每个调用点按名字与参数个数过滤后都只剩一个候选。这是设计使然，同参数个数的多个候选不成边。跨仓库边界的同参数个数重载仍按 Risks 接受。
- **查找类型层次含仓库外父类型的边：**
  - Fineract：18,252 条（23,090 个调用点）；
  - hadoop：120,087 条（166,225 个调用点）。

### 4. 非 Java 不变，以及 uneeg-managementportal

wcp-auth（`cb6ea0b51a87`）、wcp-service-v2（`e1833975bf5d`）、cebreo/unmc（`b6f10267c77d`）的 factsDigest 前后相同。

uneeg-managementportal 的 factsDigest 从 `f22350702217` 变为 `7abaa14d274c`，节点 3,859 → 3,866，边 8,577 → 8,594，缺口条目 47 → 49：
- **+7 个节点：** MapStruct 接口 `ClientDetailsMapper` 的 7 个接口方法。
- **+17 条边：**
  - 这 7 个方法的文件 `contains` 与类 `contains` 各 7 条；
  - `ClientDetailsMapperDecorator` 到 `ClientDetailsMapper` 的 `implements` 1 条；
  - 方法级 `implements` 2 条。
  - 没有边被删除。
- **152 个 Java 调用点：** 改前全部是 `calls-unresolved`。改后：
  - `calls-external` 91 个；
  - `calls-unresolved` 58 个；
  - `calls-caller-unresolved` 2 个，位于嵌套类 `ProfileInfoVM` 内；
  - `calls-ambiguous` 1 个，`clientDetailsToClientDetailsDTO` 有两个 1 参重载。
  - 没有成边：被调用的都是 JDK、Spring、AspectJ 类型或 Kotlin 写的仓库类型。
- **缺口条目 +2：** 去掉 Java 的 `methods-name-only`，新增 Java 的 `calls-external`、`calls-ambiguous`、`calls-caller-unresolved`。
- **在本项验收中发现并修正：** Java 调用 Kotlin 写的仓库类型（如 `UserRepository`）原先落进 `calls-external`，已修正（c3b49985，见 D3）。修正后剩下的 91 个 `calls-external` 调用点已逐个核对，全部是 JDK、Spring、AspectJ、OAuth2 的类型。这次修正同样影响纯 Java 项目：经按需导入或静态导入引入的仓库内成员类型不再判为外部。Fineract 因此有 134 个、hadoop 有 151 个调用点从 `calls-external` 改记 `calls-unresolved`，边不变。

### 5. 性能与上限

- **hadoop 在默认堆下成功**（不设 `NODE_OPTIONS`）。
- **用时与内存（同条件 A/B）：** 同一台机器上改前、改后交替各跑两次。最终版本另跑一次，阶段耗时与 A/B 中的改后版本一致。

  | | 改前 | 改后 | 最终版本 |
  |---|---|---|---|
  | 用时 | 204.8 / 197.0 秒 | 213.0 / 208.7 秒 | 212.1 秒 |
  | 最大常驻内存 | 3.54 / 3.60 GB | 3.45 / 3.54 GB | 3.86 GB |
  | 峰值内存占用 | 4.21 / 4.13 GB | 3.80 / 3.81 GB | 4.10 GB |

  - 均值用时增幅 +5.0%。
  - 结构抽取约 62.6 → 83.6 秒（新增接收者与类型事实），事实图约 25.8 → 15.8 秒。
  - 内存在改前的波动范围之内。
- **30% 上限按同条件 A/B 判定（+5.0%，满足）：** 本机整体变慢，同一份改前代码现在要跑 197–205 秒，所以不能与 line-store 时的基线（118.6 秒）比绝对值。
- **Fineract：**

  | | 改前 | 改后 | 最终版本 |
  |---|---|---|---|
  | 用时 | 89.0 秒 | 97.1 秒（+9%） | 98.4 秒 |
  | 最大常驻内存 | 2.52 GB | 2.12 GB | 2.20 GB |
- **图谱大小（`knowledge-graph.jsonl`）：** 改前按紧凑记录估算。
  - hadoop：约 372 MB → 577 MB（+55%）；
  - Fineract：约 142 MB → 205 MB（+44%）。
- **序列化余量（相对 V8 单串上限 536,870,888 字符）：**
  - 最大的单串产物是 `fingerprints.json`，占 14.72%（改前 14.53%）。
  - 按行存储的产物，最长一行占比：
    - 图谱：14,282 字节（0.0027%）；
    - `source-index`：1.21 MB（0.23%）；
    - `structure-all`：0.99 MB（0.19%）。

### 6. MCP

对改后的 Fineract 运行 `deploy/mcp-smoke.mjs`，7 个工具全部 PASS。

### 全量门（任务 6.1）

在 HEAD c3b49985 上运行：`pnpm install --frozen-lockfile`、`pnpm -r build`、`pnpm --filter @excavator/core test`、`pnpm run typecheck`、`node scripts/check-refs.mjs`、`openspec validate --all --strict`、`pytest tests/skill` 全部通过。

`pnpm test` 跑了三次：
1. **第一次：** 1 个失败。`tests/deploy/e2e.test.mjs` 的墙钟超时用例在并发负载下返回状态 4 而非 3；单独跑 3/3 通过，本分支不改 `deploy/`。另有一个已知的 vitest RPC `onTaskUpdate` 超时。
2. **第二次：** 7 个文件超时，都在同一时段卡住约 340 秒，属于整机停顿。这 7 个文件单独重跑 286/286 通过。
3. **第三次：** 97/97 个文件、1,658 个用例通过，4 个跳过。

拆分时重建的中间提交 2b44cbbc，在另一个检出中跑三件套：97/97 个文件通过。

固定摘要：没有 Java 夹具的固定摘要发生变化，所以任务 5.1 无需重冻，提交序列中的第 5 步省略。
