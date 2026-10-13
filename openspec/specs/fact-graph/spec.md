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

事实节点 SHALL 至少覆盖 file、function/method（包括 Java 接口方法与抽象方法）、class/interface 等抽取器可靠支持的声明，以及可确定性识别的配置/路由等非代码节点。事实边 SHALL 至少覆盖 `contains`、`exports`、`imports`、**能唯一解析目标**的 `calls`，以及能从声明确定的类型层次边 `inherits` / `implements`。不能唯一解析的引用 MUST NOT 猜测，SHALL 写入 gap。每条事实边 SHALL 保留 provenance 与源码证据。

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

系统 SHALL 为能解析到仓库内类型的 `extends` / `implements` 生成类到类的边：类继承类、接口继承接口为 `inherits`，类实现接口为 `implements`。系统 SHALL 为具体方法生成指向它所实现的仓库内抽象方法（接口方法或抽象方法，同名且擦除后的参数类型相同）的 `implements` 边。这些边 SHALL 带声明行证据，SHALL 作为确定性事实边参与遍历。父类型在仓库外时 MUST NOT 生成边。

#### Scenario: 类实现接口
- **WHEN** 仓库内类 `PaymentServiceImpl implements PaymentService`，并实现了 `pay(long)`
- **THEN** 生成 `PaymentServiceImpl` 到 `PaymentService` 的 `implements` 边，以及 `PaymentServiceImpl#pay(long)` 到 `PaymentService#pay(long)` 的 `implements` 边

#### Scenario: 经接口的调用可遍历到实现
- **WHEN** 从调用 `PaymentService#pay(long)` 的方法出发做有界遍历
- **THEN** 遍历经 `calls` 与 `implements` 边到达 `PaymentServiceImpl#pay(long)`

#### Scenario: 仓库外父类型不成边
- **WHEN** 仓库内接口继承了仓库外的接口（例如 Spring 的 `JpaRepository`）
- **THEN** 不为该父类型生成边

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
- 注解绑定器：注解全限定名、读名字的参数键、缺省名规则；
- 两种绑定器都声明点分名是否按命名空间解析；
- 表达式语言：分隔符、文件类别（含整篇作为模板文本扫描的扩展名）、隐式名字、声明局部名的属性（可限定元素及其命名空间，可声明属性值里表达式的根名为局部名）、可见命名空间及其条件；
- XML 注入族，见「XML 注入点」；
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
- 五类缺口回读的计数分别等于对应桶之和。

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
- **WHEN** 某个注入点没有落入任何桶，或某类缺口回读的计数与对应桶之和不等
- **THEN** 构建失败，不写出产物

### Requirement: injects 边的证据与遍历

`injects` 边 SHALL 带 `provenance: "extracted"`。每个成边的注入点一条证据，内容为：

- 注入点所在的 XML 文件与行；
- 名字（`token`）与注入点 id；
- 消费者元素所在行，以及消费者类经继承属性解析时经过的绑定处；
- 目标解析经过的全部绑定处：名字直接命中的绑定、别名所名的绑定与继承所名的绑定，每处给出文件、行与绑定器。

同一条边的证据按文件、行、名字与注入点 id 排序去重。图校验 SHALL 要求证据行包含 `token`。`injects` SHALL 属于可遍历的确定性边类型，可以从目标类沿入边找到被注入它的消费者类。

#### Scenario: 证据可复核
- **WHEN** 读 `injects` 边每条证据的文件与行
- **THEN** 该行含证据里的 `token`；证据里的每个绑定处所在行，含该绑定声明的名字，或是产生缺省名的注解

#### Scenario: 从被注入的类遍历到消费者
- **WHEN** 从 `com.acme.OrderDaoImpl` 的 class 节点做 1 跳入边遍历
- **THEN** 结果包含经 `injects` 到达的 `com.acme.OrderServiceImpl`

#### Scenario: 证据行不含名字时校验报出
- **WHEN** 一条 `injects` 边的证据行号被改成不含 `token` 的行
- **THEN** 图校验对这条边报出证据不符
