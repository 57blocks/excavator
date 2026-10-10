## Purpose

确定性、零模型、build-free、语言无关的活性判定：在事实图与声明式的根集合之上，为每个函数节点给出恰好一个可审计的判定（`live` / `test-only` / `undetermined` / `suspect` / `dead`），`dead` 只在代码可能被引用的每一种方式都被看见且均无引用时发出，`suspect` 只在仓库里没有任何引用证据、仅差一条人的立场声明时发出，宁可漏报，绝不把还在使用的代码报成 dead。

## ADDED Requirements

### Requirement: 活性判定的定义

系统 SHALL 以「从根集合出发的可达性」定义活性，而不是「有没有入边」。根集合由声明得到（见「根与活性声明」）。判定 SHALL 为以下五种之一，按此顺序先到者得，且每个函数节点恰好落入一种：

- `live`：从某个生产根出发，经**解析边**可达，并带有一条逐跳有证据的路径。解析边为：`calls`；覆写分派——被覆写或被实现的方法活则覆写它的方法活，但分派只从「被调用而活」（根、`calls` 的目标、分派到达）的方法出发；声明依赖——覆写方法活则被覆写的方法活；
- `test-only`：不是 `live`，但从测试根出发经解析边可达；
- `undetermined`：不是前两者，且仓库里存在**引用证据**——至少一条证据类原因成立（见「可能引用图」与「`dead` 的发出条件」），或从生产根、测试根、任何 `live` / `test-only` / `undetermined` 节点经解析边或可能引用可达；带原因与证据；
- `suspect`（疑似 dead）：不是前三者，仓库里**没有任何引用证据**，唯一阻止 `dead` 的是一条尚未表态的人的立场（立场类原因，当前只有 `public-api-undeclared`），或只从 `suspect` 节点经解析边或可能引用可达；记录 SHALL 写明能了结它的那条声明；
- `dead`：以上都不是，在产物头部所列残余假设下 dead。

构造器 MUST NOT 判为 `dead` 或 `suspect`：它只可能是 `live`、`test-only` 或 `undetermined`（原因 `constructor-out-of-scope`）。`dead` 与 `suspect` 的判定 SHALL 标明它是否「直接无引用」（没有任何解析边或可能引用指向它），并标明它所属的簇（互相引用但没有任何根能到达的 dead / suspect 节点集合）。判定 MUST NOT 带置信度或概率；桶只按原因种类划分，机器可核。

#### Scenario: 只被 dead 代码引用的代码也是 dead
- **WHEN** 方法 A 只被方法 B 调用，B 没有任何引用，且 A、B 都不触发任何证据类或立场类原因
- **THEN** B 判为 `dead`（直接无引用），A 判为 `dead`（只被 dead 代码引用），两者属于同一个簇

#### Scenario: 只被疑似 dead 的公开方法引用
- **WHEN** 私有方法 A 只被 `public` 方法 B 调用，B 没有任何引用证据，且 B 的路径没有 `publicApi` 声明
- **THEN** B 判为 `suspect`（原因 `public-api-undeclared`，了结声明为「把 B 所在路径声明为 `internal`」），A 判为 `suspect`（只从 suspect 可达，了结声明同 B），两者属于同一个簇；声明 `internal` 后两者都变为 `dead`，声明 `external` 后 B 为 `undetermined`（`public-api-external`）、A 为 `undetermined`（从 undetermined 可达）

#### Scenario: 证据压过立场
- **WHEN** 方法 M 既是未声明的 `public` 方法，又在某个 XML 文件里出现了名字
- **THEN** M 判为 `undetermined`（`name-occurs-elsewhere`），不判为 `suspect`

#### Scenario: 孤岛环也是 dead
- **WHEN** A 调用 B、B 调用 A，此外没有任何引用指向二者，且二者都不触发任何原因
- **THEN** A 与 B 都判为 `dead` 且属于同一个簇；按入边计数的做法会把两者都当成「有引用」，本系统不这样做

#### Scenario: 只被测试使用
- **WHEN** 生产方法 M 只被声明为测试范围内的代码调用
- **THEN** M 判为 `test-only`，不判为 `live`、`suspect` 或 `dead`

