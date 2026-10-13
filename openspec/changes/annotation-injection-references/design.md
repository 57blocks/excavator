## Context

- 第 2、3 步（name-binding-references、xml-injection-references，已归档）建立了以下基础，本变更全部沿用：
  - 声明式目录与严格加载器；
  - 部署单元；
  - 一张绑定表，目标解析一次，经别名、继承与工厂规则；
  - 目标分类：类节点、仓库外、未建索引、资源包、未知、歧义；
  - `injects` 边类型、五类 `injection-*` 缺口、守恒断言。
- 注解绑定今天只读顶层类型上的注解（`classes[].annotationArguments`）。注解身份按 Java 作用域规则确认：全限定写法、单类型导入、同包同名类型、恰好一个按需导入。
- Core 今天对成员的注解只记简单名（`functions[].annotations`），没有参数、没有行，字段与参数上的注解完全不记。嵌套类型不进 `classes`，也不抽取它们的成员。图里的类节点只有顶层类型；类名提及把 `Outer$Inner` 归到 `Outer` 的节点。
- `build-fact-graph.mjs` 的 `addEdge` 对同类型、同两端的第二条边直接丢弃。如果 XML 与注解对同一对类各产一条 `injects`，第二条的证据会静默丢失。
- 框架知识的分层见 `skills/excavator/frameworks/README.md`。按名字注入属于第三层，按类型注入属于第二层（addendum）。
- 探针：正则近似实现本设计，只作量级参考，不是 oracle。数字见 proposal。另外：
  - Seam 2.2 examples 的 407 个 `@In` 里，18 个写了名字，9 个是 EL 表达式，其余按字段名缺省。「无绑定」的主要是框架内置组件（`facesMessages` 20、`statusMessages` 13、`identity` 11）以及由 `@Out` / `@Factory` 产生的上下文变量（`currentUser`、`authenticatedMember`）。
  - TomEE 与 Dataverse 的 `@Resource` 都在 EJB / CDI 类上，指的是 JNDI 资源（数据源、队列），不是 bean 名。这些类没有被任何 Spring 绑定器管理。
  - Dataverse 的 885 个 `@EJB` 全部不写 `beanName`，按类型注入。
  - fineract 的 `@Qualifier` 多数指向 `@Bean` 方法声明的 bean，本步不读 `@Bean`。
  - 成员注解的量：hadoop 约 8.7 万处（其中 `@Override` 约 4 万），fineract 约 3.8 万，Sakai 12.7 约 1.1 万。

## Goals / Non-Goals

**Goals:**

- 按名字注入的 Java 注解注入点，得到一条带逐行证据的 `injects` 边：Spring 的 `@Qualifier` 与 `@Resource`，Seam 的 `@In`，EJB 的 `@EJB(beanName)`。证据能复核：名字所在行、管理消费者类的绑定处、目标解析经过的绑定处。
- 代码里不出现任何框架的注解名。注解、成员种类、缺省名规则与管理关系都写在目录数据里，每条带依据。
- 每个注入点落进一个可见桶，共十五种，由守恒保证。按类型注入、不受管理的类、写在不读位置上的注解，都有计数。
- XML 与注解两种来源共用 `injects` 边与缺口类型，同一对类只有一条边。

**Non-Goals:**

- 不解析按类型注入：不写名字的 `@EJB`、`@Inject`、`@Autowired`，以及 `@Resource` 缺省名在管理单元里没有绑定时的退路。它们计入「无名字」或「按类型」，不画边，留给 addendum。
- 不读成员上的绑定器：Spring `@Bean` 方法、CDI `@Produces @Named`、Seam `@Factory` 与 `@Out`。这些名字今天落「无绑定」或「他处」，可见。
- 不读注入点上的 CDI `@Named` 限定符。探针在七个语料上只见到 0–1 处，本步不为它写目录条目。
- 不读 `ejb-jar.xml` 的 `<ejb-name>`，也不读 `<ejb-ref>` / `<ejb-local-ref>`，留给 Java EE 描述符的后续步骤。只在 `ejb-jar.xml` 里声明名字的 EJB，其 `beanName` 注入落「无绑定」。
- 不解析 Seam `@In("#{…}")` 里的 EL 表达式，计入「表达式」，记缺口。
- 不为嵌套类型建节点。嵌套、局部、匿名类型成员上的注入点归到所在顶层类型的节点，与类名提及的做法一致，并单独计数。

