## MODIFIED Requirements

### Requirement: 名字绑定

系统 SHALL 只依据一份声明式的名字绑定目录，从仓库文件中读出「名字 → 目标」的绑定。目录是数据，不是代码分支，内容包括：

- XML 绑定器：
  - 根元素与可选的根命名空间。根命名空间列表里的 `null` 表示根元素没有声明命名空间。
  - 元素与直接父元素。
  - 名字来源：子元素文本或属性，可为个别属性声明别名分隔符。
  - 目标来源与目标种类：类、资源包，或名字（把名字转给另一个名字）。
  - 可选的目标规则：带有所列属性之一时目标未知；没有目标时，从某个属性所名的绑定继承目标。
  - 缺少目标时的含义：目标未知，或配置别处声明的同名组件。
- 注解绑定器：注解全限定名、读名字的参数键、缺省名规则；
- 两种绑定器都声明点分名是否按命名空间解析；
- 表达式语言：分隔符、文件类别（含整篇作为模板文本扫描的扩展名）、隐式名字、声明局部名的属性（可限定元素及其命名空间，可声明属性值里表达式的根名为局部名）、可见命名空间及其条件；
- XML 注入族，见「XML 注入点」；
- 部署单元描述符的文件名。

每个绑定器与注入族 SHALL 带 id、命名空间与一句依据说明。目录出现未知键、缺少字段或类型不符时，加载 MUST 失败，不得带着部分目录运行。

注解绑定：

- 注解的身份 SHALL 按 Java 作用域规则确认，依次为：全限定写法、单类型导入、仓库在同包声明的同名类型、恰好一个提供目录内注解的按需导入。确认结果在目录里的才产生绑定。写法与目录中某个简单名相同、却没有确认的注解，SHALL 按写法计数。
- 名字取注解的字符串字面量参数。参数缺省或为空串时，按绑定器的缺省名规则从类的简单名推出。参数不是字符串字面量时，MUST NOT 产生绑定，SHALL 计数。缺省名规则为空、又没写名字的，同样计数。

XML 绑定：

- 名字与目标取自所声明的子元素文本或属性值，去掉首尾空白。分隔符只拆分为其声明的属性；同一元素的相同名字只算一次。
- 直接父元素不符的元素（如嵌在属性里的内部 bean）MUST NOT 产生绑定。
- 没有名字的元素 MUST NOT 产生绑定，SHALL 按绑定器计入缺名计数。
- 元素带有目标规则所列属性之一时（如 Spring 的 `factory-method`、`factory-bean`），绑定的目标 SHALL 为未知，即使元素写了类。这时写出的类是工厂，不是绑定对象的类。
- 有名字却没有目标的元素，SHALL 产生没有目标的绑定；绑定器声明其含义为配置时，该绑定标为配置。

绑定的目标在全部绑定读出后解析，每个绑定落到以下之一：仓库里有节点的类、仓库外的类、仓库有声明却没有节点的类、资源包、未知、歧义。

- 没有目标、而目标规则声明了继承属性、元素也写了该属性的绑定（如 Spring 只写 `parent` 的 bean），SHALL 取同单元、同命名空间里该属性所名的绑定的解析结果。
- 种类为名字的绑定（如 Spring `<alias>`），同样取所名绑定的解析结果。
- 所名的名字在同单元、同命名空间里没有绑定，或解析成环时，结果 SHALL 为未知；所名的名字有多个结果不一致的绑定时，结果为歧义。

所有名字都进入绑定表。EL 匹配时只用以下名字：EL 标识符；点分名每段都是 EL 标识符、且绑定器声明按命名空间解析的，作为命名空间名。其余名字 SHALL 计入非标识符名计数，并且不参与 EL 匹配。XML 注入点按名字原样匹配，不受此限。

每个文件属于一个部署单元：最近的、含目录所列描述符文件的祖先目录；没有这样祖先的文件属于仓库单元。XML 绑定属于描述符文件所在的单元，注解绑定属于类文件所在的单元。

