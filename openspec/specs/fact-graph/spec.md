# fact-graph Specification

## Purpose

确定性事实层：把既有结构抽取（structure-all + import-map）投影为事实节点、事实边与覆盖账本，零模型、可复现、缺失可见，且模型输出不得回写。它是 Lazy 首次运行的唯一产物，也是所有语义补充的地基。

## Requirements

### Requirement: 事实层是零模型的确定性投影

Fact Builder SHALL 仅由 `structure-all` 与 import-map 的结果投影得到事实节点与边，MUST NOT 调用任何模型，MUST NOT 重新解析源码。对同一输入重复运行 SHALL 产出相同的事实投影。

#### Scenario: 构建事实层不调用模型
- **WHEN** 执行 Build Fact Graph
- **THEN** 不发生任何模型调用，且对同一输入重复运行得到相同的事实节点、边、coverage 与 gaps

### Requirement: 支持的事实节点与事实边

事实节点 SHALL 至少覆盖 file、function/method（包括 Java 接口方法与抽象方法）、class/interface 等抽取器可靠支持的声明，以及可确定性识别的配置/路由等非代码节点。事实边 SHALL 至少覆盖 `contains`、`exports`、`imports`、**能唯一解析目标**的 `calls`，能从声明确定的类型层次边 `inherits` / `implements`，以及具体方法之间的覆写边 `overrides`。不能唯一解析的引用 MUST NOT 猜测，SHALL 写入 gap。每条事实边 SHALL 保留 provenance 与源码证据。

#### Scenario: 唯一可解 call 成边，不可解入 gap
- **WHEN** 一处调用能唯一解析到目标节点
- **THEN** 生成一条带 provenance/证据的 `calls` 边；无法唯一解析时改为记入 gap，而不生成猜测的边

### Requirement: Lazy schema 的确定性基础字段

Lazy 事实节点 SHALL 允许 `summary: ""`、`tags: []`、`layers: []`。`complexity` SHALL 由固定阈值确定性生成：`<50` 为 `simple`、`50–200` 为 `moderate`、`>200` 为 `complex`；阈值固定、可复现、不调用模型。文件节点 SHALL 使用 structure-all 已算出的非空代码行数（`nonEmptyLines`）；声明节点因投影不重新读源、没有逐声明的非空计数，SHALL 使用行跨度（`endLine-startLine+1`）作为代理。

#### Scenario: 文件 complexity 由非空行数确定
- **WHEN** 为一个文件节点计算 complexity
- **THEN** 依据 structure-all 的 `nonEmptyLines` 落入固定阈值分档，不调用模型

#### Scenario: 声明 complexity 由行跨度代理确定
- **WHEN** 为一个函数/类节点计算 complexity
- **THEN** 依据其行跨度落入固定阈值分档，不调用模型

#### Scenario: Lazy 节点语义字段为空或确定性值
- **WHEN** Lazy 首次运行产出事实节点
- **THEN** 其 `summary`/`tags`/`layers` 为空或确定性值，没有任何字段由模型写入

### Requirement: 覆盖账本与 factDigest

事实层 SHALL 产出 `coverage` 与 `gaps`：每个被扫描输入落入恰好一个可见桶，解析失败的文件 SHALL 进入 coverage/gaps，MUST NOT 伪装成"无符号"或"已删除"。事实层 SHALL 产出 `factDigest`，且 `factDigest` SHALL 只覆盖规范化后的事实节点、事实边、coverage 与 gaps，排除 sourceRevision、时间戳、模型名及其他运行元数据。

#### Scenario: 解析失败产生可见 gap
- **WHEN** 某文件解析失败
- **THEN** 它出现在 coverage/gaps 中且带原因，而不是被静默丢弃或伪装成无符号

#### Scenario: factDigest 不含运行元数据
- **WHEN** 同一源码内容以不同时间戳/运行元数据构建两次
- **THEN** 两次得到相同的 factDigest

#### Scenario: 仅有名字的类方法记为可见 gap
- **WHEN** 抽取器只给出类方法的名字而无行号（如 TS/JS 的 `classes[].methods`），无法投影为节点
- **THEN** 这些方法记为可见 gap（`methods-name-only`），而不是从图中静默消失；已由 `functions[]` 带 owner 投影为节点的方法（Go/Rust/C++）不重复计入

### Requirement: canonical 事实不可被模型回写

`knowledge-graph.jsonl` 中的确定性节点身份、源码范围、结构边、coverage 与 gaps SHALL 只由确定性投影写入；任何模型输出 MUST NOT 通过 merge/annotate/publish 修改这些字段。无法映射到事实节点的模型输出 SHALL 记为 gap，MUST NOT 创建假锚点。

#### Scenario: 无法映射的模型输出记为 gap
- **WHEN** （后续切片中）某模型输出无法映射到任何事实节点
- **THEN** 记录为一条 semantic gap，而不是新建一个事实锚点

### Requirement: 图谱持久化不受单字符串上限约束且往返无损

图谱 SHALL 持久化为 `.excavator/knowledge-graph.jsonl`。第一行是文件头，带格式标识、全部根级标量字段与各类记录的计数；其后每行一条记录，一条记录只承载一个节点、一条边、一个分层、一个导览步骤、coverage 或一个缺口，因此单行长度与整图大小无关。写入与读取 MUST NOT 把整图放进单个字符串。

读回的内存图 SHALL 与写入前严格深度相等：记录顺序与原数组顺序一致；同一张图写两次逐字节相同。读取时 SHALL 校验文件头、记录数与记录类型；校验失败 SHALL 以具名错误失败并报告为无效产物，MUST NOT 返回部分图。

系统 MUST NOT 读取旧格式的 `knowledge-graph.json`。只剩旧文件时，读取方 SHALL 把图谱报告为缺失产物；发布新图谱时 SHALL 删除旧文件。

结构抽取结果 SHALL 以同样的按行方式持久化为 `intermediate/structure-all.jsonl`：一个文件头加每个被扫描文件一行。

#### Scenario: 往返严格相等
- **WHEN** 把一张图（含无 coverage/gaps 的旧形状、含分层与导览的 Full 形状）写出后再读回
- **THEN** 读回的图与原图严格深度相等，再写一次得到逐字节相同的文件

#### Scenario: 图谱总量超过单字符串上限
- **WHEN** 一个仓库的图谱若整体序列化会超过运行时单字符串上限
- **THEN** 持久化与读取仍然成功，文件中没有任何一行接近该上限

#### Scenario: 截断或损坏的图谱文件
- **WHEN** 图谱文件缺少文件头、实际记录数与文件头声明不符，或出现未知的记录类型
- **THEN** 读取以具名错误失败，读取方报告无效产物，不返回部分图

#### Scenario: 只剩旧格式的图谱文件
- **WHEN** 数据目录里只有旧的 `knowledge-graph.json`
- **THEN** 读取方把图谱视为缺失并以可见缺口报告，不解析旧文件；下一次成功发布删除该旧文件

### Requirement: Java 成员调用按接收者的声明类型解析

系统 SHALL 对 Java 调用点按接收者的静态类型解析。静态类型来自：局部变量、参数与字段的声明类型，`this` / `super`，类名（静态调用），`new` 表达式，强制转换，以及链式调用中前一个调用的声明返回类型。系统 SHALL 在该类型及其仓库内父类型中按方法名与参数个数查找候选，恰好一个声明时生成 `calls` 边，目标为静态类型选中的声明，可以是接口方法或抽象方法。对 Java，系统 MUST NOT 只凭方法名在调用方文件或其导入文件中匹配成员调用。

不能成边的 Java 调用点 SHALL 恰好落入以下一个可见桶：
- `calls-external`：目标类型可证明在仓库外（经导入或 `java.lang` 解析到仓库外的类型；`Object` 的方法；或方法不在仓库内的类型层次中，而该层次显式继承了仓库外的类型，或是隐式继承 `java.lang.Enum` 的枚举）；
- `calls-generated`：目标是源码中没有声明的生成方法（声明字段的访问器、记录的分量访问器与规范构造器、Lombok 构建器方法与构造器、隐式默认构造器、枚举的 `values` / `valueOf`）；
- `calls-ambiguous`：多个候选；
- `calls-unresolved`：接收者类型无法确定，或类型找不到，或类型在仓库内但解析器不读（仓库内类型的成员类型、仓库内 Kotlin / Scala 源码声明的类型）；
- `calls-caller-unresolved`：调用方无法确定。

非 Java 语言的调用解析 SHALL 保持不变。

#### Scenario: 字段类型为仓库内的类
- **WHEN** 方法里调用 `helper.assist()`，`helper` 是声明类型为仓库内类 `Helper` 的字段，且 `Helper` 只声明了一个无参的 `assist`
- **THEN** 生成一条从该方法指向 `Helper#assist()` 的 `calls` 边

#### Scenario: 接收者是接口
- **WHEN** 接收者的声明类型是仓库内接口 `PaymentService`，调用其中声明的 `pay(long)`
- **THEN** `calls` 边指向接口方法 `PaymentService#pay(long)`

#### Scenario: 重载按参数个数区分
- **WHEN** 接收者类型声明了 `find(Long)` 与 `find(Long, boolean)`，调用传入两个参数
- **THEN** 边指向 `find(Long, boolean)`；若同一参数个数有多个重载，则记入 `calls-ambiguous`，不生成边

#### Scenario: 仓库外类型
- **WHEN** 接收者的类型是 `java.util.List` 或其它经导入解析到仓库外的类型
- **THEN** 该调用点记入 `calls-external`，不生成边

#### Scenario: 生成的访问器
- **WHEN** 调用 `loan.getStatus()`，`Loan` 在仓库内的类型层次中声明了字段 `status`，但没有声明 `getStatus`
- **THEN** 该调用点记入 `calls-generated`，而不是 `calls-external`

#### Scenario: 仓库内其它 JVM 语言的类型
- **WHEN** Java 方法调用 `users.findByLogin(...)`，`users` 的声明类型是仓库内 Kotlin 源码声明的 `UserRepository`
- **THEN** 该调用点记入 `calls-unresolved`，不记入 `calls-external`

#### Scenario: 接收者类型无法确定
- **WHEN** 接收者是没有声明类型的 lambda 参数
- **THEN** 该调用点记入 `calls-unresolved`

#### Scenario: 每个调用点恰好一个去向
- **WHEN** 对一个 Java 项目构建事实图
- **THEN** 成边的调用点数与五个桶的计数之和等于 Java 调用点总数

#### Scenario: 非 Java 项目不变
- **WHEN** 对不含 Java 文件的项目构建事实图
- **THEN** 事实投影与本变更之前逐字节相同

### Requirement: Java 类型层次边

系统 SHALL 为能解析到仓库内类型的 `extends` / `implements` 生成类到类的边：类继承类、接口继承接口为 `inherits`，类实现接口为 `implements`。系统 SHALL 为具体方法（含接口的 `default` 方法）生成指向它所实现的仓库内抽象方法（接口方法或抽象方法，同名且擦除后参数类型相同）的 `implements` 边。对每个具体类型 C，其仓库内祖先的每个抽象方法 A，若 C 自身没有声明同名同参数个数的方法，SHALL 以 C 的父类链中最近的同名同参数个数具体声明 M（类的方法优先于接口 `default` 方法）为实现：擦除签名相同即生成 `M → A` 的 `implements` 边，证据为 C 的该父类型声明行。同名、同参数个数、但任一方擦除签名不能确定（类型变量、嵌套或无法解析的类型、按需导入的外部类型）的配对 MUST NOT 生成边，也 MUST NOT 静默丢弃：SHALL 记为可见缺口 `override-uncertain`（scope `java`，样例为两个声明）。`private`、`static` 方法与构造器不参与配对；包访问的方法只与同包的方法配对。这些边 SHALL 带声明行证据，SHALL 作为确定性事实边参与遍历。父类型在仓库外时 MUST NOT 生成边。

#### Scenario: 类实现接口
- **WHEN** 仓库内类 `PaymentServiceImpl implements PaymentService`，并实现了 `pay(long)`
- **THEN** 生成 `PaymentServiceImpl` 到 `PaymentService` 的 `implements` 边，以及 `PaymentServiceImpl#pay(long)` 到 `PaymentService#pay(long)` 的 `implements` 边

#### Scenario: 经接口的调用可遍历到实现
- **WHEN** 从调用 `PaymentService#pay(long)` 的方法出发做有界遍历
- **THEN** 遍历经 `calls` 与 `implements` 边到达 `PaymentServiceImpl#pay(long)`

#### Scenario: 仓库外父类型不成边
- **WHEN** 仓库内接口继承了仓库外的接口（例如 Spring 的 `JpaRepository`）
- **THEN** 不为该父类型生成边

#### Scenario: 继承来的实现
- **WHEN** `class C extends Base implements I {}`，`Base` 声明具体方法 `m()`，`I` 声明抽象方法 `m()`，两者擦除签名相同
- **THEN** 生成 `Base#m()` 到 `I#m()` 的 `implements` 边，证据为 `C` 声明 `implements I` 的那一行

#### Scenario: 接口 default 方法实现父接口的抽象方法
- **WHEN** 接口 `J extends I` 以 `default` 方法实现了 `I` 的抽象方法 `m()`
- **THEN** 生成 `J#m()` 到 `I#m()` 的 `implements` 边

#### Scenario: 擦除签名不确定的配对记缺口
- **WHEN** 接口 `COBBusinessStep<T>` 声明 `execute(T)`，`LoanStep implements COBBusinessStep<Loan>` 声明 `execute(Loan)`
- **THEN** 不生成 `implements` 边，记入 `override-uncertain` 缺口，样例为 `LoanStep#execute(Loan) ~ COBBusinessStep#execute(T)`

### Requirement: 非代码文件中的名称提及

系统 SHALL 对 source-manifest 中除代码语言以外的每个文件做词法扫描，范围包括 XML、JSP、Facelets、properties、YAML、shell，以及扩展名未在语言表声明的文本文件。代码语言是语言注册表中配置了 tree-sitter 语法的语言，由注册表派生，不另立清单。扫描只记录两类候选：类全限定名形态的 token，以及以 manifest 中出现过的扩展名结尾的路径形态 token。每个候选 SHALL 带原文件行号。XML / HTML / JSP / Facelets 的注释（`<!-- -->`、`<%-- --%>`）与 properties 的整行注释（`#`、`!`）中的文本 MUST NOT 产生候选。标记语言文件中的候选 SHALL 记录所在元素名，位于属性值内时还要记录属性名。扫描过的文件数 SHALL 按语言写入覆盖。扫描器因过大、二进制、未知语言、读取失败或符号链接而跳过的非代码文件没有被扫描，其数量 SHALL 按跳过原因写入同一覆盖段，使这部分遗漏可见。扫描未运行时覆盖 SHALL 明示未运行，MUST NOT 与「扫描了但没有提及」混同。

#### Scenario: 描述符里的类名被记录
- **WHEN** `WEB-INF/web.xml` 第 12 行为 `<servlet-class>com.acme.web.OrderServlet</servlet-class>`
- **THEN** 产生一个类名候选，行号 12，元素为 `servlet-class`

