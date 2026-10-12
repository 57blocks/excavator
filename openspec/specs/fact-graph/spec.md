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
