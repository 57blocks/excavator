## Context

- 第 1 步（name-mention-facts，已归档）建立了以下基础：
  - 非代码文件的词法阶段 `text-mentions.mjs`，含标记语言注释遮蔽与元素 / 属性上下文，并有带栈的 `markupSegments`；
  - 投影中的跨文件解析 `mention-resolution.mjs`，即类名按最长前缀匹配 Java 顶层类型，「存在但未建索引」以文件自己的声明为准；
  - `mentions` 边、三类缺口与 `coverage.mentions`；
  - `buildFactGraph` 未收到站点时，覆盖记 `not-run`。

  本变更沿用同一形状：单文件词法阶段 → 投影中解析 → 每个候选落成边或可见桶 → 守恒断言。
- 扫描把 `.xhtml`、`.jsp`、`.tag` 等未声明扩展名的文件按扩展名作语言 id 收进 source-manifest（第 1 步的管线测试已覆盖 `xhtml` 与 `jsp`）。
- Core 的 Java 结构抽取只为顶层类型记录注解名（`classes[].annotations`，照写法记录，如 `Named` 或 `javax.inject.Named`），没有参数值。另外记录了 `imports`（含按需导入 `p.*`）和 `qualifiedName`（包名 + 类名）。结构每次运行重新抽取，无跨运行缓存。`extract-structure-result.mjs` 对已知字段做校验。
- 框架附录（`skills/excavator/frameworks/*.md`）是给模型的提示。README 规定：只因框架惯例而成立的关系没有可引用的记录，确定性阶段不得把惯例当事实。
- 探针：用 Python 按本设计近似实现，仅作量级参考，不是 oracle。结果见下表，各桶说明见 D7。

  | 语料 | 单元 | 根名 | 成边 | 局部 | 资源包 | 隐式 | 他处 | 无绑定 |
  |---|---|---|---|---|---|---|---|---|
  | Dataverse | 5 | 9,818 | 36% | 27% | 25% | 1% | 0 | 8% |
  | Sakai 12.7 | 441 | 24,380 | 56% | 20% | — | 1% | 15% | 5% |
  | Seam 2.2 examples | 42 | 7,244 | 39% | 16% | — | 0 | 2% | 40% |
  | Cargo Tracker | 1 | 213 | 43% | 30% | — | 8% | 0 | 18% |
  | TomEE 8.x examples | 222 | 378 | 32% | 14% | 15% | 5% | 1% | 30% |

  Seam 的「无绑定」主要是框架库里的内置组件，比如 `messages`、`identity`。Sakai 的「他处」主要是其它工具模块里同名的资源包与 bean。

## Goals / Non-Goals

**Goals:**

- 页面经 EL 名字使用的 bean 类得到一条带逐行证据的入边，证据能复核：页面行、根名、绑定处。
- 代码里不出现任何框架、注解、元素名或默认命名规则。这些都在目录数据里，每条带依据说明。
- 每个 EL 根名都落进一个可见桶，共十种，用守恒断言保证没有第十一种去向。不能锚定的一律成缺口，不放宽匹配范围去找。

**Non-Goals（设计层面）:**

- 不实现 EL 求值语义（解析器链顺序、作用域属性），只用「隐式名字 → 局部变量 → 单元内可见绑定」这个静态近似。顺序的理由见 D7。
- 不建 bean 节点或「名字」节点。边直接指向类节点，名字留在证据里。
- 不解析 Kotlin / Scala / Groovy 源文件上的注解，也不读嵌套类型和成员（producer / factory）上的注解。被它们绑定的名字落「无绑定」，原因写在缺口说明里。
- 不展开元注解：以 `@Component` 或 `@Named` 为元注解的自定义构造型（如 CDI 的自定义 stereotype、Spring 的自定义 `@Service` 变体）不产生绑定。展开需要读仓库里的注解类型声明，属于后续步骤。
- 不读容器注解里嵌套的注解（如 Seam 的 `@Roles({@Role(...)})`）。Core 对数组与嵌套注解参数只记 `null`。
- 不跨文件传播局部名：静态 include（`<%@ include file=… %>`）的被包含片段、`jsp:useBean scope="session"` 在别的页面创建的对象，在片段里仍按本文件规则分桶，多落「无绑定」或「他处」。

## Decisions

**D0：为什么落代码，而不是交给 skill / prompt。**

- 绑定与引用是结构化的代码事实。探针统计：Sakai 12.7 约有 163 个 `<managed-bean>`、985 个带名字的 Spring `<bean>`，Dataverse 约有 139 个类上的 `@Named`；页面里的 EL 根名以万计。按「结构化代码事实不让模型转写」，这类事实由确定性抽取原样产出。
- 下游的遍历、死代码判定（R5）和审计都需要可复现、可校验的边。
- 什么算绑定、默认名怎么来、EL 看得见什么，属于判断。这些判断写成目录数据，代码只执行。

