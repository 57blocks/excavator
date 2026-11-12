## ADDED Requirements

### Requirement: XML 方法调用点

系统 SHALL 按目录的 XML 方法调用族，从根元素命中的 XML 文件里读出方法调用点，并把每个调用点解析成一条 `invokes` 边或一个可见桶。根元素的匹配与标记语言注释的处理同「XML 注入点」。

方法调用族声明根元素与根命名空间、消费者元素与读消费者类所用的 XML 绑定器，以及调用点列表。每个调用点有 id，并声明：

- 位置：元素本地名加属性名，或属性所在命名空间（如 Spring `p:`）；
- 方法名的得出方式：`value` 为属性值去掉首尾空白；`setter` 为 `set` 加首字母大写的属性名，命名空间属性先去掉 `-ref` 后缀，元素位置则取所在元素的 `name` 属性值；
- 方法所属的类：`consumer` 为消费者类；`declared` 为消费者元素上绑定器读出的声明类，不受目标未知条件影响（用于静态工厂方法）；`named` 为某属性所名 bean 的目标类，该属性在调用点元素自身上，或在最近的、本地名为所列元素的祖先上；
- 参数个数：`0`、`1` 或不限；
- 是否可选。

根元素上声明为默认值的属性（Spring `default-init-method`、`default-destroy-method`）SHALL 展开为它下面每个没有写对应属性的消费者元素上的一个可选调用点，行号为根元素上该属性所在行。

每个调用点 SHALL 恰好落入一个桶，先看所属类，再看方法：

1. 所属类：
   - `consumer`：按「XML 注入点」第 4 步的消费者规则归类，落到消费者缺失、消费者在仓库外、消费者未知、消费者未建索引或消费者歧义时，调用点落入同名的**所属类**桶；
   - `declared`：声明类为仓库类时继续，否则按仓库外、未建索引、未知、歧义归类；
   - `named`：没有该属性时落**所属类缺失**；有则把属性值当作名字，按「XML 注入点」第 2、3 步在同单元、同命名空间的绑定里归类，落到唯一仓库类时继续，否则落入对应的**所属类**桶（含他处与无绑定）。
2. 方法：属性名含 `.` 的 setter 调用点（嵌套属性路径 `a.b`）落**方法未建模**。其余按运行时分派的顺序，依次看所属类、再看它在仓库内的祖先（近者在前，父类先于接口），在第一个有匹配的类型上，取名字相同且参数个数满足约束的方法节点：
   - 恰好一个：**成边**；
   - 同一类型上多于一个（重载）：**方法歧义**；
   - 没有，可选调用点：**可选未生效**，不是缺口（默认方法只对有该方法的 bean 生效，没有时不涉及仓库里的任何方法）；
   - 没有，而所属类有仓库外或未知的祖先：**方法可能在仓库外**；
   - 没有，其它情形：**方法不存在**。

成边的调用点生成从 XML 文件节点指向方法节点的 `invokes` 边，每个（文件，方法）一条。`coverage.methodCalls` SHALL 记录每个桶的计数，各桶之和 SHALL 等于调用点总数，不相等时报错且不写出图。缺口如下：

| 缺口 | 对应的桶 |
|---|---|
| `method-call-owner-unresolved` | 所属类缺失、所属类未知、所属类未建索引、所属类歧义、所属类在他处、所属类无绑定 |
| `method-call-method-unresolved` | 方法不存在、方法可能在仓库外、方法未建模 |
| `method-call-ambiguous` | 方法歧义 |

所属类在仓库外不是缺口。

#### Scenario: init-method 成边
- **WHEN** `ctx.xml` 有 `<bean id="svc" class="app.OrderService" init-method="start"/>`，`OrderService` 声明无参方法 `start`
- **THEN** 图里有一条从 `ctx.xml` 的文件节点指向 `OrderService#start()` 的 `invokes` 边

#### Scenario: property 名对应 setter
- **WHEN** `<bean class="app.OrderService"><property name="orderDao" ref="dao"/></bean>`，`OrderService` 的父类 `BaseService`（仓库内）声明 `setOrderDao(OrderDao)`
- **THEN** 有一条指向 `BaseService#setOrderDao(OrderDao)` 的 `invokes` 边；同一属性上的 `ref` 照旧产生 `injects` 边

