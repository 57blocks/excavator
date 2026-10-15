## Context

动机见 proposal.md。可复用的现有部件：
- 顶层 Java 类型的注解（`classes[].annotationArguments`）与类型种类（`kind`）由 Core 抽取；
- 注解身份由 `createAnnotationIdentity` 确认（name-reference-resolution.mjs），名字绑定、注入点与路由三个阶段共用；
- 非代码文件由 `collectNameReferenceSites` 一趟读完，根元素被某个目录读取的描述符解析一次（`parseXml`）；
- 类名到声明由 `typesByFqn` 与 `resolveClassName` 判定（mention-resolution.mjs）；
- 页面到 bean 的 `references` 边在证据里记下了绑定者（`bindings[].binder`）；
- Full 的分层由 `semantic-graph.mjs write` 净化后写入 `semantic-graph.json`。

## Goals / Non-Goals

**Goals：**
- 由注解、描述符与 EL 绑定确定的组件角色及其层，成为类节点上可复核的事实；
- 每个来源点落入可见桶，有守恒；
- Lazy 经 MCP 看得到层；Full 的模型分层有确定性审计。

**Non-Goals：**
- 不给没有正向证据的类型分层（见 D6）。
- 不改 Core。
- 不读 `layerHints`：它按目录名猜层，不是代码事实。
- 不碰经典 Full 的 Phase 4，它不经过事实图。
- 不读 `orm.xml`：它的类名写在属性里，不是子元素文本。
- 嵌套类型上的注解：Core 只给顶层类型抽注解。EJB 组件类必须是顶层类，影响面小。
- 不用真实模型跑 Phase F3。审计让偏差可见，模型的遵从度留到 P0 第 5 步测量。

## Decisions

### D1 角色与层写在目录里，层次顺序决定多角色的层

`catalogs/component-roles.json` 列出角色、层与层次顺序，每项带依据。加载器沿用其它目录的严格加载：未知键、缺字段、类型不符，或层不在层次顺序里，都直接失败。

层次顺序为 api、middleware、service、data、ui、utility：
- 入口按暴露什么归层；
- 包裹者排在被包裹者之前；
- 会话 bean 排在 backing bean 之前，与附录相同。

一个类的全部角色都记下，层次顺序只决定 `layer`。

考虑过、没采用的：角色分属不同层就不给层、记成缺口。

按行首写法粗测，写类级 `@Path` 的文件里同时写会话 bean 注解的：
- Dataverse：45 个里有 16 个；
- Cargo Tracker：3 个全是；
- TomEE examples：68 个里有 18 个。

这样会让大量 API 类没有层，而附录本来就能给出归属。

### D2 三种来源，各复用现有的读取

- **注解**：用 `createAnnotationIdentity` 确认，`fqns` 取目录里全部角色注解与排除注解。
- **描述符**：
  - 在 xml-name-bindings.mjs 加 `componentRolesOfTree(tree, roles)`，按根元素本地名、父元素与元素匹配，读类名子元素的文本与行；
  - `collectNameReferenceSites` 接受角色目录，把角色描述符的根加进「需要解析」的判定，在同一趟里产出 `componentRoleDeclarations`；
  - 不新增遍历全部文件的阶段。
- **绑定**：在 `buildFactGraph` 里，组件角色阶段排在名字引用阶段之后，读已生成的 `references` 边。

### D3 描述符的类名整段匹配

`resolveClassName` 取最长前缀，`Outer$Inner` 会落到 `Outer`。这对「提及」成立，对角色就是编造。

判定：
- 把 `$` 换成 `.` 之后，整段在 `typesByFqn` 里：
  - 一个声明，且有节点：成角色；
  - 一个声明，没有节点：未建索引；
  - 多个声明：多个声明。
- 整段不在：再问 `resolveClassName`：
  - 它返回仓库内（只能是前缀命中，即嵌套类型）或未建索引：未建索引；
  - 它返回仓库外：仓库外。

### D4 角色是类节点的属性

`componentRoles` 与 `layer` 写在类节点上，图 schema 本来就允许附加属性。

考虑过、没采用的：
- 在 Lazy 产物里写 `layers[]`：Lazy 按设计不带分层，只覆盖部分节点的 `layers[]` 会被读成完整的分层。
- 层节点加归属边：层不是代码里的声明，没有锚点。

图校验按证据核对，与边证据相同：行含 `token`。

### D5 backing bean 来自 references 边，证据取一条见证

角色目录的 `boundBy` 写名字绑定目录的绑定者 id，`@Named` 与 `@Model` 各一个。只有绑定来自这些绑定者的 `references` 边才算：
- Spring 等其它绑定者绑定的类，经 EL 引用也不是 backing bean；
- 附录也只认 `@Named` 与 `@Model`。

一个常用的 bean 可能被上百处引用，所以证据只取按文件与行排在最前的一条。完整的引用在 `references` 边上。

### D6 只认正向证据

没有页面绑定，不能推出不是 backing bean：
- 页面可能不在选择范围里；
- 表达式可能落在未解析的桶里。

用「没有」来定层，会在 EL 覆盖不全的语料上把 backing bean 判成服务层。所以：
- 只带作用域注解、或没被绑定的 `@Named` 类不给层；
- 附录没有给出层的角色（监听器、生产者、观察者）不进目录。

这些类型的分层仍由模型决定，Full 审计不管它们。

### D7 Phase F3 只喂入与审计，不改写

审计放在 `semantic-graph.mjs write`。它已经有事实图与净化后的分层，审计在净化之后、写盘之前进行：
- 缺口进 `semantic-graph.json` 的 `gaps`；
- 分层原样写出。