**D1：名字绑定目录（声明式数据）。**

- 位置：`skills/excavator/catalogs/name-bindings.json`。加载与校验由 `name-binding-catalog.mjs` 负责：校验严格，未知键、缺字段、类型不符都抛错；加载结果深度冻结。lazy 驱动加载随附目录传给投影，测试可以传自己的目录。
- 顶层结构：`version`、`unitDescriptors`、`xmlBinders`、`annotationBinders`、`expressionLanguages`。每个绑定器有 `id`、`basis`（一句话说明依据的框架规范）和 `namespace`。
- **XML 绑定器**的字段：
  - `root`：根元素本地名。
  - `rootNamespace`：可选，根元素命名空间 URI 的白名单。
  - `element`：元素本地名。
  - `parent`：直接父元素本地名。这一项排除 Spring 的内部 bean，它的 `id` 不注册为名字。
  - `name`：取自某个直接子元素的文本（`child`），或取自属性列表（`attribute: [...]`）。`split` 可选，是「属性名 → 分隔字符」的映射，只对所列属性拆分，供 Spring 的 `name="a,b c"` 使用；`id` 不拆。键必须是 `attribute` 里列出的属性。
  - `target`：`kind` 取 `class` 或 `bundle`，值取自 `child` 或 `attribute`。
  - `missingTarget`：必填，元素有名字却没有目标时的含义。`unknown` 表示这是一个目标未知的绑定（Spring 只有 `parent` 或 `factory-bean` 的 `<bean>`）；`configures` 表示该元素是在配置别处声明的同名组件（Seam 不写 `class` 的 `<component>`），详见 D4、D7。
- **注解绑定器**的字段：
  - `annotations`：注解全限定名列表。
  - `nameArguments`：读名字的参数键列表；单个无键参数视为 `value`。
  - `defaultName`：`lowercase-first`、`java-beans-decapitalize` 或 `null`（必须显式写名字）。
- 两种绑定器都有必填的 `namespacedNames`（布尔）：该框架的 EL 解析器是否把点分名当作命名空间。CDI 与 Seam 是：名为 `x.y` 的 bean 经 `#{x.y.z}` 访问，`x` 解析为命名空间。JSF managed bean 与 Spring 的 EL 桥接不是：它们只按整个根名查找，点分名从 EL 访问不到。
- **表达式语言**的字段：
  - `delimiters`；
  - `files`：`extensions`；`templateExtensions`（`extensions` 的子集，整篇作为模板文本扫描的文件，见 D6）；`xmlRoots`（每项 `root` 加可选 `rootNamespace`）；
  - `implicitNames`；
  - `localDeclarations`：每项为 `attribute`，可选限定 `element` 本地名，以及：
    - `elementNamespaces`：可选，元素命名空间 URI 列表，要求同时给 `element`。元素的前缀在本文件中经 `xmlns:前缀` 或 JSP `<%@ taglib prefix uri %>` 绑定到列表中的某个 URI 时才算；不带前缀的元素取默认命名空间。一个前缀在文件里绑定多个 URI 时，任一命中即算（多认局部名只会少成边，不会编造）。
    - `declares`：可选，`literal`（缺省，属性值本身就是名字）或 `expression-root`（属性值里 EL 表达式的根名被声明为局部名，如 Tomahawk `aliasBean` 的 `alias="#{bean}"`）。
  - `sees`：可见命名空间。每项 `namespace` 加可选 `when`，`when` 当前只支持一种形状：`elementTextIn: { root, elements, anyOf }`，即同单元某个该根元素的文件里，所列元素之一的文本等于 `anyOf` 中的一个值。
