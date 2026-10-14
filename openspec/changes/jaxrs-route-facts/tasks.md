执行约束：
- 人员：一个 coder（Sonnet），一个 acceptor（Opus）。
- 验收 oracle 见 design.md「验收 Oracle」，动手前已写死。
- 语言：代码、测试与注释用英文，OpenSpec 用中文。
- build-free：不编译目标项目，不安装运行时，不下载依赖。
- 分支：`feat/jaxrs-route-facts` 基于 `main`；`javaee-jsf-framework-knowledge` 已归档。
- 本变更不改 Core。改动全部在 skill 侧，跑 skill 测试前 core dist 仍需是当前源码的构建。
- 公开仓库：夹具、测试与提交信息里不出现客户、产品或私有语料的名字。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入，每个 commit 单独可测）：

0. `docs(openspec): archive javaee-jsf-framework-knowledge`（已完成）。
1. `docs(openspec): propose jaxrs-route-facts`：proposal、design、规格增量、tasks。
2. `feat(facts): route catalog with the JAX-RS family`：任务 1.1–1.2。
3. `feat(facts): resolve JAX-RS route sites into endpoints`：任务 2.1–2.4。
4. `feat(lazy): project endpoints and routes edges into the fact graph`：任务 3.1–3.5。
5. `docs(skill): JAX-RS routes are facts in the javaee addendum`：任务 4.1。
6. `docs(openspec): record jaxrs-route-facts acceptance`：任务 5.1–5.2。

## 1. 路由目录

- [x] 1.1 新模块 `skills/excavator/route-catalog.mjs`，提供 `parseRouteCatalog(value)`、`loadRouteCatalog(path = SHIPPED_ROUTE_CATALOG)`，按 design D3 严格校验：
  - 未知键、缺字段、类型不符、空列表（`clientAnnotations` 除外）都抛错；
  - 族 id 重复、动词重复都抛错；
  - 同一个全限定名在一个族里既是动词又是路径注解，抛错。
  - 测试覆盖每一种失败。
- [x] 1.2 随附 `skills/excavator/catalogs/routes.json`，版本 1，族 `jaxrs`：
  - 根路径与方法路径注解为 `javax.ws.rs.Path`、`jakarta.ws.rs.Path`，参数键 `value`；
  - 七个动词，每个列出 `javax.ws.rs` 与 `jakarta.ws.rs` 两个全限定名；
  - `clientAnnotations` 为 `org.eclipse.microprofile.rest.client.inject.RegisterRestClient`；
  - `publicOnly: true`；
  - 一句 `basis`。

## 2. 路由解析

- [x] 2.1 新模块 `skills/excavator/route-resolution.mjs` 的 `resolveRoutes({ javaRows, catalog, identity, handlerIdOf, mutations })`：
  - 按 design D4 读取注解、确认身份、分组成路由点；
  - 按 D5 的顺序落九个桶；
  - 按 D6 拼路由；
  - 返回端点条目（按 D7 分组）、待画的 `routes` 边（处理方法 id 已知）、缺口与覆盖。
  - 模块是纯函数，不读文件，代码里不出现任何框架名字。
- [x] 2.2 `routes` 边与证据按 D8：
  - 证据为 `{ file, line, source: 'tree-sitter', token, role, value? }`，按（文件，行，角色）排序去重；
  - 端点的 `contains` 证据为第一个处理方法的动词行，带 `token`。
- [x] 2.3 覆盖、缺口与守恒按 D9：
  - 四类 `route-*` 缺口的样例为 `<file>:<line> <Owner>.<method>`；
  - 提供 `assertRouteConservation`；
  - 没有目录时为 `not-run`。
- [x] 2.4 变异绊线：D11 的五个开关，每个至少让一条测试变红。不改生产默认值。

## 3. 接入流水线与夹具