## Decisions

**D0：为什么落代码，而不是交给 skill / prompt。**

- 与第 3 步相同：一个文件里的字符串名字由另一个文件的声明绑定。要确认名字在单元里唯一，需要完整的声明集，这是缺失判断，读一个文件的模型做不到。
- 还有一层判断模型也做不到：同一个 `@Resource(name = "x")`，在 Spring 管理的类上是 bean 名，在 EJB 上是 JNDI 名。判定「这个类由谁管理」要看整个仓库的组件声明。
- 名字的写法本身是结构化代码事实（注解参数），由确定性抽取原样产出。

**D1：Core 记录成员上的注解。**

`StructuralAnalysis` 新增 `memberAnnotations?: JavaMemberAnnotationUse[]`，只对 Java，按源码顺序：

```ts
interface JavaMemberAnnotationUse {
  name: string;            // 写法，如 `Resource` 或 `javax.annotation.Resource`
  line: number;            // 注解开始的行
  arguments: Array<{ key: string; value: string | null; line: number }>;
  on: "field" | "method" | "constructor" | "parameter" | "component";
  owner: string;           // 所在顶层类型的简单名
  nested: boolean;         // 直接所在的类型不是顶层类型（嵌套、局部或匿名）
  member: { name: string; line: number };
  parameter?: { name: string; index: number; line: number };
}
```

- **参数**：键与值的规则同第 2 步的 `annotationArguments`，即：
  - 单个无名参数的键为 `value`；
  - 字符串字面量记解码后的值，其它写法记 `null`；
  - 标记注解与空括号为 `[]`。

  每个参数多记一个 `line`，即值开始的行。注解跨行时，名字所在行由此可查。
- **附着位置**：
  - 字段：`field_declaration`，以及接口里的常量声明。每个声明符一条记录，`member` 是声明符的名字与名字所在行。同一注解附着几个声明符，就有几条记录。记录按注解排列：`@A @B int x, y;` 依次是 A-x、A-y、B-x、B-y，注解行因此不倒退。
  - 方法与构造器：`member` 是方法名或构造器名及其所在行。record 的紧凑构造器（`R { ... }`）也是构造器，`on: "constructor"`。
  - 参数：方法与构造器的 `formal_parameter`，以及可变参数 `...` 之前写的注解。记录：
    - `on: "parameter"`；
    - `member`：所在的方法或构造器；
    - `parameter`：参数名、从 0 起的位置、参数名所在行。
  - record 组件：`on: "component"`，`member` 是 record 本身，`parameter` 是组件。
- **范围**：文件里任意深度的类型体都要遍历，包括嵌套、局部与匿名类型，以及带类体的枚举常量（按匿名类型算）。
  - `owner` 永远是包含它的顶层类型的简单名。
  - `nested` 标出直接所在的类型是不是顶层类型。record 组件的 `nested` 取声明它的 record。
  - 顶层注解类型（`@interface`）里的常量与嵌套类型也记录，`owner` 为该注解类型的名字。
- **不记录**：类型上的注解（第 2 步已有）、局部变量、lambda 与 catch 参数、类型使用注解、receiver 参数、可变参数 `...` 之后的注解、枚举常量、注解类型的元素（`String value() default ""`）。这些位置上没有容器注入。
  - 写在 `modifiers` 里的注解在语法上分不出声明注解与类型使用注解，`@Foo List<String> m()` 按方法注解记录。写在类型内部的（`List<@Foo String>`、`throws @Foo X`）不在 `modifiers` 里，不记录。