#### Scenario: 从未被调用的抽象方法与它的实现
- **WHEN** 仓库内接口方法 `I.m()` 没有任何调用，它唯一的实现 `C.m()` 也没有任何直接引用，且二者都不触发任何原因
- **THEN** `I.m()` 与 `C.m()` 都判为 `dead`，属于同一个簇

#### Scenario: 覆写方法的活性来自被覆写方法
- **WHEN** `Base.m()` 被某个 `live` 方法调用，`Sub.m()` 覆写了 `Base.m()`，`Sub.m()` 没有任何直接引用
- **THEN** `Sub.m()` 判为 `live`，证据路径经过 `Base.m()` 的调用边与 `Sub.m() → Base.m()` 的覆写边

#### Scenario: 继承来的实现经接口调用而活
- **WHEN** `class C extends Base implements I {}`，`Base.m()` 满足 `I.m()`，某个 `live` 方法以 `I.m()` 为目标调用
- **THEN** `Base.m()` 判为 `live`，证据路径经过 `I.m()` 的调用边与 `Base.m() → I.m()` 的实现边

#### Scenario: 实现方法活则接口方法活
- **WHEN** `C.m()` 直接被 `live` 方法调用并实现了仓库内接口方法 `I.m()`，而 `I.m()` 本身没有调用
- **THEN** `I.m()` 判为 `live`，原因为声明依赖（删除它需要同时改动实现）

#### Scenario: 仅因声明依赖而活的方法不向其它实现分派
- **WHEN** `I.m()` 只因 `C1.m()` 被直接调用而活，没有任何调用以 `I.m()` 为目标，`C2.m()` 也实现了 `I.m()` 且没有任何直接引用
- **THEN** `C2.m()` 不因此判为 `live`；分派只从被调用或作为根的方法出发

#### Scenario: 构造器不判 dead
- **WHEN** 类 `Foo` 的构造器没有任何 `new Foo(...)` 调用点解析到它
- **THEN** 该构造器判为 `undetermined`，原因 `constructor-out-of-scope`，不判为 `dead` 或 `suspect`

### Requirement: 可能引用图

在解析边之外，系统 SHALL 把每一种「这里可能引用了某个方法」的事实作为可能引用计入，只用于阻止 `dead` 与 `suspect`，MUST NOT 用于得出 `live`。可能引用 SHALL 至少包括：

- 落入 `calls-unresolved`、`calls-ambiguous` 的调用点：指向所有名字相同且参数个数适用（含可变参数；参数个数未知的方法引用视为适用任意个数）的仓库内方法；有候选列表的歧义调用点只指向候选；
- 落入 `calls-generated` 的调用点：指向接收者静态类型的仓库内子类型里名字相同、参数个数适用的声明；
- 调用方无法归属（`calls-caller-unresolved`）的调用点：其目标（已解析目标，或名字兼容的候选）视为被未归属来源引用；
- 可能覆写配对（事实图的 `override-uncertain` 缺口：同名、同参数个数、擦除签名不能确定的仓库内祖先方法与后代方法，含继承来的实现）：双向计入——祖先方法被任何东西到达则后代方法不能 dead（可能分派），后代方法被到达则祖先方法不能 dead（声明依赖）；
- 可见性收窄：`private` 方法只接受同一文件内的可能引用；包私有方法只接受同一包内的可能引用；`protected` 与 `public` 不收窄。

可达性的传播 SHALL 分层：从生产根、测试根、所有 `undetermined` 节点与所有 `live` / `test-only` 节点出发，沿解析边与可能引用可达的节点判为 `undetermined`（原因为到达它的边种类与前驱）；之后从所有 `suspect` 节点出发可达、且尚未判定的节点判为 `suspect`，其了结声明为所有到达它的 `suspect` 来源的了结声明之并：只有全部声明都表态后它才可能变为 `dead`。

#### Scenario: 未解析调用点阻止 dead
- **WHEN** 方法 `m(int)` 没有任何解析入边，但某个 `live` 方法里有一处落入 `calls-unresolved`、名为 `m`、传一个实参的调用点
- **THEN** `m(int)` 判为 `undetermined`，原因指向该调用点，不判为 `dead`，也不判为 `live`