#### Scenario: p 命名空间去掉 -ref
- **WHEN** `<bean class="app.OrderService" p:orderDao-ref="dao"/>`
- **THEN** 调用点的方法名为 `setOrderDao`

#### Scenario: 静态工厂方法不受目标未知影响
- **WHEN** `<bean id="x" class="app.Factory" factory-method="create"/>`，`Factory` 声明 `create`
- **THEN** 有一条指向 `Factory#create` 的 `invokes` 边；该 bean 作为注入目标仍为目标未知

#### Scenario: 实例工厂方法在 factory-bean 的类上
- **WHEN** `<bean id="f" class="app.Maker"/>` 与 `<bean id="x" factory-bean="f" factory-method="make"/>`，`Maker` 声明 `make`
- **THEN** 有一条指向 `Maker#make` 的 `invokes` 边

#### Scenario: 调度方法在 ref 所名 bean 的类上
- **WHEN** `<task:scheduled ref="job" method="run" fixed-delay="1000"/>`，`job` 绑定到仓库类 `NightlyJob`，它声明 `run`
- **THEN** 有一条指向 `NightlyJob#run` 的 `invokes` 边

#### Scenario: 通知方法在外层 aspect 所名 bean 的类上
- **WHEN** `<aop:aspect ref="audit"><aop:before method="log" pointcut="…"/></aop:aspect>`，`audit` 绑定到仓库类 `AuditAspect`，它声明 `log`
- **THEN** 有一条指向 `AuditAspect#log` 的 `invokes` 边

#### Scenario: 默认 init 方法只对有该方法的 bean 生效
- **WHEN** `<beans default-init-method="init">` 下有两个 bean，类 `A` 声明无参 `init`，类 `B` 没有
- **THEN** 有一条指向 `A#init()` 的 `invokes` 边；`B` 的调用点落可选未生效，不产生缺口

#### Scenario: 方法可能在库里
- **WHEN** bean 的类继承仓库外的类，`<property name="dataSource">` 对应的 `setDataSource` 在仓库里找不到
- **THEN** 调用点落方法可能在仓库外，记一条 `method-call-method-unresolved` 缺口

#### Scenario: 子类覆写时指向最近的声明
- **WHEN** `init-method="reset"`，类 `Dup` 声明无参 `reset`，它的仓库内父类 `DupBase` 也声明无参 `reset`
- **THEN** 只有一条指向 `Dup#reset()` 的 `invokes` 边；`DupBase#reset()` 经 `overrides` 由未使用代码的双向规则带到

#### Scenario: 重载歧义
- **WHEN** `factory-method="of"`（参数个数不限），类上声明 `of(String)` 与 `of(int)`
- **THEN** 调用点落方法歧义，记一条 `method-call-ambiguous` 缺口，不画边

#### Scenario: 嵌套属性路径不建模
- **WHEN** `<property name="config.timeout" value="5"/>`
- **THEN** 调用点落方法未建模，记一条 `method-call-method-unresolved` 缺口

#### Scenario: 守恒
- **WHEN** 对任意语料构建事实图
- **THEN** `coverage.methodCalls` 各桶之和等于读出的调用点数

### Requirement: invokes 边的证据与遍历

`invokes` 边 SHALL 带 `provenance: "extracted"`。每个成边的调用点一条证据：XML 文件与行、`token`（属性值，setter 调用点为属性名的原样写法）、调用点 id，以及所属类解析经过的绑定处。同一条边的证据按文件、行、`token`、调用点 id 排序去重。

图校验 SHALL 要求证据行包含 `token`。`invokes` SHALL 属于可遍历的确定性边类型：从方法节点沿入边可以找到调用它的 XML 文件。

#### Scenario: 证据可复核
- **WHEN** 读 `invokes` 边每条证据的文件与行
- **THEN** 该行含证据里的 `token`

#### Scenario: 从方法遍历到描述文件
- **WHEN** 从 `OrderService#start()` 做 1 跳入边遍历
- **THEN** 结果包含经 `invokes` 到达的 `ctx.xml`
