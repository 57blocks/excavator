## Context

- 第 2 步（name-binding-references，已归档）建立了以下基础，本变更全部沿用：
  - 声明式目录 `skills/excavator/catalogs/name-bindings.json` 与严格加载器；
  - XML 读取器 `xml-name-bindings.mjs`：容错解析、注释遮蔽、按本地名匹配元素、读根命名空间；
  - 部署单元（最近的描述符祖先）；
  - 绑定表、目标分类（类节点 / 仓库外 / 未建索引 / 资源包 / 未知 / 歧义）、按单元与命名空间可见；
  - 可见桶、缺口与两条守恒；
  - lazy 阶段 `nameReferences`，在 `mentions` 之后读一遍非代码文件。
- 第 2 步的绑定表在建表时丢弃 EL 访问不到的名字（点分名、含 `/` 的名字），只计入 `nonIdentifierNames`。Spring 的 bean id 可以是任意字符串，Sakai 大量用接口全限定名作 id，所以注入点要匹配的名字有很大一部分在今天的表里不存在。
- 第 2 步的 `spring-xml-bean` 绑定器把 `class` 属性当作目标。带 `factory-method` 的定义里，`class` 写的是工厂类，bean 是工厂方法的返回值；今天它会被绑到工厂类上，这是错归属。只写 `parent` 的定义今天是目标未知。`<alias>` 今天不读。
- Core 不需要改动：注入点、消费者与目标全在 XML 与已有的绑定表里。
- 框架知识的分层见 `skills/excavator/frameworks/README.md`。名字装配属于第三层，即确定性事实，理由见 D0。
- 探针：JS 近似实现本设计，仅作量级参考，不是 oracle。

  | 语料 | 根为 `beans` 的文件（Spring / 无命名空间 / 其它） | 注入点 | 成边 | 他处 | 仓库外 | 无绑定 | 目标未知 | 歧义 | 消费者未解析 | 消费者在仓库外 |
  |---|---|---|---|---|---|---|---|---|---|---|
  | Sakai 12.7 | 256 / 9 / 0 | 3,740 | 1,359 | 1,845 | 286 | 133 | 43 | 10 | 17 | 47 |
  | OSCAR | 21 / 1 / 0 | 179 | 128 | 0 | 30 | 2 | 0 | 2 | 13 | 4 |
  | OpenMRS core | 7 / 0 / 0 | 48 | 12 | 0 | 1 | 7 | 1 | 0 | 25 | 2 |
  | JPetStore 6 | 2 / 0 / 1 | 2 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 |
  | Seam 2.2 examples | 1 / 0 / 0 | 10 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 |
  | TomEE 8.x examples | 0 / 13 / 42 | 0 | — | — | — | — | — | — | — | — |

  - Sakai 的成边注入点对应 743 条不同的（消费者类，目标类）。
  - Sakai 的「他处」是 kernel 等别的模块里声明的服务 bean。
  - Sakai 的 133 个「无绑定」中，75 个是 RSF 库自带的 bean 名字。OpenMRS 的 7 个「无绑定」有 6 个在测试上下文里，这些名字不在任何单元的 XML 或构造型注解里。
  - OpenMRS 的「消费者未解析」主要来自同一个工厂方法定义上的 25 个属性。
  - JPetStore 的两处 `ref="dataSource"` 指向 `<jdbc:embedded-database id>` 这类自定义命名空间元素，本步不读。
  - TomEE 的 `beans` 根全是 CDI `beans.xml`：命名空间为 Java EE 的 42 个；无命名空间的 13 个里没有 `<bean>` 元素，也没有注入点。
  - 引用形状里没有注入点读的：Sakai 的 `custom-filter@ref` 4 处、`http@entry-point-ref` 2 处、`authentication-provider@ref` 2 处。
  - 三个语料中，主源注入点只解析到测试源绑定的成边为 0。

## Goals / Non-Goals

**Goals:**

