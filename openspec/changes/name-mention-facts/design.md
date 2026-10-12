## Context

- 扫描（`scan-project.mjs`）只跳过「无扩展名且文件名不在表内」的文件。`.xhtml`、`.jsp`、`.tag`、`faces-config.xml` 都进 source-manifest、有 file 节点、进检索索引，抽取时记 `no-extractor`（2026-10-12 在小型 JSF 探针上实跑核实）。缺的是边，不是可见性。
- 事实图由 `buildFactGraph({ scan, structureAll, importMap })` 纯投影得到，不读文件内容；Lazy 驱动（`lazy-analyze.mjs`）负责各阶段，source-index 阶段已经通过 `readFile` 从物化快照读内容。Full 的 Phase F 复用同一个驱动，MCP `sync_facts` 做整体重投影。
- Java 类型事实：每个顶层类型一条 class 条目，带 `qualifiedName`（`包名.类名`）与 `memberTypes`（嵌套类型的简单名）。嵌套、匿名、局部类型不建节点（dead-code-detection 的非目标）。同一 id 被多个声明占用时 class id 为 null，落 `identity-collision`。
- 可遍历边集合在 `retrieve.mjs` 的 `DETERMINISTIC_EDGE_TYPES`；`overrides` 是上一次加入的先例。
- 先例：Java 调用解析是「单文件抽站点、投影时跨文件解析、每个站点落成边或可见桶、守恒断言」；XAML parser 是「单文件只记词法事实，跨文件连边放到别处」。
- 语言注册表里配置了 tree-sitter 语法的语言有 15 种（c、cpp、csharp、dart、javascript、go、kotlin、java、php、ruby、python、scala、rust、typescript、swift）。

## Goals / Non-Goals

**Goals:**
- 在不知道框架、版本、厂商的前提下，把非代码文件里对仓库类与仓库文件的提及变成带逐行证据的事实边。
- 每个候选都落一个可见结果：成边、歧义、未解析、目标未建索引、仓库外。用守恒断言保证没有第五种去向。
- 不改任何既有节点与边；只新增 `mentions` 边、三类缺口和一段覆盖。

**Non-Goals:**
- EL（`#{bean.x}`）、按 bean 名的引用（`ref="orderService"`、batch job 的 `ref`）：第 2 步。
- Java / Kotlin 等代码文件里的字符串字面量（`Class.forName`、导航 outcome）：第 2 步。
- 包名提及（`component-scan base-package`）、JSF 资源库路径（复合组件命名空间 → `resources/`）：后续步骤。
- 判定一个提及是什么角色（servlet、bean、EJB）：第 3 步的数据目录消费本变更记录的元素 / 属性上下文。
- 为嵌套类型建节点。

## Decisions

**D0：为什么落代码而不是交给 skill / prompt（AGENTS 的 AI-first 闸门）。** 提及是结构化的代码事实：Sakai 一个仓库就有 2,106 个 `<bean class>`、157 个 `<servlet-class>`。按「结构化代码事实不让模型转写」，这类事实由确定性抽取原样产出，模型逐个读描述符既贵、又不可复现，还会漏。另外，下游的有界遍历、死代码判定和审计都要机器可校验、可复用的边，而 prompt 产不出持久化契约。

**D1：词法与解析分两层；词法是独立阶段，解析在投影里。**
- 新模块 `text-mentions.mjs` 是纯函数：`(path, language, text) → 候选列表`，不读盘、不看其它文件。Lazy 驱动新增 `mentions` 阶段，紧跟 importMap，按 manifest 从物化快照读内容，产出逐文件候选，交给 `buildFactGraph({ ..., mentionSites })`。
- `buildFactGraph` 未收到 `mentionSites` 时，覆盖记 `mentions.status: "not-run"`，不产生边，也不与「扫描了但为零」混同。现有直接调用 `buildFactGraph` 的测试因此不需要改输入。
- 备选「写成 Core 的 parser plugin」：plugin 按语言分发，而这里要覆盖所有非代码语言，包括未声明的扩展名；跨文件解析也离不开全局类型字典。不选。
- 备选「在 `buildFactGraph` 里读文件」：破坏投影的纯函数性质，测试要造文件系统。不选。

