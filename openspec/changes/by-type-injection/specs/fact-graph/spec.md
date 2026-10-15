## ADDED Requirements

### Requirement: Java 按类型注入点

系统 SHALL 按「按类型注入目录」，从 Java 类型成员上的注解读出按类型的注入点，为每个注入点求出候选集：恰好一个候选时生成一条 `injects` 边，否则落入一个可见桶。

输入来自 Core 的 Java 抽取：
- 成员上的注解，含所附成员的声明类型：字段的类型、方法的返回类型；
- 顶层类型：种类、修饰符、父类型、字段类型、类型上的注解；
- 顶层以下的类型声明（成员类型、局部类型、匿名类），各带所在的顶层类型、修饰符与父类型。匿名类的父类型是 `new` 后面写的类型；
- 方法与构造器：参数类型与返回类型；
- 每个类字面量，以及它写在注解参数里还是代码里；
- 注解参数里的类字面量，归属到所在的参数。

目录是数据，不是代码分支。目录声明：
- 注入族，每个族声明：
  - id 与一句依据说明；
  - 注入注解的全限定名；
  - 可附着的成员种类：字段、方法、构造器；
  - 是否读限定符；
  - 方法上的注解是否要求方法恰好一个参数；
  - 表示按名字注入的参数键、表示按 JNDI 名注入的参数键；
  - 表示按名字注入的另一个注解：注入点上写了它时，由「Java 注解注入点」按名字解析；
  - 改写注入类型的参数键，可为空；
- 名字限定符注解，以及带缺省名的构造型注解；
- 生产者注解；
- 提供者类型：类型参数就是它提供的类型；
- 让 bean 资格取决于部署的注解；
- 注入点上已知不是限定符的注解；
- 声明业务接口的注解（见「EJB 注解声明的业务接口」）。

目录出现未知键、缺少字段或类型不符时，加载 MUST 失败，不得带着部分目录运行。

注解的身份 SHALL 按「名字绑定」的 Java 作用域规则确认。写法与目录中某个注入注解的简单名相同、却没有确认的，SHALL 按写法计数，不是注入点。

注入点：
- 字段上的注入注解：一个注入点，类型为字段的声明类型；
- 方法或构造器上的注入注解：每个参数一个注入点，类型为参数的声明类型；
- 族声明了改写类型的参数、且写了它时，注入类型为该参数里的类字面量；
- 在下面第 1–5 个桶落定的方法或构造器注解，计一个注入点。

注入类型记为 T。候选集 SHALL 是仓库里所有可能满足 T 的声明，按擦除后的类型比较：
- 顶层的非抽象类与 `record`，等于 T 或传递地以 T 为父类型。父类型包括 Java 的 `extends`、`implements`，以及业务接口注解声明的仓库接口；
- 带生产者注解的顶层类型方法与字段：返回类型或字段类型等于 T，或是 T 的子类型；
- 顶层的非抽象类与 `record`：它自己或它的某个仓库祖先写出的父类型是目录里的提供者类型，其类型参数等于 T 或是 T 的子类型。

接口、注解类型、`enum` 与带 `abstract` 修饰符的类 MUST NOT 是候选：容器不实例化它们。枚举常量只能经生产者或程序化绑定提供，这两种另有规则。

只对读限定符的族，注入点上写了名字限定符时：
- 名字取字面量值；没写值或为空串时，字段取字段名，参数无法确定名字；
- 候选只保留 bean 名字等于该名字的：
  - 类：名字来自它的名字限定符注解，未写值时为简单名首字母小写；带缺省名的构造型时同样取缺省名；
  - 生产者方法：名字来自它的名字限定符，未写值时，`get` 或 `is` 开头的方法取 Java Beans 属性名，其它取方法名；
  - 生产者字段：未写值时取字段名；
  - 没有名字限定符、也没有带缺省名的构造型的类与生产者没有名字，被筛掉；
- 候选的名字限定符值不是字面量时，该候选保留；提供者类的 bean 名字无从得知，同样保留。