- 经 Spring XML 名字装配的（消费者类，目标类）得到一条带逐行证据的 `injects` 边。证据能复核：注入点行、名字、消费者行、解析经过的每一处绑定。
- 代码里不出现 Spring 的元素名、属性名或命名空间。这些都在目录数据里，每条带依据。
- 每个注入点落进一个可见桶，共十四种，由守恒断言保证。引用形状里没有读的也有计数。
- EL 与注入用同一张绑定表、同一套目标解析。第 2 步 EL 结果的变化只来自 D3 的三条目标规则，验收逐条列出。

**Non-Goals（设计层面）:**

- 不建 bean 节点。边在类节点之间，bean 名字与定义处留在证据里。理由见 D7。
- 不区分 FactoryBean 与普通类。边的目标是定义声明的类；产物类型需要类型层次与泛型解析，属于后续步骤。
- 不读 `<import resource>` 来划分上下文。可见范围仍是部署单元，代价见风险一节。
- 不读按类型的自动装配（`autowire`、`@Autowired`），它属于 addendum。也不读 SpEL（`#{…}` 里的 bean 名字）。

## Decisions

**D0：为什么落代码，而不是交给 skill / prompt。**

- 按 README 的判据：一个文件里的字符串名字由另一个文件的声明绑定，属于第三层。模型读一个文件加查图做不到这件事：它要确认这个名字在单元里有唯一的声明，而这是一个缺失判断，需要完整的声明集。按名字猜，在别名、同名覆盖、跨模块同名时都会编造。
- 量大：Sakai 一个仓库就有 3,740 个注入点。按「结构化代码事实不让模型转写」，由确定性抽取原样产出。
- 下游的遍历、死代码判定（R5）与审计都需要可复现、可校验的边。
- 注入点、消费者、普查规则是框架语义，写成目录数据。代码只执行与框架无关的机制。

**D1：目录（版本 2）。**

- XML 绑定器的改动：
  - `rootNamespace` 的元素可以是字符串或 `null`，`null` 表示根元素没有声明命名空间。
  - `target.kind` 新增 `name`：目标文本是另一个名字，在同单元、同命名空间里解析（D3）。
  - `target` 新增可选字段：
    - `unknownWhen`：属性名列表。元素带有其中之一时，目标为未知，未知原因记为该属性名。
    - `inheritFrom`：属性名。元素没有目标、且写了该属性时，从该属性所名的绑定继承目标。
  - 只有 `kind: class` 的目标可以带 `unknownWhen` 与 `inheritFrom`。
- 新增顶层 `xmlInjections`，每项是一个注入族，字段如下：
  - `id`、`namespace`、`basis`；
  - `root`，可选 `rootNamespace`（同绑定器，可含 `null`）；
  - `consumer: { element, binder }`：`binder` 必须是同命名空间、`target.kind` 为 `class` 的 XML 绑定器 id；
  - `sites`：非空数组，每项有全局唯一的 `id` 与可选 `scope`。`scope` 取 `unit`（缺省）、`file` 或 `outside`。每项是以下两种形状之一：
    - `{ element, attribute }`；
    - `{ attributeNamespace, attributeSuffix }`：属性的前缀在该元素的作用域里绑定到该命名空间，属性本地名以后缀结尾。
  - `census: { attributes, attributeSuffixes, elements }`：三个字符串数组，至少一个非空。