- [x] 3.1 夹具：在 `tests/fixtures/javaee-jsf-app/` 新增模块 `orders-rest/`，有自己的 `pom.xml`，内容覆盖 design O1 列出的全部情形。既有夹具测试锁定的计数如有变化，逐项写明来源。
  - 变化的锁定计数，逐项如下：
    - `tests/lazy/javaee-jsf-pipeline.test.mjs`「声明无框架关键字」：清单文件数 6 改为 7。来源：新增的 `orders-rest/pom.xml`。模块也登记进了父 `pom.xml` 的 `<modules>`，那一行没有清单文件的关键字，也不是点分名字。
    - 同一个文件「类名规则的名字计数」：`candidates` 57 改为 61，`external` 42 改为 46，`edge` 仍为 15。来源：`orders-rest/pom.xml` 里的四个点分名字，`maven.apache.org`、`com.acme.orders`、`jakarta.platform`、`jakarta.jakartaee`，都不是仓库里的类型。去掉 provider 那一行的副本里，56 与 41 相应改为 60 与 45。
    - `tests/skill/excavator/test_scan_project.test.mjs`「javaee-jsf-app 夹具」：`javaee` 的 `manifests` 2 改为 3。来源：`orders-rest/pom.xml` 写了 `jakarta.jakartaee-api`。证据仍是按路径排第一的 `orders-ejb/pom.xml` 第 13 行；`jsf` 的 3 不变。
    - 四个流水线测试里的 `PIPELINE_VERSION` 与产物头 `lazy-fact-graph/10` 改为 `/11`（任务 3.3）：`javaee-jsf-pipeline`、`name-references-pipeline`、`xml-injection-pipeline`、`annotation-injection-pipeline`（后者两处，其中一处是同步后的产物头）。
- [x] 3.2 `build-fact-graph.mjs`：
  - 新参数 `routeCatalog`。给了它却没给 `mentionInputs` 时抛错。
  - 按 D7 的顺序接入：
    1. 先为结构行的声明派生 id 并检测冲突；
    2. 再解析路由；
    3. 再把端点条目加入声明列表，建节点与 `contains` 边，端点的 `contains` 证据按 D8；
    4. 最后加 `routes` 边。
  - 缺口进 gap 收集器，`coverage.routes` 进覆盖与 `factsDigest`，守恒失败时抛错。
  - 测试断言：结构行声明的节点 id 与序号不受端点影响。
- [x] 3.3 `lazy-analyze.mjs`：
  - 加载路由目录，可注入；
  - 与 `mentionInputs` 一起传入；
  - `PIPELINE_VERSION` 升到 `lazy-fact-graph/11`。
  - `javaee-jsf-pipeline` 一类的端到端测试断言夹具上的端点、`routes` 边、九个桶与缺口。
- [x] 3.4 `validate-graph.mjs` 与 `retrieve.mjs` 按 D8：
  - `routes` 证据与带 `token` 的 `contains` 证据核对 `token`；
  - `DETERMINISTIC_EDGE_TYPES` 加 `routes`。
  - 在夹具产物上跑图校验，没有新增告警；
  - 从处理方法经 `routes` 入边 1 跳到达端点，从端点出边 1 跳到达处理方法。
