## Why

JSF 页面不写 bean 的类名，写的是 EL 名字：`#{orderBean.save}`。名字到类的绑定声明在别处，比如 `faces-config.xml` 的 `<managed-bean>`、类上的 `@Named` / `@ManagedBean` / `@Name`、Spring XML 的 `<bean id>`、Seam 的 `components.xml`。第 1 步（name-mention-facts）只认字面写出的类名与路径，所以页面到 bean 的关系仍然缺失：只被页面使用的 backing bean 依旧没有入边，看起来没人引用。按本变更的规则做的探针（Python 近似实现，仅作量级参考）显示：Dataverse、Sakai 12.7、Seam 2.2 examples 页面里的 EL 根名分别约 9.8k、24.4k、7.2k 处，其中在同一部署单元内能唯一落到仓库类的约 37%、57%、39%。

难点在于既不编造，也不为某个技术栈硬编码：

- 哪些 XML 元素、哪些注解声明了名字，没写名字时缺省名怎么来，EL 能看见哪些名字，都是框架语义，无法从文本结构推出。写进代码，就成了为某个栈定制。
- 名字的作用域是部署单元。两个独立示例各有一个 `person` bean 时，跨单元按名字匹配会把一个页面连到另一个应用的类。Seam 2.2 示例里这种跨示例同名很常见，比如几个示例各自声明同名的 `@Name` 组件。

做法：框架知识只作为数据，写成一份声明式的名字绑定目录；代码只实现与目录内容无关的机制，即读绑定、算单元、对 EL 做词法分析、按规则把每个根名落进一个桶。绑定在页面所在单元内唯一落到仓库类时成边，其余进可见的桶或缺口。

## What Changes

- **名字绑定目录（数据文件）**：声明以下内容。
  - XML 绑定器：根元素、元素、名字与类各从哪里读。
  - 注解绑定器：注解全限定名、名字参数、缺省名规则。
  - 表达式语言：分隔符、文件类别、隐式对象、声明局部变量的属性、可见的命名空间及其条件。
  - 部署单元描述符。

  随附 JSF、CDI、Seam、Spring 与 JSF / JSP EL 的条目。其中 Spring bean 只有在单元声明了 JSF 桥接解析器时才对 EL 可见。目录严格校验，出现未知键或缺字段即失败。
- **Core Java 抽取器**：顶层类型的注解额外记录参数。字符串字面量记取值，其它写法标为非字面量。`@Named("x")` 这类显式名字由此可读。
- **名字绑定事实**：按目录从 XML 描述符与类注解读出「名字 → 类」。注解按 Java 作用域规则确认身份，规则包括全限定写法、单类型导入、同包声明和按需导入；确认不了的不算绑定，只计数。
- **部署单元**：文件所属的单元是最近的含构建描述符的祖先目录，描述符清单来自目录数据。没有这样祖先的文件属于仓库单元。
- **EL 引用**：
  - 对表达式文件做词法扫描，范围是 Facelets / JSP 系列扩展名、faces-config 和 Seam 页面描述符，取出 `#{…}` / `${…}`。注释、JSP 脚本段与转义的表达式跳过。
  - 取出每个根名及其成员链。成员链本步只用于点分名匹配（CDI、Seam 的 `@Named("admin.track")` 经 `#{admin.track.x}` 访问），不解析到成员。
  - 根名依次落入：局部变量、隐式对象、单元内可见绑定、其它单元或不可见命名空间里的绑定、无绑定。单元内可见绑定再细分为：唯一类（成边）、资源包、歧义、类未建索引、类在仓库外、未写类。
- **新事实边 `references`**：从页面文件指向 bean 类，证据为页面行、根名与绑定处（文件、行、绑定器）。它进入可遍历的确定性边集合，验证器按根名核对页面行。
- **覆盖与缺口**：新增 `coverage.nameReferences` 覆盖段，配守恒断言，并新增五类缺口。覆盖段记录：
  - 按绑定器计的绑定数；
  - 按桶计的根名数；
  - 含 `#{` 却不在表达式文件类别里的文件，按扩展名与根元素计数。
- `PIPELINE_VERSION` 升到 `lazy-fact-graph/7`。
- **不在本变更内（后续步骤）**：
  - 成员链解析到方法 / 属性；
  - 导航，包括 `navigation-case`、隐式 outcome 和 Java 字符串字面量；
  - Spring `ref=` 与 EJB / CDI 注入边；
  - 按模块依赖声明放开跨单元可见；
  - producer / factory 方法与嵌套类型声明的名字；
  - 项目自定义目录（企业内部框架的注解与描述符）；
  - `.xhtml` 语言注册与 `jsf` 框架附录；
  - Spring XML 内的 SpEL；
  - Thymeleaf 等其它模板语言。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fact-graph`：新增「名字绑定」「EL 名字引用生成 references 边」「references 边的证据与遍历」三项要求。只用 ADDED，不改既有要求的原文，避免与未归档的 dead-code-detection 冲突。

## Impact

- **代码**：
  - Core：`packages/core/src/plugins/extractors/java-declaration-facts.ts`、`java-extractor.ts`，`packages/core/src/types.ts`（新增可选字段）。
  - skill：`skills/excavator/extract-structure-result.mjs`（字段校验）；新增目录数据文件与它的加载器、绑定与 EL 的词法模块、解析模块；`lazy-analyze.mjs`、`build-fact-graph.mjs`、`retrieve.mjs`、`validate-graph.mjs`。
- **产物**：knowledge graph 新增 `references` 边、五类缺口与一段覆盖。旧产物因版本号变化，在下次同步时整体重投影。
- **不影响**：既有节点与边（含第 1 步的 `mentions`），以及 MCP 工具的参数与形状。
- **语料**：验收使用 Dataverse、Sakai 12.7、Seam 2.2 examples、Cargo Tracker、TomEE 8.x examples 的固定提交，回归用 go-multirepo / mixed-suite。真实项目的源码、路径与输出不提交。
