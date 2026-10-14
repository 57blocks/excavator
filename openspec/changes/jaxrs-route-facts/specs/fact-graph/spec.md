## ADDED Requirements

### Requirement: Java 注解路由

系统 SHALL 按路由目录，从 Java 类型与方法上的注解读出路由点，把每个路由点解析成一个端点，或落入一个可见桶。注解来自 Core 已有的抽取：
- 顶层类型上的注解（`classes[].annotationArguments`）；
- 类型体内成员上的注解（`memberAnnotations`）。

路由目录是数据，不是代码分支。每个路由族声明：
- id 与一句依据说明；
- 根路径注解：全限定名列表，以及读路径的参数键；
- 方法路径注解：同上；
- HTTP 方法注解：每个动词一条，列出它的全限定名；
- 客户端注解：类型上带有它们时，该类型声明的是对远端服务的调用，不是本应用的入口（可为空）；
- 是否只认 `public` 方法。

目录出现未知键、缺少字段或类型不符时，加载 MUST 失败，不得带着部分目录运行。

注解的身份 SHALL 按「名字绑定」的 Java 作用域规则确认。写法与目录中某个注解的简单名相同、却没有确认的，SHALL 按写法计数，不是路由注解。

路由点是类型体内的一个方法，它带有某个族至少一个经确认的 HTTP 方法注解或方法路径注解。每个路由点 SHALL 按以下顺序恰好落入一个桶：

1. 方法声明在嵌套、局部或匿名类型里：**嵌套**；
2. 所在顶层类型上有该族经确认的客户端注解：**客户端声明**，不算缺口；
3. 所在顶层类型里没有名字与名字所在行都对应的方法声明，或该声明的节点身份与别的声明冲突：**处理方法未建索引**；
4. 族只认 `public` 方法，而该方法不是 `public`：**非 public**，不算缺口；
5. 带有两个或更多不同动词：**多个 HTTP 方法**；
6. 没有 HTTP 方法注解：**没有 HTTP 方法**，即子资源定位方法，或目录以外的自定义动词；
7. 所在顶层类型上没有经确认的根路径注解：**没有根路径**，即子资源方法，或由部署配置注册的资源；
8. 根路径或方法路径注解没写路径参数，或参数不是字符串字面量：**路径非字面量**；
9. 其余：**成端点**。

路由写成「动词 + 一个空格 + 路径」：
- 路径由根路径值与方法路径值拼成。没写方法路径时，方法路径值为空串。
- 两个值各去掉开头与结尾的全部 `/`，非空的段以 `/` 相连，前面加 `/`。
- 值的其余部分原样保留，包括模板 `{id}` 与其中的正则。
- 路径相对于应用的根，不含 `@ApplicationPath` 或部署配置给的前缀。

端点节点：
- 每个（类文件，顶层类型，路由）一个 `endpoint` 节点；
- 名字为路由，所属为顶层类型的简单名；
- 行范围取该组里源码顺序第一个处理方法的行范围；
- 身份经统一的节点身份函数派生；
- 不进入 source index：处理方法的 chunk 已含注解原文。

每个成端点的路由点 SHALL 生成一条 `routes` 边，从端点指向处理方法的节点。同一路由由几个方法处理时，一个端点、几条边。

文件到端点的 `contains` 边 SHALL 引用该端点第一个处理方法的 HTTP 方法注解所在行，并以该注解的写法作 `token`。

缺口：

| 缺口 | 对应的桶 |
|---|---|
| `route-handler-unresolved` | 嵌套、处理方法未建索引 |
| `route-verb-unresolved` | 多个 HTTP 方法、没有 HTTP 方法 |
| `route-root-unresolved` | 没有根路径 |
| `route-path-unresolved` | 路径非字面量 |

样例 SHALL 写出路由点的文件、行与方法名。

为了成端点，MUST NOT 放宽规则：
- 不从父类型、接口或部署配置补根路径；
- 不读常量；
- 不在几个动词里取第一个。

`coverage.routes` SHALL 给出：
- 运行状态；
- 每个族的路由点数、九个桶的计数、端点数与边数；
- 未确认注解按写法的计数。

守恒 SHALL 成立，不成立时构建 MUST 失败：
- 九个桶之和等于路由点数；
- 成端点的路由点数等于该族的 `routes` 边数；
- 每类缺口的计数等于对应桶之和。

没有路由目录输入时，状态为 `not-run`。

#### Scenario: 类与方法的路径拼成路由
- **WHEN** 类 `OrderResource` 写 `@Path("/orders/")`，其 public 方法 `find` 写 `@GET` 与 `@Path("{id}")`，注解都经 `javax.ws.rs` 的单类型导入确认
- **THEN** 生成名为 `GET /orders/{id}`、所属为 `OrderResource` 的 `endpoint` 节点，以及从它指向 `find` 的 `routes` 边

#### Scenario: 没写方法路径
- **WHEN** 类写 `@Path("orders")`，方法 `create` 只写 `@POST`
- **THEN** 路由为 `POST /orders`

#### Scenario: 根路径为斜杠
- **WHEN** 类写 `@Path("/")`，方法只写 `@GET`
- **THEN** 路由为 `GET /`

#### Scenario: jakarta 命名空间
- **WHEN** 文件经 `import jakarta.ws.rs.*;` 写 `@Path("items")` 与 `@DELETE`，仓库在同包没有名为 `Path` 或 `DELETE` 的类型
- **THEN** 与 `javax.ws.rs` 的写法得到同样的端点