#### Scenario: 私有方法不受其它文件的可能引用影响
- **WHEN** `private` 方法 `A.helper()` 只在本文件无引用，另一个文件里有一处未解析的 `helper()` 调用
- **THEN** 该调用点不构成对 `A.helper()` 的可能引用；`A.helper()` 的判定只取决于本文件内的引用与其它发出条件

#### Scenario: 未归属调用方的调用点视为来源
- **WHEN** 匿名类内部的一处调用解析到方法 `m`，而调用方无法归属
- **THEN** `m` 至少判为 `undetermined`，原因为「被未归属来源引用」

#### Scenario: 擦除签名不确定的实现不判 dead
- **WHEN** 接口 `COBBusinessStep<T>` 声明 `execute(T)`，`LoanStep` 声明 `execute(Loan)`，事实图因签名不确定没有连 `implements` 边而记了 `override-uncertain` 缺口，`execute(T)` 被某个 `live` 方法调用
- **THEN** `LoanStep.execute(Loan)` 判为 `undetermined`，原因为可能覆写分派，不判为 `dead`

#### Scenario: 从 suspect 经可能引用可达
- **WHEN** `suspect` 方法 B 里有一处未解析的 `helper()` 调用，`helper()` 只有一个同包的包私有声明且没有其它任何引用证据
- **THEN** `helper()` 判为 `suspect`，了结声明与 B 相同

### Requirement: `dead` 的发出条件与残余假设

对未被任何根经解析边或可能引用到达的函数节点，系统 SHALL 逐项检查以下「不在索引内」的引用形态。原因分两类：**证据类**（仓库里存在可能引用它的具体机制）与**立场类**（仓库里没有证据，只差人的声明）。任一证据类原因成立即判为 `undetermined`；只有立场类原因成立即判为 `suspect`；都不成立才判为 `dead`。

证据类原因：
- `language-not-covered`：声明所在语言未声明引用覆盖完整（见「语言插件模型与覆盖门」）；
- `constructor-out-of-scope`：构造器；
- `public-api-external`：`public` / `protected` 声明，其路径被活性声明标为 `external`（声明了的外部契约）；
- `may-override-external`：非 `private`、非 `static` 的实例方法或接口方法，其所属类型的层次、或继承了该方法的任一仓库内子类型的层次，含仓库外或无法解析的父类型（无法解析包括仓库内类型的成员类型、仓库内 Kotlin / Scala 等其它语言声明的类型；`java.lang.Object`、`java.lang.Enum`、`java.lang.Record` 除外）。仓库内父类型也声明了同名方法并不能排除它同时覆写了外部方法，所以 `@Override` 不解除这条规则；只有「标注 `@Override` 且仓库内父类型没有对应方法」的声明按「根与活性声明」成为根；
- `annotation-unclassified`：方法注解，或所属类型的类注解，在注解目录与活性声明中都没有分类（`private` 方法只看方法注解）；
- `annotation-reflective`：注解被分类为「框架可能按约定调用该类型的方法」；
- `annotation-class-literal`：所属类型在仓库内任一注解的实参里以类字面量（`X.class`）被引用（`private` 方法除外）；简单名无法解析时所有同名仓库类型都算被引用；
- `annotation-element`：注解类型（`@interface`）的元素；
- `bean-accessor`：非 `private` 的 `getX()` / `isX()`（无参）或 `setX(1)`，除非活性声明把访问器标为 `plain`。这是证据类：序列化按属性名反射调用访问器是仓库里可观察的具体机制，不是立场；
- `name-occurs-elsewhere`：按「文本出现否决」检查到多余出现；
- `identity-collision`：节点身份与其它声明冲突。

立场类原因：
- `public-api-undeclared`：`public` / `protected` 声明，且其路径没有任何 `publicApi` 声明；了结声明为「把该路径声明为 `internal` 或 `external`」。

只有以上全部不成立时，系统 SHALL 判为 `dead`，并在判定记录里列出已执行的检查与计数。产物头部 SHALL 列出残余假设：按计算名字做的反射、不出现名字的构建期代码生成、代码里（非注解实参）的类字面量交给仓库外方法后的反射调用、被选中源码集合之外的引用，不在检查范围内；`dead` 的保证 SHALL 表述为「在这些残余假设下 dead」。代码里的类字面量数量 SHALL 在普查中报告。