- `functions[].annotations` 保持不变。dead-code-detection 等已有读者不受影响。
- `extract-structure-result.mjs` 透传 `memberAnnotations` 并校验形状。坏形状与其它 Java 事实字段走同一条路：该文件的结构结果判为失败，结构行落 `parse-failed`，带文件路径。
- 结构行的体积：每处成员注解约 150 字节，hadoop 约增加 13 MB。O5 报告 `structure-all.jsonl` 的体积变化。
- 结构抽取若有按内容缓存，缓存键要随抽取输出的形状变化而失效。coder 核对，并在 tasks 里写明结论。

**D2：注解身份的确认共用一处。**

把第 2 步注解绑定器里的身份确认抽成一个函数：输入为结构行与写法，输出为目录内全限定名、确认为非目录（含同包同名遮蔽）、或未确认。注解绑定器与注解注入点都调用它，规则不变。注入点注解里未确认的写法，按写法计入 `coverage.annotationInjections.unconfirmed`。

**D3：目录（版本 3）。**

- **注解绑定器的缺省名规则**新增 `simple-name`：类的简单名原样，用于 EJB。
- **新绑定器** `ejb-annotation-session`：
  - 命名空间 `ejb`；
  - 注解 `javax.ejb.Stateless`、`Stateful`、`Singleton` 及对应的 `jakarta.ejb.*`；
  - 名字参数 `name`，缺省名规则 `simple-name`，`namespacedNames: false`。
- **`spring-annotation-stereotype`** 补四个注解：
  - `org.springframework.context.annotation.Configuration`；
  - `org.springframework.web.bind.annotation.RestController`；
  - `org.springframework.web.bind.annotation.ControllerAdvice`；
  - `org.springframework.web.bind.annotation.RestControllerAdvice`。

  它们都以 `@Component` 为元注解，bean 名规则相同。依据写进 `basis`。
- **新顶层 `annotationInjections`**，每个注入族的字段：

  | 键 | 含义 |
  |---|---|
  | `id`、`namespace`、`basis` | 同其它条目 |
  | `binders` | 可选，绑定器 id 列表。给出时，名字只在这些绑定器的绑定里解析。每个 id 必须存在，且与注入族同命名空间。 |
  | `consumer.managedBy` | 绑定器 id 列表，可为空。非空时，消费者类必须是这些绑定器某个绑定的目标，见 D5。 |
  | `sites` | 注入点列表，至少一个 |

  每个注入点的字段：

  | 键 | 含义 |
  |---|---|
  | `id`、`basis` | `id` 在整个目录里唯一 |
  | `annotations` | 注解全限定名，至少一个 |
  | `on` | 读哪些成员种类，取 `field`、`method`、`constructor`、`parameter`、`component` 的非空子集 |
  | `nameArguments` | 读名字的参数键，按顺序取第一个出现的，可为空 |
  | `defaultName` | `null`，或缺省名规则 `member-java-beans` / `member-seam`，见 D4 |
  | `fallbackToType` | 布尔。名字取缺省、又在管理单元里没有绑定时，容器是否退回按类型注入 |
  | `expressionPrefix` | `null` 或字符串。名字以它开头时，是表达式，不是名字 |

