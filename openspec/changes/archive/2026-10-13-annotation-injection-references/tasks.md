执行约束：
- 人员：一个 coder（Sonnet），一个 acceptor（Opus）。
- 验收 oracle 见 design.md「验收 Oracle」，动手前已写死。
- 语言：代码、测试与注释用英文，OpenSpec 用中文。
- build-free：不编译目标项目、不安装运行时、不下载依赖。
- 分支：`feat/annotation-injection-references` 基于 `main`，第 3 步已归档。
- 本变更改 Core：每次改完 Core 都要重建 core dist，再跑 skill 测试。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入，每个 commit 单独可测）：

0. `docs(openspec): archive xml-injection-references`（已完成）。
1. `docs(openspec): propose annotation-injection-references`：proposal、design、规格增量、tasks。
2. `feat(core): record annotations on Java members with their arguments`：任务 1.1–1.3。
3. `feat(facts): catalog v3 with annotation injection families and EJB names`：任务 2.1–2.2。
4. `feat(facts): resolve Java annotation injection points`：任务 3.1–3.5。
5. `feat(lazy): merge annotation injections into the injects edges`：任务 4.1–4.4。
6. `docs(openspec): record annotation-injection-references acceptance`：任务 5.1–5.2。

## 1. Core：成员上的注解

- [x] 1.1 `types.ts` 新增 `JavaMemberAnnotationUse` 与 `StructuralAnalysis.memberAnnotations`，按 design D1。`java-extractor.ts` 遍历文件里任意深度的类型体，记录以下位置上的注解：字段（每个声明符一条，含接口常量）、方法、构造器、方法与构造器参数（含可变参数 `...` 之前的注解）、record 组件。
  - 每条记录带：写法、行、参数（键、值、值所在行）、`on`、`owner`（顶层类型简单名）、`nested`、`member`，参数位置还带 `parameter`。
  - 参数的键与值沿用 `extractAnnotationUses` 的规则。
  - 类型上的注解与 `functions[].annotations` 不变。

  验证：`packages/core` 的测试覆盖以下情形，断言精确的记录：
  - 每种位置；
  - 多声明符字段；
  - 跨行注解（参数行不等于注解行）；
  - 非字面量参数；
  - 嵌套、局部、匿名类型（`owner` 为顶层类型，`nested` 为真）；
  - 顶层 `@interface` 的成员；
  - 不记录的位置：局部变量、lambda 参数、catch 参数、类型使用注解。
- [x] 1.2 `extract-structure-result.mjs` 透传 `memberAnnotations` 并校验形状，坏形状与其它 Java 事实字段一样让该文件落 `parse-failed`。核对结构抽取有没有按内容或版本的缓存。如果有，确认形状变化会让旧缓存失效，在本任务下写明结论。
  验证：`tests/` 里结构行的测试断言字段透传，坏形状的测试断言结构行为 `parse-failed`；冻结摘要若受影响，用生成器整块重冻并列出。
  缓存结论：结构抽取没有按内容或版本的缓存。`structure-all.mjs` 每次 Lazy 运行都对物化快照里的全部文件重新抽取；跨运行唯一的复用闸是 `source-manifest.json` 的 `pipelineVersion`（`sync-fact-graph.mjs`、`project-service.mjs` 比较）。本步没有任何读者消费 `memberAnnotations`，旧产物与 `/8` 的投影一致；`PIPELINE_VERSION` 随第一个消费者在任务 4.2 升到 `/9`，那时所有旧 manifest 因版本不符整体重投影。
- [x] 1.3 重建 core dist；core 测试、typecheck、根测试全绿。
  验证：命令输出计数写进交付报告。

## 2. 目录

- [x] 2.1 `name-binding-catalog.mjs` 支持目录版本 3，按 design D3：
  - 注解绑定器缺省名规则新增 `simple-name`；
  - 新顶层 `annotationInjections`。注入族字段为 `id`、`namespace`、`basis`、可选 `binders`、`consumer.managedBy`、`sites`。注入点字段为 `id`、`basis`、`annotations`、`on`、`nameArguments`、`defaultName`、`fallbackToType`、`expressionPrefix`。
  - 校验规则：
    - 绑定器 id 必须存在且同命名空间；
    - `on` 非空、只含五种成员种类；
    - `defaultName` 为 `null`、`member-java-beans` 或 `member-seam`；
    - 注入点 id 全局唯一；
    - 版本 2 被拒绝。

  验证：`tests/facts/name-binding-catalog.test.mjs` 对每条新规则各有一条非法输入测试，错误信息指出位置。