#### Scenario: 注释里的装配不算
- **WHEN** Spring XML 中 `<!-- <bean class="com.acme.Legacy"/> -->` 被注释掉
- **THEN** 不产生 `com.acme.Legacy` 的候选

#### Scenario: 代码文件不在本扫描内
- **WHEN** 一个 `.java` 文件的字符串字面量里写了 `"com.acme.Foo"`
- **THEN** 本扫描不为它产生候选

### Requirement: 类全限定名提及生成 mentions 边

类名候选 SHALL 先把 `$` 归一为 `.`，再对仓库内 Java 顶层类型的全限定名取最长前缀匹配，前缀至少两段。因此候选带成员、`.class` 后缀或嵌套类型名时，命中所在的顶层类型；嵌套类型不是节点。默认包里的类型（全限定名只有一段）不参与匹配。恰好命中一个仓库类型时，SHALL 生成一条从提及文件的 file 节点指向该类型 class 节点的 `mentions` 边。同一全限定名由多个仓库声明共有时 MUST NOT 生成边，SHALL 记入 `mention-ambiguous` 缺口，样例列出各候选。前缀不在字典中、却是仓库内存在但不是节点的声明时，SHALL 记入 `mention-target-unindexed` 缺口。这类声明包括 Kotlin / Scala 的类型（按源文件的包路径与文件名判定），以及字典里没有、却由 Java 源文件声明的类型，如注解类型。后者按该文件自己声明的 `package` 与文件名判定，目录名只是包名的后缀不算。只有不命中任何仓库声明的候选才算仓库外，仓库外的类名不成边。

#### Scenario: servlet 类被 web.xml 提及
- **WHEN** `web.xml` 提及 `com.acme.web.OrderServlet`，且仓库内恰有一个该名类型
- **THEN** 生成 `web.xml` 的 file 节点到 `OrderServlet` class 节点的 `mentions` 边，证据为该行

#### Scenario: 嵌套类型的二进制名
- **WHEN** Spring XML 写 `class="com.acme.Outer$Handler"`，仓库内顶层类型 `com.acme.Outer` 声明了嵌套类型 `Handler`
- **THEN** 生成指向 `Outer` class 节点的 `mentions` 边，证据保留原 token `com.acme.Outer$Handler`

#### Scenario: 成员后缀取类型前缀
- **WHEN** properties 值为 `com.acme.Limits.MAX_SIZE`，`com.acme.Limits` 是仓库类型
- **THEN** 生成指向 `com.acme.Limits` 的 `mentions` 边

#### Scenario: 不是节点的仓库声明不算仓库外
- **WHEN** Spring XML 写 `expression="com.acme.Audited"`，仓库内有 `com/acme/Audited.java` 声明注解类型 `@interface Audited`（注解类型不是节点）
- **THEN** 不生成边，记入 `mention-target-unindexed`，不计入仓库外

#### Scenario: 目录名像包名不等于声明了该类型
- **WHEN** `web.xml` 写 `<servlet-name>ejb3.Foo</servlet-name>`，仓库内 `src/main/java/org/acme/ejb3/Foo.java` 声明 `package org.acme.ejb3;`
- **THEN** `ejb3.Foo` 不是仓库声明，计入仓库外，不记 `mention-target-unindexed`

#### Scenario: 同名类型不猜
- **WHEN** 两个模块各自声明了 `com.acme.Config`，某 XML 提及 `com.acme.Config`
- **THEN** 不生成边，记入 `mention-ambiguous`，样例列出两个声明

### Requirement: 路径提及生成 mentions 边

路径候选 SHALL 先去掉 `classpath:`、`classpath*:`、`file:` 前缀与查询串、片段；含 URL scheme 或表达式定界符（`#{`、`${`）的 token 不是路径候选。解析 SHALL 依次尝试，取第一个有命中的规则：
1. 以 `/` 开头且提及文件位于某个 web 根之下时，相对该 web 根解析。web 根是包含 `WEB-INF/` 目录的最近祖先目录，提及文件自身在 `WEB-INF/` 下时同样适用。
2. 不以 `/` 开头时，相对提及文件所在目录解析。
3. 不以 `/` 开头、上一条无命中、且提及文件位于某个 web 根之下时，相对该 web 根解析（Servlet 规范中 `welcome-file`、`jsp-file` 这类值相对上下文根）。
4. 带 `classpath:` / `classpath*:` 前缀的 token 不走前三条，去掉开头的 `/`、`./`、`../` 段后按路径段边界做后缀匹配：类路径的语义就是「在任一类路径根下」。其它 token 在前三条都没有命中时 MUST NOT 做后缀匹配，记入 `path-mention-unresolved`：它们的基准目录不可见，后缀会匹配到别的模块、别的应用里形状相同的文件。

不带 classpath 前缀的模式按规则 1–3 展开时，开头的 `/`、`./`、`../` 之后的第一段 MUST 是字面目录（不含通配，也不是 `.` / `..`）。以 `*` 或 `**` 开头的模式在任何目录下都能命中，无法确认基准目录就在这里，所以 MUST NOT 展开，记入 `path-mention-unresolved`。

开头的 `/`、`./`、`../` 之后若还出现 `.` 或 `..` 段，该 token 不按任何规则解析，记入 `path-mention-unresolved`：这样的段可能抵消一个不是字面目录的段（如 `$VAR/..`），解析结果靠运气。

解析的目标范围是 manifest 中的文件，加上扫描器因过大、二进制、未知语言、读取失败或符号链接而跳过的文件。被忽略规则、默认过滤或敏感规则排除的文件不参与。恰好命中一个文件时：该文件是图上的 file 节点，SHALL 生成提及文件到它的 `mentions` 边；它是被跳过的文件，SHALL 记入 `mention-target-unindexed`，MUST NOT 记成不存在。带 `classpath*:` 前缀或含 `*` 通配、且至少含一个不带通配也不是 `.` / `..` 的目录段的候选是模式：每个是节点的命中都成边，并标为模式命中；命中里被跳过的文件按数量写入覆盖；只命中被跳过的文件时记入 `mention-target-unindexed`。含通配但没有这样的目录段的 token（如 `*.xhtml`、`**/*.xml`、`./*.ts`）不是路径候选：它们是 URL 映射或全局通配，不指向具体文件。非模式候选命中多个文件时 MUST NOT 生成边，SHALL 记入 `mention-ambiguous`；零命中 SHALL 记入 `path-mention-unresolved`。提及文件指向自身时不成边。

#### Scenario: 模板按 web 根解析
- **WHEN** `webapp/order/list.xhtml` 写 `template="/WEB-INF/templates/main.xhtml"`，`webapp/WEB-INF/` 存在
- **THEN** 生成指向 `webapp/WEB-INF/templates/main.xhtml` 的 `mentions` 边

#### Scenario: 两个 web 应用各自解析
- **WHEN** 模块 A 与模块 B 都有 `src/main/webapp/WEB-INF/templates/main.xhtml`，A 的页面以 `/WEB-INF/templates/main.xhtml` 引用模板
- **THEN** 边指向 A 自己的模板，不记歧义

#### Scenario: 相对包含
- **WHEN** `pages/order.jsp` 写 `<jsp:include page="header.jsp"/>`，`pages/header.jsp` 存在
- **THEN** 生成指向 `pages/header.jsp` 的 `mentions` 边

#### Scenario: classpath 后缀多重命中不猜
- **WHEN** XML 写 `classpath:spring/beans.xml`，两个模块都有以 `spring/beans.xml` 结尾的文件
- **THEN** 不生成边，记入 `mention-ambiguous`

#### Scenario: 描述符里的欢迎页按 web 根解析
- **WHEN** `webapp/WEB-INF/web.xml` 写 `<welcome-file>index.jsp</welcome-file>`，`webapp/index.jsp` 存在，另一个模块也有 `index.jsp`
- **THEN** 生成指向 `webapp/index.jsp` 的 `mentions` 边，不记歧义

#### Scenario: URL 映射不是路径
- **WHEN** `web.xml` 写 `<url-pattern>*.xhtml</url-pattern>`
- **THEN** 不产生路径候选，不生成任何边或缺口

#### Scenario: 构建描述符里的模式不跨模块
- **WHEN** `modA/pom.xml` 写 `<include>java/**/*.java</include>`，`modA/java/` 不存在，`modB/src/main/java/` 下有 Java 文件
- **THEN** 不生成任何边，记入 `path-mention-unresolved`

#### Scenario: 相对路径落空不按后缀猜
- **WHEN** `appA/view/template.xhtml` 写 `<link href="style/date.css"/>`，`appA/view/style/date.css` 不存在，`appB/view/style/date.css` 存在
- **THEN** 不生成边，记入 `path-mention-unresolved`

#### Scenario: 以通配开头的模式不从所在目录展开
- **WHEN** `jrcs/build.xml` 写 `<include name="**/jrcs/diff/**/*.java"/>`，`jrcs/src/java/org/x/jrcs/diff/` 与 `jrcs/src/test/org/x/jrcs/diff/` 下都有 Java 文件
- **THEN** 不生成边，记入 `path-mention-unresolved`

#### Scenario: 裸文件名不按后缀匹配
- **WHEN** 根目录的 `CHANGELOG.txt` 写 `unistd.h`，仓库里唯一的 `unistd.h` 在 `native/os/windows/` 下
- **THEN** 不生成边，记入 `path-mention-unresolved`

#### Scenario: 存在但被跳过的文件不算不存在
- **WHEN** 根目录的 `LICENSE.txt` 写出 `native/gtest/gtest.h` 的完整路径，该文件因过大被扫描器跳过
- **THEN** 不生成边，记入 `mention-target-unindexed`，不记 `path-mention-unresolved`

#### Scenario: 不存在的路径可见
- **WHEN** 页面包含 `/WEB-INF/missing.xhtml`，仓库内没有任何以 `missing.xhtml` 结尾的文件
- **THEN** 记入 `path-mention-unresolved`，样例含提及文件、行号与原 token

### Requirement: mentions 边的证据与遍历

每条 `mentions` 边 SHALL 对应一对（提及文件，目标）。证据 SHALL 列出该文件中提及该目标的每一行，每条证据带原 token、元素与属性上下文（有则记），以及解析方式：类名、web 根、相对、后缀或模式。`mentions` 边 SHALL 是可遍历的确定性边，有界遍历可经它在装配文件与类、页面与页面之间往返。每条边证据行上的原文 SHALL 含有该 token：类名提及为点分或 `$` 形式，路径提及为原路径。

#### Scenario: 从类遍历到装配它的描述符
- **WHEN** 从 `OrderServlet` 出发做 1-hop 遍历
- **THEN** 结果包含经 `mentions` 边相连的 `web.xml`

#### Scenario: 同一文件多次提及合为一条边
- **WHEN** 同一 Spring XML 在第 10、40、41 行提及同一类
- **THEN** 只有一条 `mentions` 边，证据依次为 10、40、41 三行

### Requirement: 名字绑定

系统 SHALL 只依据一份声明式的名字绑定目录，从仓库文件中读出「名字 → 目标」的绑定。目录是数据，不是代码分支，内容包括：

- XML 绑定器：
  - 根元素与可选的根命名空间。根命名空间列表里的 `null` 表示根元素没有声明命名空间。
  - 元素与直接父元素。
  - 名字来源：子元素文本或属性，可为个别属性声明别名分隔符。
  - 目标来源与目标种类：类、资源包，或名字（把名字转给另一个名字）。
  - 可选的目标规则：带有所列属性之一时目标未知；没有目标时，从某个属性所名的绑定继承目标。
  - 缺少目标时的含义：目标未知，或配置别处声明的同名组件。
- 注解绑定器：注解全限定名、读名字的参数键、缺省名规则（首字母小写、Java Beans 规则，或类的简单名原样）；
- 两种绑定器都声明点分名是否按命名空间解析；
- 表达式语言：分隔符、文件类别（含整篇作为模板文本扫描的扩展名）、隐式名字、声明局部名的属性（可限定元素及其命名空间，可声明属性值里表达式的根名为局部名）、可见命名空间及其条件；
- XML 注入族，见「XML 注入点」；
- 注解注入族，见「Java 注解注入点」；
- 部署单元描述符的文件名。

每个绑定器与注入族 SHALL 带 id、命名空间与一句依据说明。目录出现未知键、缺少字段或类型不符时，加载 MUST 失败，不得带着部分目录运行。

注解绑定：

- 注解的身份 SHALL 按 Java 作用域规则确认，依次为：全限定写法、单类型导入、仓库在同包声明的同名类型、恰好一个提供目录内注解的按需导入。确认结果在目录里的才产生绑定。写法与目录中某个简单名相同、却没有确认的注解，SHALL 按写法计数。
- 名字取注解的字符串字面量参数。参数缺省或为空串时，按绑定器的缺省名规则从类的简单名推出。参数不是字符串字面量时，MUST NOT 产生绑定，SHALL 计数。缺省名规则为空、又没写名字的，同样计数。

XML 绑定：

- 名字与目标取自所声明的子元素文本或属性值，去掉首尾空白。分隔符只拆分为其声明的属性；同一元素的相同名字只算一次。
- 直接父元素不符的元素（如嵌在属性里的内部 bean）MUST NOT 产生绑定。
- 没有名字的元素 MUST NOT 产生绑定，SHALL 按绑定器计入缺名计数。
- 元素带有目标规则所列属性之一时（如 Spring 的 `factory-method`、`factory-bean`），绑定的目标 SHALL 为未知，即使元素写了类。这时写出的类是工厂，不是绑定对象的类。
- 有名字却没有目标的元素，SHALL 产生没有目标的绑定；绑定器声明其含义为配置时，该绑定标为配置。

绑定的目标在全部绑定读出后解析，每个绑定落到以下之一：仓库里有节点的类、仓库外的类、仓库有声明却没有节点的类、资源包、未知、歧义。

- 没有目标、而目标规则声明了继承属性、元素也写了该属性的绑定（如 Spring 只写 `parent` 的 bean），SHALL 取同单元、同命名空间里该属性所名的绑定的解析结果。
- 种类为名字的绑定（如 Spring `<alias>`），同样取所名绑定的解析结果。
- 所名的名字在同单元、同命名空间里没有绑定，或解析成环时，结果 SHALL 为未知；所名的名字有多个结果不一致的绑定时，结果为歧义。

所有名字都进入绑定表。EL 匹配时只用以下名字：EL 标识符；点分名每段都是 EL 标识符、且绑定器声明按命名空间解析的，作为命名空间名。其余名字 SHALL 计入非标识符名计数，并且不参与 EL 匹配。XML 注入点按名字原样匹配，不受此限。

每个文件属于一个部署单元：最近的、含目录所列描述符文件的祖先目录；没有这样祖先的文件属于仓库单元。XML 绑定属于描述符文件所在的单元，注解绑定属于类文件所在的单元。

