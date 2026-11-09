## Context

XML 注入（`xmlInjections`）已经把 Spring `<bean>` 解析到仓库类：目录声明注入点，`xml-name-bindings.mjs` / `name-reference-sites.mjs` 读出注入点与消费者，`name-reference-resolution.mjs` 的绑定表给出名字到类，`xml-injection-resolution.mjs` 决定每个注入点的桶，`build-fact-graph.mjs` 画 `injects` 边。绑定表、行数据与类型查询（`resolver.typeQueries.ancestors`）只在 `build-fact-graph` 里存在，没有落盘。

`unused-code.mjs` 的可达性从 `routes` 的目标出发，只沿函数之间的 `calls`、`implements`、`overrides` 走（:360 起）。名字普查会读 `.xml`，所以 `init-method="start"` 让 `start` 得到 `name-elsewhere`，但 setter 的名字不出现在 XML 里。

## Decisions

### D1 新边 `invokes`，在构建阶段解析

在 `build-fact-graph` 里、XML 注入阶段之后解析方法调用点，产出 `invokes` 边（XML 文件节点 → 方法节点）。

- 为什么不在 unused-code 里补一个按名字的信号：所属类的解析要用绑定表，而它只在构建阶段存在；在 unused-code 里重跑会复制整套解析。按名字的信号也分不清同名方法属于哪个类，只能降可信度，不能判可达。
- 为什么起点是文件节点：调用来自描述文件，不是某个函数；`routes` 已有非函数起点的先例。

### D2 目录声明调用点，代码不认识 Spring

`xmlMethodCalls` 与 `xmlInjections` 平行，字段见 spec。方法名的两种得出方式（`value`、`setter`）、所属类的三种来源（`consumer`、`declared`、`named`）、参数个数与可选，都是目录数据。随附 Spring 条目覆盖：`bean@init-method`、`bean@destroy-method`、`bean@factory-method`（无 `factory-bean` 时 `declared`，有时 `named: factory-bean`）、`lookup-method@name`、`replaced-method@name`、`property@name`（setter）、`p:` 命名空间属性（setter）、`scheduled@method`（`named: ref`）、`aop:before|after|after-returning|after-throwing|around@method`（`named: ref`，在祖先 `aspect` 上），以及根元素的 `default-init-method` / `default-destroy-method`（可选）。

`factory-method` 在有无 `factory-bean` 时所属类不同：拆成两个调用点，按元素是否带 `factory-bean` 属性二选一，由目录的 `when` / `unless` 属性条件表达。

### D3 方法查找

按运行时分派的顺序查找：先所属类，再 `typeQueries.ancestors` 给出的仓库内祖先（近者在前），在第一个有匹配（`owner`、`name`、参数个数）的类型上取方法节点。子类覆写父类方法时，容器调用的是子类的声明，所以只连最近的一个；被覆写的声明由未使用代码沿 `overrides` 的双向规则带到。只有同一类型上的多个匹配（重载）才是歧义。嵌套属性路径（`a.b`，容器调用 `getA().setB`）不建模，落可见桶。构造器不参与。祖先里有仓库外或未知类型、而仓库内没找到时，方法可能来自库，落「方法可能在仓库外」，记缺口——这类调用不能证明仓库内某方法在用，也不能说它不存在。

setter 名按 JavaBeans 规则只把首字母大写（`URL` → `setURL`，`dao` → `setDao`）。

### D4 unused-code 把 `invokes` 的目标当作根

在现有种子循环里，`routes` 与 `invokes` 的目标都是根；守恒仍是「根可达 + 候选 = 全部函数节点」。产物字段 `routeReachable` 保留原名，含义扩为「从根可达」，并新增 `counts.roots = { routes, invokes }`，避免改产物格式号与下游读者。SKILL.md 的定义句同步。

### D5 不做的

- `autowire` 推出的 setter：要按类型或名字匹配全部可写属性，属于按类型注入的范畴。
- `<constructor-arg>` 选构造器：要按参数个数与类型做重载决议。
- 值或表达式里的方法名：`MethodInvokingFactoryBean` 的 `targetMethod` 值、AOP 切点表达式。
- 抽象父定义（`parent`）上的 `init-method` 展开到子定义：与 XML 注入相同，消费者按继承规则解析，但调用点只读自身元素上写的属性。

