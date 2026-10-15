## Context

动机见 proposal.md。现状：

- 按名字的注解注入（`annotation-injection-resolution.mjs`）已成事实。`@Inject` 与不带名字的 `@EJB` 在那里落「无名字」桶，不连边。
- Java 调用解析器（`java-call-resolution.mjs` 的 `createJavaCallResolver`）内部已有：
  - 按文件作用域解析类型文本（`resolveType`：仓库内、仓库外、未知、数组、基本类型）；
  - 类型索引；
  - 已解析的父类型（`supertypesOf`）与传递的祖先（`hierarchy`）。

  对外只暴露 `hierarchyEdges()` 与 `resolveFileCalls(row)`。`build-fact-graph.mjs` 为 Java 行建一个解析器实例。
- Core 的 Java 结构行今天给出：
  - 顶层类型（种类、全限定名、父类型、字段类型、类型注解及字符串字面量参数、类型参数、成员类型的名字），没有修饰符；
  - 顶层类型体内的方法与构造器（参数类型、返回类型、`abstract`、可见性）；
  - 每个类字面量（类型、行、写在注解参数里还是代码里），不归属到注解参数；
  - 任意深度成员上的注解（`memberAnnotations`），不带成员的声明类型。

  嵌套、局部、匿名类型只有成员类型的名字，没有父类型；顶层注解类型声明不进 `classes`。
- 注解身份确认用共用函数 `createAnnotationIdentity`，名字绑定、注解注入、路由都用它。
- `injects` 边由 `mergeInjectsEdges` 按（消费者，目标）合并 XML 与注解两个来源。
- 事实图每次同步都从完整的结构行重新投影。跨运行唯一的复用闸是 `PIPELINE_VERSION`。

## Goals / Non-Goals

**Goals：**
- 每个 `@Inject` 与不带名字的 `@EJB` 注入点，要么得到一条可核对的 `injects` 边，要么落入一个可见桶，桶与边守恒。
- 成边零编造：只在候选集确定完整、且恰好一个候选时成边。
- `@Local` / `@Remote` 用类字面量声明的业务接口成为类型层次事实。
- 框架知识只在目录数据里；解析代码不出现 CDI、EJB、Guice 的名字。

**Non-Goals：**
- 仓库里声明的限定符注解（`@Qualifier` 元注解）的匹配。这类注入点落「限定符未解」，按写法计数，留作后续候选。
- `beans.xml` 的 alternative 选择、bean 发现模式、Guice 模块的绑定语句、Spring XML 对按类型注入的影响。
- `Instance<T>`、`Provider<T>`、`Event<T>` 这类注入点：它们注入的是容器对象，落「仓库外类型」。
- 业务接口的方法级 `implements` 边。
- `ejb-jar.xml` 里 `<local>`、`<remote>`、`<business-local>` 声明的业务接口。
- Spring `@Autowired` 与 `@Resource` 的按类型退回。
- 分层断言：由紧随其后的独立变更处理，见 D16。

## Decisions

### D1 按类型注入是 `injects` 边，目标是类或生产者方法

- 边类型沿用 `injects`：读者与遍历已经认识它，「谁注入了谁」与按名字注入是同一个问题。
- 源是消费者成员所在的顶层类节点，与按名字注入一致。
- 目标：
  - 唯一候选是类时，指向类节点；
  - 是生产者方法时，指向方法节点：注入的值由它产生，指向它所在的类会把「产生者」与「被注入的类型」混为一谈。
- 生产者字段与提供者类没有可指的节点（字段不是节点；提供者类不是被注入的对象），落「目标非节点」，不另造节点。
- 不指向接口本身：「依赖接口」已由字段类型与调用边表达，本变更要回答的是注入的是哪个实现。

### D2 候选是超集，唯一即成边

注入的对象一定满足注入类型 T。仓库里能满足 T 的有三种：
- T 本身或其子类型中的具体类；
- 返回 T 或其子类型的生产者；
- 提供 T 的提供者类。

候选集把它们全部列出，不看部署里是否真的启用。所以只要候选集完整，它就是真实 bean 集合的超集：
- 候选集恰好一个，且部署有效（注入点能满足）时，注入的就是它；
- 两个或更多时，部署怎样消歧（限定符、`@Alternative`、`@Priority`）静态读不出，落「歧义」。