#### Scenario: faces-config 声明的 managed bean
- **WHEN** 某单元的 `faces-config.xml` 在根元素下声明 `<managed-bean><managed-bean-name>orders</managed-bean-name><managed-bean-class>com.acme.web.OrderBean</managed-bean-class></managed-bean>`
- **THEN** 该单元有绑定 `orders` → `com.acme.web.OrderBean` 的 class 节点，证据为名字所在行

#### Scenario: CDI 缺省名
- **WHEN** 类 `com.acme.web.CustomerBean` 写了 `import javax.inject.Named;` 与 `@Named`，没有参数
- **THEN** 产生绑定 `customerBean` → 该类

#### Scenario: Spring 缺省名保留连续大写
- **WHEN** 类 `URLHelper` 带 `@org.springframework.stereotype.Component`，没有参数
- **THEN** 产生绑定 `URLHelper`，不是 `uRLHelper`

#### Scenario: 同名的自定义注解不算绑定
- **WHEN** 仓库在类所在的包里声明了自己的注解类型 `Named`，类上写 `@Named("x")`，且没有导入 `javax.inject.Named`
- **THEN** 该注解确认为仓库自己的 `Named`，不产生绑定

#### Scenario: 无法确认的注解
- **WHEN** 类上写 `@Named("x")`，文件只有按需导入 `import com.google.inject.name.*;`，同包也没有 `Named`
- **THEN** 不产生绑定，`Named` 计入未确认注解计数

#### Scenario: EJB 缺省名为类的简单名
- **WHEN** 类 `com.acme.OrderBean` 带 `@javax.ejb.Stateless`，没有参数
- **THEN** 产生 `ejb` 命名空间的绑定 `OrderBean` → 该类

#### Scenario: Configuration 类是 Spring 组件
- **WHEN** 类 `com.acme.AppConfig` 带 `@org.springframework.context.annotation.Configuration`，没有参数
- **THEN** 产生 `spring` 命名空间的绑定 `appConfig` → 该类

#### Scenario: 控制器增强的 value 不是名字
- **WHEN** 类 `com.acme.Faults` 带 `@org.springframework.web.bind.annotation.ControllerAdvice("com.acme.web")`
- **THEN** 产生 `spring` 命名空间的绑定 `faults` → 该类，不产生名为 `com.acme.web` 的绑定

#### Scenario: 非字面量名字
- **WHEN** 类上写 `@Named(Names.ORDERS)`
- **THEN** 不产生绑定，计入非字面量名字计数

#### Scenario: Spring 内部 bean 的 id 不是名字
- **WHEN** Spring XML 在 `<property>` 内嵌套 `<bean id="inner" class="com.acme.Inner"/>`
- **THEN** 不产生 `inner` 的绑定

#### Scenario: 只有 parent 的 bean 继承父定义的类
- **WHEN** 同一单元的 Spring XML 根元素下有 `<bean id="base" class="com.acme.BaseDao"/>` 与 `<bean id="child" parent="base"/>`，`child` 没有 `class`
- **THEN** 绑定 `child` 的目标解析为 `com.acme.BaseDao` 的 class 节点

#### Scenario: 只有 parent 的 bean 定义
- **WHEN** Spring XML 根元素下有 `<bean id="child" parent="base"/>`，没有 `class`，本单元也没有名为 `base` 的 Spring 绑定
- **THEN** 绑定 `child` 的目标为未知

#### Scenario: 工厂方法定义的目标未知
- **WHEN** Spring XML 根元素下有 `<bean id="svc" class="com.acme.ServiceLocator" factory-method="lookup"/>`
- **THEN** 绑定 `svc` 的目标为未知，不是 `com.acme.ServiceLocator`

#### Scenario: 别名解析到所名的定义
- **WHEN** 同一单元有 `<bean id="orderDao" class="com.acme.OrderDaoImpl"/>` 与 `<alias name="orderDao" alias="orders"/>`
- **THEN** 绑定 `orders` 的目标解析为 `com.acme.OrderDaoImpl` 的 class 节点

#### Scenario: 别名成环时目标未知
- **WHEN** 同一单元有 `<alias name="a" alias="b"/>` 与 `<alias name="b" alias="a"/>`，没有别的 `a` 或 `b` 绑定
- **THEN** 绑定 `a` 与 `b` 的目标都为未知，解析终止

#### Scenario: 匿名 bean 不产生绑定
- **WHEN** Spring XML 根元素下有 `<bean class="com.acme.Audit"/>`，没有 `id` 与 `name`
- **THEN** 不产生绑定，Spring XML 绑定器的缺名计数加一

#### Scenario: id 不按别名分隔符拆分
- **WHEN** Spring XML 写 `<bean id="a;b" name="c d" class="com.acme.X"/>`
- **THEN** 绑定名为 `a;b`、`c`、`d`，没有 `a` 与 `b`；`a;b` 计入非标识符名计数，EL 匹配不到它

#### Scenario: 点分 bean id 可被注入点匹配
- **WHEN** Spring XML 写 `<bean id="com.acme.api.OrderService" class="com.acme.impl.OrderServiceImpl"/>`
- **THEN** 该名字进入绑定表；EL 匹配不到它，并计入非标识符名计数；同单元写 `ref="com.acme.api.OrderService"` 的注入点能匹配到它

#### Scenario: 目录格式错误
- **WHEN** 名字绑定目录里有一个绑定器多了一个未定义的键
- **THEN** 加载失败并指出该键，分析不继续

### Requirement: EL 名字引用生成 references 边

系统 SHALL 对目录中表达式语言覆盖的每个文件做 EL 词法扫描。文件按扩展名，或按 XML 根元素及其命名空间判定。扫描规则：

- 取出每个 `#{…}` 与 `${…}` 内的根名，以及紧随其后的 `.标识符` 成员链。每个根名带原文件行号。
- 标记语言注释、JSP 脚本段中的文本 MUST NOT 产生根名。XML 形式的文件，表达式在所在的属性值或标签之间的文本段内定界，落在文本段之外的分隔符不产生根名，SHALL 计数；目录声明为模板文本的文件整篇作为一个文本段。分隔符前是反斜杠的、在所在文本段内未闭合的，都不产生根名，分别计数；未闭合时从该分隔符之后继续扫描。任何分隔符 MUST NOT 既不产生根名、又不被计数。
- 关键字、点号之后的标识符、函数前缀与函数名、字符串字面量与数字字面量里的字母都不是根名。表达式中的 XML 实体与字符引用（如 `&amp;`）按其代表的字符处理，不产生标识符。

每个根名 SHALL 按以下顺序落入且只落入一个桶：

1. **局部**：本文件中由目录声明的局部名属性（如 `var`、`varStatus`）声明的名字，或本表达式内的 lambda 参数。限定了元素命名空间的声明，只在元素前缀经本文件的 `xmlns` 或 JSP `taglib` 指令绑定到所列命名空间时生效。
2. **隐式**：目录为该表达式语言列出的隐式名字。
3. 候选名字为根名，以及成员链的每个点分前缀。取本单元内、该语言此处可见的命名空间里名字等于某个候选的绑定：
   - 命中的绑定分属不止一个候选名字：**歧义**；
   - 否则，有已知目标的绑定时，标为配置的目标未知绑定不参与归类；
   - 再按目标归类。全部指向同一个仓库类节点：**成边**；
   - 全部为资源包：**资源包**；
   - 全部指向同一个仓库外的类：**仓库外**；
   - 全部指向同一个仓库里有声明但不是节点的类：**未建索引**；
   - 全部目标未知：**目标未知**；
   - 其余情形：**歧义**。
4. **他处**：本单元不可见，但其它单元或不可见的命名空间里有名字等于某个候选的绑定。
5. **无绑定**。

只有成边的根名生成边：每个（文件，类）一条从该文件的 file 节点指向类 class 节点的 `references` 边。未建索引、目标未知、歧义、他处、无绑定 SHALL 分别记入缺口 `name-reference-target-unindexed`、`name-reference-target-unknown`、`name-reference-ambiguous`、`name-reference-elsewhere`、`name-reference-unbound`。歧义与他处的样例 SHALL 列出候选。MUST NOT 为了成边而放宽到其它单元、其它命名空间、第一个候选或最短的候选名字。

覆盖 SHALL 写入以下内容：

- 扫描文件数（按语言）与单元数；
- 绑定数（按绑定器），以及非字面量、缺名、非标识符名、未确认注解的计数；
- 十个桶的计数，以及转义、未闭合与文本段外分隔符的计数；
- 落隐式、但本单元可见命名空间里另有同名绑定的根名数；
- 含 `#{` 却不在表达式文件范围内的非代码文件：`.xml` 文件按根元素计数，其余按扩展名计数。

十个桶之和 SHALL 等于根名总数，五类缺口回读的计数 SHALL 等于对应桶；任一不等时构建失败。扫描未运行时，覆盖 SHALL 明示未运行。

#### Scenario: 页面用到 faces-config 声明的 bean
- **WHEN** 同一单元内 `orders/list.xhtml` 第 8 行写 `#{orders.save}`，且该单元只有一个 `orders` 绑定，指向 `OrderBean`
- **THEN** 生成 `list.xhtml` 的 file 节点到 `OrderBean` class 节点的 `references` 边，证据含第 8 行、根名 `orders`、成员链 `orders.save` 与绑定处

#### Scenario: 只被页面使用的 bean 有入边
- **WHEN** 一个带 `@Named` 的类没有任何 Java 调用方，只在一个页面的 EL 里被使用
- **THEN** 该类有一条来自该页面的 `references` 入边

#### Scenario: 循环变量不是 bean
- **WHEN** 页面写 `<ui:repeat value="#{orders.items}" var="item">`，并在其中使用 `#{item.price}`，同一单元恰有一个名为 `item` 的 bean
- **THEN** `item` 落局部，不生成指向该 bean 的边

#### Scenario: 请求参数名不是局部名
- **WHEN** Facelets 页面声明 `xmlns:f="http://xmlns.jcp.org/jsf/core"`，写 `<f:param name="cart" value="#{orderId}"/>`，并在别处写 `#{cart.total}`，同一单元恰有一个 `cart` 绑定
- **THEN** `cart` 不落局部，生成指向该 bean 类的边

#### Scenario: 别名标签声明的名字是局部名
- **WHEN** JSP 页面以 `<%@ taglib prefix="t" uri="http://myfaces.apache.org/tomahawk" %>` 引入 Tomahawk，写 `<t:aliasBean alias="#{bean}" value="#{orders}">` 与 `#{bean.save}`，同一单元有名为 `bean` 的绑定
- **THEN** 两处 `bean` 都落局部，不生成指向名为 `bean` 的类的边；`orders` 按绑定解析

#### Scenario: 脚本块里的动作声明局部名
- **WHEN** 经典 JSP 页面在 `<script>` 体内写 `<c:forEach items="${paramValues.to}" var="mailer">` 与 `${mailer.name}`，同一单元有名为 `mailer` 的绑定
- **THEN** `mailer` 落局部，不生成该页面指向名为 `mailer` 的类的边

#### Scenario: 点分名按成员链前缀匹配
- **WHEN** 类带 `@jakarta.inject.Named("admin.track")`，同一单元的页面写 `#{admin.track.trackingId}`
- **THEN** 生成指向该类的 `references` 边，证据的 `token` 为 `admin`，命中的绑定名为 `admin.track`

#### Scenario: 根名与点分名同时命中
- **WHEN** 同一单元同时有名为 `admin` 与 `admin.track` 的绑定，页面写 `#{admin.track.trackingId}`
- **THEN** 不生成边，记入 `name-reference-ambiguous`，样例列出两个名字

#### Scenario: 不按命名空间解析的点分名访问不到
- **WHEN** Spring XML 有 `<bean id="admin.track" class="com.acme.Track"/>`，单元已声明 Spring 的 EL 解析器，页面写 `#{admin.track.x}`
- **THEN** 不生成边；该名字计入非标识符名计数

#### Scenario: 配置型组件让位于注解声明的同名组件
- **WHEN** Seam `components.xml` 写 `<component name="numberGuess">`，不写 `class`；同一单元的类带 `@Name("numberGuess")`；页面写 `#{numberGuess.guess}`
- **THEN** 生成指向该类的边，证据的绑定处同时列出 `components.xml` 与注解所在行

#### Scenario: 目标未知的 Spring bean 与同名注解并存为歧义
- **WHEN** 单元已声明 Spring 的 EL 解析器，Spring XML 有 `<bean id="report" parent="base"/>`，同单元的类带 `@Component("report")`，页面写 `#{report.run}`
- **THEN** 不生成边，记入 `name-reference-ambiguous`

#### Scenario: 经典 JSP 属性值里嵌套的动作
- **WHEN** JSP 页面写 `<div title="<h:outputText value="#{mailer.subject}"/>">`，同一单元恰有一个 `mailer` 绑定
- **THEN** 产生根名 `mailer`，生成指向该 bean 类的边

#### Scenario: XML 形式文件里标签语法中的分隔符可见
- **WHEN** Facelets 页面写 `<p #{stray.x} class="#{ok.y}">`
- **THEN** 只有 `ok` 是根名，文本段外分隔符计数加一

#### Scenario: 未闭合的表达式不吞掉后文
- **WHEN** 页面第 3 行写 `#{orders.title`，没有 `}`，第 9 行写 `#{cart.total}`
- **THEN** 未闭合计数加一，第 9 行产生根名 `cart`

#### Scenario: 隐式对象优先于同名 bean
- **WHEN** 页面写 `#{param.id}`，同一单元有名为 `param` 的绑定
- **THEN** `param` 落隐式，不生成边，隐式与绑定并存的计数加一

#### Scenario: 其它单元的同名 bean 不成边
- **WHEN** 单元 A 的页面写 `#{remote.x}`，只有单元 B 声明了 `remote`
- **THEN** 不生成边，记入 `name-reference-elsewhere`，样例列出单元 B

#### Scenario: 没有桥接时 Spring bean 对 EL 不可见
- **WHEN** 单元内 Spring XML 声明了 bean `orderService`，页面写 `#{orderService.count}`，且该单元的 faces-config 没有声明 Spring 的 EL 解析器
- **THEN** 不生成边，记入 `name-reference-elsewhere`

#### Scenario: 桥接后 Spring bean 对 EL 可见
- **WHEN** 同样的 bean 与页面，该单元的 faces-config 在 `el-resolver` 中声明了 `org.springframework.web.jsf.el.SpringBeanFacesELResolver`
- **THEN** 生成指向该 bean 类的 `references` 边

#### Scenario: 同名绑定指向不同的类
- **WHEN** 同一单元的主源与测试源各有一个 `@Name("paymentHome")`，指向两个不同的类，页面写 `#{paymentHome.pay}`
- **THEN** 不生成边，记入 `name-reference-ambiguous`，样例列出两个类

#### Scenario: 注释与转义里的表达式不算
- **WHEN** 页面写 `<!-- #{orders.secret} -->` 与 `\#{orders.raw}`
- **THEN** 两处都不产生根名，转义计数加一