#### Scenario: 方法引用阻止 dead
- **WHEN** 方法 `isEhcacheEnabled()` 只以 `PlatformCache::isEhcacheEnabled` 的形式被引用
- **THEN** 该方法引用作为调用点解析成边或落入可能引用，该方法不判为 `dead` 或 `suspect`

#### Scenario: 约定式访问器不判 dead 也不判 suspect
- **WHEN** `public BigDecimal getSumOutwardCash()` 在全仓文本里只出现在声明处，路径没有 `publicApi` 声明
- **THEN** 判为 `undetermined`，原因 `bean-accessor`；证据类原因压过立场类原因

#### Scenario: 反射字面量与配置文件里的名字
- **WHEN** 方法 `provideArgs` 没有任何调用点，但 `@MethodSource("provideArgs")` 或某个 XML 文件里出现了 `provideArgs`
- **THEN** 判为 `undetermined`，原因 `name-occurs-elsewhere`，证据为第一处出现的文件与行

#### Scenario: 覆写外部契约
- **WHEN** 类实现了仓库外接口（如 `ExceptionMapper`），其方法 `toResponse` 没有标注 `@Override`，仓库内无人调用
- **THEN** 判为 `undetermined`，原因 `may-override-external`；若标注了 `@Override` 且仓库内父类型没有该方法，则该方法是根，判为 `live`

#### Scenario: 继承来的方法满足子类的外部接口
- **WHEN** `class C extends Base implements ExternalIface {}`，`Base.m()` 没有任何仓库内调用，`Base` 自身的层次全在仓库内
- **THEN** `Base.m()` 判为 `undetermined`，原因 `may-override-external`，证据指向 `C` 的父类型声明行

#### Scenario: 实现另一个类的嵌套接口
- **WHEN** `class C implements Outer.Inner`，`Outer.Inner` 是仓库内类型的成员类型，解析器不读它
- **THEN** `C` 的非 `private` 实例方法判为 `undetermined`，原因 `may-override-external`，不判为 `dead`

#### Scenario: 未分类的注解
- **WHEN** 方法标注了注解目录与活性声明都没有分类的 `@Scheduled`
- **THEN** 判为 `undetermined`，原因 `annotation-unclassified`，带注解名；活性声明把它分类为 `root` 后，该方法成为根

#### Scenario: 注解实参里的类字面量
- **WHEN** `Helper` 没有任何注解，它的方法名在全仓都没有多余出现，但某处有 `@Mapper(uses = Helper.class)`
- **THEN** `Helper` 的非 `private` 方法判为 `undetermined`，原因 `annotation-class-literal`，证据指向该注解所在行

#### Scenario: 注解类型的元素
- **WHEN** 结构结果里出现注解类型（`@interface`）的元素作为函数条目
- **THEN** 判为 `undetermined`，原因 `annotation-element`

#### Scenario: 公开方法没有任何证据时是 suspect
- **WHEN** `public` 方法 `addTax(4)` 没有任何解析入边与可能引用，不触发任何证据类原因，名字只出现在它自己的声明行，路径没有 `publicApi` 声明
- **THEN** 判为 `suspect`，原因 `public-api-undeclared`，记录写明「声明该路径为 `internal` 即为 `dead`」

#### Scenario: 名字只在已解释的位置出现才可 dead
- **WHEN** 包私有方法 `addTax(4)` 没有任何解析入边与可能引用，不触发任何原因，名字只出现在它自己的声明行
- **THEN** 判为 `dead`，记录里 `textOccurrences` 为 0

### Requirement: 文本出现否决独立于解析器

对所有未被证明活的候选名字（构造器除外），系统 SHALL 扫描被选中源码集合（源码清单列出的文件，排除 `.excavator/`，二进制文件跳过并计数），按整词、区分大小写逐行计数。每一行允许的出现次数 SHALL 只等于：该行上以该名字声明的方法条目数，加上该行上被候选所在语言的适配器记账为**指向该候选**（解析边或可能引用）的调用点数。任何多余出现 SHALL 否决（`name-occurs-elsewhere`），证据为第一处多余出现的文件与行。解析到其它同名方法、`calls-external`、`calls-generated` 的调用点，以及其它语言的调用点，MUST NOT 计入允许次数。普查 SHALL 报告「仅因解析器已另行解释的调用点行而被否决」的候选数，作为这一独立性的代价。

