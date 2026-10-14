## Why

JAX-RS 应用的 HTTP 入口写在注解里：类上的 `@Path`，方法上的 `@Path` 与 `@GET`、`@POST` 等 HTTP 方法注解。容器按注解分派请求，源码里没有调用者，所以今天图里看不到「这个方法处理 `GET /orders/{id}`」：

- 处理方法没有任何入边；
- 一个项目有哪些 API 入口，没有一份完整的清单；
- `javaee.md` 附录让模型在语义描述里写路由，那是逐方法的转写，范围大时成本高，也没有地方给出全集。

路由清单是普查：要穷举仓库里每个处理方法，确认每个注解的身份，再把类上与方法上的路径拼起来。按 `skills/excavator/frameworks/README.md` 的三层规则，它属于第三层，即确定性事实。事实层已经有 `endpoint` 节点类型（来自 GraphQL、protobuf 的解析器），Core 也已经抽取了类上与方法上的注解及其字面量参数。本变更只补解析这一步，不改 Core。

按本变更规则做的探针（正则近似，只作量级参考，主代码与测试合计）：

| 语料 | 导入 JAX-RS 的文件 | 成端点 | 类上没有路径 | 方法有路径、没有 HTTP 方法 | 路径不是字面量 | 嵌套类型里 | 成端点中写在接口上 |
|---|---|---|---|---|---|---|---|
| fineract | 173 | 360 | 0 | 0 | 0 | 5 | 0 |
| Dataverse | 46 | 555 | 0 | 0 | 3 | 0 | 0 |
| OSCAR | 35 | 267 | 0 | 1 | 0 | 0 | 0 |
| TomEE 8.x examples | 69 | 179 | 0 | 0 | 0 | 1 | 19 |
| Seam 2.2 examples | 24 | 146 | 2 | 10 | 0 | 0 | 70 |
| hadoop | 26 | 135 | 0 | 0 | 137 | 0 | 0 |
| Sakai `master` | 15 | 0 | 169 | 0 | 0 | 0 | 0 |
| Cargo Tracker | 3 | 3 | 0 | 0 | 0 | 0 | 0 |
| DayTrader 8 | 3 | 6 | 0 | 0 | 0 | 0 | 0 |

表里有三类缺口值得注意：

- Sakai 的资源类不写类上的 `@Path`，由 CXF 的 Spring 配置注册；
- hadoop 的路径大多写成常量；
- Seam 的方法有路径、没有 HTTP 方法，是子资源定位方法。

这三类都落可见缺口，不猜。

## What Changes

- **路由目录（数据）**：新文件 `skills/excavator/catalogs/routes.json`，版本 1。
  - 每个路由族声明：类上的根路径注解、方法上的路径注解、HTTP 方法注解与对应的动词、客户端注解、是否只认 `public` 方法。
  - 随附一个族 `jaxrs`，覆盖 `javax.ws.rs` 与 `jakarta.ws.rs` 两套名字；客户端注解为 MicroProfile 的 `@RegisterRestClient`。它标出的接口声明的是对远端服务的调用，不是本应用的入口。
  - 加载严格：未知键、缺字段、类型不符都让加载失败。
- **解析**（新模块 `route-resolution.mjs`）：
  - 读结构行里的类型注解（`classes[].annotationArguments`）与成员注解（`memberAnnotations`）。注解身份按「名字绑定」的 Java 作用域规则确认，与名字绑定、注解注入共用同一个函数。
  - 一个带有某族 HTTP 方法注解或方法路径注解的方法是一个路由点。每个路由点按顺序落入九个桶之一：嵌套类型、客户端声明、处理方法未建索引、非 public、多个 HTTP 方法、没有 HTTP 方法、类上没有根路径、路径不是字面量、成端点。
  - 路由写成 `<动词> <路径>`。路径由类上与方法上的路径拼成：两段各去掉首尾的 `/`，非空的段以 `/` 相连，前面加 `/`。路径相对于 JAX-RS 应用的根，不含 `@ApplicationPath` 或部署配置给的前缀。
- **节点与边**：
  - 每个（文件，顶层类型，路由）一个 `endpoint` 节点，名字是路由，所属是顶层类型，行范围取源码顺序第一个处理方法的行范围。
  - 每个成端点的路由点一条 `routes` 边，从端点指向处理方法。同一路由由几个方法处理时（按媒体类型协商），一个端点、几条边。
  - `routes` 边的证据是 HTTP 方法注解、方法路径注解与类上根路径注解所在的行，每条带写出的注解名作 `token`。
  - 文件到端点的 `contains` 边引用 HTTP 方法注解的行，并带 `token`；图校验对带 `token` 的 `contains` 证据核对 `token`。
  - `routes` 加入可遍历的确定性边类型。
- **覆盖与缺口**：
  - 新增 `coverage.routes`：每个族的路由点数、九个桶、端点数、边数，以及未确认注解的计数。
  - 新缺口四类：`route-handler-unresolved`、`route-verb-unresolved`、`route-root-unresolved`、`route-path-unresolved`。
  - 桶、缺口与边做守恒检查，不平衡时构建失败。
- **附录**：
  - `javaee.md` 把路由列入「已在事实图里」；
  - 原来的推断规则改为只补应用前缀：部署单元里恰好一个 `@ApplicationPath` 时，在端点或处理方法的语义描述里写出完整路径；
  - 不另造路由节点；
  - `frameworks/README.md` 的归属表加一行。
- `PIPELINE_VERSION` 升到 `lazy-fact-graph/11`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fact-graph`：
  - 新增「Java 注解路由」；
  - 新增「routes 边的证据与遍历」。
- `javaee-framework`：修改「javaee 附录只作 guidance」：JAX-RS 路由已是确定性事实，附录只补应用前缀。

## Impact

- **代码**：
  - 不改 Core，不需要重建 core dist；
  - skill 侧：
    - 新文件 `catalogs/routes.json`；
    - 新模块 `route-catalog.mjs` 与 `route-resolution.mjs`；
    - 修改 `build-fact-graph.mjs`、`lazy-analyze.mjs`、`validate-graph.mjs`（`contains` 的 `token`）与 `retrieve.mjs`（可遍历边类型）；
    - 修改附录 `frameworks/javaee.md` 与 `frameworks/README.md`。
- **产物**：
  - 用到 JAX-RS 的项目，图里多出 Java 文件里的 `endpoint` 节点、文件到端点的 `contains` 边、`routes` 边与 `route-*` 缺口；
  - 所有项目的覆盖多出 `routes` 一段；
  - 旧产物因版本号变化，在下次同步时整体重投影。
- **不影响**：
  - 既有节点与边；
  - 结构行与 source index：处理方法的 chunk 已经含注解原文，Java 端点不另建 chunk；
  - MCP 工具的参数与形状。
- **语料**：
  - 验收用 fineract、Dataverse、OSCAR、TomEE 8.x examples、Seam 2.2 examples、hadoop、Sakai `master`；
  - 回归用 Cargo Tracker、DayTrader 8、JPetStore 6、DayTrader 7 与两个私有语料。
  - 真实项目的源码、路径与输出不提交。