#### Scenario: 函数与三元运算
- **WHEN** 页面写 `#{fn:length(orders.items) gt 0 ? cart.total : 0}`
- **THEN** 根名为 `orders` 与 `cart`；`fn`、`length`、`items`、`total` 都不是根名

#### Scenario: 属性值里的实体引用
- **WHEN** 页面属性写 `rendered="#{orders.open &amp;&amp; not cart.empty}"`
- **THEN** 根名为 `orders` 与 `cart`，`amp` 不是根名

#### Scenario: 不在表达式文件范围内的 EL 可见
- **WHEN** 一个 `.html` 文件含 `#{home.title}`
- **THEN** 不产生根名，覆盖中 `html` 的目录外文件计数加一

#### Scenario: 阶段未运行
- **WHEN** 投影没有收到 EL 站点与名字绑定目录
- **THEN** 覆盖记未运行，不生成 `references` 边，也不产生 `name-reference-*` 缺口

### Requirement: references 边的证据与遍历

`references` 边的每条证据 SHALL 含以下内容：

- 引用所在行；
- 根名（`token`）、成员链与命中的绑定名；
- 产生该绑定的每个绑定处（文件、行、绑定器 id）。

图谱验证 SHALL 要求被引行包含 `token`。`references` SHALL 属于可遍历的确定性边类型：从 bean 类沿入边，能有界地遍历到使用它的页面。`references` 与 `mentions` 是两种边类型，同一对文件与类可以同时有两种边。

#### Scenario: 证据可复核
- **WHEN** 一条 `references` 边的证据指向第 8 行、`token` 为 `orders`
- **THEN** 快照中该文件第 8 行含 `orders`；证据里的绑定处那一行含 `orders` 的声明，或含产生缺省名的注解

#### Scenario: 从 bean 类遍历到页面
- **WHEN** 从 `OrderBean` 的 class 节点做 1 跳入边遍历
- **THEN** 结果包含经 `references` 到达的 `orders/list.xhtml`

### Requirement: XML 注入点

系统 SHALL 按目录的 XML 注入族，从根元素命中的 XML 文件里读出注入点，并把每个注入点解析成一条 `injects` 边或一个可见桶。根元素按本地名与根命名空间匹配：根命名空间不在列表里的文件（如命名空间为 Java EE 的 CDI `beans.xml`）MUST NOT 被当作注入族读取。标记语言注释里的内容不算。

注入族声明：

- 注入点：元素本地名加属性名，或者属性所在命名空间加属性名后缀（如 Spring `p:` 与 `c:` 命名空间里以 `-ref` 结尾的属性）。每个注入点有 id，并声明名字的可见范围：
  - 单元：同单元、注入族命名空间里的绑定；
  - 本文件：只看同一文件里的绑定，如 `<ref local>`；
  - 静态不可见：名字在父容器等静态读取看不到的地方，如 `<ref parent>`。
- 消费者元素本地名，以及读消费者类所用的 XML 绑定器。消费者类按该绑定器的目标规则读，包括目标未知的条件与继承属性。
- 普查规则：哪些属性名、属性名后缀与元素算作引用形状。

每个注入点的名字是属性值去掉首尾空白后的原文，行号为该属性所在行。消费者是注入点所在元素自身或最近的祖先中，本地名为消费者元素的那一个；所以内部 bean 里的注入点，消费者是内部 bean。

普查规则命中、却没有任何注入点读取的引用形状，SHALL 按「元素本地名@属性名」计数，普查元素按元素本地名计数。例如 `<idref bean>` 只传名字字符串、不注入 bean，计为 `idref`。

每个注入点 SHALL 恰好落入一个桶，先看目标，目标落到仓库类之后再看消费者：

1. **静态不可见**：注入点声明名字静态不可见。
2. 取可见范围内、注入族命名空间里名字等于该名字的全部绑定，按「名字绑定」解析后的目标归类，规则与 EL 相同：
   - 全部是同一个仓库类：看消费者，见第 4 步；
   - 全部是资源包：**资源包**；
   - 全部是同一个仓库外的类：**仓库外**，不算缺口；
   - 全部是同一个已声明却没有节点的类：**目标未建索引**；
   - 全部目标未知：**目标未知**；
   - 其余：**歧义**。
3. 可见范围内没有这个名字时：别的单元、别的命名空间或本单元其它文件（可见范围为本文件时）里有这个名字，落**他处**；都没有，落**无绑定**。
4. 消费者：
   - 没有消费者元素（如顶层 `<util:list>` 里的 `<ref>`）：**消费者缺失**；
   - 消费者类为同一个仓库类：**成边**；
   - 仓库外的类：**消费者在仓库外**，不算缺口；
   - 未知：**消费者未知**，包括工厂方法定义，以及继承属性所名的定义在本单元没有绑定；
   - 已声明却没有节点：**消费者未建索引**；
   - 歧义：**消费者歧义**。

成边的注入点生成从消费者类节点指向目标类节点的 `injects` 边，每个（消费者类，目标类）一条。缺口如下：

| 缺口 | 对应的桶 |
|---|---|
| `injection-target-unresolved` | 静态不可见、目标未建索引、目标未知 |
| `injection-ambiguous` | 歧义 |
| `injection-elsewhere` | 他处 |
| `injection-unbound` | 无绑定 |
| `injection-consumer-unresolved` | 消费者缺失、消费者未知、消费者未建索引、消费者歧义 |

样例 SHALL 写出注入点的文件、行与名字，歧义与他处的样例列出候选。MUST NOT 为了成边而放宽到其它单元、其它命名空间、其它文件或第一个候选。

`coverage.injections` SHALL 给出：

- 运行状态；
- 按注入族计的已读文件数；
- 按注入点 id 计的注入点数；
- 十四个桶的计数与注入点总数；
- 普查未读计数。

守恒有两条：

- 十四个桶之和等于注入点总数；
- 五类缺口回读的计数，分别等于 XML 注入点与「Java 注解注入点」对应桶之和。

任一不等，构建 MUST 失败。没有收到注入点与目录时，覆盖记 `not-run`。

#### Scenario: property 的 ref 成边
- **WHEN** 同一单元的 Spring XML 有 `<bean id="orderService" class="com.acme.OrderServiceImpl"><property name="dao" ref="orderDao"/></bean>` 与 `<bean id="orderDao" class="com.acme.OrderDaoImpl"/>`，两个类都在仓库里
- **THEN** 生成 `com.acme.OrderServiceImpl` → `com.acme.OrderDaoImpl` 的 `injects` 边，证据为 `ref="orderDao"` 所在行

#### Scenario: 集合里的 ref 消费者是最近的 bean
- **WHEN** `<bean class="com.acme.Router"><property name="handlers"><list><ref bean="orderHandler"/></list></property></bean>`，`orderHandler` 在本单元绑定到仓库类 `com.acme.OrderHandler`
- **THEN** 生成 `com.acme.Router` → `com.acme.OrderHandler` 的 `injects` 边

#### Scenario: 内部 bean 的注入点属于内部 bean
- **WHEN** `<bean id="a" class="com.acme.A"><property name="p"><bean class="com.acme.Inner"><property name="q" ref="x"/></bean></property></bean>`，`x` 绑定到仓库类 `com.acme.X`
- **THEN** 生成 `com.acme.Inner` → `com.acme.X` 的 `injects` 边，不生成 `com.acme.A` → `com.acme.X`

#### Scenario: p 命名空间的引用属性
- **WHEN** 根元素声明 `xmlns:p="http://www.springframework.org/schema/p"`，`<bean class="com.acme.Report" p:source-ref="orderDao"/>`
- **THEN** 该属性是一个注入点，消费者是它所在的 `<bean>`，生成 `com.acme.Report` → `orderDao` 的目标类的 `injects` 边

#### Scenario: 注解声明的目标
- **WHEN** 同一单元的类 `com.acme.JdbcOrderDao` 带 `@org.springframework.stereotype.Repository("orderDao")`，Spring XML 写 `<property name="dao" ref="orderDao"/>`，消费者是仓库类
- **THEN** 生成消费者类 → `com.acme.JdbcOrderDao` 的 `injects` 边，证据的绑定处为注解所在行

#### Scenario: 经别名的目标
- **WHEN** 同一单元有 `<bean id="orderDao" class="com.acme.OrderDaoImpl"/>`、`<alias name="orderDao" alias="orders"/>` 与消费者为仓库类的 `<property ref="orders"/>`
- **THEN** 生成消费者类 → `com.acme.OrderDaoImpl` 的 `injects` 边，证据的绑定处同时列出别名与 bean 定义

#### Scenario: ref local 只看本文件
- **WHEN** `<ref local="orderDao"/>` 所在文件没有 `orderDao`，同单元另一个文件有 `<bean id="orderDao" class="com.acme.OrderDaoImpl"/>`
- **THEN** 不生成边；该注入点落「他处」

#### Scenario: ref parent 静态不可见
- **WHEN** 注入点写 `<ref parent="orderDao"/>`
- **THEN** 不生成边；落「静态不可见」，记缺口 `injection-target-unresolved`

#### Scenario: 名字只在别的单元
- **WHEN** 单元 A 的 Spring XML 写 `ref="userDirectory"`，只有单元 B 声明了 `userDirectory`
- **THEN** 不生成边；落「他处」，样例列出单元 B

#### Scenario: 同名两个类为歧义
- **WHEN** 同一单元的两个 Spring XML 文件分别写 `<bean id="mailer" class="com.acme.SmtpMailer"/>` 与 `<bean id="mailer" class="com.acme.FakeMailer"/>`，另一处写 `ref="mailer"`
- **THEN** 不生成边；落「歧义」，样例列出两个类

#### Scenario: 目标在仓库外
- **WHEN** `ref="dataSource"` 所名的 bean 是 `<bean id="dataSource" class="org.apache.commons.dbcp.BasicDataSource"/>`，仓库里没有这个类
- **THEN** 不生成边、不记缺口；落「仓库外」

#### Scenario: 工厂方法定义作目标
- **WHEN** `ref="svc"` 所名的 bean 是 `<bean id="svc" class="com.acme.ServiceLocator" factory-method="lookup"/>`
- **THEN** 不生成边；落「目标未知」，记缺口 `injection-target-unresolved`

#### Scenario: 消费者继承父定义的类
- **WHEN** 同一单元有 `<bean id="baseDao" class="com.acme.BaseDao"/>` 与 `<bean id="userDao" parent="baseDao"><property name="ds" ref="mainDs"/></bean>`，`mainDs` 绑定到仓库类 `com.acme.MainDs`
- **THEN** 生成 `com.acme.BaseDao` → `com.acme.MainDs` 的 `injects` 边，证据的消费者处列出 `parent` 所名的定义

#### Scenario: 工厂方法定义作消费者
- **WHEN** `<bean id="ctx" class="com.acme.Context" factory-method="getInstance"><property name="dao" ref="orderDao"/></bean>`，`orderDao` 绑定到仓库类
- **THEN** 不生成边；落「消费者未知」，记缺口 `injection-consumer-unresolved`

#### Scenario: 没有外层 bean
- **WHEN** 根元素下的 `<util:list id="handlers">` 里写 `<ref bean="orderHandler"/>`，`orderHandler` 绑定到仓库类
- **THEN** 不生成边；落「消费者缺失」，记缺口 `injection-consumer-unresolved`

#### Scenario: 消费者在仓库外
- **WHEN** `<bean class="org.springframework.transaction.interceptor.TransactionProxyFactoryBean"><property name="target" ref="orderServiceTarget"/></bean>`，`orderServiceTarget` 绑定到仓库类
- **THEN** 不生成边、不记缺口；落「消费者在仓库外」

#### Scenario: 非 Spring 命名空间的 beans 根不读
- **WHEN** `beans.xml` 的根元素是 `<beans xmlns="http://xmlns.jcp.org/xml/ns/javaee">`，里面有 `ref` 属性
- **THEN** 该文件不产生注入点，也不进普查

#### Scenario: 普查记下没有读的引用形状
- **WHEN** Spring XML 里有 `<idref bean="orderDao"/>` 与 `<security:custom-filter ref="authFilter"/>`
- **THEN** 两处都不产生注入点；普查未读计数为 `idref` 1、`custom-filter@ref` 1

#### Scenario: 注释里的注入点不算
- **WHEN** Spring XML 里 `<!-- <property name="dao" ref="orderDao"/> -->`
- **THEN** 不产生注入点，也不进普查

#### Scenario: 守恒不平衡时构建失败
- **WHEN** 某个注入点没有落入任何桶，或某类缺口回读的计数与两种来源对应桶之和不等
- **THEN** 构建失败，不写出产物

### Requirement: injects 边的证据与遍历

`injects` 边 SHALL 带 `provenance: "extracted"`。同一对（消费者，目标）只有一条边：XML 注入点、Java 注解注入点与 Java 按类型注入点中有几种成边，证据就合并几种，MUST NOT 丢失任何一方的证据。

XML 注入点每个成边一条证据，内容为：

- 注入点所在的 XML 文件与行；
- 名字（`token`）与注入点 id；
- 消费者元素所在行，以及消费者类经继承属性解析时经过的绑定处；
- 目标解析经过的全部绑定处：名字直接命中的绑定、别名所名的绑定与继承所名的绑定，每处给出文件、行与绑定器。

Java 注解注入点每个成边一条证据，内容为：

- 名字写出的 Java 文件与行：显式名字为参数值所在行，缺省名为成员名所在行；
- 该行上写出的文字（`token`）、解析用的名字与注入点 id。缺省名时 `token` 是成员名的原样写法，如 `setOrderDao`；
- 管理消费者类的绑定处；注入族不要求管理时为空；
- 目标解析经过的全部绑定处，同 XML 注入点。

Java 按类型注入点每个成边的注入点给出一组证据，每条带 `token` 与角色：

- 注入注解所在行：`token` 为注解的写法，角色「注入」，带族 id 与成员名；参数注入点另带参数序号；
- 成员名所在行：`token` 为成员名，角色「成员」，带写出的声明类型；参数注入点的成员是方法或构造器；
- 名字限定符筛过候选时，它所在行：`token` 为其写法，角色「限定符」，带名字；
- 目标是生产者方法时，生产者注解所在行：`token` 为其写法，角色「生产者」。

同一条边的证据按文件、行、`token`、注入点 id 或角色、成员与参数序号排序去重。图校验 SHALL 要求证据行包含 `token`。`injects` SHALL 属于可遍历的确定性边类型，可以从目标（类或生产者方法）沿入边找到被注入它的消费者类。

#### Scenario: 证据可复核
- **WHEN** 读 `injects` 边每条证据的文件与行
- **THEN** 该行含证据里的 `token`；证据里的每个绑定处与管理绑定处所在行，含该绑定声明的名字，或是产生缺省名的注解

#### Scenario: 从被注入的类遍历到消费者
- **WHEN** 从 `com.acme.OrderDaoImpl` 的 class 节点做 1 跳入边遍历
- **THEN** 结果包含经 `injects` 到达的 `com.acme.OrderServiceImpl`

#### Scenario: 证据行不含名字时校验报出
- **WHEN** 一条 `injects` 边的证据行号被改成不含 `token` 的行
- **THEN** 图校验对这条边报出证据不符