每个注入点 SHALL 按以下顺序恰好落入一个桶：

1. 写了表示按名字注入的参数且值不是空串，或注入点上有族列出的按名字注入注解且它写了不是空串的值（非字面量也算）：**按名字**，由「Java 注解注入点」解析，不算缺口。空串与不写相同；按名字注入注解没写值时不在此落桶，按其它注解进第 9 个桶；
2. 写了表示 JNDI 名的参数且值不是空串：**JNDI 名**；
3. 成员种类不在族的声明里，或族要求方法恰好一个参数（setter 注入）而方法不是：**位置不读**，不算缺口；
4. 成员在嵌套、局部或匿名类型里：**嵌套**；
5. 以下任一成立：**成员未建索引**：
   - 字段没有声明类型；
   - 所在顶层类型里，找不到名字与名字所在行都对应的方法或构造器声明；
   - 消费者顶层类型没有节点；
6. T 在仓库外、是基本类型或数组：**仓库外类型**，不算缺口；
7. T 是作用域里的类型变量：**类型变量**；
8. 以下任一成立：**类型无法确定**：
   - T 无法解析；
   - T 是嵌套类型；
   - T 的全限定名在仓库里声明了不止一次；
   - 改写类型的参数不是恰好一个类字面量；
9. 读限定符的族，注入点上有以下注解以外的注解，或名字限定符无法确定名字：**限定符未解**。不计的注解：
   - 注入注解；
   - 名字限定符；
   - 目录列为已知不是限定符的注解；
10. 候选集可能不完整：**隐藏候选**。以下任一成立即是：
    - 某个嵌套、局部或匿名类型的父类型等于 T 或是 T 的子类型；
    - 某个嵌套类型里的生产者，返回类型或字段类型等于 T 或是 T 的子类型；
    - 某个嵌套类型的父类型是提供者类型，类型参数等于 T 或是 T 的子类型；
    - 某个声明有解析不出的父类型（包括业务接口注解写的类型），其最后一段简单名等于 T 或 T 的某个仓库子类型的简单名；
    - 生产者的返回类型或字段类型解析不出，简单名同样相等；
    - 某个类经祖先成为提供者，而祖先写出的提供类型是类型变量：该类与它的祖先写出的父类型里，有类型参数的简单名同样相等；
    - 仓库里有 Kotlin 或 Scala 源文件声明了类型，且 T 不是 `final` 类：这些类型的父类型没有抽取，可能实现或继承 T；
11. T 是接口或抽象类，且仓库代码里以类字面量写出了 T，注解参数里的不算：**动态提供**；
12. 没有候选：**无候选**；
13. 两个或更多候选：**歧义**；
14. 唯一候选带有让 bean 资格取决于部署的注解：**部署决定**；
15. 唯一候选没有可指的节点（生产者字段、提供者类，或没有节点的声明）：**目标非节点**；
16. 其余：**成边**。

成边的注入点 SHALL 生成从消费者顶层类节点指向唯一候选节点的 `injects` 边：
- 候选是类时，指向它的类节点；
- 候选是生产者方法时，指向它的方法节点。

缺口：

| 缺口 | 对应的桶 |
|---|---|
| `type-injection-point-unresolved` | JNDI 名、嵌套、成员未建索引 |
| `type-injection-type-unresolved` | 类型变量、类型无法确定 |
| `type-injection-candidates-unresolved` | 限定符未解、隐藏候选、动态提供、部署决定、目标非节点 |
| `type-injection-unbound` | 无候选 |
| `type-injection-ambiguous` | 歧义 |

样例 SHALL 写出注入点的文件、行、消费者与成员名。歧义的样例列出候选。

为了成边，MUST NOT 放宽规则：
- 不只按简单名比较类型；
- 不在几个候选里取第一个；
- 不忽略落「限定符未解」的注解；
- 不把抽象类、接口或 `enum` 当候选。