因此正确性只依赖一件事：**不能有看不见的提供方式**。下面各种情形都会让候选集不完整，各落一个桶：
- **隐藏候选**：Core 今天不给父类型的嵌套、局部、匿名类型；嵌套类型里的生产者；父类型解析不出的声明。本变更由 Core 补出前两项（D3）。第三项按简单名保守匹配：解析不出的名字只要可能是 T 或 T 的子类型，就阻断。
- **动态提供**：实例不来自任何声明的类，例如：
  - Guice 的 `bind(Foo.class).toInstance(...)`；
  - 动态代理 `Proxy.newProxyInstance(..., new Class[]{Foo.class}, ...)`；
  - mock；
  - 服务定位器 `lookup(Foo.class)`。

  这些写法都以类字面量写出 T。只对接口与抽象类判：具体类的类字面量绝大多数是 `Logger.getLogger(Foo.class)`，而具体类的实例无论从哪来，总是 T 或其子类的实例，后者已是候选。探针里，这个规则在 Cargo Tracker 让 24 个注入点不成边（都是测试的部署描述），在 Sakai 拦下主代码里一个按类型查找的服务。
- **部署决定**：唯一候选带 `@Alternative` 等注解，它是否是 bean 由部署决定；不是时，真正的 bean 在看不见的地方。

剩余风险是仓库外提供的 bean：外部 jar 里的实现、容器扩展生成的实现。这种 bean 实现的是仓库自己声明的类型，而仓库里又恰好有一个实现，很少见；常见形态（REST 客户端、Spring Data、DeltaSpike 仓库）要么仓库里没有实现，要么注入点带限定符。见 Risks。

按擦除后的类型比较。`Repository<Order>` 的唯一候选若实现的是 `Repository<User>`，部署有效就意味着真正的 bean 在别处。超集论证不受影响：擦除只会多算候选，看不见的提供方式另由上面的桶拦。

### D3 Core 补四项事实

都是结构行里的可选字段，旧读者不受影响：

```ts
// classes[] 的每一项（顶层类型）
modifiers?: string[];   // 类型声明上的修饰符关键字，源码顺序，不含注解：public、abstract、final、static、sealed、non-sealed、strictfp

// 结构行
nestedTypes?: JavaNestedType[];   // 顶层以下的每个类型声明与匿名类，源码顺序

export interface JavaNestedType {
  kind: "class" | "interface" | "enum" | "record" | "annotation" | "anonymous";
  name: string | null;            // 匿名类为 null
  line: number;                   // 名字所在行；匿名类为 `new` 所在行
  owner: string;                  // 所在顶层类型的简单名
  local: boolean;                 // 写在方法、构造器、初始化块或 lambda 体里，或是匿名类
  modifiers: string[];
  supertypes: JavaSupertype[];    // 同 classes[].supertypes；匿名类为空
  instantiates?: { type: string; line: number };   // 只有匿名类有：`new` 后面写的类型
}

// JavaAnnotationUse.arguments[] 与 JavaMemberAnnotationUse.arguments[] 的每一项
classLiterals?: Array<{ type: string; line: number }>;
  // 值是类字面量，或元素里有类字面量的数组初始化器时，列出其中每个类字面量；value 仍为 null

// JavaMemberAnnotationUse.member
type?: string;   // 字段：声明类型，声明符上的数组维度并入；方法：返回类型；构造器没有
```

- 枚举常量体（`A { ... }`）不进 `nestedTypes`：它是枚举的子类，枚举不是可注入的候选。
- 顶层注解类型仍不进 `classes`。
- 抽取器在已有的遍历里补这些字段，不改既有字段的值。`extract-structure-result.mjs` 透传并校验新字段的形状，坏形状与其它 Java 事实字段一样让该文件落 `parse-failed`。
- 缓存结论沿用 `annotation-injection-references` 任务 1.2 的核查：结构抽取没有按内容或版本的缓存，`fingerprint.ts` 只取类与函数的固定字段。Core 这一步不改 `PIPELINE_VERSION`，版本随第一个消费者在 D13 升。
- 读新字段的 skill 代码遇到有类型、却缺 `nestedTypes` 的行，与路由阶段一样报错，指明可能是旧抽取的产物。

### D4 目录是数据