**D2：扫描范围 = manifest 全部文件 − 代码语言；代码语言从注册表派生。**
- 默认纳入是技术栈无关的关键：`.ftl`、`.vm`、`.tag`、`.jspx`、厂商描述符、启动脚本，无需逐个声明。
- 排除代码语言，避免与 `imports` 边重复（TS/JS 的相对路径 import），也把代码里的字符串字面量留给第 2 步统一处理。
- 扫描器跳过的文件（过大、二进制、未知语言等）不扫描，本变更不改变这一点。但它们是仓库里真实存在的文件：路径解析把它们算进目标范围（D5），覆盖按跳过原因记录没有扫描的非代码文件数（D6）。验收发现 hadoop 有 146 个这样的非代码文件，其中 58 个过大，多为 jdiff XML。如果不记，这部分遗漏只在扫描器的账本里可见，在 `coverage.mentions` 里看不到。

**D3：候选的切分与过滤。**
- 文本先做注释遮蔽：标记语言（XML 族、HTML、JSP、xhtml、未声明但以 `<` 开头的标记文件）遮蔽 `<!-- -->` 与 `<%-- --%>`；properties 遮蔽整行 `#` / `!` 注释。遮蔽时保留换行和偏移，行号对应原文。其它格式不遮蔽，写进覆盖说明。
- 类名候选：形如 `[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+` 的 token。左侧不是标识符字符也不是 `.`；右侧不是标识符字符，也不是「`.` 后接标识符字符」（含数字，所以 `com.acme.Foo.2` 不是候选）。因此句末的 `com.acme.Foo.` 与 AspectJ 的 `com.acme.Foo.*(..)` 照样成为候选。验收阶段 B 发现实现本来就是这样做的，于是改 design 对齐实现。
- 路径候选：在空白、引号、`<>`、`,`、`;`、`(`、`)`、`=` 处切开，得到不含这些字符的串；去掉 `classpath:` / `classpath*:` / `file:` 前缀、`?` 之后与 `#` 之后的部分。剩余串的扩展名必须出现在 manifest 文件的扩展名集合里。含 `://`、`#{`、`${` 的串不是路径候选。判断通配 token 是否「至少含一个字面目录段」时，`.` 与 `..` 不算字面段，所以 `./*.ts` 不是候选。
- 上下文：标记文件中，候选位于某个开始标签的属性值内时，记 `{ element, attribute }`；位于元素文本内时，记最近未闭合元素名，`attribute` 为 null。JSP 指令 `<%@ page import="…" %>` 记 `element: "%@page"`，其它指令同理（`%@include`、`%@taglib`）。指令的上下文由指令本身决定，与外层未闭合的元素无关：验收发现 `<script>` 内的 `<%@ include file %>` 被记成了 `script`。上下文是尽力而为的词法信息，非标记文件为 null。现在就记，是为了让第 3 步不必再扫一遍、再升一次版本。

**D4：类名解析——顶层类型字典、`$` 归一、最长前缀。**
- 字典：每个带 `qualifiedName` 的 Java class 条目，键为全限定名，值为声明列表。
- 候选的 `$` 归一为 `.`，从全长往短取前缀，前缀至少两段，第一个在字典里的前缀即命中。命中一个声明且其 id 非 null 时成边；命中多个声明或 id 为 null 时记 `mention-ambiguous`。
- 没有前缀命中 Java 字典、但能命中仓库内不是节点的声明时，记 `mention-target-unindexed`。这类声明有两种：其它 JVM 声明（Kotlin / Scala 行的包名 + 类型名，沿用 `createOtherJvmIndex`），以及 Java 源文件按包路径与文件名可确认、却没有 class 条目的类型（今天是注解类型 `@interface`：抽取器不为它建节点，验收阶段 A 发现）。后者按该文件自己声明的包判定：Lazy 的 `mentions` 阶段为「文件名对应的类型不在字典里」的 Java 文件读出 `package` 声明，读前遮蔽注释。这类文件包括没有 class 条目的 `.java` 文件，以及因过大被扫描器跳过的 `.java` 文件。`<声明的包>.<文件名>` 即是一个不是节点的仓库声明。没有 `package` 声明的文件属于默认包，不参与匹配。依据是「外部要有完整索引」：字典没读到的仓库声明只能判未知，不能判仓库外。
- 第一版（`a88d94eb`）按「目录以包路径结尾、文件名为类型名」判定，验收阶段 B 发现它在 4 个语料上造出 277 条错误的未建索引声明。例如 `<servlet-name>ejb3.PingServlet2Session</servlet-name>` 匹配到了包为 `…web.prims.ejb3`、且已建索引的类，hadoop 的配置键 `fs.AbstractFileSystem.bos.impl` 匹配到了 `org/apache/hadoop/fs/AbstractFileSystem.java`。目录名只是包名的后缀，不等于声明了这个类型，所以改读声明的包。Kotlin / Scala 沿用 `createOtherJvmIndex` 的目录判定，因为它与调用解析共用；残余风险见 Risks。都不命中时计入 `external`，不出缺口：仓库外类名是常态，而且 `external` 的计数仍在守恒里可见。
- 备选「按简单名匹配」：`Config`、`Util` 这类简单名会把整个仓库连起来。不选。

