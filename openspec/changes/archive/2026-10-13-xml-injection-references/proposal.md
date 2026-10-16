## Why

Spring XML 用名字装配依赖：`<property name="dao" ref="orderDao"/>` 把名为 `orderDao` 的 bean 注入到外层 `<bean>` 的类里。名字到类的绑定声明在别处：同一个或另一个 XML 文件的 `<bean id>`、`<alias>`，或者类上的 `@Service("orderDao")`。第 1 步（name-mention-facts）只认字面写出的类名，第 2 步（name-binding-references）只解析页面里的 EL 名字。所以「哪个类被注入了哪个 bean」在图里仍然缺失。一个只经 XML 装配给别人的 DAO 实现，依旧没有来自使用者的入边。

按本变更的规则做的探针（JS 近似实现，仅作量级参考）在四个语料上统计了 Spring XML 注入点：

| 语料 | 注入点 | 消费者与目标都落到仓库类 | 目标在其它单元 | 目标在仓库外 | 其余 |
|---|---|---|---|---|---|
| Sakai 12.7 | 3,740 | 1,359 | 1,845 | 286 | 250 |
| OSCAR | 179 | 128 | 0 | 30 | 21 |
| OpenMRS core | 48 | 12 | 0 | 1 | 35 |
| JPetStore 6 | 2 | 0 | 0 | 0 | 2 |

注入点按写法分：`property@ref` 2,138 个，`<ref bean>` 1,674 个，`lookup-method@bean` 112 个，`constructor-arg@ref` 38 个，其余少量。

按 `skills/excavator/frameworks/README.md` 的三层规则，这类关系属于第三层，即确定性事实：一个文件里写的字符串名字，由另一个文件的声明绑定。判断要用到整个部署单元的完整绑定集。要确认名字在单元里唯一，必须看到全部声明；只读一个文件的模型做不到。按名字猜就是编造。

第 2 步已经建好的机制直接复用：声明式目录、部署单元、绑定表、目标分类、可见桶与守恒。本变更只往目录里加数据（注入点声明、别名绑定器、定义继承与工厂方法的目标规则），在同一张绑定表上解析注入点。代码里不出现 Spring 的元素名或属性名。

## What Changes

- **目录（数据）**：版本升到 2。
  - 新增顶层 `xmlInjections`。每个注入族声明：根元素与根命名空间、注入点列表、消费者元素、消费者类按哪个绑定器的目标规则读，以及一份普查规则。
    - 注入点可以是元素加属性，也可以是属性命名空间加后缀；每个注入点声明名字的可见范围：单元、本文件，或静态不可见。
    - 普查规则列出哪些属性名、属性名后缀与元素算作「引用形状」。
  - XML 绑定器的 `rootNamespace` 允许 `null`，表示根元素没有声明命名空间（DTD 形式的 Spring 文件）。
  - XML 绑定器的 `target` 新增两个可选规则：
    - `unknownWhen`：元素带有所列属性之一时，目标未知。用于 Spring 的工厂方法与工厂 bean，这时 `class` 写的是工厂，不是 bean 的类。
    - `inheritFrom`：元素没有目标时，从该属性所名的同单元、同命名空间绑定继承目标。用于 Spring 只写 `parent` 的 bean 定义。
  - 目标种类新增 `name`：绑定把名字转给另一个名字，用于 Spring `<alias>`。
  - 随附条目：Spring 注入族 `spring-xml-injection`，共 11 个注入点；新绑定器 `spring-xml-alias`；`spring-xml-bean` 加根命名空间与上面两条目标规则。