- 加载器校验：未知键、缺字段、类型不符、重复 id（绑定器与注入点各自全局唯一）、`consumer.binder` 不存在或不合格、`sites` 形状两者都不是或两者混写，都抛错并指出位置。
- **随附条目**（依据写进 `basis`）：
  - `spring-xml-bean`：
    - 加 `rootNamespace: ["http://www.springframework.org/schema/beans", null]`；
    - 加 `target.unknownWhen: ["factory-method", "factory-bean"]` 与 `target.inheritFrom: "parent"`。
  - 新绑定器 `spring-xml-alias`：
    - 命名空间 `spring`，根元素 `beans`，根命名空间同上；
    - 元素 `alias`，父元素 `beans`；
    - 名字取属性 `alias`，目标为 `{ kind: name, attribute: name }`；
    - `namespacedNames: false`，`missingTarget: unknown`。
  - 新注入族 `spring-xml-injection`：
    - 命名空间 `spring`，根元素与根命名空间同上；
    - 消费者为 `{ element: bean, binder: spring-xml-bean }`。

    | 注入点 id | 写法 | `scope` |
    |---|---|---|
    | `spring-property-ref` | `property@ref` | unit |
    | `spring-constructor-arg-ref` | `constructor-arg@ref` | unit |
    | `spring-ref-bean` | `ref@bean` | unit |
    | `spring-ref-local` | `ref@local` | file |
    | `spring-ref-parent` | `ref@parent` | outside |
    | `spring-entry-key-ref` | `entry@key-ref` | unit |
    | `spring-entry-value-ref` | `entry@value-ref` | unit |
    | `spring-lookup-method` | `lookup-method@bean` | unit |
    | `spring-replaced-method` | `replaced-method@replacer` | unit |
    | `spring-p-ref` | `http://www.springframework.org/schema/p` 命名空间里以 `-ref` 结尾的属性 | unit |
    | `spring-c-ref` | `http://www.springframework.org/schema/c` 命名空间里以 `-ref` 结尾的属性 | unit |

    普查：属性 `ref`、后缀 `-ref`、元素 `ref` 与 `idref`。
    - `idref` 不是注入点。Spring 文档说明它只传另一个 bean 的 id 字符串，不注入该 bean。
    - `lookup-method` 与 `replaced-method` 是注入点。Spring 文档把两者归为方法注入：前者让容器覆写方法、返回所名的 bean，后者把方法实现交给所名的 bean。
- 被否决的方案：
  - 在代码里写死 `ref` 与 `-ref`。这样框架就硬编码在代码里，第二个 XML 装配框架（如 OSGi Blueprint 的 `<blueprint>` / `<bean>` / `<property ref>`）就得改代码。
  - 单开一份注入目录。注入点要用的绑定、单元与命名空间都在现有目录里，拆开会让两份数据互相引用。

**D2：一张绑定表，名字过滤移到 EL 匹配。**

- 建表时所有绑定都进表，包括点分名、含 `/` 的名字，以及新的别名绑定。每个绑定记一个标志：EL 能不能访问到它。判定沿用第 2 步的规则：EL 标识符；或者每段都是标识符的点分名，且绑定器 `namespacedNames: true`。
- EL 匹配只用可访问的绑定。`nonIdentifierNames` 的含义不变，仍是 EL 访问不到的绑定数；新的别名绑定是点分名时也计入，所以这个计数可能增加。`coverage.nameReferences.bindings` 仍只计 EL 可访问的绑定，所以第 2 步的覆盖计数不受影响；`bindings` 与 `missingNames` 各多一个键 `spring-xml-alias`。
- EL 匹配时，「他处」的判定也只看 EL 可访问的绑定。第 2 步就是这样做的，因为不可访问的名字根本不在表里。
- 注入点按名字原文匹配，不做任何过滤。
- 被否决的方案：注入另建一张表。两张表会对同一个名字给出不同的绑定，同一份 Spring XML 的别名与继承也要解析两次。

**D3：目标解析（别名、继承、工厂）。**

- 全部绑定读出后，每个绑定的目标解析一次并缓存，结果是 `{ kind, key, labels, reason? }`，`kind` 取 `node`、`unindexed`、`external`、`bundle`、`unknown`、`ambiguous` 之一。规则依次为：
  1. XML 元素带有 `unknownWhen` 所列属性：`unknown`，原因为该属性名。即使写了类，也不解析。
  2. 目标种类为 `class`、`bundle`：沿用第 2 步，`class` 走第 1 步的类名解析。
  3. 没有目标、元素写了 `inheritFrom` 属性：解析同单元、同命名空间里该属性所名的名字（见下）。
  4. 目标种类为 `name`：同样解析所名的名字。
  5. 其余没有目标的：`unknown`，`configures` 标志与第 2 步相同。