- [x] 3.5 检查 D10 列出的位置与其它按节点类型、边类型分支的地方，按需最小修改，并在本任务下写明每处的结论：
  - `project-service.mjs`；
  - MCP `project_status`；
  - `select-stale-semantics.mjs`、`consumer-freshness.mjs`；
  - lazy 驱动的确定性校验；
  - 所有列举确定性边类型的散文与常量。

  结论，一处一行：
  - `skills/excavator/project-service.mjs`：`fileNodeMap` 只取 `file` 类型，端点节点（类型 `endpoint`）不进；`traverse` 按清单里的 `filePath` 取节点、取两端都在的边，端点节点（`filePath` 是 Java 文件）与 `routes` 边照常通过；`recall` 能按完整路由名精确命中端点节点，按路由里的词命中处理方法的 chunk；`read_evidence` 按节点取行范围。不改。测试：`tests/lazy/route-facts-pipeline.test.mjs`。
  - MCP `project_status`（`mcp-server.mjs` 与 `projectStatus`）：原样返回 `graph.coverage` 与 `graph.gaps`，`coverage.routes` 与 `route-*` 缺口（scope 为族 id）自然出现；没有任何 schema 列举覆盖段的键。不改。测试：经项目服务与真实 stdio 服务器各一条。
  - `select-stale-semantics.mjs`、`semantic-cache-reuse.mjs`：对所有带 `filePath` 的节点一视同仁，不按类型分支。含端点节点的 Java 文件在端点没有语义条目前算过期，与 GraphQL 端点节点相同。不改。
  - `consumer-freshness.mjs`：只比对修订与流水线版本，不涉及节点与边类型；版本升到 /11 后 /10 的产物读作过期，同步后整体重投影。不改。测试：`route-facts-pipeline` 的「上一个流水线版本」。
  - lazy 驱动的确定性校验（`validateFactGraphIntegrity`）：只查悬空端点、重复 id 与账本守恒，不按类型分支；夹具一次运行的结果为 `ok`。`mergeFactProjectionIntoGraph` 保留投影里的全部边，并丢弃文件里不再出现的事实节点，改了路由后下次同步旧端点消失。不改。测试：`route-facts-pipeline` 的同步一条。
  - `build-source-index.mjs`：chunk 来自结构行（非代码行的 `endpoints`），不来自图的节点；Java 端点不建 chunk（D7）。写出的索引里没有 `endpoint:orders-rest` 的 id。不改。
  - `finalize-incremental.mjs`（`LAYER_NODE_TYPES`、`hasAnalyzedFileCoverage`）与 `validate-graph.mjs`（`FILE_LEVEL_TYPES`）：`endpoint` 本来就是文件级类型，按路径与邻居分层。Lazy 图没有分层，校验器把每个文件级节点都列为「不在任何层」，夹具里多出 12 条端点的同类条目，不是新告警。不改。
  - `annotate-graph.mjs`：`findRecord` 只认结构类型 `imports`、`exports`、`contains`、`calls`，`routes` 与 `injects` 同样不在其内；文件到端点的 `contains` 没有抽取记录，与 GraphQL 端点相同。不改。
  - `retrieve.mjs` 的 `DETERMINISTIC_EDGE_TYPES`：加 `routes`（任务 3.4）。`validate-graph.mjs` 的 `expectedTokens`：改（任务 3.4）。`build-fact-graph.mjs` 的独立 CLI 入口：不传目录，`coverage.routes` 为 `not-run`，注释已补，测试：`route-facts-pipeline`。
  - `agents/excavator-architecture-analyzer.md` 第 349、389 行（「`endpoint` 节点归数据层」）：这条是为模式文件里的端点写的，路由端点应与它的资源类同层。不改代理提示词，由 `javaee.md` 的分层表写明路由端点归 `layer:api`（任务 4.1）。
  - 列举确定性边类型的散文：`skills/excavator-chat/SKILL.md` 第 106、108、216 行只列 `contains`、`imports`、`exports`、`calls`，对 `inherits`、`implements`、`overrides`、`mentions`、`references`、`injects` 早已过时，`routes` 与它们同样，不在本变更范围内，不改，写进报告。`agents/excavator-graph-reviewer.md` 与 `packages/core/src/schema.ts` 的边类型表里本来就有 `routes`。`src/diff-analyzer.ts`、`src/explain-builder.ts` 只沿 `contains` 取子节点，不按 `endpoint` 分支，端点与声明一样是文件的子节点。不改。

## 4. 附录

- [x] 4.1 按 design D12 修改 `skills/excavator/frameworks/javaee.md` 与 `frameworks/README.md`。附录契约测试与提示证据段测试如有锁定的文字，同步更新。

## 5. 验收与记录

- [x] 5.1 acceptor 按 design「验收 Oracle」O2–O7 在固定语料上验收：
  - 每项给出命令、计数与结论，编造与遗漏分开计数；
  - 报告存在仓库外的 `excavator-test-runs/jaxrs-route-facts/`；
  - 抽查发现编造时，按预先承诺的 F1 / F2 或「先改源头」执行，并在本文件追加对应任务。
- [x] 5.2 全量门 O8 通过后，把验收摘要写进本文件末尾。摘要只放计数、耗时与结论，不放真实项目的源码或路径。

## 验收摘要

被测提交 `269cb7cf`（`lazy-fact-graph/11`），基线 `87260bf8`（`/10`）。语料 13 个：
- 主语料与专项语料：fineract、Dataverse、OSCAR、TomEE 8.x examples、Seam 2.2 examples、hadoop、Sakai `master`；
- 小规模正例：Cargo Tracker、DayTrader 8；
- 不回归：JPetStore 6、DayTrader 7 与两个私有语料。

结论：O2–O8 全部通过，编造 0，F1、F2 都没有触发，没有放宽任何 oracle。