- **随附条目**（依据写进 `basis`）：

  | 框架 | XML 绑定器 | 注解绑定器 |
  |---|---|---|
  | JSF | faces-config 的 `managed-bean`（父 `faces-config`）；`resource-bundle` 的 `var` → `base-name`，`kind: bundle`，父 `application` | `javax.faces.bean.ManagedBean`（`name`，`lowercase-first`） |
  | CDI | — | `javax.inject.Named` / `jakarta.inject.Named`（`value`，`lowercase-first`）；`javax.enterprise.inject.Model` / `jakarta.enterprise.inject.Model`（无参数，`lowercase-first`）；都是 `namespacedNames: true` |
  | Seam | `components.xml` 的 `component`（父 `components`，根命名空间 `http://jboss.com/products/seam/components`，`missingTarget: configures`） | `org.jboss.seam.annotations.Name`（`value`，`null`）；`org.jboss.seam.annotations.Role`（`name`，`null`，为同一个类再声明一个名字）；都是 `namespacedNames: true` |
  | Spring | `beans/bean`（`id` 与 `name`，只拆 `name`：`split: { name: ",; " }`，`missingTarget: unknown`） | `org.springframework.stereotype.Component` / `Service` / `Repository` / `Controller`（`value`，`java-beans-decapitalize`） |

  JSF 与 Spring 的绑定器 `namespacedNames: false`；JSF 两个 XML 绑定器 `missingTarget: unknown`。

  另有一条表达式语言 `jsf-jsp-el`：
  - 分隔符：`#{`、`${`。
  - 文件：扩展名 `xhtml`、`jsp`、`jspx`、`jspf`、`tag`、`tagx`，其中经典 JSP 的 `jsp`、`jspf`、`tag` 是模板文本扩展名；根元素 `faces-config`；根元素 `pages` / `page`（Seam 页面命名空间）。
  - 隐式名：JSP 2.x 与 JSF 2.0–4.0 隐式对象的并集，共 23 个（含 JSF 2.2 的 `resource`、`flowScope` 与 JSF 2.3 的 `externalContext`）。仓库用的是哪个版本无法确定，取并集。代价：老版本应用里恰好叫 `resource` 或 `externalContext` 的 bean 落「隐式」，不成边；覆盖里的 `implicitWithBinding` 让这种情形可见。
  - 局部声明：
    - 任意元素的 `var`、`varStatus`，以及 Tomahawk 与 PrimeFaces 数据表的 `rowIndexVar`；
    - Facelets `ui` 命名空间（`http://java.sun.com/jsf/facelets`、`http://xmlns.jcp.org/jsf/facelets`、`jakarta.faces.facelets`）下 `param` 元素的 `name`。`f:param`、`c:param`、`jsp:param` 的 `name` 是请求参数名，不是 EL 变量；
    - `useBean` 元素的 `id`，不限命名空间，因为经典 JSP 的 `jsp:` 前缀不声明命名空间；
    - Tomahawk（`http://myfaces.apache.org/tomahawk`）`aliasBean` 元素 `alias` 属性里表达式的根名（`declares: expression-root`）。
  - 可见命名空间：`el` 恒可见。`spring` 仅当同单元某个 faces-config 在 `el-resolver` 或 `variable-resolver` 中声明了 `SpringBeanFacesELResolver`、`DelegatingVariableResolver` 或 `SpringBeanVariableResolver` 时可见（不含 `WebApplicationContextFacesELResolver`，它不把名字解析为 Spring bean）。
  - 单元描述符：`pom.xml`、`build.gradle`、`build.gradle.kts`、`build.xml`、`build.sbt`。
- 被否决的方案：把这些规则写成代码里的分支。那样技术栈就硬编码在代码里，每加一个框架都要改代码；而且规则散落在代码中，无法逐条复核依据。

**D2：Core 记录类型注解的参数（`classes[].annotationArguments`）。**

- 对每个顶层类型的每个注解，记 `{ name, line, arguments }`：
  - `name` 与 `annotations` 的写法一致；
  - `arguments` 的每项为 `{ key, value }`，单值写法的 `key` 是 `value`；
  - 参数是单个字符串字面量（含转义序列）时，`value` 为解码后的字符串，其余写法（常量、拼接、数组、类字面量）一律为 `null`；
  - 无括号或空括号时，`arguments` 为 `[]`。
- 不改 `annotations` 的形状，旧消费者不受影响。`extract-structure-result.mjs` 为新字段加校验。
- 被否决的方案：在 skill 侧用正则读 Java 源文件里的注解。注释、字符串、多行、嵌套括号都会让正则出错，而 Core 已经有语法树。

**D3：注解身份按 Java 作用域规则确认，不按简单名。**

写法 `W` 出现在包 `P` 的文件里时，按以下顺序确认：

1. 写成全限定名的，就是 `W`。
2. 有单类型导入 `x.W` 的，就是 `x.W`。
3. 仓库声明了 `P.W` 的，就是它，同包的类型遮蔽按需导入。「声明」的判定包括顶层类型字典，以及第 1 步按 `package` 读到的声明类型。
4. 恰有一个按需导入 `p.*`、且 `p.W` 在目录里的，就是 `p.W`。
5. 其余情形不确认。

确认结果在目录里才产生绑定。确认成仓库自己的同名类型时，它就不是目录里的注解，不产生绑定，也不计数。写法与目录里的某个简单名相同、却按以上规则确认不了的，按写法计入 `unconfirmedAnnotations`，可见。这样，自己声明的 `@Named` 或 Guice 的 `com.google.inject.name.Named` 都不会被当成 CDI 的 `@Named`。

**D4：绑定的名字与目标。**