**D5：路径解析——web 根、相对、后缀；模式全收。**
- web 根集合：manifest 中所有形如 `<dir>/WEB-INF/…` 的路径给出的 `<dir>`（包括仓库根时的空前缀）。提及文件的 web 根是它最近的、属于该集合的祖先目录（Servlet 规范定义的上下文根）。
- 目标范围：manifest 文件，加上扫描器以处理原因跳过的文件（`too-large`、`binary`、`unknown-language`、`read-failed`、`symlink`）。这类原因都是逐文件记录的；忽略规则、默认过滤与敏感规则是策略排除，可能按目录记录，不参与。命中被跳过的文件记 `mention-target-unindexed`，不记成不存在：验收发现 hadoop `LICENSE.txt` 写了一个过大头文件的完整路径，产物却报「仓库里没有」。
- 规则顺序见规格（web 根、所在目录、web 根兜底、classpath 后缀）；每条规则产出 0 到多个命中，第一个有命中的规则定案。web 根兜底只用于提及文件位于某个 web 根之下、且 token 不以 `/` 开头的情形，依据是 Servlet 规范里描述符中的路径相对上下文根。只与已知路径比对，不访问文件系统，所以 `../` 越界不可能读到仓库外。
- 后缀规则只收带 classpath 前缀的 token：classpath 的语义本身就是「在任一类路径根下」，后缀匹配正对应这层语义，`classpath*:` 模式的全仓展开也是它的本意。后缀匹配前去掉开头的 `/`、`./`、`../` 段，按路径段边界匹配（`a/spring/beans.xml` 能匹配 `spring/beans.xml`，`a/xspring/beans.xml` 不能）。其它 token 在前三条规则都没有命中时记未解析，不按后缀猜。这条规则经两轮验收收紧：
  - 阶段 B：人工抽查在 208 条边里发现 8 条编造，全部来自后缀兜底。7 条是构建描述符里的模式：Maven `<include>`、Ant fileset 的模式相对一个看不见的基准目录，所在目录没有命中，于是展开到全仓所有形状相同的模块；sakai `master` 一个 pom 的 `java/**/*.java` 产生了 6,997 条边，只有 34 条在它自己的模块里。另 1 条是 CHANGELOG 里的裸文件名 `unistd.h`，原文指的是系统头文件。当时收紧为「classpath，或非模式且含目录段」，并预定：复验若在跨目录子树的后缀边里再发现编造，就只保留 classpath。
  - 阶段 C：对 391 条跨子树（含仓库根文件发出）的后缀边做了全量或分层复核，发现 5 条编造。它们是：构建文件里相对另一个基准目录的 `META-INF/orm.xml`；页面里断掉的相对 `href`，落到了另一个应用；CI 脚本 `cd` 之后的下载目标；两条历史 CHANGELOG 里的散文路径。按预定方案启用后退，不再另开讨论。代价是约 3,450 条边改记为未解析缺口；抽中的 391 条里 386 条本是对的，sakai 的大头在 help 模块。缺口可见、编造为零，按「零编造、不求全覆盖」取前者。
