## ADDED Requirements

### Requirement: 名字绑定

系统 SHALL 只依据一份声明式的名字绑定目录，从仓库文件中读出「名字 → 目标」的绑定。目录是数据，不是代码分支，内容包括：

- XML 绑定器：根元素与可选的根命名空间、元素、直接父元素、名字来源（子元素文本或属性，可为个别属性声明别名分隔符）、目标来源与目标种类（类或资源包）、缺少目标时的含义（目标未知，或配置别处声明的同名组件）；
- 注解绑定器：注解全限定名、读名字的参数键、缺省名规则；
- 两种绑定器都声明点分名是否按命名空间解析；
- 表达式语言：分隔符、文件类别（含整篇作为模板文本扫描的扩展名）、隐式名字、声明局部名的属性（可限定元素及其命名空间，可声明属性值里表达式的根名为局部名）、可见命名空间及其条件；
- 部署单元描述符的文件名。

每个绑定器 SHALL 带 id、命名空间与一句依据说明。目录出现未知键、缺少字段或类型不符时，加载 MUST 失败，不得带着部分目录运行。

注解绑定：

- 注解的身份 SHALL 按 Java 作用域规则确认，依次为：全限定写法、单类型导入、仓库在同包声明的同名类型、恰好一个提供目录内注解的按需导入。确认结果在目录里的才产生绑定。写法与目录中某个简单名相同、却没有确认的注解，SHALL 按写法计数。
- 名字取注解的字符串字面量参数。参数缺省或为空串时，按绑定器的缺省名规则从类的简单名推出。参数不是字符串字面量时，MUST NOT 产生绑定，SHALL 计数。缺省名规则为空、又没写名字的，同样计数。

XML 绑定：

- 名字与目标取自所声明的子元素文本或属性值，去掉首尾空白。分隔符只拆分为其声明的属性；同一元素的相同名字只算一次。
- 直接父元素不符的元素（如嵌在属性里的内部 bean）MUST NOT 产生绑定。
- 没有名字的元素 MUST NOT 产生绑定，SHALL 按绑定器计入缺名计数。
- 有名字却没有目标的元素，SHALL 产生目标未知的绑定；绑定器声明其含义为配置时，该绑定标为配置。

名字是 EL 标识符的，进入绑定表。点分名每段都是 EL 标识符、且绑定器声明按命名空间解析的，作为命名空间名进入绑定表。其余名字 SHALL 计数，并且不参与匹配。

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

#### Scenario: 只有 parent 的 bean 定义
- **WHEN** Spring XML 根元素下有 `<bean id="child" parent="base"/>`，没有 `class`
- **THEN** 产生名字 `child`、目标未知的绑定

#### Scenario: 匿名 bean 不产生绑定
- **WHEN** Spring XML 根元素下有 `<bean class="com.acme.Audit"/>`，没有 `id` 与 `name`
- **THEN** 不产生绑定，Spring XML 绑定器的缺名计数加一

#### Scenario: id 不按别名分隔符拆分
- **WHEN** Spring XML 写 `<bean id="a;b" name="c d" class="com.acme.X"/>`
- **THEN** 绑定名为 `a;b`（非标识符，计数）、`c`、`d`，没有 `a` 与 `b`

#### Scenario: 目录格式错误
- **WHEN** 名字绑定目录里有一个绑定器多了一个未定义的键
- **THEN** 加载失败并指出该键，分析不继续

### Requirement: EL 名字引用生成 references 边

系统 SHALL 对目录中表达式语言覆盖的每个文件做 EL 词法扫描。文件按扩展名，或按 XML 根元素及其命名空间判定。扫描规则：

- 取出每个 `#{…}` 与 `${…}` 内的根名，以及紧随其后的 `.标识符` 成员链。每个根名带原文件行号。
- 标记语言注释、JSP 脚本段中的文本 MUST NOT 产生根名。XML 形式的文件，表达式在所在的属性值或标签之间的文本段内定界，落在文本段之外的分隔符不产生根名，SHALL 计数；目录声明为模板文本的文件整篇作为一个文本段。分隔符前是反斜杠的、在所在文本段内未闭合的，都不产生根名，分别计数；未闭合时从该分隔符之后继续扫描。任何分隔符 MUST NOT 既不产生根名、又不被计数。
- 关键字、点号之后的标识符、函数前缀与函数名、字符串字面量与数字字面量里的字母都不是根名。表达式中的 XML 实体与字符引用（如 `&amp;`）按其代表的字符处理，不产生标识符。

每个根名 SHALL 按以下顺序落入且只落入一个桶：