- **随附条目**：

  | 注入族 | 命名空间 | `binders` | `managedBy` | 注入点 |
  |---|---|---|---|---|
  | `spring-annotation-injection` | `spring` | 不限 | `spring-xml-bean`、`spring-annotation-stereotype` | `spring-qualifier`：`org.springframework.beans.factory.annotation.Qualifier`，`on` 字段与参数，参数 `value`，无缺省名，不退回<br>`spring-resource`：`javax.annotation.Resource`、`jakarta.annotation.Resource`，`on` 字段与方法，参数 `name`，`member-java-beans`，退回按类型 |
  | `seam-annotation-injection` | `el` | `seam-annotation-name`、`seam-annotation-role`、`seam-xml-component` | 同 `binders` | `seam-in`：`org.jboss.seam.annotations.In`，`on` 字段与方法，参数 `value`，`member-seam`，不退回，表达式前缀 `#{` |
  | `ejb-annotation-injection` | `ejb` | 不限 | 空 | `ejb-bean-name`：`javax.ejb.EJB`、`jakarta.ejb.EJB`，`on` 字段与方法，参数 `beanName`，无缺省名，不退回 |

  - 方法上的 `@Qualifier` 不读：它在 `@Bean` 方法上声明的是 bean 的限定符，不是注入。写在方法上的会计入「位置不读」。
  - Seam 的 `binders` 限定是必要的：`el` 命名空间里还有 JSF、CDI 的名字，它们不是 Seam 组件。
  - EJB 不要求管理：Java EE 容器向所有组件注入 `@EJB`，包括 servlet、CDI bean 与 JSF bean，静态上没有可靠的「受管」判据。
- **加载校验**：
  - 未知键、缺键、类型不符，都拒绝加载；
  - 绑定器 id 引用不存在，或与注入族不同命名空间，也拒绝加载；
  - `on` 为空或含未知种类，拒绝加载；
  - `defaultName` 不是已知规则，拒绝加载。
  - 版本 2 的目录被拒绝。

**D4：读注入点。**

对每个 Java 结构行的每条 `memberAnnotations`，先按 D2 确认身份。身份是某个注入点的注解时，这条记录就是该注入点的一个**站点**。名字按以下规则取：

1. `nameArguments` 里第一个出现的参数：
   - 值为 `null`（非字面量）：名字不可读；
   - 值非空：名字为该值，写出的位置是参数的行；
   - 值为空串：同未写。
2. 未写名字时，按 `defaultName` 推出缺省名，写出的位置是成员名（或参数名）所在行：
   - `member-java-beans`：
     - 字段取字段名；
     - 方法名以 `set` 开头且长于 3 个字符时，取 `set` 之后的部分，按 `java-beans-decapitalize` 处理；
     - 其它方法取方法名。
   - `member-seam`：
     - 字段取字段名；
     - 方法名以 `set` 开头且长于 3 个字符时，取 `set` 之后的部分，首字母小写；
     - 其它方法没有缺省名。
   - 参数、构造器、record 组件都没有缺省名。

证据的 `token` 是写在那一行上的文字：显式名字时为名字本身，缺省名时为成员名的原样写法（如 `setOrderDao`）。`name` 是用来解析的名字。

**D5：消费者与解析范围。**

- 消费者是同一结构行里简单名为 `owner` 的顶层类型的 class 节点。找不到节点（如 `@interface` 的成员），或节点身份冲突，落「消费者未建索引」。
- 注入族的 `managedBy` 非空时：
  - 找出所有「管理」消费者类的绑定：绑定器在 `managedBy` 里，且按绑定表的目标解析落到的类节点就是消费者。例如 XML `<bean class>` 写了这个类，或类上有 `@Service`。
  - 一个都没有：落「不受管理」，不解析。
  - 有：名字在这些绑定所在的全部单元里解析。
  - 依据是容器只向它自己实例化的对象注入，而这个对象在哪个上下文里实例化，名字就在哪里查找。
- 注入族的 `managedBy` 为空时，名字在类文件所在的单元里解析。
- 命中的绑定：解析范围内的单元里、注入族命名空间里名字相等的绑定。`binders` 给出时，只保留这些绑定器的绑定。
- 绑定表新增一个查询：解析到某个类节点的全部绑定。它在表建好、目标解析完成后一次算出。

**D6：分桶（顺序即优先级）。**