文件的确定性层只在它的类节点同层时成立。Java 文件一般只有一个顶层类型，不同层的情形不审计文件。

### D8 版本与 MCP

- 类节点多了属性，事实摘要随之改变，`PIPELINE_VERSION` 升到 `lazy-fact-graph/13`。
- `traverse` 的节点投影与 `recall` 的候选，在节点有层时加 `layer` 与 `componentRoles`（只列角色 id）。只加字段，原有字段不变。

### D9 测试

- **目录**：严格加载的每种失败一条；`boundBy` 引用的绑定者在名字绑定目录里存在；每个角色的层出现在 Java EE 或 JSF 附录的层表里。
- **解析**：规格的每个场景一条测试；每个桶至少一条；守恒。
- **夹具**：在 `tests/fixtures/javaee-jsf-app` 补上规格场景需要的类与描述符条目。会改变既有测试钉住计数的，用生成器整块重冻，逐项写明原因。
- **绊线**（`mutations` 测试缝），每条都必须让对应测试变红：
  - `prefixClassName`：描述符改用 `resolveClassName` 的最长前缀，嵌套类型场景变红；
  - `simpleNames`：注解按简单名认；
  - `noExclusion`：不看排除注解；
  - `lastLayer`：取层次顺序里最靠后的层；
  - `anyBinder`：任何 `references` 边都算绑定；
  - `noAuditFiles`：审计不看文件节点。

## Risks / Trade-offs

- 事实图版本变化，每个项目下一次同步完整重投影一次。
- 层次顺序是约定：例如 `@Stateless @Path` 放在 api，有人会主张放在 service。全部角色都记下，任何人都能看到依据，改约定只改目录。
- 模型若用了附录以外的层 id，会对每个有层的节点记缺口。这是正确的信号，不放宽。
- `persistence.xml` 的 `<class>` 也可能列 JPA 转换器，所以角色叫 `persistence-unit-class`，不叫实体，层仍是 data。

## 验收 Oracle（动手前写死）

全部 build-free：语料只读，不编译、不装运行时、不删副本中的文件。产物不进仓库。

按风险分级：
- 本特性触发的语料做全量核对。
- 只读非代码文件与 Java 结构行的阶段，在非 Java 语料上不可能触发，抽两个做不回归即可。
- 不测耗时：描述符的解析搭在已有的一趟读取上，不新增遍历全部文件的阶段。

- **O1 单测与绊线**（coder）：D9 的全部测试，绊线逐条变红的记录。
- **O2 独立角色核对**（acceptor）：
  - 对象：本地触发本特性的 Java 语料，至少 Dataverse、TomEE examples、Cargo Tracker、DayTrader 的三个版本（其中 geronimo 版本是 EJB 2.x，以描述符为主）、jboss-seam-2.2、fineract、hadoop。其余 Java 语料是否触发，由 acceptor 先用独立读取判定并写进报告。
  - 独立计算：不引用本仓库代码。自写读取：
    - 用正则读 Java 文件的 import 与顶层类型上的注解；
    - 用 XML 解析读描述符；
    - 按规格的角色表算出每个类型的期望角色集与层。
  - 断言：
    - 产品的（类，角色）集合与独立计算逐条相符；
    - 不相符的每一条都落在产品记下的桶里（未确认写法、未建索引、多个声明、不适用），并按类别解释。
  - 分层人工抽查：
    - 全部多层类，每种层组合至少 3 个；
    - backing bean 10 个；
    - 只由描述符得到角色的 10 个；
    - 「仓库外」的 10 个：在仓库里搜索，确认确实没有该声明；
    - 每个缺口类别 3 个。
  - 装置先验：在产品副本里改掉 3 个类的角色，确认核对能报出。
- **O3 不回归**（acceptor）：
  - 触发的语料，加两个非 Java 语料（koel 与一个私有 C# 语料），改后对比 `lazy-fact-graph/12` 的产物；
  - 允许的差异只有：
    - 类节点多出 `componentRoles` 与 `layer`；
    - 覆盖多出 `componentRoles`；
    - 多出两种新缺口；
    - 版本与每次运行各异的字段。
  - 节点、边与其余缺口必须完全相同。非 Java 语料没有任何角色。
- **O4 真实 MCP**（acceptor），在 Dataverse 上：
  - 一个会话 bean 的 `traverse` 节点带 `layer: "layer:service"`；
  - `recall` 一个实体，候选带 `layer: "layer:data"`；
  - `read_evidence` 读角色证据所在行，含 `token`。
- **O5 分层审计装置**（acceptor，无模型）：在 Dataverse 的事实上，用 O2 的独立期望构造分层文件，跑 `semantic-graph.mjs write`：
  - 全部放对：没有 `layer-role-` 缺口；
  - 把 3 个文件放错：恰好 3 条 `layer-role-mismatch`；
  - 漏掉 2 个：恰好 2 条 `layer-role-unplaced`；
  - 写出的分层与输入相同。
- **O6 全量门**（我跑），依次：
  1. `pnpm --filter @excavator/core build`；
  2. core 测试；
  3. `pnpm typecheck`；
  4. `pnpm exec vitest run --maxWorkers=4`；
  5. `node scripts/check-refs.mjs`；
  6. `openspec validate --all --strict`。

  中间 commit 各自通过。

预案：
- O2 出现产品有、独立计算没有的角色：这是编造，停下修，不放宽 oracle。
- O2 出现独立计算有、产品没有、又不在任何桶里的角色：这是静默漏，修到它落进可见桶。
- O3 出现允许以外的差异：停下查明是哪个阶段的问题。