新文件 `skills/excavator/catalogs/type-injections.json`，版本 1：

```json
{
  "version": 1,
  "injectionFamilies": [
    {
      "id": "jsr330-inject",
      "basis": "…",
      "annotations": ["javax.inject.Inject", "jakarta.inject.Inject", "com.google.inject.Inject"],
      "on": ["field", "method", "constructor"],
      "readsQualifiers": true,
      "singleParameterMethods": false,
      "nameArguments": [],
      "nameAnnotations": ["org.springframework.beans.factory.annotation.Qualifier"],
      "lookupArguments": [],
      "typeArgument": null
    },
    {
      "id": "ejb-inject",
      "basis": "…",
      "annotations": ["javax.ejb.EJB", "jakarta.ejb.EJB"],
      "on": ["field", "method"],
      "readsQualifiers": false,
      "singleParameterMethods": true,
      "nameArguments": ["beanName"],
      "nameAnnotations": [],
      "lookupArguments": ["lookup", "mappedName"],
      "typeArgument": "beanInterface"
    }
  ],
  "namedQualifier": {
    "basis": "…",
    "annotations": ["javax.inject.Named", "jakarta.inject.Named"],
    "argument": "value",
    "defaultNameStereotypes": ["javax.enterprise.inject.Model", "jakarta.enterprise.inject.Model"]
  },
  "producers": {
    "basis": "…",
    "annotations": ["javax.enterprise.inject.Produces", "jakarta.enterprise.inject.Produces", "com.google.inject.Provides", "dagger.Provides", "org.springframework.context.annotation.Bean"]
  },
  "providerTypes": {
    "basis": "…",
    "types": ["javax.inject.Provider", "jakarta.inject.Provider", "com.google.inject.Provider", "org.springframework.beans.factory.FactoryBean"]
  },
  "deploymentDependent": {
    "basis": "…",
    "annotations": ["javax.enterprise.inject.Alternative", "jakarta.enterprise.inject.Alternative", "javax.enterprise.inject.Specializes", "jakarta.enterprise.inject.Specializes", "javax.enterprise.inject.Typed", "jakarta.enterprise.inject.Typed", "javax.enterprise.inject.Vetoed", "jakarta.enterprise.inject.Vetoed", "javax.decorator.Decorator", "jakarta.decorator.Decorator", "javax.interceptor.Interceptor", "jakarta.interceptor.Interceptor"]
  },
  "notQualifiers": {
    "basis": "…",
    "annotations": ["lombok.Getter", "lombok.Setter", "javax.annotation.Nullable"]
  },
  "businessInterfaces": {
    "basis": "…",
    "annotations": ["javax.ejb.Local", "javax.ejb.Remote", "jakarta.ejb.Local", "jakarta.ejb.Remote"],
    "argument": "value"
  }
}
```

- 每个族与每个角色都是带 `basis` 的对象：一句话写明这条知识的出处与含义，与 `routes.json` 的族一样。

- 加载器 `type-injection-catalog.mjs` 照 `route-catalog.mjs` 的样子：严格、全量、深冻结。以下都抛错，并指明位置：
  - 未知键、缺字段、类型不符；
  - 族的 `annotations` 或 `on` 为空；
  - id 重复；
  - 全限定名不是点分名；
  - 同一全限定名出现在两个角色里：注入注解、按名字注入注解、名字限定符、生产者、提供者、部署决定、非限定符、业务接口，彼此不得重叠。
- `com.google.inject.Inject` 与 `javax.inject.Inject` 用同一族：D2 的论证与容器无关。Guice 的模块绑定都以类字面量写出被绑定的类型，由「动态提供」拦下。
- `nameAnnotations` 列出与注入注解同用、由按名字阶段解析的注解。Spring 的 `@Qualifier` 写在 `@Inject` 的字段或参数上时，`annotationInjections` 的 `spring-qualifier` 已按名字解析它；本阶段把这类点归「按名字」，不再当未知限定符报缺口。
- Guice 的 `com.google.inject.name.Named` 不进 `namedQualifier`：Guice 不读类上的 `@Named`，按名字筛候选会错。写它的注入点落「限定符未解」。
- `notQualifiers` 只放从不当限定符用的注解。`java.lang` 的注解不在其中：身份函数不建模 `java.lang` 的隐式导入，这类写法确认不了，会落「限定符未解」。这是保守的一侧，代价见 Risks。

