## MODIFIED Requirements

### Requirement: 未使用代码的定义

未使用代码 SHALL 定义为：事实图里的函数节点（方法、函数、构造器），从任何入口出发沿引用都走不到。根 SHALL 是路由处理方法（`routes` 边的目标）与容器调用的方法（`invokes` 边的目标）。引用 SHALL 是这几种事实边：
- `calls`（调用方到被调用方）；
- `routes`（端点到处理方法）；
- `invokes`（描述文件到容器调用的方法）；
- 函数之间的 `implements` 与 `overrides`。

`implements` 与 `overrides` SHALL 按双向处理：被覆写的方法在用，则覆写它的方法可能被分派到；覆写方法在用，则被覆写的声明不能删。

候选产物的计数 SHALL 分别给出 `routes` 的目标数与 `invokes` 的目标数（同时是两者的方法各计一次）。

每个未使用的节点 SHALL 带两种原因之一：
- `unreferenced`：它是簇的入口，即没有任何引用，或属于一个只在内部互相引用的孤岛；
- `only-reachable-from-unused`：它是簇的成员，只被不可达代码引用，记录全部直接引用它的节点（它们都未使用）。

未使用节点 SHALL 按引用连成组报告，每组列出它的全部入口。

只从测试入口可达、不从生产入口可达的节点 SHALL 标为 `test-only`，不计入未使用。方法内部的不可达语句不在本能力范围内。

#### Scenario: A 只被 B 引用，B 没有任何引用
- **WHEN** 方法 B 没有任何引用，方法 A 只被 B 调用，二者都不是入口
- **THEN** B 为 `unreferenced`，A 为 `only-reachable-from-unused` 且记录引用者 B；二者属于同一组，组的入口是 B

#### Scenario: 互相调用的孤岛
- **WHEN** 方法 A 与 B 互相调用，仓库里没有其它引用，二者都不是入口
- **THEN** A 与 B 都为 `unreferenced`，作为同一组的入口报告

#### Scenario: 只被测试调用
- **WHEN** 方法 C 只被测试方法调用，测试方法被判为测试入口
- **THEN** C 为 `test-only`，不出现在未使用候选里

#### Scenario: 容器调用的方法及其调用链不是候选
- **WHEN** `OrderService#start()` 是一条 `invokes` 边的目标，`start` 调用 `loadCache`
- **THEN** `start` 与 `loadCache` 都可达，不出现在候选里；计数里 `invokes` 的目标数为 1
