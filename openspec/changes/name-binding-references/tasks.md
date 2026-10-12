执行约束：
- 人员：一个 coder（Sonnet），一个 acceptor（Opus）。
- 验收 oracle 见 design.md「验收 Oracle」，动手前已写死。
- 语言：代码、测试与注释用英文，OpenSpec 用中文。
- build-free：不编译目标项目、不安装运行时、不下载依赖。Core 改动后，用仓库已有的构建脚本重建 `packages/core/dist`，再跑 skill 侧测试。
- 分支：`feat/name-binding-references` 基于 `main`，第 1 步已归档。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入，每个 commit 单独可测）：

0. `docs(openspec): archive name-mention-facts`（已完成）。
1. `docs(openspec): propose name-binding-references`：proposal、design、规格增量、tasks。
2. `feat(core): record Java type annotation arguments`：任务 1.1–1.2。
3. `feat(facts): name-binding catalog`：任务 2.1–2.2。
4. `feat(facts): lex EL expressions and XML name bindings`：任务 3.1–3.3。
5. `feat(facts): resolve EL roots into references edges, gaps and coverage`：任务 4.1–4.5。
6. `feat(lazy): run the name-reference stage and traverse references edges`：任务 5.1–5.4。
7. `docs(openspec): record name-binding-references acceptance`：任务 6.1–6.2。

## 1. Core：类型注解参数

- [ ] 1.1 Java 抽取器为顶层类型记录 `annotationArguments`，内容是每个注解的 `{ name, line, arguments: [{ key, value }] }`，按 design D2。单值写法的 `key` 为 `value`；字符串字面量取解码后的值，其它写法的值为 `null`；无括号或空括号时为 `[]`。`annotations` 的形状不变，`types.ts` 加可选字段与注释。
  验证：`java-declaration-facts.test.ts` 或 `java-extractor.test.ts` 覆盖以下写法：`@Named`、`@Named()`、`@Named("x")`、`@Named(value = "x")`、`@ManagedBean(name = "x", eager = true)`、`@Named(Names.X)`、`@Named("a" + "b")`、带 `\"` 转义的字面量、全限定写法 `@javax.inject.Named("x")`，以及多行注解的行号。
- [ ] 1.2 `skills/excavator/extract-structure-result.mjs` 为新字段加校验：形状不符则该文件失败，与现有 Java 字段的做法一致。
  验证：测试分别给一个合法和一个非法的 `annotationArguments`，前者通过、后者失败；重建 core dist 后，skill 侧现有测试全绿。

## 2. 名字绑定目录

- [ ] 2.1 新建 `skills/excavator/catalogs/name-bindings.json`，内容为 design D1 的随附条目，每个绑定器带 `id`、`namespace`、`basis`。
  验证：2.2 的测试加载随附目录，断言绑定器 id 集合与 D1 一致。
- [ ] 2.2 新建 `skills/excavator/name-binding-catalog.mjs`，提供加载与严格校验：未知键、缺字段、类型不符、重复 id 都抛错并指出位置；结果深度冻结。
  验证：`tests/facts/name-binding-catalog.test.mjs` 覆盖规格场景「目录格式错误」，另加缺字段、错类型、重复 id、`when` 形状错误；随附目录加载成功。

## 3. 单文件词法

- [ ] 3.1 EL 词法为纯函数，输入文本、语言 / 根元素和目录中的表达式语言，输出根名列表 `{ line, token, chain, local }` 及 `escaped`、`unterminated` 计数，规则按 design D6。注释遮蔽复用第 1 步的实现；新增 JSP 脚本段与 `jsp:scriptlet` / `jsp:expression` / `jsp:declaration` 的遮蔽。
  验证：`tests/facts/el-expressions.test.mjs` 覆盖规格场景「注释与转义里的表达式不算」「函数与三元运算」，另加：
  - 字符串里的标识符、嵌套 `{}`、lambda 的单参数与括号参数表；
  - 多行表达式的行号、CRLF、未闭合；
  - 点号之后的关键字，如 `bean.empty`；
  - 属性值里的 `&amp;&amp;` 不产生根名 `amp`；数字字面量 `1e5` 不产生根名；
  - 方括号里的根名 `map[key]`；
  - `var` / `varStatus` / `param name` / `useBean id` 声明的局部名。
- [ ] 3.2 XML 绑定与根元素读取为纯函数，按 design D1 / D4 / D6 实现：
  - 根元素本地名与根命名空间；
  - 按绑定器的 `parent`、`element`、`name`、`target` 读出绑定，带名字所在行；
  - Spring `name` 按 `split` 拆分；
  - `elementTextIn` 条件事实。

  验证：`tests/facts/xml-name-bindings.test.mjs` 覆盖规格场景「faces-config 声明的 managed bean」「Spring 内部 bean 的 id 不是名字」「只有 parent 的 bean 定义」，另加：带前缀的元素名；DOCTYPE 与注释在根元素之前；根命名空间不符时 Seam 条目不生效；被注释掉的 `<el-resolver>` 不满足条件。
