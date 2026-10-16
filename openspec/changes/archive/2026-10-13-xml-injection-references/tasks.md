执行约束：
- 人员：一个 coder（Sonnet），一个 acceptor（Opus）。
- 验收 oracle 见 design.md「验收 Oracle」，动手前已写死。
- 语言：代码、测试与注释用英文，OpenSpec 用中文。
- build-free：不编译目标项目、不安装运行时、不下载依赖。本变更不改 Core。
- 分支：`feat/xml-injection-references` 基于 `main`，第 2 步已归档，框架知识分层已记录。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入，每个 commit 单独可测）：

0. `docs(openspec): archive name-binding-references`、`docs: record where framework knowledge lives`（已完成）。
1. `docs(openspec): propose xml-injection-references`：proposal、design、规格增量、tasks。
2. `feat(facts): catalog v2 with XML injection families and target rules`：任务 1.1–1.2。
3. `feat(facts): one binding table resolved through aliases, inheritance and factories`：任务 2.1–2.3。
4. `feat(facts): read XML injection sites, consumers and the reference census`：任务 3.1–3.2。
5. `feat(facts): resolve XML injection sites into injects edges, gaps and coverage`：任务 4.1–4.4。
6. `feat(lazy): run injection resolution and traverse injects edges`：任务 5.1–5.4。
7. `docs(openspec): record xml-injection-references acceptance`：任务 6.1–6.2。

## 1. 目录

- [x] 1.1 `name-binding-catalog.mjs` 按 design D1 支持目录版本 2：
  - `rootNamespace` 的元素可为 `null`；
  - `target.kind` 新增 `name`；
  - `target.unknownWhen` 与 `target.inheritFrom` 只在 `kind: class` 时允许；
  - 新顶层 `xmlInjections`：`consumer.binder` 必须存在、同命名空间、目标种类为 `class`；注入点两种形状二选一；`scope` 取 `unit`、`file` 或 `outside`；注入点 id 全局唯一；普查三项至少一个非空。

  验证：`tests/facts/name-binding-catalog.test.mjs` 对每条新规则各有一条非法输入测试，错误信息指出位置；版本 1 的目录被拒绝。
- [x] 1.2 随附目录升到版本 2：
  - `spring-xml-bean` 加根命名空间、`unknownWhen`、`inheritFrom`；
  - 新绑定器 `spring-xml-alias`；
  - 新注入族 `spring-xml-injection`，11 个注入点与普查规则按 design D1 表格；
  - 每项带 `basis`。

  验证：测试加载随附目录，断言绑定器 id 集合、注入点 id 与 `scope` 集合、普查规则与 D1 一致。

## 2. 共用绑定表与目标解析

- [x] 2.1 `xml-name-bindings.mjs` 的绑定读取：
  - 根命名空间列表含 `null` 时，匹配没有声明命名空间的根；
  - 绑定行带上 `unknownBecause`（命中的 `unknownWhen` 属性名，或 null）与 `inherits`（`inheritFrom` 属性的值，或 null）；
  - `kind: name` 的目标按 `child` / `attribute` 读出文本。

  验证：`tests/facts/xml-name-bindings.test.mjs` 覆盖 DTD 无命名空间文件、Java EE 命名空间的 `beans.xml` 不被 `spring-xml-bean` 读、工厂方法定义、只写 `parent` 的定义、`<alias>`。
- [x] 2.2 `name-reference-resolution.mjs` 抽出 `buildNameBindingTable`，按 design D2 / D3 实现：
  - 所有名字进表，每个绑定带「EL 可访问」标志；
  - 目标解析一次并缓存：`unknownWhen`、类名解析、`inheritFrom` 与 `kind: name` 在同单元同命名空间解析所名的名字、成环与无绑定为未知；
  - 返回解析经过的绑定处。

  `resolveNameReferences` 改为接收这张表，EL 匹配与「他处」判定只用 EL 可访问的绑定；`nonIdentifierNames` 与 `coverage.nameReferences.bindings` 的含义不变。

  验证：`tests/facts/name-reference-resolution.test.mjs` 覆盖 MODIFIED 规格「名字绑定」的新场景，即父定义继承、父定义不在本单元、工厂方法、别名、别名成环、点分 id 进表但 EL 访问不到；第 2 步的既有测试不改断言仍全绿。