1. **局部**：本文件中由目录声明的局部名属性（如 `var`、`varStatus`）声明的名字，或本表达式内的 lambda 参数。限定了元素命名空间的声明，只在元素前缀经本文件的 `xmlns` 或 JSP `taglib` 指令绑定到所列命名空间时生效。
2. **隐式**：目录为该表达式语言列出的隐式名字。
3. 候选名字为根名，以及成员链的每个点分前缀。取本单元内、该语言此处可见的命名空间里名字等于某个候选的绑定：
   - 命中的绑定分属不止一个候选名字：**歧义**；
   - 否则，有已知目标的绑定时，标为配置的目标未知绑定不参与归类；
   - 再按目标归类。全部指向同一个仓库类节点：**成边**；
   - 全部为资源包：**资源包**；
   - 全部指向同一个仓库外的类：**仓库外**；
   - 全部指向同一个仓库里有声明但不是节点的类：**未建索引**；
   - 全部目标未知：**目标未知**；
   - 其余情形：**歧义**。
4. **他处**：本单元不可见，但其它单元或不可见的命名空间里有名字等于某个候选的绑定。
5. **无绑定**。

只有成边的根名生成边：每个（文件，类）一条从该文件的 file 节点指向类 class 节点的 `references` 边。未建索引、目标未知、歧义、他处、无绑定 SHALL 分别记入缺口 `name-reference-target-unindexed`、`name-reference-target-unknown`、`name-reference-ambiguous`、`name-reference-elsewhere`、`name-reference-unbound`。歧义与他处的样例 SHALL 列出候选。MUST NOT 为了成边而放宽到其它单元、其它命名空间、第一个候选或最短的候选名字。

覆盖 SHALL 写入以下内容：

- 扫描文件数（按语言）与单元数；
- 绑定数（按绑定器），以及非字面量、缺名、非标识符名、未确认注解的计数；
- 十个桶的计数，以及转义、未闭合与文本段外分隔符的计数；
- 落隐式、但本单元可见命名空间里另有同名绑定的根名数；
- 含 `#{` 却不在表达式文件范围内的非代码文件：`.xml` 文件按根元素计数，其余按扩展名计数。

十个桶之和 SHALL 等于根名总数，五类缺口回读的计数 SHALL 等于对应桶；任一不等时构建失败。扫描未运行时，覆盖 SHALL 明示未运行。

#### Scenario: 页面用到 faces-config 声明的 bean
- **WHEN** 同一单元内 `orders/list.xhtml` 第 8 行写 `#{orders.save}`，且该单元只有一个 `orders` 绑定，指向 `OrderBean`
- **THEN** 生成 `list.xhtml` 的 file 节点到 `OrderBean` class 节点的 `references` 边，证据含第 8 行、根名 `orders`、成员链 `orders.save` 与绑定处

#### Scenario: 只被页面使用的 bean 有入边
- **WHEN** 一个带 `@Named` 的类没有任何 Java 调用方，只在一个页面的 EL 里被使用
- **THEN** 该类有一条来自该页面的 `references` 入边

#### Scenario: 循环变量不是 bean
- **WHEN** 页面写 `<ui:repeat value="#{orders.items}" var="item">`，并在其中使用 `#{item.price}`，同一单元恰有一个名为 `item` 的 bean
- **THEN** `item` 落局部，不生成指向该 bean 的边

#### Scenario: 请求参数名不是局部名
- **WHEN** Facelets 页面声明 `xmlns:f="http://xmlns.jcp.org/jsf/core"`，写 `<f:param name="cart" value="#{orderId}"/>`，并在别处写 `#{cart.total}`，同一单元恰有一个 `cart` 绑定
- **THEN** `cart` 不落局部，生成指向该 bean 类的边

#### Scenario: 别名标签声明的名字是局部名
- **WHEN** JSP 页面以 `<%@ taglib prefix="t" uri="http://myfaces.apache.org/tomahawk" %>` 引入 Tomahawk，写 `<t:aliasBean alias="#{bean}" value="#{orders}">` 与 `#{bean.save}`，同一单元有名为 `bean` 的绑定
- **THEN** 两处 `bean` 都落局部，不生成指向名为 `bean` 的类的边；`orders` 按绑定解析

#### Scenario: 点分名按成员链前缀匹配
- **WHEN** 类带 `@jakarta.inject.Named("admin.track")`，同一单元的页面写 `#{admin.track.trackingId}`
- **THEN** 生成指向该类的 `references` 边，证据的 `token` 为 `admin`，命中的绑定名为 `admin.track`

#### Scenario: 根名与点分名同时命中
- **WHEN** 同一单元同时有名为 `admin` 与 `admin.track` 的绑定，页面写 `#{admin.track.trackingId}`
- **THEN** 不生成边，记入 `name-reference-ambiguous`，样例列出两个名字

#### Scenario: 不按命名空间解析的点分名访问不到
- **WHEN** Spring XML 有 `<bean id="admin.track" class="com.acme.Track"/>`，单元已声明 Spring 的 EL 解析器，页面写 `#{admin.track.x}`
- **THEN** 不生成边；该名字计入非标识符名计数

#### Scenario: 配置型组件让位于注解声明的同名组件
- **WHEN** Seam `components.xml` 写 `<component name="numberGuess">`，不写 `class`；同一单元的类带 `@Name("numberGuess")`；页面写 `#{numberGuess.guess}`
- **THEN** 生成指向该类的边，证据的绑定处同时列出 `components.xml` 与注解所在行