- [x] 2.2 随附目录升到版本 3：
  - 新绑定器 `ejb-annotation-session`；
  - `spring-annotation-stereotype` 加 `@Configuration`、`@RestController`；
  - 新绑定器 `spring-annotation-advice`（`@ControllerAdvice`、`@RestControllerAdvice`，读 `name`，不读 `value`）；
  - 三个注入族按 design D3 表格；
  - 每项带 `basis`。

  验证：测试加载随附目录，断言绑定器 id 集合、注入族与注入点 id、各注入点的 `on`、`defaultName`、`fallbackToType` 与 D3 一致。

## 3. 注解注入解析

- [x] 3.1 `name-reference-resolution.mjs`：
  - 把注解身份确认抽成共用函数，注解绑定器改为调用它，行为不变；
  - `ejb-annotation-session`、`spring-annotation-advice` 与补充的构造型注解按既有规则产生绑定（第 2 步提交时已生效，测试随目录一起提交）；
  - 绑定表新增查询「解析到某个类节点的全部绑定」，在目标解析完成后一次算出。

  验证：`tests/facts/name-reference-resolution.test.mjs` 既有断言不改仍全绿；新增 `simple-name` 缺省名、`@Configuration` 绑定、反查查询的测试。
- [x] 3.2 新模块 `annotation-injection-resolution.mjs` 的 `resolveAnnotationInjections`：
  - 按 D4 读名字；
  - 按 D5 定消费者与解析范围；
  - 按 D6 分十五个桶，顺序即优先级。

  验证：`tests/facts/annotation-injection-resolution.test.mjs` 覆盖规格「Java 注解注入点」的每个场景，另加：
  - 多个管理单元的名字结果不一致时为歧义；
  - 空串名字取缺省名；
  - `member-seam` 对非 setter 方法没有缺省名；
  - 写法未确认的注解计入 `unconfirmed`。
- [x] 3.3 `injects` 边与证据按 D7：每个（消费者类，目标类）一条；证据含 `file`、`line`、`token`、`name`、`site`、管理绑定处、目标解析经过的绑定处；排序去重；自环照画。
  验证：测试断言精确的边与证据，包括缺省名证据的 `token` 与 `name` 不同的情形。
- [x] 3.4 覆盖与缺口按 D8：五类缺口的样例形式，十五个桶之和等于 `siteCount`，`nested` 与 `unconfirmed` 计数，`not-run`。`xml-injection-resolution.mjs` 的守恒函数改为接收两段覆盖，缺口按两种来源合计核对。
  验证：测试构造桶之和不等、合计缺口不等，断言抛错；XML 单独运行时守恒仍成立。
- [x] 3.5 变异绊线：D11 的六个开关各让至少一条测试变红；第 2、3 步的绊线在共用绑定表上仍各让至少一条测试变红。不改生产默认值。
  验证：测试里逐个打开开关，断言结果变化。

## 4. 接入流水线与夹具

- [x] 4.1 新夹具 `tests/fixtures/annotation-injection/`，内容覆盖 design O1 列出的全部情形。
  验证：4.2 的管道测试断言精确的边列表、证据、十五个桶与计数。
  夹具：三个部署单元（`app`、`lib`、`seam`，各有 `pom.xml`），38 个注入点，12 条 `injects` 边。除 `bundle` 外每个桶都有至少一个站点；`bundle` 在随附目录里不可达（没有注入族读的绑定器声明资源包），留给单元测试。注解身份的两种结果各有一例：同包的自定义 `Qualifier` 是「他类型」（不计数），按需导入里没有它的 `Qualifier` 是「未确认」。