- 开头的 `/`、`./`、`../` 之后再出现 `.` / `..` 段的 token 不解析，记未解析。`posix.normalize` 会让 `$GITHUB_ACTION_PATH/..` 这样的段相互抵消，验收里的 3 条边目标碰巧正确，但这套机制同样可能抵消一个有意义的目录。
- 模式：`classpath*:` 前缀或含 `*`、且至少有一个不带通配的目录段的候选按 glob 处理（`*` 不跨段，`**` 跨段），在定案规则的范围内展开，每个命中成边，证据标 `resolution: "pattern"`。没有字面目录段的通配（`*.xhtml`、`**/*.xml`）不是候选：`web.xml` 的 `url-pattern` 是 URL 映射，若当成路径会把描述符连到大量页面。
- 不带 classpath 前缀的模式按规则 1–3 展开时，开头的 `/`、`./`、`../` 之后的第一段必须是字面目录；以 `*` / `**` 开头的模式不展开，记未解析。依据是锚定规则必须能落空：字面首段只有在基准目录真是这里时才会命中，命中本身就验证了基准；以通配开头的模式在任何目录下都能命中，分不清「基准在这里」和「基准在下面某个子目录」。阶段 C 全量复核了 12 个语料的 78 个模式出现，5 个错误全部以 `**` 开头。其中 Ant `<javac srcdir="${java.dir}">` 里的 `**/jrcs/diff/**/*.java` 从 build.xml 所在目录展开，扫进了 `src/completejava` 与测试目录，71 个目标里 53 个是错的；hadoop-azure failsafe 的 `**/azurebfs/commit/*.java` 扫进了 `src/main`。备选「解析声明的基准目录」需要跟踪 Ant 属性与 `<import>`、Maven surefire / failsafe 的目录约定，是按技术栈定制，不选。代价按阶段 C 的全量复核算：以通配开头的 47 个出现里 42 个今天是对的，共 370 个目标，它们变成缺口，大头是 hadoop（22 处、266 个目标）。字面首段的 22 个与 classpath 的 9 个全部正确，保留。
- 歧义只看非模式候选的多重命中。备选「多重命中时取与提及文件公共前缀最长的那个」：这是启发式，规格要求不猜。不选，代价是多模块仓库里 classpath 后缀引用会多出一些歧义缺口，数量见验收。

**D6：边的形状与守恒。**
- `mentions` 边：`source` 为提及文件的 file 节点；`target` 为 class 节点或 file 节点；`direction: "forward"`、`weight: 0.5`、`provenance: "extracted"`。每对（source, target）一条边，`evidence` 为该对的全部提及，按行升序去重；每条证据为 `{ file, line, source: "lexical", token, context, resolution }`，其中 `resolution` 取 `fqn` / `web-root` / `relative` / `suffix` / `pattern`。
- 缺口：`mention-ambiguous`、`path-mention-unresolved`、`mention-target-unindexed`，scope 为提及文件的语言；样例格式 `path:line token -> [候选…]`；计数单位为候选出现次数。`path-mention-unresolved` 的说明写「没有按规则锚定到已知文件」，不写「仓库里没有」：被忽略规则、默认过滤排除的文件（如 `*.min.js`）不参与，别处同名的文件也不猜。阶段 C 发现旧说明在至少 39 处不实。
- 覆盖 `mentions` 记录这些内容：`status`；按语言的已扫描文件数；按跳过原因的未扫描非代码文件数 `skipped`；两类候选数与各去向计数；模式命中里被跳过文件的数量 `path.unindexedHits`：每个模式命中的每个被跳过文件都算，不论该模式是否还命中了节点。
- 守恒：类名候选数 = 成边站点 + 歧义 + 未建索引 + 仓库外；路径候选数 = 成边站点 + 歧义 + 未解析 + 自指 + 未建索引。路径的未建索引包括唯一命中被跳过文件，以及模式只命中被跳过文件。不平衡即抛错，沿用 `assertCallConservation` 的做法。

**D7：遍历。** `mentions` 加入 `DETERMINISTIC_EDGE_TYPES`。遍历本来就不分方向，从类可以走到装配它的描述符，从页面可以走到它包含的页面。一个被大量提及的文件（如 `web.xml`）可能把很多类连起来，由现有的预算与边界报告兜住，和共享大包同理。

**D8：版本与冻结摘要。** `PIPELINE_VERSION` 升到 `lazy-fact-graph/6`，注释写明本次新增的事实。凡是因新边、新覆盖段变化的冻结摘要，一律用生成器整块重冻，不逐字段手补；提交说明列出哪些摘要变了、为什么变。