#### Scenario: faces-config 声明的 managed bean
- **WHEN** 某单元的 `faces-config.xml` 在根元素下声明 `<managed-bean><managed-bean-name>orders</managed-bean-name><managed-bean-class>com.acme.web.OrderBean</managed-bean-class></managed-bean>`
- **THEN** 该单元有绑定 `orders` → `com.acme.web.OrderBean` 的 class 节点，证据为名字所在行

#### Scenario: CDI 缺省名
- **WHEN** 类 `com.acme.web.CustomerBean` 写了 `import javax.inject.Named;` 与 `@Named`，没有参数
- **THEN** 产生绑定 `customerBean` → 该类

#### Scenario: Spring 缺省名保留连续大写
- **WHEN** 类 `URLHelper` 带 `@org.springframework.stereotype.Component`，没有参数
- **THEN** 产生绑定 `URLHelper`，不是 `uRLHelper`

#### Scenario: 同名的自定义注解不算绑定
- **WHEN** 仓库在类所在的包里声明了自己的注解类型 `Named`，类上写 `@Named("x")`，且没有导入 `javax.inject.Named`
- **THEN** 该注解确认为仓库自己的 `Named`，不产生绑定

#### Scenario: 无法确认的注解
- **WHEN** 类上写 `@Named("x")`，文件只有按需导入 `import com.google.inject.name.*;`，同包也没有 `Named`
- **THEN** 不产生绑定，`Named` 计入未确认注解计数

#### Scenario: 非字面量名字
- **WHEN** 类上写 `@Named(Names.ORDERS)`
- **THEN** 不产生绑定，计入非字面量名字计数

#### Scenario: Spring 内部 bean 的 id 不是名字
- **WHEN** Spring XML 在 `<property>` 内嵌套 `<bean id="inner" class="com.acme.Inner"/>`
- **THEN** 不产生 `inner` 的绑定

#### Scenario: 只有 parent 的 bean 继承父定义的类
- **WHEN** 同一单元的 Spring XML 根元素下有 `<bean id="base" class="com.acme.BaseDao"/>` 与 `<bean id="child" parent="base"/>`，`child` 没有 `class`
- **THEN** 绑定 `child` 的目标解析为 `com.acme.BaseDao` 的 class 节点

#### Scenario: 只有 parent 的 bean 定义
- **WHEN** Spring XML 根元素下有 `<bean id="child" parent="base"/>`，没有 `class`，本单元也没有名为 `base` 的 Spring 绑定
- **THEN** 绑定 `child` 的目标为未知

#### Scenario: 工厂方法定义的目标未知
- **WHEN** Spring XML 根元素下有 `<bean id="svc" class="com.acme.ServiceLocator" factory-method="lookup"/>`
- **THEN** 绑定 `svc` 的目标为未知，不是 `com.acme.ServiceLocator`

#### Scenario: 别名解析到所名的定义
- **WHEN** 同一单元有 `<bean id="orderDao" class="com.acme.OrderDaoImpl"/>` 与 `<alias name="orderDao" alias="orders"/>`
- **THEN** 绑定 `orders` 的目标解析为 `com.acme.OrderDaoImpl` 的 class 节点

#### Scenario: 别名成环时目标未知
- **WHEN** 同一单元有 `<alias name="a" alias="b"/>` 与 `<alias name="b" alias="a"/>`，没有别的 `a` 或 `b` 绑定
- **THEN** 绑定 `a` 与 `b` 的目标都为未知，解析终止

#### Scenario: 匿名 bean 不产生绑定
- **WHEN** Spring XML 根元素下有 `<bean class="com.acme.Audit"/>`，没有 `id` 与 `name`
- **THEN** 不产生绑定，Spring XML 绑定器的缺名计数加一

#### Scenario: id 不按别名分隔符拆分
- **WHEN** Spring XML 写 `<bean id="a;b" name="c d" class="com.acme.X"/>`
- **THEN** 绑定名为 `a;b`、`c`、`d`，没有 `a` 与 `b`；`a;b` 计入非标识符名计数，EL 匹配不到它

#### Scenario: 点分 bean id 可被注入点匹配
- **WHEN** Spring XML 写 `<bean id="com.acme.api.OrderService" class="com.acme.impl.OrderServiceImpl"/>`
- **THEN** 该名字进入绑定表；EL 匹配不到它，并计入非标识符名计数；同单元写 `ref="com.acme.api.OrderService"` 的注入点能匹配到它