`coverage.typeInjections` SHALL 给出：
- 运行状态；
- 每个族的注解数、注入点数、十六个桶的计数与边数；
- 未确认注解按写法的计数；
- 「限定符未解」按注解写法的计数；
- 业务接口一段（见「EJB 注解声明的业务接口」）。

守恒 SHALL 成立，不成立时构建 MUST 失败：
- 每个族十六个桶之和等于注入点数；
- 每个族成边的注入点数，等于该族证据里「注入」角色的条目数；
- 每类缺口的计数等于对应桶之和。

#### Scenario: 唯一实现成边
- **WHEN** 类 `com.acme.OrderController` 的字段写 `@Inject private OrderService service;`，接口 `com.acme.OrderService` 在仓库里只有一个实现 `com.acme.OrderServiceImpl`
- **THEN** 生成 `com.acme.OrderController` → `com.acme.OrderServiceImpl` 的 `injects` 边

#### Scenario: 间接实现也是候选
- **WHEN** 接口 `OrderService` 由 `BaseOrderService` 实现，`PremiumOrderService` 继承了 `BaseOrderService`，两者都不是抽象类
- **THEN** 字段 `@Inject OrderService service` 有两个候选，不生成边；落「歧义」，记 `type-injection-ambiguous`，样例列出两个候选

#### Scenario: 抽象类不是候选
- **WHEN** 接口 `OrderService` 由 `abstract class AbstractOrderService` 实现，`DefaultOrderService` 继承它
- **THEN** 字段 `@Inject OrderService service` 的唯一候选是 `DefaultOrderService`，生成到它的 `injects` 边

#### Scenario: 不带名字的 EJB 注入具体类
- **WHEN** 字段写 `@EJB private InvoiceBean invoices;`，`com.acme.InvoiceBean` 是没有子类的具体类
- **THEN** 生成声明该字段的类 → `com.acme.InvoiceBean` 的 `injects` 边

#### Scenario: 构造器的每个参数是一个注入点
- **WHEN** 构造器写 `@Inject OrderController(OrderService service, AuditLog log)`，两个类型在仓库里各只有一个候选
- **THEN** 生成两条 `injects` 边，注入点数计 2

#### Scenario: 生产者方法是候选
- **WHEN** 仓库里只有 `@Produces OrderRepository repository()` 能提供 `OrderRepository`
- **THEN** 字段 `@Inject OrderRepository repo` 生成指向该生产者方法节点的 `injects` 边

#### Scenario: 生产者与实现类同时存在
- **WHEN** `OrderRepository` 既有非抽象实现类 `JpaOrderRepository`，又有一个返回 `OrderRepository` 的生产者方法
- **THEN** 字段 `@Inject OrderRepository repo` 有两个候选，落「歧义」

#### Scenario: 名字限定符筛出唯一候选
- **WHEN** `PaymentService` 有两个实现，其中只有 `FastPayment` 带 `@Named("fast")`，字段写 `@Inject @Named("fast") PaymentService payment;`
- **THEN** 生成到 `FastPayment` 的 `injects` 边，证据含 `@Named` 所在行

#### Scenario: 未知限定符
- **WHEN** 字段写 `@Inject @RestClient PaymentService payment;`，`RestClient` 是仓库外的注解，目录没有把它列为已知不是限定符
- **THEN** 不生成边；落「限定符未解」，记 `type-injection-candidates-unresolved`，覆盖按写法给 `RestClient` 计 1

#### Scenario: EJB 族不读限定符
- **WHEN** 字段写 `@EJB @Deprecated private InvoiceBean invoices;`，`InvoiceBean` 只有一个候选
- **THEN** 生成 `injects` 边，`@Deprecated` 不影响解析

#### Scenario: 嵌套类型里的实现阻断成边
- **WHEN** `OrderService` 只有一个顶层实现 `OrderServiceImpl`，另一个顶层类里有静态嵌套类 `Mock implements OrderService`
- **THEN** 字段 `@Inject OrderService service` 不生成边；落「隐藏候选」