- 解析一个名字：取同单元、同命名空间里该名字的全部绑定，逐个取它们的解析结果，按第 2 步的 `classify` 归类：
  - `edge` → `node`；`bundle`、`external`、`unindexed`、`unknown` 原样；其余为 `ambiguous`。
  - 名字没有任何绑定：`unknown`，原因为「`<名字>` 在本单元没有绑定」。
  - 正在解析的绑定再次出现，即成环：`unknown`，原因为「成环」。
  - 继承与别名都只在同单元内解析。父定义在父容器或别的模块里时目标未知，不去别的单元找（理由同第 2 步 D5）。
- 解析经过的绑定处随结果一起返回，用于证据（D7）。
- 对 EL 的影响：第 2 步的分桶读的是这个解析结果，所以三条规则也作用于 EL：
  - 工厂方法定义从「成边到工厂类」变为「目标未知」，修正错归属；
  - 只写 `parent` 的定义从「目标未知」变为父定义的类；
  - 别名可被解析。

  这三条只影响 `spring` 命名空间。按第 2 步的规则，这个命名空间只在单元声明了 Spring 的 EL 桥接时对 EL 可见。验收（O4b）逐条列出受影响的 EL 根名。
- 被否决的方案：
  - 工厂方法定义继续按 `class` 绑定。`class="ServiceLocator" factory-method="lookup"` 的 bean 不是 `ServiceLocator`，画边就是编造。
  - 解析工厂方法的返回类型。这要读方法签名、处理泛型，属于后续步骤。

**D4：注入点读取（纯函数，单文件）。**

- 文件范围：根元素按本地名与 `rootNamespace` 命中某个注入族的 XML 文件，与绑定器共用一次解析。注释已遮蔽。
- 注入点：
  - 元素按本地名匹配，与第 2 步的读取器一致。
  - `attributeNamespace` 形状的注入点：属性的前缀按该元素及其祖先上的 `xmlns:前缀` 声明解析，取最近的一个。没有前缀的属性不在任何命名空间里。
  - `xmlns` 与 `xmlns:*` 声明本身永远不是注入点，也不进普查。
  - 名字为属性值去掉首尾空白。值为空的属性不产生注入点，计入普查未读，键为「元素@属性」。
  - 一个元素可以产生多个注入点，如 `<entry key-ref value-ref>`。
- 消费者：注入点所在元素自身或最近的祖先中，本地名为 `consumer.element` 的元素。对它按 `consumer.binder` 的目标规则读出 `{ line, target, unknownBecause, inherits }`。这个元素不必能产生绑定：内部 bean、匿名 bean 照样是消费者。
- 普查（在同一棵树上）：
  - 本地名在 `census.elements` 里的元素是一个普查项；有注入点读取该元素时算已读，否则按元素本地名计入未读。
  - 本地名在 `census.attributes` 里、或以 `census.attributeSuffixes` 之一结尾的属性，是一个普查项；有注入点读取该属性时算已读，否则按「元素本地名@属性名原文」计入未读。
- 输出行：`{ file, family, site, name, line, scope, consumer }`。`consumer` 为 `null` 表示没有消费者元素。
- 被否决的方案：按命名空间限定注入点元素，比如只认 Spring beans 命名空间里的 `property`。DTD 形式的文件没有命名空间；带前缀的其它命名空间里叫 `property` 且带 `ref` 的元素（如 `lang:property`）通常没有外层 `<bean>`，会落「消费者缺失」，不会编造。O6 对这类情形全读。

**D5：消费者类。**