#### Scenario: 目录格式错误
- **WHEN** 名字绑定目录里有一个绑定器多了一个未定义的键
- **THEN** 加载失败并指出该键，分析不继续

## ADDED Requirements

### Requirement: XML 注入点

系统 SHALL 按目录的 XML 注入族，从根元素命中的 XML 文件里读出注入点，并把每个注入点解析成一条 `injects` 边或一个可见桶。根元素按本地名与根命名空间匹配：根命名空间不在列表里的文件（如命名空间为 Java EE 的 CDI `beans.xml`）MUST NOT 被当作注入族读取。标记语言注释里的内容不算。

注入族声明：

- 注入点：元素本地名加属性名，或者属性所在命名空间加属性名后缀（如 Spring `p:` 与 `c:` 命名空间里以 `-ref` 结尾的属性）。每个注入点有 id，并声明名字的可见范围：
  - 单元：同单元、注入族命名空间里的绑定；
  - 本文件：只看同一文件里的绑定，如 `<ref local>`；
  - 静态不可见：名字在父容器等静态读取看不到的地方，如 `<ref parent>`。
- 消费者元素本地名，以及读消费者类所用的 XML 绑定器。消费者类按该绑定器的目标规则读，包括目标未知的条件与继承属性。
- 普查规则：哪些属性名、属性名后缀与元素算作引用形状。

每个注入点的名字是属性值去掉首尾空白后的原文，行号为该属性所在行。消费者是注入点所在元素自身或最近的祖先中，本地名为消费者元素的那一个；所以内部 bean 里的注入点，消费者是内部 bean。

普查规则命中、却没有任何注入点读取的引用形状，SHALL 按「元素本地名@属性名」计数，普查元素按元素本地名计数。例如 `<idref bean>` 只传名字字符串、不注入 bean，计为 `idref`。

每个注入点 SHALL 恰好落入一个桶，先看目标，目标落到仓库类之后再看消费者：

1. **静态不可见**：注入点声明名字静态不可见。
2. 取可见范围内、注入族命名空间里名字等于该名字的全部绑定，按「名字绑定」解析后的目标归类，规则与 EL 相同：
   - 全部是同一个仓库类：看消费者，见第 4 步；
   - 全部是资源包：**资源包**；
   - 全部是同一个仓库外的类：**仓库外**，不算缺口；
   - 全部是同一个已声明却没有节点的类：**目标未建索引**；
   - 全部目标未知：**目标未知**；
   - 其余：**歧义**。
3. 可见范围内没有这个名字时：别的单元、别的命名空间或本单元其它文件（可见范围为本文件时）里有这个名字，落**他处**；都没有，落**无绑定**。
4. 消费者：
   - 没有消费者元素（如顶层 `<util:list>` 里的 `<ref>`）：**消费者缺失**；
   - 消费者类为同一个仓库类：**成边**；
   - 仓库外的类：**消费者在仓库外**，不算缺口；
   - 未知：**消费者未知**，包括工厂方法定义，以及继承属性所名的定义在本单元没有绑定；
   - 已声明却没有节点：**消费者未建索引**；
   - 歧义：**消费者歧义**。

成边的注入点生成从消费者类节点指向目标类节点的 `injects` 边，每个（消费者类，目标类）一条。缺口如下：

| 缺口 | 对应的桶 |
|---|---|
| `injection-target-unresolved` | 静态不可见、目标未建索引、目标未知 |
| `injection-ambiguous` | 歧义 |
| `injection-elsewhere` | 他处 |
| `injection-unbound` | 无绑定 |
| `injection-consumer-unresolved` | 消费者缺失、消费者未知、消费者未建索引、消费者歧义 |

样例 SHALL 写出注入点的文件、行与名字，歧义与他处的样例列出候选。MUST NOT 为了成边而放宽到其它单元、其它命名空间、其它文件或第一个候选。

`coverage.injections` SHALL 给出：

- 运行状态；
- 按注入族计的已读文件数；
- 按注入点 id 计的注入点数；
- 十四个桶的计数与注入点总数；
- 普查未读计数。

守恒有两条：