1. **位置不读**（`position`）：成员种类不在注入点的 `on` 里。
2. **名字非字面量**（`nonLiteral`）：名字参数写了，但不是字符串字面量。
3. **无名字**（`unnamed`）：没写名字，这个位置也没有缺省名，即按类型注入。
4. **表达式**（`expression`）：名字以 `expressionPrefix` 开头。
5. **消费者未建索引**（`consumerUnindexed`）。
6. **不受管理**（`unmanaged`）。
7. 有命中的绑定时，按绑定表归类：
   - 同一个类节点：**成边**（`edge`）；
   - 资源包：`bundle`；
   - 仓库外：`external`；
   - 目标未建索引：`unindexed`；
   - 目标未知：`unknown`；
   - 其余：**歧义**（`ambiguous`）。
8. 没有命中的绑定时：
   - 名字是缺省名，且注入点 `fallbackToType`：**按类型**（`byType`）；
   - 别处有同名绑定（任何单元、任何命名空间）：**他处**（`elsewhere`）；
   - 否则：**无绑定**（`unbound`）。

共十五个桶。消费者先于目标判定：消费者在注解注入里就是声明它的类，不需要解析；管不管理决定了名字该在哪里查。

**D7：`injects` 边与证据。**

- 边同第 3 步：每个（消费者类，目标类）一条，`type: "injects"`，`provenance: "extracted"`，`weight` 0.5，自环照画。
- 注解来源的证据：
  ```
  { file, line, source: "lexical", token, name, site,
    consumer: { bindings: [{ file, line, binder }] },
    bindings: [{ file, line, binder }] }
  ```
  - `file` 与 `line`：Java 文件，以及名字写出的行（D4）。
  - `consumer.bindings`：管理消费者类的绑定处，按文件、行、绑定器排序去重；`managedBy` 为空的注入族为空列表。
  - `bindings`：目标解析经过的全部绑定处，同第 3 步。
- **两种来源合成一条边**：
  - XML 与注解对同一对类都成边时，只有一条 `injects` 边，证据是两者的并集，按文件、行、`token`、`site` 排序去重。
  - 合并在加入图之前完成，不依赖 `addEdge` 的去重。
- XML 来源的证据形状不变。
- `validate-graph.mjs` 对 `injects` 仍按证据的 `token` 核对。缺省名证据的 `token` 是成员名，正好写在那一行上。

**D8：覆盖、缺口与守恒。**

- `coverage.annotationInjections` 的字段：
  - `status`
  - `sites`：按注入点 id 计，每个 id 都列出，没有的记 0
  - `buckets`：十五个桶
  - `siteCount`
  - `nested`：位于嵌套、局部或匿名类型里的站点数
  - `unconfirmed`：注入点注解中未确认的写法，按写法计，键按字典序
- 缺口复用第 3 步的五类：

  | 缺口 | 注解来源的桶 | 样例中写出 |
  |---|---|---|
  | `injection-target-unresolved` | `nonLiteral`、`expression`、`unindexed`、`unknown` | 原因 |
  | `injection-ambiguous` | `ambiguous` | 候选 |
  | `injection-elsewhere` | `elsewhere` | 候选单元与命名空间 |
  | `injection-unbound` | `unbound` | — |
  | `injection-consumer-unresolved` | `consumerUnindexed` | 原因 |

  - 样例形式同第 3 步：`<文件>:<行> <名字> -> [<候选或原因>]`。注解来源的缺口 scope 为 `java`。
  - `position`、`unnamed`、`unmanaged`、`bundle`、`external`、`byType` 不是缺口：它们是正确的不成边。
- 守恒：
  - 十五个桶之和等于 `siteCount`；
  - 每类缺口回读的计数，等于 XML 来源对应桶之和加注解来源对应桶之和。
  - 任一不等，构建失败。
- 没有收到名字引用阶段的站点与目录时，`annotationInjections.status` 为 `not-run`，与 `injections` 相同。

