## MODIFIED Requirements

### Requirement: 支持的事实节点与事实边

事实节点 SHALL 至少覆盖 file、function/method（包括 Java 接口方法与抽象方法）、class/interface 等抽取器可靠支持的声明，以及可确定性识别的配置/路由等非代码节点。事实边 SHALL 至少覆盖 `contains`、`exports`、`imports`、**能唯一解析目标**的 `calls`，能从声明确定的类型层次边 `inherits` / `implements`，以及具体方法之间的覆写边 `overrides`。不能唯一解析的引用 MUST NOT 猜测，SHALL 写入 gap。每条事实边 SHALL 保留 provenance 与源码证据。

#### Scenario: 唯一可解 call 成边，不可解入 gap
- **WHEN** 一处调用能唯一解析到目标节点
- **THEN** 生成一条带 provenance/证据的 `calls` 边；无法唯一解析时改为记入 gap，而不生成猜测的边

### Requirement: Java 类型层次边

系统 SHALL 为能解析到仓库内类型的 `extends` / `implements` 生成类到类的边：类继承类、接口继承接口为 `inherits`，类实现接口为 `implements`。系统 SHALL 为具体方法（含接口的 `default` 方法）生成指向它所实现的仓库内抽象方法（接口方法或抽象方法，同名且擦除后参数类型相同）的 `implements` 边。对每个具体类型 C，其仓库内祖先的每个抽象方法 A，若 C 自身没有声明同名同参数个数的方法，SHALL 以 C 的父类链中最近的同名同参数个数具体声明 M（类的方法优先于接口 `default` 方法）为实现：擦除签名相同即生成 `M → A` 的 `implements` 边，证据为 C 的该父类型声明行。同名、同参数个数、但任一方擦除签名不能确定（类型变量、嵌套或无法解析的类型、按需导入的外部类型）的配对 MUST NOT 生成边，也 MUST NOT 静默丢弃：SHALL 记为可见缺口 `override-uncertain`（scope `java`，样例为两个声明）。`private`、`static` 方法与构造器不参与配对；包访问的方法只与同包的方法配对。这些边 SHALL 带声明行证据，SHALL 作为确定性事实边参与遍历。父类型在仓库外时 MUST NOT 生成边。

#### Scenario: 类实现接口
- **WHEN** 仓库内类 `PaymentServiceImpl implements PaymentService`，并实现了 `pay(long)`
- **THEN** 生成 `PaymentServiceImpl` 到 `PaymentService` 的 `implements` 边，以及 `PaymentServiceImpl#pay(long)` 到 `PaymentService#pay(long)` 的 `implements` 边

#### Scenario: 经接口的调用可遍历到实现
- **WHEN** 从调用 `PaymentService#pay(long)` 的方法出发做有界遍历
- **THEN** 遍历经 `calls` 与 `implements` 边到达 `PaymentServiceImpl#pay(long)`

#### Scenario: 仓库外父类型不成边
- **WHEN** 仓库内接口继承了仓库外的接口（例如 Spring 的 `JpaRepository`）
- **THEN** 不为该父类型生成边

#### Scenario: 继承来的实现
- **WHEN** `class C extends Base implements I {}`，`Base` 声明具体方法 `m()`，`I` 声明抽象方法 `m()`，两者擦除签名相同
- **THEN** 生成 `Base#m()` 到 `I#m()` 的 `implements` 边，证据为 `C` 声明 `implements I` 的那一行

#### Scenario: 接口 default 方法实现父接口的抽象方法
- **WHEN** 接口 `J extends I` 以 `default` 方法实现了 `I` 的抽象方法 `m()`
- **THEN** 生成 `J#m()` 到 `I#m()` 的 `implements` 边

#### Scenario: 擦除签名不确定的配对记缺口
- **WHEN** 接口 `COBBusinessStep<T>` 声明 `execute(T)`，`LoanStep implements COBBusinessStep<Loan>` 声明 `execute(Loan)`
- **THEN** 不生成 `implements` 边，记入 `override-uncertain` 缺口，样例为 `LoanStep#execute(Loan) ~ COBBusinessStep#execute(T)`

## ADDED Requirements

### Requirement: Java 方法引用作为调用点

Java 抽取器 SHALL 把方法引用表达式记录为调用点：`X::m`、`expr::m`、`this::m`、`super::m` 的被调用者为 `m`，`X::new` 为对 `X` 的构造调用；接收者描述与普通调用相同；实参个数记为未知（`argCount: null`）。事实图解析这类调用点时 SHALL 按名字在接收者类型层次中查找，参数个数未知视为适用任意个数：恰好一个声明成边，多个记 `calls-ambiguous`；数组类型的构造引用记 `calls-external`。这类调用点 SHALL 计入调用点总数并参与守恒。

#### Scenario: 类型限定的方法引用成边
- **WHEN** 源码出现 `PlatformCache::isEhcacheEnabled`，`PlatformCache` 是仓库内类且只声明了一个 `isEhcacheEnabled`
- **THEN** 生成从所在方法指向 `PlatformCache#isEhcacheEnabled()` 的 `calls` 边，证据为该行

#### Scenario: 重载的方法引用记歧义
- **WHEN** `Mapper::toData` 的 `toData` 在 `Mapper` 中有两个重载
- **THEN** 该调用点记入 `calls-ambiguous`，不生成边

#### Scenario: 构造器引用
- **WHEN** 源码出现 `LoanData::new`，`LoanData` 在仓库内且只声明了一个构造器
- **THEN** 生成指向该构造器的 `calls` 边；`int[]::new` 记入 `calls-external`

### Requirement: Java 方法体之外的调用点