### D5 注入点与注解身份

- 身份：`createAnnotationIdentity` 的已知集合，是目录里全部角色的全限定名。确认为目录名的才有角色；`other` 是别的注解；`unconfirmed` 按写法计数。
- 注入点：
  - 字段：字段上的注入注解。T 取成员注解所附成员的声明类型（`member.type`，D3），它与 `fieldTypes` 里同名字段的类型相同，并且一行多个声明符时各自对应；
  - 方法与构造器：用（所在顶层类型，成员名，名字所在行）在 `functions` 里找声明，规则同路由阶段：名字相同、行范围含名字所在行，且恰好一个、有节点 id。每个参数一个注入点，T 取 `paramTypes`；
  - 方法级注解只是触发，不当参数的限定符；参数的限定符是参数上的注解。
- 消费者是成员所在的顶层类节点。

### D6 类型解析复用调用解析器

- `createJavaCallResolver` 的返回对象新增只读的类型查询，内部复用 `resolveType`、`supertypesOf`、`hierarchy`：
  - 在给定文件与所属顶层类型的作用域里解析一段类型文本，可附加方法的类型参数；
  - 列出全部顶层类型；
  - 列出一个类型已解析的父类型。

  不改既有行为，既有测试不变。新阶段与调用解析共用 `build-fact-graph.mjs` 里的同一个实例，不建第二个。
- 类型变量先判：擦除后的基名是所属类型或方法的类型参数，落「类型变量」。
- 判「类型无法确定」的情形：
  - 解析结果为未知；
  - 写成 `Outer.Inner` 的嵌套类型（解析器对此返回未知）；
  - 全限定名对应多个声明。
- 嵌套类型的父类型、匿名类的 `instantiates`、代码里的类字面量，都在所在文件、所属顶层类型的作用域里解析。这会忽略嵌套作用域的遮蔽，但这些结果只用于阻断（D2），多阻断不会编造。

### D7 候选集的计算

- 子类型闭包：每个顶层类型的祖先，由两部分组成：
  - 解析器的 `hierarchy`；
  - 业务接口声明（D10）追加的父类型，连同这些接口自己的祖先。

  据此建反向索引「类型 → 它的全部仓库子类型（任何种类）」，每次构建建一次。
- 类候选：子类型闭包里，加上 T 本身，种类为 `class` 或 `record`、且修饰符不含 `abstract` 的。`enum` 不是候选：容器不实例化枚举，枚举常量只能经生产者（已是候选）或程序化绑定（由「动态提供」拦下）注入。
- 生产者候选：带目录生产者注解的方法与字段，`member.type` 解析为 T 或 T 的子类型的：
  - 顶层类型里的，是候选；
  - 嵌套类型里的，阻断（隐藏候选）。
- 提供者候选：顶层的非抽象类与 `record`（含嵌套类型，后者阻断），它自己或某个仓库祖先写出的父类型确认为目录提供者类型，其第一个类型参数解析为 T 或 T 的子类型。按祖先传递，因为经仓库基类提供的类不直接写提供者类型。提供者类型的写法确认不了，或类型参数解析不出时，类型参数的简单名进简单名阻断集。祖先写出的类型参数是类型变量时（`class BaseProvider<X> implements Provider<X>`，`class FooProvider extends BaseProvider<Foo>`），提供的类型要做类型变量代换，本变更不做：该类与它各个祖先写出的父类型里的全部类型参数，简单名都进阻断集。
- 简单名阻断集：T 与 T 的全部子类型的简单名。以下声明命中即阻断：
  - 有解析为未知的父类型（含业务接口的类字面量），其最后一段简单名在集合里；
  - 生产者的 `member.type` 解析为未知，基名在集合里；
  - 代码类字面量解析为未知，基名等于 T 的简单名。动态提供只看 T 本身。
- 其它 JVM 语言：Kotlin 与 Scala 的结构行没有父类型，这些文件里声明的类型可能实现或继承 T。仓库里有这样的类型声明、且 T 不是 `final` 类时，注入点落「隐藏候选」。混合仓库因此不成边，但每个点都在桶里可见。

### D8 限定符