#### Scenario: 匿名类阻断成边
- **WHEN** `OrderService` 只有一个顶层实现，另一处代码写 `new OrderService() { ... }`
- **THEN** 字段 `@Inject OrderService service` 不生成边；落「隐藏候选」

#### Scenario: 代码里的类字面量阻断成边
- **WHEN** 接口 `OrderService` 只有一个实现，某个模块写 `bind(OrderService.class)`
- **THEN** 字段 `@Inject OrderService service` 不生成边；落「动态提供」

#### Scenario: 业务接口注解里的类字面量不阻断
- **WHEN** 接口 `OrderService` 的类字面量只出现在 `@Local(OrderService.class)` 里
- **THEN** 不因此落「动态提供」

#### Scenario: 唯一候选的资格取决于部署
- **WHEN** `OrderService` 唯一的实现带 `@Alternative`
- **THEN** 不生成边；落「部署决定」

#### Scenario: 仓库外的类型
- **WHEN** 字段写 `@Inject EntityManager em;`
- **THEN** 不生成边、不记缺口；落「仓库外类型」

#### Scenario: 带 beanName 的 EJB 不在此解析
- **WHEN** 字段写 `@EJB(beanName = "OrderBean") private Orders orders;`
- **THEN** 本阶段不生成边、不记缺口；落「按名字」

#### Scenario: 与 Spring Qualifier 同用
- **WHEN** 字段写 `@Inject @Qualifier("orderDao") private OrderDao dao;`，`Qualifier` 是 Spring 的注解
- **THEN** 本阶段不生成边、不记缺口；落「按名字」，不计入「限定符未解」

#### Scenario: JNDI 名
- **WHEN** 字段写 `@EJB(lookup = "java:global/app/OrderBean") private Orders orders;`
- **THEN** 不生成边；落「JNDI 名」，记 `type-injection-point-unresolved`

#### Scenario: 类型变量
- **WHEN** 泛型类 `Repository<T>` 的字段写 `@Inject private T delegate;`
- **THEN** 不生成边；落「类型变量」，记 `type-injection-type-unresolved`

#### Scenario: 同包同名的自定义注解不是注入点
- **WHEN** 仓库在类所在的包里声明了注解类型 `Inject`，字段写 `@Inject`，没有导入 `javax.inject.Inject`
- **THEN** 该注解不是注入点，不进任何桶

#### Scenario: 目录格式错误
- **WHEN** 按类型注入目录的某个族多出一个未知键
- **THEN** 加载失败，事实构建不带着部分目录运行

#### Scenario: 守恒不平衡时构建失败
- **WHEN** 解析结果某个族十六个桶之和不等于注入点数
- **THEN** 事实构建失败并报出不平衡的族

#### Scenario: 阶段未运行
- **WHEN** 事实构建没有按类型注入目录输入
- **THEN** `coverage.typeInjections` 的状态为 `not-run`，图里没有本阶段的边

### Requirement: EJB 注解声明的业务接口

系统 SHALL 读顶层类上经确认的业务接口注解（`@Local`、`@Remote` 等，由目录列出）。值参数里的每个类字面量是一个声明，SHALL 恰好落入一个桶：

1. 注解没写值参数：**未列类型**，按注解计一次，不算缺口；
2. 写了值参数，但其中没有类字面量：**不可读**，按注解计一次；
3. 类型在仓库外：**仓库外类型**，不算缺口；
4. 类型无法解析：**类型无法确定**；
5. 类型是仓库里的类、不是接口：**不是接口**，不算缺口；
6. 该类经 Java 的父类型已传递到达该接口：**已是父类型**，不算缺口；
7. 该类没有节点：**类未建索引**；
8. 其余：**声明**。

落「声明」的 SHALL 生成从该类指向该接口的 `implements` 边，`provenance: "extracted"`。证据为类字面量所在行，`token` 为写出的类型。

落「已是父类型」「类未建索引」与「声明」的接口，在「Java 按类型注入点」里 SHALL 算作该类的父类型。

