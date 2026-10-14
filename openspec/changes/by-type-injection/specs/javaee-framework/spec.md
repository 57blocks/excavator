## MODIFIED Requirements

### Requirement: javaee 附录只作 guidance

`skills/excavator/frameworks/javaee.md` SHALL 只作 prompt 附录，不产行号。据其约定推出的关系一律 `provenance:"inferred"`，不带 evidence。确定性阶段 MUST NOT 把约定当事实。

附录 SHALL 写明：
- 图里已有哪些确定性事实，分析时 MUST NOT 重画：
  - `@EJB(beanName)` 等按名字注入的 `injects`；
  - `@Inject` 与不带名字的 `@EJB` 按类型注入的 `injects`：仓库里恰好一个候选时成边，指向实现类或生产者方法；
  - `@Local` / `@Remote` 用类字面量声明、Java 里没写 `implements` 的业务接口：类到接口的 `implements`；
  - `@Named` bean 与 EL 名字之间的 `references`；
  - 描述符里类名的 `mentions`；
  - JAX-RS 路由：`endpoint` 节点，以及从端点指向处理方法的 `routes` 边；
  - `implements` 与 `calls`。
- 按类型注入点落 `type-injection-*` 缺口时，MUST NOT 推断它的目标：候选集不完整、有多个候选、限定符未解或由部署决定，都是静态读不出来的。语义描述可以写出注入点的声明类型，并说明目标由部署决定。业务接口落 `business-interface-unresolved` 时同样不推断。
- JAX-RS 端点的名字是相对于应用根的路由。处理方法所在的部署单元里恰好一个 `@ApplicationPath` 类时，把它的值作为前缀，写进端点或处理方法的语义描述；零个或多个时不加前缀，并说明前缀未知。MUST NOT 另造路由节点，MUST NOT 为 `route-*` 缺口猜测路由。
- MDB 与 CDI 事件的发布订阅关系，只在两端写着同一个目的地字面量、或同一个事件类型时推断。
- 组件角色与分层：session bean、MDB、resource、provider、interceptor、entity、producer、描述符。被页面 EL 绑定的 `@Named` 类是 backing bean，分层与 `jsf.md` 一致；其余 CDI bean 归服务层。session bean（由注解或 `ejb-jar.xml` 条目认定）即使被页面 EL 绑定也仍是 session bean、归服务层。`*Bean.java` 这类两种角色共用的文件名后缀不单独决定角色。

#### Scenario: 约定不产可引用锚点
- **WHEN** 某关系仅由 `javaee.md` 的约定推出
- **THEN** 该关系为 `inferred`、无 evidence，不进入确定性事实

#### Scenario: 多个实现时不推断按类型注入
- **WHEN** 字段 `@Inject OrderService service` 的接口在仓库内有两个非抽象实现，注入点落 `type-injection-ambiguous`
- **THEN** 附录指示不为该注入点推断依赖边，语义描述只写出声明类型 `OrderService`

#### Scenario: 间接实现也是候选
- **WHEN** 字段 `@Inject OrderService service` 的接口在仓库内只有一个直接实现 `BaseOrderService`，而 `PremiumOrderService` 继承了它，两者都不是抽象类
- **THEN** 事实层的候选有两个，注入点落 `type-injection-ambiguous`；附录指示不为该注入点推断依赖边

#### Scenario: 已有按类型的边不重画
- **WHEN** 图里已有字段 `@Inject OrderService service` 产生的 `injects` 边，指向 `OrderServiceImpl`
- **THEN** 附录指示不再为同一注入画推断边

#### Scenario: 已有确定性边不重画
- **WHEN** 图里已有 `@EJB(beanName = "OrderBean")` 产生的 `injects` 边
- **THEN** 附录指示不再为同一注入画推断边

#### Scenario: 路由不重画、只补前缀
- **WHEN** 图里已有端点 `GET /orders/{id}` 及其 `routes` 边，处理方法所在的部署单元里恰好一个 `@ApplicationPath("api")` 类
- **THEN** 附录指示不另造路由节点或推断边，只在语义描述里写出完整路径 `GET /api/orders/{id}`
