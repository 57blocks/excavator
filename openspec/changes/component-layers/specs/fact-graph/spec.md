## ADDED Requirements

### Requirement: 组件角色与所属层

系统 SHALL 按角色目录，给 Java 顶层类型确定组件角色，并按角色给出所属层，作为确定性事实记在类节点上。

角色目录是数据，不是代码分支。目录声明：
- 层次顺序：层 id 的列表与一句依据说明。一个类型有几个分属不同层的角色时，取顺序里最靠前的层。
- 每个角色：
  - id、一句依据说明、所属层（层次顺序里的一个 id）；
  - 注解：全限定名列表，可为空；可限定只认某些类型种类（如只认接口）；
  - 排除注解：类型上带有它们时，该角色的注解不算数（可为空）；
  - 描述符元素：每条写明根元素、元素、父元素，以及给出类名的子元素名，一个或多个（可为空）；
  - 绑定者：名字绑定目录里的绑定者 id。页面经 EL 绑定到某个类、且绑定来自这些绑定者时，该类有此角色（可为空）。

目录出现未知键、缺少字段、类型不符，或角色的层不在层次顺序里时，加载 MUST 失败。

角色的来源点有三种，每个来源点 SHALL 按顺序恰好落入一个桶。

注解来源点：顶层类型上一个经确认属于某角色的注解。身份按「名字绑定」的 Java 作用域规则确认；写法与目录注解的简单名相同、却没有确认的，按写法计数，不是来源点。桶依次为：
1. 类型种类不是该角色限定的种类，或类型上带有该角色的排除注解：**不适用**，不算缺口；
2. 类型没有类节点：**未建索引**；
3. 其余：**成角色**。

描述符来源点：根元素与目录相符的描述符里，父元素与元素都相符的元素中，每个出现的类名子元素是一个来源点。根元素按本地名匹配，不看命名空间（EJB 2.x 的描述符没有命名空间）。一个类名子元素都没有的元素，本身算一个来源点。桶依次为：
1. 元素没有类名子元素，或子元素的文本为空：**没写类**，不算缺口（如 `<servlet>` 写的是 `<jsp-file>`，或 `<session>` 只覆盖注解给出的配置）；
2. 类名整段等于恰好一个仓库顶层类型的全限定名，且该类型有节点：**成角色**；
3. 类名整段等于两个或更多仓库顶层类型的全限定名：**多个声明**；
4. 类名是仓库内的类型，但不是有节点的顶层类型：**未建索引**。包括只有前缀命中的嵌套类型（`Outer$Inner`、`Outer.Inner`），不把角色给外层类型；
5. 其余：**仓库外**，不算缺口（如 `javax.faces.webapp.FacesServlet`）。

绑定来源点：一个类节点与一个角色。从表达式文件指向该类的 `references` 边里，至少有一条的证据带有来自该角色绑定者的绑定。绑定来源点都 **成角色**。

类节点的属性：
- `componentRoles`：该类的角色，按目录顺序。每项是角色 id、所属层与证据。每个成角色的来源点一条证据，带文件、行、`token` 与来源（注解、描述符或绑定），按文件、行与来源排序：
  - 注解来源的 `token` 是注解的写法；
  - 描述符来源的 `token` 是子元素里写的类名；
  - 绑定来源只取一条见证：这类边的证据里按文件与行排在最前的一条，`token` 是该行的 EL 写法。其余引用由 `references` 边自己承载。
- `layer`：按层次顺序在该类各角色的层里取最靠前的一个。

只有正向证据给出角色。没有来源点的类型没有 `componentRoles` 与 `layer`，不从「没有被绑定」「没有注解」推出任何层。

缺口：

| 缺口 | 对应的桶 |
|---|---|
| `component-role-unresolved` | 注解来源点与描述符来源点的「未建索引」 |
| `component-role-ambiguous` | 描述符来源点的「多个声明」 |

覆盖记在 `coverage.componentRoles`：三种来源点各桶的计数、按写法计数的未确认注解、有角色的类数、按层的类数，以及角色分属两个或更多层的类数。

守恒 SHALL 成立：
- 各来源的桶之和等于来源点数；
- 「成角色」的来源点数等于类节点上该来源的证据条数；
- 记下的缺口等于对应桶的计数。

MCP 的 `traverse` 返回的节点，以及 `recall` 返回的有节点身份的候选，SHALL 在节点有层时带上 `layer`，以及只列角色 id 的 `componentRoles`。

图校验 SHALL 核对 `componentRoles` 的证据：
- 每条证据的行含它的 `token`；
- 一个角色只要有一条证据核对通过即确认；全部不符时报出证据不符。

#### Scenario: 注解给出角色与层
- **WHEN** `OrderProcessorBean` 写 `@Stateless`，`import javax.ejb.Stateless`
- **THEN** 它的类节点 `componentRoles` 含 `session-bean`，证据是注解所在行、`token` 为 `Stateless`；`layer` 为 `layer:service`

#### Scenario: 描述符给出角色
- **WHEN** `ejb-jar.xml` 的 `<session>` 写 `<ejb-class>com.acme.orders.LegacyOrderBean</ejb-class>`，源码上没有注解
- **THEN** `LegacyOrderBean` 的 `componentRoles` 含 `session-bean`，证据是该行、`token` 为类名，来源为描述符

#### Scenario: 嵌套类型不把角色给外层
- **WHEN** 描述符写 `<servlet-class>com.acme.Outer$ExportServlet</servlet-class>`，仓库里有顶层类型 `com.acme.Outer`
- **THEN** 该来源点落入「未建索引」并记 `component-role-unresolved`，`Outer` 没有这个角色

#### Scenario: 仓库外的类
- **WHEN** `web.xml` 写 `<servlet-class>javax.faces.webapp.FacesServlet</servlet-class>`
- **THEN** 来源点落入「仓库外」，不记缺口，不给任何节点角色

#### Scenario: 多角色按层次顺序取层
- **WHEN** 一个类同时写 `@Stateless` 与类级 `@Path("orders")`
- **THEN** `componentRoles` 同时含 `jaxrs-resource` 与 `session-bean`；`layer` 为 `layer:api`；覆盖里角色分属多个层的类数计入它

#### Scenario: 没有正向证据不给层
- **WHEN** 一个类只写 `@Named` 与 `@RequestScoped`，没有页面绑定它
- **THEN** 它没有 `componentRoles` 与 `layer`

#### Scenario: 未确认的写法只计数
- **WHEN** 一个类写 `@Stateless`，文件里两条按需导入都不提供目录里的 `Stateless`
- **THEN** 不生成来源点，覆盖按写法 `Stateless` 计数

#### Scenario: 证据可复核
- **WHEN** 读每个 `componentRoles` 证据的文件与行
- **THEN** 该行含证据里的 `token`；行号被改成不含 `token` 的行时，图校验报出证据不符

#### Scenario: 经 MCP 看到层
- **WHEN** 对 `OrderProcessorBean` 的类节点做 `traverse` 一跳
- **THEN** 返回的该节点带 `layer: "layer:service"` 与 `componentRoles: ["session-bean"]`