#### Scenario: 按类型证据可复核
- **WHEN** 读按类型注入点成边的每条证据的文件与行
- **THEN** 该行含证据里的 `token`；「注入」条目的 `token` 是一个经确认的注入注解的写法，「成员」条目的 `token` 是该成员的名字

#### Scenario: 按名字与按类型合成一条边
- **WHEN** 类 `com.acme.Checkout` 的一个字段写 `@EJB(beanName = "OrderBean") private Orders a;`，另一个字段写 `@EJB private OrderBean b;`，两者都解析到 `com.acme.OrderBean`
- **THEN** 只有一条 `com.acme.Checkout` → `com.acme.OrderBean` 的 `injects` 边，证据同时含按名字的条目与按类型的条目

#### Scenario: 两种来源合成一条边
- **WHEN** 同一单元的 Spring XML 写 `<bean id="orderService" class="com.acme.OrderService"><property name="dao" ref="orderDao"/></bean>`，`com.acme.OrderService` 的另一个字段又写 `@Resource(name = "orderDao")`，`orderDao` 绑定到仓库类 `com.acme.JdbcOrderDao`
- **THEN** 只有一条 `com.acme.OrderService` → `com.acme.JdbcOrderDao` 的 `injects` 边，证据同时含 XML 行与 Java 行

### Requirement: Java 注解注入点

系统 SHALL 按目录的注解注入族，从 Java 类型成员上的注解读出注入点，并把每个注入点解析成一条 `injects` 边或一个可见桶。注解来自 Core 对成员注解的抽取：

- 字段，每个声明符一条；
- 方法与构造器；
- 方法与构造器的参数；
- record 组件。

文件里任意深度的类型体都读，包括嵌套、局部与匿名类型。

注入族声明：

- 命名空间；
- 名字只在哪些绑定器的绑定里解析（可选）；
- 消费者类必须由哪些绑定器管理（可为空）；
- 注入点。每个注入点声明：
  - 注解全限定名；
  - 可附着的成员种类；
  - 读名字的参数键；
  - 缺省名规则；
  - 名字取缺省、又没有绑定时容器是否退回按类型注入；
  - 表达式前缀。

注解的身份 SHALL 按「名字绑定」的 Java 作用域规则确认。写法与目录中某个注入点注解的简单名相同、却没有确认的，SHALL 按写法计数，不是注入点。

注入点的名字 SHALL 按以下规则取：

- 第一个出现的名字参数是非空的字符串字面量时，名字为它的值，写出的行为参数值所在行；
- 没写名字参数或为空串时，按注入点的缺省名规则从成员推出，写出的行为成员名所在行：
  - 字段：字段名；
  - `set` 开头且长于 3 个字符的方法：去掉 `set` 后的部分，Java Beans 规则下前两个字符都大写时保持原样、否则首字母小写，Seam 规则下只把首字母小写；
  - 其它方法：Java Beans 规则取方法名，Seam 规则没有缺省名；
  - 参数、构造器与 record 组件：没有缺省名。

消费者 SHALL 是成员所在的顶层类型的 class 节点；嵌套、局部与匿名类型的成员归到顶层类型，并计数。

注入族声明了管理绑定器时：

- 只有当某个这类绑定解析到消费者类时，消费者才受管理；
- 名字 SHALL 在这些管理绑定所在的全部部署单元里解析；
- 消费者不受管理时 MUST NOT 解析名字。没有名字的组件定义（如匿名的 Spring `<bean class>`）不产生绑定，所以不使类受管理。

注入族没有声明管理绑定器时，名字在类文件所在的单元里解析。

每个注入点 SHALL 恰好落入一个桶，按以下顺序：

1. 成员种类不在注入点声明里：**位置不读**；
2. 名字参数不是字符串字面量：**名字非字面量**；
3. 没写名字、也没有缺省名：**无名字**，即按类型注入，不算缺口。其中 `@Inject` 与不带名字的 `@EJB` 由「Java 按类型注入点」解析；
4. 名字以表达式前缀开头：**表达式**；
5. 消费者类没有节点：**消费者未建索引**；
6. 消费者不受管理：**不受管理**，不算缺口；
7. 解析范围内、注入族命名空间里（声明了绑定器时只看这些绑定器）名字相等的绑定，按「名字绑定」解析后的目标归类，规则同 XML 注入点：成边、资源包、仓库外、目标未建索引、目标未知、歧义；
8. 没有这样的绑定时：
   - 名字取缺省、注入点声明退回按类型：**按类型**，不算缺口；
   - 解析范围以外有这个名字（别的单元、别的命名空间，或不在注入族所限绑定器里的绑定）：**他处**；
   - 否则：**无绑定**。

成边的注入点生成从消费者类节点指向目标类节点的 `injects` 边，与 XML 注入点共用边类型，每个（消费者类，目标类）一条。缺口复用 XML 注入点的五类：

| 缺口 | 对应的桶 |
|---|---|
| `injection-target-unresolved` | 名字非字面量、表达式、目标未建索引、目标未知 |
| `injection-ambiguous` | 歧义 |
| `injection-elsewhere` | 他处 |
| `injection-unbound` | 无绑定 |
| `injection-consumer-unresolved` | 消费者未建索引 |

样例 SHALL 写出注入点的文件、行与名字，歧义与他处的样例列出候选。MUST NOT 为了成边而放宽到解析范围以外的单元、其它命名空间、其它绑定器或第一个候选。

`coverage.annotationInjections` SHALL 给出：

- 运行状态；
- 按注入点 id 计的注入点数；
- 十五个桶的计数与注入点总数；
- 位于嵌套、局部或匿名类型里的注入点数；
- 未确认注解的计数。

十五个桶之和 SHALL 等于注入点总数。没有收到名字引用阶段的结果与目录时，覆盖记 `not-run`。

#### Scenario: Qualifier 字段成边
- **WHEN** 类 `com.acme.OrderService` 带 `@org.springframework.stereotype.Service`，字段写 `@Autowired @Qualifier("orderDao") private OrderDao dao;`，同单元 Spring XML 有 `<bean id="orderDao" class="com.acme.JdbcOrderDao"/>`
- **THEN** 生成 `com.acme.OrderService` → `com.acme.JdbcOrderDao` 的 `injects` 边，证据为 `"orderDao"` 所在行，`token` 与 `name` 都是 `orderDao`，管理绑定处为 `@Service` 所在行

#### Scenario: 构造器参数上的 Qualifier
- **WHEN** 受管理的类 `com.acme.Report` 的构造器写 `Report(@Qualifier("mainDs") DataSource ds)`，`mainDs` 在管理单元绑定到仓库类 `com.acme.MainDs`
- **THEN** 生成 `com.acme.Report` → `com.acme.MainDs` 的 `injects` 边，证据行为参数所在行

#### Scenario: Resource 字段的缺省名
- **WHEN** 受管理的类上写 `@Resource private OrderDao orderDao;`，管理单元有名为 `orderDao` 的绑定，目标为仓库类 `com.acme.JdbcOrderDao`
- **THEN** 生成到 `com.acme.JdbcOrderDao` 的 `injects` 边，证据行为字段名所在行，`token` 为 `orderDao`

#### Scenario: setter 上 Resource 的缺省名
- **WHEN** 受管理的类上写 `@Resource public void setOrderDao(OrderDao d)`，管理单元有 `orderDao` 绑定到仓库类
- **THEN** 解析的名字为 `orderDao`，证据的 `token` 为 `setOrderDao`

#### Scenario: Resource 缺省名退回按类型
- **WHEN** 受管理的类上写 `@Resource private Clock clock;`，管理单元与任何单元都没有名为 `clock` 的绑定
- **THEN** 不生成边、不记缺口；落「按类型」

#### Scenario: 不受 Spring 管理的类上的 Resource
- **WHEN** 类 `com.acme.OrderBean` 只带 `@javax.ejb.Stateless`，字段写 `@Resource(name = "jdbc/orders") private DataSource ds;`
- **THEN** 不解析名字，不生成边、不记缺口；落「不受管理」

#### Scenario: 由别的单元 XML 管理的类
- **WHEN** 单元 `core` 里的类 `com.acme.OrderService` 没有构造型注解，字段写 `@Resource(name = "orderDao")`；单元 `web` 的 Spring XML 写 `<bean id="orderService" class="com.acme.OrderService"/>` 与 `<bean id="orderDao" class="com.acme.JdbcOrderDao"/>`
- **THEN** 名字在单元 `web` 里解析，生成 `com.acme.OrderService` → `com.acme.JdbcOrderDao` 的 `injects` 边，管理绑定处为 `web` 里 `orderService` 定义所在行

#### Scenario: 方法上的 Qualifier 不读
- **WHEN** 受管理的类里写 `@Bean @Qualifier("primary") public DataSource ds()`
- **THEN** 不生成边、不记缺口；落「位置不读」

#### Scenario: Seam 缺省名成边
- **WHEN** 类 `com.acme.Checkout` 带 `@org.jboss.seam.annotations.Name("checkout")`，字段写 `@In private Cart cart;`，同单元类 `com.acme.Cart` 带 `@Name("cart")`
- **THEN** 生成 `com.acme.Checkout` → `com.acme.Cart` 的 `injects` 边，证据行为字段名所在行

#### Scenario: Seam 注入点不命中 JSF bean
- **WHEN** Seam 组件的字段写 `@In private Prefs prefs;`，同单元只有 `faces-config.xml` 声明了名为 `prefs` 的 managed bean，没有 Seam 组件叫 `prefs`
- **THEN** 不生成边；落「他处」，样例列出该 managed bean 的单元与命名空间

#### Scenario: Seam 表达式
- **WHEN** Seam 组件的字段写 `@In("#{preferences.get('wiki')}") private Object pref;`
- **THEN** 不生成边；落「表达式」，记缺口 `injection-target-unresolved`

#### Scenario: Seam 内置组件
- **WHEN** Seam 组件的字段写 `@In private FacesMessages facesMessages;`，仓库里没有名为 `facesMessages` 的绑定
- **THEN** 不生成边；落「无绑定」，记缺口 `injection-unbound`

#### Scenario: EJB beanName
- **WHEN** 字段写 `@EJB(beanName = "OrderBean") private Orders orders;`，同单元类 `com.acme.OrderBean` 带 `@javax.ejb.Stateless`、没有参数
- **THEN** 生成声明该字段的类 → `com.acme.OrderBean` 的 `injects` 边

#### Scenario: 按类型的 EJB
- **WHEN** 字段写 `@EJB private Orders orders;`，没有 `beanName`
- **THEN** 本阶段不生成边、不记缺口；落「无名字」，由「Java 按类型注入点」解析

#### Scenario: 非字面量的名字
- **WHEN** 受管理的类上写 `@Qualifier(Beans.ORDER_DAO) private OrderDao dao;`
- **THEN** 不生成边；落「名字非字面量」，记缺口 `injection-target-unresolved`

#### Scenario: 同包同名的自定义注解不是注入点
- **WHEN** 仓库在类所在的包里声明了注解类型 `Resource`，字段写 `@Resource(name = "x")`，没有导入 `javax.annotation.Resource`
- **THEN** 该注解不是注入点，不进任何桶

#### Scenario: 嵌套类型里的注入点
- **WHEN** 受管理的顶层类 `com.acme.Outer` 里的静态嵌套类的字段写 `@Resource(name = "orderDao")`
- **THEN** 消费者为 `com.acme.Outer` 的 class 节点，注入点计入嵌套计数

### Requirement: Java 注解路由

系统 SHALL 按路由目录，从 Java 类型与方法上的注解读出路由点，把每个路由点解析成一个端点，或落入一个可见桶。注解来自 Core 已有的抽取：
- 顶层类型上的注解（`classes[].annotationArguments`）；
- 类型体内成员上的注解（`memberAnnotations`）。

路由目录是数据，不是代码分支。每个路由族声明：
- id 与一句依据说明；
- 根路径注解：全限定名列表，以及读路径的参数键；
- 方法路径注解：同上；
- HTTP 方法注解：每个动词一条，列出它的全限定名；
- 客户端注解：类型上带有它们时，该类型声明的是对远端服务的调用，不是本应用的入口（可为空）；
- 是否只认 `public` 方法。

目录出现未知键、缺少字段或类型不符时，加载 MUST 失败，不得带着部分目录运行。

注解的身份 SHALL 按「名字绑定」的 Java 作用域规则确认。写法与目录中某个注解的简单名相同、却没有确认的，SHALL 按写法计数，不是路由注解。

路由点是类型体内的一个方法，它带有某个族至少一个经确认的 HTTP 方法注解或方法路径注解。每个路由点 SHALL 按以下顺序恰好落入一个桶：

1. 方法声明在嵌套、局部或匿名类型里：**嵌套**；
2. 所在顶层类型上有该族经确认的客户端注解：**客户端声明**，不算缺口；
3. 所在顶层类型里没有名字与名字所在行都对应的方法声明，或该声明的节点身份与别的声明冲突：**处理方法未建索引**；
4. 族只认 `public` 方法，而该方法不是 `public`：**非 public**，不算缺口；
5. 带有两个或更多不同动词：**多个 HTTP 方法**；
6. 没有 HTTP 方法注解：**没有 HTTP 方法**，即子资源定位方法，或目录以外的自定义动词；
7. 所在顶层类型上没有经确认的根路径注解：**没有根路径**，即子资源方法，或由部署配置注册的资源；
8. 根路径或方法路径注解没写路径参数，或参数不是字符串字面量：**路径非字面量**；
9. 其余：**成端点**。

路由写成「动词 + 一个空格 + 路径」：
- 路径由根路径值与方法路径值拼成。没写方法路径时，方法路径值为空串。
- 两个值各去掉开头与结尾的全部 `/`，非空的段以 `/` 相连，前面加 `/`。
- 值的其余部分原样保留，包括模板 `{id}` 与其中的正则。
- 路径相对于应用的根，不含 `@ApplicationPath` 或部署配置给的前缀。

端点节点：
- 每个（类文件，顶层类型，路由）一个 `endpoint` 节点；
- 名字为路由，所属为顶层类型的简单名；
- 行范围取该组里源码顺序第一个处理方法的行范围；
- 身份经统一的节点身份函数派生；
- 不进入 source index：处理方法的 chunk 已含注解原文。

每个成端点的路由点 SHALL 生成一条 `routes` 边，从端点指向处理方法的节点。同一路由由几个方法处理时，一个端点、几条边。

文件到端点的 `contains` 边 SHALL 引用该端点第一个处理方法的 HTTP 方法注解所在行，并以该注解的写法作 `token`。

缺口：

| 缺口 | 对应的桶 |
|---|---|
| `route-handler-unresolved` | 嵌套、处理方法未建索引 |
| `route-verb-unresolved` | 多个 HTTP 方法、没有 HTTP 方法 |
| `route-root-unresolved` | 没有根路径 |
| `route-path-unresolved` | 路径非字面量 |

样例 SHALL 写出路由点的文件、行与方法名。