MUST NOT 为业务接口生成方法级的 `implements` 边。

缺口 `business-interface-unresolved` 对应「不可读」「类型无法确定」与「类未建索引」。

`coverage.typeInjections.businessInterfaces` SHALL 给出注解数、声明数、八个桶的计数与边数。守恒：八个桶之和 SHALL 等于声明数，「声明」的数目 SHALL 等于本段生成的 `implements` 边数，不成立时构建 MUST 失败。

#### Scenario: 不写 implements 的业务接口
- **WHEN** 类 `com.acme.OrderBean` 带 `@Stateless @Local(OrderService.class)`，没有 `implements OrderService`，仓库里没有别的类实现 `OrderService`
- **THEN** 生成 `com.acme.OrderBean` → `com.acme.OrderService` 的 `implements` 边，证据行为类字面量所在行；字段 `@EJB OrderService orders` 生成到 `com.acme.OrderBean` 的 `injects` 边

#### Scenario: 已经实现的接口
- **WHEN** 类写 `@Local(OrderService.class) public class OrderBean implements OrderService`
- **THEN** 不生成新的 `implements` 边，落「已是父类型」

#### Scenario: 常量作参数
- **WHEN** 类写 `@Local(Interfaces.LOCAL)`
- **THEN** 不生成边；落「不可读」，记 `business-interface-unresolved`

#### Scenario: 业务接口在仓库外
- **WHEN** 类写 `@Remote(javax.management.MBeanServer.class)`
- **THEN** 不生成边、不记缺口；落「仓库外类型」

## MODIFIED Requirements

### Requirement: injects 边的证据与遍历

`injects` 边 SHALL 带 `provenance: "extracted"`。同一对（消费者，目标）只有一条边：XML 注入点、Java 注解注入点与 Java 按类型注入点中有几种成边，证据就合并几种，MUST NOT 丢失任何一方的证据。

XML 注入点每个成边一条证据，内容为：

- 注入点所在的 XML 文件与行；
- 名字（`token`）与注入点 id；
- 消费者元素所在行，以及消费者类经继承属性解析时经过的绑定处；
- 目标解析经过的全部绑定处：名字直接命中的绑定、别名所名的绑定与继承所名的绑定，每处给出文件、行与绑定器。

Java 注解注入点每个成边一条证据，内容为：

- 名字写出的 Java 文件与行：显式名字为参数值所在行，缺省名为成员名所在行；
- 该行上写出的文字（`token`）、解析用的名字与注入点 id。缺省名时 `token` 是成员名的原样写法，如 `setOrderDao`；
- 管理消费者类的绑定处；注入族不要求管理时为空；
- 目标解析经过的全部绑定处，同 XML 注入点。

Java 按类型注入点每个成边的注入点给出一组证据，每条带 `token` 与角色：

- 注入注解所在行：`token` 为注解的写法，角色「注入」，带族 id 与成员名；参数注入点另带参数序号；
- 成员名所在行：`token` 为成员名，角色「成员」，带写出的声明类型；参数注入点的成员是方法或构造器；
- 名字限定符筛过候选时，它所在行：`token` 为其写法，角色「限定符」，带名字；
- 目标是生产者方法时，生产者注解所在行：`token` 为其写法，角色「生产者」。

同一条边的证据按文件、行、`token`、注入点 id 或角色、成员与参数序号排序去重。图校验 SHALL 要求证据行包含 `token`。`injects` SHALL 属于可遍历的确定性边类型，可以从目标（类或生产者方法）沿入边找到被注入它的消费者类。

#### Scenario: 证据可复核
- **WHEN** 读 `injects` 边每条证据的文件与行
- **THEN** 该行含证据里的 `token`；证据里的每个绑定处与管理绑定处所在行，含该绑定声明的名字，或是产生缺省名的注解

#### Scenario: 从被注入的类遍历到消费者
- **WHEN** 从 `com.acme.OrderDaoImpl` 的 class 节点做 1 跳入边遍历
- **THEN** 结果包含经 `injects` 到达的 `com.acme.OrderServiceImpl`