#### Scenario: 同一行的多余字面量
- **WHEN** 某行同时有解析到候选 `foo` 的调用 `a.foo()` 与字符串字面量 `"foo"`
- **THEN** 该行出现 2 次、允许 1 次，候选被否决

#### Scenario: 其它语言的调用点不计入允许次数
- **WHEN** Kotlin 文件里有一处调用 `user.findByLogin(...)`，Kotlin 行的调用点列表记录了它
- **THEN** 该出现仍然否决 Java 方法 `findByLogin`

#### Scenario: 解析到另一个同名方法的调用点仍然否决
- **WHEN** 调用 `y.foo()` 被解析为指向 `Y.foo()` 的边，候选是 `X.foo()`
- **THEN** 该行对 `X.foo()` 的允许次数为 0，`X.foo()` 被否决

### Requirement: 根与活性声明

根 SHALL 由确定性数据得到，MUST NOT 由模型在判定时决定。内建根来自语言规则数据；Java 的内建根为：`public static void main(String[])`；覆写 `java.lang.Object` 的 `equals(1)` / `hashCode()` / `toString()` / `finalize()` / `clone()`；标注 `@Override` 且仓库内父类型没有对应方法的声明（覆写外部契约）；序列化约定方法（`readObject`、`writeObject`、`readResolve`、`writeReplace`、`readObjectNoData`、`readExternal`、`writeExternal`）。

声明式根与分类来自两个数据源：随插件发布的各语言注解与约定目录（方法注解分类为 `root` / `inert` / `reflective`；类注解分类为 `inert` / `reflective`；每条带出处），以及项目根目录的活性声明文件 `.excavator-liveness.json`：`publicApi` 按路径声明 `internal` / `external`；`testScope` 按路径声明测试范围，其内所有函数节点为测试根，测试范围内带 `root` 注解（如 `@Test`）的方法也只是测试根，不是生产根；`annotations` 覆盖或补充目录；`beanAccessors`；`roots` 列出显式根（节点 id 或 `类名#方法名` 模式）。声明文件 SHALL 严格校验（未知键、未知分类值即失败），MUST NOT 由 MCP server 写入。类注解的 `inert` 只断言该注解不会让框架按约定调用这个类型声明的方法，不涉及实例化。产物 SHALL 记录声明与目录的摘要，并给出按原因与注解名统计的 `undetermined` 普查和按了结声明统计的 `suspect` 普查，使未声明项的代价可见。缺少声明文件时 SHALL 按「全部未声明」计算，不得失败。

#### Scenario: 没有声明文件
- **WHEN** 项目没有 `.excavator-liveness.json`
- **THEN** 判定照常产出；没有任何引用证据的 `public` / `protected` 方法为 `suspect`（`public-api-undeclared`），普查按路径列出了结每组 suspect 所需的声明

#### Scenario: 声明只能把 undetermined 或 suspect 变成 live 或 dead
- **WHEN** 活性声明把 `fineract-client-feign/**` 标为 `external`、其余标为 `internal`，并把 `@Slf4j` 标为 `inert`
- **THEN** `external` 路径下的公开方法为 `undetermined`（`public-api-external`）；此前只因 `public-api-undeclared` 而 `suspect`、或只因 `@Slf4j` 未分类而 `undetermined` 的方法按其余条件重新判定

#### Scenario: 测试范围优先于注解根
- **WHEN** `src/test/**` 被声明为测试范围，其中的方法标注了目录分类为 `root` 的 `@Test`
- **THEN** 该方法是测试根而不是生产根；只被它调用的生产方法为 `test-only`

#### Scenario: 非法声明失败
- **WHEN** 声明文件含未知键或把注解分类为未定义的值
- **THEN** 原语以具名错误失败，不产出判定

### Requirement: 语言插件模型与覆盖门