**D9：与死代码检测的关系。** `mentions` 是 dead-code-detection 切片 B 的输入：被提及的类，其方法不能判 `dead`，原因记为按名称被提及。本变更不改死代码的任何文件。两个变更的规格增量互不修改对方的要求（本变更只用 ADDED），归档顺序不受约束。

## 验收 Oracle（动手前写死）

验收语料（除 O4 外均为本变更的例外语料，固定提交，均在 `excavator-test-repos/` 下；源码、路径、输出不提交）：

| 语料 | 提交 | 用途 |
|---|---|---|
| Sakai `master` | `10a1d904d379df3cb2371ee0e405a4c2d1060588` | Spring XML（250 个文件）、web.xml（91 个）；规模与耗时 |
| Sakai `12.7` | `5e75448885a8484fceea955509fc786bc99bfff4` | `javax` 时代 JSF on JSP、faces-config |
| Dataverse | `cc6e62e3354492ad1f4127adc64eb22445319b95` | Facelets 的 `ui:include` / `template=` |
| Geronimo DayTrader | `dcf13a23fa6d81a9efb4f018eef9d59f115b4b1f` | EJB 2.1 的 ejb-jar.xml 与厂商描述符 |
| Seam 2.2 examples | `345f9cf6c76b55825fb6c71df02dd5947dd154f0` | 多应用服务器描述符变体、pages.xml |
| TomEE 8.x examples | `9c1921010cb36300a0e7ebdf0de9df22b8307ebe` | ejb-jar.xml 精确小样例 |

Seam 与 TomEE 是 `blob:none` 稀疏克隆。为避免快照物化时按需拉取稀疏范围外的对象，把 `examples/` 复制成非 git 目录再分析（非 git 来源）。

- **O1 夹具与绊线**（coder 写，acceptor 审）：规格每个场景一条测试，另加以下用例：
  - 身份夹具：两个模块声明同一全限定名；两个 web 应用有同一相对路径的模板。
  - 格式与行号：CRLF 文件；多行注释中间夹活动标记时的行号。
  - 匹配边界：默认包类型不匹配；`.class` 与常量后缀；`$` 多级嵌套。
  - 路径过滤：自指不成边；URL 与 EL 不是路径；扩展名不在 manifest 的 token 不是路径候选。
  - 范围：代码语言文件不产生候选；`mentionSites` 缺省时覆盖为 `not-run`。
  - 变异绊线：关掉注释遮蔽、关掉歧义判断、关掉 web 根规则、把最长前缀改成最短前缀，四个变异各自至少让一条测试变红。
- **O2 全量精度审计**（acceptor 独立实现，不复用被测代码）：对每个语料的每条 `mentions` 边的每条证据，读快照中该行，要求原文含 `token`；再按规格规则独立重算 token 的目标，要求与边的 target 一致。不一致数必须为 0。装置先验：往图谱副本里注入一条错边和一条错行号的证据，审计必须报出这两条。
- **O3 召回**（acceptor 独立 grep 脚本，结果按桶对账）：
  1. **类名提及：** Sakai 两个提交与 DayTrader、Seam、TomEE 中，以下位置的值若能按规格规则命中仓库 Java 顶层类型，就必须出现在成边或 `mention-ambiguous` 里，逐项对账：
     - 非注释的 `class="…"` 属性；
     - `<servlet-class>`、`<filter-class>`、`<listener-class>`、`<ejb-class>`、`<home>`、`<remote>`、`<local-home>`、`<local>` 元素文本。
  2. **路径提及：** 以下位置的字面值（不含 EL）必须逐个落在成边、`mention-ambiguous` 或 `path-mention-unresolved`，且成边目标与独立解析一致：
     - Dataverse 的 `ui:include src`、`template`；
     - Sakai 12.7 的 `<to-view-id>`、`<from-view-id>`、`jsp:include page`、`<%@ include file %>`。
- **O4 不回归**：wcp、cebreo、hadoop、fineract 各自与同一提交、`lazy-fact-graph/5` 的基线对比：
  - 节点集合、非 `mentions` 边集合、既有缺口完全一致；
  - 覆盖只多 `mentions` 一段；
  - 新增的 `mentions` 边与缺口全部列出计数，逐个语料说明来源（比如 hadoop 的 XML 配置）。