#### Scenario: 证据行不含名字时校验报出
- **WHEN** 一条 `injects` 边的证据行号被改成不含 `token` 的行
- **THEN** 图校验对这条边报出证据不符

#### Scenario: 按类型证据可复核
- **WHEN** 读按类型注入点成边的每条证据的文件与行
- **THEN** 该行含证据里的 `token`；「注入」条目的 `token` 是一个经确认的注入注解的写法，「成员」条目的 `token` 是该成员的名字

#### Scenario: 按名字与按类型合成一条边
- **WHEN** 类 `com.acme.Checkout` 的一个字段写 `@EJB(beanName = "OrderBean") private Orders a;`，另一个字段写 `@EJB private OrderBean b;`，两者都解析到 `com.acme.OrderBean`
- **THEN** 只有一条 `com.acme.Checkout` → `com.acme.OrderBean` 的 `injects` 边，证据同时含按名字的条目与按类型的条目

#### Scenario: 两种来源合成一条边
- **WHEN** 同一单元的 Spring XML 写 `<bean id="orderService" class="com.acme.OrderService"><property name="dao" ref="orderDao"/></bean>`，`com.acme.OrderService` 的另一个字段又写 `@Resource(name = "orderDao")`，`orderDao` 绑定到仓库类 `com.acme.JdbcOrderDao`
- **THEN** 只有一条 `com.acme.OrderService` → `com.acme.JdbcOrderDao` 的 `injects` 边，证据同时含 XML 行与 Java 行

### Requirement: Java 注解注入点

系统 SHALL 按目录的注解注入族，从 Java 类型成员上的注解读出注入点，并把每个注入点解析成一条 `injects` 边或一个可见桶。注解来自 Core 对成员注解的抽取：

- 字段，每个声明符一条；
- 方法与构造器；
- 方法与构造器的参数；
- record 组件。

文件里任意深度的类型体都读，包括嵌套、局部与匿名类型。

注入族声明：

- 命名空间；
- 名字只在哪些绑定器的绑定里解析（可选）；
- 消费者类必须由哪些绑定器管理（可为空）；
- 注入点。每个注入点声明：
  - 注解全限定名；
  - 可附着的成员种类；
  - 读名字的参数键；
  - 缺省名规则；
  - 名字取缺省、又没有绑定时容器是否退回按类型注入；
  - 表达式前缀。

注解的身份 SHALL 按「名字绑定」的 Java 作用域规则确认。写法与目录中某个注入点注解的简单名相同、却没有确认的，SHALL 按写法计数，不是注入点。

注入点的名字 SHALL 按以下规则取：

- 第一个出现的名字参数是非空的字符串字面量时，名字为它的值，写出的行为参数值所在行；
- 没写名字参数或为空串时，按注入点的缺省名规则从成员推出，写出的行为成员名所在行：
  - 字段：字段名；
  - `set` 开头且长于 3 个字符的方法：去掉 `set` 后的部分，Java Beans 规则下前两个字符都大写时保持原样、否则首字母小写，Seam 规则下只把首字母小写；
  - 其它方法：Java Beans 规则取方法名，Seam 规则没有缺省名；
  - 参数、构造器与 record 组件：没有缺省名。

消费者 SHALL 是成员所在的顶层类型的 class 节点；嵌套、局部与匿名类型的成员归到顶层类型，并计数。

注入族声明了管理绑定器时：

- 只有当某个这类绑定解析到消费者类时，消费者才受管理；
- 名字 SHALL 在这些管理绑定所在的全部部署单元里解析；
- 消费者不受管理时 MUST NOT 解析名字。没有名字的组件定义（如匿名的 Spring `<bean class>`）不产生绑定，所以不使类受管理。

注入族没有声明管理绑定器时，名字在类文件所在的单元里解析。

每个注入点 SHALL 恰好落入一个桶，按以下顺序：

