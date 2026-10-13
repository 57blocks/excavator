## Why

第 3 步（xml-injection-references）把 XML 里按名字的注入变成了 `injects` 边。同一类名字也写在 Java 注解里：

- Spring：`@Qualifier("orderDao")`、`@Resource(name = "orderDao")`，以及不写名字、按字段名或 setter 属性名注入的 `@Resource`；
- Seam：`@In`，名字缺省就是字段名；
- EJB：`@EJB(beanName = "OrderBean")`。

名字到类的绑定声明在别处：XML `<bean id>`、`@Service("orderDao")`、`@Name("orderDao")`、`@Stateless(name = "OrderBean")`。今天图里没有这些关系。一个只经注解按名字注入给别人的类，没有来自使用者的入边。

按本变更规则做的探针（正则近似，只作量级参考，主代码与测试合计）：

| 语料 | 注解注入点 | 管理单元内有绑定 | 容器不管理该类 | 不写名字（按类型注入） | 其余（他处、无绑定、表达式） |
|---|---|---|---|---|---|
| Seam 2.2 examples（`@In`） | 407 | 159 | 29 | 0 | 219 |
| OSCAR（`@Qualifier`、`@Resource`） | 8 | 7 | 1 | 0 | 0 |
| OpenMRS core | 24 | 6 | 11 | 0 | 7 |
| Sakai 12.7 | 28 | 3 | 22 | 1 | 2 |
| TomEE 8.x examples（`@Resource`、`@EJB`） | 169 | 0 | 85 | 78 | 6 |
| fineract（`@Qualifier`） | 49 | 1 | 18 | 9 | 21 |
| Dataverse（`@EJB`、`@Resource`） | 899 | 0 | 14 | 885 | 0 |

按 `skills/excavator/frameworks/README.md` 的三层规则：

- 按名字注入属于第三层，即确定性事实。名字写在一个文件里，绑定在另一个文件里，要用整个部署单元的完整绑定集才能判定唯一。
- 按类型注入（不写名字的 `@EJB`、`@Inject`、`@Autowired`）留在第二层：字段类型、`imports`、`calls` 与 `implements` 边已经能让模型读出依赖。

本变更只把这些按类型注入的点计数，不画边。

## What Changes

- **Core Java 抽取器**：记录类型体内成员上的注解，覆盖字段（每个声明符一条）、方法、构造器、方法与构造器参数、record 组件。
  - 每条注解记录：写法、行、参数（键、字符串字面量的值或非字面量标记、值所在行）。
  - 每条注解还记录它附着的成员：成员种类、名字与名字所在行，参数位置与参数名，所在顶层类型的简单名，以及是否位于嵌套、局部或匿名类型里。
  - 类型上的注解保持第 2 步的形状不变。
- **目录（数据）**：版本升到 3。
  - 新顶层 `annotationInjections`。每个注入族声明：
    - 命名空间；
    - 名字只在哪些绑定器的绑定里解析（可选）；
    - 消费者类必须由哪些绑定器管理（可选）；
    - 注入点列表。每个注入点声明：注解全限定名、可附着的成员种类、读名字的参数键、缺省名规则、名字缺省且没有绑定时容器是否退回按类型注入、表达式前缀。
  - 注解绑定器新增缺省名规则 `simple-name`（类的简单名原样）。
  - 新绑定器 `ejb-annotation-session`：`@Stateless`、`@Stateful`、`@Singleton` 的 `name`，命名空间 `ejb`。
  - `spring-annotation-stereotype` 补上同样经 `@Component` 元注解成为 bean、`value` 即 bean 名的 `@Configuration`、`@RestController`。
  - 新绑定器 `spring-annotation-advice`：`@ControllerAdvice`、`@RestControllerAdvice` 也是 bean，但 `value` 是扫描包，bean 名写在 `name`。
  - 随附三个注入族：
    - `spring-annotation-injection`：`@Qualifier`、`@Resource`；
    - `seam-annotation-injection`：`@In`；
    - `ejb-annotation-injection`：`@EJB`。
- **解析**：
  - 注解身份按第 2 步的 Java 作用域规则确认。消费者是成员所在的顶层类型的 class 节点。
  - 注入族要求管理时，名字在管理消费者类的那些部署单元里解析，也就是声明这个类为组件的 XML 或注解所在的单元；类没有被管理，就不解析，记入「不受管理」。注入族不要求管理时，在类文件所在的单元里解析。
  - 解析经第 3 步的同一张绑定表，结果落 15 个桶之一。
- **边**：
  - 目标唯一落到仓库类时，画 `injects` 边，从消费者类指向目标类，与 XML 注入共用边类型。
  - 同一对类由 XML 与注解都产生时合成一条边，证据合并。
  - 证据为注解参数或成员名所在的 Java 文件与行，加上：写出的 `token`、解析用的名字、注入点 id、管理消费者的绑定处、目标解析经过的绑定处。
- **覆盖与缺口**：
  - 新增 `coverage.annotationInjections`：每个注入点 id 的计数、15 个桶、未确认注解计数、位于嵌套类型里的注入点数。
  - 缺口复用第 3 步的五类 `injection-*`。两种来源一起做守恒。
- `PIPELINE_VERSION` 升到 `lazy-fact-graph/9`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fact-graph`：
  - 新增「Java 注解注入点」；
  - 修改「名字绑定」：目录增加注解注入族，注解绑定器有了新的缺省名规则；
  - 修改「injects 边的证据与遍历」：注解证据的形状，以及两种来源合成一条边。

## Impact

- **代码**：
  - Core：`packages/core/src/types.ts`、`packages/core/src/plugins/extractors/java-extractor.ts`、`java-annotation-arguments.ts`；
  - skill：
    - `extract-structure-result.mjs`（结构行透传与校验）；
    - `name-binding-catalog.mjs`、`catalogs/name-bindings.json`；
    - `name-reference-resolution.mjs`（注解身份确认抽成共用函数；绑定表提供「哪些绑定管理某个类」）；
    - 新模块 `annotation-injection-resolution.mjs`；
    - `xml-injection-resolution.mjs`（守恒改为两种来源合计）；
    - `build-fact-graph.mjs`、`lazy-analyze.mjs`。
- **产物**：
  - knowledge graph 新增注解来源的 `injects` 边与 `injection-*` 缺口，以及 `coverage.annotationInjections`；
  - 结构行多出 `memberAnnotations`；
  - `coverage.nameReferences.bindings` 与 `missingNames` 各多 `ejb-annotation-session`、`spring-annotation-advice` 两个键。
  - 旧产物因版本号变化，在下次同步时整体重投影。
- **不影响**：
  - 既有节点；
  - `mentions`、`references` 与 XML 来源 `injects` 证据的形状；
  - MCP 工具的参数与形状。
- **语料**：
  - 验收用 Seam 2.2 examples、OSCAR、OpenMRS core、Sakai 12.7、TomEE 8.x examples、fineract；
  - 回归用 Dataverse、Cargo Tracker、wcp、cebreo、hadoop。
  - 真实项目的源码、路径与输出不提交。