- 十四个桶之和等于注入点总数；
- 五类缺口回读的计数分别等于对应桶之和。

任一不等，构建 MUST 失败。没有收到注入点与目录时，覆盖记 `not-run`。

#### Scenario: property 的 ref 成边
- **WHEN** 同一单元的 Spring XML 有 `<bean id="orderService" class="com.acme.OrderServiceImpl"><property name="dao" ref="orderDao"/></bean>` 与 `<bean id="orderDao" class="com.acme.OrderDaoImpl"/>`，两个类都在仓库里
- **THEN** 生成 `com.acme.OrderServiceImpl` → `com.acme.OrderDaoImpl` 的 `injects` 边，证据为 `ref="orderDao"` 所在行

#### Scenario: 集合里的 ref 消费者是最近的 bean
- **WHEN** `<bean class="com.acme.Router"><property name="handlers"><list><ref bean="orderHandler"/></list></property></bean>`，`orderHandler` 在本单元绑定到仓库类 `com.acme.OrderHandler`
- **THEN** 生成 `com.acme.Router` → `com.acme.OrderHandler` 的 `injects` 边

#### Scenario: 内部 bean 的注入点属于内部 bean
- **WHEN** `<bean id="a" class="com.acme.A"><property name="p"><bean class="com.acme.Inner"><property name="q" ref="x"/></bean></property></bean>`，`x` 绑定到仓库类 `com.acme.X`
- **THEN** 生成 `com.acme.Inner` → `com.acme.X` 的 `injects` 边，不生成 `com.acme.A` → `com.acme.X`

#### Scenario: p 命名空间的引用属性
- **WHEN** 根元素声明 `xmlns:p="http://www.springframework.org/schema/p"`，`<bean class="com.acme.Report" p:source-ref="orderDao"/>`
- **THEN** 该属性是一个注入点，消费者是它所在的 `<bean>`，生成 `com.acme.Report` → `orderDao` 的目标类的 `injects` 边

#### Scenario: 注解声明的目标
- **WHEN** 同一单元的类 `com.acme.JdbcOrderDao` 带 `@org.springframework.stereotype.Repository("orderDao")`，Spring XML 写 `<property name="dao" ref="orderDao"/>`，消费者是仓库类
- **THEN** 生成消费者类 → `com.acme.JdbcOrderDao` 的 `injects` 边，证据的绑定处为注解所在行

#### Scenario: 经别名的目标
- **WHEN** 同一单元有 `<bean id="orderDao" class="com.acme.OrderDaoImpl"/>`、`<alias name="orderDao" alias="orders"/>` 与消费者为仓库类的 `<property ref="orders"/>`
- **THEN** 生成消费者类 → `com.acme.OrderDaoImpl` 的 `injects` 边，证据的绑定处同时列出别名与 bean 定义

#### Scenario: ref local 只看本文件
- **WHEN** `<ref local="orderDao"/>` 所在文件没有 `orderDao`，同单元另一个文件有 `<bean id="orderDao" class="com.acme.OrderDaoImpl"/>`
- **THEN** 不生成边；该注入点落「他处」

#### Scenario: ref parent 静态不可见
- **WHEN** 注入点写 `<ref parent="orderDao"/>`
- **THEN** 不生成边；落「静态不可见」，记缺口 `injection-target-unresolved`

#### Scenario: 名字只在别的单元
- **WHEN** 单元 A 的 Spring XML 写 `ref="userDirectory"`，只有单元 B 声明了 `userDirectory`
- **THEN** 不生成边；落「他处」，样例列出单元 B

#### Scenario: 同名两个类为歧义
- **WHEN** 同一单元的两个 Spring XML 文件分别写 `<bean id="mailer" class="com.acme.SmtpMailer"/>` 与 `<bean id="mailer" class="com.acme.FakeMailer"/>`，另一处写 `ref="mailer"`
- **THEN** 不生成边；落「歧义」，样例列出两个类

#### Scenario: 目标在仓库外
- **WHEN** `ref="dataSource"` 所名的 bean 是 `<bean id="dataSource" class="org.apache.commons.dbcp.BasicDataSource"/>`，仓库里没有这个类
- **THEN** 不生成边、不记缺口；落「仓库外」