1. 成员种类不在注入点声明里：**位置不读**；
2. 名字参数不是字符串字面量：**名字非字面量**；
3. 没写名字、也没有缺省名：**无名字**，即按类型注入，不算缺口。其中 `@Inject` 与不带名字的 `@EJB` 由「Java 按类型注入点」解析；
4. 名字以表达式前缀开头：**表达式**；
5. 消费者类没有节点：**消费者未建索引**；
6. 消费者不受管理：**不受管理**，不算缺口；
7. 解析范围内、注入族命名空间里（声明了绑定器时只看这些绑定器）名字相等的绑定，按「名字绑定」解析后的目标归类，规则同 XML 注入点：成边、资源包、仓库外、目标未建索引、目标未知、歧义；
8. 没有这样的绑定时：
   - 名字取缺省、注入点声明退回按类型：**按类型**，不算缺口；
   - 解析范围以外有这个名字（别的单元、别的命名空间，或不在注入族所限绑定器里的绑定）：**他处**；
   - 否则：**无绑定**。

成边的注入点生成从消费者类节点指向目标类节点的 `injects` 边，与 XML 注入点共用边类型，每个（消费者类，目标类）一条。缺口复用 XML 注入点的五类：

| 缺口 | 对应的桶 |
|---|---|
| `injection-target-unresolved` | 名字非字面量、表达式、目标未建索引、目标未知 |
| `injection-ambiguous` | 歧义 |
| `injection-elsewhere` | 他处 |
| `injection-unbound` | 无绑定 |
| `injection-consumer-unresolved` | 消费者未建索引 |

样例 SHALL 写出注入点的文件、行与名字，歧义与他处的样例列出候选。MUST NOT 为了成边而放宽到解析范围以外的单元、其它命名空间、其它绑定器或第一个候选。

`coverage.annotationInjections` SHALL 给出：

- 运行状态；
- 按注入点 id 计的注入点数；
- 十五个桶的计数与注入点总数；
- 位于嵌套、局部或匿名类型里的注入点数；
- 未确认注解的计数。

十五个桶之和 SHALL 等于注入点总数。没有收到名字引用阶段的结果与目录时，覆盖记 `not-run`。

#### Scenario: Qualifier 字段成边
- **WHEN** 类 `com.acme.OrderService` 带 `@org.springframework.stereotype.Service`，字段写 `@Autowired @Qualifier("orderDao") private OrderDao dao;`，同单元 Spring XML 有 `<bean id="orderDao" class="com.acme.JdbcOrderDao"/>`
- **THEN** 生成 `com.acme.OrderService` → `com.acme.JdbcOrderDao` 的 `injects` 边，证据为 `"orderDao"` 所在行，`token` 与 `name` 都是 `orderDao`，管理绑定处为 `@Service` 所在行

#### Scenario: 构造器参数上的 Qualifier
- **WHEN** 受管理的类 `com.acme.Report` 的构造器写 `Report(@Qualifier("mainDs") DataSource ds)`，`mainDs` 在管理单元绑定到仓库类 `com.acme.MainDs`
- **THEN** 生成 `com.acme.Report` → `com.acme.MainDs` 的 `injects` 边，证据行为参数所在行

#### Scenario: Resource 字段的缺省名
- **WHEN** 受管理的类上写 `@Resource private OrderDao orderDao;`，管理单元有名为 `orderDao` 的绑定，目标为仓库类 `com.acme.JdbcOrderDao`
- **THEN** 生成到 `com.acme.JdbcOrderDao` 的 `injects` 边，证据行为字段名所在行，`token` 为 `orderDao`

#### Scenario: setter 上 Resource 的缺省名
- **WHEN** 受管理的类上写 `@Resource public void setOrderDao(OrderDao d)`，管理单元有 `orderDao` 绑定到仓库类
- **THEN** 解析的名字为 `orderDao`，证据的 `token` 为 `setOrderDao`

#### Scenario: Resource 缺省名退回按类型
- **WHEN** 受管理的类上写 `@Resource private Clock clock;`，管理单元与任何单元都没有名为 `clock` 的绑定
- **THEN** 不生成边、不记缺口；落「按类型」

