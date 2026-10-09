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
  - `{kind:'field', object, name}`：`a.b`、`this.b`；
  - `{kind:'call', object, name, argCount}`：链式调用中的前一个调用；
  - `{kind:'new', type}`；
  - `{kind:'type', type}`：强制转换、字符串字面量为 `String`；
  - `{kind:'unknown'}`：数组元素、lambda 返回值等。
- `argCount`：本次调用的实参个数。
- `enclosingType`：调用所在的顶层类型名；位于匿名类、局部类、枚举常量体或嵌套类型内时为 `null`。

原有的 `callee` 文字不变，其它使用者不受影响。

**D3：类型名解析顺序遵循 Java 规则。**
1. 单类型导入；
2. 同包类型；
3. 按需导入（`*`）；
4. `java.lang`。

全限定名在仓库类型表中即为仓库内；经导入或 `java.lang` 解析到仓库外则为外部；都找不到则为未知。同一个简单名在仓库内命中多个全限定名时视为有歧义。`java.lang` 用固定的公开类型名单。

**D4：方法查找与静态目标。** 在静态类型 T 及其仓库内父类型（先父类、后接口，逐层向上）中收集名字相同、参数个数适用（含可变参数）的声明。签名相同的只保留离 T 最近的那个（覆写）。最终恰好一个签名时，`calls` 边指向该声明，可以是接口方法或抽象方法；多于一个记 `calls-ambiguous`。

**D5：运行期分派用 `implements` 边表达，不猜 `calls` 边。** 规格要求 `calls` 只连唯一目标。为每个实现都连一条 `calls` 边（类层次分析）会违背这一点，并成倍放大边数，所以不选。改为：
- `calls` 连到静态目标；
- 具体方法用 `implements` 边连到它实现的抽象方法；
- 遍历不分方向，所以「调用方 → 接口方法 ← 实现方法」可以走通。

**D6：找不到声明时的分类顺序**（不生成边，只决定落哪个桶）：
1. 方法名是 `Object` 的方法（`equals`、`hashCode`、`toString`、`getClass` 等）→ `calls-external`；
2. 方法是生成的 → `calls-generated`，包括：
   - 层次中某个仓库内类型声明了对应字段的 `get` / `is` / `set` 访问器；
   - 类带 `@Builder` / `@SuperBuilder` 时的 `builder` / `toBuilder`；
   - 枚举的 `values` / `valueOf`；
3. 层次中显式继承或实现了仓库外的类型 → `calls-external`；
4. 其余 → `calls-unresolved`。

生成方法的判断排在外部之前：Lombok 实体类常继承仓库外的基类，否则它的 getter 会被误标为外部。分类只影响缺口的归属，不产生边。

**D7：Java 的裸调用与 `this` 调用改用所在类型的层次解析，再查静态导入。** Java 的裸调用只可能指向所在类型、其父类型或静态导入，所以不再沿用「在导入文件里按名字匹配」的通用规则；该规则可能连到导入文件里同名但无关的方法。`enclosingType` 为 `null`（匿名类、局部类、枚举常量体、嵌套类型）时，裸调用、`this` 调用以及未绑定名字的接收者一律记 `calls-unresolved`，不连到外层类型的方法。

**D8：调用方归属。** 调用方必须是本文件中 `owner` 等于 `enclosingType`、名字相符、行范围包含调用行的那个函数，否则记 `calls-caller-unresolved`。这样可以避免嵌套类型里的方法因与外层方法同名而被错误归属。

**D9：`new X(...)`。**
- 按参数个数匹配 X 的构造器，恰好一个即成边；
- X 在仓库内但没有声明构造器、且参数为 0 个时，是隐式默认构造器，记 `calls-generated`；
- X 在仓库外记 `calls-external`。

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
- **[缺口桶之间分错。]** 例如生成方法与外部方法分错。只影响缺口归属、不产生边，已在 D6 写明顺序。
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
3. **正确性：** 独立代理从 Fineract 的新边中随机抽 50 条，读源码核实目标就是接收者静态类型选中的声明；要求 0 错。
4. **非 Java 不变：** wcp-auth、wcp-service-v2、cebreo/unmc 的 factsDigest 前后相同；cebreo/uneeg-managementportal（含 8 个 Java 文件）的变化逐项解释。
5. **性能与上限：** hadoop 的 Lazy 必须在默认堆下成功；报告用时、最大常驻内存、图谱大小与各产物的序列化余量的前后对比。
6. **MCP：** 对改后的 Fineract 运行 `deploy/mcp-smoke.mjs`，7 个工具全部通过。