**D9：阶段与接口。**

- 注解注入点来自结构行，不来自 `nameReferences` 阶段，所以不增加文件读取。
- 新模块 `annotation-injection-resolution.mjs` 的 `resolveAnnotationInjections({ javaRows, catalog, table, classIds, mutations })` 返回 `{ edges, gaps, coverage }`。
- `buildFactGraph` 的顺序：
  1. 在同一张绑定表上依次跑 EL、XML 注入、注解注入；
  2. 合并两种 `injects` 边；
  3. 记录缺口；
  4. 做三段守恒。
- `xml-injection-resolution.mjs` 的守恒函数改为接收两段覆盖。

**D10：版本。**

- `PIPELINE_VERSION` 升到 `lazy-fact-graph/9`，目录 `version` 升到 3。
- Core 的结构输出形状变化，按 D1 核对抽取缓存。
- 冻结摘要若受影响，用生成器整块重冻。

**D11：变异绊线（先验装置）。**

`mutations` 提供以下开关，每个都必须让至少一条测试变红：

- `annotationSimpleNames`：注入点注解只看简单名，不确认身份；
- `annotationIgnoreManaged`：不查管理关系，在类文件单元解析；
- `annotationIgnoreBinders`：忽略注入族的 `binders` 限定；
- `annotationNoFallback`：`byType` 并入「他处」或「无绑定」；
- `annotationTokenIsName`：缺省名证据的 `token` 写成解析用的名字；
- `noInjectsMerge`：两种来源的同一对类不合并，第二条被丢弃。

第 2、3 步的绊线保留，在共用的绑定表上重跑。

## 验收 Oracle（动手前写死）

语料都在 `excavator-test-repos/` 下，固定提交或固定快照；源码、路径、输出不提交：

| 语料 | 提交 | 用途 |
|---|---|---|
| Seam 2.2 examples | 同第 2 步验收的快照 | 注解注入主语料：`@In`，缺省名，表达式，`components.xml` 组件 |
| OSCAR | `0c61438fad7075bb8e17943e41f16caf85c7f52c` | Spring `@Qualifier` 与 `@Resource`，XML 与注解两种来源 |
| OpenMRS core | `142b13f4daa67fb2fd4cbb08e599d1d720ce062b` | `@Qualifier`，测试源上的注入点 |
| Sakai 12.7 | `5e75448885a8484fceea955509fc786bc99bfff4` | 跨模块管理，测试源 |
| TomEE 8.x examples | 同第 2 步验收的快照 | `@EJB(beanName)`；EJB 上的 `@Resource` 落「不受管理」 |
| fineract | `f9c2fcdc1c02bdad3b3387f1385391d9ececaea7` | Spring Java 配置，`@Qualifier` 指向 `@Bean` |
| Dataverse（`cc6e62e3354492ad1f4127adc64eb22445319b95`）、Cargo Tracker（`4d26b8fd59a7f0bac6e42d5d19a8cd1b379353b5`） | 固定检出 | 按类型的 `@EJB`、EE `@Resource` 不成边 |
| wcp、cebreo、hadoop（`2014707f8c31a620bffb4256d7f67245de5b94a3`） | 固定检出 | 不回归 |
| Sakai `master`（`10a1d904d379df3cb2371ee0e405a4c2d1060588`）、hadoop | 同上 | 耗时 |