- 只对 `readsQualifiers` 的族读。
- 注入点上的注解按身份分三类：
  - 注入注解与 `notQualifiers`：不计；
  - 名字限定符：按名字筛（见规格）；
  - 其余（`other` 与 `unconfirmed` 都在内）：落「限定符未解」，覆盖按写法计数。
- 名字筛选是排除：只去掉确定没有该名字的候选。没有名字限定符、也没有带缺省名构造型的类与生产者没有名字（CDI 只给带 `@Named` 的 bean 名字），被去掉；名字限定符的值不是字面量的候选与提供者类保留。
- bean 名字的缺省规则：
  - 类：简单名首字母小写；
  - 生产者方法：`get` 或 `is` 开头时取 Java Beans 属性名（`java.beans.Introspector` 的规则：前两个字符都大写时保持原样），否则取方法名；
  - 生产者字段：取字段名。

  CDI 规定的就是这些。
- 不读限定符时，注入点上的其它注解（如 `@EJB` 字段上的 `@Deprecated`）不影响解析。
- 不做反向检查：注入点没写限定符、唯一候选却带了某个限定符。按 CDI 这个候选不满足 `@Default`；但超集论证（D2）不依赖它，多算的候选只会让结果偏向「歧义」。

### D9 十六个桶的顺序

顺序见规格，理由：
- 1–3 判「是不是本阶段的按类型注入点」。按名字与 JNDI 名的点属于别处，位置不读的点不是注入。
- 4–5 判「注入点读不读得出来」。
- 6–8 判「T 是什么」。仓库外类型先于限定符：`@Inject @Any Instance<Foo>` 归「仓库外类型」，不归限定符。
- 9–11 判「候选集完不完整」。限定符先于候选，因为它是注入点自身的事。隐藏与动态先于计数：候选集不完整时，「无候选」「歧义」都不成立。
- 12–13 计数。
- 14–15 只看唯一候选。
- 16 成边。

### D10 业务接口

- 只读顶层类的类型注解：嵌套类不能是 session bean。
- 类字面量来自 D3 给注解参数补的 `classLiterals`。
- 八个桶的顺序见规格。按注解计一次的，只有两个按注解判的桶：「未列类型」与「不可读」。
- 「已是父类型」：沿解析器的 `hierarchy` 判该类是否已到达该接口。
- 「声明」生成 `implements` 边：
  - 权重与 Java 的类型层次边相同（0.9），`provenance: "extracted"`；
  - 证据 `{ file, line, source: 'tree-sitter', token, role: 'businessInterface' }`，`line` 为类字面量所在行，`token` 为写出的类型；
  - 图校验对 `implements` 按端点名核对，类字面量行含接口的简单名。
- 解析到仓库接口的声明（「已是父类型」「类未建索引」「声明」）都进 D7 的子类型闭包。解析为未知的声明进简单名阻断集。
- 「不可读」（如 `@Local(Interfaces.LOCAL)`）不阻断任何类型：它没写出名字。常量的值要以类字面量写在仓库代码里，接口类型因此已由「动态提供」拦下；常量来自仓库外时属于 Risks 的「仓库外提供」。

### D11 边与证据

- 证据见规格：

  ```
  { file, line, source: 'tree-sitter', token, role, family, member, parameter?, type?, name? }
  ```

  - `role` 取 `injection`、`member`、`qualifier`、`producer` 之一；
  - `member` 为成员名；
  - `parameter` 为参数序号；
  - `type` 为写出的声明类型，只在 `member` 条目上；
  - `name` 为限定符读到的名字。
- `mergeInjectsEdges` 增加第三个来源 `typeEdges`，按（源，目标）合并；`noInjectsMerge` 开关对三个来源同样生效。排序去重的键依次为文件、行、`token`、注入点 id 或角色、成员、参数序号。
- 本阶段内部先把自己的边按（源，目标）合并，守恒在合并前按注入点计。

### D12 覆盖、缺口与守恒

```
coverage.typeInjections = {
  status: 'ran',
  families: { <id>: { annotations, points, buckets: { …16 }, edges } },
  unconfirmed: { <written>: n },
  qualifiers: { <written>: n },
  businessInterfaces: { annotations, declarations, buckets: { …8 }, edges }
}
```