为了成端点，MUST NOT 放宽规则：
- 不从父类型、接口或部署配置补根路径；
- 不读常量；
- 不在几个动词里取第一个。

`coverage.routes` SHALL 给出：
- 运行状态；
- 每个族的路由点数、九个桶的计数、端点数与边数；
- 未确认注解按写法的计数。

守恒 SHALL 成立，不成立时构建 MUST 失败：
- 九个桶之和等于路由点数；
- 成端点的路由点数等于该族的 `routes` 边数；
- 每类缺口的计数等于对应桶之和。

没有路由目录输入时，状态为 `not-run`。

#### Scenario: 类与方法的路径拼成路由
- **WHEN** 类 `OrderResource` 写 `@Path("/orders/")`，其 public 方法 `find` 写 `@GET` 与 `@Path("{id}")`，注解都经 `javax.ws.rs` 的单类型导入确认
- **THEN** 生成名为 `GET /orders/{id}`、所属为 `OrderResource` 的 `endpoint` 节点，以及从它指向 `find` 的 `routes` 边

#### Scenario: 没写方法路径
- **WHEN** 类写 `@Path("orders")`，方法 `create` 只写 `@POST`
- **THEN** 路由为 `POST /orders`

#### Scenario: 根路径为斜杠
- **WHEN** 类写 `@Path("/")`，方法只写 `@GET`
- **THEN** 路由为 `GET /`

#### Scenario: jakarta 命名空间
- **WHEN** 文件经 `import jakarta.ws.rs.*;` 写 `@Path("items")` 与 `@DELETE`，仓库在同包没有名为 `Path` 或 `DELETE` 的类型
- **THEN** 与 `javax.ws.rs` 的写法得到同样的端点

#### Scenario: 几个方法共享一个路由
- **WHEN** 同一个类里两个 public 方法都写 `@GET @Path("{id}")`，只是 `@Produces` 不同
- **THEN** 只有一个 `GET /orders/{id}` 端点，有两条 `routes` 边，各指向一个方法；端点的行范围取源码在前的那个方法

#### Scenario: 接口上声明的路由
- **WHEN** 接口 `OrderApi` 写 `@Path("/v2/orders")`，其方法 `list` 写 `@GET`；实现类 `OrderApiImpl` 的 `list` 不写任何注解
- **THEN** 端点 `GET /v2/orders` 的 `routes` 边指向接口方法 `OrderApi.list`；实现方法经既有的方法级 `implements` 边可达，不另画端点

#### Scenario: 子资源定位方法
- **WHEN** 方法 `items` 写 `@Path("{id}/items")`，没有 HTTP 方法注解
- **THEN** 不生成端点，计入「没有 HTTP 方法」，记 `route-verb-unresolved` 缺口

#### Scenario: 类上没有根路径
- **WHEN** 类 `ItemsResource` 没有类上的 `@Path`，其方法 `list` 写 `@GET`
- **THEN** 不生成端点，计入「没有根路径」，记 `route-root-unresolved` 缺口

#### Scenario: 路径写成常量
- **WHEN** 方法写 `@GET @Path(Paths.HISTORY)`
- **THEN** 不生成端点，计入「路径非字面量」，记 `route-path-unresolved` 缺口

#### Scenario: 多个动词
- **WHEN** 方法同时写 `@GET` 与 `@POST`
- **THEN** 不生成端点，计入「多个 HTTP 方法」，记 `route-verb-unresolved` 缺口

#### Scenario: 非 public 方法
- **WHEN** 类写 `@Path("orders")`，其 private 方法写 `@GET`
- **THEN** 不生成端点，计入「非 public」，不记缺口

#### Scenario: 远端服务的客户端接口
- **WHEN** 接口写 `@RegisterRestClient`（经 `org.eclipse.microprofile.rest.client.inject` 的单类型导入确认）与 `@Path("/library")`，方法写 `@GET`
- **THEN** 不生成端点，计入「客户端声明」，不记缺口

#### Scenario: 嵌套类型里的路由
- **WHEN** 顶层类的静态嵌套类里，一个方法写 `@GET`
- **THEN** 不生成端点，计入「嵌套」，记 `route-handler-unresolved` 缺口

#### Scenario: 同名的自定义注解不是路由注解
- **WHEN** 仓库声明注解类型 `com.acme.rest.GET`，某文件单类型导入它并写在方法上
- **THEN** 该注解不是路由注解，也不计入未确认

#### Scenario: 无法确认的注解
- **WHEN** 文件同时写 `import javax.ws.rs.*;` 与 `import jakarta.ws.rs.*;`，方法写 `@GET`
- **THEN** `GET` 无法确认，计入按写法的未确认计数；只凭它不构成路由点

#### Scenario: 目录格式错误
- **WHEN** 路由目录的某个族多出一个未知键
- **THEN** 加载失败，事实构建不带着部分目录运行

#### Scenario: 守恒不平衡时构建失败
- **WHEN** 解析结果的九个桶之和不等于路由点数
- **THEN** 事实构建失败并报出不平衡的族

#### Scenario: 阶段未运行
- **WHEN** 事实构建没有路由目录输入
- **THEN** `coverage.routes` 的状态为 `not-run`，图里没有 Java 文件里的端点节点

### Requirement: routes 边的证据与遍历

`routes` 边 SHALL 带 `provenance: "extracted"`。

每条边的证据 SHALL 包括：
- HTTP 方法注解所在的行；
- 写了方法路径注解时，它所在的行；
- 类上根路径注解所在的行。

每条证据带 `token`，即该行上注解的写法（如 `GET`、`javax.ws.rs.GET`、`Path`），并标明角色：动词、方法路径或根路径。路径证据另记读到的值。同一条边的证据按文件、行与角色排序去重。

图校验 SHALL 按证据自身的 `token` 核对：
- `routes` 证据的行包含它的 `token`；
- 带 `token` 的 `contains` 证据的行包含它的 `token`；
- 不带 `token` 的 `contains` 证据，校验规则不变。

与其它边类型相同，一条边只要有一条证据的行含它的 `token`，图校验就确认这条边。

`routes` SHALL 属于可遍历的确定性边类型：
- 从处理方法沿入边可以找到端点；
- 从端点沿出边可以找到处理方法。

#### Scenario: 证据可复核
- **WHEN** 读 `routes` 边每条证据的文件与行
- **THEN** 该行含证据里的 `token`；动词证据的 `token` 是一个已确认的 HTTP 方法注解的写法，路径证据记下的值等于该注解读到的字面量

#### Scenario: 从处理方法遍历到端点
- **WHEN** 从 `OrderResource.find` 的方法节点做 1 跳入边遍历
- **THEN** 结果包含经 `routes` 到达的端点 `GET /orders/{id}`

#### Scenario: 证据行不含 token 时校验报出
- **WHEN** 一条 `routes` 边的每条证据，行号都被改成不含各自 `token` 的行
- **THEN** 图校验对这条边报出证据不符

#### Scenario: 端点的 contains 证据可复核
- **WHEN** 对文件到端点 `GET /orders/{id}` 的 `contains` 边做图校验
- **THEN** 证据行含 HTTP 方法注解的写法 `GET`，校验通过；该行号被改成不含 `GET` 的行时，校验报出证据不符

### Requirement: Java 按类型注入点

系统 SHALL 按「按类型注入目录」，从 Java 类型成员上的注解读出按类型的注入点，为每个注入点求出候选集：恰好一个候选时生成一条 `injects` 边，否则落入一个可见桶。

输入来自 Core 的 Java 抽取：
- 成员上的注解，含所附成员的声明类型：字段的类型、方法的返回类型；
- 顶层类型：种类、修饰符、父类型、字段类型、类型上的注解；
- 顶层以下的类型声明（成员类型、局部类型、匿名类），各带所在的顶层类型、修饰符与父类型。匿名类的父类型是 `new` 后面写的类型；
- 方法与构造器：参数类型与返回类型；
- 每个类字面量，以及它写在注解参数里还是代码里；
- 注解参数里的类字面量，归属到所在的参数。

目录是数据，不是代码分支。目录声明：
- 注入族，每个族声明：
  - id 与一句依据说明；
  - 注入注解的全限定名；
  - 可附着的成员种类：字段、方法、构造器；
  - 是否读限定符；
  - 方法上的注解是否要求方法恰好一个参数；
  - 表示按名字注入的参数键、表示按 JNDI 名注入的参数键；
  - 表示按名字注入的另一个注解：注入点上写了它时，由「Java 注解注入点」按名字解析；
  - 改写注入类型的参数键，可为空；
- 名字限定符注解，以及带缺省名的构造型注解；
- 生产者注解；
- 提供者类型：类型参数就是它提供的类型；
- 让 bean 资格取决于部署的注解；
- 注入点上已知不是限定符的注解；
- 声明业务接口的注解（见「EJB 注解声明的业务接口」）。

目录出现未知键、缺少字段或类型不符时，加载 MUST 失败，不得带着部分目录运行。

注解的身份 SHALL 按「名字绑定」的 Java 作用域规则确认。写法与目录中某个注入注解的简单名相同、却没有确认的，SHALL 按写法计数，不是注入点。

注入点：
- 字段上的注入注解：一个注入点，类型为字段的声明类型；
- 方法或构造器上的注入注解：每个参数一个注入点，类型为参数的声明类型；
- 族声明了改写类型的参数、且写了它时，注入类型为该参数里的类字面量；
- 在下面第 1–5 个桶落定的方法或构造器注解，计一个注入点。

注入类型记为 T。候选集 SHALL 是仓库里所有可能满足 T 的声明，按擦除后的类型比较：
- 顶层的非抽象类与 `record`，等于 T 或传递地以 T 为父类型。父类型包括 Java 的 `extends`、`implements`，以及业务接口注解声明的仓库接口；
- 带生产者注解的顶层类型方法与字段：返回类型或字段类型等于 T，或是 T 的子类型；
- 顶层的非抽象类与 `record`：它自己或它的某个仓库祖先写出的父类型是目录里的提供者类型，其类型参数等于 T 或是 T 的子类型。

接口、注解类型、`enum` 与带 `abstract` 修饰符的类 MUST NOT 是候选：容器不实例化它们。枚举常量只能经生产者或程序化绑定提供，这两种另有规则。

只对读限定符的族，注入点上写了名字限定符时：
- 名字取字面量值；没写值或为空串时，字段取字段名，参数无法确定名字；
- 候选只保留 bean 名字等于该名字的：
  - 类：名字来自它的名字限定符注解，未写值时为简单名首字母小写；带缺省名的构造型时同样取缺省名；
  - 生产者方法：名字来自它的名字限定符，未写值时，`get` 或 `is` 开头的方法取 Java Beans 属性名，其它取方法名；
  - 生产者字段：未写值时取字段名；
  - 没有名字限定符、也没有带缺省名的构造型的类与生产者没有名字，被筛掉；
- 候选的名字限定符值不是字面量时，该候选保留；提供者类的 bean 名字无从得知，同样保留。

每个注入点 SHALL 按以下顺序恰好落入一个桶：

1. 写了表示按名字注入的参数且值不是空串，或注入点上有族列出的按名字注入注解且它写了不是空串的值（非字面量也算）：**按名字**，由「Java 注解注入点」解析，不算缺口。空串与不写相同；按名字注入注解没写值时不在此落桶，按其它注解进第 9 个桶；
2. 写了表示 JNDI 名的参数且值不是空串：**JNDI 名**；
3. 成员种类不在族的声明里，或族要求方法恰好一个参数（setter 注入）而方法不是：**位置不读**，不算缺口；
4. 成员在嵌套、局部或匿名类型里：**嵌套**；
5. 以下任一成立：**成员未建索引**：
   - 字段没有声明类型；
   - 所在顶层类型里，找不到名字与名字所在行都对应的方法或构造器声明；
   - 消费者顶层类型没有节点；
6. T 在仓库外、是基本类型或数组：**仓库外类型**，不算缺口；
7. T 是作用域里的类型变量：**类型变量**；
8. 以下任一成立：**类型无法确定**：
   - T 无法解析；
   - T 是嵌套类型；
   - T 的全限定名在仓库里声明了不止一次；
   - 改写类型的参数不是恰好一个类字面量；
9. 读限定符的族，注入点上有以下注解以外的注解，或名字限定符无法确定名字：**限定符未解**。不计的注解：
   - 注入注解；
   - 名字限定符；
   - 目录列为已知不是限定符的注解；
10. 候选集可能不完整：**隐藏候选**。以下任一成立即是：
    - 某个嵌套、局部或匿名类型的父类型等于 T 或是 T 的子类型；
    - 某个嵌套类型里的生产者，返回类型或字段类型等于 T 或是 T 的子类型；
    - 某个嵌套类型的父类型是提供者类型，类型参数等于 T 或是 T 的子类型；
    - 某个声明有解析不出的父类型（包括业务接口注解写的类型），其最后一段简单名等于 T 或 T 的某个仓库子类型的简单名；
    - 生产者的返回类型或字段类型解析不出，简单名同样相等；
    - 某个类经祖先成为提供者，而祖先写出的提供类型是类型变量：该类与它的祖先写出的父类型里，有类型参数的简单名同样相等；
    - 仓库里有 Kotlin 或 Scala 源文件声明了类型，且 T 不是 `final` 类：这些类型的父类型没有抽取，可能实现或继承 T；
11. T 是接口或抽象类，且仓库代码里以类字面量写出了 T，注解参数里的不算：**动态提供**；
12. 没有候选：**无候选**；
13. 两个或更多候选：**歧义**；
14. 唯一候选带有让 bean 资格取决于部署的注解：**部署决定**；
15. 唯一候选没有可指的节点（生产者字段、提供者类，或没有节点的声明）：**目标非节点**；
16. 其余：**成边**。

成边的注入点 SHALL 生成从消费者顶层类节点指向唯一候选节点的 `injects` 边：
- 候选是类时，指向它的类节点；
- 候选是生产者方法时，指向它的方法节点。

缺口：

| 缺口 | 对应的桶 |
|---|---|
| `type-injection-point-unresolved` | JNDI 名、嵌套、成员未建索引 |
| `type-injection-type-unresolved` | 类型变量、类型无法确定 |
| `type-injection-candidates-unresolved` | 限定符未解、隐藏候选、动态提供、部署决定、目标非节点 |
| `type-injection-unbound` | 无候选 |
| `type-injection-ambiguous` | 歧义 |

样例 SHALL 写出注入点的文件、行、消费者与成员名。歧义的样例列出候选。

为了成边，MUST NOT 放宽规则：
- 不只按简单名比较类型；
- 不在几个候选里取第一个；
- 不忽略落「限定符未解」的注解；
- 不把抽象类、接口或 `enum` 当候选。

`coverage.typeInjections` SHALL 给出：
- 运行状态；
- 每个族的注解数、注入点数、十六个桶的计数与边数；
- 未确认注解按写法的计数；
- 「限定符未解」按注解写法的计数；
- 业务接口一段（见「EJB 注解声明的业务接口」）。