| Oracle | 结论 | 计数 |
|---|---|---|
| O2 精度审计 | 通过 | 独立实现，13 个语料不一致 0。逐条核对的证据：fineract 3554、Dataverse 2300、OSCAR 1062、TomEE 585、Seam 574、hadoop 513、Cargo Tracker 11、DayTrader 8 22。装置先验注入四种错，4/4 报出，无误报 |
| O3 桶与计数对账 | 通过 | 九个桶、路由点、端点、边、未确认计数与缺口计数，13 个语料差异 0。独立的源码统计与路由点逐个一致 |
| O4 不回归 | 通过 | 13 个语料既有节点、边（含证据）、缺口及其顺序完全一致。新增只有 Java 文件里的端点、文件到端点的 `contains`、`routes` 边与 `route-*` 缺口，覆盖只多 `routes` 一段。source index、结构行、扫描结果与 import map 逐字节一致，索引里没有端点。不用 JAX-RS 的 4 个语料只多全零的 `coverage.routes`。装置先验 4/4 |
| O5 耗时 | 通过 | 交错各 3 次取中位数：Sakai `master` 105.62 s → 108.85 s（+3.1%），hadoop 198.74 s → 188.20 s（−5.3%）。`factGraph` 阶段 6378 → 6987 ms、16816 → 14371 ms |
| O6 分层抽查 | 通过 | 5 个语料共 256 项，编造 0 |
| O7 真实 MCP | 通过 | TomEE examples，7 个工具 25 项检查。处理方法 1 跳入边经 `routes` 到端点，端点 1 跳出边到处理方法；`read_evidence` 返回注解原行；`project_status` 给出 `routes` 覆盖与 `route-*` 缺口 |
| O8 全量门 | 通过 | core 1261、全仓 2972 通过（4 个跳过与本变更无关），typecheck、`check-refs`、`openspec validate --all --strict` 通过；中间 commit 各自通过 |

每个语料的计数（未列出的桶都为 0；未确认计数在所有真实语料上都为空）：

| 语料 | 路由点 | 嵌套 | 客户端 | 没有 HTTP 方法 | 没有根路径 | 路径非字面量 | 成端点 | 端点 | 边 |
|---|---|---|---|---|---|---|---|---|---|
| fineract | 972 | 5 | 0 | 0 | 0 | 25 | 942 | 940 | 942 |
| Dataverse | 584 | 0 | 0 | 0 | 0 | 3 | 581 | 579 | 581 |
| OSCAR | 268 | 0 | 0 | 1 | 0 | 0 | 267 | 267 | 267 |
| TomEE 8.x examples | 181 | 1 | 19 | 0 | 0 | 0 | 161 | 161 | 161 |
| Seam 2.2 examples | 158 | 0 | 0 | 10 | 2 | 0 | 146 | 146 | 146 |
| hadoop | 277 | 0 | 0 | 0 | 0 | 145 | 132 | 132 | 132 |
| Sakai `master` | 169 | 0 | 0 | 0 | 169 | 0 | 0 | 0 | 0 |
| Cargo Tracker | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 3 | 3 |
| DayTrader 8 | 6 | 0 | 0 | 0 | 0 | 0 | 6 | 6 | 6 |
| 其余 4 个 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

- fineract 与 Dataverse 的边比端点多 2：同一动词与路径、按 `@Produces` 或 `@Consumes` 区分的多处理方法端点。
- 遗漏都在可见的桶里：
  - 子资源定位方法与子资源类：Seam 12，OSCAR 1；
  - 常量或拼接的路径：hadoop 145（含类上路径写成常量的整组资源），fineract 25，Dataverse 3；
  - 嵌套类型：fineract 5、TomEE 1，都在测试代码里；
  - MicroProfile 客户端接口：TomEE 19，都在测试代码里，按设计不成端点；
  - Sakai `master` 全部 169 个路由点没有类上路径，资源由 CXF 配置注册。

已知限制与后续候选：
- `recall` 只在检索词等于完整路由时命中端点节点；用路由里的片段词时命中处理方法的 chunk，再经 `routes` 入边 1 跳到端点。design D1 已按此改正。
- 读 CXF / Spring 的 `jaxrs:server` 补根路径，与求值仓库内的路径常量，是 Sakai 与 hadoop 两类缺口的后续候选。
- 提案的探针表是正则近似，与实测有出入：
  - fineract 实测成端点 942、路径非字面量 25；
  - TomEE「成端点中写在接口上」的 19 个实为客户端接口，已落「客户端声明」；接口上的端点只出现在 Seam，共 70 个，来自 5 个接口，实现类不带 JAX-RS 注解，F1 不适用；
  - hadoop 实测成端点 132、路径非字面量 145。
- 未确认注解的计数只在夹具上触发，真实语料里没有出现。