- **O1 夹具与绊线**（coder 写，acceptor 审）：
  - 规格的每个场景一条测试。
  - Core 测试覆盖 D1 的每种位置，以及嵌套、局部、匿名类型，多声明符字段，跨行注解，非字面量参数，`@interface` 成员。
  - 新夹具 `tests/fixtures/annotation-injection/`，至少含：
    - 两个单元；一个 Spring 类由另一个单元的 XML 管理；
    - Spring 的 `@Qualifier`（字段、构造器参数、写在方法上）与 `@Resource`（显式名、字段缺省名、setter 缺省名、缺省名退回按类型）；
    - 由 `@Configuration` 管理的类；不受任何 Spring 绑定器管理的类上的 `@Resource`；
    - Seam 的 `@In`（缺省名、显式名、`#{…}` 表达式、指向 `components.xml` 组件、指向 JSF 同名 bean 而非 Seam 组件）；
    - `@EJB(beanName)` 指向 `@Stateless(name)` 与缺省名的 `@Stateless`；不写 `beanName` 的 `@EJB`；
    - 非字面量名字；同包自定义的同名注解；未确认的注解；嵌套类型里的注入点；
    - 同一对类由 XML 与注解都成边。
  - 断言精确的边列表、证据、十五个桶与计数。D11 的每个变异至少让一条测试变红。
- **O2 全量精度审计**（acceptor 独立实现，不复用被测代码）：
  - 对 Seam、OSCAR、OpenMRS core、Sakai 12.7、TomEE、fineract 每条注解来源 `injects` 证据：
    - 读快照中的 Java 行，要求含 `token`；
    - 由该行所在的成员与注解独立推出名字，要求等于 `name`；
    - 读每个绑定处与管理绑定处的行，要求含该绑定的名字或是产生缺省名的注解。
  - 按规格独立重算消费者类、管理单元与目标类，要求与边一致，不一致数必须为 0。XML 来源的证据与第 3 步一致。
  - 装置先验：往图谱副本里注入四种错，审计必须全部报出：
    - 一条错目标的边；
    - 一条错行号的证据；
    - 一条消费者不受管理的边；
    - 一条命中非注入族绑定器（Seam 注入点命中 JSF bean）的边。
- **O3 桶与计数对账**（acceptor 独立脚本）：
  - 每个语料的十五个桶、按注入点 id 的计数、`nested` 与 `unconfirmed`，都与独立重算逐项一致；
  - 站点数与独立的 Java 源码统计一致（同样遮蔽注释与字符串）。
- **O4 不回归**：Dataverse、Cargo Tracker、wcp、cebreo、hadoop 各自与同一检出、`lazy-fact-graph/8` 的基线对比：
  - 节点集合、全部边（含 XML 来源的 `injects` 及其证据）、既有缺口完全一致；
  - 覆盖只多 `annotationInjections` 一段，`nameReferences` 的 `bindings` 与 `missingNames` 各多一个 `ejb-annotation-session` 键；`bindings` 中 `spring-annotation-stereotype` 的计数可以因补充的四个注解而增加，增量要等于这四个注解在该语料上产生的绑定数；
  - 新增的注解来源边与缺口逐语料列出计数，每一个都说明来源。
- **O4b 前两步回归**：Seam、OSCAR、OpenMRS core、Sakai 12.7、TomEE、fineract 与 `/8` 基线对比：
  - 节点与非 `injects` 边一致；
  - XML 来源的 `injects` 证据一致；
  - `references` 与 `nameReferences` 的桶一致。
  - 差异只能来自两处，每处逐条列出：
    - 新绑定器 `ejb-annotation-session` 与补充的构造型注解让某个名字多了绑定，可能让 XML 注入点从「无绑定」变成「他处」，或改变 EL 结果；
    - 边合并让 XML 来源的边多出注解证据。
- **O5 耗时**：Sakai `master` 与 hadoop 的 Lazy 总耗时，与同一会话、同一提交新测的 `/8` 基线相比，增幅不超过 10%（各取 3 次中位数）。`structureAll` 与 `factGraph` 阶段单独报告，`structure-all.jsonl` 的体积变化单独报告。
- **O6 分层人工抽查**（acceptor，Seam、OSCAR、OpenMRS core、TomEE、fineract）：
  - 成边：每个注入点 id 随机 10 条，不足全抽；
  - 以下层全抽，每层上限 30：缺省名（字段与 setter）、由别的单元 XML 管理的消费者、嵌套类型里的注入点、合并了两种来源的边；
  - 每类缺口随机 20 条样例；随机 20 条「不受管理」、20 条「按类型」、20 条「无绑定」，查有没有本该成边的，以及有没有本该不受管理却成边的；
  - 编造计数必须为 0。漏边单独计数并归因。
