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

- [ ] 1.1 `types.ts` 新增 `JavaMemberAnnotationUse` 与 `StructuralAnalysis.memberAnnotations`，按 design D1。`java-extractor.ts` 遍历文件里任意深度的类型体，记录以下位置上的注解：字段（每个声明符一条，含接口常量）、方法、构造器、方法与构造器参数（含可变参数 `...` 之前的注解）、record 组件。
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
- [ ] 1.2 `extract-structure-result.mjs` 透传 `memberAnnotations` 并校验形状，坏形状报错并指出位置。核对结构抽取有没有按内容或版本的缓存。如果有，确认形状变化会让旧缓存失效，在本任务下写明结论。
  验证：`tests/` 里结构行的测试断言字段透传，坏形状的测试报错；冻结摘要若受影响，用生成器整块重冻并列出。
- [ ] 1.3 重建 core dist；core 测试、typecheck、根测试全绿。
  验证：命令输出计数写进交付报告。

## 2. 目录

- [ ] 2.1 `name-binding-catalog.mjs` 支持目录版本 3，按 design D3：
  - 注解绑定器缺省名规则新增 `simple-name`；
  - 新顶层 `annotationInjections`。注入族字段为 `id`、`namespace`、`basis`、可选 `binders`、`consumer.managedBy`、`sites`。注入点字段为 `id`、`basis`、`annotations`、`on`、`nameArguments`、`defaultName`、`fallbackToType`、`expressionPrefix`。
  - 校验规则：
    - 绑定器 id 必须存在且同命名空间；
    - `on` 非空、只含五种成员种类；
    - `defaultName` 为 `null`、`member-java-beans` 或 `member-seam`；
    - 注入点 id 全局唯一；
    - 版本 2 被拒绝。

  验证：`tests/facts/name-binding-catalog.test.mjs` 对每条新规则各有一条非法输入测试，错误信息指出位置。
- [ ] 2.2 随附目录升到版本 3：
  - 新绑定器 `ejb-annotation-session`；
  - `spring-annotation-stereotype` 加四个注解；
  - 三个注入族按 design D3 表格；
  - 每项带 `basis`。

  验证：测试加载随附目录，断言绑定器 id 集合、注入族与注入点 id、各注入点的 `on`、`defaultName`、`fallbackToType` 与 D3 一致。

## 3. 注解注入解析

- [ ] 3.1 `name-reference-resolution.mjs`：
  - 把注解身份确认抽成共用函数，注解绑定器改为调用它，行为不变；
  - `ejb-annotation-session` 与补充的构造型注解按既有规则产生绑定；
  - 绑定表新增查询「解析到某个类节点的全部绑定」，在目标解析完成后一次算出。

  验证：`tests/facts/name-reference-resolution.test.mjs` 既有断言不改仍全绿；新增 `simple-name` 缺省名、`@Configuration` 绑定、反查查询的测试。
- [ ] 3.2 新模块 `annotation-injection-resolution.mjs` 的 `resolveAnnotationInjections`：
  - 按 D4 读名字；
  - 按 D5 定消费者与解析范围；
  - 按 D6 分十五个桶，顺序即优先级。

  验证：`tests/facts/annotation-injection-resolution.test.mjs` 覆盖规格「Java 注解注入点」的每个场景，另加：
  - 多个管理单元的名字结果不一致时为歧义；
  - 空串名字取缺省名；
  - `member-seam` 对非 setter 方法没有缺省名；
  - 写法未确认的注解计入 `unconfirmed`。
- [ ] 3.3 `injects` 边与证据按 D7：每个（消费者类，目标类）一条；证据含 `file`、`line`、`token`、`name`、`site`、管理绑定处、目标解析经过的绑定处；排序去重；自环照画。
  验证：测试断言精确的边与证据，包括缺省名证据的 `token` 与 `name` 不同的情形。
- [ ] 3.4 覆盖与缺口按 D8：五类缺口的样例形式，十五个桶之和等于 `siteCount`，`nested` 与 `unconfirmed` 计数，`not-run`。`xml-injection-resolution.mjs` 的守恒函数改为接收两段覆盖，缺口按两种来源合计核对。
  验证：测试构造桶之和不等、合计缺口不等，断言抛错；XML 单独运行时守恒仍成立。
- [ ] 3.5 变异绊线：D11 的六个开关各让至少一条测试变红；第 2、3 步的绊线在共用绑定表上仍各让至少一条测试变红。不改生产默认值。
  验证：测试里逐个打开开关，断言结果变化。

## 4. 接入流水线与夹具

- [ ] 4.1 新夹具 `tests/fixtures/annotation-injection/`，内容覆盖 design O1 列出的全部情形。
  验证：4.2 的管道测试断言精确的边列表、证据、十五个桶与计数。
- [ ] 4.2 `build-fact-graph.mjs`：
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
- [ ] 4.3 图校验与遍历：在夹具产物上跑图校验，没有新增告警；从被注入的类经 `injects` 1 跳到达注解来源的消费者。
  验证：测试覆盖以上两点，并覆盖规格场景「两种来源合成一条边」。
- [ ] 4.4 检查其它可能误判新字段、新覆盖段的位置：schema、`project-service.mjs`、MCP `project_status`、dead-code-detection 读 `functions[].annotations` 的地方。按需最小修改。
  验证：逐处说明查过的位置及结论；夹具产物经 `project_status` 能看到 `annotationInjections` 覆盖。

## 5. 验收与记录

- [ ] 5.1 acceptor 按 design「验收 Oracle」O2–O7 在固定语料上验收，O4b 包括在内。每项给出命令、计数与结论，编造与遗漏分开计数；报告存在仓库外。抽查发现编造时，按预先承诺的 F1 / F2 或「先改源头」执行，并在本文件追加对应任务。
  验证：报告中每项 oracle 都有通过 / 不通过结论和证据。
- [ ] 5.2 全量门 O8 通过后，把验收摘要写进本文件末尾。摘要只放计数、耗时与结论，不放真实项目的源码或路径。
  验证：`openspec validate --all --strict` 通过。