#### Scenario: 几个方法共享一个路由
- **WHEN** 同一个类里两个 public 方法都写 `@GET @Path("{id}")`，只是 `@Produces` 不同
- **THEN** 只有一个 `GET /orders/{id}` 端点，有两条 `routes` 边，各指向一个方法；端点的行范围取源码在前的那个方法

#### Scenario: 接口上声明的路由
- **WHEN** 接口 `OrderApi` 写 `@Path("/v2/orders")`，其方法 `list` 写 `@GET`；实现类 `OrderApiImpl` 的 `list` 不写任何注解
- **THEN** 端点 `GET /v2/orders` 的 `routes` 边指向接口方法 `OrderApi.list`；实现方法经既有的方法级 `implements` 边可达，不另画端点

#### Scenario: 子资源定位方法
- **WHEN** 方法 `items` 写 `@Path("{id}/items")`，没有 HTTP 方法注解
- **THEN** 不生成端点，计入「没有 HTTP 方法」，记 `route-verb-unresolved` 缺口

#### Scenario: 类上没有根路径
- **WHEN** 类 `ItemsResource` 没有类上的 `@Path`，其方法 `list` 写 `@GET`
- **THEN** 不生成端点，计入「没有根路径」，记 `route-root-unresolved` 缺口

#### Scenario: 路径写成常量
- **WHEN** 方法写 `@GET @Path(Paths.HISTORY)`
- **THEN** 不生成端点，计入「路径非字面量」，记 `route-path-unresolved` 缺口

#### Scenario: 多个动词
- **WHEN** 方法同时写 `@GET` 与 `@POST`
- **THEN** 不生成端点，计入「多个 HTTP 方法」，记 `route-verb-unresolved` 缺口

#### Scenario: 非 public 方法
- **WHEN** 类写 `@Path("orders")`，其 private 方法写 `@GET`
- **THEN** 不生成端点，计入「非 public」，不记缺口

#### Scenario: 远端服务的客户端接口
- **WHEN** 接口写 `@RegisterRestClient`（经 `org.eclipse.microprofile.rest.client.inject` 的单类型导入确认）与 `@Path("/library")`，方法写 `@GET`
- **THEN** 不生成端点，计入「客户端声明」，不记缺口

#### Scenario: 嵌套类型里的路由
- **WHEN** 顶层类的静态嵌套类里，一个方法写 `@GET`
- **THEN** 不生成端点，计入「嵌套」，记 `route-handler-unresolved` 缺口

#### Scenario: 同名的自定义注解不是路由注解
- **WHEN** 仓库声明注解类型 `com.acme.rest.GET`，某文件单类型导入它并写在方法上
- **THEN** 该注解不是路由注解，也不计入未确认

#### Scenario: 无法确认的注解
- **WHEN** 文件同时写 `import javax.ws.rs.*;` 与 `import jakarta.ws.rs.*;`，方法写 `@GET`
- **THEN** `GET` 无法确认，计入按写法的未确认计数；只凭它不构成路由点

#### Scenario: 目录格式错误
- **WHEN** 路由目录的某个族多出一个未知键
- **THEN** 加载失败，事实构建不带着部分目录运行

#### Scenario: 守恒不平衡时构建失败
- **WHEN** 解析结果的九个桶之和不等于路由点数
- **THEN** 事实构建失败并报出不平衡的族

#### Scenario: 阶段未运行
- **WHEN** 事实构建没有路由目录输入
- **THEN** `coverage.routes` 的状态为 `not-run`，图里没有 Java 文件里的端点节点

### Requirement: routes 边的证据与遍历

`routes` 边 SHALL 带 `provenance: "extracted"`。

每条边的证据 SHALL 包括：
- HTTP 方法注解所在的行；
- 写了方法路径注解时，它所在的行；
- 类上根路径注解所在的行。

每条证据带 `token`，即该行上注解的写法（如 `GET`、`javax.ws.rs.GET`、`Path`），并标明角色：动词、方法路径或根路径。路径证据另记读到的值。同一条边的证据按文件、行与角色排序去重。

图校验 SHALL 按证据自身的 `token` 核对：
- `routes` 证据的行包含它的 `token`；
- 带 `token` 的 `contains` 证据的行包含它的 `token`；
- 不带 `token` 的 `contains` 证据，校验规则不变。

与其它边类型相同，一条边只要有一条证据的行含它的 `token`，图校验就确认这条边。

`routes` SHALL 属于可遍历的确定性边类型：
- 从处理方法沿入边可以找到端点；
- 从端点沿出边可以找到处理方法。

#### Scenario: 证据可复核
- **WHEN** 读 `routes` 边每条证据的文件与行
- **THEN** 该行含证据里的 `token`；动词证据的 `token` 是一个已确认的 HTTP 方法注解的写法，路径证据记下的值等于该注解读到的字面量

#### Scenario: 从处理方法遍历到端点
- **WHEN** 从 `OrderResource.find` 的方法节点做 1 跳入边遍历
- **THEN** 结果包含经 `routes` 到达的端点 `GET /orders/{id}`

#### Scenario: 证据行不含 token 时校验报出
- **WHEN** 一条 `routes` 边的每条证据，行号都被改成不含各自 `token` 的行
- **THEN** 图校验对这条边报出证据不符

#### Scenario: 端点的 contains 证据可复核
- **WHEN** 对文件到端点 `GET /orders/{id}` 的 `contains` 边做图校验
- **THEN** 证据行含 HTTP 方法注解的写法 `GET`，校验通过；该行号被改成不含 `GET` 的行时，校验报出证据不符