- 没有目录时为 `{ status: 'not-run' }`。
- 缺口样例：

  ```
  <file>:<line> <Owner>.<member>[#<参数序号>] : <写出的类型>
  ```

  `ambiguous` 后接 ` -> ` 与排序后的候选全限定名（生产者为 `<类>#<方法>`），最多 5 个，多出的写 `…+N`。业务接口缺口的样例为 `<file>:<line> <Class> <写出的类型或参数>`。
- `assertTypeInjectionConservation` 校验规格里的三条守恒，再加业务接口的两条；不平衡时抛错，事实构建失败。

### D13 接入流水线

- `build-fact-graph.mjs` 新参数 `typeInjectionCatalog`。给了它却没给 `mentionInputs` 时抛错：身份确认要用 `javaPackages`。
- 阶段的输入另有 `otherJvmTypeCount`：Kotlin 与 Scala 结构行声明的类型数，用于 D7 的其它 JVM 语言规则。
- 阶段放在类型层次边之后、名字阶段之前：
  - 先算业务接口，追加 `implements` 边，跳过已有的同端点边；
  - 再算注入点，按类型的边与名字阶段的两组边一起经 `mergeInjectsEdges` 加入图。

  名字阶段没运行时，只合并本阶段的边。
- `lazy-analyze.mjs` 加载目录（`loadTypeInjectionCatalog()`，可注入），`PIPELINE_VERSION` 升到 `lazy-fact-graph/12`。`build-fact-graph.mjs` 的独立 CLI 入口照旧不传目录，阶段为 `not-run`。
- 检查其它按边类型或覆盖段分支的位置，确认新覆盖段、指向方法节点的 `injects` 边不出错：
  - `project-service.mjs`；
  - MCP `project_status`；
  - 语义规划与新鲜度；
  - `factsDigest`。

### D14 变异绊线

用测试接缝（`mutations`，生产默认关），每个开关至少让一条测试变红：
- `simpleNameAnnotations`：只按简单名认注解；
- `abstractCandidates`：抽象类也算候选；
- `noHiddenCandidates`：不判隐藏候选；
- `noDynamicGuard`：不判动态提供；
- `ignoreUnknownQualifiers`：其它注解不让注入点落「限定符未解」；
- `noNamedFilter`：不按名字筛候选；
- `firstCandidate`：多个候选时取第一个；
- `noBusinessInterfaces`：不读业务接口注解。

### D15 附录

- `javaee.md`：
  - 「Already in the fact graph」表加两行：按类型的 `injects`（来自 `catalogs/type-injections.json`），以及业务接口的 `implements`；
  - 原「Injection by type」规则改写为：图里已有边就不重画；`type-injection-*` 缺口不猜目标，语义描述可写声明类型并说明目标由部署决定；
  - 缺口说明加 `type-injection-` 前缀的五类与 `business-interface-unresolved`。
- `frameworks/README.md` 的归属表加一行：按类型注入与业务接口 → 确定性，`catalogs/type-injections.json`。

### D16 分层拆到下一个变更

需求的验收写的是「在测试里断言边与分层」。分层的现状：
- `FrameworkConfig.layerHints` 没有任何读者；
- Lazy 图没有分层；
- 附录里的组件角色与分层是 guidance。

分层是节点角色，不是边，需要另一套投影、覆盖与校验。放进本变更会让它翻倍，所以紧接着单独提一个变更，复用本变更的注入事实。

## 验收 Oracle（动手前写死）

语料都在 `excavator-test-repos/` 下，用固定检出；源码、路径与输出都不提交。

| 语料 | 用途 |
|---|---|
| Dataverse | 主语料：大量不带名字的 `@EJB` 注入具体类 |
| TomEE 8.x examples | `@Inject` 与 `@EJB`、接口与生产者、测试里的类字面量 |
| Cargo Tracker | `@Inject` 注入仓库接口，Arquillian 测试 |
| DayTrader 8、DayTrader 7 | 仓库限定符（落「限定符未解」）、构造器注入 |
| Sakai `master`、hadoop | Spring 与 Guice 下的 `javax.inject.Inject`，耗时 |
| Seam 2.2 examples、OSCAR、fineract、JPetStore 6、两个私有语料 | 不回归 |

