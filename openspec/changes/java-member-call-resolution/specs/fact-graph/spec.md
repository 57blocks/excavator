## MODIFIED Requirements

### Requirement: 支持的事实节点与事实边

事实节点 SHALL 至少覆盖 file、function/method（包括 Java 接口方法与抽象方法）、class/interface 等抽取器可靠支持的声明，以及可确定性识别的配置/路由等非代码节点。事实边 SHALL 至少覆盖 `contains`、`exports`、`imports`、**能唯一解析目标**的 `calls`，以及能从声明确定的类型层次边 `inherits` / `implements`。不能唯一解析的引用 MUST NOT 猜测，SHALL 写入 gap。每条事实边 SHALL 保留 provenance 与源码证据。

#### Scenario: 唯一可解 call 成边，不可解入 gap
- **WHEN** 一处调用能唯一解析到目标节点
- **THEN** 生成一条带 provenance/证据的 `calls` 边；无法唯一解析时改为记入 gap，而不生成猜测的边

## ADDED Requirements

### Requirement: Java 成员调用按接收者的声明类型解析

系统 SHALL 对 Java 调用点按接收者的静态类型解析。静态类型来自：局部变量、参数与字段的声明类型，`this` / `super`，类名（静态调用），`new` 表达式，强制转换，以及链式调用中前一个调用的声明返回类型。系统 SHALL 在该类型及其仓库内父类型中按方法名与参数个数查找候选，恰好一个声明时生成 `calls` 边，目标为静态类型选中的声明，可以是接口方法或抽象方法。对 Java，系统 MUST NOT 只凭方法名在调用方文件或其导入文件中匹配成员调用。

不能成边的 Java 调用点 SHALL 恰好落入以下一个可见桶：
- `calls-external`：目标类型可证明在仓库外（经导入或 `java.lang` 解析到仓库外的类型；`Object` 的方法；或方法不在仓库内的类型层次中，而该层次显式继承了仓库外的类型，或是隐式继承 `java.lang.Enum` 的枚举）；
- `calls-generated`：目标是源码中没有声明的生成方法（声明字段的访问器、记录的分量访问器与规范构造器、Lombok 构建器方法与构造器、隐式默认构造器、枚举的 `values` / `valueOf`）；
- `calls-ambiguous`：多个候选；
- `calls-unresolved`：接收者类型无法确定，或类型找不到；
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
