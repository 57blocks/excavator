## Why

Spring XML 不仅用名字注入 bean，还用名字指定容器要调用的方法：

- `<bean init-method="start" destroy-method="stop">`、`<beans default-init-method default-destroy-method>`；
- `<bean factory-method="create">`：静态工厂方法在 `class` 所写的类上，有 `factory-bean` 时在那个 bean 的类上；
- `<lookup-method name="m">`、`<replaced-method name="m">`：容器覆写 bean 类上的方法 `m`；
- `<property name="dao">` 与 `p:dao="…"` / `p:dao-ref="…"`：容器调用 bean 类上的 setter `setDao`；
- `<task:scheduled ref="job" method="run">`：调度器调用 `job` 这个 bean 的类上的 `run`；
- `<aop:aspect ref="audit"><aop:before method="log" …/>`：通知方法在外层 `aop:aspect` 所名 bean 的类上。

事实图里没有任何东西表示这类调用。现有的 `injects` 只连类到类，`/excavator-unused-code` 的可达性又只沿函数间的边走，所以这些方法全部成为未使用候选，与真正没人用的方法同等对待。名字普查能看到 `init-method="start"` 里的 `start`，把可信度降到 low；setter 的名字 `setDao` 在 XML 里根本不出现，连这个信号都没有。在一个以 Spring XML 装配为主的大型项目上，这会让未使用代码报告充满误报，而这类项目正是该报告最该有用的地方。

现有的名字绑定表、部署单元、消费者类解析和可见桶机制已经能把 `<bean>` 解析到仓库里的类，缺的只是从类到方法这一步。

## What Changes

- **目录（数据）**：`catalogs/name-bindings.json` 新增顶层 `xmlMethodCalls`，目录版本加一。每个方法调用族声明根元素与根命名空间、消费者元素与绑定器，以及调用点列表。每个调用点声明：
  - 元素加属性，或属性命名空间（Spring `p:`）；
  - 方法名怎么从值或属性名得出：原样，或 setter（`set` 加首字母大写的属性名，`p:` 属性去掉 `-ref` 后缀）；
  - 方法属于哪个类：消费者 bean 的类，或由某个属性所名的 bean 的类。这个属性在调用点元素自身上（`factory-bean`、`task:scheduled` 的 `ref`），或在最近的某个祖先元素上（`aop:aspect` 的 `ref`）；
  - 参数个数约束：无参（init、destroy）、单参（setter）或不限；
  - 是否可选：`default-init-method` 与 `default-destroy-method` 对没有该方法的 bean 不生效，这不是缺口。
  随附条目：Spring 方法调用族 `spring-xml-method-call`。
- **读取**：在注入点的同一遍读取里，读出每个调用点的方法名、行、消费者，以及（`factory-bean` 时）工厂 bean 名。根元素上的 `default-*` 属性展开到它下面每个没有写同名属性的 `<bean>`。
- **解析与新边 `invokes`**：
  - 方法所属的类：消费者类按注入点的消费者规则解析；工厂方法例外，它的类就是 `class` 属性所写的类，不受 `unknownWhen` 影响。由属性所名的 bean，按注入点的目标规则在同单元、同命名空间的绑定里解析。
  - 类落到唯一仓库类后，在该类与它的仓库内祖先上按名字和参数个数找方法节点。
  - 唯一命中时，画一条从 XML 文件节点指向方法节点的 `invokes` 边，带证据（文件、行、`token`、调用点 id）。
  - 否则落入可见桶：类那一侧沿用注入点的分类；方法那一侧分为没有该方法、祖先在仓库外或未知（方法可能在库里）、重载歧义；可选调用点找不到方法时落「可选未生效」，不算缺口。
  - 每个调用点恰好一个桶，守恒断言。
- **覆盖与缺口**：新增 `coverage.methodCalls`，含各桶计数与守恒；新增缺口种类 `method-call-owner-unresolved`、`method-call-method-unresolved`、`method-call-ambiguous`。
- **遍历与校验**：`invokes` 属于可遍历的确定性边类型；图校验要求证据行包含 `token`。
- **未使用代码**：`invokes` 边指向的方法与路由处理方法一样是可达性的根。产物的计数分列两种根各有多少。
- `PIPELINE_VERSION` 升一档。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fact-graph`：新增 XML 方法调用点的读取、解析、`invokes` 边、桶与缺口。
- `unused-code`：未使用代码的定义里，`invokes` 的目标是根。

## Impact

- 代码：`skills/excavator/` 下的目录与目录校验、XML 读取、注入阶段之后的新解析模块、`build-fact-graph.mjs`、`lazy-analyze.mjs`、`retrieve.mjs`、`validate-graph.mjs`、`unused-code.mjs`；`excavator-chat` 与 `excavator-unused-code` 的 SKILL.md 里列边类型和定义的句子。
- 升 `PIPELINE_VERSION`，已有的 lazy 图要重建。
- 不做：
  - `autowire="byName"` / `byType` 推出的 setter；
  - `<constructor-arg>` 对构造器的选择；
  - `MethodInvokingFactoryBean` 的属性值、`<aop:*>` 切点表达式里写的方法模式等，写在值或表达式里的方法名；
  - 注解形式的生命周期方法（`@PostConstruct` 等），它们已有注解信号。
