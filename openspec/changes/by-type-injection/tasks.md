执行约束：
- 人员：一个 coder（Sonnet），一个 acceptor（Opus）。
- 验收 oracle 见 design.md「验收 Oracle」，动手前已写死。
- 语言：代码、测试与注释用英文，OpenSpec 用中文。
- build-free：不编译目标项目，不安装运行时，不下载依赖。
- 分支：`feat/by-type-injection` 基于 `main`；`jaxrs-route-facts` 已归档。
- 本变更改 Core：每次改完 Core 都要重建 core dist，再跑 skill 测试。
- 公开仓库：夹具、测试与提交信息里不出现客户、产品或私有语料的名字。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入，每个 commit 单独可测）：

0. `docs(openspec): archive jaxrs-route-facts`（已完成）。
1. `docs(openspec): propose by-type-injection`：proposal、design、规格增量、tasks。
2. `feat(core): record Java type modifiers and nested type declarations`：任务 1.1。
3. `feat(core): record class literals in annotation arguments and member types`：任务 1.2–1.3。
4. `feat(facts): type injection catalog`：任务 2.1–2.2。
5. `feat(facts): type queries on the Java call resolver`：任务 3.1。
6. `feat(facts): resolve by-type injection points`：任务 3.2–3.5。
7. `feat(facts): EJB business interfaces declared by annotation`：任务 3.6。
8. `feat(lazy): project by-type injects and declared implements into the fact graph`：任务 4.1–4.4。
9. `docs(skill): by-type injection is a fact in the javaee addendum`：任务 5.1。
10. `docs(openspec): record by-type-injection acceptance`：任务 6.1–6.2。

## 1. Core：Java 结构行的四项事实

- [ ] 1.1 按 design D3，`types.ts` 与 Java 抽取器补两项：
  - `classes[].modifiers`：顶层类型声明上的修饰符关键字，源码顺序，不含注解；
  - `nestedTypes`：顶层以下的每个类型声明与匿名类，源码顺序。字段为 `kind`、`name`、`line`、`owner`、`local`、`modifiers`、`supertypes`，匿名类另有 `instantiates`。枚举常量体不记。

  测试精确断言以下情形：
  - 成员类与静态嵌套类、局部类、匿名类、嵌套接口、嵌套 `enum` 与 `record`；
  - 嵌套在匿名类里的类型；
  - 顶层注解类型里的嵌套类型；
  - 顶层类型各种修饰符组合；
  - 带注解的修饰符列表（注解不进列表）。
- [ ] 1.2 按 D3 补另外两项：
  - 注解参数的 `classLiterals`：类型注解与成员注解两处都补。单个类字面量、数组初始化器、混有非类字面量的数组、跨行的数组、全限定写法、带泛型或数组维度的类字面量，各有精确断言；`value` 仍为 `null`。
  - `memberAnnotations[].member.type`：字段（含声明符上的数组维度、一行多个声明符）、方法返回类型、构造器（没有）、参数与 record 组件所属成员的取值，各有精确断言。
- [ ] 1.3 `extract-structure-result.mjs` 透传并校验三处新形状：`modifiers`、`nestedTypes`、参数 `classLiterals` 与 `member.type`。坏形状让该文件落 `parse-failed`，每种坏形状一条测试。

  在本任务下写明两项核查结论：
  - 结构抽取有没有按内容或版本的缓存；
  - 结构行的其它读者在新字段上会不会出错：`build-source-index.mjs`、`annotate-graph.mjs`、`java-call-resolution.mjs`、`mention-sites.mjs`、`fingerprint.ts`。

  重建 core dist；core 测试、typecheck、根测试全绿。

## 2. 按类型注入目录

- [ ] 2.1 新模块 `skills/excavator/type-injection-catalog.mjs`，提供 `parseTypeInjectionCatalog(value)` 与 `loadTypeInjectionCatalog(path = SHIPPED_TYPE_INJECTION_CATALOG)`，按 design D4 严格校验。测试覆盖每一种失败：
  - 未知键、缺字段、类型不符；
  - 空的 `annotations` 或 `on`；
  - `on` 里出现未知的成员种类；
  - 族 id 重复；
  - 不是点分名；
  - 同一全限定名出现在两个角色里；
  - 版本不符。
- [ ] 2.2 随附 `skills/excavator/catalogs/type-injections.json`，内容照 D4，每个族与每个角色一句 `basis`。

## 3. 解析

