## Context

需求要求把 JAX-RS 的 `@Path` 与 HTTP 方法注解作为 API 入口进入图。现状：

- 事实层已有 `endpoint` 节点类型，来自 GraphQL、protobuf 解析器写在结构行 `endpoints` 里的条目，经统一的节点身份函数派生 id，也进入 source index。
- Core 的 Java 抽取器已经给出：
  - 顶层类型上的注解及字符串字面量参数（`classes[].annotationArguments`）；
  - 类型体内成员上的注解，含所附着的方法名与名字所在行、所属顶层类型、是否嵌套（`memberAnnotations`）；
  - 每个方法的可见性（`functions[].visibility`）。
- 注解身份确认已有共用函数 `createAnnotationIdentity`（`name-reference-resolution.mjs`），名字绑定与注解注入都用它。它需要：仓库 Java 类型的全限定名集合、Kotlin/Scala 类型索引，以及结构行里没有类型的 Java 文件的包（含注解类型声明，来自 `mentionInputs.javaPackages`）。
- 事实图每次同步都从完整的结构行重新投影；source index 按文件增量更新，未变文件的 chunk 原样复用。

## Goals / Non-Goals

**Goals：**
- 每个由注解声明、能在文件内拼出完整相对路由的 JAX-RS 处理方法，得到一个 `endpoint` 节点和一条 `routes` 边。
- 每个没拼出来的路由点落入一个可见桶，桶与边守恒。
- 框架知识只在目录数据里；解析代码不出现 JAX-RS 的名字。

**Non-Goals：**
- 应用前缀（`@ApplicationPath`、`web.xml` 的 servlet 映射、CXF `jaxrs:server address` 等）：留给附录，由模型写进语义描述。
- 注解继承：从接口或父类方法继承的注解、从父类型继承的类上 `@Path`。
- 子资源定位方法的链式拼接。
- 路径常量的求值。
- Spring MVC 与其它框架的路由：目录可以在后续步骤加族，本步只随附 `jaxrs`。
- Core 改动、source index 改动。

## Decisions

### D1 路由是 `endpoint` 节点加 `routes` 边

备选：
- (a) 在方法节点上加路由字段：要改节点 schema、序列化与 MCP 输出，`recall` 和 `traverse` 也看不到它。
- (b) 不建节点，只在附录里让模型写：这是现状，没有全集。
- (c) `endpoint` 节点加边：复用既有节点类型、身份、`contains`、遍历与 `factsDigest`。路由成为可数、可遍历的事实；后续的死代码可达性也可以从端点出发。

选 (c)。边类型用 schema 里已有的 `routes`，方向为端点 → 处理方法。端点名本身就是路由：`recall` 用完整路由（如 `GET /orders/{id}`）作检索词时精确命中端点节点；用路由里的片段词时命中处理方法的 chunk（含注解原文），再经 `routes` 入边 1 跳到端点。

### D2 路由相对于应用根

端点名不含应用前缀。前缀来自另一个文件或部署配置，而且来源有好几种：`@ApplicationPath`、`web.xml` 的 servlet 映射、CXF 与 RESTEasy 的厂商配置。把它放进名字有两个后果：

- 端点身份会依赖别的文件。改一个激活类，全部端点的 id 都会变。
- 每种来源都要一套解析和一个缺口。

所以端点名定义为「相对于应用根的路由」，含义稳定。附录在部署单元内恰好一个 `@ApplicationPath` 时，把完整路径写进语义描述。代价是图里的端点名不是客户端实际请求的 URL，这一点写进附录与 `languageLesson`。

### D3 路由目录是数据

新文件 `skills/excavator/catalogs/routes.json`，加载器 `route-catalog.mjs`。不并入 `name-bindings.json`：路由不是名字绑定，两份目录的版本各自演进。形状：

```json
{
  "version": 1,
  "routeFamilies": [
    {
      "id": "jaxrs",
      "basis": "…一句依据…",
      "rootPath": { "annotations": ["javax.ws.rs.Path", "jakarta.ws.rs.Path"], "argument": "value" },
      "methodPath": { "annotations": ["javax.ws.rs.Path", "jakarta.ws.rs.Path"], "argument": "value" },
      "verbs": [
        { "verb": "GET", "annotations": ["javax.ws.rs.GET", "jakarta.ws.rs.GET"] }
      ],
      "clientAnnotations": ["org.eclipse.microprofile.rest.client.inject.RegisterRestClient"],
      "publicOnly": true
    }
  ]
}
```

