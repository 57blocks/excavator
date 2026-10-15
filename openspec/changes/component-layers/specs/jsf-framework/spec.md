## ADDED Requirements

### Requirement: JSF 组件的角色与层由事实给出

角色目录 SHALL 含以下 JSF 角色。注解同时列出 `javax.faces.*` 与 `jakarta.faces.*` 两种全限定名。

| 角色 | 来源 | 层 |
|---|---|---|
| `jsf-managed-bean` | 注解 `faces.bean.ManagedBean`；`faces-config` / `faces-config` / `managed-bean` / `managed-bean-class` | `layer:ui` |
| `backing-bean` | 页面经 EL 绑定，且绑定来自 `@Named` 或 `@Model` 的绑定者（名字绑定目录的 `cdi-annotation-named`、`cdi-annotation-model`） | `layer:ui` |
| `faces-converter` | 注解 `faces.convert.FacesConverter`；`faces-config` / `faces-config` / `converter` / `converter-class` | `layer:utility` |
| `faces-validator` | 注解 `faces.validator.FacesValidator`；`faces-config` / `faces-config` / `validator` / `validator-class` | `layer:utility` |

`backing-bean` 只认正向证据：
- 没有页面绑定的 `@Named`、`@Model` 类不是 backing bean，也不因此得到别的层；
- 同时是会话 bean 的类按层次顺序在 `layer:service`。

目录引用的绑定者 id SHALL 在名字绑定目录里存在，由测试锁定。

JSF 附录 SHALL 写明：类节点上的 `layer` 与 `componentRoles` 是事实，分层时不重新分配。

#### Scenario: 页面绑定的 @Named 类
- **WHEN** `OrderBean` 写 `@Named("orders")`，`list.xhtml` 写 `#{orders.list}`
- **THEN** `OrderBean` 有 `backing-bean` 角色，证据是这些页面引用里按文件与行排在最前的一处，`token` 为 `orders`；`layer` 为 `layer:ui`

#### Scenario: 页面绑定的会话 bean
- **WHEN** 一个类写 `@Stateless` 与 `@Named`，页面经 EL 绑定它
- **THEN** 它同时有 `session-bean` 与 `backing-bean` 角色，`layer` 为 `layer:service`

#### Scenario: faces-config 声明的转换器
- **WHEN** `faces-config.xml` 写 `<converter-class>com.acme.orders.web.MoneyConverter</converter-class>`
- **THEN** `MoneyConverter` 有 `faces-converter` 角色，`layer` 为 `layer:utility`