- [x] 2.3 第 2 步夹具 `tests/fixtures/jsf-name-references/` 加一个声明了 Spring 桥接的单元，含工厂方法定义、只写 `parent` 的定义与别名，各被一个 EL 根名使用。
  验证：`tests/lazy/name-references-pipeline.test.mjs` 断言这三个根名分别落「目标未知」、成边到父定义的类、成边到别名所名的类；既有单元的边、证据与桶不变，总计数的变化恰好等于新单元的贡献；变异 `noAliases`、`noInheritance`、`ignoreUnknownWhen` 各让至少一条测试变红。

## 3. 注入点读取

- [x] 3.1 `xml-name-bindings.mjs` 新增注入点读取，按 design D4 / D5：
  - 根元素按本地名与 `rootNamespace` 命中注入族；
  - 元素加属性形状按本地名匹配；属性命名空间形状按作用域内最近的 `xmlns:前缀` 解析；`xmlns` 声明不是注入点、不进普查；
  - 名字去首尾空白，空值计入普查未读；
  - 消费者为自身或最近的祖先消费者元素，按 `consumer.binder` 的目标规则读出行、目标、`unknownBecause`、`inherits`；
  - 普查已读与未读按 D4 计。

  验证：`tests/facts/xml-name-bindings.test.mjs` 覆盖规格场景「集合里的 ref 消费者是最近的 bean」「内部 bean 的注入点属于内部 bean」「p 命名空间的引用属性」「非 Spring 命名空间的 beans 根不读」「普查记下没有读的引用形状」「注释里的注入点不算」，另加：前缀在祖先元素上声明；同一元素两个注入点；空的 `ref=""`。变异 `outermostConsumer`、`anyRootNamespace`、`noCensus` 各让至少一条测试变红。
- [x] 3.2 `name-reference-sites.mjs` 在同一次解析里收集 `injections`、`injectionFiles`、`uncoveredReferences`，按 design D9。
  验证：`tests/facts/name-reference-sites.test.mjs` 断言一个 Spring 文件只被读一次、只被解析一次；注入族文件不在表达式文件范围内时不产生表达式行；读失败时报错。

## 4. 注入解析

- [x] 4.1 新模块 `xml-injection-resolution.mjs` 的 `resolveXmlInjections`，按 design D6 分桶：顺序为静态不可见、可见绑定的目标归类、他处 / 无绑定、消费者。`scope: file` 只看同文件绑定，同单元其它文件的同名绑定算「他处」。
  验证：`tests/facts/xml-injection-resolution.test.mjs` 覆盖规格「XML 注入点」的其余场景：property 的 ref 成边、注解声明的目标、经别名的目标、ref local 只看本文件、ref parent 静态不可见、名字只在别的单元、同名两个类为歧义、目标在仓库外、工厂方法定义作目标、消费者继承父定义的类、工厂方法定义作消费者、没有外层 bean、消费者在仓库外。
- [x] 4.2 `injects` 边与证据按 design D7：每个（消费者类，目标类）一条；证据含文件、行、`token`、`site`、消费者行与继承经过的绑定处、目标解析经过的全部绑定处；排序去重；自环照画。
  验证：测试断言精确的边与证据；规格场景「证据可复核」在夹具产物上读行核对。
- [x] 4.3 覆盖、缺口与守恒按 design D8：五类缺口的说明文字与样例形式；两条守恒不平衡时抛错；未收到站点与目录时为 `not-run`。
  验证：测试分别构造桶之和不等、缺口回读不等，断言抛错；`not-run` 一条断言；规格场景「守恒不平衡时构建失败」。