- 消费者的类按 D3 的规则在注入点的单元里解析：`unknownWhen` 命中时为未知；写了类时走类名解析；没写类、写了 `inheritFrom` 属性时，解析所名的名字。
- 消费者的结果只用到 `node`、`external`、`unindexed`、`unknown`、`ambiguous`。`consumer.binder` 的目标种类必须是 `class`，所以不会是资源包。
- 被否决的方案：抽象模板定义上的属性展开到它的每个子定义。这是 Spring 的真实语义，但 Sakai 只有 2 处，计入「消费者未知」。展开要先建定义层次，留待有语料需要时再做。

**D6：分桶（顺序即优先级）。**

1. **静态不可见**（`outside`）：注入点的 `scope` 为 `outside`。
2. 取可见绑定：注入族命名空间里名字相等、单元相同的绑定；`scope: file` 时再限定为同一文件。
   - 有可见绑定时，按 D3 的解析结果归类：
     - 全部为同一个类节点：进第 4 步；
     - 全部为资源包：**资源包**（`bundle`）；
     - 全部为同一个仓库外的类：**仓库外**（`external`）；
     - 全部为同一个未建索引的类：**目标未建索引**（`unindexed`）；
     - 全部未知：**目标未知**（`unknown`）；
     - 其余：**歧义**（`ambiguous`）。
3. 没有可见绑定：
   - 别处有同名绑定，即别的单元、别的命名空间，或 `scope: file` 时本单元的其它文件：**他处**（`elsewhere`）；
   - 否则：**无绑定**（`unbound`）。
4. 目标为类节点后看消费者：
   - 没有消费者元素：**消费者缺失**（`consumerMissing`）；
   - 消费者为类节点：**成边**（`edge`）；
   - 仓库外：**消费者在仓库外**（`consumerExternal`）；
   - 未建索引：**消费者未建索引**（`consumerUnindexed`）；
   - 未知：**消费者未知**（`consumerUnknown`）；
   - 歧义：**消费者歧义**（`consumerAmbiguous`）。

先看目标，是因为目标决定这个名字有没有落到仓库代码上；消费者只在边的另一端可能缺失。

`scope: file` 只限定名字直接命中的绑定。这些绑定的目标仍按 D3 在单元内解析，别名与继承可以指向同单元的其它文件。

**D7：`injects` 边。**

- 每个（消费者类，目标类）一条边：`type: "injects"`，`provenance: "extracted"`，`weight` 0.5（与 `references` 相同）。消费者类与目标类相同时也画边。Spring 允许把同类的另一个 bean 注入进来，图本身也允许自环。
- 每个成边的注入点一条证据：
  ```
  { file, line, source: "lexical", token, site,
    consumer: { line, bindings: [{ file, line, binder }] },
    bindings: [{ file, line, binder }] }
  ```
  - `consumer.bindings` 是消费者经继承解析时经过的绑定处；消费者自己写了类时为空。
  - `bindings` 是目标解析经过的全部绑定处：名字直接命中的、别名所名的、继承所名的。按文件、行、绑定器排序去重。
- 同一条边的证据按文件、行、`token`、`site` 排序去重。
- `validate-graph.mjs` 对 `injects` 要求证据行包含 `token`。证据文件是 XML，不是边两端的源文件，所以期望 token 取证据的 `token`，与 `mentions`、`references` 相同。
- `retrieve.mjs` 把 `injects` 加入 `DETERMINISTIC_EDGE_TYPES`。
- 被否决的方案：
  - XML 文件 → 目标类的 `references`：丢掉消费者，问不出「谁被注入了谁」。一个 XML 文件里常有几十个 bean。
  - bean 定义节点：要新增节点类型与 id 规则，消费者问的是类之间的依赖。
  - 复用 `depends_on`：它是模型推断的边类型，确定性边不能和推断边共用类型，否则按类型过滤会混在一起。

**D8：覆盖、缺口与守恒。**

`coverage.injections` 的字段：