守恒 SHALL 成立，不成立时构建 MUST 失败：
- 每个族十六个桶之和等于注入点数；
- 每个族成边的注入点数，等于该族证据里「注入」角色的条目数；
- 每类缺口的计数等于对应桶之和。

#### Scenario: 唯一实现成边
- **WHEN** 类 `com.acme.OrderController` 的字段写 `@Inject private OrderService service;`，接口 `com.acme.OrderService` 在仓库里只有一个实现 `com.acme.OrderServiceImpl`
- **THEN** 生成 `com.acme.OrderController` → `com.acme.OrderServiceImpl` 的 `injects` 边

#### Scenario: 间接实现也是候选
- **WHEN** 接口 `OrderService` 由 `BaseOrderService` 实现，`PremiumOrderService` 继承了 `BaseOrderService`，两者都不是抽象类
- **THEN** 字段 `@Inject OrderService service` 有两个候选，不生成边；落「歧义」，记 `type-injection-ambiguous`，样例列出两个候选

#### Scenario: 抽象类不是候选
- **WHEN** 接口 `OrderService` 由 `abstract class AbstractOrderService` 实现，`DefaultOrderService` 继承它
- **THEN** 字段 `@Inject OrderService service` 的唯一候选是 `DefaultOrderService`，生成到它的 `injects` 边

#### Scenario: 不带名字的 EJB 注入具体类
- **WHEN** 字段写 `@EJB private InvoiceBean invoices;`，`com.acme.InvoiceBean` 是没有子类的具体类
- **THEN** 生成声明该字段的类 → `com.acme.InvoiceBean` 的 `injects` 边

#### Scenario: 构造器的每个参数是一个注入点
- **WHEN** 构造器写 `@Inject OrderController(OrderService service, AuditLog log)`，两个类型在仓库里各只有一个候选
- **THEN** 生成两条 `injects` 边，注入点数计 2

#### Scenario: 生产者方法是候选
- **WHEN** 仓库里只有 `@Produces OrderRepository repository()` 能提供 `OrderRepository`
- **THEN** 字段 `@Inject OrderRepository repo` 生成指向该生产者方法节点的 `injects` 边

#### Scenario: 生产者与实现类同时存在
- **WHEN** `OrderRepository` 既有非抽象实现类 `JpaOrderRepository`，又有一个返回 `OrderRepository` 的生产者方法
- **THEN** 字段 `@Inject OrderRepository repo` 有两个候选，落「歧义」

#### Scenario: 名字限定符筛出唯一候选
- **WHEN** `PaymentService` 有两个实现，其中只有 `FastPayment` 带 `@Named("fast")`，字段写 `@Inject @Named("fast") PaymentService payment;`
- **THEN** 生成到 `FastPayment` 的 `injects` 边，证据含 `@Named` 所在行

#### Scenario: 未知限定符
- **WHEN** 字段写 `@Inject @RestClient PaymentService payment;`，`RestClient` 是仓库外的注解，目录没有把它列为已知不是限定符
- **THEN** 不生成边；落「限定符未解」，记 `type-injection-candidates-unresolved`，覆盖按写法给 `RestClient` 计 1

#### Scenario: EJB 族不读限定符
- **WHEN** 字段写 `@EJB @Deprecated private InvoiceBean invoices;`，`InvoiceBean` 只有一个候选
- **THEN** 生成 `injects` 边，`@Deprecated` 不影响解析

#### Scenario: 嵌套类型里的实现阻断成边
- **WHEN** `OrderService` 只有一个顶层实现 `OrderServiceImpl`，另一个顶层类里有静态嵌套类 `Mock implements OrderService`
- **THEN** 字段 `@Inject OrderService service` 不生成边；落「隐藏候选」

#### Scenario: 匿名类阻断成边
- **WHEN** `OrderService` 只有一个顶层实现，另一处代码写 `new OrderService() { ... }`
- **THEN** 字段 `@Inject OrderService service` 不生成边；落「隐藏候选」

#### Scenario: 代码里的类字面量阻断成边
- **WHEN** 接口 `OrderService` 只有一个实现，某个模块写 `bind(OrderService.class)`
- **THEN** 字段 `@Inject OrderService service` 不生成边；落「动态提供」

#### Scenario: 业务接口注解里的类字面量不阻断
- **WHEN** 接口 `OrderService` 的类字面量只出现在 `@Local(OrderService.class)` 里
- **THEN** 不因此落「动态提供」

#### Scenario: 唯一候选的资格取决于部署
- **WHEN** `OrderService` 唯一的实现带 `@Alternative`
- **THEN** 不生成边；落「部署决定」

#### Scenario: 仓库外的类型
- **WHEN** 字段写 `@Inject EntityManager em;`
- **THEN** 不生成边、不记缺口；落「仓库外类型」

#### Scenario: 带 beanName 的 EJB 不在此解析
- **WHEN** 字段写 `@EJB(beanName = "OrderBean") private Orders orders;`
- **THEN** 本阶段不生成边、不记缺口；落「按名字」

#### Scenario: 与 Spring Qualifier 同用
- **WHEN** 字段写 `@Inject @Qualifier("orderDao") private OrderDao dao;`，`Qualifier` 是 Spring 的注解
- **THEN** 本阶段不生成边、不记缺口；落「按名字」，不计入「限定符未解」

#### Scenario: JNDI 名
- **WHEN** 字段写 `@EJB(lookup = "java:global/app/OrderBean") private Orders orders;`
- **THEN** 不生成边；落「JNDI 名」，记 `type-injection-point-unresolved`

#### Scenario: 类型变量
- **WHEN** 泛型类 `Repository<T>` 的字段写 `@Inject private T delegate;`
- **THEN** 不生成边；落「类型变量」，记 `type-injection-type-unresolved`

#### Scenario: 同包同名的自定义注解不是注入点
- **WHEN** 仓库在类所在的包里声明了注解类型 `Inject`，字段写 `@Inject`，没有导入 `javax.inject.Inject`
- **THEN** 该注解不是注入点，不进任何桶

#### Scenario: 目录格式错误
- **WHEN** 按类型注入目录的某个族多出一个未知键
- **THEN** 加载失败，事实构建不带着部分目录运行

#### Scenario: 守恒不平衡时构建失败
- **WHEN** 解析结果某个族十六个桶之和不等于注入点数
- **THEN** 事实构建失败并报出不平衡的族

#### Scenario: 阶段未运行
- **WHEN** 事实构建没有按类型注入目录输入
- **THEN** `coverage.typeInjections` 的状态为 `not-run`，图里没有本阶段的边

### Requirement: EJB 注解声明的业务接口

系统 SHALL 读顶层类上经确认的业务接口注解（`@Local`、`@Remote` 等，由目录列出）。值参数里的每个类字面量是一个声明，SHALL 恰好落入一个桶：

1. 注解没写值参数：**未列类型**，按注解计一次，不算缺口；
2. 写了值参数，但其中没有类字面量：**不可读**，按注解计一次；
3. 类型在仓库外：**仓库外类型**，不算缺口；
4. 类型无法解析：**类型无法确定**；
5. 类型是仓库里的类、不是接口：**不是接口**，不算缺口；
6. 该类经 Java 的父类型已传递到达该接口：**已是父类型**，不算缺口；
7. 该类或该接口没有节点：**类未建索引**；
8. 其余：**声明**。

落「声明」的 SHALL 生成从该类指向该接口的 `implements` 边，`provenance: "extracted"`。证据为类字面量所在行，`token` 为写出的类型。

落「已是父类型」「类未建索引」与「声明」的接口，在「Java 按类型注入点」里 SHALL 算作该类的父类型。

MUST NOT 为业务接口生成方法级的 `implements` 边。

缺口 `business-interface-unresolved` 对应「不可读」「类型无法确定」与「类未建索引」。

`coverage.typeInjections.businessInterfaces` SHALL 给出注解数、声明数、八个桶的计数与边数。守恒：八个桶之和 SHALL 等于声明数，「声明」的数目 SHALL 等于本段生成的 `implements` 边数，不成立时构建 MUST 失败。

#### Scenario: 不写 implements 的业务接口
- **WHEN** 类 `com.acme.OrderBean` 带 `@Stateless @Local(OrderService.class)`，没有 `implements OrderService`，仓库里没有别的类实现 `OrderService`
- **THEN** 生成 `com.acme.OrderBean` → `com.acme.OrderService` 的 `implements` 边，证据行为类字面量所在行；字段 `@EJB OrderService orders` 生成到 `com.acme.OrderBean` 的 `injects` 边

#### Scenario: 已经实现的接口
- **WHEN** 类写 `@Local(OrderService.class) public class OrderBean implements OrderService`
- **THEN** 不生成新的 `implements` 边，落「已是父类型」

#### Scenario: 常量作参数
- **WHEN** 类写 `@Local(Interfaces.LOCAL)`
- **THEN** 不生成边；落「不可读」，记 `business-interface-unresolved`

#### Scenario: 业务接口在仓库外
- **WHEN** 类写 `@Remote(javax.management.MBeanServer.class)`
- **THEN** 不生成边、不记缺口；落「仓库外类型」

### Requirement: Java 方法引用作为调用点

Java 抽取器 SHALL 把方法引用表达式记录为调用点：`X::m`、`expr::m`、`this::m`、`super::m` 的被调用者为 `m`，`X::new` 为对 `X` 的构造调用；接收者描述与普通调用相同；实参个数记为未知（`argCount: null`）。事实图解析这类调用点时 SHALL 按名字在接收者类型层次中查找，参数个数未知视为适用任意个数：恰好一个声明成边，多个记 `calls-ambiguous`；数组类型的构造引用记 `calls-external`。这类调用点 SHALL 计入调用点总数并参与守恒。

#### Scenario: 类型限定的方法引用成边
- **WHEN** 源码出现 `PlatformCache::isEhcacheEnabled`，`PlatformCache` 是仓库内类且只声明了一个 `isEhcacheEnabled`
- **THEN** 生成从所在方法指向 `PlatformCache#isEhcacheEnabled()` 的 `calls` 边，证据为该行

#### Scenario: 重载的方法引用记歧义
- **WHEN** `Mapper::toData` 的 `toData` 在 `Mapper` 中有两个重载
- **THEN** 该调用点记入 `calls-ambiguous`，不生成边

#### Scenario: 构造器引用
- **WHEN** 源码出现 `LoanData::new`，`LoanData` 在仓库内且只声明了一个构造器
- **THEN** 生成指向该构造器的 `calls` 边；`int[]::new` 记入 `calls-external`

### Requirement: Java 方法体之外的调用点

Java 抽取器 SHALL 记录方法与构造器体之外的调用点——方法调用、方法引用与对象创建——包括字段初始化（含其中的 lambda）、静态与实例初始化块、枚举常量实参与 record 紧凑构造器体。这类调用点的调用者 SHALL 记为不可能是 Java 标识符的哨兵：静态上下文（`static` 字段、接口与注解类型的字段、静态初始化块、枚举常量实参）为 `<clinit>`，实例上下文为 `<init>`。哨兵 MUST NOT 匹配任何声明，这类调用点 SHALL 落入 `calls-caller-unresolved` 并计入守恒。已在方法体内的调用点（含字段初始化里匿名类的方法）保持原调用者。

#### Scenario: 静态字段初始化里的方法引用
- **WHEN** 顶层类 `CleanerUtil` 声明 `private static final BufferCleaner CLEANER = CleanerUtil::unmapHackImpl;`，`unmapHackImpl` 只在这里被引用
- **THEN** 该方法引用记为调用者 `<clinit>` 的调用点，落入 `calls-caller-unresolved`，不生成 `calls` 边

#### Scenario: 实例初始化与紧凑构造器
- **WHEN** 实例字段初始化 `private final List<X> xs = new ArrayList<>();` 与 record 紧凑构造器体里的 `validate(a)`
- **THEN** 两处都记为调用者 `<init>` 的调用点，计入 Java 调用点总数与守恒

### Requirement: Java 方法声明的修饰符、注解与类字面量

Java 抽取器 SHALL 为每个函数条目输出 `visibility`（`public` / `protected` / `package` / `private`；接口成员默认 `public`）、`modifiers`（`static`、`final`、`native`、`default`、`synchronized` 等关键字，源码顺序）与 `annotations`（方法注解名，源码顺序，去掉 `@` 与包前缀）。Java 抽取器 SHALL 为每个文件输出 `classLiterals`：文件里每个类字面量 `X.class` 的类型文本、行号与上下文（`annotation`：位于注解实参内；`code`：其它位置）。结构结果 SHALL 校验并透传这些字段。这些字段 MUST NOT 进入节点身份，非 Java 语言的结构结果 SHALL 保持不变。

#### Scenario: 带注解的公开方法
- **WHEN** 抽取 `@GET @Path("/x") public Response list()`
- **THEN** 函数条目带 `visibility: "public"`、`annotations: ["GET", "Path"]`；节点 ID 与本变更之前相同

#### Scenario: 包私有静态方法
- **WHEN** 抽取 `static void helper()`
- **THEN** 函数条目带 `visibility: "package"`、`modifiers: ["static"]`

#### Scenario: 注解实参里的类字面量
- **WHEN** 抽取 `@Mapper(uses = Helper.class) public interface LoanMapper {}` 与方法体里的 `LoggerFactory.getLogger(LoanMapper.class)`
- **THEN** 文件条目的 `classLiterals` 含 `{ type: "Helper", context: "annotation" }` 与 `{ type: "LoanMapper", context: "code" }`，各带行号

### Requirement: Java 具体方法覆写边

系统 SHALL 为仓库内的具体方法 M（含接口的 `default` 方法）生成指向它覆写的仓库内祖先类型中具体方法 A（同名、擦除后参数类型相同、A 非 `private` 非 `static`，包访问的 A 只与同包的 M 配对，含接口 `default` 方法）的 `overrides` 边，每条父类型路径上取离 M 最近的祖先声明。对每个类、枚举或 record 类型 C（含抽象类），其仓库内接口祖先的每个 `default` 方法 A，若 C 自身没有声明同名同参数个数的方法，SHALL 以 C 的父类链中最近的同名同参数个数具体类方法 M 为继承来的覆写（类优先于接口 `default`）：擦除签名相同即生成 `M → A` 的 `overrides` 边，证据为 C 引入 A 的那条父类型声明行；父类链中擦除签名相同的抽象重声明使 A 不被继承，不生成边。同名、同参数个数但任一方擦除签名不能确定的配对 MUST NOT 生成边，SHALL 记入 `override-uncertain` 缺口。边 SHALL 带 M 的声明行证据，SHALL 作为确定性事实边参与遍历。祖先在仓库外时 MUST NOT 生成边。

#### Scenario: 子类覆写父类的具体方法
- **WHEN** `Base` 声明具体方法 `fallback(Long, String)`，`Sub extends Base` 也声明了具体的 `fallback(Long, String)`
- **THEN** 生成 `Sub#fallback(Long,String)` 到 `Base#fallback(Long,String)` 的 `overrides` 边

