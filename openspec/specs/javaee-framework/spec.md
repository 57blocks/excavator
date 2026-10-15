# javaee-framework Specification

## Purpose
确定性检测 Java EE / Jakarta EE 并提供分层提示；`javaee.md` 附录只作分析 guidance；Java EE 部署描述符里写下的类名经既有的 `mentions` 规则连边，并由夹具锁定。

## Requirements

### Requirement: 从 manifest 与 EJB 描述符检测 javaee

系统 SHALL 提供 id 为 `javaee` 的框架配置。

manifest：`pom.xml`、`build.gradle`、`build.gradle.kts`、`ivy.xml`、`ejb-jar.xml`。

关键字至少覆盖：
- 平台 API：`javaee-api`、`javaee-web-api`、`jakarta.jakartaee-api`、`jakarta.jakartaee-web-api`；
- EJB：`javax.ejb`、`jakarta.ejb`；
- JAX-RS：`javax.ws.rs`、`jakarta.ws.rs`、`jsr311-api`；
- CDI：`cdi-api`、`javax.enterprise`、`jakarta.enterprise`；
- EJB 描述符的根元素名 `ejb-jar`。

MUST NOT 以 Servlet、JPA、JMS 的 API 作为 `javaee` 的关键字：这些 API 在非 Java EE 的项目里同样常见。

配置 SHALL 提供：
- `layerHints`，至少覆盖 `ejb→service`、`rest→api`、`entity→data`、`interceptor→middleware`；
- `entryPoints`，含 `WEB-INF/web.xml`、`META-INF/ejb-jar.xml`、`META-INF/application.xml` 的通配形式。

#### Scenario: Jakarta EE 平台 API 被检出
- **WHEN** `pom.xml` 声明 `jakarta.platform:jakarta.jakartaee-api`
- **THEN** 检出 `javaee`

#### Scenario: 只有 EJB 描述符的 Ant 项目被检出
- **WHEN** 项目没有 Maven 或 Gradle 构建文件，`resources/META-INF/ejb-jar.xml` 以 `<ejb-jar` 为根元素
- **THEN** 检出 `javaee`，证据为该描述符

#### Scenario: 只用 JAX-RS 的项目被检出
- **WHEN** `build.gradle` 声明 `jakarta.ws.rs:jakarta.ws.rs-api`，此外没有其他 Java EE API
- **THEN** 检出 `javaee`

#### Scenario: 只用 Servlet、JPA、JMS 不检出
- **WHEN** `pom.xml` 只声明 `jakarta.servlet-api`、`jakarta.persistence-api` 与 `jakarta.jms-api`
- **THEN** 不检出 `javaee`

### Requirement: javaee 附录只作 guidance

`skills/excavator/frameworks/javaee.md` SHALL 只作 prompt 附录，不产行号。据其约定推出的关系一律 `provenance:"inferred"`，不带 evidence。确定性阶段 MUST NOT 把约定当事实。

附录 SHALL 写明：
- 图里已有哪些确定性事实，分析时 MUST NOT 重画：
  - `@EJB(beanName)` 等按名字注入的 `injects`；
  - `@Named` bean 与 EL 名字之间的 `references`；
  - 描述符里类名的 `mentions`；
  - JAX-RS 路由：`endpoint` 节点，以及从端点指向处理方法的 `routes` 边；
  - `implements` 与 `calls`。
- 按类型注入（不写名字的 `@Inject`、`@EJB`）只在仓库内恰好一个非抽象实现时推断依赖。实现按传递的子类型计：实现类的子类、子接口的实现类都算候选。生产者方法也计入候选。零个或多个候选时不连边：限定符、`@Alternative` 由部署决定，MUST NOT 猜。
- JAX-RS 端点的名字是相对于应用根的路由。处理方法所在的部署单元里恰好一个 `@ApplicationPath` 类时，把它的值作为前缀，写进端点或处理方法的语义描述；零个或多个时不加前缀，并说明前缀未知。MUST NOT 另造路由节点，MUST NOT 为 `route-*` 缺口猜测路由。
- MDB 与 CDI 事件的发布订阅关系，只在两端写着同一个目的地字面量、或同一个事件类型时推断。
- 组件角色与分层：session bean、MDB、resource、provider、interceptor、entity、producer、描述符。被页面 EL 绑定的 `@Named` 类是 backing bean，分层与 `jsf.md` 一致；其余 CDI bean 归服务层。session bean（由注解或 `ejb-jar.xml` 条目认定）即使被页面 EL 绑定也仍是 session bean、归服务层。`*Bean.java` 这类两种角色共用的文件名后缀不单独决定角色。

#### Scenario: 约定不产可引用锚点
- **WHEN** 某关系仅由 `javaee.md` 的约定推出
- **THEN** 该关系为 `inferred`、无 evidence，不进入确定性事实

#### Scenario: 多个实现时不推断按类型注入
- **WHEN** 字段 `@Inject OrderService service` 的接口在仓库内有两个非抽象实现
- **THEN** 附录指示不为该注入点推断依赖边

#### Scenario: 间接实现也是候选
- **WHEN** 字段 `@Inject OrderService service` 的接口在仓库内只有一个直接实现 `BaseOrderService`，而 `PremiumOrderService` 继承了它，两者都不是抽象类
- **THEN** 候选有两个，附录指示不为该注入点推断依赖边

#### Scenario: 已有确定性边不重画
- **WHEN** 图里已有 `@EJB(beanName = "OrderBean")` 产生的 `injects` 边
- **THEN** 附录指示不再为同一注入画推断边

#### Scenario: 路由不重画、只补前缀
- **WHEN** 图里已有端点 `GET /orders/{id}` 及其 `routes` 边，处理方法所在的部署单元里恰好一个 `@ApplicationPath("api")` 类
- **THEN** 附录指示不另造路由节点或推断边，只在语义描述里写出完整路径 `GET /api/orders/{id}`

### Requirement: Java EE 描述符里的类名经 mentions 连边

既有的类全限定名提及规则（「类全限定名提及生成 mentions 边」）SHALL 覆盖 Java EE 部署描述符，并由夹具与测试锁定：

- `ejb-jar.xml` 的 `ejb-class`、`home`、`remote`、`local-home`、`local`、`business-local`、`business-remote`、`interceptor-class` 元素文本；
- `persistence.xml` 的 `class` 元素文本；
- `web.xml` 的 `servlet-class`、`filter-class`、`listener-class` 元素文本。

命中恰好一个仓库类型时生成从描述符 file 节点到该类型 class 节点的 `mentions` 边，证据为该行。仓库外的类名（如 JPA 提供者）不成边，计入仓库外。

#### Scenario: EJB 描述符指向 bean 类
- **WHEN** `META-INF/ejb-jar.xml` 写 `<ejb-class>com.acme.orders.OrderProcessorBean</ejb-class>`，仓库内恰有该类
- **THEN** 生成 `ejb-jar.xml` 到 `OrderProcessorBean` 的 `mentions` 边

#### Scenario: 持久化单元列出实体
- **WHEN** `META-INF/persistence.xml` 写 `<class>com.acme.orders.Order</class>`，仓库内恰有该类
- **THEN** 生成 `persistence.xml` 到 `Order` 的 `mentions` 边

#### Scenario: 提供者在仓库外
- **WHEN** `persistence.xml` 写 `<provider>org.hibernate.jpa.HibernatePersistenceProvider</provider>`，仓库内没有该类型
- **THEN** 不生成边，计入仓库外