- `status`
- `files`：按注入族计
- `sites`：按注入点 id 计，每个 id 都列出，没有的记 0
- `buckets`：十四个桶
- `siteCount`
- `uncovered`：普查未读，按键计，键按字典序

缺口及其覆盖的桶：

| 缺口 | 桶 | 样例 |
|---|---|---|
| `injection-target-unresolved` | `outside`、`unindexed`、`unknown` | 写出原因：静态不可见、未建索引的类名、未知的原因 |
| `injection-ambiguous` | `ambiguous` | 列出候选 |
| `injection-elsewhere` | `elsewhere` | 列出候选单元与命名空间 |
| `injection-unbound` | `unbound` | — |
| `injection-consumer-unresolved` | 四个消费者桶 | 写出是哪一种 |

- 样例的形式：`<文件>:<行> <名字> -> [<候选或原因>]`。缺口按 XML 文件的语言分 scope。
- 守恒有两条：十四个桶之和等于 `siteCount`；五类缺口回读的计数等于对应桶之和。任一不等，构建失败。
- 没有收到站点与目录时，`injections.status` 为 `not-run`。

**D9：阶段与接口。**

- `collectNameReferenceSites` 的返回值新增：
  - `injections`：注入点行；
  - `injectionFiles`：按注入族计的文件数；
  - `uncoveredReferences`：普查未读计数。

  文件仍然只读一次、只解析一次。
- `name-reference-resolution.mjs` 抽出 `buildNameBindingTable`，产出绑定表与 D3 的目标解析器。`resolveNameReferences` 改为接收这张表。新模块 `xml-injection-resolution.mjs` 的 `resolveXmlInjections` 也接收它。两者都提供 `mutations` 测试接口。
- `buildFactGraph` 在同一处构建一次表，依次跑 EL 与注入，各自写覆盖段与守恒。lazy 阶段名不变，仍是 `nameReferences`。

**D10：版本。**

- `PIPELINE_VERSION` 升到 `lazy-fact-graph/8`，目录 `version` 升到 2。
- 冻结摘要用生成器整块重冻，不逐字段补。

**D11：变异绊线（先验装置）。**

`mutations` 提供以下开关，每个都必须让至少一条测试变红：

- `injectionIgnoreUnits`：注入点跨单元匹配；
- `injectionFirstBinding`：歧义时取第一个；
- `ignoreFileScope`：`scope: file` 当作单元；
- `noAliases`：别名绑定不解析，当作没有目标；
- `noInheritance`：忽略 `inheritFrom`；
- `ignoreUnknownWhen`：工厂方法定义仍按 `class` 解析；
- `outermostConsumer`：取最外层而不是最近的消费者元素；
- `anyRootNamespace`：不查注入族的 `rootNamespace`；
- `noCensus`：不记普查未读。

第 2 步的十条绊线保留，并在共用的绑定表上重跑。

## 验收 Oracle（动手前写死）

语料都在 `excavator-test-repos/` 下，固定提交；源码、路径、输出不提交：

| 语料 | 提交 | 用途 |
|---|---|---|
| Sakai 12.7 | `5e75448885a8484fceea955509fc786bc99bfff4` | 注入主语料：3,740 个注入点，441 个单元，点分 id，别名，工厂方法，`lookup-method` |
| OSCAR | `0c61438fad7075bb8e17943e41f16caf85c7f52c` | 高成边率语料，`ref local`，无命名空间的 DTD 文件 |
| OpenMRS core | `142b13f4daa67fb2fd4cbb08e599d1d720ce062b` | 工厂方法消费者，测试上下文，注解声明的目标 |
| Dataverse、Seam 2.2 examples、Cargo Tracker、TomEE 8.x examples | 同第 2 步验收 | 第 2 步 EL 回归 |
| go-multirepo、mixed-suite、hadoop（`2014707f8c31a620bffb4256d7f67245de5b94a3`）、fineract（`f9c2fcdc1c02bdad3b3387f1385391d9ececaea7`） | 固定检出 | 不回归 |
| Sakai `master`（`10a1d904d379df3cb2371ee0e405a4c2d1060588`）、hadoop | 同上 | 耗时 |