- 随附族 `jaxrs` 的 `verbs` 为 `GET`、`POST`、`PUT`、`DELETE`、`HEAD`、`OPTIONS`、`PATCH`，每个列出 `javax.ws.rs` 与 `jakarta.ws.rs` 两个全限定名。
- 加载严格。以下情况都让加载失败：
  - 未知键，或缺字段；
  - 类型不符，或空列表（`clientAnnotations` 除外）；
  - 动词或族 id 重复；
  - 同一个全限定名在一个族里既是动词又是路径注解。
- `basis` 只是说明，不参与解析。

### D4 路由点与注解身份

- 注解身份用 `createAnnotationIdentity`。`fqns` 是全部路由族里出现的注解，`typesByFqn`、`otherJvm`、`declaredJavaTypes` 的构造与名字绑定阶段相同。
- 构建事实图时给了路由目录，就必须同时给 `mentionInputs`：缺 `javaPackages` 就无法识别同包声明的同名注解类型。只给目录、不给 `mentionInputs` 时抛错，与既有阶段的成对约束一致。
- 读取的注解：
  - 方法：`memberAnnotations` 中 `on === 'method'` 的记录，按（所属顶层类型，方法名，名字所在行）分组，一组就是一个方法；
  - 根路径：顶层类型的 `classes[].annotationArguments`；
  - 客户端注解：同上，读顶层类型。
- 一个方法带有某族至少一个经确认的动词或方法路径注解，就是该族的一个路由点。注解经确认不属于目录（`other`）时忽略。无法确认（`unconfirmed`）时按写法计数，不让方法成为路由点。

### D5 九个桶的顺序

1. **嵌套**：记录的 `nested` 为真。嵌套类型没有方法节点，处理方法无从指向。
2. **客户端声明**：顶层类型带有该族经确认的客户端注解。它声明的是远端服务，不是本应用的入口，不算缺口。
3. **处理方法未建索引**：在该行的 `functions` 里找所属相同、名字相同、行范围含名字所在行的条目。找不到，或它的 id 处在身份冲突里，就落这个桶。
4. **非 public**：族声明 `publicOnly`，而该条目的 `visibility` 不是 `public`。JAX-RS 只把 public 方法暴露为资源方法，所以不算缺口。接口方法的缺省可见性已是 `public`。
5. **多个 HTTP 方法**：经确认的动词去重后多于一个。
6. **没有 HTTP 方法**：没有经确认的动词，即子资源定位方法，或用 `@HttpMethod` 自定义的动词。
7. **没有根路径**：顶层类型上没有经确认的根路径注解，即子资源方法，或由部署配置注册的资源。
8. **路径非字面量**：根路径或方法路径注解没写 `argument` 键，或值为 `null`。
9. **成端点**。

顺序的理由：
- 前三个桶说的是「这个方法能不能作为处理方法」；
- 第 4 个桶说运行时不暴露它；
- 第 5–8 个桶说路由拼不出来，越靠前的原因越根本。

一个定位方法即使路径不是字面量，也先落「没有 HTTP 方法」。

### D6 路径拼接

```
segment(v) = v 去掉开头与结尾的全部 '/'
path = '/' + [segment(root), segment(method ?? '')].filter(s => s !== '').join('/')
route = verb + ' ' + path
```

值中间的字符原样保留，包括连续的 `/`、空白、模板与模板里的正则。模板以 `{` 开头、以 `}` 结尾，去首尾 `/` 碰不到模板内部。

### D7 端点节点与身份

- 按（类文件，顶层类型简单名，路由）分组，一组一个节点，各字段如下：

  | 字段 | 取值 |
  |---|---|
  | `type` | `endpoint` |
  | `name` | 路由 |
  | `owner` | 顶层类型简单名 |
  | `filePath` | 类文件 |
  | `lineRange` | 组内源码顺序第一个处理方法的行范围 |
  | `anchorSource` | `rule` |
  | `complexity` | 按行跨度，与其它声明相同 |