- [x] 4.4 变异绊线 `injectionIgnoreUnits`、`injectionFirstBinding`、`ignoreFileScope` 各让至少一条测试变红；第 2 步的十条绊线在共用绑定表上仍各让至少一条测试变红。不改生产默认值。
  验证：测试里逐个打开开关，断言结果变化。

## 5. 接入流水线与夹具

- [x] 5.1 新夹具 `tests/fixtures/spring-xml-injection/`，内容覆盖 design O1 列出的全部情形。
  验证：5.2 的管道测试断言精确的边列表、证据、十四个桶与普查计数。
- [x] 5.2 `build-fact-graph.mjs` 构建一次绑定表，依次跑 EL 与注入，写 `coverage.injections`、缺口与守恒；`lazy-analyze.mjs` 的 `nameReferences` 阶段传入注入点。`PIPELINE_VERSION` 升到 `lazy-fact-graph/8`，注释写明新增的事实；冻结摘要用生成器整块重冻。
  验证：`tests/lazy/xml-injection-pipeline.test.mjs` 在夹具上跑 Lazy，断言边、桶与 stages 行；三件套全绿；commit 说明列出每个重冻的摘要及原因。
- [x] 5.3 `retrieve.mjs` 的 `DETERMINISTIC_EDGE_TYPES` 加入 `injects`；`validate-graph.mjs` 对 `injects` 的期望 token 取证据的 `token`。
  验证：测试覆盖规格场景「从被注入的类遍历到消费者」「证据行不含名字时校验报出」；在 5.1 的夹具产物上跑图校验，没有新增告警。
- [x] 5.4 检查其它可能拒绝或误判新边、新覆盖段的位置，按需最小修改。位置包括：schema、`annotate-graph.mjs`、`project-service.mjs` 的状态输出、MCP `project_status`、活跃变更 `dead-code-detection` 读入边的地方。
  验证：逐处说明查过的位置及结论；夹具产物经 `project_status` 能看到 `injections` 覆盖。

## 6. 验收与记录

- [x] 6.1 acceptor 按 design「验收 Oracle」O2–O7 在固定语料上验收，O4b 包括在内。每项给出命令、计数与结论，编造与遗漏分开计数；报告存在仓库外。抽查发现编造时，按预先承诺的 F1 / F2 或「先改源头」执行，并在本文件追加对应任务。
  验证：报告中每项 oracle 都有通过 / 不通过结论和证据。
- [x] 6.2 全量门 O8 通过后，把验收摘要写进本文件末尾。摘要只放计数、耗时、结论，不放真实项目的源码或路径。
  验证：`openspec validate --all --strict` 通过。

## 验收摘要

最终验收在 `df5d3253` 上完成，一轮通过。注入语料 3 个：Sakai 12.7、OSCAR、OpenMRS core。第 2 步回归语料：Dataverse、Sakai 12.7、Seam 2.2 examples、Cargo Tracker、TomEE 8.x examples。不回归语料：go-multirepo 的两个仓库、mixed-suite 的两个项目、hadoop、fineract。耗时语料为 Sakai `master` 与 hadoop。

acceptor 的分桶引擎、审计、对账与 XML 计数脚本都独立于被测代码实现，不引用 `skills/excavator`。每个仪器先用埋入的已知差异证明能报出差异，D11 的每条变异在 selftest 上都能被抓到。预期数在任何 `/8` 产物出现之前登记。登记时发现两处规格措辞与 design 不一致（`nonIdentifierNames` 计数、`missingNames` 的别名键），已裁定并同步修订 proposal 与 design。报告存在仓库外。