开工前由 acceptor 记下每个语料的提交号，写进验收报告。`/11` 基线复用 `jaxrs-route-facts` 验收在 `269cb7cf` 上的产物：该提交的 skill 与 Core 代码与本变更的父提交 `main` 相同。复用前先核对这一点，不同就重建。

- **O1 夹具与绊线**（coder 写，acceptor 审）：
  - 规格的每个场景一条测试。
  - 在 `tests/fixtures/javaee-jsf-app/` 加模块 `orders-inject`，有自己的 `pom.xml`，覆盖十六个桶与业务接口的八个桶。至少含：
    - 唯一实现的接口；
    - 两层实现；
    - 抽象中间类；
    - 具体类注入；
    - 构造器与 setter 注入；
    - 生产者方法与生产者字段；
    - 提供者类；
    - `@Named` 筛选：类上写值、类上不写值、`@Model`；
    - 仓库外与未知限定符；
    - 静态嵌套实现、匿名实现、局部类实现；
    - 代码里的接口类字面量；
    - `@Alternative` 唯一实现；
    - `@EJB(beanName)`、`@EJB(lookup)`、`@EJB(beanInterface = X.class)`；
    - 类型变量、嵌套类型、同名的两个声明；
    - 嵌套类型里的注入点；
    - 同包的同名 `Inject` 注解；
    - `@Local(X.class)` 未写 `implements`、已写 `implements`、常量参数、仓库外接口。
  - 测试断言精确的边、证据、桶、缺口与覆盖。
  - D14 每个开关至少让一条测试变红。
  - Core 的四项新事实各有精确断言的抽取测试。
  - 既有测试里锁定的计数如有变化，逐项说明来源。
- **O2 全量精度审计**（acceptor 独立实现，不复用被测代码）：
  - 对验收语料里本阶段的每条 `injects` 边，以及每条业务接口 `implements` 边：
    - 读快照里的 Java 源码，独立识别注解（遮蔽注释与字符串，按导入确认身份）；
    - 独立建类型层次，含嵌套、局部、匿名类型；
    - 独立求候选集与阻断条件；
    - 核对边的消费者、目标与每条证据的行和 `token`。
  - 不一致数必须为 0。
  - 装置先验：往图谱副本里注入四种错，审计必须全部报出：
    - 错目标；
    - 错消费者；
    - 错证据行；
    - 给一个歧义注入点多画一条边。
- **O3 桶与计数对账**（acceptor 独立脚本）：
  - 每个语料、每个族的注入点数与十六个桶，与独立重算逐项比对。差异逐条读源码归因，只允许归因为审计脚本的已知局限，并给出例子。
  - 跨阶段一致：名字阶段 `ejb-bean-name` 注入点的「无名字」数，等于本阶段 `ejb-inject` 族的注解数，减去「按名字」，再减去成员种类不在名字阶段 `on` 里的「位置不读」与「JNDI 名」。后一项含「JNDI 名」：构造器上的 `@EJB(lookup = …)` 在这里落「JNDI 名」，在名字阶段落「位置不读」。空串的 `beanName`、`lookup`、`mappedName` 与不写相同，两个阶段一致。
- **O4 不回归**：每个语料与同一检出、`lazy-fact-graph/11` 的基线对比。
  - 既有节点集合、既有边与既有缺口完全一致，只有两处例外：
    - 新增的 `injects` 边；
    - 既有 `injects` 边上新增的按类型证据条目：既有条目不变，新增条目逐条列出。
  - 新增内容只能是：
    - `injects` 边；
    - 业务接口的 `implements` 边：语料里预计为 0；
    - `type-injection-*` 与 `business-interface-unresolved` 缺口。
  - 覆盖只多 `typeInjections` 一段。
  - 不用按类型注入的语料只多这一段，且其中计数为 0。
- **O5 耗时**：Sakai `master` 与 hadoop 的 Lazy 总耗时，与同一会话新测的 `/11` 基线相比，增幅不超过 10%（各取 3 次中位数）。`factGraph` 阶段单独报告。
- **O6 分层人工抽查**（acceptor：Dataverse、TomEE、Cargo Tracker、DayTrader 8、DayTrader 7、Sakai `master`）：
  - 成边：每个语料随机 10 条；
  - 以下层全抽，每层上限 30：
    - 注入类型是接口或抽象类的；
    - 参数注入点（构造器与方法）；
    - 目标是生产者方法的；
    - 经 `@Named` 筛出的；
    - 目标是注入类型的子类而非它本身的；
    - 消费者是抽象类的；
  - 每类缺口随机 20 条样例；「仓库外类型」随机 20 条。
  - 编造计数必须为 0。编造指：边的目标不是容器会注入的对象。判断时读源码与部署配置：`beans.xml`、Guice 模块、生产者。漏边单独计数并归因。