- [ ] 3.1 `java-call-resolution.mjs` 的返回对象新增 D6 的只读类型查询，复用内部的 `resolveType`、`supertypesOf`、`hierarchy`，不改既有行为：
  - 在给定文件与所属顶层类型的作用域里解析类型文本，可附加方法的类型参数；
  - 列出全部顶层类型；
  - 列出一个类型已解析的父类型。

  新查询有单元测试，覆盖仓库内、仓库外、未知、嵌套类型、全限定名重复、类型变量。既有测试一条不改。
- [ ] 3.2 新模块 `skills/excavator/type-injection-resolution.mjs` 的 `resolveTypeInjections({ javaRows, catalog, identity, types, classIdOf, functionIdOf, mutations })`：
  - 按 D5 读注入点、确认身份、找方法声明；
  - 按 D7 建子类型闭包与候选集；
  - 按 D8 处理限定符；
  - 按规格的顺序落十六个桶，恰一个候选时产出待画的 `injects` 边。

  模块是纯函数，不读文件，代码里不出现任何框架名字。遇到有类型、却没有 `memberAnnotations` 或 `nestedTypes` 的行时抛错，指明可能是旧抽取的产物。
- [ ] 3.3 证据按 D11：每个成边的注入点给出「注入」「成员」两条，按情况加「限定符」「生产者」。本阶段的边先按（源，目标）合并，证据排序去重。
- [ ] 3.4 覆盖、缺口与守恒按 D12：
  - 五类 `type-injection-*` 缺口的样例格式照 D12；
  - 提供 `assertTypeInjectionConservation`；
  - 没有目录时为 `not-run`。
- [ ] 3.5 D14 的变异开关（`noBusinessInterfaces` 除外），每个至少让一条测试变红；不改生产默认值。规格「Java 按类型注入点」的每个场景至少一条单元测试。
- [ ] 3.6 业务接口按 D10：
  - 八个桶；
  - `implements` 边及其证据；
  - 接口进入子类型闭包，解析为未知的进简单名阻断集；
  - `business-interface-unresolved` 缺口；
  - 覆盖段与守恒；
  - 开关 `noBusinessInterfaces`。

  规格「EJB 注解声明的业务接口」的每个场景至少一条单元测试。

## 4. 接入流水线与夹具

- [ ] 4.1 `annotation-injection-resolution.mjs` 的 `mergeInjectsEdges` 增加 `typeEdges` 来源，按 D11 合并、排序去重；`noInjectsMerge` 对三个来源同样生效。测试覆盖：
  - 按名字与按类型落在同一对上；
  - 只有按类型的边；
  - 开关打开时的行为。
- [ ] 4.2 `build-fact-graph.mjs` 按 D13：
  - 新参数 `typeInjectionCatalog`。给了它却没给 `mentionInputs` 时抛错；
  - 复用已建的调用解析器实例；
  - 业务接口的 `implements` 边跳过已有的同端点边；
  - 按类型的边经 `mergeInjectsEdges` 与名字阶段的边一起加入；名字阶段没运行时单独加入；
  - 缺口进 `gapCollector`；
  - 覆盖进 `coverage.typeInjections`。

  按 D13 逐个检查按边类型或覆盖段分支的位置，在本任务下写明结论。
- [ ] 4.3 `lazy-analyze.mjs` 加载目录（可注入），`PIPELINE_VERSION` 升到 `lazy-fact-graph/12`。独立 CLI 入口照旧不传目录。
- [ ] 4.4 夹具：在 `tests/fixtures/javaee-jsf-app/` 新增模块 `orders-inject/`，有自己的 `pom.xml`，并登记进父 `pom.xml`。内容覆盖 design O1 列出的全部情形。新增流水线测试 `tests/lazy/type-injection-pipeline.test.mjs`，断言：
  - 精确的边、证据、桶、缺口与覆盖；
  - 图校验通过；
  - 从实现类 1 跳入边遍历能到消费者；
  - 证据行号被改成不含 `token` 的行时，图校验报出。

  既有测试锁定的计数如有变化（清单文件数、名字计数、版本号字符串等），逐项写明来源。

## 5. 附录

- [ ] 5.1 按 D15 修改 `skills/excavator/frameworks/javaee.md` 与 `frameworks/README.md`。若 `test_prompt_evidence_sections` 一类测试锁定了附录的段落，同步更新，并写明变化。

## 6. 验收与记录

- [ ] 6.1 acceptor 按 design「验收 Oracle」O2–O7 执行，产出报告，放在 `excavator-test-runs/by-type-injection/`，不进仓库；O8 由我跑。
- [ ] 6.2 在本文件末尾写「验收摘要」，内容为：
  - 候选提交与基线；
  - O2–O8 的结果表；
  - 每个语料的注入点、边与主要桶；
  - 已知限制。

  语料用公开名字，私有语料只写「两个私有语料」。
