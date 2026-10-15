## Why

EJB 与 CDI 应用的依赖大多按类型注入：字段、构造器参数或 setter 上写 `@Inject`，或写一个不带名字的 `@EJB`，容器在部署里找声明类型的 bean 注入进来。今天事实层只认按名字的注入（`@EJB(beanName)`、`@Resource(name)` 等）。按类型的注入点在 `annotationInjections` 里落「无名字」桶，图里没有边，只能由 `javaee.md` 附录让模型逐个推断：

- 推断是逐个注入点的转写，范围大时成本高；
- 推断边是 `inferred`，不带证据，不能核对；
- 没有一份完整的注入点清单，也看不到哪些没解开、为什么。

候选集是普查：穷举仓库里声明类型的全部子类型和生产者，再看是否恰好一个。按 `skills/excavator/frameworks/README.md` 的三层规则，它属于确定性事实。

需求里另有一项：EJB 用 `@Local(Foo.class)`、`@Remote(Foo.class)` 声明 bean 的业务接口时，bean 类不必在 Java 里写 `implements Foo`。今天图里没有这条接口到实现的关系。

按本变更规则做的探针（正则近似，只作量级参考，主代码与测试合计；候选列只统计字段上的注入点）：

| 语料 | 按类型注入点 | `@Inject` | 不带名字的 `@EJB` | 在构造器或方法上 | 类型在仓库外 | 恰一个候选 | 多个候选 | 注入点上还有别的注解 |
|---|---|---|---|---|---|---|---|---|
| Dataverse | 1154 | 269 | 885 | 3 | 26 | 856 | 269 | 12 |
| TomEE 8.x examples | 228 | 150 | 78 | 0 | 62 | 98 | 68 | 20 |
| Cargo Tracker | 72 | 72 | 0 | 0 | 24 | 48 | 0 | 1 |
| DayTrader 8 | 58 | 56 | 2 | 12 | 12 | 20 | 14 | 19 |
| hadoop | 42 | 42 | 0 | 40 | 2 | 0 | 0 | 0 |
| Sakai `master` | 35 | 35 | 0 | 7 | 7 | 4 | 17 | 2 |
| DayTrader 7 | 20 | 17 | 3 | 0 | 7 | 5 | 8 | 1 |
| Seam 2.2 examples | 2 | 2 | 0 | 0 | 0 | 0 | 2 | 1 |
| OSCAR、fineract、JPetStore 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

另外两项探针：

- 带类字面量的 `@Local` / `@Remote` 只在 TomEE examples 出现 4 处，bean 类都同时写了 `implements`。仓库里没写 `implements` 的情形一处也没有，这部分只能靠夹具验证。
- 恰一个候选、声明类型是接口或抽象类的注入点里，有一部分的类型在代码里以类字面量出现（`Foo.class`）：
  - Cargo Tracker 38 个里有 24 个，都在测试的部署描述里；
  - TomEE examples 16 个里有 6 个，也都在测试里；
  - Sakai `master` 3 个里有 1 个，在主代码里按类型查找服务。

  按类型查找、Guice 的 `bind(Foo.class)`、动态代理与 mock 都这样写，这时实例可能不来自任何声明的类，静态看不见。

## What Changes

- **Core：Java 结构行补四项事实**（都是可选字段，旧读者不受影响）：
  - 顶层类型的修饰符（`classes[].modifiers`），用来认出抽象类；
  - 顶层以下的类型声明（`nestedTypes`）：成员类型、局部类型与匿名类，各带名字、行、所在顶层类型、修饰符与父类型；匿名类记 `new` 后面的类型；
  - 注解参数里的类字面量：每个参数值是类字面量或类字面量数组时，列出写出的类型与所在行；
  - 成员注解所附成员的声明类型（`memberAnnotations[].member.type`）：字段的类型、方法的返回类型。
- **按类型注入目录（数据）**：新文件 `skills/excavator/catalogs/type-injections.json`，版本 1。
  - 注入族：注解全限定名、可附着的成员种类、表示按名字或按 JNDI 名注入的参数、与注入注解同用并由按名字阶段解析的注解（Spring `@Qualifier`）、改写注入类型的参数。随附 `jsr330-inject`（`javax.inject.Inject`、`jakarta.inject.Inject`、`com.google.inject.Inject`）与 `ejb-inject`（`javax.ejb.EJB`、`jakarta.ejb.EJB`）。
  - 名字限定符（`@Named`）及带缺省名的构造型（`@Model`）。
  - 生产者注解（CDI `@Produces`、Guice 与 Dagger 的 `@Provides`、Spring `@Bean`）与提供者类型（`Provider<T>`、`FactoryBean<T>`）。
  - 让 bean 资格取决于部署的注解（`@Alternative`、`@Specializes`、`@Typed`、`@Vetoed`、`@Decorator`、`@Interceptor`）。
  - 注入点上已知不是限定符的注解。
  - 声明业务接口的注解（`@Local`、`@Remote`）。
  - 加载严格：未知键、缺字段、类型不符都让加载失败。