- id 由 `deriveNodeId` 派生，形如 `endpoint:<path>:<Owner>#<route>`。同组的几个处理方法共享一个节点，所以端点之间不会冲突；类型前缀也让端点不会与函数或类冲突。
- 构建顺序：
  1. 先为结构行的声明派生 id 并检测冲突；
  2. 再解析路由，这一步需要知道处理方法有没有唯一 id；
  3. 最后把端点条目加入声明列表，一起建节点和 `contains` 边。
- 端点自成一个（路径，所属，类型）序号组，不改变其它声明的序号与 id。
- 不进 source index：
  - source index 按文件增量更新；
  - 端点是否存在可能取决于别的文件，例如同包新声明了一个同名注解类型；
  - 处理方法的 chunk 已经含注解原文。

### D8 边与证据

- `routes` 边：

  | 字段 | 取值 |
  |---|---|
  | `source` | 端点 |
  | `target` | 处理方法 |
  | `direction` | `forward` |
  | `weight` | 0.5（与其它注解事实相同） |
  | `provenance` | `extracted` |

- `routes` 边的证据每条为 `{ file, line, source: 'tree-sitter', token, role, value? }`：

  | `role` | `line` | `token` | `value` |
  |---|---|---|---|
  | `verb` | 动词注解所在行 | 注解写法 | — |
  | `method-path` | 方法路径注解所在行 | 写法 | 读到的值 |
  | `root-path` | 根路径注解所在行 | 写法 | 读到的值 |

  证据按（文件，行，角色）排序去重。
- 文件到端点的 `contains` 边沿用通用构造，例外是证据：引用第一个处理方法的动词注解行，带 `token`，`source: 'tree-sitter'`。
- `validate-graph.mjs` 的改动：
  - `expectedTokens` 让 `routes` 与 `mentions`、`references`、`injects` 一样取证据自身的 `token`；
  - `contains` 的证据带 `token` 时取它，不带时仍取目标名。
  - 既有 `contains` 证据都不带 `token`，行为不变。
- `retrieve.mjs` 的 `DETERMINISTIC_EDGE_TYPES` 加 `routes`。

### D9 覆盖、缺口与守恒

`coverage.routes`：

```json
{
  "status": "ran",
  "families": {
    "jaxrs": {
      "sites": 0,
      "buckets": { "nested": 0, "client": 0, "handlerUnindexed": 0, "nonPublic": 0, "conflict": 0, "noVerb": 0, "noRoot": 0, "nonLiteral": 0, "endpoint": 0 },
      "endpoints": 0,
      "edges": 0
    }
  },
  "unconfirmed": { "GET": 0 }
}
```

缺口映射：

| 桶 | 缺口 |
|---|---|
| `nested`、`handlerUnindexed` | `route-handler-unresolved` |
| `conflict`、`noVerb` | `route-verb-unresolved` |
| `noRoot` | `route-root-unresolved` |
| `nonLiteral` | `route-path-unresolved` |

- 缺口的 scope 是族 id，样例为 `<file>:<line> <Owner>.<method>`，`line` 是方法名所在行。
- `assertRouteConservation` 校验：
  - 每族九桶之和等于 `sites`；
  - `endpoint` 等于 `edges` 等于该族 `routes` 边数；
  - 每类缺口的计数等于对应桶之和。
- 校验不平衡时抛错，事实构建失败。

没有目录时为 `{ status: 'not-run' }`。

### D10 接入流水线

- `lazy-analyze.mjs` 加载路由目录（`loadRouteCatalog()`，可注入），与 `mentionInputs` 一起传给 `buildFactGraph`。`PIPELINE_VERSION` 升到 `lazy-fact-graph/11`。
- `build-fact-graph.mjs` 的独立 CLI 入口照旧不传目录，路由阶段为 `not-run`。
- 检查其它按节点类型或边类型分支的位置，确认 Java 文件里出现 `endpoint` 节点后行为正确、`routes` 边不被丢弃：
  - `project-service.mjs`；
  - MCP `project_status`；
  - 语义规划与新鲜度（`select-stale-semantics.mjs`、`consumer-freshness.mjs`）；
  - lazy 驱动自己的确定性校验。

  按需最小修改。

