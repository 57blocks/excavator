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

- [ ] 2.1 新模块 `skills/excavator/route-resolution.mjs` 的 `resolveRoutes({ javaRows, catalog, identity, handlerIdOf, mutations })`：
  - 按 design D4 读取注解、确认身份、分组成路由点；
  - 按 D5 的顺序落九个桶；
  - 按 D6 拼路由；
  - 返回端点条目（按 D7 分组）、待画的 `routes` 边（处理方法 id 已知）、缺口与覆盖。
  - 模块是纯函数，不读文件，代码里不出现任何框架名字。
- [ ] 2.2 `routes` 边与证据按 D8：
  - 证据为 `{ file, line, source: 'tree-sitter', token, role, value? }`，按（文件，行，角色）排序去重；
  - 端点的 `contains` 证据为第一个处理方法的动词行，带 `token`。
- [ ] 2.3 覆盖、缺口与守恒按 D9：
  - 四类 `route-*` 缺口的样例为 `<file>:<line> <Owner>.<method>`；
  - 提供 `assertRouteConservation`；
  - 没有目录时为 `not-run`。
- [ ] 2.4 变异绊线：D11 的五个开关，每个至少让一条测试变红。不改生产默认值。

## 3. 接入流水线与夹具

- [ ] 3.1 夹具：在 `tests/fixtures/javaee-jsf-app/` 新增模块 `orders-rest/`，有自己的 `pom.xml`，内容覆盖 design O1 列出的全部情形。既有夹具测试锁定的计数如有变化，逐项写明来源。
- [ ] 3.2 `build-fact-graph.mjs`：
  - 新参数 `routeCatalog`。给了它却没给 `mentionInputs` 时抛错。
  - 按 D7 的顺序接入：
    1. 先为结构行的声明派生 id 并检测冲突；
    2. 再解析路由；
    3. 再把端点条目加入声明列表，建节点与 `contains` 边，端点的 `contains` 证据按 D8；
    4. 最后加 `routes` 边。
  - 缺口进 gap 收集器，`coverage.routes` 进覆盖与 `factsDigest`，守恒失败时抛错。
  - 测试断言：结构行声明的节点 id 与序号不受端点影响。
- [ ] 3.3 `lazy-analyze.mjs`：
  - 加载路由目录，可注入；
  - 与 `mentionInputs` 一起传入；
  - `PIPELINE_VERSION` 升到 `lazy-fact-graph/11`。
  - `javaee-jsf-pipeline` 一类的端到端测试断言夹具上的端点、`routes` 边、九个桶与缺口。
- [ ] 3.4 `validate-graph.mjs` 与 `retrieve.mjs` 按 D8：
  - `routes` 证据与带 `token` 的 `contains` 证据核对 `token`；
  - `DETERMINISTIC_EDGE_TYPES` 加 `routes`。
  - 在夹具产物上跑图校验，没有新增告警；
  - 从处理方法经 `routes` 入边 1 跳到达端点，从端点出边 1 跳到达处理方法。
- [ ] 3.5 检查 D10 列出的位置与其它按节点类型、边类型分支的地方，按需最小修改，并在本任务下写明每处的结论：
  - `project-service.mjs`；
  - MCP `project_status`；
  - `select-stale-semantics.mjs`、`consumer-freshness.mjs`；
  - lazy 驱动的确定性校验；
  - 所有列举确定性边类型的散文与常量。

## 4. 附录

- [ ] 4.1 按 design D12 修改 `skills/excavator/frameworks/javaee.md` 与 `frameworks/README.md`。附录契约测试与提示证据段测试如有锁定的文字，同步更新。

## 5. 验收与记录

- [ ] 5.1 acceptor 按 design「验收 Oracle」O2–O7 在固定语料上验收：
  - 每项给出命令、计数与结论，编造与遗漏分开计数；
  - 报告存在仓库外的 `excavator-test-runs/jaxrs-route-facts/`；
  - 抽查发现编造时，按预先承诺的 F1 / F2 或「先改源头」执行，并在本文件追加对应任务。
- [ ] 5.2 全量门 O8 通过后，把验收摘要写进本文件末尾。摘要只放计数、耗时与结论，不放真实项目的源码或路径。