## Risks

- `PIPELINE_VERSION` 升档，已有 lazy 图全部重建。
- 默认方法（`default-init-method`）在大文件上会为每个 bean 产生一个可选调用点，调用点总数随 bean 数增长；它们多数落「可选未生效」，不是缺口。
- 若某个语料的 bean 类大多继承仓库外的基类（如框架的 `*Support` 类），setter 会大量落「方法可能在仓库外」。这是可见缺口，不是误判。

## Oracle

动手前写死：

- 单元测试：spec 的每个 Scenario 一例；目录校验拒绝缺字段与未知字段；守恒篡改（`vi.mock` 改一个桶）必须报错，与 `xml-injection-conservation` 测试同法。
- 装置先验：去掉 setter 名映射时 property 场景失败；让 `declared` 退回消费者规则时静态工厂场景失败；去掉祖先查找时父类 setter 场景失败。
- 夹具：扩展 `tests/fixtures/spring-xml-injection/` 或新增夹具，覆盖 spec 的全部场景，跑 lazy 后检查边、桶、缺口与图校验通过。
- unused-code：夹具上，被 `invokes` 指向的方法及其调用链不在候选里，`counts.roots.invokes` 等于被指向的方法数。
- 本地真实语料（不用 AWS）：在含 Spring XML 的本地语料（sakai-12.7、oscar、openmrs-workspace、jpetstore-6）上，修复前后各跑 lazy 与 `unused-code candidates`：候选数下降量 = 新增的根可达函数数；每个非零的桶抽 5 条，核对 XML 行与方法声明。不设降幅阈值，照实记录。
- 门：`pnpm -r build`、`pnpm --filter @excavator/core test`、`pnpm run typecheck`、`pnpm test`（与修复前基线比，只允许已知的环境性失败）。

## 验收记录

- 夹具：12 条 `invokes` 边（14 个成边调用点），`coverage.methodCalls` 27 个调用点、各桶之和相等；`unused-code candidates` 的 `counts.roots.invokes` 为 11，被指向的方法及其调用链（`start` → `loadCache`、`warm`）不在候选里，被覆写的 `DupBase#reset()` 经 `overrides` 带到。
- 装置先验：去掉 setter 名映射、`declared` 退回消费者规则、去掉祖先查找、恢复「全部层级一起取」，各有对应测试失败；默认方法在继承库类型的 bean 上落可选未生效的测试，在旧的判定顺序下失败。
- 实现中改动的两条规则（spec 已同步）：方法按运行时分派顺序取最近的声明，覆写不再算歧义；可选调用点找不到方法时一律落可选未生效，不因祖先在仓库外而记缺口。
- 本地真实语料修复前后对照（不用 AWS，各语料在临时克隆上跑 lazy 与 `unused-code candidates`）：

| 语料 | 调用点 | 成边 | `invokes` 边 | 候选（前 → 后） | 新增根可达 |
|---|---|---|---|---|---|
| jpetstore-6 | 5 | 0 | 0 | 364 → 364 | 0 |
| openmrs-core | 59 | 11 | 10 | 15,969 → 15,954 | 15 |
| oscar | 267 | 136 | 124 | 45,846 → 45,723 | 123 |
| sakai-12.7 | 6,898 | 5,261 | 2,970 | 68,511 → 58,364 | 10,147 |

  - 每个语料的候选减少数都等于新增的根可达函数数，没有新增候选；节点数不变，其它边类型的数量不变。
  - 抽查：每个语料随机 5 条 `invokes` 边，XML 行与方法声明都对得上。
  - 缺口抽查：
    - 所属类未解析：`factory-method` 定义的 bean 上的属性（类读不出来）、`factory-bean` 所名 bean 在别的单元（sakai 的 kernel 组件）、`parent` 定义在别的单元。
    - 方法未解析：继承仓库外基类的 setter（如 Hibernate 的工厂 bean）、Lombok `@Setter` 生成的 setter（源码里没有声明）、XML 写了而类上已经没有的 setter。
    - 方法歧义：同一个类上两个单参数的同名 setter（`String` 与 `int`），容器按类型转换选，静态读不出。