- [ ] 3.3 收集器：对每个非代码文件读一次，产出表达式站点、XML 绑定、条件事实与目录外文件计数，按 design D9。
  验证：`tests/facts/name-reference-sites.test.mjs` 覆盖规格场景「不在表达式文件范围内的 EL 可见」，以及代码语言文件不被读取、读失败时报错（不静默为空）。变异绊线 `noCommentMask` 至少让一条测试变红。

## 4. 跨文件解析

- [ ] 4.1 部署单元按 design D5 划分：最近的描述符祖先，没有则属仓库单元。
  验证：`tests/facts/name-reference-resolution.test.mjs` 断言嵌套描述符、无描述符页面与 `repositoryUnitFiles` 计数。
- [ ] 4.2 注解绑定按 design D3 / D4 实现：作用域确认、缺省名两种规则、空串、非字面量、缺名、非标识符名，计数各入其位。
  验证：同一测试文件覆盖规格场景「CDI 缺省名」「Spring 缺省名保留连续大写」「同名的自定义注解不算绑定」「无法确认的注解」「非字面量名字」，另加：
  - Seam `@Role(name = "x")` 为同一个类再声明一个名字；
  - 同包声明遮蔽按需导入；
  - 被注解类没有节点时，目标为未建索引。

  输入行的形状取自 Core 1.1 的真实输出。
- [ ] 4.3 根名分桶与边按 design D7 / D8 实现，十个桶的判定顺序与规格一致；每对（文件，类）一条 `references` 边，证据字段齐全、排序去重。
  验证：测试覆盖规格「EL 名字引用生成 references 边」的其余场景，以及「references 边的证据与遍历」的「证据可复核」（在夹具产物上读行核对）。
- [ ] 4.4 覆盖、缺口与守恒按 design D10 实现：五类缺口的说明文字；歧义与他处的样例列出候选；两条守恒等式不平衡时抛错；未收到站点与目录时为 `not-run`。
  验证：测试对守恒失败、`not-run`、站点与目录只给其一时抛错，各有一条断言。
- [ ] 4.5 变异绊线：`ignoreUnits`、`noLocals`、`bindingsBeforeImplicit`、`firstBinding`、`simpleNameAnnotations`、`ignoreSeesConditions`、`anyParent` 每个至少让一条测试变红，不改生产默认值。
  验证：测试里逐个打开开关，断言结果变化。

## 5. 接入流水线与夹具

- [ ] 5.1 新夹具 `tests/fixtures/jsf-name-references/`，内容覆盖 design O1 列出的全部情形。
  验证：5.2 的管道测试断言精确的边列表与十个桶的计数。
- [ ] 5.2 `lazy-analyze.mjs` 在 `mentions` 之后新增计时阶段 `nameReferences`：加载随附目录、收集站点，传给 `buildFactGraph`；`PIPELINE_VERSION` 升到 `lazy-fact-graph/7`，注释写明新增的事实。冻结摘要用生成器整块重冻。
  验证：`tests/lazy/name-references-pipeline.test.mjs` 在夹具上跑 Lazy，断言边、桶与 stages 行含 `nameReferences=`；规格场景「只被页面使用的 bean 有入边」在产物上成立；三件套、core 测试、typecheck 全绿；commit 说明列出每个重冻的摘要及原因。
- [ ] 5.3 `retrieve.mjs` 的 `DETERMINISTIC_EDGE_TYPES` 加入 `references`；`validate-graph.mjs` 对 `references` 的期望 token 取证据里的 `token`。
  验证：测试覆盖规格场景「从 bean 类遍历到页面」；在 5.1 的夹具产物上跑图校验，没有新增告警。
- [ ] 5.4 检查其它可能拒绝或误判新边、新覆盖段的位置，按需最小修改。位置包括：schema、`annotate-graph.mjs`、`project-service.mjs` 的状态输出、MCP `project_status`。
  验证：逐处说明查过的位置及结论；夹具产物经 `project_status` 能看到 `nameReferences` 覆盖。

## 6. 验收与记录

- [ ] 6.1 acceptor 按 design「验收 Oracle」O2–O7 在固定语料上验收。每项给出命令、计数与结论，编造与遗漏分开计数；报告存在仓库外。抽查发现编造时，按预先承诺的 F1 / F2 或「先改源头」执行，并在本文件追加对应任务。
  验证：报告中每项 oracle 都有通过 / 不通过结论和证据。
- [ ] 6.2 全量门 O8 通过后，把验收摘要写进本文件末尾。摘要只放计数、耗时、结论，不放真实项目的源码或路径。
  验证：`openspec validate --all --strict` 通过。