Java 抽取器 SHALL 记录方法与构造器体之外的调用点——方法调用、方法引用与对象创建——包括字段初始化（含其中的 lambda）、静态与实例初始化块、枚举常量实参与 record 紧凑构造器体。这类调用点的调用者 SHALL 记为不可能是 Java 标识符的哨兵：静态上下文（`static` 字段、接口与注解类型的字段、静态初始化块、枚举常量实参）为 `<clinit>`，实例上下文为 `<init>`。哨兵 MUST NOT 匹配任何声明，这类调用点 SHALL 落入 `calls-caller-unresolved` 并计入守恒。已在方法体内的调用点（含字段初始化里匿名类的方法）保持原调用者。

#### Scenario: 静态字段初始化里的方法引用
- **WHEN** 顶层类 `CleanerUtil` 声明 `private static final BufferCleaner CLEANER = CleanerUtil::unmapHackImpl;`，`unmapHackImpl` 只在这里被引用
- **THEN** 该方法引用记为调用者 `<clinit>` 的调用点，落入 `calls-caller-unresolved`，不生成 `calls` 边

#### Scenario: 实例初始化与紧凑构造器
- **WHEN** 实例字段初始化 `private final List<X> xs = new ArrayList<>();` 与 record 紧凑构造器体里的 `validate(a)`
- **THEN** 两处都记为调用者 `<init>` 的调用点，计入 Java 调用点总数与守恒

### Requirement: Java 方法声明的修饰符、注解与类字面量

Java 抽取器 SHALL 为每个函数条目输出 `visibility`（`public` / `protected` / `package` / `private`；接口成员默认 `public`）、`modifiers`（`static`、`final`、`native`、`default`、`synchronized` 等关键字，源码顺序）与 `annotations`（方法注解名，源码顺序，去掉 `@` 与包前缀）。Java 抽取器 SHALL 为每个文件输出 `classLiterals`：文件里每个类字面量 `X.class` 的类型文本、行号与上下文（`annotation`：位于注解实参内；`code`：其它位置）。结构结果 SHALL 校验并透传这些字段。这些字段 MUST NOT 进入节点身份，非 Java 语言的结构结果 SHALL 保持不变。

#### Scenario: 带注解的公开方法
- **WHEN** 抽取 `@GET @Path("/x") public Response list()`
- **THEN** 函数条目带 `visibility: "public"`、`annotations: ["GET", "Path"]`；节点 ID 与本变更之前相同

#### Scenario: 包私有静态方法
- **WHEN** 抽取 `static void helper()`
- **THEN** 函数条目带 `visibility: "package"`、`modifiers: ["static"]`

#### Scenario: 注解实参里的类字面量
- **WHEN** 抽取 `@Mapper(uses = Helper.class) public interface LoanMapper {}` 与方法体里的 `LoggerFactory.getLogger(LoanMapper.class)`
- **THEN** 文件条目的 `classLiterals` 含 `{ type: "Helper", context: "annotation" }` 与 `{ type: "LoanMapper", context: "code" }`，各带行号

### Requirement: Java 具体方法覆写边

系统 SHALL 为仓库内的具体方法 M（含接口的 `default` 方法）生成指向它覆写的仓库内祖先类型中具体方法 A（同名、擦除后参数类型相同、A 非 `private` 非 `static`，包访问的 A 只与同包的 M 配对，含接口 `default` 方法）的 `overrides` 边，每条父类型路径上取离 M 最近的祖先声明。对每个类、枚举或 record 类型 C（含抽象类），其仓库内接口祖先的每个 `default` 方法 A，若 C 自身没有声明同名同参数个数的方法，SHALL 以 C 的父类链中最近的同名同参数个数具体类方法 M 为继承来的覆写（类优先于接口 `default`）：擦除签名相同即生成 `M → A` 的 `overrides` 边，证据为 C 引入 A 的那条父类型声明行；父类链中擦除签名相同的抽象重声明使 A 不被继承，不生成边。同名、同参数个数但任一方擦除签名不能确定的配对 MUST NOT 生成边，SHALL 记入 `override-uncertain` 缺口。边 SHALL 带 M 的声明行证据，SHALL 作为确定性事实边参与遍历。祖先在仓库外时 MUST NOT 生成边。

#### Scenario: 子类覆写父类的具体方法
- **WHEN** `Base` 声明具体方法 `fallback(Long, String)`，`Sub extends Base` 也声明了具体的 `fallback(Long, String)`
- **THEN** 生成 `Sub#fallback(Long,String)` 到 `Base#fallback(Long,String)` 的 `overrides` 边

#### Scenario: 类方法覆写接口 default 方法
- **WHEN** 接口 `I` 声明 `default void m()`，`class C implements I` 声明了具体的 `m()`
- **THEN** 生成 `C#m()` 到 `I#m()` 的 `overrides` 边

#### Scenario: 经父类型的调用可遍历到覆写
- **WHEN** 从调用 `Base#fallback(Long,String)` 的方法出发做有界遍历
- **THEN** 遍历经 `calls` 与 `overrides` 边到达 `Sub#fallback(Long,String)`

#### Scenario: 继承来的覆写（类优先）
- **WHEN** `class C extends B implements J {}`，`B` 声明具体方法 `m()`，`J` 声明 `default void m()`，`C` 自身不声明 `m()`
- **THEN** 生成 `B#m()` 到 `J#m()` 的 `overrides` 边，证据为 `C` 声明 `implements J` 的那一行；从调用 `J#m()` 的方法出发的遍历经 `calls` 与 `overrides` 到达 `B#m()`

#### Scenario: 参数类型为嵌套类型的覆写记缺口
- **WHEN** `Base` 声明 `handle(Outer.Event)`，`Sub extends Base` 声明 `handle(Outer.Event)`，`Outer.Event` 是解析器不读的成员类型
- **THEN** 不生成 `overrides` 边，记入 `override-uncertain` 缺口