#### Scenario: 工厂方法定义作目标
- **WHEN** `ref="svc"` 所名的 bean 是 `<bean id="svc" class="com.acme.ServiceLocator" factory-method="lookup"/>`
- **THEN** 不生成边；落「目标未知」，记缺口 `injection-target-unresolved`

#### Scenario: 消费者继承父定义的类
- **WHEN** 同一单元有 `<bean id="baseDao" class="com.acme.BaseDao"/>` 与 `<bean id="userDao" parent="baseDao"><property name="ds" ref="mainDs"/></bean>`，`mainDs` 绑定到仓库类 `com.acme.MainDs`
- **THEN** 生成 `com.acme.BaseDao` → `com.acme.MainDs` 的 `injects` 边，证据的消费者处列出 `parent` 所名的定义

#### Scenario: 工厂方法定义作消费者
- **WHEN** `<bean id="ctx" class="com.acme.Context" factory-method="getInstance"><property name="dao" ref="orderDao"/></bean>`，`orderDao` 绑定到仓库类
- **THEN** 不生成边；落「消费者未知」，记缺口 `injection-consumer-unresolved`

#### Scenario: 没有外层 bean
- **WHEN** 根元素下的 `<util:list id="handlers">` 里写 `<ref bean="orderHandler"/>`，`orderHandler` 绑定到仓库类
- **THEN** 不生成边；落「消费者缺失」，记缺口 `injection-consumer-unresolved`

#### Scenario: 消费者在仓库外
- **WHEN** `<bean class="org.springframework.transaction.interceptor.TransactionProxyFactoryBean"><property name="target" ref="orderServiceTarget"/></bean>`，`orderServiceTarget` 绑定到仓库类
- **THEN** 不生成边、不记缺口；落「消费者在仓库外」

#### Scenario: 非 Spring 命名空间的 beans 根不读
- **WHEN** `beans.xml` 的根元素是 `<beans xmlns="http://xmlns.jcp.org/xml/ns/javaee">`，里面有 `ref` 属性
- **THEN** 该文件不产生注入点，也不进普查

#### Scenario: 普查记下没有读的引用形状
- **WHEN** Spring XML 里有 `<idref bean="orderDao"/>` 与 `<security:custom-filter ref="authFilter"/>`
- **THEN** 两处都不产生注入点；普查未读计数为 `idref` 1、`custom-filter@ref` 1

#### Scenario: 注释里的注入点不算
- **WHEN** Spring XML 里 `<!-- <property name="dao" ref="orderDao"/> -->`
- **THEN** 不产生注入点，也不进普查

#### Scenario: 守恒不平衡时构建失败
- **WHEN** 某个注入点没有落入任何桶，或某类缺口回读的计数与对应桶之和不等
- **THEN** 构建失败，不写出产物

### Requirement: injects 边的证据与遍历

`injects` 边 SHALL 带 `provenance: "extracted"`。每个成边的注入点一条证据，内容为：

- 注入点所在的 XML 文件与行；
- 名字（`token`）与注入点 id；
- 消费者元素所在行，以及消费者类经继承属性解析时经过的绑定处；
- 目标解析经过的全部绑定处：名字直接命中的绑定、别名所名的绑定与继承所名的绑定，每处给出文件、行与绑定器。

同一条边的证据按文件、行、名字与注入点 id 排序去重。图校验 SHALL 要求证据行包含 `token`。`injects` SHALL 属于可遍历的确定性边类型，可以从目标类沿入边找到被注入它的消费者类。

#### Scenario: 证据可复核
- **WHEN** 读 `injects` 边每条证据的文件与行
- **THEN** 该行含证据里的 `token`；证据里的每个绑定处所在行，含该绑定声明的名字，或是产生缺省名的注解

#### Scenario: 从被注入的类遍历到消费者
- **WHEN** 从 `com.acme.OrderDaoImpl` 的 class 节点做 1 跳入边遍历
- **THEN** 结果包含经 `injects` 到达的 `com.acme.OrderServiceImpl`

#### Scenario: 证据行不含名字时校验报出
- **WHEN** 一条 `injects` 边的证据行号被改成不含 `token` 的行
- **THEN** 图校验对这条边报出证据不符