#### Scenario: 类方法覆写接口 default 方法
- **WHEN** 接口 `I` 声明 `default void m()`，`class C implements I` 声明了具体的 `m()`
- **THEN** 生成 `C#m()` 到 `I#m()` 的 `overrides` 边

#### Scenario: 经父类型的调用可遍历到覆写
- **WHEN** 从调用 `Base#fallback(Long,String)` 的方法出发做有界遍历
- **THEN** 遍历经 `calls` 与 `overrides` 边到达 `Sub#fallback(Long,String)`

#### Scenario: 继承来的覆写（类优先）
- **WHEN** `class C extends B implements J {}`，`B` 声明具体方法 `m()`，`J` 声明 `default void m()`，`C` 自身不声明 `m()`
- **THEN** 生成 `B#m()` 到 `J#m()` 的 `overrides` 边，证据为 `C` 声明 `implements J` 的那一行；从调用 `J#m()` 的方法出发的遍历经 `calls` 与 `overrides` 到达 `B#m()`

#### Scenario: 参数类型为嵌套类型的覆写记缺口
- **WHEN** `Base` 声明 `handle(Outer.Event)`，`Sub extends Base` 声明 `handle(Outer.Event)`，`Outer.Event` 是解析器不读的成员类型
- **THEN** 不生成 `overrides` 边，记入 `override-uncertain` 缺口

### Requirement: TS/JS JSX 元素引用生成 calls 边

TS/JS 抽取器 SHALL 在用 tsx 或 javascript 语法解析的文件里，记录每个 JSX 开标签与自闭合标签写下的标签名与行号；闭合标签与片段 `<>` MUST NOT 计入。
- 标签名是小写开头的标识符、含 `-` 的标识符、或带命名空间的名字（`svg:rect`）时，该元素是内建元素，SHALL 只计入内建元素数，MUST NOT 产生边或 gap。
- 成员表达式标签（`<UI.Button>`）从不是内建元素。
- 标签的根名字被外层函数的参数、局部变量、局部函数或类、`catch` 参数、`for…in/of` 变量绑定时，抽取器 SHALL 标记该元素为局部绑定。绑定按函数作用域收集，偏向多标（多标只会把元素推进 gap，不会生成错边）。

事实图 SHALL 按以下顺序解析每个非内建元素的根名字：
1. 局部绑定的元素，以及语法从错误中恢复出的标签（javascript 语法把 `<this.Foo/>` 读成 `<Foo/>`，名字不是源码写的），落进 `jsx-unbound`；
2. 本文件 import 的绑定（具名、默认、命名空间）：说明符没有解析到仓库文件时，import map 列为外部的落进 `jsx-external`，其余落进 `jsx-target-unresolved`；解析到文件时，在该文件的导出里找导入名；
3. 本文件顶层声明的函数或类；
4. 都没有，落进 `jsx-unbound`。

在文件导出里找名字时 SHALL 先跟显式转发（`export { A as B } from`），再找本地导出（`default` 匹配默认导出，其它名字匹配非默认的同名导出；按本地声明名在本文件的作用域里解析：是本文件 import 的绑定时沿该 import 继续，是顶层函数或类时定位该节点），最后跟 `export * from`（默认导出不经 `export *` 转发）。转发链按已访问集合截断环路，MUST NOT 设深度上限。`export *` 给出多个不同目标时落进 `jsx-ambiguous`；没有找到且某个 `export *` 指向仓库外时落进 `jsx-external`；其余没有找到的落进 `jsx-target-unresolved`。

成员表达式标签的后续段 SHALL 只在命名空间（`import * as`、`export * as`）上继续解析；落在函数或类之后还有段（值的属性）、或整个标签只是命名空间时，落进 `jsx-target-unresolved`。解析出多个候选声明时落进 `jsx-ambiguous`。

目标唯一时，调用者 SHALL 是本文件行范围包含该元素的函数节点；恰好一个时生成从调用者指向目标的 `calls` 边，provenance 为 `extracted`，证据带标签名原文 `token`；没有或多于一个时落进 `jsx-caller-unresolved`。一个元素 MUST 恰好落进一处：边或五个 `jsx-*` gap 之一。

`coverage.jsxElements` SHALL 记录文件数、内建元素数、调用点数与各去向计数；import map 没有提供 `resolvedSources` 时记为 `not-run`。同一调用者对同一目标的多个元素合成一条边，证据取第一个调用点；该对已有 `calls` 边时沿用已有的边；计数仍按调用点。构建 SHALL 校验调用点数 = 成边的调用点数 + 各 gap 数，且各 gap 数与 gaps 里同种类的计数一致，不成立时以非零状态退出。

#### Scenario: 自闭合元素经具名 import 成边
- **GIVEN** `page.tsx` 的函数 `Page` 里写着 `<Button />`，文件顶部 `import { Button } from './button'`，`button.tsx` 导出函数 `Button`
- **WHEN** 构建事实图
- **THEN** 生成 `Page → Button` 的 `calls` 边，证据行是 `<Button />` 所在行，`token` 为 `Button`

#### Scenario: 默认导入换了本地名
- **GIVEN** `import Btn from './button'`，`button.tsx` 写着 `export default function Button`
- **WHEN** 构建事实图
- **THEN** `<Btn>` 生成指向 `Button` 的 `calls` 边，`token` 为 `Btn`

#### Scenario: 成员表达式经命名空间导入
- **GIVEN** `import * as UI from './ui'`，`ui.tsx` 导出函数 `Panel`
- **WHEN** 构建事实图
- **THEN** `<UI.Panel>` 生成指向 `Panel` 的 `calls` 边；`<UI.Missing>` 落进 `jsx-target-unresolved`

#### Scenario: 经转发桶文件
- **GIVEN** `index.ts` 写着 `export { Button } from './button'` 与 `export * from './card'`，页面从 `./index` 导入 `Button` 与 `Card`
- **WHEN** 构建事实图
- **THEN** 两个元素各自生成指向声明文件里组件的 `calls` 边，`index.ts` 获得指向两个被转发文件的 `imports` 边

#### Scenario: 内建元素不成边
- **WHEN** 函数里只有 `<div>`、`<my-element>`、`<svg:rect>`
- **THEN** 不生成边也不生成 gap，`coverage.jsxElements.intrinsic` 计入三个

#### Scenario: 被参数遮蔽的标签
- **GIVEN** 文件 import 了 `Icon`，函数 `Row({ Icon })` 里写着 `<Icon />`
- **WHEN** 构建事实图
- **THEN** 该元素落进 `jsx-unbound`，不生成指向导入的 `Icon` 的边

#### Scenario: 第三方组件
- **WHEN** 元素的根名字从 import map 列为外部的说明符（如包名）导入
- **THEN** 该元素落进 `jsx-external`，不生成边

#### Scenario: 顶层的元素没有调用者
- **WHEN** 元素写在模块顶层（例如 `const routes = [<Home />]`）
- **THEN** 目标可以解析，但没有包含它的函数节点，该元素落进 `jsx-caller-unresolved`

#### Scenario: 守恒被破坏
- **WHEN** 各去向计数之和不等于调用点数，或与 gaps 里的计数不一致
- **THEN** 构建以非零状态退出，不写图

### Requirement: TS/JS 的 import 绑定、转发与本地导出名

TS/JS 抽取器 SHALL 为每个 import 条目记录 `bindings`：本地名到导入名的对应，导入名是导出名、`default` 或 `*`（命名空间）。`export … from 'S'` 与 `export * from 'S'` SHALL 同时记为来源 `S` 的 import 条目，带 `reexports`（导出名到导入名，`export *` 记为 `*` 到 `*`，`export * as NS` 记为 `NS` 到 `*`），import map 因此为它们解析目标、桶文件获得 `imports` 边。导出条目的导出名与本地声明名不同时（`export { X as Y }`、`export default class X`、`export default X;`）SHALL 记录 `local`；事实图的 `exports` 边 SHALL 按 `local`（没有则按导出名）找声明。import map SHALL 为 TS/JS 文件输出每个解析成功的源说明符对应的仓库文件（`resolvedSources`）。

这些字段都是可选的；没有它们的结构结果照旧有效。

#### Scenario: 默认导出标识符
- **WHEN** 文件写着 `function Home() {}` 与 `export default Home;`
- **THEN** 导出条目是 `{ name: 'default', isDefault: true, local: 'Home' }`，事实图生成从文件指向 `Home` 的 `exports` 边

#### Scenario: 改名导出
- **WHEN** 文件写着 `export { Inner as Outer }`
- **THEN** 导出条目带 `local: 'Inner'`，`exports` 边指向 `Inner` 的节点

### Requirement: 非 Java 调用的作用域不含只经转发到达的文件

TS/JS 抽取器 SHALL 让每个 `export … from 'S'` 条目都带 `reexports`；转发名单为空时（`export {} from 'S'`）为空数组。这样转发条目与副作用导入 `import 'S'` 可以区分。

import map SHALL 为每个文件输出 `reexportOnly`：只经转发条目到达、没有经 import 语句、`require()` 或其它抽取路径到达的已解析目标，按路径排序；没有这种目标的文件不写这个键。`importMap` SHALL 照旧列出这些目标，`imports` 边照旧生成。

Fact Builder 为 Java 与 TS/JS 以外的文件解析调用时，被调者的作用域 SHALL 是本文件，加 `importMap` 中不在该文件 `reexportOnly` 里的目标。转发不在本文件引入名字，只经转发到达的文件里的声明 MUST NOT 成为本文件调用的候选。import map 没有 `reexportOnly` 时，作用域为本文件加全部 `importMap` 目标。TS/JS 文件的调用按「TS/JS 调用按本文件的绑定解析被调者」解析，转发同样不引入候选。

#### Scenario: 对参数的调用不连到被转发的模块
- **WHEN** 文件写着 `export { createLogger } from './logger'` 与 `function run(log) { log() }`，`logger.ts` 声明了 `log`，文件没有别的路径到达 `logger.ts`
- **THEN** `log()` 不生成 `calls` 边，记入 `calls-unresolved`；文件到 `logger.ts` 的 `imports` 边照旧生成

#### Scenario: 转发不制造歧义
- **WHEN** 文件从 `./util` 导入 `log` 并调用它，同时转发 `./logger`，`util.ts` 与 `logger.ts` 都声明了 `log`
- **THEN** 调用生成指向 `util.ts` 的 `log` 的 `calls` 边，不记入 `calls-ambiguous`

#### Scenario: 同一模块还经 require 到达
- **WHEN** 文件既转发 `./logger`，又写着 `const { log } = require('./logger')`
- **THEN** `logger.ts` 不在 `reexportOnly` 里

#### Scenario: 空转发
- **WHEN** 文件写着 `export {} from './logger'`
- **THEN** 该条目带 `reexports: []`，`logger.ts` 列在该文件的 `reexportOnly` 里，不进调用作用域

### Requirement: TS/JS 调用按本文件的绑定解析被调者

TS/JS 抽取器 SHALL 为根名字被外层函数绑定的调用点标 `local: true`。根名字是被调表达式本身的标识符，或成员表达式最左端的标识符；绑定包括参数、解构出的名字、局部变量、局部函数或类、`catch` 参数与 `for…in/of` 变量，按函数作用域收集，块级名字算整个函数（偏向多标）。结构结果 SHALL 保留这个标记。

Fact Builder 为语言是 `typescript` 或 `javascript` 的文件解析调用时，SHALL 只把被调者解析到本文件绑定的东西，按以下顺序：
1. 标了 `local` 的调用点，以及被调者不是用 `.` 连接的标识符的调用点，落进 `calls-unresolved`；
2. 根名字是本文件 import 的绑定（具名、默认、命名空间）时：说明符没有解析到仓库文件，落进 `calls-unresolved`；解析到文件时，按 JSX 元素引用的规则在该文件的导出里找导入名（显式转发、本地导出、`export *`）；
3. 否则找本文件的顶层函数或类；
4. 都没有，落进 `calls-unresolved`。

成员段 SHALL 只在命名空间上继续解析；落在函数、类或值之后还有段，或被调者只是命名空间时，落进 `calls-unresolved`。解析出恰好一个声明时，调用方按原规则确定后生成 `calls` 边；解析出多个声明、或多个 `export *` 给出不同目标时，落进 `calls-ambiguous`。被导入模块里与被调者同名、但没有经绑定指向的声明 MUST NOT 成为候选。`require()` 绑定的名字不在 `bindings` 里，对它们的调用落进 `calls-unresolved`。

TS/JS 的 `calls-unresolved` 与 `calls-ambiguous` 缺口 SHALL 用写明上述去向的原因文本。Java 与其它语言的调用解析不受本要求影响。

#### Scenario: 对参数的调用不连到被导入模块的同名声明
- **WHEN** 文件写着 `import { createLogger } from './logger'` 与 `function run(log) { log(); createLogger() }`，`logger.ts` 声明并导出了 `log` 与 `createLogger`
- **THEN** `log()` 不生成 `calls` 边，记入 `calls-unresolved`；`createLogger()` 生成指向 `logger.ts` 的 `createLogger` 的边

#### Scenario: 没有导入的名字不经别的导入解析
- **WHEN** 文件写着 `export * from './a'` 与 `import { helper } from './b'`，`a.ts` 与 `b.ts` 都声明了 `log`，文件调用 `log()`
- **THEN** `log()` 记入 `calls-unresolved`，不生成指向 `b.ts` 的 `log` 的边

#### Scenario: 从包导入的名字
- **WHEN** 文件从 `date-fns` 导入 `format`，又从 `./fmt` 导入别的名字，`fmt.ts` 也声明了 `format`
- **THEN** `format()` 记入 `calls-unresolved`

#### Scenario: 被参数遮蔽的导入名
- **WHEN** 文件导入了 `log`，函数 `wrap(log)` 调用 `log()`，函数 `direct()` 也调用 `log()`
- **THEN** `wrap` 里的调用点带 `local: true`，记入 `calls-unresolved`；`direct` 里的调用生成指向被导入的 `log` 的边

#### Scenario: 改名导入、默认导入与命名空间
- **WHEN** 文件写着 `import { log as write } from './logger'`、`import make from './factory'`（`factory.ts` 写着 `export default function createThing`）与 `import * as util from './b'`，并调用 `write()`、`make()`、`util.helper()`、`util()`、`util.missing()`
- **THEN** 前三个分别生成指向 `logger.ts` 的 `log`、`createThing`、`b.ts` 的 `helper` 的边；`util()` 与 `util.missing()` 记入 `calls-unresolved`

#### Scenario: 经转发与歧义
- **WHEN** 文件从只写着 `export { log } from './logger'` 的桶文件导入 `log` 并调用它，另一个文件从写着 `export * from './a'` 与 `export * from './b'` 的文件导入 `log` 并调用它
- **THEN** 前者生成指向 `logger.ts` 的 `log` 的边；后者记入 `calls-ambiguous`

#### Scenario: CommonJS
- **WHEN** `.js` 文件写着 `const { log } = require('./logger')` 并调用 `log()`
- **THEN** 该调用记入 `calls-unresolved`，不生成边