- [x] 4.2 `build-fact-graph.mjs`：
  - 在同一张绑定表上依次跑 EL、XML 注入、注解注入；
  - 两种来源的 `injects` 边在加入图之前按（消费者，目标）合并，证据取并集、排序去重；
  - 写 `coverage.annotationInjections`；
  - 缺口回读后做合计守恒。

  `PIPELINE_VERSION` 升到 `lazy-fact-graph/9`，注释写明新增的事实；冻结摘要若受影响，用生成器整块重冻。
  验证：`tests/lazy/annotation-injection-pipeline.test.mjs` 在夹具上跑 Lazy，断言：
  - 边、证据、桶与 stages 行；
  - 合并边同时含 XML 与 Java 证据；
  - 每条证据的行含 `token`。

  第 3 步的 `xml-injection-pipeline` 测试只允许版本号字符串变化。
  完成：
  - 合计守恒由 `tests/lazy/annotation-injection-conservation.test.mjs` 断言（缺一类缺口、多记一条、桶和不等都抛错；不带注解覆盖时 XML 单段守恒对同一份计数不成立；三个绊线开关经同一个 mutations 对象到达注解解析与合并）。
  - 五类 `injection-*` 缺口的原因文字改为同时说明 XML 与 Java 注解来源。`java` 范围先查 `JAVA_CALL_GAP_REASONS`，它的键（`calls-*`、`override-uncertain`）与五类不相交，不冲突；测试断言。
  - 没有冻结摘要受影响：没有任何固定摘要哈希 Lazy 投影、覆盖或版本号；`NON_JAVA_ROWS_SHA256` 不变。没有重冻。
  - 既有断言的变化只有三处：`xml-injection-pipeline` 与 `name-references-pipeline` 两个测试里各两处版本号字符串 `/8` → `/9`；`lazy-publish-staging` 的「单条记录超限」测试，超长函数名由固定 3000 个字符改为「基线最大记录长度 + 1000」。原因：facts digest 的覆盖记录随 `annotationInjections` 段增长，固定的 3006 字符不再大于 `limit`（基线最大记录 + 500），前置断言 `limit < longName.length` 先失败；断言本身不变。
- [x] 4.3 图校验与遍历：在夹具产物上跑图校验，没有新增告警；从被注入的类经 `injects` 1 跳到达注解来源的消费者。
  验证：测试覆盖以上两点，并覆盖规格场景「两种来源合成一条边」。
  结论：`validate-graph.mjs` 的 `case 'injects'` 本来就取证据的 `token`，Java 证据的 `token` 在所引的行上（缺省名时是成员的写法），不需要放宽。测试在夹具产物上跑图校验，与去掉全部 `injects` 边的同一图相比：`issues`、`warnings` 不变，`edgesChecked` 与 `edgeConfirmed` 各多 12；只有 `setInventory` 一行、不含名字 `inventory` 的边照样被确认；把 `LibClient` 那条边的证据行改到第 1 行则被报出且只有这一条。遍历：从 `AuditLog` 1 跳到 `OrderService`（两种来源合成的边）与 `AppConfig`（只有注解），从 `OrderDaoImpl` 1 跳到四个消费者，经项目服务与真实 stdio MCP 服务器同样。
- [x] 4.4 检查其它可能误判新字段、新覆盖段的位置：schema、`project-service.mjs`、MCP `project_status`、dead-code-detection 读 `functions[].annotations` 的地方。按需最小修改。
  验证：逐处说明查过的位置及结论；夹具产物经 `project_status` 能看到 `annotationInjections` 覆盖。
  逐处结论（除最后一项文档行外，都不需要改代码）：
  - 图 schema（`packages/core/src/schema.ts`）：`CoverageSchema` 与 `EvidenceSchema` 都是 `passthrough`，新覆盖段与证据里的 `name`、`consumer`、`bindings` 照常通过；`EdgeTypeSchema` 本来就没有 `mentions`、`references`、`injects`，Lazy 产物不经它解析；唯一的使用者 `auditGraphShape`（`annotate-graph.mjs`）只查溯源与非模型证据。测试：夹具产物上 `auditGraphShape` 对 `injects` 边没有发现。
  - `project-service.mjs`：`projectStatus` 与 `syncFacts` 把 `graph.coverage` 整段作为 `factCoverage` 返回；`snapshotIdentity` 把 manifest 与 `PIPELINE_VERSION` 比较，`/8` 产物读作 `stale`，`sync-fact-graph.mjs` 用同一判据整体重投影。测试：把产物与 manifest 改回 `/8`，`projectStatus` 为 `unavailable`，`syncFacts` 之后覆盖段与注解边回来。
  - MCP `project_status`：`mcp-server.mjs` 没有限制 `factCoverage` 的输出 schema。测试：真实 stdio 服务器返回 `annotationInjections` 覆盖与 `java` 范围的 `injection-*` 缺口，`traverse` 返回合成边，`read_evidence` 返回 Java 原行。
  - dead-code-detection 与 `functions[].annotations`：`memberAnnotations` 是独立字段，`functions[].annotations`（裸名）及其校验没动；仓库里还没有读 `functions[].annotations` 的代码（该变更的判定引擎从任务 4.1 起尚未实现），`java-call-resolution.mjs` 只读 `classes[].annotations`。
  - 枚举覆盖段键的位置：在 `skills/`、`agents/`、`hooks/`、`scripts/`、`src/`、`packages/core/src` 里搜 `coverage.mentions`、`nameReferences`、`injections`，只有 `build-fact-graph.mjs`、`lazy-analyze.mjs` 与各解析模块；`factsDigest` 整段哈希 `coverage`，新段是投影事实，进摘要。
  - 结构行的其它读者：`build-source-index.mjs`、`annotate-graph.mjs`、`java-call-resolution.mjs`、`mention-sites.mjs` 按字段名取值，不遍历行；`structure-all-store.mjs`、`jsonl-lines.mjs` 整行读写；Core 的 `fingerprint.ts` 只读 `functions`、`classes`、`imports`、`exports`。没有读者在 `memberAnnotations` 上出错。
  - `validate-graph.mjs`、`retrieve.mjs`：见 4.3，`injects` 都已在其中。
  - `skills/excavator/frameworks/README.md`：「现在什么在哪」表加一行，说明 Java 注解注入的名字解析在目录里（与第 3 步的 XML 一行并列）。