- **O5 耗时**：Sakai `master` 与 hadoop 的 Lazy 总耗时，与同一会话、同一提交新测的基线相比增幅不超过 10%（各取 3 次中位数）。`mentions` 阶段单独计时并报告。
- **O6 人工抽查**（acceptor）：每个语料随机抽 20 条边、各类缺口样例全部读原文，判断是否真提及。编造计数必须为 0，遗漏单独计数。
- **O7 真实 MCP**：对 Sakai 12.7 起 stdio MCP 调全部 7 个工具：
  - 从一个 servlet 类做 1-hop `traverse`，能到达提及它的 `web.xml`；
  - `project_status` 报出新缺口与 `mentions` 覆盖；
  - `recall` 不受影响。
- **O8 全量门**（我跑）：三件套 + core 测试 + typecheck + `openspec validate --all --strict` + `node scripts/check-refs.mjs`。

## Risks / Trade-offs

- [文档里的提及也成边：README、设计文档写了类的全限定名] → 这是真提及，边类型叫 `mentions` 而不是 `references`；消费者能看到源文件的类别。O3 和 O4 会报出这类边的数量。
- [后缀只留给 classpath：非 classpath 的路径在相对与 web 根都落空时成为缺口，即使仓库里恰好只有一个同尾部的文件] → 阶段 C 量过：约 3,450 条边改记缺口；hadoop 至多 1,196 处、dataverse 至多 307 处裸文件名的 basename 在仓库里唯一。缺口带原 token 与行号，可见。要召回它们，应由消费者（经 MCP 的 AI）读缺口样例与原文自行判断，不在 Core 里猜。
- [多模块仓库里 classpath 引用的歧义缺口可能很多] → 阶段 C 实测：sakai-12.7 12 处、sakai `master` 10 处，没有淹没信号，不需要引入模块边界。
- [不是节点的 Java 声明按「声明的包 + 文件名」判定：同一文件里第二个顶层注解类型、或文件名与类型名不同的非 public 注解类型认不出来，仍计入 `external`] → Java 要求 public 顶层类型与文件同名，被描述符按全限定名引用的注解类型几乎都是 public 的，剩下的情形很少。要彻底消除，需要 Core 为注解类型建节点；那属于抽取器的变更，不在本变更内。
- [被跳过的 Java 文件只有 `too-large` 的会被读包声明；二进制、符号链接、读取失败的读不到，提及它们的类型仍计入 `external`] → 物化快照不含符号链接，后两种本来就不可读。这些情形很少，跳过账本里也能看到。
- [Kotlin / Scala 仍按目录判定包：目录名只是包名后缀时，会出现错误的未建索引声明] → 判定与调用解析共用，单独改会让两处对「另一个 JVM 声明」的理解不一致。验收阶段 B 在 Kotlin 上只见到 2 条，都属实。若复验发现错误声明，在后续变更里让两处一起改为读声明的包。
- [模式命中的扇出是 N×M：N 个文件都写同一个 `classpath*:` 模式、命中 M 个文件时，产生 N×M 条边。合成探针上 5,000 × 5,000 时内存耗尽] → 规格允许，这些边也都属实。非 classpath 模式不再按后缀展开、且须以字面目录开头之后，只在自己的目录或 web 根下的一个具名子目录里展开。阶段 C（收紧首段之前）：sakai `master` 91 条模式边、最大扇出 40；hadoop 209 条、最大扇出 102。如果真实语料上出现失控，在后续变更里把模式本身作为一个节点（文件 → 模式 → 命中），而不是加上限。
- [超大的生成 XML（WSDL、测试数据）会产生大量提及] → 太大的文件本来就被扫描跳过；中等大小的照常处理，耗时由 O5 兜住。
- [最长前缀从 token 开头锚定，`log4j.logger.com.acme.Foo` 这种在全限定名前加了前缀的写法不命中] → 这类多是日志配置，不是装配；计入 `external`。如果验收发现装配场景里也有这种写法，再在后续变更里加入子序列匹配。
- [类名正则会在 URL 路径或注释外的说明文字里捕获点分串] → 只有命中仓库类型才成边，属实提及。O6 人工抽查会报这类边的比例。

## Migration Plan

升版本号后，已有产物在下次 Lazy / `sync_facts` 时整体重投影，不需要迁移脚本。回滚时按步 revert 对应 commit，版本号随之回退，产物再次整体重投影。