### D11 变异绊线

用测试接缝（`mutations`，生产默认关），每个开关至少让一条测试变红：
- `simpleNameAnnotations`：只按简单名认注解，同包自定义的同名注解会被当成路由注解；
- `noSlashTrim`：不去首尾 `/`；
- `rootFromMethod`：类上没有根路径时，用方法路径单独成路由；
- `firstVerb`：多个动词时取第一个；
- `containsWithoutToken`：端点的 `contains` 证据不带 `token`，图校验应报出。

### D12 附录

- `javaee.md`：
  - 「Already in the fact graph」表加一行：`routes`，端点 → 处理方法，来自路由目录；
  - 缺口说明加 `route-` 前缀的四类；
  - 原「JAX-RS routes」规则改写为：端点已是事实，不另造路由节点；部署单元内恰好一个 `@ApplicationPath` 时，在语义描述里写完整路径，零个或多个时说前缀未知；`route-*` 缺口不猜；
  - `languageLesson` 一条：端点名相对于应用根。
- `frameworks/README.md` 的归属表加一行：JAX-RS 路由到处理方法 → 确定性，`catalogs/routes.json`。

## 验收 Oracle（动手前写死）

语料都在 `excavator-test-repos/` 下，用固定检出；源码、路径、输出都不提交。

| 语料 | 用途 |
|---|---|
| fineract、Dataverse、OSCAR | 主语料：类与方法路径、jakarta 与 javax |
| TomEE 8.x examples | 接口上的路由、MicroProfile 客户端接口 |
| Seam 2.2 examples | 接口上的路由、子资源定位方法 |
| hadoop | 路径常量 |
| Sakai `master` | 类上没有路径（CXF 注册） |
| Cargo Tracker、DayTrader 8 | 小规模正例 |
| JPetStore 6、DayTrader 7、两个私有语料 | 不回归 |

开工前由 acceptor 记下每个语料的提交号，写进验收报告。

- **O1 夹具与绊线**（coder 写，acceptor 审）：
  - 规格的每个场景一条测试。
  - 在 `tests/fixtures/javaee-jsf-app/` 加第三个模块 `orders-rest`，有自己的 `pom.xml`，至少含：
    - `@ApplicationPath` 激活类；
    - 根路径带首尾 `/` 的资源类，含无方法路径、模板、正则模板的处理方法；
    - 按媒体类型共享路由的两个方法；
    - private 处理方法；
    - 同时写两个动词的方法；
    - 子资源定位方法与子资源类；
    - 路径常量；
    - 嵌套类里的处理方法；
    - 带 `@Path` 的接口及不写注解的实现类；
    - `@RegisterRestClient` 客户端接口；
    - `jakarta` 按需导入的文件，以及全限定写法的注解；
    - 同包声明的同名注解类型，以及两个按需导入都提供 `GET` 的文件。
  - 测试断言精确的端点列表、边、证据、九个桶与缺口。
  - D11 每个开关至少让一条测试变红。
  - 既有 `javaee-jsf-pipeline` 测试里锁定的计数如有变化，逐项说明来源。
- **O2 全量精度审计**（acceptor 独立实现，不复用被测代码）：
  - 对验收语料的每个端点与 `routes` 边：
    - 读快照里的 Java 源码，独立识别注解（遮蔽注释与字符串，按导入确认身份）；
    - 独立拼出路由；
    - 核对端点名、所属、处理方法与每条证据的行和 `token`。
  - 不一致数必须为 0。
  - 装置先验：往图谱副本里注入四种错，审计必须全部报出：
    - 错动词；
    - 错路径段；
    - 错处理方法；
    - 错证据行。
- **O3 桶与计数对账**（acceptor 独立脚本）：
  - 每个语料、每个族的九个桶、端点数、边数与未确认计数，都与独立重算逐项一致；
  - 路由点数与独立的源码统计一致。
- **O4 不回归**：每个语料与同一检出、`lazy-fact-graph/10` 的基线对比：
  - 既有节点集合、既有边（含证据）与既有缺口完全一致；
  - 新增内容只能是 Java 文件里的 `endpoint` 节点、文件到端点的 `contains` 边、`routes` 边与 `route-*` 缺口；
  - 覆盖只多 `routes` 一段；
  - 不用 JAX-RS 的语料只多 `coverage.routes`，且其中计数为 0。
