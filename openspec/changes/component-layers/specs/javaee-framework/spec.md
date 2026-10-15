## ADDED Requirements

### Requirement: Java EE 组件的角色与层由事实给出

角色目录 SHALL 含以下 Java EE 角色。注解同时列出 `javax.*` 与 `jakarta.*` 两种全限定名。

| 角色 | 注解 | 描述符元素（根 / 父 / 元素 / 类名子元素） | 层 |
|---|---|---|---|
| `jaxrs-resource` | 类级 `ws.rs.Path`；带 `RegisterRestClient` 的类型不算 | — | `layer:api` |
| `jaxrs-activator` | `ws.rs.ApplicationPath` | — | `layer:api` |
| `servlet` | `servlet.annotation.WebServlet` | `web-app` 与 `web-fragment` / 同名根 / `servlet` / `servlet-class` | `layer:api` |
| `jaxrs-provider` | `ws.rs.ext.Provider` | — | `layer:middleware` |
| `interceptor` | `interceptor.Interceptor` | `ejb-jar` / `interceptors` / `interceptor` / `interceptor-class` | `layer:middleware` |
| `decorator` | `decorator.Decorator` | — | `layer:middleware` |
| `servlet-filter` | `servlet.annotation.WebFilter` | `web-app` 与 `web-fragment` / 同名根 / `filter` / `filter-class` | `layer:middleware` |
| `session-bean` | `ejb.Stateless`、`ejb.Stateful`、`ejb.Singleton` | `ejb-jar` / `enterprise-beans` / `session` / `ejb-class` | `layer:service` |
| `message-driven-bean` | `ejb.MessageDriven` | `ejb-jar` / `enterprise-beans` / `message-driven` / `ejb-class` | `layer:service` |
| `ejb-client-view` | `ejb.Local`、`ejb.Remote`，只认接口 | `ejb-jar` / `enterprise-beans` / `session` / `business-local`、`business-remote`、`local`、`remote`、`home`、`local-home` | `layer:service` |
| `entity` | `persistence.Entity`、`persistence.MappedSuperclass`、`persistence.Embeddable` | — | `layer:data` |
| `entity-bean` | — | `ejb-jar` / `enterprise-beans` / `entity` / `ejb-class` | `layer:data` |
| `persistence-unit-class` | — | `persistence` / `persistence-unit` / `class` | `layer:data` |

层次顺序为 `layer:api`、`layer:middleware`、`layer:service`、`layer:data`、`layer:ui`、`layer:utility`：
- 入口按它暴露什么归层，所以同时是会话 bean 的 JAX-RS 资源或 servlet 在 `layer:api`；
- 拦截器、过滤器、提供者按它包裹什么归层，排在被包裹的组件之前；
- 会话 bean 即使被页面经 EL 绑定，也在 `layer:service`，与附录相同。

`javax.inject.Singleton` 与 `javax.annotation.ManagedBean` 不是这里的角色注解。

监听器、只带作用域注解的类、`@Produces` 与 `@Observes` 所在的类，附录没有按角色给出确定的层，目录不列。

Java EE 附录 SHALL 写明：类节点上的 `layer` 与 `componentRoles` 是事实，分层时不重新分配，也不据文件名推翻。

#### Scenario: 注解与描述符同时声明会话 bean
- **WHEN** `OrderProcessorBean` 写 `@Stateless`，`ejb-jar.xml` 也以 `<ejb-class>` 列出它
- **THEN** 它的 `session-bean` 角色有两条证据，一条来自注解、一条来自描述符；`layer` 为 `layer:service`

#### Scenario: EJB 2.x 的接口
- **WHEN** `ejb-jar.xml` 的 `<session>` 写 `<home>com.acme.orders.LegacyOrderHome</home>` 与 `<remote>com.acme.orders.LegacyOrderRemote</remote>`
- **THEN** 这两个接口有 `ejb-client-view` 角色，`layer` 为 `layer:service`

#### Scenario: 描述符声明的拦截器与过滤器
- **WHEN** `ejb-jar.xml` 写 `<interceptor-class>com.acme.orders.AuditInterceptor</interceptor-class>`，`web.xml` 写 `<filter-class>com.acme.orders.web.AuditFilter</filter-class>`
- **THEN** 两者分别有 `interceptor` 与 `servlet-filter` 角色，`layer` 都是 `layer:middleware`

#### Scenario: 实体
- **WHEN** `Order` 写 `@Entity`，`persistence.xml` 写 `<class>com.acme.orders.Order</class>`
- **THEN** `Order` 有 `entity` 与 `persistence-unit-class` 两个角色，`layer` 为 `layer:data`

#### Scenario: 远端服务的客户端不是资源
- **WHEN** 一个接口写类级 `@Path` 与 `@RegisterRestClient`
- **THEN** 它的 `@Path` 来源点落入「不适用」，它没有 `jaxrs-resource` 角色

#### Scenario: 监听器没有层
- **WHEN** `web.xml` 写 `<listener-class>com.acme.orders.web.OrderListener</listener-class>`
- **THEN** `OrderListener` 没有 `componentRoles` 与 `layer`