判定引擎 SHALL 不含任何语言分支，只消费一种通用的引用事实模型：函数节点事实（种类、可见性、可分派性、作用域键、注解、所属类型注解、层次是否触及仓库外、内建根、约定标记）、调用点事实（未解析 / 歧义 / 生成 / 未归属，名字、参数个数、调用方、候选）、可能覆写配对、类字面量目标。每种语言 SHALL 只通过三样东西接入：一个 build-free 的适配器（把结构结果与事实图投影为引用事实）、一份覆盖声明（`complete` 或 `none`）、一份规则数据（内建根、注解与约定目录、哪些结构蕴含哪些可能引用）。只有覆盖声明为 `complete` 的语言的函数节点才可能判为 `dead` 或 `suspect`；没有适配器或覆盖为 `none` 的语言，其函数节点 SHALL 一律判为 `undetermined`（`language-not-covered`），仍计入守恒。本变更只为 Java 声明 `complete`：调用、方法引用、覆写与实现、注解、修饰符、类字面量都在索引里，索引之外的形态由文本出现否决兜底。其它语言的源码对已覆盖语言方法的引用 SHALL 经文本出现否决阻止 `dead` 与 `suspect`。

#### Scenario: 非 Java 项目
- **WHEN** 对只含 Go 文件的项目运行判定
- **THEN** 每个函数节点都为 `undetermined`（`language-not-covered`），`dead` 与 `suspect` 计数为 0，守恒成立

#### Scenario: Kotlin 调用 Java
- **WHEN** 仓库内 Kotlin 源码调用了 Java 方法 `findByLogin`，Java 索引里没有该调用
- **THEN** `findByLogin` 因 `name-occurs-elsewhere` 判为 `undetermined`，证据指向该 Kotlin 文件

#### Scenario: 新增语言不改引擎
- **WHEN** 为另一种语言加入适配器、覆盖声明与规则数据
- **THEN** 引擎代码不变，已覆盖语言的判定逐条不变，新语言的函数节点按同样的五桶与守恒产出

### Requirement: 判定不依赖构建

判定、抽取与验收 MUST NOT 编译目标项目、调用目标语言的编译器或类型检查器、安装或要求目标语言的运行时与工具链、或下载目标项目的依赖。所有事实 SHALL 来自 tree-sitter 级别的抽取与源码文本。

#### Scenario: 没有目标语言工具链的环境
- **WHEN** 在没有 JDK、Gradle 或网络的环境里对 Java 项目运行判定
- **THEN** 判定照常产出，与有工具链的环境逐字节相同

### Requirement: 守恒、产物与有界查询

判定 SHALL 持久化为 `.excavator/dead-code.jsonl`：一行头部（格式标识、事实摘要、声明摘要、目录摘要、源码快照身份、各语言的覆盖声明、五种判定的计数与总数、按原因的计数、普查、残余假设），其后每个函数节点恰好一条判定记录。写入与读取 SHALL 校验 `live + test-only + undetermined + suspect + dead = 函数节点总数`，不等即以具名错误失败。`live` 记录 SHALL 带根与前驱（可重建路径）；`undetermined` 记录 SHALL 带原因与证据；`suspect` 记录 SHALL 带原因、了结声明与前驱；`dead` 记录 SHALL 带已执行检查与簇标识。普查 SHALL 包括：按原因与注解名的 `undetermined` 计数、按了结声明（路径）分组的 `suspect` 计数、可能引用扇出与文本否决命中最多的名字、未归属来源引用的目标数、代码里的类字面量数、仅因解析器已另行解释的行而被否决的候选数。查询 SHALL 有界：分页列表带 `truncated` 与续查边界；指定节点查询每次不超过 20 个。产物 SHALL 绑定构建它的事实摘要，事实摘要或声明变化后读取方 SHALL 报告为过期，MUST NOT 把旧判定表示为当前。

#### Scenario: 守恒失败即失败
- **WHEN** 写入时某个函数节点没有落入任何判定
- **THEN** 写入以具名错误失败，不产出部分产物

#### Scenario: 事实摘要变化后的查询
- **WHEN** 事实图重建后 `factsDigest` 变化，而判定产物仍是旧摘要构建的
- **THEN** 查询返回 `stale-product` 状态与两个摘要，不返回旧判定

#### Scenario: 分页列表
- **WHEN** 请求 `suspect` 判定列表且数量超过单页上限
- **THEN** 返回一页记录、`truncated: true` 与下一页偏移