- 名字：
  - 注解参数为非空字面量时用它。
  - 参数缺省或为空串时，按 `defaultName` 从类的简单名推出（CDI、JSF、Spring 的规范都把空串当作未指定）。
  - 参数为非字面量时，不产生绑定，计入 `nonLiteralNames`。
  - 必须显式写名却没写的，计入 `missingNames`。
  - XML 名字取文本或属性值，去掉首尾空白，再按 `split` 拆分；同一元素产出的相同名字只算一次。匹配到绑定器、却没有任何名字的元素（Spring 匿名 `<bean class>`、Seam 只写 `class` 的 `<component>`），不产生绑定，按绑定器计入 `missingNames`。
  - 名字是 EL 标识符（`[A-Za-z_$][A-Za-z0-9_$]*`）的，进绑定表。
  - 名字是点分名、每段都是 EL 标识符、且绑定器 `namespacedNames: true` 的，作为命名空间名进绑定表，例如 CDI 的 `@Named("admin.track")`、Seam 的 `org.jboss.seam.core.manager`。
  - 其余名字计入 `nonIdentifierNames`，不进绑定表，例如 Spring 的点分名或含 `/` 的名字。它们从 EL 访问不到。
- 目标：
  - 注解绑定的目标是被注解的类节点。该类没有节点（`identity-collision`）时，目标为「未建索引」。
  - XML 的 `class` 目标沿用第 1 步的类名解析：`$` 归一为 `.`，对顶层类型取最长前缀，至少两段。结果分四种：唯一类节点；多个声明（歧义）；仓库有声明但不是节点（未建索引）；仓库外。
  - `bundle` 目标不解析成文件，只表示「名字已被声明为资源包」。
  - 匹配到绑定器元素、有名字却没有目标的，按绑定器的 `missingTarget`：
    - `unknown`：目标未知的绑定，如 Spring 只有 `parent` 或 `factory-bean` 的 `<bean>`。Spring 会用它覆盖同名的扫描组件，实际的类可能来自 `parent`，所以与同名注解绑定并存时按歧义处理。
    - `configures`：目标未知、并标为「配置」的绑定，如 Seam 用 `<component name="x">` 给 `@Name("x")` 的组件设属性。它在 D7 归类时让位于同名的已知目标绑定。
- 证据位置：XML 绑定记名字文本或名字属性值所在行；注解绑定记注解所在行。

**D5：部署单元。**

- 文件的单元是它最近的祖先目录中、含目录所列描述符文件名的那一个；没有这样祖先的文件属于仓库单元。描述符取 source-manifest 中的路径；被忽略规则排除的描述符不参与。
- 页面只看见本单元的绑定。XML 绑定属于描述符文件所在的单元；注解绑定属于类文件所在的单元。
- 被否决的方案：
  - 仓库范围唯一即成边：这就是第 1 步教训里「锚定不中就放宽到更大的匹配器」。探针在 TomEE 与 Seam 上实际看到了跨示例的同名绑定。
  - web 根作为单元：bean 类不在 web 根下。
- 跨单元的 bean（web 模块的页面引用 ejb 或 jar 模块里的 `@Named`）因此落「他处」缺口，样例列出候选单元。按模块依赖声明放开可见性，是后续步骤。

**D6：EL 词法（纯函数，单文件）。**