#### Scenario: 目标未知的 Spring bean 与同名注解并存为歧义
- **WHEN** 单元已声明 Spring 的 EL 解析器，Spring XML 有 `<bean id="report" parent="base"/>`，同单元的类带 `@Component("report")`，页面写 `#{report.run}`
- **THEN** 不生成边，记入 `name-reference-ambiguous`

#### Scenario: 经典 JSP 属性值里嵌套的动作
- **WHEN** JSP 页面写 `<div title="<h:outputText value="#{mailer.subject}"/>">`，同一单元恰有一个 `mailer` 绑定
- **THEN** 产生根名 `mailer`，生成指向该 bean 类的边

#### Scenario: XML 形式文件里标签语法中的分隔符可见
- **WHEN** Facelets 页面写 `<p #{stray.x} class="#{ok.y}">`
- **THEN** 只有 `ok` 是根名，文本段外分隔符计数加一

#### Scenario: 未闭合的表达式不吞掉后文
- **WHEN** 页面第 3 行写 `#{orders.title`，没有 `}`，第 9 行写 `#{cart.total}`
- **THEN** 未闭合计数加一，第 9 行产生根名 `cart`

#### Scenario: 隐式对象优先于同名 bean
- **WHEN** 页面写 `#{param.id}`，同一单元有名为 `param` 的绑定
- **THEN** `param` 落隐式，不生成边，隐式与绑定并存的计数加一

#### Scenario: 其它单元的同名 bean 不成边
- **WHEN** 单元 A 的页面写 `#{remote.x}`，只有单元 B 声明了 `remote`
- **THEN** 不生成边，记入 `name-reference-elsewhere`，样例列出单元 B

#### Scenario: 没有桥接时 Spring bean 对 EL 不可见
- **WHEN** 单元内 Spring XML 声明了 bean `orderService`，页面写 `#{orderService.count}`，且该单元的 faces-config 没有声明 Spring 的 EL 解析器
- **THEN** 不生成边，记入 `name-reference-elsewhere`

#### Scenario: 桥接后 Spring bean 对 EL 可见
- **WHEN** 同样的 bean 与页面，该单元的 faces-config 在 `el-resolver` 中声明了 `org.springframework.web.jsf.el.SpringBeanFacesELResolver`
- **THEN** 生成指向该 bean 类的 `references` 边

#### Scenario: 同名绑定指向不同的类
- **WHEN** 同一单元的主源与测试源各有一个 `@Name("paymentHome")`，指向两个不同的类，页面写 `#{paymentHome.pay}`
- **THEN** 不生成边，记入 `name-reference-ambiguous`，样例列出两个类

#### Scenario: 注释与转义里的表达式不算
- **WHEN** 页面写 `<!-- #{orders.secret} -->` 与 `\#{orders.raw}`
- **THEN** 两处都不产生根名，转义计数加一

#### Scenario: 函数与三元运算
- **WHEN** 页面写 `#{fn:length(orders.items) gt 0 ? cart.total : 0}`
- **THEN** 根名为 `orders` 与 `cart`；`fn`、`length`、`items`、`total` 都不是根名

#### Scenario: 属性值里的实体引用
- **WHEN** 页面属性写 `rendered="#{orders.open &amp;&amp; not cart.empty}"`
- **THEN** 根名为 `orders` 与 `cart`，`amp` 不是根名

#### Scenario: 不在表达式文件范围内的 EL 可见
- **WHEN** 一个 `.html` 文件含 `#{home.title}`
- **THEN** 不产生根名，覆盖中 `html` 的目录外文件计数加一

#### Scenario: 阶段未运行
- **WHEN** 投影没有收到 EL 站点与名字绑定目录
- **THEN** 覆盖记未运行，不生成 `references` 边，也不产生 `name-reference-*` 缺口

### Requirement: references 边的证据与遍历

`references` 边的每条证据 SHALL 含以下内容：

- 引用所在行；
- 根名（`token`）、成员链与命中的绑定名；
- 产生该绑定的每个绑定处（文件、行、绑定器 id）。

图谱验证 SHALL 要求被引行包含 `token`。`references` SHALL 属于可遍历的确定性边类型：从 bean 类沿入边，能有界地遍历到使用它的页面。`references` 与 `mentions` 是两种边类型，同一对文件与类可以同时有两种边。

#### Scenario: 证据可复核
- **WHEN** 一条 `references` 边的证据指向第 8 行、`token` 为 `orders`
- **THEN** 快照中该文件第 8 行含 `orders`；证据里的绑定处那一行含 `orders` 的声明，或含产生缺省名的注解

#### Scenario: 从 bean 类遍历到页面
- **WHEN** 从 `OrderBean` 的 class 节点做 1 跳入边遍历
- **THEN** 结果包含经 `references` 到达的 `orders/list.xhtml`