- **O1 夹具与绊线**（coder 写，acceptor 审）：
  - 规格的每个场景一条测试。
  - 新夹具 `tests/fixtures/spring-xml-injection/`，至少含以下内容：
    - 两个带描述符的单元，外加一个无描述符的仓库单元文件；
    - Spring 命名空间文件、DTD 形式无命名空间的文件、命名空间为 Java EE 的 `beans.xml`（里面写 `ref`）；
    - 全部 11 种注入点；
    - 内部 bean、集合里的 `<ref>`、顶层 `<util:list>`；
    - 别名、别名成环、别名到别的单元的名字；
    - 只写 `parent` 的目标与消费者，父定义不在本单元；
    - 工厂方法定义作目标与作消费者；
    - 点分 bean id；注解声明的目标；同单元同名不同类；消费者与目标都在仓库外；
    - `idref`、带前缀的 `custom-filter@ref`、空的 `ref=""`、注释掉的注入点；
    - 第 2 步夹具里加一个桥接单元，含工厂方法定义、只写 `parent` 的定义与别名，各被一个 EL 根名使用。
  - 断言精确的边列表、证据、十四个桶与普查计数。D11 的每个变异至少让一条测试变红。
- **O2 全量精度审计**（acceptor 独立实现，不复用被测代码）：
  - 对 Sakai 12.7、OSCAR、OpenMRS core 每条 `injects` 边的每条证据：读快照中的 XML 行，要求某个注入点属性的值等于 `token`；读每个绑定处的行，要求含该绑定的名字或是产生缺省名的注解。
  - 按规格独立重算消费者类与目标类，要求与边一致。不一致数必须为 0。
  - 装置先验：往图谱副本里注入四种错，审计必须全部报出：一条错目标的边、一条错行号的证据、一条跨单元的边、一条把外层 bean 当消费者的边。
- **O3 桶与普查对账**（acceptor 独立脚本）：
  - 每个语料的十四个桶与独立重算逐桶一致；
  - 按注入点 id 的计数与普查未读计数，与独立的 XML 统计一致（同样遮蔽注释）。
- **O4 不回归**：go-multirepo、mixed-suite、hadoop、fineract 各自与同一检出、`lazy-fact-graph/7` 的基线对比：
  - 节点集合、非 `injects` 边集合、既有缺口完全一致；
  - 覆盖只多 `injections` 一段，以及 `nameReferences` 的 `bindings` 与 `missingNames` 各一个 `spring-xml-alias` 键；
  - 新增的 `injects` 边与缺口逐语料列出计数，每一个都说明来源。
- **O4b 第 2 步回归**：Dataverse、Sakai 12.7、Seam 2.2 examples、Cargo Tracker、TomEE 8.x examples 各自与同一快照、`lazy-fact-graph/7` 的基线对比：
  - 节点与非 `injects` 边一致；
  - `references` 边的证据与 `nameReferences` 的桶一致，差异只能来自 D3 的三条规则，每个差异根名逐条列出原因；
  - 由工厂方法规则消失的 `references` 边逐条列出，并读原文确认是错归属。
- **O5 耗时**：Sakai `master` 与 hadoop 的 Lazy 总耗时，与同一会话、同一提交新测的 `/7` 基线相比，增幅不超过 10%（各取 3 次中位数）。`nameReferences` 阶段单独报告。
- **O6 分层人工抽查**（acceptor，三个注入语料）：
  - 成边：每个注入点 id 随机 10 条，不足全抽；
  - 以下层全抽，每层上限 30：消费者经继承、目标经别名、目标经注解、`spring-ref-local`、内部 bean 消费者、元素有命名空间前缀的注入点；
  - 每类缺口随机 20 条样例，不足全读；随机 20 条「他处」、20 条「无绑定」与 10 条「消费者在仓库外」，查有没有本该成边的；
  - 编造计数必须为 0。漏边单独计数并归因。