| oracle | 结论 | 计数 |
|---|---|---|
| O1 夹具与绊线 | 通过 | 夹具覆盖 11 种注入点形状、14 个桶中随附目录能到达的 13 个（资源包桶由单测覆盖）与普查四种形状；D11 的变异绊线各至少让一条测试变红 |
| O2 全量审计 | 通过 | 3 个注入语料共 882 条 `injects` 边、1,499 条证据，编造 0、遗漏 0；埋错证明在 Sakai 上 4/4 报出，另两个语料 2/2（跨单元与外层消费者两种在这两个语料上无法埋入） |
| O3 桶与普查对账 | 通过 | 13/13 个语料与独立重算完全一致：十四个桶、按注入点 id 的计数、普查未读计数、注入族文件数；独立 XML 计数与引擎一致 |
| O4 不回归 | 通过 | 6/6：节点、全部非 `injects` 边与既有缺口完全一致；新增 `injects` 边与缺口为 0；覆盖只多 `injections` 一段（`ran`、全零）与两个值为 0 的 `spring-xml-alias` 键 |
| O4b 第 2 步回归 | 通过 | 5/5：节点与全部非 `injects` 边一致，`references` 边、证据与 `nameReferences` 的桶一致；D3 三条规则在这些语料上未改变任何 EL 结果，工厂方法规则没有让任何 `references` 边消失；Sakai `nonIdentifierNames` 796 → 801（5 个点分别名），与预登记一致 |
| O5 耗时 | 通过 | 3 次中位数：Sakai `master` −1.3%（94.47 → 93.23 s），hadoop −0.3%（151.29 → 150.78 s）；`nameReferences` 阶段分别为 399 → 407 ms 与 85 → 84 ms |
| O6 人工抽查 | 通过 | 编造 0。读 Sakai 132 条、OSCAR 55 条、OpenMRS 35 条，含边、缺口样例全读、「他处」与「无绑定」各随机 20 条、仓库外消费者 10 条。抽到的边全部正确（57 / 40 / 15）。遗漏都在可见缺口里，归因见下 |
| O7 真实 MCP | 通过 | OSCAR 上经 stdio 调用全部工具，15/15 项检查通过：从一个只由 XML 绑定的 DAO 类经 `injects` 一跳到达消费者；`read_evidence` 读回注入行与消费者定义；`project_status` 报出 `injections` 覆盖与注入缺口；会话前后产物摘要不变 |
| O8 全量门 | 通过 | 根测试 2,425 通过 / 4 跳过；core 1,121；typecheck；check-refs；`openspec validate --all --strict` 38/38；core 与 `main` 无差异 |

注入覆盖（`df5d3253`）：

| 语料 | 注入点 | 成边 | 正确不成边（仓库外目标或消费者） | 缺口 |
|---|---|---|---|---|
| Sakai 12.7 | 3,740 | 1,359（36.3%） | 333 | 2,048 |
| OSCAR | 179 | 128（71.5%） | 34 | 17 |
| OpenMRS core | 48 | 12（25.0%） | 3 | 33 |

Sakai 的缺口里，「他处」1,845 个是最大一类：Sakai 的组件 bean 在运行时跨部署单元共享，而 D6 只看本单元。TomEE 有 28 个不带命名空间的 CDI `beans.xml` 按 D1 计为注入族文件，注入点为 0，记为观察。

O6 抽到的遗漏都在缺口里可见，按原因归类：

| 原因 | Sakai | OpenMRS |
|---|---|---|
| 目标在别的部署单元（「他处」，D6 的设计范围） | 22 | 0 |
| 测试源码里同单元同名的绑定让主代码的目标歧义或未知 | 6 | 0 |
| 匿名顶层 bean：Spring 以类名注册别名，目录没有对应绑定器 | 2 | 0 |
| 不写类的抽象模板（D5 未展开模板） | 2 | 0 |
| 消费者或目标是工厂方法定义（D3，目标未知） | 0 | 6 |

对匿名 bean 别名另做全量计数：Sakai 共 5 条遗漏，全部落「无绑定」；OSCAR 与 OpenMRS 为 0。

预先承诺的 F1 / F2 没有触发：两者的条件是编造，本轮编造为 0。测试源码绑定造成的歧义已经以缺口形式可见。后续步骤的候选有三项，都是覆盖问题，不是正确性问题：
- 按模块依赖放开「他处」的可见性；
- 主代码注入点排除测试源码绑定；
- 匿名 bean 的类名别名。