- **绑定表**：绑定表保留所有名字。点分名或含其它字符的名字不再在建表时丢弃，改为在 EL 匹配时按第 2 步的规则过滤。所以第 2 步的 EL 匹配范围不变，`nonIdentifierNames` 仍是 EL 访问不到的绑定数（新绑定器 `spring-xml-alias` 读到的点分别名也计入），而 Sakai 这类用接口全限定名作 bean id 的 `ref` 能匹配上。绑定的目标在建表后统一解析一次，经过别名与定义继承，最后落到类、仓库外、未建索引、未知或歧义。EL 与注入读同一张表。
- **注入点读取**：对根元素命中注入族的 XML 文件，读出每个注入点的名字、行、可见范围，以及消费者：最近的、名为消费者元素的自身或祖先元素，及其按绑定器目标规则读出的类、继承名与未知原因。普查规则命中、却没有注入点读的引用形状，按「元素@属性」计数，例如 `idref`、`custom-filter@ref`。
- **解析与新边 `injects`**：注入点的名字在本单元、注入族命名空间的绑定里解析；可见范围为本文件时只看本文件；静态不可见时直接落桶。目标唯一落到仓库类、且消费者也唯一落到仓库类时，画一条 `injects` 边，从消费者类指向目标类。语义为定义级：目标是被绑定的定义声明的类（FactoryBean 不展开为其产物）。证据为注入点所在的 XML 行、名字、注入点 id、消费者行与解析经过的绑定处。`injects` 进入可遍历的确定性边集合，验证器按名字核对证据行。
- **覆盖与缺口**：新增 `coverage.injections`，含 14 个桶、普查未读计数与守恒断言。新增五类缺口：`injection-target-unresolved`、`injection-ambiguous`、`injection-elsewhere`、`injection-unbound`、`injection-consumer-unresolved`。
- **对第 2 步 EL 结果的修正**（同一张绑定表带来，验收逐条列出差异）：
  - 工厂方法定义的 Spring bean 不再绑定到工厂类，改为目标未知。这一条修的是错归属。
  - 只写 `parent` 的 bean 继承父定义的类。
  - `<alias>` 声明的别名可被解析。

  这些都只影响单元内声明了 Spring 桥接的 EL 根名。
- `PIPELINE_VERSION` 升到 `lazy-fact-graph/8`。
- **不在本变更内（后续步骤）**：
  - 注解注入点：`@Resource(name)`、`@Qualifier`、`@EJB(beanName)`、`@Inject @Named`、Seam `@In`、`@ManagedProperty`。这些需要 Core 记录字段与参数上的注解参数。
  - 按类型自动装配，即 `autowire` 属性与 `@Autowired`；这属于 addendum 一层。
  - 字符串查找：`getBean("x")`、`Component.getInstance("x")`、JNDI `lookup`。
  - 自定义命名空间元素声明的 bean，如 `<jdbc:embedded-database id>`、`<util:list id>`；被它们绑定的名字落「无绑定」。
  - 内部 bean 的按值注入，即 `<property><bean class=…/></property>`。类名已经有 `mentions` 边。
  - 抽象模板定义上的属性展开到子定义。探针中只有 2 处，计入消费者未解析。
  - `depends-on`、`factory-bean`、`parent` 本身成边。
  - 按模块依赖放开跨单元可见；Sakai 的 1,845 个「他处」等这一步。
  - Java EE / JSF 的识别配置与 addendum。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fact-graph`：新增「XML 注入点」「injects 边的证据与遍历」两项要求，并修改第 2 步的「名字绑定」要求：目录新字段、绑定表保留全部名字、目标经别名与继承解析、工厂方法目标未知。

## Impact

- **代码**：只改 skill 侧，不改 Core。
  - `skills/excavator/catalogs/name-bindings.json` 与 `name-binding-catalog.mjs`（新字段与校验）；
  - `xml-name-bindings.mjs`（注入点、消费者与普查读取，目标规则）；
  - `name-reference-sites.mjs`（收集注入点）；
  - `name-reference-resolution.mjs`（抽出共用的绑定表，目标解析经别名与继承；EL 匹配时过滤名字）；
  - 新模块 `xml-injection-resolution.mjs`；
  - `build-fact-graph.mjs`、`lazy-analyze.mjs`、`retrieve.mjs`、`validate-graph.mjs`。
- **产物**：knowledge graph 新增 `injects` 边、五类缺口与 `coverage.injections`；`coverage.nameReferences` 的 `bindings` 与 `missingNames` 各多一个 `spring-xml-alias` 键。旧产物因版本号变化，在下次同步时整体重投影。
- **不影响**：既有节点与边（含 `mentions`、`references` 的形状），以及 MCP 工具的参数与形状。
- **语料**：验收用 Sakai 12.7、OSCAR、OpenMRS core 的固定提交。第 2 步回归用 Dataverse、Sakai 12.7、Seam 2.2 examples、Cargo Tracker、TomEE 8.x examples，不回归用 go-multirepo、mixed-suite、hadoop、fineract。真实项目的源码、路径与输出不提交。