- **解析**（新模块 `type-injection-resolution.mjs`）：
  - 注入点：字段一个；方法或构造器的每个参数一个。
  - 候选是仓库里所有可能满足声明类型的东西：等于或传递继承声明类型的非抽象类与 `record`，返回该类型或其子类型的生产者方法与字段，提供该类型的提供者类。按擦除后的类型比较。
  - 候选集是可能注入对象的超集，所以恰好一个候选时，注入的就是它。超集可能不完整时一律不连边，落可见桶：
    - 子类型藏在嵌套、局部或匿名类型里；
    - 生产者写在嵌套类型里；
    - 某个父类型解析不出、名字又可能就是声明类型的类型；
    - 唯一候选的 bean 资格取决于部署；
    - 声明类型是接口或抽象类，又在代码里以类字面量出现。
  - 限定符：`@Named` 按 bean 名字筛候选；注入点上别的注解，除非目录列为已知不是限定符，都让注入点落「限定符未解」。
  - 每个注入点按顺序落入十六个桶之一，恰一个候选时成边。
- **业务接口**：顶层类上 `@Local(Foo.class)` / `@Remote(Foo.class)` 列出的仓库接口，在 Java 里还不是该类的父类型时：
  - 该类成为 `Foo` 及其父类型的按类型候选；
  - 生成类到 `Foo` 的 `implements` 边，证据为类字面量所在行。
- **边**：
  - 成边的注入点生成 `injects` 边，从消费者顶层类指向唯一候选：类节点，或生产者方法节点。
  - 与按名字注入、XML 注入的边合并，每个（消费者，目标）一条边，证据合并。
  - 证据含注入注解行、成员名行，筛过候选的 `@Named` 行，目标是生产者方法时还有生产者注解行。每条都带 `token` 与角色。
- **覆盖与缺口**：
  - 新增 `coverage.typeInjections`：每个族的注解数、注入点数、十六个桶、边数，未确认注解按写法的计数，「限定符未解」按注解写法的计数，以及业务接口一段。
  - 新缺口六类：
    - `type-injection-point-unresolved`
    - `type-injection-type-unresolved`
    - `type-injection-candidates-unresolved`
    - `type-injection-unbound`
    - `type-injection-ambiguous`
    - `business-interface-unresolved`
  - 守恒不平衡时构建失败。
- **附录**：`javaee.md` 把按类型注入与业务接口列入「已在事实图里」；原来让模型按候选推断的规则删去，改为 `type-injection-*` 缺口不猜。
- `PIPELINE_VERSION` 升到 `lazy-fact-graph/12`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fact-graph`：
  - 新增「Java 按类型注入点」；
  - 新增「EJB 注解声明的业务接口」；
  - 修改「injects 边的证据与遍历」：加入按类型注入的证据，三种来源合并成一条边。
- `javaee-framework`：修改「javaee 附录只作 guidance」：按类型注入与业务接口已是确定性事实，附录不再推断按类型注入。

## Impact

- **代码**：
  - Core：Java 抽取器与 `types.ts` 加四项可选事实，改完要重建 core dist；
  - skill 侧：
    - 新文件 `catalogs/type-injections.json`；
    - 新模块 `type-injection-catalog.mjs` 与 `type-injection-resolution.mjs`；
    - `java-call-resolution.mjs` 导出类型解析与类型层次的查询，供新阶段复用，不另写一套 Java 作用域规则；
    - 修改 `build-fact-graph.mjs`、`lazy-analyze.mjs`、`annotation-injection-resolution.mjs`（`injects` 边合并）；
    - 修改附录 `frameworks/javaee.md` 与 `frameworks/README.md`。
- **产物**：
  - 用到按类型注入的项目，图里多出 `injects` 边与 `type-injection-*` 缺口；用到 `@Local` / `@Remote` 类字面量的项目，可能多出 `implements` 边；
  - 所有项目的覆盖多出 `typeInjections` 一段；
  - 旧产物因版本号变化，在下次同步时整体重投影。
- **不影响**：
  - 既有节点、既有边及其证据；
  - 按名字注入的桶与缺口：不带名字的 `@EJB` 在那边仍落「无名字」；
  - source index；
  - MCP 工具的参数与形状。
- **拆出去的部分**：需求里「分层在测试里断言」一项，由紧随其后的独立变更处理。今天没有任何框架消费 `layerHints`，Lazy 图也没有分层。分层是节点角色，不是边，放进本变更会让它翻倍。
- **语料**：
  - 验收用 Dataverse、TomEE 8.x examples、Cargo Tracker、DayTrader 8、DayTrader 7、Sakai `master`、hadoop；
  - 回归用 Seam 2.2 examples、OSCAR、fineract、JPetStore 6 与两个私有语料；
  - 真实项目的源码、路径与输出不提交。
