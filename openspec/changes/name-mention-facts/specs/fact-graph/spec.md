## ADDED Requirements

### Requirement: 非代码文件中的名称提及

系统 SHALL 对 source-manifest 中除代码语言以外的每个文件做词法扫描，范围包括 XML、JSP、Facelets、properties、YAML、shell，以及扩展名未在语言表声明的文本文件。代码语言是语言注册表中配置了 tree-sitter 语法的语言，由注册表派生，不另立清单。扫描只记录两类候选：类全限定名形态的 token，以及以 manifest 中出现过的扩展名结尾的路径形态 token。每个候选 SHALL 带原文件行号。XML / HTML / JSP / Facelets 的注释（`<!-- -->`、`<%-- --%>`）与 properties 的整行注释（`#`、`!`）中的文本 MUST NOT 产生候选。标记语言文件中的候选 SHALL 记录所在元素名，位于属性值内时还要记录属性名。扫描过的文件数 SHALL 按语言写入覆盖；扫描未运行时覆盖 SHALL 明示未运行，MUST NOT 与「扫描了但没有提及」混同。

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

类名候选 SHALL 先把 `$` 归一为 `.`，再对仓库内 Java 顶层类型的全限定名取最长前缀匹配，前缀至少两段。因此候选带成员、`.class` 后缀或嵌套类型名时，命中所在的顶层类型；嵌套类型不是节点。默认包里的类型（全限定名只有一段）不参与匹配。恰好命中一个仓库类型时，SHALL 生成一条从提及文件的 file 节点指向该类型 class 节点的 `mentions` 边。同一全限定名由多个仓库声明共有时 MUST NOT 生成边，SHALL 记入 `mention-ambiguous` 缺口，样例列出各候选。前缀不在字典中、却是仓库内存在但不是节点的声明时，SHALL 记入 `mention-target-unindexed` 缺口。这类声明包括 Kotlin / Scala 的类型和 Java 注解类型，按源文件的包路径与文件名判定。只有不命中任何仓库声明的候选才算仓库外，仓库外的类名不成边。

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

#### Scenario: 同名类型不猜
- **WHEN** 两个模块各自声明了 `com.acme.Config`，某 XML 提及 `com.acme.Config`
- **THEN** 不生成边，记入 `mention-ambiguous`，样例列出两个声明

### Requirement: 路径提及生成 mentions 边

路径候选 SHALL 先去掉 `classpath:`、`classpath*:`、`file:` 前缀与查询串、片段；含 URL scheme 或表达式定界符（`#{`、`${`）的 token 不是路径候选。解析 SHALL 依次尝试，取第一个有命中的规则：
1. 以 `/` 开头且提及文件位于某个 web 根之下时，相对该 web 根解析。web 根是包含 `WEB-INF/` 目录的最近祖先目录，提及文件自身在 `WEB-INF/` 下时同样适用。
2. 不以 `/` 开头时，相对提及文件所在目录解析。
3. 不以 `/` 开头、上一条无命中、且提及文件位于某个 web 根之下时，相对该 web 根解析（Servlet 规范中 `welcome-file`、`jsp-file` 这类值相对上下文根）。
4. 以上无命中或带 classpath 前缀时，去掉开头的 `/`、`./`、`../` 段，按路径段边界对 manifest 路径做后缀匹配。

恰好命中一个文件时，SHALL 生成提及文件到该文件的 `mentions` 边。带 `classpath*:` 前缀或含 `*` 通配、且至少含一个不带通配的目录段的候选是模式：每个命中都成边，并标为模式命中。含通配但没有这样的目录段的 token（如 `*.xhtml`、`**/*.xml`）不是路径候选：它们是 URL 映射或全局通配，不指向具体文件。非模式候选命中多个文件时 MUST NOT 生成边，SHALL 记入 `mention-ambiguous`；零命中 SHALL 记入 `path-mention-unresolved`。提及文件指向自身时不成边。

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