#### Scenario: 不受 Spring 管理的类上的 Resource
- **WHEN** 类 `com.acme.OrderBean` 只带 `@javax.ejb.Stateless`，字段写 `@Resource(name = "jdbc/orders") private DataSource ds;`
- **THEN** 不解析名字，不生成边、不记缺口；落「不受管理」

#### Scenario: 由别的单元 XML 管理的类
- **WHEN** 单元 `core` 里的类 `com.acme.OrderService` 没有构造型注解，字段写 `@Resource(name = "orderDao")`；单元 `web` 的 Spring XML 写 `<bean id="orderService" class="com.acme.OrderService"/>` 与 `<bean id="orderDao" class="com.acme.JdbcOrderDao"/>`
- **THEN** 名字在单元 `web` 里解析，生成 `com.acme.OrderService` → `com.acme.JdbcOrderDao` 的 `injects` 边，管理绑定处为 `web` 里 `orderService` 定义所在行

#### Scenario: 方法上的 Qualifier 不读
- **WHEN** 受管理的类里写 `@Bean @Qualifier("primary") public DataSource ds()`
- **THEN** 不生成边、不记缺口；落「位置不读」

#### Scenario: Seam 缺省名成边
- **WHEN** 类 `com.acme.Checkout` 带 `@org.jboss.seam.annotations.Name("checkout")`，字段写 `@In private Cart cart;`，同单元类 `com.acme.Cart` 带 `@Name("cart")`
- **THEN** 生成 `com.acme.Checkout` → `com.acme.Cart` 的 `injects` 边，证据行为字段名所在行

#### Scenario: Seam 注入点不命中 JSF bean
- **WHEN** Seam 组件的字段写 `@In private Prefs prefs;`，同单元只有 `faces-config.xml` 声明了名为 `prefs` 的 managed bean，没有 Seam 组件叫 `prefs`
- **THEN** 不生成边；落「他处」，样例列出该 managed bean 的单元与命名空间

#### Scenario: Seam 表达式
- **WHEN** Seam 组件的字段写 `@In("#{preferences.get('wiki')}") private Object pref;`
- **THEN** 不生成边；落「表达式」，记缺口 `injection-target-unresolved`

#### Scenario: Seam 内置组件
- **WHEN** Seam 组件的字段写 `@In private FacesMessages facesMessages;`，仓库里没有名为 `facesMessages` 的绑定
- **THEN** 不生成边；落「无绑定」，记缺口 `injection-unbound`

#### Scenario: EJB beanName
- **WHEN** 字段写 `@EJB(beanName = "OrderBean") private Orders orders;`，同单元类 `com.acme.OrderBean` 带 `@javax.ejb.Stateless`、没有参数
- **THEN** 生成声明该字段的类 → `com.acme.OrderBean` 的 `injects` 边

#### Scenario: 按类型的 EJB
- **WHEN** 字段写 `@EJB private Orders orders;`，没有 `beanName`
- **THEN** 本阶段不生成边、不记缺口；落「无名字」，由「Java 按类型注入点」解析

#### Scenario: 非字面量的名字
- **WHEN** 受管理的类上写 `@Qualifier(Beans.ORDER_DAO) private OrderDao dao;`
- **THEN** 不生成边；落「名字非字面量」，记缺口 `injection-target-unresolved`

#### Scenario: 同包同名的自定义注解不是注入点
- **WHEN** 仓库在类所在的包里声明了注解类型 `Resource`，字段写 `@Resource(name = "x")`，没有导入 `javax.annotation.Resource`
- **THEN** 该注解不是注入点，不进任何桶

#### Scenario: 嵌套类型里的注入点
- **WHEN** 受管理的顶层类 `com.acme.Outer` 里的静态嵌套类的字段写 `@Resource(name = "orderDao")`
- **THEN** 消费者为 `com.acme.Outer` 的 class 节点，注入点计入嵌套计数