- **O5 耗时**：Sakai `master` 与 hadoop 的 Lazy 总耗时，与同一会话新测的 `/10` 基线相比，增幅不超过 10%（各取 3 次中位数）。`factGraph` 阶段单独报告。
- **O6 分层人工抽查**（acceptor，fineract、Dataverse、OSCAR、TomEE、Seam）：
  - 成端点：每个语料随机 10 个；
  - 以下层全抽，每层上限 30：
    - 接口上的端点；
    - 有多个处理方法的端点；
    - 根路径为 `/` 或方法路径为空的端点；
    - 含正则模板的端点；
  - 每类缺口随机 20 条样例；「非 public」与「客户端声明」各随机 20 条；
  - 编造计数必须为 0。编造指：端点不是本应用会分派到的路由，或者路由、处理方法错。漏端点单独计数并归因。
- **预先承诺的退路**（抽查发现编造时直接执行，不再讨论）：
  - **F1**：编造来自仓库内没有任何实现的接口，即只作客户端代理用的接口。处理办法：
    - 接口上的路由点在仓库内找不到实现类时（沿 `implements` 与 `inherits` 传递），落新桶「无实现」，不算缺口；
    - 在夹具里补一条先红后绿的测试。
  - **F2**：编造来自路径拼接。处理办法：按 JAX-RS 规范修正 D6，补夹具测试，重跑 O2 与 O6。
  - **其它来源**：先改源头，补一条先红后绿的夹具测试，再重跑 O2 与 O6。
- **O7 真实 MCP**：对 TomEE examples 或 fineract 起 stdio MCP，调用全部工具：
  - 从一个处理方法做 1 跳入边遍历，经 `routes` 到达端点；
  - 从端点做 1 跳出边遍历，到达处理方法；
  - `read_evidence` 对 `routes` 边返回注解原行；
  - `project_status` 报出 `routes` 覆盖与 `route-*` 缺口；
  - `recall` 用路由里的词能检索到相关结果，且不报错。
- **O8 全量门**（我跑）：
  - 依次跑：
    - `pnpm --filter @excavator/core build`；
    - core 测试与 typecheck；
    - `pnpm typecheck`；
    - `pnpm exec vitest run --maxWorkers=4`；
    - `node scripts/check-refs.mjs`；
    - `openspec validate --all --strict`。
  - 新文件先 `git add -N`。

## Risks / Trade-offs

- **端点名不是完整 URL。** 应用前缀留在语义层（D2）。不读附录的使用者可能以为 `GET /orders` 就是请求路径。缓解：附录与 `languageLesson` 写明这一点；完整路径进入语义描述。
- **由部署配置注册的资源全部落缺口。** Sakai 这类 CXF 项目的资源类不写类上的 `@Path`，169 个路由点全部记 `route-root-unresolved`。这是漏，不是编造，桶里可见。读 CXF / Spring 的 `jaxrs:server` 是后续候选。
- **路径常量落缺口。** hadoop 约一半的路径是常量，记 `route-path-unresolved`。求值仓库内的 `static final String` 常量是后续候选。
- **注解继承不读。** 实现类不写注解、靠接口方法上的注解生效时：
  - 接口有类上 `@Path`，端点画在接口方法上，实现方法经方法级 `implements` 边可达（接口的 default 方法被覆写时经 `overrides`）；
  - 接口没有，而实现类有，接口方法落「没有根路径」。

  两种情况都不编造。
- **客户端接口的识别只认目录里的注解。** RESTEasy `ProxyFactory`、CXF `JAXRSClientFactory` 这类不加注解、只靠工厂调用的客户端代理接口，会被当作声明了路由。O6 专门抽查接口上的端点，F1 兜底。
- **端点行范围只取第一个处理方法。** 几个方法共享路由时，读端点源码只看到第一个；其余的经 `routes` 边可达。

## Migration Plan

- 升版本号后，已有产物在下次 Lazy / `sync_facts` 时整体重投影，不需要迁移脚本。
- 路由目录随插件发布，没有外部使用者。
- 回滚时按步 revert 对应 commit。
- 结构行与 source index 的格式不变。