## 5. 验收与记录

- [x] 5.1 acceptor 按 design「验收 Oracle」O2–O7 在固定语料上验收，O4b 包括在内。每项给出命令、计数与结论，编造与遗漏分开计数；报告存在仓库外。抽查发现编造时，按预先承诺的 F1 / F2 或「先改源头」执行，并在本文件追加对应任务。
  验证：报告中每项 oracle 都有通过 / 不通过结论和证据。
- [x] 5.2 全量门 O8 通过后，把验收摘要写进本文件末尾。摘要只放计数、耗时与结论，不放真实项目的源码或路径。
  验证：`openspec validate --all --strict` 通过。

## 验收摘要

最终验收在 `844905c2` 上完成，一轮通过。注解注入语料 6 个：Seam 2.2 examples、OSCAR、OpenMRS core、Sakai 12.7、TomEE 8.x examples、fineract。不回归语料：Dataverse、Cargo Tracker、go-multirepo 的两个仓库、mixed-suite 的两个项目、hadoop。耗时语料为 Sakai `master` 与 hadoop。`/8` 基线复用第 3 步验收在 `df5d3253` 上的产物，该提交的 skill 代码与本变更的父提交 `main` 相同。

acceptor 的 Java 成员注解扫描器、绑定表引擎、分桶规则、审计与对账脚本都独立于被测代码实现，不引用 `skills/excavator` 与 `packages/core`。每个仪器先用埋入的已知差异证明能报出差异。预期数在任何 `/9` 产物出现之前登记，登记期间目录拆出 `spring-annotation-advice`（`@ControllerAdvice` 的 `value` 是扫描包，不是名字），预登记随之改版。验收中发现两处仪器错误，产品无误：
- 引擎给注解类型上的 `@Singleton` 也产生了绑定，而 Core 的 `classes` 不含注解类型；
- 缺口记录被替换（而非新增）时，预期的缺口总数公式不对。

两处都修了仪器，并补了仪器自测。报告存在仓库外。