- **预先承诺的退路**（抽查发现编造时直接执行，不再讨论）：
  - **F1**：编造来自跨单元管理，即消费者被另一个单元的 XML 管理、名字在那个单元解析错了：注入族 `managedBy` 只认与类文件同单元的管理绑定，别的单元管理的落新桶 `managedElsewhere`，记为 `injection-elsewhere` 缺口。
  - **F2**：编造来自 Seam 注入点命中了 `components.xml` 里只做配置、不声明类的组件：`seam-annotation-injection` 的 `binders` 去掉 `seam-xml-component`。
  - **其它来源**：先改源头，并补一条先红后绿的夹具测试，再重跑 O2 与 O6。
- **O7 真实 MCP**：对 Seam 2.2 examples 起 stdio MCP，调用全部工具：
  - 从一个只经 `@In` 注入的 Seam 组件类做 1 跳入边遍历，经 `injects` 到达注入它的类；
  - `read_evidence` 对该边返回 Java 原行；
  - `project_status` 报出 `annotationInjections` 覆盖与注入缺口；
  - `recall` 不受影响。
- **O8 全量门**（我跑）：
  - 三件套；
  - core 测试与 typecheck；
  - `openspec validate --all --strict`；
  - `node scripts/check-refs.mjs`；
  - core dist 重建后，skill 测试在新 dist 上通过。

## Risks / Trade-offs

- **「管理」的判定只认目录里的绑定器。**
  - 只经 `@Bean` 方法、`<context:component-scan>` 加自定义过滤器、`@Import` 或 Spring Boot 自动配置注册的类，落「不受管理」，它们的注入点不解析。这是漏，不是编造，桶里可见。
  - 反过来，一个带 `@Service` 却不在任何扫描范围内的类会被当作受管理。与第 3 步的风险相同，O6 抽查「由构造型管理」的成边。
- **匿名组件定义不使类受管理。** 匿名的 Spring `<bean class>` 没有名字，不产生绑定（第 2 步的规则），所以它的类落「不受管理」。Spring 实际会为它生成名字并注入。这是漏，可见；第 3 步验收已记下匿名 bean 的类名别名是后续项。
- **跨单元管理。** 消费者类在 jar 模块，管理它的 XML 在 war 模块时，名字在 war 模块解析。这符合 Spring 在哪个上下文实例化就在哪里查找的语义，但也让解析范围跨出类文件所在的单元。F1 兜底。
- **`@Resource` 的缺省名退回按类型。** 缺省名在管理单元里没有绑定时，Spring 按类型注入，所以本步不画边，计入「按类型」。缺省名恰好与另一个类的 bean 同名时，Spring 按名字注入那个 bean，本步也按名字画边，两者一致。
- **Seam 的内置组件与上下文变量。** 它们落「无绑定」，Seam examples 约有一半。读 `@Factory`、`@Out` 与框架内置组件名属于后续步骤。
- **嵌套类型归到顶层类型。** 嵌套类上的注入画在顶层类的节点上，与类名提及一致；`nested` 计数让读者知道有多少条。
- **补充构造型注解会改变第 2、3 步的结果。** 新绑定只在 `spring` 命名空间；只有声明了 Spring 桥接的单元，EL 才看得到它们。O4b 逐条列出。

## Migration Plan

升版本号后，已有产物在下次 Lazy / `sync_facts` 时整体重投影，不需要迁移脚本。目录版本号随代码一起升，没有外部的目录使用者。回滚时按步 revert 对应 commit。Core 的新字段是可选字段，旧读者忽略它。