- **预先承诺的退路**（抽查发现编造时直接执行，不再讨论）：
  - **F1**：编造来自一种静态看不见的提供方式。处理办法：
    - 找出它的语法信号（调用形态、注解、配置），加进 D7 的阻断条件或目录；
    - 补一条先红后绿的夹具测试；
    - 重跑 O2 与 O6。
  - **F2**：编造来自 `@Named` 筛选，即容器不读类上的名字。处理办法：名字筛选只保留生产者候选；类候选在有名字限定符时一律落「限定符未解」。补夹具测试，重跑 O2 与 O6。
  - **F3**：编造来自部署相关的 bean 资格（未启用的 alternative、发现模式）。处理办法：把对应注解或配置信号加进 `deploymentDependent` 或阻断条件，补夹具测试，重跑 O2 与 O6。
  - **其它来源**：先改源头，补一条先红后绿的夹具测试，再重跑 O2 与 O6。
- **O7 真实 MCP**：对 Dataverse 或 TomEE examples 起 stdio MCP，调用全部工具：
  - 从一个消费者类做 1 跳出边遍历，经按类型的 `injects` 到达实现类；
  - 从实现类做 1 跳入边遍历，到达消费者；
  - `read_evidence` 对这条边返回注入注解原行；
  - `project_status` 报出 `typeInjections` 覆盖与 `type-injection-*` 缺口；
  - `recall` 用消费者名能检索到相关结果，且不报错。
- **O8 全量门**（我跑）：依次跑
  1. `pnpm --filter @excavator/core build`；
  2. core 测试与 typecheck；
  3. `pnpm typecheck`；
  4. `pnpm exec vitest run --maxWorkers=4`；
  5. `node scripts/check-refs.mjs`；
  6. `openspec validate --all --strict`。

  新文件先 `git add -N`。每个中间 commit 也各自过门。

## Risks / Trade-offs

- **仓库外提供的 bean 看不见。** 外部 jar 或容器扩展为仓库自己的类型提供实现，而仓库里恰好也有一个实现时，会编造。部署描述符的 `<ejb-ref>` / `<injection-target>` 也能覆盖注解注入：指向本仓库的 bean 时，它必在候选集里；指向外部时属于这一类。缓解：
  - D2 的「动态提供」与「部署决定」覆盖常见的程序化提供；
  - O6 专门抽查注入类型是接口的边；
  - F1 兜底。
- **测试里的类字面量会让主代码的注入点不成边。** Cargo Tracker 约一半的接口注入点因此落「动态提供」。这是漏，不是编造，桶里可见。不按路径区分测试代码：事实层对全部文件一视同仁，按路径猜测试是启发式。
- **仓库限定符不匹配。** DayTrader 8 一类用自定义限定符区分实现的项目，这些注入点全部落「限定符未解」，覆盖按写法给出计数。仓库限定符要读注解类型的元注解，Core 今天不抽顶层注解类型，留作后续。
- **`java.lang` 注解与未知注解让注入点落「限定符未解」。** 这是保守的一侧，覆盖里有按写法的计数，目录可以按数据扩充 `notQualifiers`。
- **不判 CDI 的 `@Default` 规则。** 见 D8。它只会把本可成边的点留在「歧义」，不会编造。
- **业务接口在语料里没有出现。** 这部分只由夹具验证。方法级边不做，经业务接口的调用到不了 bean 的方法。
- **Core 新增字段让结构行变大。** `nestedTypes` 每个匿名类一条。O5 计时会反映出来。

## Migration Plan

- 升版本号后，已有产物在下次 Lazy / `sync_facts` 时整体重投影，不需要迁移脚本。
- 目录随插件发布，没有外部使用者。
- Core 新字段可选：旧结构行由 skill 阶段报错，指明需要重新抽取；Lazy 每次运行都重新抽取。
- 回滚时按步 revert 对应 commit。