| oracle | 结论 | 计数 |
|---|---|---|
| O1 夹具与绊线 | 通过 | 三个单元的夹具覆盖 15 个桶中随附目录能到达的 14 个（资源包桶由单测覆盖），含跨单元管理、`@ControllerAdvice` 管理的消费者、缺省名证据（`token` 与 `name` 不同）、XML 与注解合成的一条边；D11 的六个变异开关各至少让一条测试变红，第 2、3 步的绊线在共用绑定表上仍然有效 |
| O2 全量审计 | 通过 | 13/13 个语料编造 0、遗漏 0；注解来源 `injects` 边 171 条（Seam 156、OSCAR 4、OpenMRS 6、Sakai 12.7 3、fineract 2）；四种埋错（错目标、错证据行、不受管理的消费者、Seam 注入点命中 JSF bean）在 Seam、OSCAR、OpenMRS 上全部报出 |
| O3 桶与计数对账 | 通过 | 13/13 个语料与独立重算完全一致：十五个桶、按注入点 id 的计数、`nested`、`unconfirmed`（全部为空）；结构行的 `memberAnnotations` 与独立扫描逐行一致（hadoop 81,052 行、fineract 40,166 行等），解析状态与 `/8` 相同 |
| O4 不回归 | 通过 | 7/7：节点、全部边（含 XML 来源 `injects` 及其证据）与既有缺口一致；新增绑定键 `ejb-annotation-session`（Dataverse 128、Cargo Tracker 10）与 `spring-annotation-advice` 的计数逐项有来源；`spring-annotation-stereotype` 的增量等于 `@Configuration`、`@RestController` 产生的绑定数 |
| O4b 前两步回归 | 通过 | 6/6：节点与非 `injects` 边一致，XML 来源 `injects` 证据一致，`references` 与 `nameReferences` 的桶一致；合并边 0 条；构造型增量 OpenMRS 122 → 129、Sakai 12.7 7 → 14、fineract 1,719 → 1,875，EJB 绑定 TomEE 143、Seam 54，`spring-annotation-advice` fineract 1。OSCAR、OpenMRS、Sakai 12.7 的 XML 注入缺口在种类、范围、计数与样例上与 `/8` 一致，只有每类缺口的说明文字按任务 4.2 改写为同时覆盖两种来源；判为一致（说明文字不是缺口事实，每类仍只有一段） |
| O5 耗时 | 通过 | 3 次中位数：Sakai `master` +8.7%（99.28 → 107.96 s），hadoop +4.0%（176.29 → 183.28 s）；只取开跑与运行中负载都低的轮次，增幅约 2%–6%。多出的时间在 `structureAll`（成员注解抽取），`factGraph` 不变慢；`structure-all.jsonl` 增大 4.48 MB 与 13.48 MB，与预测相差不到 3%。本轮部分运行受桌面应用负载干扰，干扰抬高了一次基线，因此另报干净轮次的增幅 |
| O6 人工抽查 | 通过 | 编造 0、按规则的遗漏 0。共 269 条：Seam 127、fineract 48、TomEE 31、OpenMRS 28、Sakai 12.7 28、OSCAR 7，覆盖边、每类缺口与不成边的桶；缺口样例格式全部符合 |
| O7 真实 MCP | 通过 | Seam 上经 stdio 调用工具，15/15 项检查通过：从一个只经 `@In` 注入的组件类经 `injects` 一跳到达两个消费者，`read_evidence` 读回注解所在行，`project_status` 报出 `annotationInjections` 覆盖与 Java 范围的注入缺口；语料前后不变 |
| O8 全量门 | 通过 | 根测试 2,649 通过 / 4 跳过；core 1,151；typecheck；check-refs；`openspec validate --all --strict` 38/38；core dist 与源码一致 |

注解注入覆盖（`844905c2`）：

| 语料 | 注入点 | 成边 | 正确不成边 | 缺口 |
|---|---|---|---|---|
| Seam 2.2 examples | 422 | 156（37.0%） | 32（不受管理 31、仓库外 1） | 234（无绑定 204、表达式 21、他处 7、歧义 2） |
| OSCAR | 8 | 4 | 4（不受管理 3、仓库外 1） | 0 |
| OpenMRS core | 25 | 6 | 11（不受管理 9、位置不读 2） | 8（无绑定） |
| Sakai 12.7 | 28 | 3 | 23（不受管理 20、仓库外 2、按类型 1） | 2（他处） |
| TomEE 8.x examples | 169 | 0 | 163（不受管理 85、不写名字 78） | 6（无绑定） |
| fineract | 49 | 2 | 1（不受管理） | 46（无绑定 34、非字面量 9、他处 3） |
| Dataverse | 898 | 0 | 898（不写名字 884、不受管理 14） | 0 |

「不受管理」「不写名字」「按类型」不是缺口记录，但在 `coverage.annotationInjections` 的桶里可见。Dataverse 与 TomEE 的注入几乎全是不写名字的 `@EJB`、`@Resource`，按设计留给第二层（按类型），本步只计数。

O6 另外单列了 97 条：框架运行时会注入，但本步规则有意不读其来源。它们都落在可见的桶里，不是编造，是后续覆盖项：

| 原因 | 条数 |
|---|---|
| Spring 测试上下文里的绑定 | 29 |
| `@Bean` 工厂方法声明的 bean | 26 |
| 绑定注解在嵌套类型上（绑定器只读顶层类型） | 11 |
| Seam 的 Wicket 页面 | 10 |
| 抽象基类上的注入点（由子类受管理） | 6 |
| Seam `@Factory` | 5 |
| 多模块共用一个 Spring Boot 上下文 | 3 |
| 匿名 `<bean>` 的类名别名 | 2 |
| Sakai 共享父上下文 | 2 |
| Seam 与 Spring 的桥接 | 2 |
| `.groovy` 文件里的 `@Name` | 1 |

预先承诺的 F1 / F2 没有触发：两者的条件是编造，本轮编造为 0。后续步骤的覆盖候选，在第 3 步三项之外再加：
- `@Bean` 与 `@Factory`、`@Produces` 方法作为绑定器；
- 嵌套类型上的绑定注解；
- 抽象基类按受管理子类判断管理。