- **预先承诺的退路**（抽查发现编造时直接执行，不再讨论）：
  - **F1**：编造来自注解声明的目标，即类上有构造型注解、却不在任何组件扫描范围内：注入点只认 XML 绑定，只命中注解绑定的注入点落新桶 `annotationOnly`，记为缺口。
  - **F2**：编造来自主源注入点解析到测试源里的同名绑定：目录新增测试源目录模式（数据），主源注入点不看测试源绑定，只命中测试源绑定的注入点落「他处」。
  - **其它来源**：先改源头，并补一条先红后绿的夹具测试，再重跑 O2 与 O6。
- **O7 真实 MCP**：对 OSCAR 起 stdio MCP，调用全部工具：
  - 从一个只经 XML 装配的 DAO 实现类做 1 跳入边遍历，经 `injects` 到达注入它的服务类；
  - `read_evidence` 对该边返回 XML 原行；
  - `project_status` 报出 `injections` 覆盖与新缺口；
  - `recall` 不受影响。
- **O8 全量门**（我跑）：三件套、`openspec validate --all --strict`、`node scripts/check-refs.mjs`。本变更不改 Core，core 测试与 typecheck 不在门内；但要核对 core dist 与主线一致。

## Risks / Trade-offs

- **单元不等于 Spring 上下文。** 一个单元里可能有几个互不加载的上下文，比如两个 DispatcherServlet，或者主上下文与测试上下文。一个上下文里的 `ref` 可能解析到另一个上下文里的同名定义。
  - 同名不同类时落歧义，不会编造。
  - 剩下的风险是：A 上下文引用的名字只在 B 上下文里声明，运行时会启动失败，也就是死配置。三个语料中主源只命中测试源绑定的成边为 0，F2 兜底。
  - 读 `<import>` 与 `contextConfigLocation` 来划分上下文，属于后续步骤。
- **跨模块的 bean 落「他处」。** Sakai 有 1,845 个注入点要等按模块依赖放开可见性的步骤。共享 kernel 在运行时对所有模块可见，这是 Sakai 自己的组件管理器做的，不是 Spring 的通用语义。
- **定义级语义。** FactoryBean 定义的边指向 FactoryBean 类，不是它的产物；代理工厂（如 `TransactionProxyFactoryBean`）多在仓库外，落「消费者在仓库外」或「仓库外」。证据里的注入点 id 让消费者可以按需过滤。
- **注解声明的目标不核对组件扫描范围。** 一个带 `@Service("x")` 的类只有在被扫描到时才是 bean；XML 引用了 `x`，又只有这个类声明了 `x`，说明它很可能被扫描到。O6 设「目标经注解」一层，F1 兜底。
- **JSR-330 `@Named` 也可以是 Spring 组件**，但它在目录里属于 `el` 命名空间。只被 `@Named` 声明的名字，对 Spring 注入点落「他处」，样例写明命名空间。是否由 Spring 扫描要看配置，静态判定不了。
- **按本地名匹配元素。** 别的命名空间里同名的元素（如 `lang:property ref`）也会被读成注入点，结果通常是「消费者缺失」，可见、不编造。O6 设「元素有命名空间前缀」一层。
- **第 2 步的 EL 结果会变。** 变化只在声明了 Spring 桥接的单元，O4b 逐条列出。工厂方法规则会去掉一些 `references` 边，去掉的是错归属。
- **抽象模板的属性不展开到子定义。** 子定义的类拿不到父模板上注入的依赖，计入「消费者未知」。Sakai 2 处。

## Migration Plan

升版本号后，已有产物在下次 Lazy / `sync_facts` 时整体重投影，不需要迁移脚本。目录版本号随代码一起升，没有外部的目录使用者。回滚时按步 revert 对应 commit。