- **文件范围**：表达式语言 `files` 命中的文件，即扩展名命中，或 XML 根元素与命名空间命中。根元素是序言、注释、DOCTYPE 之后的第一个元素，比较时用本地名；根命名空间取默认命名空间或根前缀所绑定的命名空间。
- **遮蔽**：标记语言注释（复用第 1 步）；JSP 脚本段 `<% … %>`（`<%@` 指令除外）；`jsp:scriptlet`、`jsp:expression`、`jsp:declaration` 元素体。CDATA 与 `<script>` 不遮蔽，Facelets 与 JSP 都会对模板文本里的 EL 求值。
- **定界**：
  - 分隔符前一个字符是 `\` 时，该处不是表达式，计入 `escaped`。
  - 扫描范围按文件语法分两种：
    - XML 形式（Facelets、JSP 文档 `jspx` / `tagx`、描述符）：表达式在所在的文本段内定界，即一个属性值或两个标签之间的文本（段落划分沿用第 1 步的 `markupSegments`）。这与先做 XML 解析、再在文本与属性值里找 EL 的做法一致，也让引号失配的表达式不会越过标签吞进后文。落在任何文本段之外（标签自身语法里）的分隔符不产生根名，计入 `unscanned`。
    - 模板文本（目录 `templateExtensions`，即经典 JSP）：遮蔽注释与脚本后整篇作为一个文本段。JSP 编译器把 HTML 标签当模板文本，在全文里找表达式，所以嵌在 HTML 属性值里的动作（`<div title="<h:outputText value="#{x}"/>">`）、动作属性里 `\"` 转义后的表达式都照样生效。按 XML 文本段切会把这些分隔符丢进标签语法；验收在 Sakai 上实测因此丢了 185 个根名，且不留计数。
    - 每个分隔符因此必落其一：产生根名的表达式、无根名的表达式、`escaped`、`unterminated`、`unscanned`。
  - 段内向后找匹配的 `}`，跳过 EL 字符串字面量（`'…'`、`"…"`，`\` 转义），并计嵌套的 `{}`。段内未闭合的，计入 `unterminated`，不产生根名，并从该分隔符之后继续扫描，所以一处漏写的 `}` 不会吞掉后面的表达式。每个未闭合的分隔符计一次。最坏情形的耗时与「分隔符数 × 段长」成正比。
  - 代价：模板文本整篇扫描时，表达式内引号失配会让字符串一路吞到下一个同种引号，其后的模板文本可能被当成表达式读出根名。运行时这样的页面同样编译失败；O6 的随机层与无绑定层覆盖 JSP 页面。
- **根名**：表达式内的标识符同时满足以下条件时，才是根名：
  - 前面（跳过空白）不是 `.`；
  - 不是关键字（`and or not eq ne lt gt le ge div mod empty true false null instanceof`）；
  - 不是函数前缀或函数名：形如 `X : Y (` 的 `X` 与 `Y` 都排除，三元运算 `a ? b : c` 的 `b`、`c` 不受影响；
  - 不在字符串字面量里；
  - 不是 lambda 参数：紧跟 `->` 的标识符，或紧跟 `->` 的括号参数表里的标识符，是本表达式内的局部名。
- **实体与字面量**：表达式里的 XML 实体与字符引用（`&amp;`、`&lt;`、`&gt;`、`&quot;`、`&apos;`、数字引用）按其代表的字符处理。XHTML 属性值里的 `&amp;&amp;` 很常见，不处理的话会产生根名 `amp`。数字字面量（含指数写法）里的字母不是标识符。
- **成员链**：根名之后连续的 `.标识符`，记为 `chain`，本步只记录、不解析。行号取根名所在行，多行表达式也能逐行复核。
- **局部名**：本文件中由 `localDeclarations` 声明的名字，加本表达式内的 lambda 参数。局部名只在本文件内有效，不扩到整个单元。理由与代价见风险一节。元素命名空间按 D1 的 `elementNamespaces` 判定：本文件里的 `xmlns:前缀="URI"`（任意元素上）与 JSP `taglib` 指令的 `prefix` / `uri` 组成前缀表，不按作用域细分。`declares: expression-root` 的属性，其表达式根名记为局部名，这些根名本身也落「局部」。

**D7：根名的分桶（顺序即优先级）。**

1. **局部**：名字是局部名。
2. **隐式**：名字在 `implicitNames` 里。JSF 与 JSP 都先解析隐式对象，所以排在绑定之前。隐式根名在本单元可见命名空间里另有同名绑定的，计入 `implicitWithBinding`。
3. 候选名字是根名本身，加上成员链的每个点分前缀（`#{admin.track.list}` 的候选为 `admin`、`admin.track`、`admin.track.list`）；点分名只来自 `namespacedNames` 的绑定器（D4）。取本单元、本语言可见命名空间里名字等于某个候选的全部绑定：
   - 命中的绑定分属不止一个候选名字（如同时有 `admin` 与 `admin.track`）：**歧义**，样例列出各名字及其目标。运行时由哪个解析器先答无法静态确定。
   - 否则先去掉让位的绑定：同时有已知目标的绑定时，`missingTarget: configures` 的目标未知绑定不参与归类，但仍列在证据的绑定处里。
   - 再按目标归类：
   - 全部指向同一个类节点：**成边**，证据列出这些绑定处。
   - 全部是 `bundle`：**资源包**，不成边、不算缺口，名字已有归属。
   - 全部指向同一个仓库外的类：**仓库外**，不成边、不算缺口，与第 1 步口径一致。
   - 全部指向同一个已声明但不是节点的类：**未建索引**，缺口 `name-reference-target-unindexed`。
   - 全部目标未知：**目标未知**，缺口 `name-reference-target-unknown`。
   - 其余情形（指向不同的类、目标种类混杂、XML 类名本身歧义）：**歧义**，缺口 `name-reference-ambiguous`，样例列出各候选。
4. **他处**：本单元不可见，但别的单元或不可见的命名空间里有名字等于某个候选的绑定。缺口 `name-reference-elsewhere`，样例列出候选单元与命名空间。
5. **无绑定**：缺口 `name-reference-unbound`。它的说明写明本步不读的绑定来源：库里的组件、调用方传入的参数、静态 include 的包含方、producer / factory 方法、嵌套类型、非 Java 源文件、运行时属性。这些来源绑定的名字，若别的单元恰好有同名绑定，落「他处」而不是这里。

**D8：`references` 边。**

- 每个（页面文件，类）一条边，`type: "references"`，`provenance: "extracted"`，权重与 `mentions` 相同。
- 每处引用一条证据：`{ line, token: 根名, chain, name: 命中的绑定名, bindings: [{ file, line, binder }] }`，按行与 token 排序去重。`name` 通常等于 `token`；命名空间名时是成员链的点分前缀。
- `validate-graph.mjs` 对 `references` 要求被引行包含 `token`。`retrieve.mjs` 把 `references` 加入 `DETERMINISTIC_EDGE_TYPES`。
- 不改 `mentions`：`mentions` 表示「字面写出了名字」，`references` 表示「经绑定解析到」，消费者可以分开过滤。

**D9：阶段与接口。**

- 新的词法收集器 `collectNameReferenceSites({ scan, readFile, catalog })`，对每个非代码文件读一次，产出：
  - 表达式站点：按文件给出根名列表，以及 `escaped`、`unterminated`、`unscanned`；
  - XML 绑定：文件、绑定器、名字、行、目标文本；
  - 条件事实：满足 `elementTextIn` 的文件与单元；
  - 目录外文件计数：原文（不做注释遮蔽）含 `#{` 却不在表达式文件范围内的非代码文件。扩展名为 `.xml` 的按 `xml:<根元素本地名>` 计（读不到根元素时计 `xml`），其余按小写扩展名计，没有扩展名的计为 `(none)`；以标签开头的 HTML 片段仍计 `html`，DTD 计 `dtd`。用原文是因为它只提示「这里可能有没读的 EL」，多报不会产生边。
- lazy 驱动在 `mentions` 之后新增一个计时阶段 `nameReferences`，把站点与目录一起交给 `buildFactGraph({ ..., nameReferenceSites, nameBindingCatalog })`。两者必须同时给或同时不给；都不给时，覆盖记 `nameReferences.status: "not-run"`。
- 注解绑定在投影里从 `structureAll` 读出，用 D3 规则确认。解析放在 `name-reference-resolution.mjs`，提供与第 1 步相同形式的变异测试接口 `mutations`。

**D10：覆盖与守恒。**

`coverage.nameReferences` 的字段：

- `status`
- `files`：按语言计
- `units`：至少拥有一个表达式文件或一个绑定的单元数，仓库单元满足条件时也计入
- `repositoryUnitFiles`：表达式文件中属于仓库单元的个数
- `bindings`：按绑定器 id 计
- `nonLiteralNames`、`nonIdentifierNames`：总数
- `missingNames`：按绑定器计（含 XML 无名元素与没有缺省名规则的注解），每个绑定器都列出，没有的记 0
- `unconfirmedAnnotations`：按写法计
- `roots`：十个桶；`rootCount`：根名总数，守恒等式的另一边
- `implicitWithBinding`
- `escaped`、`unterminated`、`unscanned`
- `outsideFiles`

守恒有两条：

- `roots` 的十个桶之和等于根名总数；
- 五类缺口回读的计数分别等于对应桶。

任一不等，构建失败。缺口按页面所在文件的语言分 scope，与第 1 步一致。

**D11：版本。**

`PIPELINE_VERSION` 升到 `lazy-fact-graph/7`。冻结摘要用生成器整块重冻，不逐字段补。

**D12：变异绊线（先验装置）。**

`mutations` 提供以下开关，每个都必须让至少一条测试变红：

- `ignoreUnits`：跨单元匹配；
- `noLocals`
- `bindingsBeforeImplicit`
- `firstBinding`：歧义时取第一个；
- `simpleNameAnnotations`：不做 D3 确认；
- `ignoreSeesConditions`：Spring 恒可见；
- `anyParent`：不查 `parent`；
- `noCommentMask`
- `shortestPrefix`：多个候选名字命中时取最短的，即根名；
- `noExpressionLocals`：不把 `declares: expression-root` 的根名记为局部名。

## 验收 Oracle（动手前写死）

验收语料都在 `excavator-test-repos/` 下，固定提交；源码、路径、输出不提交：

| 语料 | 提交 | 用途 |
|---|---|---|
| Dataverse | `cc6e62e3354492ad1f4127adc64eb22445319b95` | CDI `@Named`（显式与缺省）、资源包、Facelets |
| Sakai 12.7 | `5e75448885a8484fceea955509fc786bc99bfff4` | faces-config managed bean、JSF on JSP、441 个单元 |
| Seam 2.2 examples | 非 git 副本，源自 `345f9cf6c76b55825fb6c71df02dd5947dd154f0` | `@Name`、components.xml、pages.xml、Spring 桥接、测试类同名 |
| Cargo Tracker | `4d26b8fd59a7f0bac6e42d5d19a8cd1b379353b5` | Jakarta `@Named` 小样例 |
| TomEE 8.x examples | 非 git 副本，源自 `9c1921010cb36300a0e7ebdf0de9df22b8307ebe` | 222 个单元，跨单元同名 |

- **O1 夹具与绊线**（coder 写，acceptor 审）：
  - 规格的每个场景一条测试。
  - 新夹具 `tests/fixtures/jsf-name-references/` 至少含以下内容：
    - 三个带描述符的单元，外加一个无描述符的页面；
    - faces-config 的 managed bean、资源包、`managed-property` 里的 EL、Spring 桥接声明；
    - `@Named` 显式 / 缺省 / 空串 / 非字面量写法，`@ManagedBean` 显式 / 缺省，`@Name`，`@Component` 缺省（含 `URLHelper` 这种前两个字母大写的类名），`@Model`；
    - 同包自定义 `Named` 与按需导入的 Guice `Named`；
    - Spring 内部 bean 的 `id`，只有 `parent` 的 `<bean>`；
    - 测试源里的同名 bean；
    - 绑定到仓库外类和 Kotlin 类；
    - 注释、转义、函数调用、三元运算、lambda、字符串里的标识符、多行表达式；
    - `ui:repeat var` 与 `ui:param name`，以及 `f:param` / `c:param` 的 `name` 不算局部名；
    - Tomahawk `aliasBean` 的 `alias`，且同单元有与别名同名的绑定；
    - CDI 点分名 `@Named("admin.track")` 被 `#{admin.track.x}` 使用；同单元同时有 `admin` 与 `admin.track` 时的歧义；`namespacedNames: false` 的点分名不参与匹配；
    - Seam 不写 `class` 的 `<component name>` 与同名 `@Name` 并存；只写 `class` 的 `<component>` 与匿名 Spring `<bean class>`；
    - 未闭合的 `#{` 之后还有正常表达式；
    - `externalContext` 与同名绑定并存。
  - 断言精确的边列表与十个桶的计数。D12 的每个变异至少让一条测试变红。
- **O2 全量精度审计**（acceptor 独立实现，不复用被测代码）：
  - 对每个语料每条 `references` 边的每条证据：读快照中的页面行，要求它在一个 EL 表达式内含 `token`；读每个绑定处的行，要求含该名字（或属于产生缺省名的注解）。
  - 按规格独立重算该根名的桶与目标，要求与边一致。不一致数必须为 0。
  - 装置先验：往图谱副本里注入一条错目标边、一条错行号证据和一条跨单元边，审计必须报出这三条。
- **O3 桶与绑定对账**（acceptor 独立脚本）：
  - 每个语料的十个桶计数与独立重算逐桶一致；
  - 绑定数按绑定器与独立 grep 对账。每个差异必须落在 `unconfirmedAnnotations`、`nonLiteralNames`、`nonIdentifierNames`、`missingNames` 之一，或属于规格明示不读的位置（嵌套类型、非 Java 源文件）。
- **O4 不回归**：wcp、cebreo、hadoop、fineract 各自与同一提交、`lazy-fact-graph/6` 的基线对比：
  - 节点集合、非 `references` 边集合、既有缺口完全一致；
  - 覆盖只多 `nameReferences` 一段；
  - Core 新字段不改变任何既有字段。
  - 新增的 `references` 边与缺口逐语料列出计数，预期为 0 或接近 0，每一个都要说明来源。
- **O5 耗时**：Sakai `master`（`10a1d904d379df3cb2371ee0e405a4c2d1060588`）与 hadoop 的 Lazy 总耗时，与同一会话、同一提交新测的基线相比，增幅不超过 10%（各取 3 次中位数）。`nameReferences` 阶段单独计时并报告。
- **O6 分层人工抽查**（acceptor）：
  - 每个语料按绑定器分层，每层随机抽 10 条成边，不足 10 条全抽，读页面原文与绑定原文判断。
  - 「根名在本单元别的文件里也被声明为局部名」的成边单独成一层，每个语料抽 20 条。
  - 各类缺口样例全读；每个语料再随机抽 20 条「无绑定」与 10 条「他处」，查有没有本该成边的。
  - 编造计数必须为 0。漏边单独计数并归因。
- **预先承诺的退路**（抽查发现编造时直接执行，不再讨论）：
  - **F1**：编造来自 JSP 的 `${`，即同名的请求属性：从 `jsf-jsp-el` 的 `jsp` 系列扩展名里去掉 `${`，这些表达式计入可见的 `delimiterExcluded`。
  - **F2**：编造来自调用方经 `ui:param` / `var` 传入、与 bean 同名但类型不同的名字：在本单元任一文件里被声明为局部名的根名，落新桶 `shadowable`，不成边、不算缺口，单独计数。
  - **其它来源**：先改源头，并补一条先红后绿的夹具测试，再重新跑 O2 与 O6。
- **O7 真实 MCP**：对 Dataverse 起 stdio MCP，调全部工具：
  - 从一个 `@Named` bean 类做 1-hop `traverse`，经 `references` 到达使用它的 `.xhtml`；
  - `project_status` 报出 `nameReferences` 覆盖与新缺口；
  - `recall` 不受影响。
- **O8 全量门**（我跑）：三件套、core 测试、typecheck、`openspec validate --all --strict`、`node scripts/check-refs.mjs`，并核对 core dist 已重建。

## Risks / Trade-offs

- **局部名只在本文件内有效，调用方传入的同名参数仍会解析成同名 bean。** 探针中这类成边：Dataverse 25 处、Sakai 103 处、Seam 28 处。抽样看到的都是同类的实例：调用方把 bean 或同类对象以同名参数传入片段，比如 `fileDownloadHelper`、`pager`、`msgs`。把局部名扩到整个单元会丢掉这些正确的边。O6 单设一层专查这类边，查出编造即执行 F2。
- **静态近似不等于 EL 求值。** 运行时，作用域属性可能先于 bean 被找到；同名的请求属性也可能遮蔽 bean。缓解：只有同单元、可见命名空间里唯一的绑定才成边；JSP 的 `${` 由 O6 专门抽查，有 F1 兜底。
- **单元按描述符划分，粒度可能不对。**
  - 嵌套描述符（如子目录里的 Ant 辅助 `build.xml`）会把页面与类分到两个单元，结果是「他处」缺口，属于漏边，不是编造。
  - 没有任何描述符的仓库整体算一个单元，其中互不相关的示例会互相可见。覆盖里的 `repositoryUnitFiles` 让这种情形可见。随附语料都有描述符。
- **一个描述符可能产出多个 WAR**（老式 Ant 单体），几个 web 应用会并成一个单元。
  - 不改用 web 根（`WEB-INF` 的父目录）作为可见边界：Ant 布局常把页面与 `WEB-INF` 放在不同目录、构建时才拼装。Seam 示例的页面在 `view/`，描述符在 `resources/WEB-INF/`，按 web 根收紧会切断全部 XML 绑定。
  - 探针中一个单元含多个 web 根的情形：Sakai 12.7 有 4 个单元，Seam 有 5 个，都是同一应用的变体，比如各应用服务器各一套 `resources-*`、测试用 webapp。合并是对的。
  - 同名不同类会落歧义，不会编造。剩下的风险是：A 应用的页面用到只在 B 应用里声明的名字。
- **Gradle 子项目可以不写自己的 build 文件**，由根项目的 `subprojects {}` 配置。这样的子项目会并入上层单元，若几个子项目各有同名 bean，就可能互相可见。随附语料都是 Maven、Ant 或各子项目自带描述符。读 `settings.gradle` 的 `include` 来划分单元，属于后续步骤。
- **测试源与主源同单元，同名 bean 互相歧义**（如 Seam quartz 的 `paymentHome`）。这是仓库里真实存在的二义，按歧义缺口报出；不按「main 优先」去猜。
- **XML 类名按仓库范围解析（沿用第 1 步）。** 同一全限定名在两个模块各声明一次时，绑定歧义，即使页面与描述符在同一单元。同单元优先需要类路径语义，本步不做；探针语料中没有页面受影响。
- **前缀表只读本文件。** 经 `web.xml` 的 JSP `include-prelude` 统一引入 taglib 的页面，自身没有 `taglib` 指令，`elementNamespaces` 限定的局部声明（如 Tomahawk `aliasBean`）在这些页面上不生效，别名落「他处」或「无绑定」。若同单元恰有与别名同名的绑定，会成错边；验收语料中没有这种情形，O6 的别名层会专门抽查。读 `include-prelude` 属于跨文件传播，和静态 include 一起放到后续步骤。
- **共享的 JSF jar 模块**（自带 faces-config、被各应用依赖）里的名字对依赖方落「他处」，等按模块依赖放开可见性的后续步骤解决。
- **Spring 桥接只认目录列出的解析器。** 自定义解析器（Sakai 的 `org_sakaiproject_*` 前缀名）不被认出：不可见的 `spring` 命名空间里有同名 bean 的根名落「他处」，没有的落「无绑定」。企业内部的解析器与注解要靠项目自定义目录，属于后续步骤。
- **默认名规则写在目录里，规则写错会成批产生错边。** 每条规则的 `basis` 写明出处；O6 按绑定器分层抽查，缺省名单独一层；夹具里有 `URLHelper` 这类边界写法。
- **Core 新字段会让每个 Java 文件的结构变大。** 只记参数，只在有注解的顶层类型上记，耗时由 O5 兜住。

## Migration Plan

升版本号后，已有产物在下次 Lazy / `sync_facts` 时整体重投影，不需要迁移脚本。回滚时按步 revert 对应 commit，版本号随之回退。Core 改动只新增字段，回滚不影响其它消费者。
